const { google } = require('googleapis');

// Настройки из переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Эмоции
const EMOTIONS = {
  'радость': '😊', 'грусть': '😢', 'злость': '😠', 'страх': '😰',
  'отвращение': '🤢', 'интерес': '🤔', 'безразличие': '😐',
  'приятную_усталость': '😌', 'тревогу': '😟', 'вину': '😔'
};

// Глобальное хранилище сессий (для serverless)
const userSessions = new Map();

// Инициализация Google Sheets
let sheetsClient;

async function initGoogleSheets() {
  if (sheetsClient) return sheetsClient;
  
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API initialized');
    return sheetsClient;
  } catch (error) {
    console.error('❌ Google Sheets initialization failed:', error);
    return null;
  }
}

// Функция записи в Google Sheets
async function writeToSheet(emotion, intensity, reason) {
  try {
    const sheets = await initGoogleSheets();
    if (!sheets) return false;
    
    const currentTime = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    
    // Проверяем заголовки (БЕЗ названия листа!)
    const headerCheck = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A1:D1',
    });
    
    if (!headerCheck.data.values || headerCheck.data.values[0][0] !== 'Дата и время') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: 'A1:D1',
        valueInputOption: 'RAW',
        resource: {
          values: [['Дата и время', 'Эмоция', 'Интенсивность', 'Причина']]
        }
      });
    }
    
    // Добавляем запись
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A:D',
      valueInputOption: 'RAW',
      resource: {
        values: [[currentTime, emotion, intensity, reason]]
      }
    });
    
    console.log('✅ Data written to Google Sheets');
    return true;
  } catch (error) {
    console.error('❌ Error writing to Google Sheets:', error);
    return false;
  }
}

// Главная serverless функция
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ message: 'Telegram Bot on Vercel!' });
  }

  try {
    const update = req.body;
    console.log('Update received:', JSON.stringify(update));
    
    // Мгновенно отвечаем Telegram
    res.status(200).json({ status: 'ok' });
    
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
    
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ status: 'error' });
  }
}

// Обработка сообщений
async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text || '';
  
  if (text === '/start') {
    await sendStartMessage(chatId);
  } else {
    const session = userSessions.get(chatId);
    if (session && session.emotion && session.intensity) {
      await saveEmotionEntry(chatId, text);
    } else {
      await sendMessage(chatId, '🤖 Используй кнопку "📝 Внести запись" для начала.');
    }
  }
}

// Обработка callback'ов
async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  await answerCallbackQuery(callbackQuery.id);
  
  if (data === 'add_entry') {
    userSessions.delete(chatId);
    await showEmotionKeyboard(chatId, messageId);
  } else if (data.startsWith('emotion_')) {
    const emotion = data.replace('emotion_', '');
    userSessions.set(chatId, { emotion });
    await showIntensityKeyboard(chatId, messageId, emotion);
  } else if (data.startsWith('intensity_')) {
    const intensity = parseInt(data.replace('intensity_', ''));
    const session = userSessions.get(chatId) || {};
    userSessions.set(chatId, { ...session, intensity });
    await askForReason(chatId, messageId, session.emotion, intensity);
  }
}

// Сохранение эмоции
async function saveEmotionEntry(chatId, reason) {
  const session = userSessions.get(chatId);
  if (!session || !session.emotion || !session.intensity) return;

  const { emotion, intensity } = session;
  const success = await writeToSheet(emotion.replace('_', ' '), intensity, reason);
  
  if (success) {
    const emoji = EMOTIONS[emotion];
    let level, levelEmoji;
    if (intensity <= 3) {
      level = 'слабая'; levelEmoji = '🟢';
    } else if (intensity <= 7) {
      level = 'средняя'; levelEmoji = '🟡';
    } else {
      level = 'сильная'; levelEmoji = '🔴';
    }

    const keyboard = {
      inline_keyboard: [[
        { text: '📝 Добавить еще одну запись', callback_data: 'add_entry' }
      ]]
    };

    const text = `✅ <b>Запись сохранена!</b>

🎭 Эмоция: ${emoji} ${emotion.replace('_', ' ')}
📊 Интенсивность: ${levelEmoji} ${level} (${intensity}/10)
💭 Причина: ${reason}

Отличная работа!`;

    await sendMessage(chatId, text, keyboard);
    userSessions.delete(chatId);
  } else {
    await sendMessage(chatId, '❌ Ошибка сохранения. Попробуй еще раз.');
  }
}

