import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { getDb } from '../config/db.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
let configuredChatId = process.env.TELEGRAM_CHAT_ID;

let bot = null;
const offerCache = new Map();

if (token && token !== '123456789:ABCdef...') {
  try {
    bot = new TelegramBot(token, { polling: true });
    bot.on('polling_error', (err) => {
      // Wyciszenie spamu 409 Conflict przy podwójnych instancjach (Render + lokalny PC)
    });
    console.log('🤖 Telegram Bot (@Zegarki_mikusia_bot) uruchomiony w trybie Polling!');

    bot.onText(/\/start/, async (msg) => {
      configuredChatId = msg.chat.id.toString();
      console.log(`✅ [TELEGRAM] Połączono z czatem użytkownika! CHAT ID: ${configuredChatId}`);
      
      await bot.sendMessage(configuredChatId, `🎉 *Witaj w Bot Zegarki!*

Twój bot powiadomień został pomyślnie połączony z serwerem.
System analizuje oferty w budżecie *100 PLN – 3 000 PLN* i sprawdza:
- 📦 Full Set (pudełko + papiery)
- ⚙️ Sprawność mechanizmu
- 📄 Dokumenty i gwarancję
- 🖼️ Oryginalne zdjęcia z aukcji

Zaczynamy skanowanie na żywo! ⌚🔥`, { parse_mode: 'Markdown' });
    });

    bot.on('message', (msg) => {
      if (msg.chat && msg.chat.id) {
        configuredChatId = msg.chat.id.toString();
      }
    });

    bot.on('callback_query', async (query) => {
      const data = query.data;
      if (data.startsWith('buy_')) {
        const offerId = data.replace('buy_', '');
        const offer = offerCache.get(offerId);

        if (!offer) {
          await bot.answerCallbackQuery(query.id, { text: '❌ Oferta wygasła lub nie znaleziono jej w pamięci!' });
          return;
        }

        try {
          const { prisma, isInMemory, store } = getDb();
          const cenaMlotkowa = offer.currentPrice || 0;
          const kosztWysylki = offer.shippingCost || 30;
          const prowizja = offer.commission || 0;
          const lacznyKoszt = cenaMlotkowa + kosztWysylki + prowizja;

          let createdZegarek;

          if (isInMemory) {
            createdZegarek = {
              id: offerId,
              marka: offer.marka,
              model: offer.model,
              nr_referencyjny: offer.nr_referencyjny,
              stan: offer.stan,
              full_set: offer.full_set,
              zdjecie_url: offer.imageUrl,
              status: 'KUPIONY_W_DRODZE',
              link_oferty: offer.link,
              createdAt: new Date()
            };
            const createdZakup = {
              id: 'zakup_' + offerId,
              zegarekId: offerId,
              data_zakupu: new Date(),
              cena_mlotkowa: cenaMlotkowa,
              prowizja_platformy: prowizja,
              koszt_wysylki: kosztWysylki,
              koszt_serwisu: 0,
              platforma_zakupu: offer.platform || 'Catawiki',
              laczny_koszt: lacznyKoszt
            };
            store.zegarki.push(createdZegarek);
            store.zakupy.push(createdZakup);
          } else {
            createdZegarek = await prisma.zegarek.create({
              data: {
                marka: offer.marka,
                model: offer.model,
                nr_referencyjny: offer.nr_referencyjny,
                stan: offer.stan,
                full_set: offer.full_set,
                zdjecie_url: offer.imageUrl,
                status: 'KUPIONY_W_DRODZE',
                link_oferty: offer.link,
                zakup: {
                  create: {
                    cena_mlotkowa: cenaMlotkowa,
                    prowizja_platformy: prowizja,
                    koszt_wysylki: kosztWysylki,
                    koszt_serwisu: 0,
                    platforma_zakupu: offer.platform || 'Catawiki',
                    laczny_koszt: lacznyKoszt
                  }
                }
              }
            });
          }

          await bot.answerCallbackQuery(query.id, { text: '🟢 Dodano zegarek do bazy (KUPIONY_W_DRODZE)!' });
          
          if (query.message) {
            const updatedCaption = `${query.message.caption || query.message.text}\n\n✅ *ZAKUPIONO! Dodano do bazy (Łączny koszt: ${lacznyKoszt.toFixed(2)} PLN)*`;
            if (query.message.photo) {
              await bot.editMessageCaption(updatedCaption, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
              });
            } else {
              await bot.editMessageText(updatedCaption, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
              });
            }
          }
        } catch (err) {
          console.error('⚠️ Błąd zapisywania zakupu z Telegrama:', err);
          await bot.answerCallbackQuery(query.id, { text: '⚠️ Błąd zapisu do bazy!' });
        }
      }
    });
  } catch (e) {
    console.warn('⚠️ Błąd uruchamiania Telegram Bot API:', e.message);
  }
}

