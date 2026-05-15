const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-5.2";

export default {
  fetch(request, env = {}) {
    return handleProxyRequest(request, env);
  },
};

export async function handleProxyRequest(request, env = {}) {
  const config = readProxyConfig(env);
  const requestUrl = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(config),
    });
  }

  if (requestUrl.pathname === "/health") {
    return jsonResponse({ ok: true }, 200, config);
  }

  if (requestUrl.pathname === "/ai/health") {
    return jsonResponse({ ok: true, ai: true }, 200, config);
  }

  if (requestUrl.pathname === "/ai/responses") {
    return handleAiRequest(request, config);
  }

  if (requestUrl.pathname !== "/" && requestUrl.pathname !== "/rss") {
    return jsonResponse({ error: "Not found" }, 404, config);
  }

  if (request.method !== "GET") {
    return jsonResponse({ error: "Only GET is supported" }, 405, config);
  }

  try {
    const feedUrl = validateFeedUrl(requestUrl.searchParams.get("url"), config);
    const upstream = await fetch(feedUrl, {
      redirect: "follow",
      headers: {
        accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
        "user-agent": "RSS Reader Proxy/0.1",
      },
    });

    if (!upstream.ok) {
      return jsonResponse({ error: `Upstream HTTP ${upstream.status}` }, upstream.status, config);
    }

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > config.maxBytes) {
      return jsonResponse({ error: "Feed is too large" }, 413, config);
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength > config.maxBytes) {
      return jsonResponse({ error: "Feed is too large" }, 413, config);
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders(config),
        "content-type": upstream.headers.get("content-type") || "application/xml; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonResponse({ error: error.message || "Proxy request failed" }, 400, config);
  }
}

async function handleAiRequest(request, config) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Only POST is supported" }, 405, config);
  }

  const aiConfig = readAiConfig(config.env);

  if (!aiConfig.apiKey) {
    return jsonResponse({ error: "AI_API_KEY is not configured" }, 500, config);
  }

  try {
    const payload = await normalizeAiRequestPayload(request, aiConfig);
    const upstream = await fetch(`${aiConfig.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${aiConfig.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      return jsonResponse(await upstreamErrorPayload(upstream), upstream.status, config);
    }

    if (payload.stream) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...corsHeaders(config),
          "content-type": upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
          "cache-control": "no-store, no-transform",
        },
      });
    }

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        ...corsHeaders(config),
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonResponse({ error: error.message || "AI request failed" }, 400, config);
  }
}

export function readProxyConfig(env = {}) {
  return {
    env,
    allowOrigin: String(env.ALLOW_ORIGIN || "*"),
    allowCredentials: isTruthy(env.ALLOW_CREDENTIALS),
    allowedHosts: parseAllowedHosts(env.ALLOWED_HOSTS || ""),
    maxBytes: positiveNumber(env.MAX_BYTES, DEFAULT_MAX_BYTES),
  };
}

function readAiConfig(env = {}) {
  return {
    apiKey: String(env.AI_API_KEY || ""),
    baseUrl: normalizeBaseUrl(env.AI_BASE_URL || DEFAULT_AI_BASE_URL),
    model: String(env.AI_MODEL || DEFAULT_AI_MODEL),
    maxOutputTokens: positiveNumber(env.AI_MAX_OUTPUT_TOKENS, 12000),
  };
}

async function normalizeAiRequestPayload(request, aiConfig) {
  const payload = await request.json();

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid AI request payload");
  }

  return {
    ...payload,
    model: String(payload.model || aiConfig.model),
    max_output_tokens: positiveNumber(payload.max_output_tokens, aiConfig.maxOutputTokens),
    store: Boolean(payload.store),
    stream: Boolean(payload.stream),
  };
}

async function upstreamErrorPayload(upstream) {
  const text = await upstream.text();

  try {
    const result = JSON.parse(text);
    return { error: result?.error?.message || `AI upstream HTTP ${upstream.status}` };
  } catch {
    return { error: text || `AI upstream HTTP ${upstream.status}` };
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_AI_BASE_URL));
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/+$/, "");
}

function validateFeedUrl(value, config) {
  const url = new URL(String(value || ""));

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  if (config.allowedHosts.size > 0 && !config.allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Host is not allowed by ALLOWED_HOSTS");
  }

  return url.href;
}

function parseAllowedHosts(value) {
  return new Set(
    String(value)
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function corsHeaders(config) {
  const headers = {
    "access-control-allow-origin": config.allowOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };

  if (config.allowCredentials && config.allowOrigin !== "*") {
    headers["access-control-allow-credentials"] = "true";
  }

  return headers;
}

function jsonResponse(payload, status, config) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(config),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
