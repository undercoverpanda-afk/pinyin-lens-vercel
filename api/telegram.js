// api/telegram.js - Optimized without external dependencies
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
            // Strategy: Use the best quality photo that's under 3MB
            let selectedPhoto = null;
            let selectedIndex = -1;
            
            // Start from highest quality and work down to find one under 3MB
            for (let i = message.photo.length - 1; i >= 0; i--) {
                const photo = message.photo[i];
                // Estimate file size (rough estimate: width * height * 3 bytes for RGB)
                const estimatedSize = (photo.width * photo.height * 3) / 1024 / 1024; // in MB
                
                console.log(`Photo ${i}: ${photo.width}x${photo.height}, estimated ${estimatedSize.toFixed(2)}MB`);
                
                if (estimatedSize < 3) { // Under 3MB estimated
                    selectedPhoto = photo;
                    selectedIndex = i;
                    break;
                }
            }
            
            // If all are too large, use the middle resolution
            if (!selectedPhoto) {
                selectedIndex = Math.floor(message.photo.length / 2);
                selectedPhoto = message.photo[selectedIndex];
            }
            
            const fileId = selectedPhoto.file_id;
            console.log(`Selected photo ${selectedIndex + 1}/${message.photo.length}: ${selectedPhoto.width}x${selectedPhoto.height}`);
            
            // Get file path from Telegram
            const fileResponse = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
            );
            const fileData = await fileResponse.json();
            
            if (!fileData.ok) {
                throw new Error('Failed to get file from Telegram');
            }
            
            // Check actual file size
            const fileSizeMB = fileData.result.file_size / 1024 / 1024;
            console.log('Actual file size:', fileSizeMB.toFixed(2), 'MB');
            
            // If still too large, ask for a smaller image
            if (fileSizeMB > 4.5) {
                throw new Error('Image too large. Please send a smaller or lower resolution image.');
            }
            
            // Download the image
            const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
            const imageResponse = await fetch(imageUrl);
            
            if (!imageResponse.ok) {
                throw new Error('Failed to download image from Telegram');
            }
            
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = Buffer.from(imageBuffer).toString('base64');
            
            const base64SizeMB = base64Image.length / 1024 / 1024;
            console.log('Base64 size:', base64SizeMB.toFixed(2), 'MB');
            
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
            
            // Call Claude API with enhanced prompt for better accuracy
            const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': process.env.CLAUDE_API_KEY,
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-haiku-latest',
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
                                text: `Please carefully identify ALL Chinese characters in this image and provide their pinyin pronunciation. 

Important instructions:
- Look for Chinese characters anywhere in the image (menus, signs, labels, etc.)
- For each character or word, format as: Character (pinyin)
- If characters form words, you can group them: 词语 (cí yǔ)
- Include tone marks in the pinyin
- List each item on a new line
- Be thorough - don't miss any Chinese text
- If the image quality is poor for some characters, note that
- If no Chinese characters are found, please say so

Please examine the entire image carefully.`
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
                responseText = `🇨🇳 *Chinese to Pinyin Bot*\n\n📸 Send me a photo of Chinese text and I'll provide the pinyin pronunciation!\n\n*How to use:*\n1. Take or select a photo with Chinese characters\n2. Send it to me\n3. Get instant pinyin translation\n\n*Tips for best results:*\n• Use good lighting when taking photos\n• Make sure text is clear and in focus\n• Avoid extreme angles\n• For large menus, you can send multiple photos\n\n*I can translate:*\n• Restaurant menus\n• Street signs\n• Product labels\n• Any Chinese text!\n\nJust send me a photo to get started! 📷`;
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
                errorMessage = '❌ Image is too large. Please:\n• Send a lower resolution photo\n• Or take the photo from further away\n• Or crop to focus on specific text';
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