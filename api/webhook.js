export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ 
        message: 'Webhook proxy is working!',
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'POST') {
      const update = req.body;
      console.log('Update received:', JSON.stringify(update));
      
      // МГНОВЕННО возвращаем 200 OK для Telegram
      res.status(200).json({ status: 'ok' });
      
      // Отправляем ВСЁ в Google Apps Script без обработки
      try {
        console.log('Forwarding to Google Apps Script...');
        
        const response = await fetch('https://script.google.com/macros/s/AKfycbwcYPOxMIaCZPjUoBndFkd-fQOMPV_6lgv4dhhupcQCrafyoK6PEG5DImbHL_1qMw1Vfw/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'handle_telegram_update',
            update: update,
            timestamp: new Date().toISOString()
          })
        });
        
        const result = await response.text();
        console.log('Google Apps Script response:', result);
        
      } catch (error) {
        console.error('Forward error:', error);
      }
      
      return;
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Function error:', error);
    return res.status(200).json({ status: 'error' });
  }
}
