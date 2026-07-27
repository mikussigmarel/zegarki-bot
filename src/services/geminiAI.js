import dotenv from 'dotenv';
dotenv.config();

/**
 * Tekstowy pre-filter niesprawności przed analizą AI
 */
export function checkTextIsWorkingStatus(text) {
  if (!text) return { isDefinitelyNotWorking: false };
  const lower = text.toLowerCase();
  const brokenWords = ['uszkodzony', 'uszkodzona', 'nie działa', 'niedziała', 'na części', 'do naprawy', 'nie chodzi', 'stojący', 'stojacy', 'złom', 'zlom', 'bateria do wymiany', 'brak balansu', 'uszkodzony mechanizm', 'niesprawny', 'niesprawna'];
  const isDefinitelyNotWorking = brokenWords.some(w => lower.includes(w));
  return { isDefinitelyNotWorking };
}

/**
 * Zapytanie do potężnego, darmowego silnika Groq AI (groq.com)
 * Używa rotacji aktywnych darmowych modeli:
 * 1. llama-3.1-8b-instant (20,000 TPM limit, 100ms)
 * 2. llama3-70b-8192
 * 3. llama-3.3-70b-versatile
 * 4. qwen-2.5-coder-32b
 */
async function callGroqAI(prompt) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  const cleanPrompt = prompt.length > 2000 ? prompt.slice(0, 2000) + '...' : prompt;

  const models = [
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    'qwen-2.5-coder-32b'
  ];

  for (const modelName of models) {
    console.log(`🚀 [GROQ AI] Zapytanie do silnika Groq (${modelName})...`);

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: cleanPrompt }],
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text.length > 5) return text;
      }

      const errTxt = await res.text();
      if (res.status === 429 || errTxt.includes('429') || errTxt.includes('rate_limit') || errTxt.includes('Rate limit')) {
        console.warn(`⚡ [GROQ ROTATION] Model ${modelName} osiągnął limit (429). Przełączenie na kolejny wolny model...`);
        continue;
      }

      console.warn(`⚠️ [GROQ AI] Model ${modelName} Błąd ${res.status}: ${errTxt.slice(0, 150)}`);
    } catch (e) {
      console.warn(`⚠️ Błąd połączenia z Groq AI (${modelName}):`, e.message);
    }
  }

  return null;
}

/**
 * Zapasowe zapytanie do OpenRouter API (gdyby żaden model Groq nie odpowiedział)
 */
async function callOpenRouterAI(prompt) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) return null;

  const modelName = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free';
  console.log(`🌐 [OPENROUTER AI FALLBACK] Próba awaryjna przez OpenRouter (${modelName})...`);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': 'https://zegarki-bot.onrender.com',
        'X-Title': 'Watch FLIP Bot'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (text.length > 5) return text;
    } else {
      const errTxt = await res.text();
      console.warn(`⚠️ [OPENROUTER AI] Błąd ${res.status}: ${errTxt.slice(0, 150)}`);
    }
  } catch (e) {
    console.warn('⚠️ Błąd połączenia z OpenRouter AI:', e.message);
  }

  return null;
}

/**
 * Zwraca ujednoliconą analizę AI dla podanej oferty zegarka.
 */
export async function analyzeWatchOffer(rawOffer) {
  const title = rawOffer.title || 'Brak tytułu';
  const description = rawOffer.rawDescription || rawOffer.descriptionText || '';
  const price = rawOffer.currentPrice || 0;

  const prompt = `Jesteś ekspertem rzeczoznawcą i fliperem luksusowych i popularnych zegarków.
Przeanalizuj poniższe ogłoszenie i opisz stan oraz parametry w formacie czystego JSON.

Tytuł ogłoszenia: "${title}"
Cena: ${price} PLN
Opis ogłoszenia:
"${description.slice(0, 1500)}"

Zwróć WYŁĄCZNIE poprawny kod JSON zgodny z poniższym schematem, bez żadnego dodatkowego tekstu ani formatowania markdown:
{
  "marka": "Dokładna nazwa marki np. Seiko, Tissot, Casio, Omega",
  "model": "Dokładny model zegarka",
  "nr_referencyjny": "Numer referencyjny np. SRPD55K1, T063.610.16.037.00 lub null jeśli brak",
  "rok_produkcji_lub_era": "np. 2020+, lata 90., vintage lub nieznany",
  "rodzaj_mechanizmu": "Automatyczny / Kwarcowy / Manualny / Solar / Eco-Drive / nieznany",
  "stan": "Nowy / Bardzo dobry / Doby / Do renowacji / Uszkodzony",
  "full_set": true/false (czy jest komplet pudełko + papiery),
  "papiery": true/false,
  "pudelko": true/false,
  "sprawny": true/false (czy zegarek jest w 100% sprawny chodu i funkcji),
  "powod_niesprawnosci": "powód niesprawności lub null",
  "czy_podrobka_lub_replika": true/false (czy z opisu wynika że to podróbka/replika/homage),
  "prawdopodobna_oryginalnosc": "Wysoka / Średnia / Niska / Podróbka",
  "czy_opis_wiarygodny": true/false,
  "uwagi_ai": "Krótkie podsumowanie stanu i kompletności w 1 zdaniu"
}`;

  let rawResponse = await callGroqAI(prompt);

  if (!rawResponse) {
    rawResponse = await callOpenRouterAI(prompt);
  }

  if (!rawResponse) {
    console.warn('⚠️ Silnik AI nie wygenerował odpowiedzi.');
    return {
      marka: title.split(' ')[0] || 'Zegarek',
      model: title,
      nr_referencyjny: null,
      rok_produkcji_lub_era: 'Nieokreślony',
      rodzaj_mechanizmu: 'Nieokreślony',
      aiEstimatedPrice: null,
      stan: 'Bardzo dobry',
      full_set: false,
      papiery: false,
      pudelko: false,
      sprawny: true,
      powod_niesprawnosci: null,
      czy_podrobka_lub_replika: false,
      prawdopodobna_oryginalnosc: 'Wysoka',
      czy_opis_wiarygodny: true,
      aiError: true,
      uwagi_ai: '⚠️ Tymczasowy błąd odpowiedzi AI.'
    };
  }

  try {
    const cleanJsonText = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJsonText);
    return parsed;
  } catch (parseErr) {
    console.warn('⚠️ Błąd parsowania JSON z odpowiedzi AI:', parseErr.message);
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {}
    }

    return {
      marka: title.split(' ')[0] || 'Zegarek',
      model: title,
      nr_referencyjny: null,
      rok_produkcji_lub_era: 'Nieokreślony',
      rodzaj_mechanizmu: 'Nieokreślony',
      aiEstimatedPrice: null,
      stan: 'Bardzo dobry',
      full_set: false,
      papiery: false,
      pudelko: false,
      sprawny: true,
      powod_niesprawnosci: null,
      czy_podrobka_lub_replika: false,
      prawdopodobna_oryginalnosc: 'Wysoka',
      czy_opis_wiarygodny: true,
      aiError: true,
      uwagi_ai: '⚠️ Błąd formatu odpowiedzi AI.'
    };
  }
}
