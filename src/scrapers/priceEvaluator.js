/**
 * Moduł wyceny rynkowej – CENY WYŁĄCZNIE Z PRAWDZIWYCH PORTALI (OLX, Allegro, Chrono24).
 * AI NIE WYCENIA CENY – jedynie analizuje stan, model i autentyczność.
 */

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
};

async function fetchWithStrictTimeout(url, options = {}, timeoutMs = 2000) {
  try {
    return await Promise.race([
      fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }),
      new Promise(resolve => setTimeout(() => resolve(null), timeoutMs + 100))
    ]);
  } catch (e) {
    return null;
  }
}

/**
 * Fast Allegro HTML fetch z 1 szybkim proxy i twardym limit czasowym 2s.
 */
async function fetchAllegroHtmlWithProxy(url) {
  let res = await fetchWithStrictTimeout(url, { headers: secHeaders }, 2000);
  if (res && res.ok) {
    try {
      const html = await Promise.race([
        res.text(),
        new Promise(resolve => setTimeout(() => resolve(''), 1500))
      ]);
      if (html.includes('__allegro_listing_state') || html.includes('allegro.pl')) return html;
    } catch (e) {}
  }

  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    let pRes = await fetchWithStrictTimeout(proxyUrl, { headers: secHeaders }, 2000);
    if (pRes && pRes.ok) {
      const html = await Promise.race([
        pRes.text(),
        new Promise(resolve => setTimeout(() => resolve(''), 1500))
      ]);
      if (html.includes('__allegro_listing_state') || html.length > 20000) return html;
    }
  } catch (e) {}

  return '';
}

/**
 * Przeszukuje realne oferty na portalach OLX, Allegro i Chrono24 z TWARDYM LIMIT LIMITEM CZASOWYM 3.5s (Promise.race).
 */
