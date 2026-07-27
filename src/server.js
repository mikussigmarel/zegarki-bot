import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

import apiRoutes from './routes/api.js';
import { runScraperJob } from './scrapers/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serwowanie plików statycznych dashboardu
app.use(express.static(path.join(__dirname, 'views')));

// Podpięcie podścieżki API
app.use('/api', apiRoutes);

// Strona główna - Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Rejestracja automatycznej pętli w tle (Cron Job co X minut)
const intervalMinutes = parseInt(process.env.SCRAPE_INTERVAL_MINUTES) || 10;
const cronExpression = `*/${intervalMinutes} * * * *`;

cron.schedule(cronExpression, () => {
  console.log(`⏰ Cron Job uruchamia cykliczne skanowanie (co ${intervalMinutes} min)...`);
  runScraperJob().catch(err => console.error('Błąd cron joba:', err));
});

// Start serwera Express
app.listen(PORT, async () => {
  console.log(`
============================================================
🚀 WATCH RESELL BOT SERWER URUCHOMIONY!
📍 Dashboard: http://localhost:${PORT}
⚙️ Interwał Cron: co ${intervalMinutes} minut
============================================================
  `);

  // Pierwszy skan przy starcie serwera
  console.log('🏁 Pierwsze skanowanie aukcji podczas startu...');
  setTimeout(() => {
    runScraperJob().catch(err => console.error('Błąd wstępnego skanowania:', err));
  }, 2000);
});
