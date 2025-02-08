const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*'
};

async function handleRequest(request, HF_TOKEN) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    }

    try {
        const data = await request.json();
        
        // 基本参数校验
        if (!data.model || !data.messages) {
            return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
                status: 400,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
            });
        }

        const hfUrl = 'https://huggingface.co/api/inference-proxy/together/v1/chat/completions';
        const hfHeaders = {
            'Authorization': `Bearer ${HF_TOKEN}`,
            'Content-Type': 'application/json'
        };

        // 转换请求格式
        const payload = {
            model: data.model,
            messages: data.messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            stream: data.stream || false,
            // 添加其他可能需要的参数
            temperature: data.temperature,
            max_tokens: data.max_tokens
        };

        const hfResponse = await fetch(hfUrl, {
            method: 'POST',
            headers: hfHeaders,
            body: JSON.stringify(payload)
        });

        // 处理流式响应
        if (payload.stream) {
            return new Response(hfResponse.body, {
                headers: { 
                    ...CORS_HEADERS,
                    ...Object.fromEntries(hfResponse.headers) 
                }
            });
        }

        // 处理普通响应
        const result = await hfResponse.json();
        return new Response(JSON.stringify(result), {
            headers: { 
                ...CORS_HEADERS,
                'Content-Type': 'application/json' 
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    }
}

export default {
    async fetch(request, env) {
        return handleRequest(request, env.HF_TOKEN);
    }
};
