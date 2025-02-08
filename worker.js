// 部署时需要设置环境变量 HF_API_KEYS，值格式为每行一个API key
// 示例值：
// hf_key1
// hf_key2
// hf_key3

export default {
  async fetch(request, env) {
    // 处理CORS预检请求
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    
    // 处理模型列表请求
    if (url.pathname === "/v1/models" && request.method === "GET") {
      return jsonResponse({
        object: "list",
        data: [
          {
            id: "llama/llama-4-70b",
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
      // 获取所有可用的API Key
      const apiKeys = (env.HF_API_KEYS || "").split("\n").filter(k => k.trim());
      if (apiKeys.length === 0) {
        throw new Error("No API keys configured");
      }

      // 克隆原始请求数据
      const requestData = await request.json();
      const headers = Object.fromEntries(request.headers);
      delete headers.authorization; // 移除客户端可能自带的授权头

      // 尝试各个API Key直到成功
      for (const apiKey of apiKeys) {
        try {
          const hfResponse = await fetchToHF(apiKey, headers, requestData);
          
          // 如果响应错误，抛出以尝试下一个key
          if (hfResponse.status >= 400) {
            const error = await hfResponse.json().catch(() => ({}));
            if (error.error) throw new Error(error.error);
            throw new Error(`HTTP Error ${hfResponse.status}`);
          }

          // 处理流式响应
          if (requestData.stream) {
            return streamResponse(hfResponse);
          }

          // 处理普通响应
          return jsonResponse(await hfResponse.json());
          
        } catch (error) {
          console.log(`Key failed: ${error.message}`);
          // 最后一个key也失败时抛出错误
          if (apiKey === apiKeys[apiKeys.length - 1]) {
            throw error;
          }
        }
      }
    } catch (error) {
      return new Response(JSON.stringify({
        error: {
          message: `Proxy Error: ${error.message}`,
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
async function fetchToHF(apiKey, headers, body) {
  return fetch("https://huggingface.co/api/inference-proxy/together/v1/chat/completions", {
    method: "POST",
    headers: {
      ...headers,
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

  (async () => {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value).replace(/^data: /, 'data: ');
      writer.write(encoder.encode(chunk));
    }
    writer.close();
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