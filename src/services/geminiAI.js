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
 * @returns {Promise<{marka: string, model: string, nr_referencyjny: string|null, rok_produkcji_lub_era: string, rodzaj_mechanizmu: string, aiEstimatedPrice: number|null, stan: string, full_set: boolean, papiery: boolean, pudelko: boolean, sprawny: boolean, powod_niesprawnosci: string|null, uwagi_ai: string}>}
 */
export async function analyzeWatchOffer(title, description, imageUrl = null, extraInfo = {}) {
  const countryText = extraInfo.sellerCountry ? `\nKraj wysyłki sprzedawcy ze strony: ${extraInfo.sellerCountry}` : '';
  const shippingText = extraInfo.shippingCost ? `\nRealny koszt dostawy ze strony: ${extraInfo.shippingCost} PLN` : '';
  const combinedText = `Tytuł: ${title}\nOpis: ${description || ''}${countryText}${shippingText}`;

  if (genAI) {
    try {
      const prompt = `Jesteś bezwzględnym, doświadczonym rzeczoznawcą i fliperem zegarków w Polsce (budżet 100 PLN - 3000 PLN). Twoim JEDYNYM zadaniem jest PRECYZYJNA IDENTYFIKACJA MODELU, WERYFIKACJA SPRAWNOŚCI MECHANICZNEJ, OCENA AUTENTYCZNOŚCI I STANU KOMPLETACJI zegarka. NIE WYCENIASZ CENY – cenę rynkową wyliczy osobny moduł z prawdziwych ofert na portalach.

🚨 KRYTYCZNA ZASADA #1 - BEZWZGLĘDNA WERYFIKACJA OPISU TEKSTOWEGO I SPRAWNOŚCI MECHANICZNEJ:
1. PRZECZYTAJ OPIS TEKSTOWY SŁOWO PO SŁOWIE: Nawet jeśli zdjęcie przedstawia piękny, czysty zegarek, JEŚLI W OPISIE TEKSTOWYM LUB TYTULE podano jakąkolwiek informację o braku sprawności, uszkodzeniu lub potrzebie ingerencji zegarmistrza (np. "niesprawny", "wymaga wizyty u zegarmistrza", "wymaga serwisu", "do przeglądu", "nie działa", "nie na chodzie", "staje", "spóźnia", "balans uszkodzony", "do renowacji", "na części", "nietestowany", "stan nieznany", "do naprawy"), MUSISZ BEZWZGLĘDNIE USTAWIC "sprawny": false!
2. PODAJ POWÓD NIESPRAWNOŚCI: W polu "powod_niesprawnosci" wpisz dokładny powód podany przez sprzedawcę (np. "Wymaga wizyty u zegarmistrza", "Zegarek niesprawny/uszkodzony").

🛡 KRYTYCZNA ZASADA #2 - BEZWZGLĘDNA WERYFIKACJA AUTENTYCZNOŚCI (VISION AI):
1. WERYFIKACJA ZDJĘCIA (VISION AI): Spójrz na tarczę i wykonanie zegarka na zdjęciu. Jeśli tarcza/zdjęcie przedstawia luksusowy zegarek (np. Rolex Submariner, Omega, Breitling, Tudor, Tag Heuer, Patek, Cartier itp.), a cena oferty wynosi poniżej 1500 PLN lub w tytule wpisano ogólnik typu "Elegancki zegarek męski", MUSISZ BEZWZGLĘDNIE OZNACZYĆ "czy_podrobka_lub_replika": true, "prawdopodobna_oryginalnosc": "Podróbka / Replika" oraz "czy_opis_wiarygodny": false!
2. BEZMARKOWY CHŁAM I REPLIKI FASHION: Jeśli zegarek to tani no-name z Chin lub podróbka fashion (np. Smael, Skmei, Geneva, Curren) lub opis ma zaledwie 1 niekonkretne zdanie bez szczegółów, oznacz "czy_podrobka_lub_replika": true oraz "czy_opis_wiarygodny": false!

🎯 KRYTYCZNA ZASADA #3 - BEZWZGLĘDNA IDENTYFIKACJA KONKRETNEGO MODELU:
1. DOKŁADNY MODEL I REFERENCJA: Zidentyfikuj DOKŁADNĄ nazwę modelu i numer referencyjny (np. Seiko Presage SRPD37J1, Tissot PRX T137.407, Orient Bambino FAC00005W0). Używaj zdjęcia tarczy, opisu i parametrów do rozpoznania.
2. NIEISTNIEJĄCE LUB ZMYŚLONE MODELE: Jeśli model jest zmyślony, nie istnieje na rynku zegarkowym lub jest to "no-name fantasy watch", oznacz bezwzględnie "czy_opis_wiarygodny": false oraz "czy_podrobka_lub_replika": true!
3. ROK PRODUKCJI / ERA: Zweryfikuj rocznik lub erę zegarka z opisu/zdjęcia (np. "lata 70.", "ok. 1995", "2018+", "Vintage lata 60.").
4. RODZAJ MECHANIZMU: Zweryfikuj typ mechanizmu (np. "Automatyczny", "Kwarcowy", "Nakręcany ręcznie", "Solar").

📦 ANALIZA ZDJĘCIA PUDEŁKA I PAPIERÓW (VISION AI):
- OGLĄDAJ ZDJĘCIE: Jeśli na zdjęciu widoczne jest pudełko na zegarek (oryginalne etui, zielone/czarne pudełko, opakowanie ze poduszką na zegarek), MUSISZ BEZWZGLĘDNIE ustawić "pudelko": true!
- Jeśli na zdjęciu widać dokumenty, książeczki, instrukcję lub kartę gwarancyjną/certyfikat, MUSISZ ustawić "papiery": true!
- Ustaw "full_set": true TYLKO gdy na zdjęciu lub w opisie obecne są ZARÓWNO pudełko, JAK I papiery/gwarancja!

Zwróć JEDYNIE czysty format JSON (bez markdown \`\`\`json, bez żadnego dodatkowego tekstu):
{
  "marka": "Seiko",
  "model": "Presage",
  "nr_referencyjny": "SRPD37J1",
  "rok_produkcji_lub_era": "ok. 2020",
  "rodzaj_mechanizmu": "Automatyczny",
  "stan": "Bardzo dobry",
  "full_set": true,
  "papiery": true,
  "pudelko": true,
  "sprawny": true,
  "powod_niesprawnosci": null,
  "czy_podrobka_lub_replika": false,
  "prawdopodobna_oryginalnosc": "Wysoka",
  "czy_opis_wiarygodny": true,
  "uwagi_ai": "Seiko Presage SRPD37J1 z oryginalnym pudełkiem i papierami. Zegarek automatyczny w bardzo dobrym stanie, na chodzie."
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
      const model = genAI.getGenerativeModel({ model: modelName });

      let result = null;
      let maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          result = await model.generateContent(contents);
          break;
        } catch (apiErr) {
          const isRateLimit = apiErr.message?.includes('429') || apiErr.message?.includes('quota') || apiErr.status === 429;
          if (isRateLimit && attempt < maxRetries) {
            const waitSec = attempt * 5;
            console.warn(`⏳ [RATE LIMIT 429] Przekroczono darmowy limit zapytań Gemini. Czekanie ${waitSec}s...`);
            await new Promise(res => setTimeout(res, waitSec * 1000));
          } else {
            throw apiErr;
          }
        }
      }

      const responseText = result && result.response && result.response.text ? result.response.text().trim() : '';
      let cleanJsonStr = responseText.replace(/```json\s*|\s*```/g, '').trim();

      let parsed = {};
      try {
        parsed = JSON.parse(cleanJsonStr);
      } catch (parseErr) {
        console.warn('⚠️ Błąd parsowania JSON z Gemini. Próba wyciągnięcia danych z surowego tekstu...');
        // Wyciąganie JSON za pomocą regex
        const jsonBlockMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        if (jsonBlockMatch) {
          try {
            // Usunięcie ewentualnych komentarzy inline w kodzie wygenerowanym przez AI
            const sanitized = jsonBlockMatch[0].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            parsed = JSON.parse(sanitized);
          } catch (e2) {}
        }
      }

      // AI nie wycenia ceny – cena pochodzi z prawdziwego scrapera portali
      // Pole sugerowana_szacunkowa_wartosc_pln jest ignorowane nawet jeśli AI je wyśle
      let extractedPrice = null;

      const textWorkingStatus = checkTextIsWorkingStatus(combinedText);
      const finalSprawny = textWorkingStatus.isWorking === false ? false : (parsed.sprawny !== undefined ? Boolean(parsed.sprawny) : true);

      return {
        marka: parsed.marka || parseBrandFallback(title),
        model: parsed.model || title,
        nr_referencyjny: parsed.nr_referencyjny || extractRefFallback(combinedText),
        rok_produkcji_lub_era: parsed.rok_produkcji_lub_era || 'Nieokreślony',
        rodzaj_mechanizmu: parsed.rodzaj_mechanizmu || 'Nieokreślony',
        aiEstimatedPrice: extractedPrice,
        stan: parsed.stan || (finalSprawny ? 'Bardzo dobry' : 'Niesprawny / do naprawy'),
        full_set: Boolean(parsed.full_set),
        papiery: Boolean(parsed.papiery),
        pudelko: Boolean(parsed.pudelko),
        sprawny: finalSprawny,
        powod_niesprawnosci: !finalSprawny ? (parsed.powod_niesprawnosci || textWorkingStatus.reason || 'Wymaga naprawy / wizyty u zegarmistrza') : null,
        czy_podrobka_lub_replika: Boolean(parsed.czy_podrobka_lub_replika) || (parsed.stan && parsed.stan.toLowerCase().includes('podróbka')),
        prawdopodobna_oryginalnosc: parsed.prawdopodobna_oryginalnosc || (parsed.czy_podrobka_lub_replika ? 'Podróbka / Replika' : 'Wysoka'),
        czy_opis_wiarygodny: parsed.czy_opis_wiarygodny !== undefined ? Boolean(parsed.czy_opis_wiarygodny) : true,
        uwagi_ai: parsed.uwagi_ai || 'Ścisła analiza kombinacji stanu, rocznika i kompletu'
      };
    } catch (err) {
      console.warn('⚠️ Błąd zapytania Gemini AI:', err.message);
    }
  }

  const fallbackCheck = checkTextIsWorkingStatus(combinedText);

  return {
    marka: parseBrandFallback(title),
    model: parseModelFallback(title),
    nr_referencyjny: extractRefFallback(combinedText),
    rok_produkcji_lub_era: 'Nieokreślony',
    rodzaj_mechanizmu: 'Nieokreślony',
    aiEstimatedPrice: null,
    stan: fallbackCheck.isWorking ? 'Niezweryfikowany (Błąd AI)' : 'Niesprawny / do naprawy',
    full_set: false,
    papiery: false,
    pudelko: false,
    sprawny: fallbackCheck.isWorking,
    powod_niesprawnosci: fallbackCheck.isWorking ? 'Brak weryfikacji AI (Błąd zapytania/limit)' : fallbackCheck.reason,
    czy_podrobka_lub_replika: false,
    prawdopodobna_oryginalnosc: 'Niepewna (Błąd AI)',
    czy_opis_wiarygodny: false, // 🛑 BEZPIECZEŃSTWO: Wrzucamy false, by oferta bez weryfikacji AI nie przeszła do alertu Telegrama
    uwagi_ai: '⚠️ Błąd połączenia z Gemini AI lub przekroczenie limitu zapytań (429). Oferta pominięta dla bezpieczeństwa.'
  };
}

/**
 * Szuka w tekście (tytuł + opis) fraz wyraźnie wskazujących na niesprawność / potrzebę serwisu/zegarmistrza.
 */
export function checkTextIsWorkingStatus(text) {
  if (!text) return { isWorking: true, reason: null };
  const lower = text.toLowerCase();

  const nonWorkingPhrases = [
    'wymaga wizyty u zegarmistrza',
    'wizyta u zegarmistrza',
    'u zegarmistrza',
    'do zegarmistrza',
    'niesprawny',
    'uszkodzony',
    'do naprawy',
    'do serwisu',
    'wymaga serwisu',
    'wymaga przeglądu',
    'do przeglądu',
    'nie działa',
    'nie na chodzie',
    'nie chodzi',
    'nie nakręca',
    'staje po',
    'spóźnia',
    'balans uszkodzony',
    'uszkodzony balans',
    'stan nieznany',
    'nietestowany',
    'na części',
    'do renowacji',
    'do czyszczenia',
    'zalany',
    'sprzedaję jako uszkodzony',
    'jako uszkodzony'
  ];

  for (const phrase of nonWorkingPhrases) {
    if (lower.includes(phrase)) {
      return {
        isWorking: false,
        reason: `Wykryto frazę w opisie: "${phrase}"`
      };
    }
  }

  return { isWorking: true, reason: null };
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

