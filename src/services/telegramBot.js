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
    console.log('🤖 Telegram Bot (@Zegarki_mikusia_bot) uruchomiony w trybie Polling!');

    // Automatyczne przechwytywanie Chat ID gdy użytkownik napisze /start na Telegramie
    bot.onText(/\/start/, async (msg) => {
      configuredChatId = msg.chat.id.toString();
      console.log(`✅ [TELEGRAM] Połączono z czatem użytkownika! CHAT ID: ${configuredChatId}`);
      
      await bot.sendMessage(configuredChatId, `🎉 *Witaj w Bot Zegarki!*

Twój bot powiadomień został pomyślnie połączony z serwerem.
Gdy tylko system wykryje okazję na Catawiki lub Allegro, wyślę Ci zdjęcie, opis, kalkulację rynkową oraz przycisk *[🟢 KUPIŁEM]*.

Zaczynamy skanowanie! ⌚🔥`, { parse_mode: 'Markdown' });
    });

    // Rejestracja Chat ID dla każdej wiadomości
    bot.on('message', (msg) => {
      if (msg.chat && msg.chat.id) {
        configuredChatId = msg.chat.id.toString();
      }
    });

    // Obsługa kliknięcia interaktywnego przycisku [🟢 KUPIŁEM]
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

          await bot.answerCallbackQuery(query.id, { text: '🟢 Zegarek został dodany do bazy (KUPIONY_W_DRODZE)!' });
          
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
          console.error('⚠️ Błąd podczas zapisywania zakupu z Telegrama:', err);
          await bot.answerCallbackQuery(query.id, { text: '⚠️ Błąd zapisu do bazy!' });
        }
      }
    });
  } catch (e) {
    console.warn('⚠️ Błąd uruchamiania Telegram Bot API:', e.message);
  }
}

/**
 * Wysyła alert okazjonalny na Telegrama.
 * @param {Object} offer - Obiekt oferty
 */
export async function sendWatchAlert(offer) {
  const offerId = offer.id || `offer_${Date.now()}`;
  offerCache.set(offerId, offer);

  const caption = `🔥 *OKAZJA ZEGARKA!* 🔥

⌚ *${offer.marka} ${offer.model}*
🔢 Ref: \`${offer.nr_referencyjny || 'Brak'}\`
✨ Stan: ${offer.stan} | Full Set: ${offer.full_set ? 'TAK 📦' : 'NIE ❌'}
🏛 Platforma: *${offer.platform}*

💵 Aktualna cena: *${offer.currentPrice} PLN*
📊 Średnia rynkowa: *${offer.marketAvgPrice} PLN*
🎯 Max Twoja oferta: *${offer.maxOffer} PLN*
💰 Przewidywany zysk: *+${(offer.marketAvgPrice - offer.currentPrice).toFixed(2)} PLN*
⏱ Czas do końca: *${offer.timeLeftMin} min*

🔗 [Zobacz ofertę na ${offer.platform}](${offer.link})`;

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
      console.log(`📱 [TELEGRAM] Alert wysłany pomyślnie do chatu ID: ${targetChatId}`);
      return true;
    } catch (err) {
      console.error('⚠️ Błąd wysyłania wiadomości Telegram:', err.message);
    }
  }

  console.log('\n=================== 📱 SIMULATED TELEGRAM ALERT ===================');
  console.log(caption);
  console.log(`[PRZYCISK TELEGRAM]: [ 🟢 KUPIŁEM (buy_${offerId}) ]`);
  console.log('===================================================================\n');
  return true;
}

export function getOfferFromCache(id) {
  return offerCache.get(id);
}
