const { google } = require('googleapis');

// Настройки из переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

console.log('=== FUNCTION INITIALIZED ===');
console.log('TELEGRAM_TOKEN:', TELEGRAM_TOKEN ? 'Present' : 'Missing');
console.log('GOOGLE_SHEET_ID:', GOOGLE_SHEET_ID ? 'Present' : 'Missing');
console.log('GOOGLE_CREDENTIALS:', process.env.GOOGLE_CREDENTIALS ? 'Present' : 'Missing');

// Эмоции
const EMOTIONS = {
  'радость': '😊', 'грусть': '😢', 'злость': '😠', 'страх': '😰',
  'отвращение': '🤢', 'интерес': '🤔', 'безразличие': '😐',
  'приятную_усталость': '😌', 'тревогу': '😟', 'вину': '😔'
};

// Глобальное хранилище сессий
const userSessions = new Map();

// Инициализация Google Sheets
let sheetsClient;

async function initGoogleSheets() {
  console.log('=== INITIALIZING GOOGLE SHEETS ===');
  
  if (sheetsClient) {
    console.log('Google Sheets client already exists');
    return sheetsClient;
  }
  
  try {
    console.log('Parsing Google credentials...');
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    console.log('Credentials parsed successfully');
    
    console.log('Creating Google Auth...');
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    console.log('Auth created successfully');
    
    console.log('Creating Sheets client...');
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API initialized');
    
    return sheetsClient;
  } catch (error) {
    console.error('❌ Google Sheets initialization failed:', error);
    console.error('Error stack:', error.stack);
    return null;
  }
}

// Главная serverless функция
export default async function handler(req, res) {
  console.log('=== WEBHOOK HANDLER CALLED ===');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers));
  
  if (req.method !== 'POST') {
    console.log('GET request - returning status page');
    return res.status(200).json({ 
      message: 'Telegram Bot on Vercel!',
      timestamp: new Date().toISOString(),
      env_check: {
        telegram_token: !!TELEGRAM_TOKEN,
        sheet_id: !!GOOGLE_SHEET_ID,
        credentials: !!process.env.GOOGLE_CREDENTIALS
      }
    });
  }

  try {
    const update = req.body;
    console.log('Update received:', JSON.stringify(update));
    
    // Мгновенно отвечаем Telegram
    console.log('Sending 200 OK to Telegram...');
    res.status(200).json({ status: 'ok' });
    console.log('200 OK sent to Telegram');
    
    console.log('Starting update processing...');
    
    if (update.message) {
      console.log('Processing message...');
      await handleMessage(update.message);
      console.log('Message processing completed');
    } else if (update.callback_query) {
      console.log('Processing callback query...');
      await handleCallback(update.callback_query);
      console.log('Callback processing completed');
    } else {
      console.log('Unknown update type');
    }
    
    console.log('=== WEBHOOK HANDLER COMPLETED ===');
    
  } catch (error) {
    console.error('=== WEBHOOK HANDLER ERROR ===');
    console.error('Error type:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    return res.status(200).json({ status: 'error' });
  }
}

// Обработка сообщений
async function handleMessage(message) {
  console.log('=== HANDLE MESSAGE START ===');
  
  try {
    const chatId = message.chat.id;
    const text = message.text || '';
    
    console.log(`Chat ID: ${chatId}`);
    console.log(`Text: "${text}"`);
    
    if (text === '/start') {
      console.log('Processing /start command...');
      await sendStartMessage(chatId);
      console.log('/start command processed');
    } else {
      console.log('Processing regular message...');
      const session = userSessions.get(chatId);
      console.log('User session:', session);
      
      if (session && session.emotion && session.intensity) {
        console.log('Saving emotion entry...');
        await saveEmotionEntry(chatId, text);
        console.log('Emotion entry saved');
      } else {
        console.log('Sending help message...');
        await sendMessage(chatId, '🤖 Используй кнопку "📝 Внести запись" для начала.');
        console.log('Help message sent');
      }
    }
    
    console.log('=== HANDLE MESSAGE COMPLETED ===');
  } catch (error) {
    console.error('=== HANDLE MESSAGE ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
  }
}

// Отправка стартового сообщения
async function sendStartMessage(chatId) {
  console.log('=== SEND START MESSAGE ===');
  console.log(`Target chat: ${chatId}`);
  
  try {
    const keyboard = {
      inline_keyboard: [[
        { text: '📝 Внести запись', callback_data: 'add_entry' }
      ]]
    };
    
    const text = `🌟 <b>Дневник эмоций</b>

Привет! Я помогу тебе отслеживать эмоциональные состояния и лучше понимать себя.

Нажми кнопку ниже, чтобы добавить новую запись 👇`;

    console.log('Calling sendMessage...');
    await sendMessage(chatId, text, keyboard);
    console.log('✅ Start message sent successfully');
    
  } catch (error) {
    console.error('❌ Send start message error:', error);
    console.error('Stack:', error.stack);
  }
}

// Функция отправки сообщений с детальными логами
async function sendMessage(chatId, text, keyboard = null) {
  console.log('=== SEND MESSAGE START ===');
  console.log(`Chat ID: ${chatId}`);
  console.log(`Text length: ${text.length}`);
  console.log(`Has keyboard: ${!!keyboard}`);
  
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (keyboard) {
    payload.reply_markup = JSON.stringify(keyboard);
  }
  
  console.log('Telegram API URL:', url);
  console.log('Payload:', JSON.stringify(payload));
  
  try {
    console.log('Making request to Telegram API...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', [...response.headers.entries()]);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram API error response:', errorText);
    } else {
      const responseText = await response.text();
      console.log('Telegram API success response:', responseText);
    }
    
    console.log('✅ Send message completed');
    
  } catch (error) {
    console.error('❌ Send message error:', error);
    console.error('Error type:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
  }
}

// Заглушки для остальных функций (добавлю если понадобятся)
async function handleCallback(callbackQuery) {
  console.log('=== HANDLE CALLBACK ===');
  console.log('Callback data:', callbackQuery.data);
  // Пока просто логируем
}

async function saveEmotionEntry(chatId, text) {
  console.log('=== SAVE EMOTION ENTRY ===');
  console.log('Chat:', chatId, 'Text:', text);
  // Пока просто логируем
}

// Остальные функции добавим после устранения основной проблемы
async function editMessage() { console.log('editMessage called'); }
async function answerCallbackQuery() { console.log('answerCallbackQuery called'); }
async function showEmotionKeyboard() { console.log('showEmotionKeyboard called'); }
async function showIntensityKeyboard() { console.log('showIntensityKeyboard called'); }
async function askForReason() { console.log('askForReason called'); }
