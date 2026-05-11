const BLOCKED_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "link",
  "meta",
]);

export function hashString(input) {
  let hash = 2166136261;
  const text = String(input || "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function fetchAndParseFeed(feed, proxyTemplate = "") {
  const url = buildFetchUrl(feed.url, proxyTemplate);
  const text = await fetchFeedText(url);

  return parseFeedXml(text, feed);
}

async function fetchFeedText(url) {
  if (window.rssBridge?.fetchFeed) {
    return window.rssBridge.fetchFeed(url);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.text();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function buildFetchUrl(feedUrl, proxyTemplate = "") {
  const trimmedProxy = proxyTemplate.trim();

  if (!trimmedProxy) {
    return feedUrl;
  }

  if (trimmedProxy.includes("{url}")) {
    return trimmedProxy.replaceAll("{url}", encodeURIComponent(feedUrl));
  }

  const separator = trimmedProxy.includes("?") ? "&" : "?";
  return `${trimmedProxy}${separator}url=${encodeURIComponent(feedUrl)}`;
}

export function parseFeedXml(xmlText, feed) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  const parserError = xml.querySelector("parsererror");

  if (parserError) {
    throw new Error("无法解析 RSS/Atom 内容");
  }

  const rootName = xml.documentElement?.localName?.toLowerCase();

  if (rootName === "feed") {
    return parseAtom(xml, feed);
  }

  return parseRss(xml, feed);
}

function parseRss(xml, feed) {
  const channel = xml.querySelector("channel") || xml;
  const siteTitle = textFrom(channel, ["title"]) || feed.title || feed.url;
  const siteUrl = textFrom(channel, ["link"]) || feed.siteUrl || "";
  const description = stripHtml(textFrom(channel, ["description"]) || "");
  const items = Array.from(xml.querySelectorAll("item"));

  return {
    title: siteTitle,
    siteUrl,
    description,
    articles: items.map((item) => normalizeArticle(item, feed, "rss")),
  };
}

function parseAtom(xml, feed) {
  const root = xml.documentElement;
  const siteTitle = textFrom(root, ["title"]) || feed.title || feed.url;
  const siteUrl = linkFromAtom(root) || feed.siteUrl || "";
  const description = stripHtml(textFrom(root, ["subtitle"]) || "");
  const items = Array.from(root.querySelectorAll("entry"));

  return {
    title: siteTitle,
    siteUrl,
    description,
    articles: items.map((item) => normalizeArticle(item, feed, "atom")),
  };
}

function normalizeArticle(item, feed, format) {
  const guid =
    textFrom(item, ["guid", "id"]) ||
    linkFromAtom(item) ||
    textFrom(item, ["link"]) ||
    textFrom(item, ["title"]);
  const link = format === "atom" ? linkFromAtom(item) : textFrom(item, ["link"]);
  const title = stripHtml(textFrom(item, ["title"]) || "无标题");
  const rawContent =
    textFrom(item, ["content:encoded", "encoded", "content"]) ||
    textFrom(item, ["description", "summary"]) ||
    "";
  const publishedAt =
    normalizeDate(
      textFrom(item, ["pubDate", "published", "updated", "dc:date", "date"]),
    ) || "";
  const author =
    textFrom(item, ["dc:creator", "creator", "author", "name"]) ||
    authorFromAtom(item) ||
    "";
  const stableId = hashString(`${feed.url}|${guid || link || title}`);
  const cleanContent = sanitizeArticleHtml(rawContent);
  const excerpt = createExcerpt(cleanContent || title);

  return {
    id: stableId,
    feedId: feed.id,
    guid: guid || stableId,
    title,
    link: link || "",
    content: cleanContent,
    excerpt,
    author,
    publishedAt,
    fetchedAt: new Date().toISOString(),
  };
}

function linkFromAtom(node) {
  const links = Array.from(node.children).filter(
    (child) => child.localName?.toLowerCase() === "link",
  );
  const alternate =
    links.find((link) => !link.getAttribute("rel") || link.getAttribute("rel") === "alternate") ||
    links[0];

  return alternate?.getAttribute("href") || alternate?.textContent?.trim() || "";
}

function authorFromAtom(node) {
  const author = Array.from(node.children).find(
    (child) => child.localName?.toLowerCase() === "author",
  );

  return author ? textFrom(author, ["name"]) : "";
}

function textFrom(node, names) {
  const wanted = names.map((name) => name.toLowerCase());
  const child = Array.from(node.children || []).find((candidate) => {
    const localName = candidate.localName?.toLowerCase();
    const nodeName = candidate.nodeName?.toLowerCase();

    return wanted.includes(localName) || wanted.includes(nodeName);
  });

  return child?.textContent?.trim() || "";
}

function normalizeDate(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function sanitizeArticleHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<main>${html || ""}</main>`, "text/html");
  const main = doc.querySelector("main");

  if (!main) {
    return "";
  }

  for (const element of Array.from(main.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();

    if (BLOCKED_ELEMENTS.has(tag)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith("on") || name === "style" || name === "srcset") {
        element.removeAttribute(attribute.name);
        continue;
      }

      if ((name === "href" || name === "src") && !isSafeUrl(value)) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tag === "a") {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer");
    }
  }

  return main.innerHTML.trim();
}

function isSafeUrl(value) {
  if (!value || value.startsWith("#") || value.startsWith("/")) {
    return true;
  }

  try {
    const parsed = new URL(value, window.location.href);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function stripHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || "", "text/html");
  return doc.body.textContent?.replace(/\s+/g, " ").trim() || "";
}

export function createExcerpt(html, length = 180) {
  const text = stripHtml(html);
  return text.length > length ? `${text.slice(0, length).trim()}...` : text;
}
