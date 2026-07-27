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
  const combinedText = `Tytuł: ${title}\nOpis: ${description || ''}${countryText}${shippingText}`;
  // 🛡 PRE-FILTER ANTY-PODRÓBKA (Reguła słów kluczowych)
  const lowerText = combinedText.toLowerCase();
  const fakeKeywords = ['replika', 'replica', 'podróbka', 'podrobka', 'podróba', 'klon', 'fake', 'reprodukt', 'hommage fake'];
  const hasFakeKeyword = fakeKeywords.some(kw => lowerText.includes(kw));

  // Anomalia cenowa luksusowych marek (Rolex/Omega za 200 zł = 100% podróba)
  const isLuxuryFakeAnomaly = (lowerText.includes('rolex') || lowerText.includes('breitling') || lowerText.includes('tudor')) && !lowerText.includes('homage') && (title.includes('200') || title.includes('300') || title.includes('150'));

  if (hasFakeKeyword || isLuxuryFakeAnomaly) {
    console.warn(`🚨 [ANTI-FAKE PRE-FILTER] Wykryto ewidentną podróbkę/replikę w ofercie: "${title}"`);
    return {
      marka: parseBrandFallback(title),
      model: title,
      nr_referencyjny: null,
      aiEstimatedPrice: 0,
      stan: 'Podróbka / Replika',
      full_set: false,
      papiery: false,
      pudelko: false,
      sprawny: false,
      czy_podrobka_lub_replika: true,
      prawdopodobna_oryginalnosc: 'Podróbka / Replika',
      czy_opis_wiarygodny: false,
      uwagi_ai: '🚨 Odrzucono: Wykryto ewidentną replikę/podróbkę zegarka!'
    };
  }

  if (genAI) {
    try {
      const prompt = `Jesteś bezwzględnym, doświadczonym rzeczoznawcą i fliperem zegarków w Polsce (budżet 100 PLN - 3000 PLN). Twój cel to podanie SUCHEJ, REALNEJ WARTOŚCI RYNKOWEJ W POLSCE (ze szczególnym uwzględnieniem realiów POLSKIEGO RYNKU WTÓRNEGO: Allegro, Chrono24 Polska, OLX), aby użytkownik NIE PRZEPŁACIŁ ani grosza i mógł zyskowo odprzedać zegarek w Polsce.

🛡 KRYTYCZNA ZASADA BEZPIECZEŃSTWA (BEZWZGLĘDNA WERYFIKACJA AUTENTYCZNOŚCI I JAKOŚCI OPISU):
1. ANTY-PODRÓBKA: Jeśli widzisz markę Rolex, Omega, Breitling, Tudor itp. oferowaną za śmieszne kwoty (np. 150-500 PLN) lub zegarek wyglądający na tanią replikę z Chin, MUSISZ oznaczyć "czy_podrobka_lub_replika": true i "prawdopodobna_oryginalnosc": "Podróbka / Replika".
2. JAKOŚĆ OPISU: Jeśli opis to zaledwie jedno słowo/zdanie (np. "sprzedam zegarek"), brak szczegółów lub opis wydaje się podejrzany, oznacz "czy_opis_wiarygodny": false.

ZASADA BEZWZGLĘDNEJ WYCENY POD POLSKI RYNEK (STAN + KOMPLETACJA):
Wyceniaj zegarek biorąc pod uwagę specyfikę i popyt na POLSKIM RYNKU (PLN). Zegarki Seiko, Tissot, Orient, Casio, Citizen czy vintage Omegi mają na polskim rynku sprecyzowane realia cenowe.
Musisz połączyć stan wizualny/mechaniczny Z KOMPLETEM w jedną spójną polską cenę rynkową.

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

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
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
        uwagi_ai: parsed.uwagi_ai || 'Ścisła analiza kombinacji stanu i kompletu'
      };
    } catch (err) {
      console.warn('⚠️ Błąd zapytania Gemini AI:', err.message);
    }
  }

  const isSet = combinedText.toLowerCase().includes('box') || combinedText.toLowerCase().includes('pudełko');
  const hasPapers = combinedText.toLowerCase().includes('paper') || combinedText.toLowerCase().includes('papiery') || combinedText.toLowerCase().includes('certyfikat');
  const isWorking = !combinedText.toLowerCase().includes('uszkodzony') && !combinedText.toLowerCase().includes('niesprawny');

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
    uwagi_ai: isWorking ? 'Mechanizm sprawny' : 'Zegarek niesprawny'
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
