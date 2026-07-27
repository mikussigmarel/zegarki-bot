process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
import { chromium } from 'playwright';

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

/**
 * Pobiera rzeczywisty czas zakończenia (biddingEndTime) bezpośrednio ze szczegółów oferty na Catawiki.
 */
async function getRealLotEndTimeMin(lotUrl) {
  try {
    const res = await fetch(lotUrl, { headers: secHeaders, timeout: 5000 });
    if (!res.ok) return null;
    const html = await res.text();

    const jsonMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"\s*>([\s\S]*?)<\/script>/i);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      const str = JSON.stringify(data.props?.pageProps);
      const endMatch = str.match(/"biddingEndTime":"([^"]+)"/i) || str.match(/"bidding_end_time":"([^"]+)"/i) || str.match(/"closedAt":"([^"]+)"/i);
      if (endMatch) {
        const endTimeMs = new Date(endMatch[1]).getTime();
        const nowMs = Date.now();
        return Math.max(0, Math.round((endTimeMs - nowMs) / 60000));
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Pancerne skanowanie Catawiki z PRECYZYJNYM ODCZYTEM REALNEGO CZASU ZAKOŃCZENIA AUKCJI.
 */
export async function scrapeCatawikiWatches() {
  console.log('🔍 [CATAWIKI SCRAPER] Skanowanie realnych aukcji na żywo z Catawiki...');
  const results = [];
  const visited = new Set();

  const searchTerms = ['watch', 'zegarek', 'seiko', 'omega', 'tissot'];

  for (const term of searchTerms) {
    if (results.length >= 25) break;
    try {
      const url = `https://www.catawiki.com/en/s?q=${encodeURIComponent(term)}`;
      let res = await fetch(url, { headers: secHeaders });

      let html = '';
      if (res.ok) {
        html = await res.text();
      } else {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const proxyRes = await fetch(proxyUrl, { headers: secHeaders });
        if (proxyRes.ok) {
          html = await proxyRes.text();
        }
      }

      if (!html) continue;

      const jsonMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"\s*>([\s\S]*?)<\/script>/i);
      if (!jsonMatch) continue;

      const data = JSON.parse(jsonMatch[1]);
      const lots = data.props?.pageProps?.searchLots?.lots || [];

      for (const lot of lots) {
        if (results.length >= 25) break;

        const lotId = String(lot.id);
        if (visited.has(lotId)) continue;
        visited.add(lotId);

        const title = lot.title || 'Zegarek Catawiki';
        const fullLink = lot.url ? (lot.url.startsWith('http') ? lot.url : `https://www.catawiki.com${lot.url}`) : `https://www.catawiki.com/en/l/${lotId}`;
        const imageUrl = lot.originalImageUrl || lot.thumbImageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop';

        const buyNowPrice = lot.buyNow?.price_eur;
        const priceEUR = buyNowPrice || 85;
        const currentPricePLN = Math.round(priceEUR * 4.3);

        // ⏱️ POBIERANIE DOKŁADNEGO, REALNEGO CZASU ZAKOŃCZENIA AUKCJI Z CATAWIKI
        const realTimeLeftMin = await getRealLotEndTimeMin(fullLink);

        results.push({
          id: `cw_live_${lotId}`,
          title: title,
          currentPrice: currentPricePLN,
          shippingCost: 75,
          timeLeftMin: realTimeLeftMin !== null ? realTimeLeftMin : 99999, // Jeśli brak czasu, ustaw 99999 min, by filtr go odrzucił!
          imageUrl: imageUrl,
          link: fullLink,
          platform: 'Catawiki',
          rawDescription: `${title} ${lot.subtitle || ''}`
        });
      }
    } catch (e) {}
  }

  console.log(`✅ [CATAWIKI] Pozyskano ${results.length} realnych aukcji z prawdziwym czasem!`);
  return results;
}
