const express = require('express');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(express.json());

// Настройки из переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const PORT = process.env.PORT || 3000;

// Константы для состояний
const STATES = {
  NONE: 'none',
  CHOOSING_EMOTIONS: 'choosing_emotions',
  CHOOSING_INTENSITY_FOR_EMOTION: 'choosing_intensity_for_emotion',
  ENTERING_REASON: 'entering_reason'
};

// Обновленные эмоции с эмодзи
const EMOTIONS = {
  'радость': '😊',
  'уверенность': '😎',
  'интерес': '🤔',
  'приятную усталость': '🙂‍↕️',
  'удовлетворение': '😌',
  'спокойствие': '🙂',
  'блуждающее внимание': '😶‍🌫️',
  'апатию/безразличие': '😶',
  'усталость': '😞',
  'смятение/растерянность': '🫤',
  'раздражение': '😠',
  'тревогу': '😟',
  'стыд/вину': '😣',
  'дизмораль/подавленность': '😖'
};

// Временное хранилище пользовательских сессий
const userSessions = new Map();

// Функция создания новой сессии
function createSession() {
  return {
    state: STATES.NONE,
    selectedEmotions: [], // [{emotion: string, intensity: number}]
    currentEmotionIndex: -1, // Индекс текущей эмоции для установки интенсивности
    previousState: null,
    messageId: null
  };
}

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

// Функция для поиска групп записей, которые должны быть объединены
function findMergeGroups(data) {
  const groups = [];
  let currentGroup = null;
  
  for (let i = 1; i < data.length; i++) { // Пропускаем заголовок
    const row = data[i];
    if (!row || row.length < 5) continue;
    
    const [date, time, emotion, intensity, comment] = row;
    
    // Если у нас есть дата и время, это начало новой группы
    if (date && time) {
      // Завершаем предыдущую группу
      if (currentGroup && currentGroup.rows.length > 1) {
        groups.push(currentGroup);
      }
      
      // Начинаем новую группу
      currentGroup = {
        startRow: i,
        endRow: i,
        rows: [i],
        date: date,
        time: time,
        comment: comment
      };
    } else if (currentGroup && !date && !time && emotion) {
      // Это продолжение текущей группы
      currentGroup.endRow = i;
      currentGroup.rows.push(i);
    }
  }
  
  // Не забываем последнюю группу
  if (currentGroup && currentGroup.rows.length > 1) {
    groups.push(currentGroup);
  }
  
  return groups;
}

// Функция записи в Google Sheets с умным объединением ячеек
async function writeToSheetWithSmartMerge(selectedEmotions, reason) {
  try {
    const now = new Date();
    const currentDateTime = now.toLocaleString('ru-RU', { 
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    
    const [dateStr, timeStr] = currentDateTime.split(', ');
    
    console.log(`Saving data: Date=${dateStr}, Time=${timeStr}, Emotions=${selectedEmotions.length}`);
    
    // Проверяем заголовки
    const headerCheck = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A1:E1',
    });
    
    // Создаем заголовки если их нет
    if (!headerCheck.data.values || !headerCheck.data.values[0] || headerCheck.data.values[0][0] !== 'Дата') {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: 'A1:E1',
        valueInputOption: 'RAW',
        resource: {
          values: [['Дата', 'Время', 'Что я чувствую?', 'Интенсивность', 'Почему я это чувствую?']]
        }
      });
      console.log('✅ Headers created');
    }

    // Подготавливаем данные для записи
    const values = [];
    selectedEmotions.forEach((emotionData, index) => {
      if (index === 0) {
        // Первая строка содержит дату, время, эмоцию, интенсивность и комментарий
        values.push([dateStr, timeStr, emotionData.emotion, emotionData.intensity, reason]);
      } else {
        // Остальные строки содержат только эмоцию и интенсивность
        values.push(['', '', emotionData.emotion, emotionData.intensity, '']);
      }
    });

    console.log('📝 Writing data:', values);

    // Записываем данные
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A:E',
      valueInputOption: 'RAW',
      resource: {
        values: values
      }
    });

    console.log('✅ Data written, waiting 2 seconds before merging...');

    // ЖДЕМ 2 секунды чтобы данные точно записались
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Теперь занимаемся объединением ячеек
    if (selectedEmotions.length > 1) {
      await smartMergeCells();
    }
    
    console.log(`✅ Data written to Google Sheets: ${selectedEmotions.length} emotions`);
    return true;
    
  } catch (error) {
    console.error('❌ Error writing to Google Sheets:', error);
    return false;
  }
}

