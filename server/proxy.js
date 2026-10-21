import { waitForAi } from "../shared/ai-timeouts.js";
import { MAX_AI_CONTENT_CHARS, MAX_AI_PROMPT_CHARS, MAX_AI_REQUEST_BYTES, AI_FIRST_RESPONSE_TIMEOUT_MS, AI_IDLE_TIMEOUT_MS, AI_TOTAL_TIMEOUT_MS } from "../shared/ai-limits.js";

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export default {
  fetch(request, env = {}) {
    const { pathname } = new URL(request.url);
    const isApi = pathname === "/rss" || pathname.startsWith("/rss/") ||
      pathname === "/health" || pathname === "/ai" || pathname.startsWith("/ai/");

    if (isApi) return handleProxyRequest(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
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
    try {
      const aiConfig = readAiConfig(env);
      return jsonResponse({ ok: true, ai: true, providerHash: await providerHash(aiConfig) }, 200, config);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500, config);
    }
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

  let aiConfig;
  try {
    aiConfig = readAiConfig(config.env);
  } catch (error) {
    return jsonResponse({ error: error.message }, 500, config);
  }

  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const totalTimer = setTimeout(() => controller.abort(new Error("AI request timed out")), AI_TOTAL_TIMEOUT_MS);
  const firstTimer = setTimeout(() => controller.abort(new Error("AI first response timed out")), AI_FIRST_RESPONSE_TIMEOUT_MS);
  let streaming = false;
  const cleanup = () => {
    clearTimeout(firstTimer);
    clearTimeout(totalTimer);
    request.signal.removeEventListener("abort", abort);
  };
  try {
    const payload = await normalizeAiRequestPayload(request, aiConfig, controller.signal);
    const cacheHash = await providerHash(aiConfig);
    const upstream = await waitForAi(fetch(`${aiConfig.baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${aiConfig.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }), controller.signal, AI_FIRST_RESPONSE_TIMEOUT_MS);

    clearTimeout(firstTimer);

    if (!upstream.ok) {
      return jsonResponse(await waitForAi(upstreamErrorPayload(upstream), controller.signal), upstream.status, config);
    }

    if (payload.stream && upstream.ok) {
      if (!upstream.body || !(upstream.headers.get("content-type") || "").includes("text/event-stream")) {
        throw new Error("AI upstream did not return an event stream");
      }
      streaming = true;
      return new Response(streamAiBody(upstream.body, controller, cleanup), {
        status: upstream.status,
        headers: {
          ...corsHeaders(config),
          "content-type": "text/event-stream; charset=utf-8",
          "x-ai-provider-hash": cacheHash,
          "cache-control": "no-store, no-transform",
        },
      });
    }

    return new Response(await waitForAi(upstream.text(), controller.signal), {
      status: upstream.status,
      headers: {
        ...corsHeaders(config),
        "content-type": "application/json; charset=utf-8",
        "x-ai-provider-hash": cacheHash,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const status = error.status || (controller.signal.aborted || /超时|timed out/.test(error.message) ? 504 : 502);
    controller.abort(error);
    return jsonResponse({ error: error.message || "AI request failed" }, status, config);
  } finally {
    if (!streaming) cleanup();
  }
}

export function readProxyConfig(env = {}) {
  return {
    env,
    allowOrigin: String(env.ALLOW_ORIGIN || ""),
    allowCredentials: isTruthy(env.ALLOW_CREDENTIALS),
    allowedHosts: parseAllowedHosts(env.ALLOWED_HOSTS || ""),
    maxBytes: positiveNumber(env.MAX_BYTES, DEFAULT_MAX_BYTES),
  };
}

function readAiConfig(env = {}) {
  for (const key of ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL"]) {
    if (!String(env[key] || "").trim()) throw new Error(`${key} is not configured`);
  }
  return {
    apiKey: String(env.AI_API_KEY || ""),
    baseUrl: normalizeBaseUrl(env.AI_BASE_URL),
    model: String(env.AI_MODEL).trim(),
    maxOutputTokens: Math.max(1, Math.floor(positiveNumber(env.AI_MAX_OUTPUT_TOKENS, 12000))),
  };
}

function invalidRequest(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function normalizeAiRequestPayload(request, aiConfig, signal) {
  if (Number(request.headers.get("content-length")) > MAX_AI_REQUEST_BYTES) {
    throw invalidRequest("AI request body is too large", 413);
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await waitForAi(reader.read(), signal);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_AI_REQUEST_BYTES) throw invalidRequest("AI request body is too large", 413);
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  let payload;
  try { payload = JSON.parse(text); } catch { throw invalidRequest("Invalid JSON payload"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw invalidRequest("Invalid AI request payload");
  if (typeof payload.input !== "string" || !payload.input.trim()) throw invalidRequest("input must be non-empty article text");
  if (payload.input.length > MAX_AI_CONTENT_CHARS) throw invalidRequest("Article exceeds 60000 characters; no content was truncated", 413);
  if (payload.instructions !== undefined && typeof payload.instructions !== "string") throw invalidRequest("instructions must be text");
  if ((payload.instructions || "").length > MAX_AI_PROMPT_CHARS) throw invalidRequest("instructions are too long", 413);
  return {
    // Only these fields can reach the paid API. Ignore tools, provider overrides, storage, etc.
    input: payload.input,
    instructions: payload.instructions || "",
    model: aiConfig.model,
    max_output_tokens: Math.min(aiConfig.maxOutputTokens, Math.max(1, Math.floor(positiveNumber(payload.max_output_tokens, aiConfig.maxOutputTokens)))),
    store: false,
    stream: payload.stream === true,
  };
}

async function providerHash(config) {
  const value = JSON.stringify([config.baseUrl, config.model, config.maxOutputTokens]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function streamAiBody(body, controller, cleanup) {
  const reader = body.getReader();
  let finished = false;
  const finish = () => { if (!finished) { finished = true; cleanup(); } };
  return new ReadableStream({
    async pull(stream) {
      const timer = setTimeout(() => controller.abort(new Error("AI stream idle timeout")), AI_IDLE_TIMEOUT_MS);
      try {
        const { done, value } = await waitForAi(reader.read(), controller.signal);
        if (done) { finish(); reader.releaseLock(); stream.close(); }
        else stream.enqueue(value);
      } catch (error) {
        finish();
        controller.abort(error);
        reader.cancel().catch(() => {});
        stream.error(error);
      } finally { clearTimeout(timer); }
    },
    async cancel(reason) {
      controller.abort(reason);
      finish();
      await reader.cancel(reason);
    },
  });
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
  const url = new URL(String(value).trim());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("AI_BASE_URL must use http or https");
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
  if (!config.allowOrigin) return {};

  const headers = {
    "access-control-allow-origin": config.allowOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-expose-headers": "x-ai-provider-hash",
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
