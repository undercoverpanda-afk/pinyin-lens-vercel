// api/telegram.js - Alternative without sharp
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(200).json({ ok: true });
        }
        
        const chatId = message.chat.id;
        let responseText = '';
        let replyMethod = 'sendMessage';
        
        // Handle photo messages
        if (message.photo && message.photo.length > 0) {
            // IMPORTANT CHANGE: Get medium resolution photo instead of highest
            // This reduces file size significantly
            const photoIndex = Math.min(2, message.photo.length - 1); // Get 3rd largest or highest available
            const photo = message.photo[photoIndex];
            const fileId = photo.file_id;
            
            console.log(`Using photo resolution ${photoIndex + 1} of ${message.photo.length}`);
            console.log(`Photo dimensions: ${photo.width}x${photo.height}`);
            
            // Get file path from Telegram
            const fileResponse = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
            );
            const fileData = await fileResponse.json();
            
            if (!fileData.ok) {
                throw new Error('Failed to get file from Telegram');
            }
            
            // Check file size before downloading
            if (fileData.result.file_size > 5 * 1024 * 1024) { // 5MB limit
                throw new Error('Image too large. Please send a smaller image.');
            }
            
            console.log('File size:', (fileData.result.file_size / 1024 / 1024).toFixed(2), 'MB');
            
            // Download the image
            const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
            const imageResponse = await fetch(imageUrl);
            
            if (!imageResponse.ok) {
                throw new Error('Failed to download image from Telegram');
            }
            
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = Buffer.from(imageBuffer).toString('base64');
            
            console.log('Base64 size:', (base64Image.length / 1024 / 1024).toFixed(2), 'MB');
            
            // Send typing indicator
            await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        action: 'typing'
                    })
                }
            );
            
            // Check if API key exists
            if (!process.env.CLAUDE_API_KEY) {
                console.error('CLAUDE_API_KEY is not set');
                throw new Error('API configuration error');
            }
            
            console.log('Calling Claude API...');
            
            // Call Claude API
            const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': process.env.CLAUDE_API_KEY,
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20240620',
                    max_tokens: 1024,
                    messages: [{
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: 'image/jpeg',
                                    data: base64Image
                                }
                            },
                            {
                                type: 'text',
                                text: 'Please identify all Chinese characters in this image and provide their pinyin pronunciation. Format each as: Character (pinyin). List them clearly. If no Chinese characters are found, please say so.'
                            }
                        ]
                    }]
                })
            });
            
            if (!claudeResponse.ok) {
                const errorText = await claudeResponse.text();
                console.error('Claude API error:', claudeResponse.status, errorText);
                
                let errorMessage = 'Claude API error';
                try {
                    const errorData = JSON.parse(errorText);
                    errorMessage = errorData.error?.message || errorData.message || errorText;
                } catch {
                    errorMessage = errorText.substring(0, 200);
                }
                
                // Check for specific errors
                if (errorMessage.includes('image_too_large')) {
                    throw new Error('Image is too large for processing. Please send a smaller or lower resolution image.');
                }
                
                throw new Error(`Claude API failed: ${errorMessage}`);
            }
            
            const result = await claudeResponse.json();
            responseText = `📝 *Pinyin Translation:*\n\n${result.content[0].text}`;
            
        } 
        // Handle text messages
        else if (message.text) {
            const text = message.text.toLowerCase();
            
            if (text === '/start' || text === '/help') {
                responseText = `🇨🇳 *Chinese to Pinyin Bot*\n\n📸 Send me a photo of Chinese text and I'll provide the pinyin pronunciation!\n\n*How to use:*\n1. Take or select a photo with Chinese characters\n2. Send it to me\n3. Get instant pinyin translation\n\n*Tips:*\n• Clear, well-lit photos work best\n• Avoid blurry or angled shots\n• If image is too large, try taking photo at lower resolution\n• I can handle menus, signs, and any Chinese text!`;
            } else {
                responseText = '📸 Please send me a photo with Chinese text to translate!';
            }
        }
        
        // Send response back to user
        await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${replyMethod}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: responseText,
                    parse_mode: 'Markdown'
                })
            }
        );
        
        res.status(200).json({ ok: true });
        
    } catch (error) {
        console.error('Telegram bot error:', error);
        console.error('Error details:', error.message);
        
        // Try to send error message to user
        if (req.body.message) {
            let errorMessage = '❌ Sorry, something went wrong. Please try again!';
            
            if (error.message.includes('API configuration')) {
                errorMessage = '❌ Bot configuration error. Please contact support.';
            } else if (error.message.includes('too large') || error.message.includes('too_large')) {
                errorMessage = '❌ Image is too large. Please:\n• Send a lower resolution photo\n• Or crop the image to focus on the text\n• Or take the photo from further away';
            } else if (error.message.includes('rate')) {
                errorMessage = '❌ Too many requests. Please wait a moment and try again.';
            }
            
            await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: req.body.message.chat.id,
                        text: errorMessage
                    })
                }
            );
        }
        
        res.status(200).json({ ok: true }); // Always return 200 to Telegram
    }
}