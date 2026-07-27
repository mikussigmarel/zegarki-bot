# ⌚ WatchResell Bot - System Monitorowania i Zakupu Zegarków

Bot i dashboard stworzony w technologii Node.js, Express.js, Prisma ORM (Supabase PostgreSQL), Telegram Bot API oraz Google Gemini 1.5 Flash API do automatycznego wyłapywania okazji zegarków z aukcji (Catawiki, Allegro).

---

## 🌟 Główne Funkcjonalności

1. **Automatyczny Scraper Aukcji**: Pobiera dane o aktywnych aukcjach z Catawiki (za pomocą Playwright w trybie headless) oraz Allegro.
2. **Sztuczna Inteligencja Gemini 1.5 Flash**: Ekstrahuje z opisów i zdjęć markę, model, numer referencyjny, stan zegarka oraz informację o pełnym zestawie (box & papers).
3. **Wycena Rynkowa i Matematyka Decyzyjna**:
   - Wylicza średnią rynkową z portali Chrono24, Allegro i eBay dla wyciągniętego numeru referencyjnego.
   - Odlicza marżę i koszty: `Max_Oferta = (Średnia Rynkowa * 0.7) - Koszty_Wysyłki - Prowizje`.
   - Sprawdza warunki okazyjnego zakupu (`Cena < Max_Oferta` oraz `Czas <= 30 min`).
4. **Powiadomienia Telegram z Interaktywnym Przyciskiem `[🟢 KUPIŁEM]`**:
   - Wysyła zdjęcie i komplet danych na Telegram.
   - Po wygraniu aukcji i kliknięciu przycisku w aplikacji Telegram, bot automatycznie dodaje zegarek do bazy danych (status `KUPIONY_W_DRODZE`) i aktualizuje koszt zakupu.
5. **Prestiżowy Dashboard Webowy**:
   - Podgląd zamrożonego kapitału, zegarków w drodze, na stanie oraz łącznego zysku netto.
   - Tabela zarządza zmianą statusu (Odbierz -> Sprzedano) i kalkuluje czysty zysk po odliczeniu prowizji i wysyłek.

---

## 📁 Struktura Projektu

```
watch-resell-bot/
├── prisma/
│   └── schema.prisma        # Schemat bazy danych Supabase (Zegarek, Zakup, Sprzedaz, Status)
├── src/
│   ├── config/
│   │   └── db.js            # Klient Prisma z zapasowym trybem in-memory
│   ├── scrapers/
│   │   ├── catawiki.js      # Scraper Playwright dla Catawiki
│   │   ├── allegro.js       # Scraper / API Allegro
│   │   ├── priceEvaluator.js# Moduł wyceny i kalkulator marży
│   │   └── index.js         # Główny coordinator joba skanującego
│   ├── services/
│   │   ├── geminiAI.js      # Integracja z Google Gemini 1.5 Flash Multimodal
│   │   └── telegramBot.js   # Bot Telegrama i obsługa przycisku [🟢 KUPIŁEM]
│   ├── views/
│   │   └── dashboard.html   # Ciemny dashboard (glassmorphism UI)
│   ├── routes/
│   │   └── api.js           # API REST do zarządzania magazynem i statystykami
│   └── server.js            # Główny serwer Express + Cron Job
├── .env.example
├── package.json
└── README.md
```

---

## 🚀 Uruchomienie Lokalne

1. Zainstaluj zależności:
   ```bash
   npm install
   ```
2. Skonfiguruj zmienne w `.env`:
   - `GEMINI_API_KEY` (z Google AI Studio)
   - `TELEGRAM_BOT_TOKEN` oraz `TELEGRAM_CHAT_ID` (z @BotFather)
   - `DATABASE_URL` (z Supabase PostgreSQL)
3. Uruchom serwer w trybie deweloperskim:
   ```bash
   npm run dev
   ```
4. Otwórz w przeglądarce: [http://localhost:3000](http://localhost:3000)

---

## ☁️ Darmowy Hosting na Render.com

1. Utwórz nowe repozytorium GitHub i wypchnij kod.
2. Na [Render.com](https://render.com) utwórz nowy **Web Service**.
3. Ustaw:
   - **Environment**: Node
   - **Build Command**: `npm install && npx prisma generate`
   - **Start Command**: `node src/server.js`
4. Dodaj zmienne środowiskowe w zakładce **Environment**.
