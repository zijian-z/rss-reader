// Fetch cannot navigate through Access's interactive sign-in flow. Keep redirects visible.
export function assertAiAccessResponse(response) {
  if (response.type === "opaqueredirect" || response.status === 0 ||
      (response.status >= 300 && response.status < 400)) {
    throw Object.assign(new Error("使用 AI 前请先登录 Cloudflare Access。"), { needsAccessLogin: true });
  }
}

export function aiFailureNotice(error, { accessMode = false, aborted = false } = {}) {
  if (aborted) return { message: error?.message || "已停止生成，未保存未完成内容。", login: false };
  if (error?.needsAccessLogin || (accessMode && [401, 403].includes(error?.status) && !error?.hasJsonPayload)) {
    return { message: "使用 AI 前请先登录 Cloudflare Access；登录后返回阅读器重试。", login: true };
  }
  if (error instanceof TypeError) {
    return { message: "无法连接 AI 接口。如果已启用 Cloudflare Access，请先登录后重试；也可检查网络或接口地址。", login: true };
  }
  return { message: error?.message || "AI 处理失败", login: false };
}
