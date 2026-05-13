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
    const payload = await request.json();
    const article = normalizeAiArticlePayload(payload);
    const upstream = await fetch(`${aiConfig.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${aiConfig.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: aiConfig.model,
        instructions: buildAiInstructions(),
        input: buildAiInput(article),
        store: false,
      }),
    });
    const result = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      return jsonResponse(
        { error: result?.error?.message || `AI upstream HTTP ${upstream.status}` },
        upstream.status,
        config,
      );
    }

    const outputText = extractResponseText(result);

    if (!outputText) {
      return jsonResponse({ error: "AI response did not include output text" }, 502, config);
    }

    return jsonResponse({ html: outputText }, 200, config);
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
  };
}

function normalizeAiArticlePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid AI payload");
  }

  return {
    title: String(payload.title || "无标题").slice(0, 500),
    author: String(payload.author || "").slice(0, 200),
    publishedAt: String(payload.publishedAt || "").slice(0, 120),
    url: String(payload.url || "").slice(0, 1000),
    content: String(payload.content || "").slice(0, 24000),
  };
}

function buildAiInstructions() {
  return [
    "你是 RSS 阅读器内置的中文阅读助手。",
    "判断文章主要语言：如果不是中文，先翻译成自然、准确的简体中文，再总结；如果是中文，只总结。",
    "输出必须是可直接插入页面的 HTML 片段，不要 Markdown，不要代码围栏。",
    "只允许使用 h2、h3、p、ul、ol、li、strong、em、blockquote 标签。",
    "结构固定：先给出 h2 标题“AI 摘要”；如果原文不是中文，再给出 h2 标题“中文翻译”。",
    "摘要要覆盖核心事实、背景、结论和不确定性，避免编造原文没有的信息。",
  ].join("\n");
}

function buildAiInput(article) {
  return [
    `标题：${article.title}`,
    article.author ? `作者：${article.author}` : "",
    article.publishedAt ? `发布时间：${article.publishedAt}` : "",
    article.url ? `原文链接：${article.url}` : "",
    "",
    "文章内容：",
    article.content || article.title,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractResponseText(result) {
  if (typeof result?.output_text === "string") {
    return result.output_text.trim();
  }

  if (!Array.isArray(result?.output)) {
    return "";
  }

  return result.output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((content) => content?.text || "")
    .join("\n")
    .trim();
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
