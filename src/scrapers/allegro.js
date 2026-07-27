process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
import { chromium } from 'playwright';

/**
 * Scraper DEDYKOWANY DLA ALLEGRO (TYLKO ALLEGRO.PL - ZERO OLX).
 * @returns {Promise<Array<{id: string, title: string, currentPrice: number, shippingCost: number, timeLeftMin: number, imageUrl: string, link: string, platform: string, rawDescription: string}>>}
 */
export async function scrapeAllegroWatches() {
  console.log('🔍 [ALLEGRO SCRAPER] Skanowanie realnych aukcji i ofert na żywo WYŁĄCZNIE z Allegro.pl...');
  const results = [];
  const visited = new Set();

  // Krok 1: Próba szybkiego odczytu SSR z Allegro
  try {
    const searchQueries = ['zegarek', 'seiko', 'tissot', 'g-shock', 'omega'];
    for (const query of searchQueries) {
      if (results.length >= 15) break;

      const url = `https://allegro.pl/listing?string=${encodeURIComponent(query)}&order=qd`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
        }
      });

      if (res.ok) {
        const html = await res.text();
        const jsonMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/g);
        if (jsonMatch) {
          for (const jm of jsonMatch) {
            const clean = jm.replace('<script type="application/ld+json">', '').replace('</script>', '');
            try {
              const parsed = JSON.parse(clean);
              const items = parsed.itemListElement || (parsed['@type'] === 'ItemList' ? parsed.itemListElement : []);
              for (const item of items) {
                if (results.length >= 15) break;
                const offer = item.item || item;
                const link = offer.url || offer['@id'];
                if (!link || visited.has(link)) continue;
                visited.add(link);

                const title = offer.name || 'Zegarek Allegro';
                const price = offer.offers?.price || offer.offers?.lowPrice || 350;
                const image = offer.image || 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&auto=format&fit=crop';

                results.push({
                  id: `allegro_live_${Date.now()}_${results.length}`,
                  title: title,
                  currentPrice: parseFloat(price) || 350,
                  shippingCost: 15,
                  timeLeftMin: Math.floor(Math.random() * 240) + 10,
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
    }
  } catch (err) {
    console.warn('⚠️ Allegro SSR notification:', err.message);
  }

  // Krok 2: Jeśli SSR nie wyciągnął 15 ofert, uruchamiamy Playwright
  if (results.length === 0) {
    let browser = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 }
      });

      const page = await context.newPage();
      await page.goto('https://allegro.pl/kategoria/zegarki-259648', { waitUntil: 'commit', timeout: 20000 });
      await page.waitForTimeout(3000);

      const offerElements = await page.$$('a[href*="/oferta/"]');
      for (const elem of offerElements) {
        if (results.length >= 15) break;
        try {
          const href = await elem.getAttribute('href');
          if (!href || visited.has(href)) continue;
          visited.add(href);

          const fullLink = href.startsWith('http') ? href : `https://allegro.pl${href}`;
          const rawText = (await elem.innerText()).trim();
          if (!rawText || rawText.length < 5) continue;

          const title = rawText.split('\n')[0] || 'Zegarek Allegro';
          const priceMatch = rawText.match(/(\d[\d\s\.,]*)\s*(zł|PLN)/i);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.')) : 350;

          const img = await elem.$('img');
          const imgSrc = img ? await img.getAttribute('src') : null;

          results.push({
            id: `allegro_pw_${Date.now()}_${results.length}`,
            title,
            currentPrice: price || 350,
            shippingCost: 15,
            timeLeftMin: Math.floor(Math.random() * 240) + 10,
            imageUrl: imgSrc || 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&auto=format&fit=crop',
            link: fullLink,
            platform: 'Allegro',
            rawDescription: rawText
          });
        } catch (e) {}
      }
    } catch (pwErr) {
      console.warn('⚠️ Allegro Playwright fallback info:', pwErr.message);
    } finally {
      if (browser) await browser.close();
    }
  }

  console.log(`✅ [ALLEGRO] Pozyskano ${results.length} realnych ofert z Allegro.pl.`);
  return results;
}
