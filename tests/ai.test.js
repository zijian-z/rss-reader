import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { extractAiText } from '../src/lib/rss.js';
import { aiInputHash, prepareAiText, assertAiCompleted, readResponsesEventStream } from '../src/lib/ai.js';
import { DEFAULT_CONFIG, DEFAULT_AI_CHINESE_PROMPT, DEFAULT_AI_TRANSLATION_PROMPT, normalizeLibrary } from '../src/lib/library.js';
const window = new Window();
globalThis.DOMParser = window.DOMParser;
const frame = payload => `data: ${JSON.stringify(payload)}\n\n`;
function response(text, chunks = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunks) controller.enqueue(bytes.slice(i, i + chunks));
    controller.close();
  } }));
}

test('AI text retains paragraph boundaries, lists and executable code whitespace', () => {
  const text = extractAiText('<p>First</p><p>Second<br>line</p><ul><li>One</li><li>Two</li></ul><pre>if (x &lt; 2) {\n  f();\n}</pre><script>evil()</script>');
  assert.match(text, /First\n\n\n\nSecond\nline/);
  assert.match(text, /- One[\s\S]*- Two/);
  assert.match(text, /```\nif \(x < 2\) {\n  f\(\);\n}\n```/);
  assert.doesNotMatch(text, /evil/);
  assert.throws(() => prepareAiText({ content: 'a'.repeat(60001) }), /超过/);
});

test('fingerprints track source, operation, prompts and endpoint; interrupted content is not restored', () => {
  const article = { title: '英文中的中文', content: '<p>body</p>' };
  const fingerprint = aiInputHash(article, DEFAULT_CONFIG);
  assert.notEqual(aiInputHash({ ...article, content: '<p>new body</p>' }, DEFAULT_CONFIG), fingerprint);
  assert.notEqual(aiInputHash({ ...article, title: 'English' }, DEFAULT_CONFIG), fingerprint);
  assert.notEqual(aiInputHash(article, { ...DEFAULT_CONFIG, aiChinesePrompt: 'new prompt' }), fingerprint);
  assert.notEqual(aiInputHash(article, { ...DEFAULT_CONFIG, aiWorkerUrl: 'https://other/ai/responses' }), fingerprint);
  const loaded = normalizeLibrary({ articles: [{ id: 'x', aiContent: '<p>partial</p>', aiGeneratedAt: '' }] });
  assert.equal(loaded.articles[0].aiContent, '');
});

test('stream handles fragmented UTF-8 and requires confirmed completion', async () => {
  let text = '';
  let final;
  await readResponsesEventStream(response(frame({ type: 'response.output_text.delta', delta: '你好' }) + frame({ type: 'response.completed', response: { status: 'completed', output: [] } })), {
    onDelta(delta) { text += delta; }, onCompleted(payload) { final = payload; },
  });
  assert.equal(text, '你好');
  assert.equal(final.status, 'completed');
  await assert.rejects(readResponsesEventStream(response(frame({ type: 'response.output_text.delta', delta: 'half' })), {}), /提前结束/);
  await assert.rejects(readResponsesEventStream(response(frame({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } })), {}), /token 上限/);
  await assert.rejects(readResponsesEventStream(response(frame({ type: 'response.failed', response: { error: { message: 'provider failed' } } })), {}), /失败/);
  assert.throws(() => assertAiCompleted({ status: 'incomplete' }), /不完整/);
});

test('stop and idle timeout cancel pending stream reads', async () => {
  let cancelled = 0;
  const stalled = () => new Response(new ReadableStream({ cancel() { cancelled++; } }));
  const controller = new AbortController();
  const pending = readResponsesEventStream(stalled(), {}, { signal: controller.signal });
  controller.abort(new Error('stopped'));
  await assert.rejects(pending, /stopped/);
  await assert.rejects(readResponsesEventStream(stalled(), {}, { idleTimeoutMs: 5 }), /超时/);
  assert.equal(cancelled, 2);
});

test('new defaults keep code and original lists and leave user-written prompts alone', () => {
  assert.match(DEFAULT_AI_TRANSLATION_PROMPT, /原文列表应保留/);
  assert.match(DEFAULT_AI_TRANSLATION_PROMPT, /不翻译或改写可执行代码/);
  assert.match(DEFAULT_AI_CHINESE_PROMPT, /其中的命令/);
  const config = normalizeLibrary({ config: { aiChinesePrompt: 'my own prompt' } }).config;
  assert.equal(config.aiChinesePrompt, 'my own prompt');
});

test('previous built-in prompts migrate on load while custom prompts survive', () => {
  const { aiChinesePrompt: chinese, aiTranslationPrompt: translation } = JSON.parse(readFileSync(new URL('./fixtures/legacy-prompts.json', import.meta.url)));
  const result = normalizeLibrary({ config: { aiChinesePrompt: chinese, aiTranslationPrompt: translation } });
  assert.equal(result.config.aiChinesePrompt, DEFAULT_AI_CHINESE_PROMPT);
  assert.equal(result.config.aiTranslationPrompt, DEFAULT_AI_TRANSLATION_PROMPT);
});