// Остальные функции (без изменений)
async function sendStartMessage(chatId) {
  const keyboard = {
    inline_keyboard: [[
      { text: '📝 Внести запись', callback_data: 'add_entry' }
    ]]
  };
  
  const text = `🌟 <b>Дневник эмоций</b>

Привет! Я помогу тебе отслеживать эмоциональные состояния и лучше понимать себя.

Нажми кнопку ниже, чтобы добавить новую запись 👇`;

  await sendMessage(chatId, text, keyboard);
}

async function showEmotionKeyboard(chatId, messageId) {
  const emotions = Object.keys(EMOTIONS);
  const keyboard = { inline_keyboard: [] };

  for (let i = 0; i < emotions.length; i += 2) {
    const row = [];
    for (let j = 0; j < 2 && i + j < emotions.length; j++) {
      const emotion = emotions[i + j];
      const emoji = EMOTIONS[emotion];
      row.push({
        text: `${emoji} ${emotion.charAt(0).toUpperCase() + emotion.slice(1).replace('_', ' ')}`,
        callback_data: `emotion_${emotion}`
      });
    }
    keyboard.inline_keyboard.push(row);
  }

  const text = `🎭 <b>Что ты чувствуешь прямо сейчас?</b>

Выбери эмоцию:`;

  await editMessage(chatId, messageId, text, keyboard);
}

async function showIntensityKeyboard(chatId, messageId, emotion) {
  const keyboard = {
    inline_keyboard: [
      [{ text: 'Слабая (1-3)', callback_data: 'ignore' }],
      [
        { text: '1️⃣ 1', callback_data: 'intensity_1' },
        { text: '2️⃣ 2', callback_data: 'intensity_2' },
        { text: '3️⃣ 3', callback_data: 'intensity_3' }
      ],
      [{ text: 'Средняя (4-7)', callback_data: 'ignore' }],
      [
        { text: '4️⃣ 4', callback_data: 'intensity_4' },
        { text: '5️⃣ 5', callback_data: 'intensity_5' },
        { text: '6️⃣ 6', callback_data: 'intensity_6' },
        { text: '7️⃣ 7', callback_data: 'intensity_7' }
      ],
      [{ text: 'Сильная (8-10)', callback_data: 'ignore' }],
      [
        { text: '8️⃣ 8', callback_data: 'intensity_8' },
        { text: '9️⃣ 9', callback_data: 'intensity_9' },
        { text: '🔟 10', callback_data: 'intensity_10' }
      ]
    ]
  };

  const emoji = EMOTIONS[emotion];
  const text = `📊 <b>Интенсивность: ${emoji} ${emotion.replace('_', ' ')}</b>

Насколько сильно ты это ощущаешь?`;

  await editMessage(chatId, messageId, text, keyboard);
}

async function askForReason(chatId, messageId, emotion, intensity) {
  let level, levelEmoji;
  if (intensity <= 3) {
    level = 'слабая'; levelEmoji = '🟢';
  } else if (intensity <= 7) {
    level = 'средняя'; levelEmoji = '🟡';
  } else {
    level = 'сильная'; levelEmoji = '🔴';
  }

  const text = `💭 <b>Почему ты это чувствуешь?</b>

Интенсивность: ${levelEmoji} ${level} (${intensity}/10)

Опиши причину:`;

  await editMessage(chatId, messageId, text);
}

async function sendMessage(chatId, text, keyboard = null) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (keyboard) {
    payload.reply_markup = JSON.stringify(keyboard);
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error('Telegram API error:', await response.text());
    }
  } catch (error) {
    console.error('Send message error:', error);
  }
}

async function editMessage(chatId, messageId, text, keyboard = null) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (keyboard) {
    payload.reply_markup = JSON.stringify(keyboard);
  }
  
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Edit message error:', error);
  }
}

async function answerCallbackQuery(callbackQueryId) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
  
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId })
    });
  } catch (error) {
    console.error('Answer callback error:', error);
  }
}
