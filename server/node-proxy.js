import http from "node:http";
import { handleProxyRequest } from "./proxy.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8787);

const server = http.createServer(async (request, response) => {
  try {
    const proxyResponse = await handleProxyRequest(toFetchRequest(request), {
      ALLOW_ORIGIN: process.env.ALLOW_ORIGIN,
      ALLOWED_HOSTS: process.env.ALLOWED_HOSTS,
      MAX_BYTES: process.env.MAX_BYTES,
    });

    response.writeHead(proxyResponse.status, Object.fromEntries(proxyResponse.headers));
    response.end(Buffer.from(await proxyResponse.arrayBuffer()));
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

  return new Request(url, {
    method: request.method,
    headers: toFetchHeaders(request.headers),
  });
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
