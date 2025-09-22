// api/telegram.js - Telegram bot with Jimp for image resizing
const Jimp = require('jimp');

module.exports = async function handler(req, res) {
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
            // Get the highest resolution photo for best quality
            const photo = message.photo[message.photo.length - 1];
            const fileId = photo.file_id;
            
            console.log(`Processing highest resolution photo: ${photo.width}x${photo.height}`);
            
            // Get file path from Telegram
            const fileResponse = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
            );
            const fileData = await fileResponse.json();
            
            if (!fileData.ok) {
                throw new Error('Failed to get file from Telegram');
            }
            
            console.log('Original file size:', (fileData.result.file_size / 1024 / 1024).toFixed(2), 'MB');
            
            // Download the image
            const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
            const imageResponse = await fetch(imageUrl);
            
            if (!imageResponse.ok) {
                throw new Error('Failed to download image from Telegram');
            }
            
            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
            
            // Process image with Jimp (similar to canvas in browser)
            console.log('Resizing image with Jimp...');
            const image = await Jimp.read(imageBuffer);
            
            // Resize to max 1200x1200 maintaining aspect ratio
            const maxSize = 1200;
            const width = image.getWidth();
            const height = image.getHeight();
            
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    image.resize(maxSize, Jimp.AUTO);
                } else {
                    image.resize(Jimp.AUTO, maxSize);
                }
                console.log(`Resized from ${width}x${height} to ${image.getWidth()}x${image.getHeight()}`);
            }
            
            // Set quality to 70% (similar to website)
            image.quality(70);
            
            // Convert to buffer and then base64
            const resizedBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
            const base64Image = resizedBuffer.toString('base64');
            
            console.log('Final base64 size:', (base64Image.length / 1024 / 1024).toFixed(2), 'MB');
            
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
                    model: 'claude-3-5-sonnet-20241022',
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
                responseText = `🇨🇳 *Chinese to Pinyin Bot*\n\n📸 Send me a photo of Chinese text and I'll provide the pinyin pronunciation!\n\n*How to use:*\n1. Take or select a photo with Chinese characters\n2. Send it to me\n3. Get instant pinyin translation\n\n*Tips:*\n• Clear, well-lit photos work best\n• Avoid blurry or angled shots\n• I can handle menus, signs, and any Chinese text!`;
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