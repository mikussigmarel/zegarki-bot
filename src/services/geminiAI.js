import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey && apiKey !== 'AQ.Ab8RN6JqyM...') {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
  } catch (e) {
    console.warn('⚠️ Gemini AI client initialization error:', e.message);
  }
}

/**
 * Przeanalizuje opis oraz zdjęcie zegarka pod kątem ścisłej wyceny rynkowej kombinacji stanu wizualno-mechanicznego + kompletacji.
 * @param {string} title - Tytuł aukcji
 * @param {string} description - Opis aukcji
 * @param {string} [imageUrl] - URL oryginalnego zdjęcia aukcyjnego
 * @returns {Promise<{marka: string, model: string, nr_referencyjny: string|null, aiEstimatedPrice: number|null, stan: string, full_set: boolean, papiery: boolean, pudelko: boolean, sprawny: boolean, uwagi_ai: string}>}
 */
export async function analyzeWatchOffer(title, description, imageUrl = null, extraInfo = {}) {
  const countryText = extraInfo.sellerCountry ? `\nKraj wysyłki sprzedawcy ze strony: ${extraInfo.sellerCountry}` : '';
  const shippingText = extraInfo.shippingCost ? `\nRealny koszt dostawy ze strony: ${extraInfo.shippingCost} PLN` : '';
  const combinedText = `Tytuł: ${title}\nOpis: ${description || ''}${countryText}${shippingText}`;

  if (genAI) {
    try {
      const prompt = `Jesteś bezwzględnym, doświadczonym rzeczoznawcą i fliperem zegarków w Polsce (budżet 100 PLN - 3000 PLN). Twój cel to podanie SUCHEJ, REALNEJ WARTOŚCI RYNKOWEJ W POLSCE (ze szczególnym uwzględnieniem realiów POLSKIEGO RYNKU WTÓRNEGO: Allegro, Chrono24 Polska, OLX), aby użytkownik NIE PRZEPŁACIŁ ani grosza i mógł zyskowo odprzedać zegarek w Polsce.

🛡 KRYTYCZNA ZASADA BEZPIECZEŃSTWA (BEZWZGLĘDNA WERYFIKACJA AUTENTYCZNOŚCI I VISION AI):
1. WERYFIKACJA ZDJĘCIA (VISION AI): Spójrz na tarczę i wykonanie zegarka na zdjęciu. Jeśli tarcza/zdjęcie przedstawia luksusowy zegarek (np. Rolex Submariner, Omega, Breitling, Tudor, Tag Heuer, Patek, Cartier itp.), a cena oferty wynosi poniżej 1500 PLN lub w tytule wpisano ogólnik typu "Elegancki zegarek męski", MUSISZ BEZWZGLĘDNIE OZNACZYĆ "czy_podrobka_lub_replika": true, "prawdopodobna_oryginalnosc": "Podróbka / Replika" oraz "czy_opis_wiarygodny": false!
2. BEZMARKOWY CHŁAM I REPLIKI FASHION: Jeśli zegarek to tani no-name z Chin, podróbka fashion (np. Smael, Skmei, Geneva, Curren, Bisset) lub opis ma zaledwie 1 niekonkretne zdanie bez szczegółów, oznacz "czy_podrobka_lub_replika": true oraz "czy_opis_wiarygodny": false!

ZASADA DYNAMICZNEJ AUTONOMICZNEJ WYCENY AI (100% BEZ REGUŁ I SZTYWNYCH WZORCÓW):
Przeanalizuj dokładnie markę, model, nr referencyjny, stan wizualno-mechaniczny oraz obecność oryginalnego pudełka i papierów.

🌐 ZASADA UŚREDNIENIA CEN Z WIELU STRON (MULTI-SOURCE GOOGLE SEARCH):
1. PRZESZUKAJ WIELE PORTALI: Użyj wyszukiwania Google na żywo, aby sprawdzić ceny z WIELE PORTALI jednocześnie (Chrono24 PL, Allegro, OLX, eBay Polska).
2. ODRZUĆ SKRAJNOŚCI: Absolutnie odrzuć pojedyncze absurdalnie drogie oferty (np. skrajne ceny z Chrono24) oraz tanie podejrzane sztuki.
3. WYLICZ MEDIANĘ / ŚREDNIĄ REALNĄ: Podaj jako "sugerowana_szacunkowa_wartosc_pln" WYŁĄCZNIE zrównoważoną średnią (najczęstszą cenę rynkową w PLN), za jaką ten konkretny model w tym konkretnym stanie i komplecie faktycznie sprzedaje się w Polsce.

Zwróć JEDYNIE czysty format JSON (bez markdown \`\`\`json):
{
  "marka": "Dokładna marka (np. Seiko, Tissot, Omega, Orient, Citizen, Casio)",
  "model": "Nazwa modelu / serii (np. PRX, Speedtimer, Bambino)",
  "nr_referencyjny": "Numer referencyjny (jeśli podany lub rozpoznany, inaczej null)",
  "sugerowana_szacunkowa_wartosc_pln": 1500 (SUCHA REALNA CENA RYNKOWA w PLN uwzględniająca KROK PO KROKU kombinację stanu i kompletu),
  "stan": "Ocena stanu (np. 'Nienoszony', 'Bardzo dobry', 'Używany / rysy', 'Niesprawny / do naprawy')",
  "full_set": true/false (true tylko jeśli posiada ZARÓWNO pudełko JAK I papiery/certyfikat),
  "papiery": true/false (true jeśli są papiery/certyfikat/gwarancja),
  "pudelko": true/false (true jeśli jest oryginalne pudełko),
  "sprawny": true/false (true jeśli sprawny na chodzie, false jeśli uszkodzony),
  "czy_podrobka_lub_replika": true/false (true jeśli to podróbka/replika/fake),
  "prawdopodobna_oryginalnosc": "Wysoka" / "Podejrzana" / "Podróbka / Replika",
  "czy_opis_wiarygodny": true/false (false jeśli opis to zaledwie parę słów lub ściema),
  "uwagi_ai": "Krótkie uzasadnienie wyceny oraz oceny oryginalności"
}

Dane aukcji:
${combinedText}`;

      const contents = [prompt];

      if (imageUrl && !imageUrl.includes('unsplash')) {
        try {
          const imageRes = await fetch(imageUrl);
          if (imageRes.ok) {
            const arrayBuffer = await imageRes.arrayBuffer();
            const base64Data = Buffer.from(arrayBuffer).toString('base64');
            const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';
            contents.push({
              inlineData: {
                data: base64Data,
                mimeType: mimeType
              }
            });
          }
        } catch (imgErr) {}
      }

      const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
      let model;
      try {
        model = genAI.getGenerativeModel({
          model: modelName,
          tools: [{ googleSearch: {} }]
        });
      } catch (mErr) {
        model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      }

      const result = await model.generateContent(contents);
      const responseText = result.response.text() ? result.response.text().trim() : '';
      const cleanJsonStr = responseText.replace(/```json\s*|\s*```/g, '').trim();
      const parsed = JSON.parse(cleanJsonStr);

      return {
        marka: parsed.marka || parseBrandFallback(title),
        model: parsed.model || title,
        nr_referencyjny: parsed.nr_referencyjny || extractRefFallback(combinedText),
        aiEstimatedPrice: parsed.sugerowana_szacunkowa_wartosc_pln || null,
        stan: parsed.stan || 'Bardzo dobry',
        full_set: Boolean(parsed.full_set),
        papiery: Boolean(parsed.papiery),
        pudelko: Boolean(parsed.pudelko),
        sprawny: parsed.sprawny !== undefined ? Boolean(parsed.sprawny) : true,
        czy_podrobka_lub_replika: Boolean(parsed.czy_podrobka_lub_replika) || (parsed.stan && parsed.stan.toLowerCase().includes('podróbka')),
        prawdopodobna_oryginalnosc: parsed.prawdopodobna_oryginalnosc || (parsed.czy_podrobka_lub_replika ? 'Podróbka / Replika' : 'Wysoka'),
        czy_opis_wiarygodny: parsed.czy_opis_wiarygodny !== undefined ? Boolean(parsed.czy_opis_wiarygodny) : true,
        uwagi_ai: parsed.uwagi_ai || 'Ścisła analiza kombinacji stanu i kompletu'
      };
    } catch (err) {
      console.warn('⚠️ Błąd zapytania Gemini AI:', err.message);
    }
  }

  const lower = combinedText.toLowerCase();
  const hasNegativePapers = lower.includes('brak papierów') || lower.includes('brak dokumentów') || lower.includes('bez papierów') || lower.includes('bez dokumentów') || lower.includes('no papers') || lower.includes('sam zegarek');
  const hasPapers = (lower.includes('papiery') || lower.includes('dokument') || lower.includes('certyfikat') || lower.includes('gwarancj')) && !hasNegativePapers;

  const hasNegativeBox = lower.includes('brak pudełka') || lower.includes('bez pudełka') || lower.includes('sam zegarek') || lower.includes('no box');
  const isSet = (lower.includes('pudełko') || lower.includes('box')) && !hasNegativeBox;
  const isWorking = !lower.includes('uszkodzony') && !lower.includes('niesprawny') && !lower.includes('do naprawy');

  return {
    marka: parseBrandFallback(title),
    model: parseModelFallback(title),
    nr_referencyjny: extractRefFallback(combinedText),
    aiEstimatedPrice: null,
    stan: isWorking ? 'Bardzo dobry' : 'Niesprawny',
    full_set: isSet && hasPapers,
    papiery: hasPapers,
    pudelko: isSet,
    sprawny: isWorking,
    czy_podrobka_lub_replika: false,
    prawdopodobna_oryginalnosc: 'Wysoka',
    czy_opis_wiarygodny: true,
    uwagi_ai: isWorking ? 'Mechanizm sprawny (Fallback)' : 'Zegarek niesprawny'
  };
}

function parseBrandFallback(text) {
  const brands = ['Seiko', 'Omega', 'Tissot', 'Orient', 'Citizen', 'Casio', 'Tag Heuer', 'Longines', 'Certina', 'Hamilton'];
  for (const b of brands) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(text)) return b;
  }
  return text.split(' ')[0] || 'Zegarek';
}

function parseModelFallback(text) {
  const parts = text.split(' ');
  return parts.slice(1, 4).join(' ') || text;
}

function extractRefFallback(text) {
  const match = text.match(/\b([A-Z0-9]{4,10}-[A-Z0-9]{2,6}|[0-9]{3}\.[0-9]{2}\.[0-9]{3}|[A-Z0-9]{6,12})\b/);
  return match ? match[1] : null;
}
