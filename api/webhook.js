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
      console.log('POST body:', JSON.stringify(req.body));
      
      // КРИТИЧНО: Мгновенно возвращаем 200 OK для Telegram
      res.status(200).json({ status: 'ok' });
      
      // Обрабатываем в фоне без блокировки ответа
      const update = req.body;
      if (update.message && update.message.text === '/start') {
        const chatId = update.message.chat.id;
        // НЕ ждем результата - обрабатываем асинхронно
        sendSimpleMessage(chatId).catch(error => {
          console.error('Background error:', error);
        });
      }
      
      return;
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Function error:', error);
    return res.status(200).json({ status: 'error' });
  }
}

async function sendSimpleMessage(chatId) {
  const token = process.env.TELEGRAM_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  const payload = {
    chat_id: chatId,
    text: '🎉 Vercel webhook работает! Бот успешно развернут.'
  };

  // Добавляем таймаут и retry логику
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Attempt ${attempt} to send message to ${chatId}`);
      
      // AbortController для таймаута
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 секунд таймаут
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      if (response.ok) {
        const result = await response.text();
        console.log(`Success on attempt ${attempt}:`, result);
        return; // Успех!
      } else {
        console.log(`HTTP error on attempt ${attempt}:`, response.status);
      }
      
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt < 3) {
        // Ждем перед повтором: 1с, 2с, 3с
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  
  console.error('All attempts failed to send message');
}
