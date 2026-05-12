import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Tooltip } from "@heroui/react";
import {
  Bookmark,
  CheckCheck,
  ChevronLeft,
  Download,
  Edit3,
  FolderPlus,
  List,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Settings,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import {
  createDefaultLibrary,
  createFeed,
  createFolder,
  loadLibrary,
  normalizeLibrary,
  saveLibrary,
} from "./lib/library.js";
import { fetchAndParseFeed } from "./lib/rss.js";

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

function App() {
  const [library, setLibrary] = useState(loadLibrary);
  const [mobilePane, setMobilePane] = useState("sources");
  const [query, setQuery] = useState("");
  const [isAddOpen, setAddOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isSourcesCollapsed, setSourcesCollapsed] = useState(false);
  const [isArticleListCollapsed, setArticleListCollapsed] = useState(false);
  const [editingFeedId, setEditingFeedId] = useState("");
  const fileInputRef = useRef(null);
  const libraryRef = useRef(library);

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
    library.articles.find((article) => article.id === library.selectedArticleId) ||
    visibleArticles[0] ||
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
    setMobilePane("articles");
  }

  function selectArticle(articleId) {
    setLibrary((draft) => ({
      ...draft,
      selectedArticleId: articleId,
    }));
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
    const payload = {
      ...library,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rss-reader-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importLibrary(file) {
    if (!file) {
      return;
    }

    const text = await file.text();
    setLibrary(normalizeLibrary(JSON.parse(text)));
    setSettingsOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
      <header className="topbar">
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
          article={selectedArticle}
          feed={library.feeds.find((feed) => feed.id === selectedArticle?.feedId)}
          mobilePane={mobilePane}
          onBack={() => setMobilePane("articles")}
          onToggleStar={toggleStar}
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
                <button
                  type="button"
                  className={`article-row ${selectedArticleId === article.id ? "selected" : ""} ${
                    article.read ? "read" : "unread"
                  }`}
                  key={article.id}
                  onClick={() => onSelectArticle(article.id)}
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
                </button>
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

function ReaderPane({ article, feed, mobilePane, onBack, onToggleStar }) {
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
              <ActionTooltip label={article.starred ? "取消星标" : "星标"}>
                <Button
                  isIconOnly
                  variant={article.starred ? "solid" : "flat"}
                  color={article.starred ? "warning" : "default"}
                  aria-label={article.starred ? "取消星标" : "星标"}
                  title={article.starred ? "取消星标" : "星标"}
                  onPress={() => onToggleStar(article.id)}
                >
                  <Star size={18} fill={article.starred ? "currentColor" : "none"} />
                </Button>
              </ActionTooltip>
              {article.link ? (
                <Button
                  as="a"
                  href={article.link}
                  target="_blank"
                  rel="noreferrer"
                  variant="flat"
                  title="打开原文"
                >
                  原文
                </Button>
              ) : null}
            </div>
          </div>

          <article className="reader-content">
            <h1>{article.title}</h1>
            <div className="byline">
              {article.author ? <span>{article.author}</span> : null}
              {article.publishedAt ? <time>{formatLongDate(article.publishedAt)}</time> : null}
            </div>
            <div
              className="article-html"
              dangerouslySetInnerHTML={{
                __html: article.content || `<p>${article.excerpt || "没有正文内容。"}</p>`,
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
  onReset,
}) {
  const [folderDrafts, setFolderDrafts] = useState(folders);

  function commitFolders(nextFolders) {
    setFolderDrafts(nextFolders);
    onFoldersChange(nextFolders);
  }

  return (
    <Dialog title="设置" onClose={onClose} wide>
      <div className="settings-grid">
        <section>
          <h3>刷新</h3>
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

        <section>
          <h3>阅读</h3>
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

        <section>
          <h3>文件夹</h3>
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
                <button
                  aria-label="删除文件夹"
                  title="删除文件夹"
                  disabled={folderDrafts.length <= 1}
                  onClick={() => commitFolders(folderDrafts.filter((item) => item.id !== folder.id))}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="flat"
            startContent={<FolderPlus size={17} />}
            onPress={() => commitFolders([...folderDrafts, createFolder("新文件夹")])}
          >
            新文件夹
          </Button>
        </section>

        <section className="data-section">
          <h3>数据</h3>
          <div className="data-action-grid">
            <Button
              className="data-action-button"
              startContent={<Download size={17} />}
              variant="flat"
              onPress={onExport}
            >
              导出 JSON
            </Button>
            <Button
              className="data-action-button"
              startContent={<Upload size={17} />}
              variant="flat"
              onPress={onImportClick}
            >
              导入 JSON
            </Button>
            <Button className="data-action-button danger-action" variant="flat" onPress={onReset}>
              重置
            </Button>
          </div>
        </section>

        <section className="about-section">
          <h3>关于</h3>
          <p>Copyright © 2026 Zijian Zhang. Released under the MIT License.</p>
          <a href="https://github.com/zijian-z/rss-reader" target="_blank" rel="noreferrer">
            github.com/zijian-z/rss-reader
          </a>
        </section>
      </div>

      <div className="dialog-actions">
        <Button className="accent-button" onPress={onClose}>
          完成
        </Button>
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
          <Button isIconOnly variant="light" aria-label="关闭" title="关闭" onPress={onClose}>
            ×
          </Button>
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