/**
 * Formatowanie minut do czytelnej postaci po polsku (np. "1 d. 13 godz. 20 min" lub "45 min")
 */
function formatTimeLeft(timeLeftMin) {
  if (!timeLeftMin || isNaN(timeLeftMin)) return 'Kilkanaście minut';
  const totalMin = Math.round(timeLeftMin);
  if (totalMin <= 0) return 'Zakończona';
  
  const days = Math.floor(totalMin / (24 * 60));
  const remainingMinAfterDays = totalMin % (24 * 60);
  const hours = Math.floor(remainingMinAfterDays / 60);
  const mins = remainingMinAfterDays % 60;

  if (days > 0) {
    return `${days} d. ${hours} godz. ${mins} min`;
  }
  if (hours > 0) {
    return `${hours} godz. ${mins} min`;
  }
  return `${mins} min`;
}

/**
 * Wysyła szczegółowy alert na Telegram z dokładnymi informacjami.
 * @param {Object} offer - Obiekt oferty
 */
export async function sendWatchAlert(offer) {
  const offerId = offer.id || `offer_${Date.now()}`;
  offerCache.set(offerId, offer);

  const fullSetBadge = offer.full_set ? 'TAK 📦 (Komplet)' : 'NIE ❌';
  const papieryBadge = offer.papiery ? 'TAK 📄' : 'BRAK ❌';
  const pudelkoBadge = offer.pudelko ? 'TAK 📦' : 'BRAK ❌';
  const sprawnyBadge = offer.sprawny ? 'TAK ✅ (Działa)' : 'WYMAGA REPARACJI ⚠️';
  const formattedTimeLeft = formatTimeLeft(offer.timeLeftMin);

  const originText = offer.sellerCountry ? `${offer.sellerCountry} (${offer.platform})` : (offer.platform === 'Catawiki' ? 'Unia Europejska (Catawiki EU)' : 'Polska (Allegro.pl)');
  const commissionVal = offer.commission !== undefined ? offer.commission : (offer.platform === 'Catawiki' ? Math.round(offer.currentPrice * 0.09) + 13 : 0);
  const totalCost = offer.currentPrice + offer.shippingCost + commissionVal;
  const netProfit = (offer.marketAvgPrice - totalCost).toFixed(2);

  const caption = `🔥 *OKAZJA ZEGAREK (Budżet 100 - 3000 PLN)* 🔥

⌚ *${offer.marka} ${offer.model}*
🔢 Ref: \`${offer.nr_referencyjny || 'Rozpoznano po wyglądzie'}\`
✨ Stan: *${offer.stan}* | 🏛 Platforma: *${offer.platform}*

📋 *SZCZEGÓŁY WERYFIKACJI:*
⚙️ Sprawny/Chód: ${sprawnyBadge}
📦 Full Set: ${fullSetBadge}
📄 Dokumenty/Gwarancja: ${papieryBadge}
🏷️ Pudełko: ${pudelkoBadge}
📍 *Dostawa z*: *${originText}*
📝 *Uwagi AI*: _${offer.uwagi_ai || 'Ścisła analiza kombinacji stanu i kompletu'}_

💰 *FINANSE & KOSTZTY DOSTAWY:*
💵 Cena wywoławcza/licytowana: *${offer.currentPrice} PLN*
🚚 Koszt dostawy: *${offer.shippingCost} PLN*
🏛 Opłata kupującego: *${commissionVal} PLN*
🧾 *Łączny koszt na czysto*: *${totalCost} PLN*

📊 Wartość rynkowa (Polska): *${offer.marketAvgPrice} PLN*
🎯 Max Twoja oferta: *${offer.maxOffer} PLN*
📈 *Czysty Zysk Netto*: *+${netProfit} PLN*
⏱ Czas do końca: *${formattedTimeLeft}*

🔗 [Zobacz oryginalną aukcję](${offer.link})`;

  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🟢 KUPIŁEM', callback_data: `buy_${offerId}` }],
        [{ text: '🔗 Przejdź do oferty', url: offer.link }]
      ]
    }
  };

  const targetChatId = configuredChatId || process.env.TELEGRAM_CHAT_ID;

  if (bot && targetChatId) {
    try {
      if (offer.imageUrl) {
        await bot.sendPhoto(targetChatId, offer.imageUrl, {
          caption,
          parse_mode: 'Markdown',
          ...inlineKeyboard
        });
      } else {
        await bot.sendMessage(targetChatId, caption, {
          parse_mode: 'Markdown',
          ...inlineKeyboard
        });
      }
      console.log(`📱 [TELEGRAM] Wysłano alert dla ${offer.marka} ${offer.model} (Czas: ${formattedTimeLeft})`);
      return true;
    } catch (err) {
      console.error('⚠️ Błąd wysyłania wiadomości Telegram:', err.message);
    }
  }

  return true;
}

export function getOfferFromCache(id) {
  return offerCache.get(id);
}
