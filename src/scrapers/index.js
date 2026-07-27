import { scrapeCatawikiWatches } from './catawiki.js';
import { scrapeAllegroWatches } from './allegro.js';
import { analyzeWatchOffer } from '../services/geminiAI.js';
import { getMarketPriceEstimate, evaluateBuyingDecision } from './priceEvaluator.js';
import { sendWatchAlert } from '../services/telegramBot.js';

let isJobRunning = false;
const processedOffersHistory = new Set();

/**
 * Uruchamia pełną pętlę skanowania aukcji: Scraping -> AI -> Wycena -> Telegram Alert.
 */
export async function runScraperJob() {
  if (isJobRunning) {
    console.log('⏳ Skanowanie już trwa. Pomijanie tego cyklu...');
    return;
  }

  isJobRunning = true;
  console.log('\n🚀 [CRON JOB] Rozpoczynanie cyklu skanowania aukcji zegarków...');

  try {
    // 1. Pobieranie ofert z platform
    const catawikiOffers = await scrapeCatawikiWatches();
    const allegroOffers = await scrapeAllegroWatches();

    const allOffers = [...catawikiOffers, ...allegroOffers];
    console.log(`🔎 Znaleziono łącznie ${allOffers.length} aktualnych ofert.`);

    for (const rawOffer of allOffers) {
      if (processedOffersHistory.has(rawOffer.id)) {
        continue;
      }
      processedOffersHistory.add(rawOffer.id);

      console.log(`\n--------------------------------------------------`);
      console.log(`🤖 Analiza AI (Gemini 1.5 Flash) dla: "${rawOffer.title}"...`);

      // 2. Analiza tekstu i obrazu przez Gemini AI
      const aiData = await analyzeWatchOffer(rawOffer.title, rawOffer.rawDescription, rawOffer.imageUrl);
      console.log(`📋 Wynik Gemini: ${aiData.marka} | Model: ${aiData.model} | Ref: ${aiData.nr_referencyjny || 'Brak'} | Stan: ${aiData.stan} | FullSet: ${aiData.full_set}`);

      // 3. Moduł wyceny rynkowej
      const marketPrice = await getMarketPriceEstimate(aiData.marka, aiData.model, aiData.nr_referencyjny);
      console.log(`📊 Estymacja rynkowa: Średnia = ${marketPrice.marketAvgPrice} PLN (Chrono24: ${marketPrice.chronoPrice}, Allegro: ${marketPrice.allegroPrice}, eBay: ${marketPrice.ebayPrice})`);

      // 4. Matematyka decyzyjna
      const evaluation = evaluateBuyingDecision({
        currentPrice: rawOffer.currentPrice,
        marketAvgPrice: marketPrice.marketAvgPrice,
        shippingCost: rawOffer.shippingCost,
        commission: 0,
        timeLeftMin: rawOffer.timeLeftMin,
        marginFactor: parseFloat(process.env.DEFAULT_MARGIN_FACTOR) || 0.7
      });

      console.log(`🎯 Wynik wyceny: Aktualna cena = ${rawOffer.currentPrice} PLN, Max Oferta = ${evaluation.maxOffer} PLN, Przewidywany marża/zysk = ${evaluation.profitMargin} PLN, Czas = ${rawOffer.timeLeftMin} min`);

      // 5. Weryfikacja warunków i powiadomienie Telegram
      if (evaluation.shouldBuyAlert || rawOffer.id.includes('demo')) {
        console.log(`⚡ WARUNKI SPEŁNIONE! Wysyłanie alertu okazjonalnego na Telegram...`);
        const fullOffer = {
          ...rawOffer,
          ...aiData,
          marketAvgPrice: marketPrice.marketAvgPrice,
          maxOffer: evaluation.maxOffer,
          profitMargin: evaluation.profitMargin
        };
        await sendWatchAlert(fullOffer);
      } else {
        console.log(`🛑 Oferta nie spełnia kryteriów zakupu (Aktualna: ${rawOffer.currentPrice} PLN >= Max: ${evaluation.maxOffer} PLN lub Czas > 30min).`);
      }
    }
  } catch (err) {
    console.error('⚠️ Błąd podczas wykonywania joba skanującego:', err);
  } finally {
    isJobRunning = false;
    console.log('✅ [CRON JOB] Zakończono cykl skanowania.\n');
  }
}
