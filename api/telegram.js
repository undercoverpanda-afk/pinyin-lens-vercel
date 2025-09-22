// api/telegram.js - Telegram bot webhook
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
            // Get the highest resolution photo
            const photo = message.photo[message.photo.length - 1];
            const fileId = photo.file_id;
            
            // Get file path from Telegram
            const fileResponse = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
            );
            const fileData = await fileResponse.json();
            
            if (!fileData.ok) {
                throw new Error('Failed to get file from Telegram');
            }
            
            // Download the image
            const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
            const imageResponse = await fetch(imageUrl);
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = Buffer.from(imageBuffer).toString('base64');
            
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
                throw new Error('Failed to get translation from Claude');
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
        
        // Try to send error message to user
        if (req.body.message) {
            await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: req.body.message.chat.id,
                        text: '❌ Sorry, something went wrong. Please try again!'
                    })
                }
            );
        }
        
        res.status(200).json({ ok: true }); // Always return 200 to Telegram
    }
}