export async function fetchPortalMarketPrices(marka, model, nrReferencyjny = null) {
  const cleanMarka = (marka || '').trim();
  let searchWord = cleanMarka;

  // Ignorowanie sztucznych zwrotów braku referencji
  const invalidRefPhrases = ['niepodano', 'brak', 'nieokreslony', 'nieokreślony', 'na', 'n/a', 'brakdanych', 'nieznany', 'rozpoznano'];
  let validRef = nrReferencyjny;
  if (validRef) {
    if (validRef.includes('/')) {
      validRef = validRef.split('/')[0].trim();
    }
    const rawClean = validRef.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (invalidRefPhrases.includes(rawClean) || rawClean.length < 3) {
      validRef = null;
    }
  }

  const cleanRef = validRef ? validRef.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : null;
  const refBase = cleanRef ? cleanRef.split('-')[0] : null;
  const refDigits = refBase ? refBase.replace(/[^0-9]/g, '') : null;

  let modelTokens = [];
  if (model) {
    const cleanModelStr = model.replace(new RegExp(cleanMarka, 'gi'), '').trim();
    modelTokens = cleanModelStr.split(' ').map(t => t.toLowerCase()).filter(t => t.length >= 2 && !invalidRefPhrases.includes(t));
  }

  if (validRef && cleanRef && cleanRef.length >= 3) {
    searchWord = `${cleanMarka} ${validRef}`.trim();
  } else if (modelTokens.length > 0) {
    searchWord = `${cleanMarka} ${modelTokens.join(' ')}`.trim();
  } else {
    searchWord = `${cleanMarka} ${model || ''}`.trim();
  }

  console.log(`🔎 [PORTAL PRICE SCRAPE] Szukam cen TEGO KONKRETNEGO MODELU na OLX + Allegro + Chrono24: "${searchWord}"...`);

  // Twarde zabezpieczenie czasowe 3.5s (Promise.race)
  return Promise.race([
    (async () => {
      const accessoryKeywords = ['bransoleta', 'pasek', 'pudełko', 'pudelko', 'etui', 'szkło', 'szkiełko', 'ogniwo', 'teleskop', 'części', 'czeci', 'zapięcie', 'rotomat', 'wskazówki', 'bezel', 'strap', 'buckle', 'clasp'];
      const collectedPrices = [];
      const portalBreakdown = { olx: [], allegro: [], chrono24: [] };

      const isStrictTitleMatch = (titleText) => {
        const lower = titleText.toLowerCase();
        if (accessoryKeywords.some(acc => lower.includes(acc) && !lower.includes('zegarek') && !lower.includes('watch'))) {
          return false;
        }
        if (!lower.includes(cleanMarka.toLowerCase())) {
          return false;
        }
        if (cleanRef && cleanRef.length >= 3) {
          const lowerCleanTitle = lower.replace(/[^a-z0-9]/g, '');
          if (lowerCleanTitle.includes(cleanRef)) return true;
          if (refBase && refBase.length >= 3 && lowerCleanTitle.includes(refBase)) return true;
          if (refDigits && refDigits.length >= 4 && lowerCleanTitle.includes(refDigits)) return true;
        }
        if (modelTokens.length > 0) {
          const mainModelToken = modelTokens[0];
          if (lower.includes(mainModelToken)) return true;
        }
        return cleanRef ? false : true;
      };

      await Promise.all([
        // 1. OLX API
        (async () => {
          try {
            const olxUrl = `https://www.olx.pl/api/v1/offers/?offset=0&limit=30&query=${encodeURIComponent(searchWord)}`;
            const res = await fetchWithStrictTimeout(olxUrl, { headers: { ...secHeaders, 'Accept': 'application/json' } }, 2000);
            if (res && res.ok) {
              const json = await res.json();
              const items = json.data || [];
              for (const item of items) {
                const itemTitle = item.title || '';
                const priceParam = item.params?.find(p => p.key === 'price');
                const priceVal = parseFloat(priceParam?.value?.value || item.price?.value);
                if (priceVal && !isNaN(priceVal) && priceVal >= 80 && priceVal <= 60000) {
                  if (isStrictTitleMatch(itemTitle)) {
                    collectedPrices.push(priceVal);
                    portalBreakdown.olx.push(priceVal);
                  }
                }
              }
            }
          } catch (e) {}
        })(),

        // 2. ALLEGRO
        (async () => {
          try {
            const allegroUrl = `https://allegro.pl/listing?string=${encodeURIComponent(searchWord)}`;
            const html = await fetchAllegroHtmlWithProxy(allegroUrl);
            if (html) {
              const stateMatch = html.match(/__allegro_listing_state\s*=\s*"([\s\S]*?)";/i) || html.match(/__allegro_listing_state\s*=\s*(\{[\s\S]*?\});/i);
              if (stateMatch) {
                let rawJson = stateMatch[1];
                if (rawJson.startsWith('"') || rawJson.includes('\\"')) {
                  rawJson = JSON.parse(`"${rawJson}"`);
                }
                const stateData = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
                const itemsGroups = stateData?.__elements__ || stateData?.items?.promoted || stateData?.items?.regular || [];
                let allItems = Array.isArray(itemsGroups) ? itemsGroups : [];

                for (const item of allItems) {
                  const itemTitle = item.title?.text || item.title || '';
                  const priceVal = parseFloat(item.price?.normal?.amount || item.price?.main?.amount || item.price?.amount);
                  if (priceVal && !isNaN(priceVal) && priceVal >= 80 && priceVal <= 60000) {
                    if (isStrictTitleMatch(itemTitle)) {
                      collectedPrices.push(priceVal);
                      portalBreakdown.allegro.push(priceVal);
                    }
                  }
                }
              }
            }
          } catch (e) {}
        })(),

        // 3. CHRONO24
        (async () => {
          try {
            const chronoUrl = `https://www.chrono24.pl/search/index.htm?query=${encodeURIComponent(searchWord)}`;
            const res = await fetchWithStrictTimeout(chronoUrl, { headers: secHeaders }, 2000);
            if (res && res.ok) {
              const html = await Promise.race([
                res.text(),
                new Promise(resolve => setTimeout(() => resolve(''), 1500))
              ]);
              const plnMatches = html.matchAll(/([\d\s]+)\s*(?:zł|PLN)/g);
              for (const m of plnMatches) {
                let rawPrice = m[1].replace(/\s/g, '');
                let priceVal = parseFloat(rawPrice);
                if (priceVal && !isNaN(priceVal) && priceVal >= 100 && priceVal <= 60000) {
                  const localMarketPrice = Math.round(priceVal * 0.85);
                  if (!portalBreakdown.chrono24.includes(localMarketPrice)) {
                    collectedPrices.push(localMarketPrice);
                    portalBreakdown.chrono24.push(localMarketPrice);
                  }
                }
              }
            }
          } catch (e) {}
        })()
      ]);

      if (collectedPrices.length === 0) {
        console.warn(`⚠️ [PORTAL PRICE] Brak dopasowań na bezpośrednich portalach dla: "${searchWord}"`);
        return { avgPrice: 0, count: 0, breakdown: portalBreakdown };
      }

      collectedPrices.sort((a, b) => a - b);
      let trimmedPrices = collectedPrices;
      if (collectedPrices.length >= 4) {
        trimmedPrices = collectedPrices.slice(1, collectedPrices.length - 1);
      }

      const sum = trimmedPrices.reduce((acc, p) => acc + p, 0);
      const avgPrice = Math.round(sum / trimmedPrices.length);

      const mid = Math.floor(trimmedPrices.length / 2);
      const medianPrice = trimmedPrices.length % 2 !== 0 ? trimmedPrices[mid] : Math.round((trimmedPrices[mid - 1] + trimmedPrices[mid]) / 2);

      const breakdownSummary = [];
      if (portalBreakdown.olx.length > 0) {
        const avg = Math.round(portalBreakdown.olx.reduce((a, b) => a + b, 0) / portalBreakdown.olx.length);
        breakdownSummary.push(`OLX: ${portalBreakdown.olx.length} ofert, śr. ${avg} PLN`);
      }
      if (portalBreakdown.allegro.length > 0) {
        const avg = Math.round(portalBreakdown.allegro.reduce((a, b) => a + b, 0) / portalBreakdown.allegro.length);
        breakdownSummary.push(`Allegro: ${portalBreakdown.allegro.length} ofert, śr. ${avg} PLN`);
      }
      if (portalBreakdown.chrono24.length > 0) {
        const avg = Math.round(portalBreakdown.chrono24.reduce((a, b) => a + b, 0) / portalBreakdown.chrono24.length);
        breakdownSummary.push(`Chrono24: ${portalBreakdown.chrono24.length} ofert, śr. ${avg} PLN`);
      }

      console.log(`📊 [PORTAL PRICE] ${collectedPrices.length} dopasowań TEGO MODELU. Średnia: ${avgPrice} PLN, Mediana: ${medianPrice} PLN (${collectedPrices[0]} - ${collectedPrices[collectedPrices.length - 1]} PLN)`);
      console.log(`   Rozbicie: ${breakdownSummary.join('; ')}`);

      return {
        avgPrice,
        medianPrice,
        count: collectedPrices.length,
        minPrice: collectedPrices[0],
        maxPrice: collectedPrices[collectedPrices.length - 1],
        breakdown: portalBreakdown,
        breakdownSummary: breakdownSummary.join('; ')
      };
    })(),

    new Promise(resolve => setTimeout(() => {
      console.warn(`⏱️ [PORTAL PRICE] Osiągnięto twardy limit czasu 3.5s dla wyceny: "${searchWord}". Kontynuacja...`);
      resolve({ avgPrice: 0, count: 0, breakdown: { olx: [], allegro: [], chrono24: [] } });
    }, 3500))
  ]);
}

