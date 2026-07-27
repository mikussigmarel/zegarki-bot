import dotenv from 'dotenv';
dotenv.config();

/**
 * Zapytanie do potężnego, darmowego silnika Groq AI (groq.com)
 * Model: llama-3.3-70b-versatile (70 miliardów parametrów, 200ms reakcja, 14,400 zapytań/dzień ZA DARMO!)
 */
async function callGroqAI(prompt) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  const modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`🚀 [GROQ AI] Zapytanie do ultraszybkiego silnika Groq (${modelName})...`);

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
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
      }

      const errTxt = await res.text();
      // Jeśli błąd to 429 (Rate Limit na minutę), odczekaj 60s i ponów
      if (res.status === 429 || errTxt.includes('429') || errTxt.includes('rate_limit') || errTxt.includes('Rate limit')) {
        console.warn(`⚡ [GROQ RATE LIMIT] Wykryto limit minutowy (429). Odczekuję 60 sekund na reset puli...`);
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      console.warn(`⚠️ [GROQ AI] Błąd ${res.status}: ${errTxt.slice(0, 150)}`);
    } catch (e) {
      console.warn('⚠️ Błąd połączenia z Groq AI:', e.message);
    }
  }

  return null;
}

/**
 * Zapasowe zapytanie do OpenRouter API (gdyby Groq nie odpowiedział)
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
        'Authorization': `Bearer ${openRouterKey}`
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
      return data.choices?.[0]?.message?.content || '';
    }
  } catch (e) {}

  return null;
}

/**
 * Ścisły pre-check tekstu przed zapytaniem AI.
 */
export function checkTextIsWorkingStatus(text) {
  if (!text) return { isDefinitelyNotWorking: false };
  const lower = text.toLowerCase();
  const nonWorkingPhrases = [
    'nie działa', 'nie na chodzie', 'niesprawny', 'niesprawna', 'uszkodzony',
    'uszkodzone', 'do naprawy', 'do serwisu', 'wymaga serwisu', 'wymaga naprawy',
    'balans uszkodzony', 'staje', 'spóźnia', 'spoznia', 'do renowacji', 'na części',
    'na czesci', 'do przeglądu', 'do przegladu', 'nietestowany', 'stan nieznany'
  ];

  for (const phrase of nonWorkingPhrases) {
    if (lower.includes(phrase)) {
      return { isDefinitelyNotWorking: true, reason: phrase };
    }
  }

  return { isDefinitelyNotWorking: false };
}

/**
 * Główna funkcja analityczna zasilana przez ultraszybki silnik Groq AI (Llama 3.3 70B Versatile).
 */
