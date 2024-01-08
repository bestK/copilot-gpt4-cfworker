addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {

  const url = new URL(request.url);

  const fetchAPI = request.url.replace(url.host, 'api.githubcopilot.com').replace('/v1', '');
 
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
 
  if (['HEAD', 'GET'].includes(request.method)) return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  let authKey = request.headers.get('Authorization');
  if (!authKey) return new Response("Not allowed", { status: 403, headers: corsHeaders });

  authKey = await getCopilotToken(authKey)

  if (isExpKey(authKey)) return new Response("Key Expiration", { status: 403, headers: corsHeaders });
 
  try {
    let contentType = request.headers.get('Content-Type')
    if (contentType && contentType.startsWith("multipart/form-data")) {
      let newRequest = new Request(fetchAPI, request);
      return await fetch(newRequest);
    }

    let body;
    if (request.method === 'POST') body = await request.json();

    const copilotHeaders = {
      "editor-version": "vscode/1.84.2",
      "editor-plugin-version": "copilot-chat/0.10.1",
      "openai-organization": "github-copilot",
      "openai-intent": "conversation-panel"
    }

    const payload = {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authKey}`,
        ...copilotHeaders
      },
      body: typeof body === 'object' ? JSON.stringify(body) : '{}',
      stream: body ? body.stream : false
    };

    const response = await fetch(fetchAPI, payload);

    if (response.status != 200) return response;

    if (body && body.stream && body.stream !== true) {
      const results = await response.json();
      return new Response(JSON.stringify(results), {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        },
      });
    } else {
      let newHeaders = new Headers({ ...response.headers, ...corsHeaders })
      newHeaders.delete("Content-Type")
      newHeaders.append("Content-Type", "text/event-stream")

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
  } catch (error) {
    return new Response(error.message, { headers: { ...corsHeaders }, status: 500 });
  }
}


/**
 * 是否过期 token
 */

function isExpKey(authKey) {
  try {
    const currentTime = Math.floor(Date.now() / 1000)
    const expValue = Number(authKey.split(";")[1].split("exp=")[1])
    return expValue !== null && currentTime > expValue
  } catch (error) {
    return true
  }
}


/**
 * 获取 copilot token
 */
async function getCopilotToken(authKey) {
  const cacheKey = authKey.split("Bearer ")[1]

  // @ts-ignore
  const oldAuthKey = await KV.get(cacheKey)
  if (oldAuthKey && oldAuthKey != null) {
    // @ts-ignore
    return oldAuthKey
  }

  try {
    const url = 'https://copilot.vercel.app/api/get_copilot_token'

    const payload = {
      method: "get",
      headers: {
        "authorization": authKey,

      }
    };

    const response = await fetch(url, payload);

    if (response.status != 200) {
      return response.body
    }
    const { token, refresh_in } = await response.json()
    // @ts-ignore
    await KV.put(cacheKey, token, { expirationTtl: refresh_in })
    return token
  } catch (error) {
    return "error:" + error.message
  }
}
