import { AI_IDLE_TIMEOUT_MS } from "./ai-limits.js";

// Abort must interrupt pending reads as well as fetch(), including custom stream implementations.
export function waitForAi(promise, signal, timeoutMs = AI_IDLE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
    const onAbort = () => { cleanup(); reject(signal.reason || new DOMException("已停止生成", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("AI 响应超时，请稍后重试。")); }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

