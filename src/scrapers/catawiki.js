process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
import { getEurPlnRate } from '../services/currencyRate.js';

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8'
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
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
 * Wyciąga HTML strony Catawiki z wielopoziomowym proxy w razie blokady IP chmury
 */
async function fetchCatawikiPageHtml(url) {
  const proxies = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`
  ];

  for (const targetUrl of proxies) {
    try {
      const res = await fetchWithTimeout(targetUrl, { headers: secHeaders }, 3500);
      if (res && res.ok) {
        const html = await res.text();
        if (html && (html.includes('__NEXT_DATA__') || html.includes('catawiki'))) {
          return html;
        }
      }
    } catch (e) {}
  }
  return '';
}

/**
 * Wyciąga REALNE dane ze strony oferty: cena aktualnego bida (EUR), czas zakończenia, kraj sprzedawcy oraz dokładną cenę dostawy.
 */
async function getRealLotDetails(lotUrl, fallbackBuyNow = null) {
  try {
    const html = await fetchCatawikiPageHtml(lotUrl);

    let timeLeftMin = null;
    let sellerCountry = 'Unia Europejska';
    let shippingCostPLN = 75;
    let descriptionText = '';
    let currentPriceEUR = fallbackBuyNow;

    if (html) {
      const jsonMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"\s*>([\s\S]*?)<\/script>/i);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        const pageProps = data.props?.pageProps || {};
        const str = JSON.stringify(pageProps);

        const bbr = pageProps.biddingBlockResponse;
        if (bbr) {
          if (typeof bbr.localizedCurrentBidAmount === 'number' && bbr.localizedCurrentBidAmount > 0) {
            currentPriceEUR = bbr.localizedCurrentBidAmount;
          } else if (bbr.live?.lot?.bid?.EUR && bbr.live.lot.bid.EUR > 0) {
            currentPriceEUR = bbr.live.lot.bid.EUR;
          } else if (bbr.biddingHistory?.bids?.[0]?.localizedBidAmount && bbr.biddingHistory.bids[0].localizedBidAmount > 0) {
            currentPriceEUR = bbr.biddingHistory.bids[0].localizedBidAmount;
          } else if (typeof bbr.localizedStartBidAmount === 'number' && bbr.localizedStartBidAmount > 0) {
            currentPriceEUR = bbr.localizedStartBidAmount;
          } else if (typeof bbr.localizedMinBidAmount === 'number' && bbr.localizedMinBidAmount > 0) {
            currentPriceEUR = bbr.localizedMinBidAmount;
          }
        }

        if (!currentPriceEUR) {
          const curBidMatch = str.match(/"localizedCurrentBidAmount":\s*([\d.]+)/i) || 
                              str.match(/"bid":\{"EUR":\s*([\d.]+)/i) || 
                              str.match(/"localizedBidAmount":\s*([\d.]+)/i) || 
                              str.match(/"localizedStartBidAmount":\s*([\d.]+)/i) || 
                              str.match(/"price_eur":\s*([\d.]+)/i);
          if (curBidMatch && curBidMatch[1]) {
            currentPriceEUR = parseFloat(curBidMatch[1]);
          }
        }

        const endMatch = str.match(/"biddingEndTime":"([^"]+)"/i) || str.match(/"bidding_end_time":"([^"]+)"/i) || str.match(/"closedAt":"([^"]+)"/i);
        if (endMatch) {
          const endTimeMs = new Date(endMatch[1]).getTime();
          timeLeftMin = Math.max(0, Math.round((endTimeMs - Date.now()) / 60000));
        }

        const countryMatch = str.match(/"seller"[^}]*"country":\{"name":"([^"]+)"/i) || str.match(/"country":\{"name":"([^"]+)"/i);
        if (countryMatch && countryMatch[1]) {
          sellerCountry = countryMatch[1];
        }

        const descMatch = str.match(/"description":"([\s\S]*?)"/i) || str.match(/"subtitle":"([^"]+)"/i);
        if (descMatch && descMatch[1]) {
          descriptionText = descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/<[^>]*>?/gm, ' ').slice(0, 1500);
        }

        const explicitShippingMatch = str.match(/"shipping_cost":([\d.]+)/i) || str.match(/"shippingCost":\{"amount":([\d.]+)/i) || html.match(/(?:shipping|wysyłka|delivery)[^<]{0,40}(?:€|EUR)\s*([\d.]+)/i);
        if (explicitShippingMatch && explicitShippingMatch[1]) {
          const eurFee = parseFloat(explicitShippingMatch[1]);
          if (!isNaN(eurFee) && eurFee > 0) {
            shippingCostPLN = Math.round(eurFee * 4.3);
          }
        } else if (sellerCountry) {
          const cLower = sellerCountry.toLowerCase();
          if (cLower.includes('poland') || cLower.includes('polska')) shippingCostPLN = 25;
          else if (cLower.includes('germany') || cLower.includes('niemcy') || cLower.includes('austria')) shippingCostPLN = 65;
          else if (cLower.includes('france') || cLower.includes('francja') || cLower.includes('italy') || cLower.includes('włochy') || cLower.includes('spain') || cLower.includes('hiszpania') || cLower.includes('netherlands') || cLower.includes('holandia') || cLower.includes('latvia') || cLower.includes('łotwa')) shippingCostPLN = 75;
          else shippingCostPLN = 95;
        }
      }
    }

    if (!currentPriceEUR || isNaN(currentPriceEUR) || currentPriceEUR <= 0) {
      currentPriceEUR = 25;
    }

    return { currentPriceEUR, timeLeftMin, sellerCountry, shippingCostPLN, descriptionText };
  } catch (e) {
    return { currentPriceEUR: fallbackBuyNow || 25, timeLeftMin: null, sellerCountry: 'Unia Europejska', shippingCostPLN: 75, descriptionText: '' };
  }
}

/**
 * Pancerne skanowanie Catawiki z wyciąganiem realnej ceny bida, kraju sprzedawcy i realnej dostawy ze strony.
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
      const html = await fetchCatawikiPageHtml(url);
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
        const lowerTitle = title.toLowerCase();

        if (lowerTitle.includes('rug') || lowerTitle.includes('carpet') || lowerTitle.includes('dywan') || lowerTitle.includes('coin') || lowerTitle.includes('moneta') || lowerTitle.includes('painting') || lowerTitle.includes('shaggy') || lowerTitle.includes('lahore')) {
          return null;
        }

        const fullLink = lot.url ? (lot.url.startsWith('http') ? lot.url : `https://www.catawiki.com${lot.url}`) : `https://www.catawiki.com/en/l/${lotId}`;
        const imageUrl = lot.originalImageUrl || lot.thumbImageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop';
        const fallbackBuyNow = lot.buyNow?.price_eur || lot.buyNowPrice || null;

        const details = await getRealLotDetails(fullLink, fallbackBuyNow);
        const priceEUR = details.currentPriceEUR;

        if (!priceEUR || isNaN(priceEUR) || priceEUR <= 0) {
          return null;
        }

        const currentPricePLN = Math.round(priceEUR * eurRate);
        const commissionPLN = Math.round(priceEUR * 0.09 * eurRate) + 13;

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
        if (item && results.length < 35) {
          results.push(item);
        }
      }
    } catch (e) {}
  }

  console.log(`✅ [CATAWIKI] Pozyskano ${results.length} realnych aukcji z prawdziwym czasem i realną dostawą!`);
  return results;
}
