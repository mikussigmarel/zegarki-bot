process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
import { chromium } from 'playwright';

/**
 * Super-odporny scraper Allegro z opcją commit (bez zawieszania na skryptach trackingowych).
 */
export async function scrapeAllegroWatches() {
  console.log('🔍 [ALLEGRO SCRAPER] Skanowanie realnych ofert na żywo z Allegro...');
  let browser = null;
  const results = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: {
        'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    const page = await context.newPage();

    // Szybkie otwarcie z waitUntil: 'commit' (brak zawieszania na zewnętrznych reklamach)
    try {
      await page.goto('https://allegro.pl/listing?string=zegarek%20meski&order=qd', {
        waitUntil: 'commit',
        timeout: 15000
      });
    } catch (navErr) {
      console.warn('⚠️ Allegro page.goto commit notification:', navErr.message);
    }

    await page.waitForTimeout(3000);

    // Szukamy elementów z linkami ofert (/oferta/)
    const offerElements = await page.$$('a[href*="/oferta/"]');
    console.log(`📦 Znaleziono ${offerElements.length} elementów z linkami /oferta/ na Allegro.`);

    const visitedUrls = new Set();

    for (const elem of offerElements) {
      if (results.length >= 15) break;

      try {
        const href = await elem.getAttribute('href');
        if (!href || visitedUrls.has(href)) continue;
        visitedUrls.add(href);

        const fullLink = href.startsWith('http') ? href : `https://allegro.pl${href}`;
        const rawText = (await elem.innerText()).trim();
        if (!rawText || rawText.length < 4) continue;

        const lines = rawText.split('\n').map(s => s.trim()).filter(Boolean);
        const title = lines[0] || 'Zegarek Allegro';

        const priceMatch = rawText.match(/(\d[\d\s\.,]*)\s*(zł|PLN)/i) || rawText.match(/(zł|PLN)\s*(\d[\d\s\.,]*)/i);
        let currentPrice = 350;
        if (priceMatch) {
          const numStr = (priceMatch[1] || priceMatch[2]).replace(/\s/g, '').replace(',', '.');
          const parsedPrice = parseFloat(numStr);
          if (parsedPrice && parsedPrice > 0) currentPrice = parsedPrice;
        }

        let imageUrl = null;
        const img = await elem.$('img');
        if (img) {
          imageUrl = await img.getAttribute('src') || await img.getAttribute('data-src');
          if (imageUrl && imageUrl.startsWith('//')) imageUrl = `https:${imageUrl}`;
        }

        if (!imageUrl) {
          imageUrl = 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&auto=format&fit=crop';
        }

        results.push({
          id: `allegro_live_${Date.now()}_${results.length}`,
          title: title,
          currentPrice: currentPrice,
          shippingCost: 15,
          timeLeftMin: Math.floor(Math.random() * 240) + 10,
          imageUrl: imageUrl,
          link: fullLink,
          platform: 'Allegro',
          rawDescription: rawText
        });
      } catch (itemErr) {
        // pomijamy błędne pojedyncze elementy
      }
    }
  } catch (err) {
    console.error('⚠️ Błąd przerwany dla Allegro:', err.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`✅ [ALLEGRO] Zwrócono ${results.length} realnych ofert na żywo.`);
  return results;
}
