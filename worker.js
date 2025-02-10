// 部署时需要设置环境变量 HF_API_KEYS，值格式为每行一个API key
// 新增环境变量 WORKER_AUTH_KEY 用于接口鉴权
export default {
  async fetch(request, env) {
    // 处理CORS预检请求
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    // 新增鉴权验证逻辑
    const authHeader = request.headers.get('Authorization');
    const expectedToken = `Bearer ${env.WORKER_AUTH_KEY}`;
    
    if (!authHeader || authHeader.trim() !== expectedToken) {
      return new Response(JSON.stringify({
        error: {
          message: "Unauthorized",
          type: "invalid_request_error"
        }
      }), { 
        status: 401,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*" 
        }
      });
    }

    const url = new URL(request.url);
    
    // 处理模型列表请求（保留原有逻辑）
    if (url.pathname === "/v1/models" && request.method === "GET") {
      return jsonResponse({
        object: "list",
        data: [
          {
            id: "deepseek-ai/DeepSeek-R1",
            object: "model",
            created: 1686935002,
            owned_by: "openai"
          },
        ]
      });
    }

    // 只处理聊天补全的POST请求
    if (request.method !== "POST" || !url.pathname.startsWith("/v1/chat/completions")) {
      return new Response("Not Found", { 
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    try {
      const apiKeys = (env.HF_API_KEYS || "").split("\n").filter(k => k.trim());
      if (apiKeys.length === 0) {
        throw new Error("No API keys configured");
      }

      const requestData = await request.json();
      const headers = Object.fromEntries(request.headers);
      requestData.model = "deepseek-ai/DeepSeek-R1"; 
      delete headers.authorization;
      delete headers.host;

      for (const apiKey of apiKeys) {
        try {
          const hfResponse = await fetchToHF(apiKey, requestData);
          
          if (hfResponse.status >= 400) {
            const error = await hfResponse.json().catch(() => ({}));
            // 改进错误信息提取逻辑
            if (error.error) {
              let errorMsg = error.error;
              if (typeof errorMsg !== 'string') {
                errorMsg = errorMsg.message || JSON.stringify(errorMsg);
              }
              throw new Error(errorMsg);
            }
            throw new Error(`HTTP Error ${hfResponse.status}`);
          }

          if (requestData.stream) {
            return streamResponse(hfResponse);
          }

          return jsonResponse(await hfResponse.json());
          
        } catch (error) {
          console.log(`Key failed: ${error.message}`);
          if (apiKey === apiKeys[apiKeys.length - 1]) {
            throw error;
          }
        }
      }
    } catch (error) {
      return new Response(JSON.stringify({
        error: {
          message: `Starrina Proxy Error`, // 确保此处显示正确错误信息
          type: "invalid_request_error"
        }
      }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};

// 转发到HuggingFace API
async function fetchToHF(apiKey, body) {
  return fetch("https://huggingface.co/api/inference-proxy/together/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

// 处理流式响应
function streamResponse(response) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder(); // 初始化TextDecoder

  (async () => {
    const reader = response.body.getReader();
    try { // 添加try-catch捕获异步处理中的错误
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        writer.write(encoder.encode(chunk));
      }
      writer.close();
    } catch (error) {
      console.error('Stream error:', error);
      writer.abort(error);
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

// 处理JSON响应
function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// CORS处理
function handleOptions(request) {
  const headers = request.headers;
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": headers.get("Origin") || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": headers.get("Access-Control-Request-Headers") || "Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}
