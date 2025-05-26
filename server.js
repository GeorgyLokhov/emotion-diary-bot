const express = require('express');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(express.json());

// Настройки из переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const PORT = process.env.PORT || 3000;

// Эмоции с эмодзи
const EMOTIONS = {
  'радость': '😊',
  'грусть': '😢', 
  'злость': '😠',
  'страх': '😰',
  'отвращение': '🤢',
  'интерес': '🤔',
  'безразличие': '😐',
  'приятную_усталость': '😌',
  'тревогу': '😟',
  'вину': '😔'
};

// Временное хранилище пользовательских сессий
const userSessions = new Map();

// Инициализация Google Sheets API
let sheetsClient;
async function initializeGoogleSheets() {
  try {
    let auth;
    
    // Пробуем Secret File сначала
    try {
      auth = new google.auth.GoogleAuth({
        keyFile: '/etc/secrets/google-credentials.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      console.log('✅ Using Secret File credentials');
    } catch (error) {
      console.log('Secret file not found, trying environment variable...');
      
      // Fallback на Environment Variable
      if (process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        auth = new google.auth.GoogleAuth({
          credentials: credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        console.log('✅ Using Environment Variable credentials');
      } else {
        throw new Error('No Google credentials found');
      }
    }
    
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API initialized successfully');
    
  } catch (error) {
    console.error('❌ Google Sheets initialization failed:', error);
  }
}

// Функция записи в Google Sheets (исправленная версия без названия листа)
async function writeToSheet(emotion, intensity, reason) {
  try {
    const currentTime = new Date().toLocaleString('ru-RU', { 
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    // Проверяем заголовки (без названия листа - обращается к первому листу)
    const headerCheck = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A1:D1',
    });
    
    // Создаем заголовки если их нет
    if (!headerCheck.data.values || !headerCheck.data.values[0] || headerCheck.data.values[0][0] !== 'Дата и время') {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: 'A1:D1',
        valueInputOption: 'RAW',
        resource: {
          values: [['Дата и время', 'Эмоция', 'Интенсивность', 'Причина']]
        }
      });
      console.log('✅ Headers created');
    }
    
    // Добавляем новую запись
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A:D',
      valueInputOption: 'RAW',
      resource: {
        values: [[currentTime, emotion, intensity, reason]]
      }
    });
    
    console.log(`✅ Data written to Google Sheets: ${emotion} (${intensity}) - ${reason}`);
    return true;
    
  } catch (error) {
    console.error('❌ Error writing to Google Sheets:', error);
    return false;
  }
}

// Функции для работы с Telegram API
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
      const errorText = await response.text();
      console.error('Telegram API error:', errorText);
    } else {
      console.log(`✅ Message sent to ${chatId}`);
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
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error('Edit message error:', await response.text());
    }
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

// Webhook endpoint для Telegram
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    // Мгновенно отвечаем Telegram
    res.status(200).json({ status: 'ok' });
    
    console.log('Update received:', JSON.stringify(update));
    
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ status: 'error' });
  }
});

// Обработка текстовых сообщений
async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text || '';
  
  console.log(`Message from ${chatId}: "${text}"`);
  
  if (text === '/start') {
    await sendStartMessage(chatId);
  } else {
    // Проверяем, ждем ли причину эмоции
    const session = userSessions.get(chatId);
    if (session && session.emotion && session.intensity !== undefined) {
      await saveEmotionEntry(chatId, text);
    } else {
      await sendMessage(chatId, '🤖 Используй кнопку "📝 Внести запись" для начала работы с дневником эмоций.');
    }
  }
}

// Обработка нажатий кнопок
async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  console.log(`Callback from ${chatId}: ${data}`);
  
  // Подтверждаем получение callback
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
  } else if (data === 'ignore') {
    // Игнорируем нажатия на заголовки
    return;
  }
}

// Отправка стартового сообщения
async function sendStartMessage(chatId) {
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

// Показать клавиатуру выбора эмоций
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

Выбери эмоцию, которая наиболее точно описывает твое текущее состояние:`;

  await editMessage(chatId, messageId, text, keyboard);
}

// Показать клавиатуру выбора интенсивности
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
  const text = `📊 <b>Интенсивность чувства: ${emoji} ${emotion.replace('_', ' ')}</b>

Насколько сильно ты это ощущаешь?
Выбери число от 1 до 10:`;

  await editMessage(chatId, messageId, text, keyboard);
}

// Запросить причину эмоции
async function askForReason(chatId, messageId, emotion, intensity) {
  let level, levelEmoji;
  if (intensity <= 3) {
    level = 'слабая';
    levelEmoji = '🟢';
  } else if (intensity <= 7) {
    level = 'средняя';
    levelEmoji = '🟡';
  } else {
    level = 'сильная';
    levelEmoji = '🔴';
  }

  const text = `💭 <b>Почему ты это чувствуешь?</b>

Интенсивность: ${levelEmoji} ${level} (${intensity}/10)

Опиши причину или ситуацию, которая вызвала это чувство.
Можешь писать сколько угодно - я записываю все детали:`;

  await editMessage(chatId, messageId, text);
}

// Сохранение записи эмоции
async function saveEmotionEntry(chatId, reason) {
  const session = userSessions.get(chatId);
  if (!session || !session.emotion || session.intensity === undefined) {
    await sendMessage(chatId, '❌ Ошибка: данные сессии не найдены. Начни заново с кнопки "📝 Внести запись".');
    return;
  }

  const { emotion, intensity } = session;
  
  console.log(`Saving emotion: ${emotion} (${intensity}) - ${reason}`);
  
  // Записываем в Google Sheets
  const success = await writeToSheet(emotion.replace('_', ' '), intensity, reason);
  
  if (success) {
    const emoji = EMOTIONS[emotion];
    let level, levelEmoji;
    if (intensity <= 3) {
      level = 'слабая';
      levelEmoji = '🟢';
    } else if (intensity <= 7) {
      level = 'средняя';
      levelEmoji = '🟡';
    } else {
      level = 'сильная';
      levelEmoji = '🔴';
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

Отличная работа! Регулярное отслеживание эмоций поможет тебе лучше понять себя.`;

    await sendMessage(chatId, text, keyboard);
    userSessions.delete(chatId);
  } else {
    await sendMessage(chatId, '❌ Ошибка сохранения данных в Google Таблицы. Попробуй еще раз или обратись к разработчику.');
  }
}

// Маршруты для проверки здоровья сервиса
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    googleSheets: sheetsClient ? 'initialized' : 'not initialized'
  });
});

app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Telegram Emotion Bot</h1>
    <p>✅ Server is running on Render!</p>
    <p>📊 Google Sheets: ${sheetsClient ? '✅ Connected' : '❌ Not connected'}</p>
    <p>🕐 Started: ${new Date().toISOString()}</p>
    <p><a href="/health">Health Check</a></p>
  `);
});

// Инициализация и запуск сервера
async function startServer() {
  console.log('🚀 Starting Telegram Emotion Bot...');
  console.log(`📊 Google Sheets ID: ${GOOGLE_SHEET_ID}`);
  console.log(`🤖 Telegram Bot Token: ${TELEGRAM_TOKEN ? 'Configured ✅' : 'Missing ❌'}`);
  
  // Инициализируем Google Sheets
  await initializeGoogleSheets();
  
  // Запускаем сервер
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📱 Webhook endpoint: http://localhost:${PORT}/webhook`);
  });
}

// Запуск приложения
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
