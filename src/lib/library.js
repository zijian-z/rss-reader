import { uid } from "./rss.js";

export const STORAGE_KEY = "rss-reader-library-v1";
export const CURRENT_SCHEMA_VERSION = 2;
export const CONFIG_EXPORT_TYPE = "rss-reader-config";
export const CONFIG_EXPORT_VERSION = 1;
export const DEFAULT_PROXY_TEMPLATE = "https://api.plunox.site/rss?url={url}";
export const DEFAULT_AI_WORKER_URL = "https://api.plunox.site/ai/responses";
export const DEFAULT_AI_CHINESE_PROMPT = `你是 RSS 阅读器内置的中文阅读助手。

输出要求：
- 只输出最终 HTML 片段，不要 Markdown、代码块、解释、思考过程或寒暄。
- 只使用这些标签：h2、h3、p、ul、ol、li、strong、em、blockquote。
- 必须以 <h2>AI 摘要</h2> 开始。
- 用简体中文总结文章的核心事实、结论和关键背景。
- 不要编造原文没有的信息；如果原文明显不完整，用一句话说明。`;
export const DEFAULT_AI_TRANSLATION_PROMPT = `你是 RSS 阅读器内置的中文全文翻译助手。

输出要求：
- 只输出最终 HTML 片段，不要 Markdown、代码块、解释、思考过程或寒暄。
- 只使用这些标签：h2、h3、p、ul、ol、li、strong、em、blockquote。
- 必须以 <h2>全文翻译</h2> 开始。
- 将原文完整翻译为自然准确的简体中文，不要摘要，不要要点列表，不要评论。
- 保留原文顺序、段落结构、列表关系和必要术语。
- 不要编造原文没有的信息；如果原文明显不完整，用一句话说明。`;

export const DEFAULT_CONFIG = {
  refreshMinutes: 30,
  fontSize: 18,
  lineHeight: 1.7,
  readerWidth: 780,
  fontFamily: "system",
  theme: "system",
  accentColor: "blue",
  density: "comfortable",
  proxyTemplate: DEFAULT_PROXY_TEMPLATE,
  aiWorkerUrl: DEFAULT_AI_WORKER_URL,
  aiAuthMode: "none",
  aiStream: true,
  aiChinesePrompt: DEFAULT_AI_CHINESE_PROMPT,
  aiTranslationPrompt: DEFAULT_AI_TRANSLATION_PROMPT,
};

export function createDefaultLibrary() {
  const techFolderId = "folder_tech";

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    config: { ...DEFAULT_CONFIG },
    folders: [{ id: techFolderId, name: "科技" }],
    feeds: [
      {
        id: "feed_solidot",
        folderId: techFolderId,
        title: "Solidot",
        url: "https://www.solidot.org/index.rss",
        siteUrl: "https://www.solidot.org/",
        description: "",
        lastFetched: "",
        status: "idle",
        error: "",
        unreadCount: 0,
      },
      {
        id: "feed_slashdot",
        folderId: techFolderId,
        title: "Slashdot",
        url: "https://rss.slashdot.org/Slashdot/slashdot",
        siteUrl: "https://slashdot.org/",
        description: "",
        lastFetched: "",
        status: "idle",
        error: "",
        unreadCount: 0,
      },
    ],
    articles: [],
    selectedFeedId: "feed_solidot",
    selectedArticleId: "",
    activeFilter: "all",
  };
}

export function loadLibrary() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeLibrary(JSON.parse(saved)) : createDefaultLibrary();
  } catch {
    return createDefaultLibrary();
  }
}