/**
 * Szukaj czystych, realnych cen w Google / Ceneo / DuckDuckGo BEZ ŻADNYCH SZTUCZNYCH PROCENTÓW.
 */
async function searchGlobalWebPrices(marka, model, nrReferencyjny, isNewWatch = false) {
  let cleanRefStr = nrReferencyjny;
  if (cleanRefStr && cleanRefStr.includes('/')) {
    cleanRefStr = cleanRefStr.split('/')[0].trim();
  }
  const queryTerm = `${marka} ${cleanRefStr || model}`.trim();
  console.log(`🌐 [GOOGLE WEB SEARCH] Szukam prawdziwych cen dla ("${queryTerm}", Zegarek ${isNewWatch ? 'NOWY' : 'UŻYWANY'})...`);

  return Promise.race([
    (async () => {
      const collected = [];
      try {
        const searchQuery = isNewWatch
          ? `${queryTerm} cena sklep`
          : `${queryTerm} uzywany OR olx OR allegro OR chrono24 OR uzywane cena`;

        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
        const res = await fetchWithStrictTimeout(url, { headers: secHeaders }, 2000);
        if (res && res.ok) {
          const html = await Promise.race([
            res.text(),
            new Promise(resolve => setTimeout(() => resolve(''), 1500))
          ]);
          const plnMatches = html.matchAll(/([\d\s]{2,7})\s*(?:zł|PLN|pln)/g);
          for (const m of plnMatches) {
            const val = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
            if (val >= 90 && val <= 50000) collected.push(val);
          }
        }
      } catch (e) {}

      if (collected.length > 0) {
        collected.sort((a, b) => a - b);
        let trimmed = collected.length >= 4 ? collected.slice(1, collected.length - 1) : collected;
        const avg = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
        return { avgPrice: avg, count: trimmed.length };
      }

      return { avgPrice: 0, count: 0 };
    })(),
    new Promise(resolve => setTimeout(() => resolve({ avgPrice: 0, count: 0 }), 2500))
  ]);
}

