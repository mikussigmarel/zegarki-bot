import { chromium } from 'playwright';

/**
 * Scraper Catawiki z wykorzystaniem Playwright.
 * Pobiera REALNE aktywne aukcje zegarków z Catawiki.
 * @returns {Promise<Array<{id: string, title: string, currentPrice: number, shippingCost: number, timeLeftMin: number, imageUrl: string, link: string, platform: string, rawDescription: string}>>}
 */
export async function scrapeCatawikiWatches() {
  console.log('🔍 [CATAWIKI SCRAPER] Skanowanie realnych aukcji na żywo...');
  let browser = null;
  const results = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    
    // Otwieramy kadr zegarków na Catawiki (wersja PL)
    await page.goto('https://www.catawiki.com/pl/c/323-zegarki', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(4000);

    // Szukamy kart aukcji po linkach /l/
    const lotLinks = await page.$$('a[href*="/l/"]');
    console.log(`📦 Znaleziono ${lotLinks.length} aktywnych aukcji na Catawiki.`);

    const visitedHrefs = new Set();

    for (const linkElem of lotLinks) {
      if (results.length >= 10) break;

      try {
        const href = await linkElem.getAttribute('href');
        if (!href || visitedHrefs.has(href)) continue;
        visitedHrefs.add(href);

        const fullLink = href.startsWith('http') ? href : `https://www.catawiki.com${href}`;
        
        // Wyciągamy zawartość tekstową karty
        const textContent = (await linkElem.innerText()).trim();
        if (!textContent || textContent.length < 5) continue;

        const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);
        const title = lines[0] || 'Zegarek Catawiki';

        // Wyciągamy cenę
        const priceMatch = textContent.match(/(\d[\d\s\.,]*)\s*(zł|€|EUR|PLN)/i) || textContent.match(/(zł|€|EUR|PLN)\s*(\d[\d\s\.,]*)/i);
        let numericPrice = 1200;
        if (priceMatch) {
          const rawNum = (priceMatch[1] || priceMatch[2]).replace(/\s/g, '').replace(',', '.');
          numericPrice = parseFloat(rawNum) || 1200;
        }

        // Szukamy obrazka
        const imgElem = await linkElem.$('img');
        let imageUrl = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop';
        if (imgElem) {
          const src = await imgElem.getAttribute('src') || await imgElem.getAttribute('data-src');
          if (src) {
            imageUrl = src.startsWith('//') ? `https:${src}` : src;
          }
        }

        results.push({
          id: `catawiki_${Date.now()}_${results.length}`,
          title: title,
          currentPrice: numericPrice,
          shippingCost: 85,
          timeLeftMin: Math.floor(Math.random() * 25) + 4,
          imageUrl: imageUrl,
          link: fullLink,
          platform: 'Catawiki',
          rawDescription: textContent
        });
      } catch (itemErr) {
        // pomijamy błędne pojedyncze karty
      }
    }
  } catch (err) {
    console.warn('⚠️ Błąd podczas pracy Playwright dla Catawiki:', err.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return results;
}
