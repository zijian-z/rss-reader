import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { extractAiText } from '../src/lib/rss.js';
import { extractAiOutputText, aiInputHash, prepareAiText, assertAiCompleted, readResponsesEventStream } from '../src/lib/ai.js';
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

// Reproduces providers returning both reasoning_text and output_text in the final response.
test('final extraction excludes reasoning, summaries and tool output even if they contain HTML headings', () => {
  const translated = '<h2>全文翻译</h2><p>正确译文。</p>';
  const reasoning = { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'Internal drafting mentions <h2>全文翻译</h2> but is not the answer.' }], summary: [{ type: 'summary_text', text: 'Not article content' }] };
  const payload = { status: 'completed', output: [
    reasoning,
    { type: 'function_call', text: 'tool text' },
    { type: 'message', role: 'user', content: [{ type: 'output_text', text: 'not the assistant answer' }] },
    { type: 'message', role: 'assistant', content: [
      { type: 'reasoning_text', text: 'still not the answer' },
      { type: 'output_text', text: translated },
    ] },
  ] };
  assert.equal(extractAiOutputText(payload), translated);
  assert.equal(extractAiOutputText(reasoning), '');
  assert.equal(extractAiOutputText({ type: 'reasoning_text', text: 'draft' }), '');
  assert.equal(extractAiOutputText({ output: [reasoning] }), '');
  assert.equal(extractAiOutputText({ text: 'unknown field' }), '');
  assert.equal(extractAiOutputText({ output_text: translated }), translated);
});

test('reasoning stream events and completed-response reasoning never enter the rendered text', async () => {
  const answer = '<h2>全文翻译</h2><p>最终译文。</p>';
  const completed = { status: 'completed', output: [
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: '<h2>全文翻译</h2> Drafting notes' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] },
  ] };
  const events = [
    { type: 'response.reasoning_text.delta', delta: 'Drafting notes', choices: [{ delta: { content: 'never use generic chat fallback' } }] },
    { type: 'response.reasoning_text.done', text: 'Drafting notes' },
    { type: 'response.output_item.done', item: completed.output[0] },
    { type: 'response.output_text.delta', delta: answer },
    { type: 'response.output_text.done', text: answer },
    { type: 'response.completed', response: completed },
  ];
  let streamed = '';
  let done = '';
  let final = '';
  await readResponsesEventStream(response(events.map(frame).join(''), 7), {
    onDelta(text) { streamed += text; },
    onTextDone(text) { done = text; },
    onCompleted(payload) { final = extractAiOutputText(payload); },
  });
  assert.equal(streamed, answer);
  assert.equal(done, answer);
  assert.equal(final, answer);
  assert.equal(final.match(/<h2>/g).length, 1);
});
