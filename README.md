# RSS Reader

一个采用 React、HeroUI 和前端 JavaScript 实现的三栏 RSS 阅读器：左侧订阅和文件夹，中间文章标题列表，右侧正文阅读区。桌面端可以折叠订阅栏和文章列表栏，让阅读区获得更多空间。

## 形态

- 浏览器前端：`npm run dev` 或 `npm run build` 后部署 `dist/`。
- 浏览器 + 代理：`npm run proxy` 启动本地/服务器 RSS 代理，或把 `server/proxy.js` 部署为 Cloudflare Worker。
- 桌面 App：Electron 版本通过主进程抓取 RSS，不需要单独运行代理。

## 本地开发

```bash
npm install
npm run dev
```

代理服务：

```bash
npm run proxy
```

默认监听 `0.0.0.0:8787`，本机使用：

```text
http://127.0.0.1:8787/rss?url={url}
```

部署到服务器时，可以在防火墙放行端口后使用：

```text
http://服务器地址:8787/rss?url={url}
```

如果前端页面通过 HTTPS 访问，浏览器会拦截 HTTP 代理请求。生产环境建议使用 Cloudflare Worker 代理，天然是 HTTPS。

可选环境变量：

- `HOST`：Node 代理监听地址，默认 `0.0.0.0`。
- `PORT`：代理端口，默认 `8787`。
- `ALLOW_ORIGIN`：CORS 允许来源，默认 `*`。
- `ALLOWED_HOSTS`：逗号分隔的 RSS 主机白名单，留空表示允许所有 http/https 主机。
- `MAX_BYTES`：最大响应体字节数，默认 8 MB。

## Cloudflare Worker 代理

`server/proxy.js` 是 Cloudflare Workers 入口，同时被本地 Node 代理复用。首次部署前先登录 Wrangler：

```bash
npx wrangler login
```

部署：

```bash
npm run proxy:deploy
```

本地用 Wrangler 调试 Worker：

```bash
npm run proxy:dev
```

部署后，Wrangler 会输出 Worker 地址，通常类似：

```text
https://rss-reader-proxy.<你的 workers.dev 子域>.workers.dev
```

在 RSS Reader 的设置里把“代理模板”填成：

```text
https://rss-reader-proxy.<你的 workers.dev 子域>.workers.dev/rss?url={url}
```

Worker 配置在 `wrangler.jsonc`：

- `ALLOW_ORIGIN`：前端地址，例如 `https://zijian-z.github.io` 或你的 Pages 地址。
- `ALLOW_CREDENTIALS`：如果 AI 接口使用 Cloudflare Access Cookie 鉴权，需要设为 `true`，同时 `ALLOW_ORIGIN` 必须是明确的前端 Origin，不能是 `*`。
- `ALLOWED_HOSTS`：留空表示允许代理所有 http/https RSS 地址；如果要限制来源，可填逗号分隔的主机名。
- `MAX_BYTES`：最大响应体字节数，默认 `8388608`。
- `AI_BASE_URL`：OpenAI 兼容接口的 base URL，默认 `https://api.openai.com/v1`。
- `AI_MODEL`：Responses API 使用的模型，默认 `gpt-5.2`。

默认代理模板是 `https://api.plunox.site/rss?url={url}`。该代理不会留存用户信息和请求记录；你也可以在设置中替换为自己的代理地址，或清空后直接请求 RSS 地址。

AI 功能由同一个 Worker 的 `/ai/responses` 路由转发到模型服务，前端只配置 AI Worker URL，不保存模型服务 API Key。部署前需要设置 Worker secret：

```bash
npx wrangler secret put AI_API_KEY
```

前端设置里的 AI Worker URL 通常类似：

```text
https://api.plunox.site/ai/responses
```

如果只想保护 AI 接口，建议在 Cloudflare Zero Trust 里给 `api.plunox.site/ai/*` 创建 Access 应用，并把 `/rss` 留在 Access 之外。前端设置里的“AI 鉴权”选择 `Cloudflare Access` 后，AI 请求会携带 Access 登录 Cookie；RSS 代理请求不会携带鉴权。

使用 Cloudflare Access 时还需要在 Access 应用中配置 CORS：

- Origin 填前端地址，例如 `https://zijian-z.github.io`。
- Methods 至少包含 `POST` 和 `OPTIONS`。
- Headers 至少包含 `content-type`。如果预检请求提示缺少 `Access-Control-Allow-Origin`，通常就是 Access 应用没有允许这个 request header。
- 允许 credentials。

首次使用前，可以先打开 `https://api.plunox.site/ai/health` 完成 Access 登录；登录成功后再回到阅读器使用 AI 按钮。

## 配置同步

设置里的“导出配置 JSON”只导出阅读设置、文件夹和订阅地址，不包含文章内容、已读状态、星标状态或本地缓存。

可以把导出的 JSON 上传到任意可直接访问的 URL，然后在另一台设备的设置里使用“从 URL 导入”完成配置同步。文件导入和 URL 导入都会替换当前设备上的配置，并清空本地文章缓存，之后应用会重新拉取订阅。

默认订阅源是 `https://www.solidot.org/index.rss` 和 `https://rss.slashdot.org/Slashdot/slashdot`，都位于“科技”文件夹。

桌面开发：

```bash
npm run electron:dev
```

打包当前系统的桌面 App：

```bash
npm run app:dist
```

GitHub Actions 会在 `main` 分支构建 Web 版本，并分别在 Linux、macOS、Windows 上生成桌面安装包。

## Web 部署

`main` 分支推送后，GitHub Actions 会构建 Web 版本，并把 `dist/` 的内容推送到 `zijian-z/rss-reader-page` 仓库的 `main` 分支根目录。

需要在当前仓库的 GitHub Actions secrets 中添加：

- `RSS_READER_PAGE_TOKEN`：一个能写入 `zijian-z/rss-reader-page` 的 token。

然后在 `zijian-z/rss-reader-page` 仓库里启用 GitHub Pages，发布来源选择 `main` 分支的根目录。启用后通常可以通过 `https://zijian-z.github.io/rss-reader-page/` 访问。

## 许可证

MIT License. 源代码：<https://github.com/zijian-z/rss-reader>
