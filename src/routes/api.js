import express from 'express';
import { getDb } from '../config/db.js';
import { runScraperJob } from '../scrapers/index.js';

const router = express.Router();

// GET /api/zegarki - Lista wszystkich zegarków w magazynie
router.get('/zegarki', async (req, res) => {
  try {
    const { status } = req.query;
    const { prisma, isInMemory, store } = getDb();

    if (isInMemory) {
      let filtered = store.zegarki;
      if (status && status !== 'all') {
        filtered = filtered.filter(z => z.status === status);
      }
      // Połącz dane zakupu i sprzedaży
      const result = filtered.map(z => {
        const zakup = store.zakupy.find(zk => zk.zegarekId === z.id);
        const sprzedaz = store.sprzedaze.find(s => s.zegarekId === z.id);
        return { ...z, zakup, sprzedaz };
      });
      return res.json(result);
    }

    const where = (status && status !== 'all') ? { status } : {};
    const zegarki = await prisma.zegarek.findMany({
      where,
      include: { zakup: true, sprzedaz: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(zegarki);
  } catch (err) {
    res.status(500).json({ error: 'Błąd pobierania listy zegarków: ' + err.message });
  }
});

// POST /api/zegarki - Ręczne dodanie zegarka do bazy
router.post('/zegarki', async (req, res) => {
  try {
    const { marka, model, nr_referencyjny, stan, full_set, zdjecie_url, link_oferty, cena_mlotkowa, koszt_wysylki, prowizja_platformy, platforma_zakupu } = req.body;
    const { prisma, isInMemory, store } = getDb();

    const mlotkowa = parseFloat(cena_mlotkowa) || 0;
    const wysylka = parseFloat(koszt_wysylki) || 0;
    const prowizja = parseFloat(prowizja_platformy) || 0;
    const lacznyKoszt = mlotkowa + wysylka + prowizja;
    const id = `z_${Date.now()}`;

    if (isInMemory) {
      const zegarek = {
        id,
        marka: marka || 'Nieokreślona',
        model: model || 'Model',
        nr_referencyjny: nr_referencyjny || null,
        stan: stan || 'Bardzo dobry',
        full_set: Boolean(full_set),
        zdjecie_url: zdjecie_url || null,
        status: 'KUPIONY_W_DRODZE',
        link_oferty: link_oferty || null,
        createdAt: new Date()
      };
      const zakup = {
        id: `zk_${id}`,
        zegarekId: id,
        data_zakupu: new Date(),
        cena_mlotkowa: mlotkowa,
        prowizja_platformy: prowizja,
        koszt_wysylki: wysylka,
        koszt_serwisu: 0,
        platforma_zakupu: platforma_zakupu || 'Catawiki',
        laczny_koszt: lacznyKoszt
      };
      store.zegarki.push(zegarek);
      store.zakupy.push(zakup);
      return res.status(201).json({ ...zegarek, zakup });
    }

    const zegarek = await prisma.zegarek.create({
      data: {
        marka: marka || 'Nieokreślona',
        model: model || 'Model',
        nr_referencyjny,
        stan,
        full_set: Boolean(full_set),
        zdjecie_url,
        link_oferty,
        status: 'KUPIONY_W_DRODZE',
        zakup: {
          create: {
            cena_mlotkowa: mlotkowa,
            prowizja_platformy: prowizja,
            koszt_wysylki: wysylka,
            koszt_serwisu: 0,
            platforma_zakupu: platforma_zakupu || 'Catawiki',
            laczny_koszt: lacznyKoszt
          }
        }
      },
      include: { zakup: true }
    });

    res.status(201).json(zegarek);
  } catch (err) {
    res.status(500).json({ error: 'Błąd dodawania zegarka: ' + err.message });
  }
});

// PUT /api/zegarki/:id/status - Zmiana statusu zegarka
router.put('/zegarki/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // KUPIONY_W_DRODZE, NA_STANIE, SPRZEDANY
    const { prisma, isInMemory, store } = getDb();

    if (isInMemory) {
      const z = store.zegarki.find(item => item.id === id);
      if (!z) return res.status(404).json({ error: 'Nie znaleziono zegarka' });
      z.status = status;
      return res.json(z);
    }

    const updated = await prisma.zegarek.update({
      where: { id },
      data: { status },
      include: { zakup: true, sprzedaz: true }
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Błąd aktualizacji statusu: ' + err.message });
  }
});

// POST /api/zegarki/:id/sprzedaz - Rejestracja sprzedaży zegarka
router.post('/zegarki/:id/sprzedaz', async (req, res) => {
  try {
    const { id } = req.params;
    const { cena_sprzedazy, prowizja_sprzedazy, koszt_wysylki_out, platforma_sprzedazy } = req.body;
    const { prisma, isInMemory, store } = getDb();

    const cena = parseFloat(cena_sprzedazy) || 0;
    const prowizja = parseFloat(prowizja_sprzedazy) || 0;
    const wysylka = parseFloat(koszt_wysylki_out) || 0;
    const przychodNetto = cena - prowizja - wysylka;

    if (isInMemory) {
      const z = store.zegarki.find(item => item.id === id);
      if (!z) return res.status(404).json({ error: 'Nie znaleziono zegarka' });
      z.status = 'SPRZEDANY';

      const existingSprzedazIdx = store.sprzedaze.findIndex(s => s.zegarekId === id);
      const sprzedazRecord = {
        id: `s_${id}`,
        zegarekId: id,
        data_sprzedazy: new Date(),
        cena_sprzedazy: cena,
        prowizja_sprzedazy: prowizja,
        koszt_wysylki_out: wysylka,
        platforma_sprzedazy: platforma_sprzedazy || 'OLX',
        przychod_netto: przychodNetto
      };

      if (existingSprzedazIdx >= 0) {
        store.sprzedaze[existingSprzedazIdx] = sprzedazRecord;
      } else {
        store.sprzedaze.push(sprzedazRecord);
      }

      return res.json({ ...z, sprzedaz: sprzedazRecord });
    }

    const updated = await prisma.zegarek.update({
      where: { id },
      data: {
        status: 'SPRZEDANY',
        sprzedaz: {
          upsert: {
            create: {
              cena_sprzedazy: cena,
              prowizja_sprzedazy: prowizja,
              koszt_wysylki_out: wysylka,
              platforma_sprzedazy: platforma_sprzedazy || 'OLX',
              przychod_netto: przychodNetto
            },
            update: {
              cena_sprzedazy: cena,
              prowizja_sprzedazy: prowizja,
              koszt_wysylki_out: wysylka,
              platforma_sprzedazy: platforma_sprzedazy || 'OLX',
              przychod_netto: przychodNetto
            }
          }
        }
      },
      include: { zakup: true, sprzedaz: true }
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Błąd rejestracji sprzedaży: ' + err.message });
  }
});

// DELETE /api/zegarki/:id - Usunięcie zegarka z magazynu
router.delete('/zegarki/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { prisma, isInMemory, store } = getDb();

    if (isInMemory) {
      store.zegarki = store.zegarki.filter(item => item.id !== id);
      store.zakupy = store.zakupy.filter(item => item.zegarekId !== id);
      store.sprzedaze = store.sprzedaze.filter(item => item.zegarekId !== id);
      return res.json({ success: true, message: 'Usunięto rekord' });
    }

    await prisma.zegarek.delete({ where: { id } });
    res.json({ success: true, message: 'Usunięto rekord' });
  } catch (err) {
    res.status(500).json({ error: 'Błąd usuwania zegarka: ' + err.message });
  }
});

// GET /api/stats - Pobiera statystyki kapitału i zysku
router.get('/stats', async (req, res) => {
  try {
    const { prisma, isInMemory, store } = getDb();

    let zegarkiList = [];
    if (isInMemory) {
      zegarkiList = store.zegarki.map(z => ({
        ...z,
        zakup: store.zakupy.find(zk => zk.zegarekId === z.id),
        sprzedaz: store.sprzedaze.find(s => s.zegarekId === z.id)
      }));
    } else {
      zegarkiList = await prisma.zegarek.findMany({
        include: { zakup: true, sprzedaz: true }
      });
    }

    let zamrozonyKapital = 0;
    let wDrodzeCount = 0;
    let naStanieCount = 0;
    let sprzedanyCount = 0;
    let lacznyZyskNetto = 0;

    for (const z of zegarkiList) {
      const koszt = z.zakup ? z.zakup.laczny_koszt : 0;
      if (z.status === 'KUPIONY_W_DRODZE') {
        wDrodzeCount++;
        zamrozonyKapital += koszt;
      } else if (z.status === 'NA_STANIE') {
        naStanieCount++;
        zamrozonyKapital += koszt;
      } else if (z.status === 'SPRZEDANY') {
        sprzedanyCount++;
        if (z.sprzedaz && z.zakup) {
          const zysk = z.sprzedaz.przychod_netto - z.zakup.laczny_koszt;
          lacznyZyskNetto += zysk;
        }
      }
    }

    res.json({
      zamrozonyKapital: Math.round(zamrozonyKapital * 100) / 100,
      wDrodzeCount,
      naStanieCount,
      sprzedanyCount,
      lacznyZyskNetto: Math.round(lacznyZyskNetto * 100) / 100,
      lacznieZegarkow: zegarkiList.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Błąd obliczania statystyk: ' + err.message });
  }
});

// POST /api/scrape/trigger - Wywołanie skanowania aukcji na żądanie
router.post('/scrape/trigger', async (req, res) => {
  try {
    // Wywołanie pętli w tle
    runScraperJob().catch(err => console.error('Błąd tle scrapingu:', err));
    res.json({ success: true, message: 'Skanowanie aukcji uruchomione w tle!' });
  } catch (err) {
    res.status(500).json({ error: 'Błąd uruchamiania skanowania: ' + err.message });
  }
});

export default router;
