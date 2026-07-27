/**
 * Moduł wyceny rynkowej oraz matematyki decyzyjnej.
 */

/**
 * Szacuje średnią cenę rynkową dla danego zegarka.
 */
export async function getMarketPriceEstimate(marka, model, nrReferencyjny = null, aiEstimatedPrice = null) {
  let baseEstimate = aiEstimatedPrice || 2500;

  const key = `${marka} ${model} ${nrReferencyjny || ''}`.toLowerCase();

  if (key.includes('speedmaster') || key.includes('omega')) {
    baseEstimate = 9500;
  } else if (key.includes('rolex') || key.includes('submariner')) {
    baseEstimate = 38000;
  } else if (key.includes('seiko') || key.includes('speedtimer') || key.includes('pogue')) {
    baseEstimate = 2600;
  } else if (key.includes('tissot') || key.includes('prx')) {
    baseEstimate = 2400;
  } else if (key.includes('tag heuer') || key.includes('carrera')) {
    baseEstimate = 6500;
  } else if (aiEstimatedPrice && aiEstimatedPrice > 100) {
    baseEstimate = aiEstimatedPrice;
  }

  const chronoPrice = Math.round(baseEstimate * 1.05);
  const allegroPrice = Math.round(baseEstimate * 0.95);
  const ebayPrice = Math.round(baseEstimate * 1.00);

  const marketAvgPrice = Math.round((chronoPrice + allegroPrice + ebayPrice) / 3);

  return {
    marketAvgPrice,
    chronoPrice,
    allegroPrice,
    ebayPrice
  };
}

/**
 * Wylicza matematykę decyzyjną oraz sprawdza warunek zakupu (Okres czasu: do 5 GODZIN / 300 min).
 */
export function evaluateBuyingDecision({
  currentPrice,
  marketAvgPrice,
  shippingCost = 0,
  commission = 0,
  timeLeftMin,
  marginFactor = 0.7
}) {
  // Max_Oferta = (Średnia Rynkowa * 0.7) - Koszty_Wysyłki - Prowizje
  const maxOffer = Math.round((marketAvgPrice * marginFactor) - shippingCost - commission);

  // Zwiększenie okna czasowego z 30 minut do 5 GODZIN (300 minut)
  const isCheapEnough = currentPrice < maxOffer;
  const isEndingSoon = !timeLeftMin || timeLeftMin <= 300;

  const shouldBuyAlert = isCheapEnough && isEndingSoon;
  const profitMargin = Math.round(marketAvgPrice - currentPrice - shippingCost - commission);

  return {
    shouldBuyAlert,
    maxOffer,
    profitMargin
  };
}
