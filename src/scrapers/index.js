import { scrapeCatawikiWatches } from './catawiki.js';
import { scrapeAllegroWatches, fetchAllegroFullDescription } from './allegro.js';
import { scrapeOlxWatches } from './olx.js';
import { analyzeWatchOffer, checkTextIsWorkingStatus } from '../services/geminiAI.js';
import { getMarketPriceEstimate, evaluateBuyingDecision } from './priceEvaluator.js';
import { sendWatchAlert } from '../services/telegramBot.js';

let isJobRunning = false;
const processedOffersHistory = new Set();

/**
 * Uruchamia pętlę skanowania aukcji STRYKTOWANĄ na przedział budżetowy 100 PLN - 3000 PLN oraz CZAS DO KOŃCA MAX 5 GODZIN (300 MINUT).
 * @param {boolean} [forceAll=false]
 */
export async function runScraperJob(forceAll = false) {
  if (isJobRunning) {
    console.log('⏳ Skanowanie już trwa. Pomijanie tego cyklu...');
    return;
  }

  if (forceAll) {
    processedOffersHistory.clear();
  }

  isJobRunning = true;
  console.log('\n🚀 [CRON JOB] Rozpoczynanie skanowania na żywo (Rygor: Max 5 godzin do końca, Budżet 100-3000 PLN)...');

  try {
    const catawikiOffers = await scrapeCatawikiWatches();
    const allegroOffers = await scrapeAllegroWatches();
    const olxOffers = await scrapeOlxWatches();

    const allOffers = [...catawikiOffers, ...allegroOffers, ...olxOffers];
    console.log(`🔎 Znaleziono łącznie ${allOffers.length} realnych ofert na żywo (Catawiki + Allegro + OLX).`);

    // Pre-filtrowanie przed wywołaniami AI (oszczędność quota i czasu)
    const validCandidates = allOffers.filter(rawOffer => {
      // 1. Budżet: 100 PLN - 3000 PLN
      if (rawOffer.currentPrice < 100 || rawOffer.currentPrice > 3000) return false;

      // 2. Czas: Aukcje max 5h (300 min), Kup Teraz (OLX/Allegro) z czasem 0 zawsze OK
      if (rawOffer.timeLeftMin > 300 && rawOffer.platform !== 'OLX' && rawOffer.timeLeftMin !== 0) return false;

      // 3. Tekstowy pre-filter niesprawności
      const preCheck = checkTextIsWorkingStatus(rawOffer.rawDescription || rawOffer.title);
      if (!preCheck.isWorking) return false;

      // 4. Historia przetworzonych
      if (processedOffersHistory.has(rawOffer.id) && !forceAll) return false;

      return true;
    });

    // Sortuj kandydatów: ZAWSZE pierwotnie oferty z Catawiki i Allegro, a OLX na końcu
    validCandidates.sort((a, b) => {
      const priorityA = (a.platform === 'Catawiki' || a.platform === 'Allegro') ? 1 : 2;
      const priorityB = (b.platform === 'Catawiki' || b.platform === 'Allegro') ? 1 : 2;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return (a.timeLeftMin || 999) - (b.timeLeftMin || 999);
    });

    // Analizuj WSZYSTKICH spełniających kryteria kandydatów bez sztucznych kagańców/limitów ilościowych!
    const selectedBatch = validCandidates;
    console.log(`🎯 Wyselekcjonowano ${selectedBatch.length} czystych kandydatów do analizy AI.`);

    for (const rawOffer of selectedBatch) {
      try {
        processedOffersHistory.add(rawOffer.id);

        console.log(`\n--------------------------------------------------`);
        console.log(`🤖 Analiza AI dla oferty: "${rawOffer.title}" (${rawOffer.platform}, ${rawOffer.currentPrice} PLN)...`);

        // Odstęp czasu (4.5s), aby bezwzględnie przestrzegać darmowego limitu 15 RPM w Gemini API
        await new Promise(r => setTimeout(r, 4500));

        // Dociągnięcie pełnego opisu sprzedawcy z Allegro na żądanie dla wyselekcjonowanego kandydata
        if (rawOffer.platform === 'Allegro' && rawOffer.link) {
          const fullAllegroDesc = await fetchAllegroFullDescription(rawOffer.link);
          if (fullAllegroDesc && fullAllegroDesc.length >= 10) {
            rawOffer.rawDescription = `Opis sprzedawcy:\n${fullAllegroDesc}`;
          }
        }

        // 4. Analiza AI kombinacji stanu, rocznika, mechanizmu, wyposażenia oraz wyciągniętej ze strony dostawy
        const aiData = await analyzeWatchOffer(rawOffer.title, rawOffer.rawDescription, rawOffer.imageUrl, {
          sellerCountry: rawOffer.sellerCountry,
          shippingCost: rawOffer.shippingCost
        });
        console.log(`📋 Wynik AI: ${aiData.marka} ${aiData.model} | Ref: ${aiData.nr_referencyjny || 'Brak'} | Rok/Era: ${aiData.rok_produkcji_lub_era} | Mechanizm: ${aiData.rodzaj_mechanizmu} | Sprawny: ${aiData.sprawny} | FullSet: ${aiData.full_set} | Uwagi: ${aiData.uwagi_ai}`);

        // 🛑 STRICT WORKING CHECK: Bezwzględne odrzucenie zegarków niesprawnych lub wymagających naprawy!
        if (aiData.sprawny !== true) {
          console.log(`🚨 [NON-WORKING DISCARD] Odrzucono zegarek niesprawny / do naprawy: "${rawOffer.title}" (Powód: ${aiData.powod_niesprawnosci || aiData.stan})`);
          continue;
        }

        // 🛡 ANTY-PODRÓBKA / REPLIKA DISCARD: Odrzuć natychmiast fakes, podróbki oraz niewiarygodne opisy (o ile nie był to tylko tymczasowy błąd API)!
        if (!aiData.aiError && (aiData.czy_podrobka_lub_replika || aiData.czy_opis_wiarygodny === false || aiData.prawdopodobna_oryginalnosc?.includes('Podróbka') || aiData.stan?.includes('Podróbka') || (aiData.marka?.toLowerCase().includes('rolex') && rawOffer.currentPrice < 3000))) {
          console.log(`🚨 [ANTI-FAKE DISCARD] Odrzucono ofertę z powodu wykrytej repliki/podróbki lub niewiarygodnego opisu: "${rawOffer.title}" (${aiData.uwagi_ai})`);
          continue;
        }

        // 5. WYCENA Z PRAWDZIWYCH PORTALI (OLX + Allegro + Chrono24) – AI NIE WYCENIA!
        const marketPrice = await getMarketPriceEstimate(aiData.marka, aiData.model, aiData.nr_referencyjny, aiData, rawOffer.currentPrice);
        console.log(`💰 [REALNA WYCENA] Źródło: ${marketPrice.priceSource}`);

        // 6. Ścisła matematyka decyzyjna (Czas do końca MUST BE <= 300 min)
        const evaluation = evaluateBuyingDecision({
          currentPrice: rawOffer.currentPrice,
          marketAvgPrice: marketPrice.marketAvgPrice,
          shippingCost: rawOffer.shippingCost || (rawOffer.platform === 'Catawiki' ? 75 : 15),
          commission: rawOffer.commission || (rawOffer.platform === 'Catawiki' ? Math.round(rawOffer.currentPrice * 0.09) + 13 : 0),
          timeLeftMin: rawOffer.timeLeftMin,
          marginFactor: parseFloat(process.env.DEFAULT_MARGIN_FACTOR) || 0.85,
          sprawny: aiData.sprawny
        });

        console.log(`🎯 Wycena: Cena oferty = ${rawOffer.currentPrice} PLN | Wartość rynkowa (portale) = ${marketPrice.marketAvgPrice} PLN | Max oferta = ${evaluation.maxOffer} PLN | Zysk netto = ${evaluation.profitMargin} PLN | Czas = ${rawOffer.timeLeftMin} min`);

        // 7. Wysyłka alertu na Telegram (STRICT REQUIREMENT: Tylko sprawne zegarki + Zysk netto CO NAJMNIEJ 100 PLN!)
        if (evaluation.shouldBuyAlert && evaluation.profitMargin >= 100) {
          console.log(`⚡ WARUNKI SPEŁNIONE! Zegarek 100% sprawny, zysk netto +${evaluation.profitMargin} PLN >= 100 PLN. Wysyłanie alertu na Telegram...`);
          const fullOffer = {
            ...rawOffer,
            ...aiData,
            marketAvgPrice: marketPrice.marketAvgPrice,
            priceSource: marketPrice.priceSource,
            maxOffer: evaluation.maxOffer,
            profitMargin: evaluation.profitMargin,
            reason: evaluation.reason
          };
          await sendWatchAlert(fullOffer);
        } else {
          console.log(`❌ Brak wystarczającego zysku (+100 PLN) lub niewystarczający czas dla oferty "${rawOffer.title}". Pomijanie alertu.`);
        }
      } catch (itemErr) {
        console.warn(`⚠️ Błąd analizy pojedynczej oferty "${rawOffer.title}":`, itemErr.message);
      }
    }
  } catch (err) {
    console.error('⚠️ Błąd podczas wykonywania joba skanującego:', err);
  } finally {
    isJobRunning = false;
    console.log('✅ [CRON JOB] Zakończono cykl skanowania.\n');
  }
}

