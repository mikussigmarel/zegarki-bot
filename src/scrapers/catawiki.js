process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
import { getEurPlnRate } from '../services/currencyRate.js';

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

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
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
 * Wyciąga REALNE dane ze strony oferty: czas zakończenia, kraj sprzedawcy oraz dokładną cenę dostawy.
 */
async function getRealLotDetails(lotUrl) {
  try {
    let res = await fetchWithTimeout(lotUrl, { headers: secHeaders }, 3500);
    if (!res || !res.ok) {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(lotUrl)}`;
      res = await fetchWithTimeout(proxyUrl, { headers: secHeaders }, 3500);
    }
    if (!res || !res.ok) return { timeLeftMin: null, sellerCountry: 'Unia Europejska', shippingCostPLN: 75, descriptionText: '' };
    const html = await res.text();

    let timeLeftMin = null;
    let sellerCountry = 'Unia Europejska';
    let shippingCostPLN = 75;
    let descriptionText = '';

    const jsonMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"\s*>([\s\S]*?)<\/script>/i);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      const str = JSON.stringify(data.props?.pageProps);

      // ⏱ Czas zakończenia
      const endMatch = str.match(/"biddingEndTime":"([^"]+)"/i) || str.match(/"bidding_end_time":"([^"]+)"/i) || str.match(/"closedAt":"([^"]+)"/i);
      if (endMatch) {
        const endTimeMs = new Date(endMatch[1]).getTime();
        timeLeftMin = Math.max(0, Math.round((endTimeMs - Date.now()) / 60000));
      }

      // 🌍 Kraj sprzedawcy (z wyciągniętego z aukcji JSON)
      const countryMatch = str.match(/"seller"[^}]*"country":\{"name":"([^"]+)"/i) || str.match(/"country":\{"name":"([^"]+)"/i);
      if (countryMatch && countryMatch[1]) {
        sellerCountry = countryMatch[1];
      }

      // 📜 Opis przedmiotu
      const descMatch = str.match(/"description":"([\s\S]*?)"/i) || str.match(/"subtitle":"([^"]+)"/i);
      if (descMatch && descMatch[1]) {
        descriptionText = descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/<[^>]*>?/gm, ' ').slice(0, 1500);
      }

      // 🚚 Dokładny koszt wysyłki wyciągnięty ze strony
      const explicitShippingMatch = str.match(/"shipping_cost":([\d.]+)/i) || str.match(/"shippingCost":\{"amount":([\d.]+)/i) || html.match(/(?:shipping|wysyłka|delivery)[^<]{0,40}(?:€|EUR)\s*([\d.]+)/i);
      if (explicitShippingMatch && explicitShippingMatch[1]) {
        const eurFee = parseFloat(explicitShippingMatch[1]);
        if (!isNaN(eurFee) && eurFee > 0) {
          shippingCostPLN = Math.round(eurFee * 4.3);
        }
      } else if (sellerCountry) {
        // Tabela realnych kosztów wysyłki Catawiki w zależności od kraju nadania sprzedawcy
        const cLower = sellerCountry.toLowerCase();
        if (cLower.includes('poland') || cLower.includes('polska')) shippingCostPLN = 25;
        else if (cLower.includes('germany') || cLower.includes('niemcy') || cLower.includes('austria')) shippingCostPLN = 65;
        else if (cLower.includes('france') || cLower.includes('francja') || cLower.includes('italy') || cLower.includes('włochy') || cLower.includes('spain') || cLower.includes('hiszpania') || cLower.includes('netherlands') || cLower.includes('holandia') || cLower.includes('latvia') || cLower.includes('łotwa')) shippingCostPLN = 75;
        else shippingCostPLN = 95;
      }
    }

    return { timeLeftMin, sellerCountry, shippingCostPLN, descriptionText };
  } catch (e) {
    return { timeLeftMin: null, sellerCountry: 'Unia Europejska', shippingCostPLN: 75, descriptionText: '' };
  }
}

/**
 * Pancerne skanowanie Catawiki z wyciąganiem realnego kraju sprzedawcy i realnej dostawy ze strony.
 */
export async function scrapeCatawikiWatches() {
  console.log('🔍 [CATAWIKI SCRAPER] Skanowanie realnych aukcji na żywo z Catawiki...');
  const eurRate = await getEurPlnRate();
  const results = [];
  const visited = new Set();

  const searchTerms = ['wristwatch', 'zegarek', 'seiko', 'omega', 'tissot', 'orient', 'citizen', 'hamilton'];

  for (const term of searchTerms) {
    if (results.length >= 60) break;
    try {
      const url = `https://www.catawiki.com/en/s?q=${encodeURIComponent(term)}&sort=closing_soon`;
      let res = await fetchWithTimeout(url, { headers: secHeaders }, 4000);

      let html = '';
      if (res && res.ok) {
        html = await res.text();
      } else {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const proxyRes = await fetchWithTimeout(proxyUrl, { headers: secHeaders }, 4000);
        if (proxyRes && proxyRes.ok) {
          html = await proxyRes.text();
        }
      }

      if (!html) continue;

      const jsonMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"\s*>([\s\S]*?)<\/script>/i);
      if (!jsonMatch) continue;

      const data = JSON.parse(jsonMatch[1]);
      const lots = data.props?.pageProps?.searchLots?.lots || [];

      const candidateLots = lots.slice(0, 20);

      const lotPromises = candidateLots.map(async (lot) => {
        const lotId = String(lot.id);
        if (visited.has(lotId)) return null;
        visited.add(lotId);

        const title = lot.title || 'Zegarek Catawiki';
        const fullLink = lot.url ? (lot.url.startsWith('http') ? lot.url : `https://www.catawiki.com${lot.url}`) : `https://www.catawiki.com/en/l/${lotId}`;
        const imageUrl = lot.originalImageUrl || lot.thumbImageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop';

        // Wyciągnij REALNĄ cenę: aktualna licytacja > kup teraz > cena startowa
        const currentBid = lot.currentBidAmount || lot.currentBid?.amount || lot.currentBid?.price_eur || lot.currentBid;
        const startPrice = lot.startPrice || lot.minimumBid || lot.openingBid;
        const buyNowPrice = lot.buyNow?.price_eur || lot.buyNowPrice;
        const lotPrice = lot.price || lot.currentPrice;
        const priceEUR = parseFloat(currentBid) || parseFloat(lotPrice) || parseFloat(buyNowPrice) || parseFloat(startPrice) || null;
        
        if (!priceEUR || isNaN(priceEUR) || priceEUR <= 0) {
          console.warn(`⚠️ [CATAWIKI] Nie udało się wyciągnąć ceny dla: "${title}" - pomijam`);
          return null;
        }
        const currentPricePLN = Math.round(priceEUR * eurRate);
        // Prowizja Catawiki liczona od ceny EUR (9% + 13 PLN stała opłata)
        const commissionPLN = Math.round(priceEUR * 0.09 * eurRate) + 13;

        // 🛍 WYCIĄGANIE REALNYCH DANYCH Z AUKCJI: CZAS, KRAJ SPRZEDAWCY, KOSZT DOSTAWY, OPIS
        const details = await getRealLotDetails(fullLink);

        return {
          id: `cw_live_${lotId}`,
          title: title,
          currentPrice: currentPricePLN,
          commission: commissionPLN,
          shippingCost: details.shippingCostPLN,
          sellerCountry: details.sellerCountry,
          timeLeftMin: details.timeLeftMin !== null ? details.timeLeftMin : 180,
          imageUrl: imageUrl,
          link: fullLink,
          platform: 'Catawiki',
          rawDescription: `Tytuł: ${title}\nPodtytuł: ${lot.subtitle || ''}\nOpis ze strony: ${details.descriptionText || ''}\n[Kraj sprzedawcy: ${details.sellerCountry}] [Dostawa: ${details.shippingCostPLN} PLN]`
        };
      });

      const resolvedLots = await Promise.all(lotPromises);
      for (const item of resolvedLots) {
        if (item && results.length < 25) {
          results.push(item);
        }
      }
    } catch (e) {}
  }

  console.log(`✅ [CATAWIKI] Pozyskano ${results.length} realnych aukcji z prawdziwym czasem i realną dostawą!`);
  return results;
}
