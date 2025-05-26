const axios = require('axios');

// Настройки
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzB2ZQuWkBNTYwK7aiLwhmWdMfS-XQUQMXBJ2B36PJPzSmb7LdWzHZRF2PKZ_8HNS7M/exec';

const EMOTIONS = {
  'радость': '😊', 'грусть': '😢', 'злость': '😠', 'страх': '😰',
  'отвращение': '🤢', 'интерес': '🤔', 'безразличие': '😐',
  'приятную_усталость': '😌', 'тревогу': '😟', 'вину': '😔'
};

// Временное хранилище
const userSessions = new Map();

// Главная функция
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    console.log('Update:', JSON.stringify(update));

    // Мгновенно возвращаем 200 OK
    res.status(200).json({ status: 'ok' });

    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

  } catch (error) {
    console.error('Error:', error);
    res.status(200).json({ status: 'error' });
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text || '';

  if (text === '/start') {
    await sendStartMessage(chatId);
  } else {
    const session = userSessions.get(chatId);
    if (session && session.emotion && session.intensity && !session.reason) {
      await saveToGoogleSheets(chatId, session.emotion, session.intensity, text);
    } else {
      await sendMessage(chatId, '🤖 Используй кнопку "📝 Внести запись" для начала.');
    }
  }
}

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

async function saveToGoogleSheets(chatId, emotion, intensity, reason) {
  try {
    await axios.post(GOOGLE_SCRIPT_URL, {
      action: 'save_emotion',
      emotion: emotion.replace('_', ' '),
      intensity,
      reason,
      timestamp: new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
    });

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

  } catch (error) {
    console.error('Save error:', error);
    await sendMessage(chatId, '❌ Ошибка сохранения. Попробуй еще раз.');
  }
}

async function sendMessage(chatId, text, keyboard = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  };

  if (keyboard) {
    payload.reply_markup = JSON.stringify(keyboard);
  }

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
}

async function editMessage(chatId, messageId, text, keyboard = null) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML'
  };

  if (keyboard) {
    payload.reply_markup = JSON.stringify(keyboard);
  }

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, payload);
}

async function answerCallbackQuery(callbackQueryId) {
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId
  });
}
