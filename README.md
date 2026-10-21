# RSS Reader

RSS Reader 的前端静态资源、RSS 代理和 AI 接口统一部署在一个 Cloudflare Worker，数据仍保存在本机浏览器。默认代理只转发请求，不保存用户信息。AI 接口也只通过 Worker 转发到 Responses API 兼容接口，模型密钥留在 Worker 环境变量里，不暴露给浏览器。

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

## 手动部署到 Cloudflare

在仓库根目录执行（Node.js 22 或更新版本）：

```bash
npm ci
npx wrangler login
npm run deploy
```

`npm run deploy` 和 `npx wrangler deploy` 都会先执行 `npm run build`，再将 `dist/` 和后端一起发布。不要只上传 `dist/`，否则不会包含 RSS / AI 接口。

默认继续使用现有 Worker 名称 `rss-reader-proxy`，避免意外创建新 Worker；如需更换，在 `wrangler.jsonc` 修改 `name`，并为新 Worker 重新配置密钥。请先在 Cloudflare 控制台为该 Worker 绑定自己的域名，部署后通过该域名访问。配置明确设置 `workers_dev: false` 和 `preview_urls: false`，关闭默认 workers.dev 与版本预览入口，避免绕过只配置在自定义域名上的 Access。域名继续在控制台管理，无需写死在源代码中。

如果在 Cloudflare 控制台连接 Git 仓库后手动触发构建部署，使用：

| 项目 | 值 |
| --- | --- |
| 根目录 | 仓库根目录 |
| 构建命令 | 留空（Wrangler 会构建前端） |
| 部署命令 | `npm run deploy` |

关闭该项目的自动构建触发即可保持手动发布。`npm run build` 仅构建前端，不会发布。

前端默认地址均为同源相对路径：

```text
/rss?url={url}
/ai/responses
```

旧配置中内置的 api.plunox.site 地址会在加载本地数据或导入配置时迁移为相对路径；自定义服务器地址保持不变。AI 设置支持相对路径和完整 http/https 地址。Electron 直接抓取 RSS；桌面端 AI 需要填写已部署 Worker 的完整地址。

Worker 环境变量统一在 Cloudflare 控制台设置。仓库不设置部署变量，也不内置 AI 服务商地址或模型；`keep_vars: true` 会在后续部署时保留控制台配置。启用 AI 必须配置 `AI_API_KEY`（Secret）、`AI_BASE_URL` 和 `AI_MODEL`，RSS 阅读无需配置变量。

| 变量 | 说明 |
| --- | --- |
| `ALLOWED_HOSTS` | RSS 主机白名单，留空允许所有 http/https 主机。 |
| `MAX_BYTES` | RSS 响应体上限，默认 `8388608`。 |
| `AI_BASE_URL` | 必填：Responses API 兼容 Base URL；OpenRouter 填 `https://openrouter.ai/api/v1`，不要加 `/responses`。 |
| `AI_MODEL` | 必填：服务商的完整模型 ID，OpenRouter 使用其模型页面上的 `厂商/模型名`。 |
| `AI_MAX_OUTPUT_TOKENS` | 服务端硬上限，默认 `12000`；前端请求无法突破。 |
| `ALLOW_ORIGIN` | 仅其他站点 / 桌面端跨域调用时按需设置；同源部署无需配置。 |
| `ALLOW_CREDENTIALS` | 跨域使用 Access Cookie 时设为 `true`。 |

AI 密钥使用 secret，已有 Worker 上的 secret 在部署时保留：

```bash
npx wrangler secret put AI_API_KEY
```

本地验证完整前后端：

```bash
npm run dev:worker
```

打开终端显示的本地地址。开发时也可同时运行 `npm run dev` 和 `npm run proxy`，Vite 会将 `/rss`、`/ai`、`/health` 转发到本地 8787 端口。AI 本地密钥放在 `.dev.vars`（Wrangler）或进程环境变量（Node 代理），不要提交。

AI 的文章类型由前端按标题判断：标题含中文字符时使用“中文摘要提示词”，标题不含中文字符时使用“非中文全文翻译提示词”。标题只在浏览器本地用于选择提示词；发送给 Worker 和模型的 `input` 只包含正文文本，不包含标题、作者、发布时间或原文链接。这两段提示词、是否启用流式输出、AI Worker URL 和鉴权方式都在设置里保存。Worker 不负责判断文章语言或裁剪模型输出；它固定使用服务端模型，限制请求大小、正文和提示词长度及输出 token，并只转发允许的请求字段。

## AI 完整性、缓存与停止生成

- 发送正文时保留段落、列表、表格单元格边界和代码缩进。正文超过 60000 字符时明确提示并停止请求，不静默裁剪，也不自动拆分产生多次付费请求；提示词最多 16000 字符，请求体最多 384 KiB。
- 流式输出必须收到成功的 `response.completed`，非流式结果必须确认 `status: completed`。输出达到上限、连接中断或响应失败时不会保存为完成结果；重新生成失败时保留原有完成结果。
- 缓存包含正文、摘要/翻译模式、提示词、接口地址的指纹。点击查看缓存前会通过受 Access 保护的 `/ai/health` 检查服务商、模型和输出上限指纹，变更后重新生成；模型 ID 和密钥不会放入该健康响应。正在显示的内容不会后台轮询服务商配置。
- 新内置提示词会自动替换旧内置默认值，用户自定义提示词保持不变；旧版 AI 缓存会失效，需要再次生成。
- 生成过程中可点击“停止”；同一页面一次只发起一个生成请求。首个响应和流式空闲超时为 60 秒，整个请求最多 5 分钟。停止和超时会尽力取消上游，但已经处理的内容仍可能计费；不会自动重试付费请求。
- Cloudflare Access 决定谁可以调用 AI，单次请求限制不等于每日费用预算；模型和 Key 继续在 Cloudflare 控制台配置。

## 保护 AI 接口

如果使用自己的模型 key，可在 Cloudflare Zero Trust 中给阅读器实际访问域名的 `/ai/*` 路径创建 Access 应用，或保护整个站点。登录入口为同一站点的 `/ai/health`。同源请求会自动携带本站 Cookie，无需跨域 CORS 配置。前端会识别 Access 登录跳转并显示登录按钮，即使设置中的 AI 鉴权没有切换也能引导登录；无法区分原因的网络错误会提示检查网络并提供登录入口。

部署后请在 Worker 的 Settings → Domains & Routes 确认 workers.dev 和 Version/Preview URLs 已禁用；使用无痕窗口确认自定义域名首页仍公开、`/ai/health` 要求登录。

## GitHub Actions

Actions 仅构建 Web 和桌面安装包，不再向 `rss-reader-page` 推送，也不会部署 Cloudflare。旧的 `RSS_READER_PAGE_TOKEN` 不再需要。

切换域名后浏览器本地存储不会自动迁移。请先在旧网站导出配置，再在新网站导入；配置导出不包含文章、星标和已读状态。

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
