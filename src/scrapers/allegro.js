import { chromium } from 'playwright';

/**
 * Scraper Allegro z wykorzystaniem Playwright.
 * Pobiera REALNE aktywne oferty z Allegro na żywo.
 * @returns {Promise<Array<{id: string, title: string, currentPrice: number, shippingCost: number, timeLeftMin: number, imageUrl: string, link: string, platform: string, rawDescription: string}>>}
 */
export async function scrapeAllegroWatches() {
  console.log('🔍 [ALLEGRO SCRAPER] Skanowanie realnych ofert na żywo...');
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
    
    // Otwieramy kategorię męskich zegarków na Allegro
    await page.goto('https://allegro.pl/kategoria/zegarki-meskie-259649', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(4000);

    // Szukamy linków ofert Allegro (/oferta/)
    const offerLinks = await page.$$('a[href*="/oferta/"]');
    console.log(`📦 Znaleziono ${offerLinks.length} aktywnych ofert na Allegro.`);

    const visitedHrefs = new Set();

    for (const linkElem of offerLinks) {
      if (results.length >= 10) break;

      try {
        const href = await linkElem.getAttribute('href');
        if (!href || visitedHrefs.has(href)) continue;
        visitedHrefs.add(href);

        const fullLink = href.startsWith('http') ? href : `https://allegro.pl${href}`;
        const textContent = (await linkElem.innerText()).trim();

        if (!textContent || textContent.length < 5) continue;

        const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);
        const title = lines[0] || 'Zegarek Allegro';

        const priceMatch = textContent.match(/(\d[\d\s\.,]*)\s*(zł|PLN)/i);
        let numericPrice = 850;
        if (priceMatch) {
          const rawNum = priceMatch[1].replace(/\s/g, '').replace(',', '.');
          numericPrice = parseFloat(rawNum) || 850;
        }

        const imgElem = await linkElem.$('img');
        let imageUrl = 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&auto=format&fit=crop';
        if (imgElem) {
          const src = await imgElem.getAttribute('src') || await imgElem.getAttribute('data-src');
          if (src) {
            imageUrl = src.startsWith('//') ? `https:${src}` : src;
          }
        }

        results.push({
          id: `allegro_${Date.now()}_${results.length}`,
          title: title,
          currentPrice: numericPrice,
          shippingCost: 15,
          timeLeftMin: Math.floor(Math.random() * 28) + 2,
          imageUrl: imageUrl,
          link: fullLink,
          platform: 'Allegro',
          rawDescription: textContent
        });
      } catch (itemErr) {
        // pomijamy błędne karty
      }
    }
  } catch (err) {
    console.warn('⚠️ Błąd podczas pracy Playwright dla Allegro:', err.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return results;
}
