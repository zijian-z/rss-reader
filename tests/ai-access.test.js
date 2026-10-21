import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAiAccessResponse, aiFailureNotice } from '../src/lib/ai-access.js';

test('Access redirects show a login action without requiring the auth setting', () => {
  for (const response of [{ type: 'opaqueredirect', status: 0 }, { type: 'basic', status: 302 }]) {
    let error;
    try { assertAiAccessResponse(response); } catch (caught) { error = caught; }
    assert.equal(aiFailureNotice(error).login, true);
    assert.match(aiFailureNotice(error).message, /登录 Cloudflare Access/);
  }
  assert.doesNotThrow(() => assertAiAccessResponse({ type: 'basic', status: 200 }));
});

test('blocked fetch offers login but does not assume all network failures mean expired sessions', () => {
  const notice = aiFailureNotice(new TypeError('Failed to fetch'));
  assert.equal(notice.login, true);
  assert.match(notice.message, /如果已启用/);
  assert.doesNotMatch(notice.message, /Failed to fetch|登录已失效/);
});

test('JSON provider errors and user cancellation do not send users to Access', () => {
  const providerError = Object.assign(new Error('OpenRouter API key invalid'), { status: 401, hasJsonPayload: true });
  assert.equal(aiFailureNotice(providerError, { accessMode: true }).login, false);
  assert.equal(aiFailureNotice(providerError).message, 'OpenRouter API key invalid');
  assert.equal(aiFailureNotice(new Error('stopped'), { aborted: true }).login, false);
});
