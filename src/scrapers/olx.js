process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'pl-PL,pl;q=0.9'
};

/**
 * Wyciąga pełną treść opisu ogłoszenia ze strony OLX
 */
async function fetchOlxFullDescription(offerUrl) {
  if (!offerUrl) return '';
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(offerUrl)}`;
    const res = await fetch(proxyUrl, { headers: secHeaders, signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/<div[^>]*data-cy="ad_description"[^>]*>([\s\S]*?)<\/div>/i) ||
                    html.match(/<div[^>]*class="[^"]*css-1o924fl[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                    html.match(/<div[^>]*class="[^"]*css-1234[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (match) {
        return match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  } catch (e) {}
  return '';
}

/**
 * Pancerne skanowanie OLX.pl oparte o oficjalne API REST OLX oraz pobieranie pełnych opisów sprzedawców.
 */
export async function scrapeOlxWatches() {
  console.log('🔍 [OLX SCRAPER] Skanowanie realnych ofert na żywo z oficjalnego API OLX.pl...');
  const results = [];
  const visited = new Set();

  try {
    const searchQueries = ['zegarek męski', 'zegarek seiko', 'zegarek tissot', 'zegarek orient', 'zegarek casio g-shock', 'zegarek omega', 'zegarek citizen', 'zegarek hamilton', 'zegarek certina', 'zegarek longines'];

    await Promise.all(searchQueries.map(async (query) => {
      if (results.length >= 60) return;

      const apiUrl = `https://www.olx.pl/api/v1/offers/?offset=0&limit=40&query=${encodeURIComponent(query)}`;
      try {
        const res = await fetch(apiUrl, {
          headers: secHeaders,
          signal: AbortSignal.timeout(4000)
        });

        if (res.ok) {
          const json = await res.json();
          const items = json.data || [];

          for (const item of items) {
            if (results.length >= 60) break;
            const id = String(item.id);
            if (visited.has(id)) continue;
            visited.add(id);

            const title = item.title || 'Zegarek OLX';
            const lowerTitle = title.toLowerCase();

            // Pomijaj instrumenty muzyczne i nie-zegarki
            if (lowerTitle.includes('keyboard') || lowerTitle.includes('pianino') || lowerTitle.includes('gitar') || lowerTitle.includes('kalkulator')) continue;
            if (lowerTitle.includes('smartwatch') || lowerTitle.includes('apple watch') || lowerTitle.includes('galaxy watch') || lowerTitle.includes('budzik') || lowerTitle.includes('ścienny') || lowerTitle.includes('nakręcarka')) continue;

            const priceParam = item.params?.find(p => p.key === 'price');
            const priceVal = priceParam?.value?.value || item.price?.value;
            if (!priceVal || isNaN(priceVal)) continue;

            const city = item.location?.city?.name || 'Polska';
            const link = item.url || `https://www.olx.pl/d/oferta/${id}`;
            const photo = item.photos?.[0]?.link ? item.photos[0].link.replace('{width}', '1000').replace('{height}', '750') : 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&auto=format&fit=crop';

            let cleanDesc = (item.description || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();

            // Jeśli opis z API jest za krótki, dociągnij pełny opis ze strony ogłoszenia
            if (cleanDesc.length < 15) {
              const fullWebDesc = await fetchOlxFullDescription(link);
              if (fullWebDesc.length >= 10) {
                cleanDesc = fullWebDesc;
              }
            }

            const paramsText = item.params ? item.params.map(p => `${p.name || p.key}: ${p.value?.label || p.value?.value || ''}`).join('; ') : '';
            const fullRawDesc = `Tytuł ogłoszenia: ${title}\nOpis sprzedawcy:\n${cleanDesc}\nParametry ogłoszenia: ${paramsText}\nLokalizacja: ${city}`;

            results.push({
              id: `olx_${id}`,
              title: title,
              currentPrice: parseFloat(priceVal),
              shippingCost: 12,
              sellerCountry: `Polska, ${city} (OLX)`,
              timeLeftMin: 120,
              imageUrl: photo,
              link: link,
              platform: 'OLX',
              rawDescription: fullRawDesc
            });
          }
        }
      } catch (err) {
        console.warn(`⚠️ Ostrzeżenie OLX query (${query}):`, err.message);
      }
    }));
  } catch (err) {
    console.warn('⚠️ Błąd scrapera OLX:', err.message);
  }

  console.log(`✅ [OLX] Pozyskano ${results.length} realnych ofert z OLX.pl z pełną analityką opisów!`);
  return results;
}