export function saveLibrary(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

export function createConfigExport(library) {
  const config = {
    ...DEFAULT_CONFIG,
    ...(typeof library?.config === "object" && library.config ? library.config : {}),
  };
  return {
    type: CONFIG_EXPORT_TYPE,
    version: CONFIG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    config,
    folders: Array.isArray(library?.folders)
      ? library.folders.map((folder) => ({
          id: String(folder.id || uid("folder")),
          name: String(folder.name || "未命名文件夹"),
        }))
      : [],
    feeds: Array.isArray(library?.feeds)
      ? library.feeds.map((feed) => ({
          id: String(feed.id || uid("feed")),
          folderId: String(feed.folderId || ""),
          title: String(feed.title || feed.url || "未命名订阅"),
          url: String(feed.url || ""),
          siteUrl: String(feed.siteUrl || ""),
          description: String(feed.description || ""),
        })).filter((feed) => feed.url)
      : [],
    selectedFeedId: typeof library?.selectedFeedId === "string" ? library.selectedFeedId : "",
  };
}

export function normalizeConfigImport(input) {
  const fallback = createDefaultLibrary();
  const source = input && typeof input === "object" ? input : fallback;
  const folders = Array.isArray(source.folders) ? source.folders : fallback.folders;
  const normalizedFolders = folders.map(normalizeFolder).filter(Boolean);
  const normalizedFolderIds = new Set(normalizedFolders.map((folder) => folder.id));
  const fallbackFolderId = normalizedFolders[0]?.id || "";
  const feeds = (Array.isArray(source.feeds) ? source.feeds : fallback.feeds)
    .map(normalizeFeed)
    .filter(Boolean)
    .map((feed) => ({
      ...feed,
      folderId: normalizedFolderIds.has(feed.folderId) ? feed.folderId : fallbackFolderId,
      lastFetched: "",
      status: "idle",
      error: "",
      unreadCount: 0,
    }));
  const selectedFeedId = feeds.some((feed) => feed.id === source.selectedFeedId)
    ? source.selectedFeedId
    : feeds[0]?.id || "all";

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    config: {
      ...DEFAULT_CONFIG,
      ...(typeof source.config === "object" && source.config ? source.config : {}),
    },
    folders: normalizedFolders,
    feeds,
    articles: [],
    selectedFeedId,
    selectedArticleId: "",
    activeFilter: "all",
  };
}

export function normalizeLibrary(input) {
  const fallback = createDefaultLibrary();
  const folders = Array.isArray(input?.folders) ? input.folders : fallback.folders;
  const feeds = Array.isArray(input?.feeds) ? input.feeds : fallback.feeds;
  const articles = Array.isArray(input?.articles) ? input.articles : [];
  const config = {
    ...DEFAULT_CONFIG,
    ...(typeof input?.config === "object" && input.config ? input.config : {}),
  };
  const schemaVersion = Number(input?.schemaVersion || 1);

  if (schemaVersion < 2 && !config.proxyTemplate) {
    config.proxyTemplate = DEFAULT_PROXY_TEMPLATE;
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    config,
    folders: folders.map(normalizeFolder).filter(Boolean),
    feeds: feeds.map(normalizeFeed).filter(Boolean),
    articles: articles.map(normalizeArticle).filter(Boolean),
    selectedFeedId:
      typeof input?.selectedFeedId === "string" ? input.selectedFeedId : feeds[0]?.id || "",
    selectedArticleId:
      typeof input?.selectedArticleId === "string" ? input.selectedArticleId : "",
    activeFilter:
      typeof input?.activeFilter === "string" ? input.activeFilter : fallback.activeFilter,
  };
}

export function createFolder(name) {
  return {
    id: uid("folder"),
    name: name.trim() || "未命名文件夹",
  };
}

export function createFeed({ title, url, folderId }) {
  return {
    id: uid("feed"),
    folderId,
    title: title.trim() || url.trim(),
    url: url.trim(),
    siteUrl: "",
    description: "",
    lastFetched: "",
    status: "idle",
    error: "",
    unreadCount: 0,
  };
}

function normalizeFolder(folder) {
  if (!folder || typeof folder !== "object") {
    return null;
  }

  return {
    id: String(folder.id || uid("folder")),
    name: String(folder.name || "未命名文件夹"),
  };
}

function normalizeFeed(feed) {
  if (!feed || typeof feed !== "object" || !feed.url) {
    return null;
  }

  return {
    id: String(feed.id || uid("feed")),
    folderId: String(feed.folderId || ""),
    title: String(feed.title || feed.url),
    url: String(feed.url),
    siteUrl: String(feed.siteUrl || ""),
    description: String(feed.description || ""),
    lastFetched: String(feed.lastFetched || ""),
    status: "idle",
    error: "",
    unreadCount: Number(feed.unreadCount || 0),
  };
}

function normalizeArticle(article) {
  if (!article || typeof article !== "object" || !article.id) {
    return null;
  }

  return {
    id: String(article.id),
    feedId: String(article.feedId || ""),
    guid: String(article.guid || article.id),
    title: String(article.title || "无标题"),
    link: String(article.link || ""),
    content: String(article.content || ""),
    excerpt: String(article.excerpt || ""),
    author: String(article.author || ""),
    publishedAt: String(article.publishedAt || ""),
    fetchedAt: String(article.fetchedAt || ""),
    read: Boolean(article.read),
    starred: Boolean(article.starred),
    aiContent: String(article.aiContent || ""),
    aiGeneratedAt: String(article.aiGeneratedAt || ""),
    aiMode: Boolean(article.aiMode),
    aiPromptVersion: String(article.aiPromptVersion || ""),
  };
}
