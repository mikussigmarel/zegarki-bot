/**
 * Moduł wyceny rynkowej z rygorystycznym filtrem czasowym (Max 5 godzin do końca).
 */

/**
 * Szacuje średnią cenę rynkową zegarka na podstawie wyceny Gemini.
 */
export async function getMarketPriceEstimate(marka, model, nrReferencyjny = null, aiData = {}) {
  const { aiEstimatedPrice } = aiData;
  let marketAvgPrice = aiEstimatedPrice || 2500;

  const key = `${marka || ''} ${model || ''} ${nrReferencyjny || ''}`.toLowerCase();

  if (!aiEstimatedPrice) {
    if (key.includes('speedmaster') || key.includes('omega')) {
      marketAvgPrice = 9500;
    } else if (key.includes('rolex') || key.includes('submariner')) {
      marketAvgPrice = 38000;
    } else if (key.includes('seiko') || key.includes('speedtimer') || key.includes('pogue')) {
      marketAvgPrice = 2600;
    } else if (key.includes('tissot') || key.includes('prx')) {
      marketAvgPrice = 2400;
    } else if (key.includes('tag heuer') || key.includes('carrera')) {
      marketAvgPrice = 6500;
    }
  }

  const chronoPrice = Math.round(marketAvgPrice * 1.05);
  const allegroPrice = Math.round(marketAvgPrice * 0.95);
  const ebayPrice = Math.round(marketAvgPrice * 1.00);

  return {
    marketAvgPrice: Math.round(marketAvgPrice),
    chronoPrice,
    allegroPrice,
    ebayPrice
  };
}

/**
 * Wylicza matematykę decyzyjna zakupu (Ścisły rygor: MAX 5 GODZIN DO KOŃCA).
 */
export function evaluateBuyingDecision({
  currentPrice,
  marketAvgPrice,
  shippingCost = 0,
  commission = 0,
  timeLeftMin,
  marginFactor = 0.7,
  sprawny = true
}) {
  const totalCost = currentPrice + shippingCost + commission;
  const profitMargin = Math.round(marketAvgPrice - totalCost);
  const maxOffer = Math.round((marketAvgPrice * marginFactor) - shippingCost - commission);

  // STRICT REQUIREMENT: Zostało <= 300 minut (5 godzin)
  const isEndingSoon = timeLeftMin !== undefined && timeLeftMin !== null && timeLeftMin <= 300;

  // Wysyłaj alert gdy aukcja kończy się w ciągu 5 godzin ORAZ daje realny zysk netto (min. 50 PLN po opłatach i dostawie)
  const isProfitable = profitMargin >= 50 || currentPrice < maxOffer;
  const shouldBuyAlert = isEndingSoon && isProfitable && sprawny !== false;

  return {
    shouldBuyAlert,
    maxOffer,
    profitMargin
  };
}
