/**
 * Pobiera aktualny kurs EUR/PLN z API Narodowego Banku Polskiego.
 * Fallback na 4.30 jeśli API niedostępne.
 */
let cachedRate = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 godzina

export async function getEurPlnRate() {
  const now = Date.now();
  if (cachedRate && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedRate;
  }

  try {
    const res = await fetch('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000)
    });

    if (res.ok) {
      const data = await res.json();
      const rate = data.rates?.[0]?.mid;
      if (rate && !isNaN(rate) && rate > 3 && rate < 6) {
        cachedRate = rate;
        cacheTimestamp = now;
        console.log(`💱 [NBP] Aktualny kurs EUR/PLN: ${rate}`);
        return rate;
      }
    }
  } catch (e) {
    console.warn('⚠️ Nie udało się pobrać kursu EUR/PLN z NBP, używam fallback 4.30');
  }

  return 4.30; // Fallback
}