export async function analyzeWatchOffer(title, description, imageUrl = null, extraInfo = {}) {
  const countryText = extraInfo.sellerCountry ? `\nKraj wysyłki sprzedawcy ze strony: ${extraInfo.sellerCountry}` : '';
  const shippingText = extraInfo.shippingCost ? `\nRealny koszt dostawy ze strony: ${extraInfo.shippingCost} PLN` : '';
  const combinedText = `Tytuł: ${title}\nOpis: ${description || ''}${countryText}${shippingText}`;

  const prompt = `Jesteś profesjonalnym rzeczoznawcą i fliperem zegarków w Polsce (budżet 100 PLN - 3000 PLN). Twoim zadaniem jest PRECYZYJNA IDENTYFIKACJA MODELU, WERYFIKACJA SPRAWNOŚCI MECHANICZNEJ, OCENA AUTENTYCZNOŚCI I STANU KOMPLETACJI zegarka. NIE WYCENIASZ CENY.

🚨 KRYTYCZNA ZASADA #1 - WERYFIKACJA SPRAWNOŚCI MECHANICZNEJ:
JEŚLI W OPISIE TEKSTOWYM LUB TYTULE podano jakikolwiek detal o braku sprawności lub uszkodzeniu (np. "niesprawny", "do naprawy", "wymaga serwisu", "nie działa", "nie na chodzie", "staje", "spóźnia", "balans uszkodzony", "do renowacji", "na części", "nietestowany", "stan nieznany"), MUSISZ USTAWIC "sprawny": false! W polu "powod_niesprawnosci" podaj dokładny powód.

🛡 KRYTYCZNA ZASADA #2 - WERYFIKACJA AUTENTYCZNOŚCI:
Jeśli oferta sprzedaje replikę, klona, podróbkę (np. "Rolex", "Omega", "Breitling" za rażąco niską cenę lub opis z wyraźną sugestią "replika", "tarcza zamiennik", "homage mod"), MUSISZ USTAWIC "czy_podrobka_lub_replika": true, "prawdopodobna_oryginalnosc": "Podróbka / Replika" oraz "czy_opis_wiarygodny": false!

📦 KRYTYCZNA ZASADA #3 - WERYFIKACJA ZESTAWU (PUDEŁKO I DOKUMENTY):
Jeśli w opisie sprzedawca pisze że sprzedaje z pudełkiem i papierami/dokumentami, ustaw "full_set": true, "pudelko": true, "papiery": true. Jeśli brak, ustaw false.

ZWRÓĆ WYŁĄCZNIE CZYSTY POPRAWNY JSON BEZ ŻADNEGO MARKDOWNU LUB TEKSTU POBOCZNEGO (DOKŁADNIE TEN FORMAT):
{
  "marka": "Seiko",
  "model": "Presage",
  "nr_referencyjny": "SRPD37J1",
  "rok_produkcji_lub_era": "ok. 2020",
  "rodzaj_mechanizmu": "Automatyczny",
  "aiEstimatedPrice": null,
  "stan": "Bardzo dobry",
  "full_set": true,
  "papiery": true,
  "pudelko": true,
  "sprawny": true,
  "powod_niesprawnosci": null,
  "czy_podrobka_lub_replika": false,
  "prawdopodobna_oryginalnosc": "Wysoka",
  "czy_opis_wiarygodny": true,
  "uwagi_ai": "Seiko Presage SRPD37J1 z oryginalnym pudełkiem i papierami."
}

Dane aukcji:
${combinedText}`;

  // 1. Zawsze wykonaj ultraszybkie zapytanie do Groq AI (Llama 3.3 70B - 200ms reakcja, 14 400 requests/day free)
  let responseText = await callGroqAI(prompt);

  // 2. Jeśli Groq z jakiegoś powodu nie odpowiedział -> użyj OpenRouter jako zapasowego silnika
  if (!responseText) {
    responseText = await callOpenRouterAI(prompt);
  }

  if (!responseText) {
    console.error('⚠️ Silnik AI nie wygenerował odpowiedzi.');
    return {
      marka: title.split(' ')[0] || 'Nieznana',
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

  let cleanJsonStr = responseText.replace(/```json\s*|\s*```/g, '').trim();
  let parsed = {};
  try {
    parsed = JSON.parse(cleanJsonStr);
  } catch (parseErr) {
    const jsonBlockMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
    if (jsonBlockMatch) {
      try {
        parsed = JSON.parse(jsonBlockMatch[0]);
      } catch (e2) {}
    }
  }

  return {
    marka: parsed.marka || title.split(' ')[0] || 'Nieznana',
    model: parsed.model || title,
    nr_referencyjny: parsed.nr_referencyjny || null,
    rok_produkcji_lub_era: parsed.rok_produkcji_lub_era || 'Nieokreślony',
    rodzaj_mechanizmu: parsed.rodzaj_mechanizmu || 'Nieokreślony',
    aiEstimatedPrice: null,
    stan: parsed.stan || 'Używany',
    full_set: Boolean(parsed.full_set),
    papiery: Boolean(parsed.papiery),
    pudelko: Boolean(parsed.pudelko),
    sprawny: parsed.sprawny !== undefined ? Boolean(parsed.sprawny) : true,
    powod_niesprawnosci: parsed.powod_niesprawnosci || null,
    czy_podrobka_lub_replika: Boolean(parsed.czy_podrobka_lub_replika),
    prawdopodobna_oryginalnosc: parsed.prawdopodobna_oryginalnosc || 'Nieokreślona',
    czy_opis_wiarygodny: parsed.czy_opis_wiarygodny !== undefined ? Boolean(parsed.czy_opis_wiarygodny) : true,
    uwagi_ai: parsed.uwagi_ai || 'Brak uwag AI.'
  };
}
