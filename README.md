# RSS Reader

一个采用 React、HeroUI 和前端 JavaScript 实现的三栏 RSS 阅读器。界面结构参考 NetNewsWire：左侧订阅和文件夹，中间文章标题列表，右侧正文阅读区。

## 形态

- 浏览器前端：`npm run dev` 或 `npm run build` 后部署 `dist/`。
- 浏览器 + 代理：`npm run proxy` 启动简单 RSS 代理，在设置里填写 `http://127.0.0.1:8787/rss?url={url}`。
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

可选环境变量：

- `PORT`：代理端口，默认 `8787`。
- `ALLOW_ORIGIN`：CORS 允许来源，默认 `*`。
- `ALLOWED_HOSTS`：逗号分隔的 RSS 主机白名单，留空表示允许所有 http/https 主机。
- `MAX_BYTES`：最大响应体字节数，默认 8 MB。

桌面开发：

```bash
npm run electron:dev
```

打包当前系统的桌面 App：

```bash
npm run app:dist
```

GitHub Actions 会在 `main` 分支构建 Web 版本，并分别在 Linux、macOS、Windows 上生成桌面安装包。