// Улучшенная функция поиска групп с логированием
function findMergeGroups(data) {
  console.log('🔍 Analyzing data for merge groups...');
  console.log('📊 Total rows:', data.length);
  
  if (data.length <= 1) {
    console.log('❌ Not enough data for merging');
    return [];
  }

  const groups = [];
  let currentGroup = null;
  
  for (let i = 1; i < data.length; i++) { // Пропускаем заголовок
    const row = data[i];
    console.log(`Row ${i + 1}:`, row);
    
    if (!row || row.length < 3) {
      console.log(`⏭️ Skipping row ${i + 1} - insufficient data`);
      continue;
    }
    
    const [date, time, emotion, intensity, comment] = row;
    
    // Если у нас есть дата и время, это начало новой группы
    if (date && time) {
      console.log(`🆕 New group started at row ${i + 1}`);
      
      // Завершаем предыдущую группу
      if (currentGroup && currentGroup.rows.length > 1) {
        console.log(`✅ Finished group: rows ${currentGroup.startRow + 1}-${currentGroup.endRow + 1}`);
        groups.push(currentGroup);
      }
      
      // Начинаем новую группу
      currentGroup = {
        startRow: i,
        endRow: i,
        rows: [i],
        date: date,
        time: time,
        comment: comment
      };
    } else if (currentGroup && !date && !time && emotion) {
      // Это продолжение текущей группы
      console.log(`➕ Adding row ${i + 1} to current group`);
      currentGroup.endRow = i;
      currentGroup.rows.push(i);
    } else {
      console.log(`⚠️ Row ${i + 1} doesn't fit any pattern`);
    }
  }
  
  // Не забываем последнюю группу
  if (currentGroup && currentGroup.rows.length > 1) {
    console.log(`✅ Finished last group: rows ${currentGroup.startRow + 1}-${currentGroup.endRow + 1}`);
    groups.push(currentGroup);
  }
  
  console.log(`🎯 Found ${groups.length} groups for merging`);
  return groups;
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
    userSessions.delete(chatId);
    await sendStartMessage(chatId);
  } else {
    const session = userSessions.get(chatId);
    
    if (session && session.state === STATES.ENTERING_REASON && 
        session.selectedEmotions.length > 0) {
      await saveEmotionEntry(chatId, text);
    } else {
      const keyboard = {
        inline_keyboard: [[
          { text: '📝 Внести запись', callback_data: 'add_entry' }
        ]]
      };
      
      await sendMessage(chatId, 
        '🤖 Используй кнопку "📝 Внести запись" для начала работы с дневником эмоций.', 
        keyboard);
    }
  }
}

