import { uid } from "./rss.js";

export const STORAGE_KEY = "rss-reader-library-v1";

export const DEFAULT_CONFIG = {
  refreshMinutes: 30,
  fontSize: 18,
  lineHeight: 1.7,
  readerWidth: 780,
  fontFamily: "system",
  theme: "system",
  density: "comfortable",
  proxyTemplate: "",
};

export function createDefaultLibrary() {
  const techFolderId = "folder_tech";
  const cultureFolderId = "folder_culture";

  return {
    schemaVersion: 1,
    config: { ...DEFAULT_CONFIG },
    folders: [
      { id: techFolderId, name: "科技" },
      { id: cultureFolderId, name: "阅读" },
    ],
    feeds: [
      {
        id: "feed_hackernews",
        folderId: techFolderId,
        title: "Hacker News",
        url: "https://hnrss.org/frontpage",
        siteUrl: "https://news.ycombinator.com/",
        description: "",
        lastFetched: "",
        status: "idle",
        error: "",
        unreadCount: 0,
      },
      {
        id: "feed_xkcd",
        folderId: cultureFolderId,
        title: "xkcd",
        url: "https://xkcd.com/rss.xml",
        siteUrl: "https://xkcd.com/",
        description: "",
        lastFetched: "",
        status: "idle",
        error: "",
        unreadCount: 0,
      },
    ],
    articles: [],
    selectedFeedId: "feed_hackernews",
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

export function normalizeLibrary(input) {
  const fallback = createDefaultLibrary();
  const folders = Array.isArray(input?.folders) ? input.folders : fallback.folders;
  const feeds = Array.isArray(input?.feeds) ? input.feeds : fallback.feeds;
  const articles = Array.isArray(input?.articles) ? input.articles : [];
  const config = {
    ...DEFAULT_CONFIG,
    ...(typeof input?.config === "object" && input.config ? input.config : {}),
  };

  return {
    schemaVersion: 1,
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
  };
}
