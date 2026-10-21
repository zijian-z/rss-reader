// Limits apply in the browser and at the Worker boundary; never silently truncate articles.
export const MAX_AI_CONTENT_CHARS = 60000;
export const MAX_AI_PROMPT_CHARS = 16000;
export const MAX_AI_REQUEST_BYTES = 384 * 1024;
export const AI_FIRST_RESPONSE_TIMEOUT_MS = 60000;
export const AI_IDLE_TIMEOUT_MS = 60000;
export const AI_TOTAL_TIMEOUT_MS = 300000;
