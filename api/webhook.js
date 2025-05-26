export default async function handler(req, res) {
  try {
    console.log('=== WEBHOOK HANDLER START ===');
    console.log('Method:', req.method);
    
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
      
      // Отправляем в Google Apps Script как FORM DATA (НЕ JSON)
      const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyY6vWoHozIuKRWOI0zKak9WoOvnqgEwWUuu-qGFz7Ij8nTNgbGgsGn0YOBlR-biQs_aA/exec';
      
      const payload = {
        action: 'handle_telegram_update',
        update: JSON.stringify(update),
        timestamp: new Date().toISOString(),
        source: 'vercel'
      };
      
      try {
        console.log('=== FORWARDING TO APPS SCRIPT ===');
        console.log('URL:', APPS_SCRIPT_URL);
        
        // Создаем URLSearchParams для form data
        const formData = new URLSearchParams();
        Object.keys(payload).forEach(key => {
          formData.append(key, payload[key]);
        });
        
        console.log('Form data:', formData.toString());
        console.log('Making POST request as form data...');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.log('Apps Script request TIMEOUT after 25 seconds');
          controller.abort();
        }, 25000);
        
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Vercel-Telegram-Bot/1.0'
          },
          body: formData.toString(),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        console.log('Apps Script response status:', response.status);
        
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
