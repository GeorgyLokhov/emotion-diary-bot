export default async function handler(req, res) {
  try {
    console.log('=== WEBHOOK HANDLER START ===');
    console.log('Method:', req.method);
    console.log('Headers:', JSON.stringify(req.headers));
    
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
      
      // Отправляем в Google Apps Script с детальным логированием
      const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyY6vWoHozIuKRWOI0zKak9WoOvnqgEwWUuu-qGFz7Ij8nTNgbGgsGn0YOBlR-biQs_aA/exec';
      
      const payload = {
        action: 'handle_telegram_update',
        update: update,
        timestamp: new Date().toISOString(),
        source: 'vercel'
      };
      
      try {
        console.log('=== FORWARDING TO APPS SCRIPT ===');
        console.log('URL:', APPS_SCRIPT_URL);
        console.log('Payload:', JSON.stringify(payload));
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.log('Apps Script request TIMEOUT after 25 seconds');
          controller.abort();
        }, 25000);
        
        console.log('Making POST request to Apps Script...');
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'User-Agent': 'Vercel-Telegram-Bot/1.0'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        console.log('Apps Script response status:', response.status);
        console.log('Apps Script response headers:', JSON.stringify([...response.headers.entries()]));
        
        const result = await response.text();
        console.log('Apps Script response body:', result);
        
        if (response.ok) {
          console.log('✅ Successfully forwarded to Apps Script');
        } else {
          console.error('❌ Apps Script returned error status:', response.status);
        }
        
      } catch (error) {
        console.error('=== FORWARD ERROR ===');
        console.error('Error type:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      
      console.log('=== WEBHOOK HANDLER END ===');
      return;
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('=== CRITICAL ERROR ===');
    console.error('Error:', error);
    return res.status(200).json({ status: 'error' });
  }
}
