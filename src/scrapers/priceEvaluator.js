/**
 * Moduł wyceny rynkowej oraz matematyki decyzyjnej.
 */

/**
 * Szacuje średnią cenę rynkową dla danego zegarka na podstawie numeru referencyjnego/marki/modelu.
 * Przeszukuje zakłada symulację z Chrono24, Allegro i eBay.
 * @param {string} marka
 * @param {string} model
 * @param {string|null} nrReferencyjny
 * @returns {Promise<{marketAvgPrice: number, chronoPrice: number, allegroPrice: number, ebayPrice: number}>}
 */
export async function getMarketPriceEstimate(marka, model, nrReferencyjny = null, aiEstimatedPrice = null) {
  // Wartości rynkowe bazowe wg popularnych modeli
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
  } else if (aiEstimatedPrice && aiEstimatedPrice > 500) {
    baseEstimate = aiEstimatedPrice;
  }

  // Odchylenia rynkowe dla 3 głównych platform
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
 * Wylicza matematykę decyzyjną oraz sprawdza warunek okazyjnego zakupu.
 * @param {Object} params
 * @param {number} params.currentPrice - Aktualna cena aukcji
 * @param {number} params.marketAvgPrice - Średnia rynkowa wyliczona z 3 źródeł
 * @param {number} params.shippingCost - Koszt wysyłki
 * @param {number} [params.commission=0] - Prowizja platformy
 * @param {number} params.timeLeftMin - Czas pozostały do końca aukcji w minutach
 * @param {number} [params.marginFactor=0.7] - Współczynnik marży (np. 0.7 dla 30% zysku)
 * @returns {{shouldBuyAlert: boolean, maxOffer: number, profitMargin: number}}
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

  // CZY (Aktualna_Cena < Max_Oferta) ORAZ (Czas_Do_Końca <= 30 min)
  const isCheapEnough = currentPrice < maxOffer;
  const isEndingSoon = timeLeftMin <= 30;

  const shouldBuyAlert = isCheapEnough && isEndingSoon;
  const profitMargin = Math.round(marketAvgPrice - currentPrice - shippingCost - commission);

  return {
    shouldBuyAlert,
    maxOffer,
    profitMargin
  };
}
