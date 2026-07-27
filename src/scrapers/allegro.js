process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
};

/**
 * Pancerny scraper Allegro pobierający oferty z Allegro.
 */
export async function scrapeAllegroWatches() {
  console.log('🔍 [ALLEGRO SCRAPER] Skanowanie realnych ofert na żywo z Allegro...');
  const results = [];
  const visited = new Set();

  const searchQueries = ['zegarek', 'seiko', 'tissot', 'orient', 'omega', 'citizen', 'casio g-shock', 'hamilton', 'certina'];

  for (const query of searchQueries) {
    if (results.length >= 60) break;
    try {
      const url = `https://allegrolokalnie.pl/oferty/q/${encodeURIComponent(query)}?sort=ending`;
      const res = await fetch(url, { headers: secHeaders, signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;

      const html = await res.text();
      const regex = /<a[^>]*href="(\/oferta\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const matches = [...html.matchAll(regex)];

      for (const m of matches) {
        if (results.length >= 60) break;
        const relativeLink = m[1];
        if (visited.has(relativeLink)) continue;
        visited.add(relativeLink);

        const inner = m[2];
        const titleMatch = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || inner.match(/alt="([^"]+)"/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : 'Zegarek Allegro';

        const priceDollarsMatch = inner.match(/class="ml-offer-price__dollars">([\d\s]+)<\/span>/i) || inner.match(/class="[^"]*price[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        if (!priceDollarsMatch) continue;

        const rawP = priceDollarsMatch[1].replace(/\s+/g, '').replace(',', '.');
        const currentPrice = parseFloat(rawP);
        if (isNaN(currentPrice) || currentPrice <= 0) continue;

        const imgMatch = inner.match(/src="([^"]+)"/i);
        const imgUrl = imgMatch ? imgMatch[1].replace('s180x180', 's750x750') : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop';

        const locMatch = inner.match(/<address[^>]*>([\s\S]*?)<\/address>/i);
        const city = locMatch ? locMatch[1].replace(/<[^>]*>/g, '').trim() : 'Polska';

        const isAuction = inner.includes('licytacj') || inner.includes('licytuj');

        results.push({
          id: `allegro_${relativeLink.split('/oferta/')[1]}`,
          title: title,
          currentPrice: currentPrice,
          shippingCost: 15,
          sellerCountry: `Polska, ${city} (Allegro)`,
          timeLeftMin: isAuction ? 180 : 0,
          imageUrl: imgUrl,
          link: `https://allegrolokalnie.pl${relativeLink}`,
          platform: 'Allegro',
          rawDescription: `Tytuł: ${title}\nLokalizacja: ${city}\nPlatforma: Allegro`
        });
      }
    } catch (err) {
      console.warn(`⚠️ Błąd scrapera Allegro (${query}):`, err.message);
    }
  }

  console.log(`✅ [ALLEGRO] Pozyskano ${results.length} realnych ofert z Allegro.`);
  return results;
}
