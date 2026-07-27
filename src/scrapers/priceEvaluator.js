/**
 * Moduł wyceny rynkowej – CENY WYŁĄCZNIE Z PRAWDZIWYCH PORTALI (OLX, Allegro, Chrono24).
 * AI NIE WYCENIA CENY – jedynie analizuje stan, model i autentyczność.
 */

const secHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
};

async function fetchWithStrictTimeout(url, options = {}, timeoutMs = 4000) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return null;
  }
}

/**
 * Przeszukuje realne oferty na portalach OLX, Allegro i Chrono24
 * i wylicza z nich bezpośrednią średnią cenę rynkową WYŁĄCZNIE dla tego konkretnego modelu.
 */
export async function fetchPortalMarketPrices(marka, model, nrReferencyjny = null) {
  const cleanMarka = (marka || '').trim();
  let searchWord = cleanMarka;

  const cleanRef = nrReferencyjny ? nrReferencyjny.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : null;

  let modelTokens = [];
  if (model && model !== cleanMarka) {
    const cleanModelStr = model.replace(new RegExp(cleanMarka, 'gi'), '').trim();
    modelTokens = cleanModelStr.split(' ').map(t => t.toLowerCase()).filter(t => t.length >= 2);
  }

  if (cleanRef && cleanRef.length >= 4) {
    searchWord = `${cleanMarka} ${nrReferencyjny}`.trim();
  } else if (modelTokens.length > 0) {
    searchWord = `${cleanMarka} ${modelTokens.slice(0, 2).join(' ')}`.trim();
  }

  console.log(`🔎 [PORTAL PRICE SCRAPE] Szukam cen TEGO KONKRETNEGO MODELU na OLX + Allegro + Chrono24: "${searchWord}"...`);

  const accessoryKeywords = ['bransoleta', 'pasek', 'pudełko', 'pudelko', 'etui', 'szkło', 'szkiełko', 'ogniwo', 'teleskop', 'części', 'czeci', 'zapięcie', 'rotomat', 'wskazówki', 'bezel', 'strap', 'buckle', 'clasp'];
  const collectedPrices = [];
  const portalBreakdown = { olx: [], allegro: [], chrono24: [] };

  // Ścisły weryfikator dopasowania tytułu
  const isStrictTitleMatch = (titleText) => {
    const lower = titleText.toLowerCase();

    // 1. Odrzuć paski, pudełka, bransolety i akcesoria
    if (accessoryKeywords.some(acc => lower.includes(acc) && !lower.includes('zegarek') && !lower.includes('watch'))) {
      return false;
    }

    // 2. Wymagaj marki
    if (!lower.includes(cleanMarka.toLowerCase())) {
      return false;
    }

    // 3. Jeśli mamy referencję, dopasuj referencję
    if (cleanRef && cleanRef.length >= 4) {
      const lowerCleanTitle = lower.replace(/[^a-z0-9]/g, '');
      if (lowerCleanTitle.includes(cleanRef)) return true;
    }

    // 4. Jeśli mamy tokeny modelu, upewnij się że co najmniej kluczowy token występuje w tytule
    if (modelTokens.length > 0) {
      const mainModelToken = modelTokens[0];
      if (lower.includes(mainModelToken)) return true;
    }

    return cleanRef ? false : true;
  };

  // =============================================
  // 1. SKANOWANIE OLX API
  // =============================================
  try {
    const olxUrl = `https://www.olx.pl/api/v1/offers/?offset=0&limit=40&query=${encodeURIComponent(searchWord)}`;
    const res = await fetchWithStrictTimeout(olxUrl, {
      headers: { ...secHeaders, 'Accept': 'application/json' }
    }, 4000);

    if (res && res.ok) {
      const json = await res.json();
      const items = json.data || [];
      for (const item of items) {
        const itemTitle = (item.title || '');
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
  } catch (e) {
    console.warn('⚠️ Błąd wyszukiwania cen na OLX:', e.message);
  }

  // =============================================
  // 2. SKANOWANIE ALLEGRO (z proxy fallback!)
  // =============================================
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
  } catch (e) {
    console.warn('⚠️ Błąd wyszukiwania cen na Allegro:', e.message);
  }

  // =============================================
  // 3. SKANOWANIE CHRONO24 (nowy!)
  // =============================================
  try {
    const chrono24Query = `${cleanMarka} ${nrReferencyjny || modelTokens.slice(0, 2).join(' ')}`.trim();
    const chrono24Url = `https://www.chrono24.pl/search/index.htm?query=${encodeURIComponent(chrono24Query)}&dosearch=true&searchexplain=false&accessoryTypes=`;
    
    let res = await fetchWithStrictTimeout(chrono24Url, { headers: secHeaders }, 5000);
    let html = '';
    if (res && res.ok) {
      html = await res.text();
    } else {
      // Proxy fallback
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(chrono24Url)}`;
      const proxyRes = await fetchWithStrictTimeout(proxyUrl, { headers: secHeaders }, 5000);
      if (proxyRes && proxyRes.ok) {
        html = await proxyRes.text();
      }
    }

    if (html) {
      // Chrono24 ma ceny w formacie: data-price="1234" lub class="text--price"...1 234 zł
      const priceMatches = html.matchAll(/(?:data-price|"price"|"amount")[=:]\s*"?(\d[\d\s.,]*)"?/gi);
      for (const m of priceMatches) {
        let rawPrice = m[1].replace(/\s/g, '').replace(',', '.');
        let priceVal = parseFloat(rawPrice);
        
        // Chrono24 podaje ceny profesjonalnych dealerów – przeliczamy z korektą -15% (0.85) na rynek wtórny w PL
        const localMarketPrice = Math.round(priceVal * 0.85);
        if (priceVal && !isNaN(priceVal) && priceVal >= 100 && priceVal <= 60000) {
          collectedPrices.push(localMarketPrice);
          portalBreakdown.chrono24.push(localMarketPrice);
        }
      }

      // Alternatywny regex dla cen w formacie "1 234 zł"
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
  } catch (e) {
    console.warn('⚠️ Błąd wyszukiwania cen na Chrono24:', e.message);
  }

  // =============================================
  // WYLICZENIE ŚREDNIEJ RYNKOWEJ
  // =============================================
  if (collectedPrices.length === 0) {
    console.warn(`⚠️ [PORTAL PRICE] Brak dopasowań na żadnym portalu dla: "${searchWord}"`);
    return { avgPrice: 0, count: 0, breakdown: portalBreakdown };
  }

  // Odrzucenie skrajności i wyliczenie średniej rynkowej
  collectedPrices.sort((a, b) => a - b);
  const trimCount = Math.floor(collectedPrices.length * 0.1);
  const trimmed = collectedPrices.slice(trimCount, collectedPrices.length - (trimCount || 1));
  const validList = trimmed.length > 0 ? trimmed : collectedPrices;
  const sum = validList.reduce((acc, v) => acc + v, 0);
  const avgPrice = Math.round(sum / validList.length);

  // Mediana
  const mid = Math.floor(validList.length / 2);
  const medianPrice = validList.length % 2 !== 0 ? validList[mid] : Math.round((validList[mid - 1] + validList[mid]) / 2);

  const breakdownSummary = [];
  if (portalBreakdown.olx.length > 0) breakdownSummary.push(`OLX: ${portalBreakdown.olx.length} ofert, śr. ${Math.round(portalBreakdown.olx.reduce((a, b) => a + b, 0) / portalBreakdown.olx.length)} PLN`);
  if (portalBreakdown.allegro.length > 0) breakdownSummary.push(`Allegro: ${portalBreakdown.allegro.length} ofert, śr. ${Math.round(portalBreakdown.allegro.reduce((a, b) => a + b, 0) / portalBreakdown.allegro.length)} PLN`);
  if (portalBreakdown.chrono24.length > 0) breakdownSummary.push(`Chrono24: ${portalBreakdown.chrono24.length} ofert, śr. ${Math.round(portalBreakdown.chrono24.reduce((a, b) => a + b, 0) / portalBreakdown.chrono24.length)} PLN`);

  console.log(`📊 [PORTAL PRICE] ${collectedPrices.length} dopasowań TEGO MODELU. Średnia: ${avgPrice} PLN, Mediana: ${medianPrice} PLN (${collectedPrices[0]} - ${collectedPrices[collectedPrices.length - 1]} PLN)`);
  console.log(`   Rozbicie: ${breakdownSummary.join(' | ') || 'brak danych'}`);

  return {
    avgPrice,
    medianPrice,
    count: collectedPrices.length,
    minPrice: collectedPrices[0],
    maxPrice: collectedPrices[collectedPrices.length - 1],
    breakdown: portalBreakdown,
    breakdownSummary: breakdownSummary.join('; ')
  };
}

/**
 * Allegro HTML fetch z multi-proxy fallback (taki sam jak w allegro.js scraper)
 */
async function fetchAllegroHtmlWithProxy(url) {
  let res = await fetchWithStrictTimeout(url, { headers: secHeaders }, 3000);
  if (res && res.ok) {
    const html = await res.text();
    if (html.includes('__allegro_listing_state') || html.includes('allegro.pl')) return html;
  }

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];

  for (const proxyUrl of proxies) {
    let pRes = await fetchWithStrictTimeout(proxyUrl, { headers: secHeaders }, 4000);
    if (pRes && pRes.ok) {
      const html = await pRes.text();
      if (html.includes('__allegro_listing_state') || html.length > 40000) return html;
    }
  }

  return '';
}

/**
 * Szacuje średnią cenę rynkową zegarka – ZAWSZE z prawdziwych portali, NIGDY z halucynacji AI.
 * @param {string} marka
 * @param {string} model
 * @param {string|null} nrReferencyjny
 * @param {Object} aiData
 * @param {number} [offerCurrentPrice=0]
 */
export async function getMarketPriceEstimate(marka, model, nrReferencyjny = null, aiData = {}, offerCurrentPrice = 0) {
  let marketAvgPrice = 0;
  let priceSource = '';

  // JEDYNY PRIORYTET: Prawdziwe ceny z portali OLX + Allegro + Chrono24
  const portalData = await fetchPortalMarketPrices(marka, model, nrReferencyjny);

  if (portalData.avgPrice > 0) {
    marketAvgPrice = portalData.avgPrice;
    priceSource = `Realne ceny z ${portalData.count} ofert na portalach (${portalData.breakdownSummary || 'OLX/Allegro/Chrono24'})`;
  } else {
    // Fallback: jeśli na ŻADNYM portalu nie znaleziono tego modelu
    // Spróbuj szerszego wyszukiwania (tylko marka + główny token modelu)
    if (model && model !== marka) {
      const broadSearch = await fetchPortalMarketPrices(marka, model, null);
      if (broadSearch.avgPrice > 0) {
        marketAvgPrice = broadSearch.avgPrice;
        priceSource = `Szersze wyszukiwanie: ${broadSearch.count} ofert (${broadSearch.breakdownSummary || 'OLX/Allegro/Chrono24'})`;
      }
    }

    // Ostateczny fallback: cena oferty (ale z wyraźnym ostrzeżeniem)
    if (marketAvgPrice === 0) {
      marketAvgPrice = offerCurrentPrice;
      priceSource = '⚠️ BRAK DANYCH Z PORTALI - użyto ceny oferty (ryzykowne!)';
      console.warn(`⚠️ [PRICE WARNING] Nie znaleziono żadnych cen na portalach dla "${marka} ${model}". Używam ceny oferty: ${offerCurrentPrice} PLN`);
    }
  }

  return {
    marketAvgPrice: Math.round(marketAvgPrice),
    priceSource
  };
}

/**
 * Wylicza matematykę decyzyjną zakupu.
 */
export function evaluateBuyingDecision({
  currentPrice,
  marketAvgPrice,
  shippingCost = 0,
  commission = 0,
  timeLeftMin,
  marginFactor = 0.85,
  sprawny = true
}) {
  const totalCost = currentPrice + shippingCost + commission;
  const profitMargin = Math.round(marketAvgPrice - totalCost);
  const maxOffer = Math.round((marketAvgPrice * marginFactor) - shippingCost - commission);

  // Czas do końca: max 5 godzin dla aukcji, bez limitu dla kup teraz
  const isEndingSoon = timeLeftMin !== undefined && timeLeftMin !== null && timeLeftMin <= 300;
  // Kup teraz (OLX/Allegro kup teraz) – zawsze jest dostępne
  const isBuyNow = timeLeftMin !== undefined && timeLeftMin !== null && timeLeftMin <= 0;

  // Zysk netto MUSI być >= 100 PLN
  const isProfitable = profitMargin >= 100;
  const shouldBuyAlert = (isEndingSoon || isBuyNow || timeLeftMin === undefined) && isProfitable && sprawny !== false;

  return {
    shouldBuyAlert,
    maxOffer,
    profitMargin,
    reason: isProfitable
      ? `Zysk netto: +${profitMargin} PLN po odjęciu kosztów`
      : `Brak zysku (strata: ${profitMargin} PLN)`
  };
}
