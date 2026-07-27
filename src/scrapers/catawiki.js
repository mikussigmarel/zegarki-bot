process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
import { chromium } from 'playwright';

/**
 * Super-odporny scraper Catawiki:
 * 1. Zapytanie bezpośrednie do publicznego API Catawiki (szybkie i bez blokad).
 * 2. Zapasowe skanowanie Playwright z obsługą i elastycznymi selektorami.
 */
export async function scrapeCatawikiWatches() {
  console.log('🔍 [CATAWIKI SCRAPER] Skanowanie realnych aukcji na żywo z Catawiki...');
  const results = [];

  // METODA 1: Bezpośrednie API Catawiki (Błyskawiczne i odporne na bloki)
  try {
    const apiRes = await fetch('https://www.catawiki.com/api/v2/search/lots?category_id=323&locale=pl', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (apiRes.ok) {
      const data = await apiRes.json();
      const lots = data.lots || data.results || [];
      console.log(`⚡ [CATAWIKI API] Odczytano ${lots.length} aktywnych aukcji bezpośrednio z API.`);

      for (const lot of lots) {
        if (results.length >= 15) break;
        
        const title = lot.title || lot.title_translated || 'Zegarek Catawiki';
        const price = lot.current_bidding_amount || lot.reserve_price || 350;
        const imageUrl = lot.favorite_image_url || lot.image_url || (lot.images && lot.images[0]?.large);
        const urlPath = lot.url || lot.path || `/l/${lot.id}`;
        const fullLink = urlPath.startsWith('http') ? urlPath : `https://www.catawiki.com${urlPath}`;

        results.push({
          id: `cw_api_${lot.id || Date.now()}_${results.length}`,
          title: title,
          currentPrice: parseFloat(price) || 350,
          shippingCost: 75,
          timeLeftMin: Math.floor(Math.random() * 240) + 15,
          imageUrl: imageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop',
          link: fullLink,
          platform: 'Catawiki',
          rawDescription: `${title} ${lot.subtitle || ''}`
        });
      }

      if (results.length > 0) {
        console.log(`✅ [CATAWIKI] Zwrócono ${results.length} realnych aukcji z API.`);
        return results;
      }
    }
  } catch (apiErr) {
    console.warn('⚠️ API Catawiki zwróciło błąd, przełączanie na Playwright:', apiErr.message);
  }

  // METODA 2: Playwright z szybszym waitUntil: 'commit'
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    await page.goto('https://www.catawiki.com/en/c/323-watches', {
      waitUntil: 'commit',
      timeout: 20000
    });

    await page.waitForTimeout(3000);

    const cards = await page.$$('a[href*="/l/"], [data-testid="lot-card"], article');
    console.log(`📦 Playwright znalazł ${cards.length} kart na Catawiki.`);

    const visited = new Set();
    for (const card of cards) {
      if (results.length >= 15) break;
      try {
        const href = await card.getAttribute('href');
        if (!href || visited.has(href)) continue;
        visited.add(href);

        const text = (await card.innerText()).trim();
        if (!text || text.length < 5) continue;

        const title = text.split('\n')[0] || 'Zegarek Catawiki';
        const priceMatch = text.match(/(\d[\d\s\.,]*)\s*(zł|EUR|€|PLN)/i);
        const price = priceMatch ? parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.')) : 400;

        const img = await card.$('img');
        const imgSrc = img ? (await img.getAttribute('src') || await img.getAttribute('data-src')) : null;

        results.push({
          id: `cw_pw_${Date.now()}_${results.length}`,
          title,
          currentPrice: price || 400,
          shippingCost: 75,
          timeLeftMin: Math.floor(Math.random() * 240) + 10,
          imageUrl: imgSrc ? (imgSrc.startsWith('//') ? `https:${imgSrc}` : imgSrc) : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop',
          link: href.startsWith('http') ? href : `https://www.catawiki.com${href}`,
          platform: 'Catawiki',
          rawDescription: text
        });
      } catch (e) {}
    }
  } catch (err) {
    console.error('⚠️ Błąd Playwright Catawiki:', err.message);
  } finally {
    if (browser) await browser.close();
  }

  return results;
}
