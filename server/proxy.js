const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

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

export function readProxyConfig(env = {}) {
  return {
    allowOrigin: String(env.ALLOW_ORIGIN || "*"),
    allowedHosts: parseAllowedHosts(env.ALLOWED_HOSTS || ""),
    maxBytes: positiveNumber(env.MAX_BYTES, DEFAULT_MAX_BYTES),
  };
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

function corsHeaders(config) {
  return {
    "access-control-allow-origin": config.allowOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
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
