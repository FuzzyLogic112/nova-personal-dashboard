(() => {
  "use strict";

  const DB_NAME = "nova-private-vault-v1";
  const STORE_NAME = "bookmarks";
  const META_KEY = "nova.private-vault.meta.v1";
  const AI_USAGE_KEY = "nova.ai-usage.v1";
  const PAGE_SIZE = 12;
  const $ = (selector, root = document) => root.querySelector(selector);
  const safeNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  let bookmarks = [];
  let category = "全部";
  let query = "";
  let page = 1;
  let metadata = loadMetadata();

  function loadMetadata() {
    try {
      const saved = JSON.parse(localStorage.getItem(META_KEY));
      return saved && typeof saved === "object" ? { bookmarkStats: {}, ...saved } : { bookmarkStats: {}, lastPackAt: null };
    } catch {
      return { bookmarkStats: {}, lastPackAt: null };
    }
  }

  function saveMetadata() {
    localStorage.setItem(META_KEY, JSON.stringify(metadata));
  }

  function notify(message) {
    const region = $("#toastRegion");
    if (!region) return;
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    region.append(node);
    window.setTimeout(() => {
      node.classList.add("leaving");
      node.addEventListener("animationend", () => node.remove(), { once: true });
      window.setTimeout(() => node.remove(), 600);
    }, 2800);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (db.objectStoreNames.contains(STORE_NAME)) return;
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("url", "url", { unique: false });
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }

  async function readBookmarks() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.addEventListener("success", () => resolve(request.result || []));
      request.addEventListener("error", () => reject(request.error));
      transaction.addEventListener("complete", () => db.close());
    });
  }

  async function replaceBookmarks(items) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      items.forEach((item) => store.put(item));
      transaction.addEventListener("complete", () => { db.close(); resolve(); });
      transaction.addEventListener("error", () => { db.close(); reject(transaction.error); });
      transaction.addEventListener("abort", () => { db.close(); reject(transaction.error); });
    });
  }

  function canonicalUrl(value) {
    try {
      const url = new URL(String(value));
      if (!/^https?:$/.test(url.protocol)) return "";
      url.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "spm", "from"].forEach((key) => url.searchParams.delete(key));
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
      return url.toString();
    } catch {
      return "";
    }
  }

  function hostname(value) {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return "未知域名";
    }
  }

  const CATEGORY_RULES = [
    ["AI 与自动化", /\b(ai|llm|gpt|claude|gemini|prompt|agent|openai|anthropic|huggingface)\b|人工智能|大模型|海外社交媒体ai/i],
    ["开源与代码", /github|gitlab|gitee|开源|代码|repository|developer/i],
    ["云与部署", /vercel|netlify|cloudflare|docker|kubernetes|部署|云服务|serverless/i],
    ["服务器 · VPS", /\bvps\b|服务器|主机|hosting|racknerd|bandwagon|digitalocean/i],
    ["网络 · IP", /\b(ip|dns|proxy|vpn|cdn)\b|网络|代理|中转站/i],
    ["域名", /domain|域名|namesilo|namecheap|spaceship/i],
    ["安全 · CTF", /\bctf\b|security|安全|漏洞|hack|渗透/i],
    ["职业机会", /招聘|求职|就业|career|jobs?|linkedin|boss直聘/i],
    ["学习资料", /教程|学习|课程|文档|docs?|linux学习|book|大学/i],
    ["设计与创作", /figma|canva|design|dribbble|behance|设计|配色|字体/i],
    ["社交与社区", /twitter|x\.com|reddit|discord|telegram|微博|知乎|v2ex|社交/i],
    ["影音娱乐", /bilibili|youtube|netflix|电影|音乐|spotify|anime|video/i],
    ["效率工具", /notion|obsidian|productivity|效率|工具|资源|tool/i],
    ["资讯阅读", /news|blog|rss|新闻|博客|媒体|阅读/i]
  ];

  function classifyBookmark(item) {
    const haystack = `${item.title || ""} ${item.url || ""} ${(item.path || []).join(" ")}`;
    return CATEGORY_RULES.find(([, pattern]) => pattern.test(haystack))?.[0] || "待整理";
  }

  function normalizeBookmarks(rawItems) {
    const seen = new Set();
    return rawItems.map((item, index) => {
      const url = canonicalUrl(item.url);
      if (!url) return null;
      const path = Array.isArray(item.path)
        ? item.path.map(String)
        : String(item.path || item.folder || "").split(/[\\/›>]/).filter(Boolean);
      const duplicate = seen.has(url);
      seen.add(url);
      return {
        id: String(item.id || `bookmark-${index}-${url}`),
        title: String(item.title || item.name || hostname(url)).trim().slice(0, 240),
        url,
        path,
        category: String(item.category || classifyBookmark({ ...item, url, path })).slice(0, 40),
        addedAt: item.addedAt || item.dateAdded || null,
        duplicate
      };
    }).filter(Boolean);
  }

  function flattenChromium(node, path = [], output = []) {
    if (!node || typeof node !== "object") return output;
    const nextPath = node.type === "folder" && node.name ? [...path, node.name] : path;
    if (node.type === "url" && node.url) output.push({ id: node.guid || node.id, title: node.name, url: node.url, path, addedAt: node.date_added });
    if (Array.isArray(node.children)) node.children.forEach((child) => flattenChromium(child, nextPath, output));
    return output;
  }

  function parseBookmarkHtml(text) {
    const documentNode = new DOMParser().parseFromString(text, "text/html");
    return [...documentNode.querySelectorAll("a[href]")].map((anchor, index) => ({
      id: `html-${index}`,
      title: anchor.textContent.trim(),
      url: anchor.getAttribute("href"),
      path: ["浏览器导入"]
    }));
  }

  function extractImport(payload, text) {
    if (payload?.kind === "nova-private-pack" || payload?.kind === "nova-bookmark-export") return payload.bookmarks || [];
    if (Array.isArray(payload?.bookmarks)) return payload.bookmarks;
    if (payload?.roots) return Object.values(payload.roots).flatMap((root) => flattenChromium(root));
    if (Array.isArray(payload)) return payload;
    if (/<!DOCTYPE NETSCAPE-Bookmark-file/i.test(text) || /<a\s/i.test(text)) return parseBookmarkHtml(text);
    return [];
  }

  function importUsageFromPack(payload) {
    if (!payload?.usage || typeof payload.usage !== "object") return false;
    let current = { version: 1, codex: {}, claude: {} };
    try {
      current = { ...current, ...(JSON.parse(localStorage.getItem(AI_USAGE_KEY)) || {}) };
    } catch {
      // Start from an empty, safe usage store.
    }
    let changed = false;
    ["codex", "claude"].forEach((provider) => {
      const incoming = payload.usage[provider];
      if (!incoming) return;
      const remaining = Number(incoming.remaining);
      if (!Number.isFinite(remaining)) return;
      const updatedAt = incoming.updatedAt || payload.createdAt || new Date().toISOString();
      const previous = current[provider] && typeof current[provider] === "object" ? current[provider] : {};
      const history = Array.isArray(previous.history) ? previous.history.slice(-29) : [];
      history.push({ at: updatedAt, remaining: clamp(remaining, 0, 100) });
      current[provider] = {
        usedPercent: clamp(100 - remaining, 0, 100),
        resetAt: incoming.resetAt || null,
        plan: String(incoming.plan || (provider === "codex" ? "Plus" : "Pro")).slice(0, 30),
        updatedAt,
        history
      };
      changed = true;
    });
    if (changed) {
      current.version = 1;
      localStorage.setItem(AI_USAGE_KEY, JSON.stringify(current));
      window.dispatchEvent(new CustomEvent("nova:usage-imported"));
    }
    return changed;
  }

  async function importPrivateFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        // Browser bookmark exports are HTML, not JSON.
      }
      const normalized = normalizeBookmarks(extractImport(payload, text));
      const usageImported = importUsageFromPack(payload);
      if (!normalized.length && !usageImported) throw new Error("empty");
      if (normalized.length) {
        await replaceBookmarks(normalized);
        bookmarks = normalized;
        category = "全部";
        query = "";
        page = 1;
      }
      metadata.lastPackAt = new Date().toISOString();
      saveMetadata();
      renderBookmarks();
      const skipped = Math.max(0, safeNumber(payload?.sourceSummary?.urlNodes) - normalized.length);
      notify(normalized.length
        ? `已在当前浏览器整理 ${normalized.length} 个收藏网站${skipped ? `，跳过 ${skipped} 个内部项` : ""}`
        : "AI 额度快照已更新");
    } catch {
      notify("导入失败：请选择 NOVA 私有包、Edge/Chrome JSON 或书签 HTML");
    } finally {
      $("#privatePackFile").value = "";
    }
  }

  function fuzzyScore(item, search) {
    if (!search) return 1;
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    const title = item.title.toLowerCase();
    const domain = hostname(item.url).toLowerCase();
    const folder = item.path.join(" ").toLowerCase();
    const corpus = `${title} ${domain} ${folder} ${item.category.toLowerCase()}`;
    return terms.reduce((score, term) => {
      if (!corpus.includes(term)) return -999;
      if (title.startsWith(term)) return score + 8;
      if (title.includes(term)) return score + 5;
      if (domain.includes(term)) return score + 4;
      return score + 2;
    }, 0);
  }

  function usageScore(item) {
    const stat = metadata.bookmarkStats?.[item.url];
    if (!stat) return 0;
    const recencyDays = stat.last ? Math.max(0, (Date.now() - new Date(stat.last).getTime()) / 86400000) : 99;
    return safeNumber(stat.count) * 2 + Math.max(0, 8 - recencyDays) + safeNumber(stat.hours?.[new Date().getHours()]) * 3;
  }

  function visibleBookmarks() {
    return bookmarks
      .filter((item) => category === "全部" || item.category === category)
      .map((item) => ({ item, score: fuzzyScore(item, query) + usageScore(item) * .08 }))
      .filter((entry) => entry.score > -900)
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "zh-CN"))
      .map((entry) => entry.item);
  }

  function recordBookmarkOpen(item) {
    const stats = metadata.bookmarkStats || (metadata.bookmarkStats = {});
    const stat = stats[item.url] || { count: 0, last: null, hours: Array(24).fill(0) };
    stat.count += 1;
    stat.last = new Date().toISOString();
    if (!Array.isArray(stat.hours) || stat.hours.length !== 24) stat.hours = Array(24).fill(0);
    stat.hours[new Date().getHours()] = safeNumber(stat.hours[new Date().getHours()]) + 1;
    stats[item.url] = stat;
    saveMetadata();
  }

  function itemHue(item) {
    return [...hostname(item.url)].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 360;
  }

  function createBookmarkItem(item) {
    const anchor = document.createElement("a");
    anchor.className = `bookmark-item${item.duplicate ? " bookmark-duplicate" : ""}`;
    anchor.href = item.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.title = `${item.title}\n${item.path.join(" › ")}`;
    anchor.addEventListener("click", () => recordBookmarkOpen(item));

    const mark = document.createElement("span");
    mark.className = "bookmark-favicon";
    mark.style.setProperty("--favicon-hue", itemHue(item));
    mark.textContent = hostname(item.url).slice(0, 2);

    const copy = document.createElement("span");
    copy.className = "bookmark-copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("small");
    meta.textContent = `${hostname(item.url)} · ${item.category}${item.duplicate ? " · 重复" : ""}`;
    copy.append(title, meta);

    const external = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    external.setAttribute("class", "icon");
    external.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-external");
    external.append(use);
    anchor.append(mark, copy, external);
    return anchor;
  }

  function renderSmartLaunch() {
    const wrapper = $("#smartLaunch");
    const list = $("#smartLaunchList");
    const candidates = bookmarks
      .map((item) => ({ item, score: usageScore(item) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    wrapper.hidden = !candidates.length;
    list.replaceChildren();
    candidates.forEach(({ item }) => {
      const anchor = document.createElement("a");
      anchor.className = "smart-chip";
      anchor.href = item.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.addEventListener("click", () => recordBookmarkOpen(item));
      const mark = document.createElement("i");
      mark.textContent = hostname(item.url).slice(0, 1);
      const text = document.createElement("span");
      text.textContent = item.title.slice(0, 20);
      anchor.append(mark, text);
      list.append(anchor);
    });
    $("#bookmarkRecallCount").textContent = String(candidates.length);
  }

  function renderBookmarks() {
    const counts = bookmarks.reduce((map, item) => map.set(item.category, (map.get(item.category) || 0) + 1), new Map());
    $("#bookmarkTotal").textContent = bookmarks.length ? `${bookmarks.length} 个网站 · IndexedDB` : "等待导入";
    $("#bookmarkCategoryCount").textContent = String(counts.size);
    $("#bookmarkDuplicateCount").textContent = String(bookmarks.filter((item) => item.duplicate).length);
    $("#bookmarkStorageState").textContent = bookmarks.length ? `${bookmarks.length} 条仅存于此浏览器` : "尚未载入私有数据";

    const rail = $("#bookmarkCategories");
    rail.replaceChildren();
    [["全部", bookmarks.length], ...[...counts.entries()].sort((a, b) => b[1] - a[1])].forEach(([name, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `category-button${category === name ? " active" : ""}`;
      const label = document.createElement("span");
      label.textContent = name;
      const total = document.createElement("em");
      total.textContent = count;
      button.append(label, total);
      button.addEventListener("click", () => { category = name; page = 1; renderBookmarks(); });
      rail.append(button);
    });

    const results = $("#bookmarkResults");
    results.replaceChildren();
    if (!bookmarks.length) {
      const empty = document.createElement("div");
      empty.className = "vault-empty";
      empty.innerHTML = '<svg class="icon"><use href="#i-bookmark"></use></svg><strong>导入你的浏览器收藏夹</strong><p>选择本机生成的 NOVA 私有包、Edge/Chrome Bookmarks JSON，或浏览器导出的 HTML。网址不会上传到服务器。</p>';
      results.append(empty);
      $("#bookmarkPagination").hidden = true;
      $("#bookmarkRecallCount").textContent = "0";
      renderSmartLaunch();
      return;
    }

    const filtered = visibleBookmarks();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = clamp(page, 1, pages);
    const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "vault-empty";
      empty.innerHTML = "<strong>没有匹配的收藏</strong><p>试试更短的关键词，或切换到“全部”分类。</p>";
      results.append(empty);
    } else {
      visible.forEach((item) => results.append(createBookmarkItem(item)));
    }
    $("#bookmarkPagination").hidden = filtered.length <= PAGE_SIZE;
    $("#bookmarkPage").textContent = `${page} / ${pages}`;
    $("#bookmarkPrev").disabled = page <= 1;
    $("#bookmarkNext").disabled = page >= pages;
    renderSmartLaunch();
  }

  function exportBookmarks() {
    if (!bookmarks.length) return notify("收藏知识库还是空的");
    const payload = { kind: "nova-bookmark-export", version: 1, exportedAt: new Date().toISOString(), bookmarks };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `nova-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    notify("收藏知识库已导出");
  }

  function setupEvents() {
    $("#bookmarkImport").addEventListener("click", () => $("#privatePackFile").click());
    $("#privatePackFile").addEventListener("change", (event) => importPrivateFile(event.target.files[0]));
    $("#bookmarkExport").addEventListener("click", exportBookmarks);
    $("#bookmarkSearch").addEventListener("input", (event) => { query = event.target.value.trim(); page = 1; renderBookmarks(); });
    $("#bookmarkPrev").addEventListener("click", () => { page -= 1; renderBookmarks(); });
    $("#bookmarkNext").addEventListener("click", () => { page += 1; renderBookmarks(); });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $("dialog[open]")) return;
      event.preventDefault();
      $("#bookmarks").scrollIntoView({ behavior: "smooth" });
      window.setTimeout(() => $("#bookmarkSearch").focus(), 350);
    });
  }

  async function init() {
    setupEvents();
    try {
      bookmarks = await readBookmarks();
    } catch {
      notify("当前浏览器无法打开本地收藏知识库");
    }
    renderBookmarks();
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