// Обработка нажатий кнопок
async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  console.log(`Callback from ${chatId}: ${data}`);
  
  await answerCallbackQuery(callbackQuery.id);
  
  let session = userSessions.get(chatId) || createSession();
  session.messageId = messageId;
  
  if (data === 'add_entry') {
    session = createSession();
    session.state = STATES.CHOOSING_EMOTIONS;
    session.messageId = messageId;
    userSessions.set(chatId, session);
    await showEmotionKeyboard(chatId, messageId);
    
  } else if (data === 'done_selecting_emotions') {
    if (session.selectedEmotions.length === 0) {
      return; // Нельзя завершить без выбора эмоций
    }
    // Переходим к выбору интенсивности для первой эмоции
    session.currentEmotionIndex = 0;
    session.state = STATES.CHOOSING_INTENSITY_FOR_EMOTION;
    userSessions.set(chatId, session);
    await showIntensityKeyboard(chatId, messageId, session);
    
  } else if (data === 'back') {
    await handleBack(chatId, messageId, session);
    
  } else if (data === 'cancel') {
    await handleCancel(chatId, messageId);
    
  } else if (data.startsWith('emotion_')) {
    const emotion = data.replace('emotion_', '');
    await toggleEmotion(chatId, messageId, session, emotion);
    
  } else if (data.startsWith('intensity_')) {
    const intensity = parseInt(data.replace('intensity_', ''));
    await setIntensityForCurrentEmotion(chatId, messageId, session, intensity);
    
  } else if (data === 'ignore') {
    return;
  }
}

// Переключение выбора эмоции
async function toggleEmotion(chatId, messageId, session, emotion) {
  const existingIndex = session.selectedEmotions.findIndex(e => e.emotion === emotion);
  
  if (existingIndex >= 0) {
    // Убираем эмоцию
    session.selectedEmotions.splice(existingIndex, 1);
  } else {
    // Добавляем эмоцию (без интенсивности пока)
    session.selectedEmotions.push({ emotion, intensity: null });
  }
  
  userSessions.set(chatId, session);
  await showEmotionKeyboard(chatId, messageId);
}

// Установка интенсивности для текущей эмоции
async function setIntensityForCurrentEmotion(chatId, messageId, session, intensity) {
  // Устанавливаем интенсивность для текущей эмоции
  if (session.currentEmotionIndex >= 0 && session.currentEmotionIndex < session.selectedEmotions.length) {
    session.selectedEmotions[session.currentEmotionIndex].intensity = intensity;
  }
  
  // Переходим к следующей эмоции
  session.currentEmotionIndex++;
  
  if (session.currentEmotionIndex < session.selectedEmotions.length) {
    // Есть еще эмоции без интенсивности
    userSessions.set(chatId, session);
    await showIntensityKeyboard(chatId, messageId, session);
  } else {
    // Все интенсивности установлены, переходим к вводу комментария
    session.state = STATES.ENTERING_REASON;
    session.currentEmotionIndex = -1;
    userSessions.set(chatId, session);
    await askForReason(chatId, messageId, session.selectedEmotions);
  }
}

// Обработка возврата и отмены
async function handleBack(chatId, messageId, session) {
  switch (session.state) {
    case STATES.CHOOSING_INTENSITY_FOR_EMOTION:
      if (session.currentEmotionIndex > 0) {
        // Возврат к предыдущей эмоции
        session.currentEmotionIndex--;
        // Очищаем интенсивность текущей эмоции
        session.selectedEmotions[session.currentEmotionIndex].intensity = null;
        userSessions.set(chatId, session);
        await showIntensityKeyboard(chatId, messageId, session);
      } else {
        // Возврат к выбору эмоций
        session.state = STATES.CHOOSING_EMOTIONS;
        session.currentEmotionIndex = -1;
        // Очищаем все интенсивности
        session.selectedEmotions.forEach(e => e.intensity = null);
        userSessions.set(chatId, session);
        await showEmotionKeyboard(chatId, messageId);
      }
      break;
      
    case STATES.ENTERING_REASON:
      // Возврат к выбору интенсивности (для последней эмоции)
      if (session.selectedEmotions.length > 0) {
        session.selectedEmotions.forEach(e => e.intensity = null);
        session.currentEmotionIndex = session.selectedEmotions.length - 1;
        session.state = STATES.CHOOSING_INTENSITY_FOR_EMOTION;
        userSessions.set(chatId, session);
        await showIntensityKeyboard(chatId, messageId, session);
      }
      break;
      
    default:
      await sendStartMessage(chatId);
      userSessions.delete(chatId);
  }
}

