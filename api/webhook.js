export default async function handler(req, res) {
  try {
    console.log('Function called with method:', req.method);
    
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Webhook endpoint is working!',
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'POST') {
      const update = req.body;
      console.log('Update received:', JSON.stringify(update));
      
      // МГНОВЕННО возвращаем 200 OK для Telegram
      res.status(200).json({ status: 'ok' });
      
      // НОВАЯ ССЫЛКА НА GOOGLE APPS SCRIPT!
      const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxj6t8L2uQd2ss7hNGTM0f-0YniAoJcuilU4d-gp1HfJ58qlHE61NTAfQ_JEBaQdkQ/exec';
      
      // Отправляем данные в Google Apps Script для обработки
      if (update.message) {
        await processMessageViaGoogleScript(update.message, GOOGLE_SCRIPT_URL);
      } else if (update.callback_query) {
        await processCallbackViaGoogleScript(update.callback_query, GOOGLE_SCRIPT_URL);
      }
      
      return;
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Function error:', error);
    return res.status(200).json({ status: 'error' });
  }
}

async function processMessageViaGoogleScript(message, scriptUrl) {
  try {
    const data = {
      action: 'handle_message',
      chat_id: message.chat.id,
      text: message.text || '',
      user_id: message.from.id,
      timestamp: new Date().toISOString()
    };
    
    console.log('Sending to Google Script:', JSON.stringify(data));
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const result = await response.text();
    console.log('Google Script response:', result);
    
  } catch (error) {
    console.error('Google Script error:', error);
  }
}

async function processCallbackViaGoogleScript(callbackQuery, scriptUrl) {
  try {
    const data = {
      action: 'handle_callback',
      chat_id: callbackQuery.message.chat.id,
      message_id: callbackQuery.message.message_id,
      callback_data: callbackQuery.data,
      callback_id: callbackQuery.id,
      user_id: callbackQuery.from.id,
      timestamp: new Date().toISOString()
    };
    
    console.log('Sending callback to Google Script:', JSON.stringify(data));
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const result = await response.text();
    console.log('Google Script callback response:', result);
    
  } catch (error) {
    console.error('Google Script callback error:', error);
  }
}