/**
 * Szacuje średnią cenę rynkową zegarka – ZAWSZE z prawdziwych portali i sieci (wielopoziomowe wyszukiwanie).
 */
export async function getMarketPriceEstimate(marka, model, nrReferencyjny = null, aiData = {}, offerCurrentPrice = 0) {
  let marketAvgPrice = 0;
  let priceSource = '';

  const isNewWatch = Boolean(
    aiData.stan?.toLowerCase().includes('nowy') ||
    aiData.stan?.toLowerCase().includes('fabryczn') ||
    aiData.stan?.toLowerCase().includes('metk')
  );

  const portalData = await fetchPortalMarketPrices(marka, model, nrReferencyjny);

  if (portalData.avgPrice > 0) {
    marketAvgPrice = portalData.avgPrice;
    priceSource = `Realne ceny z ${portalData.count} ofert na portalach (${portalData.breakdownSummary || 'OLX/Allegro/Chrono24'})`;
  } else {
    const webData = await searchGlobalWebPrices(marka, model, nrReferencyjny, isNewWatch);
    if (webData.avgPrice > 0) {
      marketAvgPrice = webData.avgPrice;
      priceSource = `Średnia cena rynkowa z wyników wyszukiwania w Google (${webData.count} ofert w sieci)`;
    }
  }

  if (marketAvgPrice <= 0) {
    console.warn(`⚠️ [PRICE EVALUATOR] Nie znaleziono wystarczających cen rynkowych dla: "${marka} ${nrReferencyjny || model}"`);
  }

  return {
    marketAvgPrice,
    priceSource,
    breakdown: portalData.breakdown || null
  };
}

/**
 * Główny weryfikator opłacalności zakupu zegarka na flipa.
 */
export function evaluateBuyingDecision(optsOrPrice, shippingCost = 15, marketAvgPrice = 0, platform = 'Catawiki', fullSet = false) {
  let offerCurrentPrice = 0;
  let shipFee = shippingCost;
  let mAvgPrice = marketAvgPrice;
  let plat = platform;
  let commFee = 0;
  let isSprawny = true;

  if (typeof optsOrPrice === 'object' && optsOrPrice !== null) {
    offerCurrentPrice = Number(optsOrPrice.currentPrice) || 0;
    mAvgPrice = Number(optsOrPrice.marketAvgPrice) || 0;
    shipFee = optsOrPrice.shippingCost !== undefined ? Number(optsOrPrice.shippingCost) : (optsOrPrice.platform === 'Catawiki' ? 75 : 15);
    plat = optsOrPrice.platform || 'Catawiki';
    commFee = optsOrPrice.commission !== undefined ? Number(optsOrPrice.commission) : (plat === 'Catawiki' ? Math.round(offerCurrentPrice * 0.09) + 13 : 0);
    isSprawny = optsOrPrice.sprawny !== undefined ? Boolean(optsOrPrice.sprawny) : true;
  } else {
    offerCurrentPrice = Number(optsOrPrice) || 0;
    mAvgPrice = Number(marketAvgPrice) || 0;
    shipFee = Number(shippingCost) || 15;
    plat = platform;
    commFee = plat === 'Catawiki' ? Math.round(offerCurrentPrice * 0.09) + 13 : 0;
  }

  const totalCost = offerCurrentPrice + shipFee + commFee;

  if (!mAvgPrice || mAvgPrice <= 0) {
    return {
      isProfitable: false,
      shouldBuyAlert: false,
      netProfit: 0,
      profitMargin: 0,
      maxOffer: 0,
      totalCost,
      reason: 'Brak wiarygodnych cen rynkowych do wyceny'
    };
  }

  const profitMargin = Math.round(mAvgPrice - totalCost);
  const maxOffer = Math.max(0, Math.round(mAvgPrice - shipFee - commFee - 100));
  const isProfitable = profitMargin >= 100 && isSprawny;
  const shouldBuyAlert = isProfitable;

  return {
    isProfitable,
    shouldBuyAlert,
    netProfit: profitMargin,
    profitMargin,
    maxOffer,
    totalCost,
    reason: isProfitable ? `Zysk netto +${profitMargin} PLN` : `Niewystarczający zysk (${profitMargin} PLN < 100 PLN)`
  };
}
