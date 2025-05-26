export default async function handler(req, res) {
  try {
    console.log('Function called with method:', req.method);
    console.log('Headers:', JSON.stringify(req.headers));
    
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Webhook endpoint is working!',
        timestamp: new Date().toISOString(),
        token: process.env.TELEGRAM_TOKEN ? 'Token found' : 'Token missing'
      });
    }

    if (req.method === 'POST') {
      console.log('POST body:', JSON.stringify(req.body));
      
      // Мгновенный ответ для Telegram
      res.status(200).json({ status: 'ok' });
      
      // Простая обработка /start
      const update = req.body;
      if (update.message && update.message.text === '/start') {
        const chatId = update.message.chat.id;
        await sendSimpleMessage(chatId);
      }
      
      return;
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Function error:', error);
    return res.status(200).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
}

async function sendSimpleMessage(chatId) {
  try {
    const token = process.env.TELEGRAM_TOKEN;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🎉 Vercel webhook работает! Бот успешно развернут.'
      })
    });

    const result = await response.text();
    console.log('Telegram API response:', result);
    
  } catch (error) {
    console.error('Send message error:', error);
  }
}
