import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/proxy.js';
import { normalizeLibrary, normalizeConfigImport } from '../src/lib/library.js';

const request = (path, init) => new Request(`https://reader.example${path}`, init);

test('homepage and frontend assets use ASSETS, while API paths never fall through', async () => {
  const seen = [];
  const env = { ASSETS: { fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response('frontend'); } } };
  for (const path of ['/', '/assets/app.js']) {
    assert.equal(await (await worker.fetch(request(path), env)).text(), 'frontend');
  }
  assert.deepEqual(await (await worker.fetch(request('/health'), env)).json(), { ok: true });
  assert.equal((await worker.fetch(request('/ai/missing'), env)).status, 404);
  assert.equal((await worker.fetch(request('/rss/missing'), env)).status, 404);
  assert.equal((await worker.fetch(request('/rss'), env)).status, 400);
  assert.deepEqual(seen, ['/', '/assets/app.js']);
});

test('RSS and streamed AI responses retain backend behavior on the same origin', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/responses')) {
      assert.equal(String(url), 'https://openrouter.ai/api/v1/responses');
      assert.equal(JSON.parse(init.body).model, 'provider/model');
      assert.equal(init.headers.authorization, 'Bearer test-key');
      assert.equal(JSON.parse(init.body).stream, true);
      return new Response('data: {"delta":"hello"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }
    assert.equal(String(url), 'https://feed.example/rss');
    return new Response('<rss/>', { headers: { 'content-type': 'application/xml' } });
  });
  const rss = await worker.fetch(request('/rss?url=https%3A%2F%2Ffeed.example%2Frss'));
  assert.equal(await rss.text(), '<rss/>');
  assert.equal(rss.headers.has('access-control-allow-origin'), false);
  const ai = await worker.fetch(request('/ai/responses', { method: 'POST', body: JSON.stringify({ input: 'article', stream: true }) }), { AI_API_KEY: 'test-key', AI_BASE_URL: 'https://openrouter.ai/api/v1/', AI_MODEL: 'provider/model' });
  assert.match(ai.headers.get('content-type'), /text\/event-stream/);
  assert.equal(await ai.text(), 'data: {"delta":"hello"}\n\n');
});

test('saved and imported legacy defaults migrate without replacing custom endpoints', () => {
  const legacy = { config: { proxyTemplate: 'https://api.plunox.site/rss?url={url}', aiWorkerUrl: 'https://api.plunox.site/ai/responses' } };
  for (const normalize of [normalizeLibrary, normalizeConfigImport]) {
    const migrated = normalize(legacy).config;
    assert.equal(migrated.proxyTemplate, '/rss?url={url}');
    assert.equal(migrated.aiWorkerUrl, '/ai/responses');
    const custom = normalize({ schemaVersion: 2, config: { proxyTemplate: '', aiWorkerUrl: 'https://custom.example/ai/responses' } }).config;
    assert.equal(custom.proxyTemplate, '');
    assert.equal(custom.aiWorkerUrl, 'https://custom.example/ai/responses');
  }
});

test('missing provider settings fail before contacting an upstream', async (t) => {
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected upstream'); });
  for (const key of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL']) {
    const env = { AI_API_KEY: 'test-key', AI_BASE_URL: 'https://provider.example/v1', AI_MODEL: 'provider/model' };
    delete env[key];
    const response = await worker.fetch(request('/ai/responses', { method: 'POST', body: '{}' }), env);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, `${key} is not configured`);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

const provider = { AI_API_KEY: 'test-key', AI_BASE_URL: 'https://provider.example/v1', AI_MODEL: 'fixed/model', AI_MAX_OUTPUT_TOKENS: '2000' };
const aiRequest = payload => request('/ai/responses', { method: 'POST', body: JSON.stringify(payload) });

test('paid API enforces configured model/token ceiling and a strict field allowlist', async (t) => {
  const upstream = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const payload = JSON.parse(init.body);
    assert.deepEqual(Object.keys(payload).sort(), ['input', 'instructions', 'max_output_tokens', 'model', 'store', 'stream']);
    assert.equal(payload.model, provider.AI_MODEL);
    assert.equal(payload.max_output_tokens, 2000);
    assert.equal(payload.store, false);
    return Response.json({ status: 'completed', output: [] });
  });
  const response = await worker.fetch(aiRequest({ input: 'article', model: 'very/expensive', max_output_tokens: 1000000, store: true, tools: [{ type: 'web_search' }], provider: { order: ['anything'] } }), provider);
  assert.equal(response.status, 200);
  assert.equal(upstream.mock.callCount(), 1);
});

test('oversized, structured and invalid inputs never reach the paid API', async (t) => {
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected API call'); });
  for (const [payload, status] of [
    [{ input: 'a'.repeat(60001) }, 413],
    [{ input: 'article', instructions: 'a'.repeat(16001) }, 413],
    [{ input: [{ role: 'user', content: 'unbounded conversation' }] }, 400],
    [{ input: '' }, 400],
    [[], 400],
    [{ input: 'article', extra: 'a'.repeat(400000) }, 413],
  ]) {
    assert.equal((await worker.fetch(aiRequest(payload), provider)).status, status);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('health and responses identify provider changes without exposing credentials', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'completed' }));
  const original = await (await worker.fetch(request('/ai/health'), provider)).json();
  const changed = await (await worker.fetch(request('/ai/health'), { ...provider, AI_MODEL: 'new/model' })).json();
  assert.notEqual(original.providerHash, changed.providerHash);
  assert.doesNotMatch(JSON.stringify(original), /test-key|fixed\/model/);
  const result = await worker.fetch(aiRequest({ input: 'article' }), provider);
  assert.equal(result.headers.get('x-ai-provider-hash'), original.providerHash);
});

test('cancelling an AI response aborts the paid upstream and closes its stream', async (t) => {
  let upstreamSignal;
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    upstreamSignal = init.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const result = await worker.fetch(aiRequest({ input: 'article', stream: true }), provider);
  await result.body.cancel('user stopped');
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
});
