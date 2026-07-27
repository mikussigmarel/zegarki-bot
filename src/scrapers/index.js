import { scrapeCatawikiWatches } from './catawiki.js';
import { scrapeAllegroWatches } from './allegro.js';
import { analyzeWatchOffer } from '../services/geminiAI.js';
import { getMarketPriceEstimate, evaluateBuyingDecision } from './priceEvaluator.js';
import { sendWatchAlert } from '../services/telegramBot.js';

let isJobRunning = false;
const processedOffersHistory = new Set();

/**
 * Uruchamia pełną pętlę skanowania aukcji pod kątem budżetu 100 PLN - 3000 PLN i 5-godzinnego okna czasowego.
 * @param {boolean} [forceAll=false] - Wymuś wysłanie alertu nawet jeśli oferta była przetwarzana
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
  console.log('\n🚀 [CRON JOB] Rozpoczynanie skanowania na żywo (Budżet 100 PLN - 3 000 PLN, Okno 5 godz)...');

  try {
    const catawikiOffers = await scrapeCatawikiWatches();
    const allegroOffers = await scrapeAllegroWatches();

    const allOffers = [...catawikiOffers, ...allegroOffers];
    console.log(`🔎 Znaleziono łącznie ${allOffers.length} realnych ofert na żywo.`);

    for (const rawOffer of allOffers) {
      // 1. Weryfikacja przedziału cenowego: 100 PLN - 3000 PLN
      if (rawOffer.currentPrice < 100 || rawOffer.currentPrice > 3000) {
        console.log(`⏭️ Pomijanie oferty poza budżetem 100-3000 PLN (Cena: ${rawOffer.currentPrice} PLN): "${rawOffer.title}"`);
        continue;
      }

      if (!forceAll && processedOffersHistory.has(rawOffer.id)) {
        console.log(`⏭️ Pomijanie już przetworzonej oferty: "${rawOffer.title}"`);
        continue;
      }
      processedOffersHistory.add(rawOffer.id);

      console.log(`\n--------------------------------------------------`);
      console.log(`🤖 Analiza AI (Gemini 1.5 Flash) dla realnej oferty: "${rawOffer.title}"...`);

      // 2. Szpiegowska analiza AI ze zdjęcia i opisu
      const aiData = await analyzeWatchOffer(rawOffer.title, rawOffer.rawDescription, rawOffer.imageUrl);
      console.log(`📋 Wynik Gemini: ${aiData.marka} ${aiData.model} | Ref: ${aiData.nr_referencyjny || 'Rozpoznano'} | Stan: ${aiData.stan} | FullSet: ${aiData.full_set} | Sprawny: ${aiData.sprawny}`);

      // 3. Moduł wyceny rynkowej
      const marketPrice = await getMarketPriceEstimate(aiData.marka, aiData.model, aiData.nr_referencyjny, aiData.aiEstimatedPrice);
      console.log(`📊 Estymacja rynkowa: Średnia = ${marketPrice.marketAvgPrice} PLN (Chrono24: ${marketPrice.chronoPrice}, Allegro: ${marketPrice.allegroPrice}, eBay: ${marketPrice.ebayPrice})`);

      // 4. Matematyka decyzyjna (okno czasowe do 5 godzin = 300 min)
      const evaluation = evaluateBuyingDecision({
        currentPrice: rawOffer.currentPrice,
        marketAvgPrice: marketPrice.marketAvgPrice,
        shippingCost: rawOffer.shippingCost,
        commission: 0,
        timeLeftMin: rawOffer.timeLeftMin,
        marginFactor: parseFloat(process.env.DEFAULT_MARGIN_FACTOR) || 0.7
      });

      console.log(`🎯 Wycena: Cena = ${rawOffer.currentPrice} PLN, Max Oferta = ${evaluation.maxOffer} PLN, Zysk = ${evaluation.profitMargin} PLN, Czas do końca = ${rawOffer.timeLeftMin} min`);

      // 5. Wysyłka alertu na Telegram
      if (evaluation.shouldBuyAlert || forceAll || rawOffer.currentPrice < evaluation.maxOffer) {
        console.log(`⚡ WARUNKI SPEŁNIONE! Wysyłanie oryginalnego zdjęcia i alertu na Telegram...`);
        const fullOffer = {
          ...rawOffer,
          ...aiData,
          marketAvgPrice: marketPrice.marketAvgPrice,
          maxOffer: evaluation.maxOffer,
          profitMargin: evaluation.profitMargin
        };
        await sendWatchAlert(fullOffer);
      } else {
        console.log(`🛑 Oferta nie spełnia kryteriów zakupu.`);
      }
    }
  } catch (err) {
    console.error('⚠️ Błąd podczas wykonywania joba skanującego:', err);
  } finally {
    isJobRunning = false;
    console.log('✅ [CRON JOB] Zakończono cykl skanowania.\n');
  }
}
