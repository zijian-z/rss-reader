import { waitForAi } from "../../shared/ai-timeouts.js";
export { waitForAi } from "../../shared/ai-timeouts.js";
import { hashString, extractAiText } from "./rss.js";
import { DEFAULT_AI_CHINESE_PROMPT, DEFAULT_AI_TRANSLATION_PROMPT } from "./library.js";
import { MAX_AI_CONTENT_CHARS, AI_IDLE_TIMEOUT_MS } from "../../shared/ai-limits.js";
export const AI_CACHE_VERSION = "structured-responses-v2";

export function aiInputHash(article, config) {
  const chinese = /[\u3400-\u9fff\uf900-\ufaff]/.test(article?.title || "");
  const prompt = chinese ? config.aiChinesePrompt || DEFAULT_AI_CHINESE_PROMPT : config.aiTranslationPrompt || DEFAULT_AI_TRANSLATION_PROMPT;
  return hashString(JSON.stringify([AI_CACHE_VERSION, chinese, extractAiText(article?.content || article?.excerpt || ""), prompt.trim(), config.aiWorkerUrl]));
}

export function prepareAiText(article) {
  const text = extractAiText(article.content || article.excerpt || "");
  if (!text.trim()) throw new Error("这篇文章没有可发送给 AI 的正文内容");
  if (text.length > MAX_AI_CONTENT_CHARS) throw new Error(`正文超过 ${MAX_AI_CONTENT_CHARS} 字符，本次未发送。请使用更短的正文，避免只翻译半篇文章。`);
  return text;
}

export function assertAiCompleted(payload) {
  const response = payload?.response || payload;
  if (response?.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    throw new Error(reason === "max_output_tokens" ? "AI 输出达到 token 上限，内容不完整，未保存为完成结果。" : "AI 返回了不完整结果，未保存。可检查输出上限或服务商限制。");
  }
  if (response?.status !== "completed" || response?.error) {
    throw new Error(response?.error?.message || "AI 未确认生成完成，结果未保存。");
  }
  return response;
}

export async function readResponsesEventStream(response, handlers, { signal, idleTimeoutMs = AI_IDLE_TIMEOUT_MS } = {}) {
  let completed = false;
  const callbacks = { ...handlers, onCompleted(payload) { assertAiCompleted(payload); completed = true; handlers.onCompleted?.(payload); } };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  const processPendingFrames = (flush = false) => {
    while (true) {
      const boundary = pending.search(/\r?\n\r?\n/);

      if (boundary === -1) {
        break;
      }

      const separator = pending.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
      const frame = pending.slice(0, boundary);
      pending = pending.slice(boundary + separator.length);
      processResponsesStreamFrame(frame, callbacks);
    }

    if (flush && pending.trim()) {
      processResponsesStreamFrame(pending, callbacks);
      pending = "";
    }
  };

  try {
    while (!completed) {
      const { done, value } = await waitForAi(reader.read(), signal, idleTimeoutMs);
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      if (pending.length > 1024 * 1024) throw new Error("AI 流式事件过大");
      processPendingFrames(false);
    }
    pending += decoder.decode();
    processPendingFrames(true);
    if (!completed) throw new Error("AI 连接提前结束，内容尚未完成，未保存。");
  } finally {
    // Cancel even on a terminal event so a provider cannot leave the stream open indefinitely.
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function processResponsesStreamFrame(frame, handlers) {
  const dataLines = [];
  let eventType = "";

  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const value = colonIndex === -1 ? "" : line.slice(colonIndex + 1).replace(/^ /, "");

    if (field === "event") {
      eventType = value;
    }

    if (field === "data") {
      dataLines.push(value);
    }
  }

  const data = dataLines.join("\n").trim();

  if (!data || data === "[DONE]") {
    return;
  }

  let payload;

  try {
    payload = JSON.parse(data);
  } catch {
    throw new Error("AI 流式响应格式错误，未保存。");
  }

  dispatchResponsesStreamPayload(payload, eventType, handlers);
}

function dispatchResponsesStreamPayload(payload, eventType, handlers) {
  const type = String(payload?.type || eventType || "");
  const errorMessage =
    typeof payload?.error === "string" ? payload.error : payload?.error?.message || "";

  if (errorMessage || type.includes("error") || type === "response.failed") {
    throw new Error(errorMessage || "AI 流式请求失败");
  }

  if (type === "response.output_text.delta" && typeof payload.delta === "string") {
    handlers.onDelta?.(payload.delta);
    return;
  }

  if (type === "response.output_text.done" && typeof payload.text === "string") {
    handlers.onTextDone?.(payload.text);
    return;
  }

  if (type === "response.incomplete") {
    assertAiCompleted(payload.response || { status: "incomplete" });
  }

  if (type === "response.completed") {
    handlers.onCompleted?.(payload.response || payload);
    return;
  }

  const chatDelta = payload?.choices?.[0]?.delta?.content;

  if (typeof chatDelta === "string") {
    handlers.onDelta?.(chatDelta);
  }
}

