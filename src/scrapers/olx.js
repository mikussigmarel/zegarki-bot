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

/**
 * Super-szybki, odporny na zawieszanie scraper OLX.pl z wyciąganiem lokalizacji i realnych cen.
 */
export async function scrapeOlxWatches() {
  console.log('🔍 [OLX SCRAPER] Skanowanie realnych ofert na żywo z OLX.pl...');
  const results = [];
  const visited = new Set();

  try {
    const searchQueries = ['zegarek', 'seiko', 'tissot', 'orient', 'casio', 'omega'];

    await Promise.all(searchQueries.map(async (query) => {
      if (results.length >= 40) return;

      const url = `https://www.olx.pl/oferty/q-${encodeURIComponent(query)}/`;
      let res = await fetchWithStrictTimeout(url, { headers: secHeaders }, 3000);

      let html = '';
      if (res && res.ok) {
        html = await res.text();
      } else {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const proxyRes = await fetchWithStrictTimeout(proxyUrl, { headers: secHeaders }, 3500);
        if (proxyRes && proxyRes.ok) {
          html = await proxyRes.text();
        }
      }

      if (!html) return;

      const stateMatch = html.match(/window\.__PRERENDERED_STATE__\s*=\s*"([\s\S]*?)";/i);
      if (stateMatch) {
        try {
          const unescaped = stateMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          const data = JSON.parse(unescaped);
          const ads = data.listing?.listing?.ads || [];

          for (const ad of ads) {
            if (results.length >= 40) break;
            const id = String(ad.id);
            if (visited.has(id)) continue;
            visited.add(id);

            const title = ad.title || 'Zegarek OLX';
            const priceVal = ad.price?.regularPrice?.value || parseFloat((ad.price?.displayValue || '').replace(/[^\d.]/g, ''));
            if (!priceVal || isNaN(priceVal)) continue;

            const city = ad.location?.cityName || 'Polska';
            const link = ad.url ? (ad.url.startsWith('http') ? ad.url : `https://www.olx.pl${ad.url}`) : `https://www.olx.pl/d/oferta/${id}`;
            const photo = ad.photos?.[0]?.link ? ad.photos[0].link.replace('{width}', '1000').replace('{height}', '750') : 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&auto=format&fit=crop';

            results.push({
              id: `olx_${id}`,
              title: title,
              currentPrice: parseFloat(priceVal),
              shippingCost: 12, // Przesyłka OLX
              sellerCountry: `Polska, ${city} (OLX)`,
              timeLeftMin: 120, // Oferty kup teraz na OLX
              imageUrl: photo,
              link: link,
              platform: 'OLX',
              rawDescription: `${title} ${ad.description || ''} [Lokalizacja: ${city}]`
            });
          }
        } catch (err) {}
      }
    }));
  } catch (err) {
    console.warn('⚠️ Błąd scrapera OLX:', err.message);
  }

  console.log(`✅ [OLX] Pozyskano ${results.length} realnych ofert z OLX.pl!`);
  return results;
}
