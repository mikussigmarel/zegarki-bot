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
 * Przeanalizuje opis oraz zdjęcie zegarka pod kątem kluczowych kryteriów flipowania (100 - 3000 PLN).
 * @param {string} title - Tytuł aukcji
 * @param {string} description - Opis aukcji
 * @param {string} [imageUrl] - URL oryginalnego zdjęcia aukcyjnego
 * @returns {Promise<{marka: string, model: string, nr_referencyjny: string|null, aiEstimatedPrice: number|null, stan: string, full_set: boolean, papiery: boolean, pudelko: boolean, sprawny: boolean, uwagi_ai: string}>}
 */
export async function analyzeWatchOffer(title, description, imageUrl = null) {
  const combinedText = `Tytuł: ${title}\nOpis: ${description || ''}`;

  if (genAI) {
    try {
      const prompt = `Jesteś profesjonalnym rzeczoznawcą i fliperem zegarków (przedział budżetowy 100 PLN - 3000 PLN).

Przeanalizuj poniższą ofertę oraz oryginalne zdjęcie z aukcji. Twój cel to ocenić zegarek pod kątem handlowym.

Zwróć JEDYNIE czysty format JSON (bez markdown \`\`\`json) z polami:
{
  "marka": "Dokładna marka (np. Seiko, Tissot, Omega, Orient, Citizen, Casio)",
  "model": "Nazwa modelu / serii (np. PRX, Automatic Diver, Speedtimer, Bambino)",
  "nr_referencyjny": "Numer referencyjny zegarka (jeśli podany lub rozpoznany ze zdjęcia/opisu, inaczej null)",
  "sugerowana_szacunkowa_wartosc_pln": 1500 (Twoja szacunkowa rynkowa cena w PLN na podstawie marki/modelu/stanu),
  "stan": "Ocena stanu (np. 'Nienoszony', 'Bardzo dobry', 'Używany', 'Do naprawy')",
  "full_set": true/false (true jeśli posiada ZARÓWNO oryginalne pudełko JAK I papiery),
  "papiery": true/false (true jeśli w opisie/zdjęciu są papiery/certyfikat/gwarancja),
  "pudelko": true/false (true jeśli jest oryginalne pudełko),
  "sprawny": true/false (true jeśli zegarek jest sprawny na chodzie / trzyma czas, false jeśli uszkodzony/do serwisu),
  "uwagi_ai": "Krótkie podsumowanie kluczowych zalet lub wad (np. 'Oryginalna bransoleta, czysta tarcza', 'Zarysowanie na szkiełku, sprawny mechanizm')"
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
        } catch (imgErr) {
          console.warn('⚠️ Błąd pobierania zdjęcia do analizy Gemini:', imgErr.message);
        }
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
        uwagi_ai: parsed.uwagi_ai || 'Brak krytycznych zastrzeżeń'
      };
    } catch (err) {
      console.warn('⚠️ Błąd zapytania do Gemini API (użycie wariantu zapasowego):', err.message);
    }
  }

  // Zapobiegawczy fallback
  const isSet = combinedText.toLowerCase().includes('box') || combinedText.toLowerCase().includes('pudełko');
  const hasPapers = combinedText.toLowerCase().includes('paper') || combinedText.toLowerCase().includes('papiery') || combinedText.toLowerCase().includes('gwarancja');
  const isWorking = !combinedText.toLowerCase().includes('uszkodzony') && !combinedText.toLowerCase().includes('do naprawy');

  return {
    marka: parseBrandFallback(title),
    model: parseModelFallback(title),
    nr_referencyjny: extractRefFallback(combinedText),
    aiEstimatedPrice: null,
    stan: description?.toLowerCase().includes('nienoszony') ? 'Nienoszony' : 'Bardzo dobry',
    full_set: isSet && hasPapers,
    papiery: hasPapers,
    pudelko: isSet,
    sprawny: isWorking,
    uwagi_ai: isWorking ? 'Mechanizm sprawny' : 'Może wymagać serwisu'
  };
}

function parseBrandFallback(text) {
  const brands = ['Seiko', 'Omega', 'Tissot', 'Orient', 'Citizen', 'Casio', 'Tag Heuer', 'Longines', 'Breitling', 'Certina', 'Hamilton'];
  for (const b of brands) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(text)) return b;
  }
  return text.split(' ')[0] || 'Nieznana Marka';
}

function parseModelFallback(text) {
  const parts = text.split(' ');
  return parts.slice(1, 4).join(' ') || text;
}

function extractRefFallback(text) {
  const match = text.match(/\b([A-Z0-9]{4,10}-[A-Z0-9]{2,6}|[0-9]{3}\.[0-9]{2}\.[0-9]{3}|[A-Z0-9]{6,12})\b/);
  return match ? match[1] : null;
}
