// Эмоции с эмодзи
const EMOTIONS = {
  'радость': '😊', 'грусть': '😢', 'раздражение': '😠', 'страх': '😰',
  'отвращение': '🤢', 'интерес': '🤔', 'безразличие': '😐',
  'приятную_усталость': '😌', 'тревогу': '😟', 'вину': '😔'
};

// Временное хранилище сессий
const userSessions = new Map();

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Telegram Bot on Vercel is working!',
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'POST') {
      const update = req.body;
      console.log('Update received:', JSON.stringify(update));
      
      // МГНОВЕННО возвращаем 200 OK
      res.status(200).json({ status: 'ok' });
      
      // Обрабатываем сообщения НАПРЯМУЮ в Vercel
      if (update.message) {
        await handleMessage(update.message);
      } else if (update.callback_query) {
        await handleCallback(update.callback_query);
      }
      
      return;
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Function error:', error);
    return res.status(200).json({ status: 'error' });
  }
}

// Обработка текстовых сообщений
async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text || '';

  console.log(`=== HANDLING MESSAGE ===`);
  console.log(`Chat ID: ${chatId}, Text: "${text}"`);

  if (text === '/start') {
    console.log('Processing /start command...');
    await sendStartMessage(chatId);
  } else {
    // Проверяем, ждем ли причину эмоции
    const session = userSessions.get(chatId);
    if (session && session.emotion && session.intensity && !session.reason) {
      await saveEmotionEntry(chatId, session.emotion, session.intensity, text);
    } else {
      await sendMessage(chatId, '🤖 Используй кнопку "📝 Внести запись" для начала.');
    }
  }
}

// Обработка нажатий кнопок
async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  console.log(`=== HANDLING CALLBACK ===`);
  console.log(`Chat ID: ${chatId}, Data: ${data}`);

  // Подтверждаем callback
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

// Отправка стартового сообщения
async function sendStartMessage(chatId) {
  console.log(`=== SENDING START MESSAGE ===`);
  
  const keyboard = {
    inline_keyboard: [[
      { text: '📝 Внести запись', callback_data: 'add_entry' }
    ]]
  };

  const text = `🌟 <b>Дневник эмоций</b>

Привет! Я помогу тебе отслеживать эмоциональные состояния и лучше понимать себя.

Регулярное ведение дневника эмоций поможет:
• Выявить эмоциональные паттерны
• Понять триггеры различных состояний  
• Развить эмоциональный интеллект
• Улучшить самосознание

Нажми кнопку ниже, чтобы добавить новую запись 👇`;

  await sendMessage(chatId, text, keyboard);
}

// Показать выбор эмоций
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

// Показать выбор интенсивности
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

// Запросить причину
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

// Сохранение через Google Apps Script
async function saveEmotionEntry(chatId, emotion, intensity, reason) {
  try {
    // Отправляем в Google Sheets
    const sheetData = {
      action: 'save_emotion',
      emotion: emotion.replace('_', ' '),
      intensity,
      reason,
      timestamp: new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
    };

    // НЕ ждем ответа - сохраняем в фоне  
    fetch('https://script.google.com/macros/s/AKfycbyTpE9kTgih8-AgnQSyjDZOa9Ub7jA5fbICZ1xCNsS_4EMDA9uvevC0bg8Z8naGDqBM5w/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sheetData)
    }).catch(error => console.error('Sheet save error:', error));

    // Сразу отправляем подтверждение пользователю
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

// Функции для работы с Telegram API
async function sendMessage(chatId, text, keyboard = null) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  };

  if (keyboard) {
    payload.reply_markup = JSON.stringify(keyboard);
  }

  console.log(`=== SENDING MESSAGE ===`);
  console.log(`Chat: ${chatId}, Text length: ${text.length}`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`--- Attempt ${attempt} ---`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log(`Attempt ${attempt}: TIMEOUT`);
        controller.abort();
      }, 10000);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`Attempt ${attempt}: SUCCESS!`);
        return;
      } else {
        console.log(`Attempt ${attempt}: HTTP ${response.status}`);
      }

    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  
  console.error(`=== ALL ATTEMPTS FAILED ===`);
}

async function editMessage(chatId, messageId, text, keyboard = null) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/editMessageText`;
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
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
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/answerCallbackQuery`;
  
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
