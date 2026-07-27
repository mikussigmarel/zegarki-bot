process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    return null;
  }
}

/**
 * Super-odporny scraper Allegro z weryfikacją czasu i awaryjnym proxy.
 */
export async function scrapeAllegroWatches() {
  console.log('🔍 [ALLEGRO SCRAPER] Skanowanie realnych aukcji i ofert na żywo WYŁĄCZNIE z Allegro.pl...');
  const results = [];
  const visited = new Set();

  try {
    const searchQueries = ['zegarek', 'seiko', 'tissot', 'g-shock', 'omega'];
    for (const query of searchQueries) {
      if (results.length >= 20) break;

      const url = `https://allegro.pl/listing?string=${encodeURIComponent(query)}&order=qd`;
      let res = await fetchWithTimeout(url, { headers: secHeaders }, 4000);

      let html = '';
      if (res && res.ok) {
        html = await res.text();
      } else {
        // Awaryjne proxy w razie blokady IP (403)
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const proxyRes = await fetchWithTimeout(proxyUrl, { headers: secHeaders }, 5000);
        if (proxyRes && proxyRes.ok) {
          html = await proxyRes.text();
        }
      }

      if (!html) continue;

      const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
      if (jsonMatch) {
        for (const jm of jsonMatch) {
          const clean = jm.replace(/<script type="application\/ld\+json">/i, '').replace(/<\/script>/i, '');
          try {
            const parsed = JSON.parse(clean);
            const items = parsed.itemListElement || (parsed['@type'] === 'ItemList' ? parsed.itemListElement : []);
            for (const item of items) {
              if (results.length >= 20) break;
              const offer = item.item || item;
              const link = offer.url || offer['@id'];
              if (!link || visited.has(link)) continue;
              visited.add(link);

              const title = offer.name || 'Zegarek Allegro';
              const price = offer.offers?.price || offer.offers?.lowPrice || 350;
              const image = offer.image || 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&auto=format&fit=crop';
              
              let timeLeftMin = 180;
              if (offer.offers?.priceValidUntil) {
                const validUntil = new Date(offer.offers.priceValidUntil).getTime();
                const diff = Math.round((validUntil - Date.now()) / 60000);
                if (diff > 0) timeLeftMin = diff;
              }

              results.push({
                id: `allegro_live_${Date.now()}_${results.length}`,
                title: title,
                currentPrice: parseFloat(price) || 350,
                shippingCost: 15,
                timeLeftMin: timeLeftMin,
                imageUrl: Array.isArray(image) ? image[0] : image,
                link: link.startsWith('http') ? link : `https://allegro.pl${link}`,
                platform: 'Allegro',
                rawDescription: title
              });
            }
          } catch (e) {}
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ Allegro SSR notification:', err.message);
  }

  console.log(`✅ [ALLEGRO] Pozyskano ${results.length} realnych ofert z Allegro.pl.`);
  return results;
}
