import http from "node:http";
import { handleProxyRequest } from "./proxy.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8787);

const server = http.createServer(async (request, response) => {
  try {
    const proxyResponse = await handleProxyRequest(toFetchRequest(request), {
      ALLOW_ORIGIN: process.env.ALLOW_ORIGIN,
      ALLOW_CREDENTIALS: process.env.ALLOW_CREDENTIALS,
      ALLOWED_HOSTS: process.env.ALLOWED_HOSTS,
      MAX_BYTES: process.env.MAX_BYTES,
      AI_API_KEY: process.env.AI_API_KEY,
      AI_BASE_URL: process.env.AI_BASE_URL,
      AI_MODEL: process.env.AI_MODEL,
      AI_MAX_OUTPUT_TOKENS: process.env.AI_MAX_OUTPUT_TOKENS,
    });

    response.writeHead(proxyResponse.status, Object.fromEntries(proxyResponse.headers));

    if (!proxyResponse.body) {
      response.end();
      return;
    }

    for await (const chunk of proxyResponse.body) {
      response.write(Buffer.from(chunk));
    }

    response.end();
  } catch (error) {
    response.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ error: error.message || "Proxy request failed" }));
  }
});

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`RSS proxy listening on http://${displayHost}:${port}/rss?url=`);
});

function toFetchRequest(request) {
  const origin = `http://${request.headers.host || `${host}:${port}`}`;
  const url = new URL(request.url || "/", origin);
  const method = request.method || "GET";
  const init = {
    method,
    headers: toFetchHeaders(request.headers),
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = request;
    init.duplex = "half";
  }

  return new Request(url, init);
}

function toFetchHeaders(nodeHeaders) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return headers;
}
