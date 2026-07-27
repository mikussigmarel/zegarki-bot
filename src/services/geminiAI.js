import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey && apiKey !== 'AIzaSy...') {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
  } catch (e) {
    console.warn('⚠️ Gemini AI client initialization error:', e.message);
  }
}

/**
 * Analizuje opis oraz zdjęcie zegarka za pomocą Google Gemini 1.5 Flash.
 * @param {string} title - Tytuł aukcji
 * @param {string} description - Opis aukcji
 * @param {string} [imageUrl] - URL zdjęcia zegarka
 * @returns {Promise<{marka: string, model: string, nr_referencyjny: string|null, stan: string, full_set: boolean}>}
 */
export async function analyzeWatchOffer(title, description, imageUrl = null) {
  const combinedText = `Tytuł: ${title}\nOpis: ${description || ''}`;

  if (genAI) {
    try {
      const prompt = `Jesteś ekspertem ds. zegarków i luksusowej biżuterii. Przeanalizuj poniższy wpis aukcyjny i wyciągnij szczegółowe dane techniczne.
      
Twój jedyny cel to zwrócić czysty format JSON (bez markdown, bez komentarzy) z następującymi polami:
{
  "marka": "Nazwa marki, np. Seiko, Omega, Rolex, Tissot",
  "model": "Model zegarka, np. Speedmaster, Submariner, PRX",
  "nr_referencyjny": "Numer referencyjny zegarka jeśli występuje, lub null",
  "stan": "Opis stanu, np. 'Bardzo dobry', 'Nienoszony', 'Średni', 'Do renowacji'",
  "full_set": true/false (true jeśli zawiera pudełko i papiery/dokumenty)
}

Dane do analizy:
${combinedText}`;

      const contents = [prompt];

      // Jeśli przekazano URL zdjęcia, pobieramy je i przekazujemy jako inlineData
      if (imageUrl) {
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

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(contents);
      const responseText = result.response.text() ? result.response.text().trim() : '';
      const cleanJsonStr = responseText.replace(/```json\s*|\s*```/g, '').trim();
      const parsed = JSON.parse(cleanJsonStr);

      return {
        marka: parsed.marka || parseBrandFallback(title),
        model: parsed.model || title,
        nr_referencyjny: parsed.nr_referencyjny || extractRefFallback(combinedText),
        stan: parsed.stan || 'Bardzo dobry',
        full_set: Boolean(parsed.full_set)
      };
    } catch (err) {
      console.warn('⚠️ Błąd zapytania do Gemini API (użycie wariantu zapasowego):', err.message);
    }
  }

  // Heurystyczny wyciągacz wariantu zapasowego (fallback parsing)
  return {
    marka: parseBrandFallback(title),
    model: parseModelFallback(title),
    nr_referencyjny: extractRefFallback(combinedText),
    stan: description?.toLowerCase().includes('nienoszony') ? 'Nienoszony' : 'Bardzo dobry',
    full_set: combinedText.toLowerCase().includes('box') || combinedText.toLowerCase().includes('pudełko') || combinedText.toLowerCase().includes('papers')
  };
}

function parseBrandFallback(text) {
  const brands = ['Seiko', 'Omega', 'Rolex', 'Tissot', 'Tag Heuer', 'Breitling', 'Longines', 'Casio', 'Citizen', 'Tudor', 'Hamilton', 'Certina'];
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