async function handleCancel(chatId, messageId) {
  const keyboard = {
    inline_keyboard: [[
      { text: '📝 Внести запись', callback_data: 'add_entry' }
    ]]
  };
  
  const text = `❌ <b>Запись отменена</b>

Данные не были сохранены. Можешь начать заново, когда будешь готов.`;
  
  await editMessage(chatId, messageId, text, keyboard);
  userSessions.delete(chatId);
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

Теперь ты можешь выбирать несколько эмоций за раз и указывать интенсивность для каждой из них.

Регулярное ведение дневника эмоций поможет:
• Выявить эмоциональные паттерны
• Понять триггеры различных состояний  
• Развить эмоциональный интеллект
• Улучшить самосознание

Нажми кнопку ниже, чтобы добавить новую запись 👇`;

  await sendMessage(chatId, text, keyboard);
}

// Показать клавиатуру выбора эмоций (в 2 столбца)
async function showEmotionKeyboard(chatId, messageId) {
  const session = userSessions.get(chatId);
  const emotions = Object.keys(EMOTIONS);
  const keyboard = { inline_keyboard: [] };

  // Добавляем эмоции по 2 в ряд
  for (let i = 0; i < emotions.length; i += 2) {
    const row = [];
    
    // Первая эмоция в ряду
    const emotion1 = emotions[i];
    const emoji1 = EMOTIONS[emotion1];
    const isSelected1 = session.selectedEmotions.some(e => e.emotion === emotion1);
    const text1 = isSelected1 
      ? `✅ ${emoji1} ${emotion1.charAt(0).toUpperCase() + emotion1.slice(1)}`
      : `${emoji1} ${emotion1.charAt(0).toUpperCase() + emotion1.slice(1)}`;
    
    row.push({
      text: text1,
      callback_data: `emotion_${emotion1}`
    });
    
    // Вторая эмоция в ряду (если есть)
    if (i + 1 < emotions.length) {
      const emotion2 = emotions[i + 1];
      const emoji2 = EMOTIONS[emotion2];
      const isSelected2 = session.selectedEmotions.some(e => e.emotion === emotion2);
      const text2 = isSelected2 
        ? `✅ ${emoji2} ${emotion2.charAt(0).toUpperCase() + emotion2.slice(1)}`
        : `${emoji2} ${emotion2.charAt(0).toUpperCase() + emotion2.slice(1)}`;
      
      row.push({
        text: text2,
        callback_data: `emotion_${emotion2}`
      });
    }
    
    keyboard.inline_keyboard.push(row);
  }

  // Добавляем кнопки управления
  const controlButtons = [];
  if (session.selectedEmotions.length > 0) {
    controlButtons.push({ text: '✅ Продолжить', callback_data: 'done_selecting_emotions' });
  }
  controlButtons.push({ text: '❌ Отменить', callback_data: 'cancel' });
  
  keyboard.inline_keyboard.push(controlButtons);

  let text = `🎭 <b>Что ты чувствуешь прямо сейчас?</b>

Выбери одну или несколько эмоций. Нажми на эмоцию чтобы выбрать/убрать её.`;

  if (session.selectedEmotions.length > 0) {
    text += `\n\n<b>Выбрано эмоций:</b> ${session.selectedEmotions.length}`;
  }

  await editMessage(chatId, messageId, text, keyboard);
}

// Показать клавиатуру выбора интенсивности
async function showIntensityKeyboard(chatId, messageId, session) {
  const currentEmotion = session.selectedEmotions[session.currentEmotionIndex];
  const currentNumber = session.currentEmotionIndex + 1;
  const totalNumber = session.selectedEmotions.length;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: 'Слабая (1-3)', callback_data: 'ignore' }],
      [
        { text: '1️⃣', callback_data: 'intensity_1' },
        { text: '2️⃣', callback_data: 'intensity_2' },
        { text: '3️⃣', callback_data: 'intensity_3' }
      ],
      [{ text: 'Средняя (4-7)', callback_data: 'ignore' }],
      [
        { text: '4️⃣', callback_data: 'intensity_4' },
        { text: '5️⃣', callback_data: 'intensity_5' },
        { text: '6️⃣', callback_data: 'intensity_6' },
        { text: '7️⃣', callback_data: 'intensity_7' }
      ],
      [{ text: 'Сильная (8-10)', callback_data: 'ignore' }],
      [
        { text: '8️⃣', callback_data: 'intensity_8' },
        { text: '9️⃣', callback_data: 'intensity_9' },
        { text: '🔟', callback_data: 'intensity_10' }
      ],
      [
        { text: '⬅️ Назад', callback_data: 'back' },
        { text: '❌ Отменить', callback_data: 'cancel' }
      ]
    ]
  };

  const emoji = EMOTIONS[currentEmotion.emotion];
  const text = `📊 <b>Интенсивность эмоции ${currentNumber}/${totalNumber}</b>

🎭 <b>${emoji} ${currentEmotion.emotion}</b>

Насколько сильно ты это ощущаешь?
Выбери число от 1 до 10:`;

  await editMessage(chatId, messageId, text, keyboard);
}

// Запросить причину эмоций
async function askForReason(chatId, messageId, selectedEmotions) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '⬅️ Назад', callback_data: 'back' },
        { text: '❌ Отменить', callback_data: 'cancel' }
      ]
    ]
  };

  let emotionsText = '';
  selectedEmotions.forEach((emotionData, index) => {
    const emoji = EMOTIONS[emotionData.emotion];
    let level, levelEmoji;
    if (emotionData.intensity <= 3) {
      level = 'слабая';
      levelEmoji = '🔵';
    } else if (emotionData.intensity <= 7) {
      level = 'средняя';
      levelEmoji = '🟢';
    } else {
      level = 'сильная';
      levelEmoji = '🟠';
    }
    
    emotionsText += `${index + 1}. ${emoji} ${emotionData.emotion} - ${levelEmoji} ${level} (${emotionData.intensity}/10)\n`;
  });

  const text = `💭 <b>Почему ты это чувствуешь?</b>

<b>Выбранные эмоции:</b>
${emotionsText}
Опиши причину или ситуацию, которая вызвала эти чувства:`;

  await editMessage(chatId, messageId, text, keyboard);
}

// Сохранение записи эмоций
async function saveEmotionEntry(chatId, reason) {
  const session = userSessions.get(chatId);
  if (!session || session.selectedEmotions.length === 0) {
    await sendMessage(chatId, '❌ Ошибка: данные сессии не найдены. Начни заново с кнопки "📝 Внести запись".');
    return;
  }

  console.log(`Saving emotions: ${session.selectedEmotions.length} emotions - ${reason}`);
  
  const success = await writeToSheetWithSmartMerge(session.selectedEmotions, reason);
  
  if (success) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '📝 Добавить еще одну запись', callback_data: 'add_entry' }],
        [{ text: '📊 Посмотреть гугл таблицу', url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit` }]
      ]
    };

    let emotionsText = '';
    session.selectedEmotions.forEach((emotionData, index) => {
      const emoji = EMOTIONS[emotionData.emotion];
      let level, levelEmoji;
      if (emotionData.intensity <= 3) {
        level = 'слабая';
        levelEmoji = '🔵';
      } else if (emotionData.intensity <= 7) {
        level = 'средняя';
        levelEmoji = '🟢';
      } else {
        level = 'сильная';
        levelEmoji = '🟠';
      }
      
      emotionsText += `${index + 1}. ${emoji} ${emotionData.emotion} - ${levelEmoji} ${level} (${emotionData.intensity}/10)\n`;
    });

    const text = `✅ <b>Запись сохранена!</b>

<b>Эмоции:</b>
${emotionsText}
💭 <b>Комментарий:</b> ${reason}`;

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
  
  await initializeGoogleSheets();
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📱 Webhook endpoint: http://localhost:${PORT}/webhook`);
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
