// api/translate.js (Vercel serverless function)
export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    
    try {
        // Parse the request body
        const { image, mimeType } = req.body;
        
        if (!image) {
            return res.status(400).json({ error: 'No image data provided' });
        }
        
        // Check if API key exists
        if (!process.env.CLAUDE_API_KEY) {
            console.error('CLAUDE_API_KEY environment variable is not set');
            return res.status(500).json({ error: 'Server configuration error: API key not found' });
        }
        
        // Call Claude API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.CLAUDE_API_KEY,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType || 'image/png',
                                data: image
                            }
                        },
                        {
                            type: 'text',
                            text: 'Provide the pinyin pronunciation for all chinese charecters in this image. Only provide characters and pinyin, don't provide additional commentarty or explanations. Detail when translations from new columns begin. Include numbers if there are any. If no Chinese characters are found, please say so.'
                        }
                    ]
                }]
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Claude API error:', response.status, errorText);
            
            let errorMessage = 'Claude API error';
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.error?.message || errorData.message || errorText;
            } catch {
                errorMessage = errorText;
            }
            
            return res.status(response.status).json({ error: `API Error: ${errorMessage}` });
        }
        
        const result = await response.json();
        
        if (!result.content || !result.content[0] || !result.content[0].text) {
            console.error('Unexpected API response structure:', result);
            return res.status(500).json({ error: 'Unexpected response format from API' });
        }
        
        // Send plain text response
        res.status(200).send(result.content[0].text);
        
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({ error: `Translation failed: ${error.message}` });
    }
}
