import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Tooltip } from "@heroui/react";
import {
  Bookmark,
  CheckCheck,
  ChevronLeft,
  Download,
  Edit3,
  ExternalLink,
  FolderPlus,
  Link2,
  List,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Rss,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  createDefaultLibrary,
  createConfigExport,
  createFeed,
  createFolder,
  loadLibrary,
  normalizeConfigImport,
  normalizeLibrary,
  saveLibrary,
} from "./lib/library.js";
import { fetchAndParseFeed, sanitizeArticleHtml, stripHtml } from "./lib/rss.js";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateOnlyFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const ACCENT_OPTIONS = [
  { value: "blue", label: "蓝色" },
  { value: "slate", label: "石墨" },
  { value: "violet", label: "紫色" },
  { value: "rose", label: "玫瑰" },
  { value: "amber", label: "琥珀" },
];
const AI_CACHE_VERSION = "title-language-split-v1";
const MAX_AI_CONTENT_CHARS = 60000;

function App() {
  const [library, setLibrary] = useState(loadLibrary);
  const [routeArticleId, setRouteArticleId] = useState(readRouteArticleId);
  const [mobilePane, setMobilePane] = useState("sources");
  const [isMobileNavHidden, setMobileNavHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [isAddOpen, setAddOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isSourcesCollapsed, setSourcesCollapsed] = useState(false);
  const [isArticleListCollapsed, setArticleListCollapsed] = useState(false);
  const [aiStatus, setAiStatus] = useState({ articleId: "", message: "" });
  const [editingFeedId, setEditingFeedId] = useState("");
  const fileInputRef = useRef(null);
  const libraryRef = useRef(library);
  const lastReaderScrollTopRef = useRef(0);
  const accessLoginStartedAtRef = useRef(0);

  useEffect(() => {
    libraryRef.current = library;
    saveLibrary(library);
  }, [library]);

  const selectedFeed = useMemo(
    () => library.feeds.find((feed) => feed.id === library.selectedFeedId) || null,
    [library.feeds, library.selectedFeedId],
  );

  const visibleArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const feedIdsByFolder = new Map(
      library.folders.map((folder) => [
        folder.id,
        library.feeds.filter((feed) => feed.folderId === folder.id).map((feed) => feed.id),
      ]),
    );

    return library.articles
      .filter((article) => {
        if (library.activeFilter === "unread" && article.read) {
          return false;
        }

        if (library.activeFilter === "starred" && !article.starred) {
          return false;
        }

        if (library.selectedFeedId?.startsWith("folder:")) {
          const folderId = library.selectedFeedId.replace("folder:", "");
          return feedIdsByFolder.get(folderId)?.includes(article.feedId);
        }

        if (library.selectedFeedId && library.selectedFeedId !== "all") {
          return article.feedId === library.selectedFeedId;
        }

        return true;
      })
      .filter((article) => {
        if (!normalizedQuery) {
          return true;
        }

        return `${article.title} ${article.excerpt} ${article.author}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((first, second) => {
        const firstDate = new Date(first.publishedAt || first.fetchedAt || 0).getTime();
        const secondDate = new Date(second.publishedAt || second.fetchedAt || 0).getTime();
        return secondDate - firstDate;
      });
  }, [
    library.activeFilter,
    library.articles,
    library.feeds,
    library.folders,
    library.selectedFeedId,
    query,
  ]);

  const selectedArticle =
    library.articles.find(
      (article) => article.id === (routeArticleId || library.selectedArticleId),
    ) ||
    (routeArticleId ? null : visibleArticles[0]) ||
    null;

  const unreadTotal = library.articles.filter((article) => !article.read).length;
  const starredTotal = library.articles.filter((article) => article.starred).length;
  const isRefreshing = library.feeds.some((feed) => feed.status === "refreshing");

  const refreshFeeds = useCallback(async (feedIds = null) => {
    const current = libraryRef.current;
    const targets = current.feeds.filter((feed) => !feedIds || feedIds.includes(feed.id));

    if (!targets.length) {
      return;
    }

    setLibrary((draft) => ({
      ...draft,
      feeds: draft.feeds.map((feed) =>
        targets.some((target) => target.id === feed.id)
          ? { ...feed, status: "refreshing", error: "" }
          : feed,
      ),
    }));

    await Promise.allSettled(
      targets.map(async (feed) => {
        try {
          const parsed = await fetchAndParseFeed(feed, libraryRef.current.config.proxyTemplate);
          mergeParsedFeed(feed.id, parsed);
        } catch (error) {
          const message =
            error?.name === "AbortError" ? "请求超时" : error?.message || "刷新失败";
          setLibrary((draft) => ({
            ...draft,
            feeds: draft.feeds.map((currentFeed) =>
              currentFeed.id === feed.id
                ? {
                    ...currentFeed,
                    status: "error",
                    error: message,
                    lastFetched: new Date().toISOString(),
                  }
                : currentFeed,
            ),
          }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    if (!library.feeds.length) {
      return undefined;
    }

    const hasNeverFetched = library.feeds.some((feed) => !feed.lastFetched && feed.status === "idle");

    if (hasNeverFetched) {
      refreshFeeds();
    }

    return undefined;
  }, [library.feeds.length, refreshFeeds]);

  useEffect(() => {
    const syncRoute = () => setRouteArticleId(readRouteArticleId());

    window.addEventListener("hashchange", syncRoute);
    syncRoute();

    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    if (!routeArticleId) {
      return;
    }

    setLibrary((draft) => {
      if (draft.selectedArticleId === routeArticleId) {
        return draft;
      }

      return {
        ...draft,
        selectedArticleId: routeArticleId,
      };
    });
    setMobilePane("reader");
  }, [routeArticleId]);

  useEffect(() => {
    setMobileNavHidden(false);
    lastReaderScrollTopRef.current = 0;
  }, [mobilePane, selectedArticle?.id]);

  useEffect(() => {
    const minutes = Number(library.config.refreshMinutes);

    if (!minutes || minutes < 1) {
      return undefined;
    }

    const intervalId = window.setInterval(() => refreshFeeds(), minutes * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [library.config.refreshMinutes, refreshFeeds]);

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const shouldUseDark =
      library.config.theme === "dark" || (library.config.theme === "system" && prefersDark);

    root.dataset.theme = shouldUseDark ? "dark" : "light";
  }, [library.config.theme]);

  useEffect(() => {
    if (!selectedArticle || selectedArticle.read) {
      return;
    }

    setLibrary((draft) => ({
      ...draft,
      articles: draft.articles.map((article) =>
        article.id === selectedArticle.id ? { ...article, read: true } : article,
      ),
      feeds: recalculateUnreadCounts(
        draft.feeds,
        draft.articles.map((article) =>
          article.id === selectedArticle.id ? { ...article, read: true } : article,
        ),
      ),
    }));
  }, [selectedArticle?.id]);

  function mergeParsedFeed(feedId, parsed) {
    setLibrary((draft) => {
      const existingById = new Map(draft.articles.map((article) => [article.id, article]));
      const mergedArticles = parsed.articles.map((article) => ({
        ...article,
        read: existingById.get(article.id)?.read || false,
        starred: existingById.get(article.id)?.starred || false,
        ...currentAiCache(existingById.get(article.id)),
      }));
      const otherArticles = draft.articles.filter((article) => article.feedId !== feedId);
      const nextArticles = [...mergedArticles, ...otherArticles].slice(0, 1500);
      const nextFeeds = recalculateUnreadCounts(
        draft.feeds.map((feed) =>
          feed.id === feedId
            ? {
                ...feed,
                title: parsed.title || feed.title,
                siteUrl: parsed.siteUrl || feed.siteUrl,
                description: parsed.description || feed.description,
                lastFetched: new Date().toISOString(),
                status: "ready",
                error: "",
              }
            : feed,
        ),
        nextArticles,
      );

      return {
        ...draft,
        feeds: nextFeeds,
        articles: nextArticles,
        selectedArticleId: draft.selectedArticleId || mergedArticles[0]?.id || "",
      };
    });
  }

  function selectSource(sourceId, filter = library.activeFilter) {
    const sourceArticles = library.articles
      .filter((article) => {
        if (sourceId === "all") {
          return true;
        }

        if (sourceId.startsWith("folder:")) {
          const folderId = sourceId.replace("folder:", "");
          const feedIds = library.feeds
            .filter((feed) => feed.folderId === folderId)
            .map((feed) => feed.id);
          return feedIds.includes(article.feedId);
        }

        return article.feedId === sourceId;
      })
      .sort((first, second) => {
        const firstDate = new Date(first.publishedAt || first.fetchedAt || 0).getTime();
        const secondDate = new Date(second.publishedAt || second.fetchedAt || 0).getTime();
        return secondDate - firstDate;
      });

    setLibrary((draft) => ({
      ...draft,
      selectedFeedId: sourceId,
      selectedArticleId: sourceArticles[0]?.id || "",
      activeFilter: filter,
    }));
    clearArticleRoute();
    setRouteArticleId("");
    setMobilePane("articles");
  }

  function selectArticle(articleId) {
    setLibrary((draft) => ({
      ...draft,
      selectedArticleId: articleId,
    }));
    setRouteArticleId(articleId);
    writeArticleRoute(articleId);
    setMobilePane("reader");
  }

  function markAllRead() {
    setLibrary((draft) => ({
      ...draft,
      articles: draft.articles.map((article) => ({ ...article, read: true })),
      feeds: draft.feeds.map((feed) => ({ ...feed, unreadCount: 0 })),
    }));
  }

  function toggleStar(articleId) {
    setLibrary((draft) => ({
      ...draft,
      articles: draft.articles.map((article) =>
        article.id === articleId ? { ...article, starred: !article.starred } : article,
      ),
    }));
  }

  function toggleAiMode(articleId, enabled) {
    setLibrary((draft) => ({
      ...draft,
      articles: draft.articles.map((article) =>
        article.id === articleId ? { ...article, aiMode: enabled } : article,
      ),
    }));
  }

  function resetAiContent(articleId) {
    setAiStatus((current) =>
      current.articleId === articleId ? { articleId: "", message: "", loginUrl: "" } : current,
    );
    setLibrary((draft) => ({
      ...draft,
      articles: draft.articles.map((article) =>
        article.id === articleId
          ? {
              ...article,
              aiContent: "",
              aiGeneratedAt: "",
              aiMode: false,
              aiPromptVersion: "",
            }
          : article,
      ),
    }));
  }

  function handleReaderScroll(event) {
    if (mobilePane !== "reader") {
      return;
    }

    const scrollTop = event.currentTarget.scrollTop;
    const delta = scrollTop - lastReaderScrollTopRef.current;

    if (Math.abs(delta) < 8) {
      return;
    }

    setMobileNavHidden(scrollTop > 32 && delta > 0);
    lastReaderScrollTopRef.current = scrollTop;
  }

  function openCloudflareAccessLogin(loginUrl) {
    accessLoginStartedAtRef.current = Date.now();

    const loginWindow = window.open(loginUrl, "_blank");

    if (!loginWindow) {
      window.location.href = loginUrl;
      return;
    }

    try {
      loginWindow.opener = null;
      loginWindow.focus();
    } catch {
      // Ignore browser restrictions around cross-window access.
    }

    const reloadCurrentPage = () => {
      if (Date.now() - accessLoginStartedAtRef.current < 1200) {
        return;
      }

      window.removeEventListener("focus", reloadCurrentPage);
      document.removeEventListener("visibilitychange", reloadWhenVisible);
      window.location.reload();
    };

    const reloadWhenVisible = () => {
      if (document.visibilityState === "visible") {
        reloadCurrentPage();
      }
    };

    window.addEventListener("focus", reloadCurrentPage);
    document.addEventListener("visibilitychange", reloadWhenVisible);
  }

  async function runAiForArticle(article) {
    if (!article) {
      return;
    }

    setAiStatus({ articleId: article.id, message: "" });

    try {
      const config = libraryRef.current.config;
      const contentText = stripHtml(article.content || article.excerpt || "").slice(
        0,
        MAX_AI_CONTENT_CHARS,
      );
      const requestOptions = {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: article.title,
          author: article.author,
          publishedAt: article.publishedAt,
          url: article.link,
          content: contentText || article.title,
        }),
      };

      if (config.aiAuthMode === "cloudflareAccess") {
        requestOptions.credentials = "include";
      }

      const response = await fetch(validateAiWorkerUrl(config.aiWorkerUrl), requestOptions);

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(payload?.error || `AI 请求失败：HTTP ${response.status}`);
        error.status = response.status;
        error.hasJsonPayload = Boolean(payload?.error);
        throw error;
      }

      const html = sanitizeArticleHtml(payload.html || payload.outputText || payload.text || "");

      if (!html) {
        throw new Error("AI 没有返回可显示的内容");
      }

      setLibrary((draft) => ({
        ...draft,
        articles: draft.articles.map((currentArticle) =>
          currentArticle.id === article.id
            ? {
                ...currentArticle,
                aiContent: html,
                aiGeneratedAt: new Date().toISOString(),
                aiMode: true,
                aiPromptVersion: AI_CACHE_VERSION,
              }
            : currentArticle,
        ),
      }));
    } catch (error) {
      const config = libraryRef.current.config;
      const shouldPromptAccessLogin =
        config.aiAuthMode === "cloudflareAccess" &&
        (error instanceof TypeError ||
          ((error.status === 401 || error.status === 403) && !error.hasJsonPayload));

      setAiStatus({
        articleId: article.id,
        message: shouldPromptAccessLogin
          ? "Cloudflare Access 登录可能已失效。请重新登录后回到阅读器，页面会自动刷新。"
          : error?.message || "AI 处理失败",
        loginUrl: shouldPromptAccessLogin ? buildAiHealthUrl(config.aiWorkerUrl) : "",
      });
    } finally {
      setAiStatus((current) =>
        current.articleId === article.id && !current.message
          ? { articleId: "", message: "" }
          : current,
      );
    }
  }

  function removeFeed(feedId) {
    setLibrary((draft) => {
      const remainingFeeds = draft.feeds.filter((feed) => feed.id !== feedId);
      const nextSelected =
        draft.selectedFeedId === feedId ? remainingFeeds[0]?.id || "all" : draft.selectedFeedId;

      return {
        ...draft,
        feeds: remainingFeeds,
        articles: draft.articles.filter((article) => article.feedId !== feedId),
        selectedFeedId: nextSelected,
        selectedArticleId:
          draft.selectedFeedId === feedId
            ? ""
            : draft.articles.find((article) => article.id === draft.selectedArticleId)?.id || "",
      };
    });
  }

  function updateConfig(partial) {
    setLibrary((draft) => ({
      ...draft,
      config: {
        ...draft.config,
        ...partial,
      },
    }));
  }

  function exportLibrary() {
    const payload = createConfigExport(library);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rss-reader-config-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function applyImportedConfig(payload) {
    setLibrary(normalizeConfigImport(payload));
    setSettingsOpen(false);
  }

  async function importLibrary(file) {
    if (!file) {
      return;
    }

    const text = await file.text();
    applyImportedConfig(JSON.parse(text));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function importLibraryFromUrl(url) {
    const importUrl = new URL(url.trim());

    if (!["http:", "https:"].includes(importUrl.protocol)) {
      throw new Error("只支持 http 或 https 地址");
    }

    const response = await fetch(importUrl.href, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`无法获取配置：HTTP ${response.status}`);
    }

    applyImportedConfig(JSON.parse(await response.text()));
  }

  const cssVars = {
    "--reader-font-size": `${library.config.fontSize}px`,
    "--reader-line-height": library.config.lineHeight,
    "--reader-width": `${library.config.readerWidth}px`,
    "--reader-font-family": fontFamilyValue(library.config.fontFamily),
  };

  return (
    <div
      className={`app ${library.config.density} accent-${library.config.accentColor || "blue"}`}
      style={cssVars}
    >
      <header className={`topbar ${isMobileNavHidden ? "is-hidden" : ""}`}>
        <nav className="mobile-switch" aria-label="移动端视图">
          <button
            className={mobilePane === "sources" ? "active" : ""}
            onClick={() => setMobilePane("sources")}
            type="button"
          >
            订阅
          </button>
          <button
            className={mobilePane === "articles" ? "active" : ""}
            onClick={() => setMobilePane("articles")}
            type="button"
            disabled={!selectedFeed}
          >
            标题
          </button>
          <button
            className={mobilePane === "reader" ? "active" : ""}
            onClick={() => setMobilePane("reader")}
            type="button"
            disabled={!selectedArticle}
          >
            正文
          </button>
        </nav>
      </header>

      <div
        className={`three-pane ${isSourcesCollapsed ? "sources-collapsed" : ""} ${
          isArticleListCollapsed ? "list-collapsed" : ""
        }`}
      >
        <SourcesPane
          activeFilter={library.activeFilter}
          articles={library.articles}
          feeds={library.feeds}
          folders={library.folders}
          isCollapsed={isSourcesCollapsed}
          isRefreshing={isRefreshing}
          mobilePane={mobilePane}
          onAdd={() => setAddOpen(true)}
          onEditFeed={setEditingFeedId}
          onMarkAllRead={markAllRead}
          onOpenSettings={() => setSettingsOpen(true)}
          onRefreshAll={() => refreshFeeds()}
          onRefreshFeed={(feedId) => refreshFeeds([feedId])}
          onRemoveFeed={removeFeed}
          onSelectSource={selectSource}
          onToggleCollapse={() => setSourcesCollapsed((value) => !value)}
          selectedFeedId={library.selectedFeedId}
          starredTotal={starredTotal}
          unreadTotal={unreadTotal}
        />

        <ArticleListPane
          articles={visibleArticles}
          feeds={library.feeds}
          mobilePane={mobilePane}
          onBack={() => setMobilePane("sources")}
          onSearch={setQuery}
          onSelectArticle={selectArticle}
          onToggleCollapse={() => setArticleListCollapsed((value) => !value)}
          query={query}
          isCollapsed={isArticleListCollapsed}
          selectedArticleId={selectedArticle?.id || ""}
          sourceTitle={sourceTitle(library, selectedFeed)}
        />

        <ReaderPane
          aiStatus={
            aiStatus.articleId === selectedArticle?.id
              ? aiStatus
              : { articleId: "", message: "" }
          }
          article={selectedArticle}
          feed={library.feeds.find((feed) => feed.id === selectedArticle?.feedId)}
          mobilePane={mobilePane}
          onAccessLogin={openCloudflareAccessLogin}
          onResetAi={resetAiContent}
          onRunAi={runAiForArticle}
          onReaderScroll={handleReaderScroll}
          onBack={() => setMobilePane("articles")}
          onToggleStar={toggleStar}
          onToggleAiMode={toggleAiMode}
        />
      </div>

      {isAddOpen ? (
        <AddFeedDialog
          folders={library.folders}
          onClose={() => setAddOpen(false)}
          onSubmit={(payload) => {
            setLibrary((draft) => {
              const folder =
                payload.newFolder.trim() ? createFolder(payload.newFolder) : null;
              const folderId = folder?.id || payload.folderId || draft.folders[0]?.id;
              const feed = createFeed({
                title: payload.title,
                url: payload.url,
                folderId,
              });

              return {
                ...draft,
                folders: folder ? [...draft.folders, folder] : draft.folders,
                feeds: [...draft.feeds, feed],
                selectedFeedId: feed.id,
              };
            });
            setAddOpen(false);
            window.setTimeout(() => refreshFeeds(), 100);
          }}
        />
      ) : null}

      {editingFeedId ? (
        <EditFeedDialog
          feed={library.feeds.find((feed) => feed.id === editingFeedId)}
          folders={library.folders}
          onClose={() => setEditingFeedId("")}
          onSubmit={(nextFeed) => {
            setLibrary((draft) => ({
              ...draft,
              feeds: draft.feeds.map((feed) => (feed.id === nextFeed.id ? nextFeed : feed)),
            }));
            setEditingFeedId("");
          }}
        />
      ) : null}

      {isSettingsOpen ? (
        <SettingsDialog
          config={library.config}
          folders={library.folders}
          onClose={() => setSettingsOpen(false)}
          onConfigChange={updateConfig}
          onExport={exportLibrary}
          onImportClick={() => fileInputRef.current?.click()}
          onImportUrl={importLibraryFromUrl}
          onReset={() => setLibrary(createDefaultLibrary())}
          onFoldersChange={(folders) =>
            setLibrary((draft) => ({
              ...draft,
              folders,
              feeds: draft.feeds.map((feed) =>
                folders.some((folder) => folder.id === feed.folderId)
                  ? feed
                  : { ...feed, folderId: folders[0]?.id || "" },
              ),
            }))
          }
        />
      ) : null}

      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept="application/json,.json"
        onChange={(event) => importLibrary(event.target.files?.[0])}
      />
    </div>
  );
}

function ActionTooltip({ children, label, placement = "top" }) {
  return (
    <Tooltip.Root delay={260} closeDelay={80}>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
      <Tooltip.Content className="app-tooltip" placement={placement} showArrow>
        {label}
      </Tooltip.Content>
    </Tooltip.Root>
  );
}

function SourcesPane({
  activeFilter,
  articles,
  feeds,
  folders,
  isCollapsed,
  isRefreshing,
  mobilePane,
  onAdd,
  onEditFeed,
  onMarkAllRead,
  onOpenSettings,
  onRefreshAll,
  onRefreshFeed,
  onRemoveFeed,
  onSelectSource,
  onToggleCollapse,
  selectedFeedId,
  starredTotal,
  unreadTotal,
}) {
  return (
    <aside
      className={`pane sources-pane ${isCollapsed ? "is-collapsed" : ""} ${
        mobilePane === "sources" ? "mobile-active" : ""
      }`}
    >
      <div className="pane-rail" aria-label="订阅栏已折叠">
        <ActionTooltip label="展开订阅栏" placement="right">
          <Button
            isIconOnly
            variant="light"
            aria-label="展开订阅栏"
            title="展开订阅栏"
            onPress={onToggleCollapse}
          >
            <PanelLeftOpen size={18} />
          </Button>
        </ActionTooltip>
        <ActionTooltip label="刷新全部" placement="right">
          <Button
            isIconOnly
            variant="light"
            aria-label="刷新全部"
            title="刷新全部"
            onPress={onRefreshAll}
            isDisabled={isRefreshing}
          >
            <RefreshCw size={18} className={isRefreshing ? "spin" : ""} />
          </Button>
        </ActionTooltip>
        <ActionTooltip label="添加订阅" placement="right">
          <Button
            isIconOnly
            variant="light"
            aria-label="添加订阅"
            title="添加订阅"
            onPress={onAdd}
          >
            <Plus size={18} />
          </Button>
        </ActionTooltip>
        <ActionTooltip label="全部已读" placement="right">
          <Button
            isIconOnly
            variant="light"
            aria-label="全部已读"
            title="全部已读"
            onPress={onMarkAllRead}
          >
            <CheckCheck size={18} />
          </Button>
        </ActionTooltip>
        <ActionTooltip label="设置" placement="right">
          <Button
            isIconOnly
            variant="light"
            aria-label="设置"
            title="设置"
            onPress={onOpenSettings}
          >
            <Settings size={18} />
          </Button>
        </ActionTooltip>
      </div>

      <div className="pane-body">
        <div className="pane-header sidebar-header source-toolbar">
          <div className="sidebar-actions">
            <ActionTooltip label="刷新全部">
              <Button
                isIconOnly
                variant="flat"
                aria-label="刷新全部"
                title="刷新全部"
                onPress={onRefreshAll}
                isDisabled={isRefreshing}
              >
                <RefreshCw size={18} className={isRefreshing ? "spin" : ""} />
              </Button>
            </ActionTooltip>
            <ActionTooltip label="添加订阅">
              <Button
                isIconOnly
                variant="flat"
                aria-label="添加订阅"
                title="添加订阅"
                onPress={onAdd}
              >
                <Plus size={18} />
              </Button>
            </ActionTooltip>
            <ActionTooltip label="全部已读">
              <Button
                isIconOnly
                variant="flat"
                aria-label="全部已读"
                title="全部已读"
                onPress={onMarkAllRead}
              >
                <CheckCheck size={18} />
              </Button>
            </ActionTooltip>
            <ActionTooltip label="设置">
              <Button
                isIconOnly
                variant="flat"
                aria-label="设置"
                title="设置"
                onPress={onOpenSettings}
              >
                <Settings size={18} />
              </Button>
            </ActionTooltip>
            <ActionTooltip label="折叠订阅栏">
              <Button
                isIconOnly
                className="desktop-only"
                variant="flat"
                aria-label="折叠订阅栏"
                title="折叠订阅栏"
                onPress={onToggleCollapse}
              >
                <PanelLeftClose size={18} />
              </Button>
            </ActionTooltip>
          </div>
        </div>

        <div className="smart-list">
          <SourceButton
            active={selectedFeedId === "all" && activeFilter === "all"}
            icon={<List size={17} />}
            label="全部"
            count={articles.length}
            onClick={() => onSelectSource("all", "all")}
          />
          <SourceButton
            active={activeFilter === "unread"}
            icon={<Bookmark size={17} />}
            label="未读"
            count={unreadTotal}
            onClick={() => onSelectSource("all", "unread")}
          />
          <SourceButton
            active={activeFilter === "starred"}
            icon={<Star size={17} />}
            label="星标"
            count={starredTotal}
            onClick={() => onSelectSource("all", "starred")}
          />
        </div>

        <div className="folder-list">
          {folders.map((folder) => {
            const folderFeeds = feeds.filter((feed) => feed.folderId === folder.id);
            const folderUnread = folderFeeds.reduce((sum, feed) => sum + feed.unreadCount, 0);

            return (
              <section className="folder-group" key={folder.id}>
                <button
                  type="button"
                  className={`folder-title ${
                    selectedFeedId === `folder:${folder.id}` ? "active" : ""
                  }`}
                  onClick={() => onSelectSource(`folder:${folder.id}`, "all")}
                >
                  <span>{folder.name}</span>
                  {folderUnread ? <strong>{folderUnread}</strong> : null}
                </button>

                <div className="feed-list">
                  {folderFeeds.map((feed) => (
                    <div
                      className={`feed-row ${selectedFeedId === feed.id ? "selected" : ""}`}
                      key={feed.id}
                    >
                      <button type="button" onClick={() => onSelectSource(feed.id, "all")}>
                        <span className={`feed-dot ${feed.status}`} />
                        <span className="feed-name">{feed.title}</span>
                        {feed.unreadCount ? (
                          <span className="count">{feed.unreadCount}</span>
                        ) : null}
                      </button>
                      <div className="feed-actions">
                        <ActionTooltip label="刷新订阅" placement="right">
                          <button
                            type="button"
                            aria-label="刷新订阅"
                            title="刷新订阅"
                            onClick={() => onRefreshFeed(feed.id)}
                          >
                            <RefreshCw size={14} />
                          </button>
                        </ActionTooltip>
                        <ActionTooltip label="编辑订阅" placement="right">
                          <button
                            type="button"
                            aria-label="编辑订阅"
                            title="编辑订阅"
                            onClick={() => onEditFeed(feed.id)}
                          >
                            <Edit3 size={14} />
                          </button>
                        </ActionTooltip>
                        <ActionTooltip label="删除订阅" placement="right">
                          <button
                            type="button"
                            aria-label="删除订阅"
                            title="删除订阅"
                            onClick={() => onRemoveFeed(feed.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </ActionTooltip>
                      </div>
                      {feed.error ? <p className="feed-error">{feed.error}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function SourceButton({ active, count, icon, label, onClick }) {
  return (
    <button className={`source-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
      <span className="source-icon">{icon}</span>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function ArticleListPane({
  articles,
  feeds,
  isCollapsed,
  mobilePane,
  onBack,
  onSearch,
  onSelectArticle,
  onToggleCollapse,
  query,
  selectedArticleId,
  sourceTitle,
}) {
  return (
    <section
      className={`pane list-pane ${isCollapsed ? "is-collapsed" : ""} ${
        mobilePane === "articles" ? "mobile-active" : ""
      }`}
    >
      <div className="pane-rail" aria-label="文章列表已折叠">
        <ActionTooltip label="展开标题栏" placement="right">
          <Button
            isIconOnly
            variant="light"
            aria-label="展开标题栏"
            title="展开标题栏"
            onPress={onToggleCollapse}
          >
            <PanelLeftOpen size={18} />
          </Button>
        </ActionTooltip>
        <span className="rail-divider" />
        <List size={18} aria-hidden="true" />
      </div>

      <div className="pane-body">
        <div className="pane-header list-header">
          <Button
            isIconOnly
            variant="light"
            className="mobile-back"
            aria-label="返回"
            title="返回"
            onPress={onBack}
          >
            <ChevronLeft size={19} />
          </Button>
          <div>
            <span className="eyebrow">Articles</span>
            <h2>{sourceTitle}</h2>
          </div>
          <ActionTooltip label="折叠标题栏">
            <Button
              isIconOnly
              className="desktop-only"
              variant="flat"
              aria-label="折叠标题栏"
              title="折叠标题栏"
              onPress={onToggleCollapse}
            >
              <PanelLeftClose size={18} />
            </Button>
          </ActionTooltip>
        </div>

        <label className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索标题、作者、摘要"
            type="search"
          />
        </label>

        <div className="article-list">
          {articles.length ? (
            articles.map((article) => {
              const feed = feeds.find((item) => item.id === article.feedId);

              return (
                <a
                  href={articleRouteHref(article.id)}
                  className={`article-row ${selectedArticleId === article.id ? "selected" : ""} ${
                    article.read ? "read" : "unread"
                  }`}
                  key={article.id}
                  onClick={(event) => {
                    if (!isPlainLeftClick(event)) {
                      return;
                    }

                    event.preventDefault();
                    onSelectArticle(article.id);
                  }}
                >
                  <span className="article-source">{feed?.title || "RSS"}</span>
                  <span className="article-title">
                    {!article.read ? <i /> : null}
                    {article.title}
                  </span>
                  <span className="article-excerpt">{article.excerpt}</span>
                  <span className="article-meta">
                    {article.author ? `${article.author} · ` : ""}
                    {formatShortDate(article.publishedAt || article.fetchedAt)}
                    {article.starred ? <Star size={14} fill="currentColor" /> : null}
                  </span>
                </a>
              );
            })
          ) : (
            <EmptyState icon={<MonitorSmartphone size={28} />} title="暂无文章" />
          )}
        </div>
      </div>
    </section>
  );
}

function ReaderPane({
  aiStatus,
  article,
  feed,
  mobilePane,
  onAccessLogin,
  onBack,
  onReaderScroll,
  onResetAi,
  onRunAi,
  onToggleAiMode,
  onToggleStar,
}) {
  const articleLink = normalizeArticleLink(article?.link);
  const isAiBusy = aiStatus.articleId === article?.id && !aiStatus.message;
  const hasCurrentAiContent = Boolean(
    article?.aiContent && article?.aiPromptVersion === AI_CACHE_VERSION,
  );
  const isAiMode = Boolean(article?.aiMode && hasCurrentAiContent);
  const displayedHtml =
    isAiMode && article.aiContent
      ? article.aiContent
      : article?.content || `<p>${article?.excerpt || "没有正文内容。"}</p>`;

  return (
    <main className={`pane reader-pane ${mobilePane === "reader" ? "mobile-active" : ""}`}>
      {article ? (
        <>
          <div className="reader-toolbar">
            <Button
              isIconOnly
              variant="light"
              className="mobile-back"
              aria-label="返回"
              title="返回"
              onPress={onBack}
            >
              <ChevronLeft size={19} />
            </Button>
            <div className="reader-source">
              <span>{feed?.title || "RSS"}</span>
              {article.publishedAt ? <time>{formatLongDate(article.publishedAt)}</time> : null}
            </div>
            <div className="reader-actions">
              {hasCurrentAiContent && isAiMode ? (
                <ActionTooltip label="退出 AI 模式">
                  <Button
                    isIconOnly
                    className="reader-action-button"
                    variant="flat"
                    aria-label="退出 AI 模式"
                    title="退出 AI 模式"
                    onPress={() => onToggleAiMode(article.id, false)}
                  >
                    <Undo2 size={18} />
                  </Button>
                </ActionTooltip>
              ) : (
                <ActionTooltip label={hasCurrentAiContent ? "查看 AI 内容" : "AI 总结/翻译"}>
                  <Button
                    isIconOnly
                    className="reader-action-button"
                    variant="flat"
                    aria-label={hasCurrentAiContent ? "查看 AI 内容" : "AI 总结/翻译"}
                    title={hasCurrentAiContent ? "查看 AI 内容" : "AI 总结/翻译"}
                    isDisabled={isAiBusy}
                    onPress={() =>
                      hasCurrentAiContent
                        ? onToggleAiMode(article.id, true)
                        : onRunAi(article)
                    }
                  >
                    <Sparkles size={18} className={isAiBusy ? "spin" : ""} />
                  </Button>
                </ActionTooltip>
              )}
              {hasCurrentAiContent ? (
                <ActionTooltip label="重新生成 AI 内容">
                  <Button
                    isIconOnly
                    className="reader-action-button"
                    variant="flat"
                    aria-label="重新生成 AI 内容"
                    title="重新生成 AI 内容"
                    isDisabled={isAiBusy}
                    onPress={() => {
                      onResetAi(article.id);
                      onRunAi(article);
                    }}
                  >
                    <RefreshCw size={18} className={isAiBusy ? "spin" : ""} />
                  </Button>
                </ActionTooltip>
              ) : null}
              <ActionTooltip label={article.starred ? "取消星标" : "星标"}>
                <Button
                  isIconOnly
                  className={`reader-action-button ${article.starred ? "is-active" : ""}`}
                  variant="flat"
                  aria-label={article.starred ? "取消星标" : "星标"}
                  title={article.starred ? "取消星标" : "星标"}
                  onPress={() => onToggleStar(article.id)}
                >
                  <Star size={18} fill={article.starred ? "currentColor" : "none"} />
                </Button>
              </ActionTooltip>
              {articleLink ? (
                <ActionTooltip label="打开原文">
                  <a
                    className="reader-action-button"
                    href={articleLink}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="打开原文"
                    title="打开原文"
                  >
                    <ExternalLink size={18} />
                  </a>
                </ActionTooltip>
              ) : null}
            </div>
          </div>

          <article className="reader-content" onScroll={onReaderScroll}>
            {isAiMode ? (
              <div className="ai-mode-banner">
                <Sparkles size={16} />
                <span>AI 模式</span>
                {article.aiGeneratedAt ? <time>{formatLongDate(article.aiGeneratedAt)}</time> : null}
              </div>
            ) : null}
            <h1>{article.title}</h1>
            <div className="byline">
              {article.author ? <span>{article.author}</span> : null}
              {article.publishedAt ? <time>{formatLongDate(article.publishedAt)}</time> : null}
            </div>
            {aiStatus.message ? (
              <div className="ai-error">
                <span>{aiStatus.message}</span>
                {aiStatus.loginUrl ? (
                  <button type="button" onClick={() => onAccessLogin(aiStatus.loginUrl)}>
                    登录 Cloudflare Access
                  </button>
                ) : null}
              </div>
            ) : null}
            <div
              className="article-html"
              dangerouslySetInnerHTML={{
                __html: displayedHtml,
              }}
            />
          </article>
        </>
      ) : (
        <EmptyState icon={<Rss size={30} />} title="选择一篇文章" />
      )}
    </main>
  );
}

function normalizeArticleLink(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, window.location.href).href;
  } catch {
    return "";
  }
}

function currentAiCache(article) {
  if (!article?.aiContent || article.aiPromptVersion !== AI_CACHE_VERSION) {
    return {
      aiContent: "",
      aiGeneratedAt: "",
      aiMode: false,
      aiPromptVersion: "",
    };
  }

  return {
    aiContent: article.aiContent,
    aiGeneratedAt: article.aiGeneratedAt || "",
    aiMode: Boolean(article.aiMode),
    aiPromptVersion: article.aiPromptVersion,
  };
}

function articleRouteHref(articleId) {
  return `#/article/${encodeURIComponent(articleId)}`;
}

function readRouteArticleId() {
  const hash = window.location.hash.replace(/^#/, "");
  const normalizedHash = hash.startsWith("/") ? hash : `/${hash}`;
  const prefix = "/article/";

  if (!normalizedHash.startsWith(prefix)) {
    return "";
  }

  try {
    return decodeURIComponent(normalizedHash.slice(prefix.length));
  } catch {
    return "";
  }
}

function writeArticleRoute(articleId) {
  const nextHash = articleRouteHref(articleId).slice(1);

  if (window.location.hash !== `#${nextHash}`) {
    window.location.hash = nextHash;
  }
}

function clearArticleRoute() {
  if (readRouteArticleId()) {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

function isPlainLeftClick(event) {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

function validateAiWorkerUrl(value) {
  const url = new URL(String(value || "").trim());

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("请先在设置里填写有效的 AI Worker URL");
  }

  return url.href;
}

function buildAiHealthUrl(value) {
  try {
    const url = new URL(validateAiWorkerUrl(value));
    url.pathname = "/ai/health";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "https://api.plunox.site/ai/health";
  }
}

function AddFeedDialog({ folders, onClose, onSubmit }) {
  const [form, setForm] = useState({
    url: "",
    title: "",
    folderId: folders[0]?.id || "",
    newFolder: "",
  });

  return (
    <Dialog title="添加订阅" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.url.trim()) {
            return;
          }
          onSubmit(form);
        }}
      >
        <label>
          <span>RSS 地址</span>
          <input
            required
            value={form.url}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
            placeholder="https://example.com/feed.xml"
            type="url"
          />
        </label>
        <label>
          <span>标题</span>
          <input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="自动使用源标题"
            type="text"
          />
        </label>
        <label>
          <span>文件夹</span>
          <select
            value={form.folderId}
            onChange={(event) => setForm({ ...form, folderId: event.target.value })}
          >
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>新文件夹</span>
          <input
            value={form.newFolder}
            onChange={(event) => setForm({ ...form, newFolder: event.target.value })}
            placeholder="留空则使用所选文件夹"
            type="text"
          />
        </label>
        <div className="dialog-actions">
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button className="accent-button" type="submit">
            添加
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditFeedDialog({ feed, folders, onClose, onSubmit }) {
  const [form, setForm] = useState(feed);

  if (!feed) {
    return null;
  }

  return (
    <Dialog title="编辑订阅" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(form);
        }}
      >
        <label>
          <span>标题</span>
          <input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            type="text"
          />
        </label>
        <label>
          <span>RSS 地址</span>
          <input
            required
            value={form.url}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
            type="url"
          />
        </label>
        <label>
          <span>文件夹</span>
          <select
            value={form.folderId}
            onChange={(event) => setForm({ ...form, folderId: event.target.value })}
          >
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button className="accent-button" type="submit">
            保存
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SettingsDialog({
  config,
  folders,
  onClose,
  onConfigChange,
  onExport,
  onFoldersChange,
  onImportClick,
  onImportUrl,
  onReset,
}) {
  const [folderDrafts, setFolderDrafts] = useState(folders);
  const [importUrl, setImportUrl] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [isImportingUrl, setImportingUrl] = useState(false);

  function commitFolders(nextFolders) {
    setFolderDrafts(nextFolders);
    onFoldersChange(nextFolders);
  }

  async function submitImportUrl(event) {
    event.preventDefault();
    const trimmedUrl = importUrl.trim();

    if (!trimmedUrl) {
      setImportStatus("请输入配置 JSON 的 URL。");
      return;
    }

    setImportingUrl(true);
    setImportStatus("");

    try {
      await onImportUrl(trimmedUrl);
    } catch (error) {
      setImportStatus(error?.message || "在线导入失败。");
    } finally {
      setImportingUrl(false);
    }
  }

  return (
    <Dialog title="设置" onClose={onClose} wide>
      <div className="settings-grid">
        <section className="settings-section network-section">
          <div className="section-heading">
            <h3>刷新与代理</h3>
          </div>
          <label>
            <span>间隔分钟</span>
            <input
              min="1"
              value={config.refreshMinutes}
              onChange={(event) =>
                onConfigChange({ refreshMinutes: Number(event.target.value) || 1 })
              }
              type="number"
            />
          </label>
          <label>
            <span>代理模板</span>
            <input
              value={config.proxyTemplate}
              onChange={(event) => onConfigChange({ proxyTemplate: event.target.value })}
              placeholder="留空则直接请求 RSS 地址"
              type="text"
            />
            <small className="field-note">
              默认代理不会留存用户信息和请求记录；也可以替换为自己的代理地址，或清空后直接请求 RSS。
            </small>
          </label>
        </section>

        <section className="settings-section ai-settings-section">
          <div className="section-heading">
            <h3>AI</h3>
            <p>填入部署在 Worker 上的 AI 接口地址。模型厂商的 Base URL、模型和 API Key 放在 Worker 环境变量里。</p>
          </div>
          <label>
            <span>AI Worker URL</span>
            <input
              value={config.aiWorkerUrl || ""}
              onChange={(event) => onConfigChange({ aiWorkerUrl: event.target.value })}
              placeholder="https://api.example.com/ai/responses"
              type="url"
            />
          </label>
          <label>
            <span>AI 鉴权</span>
            <select
              value={config.aiAuthMode || "none"}
              onChange={(event) => onConfigChange({ aiAuthMode: event.target.value })}
            >
              <option value="none">不使用鉴权</option>
              <option value="cloudflareAccess">Cloudflare Access</option>
            </select>
            <small className="field-note">
              使用 Cloudflare Access 时，AI 请求会携带 Access 登录 Cookie；RSS 代理仍保持公开。
            </small>
          </label>
        </section>

        <section className="settings-section reader-settings-section">
          <div className="section-heading">
            <h3>阅读外观</h3>
          </div>
          <label>
            <span>字体</span>
            <select
              value={config.fontFamily}
              onChange={(event) => onConfigChange({ fontFamily: event.target.value })}
            >
              <option value="system">系统默认</option>
              <option value="serif">衬线</option>
              <option value="mono">等宽</option>
            </select>
          </label>
          <RangeControl
            label="字号"
            max={24}
            min={14}
            onChange={(fontSize) => onConfigChange({ fontSize })}
            suffix="px"
            value={config.fontSize}
          />
          <RangeControl
            label="行高"
            max={2}
            min={1.3}
            onChange={(lineHeight) => onConfigChange({ lineHeight })}
            step={0.1}
            value={config.lineHeight}
          />
          <RangeControl
            label="正文宽度"
            max={980}
            min={620}
            onChange={(readerWidth) => onConfigChange({ readerWidth })}
            suffix="px"
            value={config.readerWidth}
          />
          <label>
            <span>主题</span>
            <select
              value={config.theme}
              onChange={(event) => onConfigChange({ theme: event.target.value })}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label>
            <span>强调色</span>
            <select
              value={config.accentColor || "blue"}
              onChange={(event) => onConfigChange({ accentColor: event.target.value })}
            >
              {ACCENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>密度</span>
            <select
              value={config.density}
              onChange={(event) => onConfigChange({ density: event.target.value })}
            >
              <option value="comfortable">舒适</option>
              <option value="compact">紧凑</option>
            </select>
          </label>
        </section>

        <section className="settings-section folder-settings-section">
          <div className="section-heading section-heading-with-action">
            <h3>文件夹</h3>
            <ActionTooltip label="新文件夹">
              <Button
                isIconOnly
                aria-label="新文件夹"
                className="settings-icon-button"
                title="新文件夹"
                variant="flat"
                onPress={() => commitFolders([...folderDrafts, createFolder("新文件夹")])}
              >
                <FolderPlus size={17} />
              </Button>
            </ActionTooltip>
          </div>
          <div className="folder-editor">
            {folderDrafts.map((folder) => (
              <div className="folder-edit-row" key={folder.id}>
                <input
                  value={folder.name}
                  onChange={(event) =>
                    commitFolders(
                      folderDrafts.map((item) =>
                        item.id === folder.id ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                />
                <ActionTooltip label="删除文件夹">
                  <button
                    aria-label="删除文件夹"
                    title="删除文件夹"
                    disabled={folderDrafts.length <= 1}
                    onClick={() => commitFolders(folderDrafts.filter((item) => item.id !== folder.id))}
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </ActionTooltip>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-section sync-section">
          <div className="section-heading">
            <h3>配置同步</h3>
            <p>仅导出配置、文件夹和订阅地址，不包含文章内容、已读状态或本地缓存。</p>
          </div>
          <div className="settings-action-row">
            <ActionTooltip label="导出配置 JSON">
              <Button
                isIconOnly
                aria-label="导出配置 JSON"
                className="settings-icon-button"
                title="导出配置 JSON"
                variant="flat"
                onPress={onExport}
              >
                <Download size={17} />
              </Button>
            </ActionTooltip>
            <ActionTooltip label="从文件导入">
              <Button
                isIconOnly
                aria-label="从文件导入"
                className="settings-icon-button"
                title="从文件导入"
                variant="flat"
                onPress={onImportClick}
              >
                <Upload size={17} />
              </Button>
            </ActionTooltip>
          </div>
          <form className="url-import-form" onSubmit={submitImportUrl}>
            <label>
              <span>在线导入 URL</span>
              <div className="url-import-controls">
                <input
                  value={importUrl}
                  onChange={(event) => setImportUrl(event.target.value)}
                  placeholder="https://example.com/rss-reader-config.json"
                  type="url"
                />
                <ActionTooltip label={isImportingUrl ? "导入中" : "从 URL 导入"}>
                  <Button
                    isIconOnly
                    aria-label={isImportingUrl ? "导入中" : "从 URL 导入"}
                    className="settings-icon-button settings-icon-button-primary"
                    isDisabled={isImportingUrl}
                    title={isImportingUrl ? "导入中" : "从 URL 导入"}
                    type="submit"
                  >
                    <Link2 size={17} />
                  </Button>
                </ActionTooltip>
              </div>
            </label>
            {importStatus ? <p className="form-status error">{importStatus}</p> : null}
          </form>
          <div className="danger-zone">
            <ActionTooltip label="重置本地数据">
              <Button
                isIconOnly
                aria-label="重置本地数据"
                className="settings-icon-button settings-icon-button-danger"
                title="重置本地数据"
                variant="flat"
                onPress={onReset}
              >
                <RotateCcw size={17} />
              </Button>
            </ActionTooltip>
          </div>
        </section>

        <section className="settings-section about-section">
          <div className="section-heading">
            <h3>关于</h3>
          </div>
          <p>Copyright © 2026 Zijian Zhang. Released under the MIT License.</p>
          <a href="https://github.com/zijian-z/rss-reader" target="_blank" rel="noreferrer">
            github.com/zijian-z/rss-reader
          </a>
        </section>
      </div>

    </Dialog>
  );
}

function RangeControl({ label, max, min, onChange, step = 1, suffix = "", value }) {
  return (
    <label>
      <span>
        {label}
        <strong>
          {value}
          {suffix}
        </strong>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function Dialog({ children, onClose, title, wide = false }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        aria-modal="true"
        className={`dialog ${wide ? "wide" : ""}`}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>{title}</h2>
          <ActionTooltip label="关闭">
            <Button isIconOnly variant="light" aria-label="关闭" title="关闭" onPress={onClose}>
              <X size={18} />
            </Button>
          </ActionTooltip>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ icon, title }) {
  return (
    <div className="empty-state">
      {icon}
      <p>{title}</p>
    </div>
  );
}

function recalculateUnreadCounts(feeds, articles) {
  return feeds.map((feed) => ({
    ...feed,
    unreadCount: articles.filter((article) => article.feedId === feed.id && !article.read).length,
  }));
}

function sourceTitle(library, selectedFeed) {
  if (library.activeFilter === "unread") {
    return "未读";
  }

  if (library.activeFilter === "starred") {
    return "星标";
  }

  if (library.selectedFeedId?.startsWith("folder:")) {
    const folder = library.folders.find(
      (item) => item.id === library.selectedFeedId.replace("folder:", ""),
    );
    return folder?.name || "文件夹";
  }

  if (library.selectedFeedId === "all") {
    return "全部";
  }

  return selectedFeed?.title || "文章";
}

function fontFamilyValue(value) {
  if (value === "serif") {
    return 'Iowan Old Style, Charter, Georgia, "Times New Roman", serif';
  }

  if (value === "mono") {
    return '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
  }

  return '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif';
}

function formatShortDate(value) {
  if (!value) {
    return "刚刚";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : formatter.format(date);
}

function formatLongDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateOnlyFormatter.format(date);
}

export default App;
