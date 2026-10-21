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
  const ai = await worker.fetch(request('/ai/responses', { method: 'POST', body: JSON.stringify({ input: 'article', stream: true }) }), { AI_API_KEY: 'test-key' });
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
