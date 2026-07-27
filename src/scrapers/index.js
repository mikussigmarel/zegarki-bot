import { scrapeCatawikiWatches } from './catawiki.js';
import { scrapeAllegroWatches } from './allegro.js';
import { scrapeOlxWatches } from './olx.js';
import { analyzeWatchOffer } from '../services/geminiAI.js';
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

    for (const rawOffer of allOffers) {
      try {
        // 1. Filtr budżetowy: 100 PLN do 3000 PLN
        if (rawOffer.currentPrice < 100 || rawOffer.currentPrice > 3000) {
          console.log(`⏭️ Pomijanie oferty poza budżetem 100-3000 PLN (Cena: ${rawOffer.currentPrice} PLN): "${rawOffer.title}"`);
          continue;
        }

        // 2. Rygorystyczne filtrowanie czasu: TYLKO AUKCJE KOŃCZĄCE SIĘ W CIĄGU 5 GODZIN (300 MINUT)
        if (rawOffer.timeLeftMin > 300) {
          console.log(`⏭️ Pomijanie oferty kończącej się za ponad 5 godzin (${rawOffer.timeLeftMin} min): "${rawOffer.title}"`);
          continue;
        }

        if (processedOffersHistory.has(rawOffer.id) && !forceAll) {
          console.log(`⏭️ Pomijanie już przetworzonej oferty: "${rawOffer.title}"`);
          continue;
        }
        processedOffersHistory.add(rawOffer.id);

        console.log(`\n--------------------------------------------------`);
        console.log(`🤖 Analiza AI (Gemini 1.5 Flash) dla realnej oferty: "${rawOffer.title}" (${rawOffer.platform})...`);

        // 3. Analiza AI kombinacji stanu, wyposażenia oraz wyciągniętej ze strony dostawy
        const aiData = await analyzeWatchOffer(rawOffer.title, rawOffer.rawDescription, rawOffer.imageUrl, {
          sellerCountry: rawOffer.sellerCountry,
          shippingCost: rawOffer.shippingCost
        });
        console.log(`📋 Wynik Gemini: ${aiData.marka} ${aiData.model} | Ref: ${aiData.nr_referencyjny || 'Brak'} | Stan: ${aiData.stan} | FullSet: ${aiData.full_set} | Podróbka: ${aiData.czy_podrobka_lub_replika || false}`);

        // 🛡 ANTY-PODRÓBKA / REPLIKA DISCARD: Odrzuć natychmiast fakes i podróbki!
        if (aiData.czy_podrobka_lub_replika || aiData.prawdopodobna_oryginalnosc?.includes('Podróbka') || aiData.stan?.includes('Podróbka')) {
          console.log(`🚨 [ANTI-FAKE DISCARD] Odrzucono ofertę z powodu wykrytej repliki/podróbki: "${rawOffer.title}" (${aiData.uwagi_ai})`);
          continue;
        }

        // 4. Moduł wyceny rynkowej
        const marketPrice = await getMarketPriceEstimate(aiData.marka, aiData.model, aiData.nr_referencyjny, aiData);

        // 5. Ścisła matematyka decyzyjna (Czas do końca MUST BE <= 300 min)
        const evaluation = evaluateBuyingDecision({
          currentPrice: rawOffer.currentPrice,
          marketAvgPrice: marketPrice.marketAvgPrice,
          shippingCost: rawOffer.shippingCost || (rawOffer.platform === 'Catawiki' ? 75 : 15),
          commission: rawOffer.commission || (rawOffer.platform === 'Catawiki' ? Math.round(rawOffer.currentPrice * 0.09) + 13 : 0),
          timeLeftMin: rawOffer.timeLeftMin,
          marginFactor: parseFloat(process.env.DEFAULT_MARGIN_FACTOR) || 0.7,
          sprawny: aiData.sprawny
        });

        console.log(`🎯 Wycena: Cena = ${rawOffer.currentPrice} PLN, Max Oferta = ${evaluation.maxOffer} PLN, Zysk = ${evaluation.profitMargin} PLN, Czas do końca = ${rawOffer.timeLeftMin} min`);

        // 6. Wysyłka alertu na Telegram
        if (evaluation.shouldBuyAlert || forceAll || rawOffer.currentPrice < evaluation.maxOffer) {
          console.log(`⚡ WARUNKI SPEŁNIONE! Wysyłanie oryginalnego zdjęcia i alertu na Telegram...`);
          const fullOffer = {
            ...rawOffer,
            ...aiData,
            marketAvgPrice: marketPrice.marketAvgPrice,
            maxOffer: evaluation.maxOffer,
            profitMargin: evaluation.profitMargin,
            reason: evaluation.reason
          };
          await sendWatchAlert(fullOffer);
        } else {
          console.log(`❌ Brak wystarczającego zysku (+50 PLN) dla oferty "${rawOffer.title}". Pomijanie alertu.`);
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
