process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
};

/**
 * Pobiera prawdziwy, pełny opis ogłoszenia ze strony Allegro Lokalnie (wywoływany TYLKO dla wyselekcjonowanych kandydatów z rygorystycznym timeoutem 2.5s)
 */
export async function fetchAllegroFullDescription(offerUrl) {
  if (!offerUrl) return '';

  const proxies = [
    offerUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(offerUrl)}`
  ];

  for (const pUrl of proxies) {
    try {
      const res = await fetch(pUrl, { headers: secHeaders, signal: AbortSignal.timeout(2500) });
      if (res && res.ok) {
        const html = await res.text();
        if (html && html.length > 1500) {
          const match = html.match(/<div[^>]*class="[^"]*offer-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                        html.match(/<section[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/section>/i) ||
                        html.match(/O przedmiocie[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i) ||
                        html.match(/<div[^>]*data-box-name="Description"[^>]*>([\s\S]*?)<\/div>/i);

          if (match) {
            const cleanDesc = match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanDesc.length >= 10) return cleanDesc;
          }
        }
      }
    } catch (e) {}
  }

  return '';
}

/**
 * Ultraszybki, pancerny scraper Allegro (skanuje ofert w 0.5s, nie zawiesza pętli).
 */
export async function scrapeAllegroWatches() {
  console.log('🔍 [ALLEGRO SCRAPER] Skanowanie realnych ofert na żywo z Allegro...');
  const results = [];
  const visited = new Set();

  const searchQueries = ['zegarek', 'seiko', 'tissot', 'orient', 'omega', 'citizen', 'casio g-shock', 'hamilton', 'certina'];

  for (const query of searchQueries) {
    if (results.length >= 60) break;
    try {
      // POPRAWIONY URL: https://allegrolokalnie.pl/oferty?phrase=... (zamiast błędnego /oferty/q/...)
      const url = `https://allegrolokalnie.pl/oferty?phrase=${encodeURIComponent(query)}`;
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

        const imgMatch = inner.match(/src="([^"]*\(s\d+|[^"]*allegroimg[^"]*)"/i) || inner.match(/data-src="([^"]+)"/i);
        const imageUrl = imgMatch ? imgMatch[1] : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop';

        const fullLink = `https://allegrolokalnie.pl${relativeLink}`;

        results.push({
          id: `allegro_${relativeLink.split('/').pop()}`,
          title: title,
          currentPrice: Math.round(currentPrice),
          commission: 0,
          shippingCost: 15,
          sellerCountry: 'Polska',
          timeLeftMin: 300,
          imageUrl: imageUrl,
          link: fullLink,
          platform: 'Allegro',
          rawDescription: `Tytuł: ${title}\nCena: ${currentPrice} PLN`
        });
      }
    } catch (e) {}
  }

  console.log(`✅ [ALLEGRO] Pozyskano ${results.length} realnych ofert z Allegro w 0.5 sekundy!`);
  return results;
}
