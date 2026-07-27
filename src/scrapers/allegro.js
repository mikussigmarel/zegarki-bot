process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
};

async function fetchWithStrictTimeout(url, options = {}, timeoutMs = 3000) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return null;
  }
}

async function fetchAllegroHtmlWithProxy(url) {
  // 1. Bezpośrednie zapytanie
  let res = await fetchWithStrictTimeout(url, { headers: secHeaders }, 2500);
  if (res && res.ok) {
    const html = await res.text();
    if (html.includes('__allegro_listing_state') || html.includes('allegro.pl')) return html;
  }

  // 2. Multi-proxy fallback dla adresów IP datacenter (Render / AWS)
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];

  for (const proxyUrl of proxies) {
    let pRes = await fetchWithStrictTimeout(proxyUrl, { headers: secHeaders }, 3500);
    if (pRes && pRes.ok) {
      const html = await pRes.text();
      if (html.includes('__allegro_listing_state') || html.length > 40000) return html;
    }
  }

  return '';
}

/**
 * Pancerny scraper Allegro.pl pobierający wyłącznie realne trwające AUKCJE zegarków kończące się najszybciej.
 */
export async function scrapeAllegroWatches() {
  console.log('🔍 [ALLEGRO SCRAPER] Skanowanie realnych aukcji na żywo z Allegro.pl...');
  const results = [];
  const visited = new Set();

  try {
    // Dwie rundy: AUKCJE (kończące się najwcześniej) + KUP TERAZ (najtańsze)
    const searchTerms = ['zegarek', 'seiko', 'tissot', 'orient', 'omega', 'citizen', 'casio g-shock', 'hamilton', 'certina'];
    const searchUrls = [];
    for (const term of searchTerms) {
      // Aukcje kończące się najszybciej
      searchUrls.push(`https://allegro.pl/listing?string=${encodeURIComponent(term)}&offerType=auction&order=qd`);
      // Kup Teraz – najtańsze
      searchUrls.push(`https://allegro.pl/listing?string=${encodeURIComponent(term)}&offerType=buyNow&order=p`);
    }

    await Promise.all(searchUrls.map(async (url) => {
      if (results.length >= 60) return;
      const html = await fetchAllegroHtmlWithProxy(url);
      if (!html) return;

      const stateMatch = html.match(/__allegro_listing_state\s*=\s*"([\s\S]*?)";/i) || html.match(/__allegro_listing_state\s*=\s*(\{[\s\S]*?\});/i);
      if (stateMatch) {
        try {
          let rawJson = stateMatch[1];
          if (rawJson.startsWith('"') || rawJson.includes('\\"')) {
            rawJson = JSON.parse(`"${rawJson}"`);
          }
          const stateData = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
          const itemsGroups = stateData?.__elements__ || stateData?.items?.promoted || stateData?.items?.regular || [];

          let allItems = [];
          if (Array.isArray(itemsGroups)) {
            allItems = itemsGroups;
          } else if (typeof itemsGroups === 'object') {
            for (const key in itemsGroups) {
              if (Array.isArray(itemsGroups[key])) {
                allItems.push(...itemsGroups[key]);
              }
            }
          }

          for (const item of allItems) {
            if (results.length >= 60) break;
            const itemId = String(item.id || item.url || Math.random());
            if (visited.has(itemId)) continue;
            visited.add(itemId);

            const title = item.title?.text || item.title || 'Zegarek Allegro';
            const priceVal = item.price?.normal?.amount || item.price?.main?.amount || item.price?.amount;
            if (!priceVal) continue;

            const currentPrice = parseFloat(priceVal);
            if (isNaN(currentPrice)) continue;

            // ⏱ Czas do końca aukcji z Allegro
            let timeLeftMin = 180;
            if (item.endingTime || item.auctionInfo?.endingTime) {
              const endMs = new Date(item.endingTime || item.auctionInfo.endingTime).getTime();
              if (!isNaN(endMs)) {
                timeLeftMin = Math.max(0, Math.round((endMs - Date.now()) / 60000));
              }
            }

            const isAuction = item.isAuction || item.offerType === 'auction' || item.auctionInfo !== undefined || (item.url && item.url.includes('aukcja'));
            // Kup Teraz nie ma timeLeftMin – ustawiamy 0 (zawsze dostępne)
            if (!isAuction) {
              timeLeftMin = 0; // Kup Teraz = bez limitu czasu
            }
            if (isAuction && timeLeftMin > 300) continue;

            const fullLink = item.url ? (item.url.startsWith('http') ? item.url : `https://allegro.pl${item.url}`) : `https://allegro.pl/oferta/${itemId}`;
            const imgUrl = item.images?.[0]?.url || item.primaryImage?.url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop';

            const subtitleText = item.subtitle?.text || item.subtitle || '';
            const paramsText = Array.isArray(item.parameters) ? item.parameters.map(p => `${p.name || ''}: ${(p.values || []).join(', ')}`).join('; ') : '';

            results.push({
              id: `allegro_${itemId}`,
              title: title,
              currentPrice: currentPrice,
              shippingCost: 15,
              sellerCountry: 'Polska (Allegro)',
              timeLeftMin: timeLeftMin,
              imageUrl: imgUrl,
              link: fullLink,
              platform: 'Allegro',
              rawDescription: `Tytuł: ${title}\nPodtytuł: ${subtitleText}\nParametry Allegro: ${paramsText}\nCzas do końca: ${timeLeftMin} min`
            });
          }
        } catch (e) {}
      }
    }));
  } catch (err) {
    console.warn('⚠️ Błąd scrapera Allegro:', err.message);
  }

  console.log(`✅ [ALLEGRO] Pozyskano ${results.length} realnych ofert z Allegro.pl.`);
  return results;
}
