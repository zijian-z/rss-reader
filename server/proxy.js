import http from "node:http";
import { URL } from "node:url";

const port = Number(process.env.PORT || 8787);
const allowOrigin = process.env.ALLOW_ORIGIN || "*";
const allowedHosts = parseAllowedHosts(process.env.ALLOWED_HOSTS || "");
const maxBytes = Number(process.env.MAX_BYTES || 8 * 1024 * 1024);

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (requestUrl.pathname !== "/" && requestUrl.pathname !== "/rss") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Only GET is supported" });
    return;
  }

  try {
    const feedUrl = validateFeedUrl(requestUrl.searchParams.get("url"));
    const upstream = await fetch(feedUrl, {
      redirect: "follow",
      headers: {
        accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
        "user-agent": "RSS Reader Proxy/0.1",
      },
    });

    if (!upstream.ok) {
      sendJson(response, upstream.status, { error: `Upstream HTTP ${upstream.status}` });
      return;
    }

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      sendJson(response, 413, { error: "Feed is too large" });
      return;
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength > maxBytes) {
      sendJson(response, 413, { error: "Feed is too large" });
      return;
    }

    response.writeHead(200, {
      "content-type": upstream.headers.get("content-type") || "application/xml; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(Buffer.from(body));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Proxy request failed" });
  }
});

server.listen(port, () => {
  console.log(`RSS proxy listening on http://127.0.0.1:${port}/rss?url=`);
});

function validateFeedUrl(value) {
  const url = new URL(String(value || ""));

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  if (allowedHosts.size > 0 && !allowedHosts.has(url.hostname)) {
    throw new Error("Host is not allowed by ALLOWED_HOSTS");
  }

  return url.href;
}

function parseAllowedHosts(value) {
  return new Set(
    value
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", allowOrigin);
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("vary", "origin");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}
