import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

// Pula kluczy API (obsługa rotacji wielu kluczy z rozdzieleniem przecinkami)
let apiKeys = [];
let currentKeyIndex = 0;

function initGeminiKeys() {
  const envKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  apiKeys = envKeys
    .split(',')
    .map(k => k.trim())
    .filter(k => k && k.length > 5);

  if (apiKeys.length > 0) {
    console.log(`🔑 [GEMINI AI] Zarejestrowano ${apiKeys.length} klucz(e) API do rotacji.`);
  }
}
initGeminiKeys();

/**
 * Solidne pobieranie obrazu z 2 próbami i nagłówkami przeglądarki, zapobiegające błędom i wiszeniu.
 */
async function fetchImageAsBase64(imageUrl) {
  if (!imageUrl || imageUrl.includes('unsplash')) return null;

  const headersList = [
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' }
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(imageUrl, {
        headers: headersList[attempt] || headersList[0],
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = res.headers.get('content-type') || 'image/jpeg';
        return { base64Data, mimeType };
      }
    } catch (e) {
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
  }

  return null;
}

/**
 * Zwraca klient GoogleGenerativeAI z rotującej puli kluczy API
 */
function getNextGeminiClient() {
  initGeminiKeys();
  if (apiKeys.length === 0) return null;
  const key = apiKeys[currentKeyIndex % apiKeys.length];
  const activeIndex = (currentKeyIndex % apiKeys.length) + 1;
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  return { client: new GoogleGenerativeAI(key), keyIndex: activeIndex, totalKeys: apiKeys.length };
}

/**
 * Zapytanie do lokalnego AI (Ollama / LocalAI / LM Studio) działającego na Localhost lub własnym serwerze GPU
 */
async function callLocalAI(prompt, base64Data = null, mimeType = 'image/jpeg') {
  const url = process.env.LOCAL_AI_URL || 'http://localhost:11434/v1/chat/completions';
  const modelName = process.env.LOCAL_AI_MODEL || 'qwen2.5-vl';

  const content = [];
  content.push({ type: 'text', text: prompt });

  if (base64Data) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64Data}`
      }
    });
  }

  console.log(`🤖 [LOKALNE AI] Wysyłanie zapytania do lokalnego serwera LLM (${modelName} na ${url})...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content }],
      temperature: 0.1
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    throw new Error(`Błąd odpowiedzi z lokalnego AI (HTTP ${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
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

  const useLocalAI = process.env.USE_LOCAL_AI === 'true';
  const hasGeminiKeys = apiKeys.length > 0;

  if (useLocalAI || hasGeminiKeys) {
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

      let base64Data = null;
      let mimeType = 'image/jpeg';

      const imgData = await fetchImageAsBase64(imageUrl);
      if (imgData) {
        base64Data = imgData.base64Data;
        mimeType = imgData.mimeType;
      }

      let responseText = '';

      if (useLocalAI) {
        // Zapytanie do lokalnego AI (Ollama)
        responseText = await callLocalAI(prompt, base64Data, mimeType);
      } else {
        // Zapytanie do chmurowego Gemini API (Rotacja kluczy + 12s timeout)
        const contents = [prompt];
        if (base64Data) {
          contents.push({
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          });
        }

        const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        const modelsToTry = [preferredModel, 'gemini-1.5-flash'];
        let result = null;

        for (const mName of modelsToTry) {
          if (result) break;
          const maxRetries = 3;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const geminiInstance = getNextGeminiClient();
            if (!geminiInstance) throw new Error('Brak skonfigurowanego klucza GEMINI_API_KEY');

            try {
              // ⏱ ŚCISŁY TIMEOUT MODELU: Max 12 sekund na zapytanie Gemini API
              const model = geminiInstance.client.getGenerativeModel({
                model: mName,
                requestOptions: { timeout: 12000 }
              });

              result = await model.generateContent(contents);
              break;
            } catch (apiErr) {
              const isRateLimit = apiErr.message?.includes('429') || apiErr.message?.includes('quota') || apiErr.status === 429;
              
              if (isRateLimit) {
                // Jeśli mamy więcej kluczy w puli, natychmiast przeskocz na kolejny klucz bez czekania!
                if (geminiInstance.totalKeys > 1) {
                  console.warn(`🔑 [ROTACJA KLUCZY] Klucz #${geminiInstance.keyIndex} przeciążony (429). Natychmiastowe przełączenie na kolejny klucz...`);
                  await new Promise(res => setTimeout(res, 500)); // 0.5s przerwa
                } else if (attempt < maxRetries) {
                  const waitSec = attempt * 6; // 6s, 12s
                  console.warn(`⏳ [RATE LIMIT 429] Klucz #${geminiInstance.keyIndex} przeciążony. Czekanie ${waitSec}s... (próba ${attempt}/${maxRetries})`);
                  await new Promise(res => setTimeout(res, waitSec * 1000));
                } else if (mName !== modelsToTry[modelsToTry.length - 1]) {
                  console.warn(`⚠️ [RATE LIMIT 429] Przełączanie z modelu ${mName} na zapasowy ${modelsToTry[1]}...`);
                } else {
                  throw apiErr;
                }
              } else {
                throw apiErr;
              }
            }
          }
        }

        responseText = result && result.response && result.response.text ? result.response.text().trim() : '';
      }

      let cleanJsonStr = responseText.replace(/```json\s*|\s*```/g, '').trim();

      let parsed = {};
      try {
        parsed = JSON.parse(cleanJsonStr);
      } catch (parseErr) {
        console.warn('⚠️ Błąd parsowania JSON z AI. Próba wyciągnięcia danych z surowego tekstu...');
        const jsonBlockMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
        if (jsonBlockMatch) {
          try {
            const sanitized = jsonBlockMatch[0].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            parsed = JSON.parse(sanitized);
          } catch (e2) {}
        }
      }

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
      console.warn('⚠️ Błąd zapytania AI:', err.message);
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
    czy_opis_wiarygodny: false,
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
