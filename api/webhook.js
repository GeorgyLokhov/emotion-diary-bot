export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(200).json({ message: 'Webhook active' });
    }

    const update = req.body;
    console.log('Update received:', JSON.stringify(update));
    
    // МГНОВЕННО возвращаем ответ Telegram
    res.status(200).json({ status: 'ok' });
    
    // Сохраняем в Google Sheets ВМЕСТО отправки через Telegram
    if (update.message && update.message.text === '/start') {
      const chatId = update.message.chat.id;
      
      // Отправляем данные в Google Apps Script для обработки
      const data = {
        action: 'send_telegram_message',
        chat_id: chatId,
        text: '🎉 Привет! Бот работает через Google Apps Script!',
        timestamp: new Date().toISOString()
      };
      
      // Используем Google Apps Script как прокси для Telegram API
      fetch('https://script.google.com/macros/s/AKfycbzB2ZQuWkBNTYwK7aiLwhmWdMfS-XQUQMXBJ2B36PJPzSmb7LdWzHZRF2PKZ_8HNS7M/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(error => console.error('Google Script error:', error));
    }

  } catch (error) {
    console.error('Error:', error);
    res.status(200).json({ status: 'error' });
  }
}
