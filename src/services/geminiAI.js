import dotenv from 'dotenv';
dotenv.config();

/**
 * Zapytanie do darmowego silnika NVIDIA Vision AI przez OpenRouter (nvidia/nemotron-nano-12b-v2-vl:free)
 */
async function callNvidiaVisionAI(prompt, base64Data = null, mimeType = 'image/jpeg') {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    throw new Error('Brak skonfigurowanego klucza OPENROUTER_API_KEY w zmiennych środowiskowych!');
  }

  const fallbackModels = [
    process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free',
    'mistralai/mistral-small-24b-instruct-2501:free',
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen-2.5-72b-instruct:free'
  ];

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

  for (const modelName of fallbackModels) {
    console.log(`🚀 [NVIDIA/OPENROUTER AI] Analizuję ofertę zegarka silnikiem ${modelName}...`);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openRouterKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content }],
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(20000)
      });

      if (res.ok) {
        const data = await res.json();
        const responseContent = data.choices?.[0]?.message?.content || '';
        if (responseContent.length > 5) {
          return responseContent;
        }
      }

      const errText = await res.text();
      console.warn(`⚠️ [OPENROUTER AI] Model ${modelName} zwrócił status ${res.status}: ${errText.slice(0, 150)}`);
    } catch (e) {
      console.warn(`⚠️ [OPENROUTER AI] Model ${modelName} błąd: ${e.message}`);
    }
  }

  // Ostateczna próba w trybie czysto tekstowym w przypadku odrzucenia zdjęcia
  if (base64Data) {
    console.warn(`⚠️ [NVIDIA AI] Ponawianie analizy w trybie czysto tekstowym...`);
    try {
      const textRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openRouterKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (textRes.ok) {
        const textData = await textRes.json();
        return textData.choices?.[0]?.message?.content || '';
      }
    } catch (e) {}
  }

  throw new Error('NVIDIA AI nie mogło przetworzyć tej oferty.');
}

/**
 * Solidne pobieranie obrazu z 2 próbami i nagłówkami przeglądarki.
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
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = res.headers.get('content-type') || 'image/jpeg';
        return { base64Data, mimeType };
      }
    } catch (e) {
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

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
 * Przeanalizuje opis oraz zdjęcie zegarka pod kątem ścisłej wyceny rynkowej.
 */
export async function analyzeWatchOffer(title, description, imageUrl = null, extraInfo = {}) {
  const countryText = extraInfo.sellerCountry ? `\nKraj wysyłki sprzedawcy ze strony: ${extraInfo.sellerCountry}` : '';
  const shippingText = extraInfo.shippingCost ? `\nRealny koszt dostawy ze strony: ${extraInfo.shippingCost} PLN` : '';
  const combinedText = `Tytuł: ${title}\nOpis: ${description || ''}${countryText}${shippingText}`;

  try {
    const prompt = `Jesteś bezwzględnym, doświadczonym rzeczoznawcą i fliperem zegarków w Polsce (budżet 100 PLN - 3000 PLN). Twoim JEDYNYM zadaniem jest PRECYZYJNA IDENTYFIKACJA MODELU, WERYFIKACJA SPRAWNOŚCI MECHANICZNEJ, OCENA AUTENTYCZNOŚCI I STANU KOMPLETACJI zegarka. NIE WYCENIASZ CENY – cenę rynkową wyliczy osobny moduł z prawdziwych ofert na portalach.

🚨 KRYTYCZNA ZASADA #1 - BEZWZGLĘDNA WERYFIKACJA OPISU TEKSTOWEGO I SPRAWNOŚCI MECHANICZNEJ:
1. PRZECZYTAJ OPIS TEKSTOWY SŁOWO PO SŁOWIE: Nawet jeśli zdjęcie przedstawia piękny, czysty zegarek, JEŚLI W OPISIE TEKSTOWYM LUB TYTULE podano jakikolwiek detal o braku sprawności, uszkodzeniu lub potrzebie ingerencji zegarmistrza (np. "niesprawny", "wymaga wizyty u zegarmistrza", "wymaga serwisu", "do przeglądu", "nie działa", "nie na chodzie", "staje", "spóźnia", "balans uszkodzony", "do renowacji", "na części", "nietestowany", "stan nieznany", "do naprawy"), MUSISZ BEZWZGLĘDNIE USTAWIC "sprawny": false!
2. PODAJ POWÓD NIESPRAWNOŚCI: W polu "powod_niesprawnosci" wpisz dokładny powód podany przez sprzedawcę.

🛡 KRYTYCZNA ZASADA #2 - BEZWZGLĘDNA WERYFIKACJA AUTENTYCZNOŚCI:
1. Weryfikacja podróbek / replik: Sprawdź dokładnie model i opisy. Jeśli oferta sprzedaje replikę, klona, podróbkę (np. "Rolex", "Omega", "Breitling", "Patek", "Tissot", "Seiko Mod" za rażąco niską cenę lub opis z wyraźną sugestią "replika", "tarcza zamiennik", "homage mod"), MUSISZ USTAWIC "czy_podrobka_lub_replika": true, "prawdopodobna_oryginalnosc": "Podróbka / Replika" oraz "czy_opis_wiarygodny": false!
2. Marki Seiko Mods / Homage: Oznaczaj jako modyfikowane / nieoryginalne składaki, jeśli tarcza/koperta nie są fabryczne.

📦 KRYTYCZNA ZASADA #3 - WERYFIKACJA ZESTAWU (PUDEŁKO I DOKUMENTY):
1. Przeczytaj treść opisu pod kątem słów kluczowych: "pudełko", "puszka", "box", "dokumenty", "papiery", "gwarancja", "paragon", "komplet", "full set".
2. Jeśli w opisie sprzedawca pisze że sprzedaje z pudełkiem i papierami/dokumentami, ustaw "full_set": true, "pudelko": true, "papiery": true.
3. Jeśli brak pudełka lub papierów, ustaw odpowiednio false.

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

    const responseText = await callNvidiaVisionAI(prompt, base64Data, mimeType);

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
  } catch (err) {
    console.error('⚠️ Błąd zapytania NVIDIA AI:', err.message);
    return {
      marka: title.split(' ')[0] || 'Nieznana',
      model: title,
      nr_referencyjny: null,
      rok_produkcji_lub_era: 'Nieokreślony',
      rodzaj_mechanizmu: 'Nieokreślony',
      aiEstimatedPrice: null,
      stan: 'Bardzo dobry (Błąd AI)',
      full_set: false,
      papiery: false,
      pudelko: false,
      sprawny: true,
      powod_niesprawnosci: null,
      czy_podrobka_lub_replika: false,
      prawdopodobna_oryginalnosc: 'Wysoka (Błąd AI)',
      czy_opis_wiarygodny: true,
      aiError: true,
      uwagi_ai: `⚠️ Błąd połączenia z NVIDIA AI: ${err.message}`
    };
  }
}
