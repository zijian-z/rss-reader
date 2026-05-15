# RSS Reader

一个安静、快速、可自托管的三栏 RSS 阅读器。它把订阅源、文章列表和正文放在同一个工作区里，适合每天扫新闻、技术博客、论坛更新和长文。界面尽量少打扰阅读：侧栏可以折叠，正文区有独立阅读宽度、字号、行高和主题配置，桌面和手机都可以直接使用。

RSS Reader 是一个纯前端应用，数据保存在本机浏览器；RSS 代理和 AI 能力可以部署到 Cloudflare Worker。默认代理只转发请求，不保存用户信息。AI 接口也只通过 Worker 转发到 Responses API 兼容接口，模型密钥留在 Worker 环境变量里，不暴露给浏览器。

## 亮点

- 三栏阅读体验：订阅源、标题列表、正文阅读区并排展示，左右栏都可折叠。
- 本地优先：订阅、文件夹、已读、星标和阅读设置保存在浏览器本地。
- 配置同步：只导出订阅 URL、文件夹和设置，不导出文章缓存和正文内容。
- 可分享文章路径：打开文章后 URL 会带上文章路径，方便复制、收藏和回到同一篇文章。
- 内置 RSS 代理：解决浏览器直接请求 RSS 时遇到的 CORS、HTTPS 和混合内容问题。
- AI 阅读模式：标题含中文的文章生成摘要；英文等非中文标题的文章直接全文翻译成中文，支持流式输出。
- 可调提示词：中文摘要和非中文全文翻译的提示词都在设置里，可随时调整。
- Cloudflare Access 支持：`/rss` 可以公开，`/ai/*` 可以单独加登录保护，避免公开消耗你的模型额度。
- 桌面版本：Electron 版本可以直接抓取 RSS，不需要额外代理。

## 快速开始

```bash
npm install
npm run dev
```

构建 Web 版本：

```bash
npm run build
```

桌面开发：

```bash
npm run electron:dev
```

打包当前系统的桌面 App：

```bash
npm run app:dist
```

## RSS 与 AI 代理

`server/proxy.js` 同时支持 RSS 代理和 AI 转发：

- `GET /rss?url={url}`：RSS 代理，默认公开。
- `GET /health`：Worker 健康检查。
- `GET /ai/health`：AI 路由健康检查，也可用来触发 Cloudflare Access 登录。
- `POST /ai/responses`：AI 转发接口，接收前端生成的 Responses API 请求体，支持 `stream: true` 和 `stream: false`。

本地启动代理：

```bash
npm run proxy
```

部署到 Cloudflare Worker：

```bash
npm run proxy:deploy
```

Worker 常用配置：

| 变量 | 说明 |
| --- | --- |
| `ALLOW_ORIGIN` | 前端 Origin，例如 `https://zijian-z.github.io`。 |
| `ALLOW_CREDENTIALS` | 使用 Cloudflare Access Cookie 鉴权时设为 `true`。 |
| `ALLOWED_HOSTS` | RSS 主机白名单，留空表示允许所有 http/https 主机。 |
| `MAX_BYTES` | RSS 响应体大小上限，默认 `8388608`。 |
| `AI_BASE_URL` | OpenAI 兼容接口地址，默认 `https://api.openai.com/v1`。 |
| `AI_MODEL` | Responses API 模型，默认 `gpt-5.2`；前端请求体不指定模型时使用它。 |
| `AI_MAX_OUTPUT_TOKENS` | AI 输出上限，默认 `12000`，较长全文翻译可适当调高。 |

AI 密钥使用 Worker secret：

```bash
npx wrangler secret put AI_API_KEY
```

前端设置里的默认代理模板：

```text
https://api.plunox.site/rss?url={url}
```

前端设置里的 AI Worker URL：

```text
https://api.plunox.site/ai/responses
```

AI 的文章类型由前端按标题判断：标题含中文字符时使用“中文摘要提示词”，标题不含中文字符时使用“非中文全文翻译提示词”。这两段提示词、是否启用流式输出、AI Worker URL 和鉴权方式都在设置里保存。Worker 不负责判断文章语言、不裁剪模型输出，只把请求转发给上游并把 JSON 或 SSE 流返回给前端。

## 保护 AI 接口

如果你用自己的模型 key，建议只保护 AI 路由，不保护 RSS 代理：

```text
api.plunox.site/ai/*
```

在 Cloudflare Zero Trust 里给这段路径创建 Access 应用，并把 `/rss` 留在 Access 之外。前端设置中把“AI 鉴权”切换为 `Cloudflare Access` 后，AI 请求会携带 Access 登录 Cookie。

Access CORS 保留这些关键项即可：

- Origin：你的前端 Origin，例如 `https://zijian-z.github.io`。
- Methods：至少 `POST` 和 `OPTIONS`。
- Headers：至少 `content-type`。
- Credentials：开启。

首次使用前可以打开：

```text
https://api.plunox.site/ai/health
```

登录成功后再回到阅读器点击 AI 按钮。

## Web 自动部署

当前仓库的 GitHub Actions 会在 `main` 分支构建 Web 版本，并把 `dist/` 推送到：

```text
zijian-z/rss-reader-page
```

需要在当前仓库配置 secret：

```text
RSS_READER_PAGE_TOKEN
```

然后在 `zijian-z/rss-reader-page` 中启用 GitHub Pages，发布来源选择 `main` 分支根目录。

## 配置同步

设置里的导出功能只导出：

- 阅读设置
- 文件夹
- 订阅源 URL
- 代理和 AI Worker 配置
- AI 提示词

不会导出文章内容、AI 生成内容、已读状态、星标状态或本地缓存。你可以把导出的 JSON 放到一个可访问 URL 上，再在另一台设备里使用“从 URL 导入”完成配置同步。

默认订阅源：

- `https://www.solidot.org/index.rss`
- `https://rss.slashdot.org/Slashdot/slashdot`

它们默认放在“科技”文件夹里。

## 许可证

MIT License. 源代码：<https://github.com/zijian-z/rss-reader>
