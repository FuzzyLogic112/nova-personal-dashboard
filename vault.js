(() => {
  "use strict";

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
  const SYNC_CHANNEL = "nova-bookmark-sync-v1";
  const SYNC_PAUSED_KEY = "nova.bookmark-sync.paused.v1";
  const SYNC_CHANGED_KEY = "nova.bookmark-sync.changed.v1";
  let syncState = null;
  let hasSyncBackup = false;
  let extensionConnected = false;
  let extensionEnabled = true;
  let syncError = "";
  let writes = Promise.resolve();
  let lastExtensionSeen = 0;
  const queueVaultWrite = (task) => {
    const next = writes.then(task, task);
    writes = next.catch(() => {});
    return next;
  };
  const syncPaused = () => localStorage.getItem(SYNC_PAUSED_KEY) === "true";
  const signalVaultChange = () => localStorage.setItem(SYNC_CHANGED_KEY, `${Date.now()}-${Math.random()}`);

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

  async function readBookmarks() {
    const saved = await NovaBookmarkStore.read();
    syncState = saved.state;
    hasSyncBackup = saved.hasBackup;
    return saved.items;
  }

  const replaceBookmarks = (items) => NovaBookmarkStore.replace(items);

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
      const canonical = canonicalUrl(item.url);
      if (!canonical) return null;
      // Keep the actual destination intact: fragments and query parameters may be functional.
      const url = String(item.url);
      const path = Array.isArray(item.path)
        ? item.path.map(String)
        : String(item.path || item.folder || "").split(/[\\/›>]/).filter(Boolean);
      const duplicate = seen.has(canonical);
      seen.add(canonical);
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
    if (extensionConnected && !syncPaused() && extensionEnabled) {
      notify("请先暂停自动同步，再导入收藏夹。");
      $("#privatePackFile").value = "";
      return;
    }
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
        await queueVaultWrite(() => {
          if (extensionConnected && !syncPaused() && extensionEnabled) throw new Error("请先暂停同步。");
          return replaceBookmarks(normalized);
        });
        syncState = null;
        signalVaultChange();
        bookmarks = normalized;
        category = "全部";
        query = "";
        page = 1;
      }
      metadata.lastPackAt = new Date().toISOString();
      saveMetadata();
      renderBookmarks();
      renderSync();
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
    return safeNumber(stat.count) * 2 + Math.max(0, 8 - recencyDays) + safeNumber(stat.hours?.[NovaTime.parts().hour]) * 3;
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
    const hour = NovaTime.parts().hour;
    stat.hours[hour] = safeNumber(stat.hours[hour]) + 1;
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
    $("#bookmarkTotal").textContent = bookmarks.length || syncState ? `${bookmarks.length} 个网站 · 仅本地` : "等待导入";
    $("#bookmarkCategoryCount").textContent = String(counts.size);
    $("#bookmarkDuplicateCount").textContent = String(bookmarks.filter((item) => item.duplicate).length);
    $("#bookmarkStorageState").textContent = bookmarks.length || syncState ? `${bookmarks.length} 条仅存于此浏览器` : "尚未载入私有数据";

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
      empty.innerHTML = syncState
        ? '<strong>浏览器收藏夹已同步，目前没有网页收藏</strong><p>添加一个网页收藏后，这里会自动更新。内部页面与脚本书签不会导入。</p>'
        : '<svg class="icon"><use href="#i-bookmark"></use></svg><strong>连接你的浏览器收藏夹</strong><p>安装 NOVA 同步扩展后自动更新，也可以手动导入书签 HTML 或 JSON。网址不会上传到服务器。</p>';
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

  function requestSync(command = "SYNC", enabled) {
    window.postMessage({ channel: SYNC_CHANNEL, direction: "page", command, enabled }, location.origin);
  }

  function renderSync() {
    const paused = syncPaused() || !extensionEnabled;
    const label = $("#bookmarkSyncStatus");
    const details = $("#bookmarkSyncDetails");
    const button = $("#bookmarkSyncToggle");
    label.textContent = syncError ? "同步需要处理" : paused ? "自动同步已暂停" :
      extensionConnected ? (syncState ? "收藏夹自动同步已连接" : "正在读取浏览器收藏夹…") : "等待连接 NOVA 同步扩展";
    label.dataset.state = syncError ? "error" : paused ? "paused" : extensionConnected ? "connected" : "waiting";
    details.textContent = syncError || (syncState
      ? `${syncState.count} 个网页收藏 · 最近确认 ${NovaTime.format(syncState.syncedAt)}（北京时间）${syncState.skipped ? ` · ${syncState.skipped} 个内部/特殊链接未导入` : ""}`
      : "安装一次，后续自动跟进收藏夹变化。首次同步会保存现有收藏的备份。");
    button.textContent = paused ? "恢复自动同步" : "暂停同步";
    button.hidden = !extensionConnected && !syncState && !paused;
    $("#bookmarkSyncNow").textContent = extensionConnected ? "立即同步" : "检查连接";
    $("#bookmarkSyncNow").disabled = paused;
    $("#bookmarkSyncRestore").hidden = !hasSyncBackup;
    $("#bookmarkImport").disabled = extensionConnected && !paused;
    $("#bookmarkImport").title = extensionConnected && !paused ? "暂停自动同步后可手动导入" : "导入书签 HTML 或 JSON";
  }

  function setupSync() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin || window.top !== window) return;
      const message = event.data;
      if (message?.channel !== SYNC_CHANNEL || message.direction !== "extension") return;
      const incoming = message.payload;
      if (!incoming || !["snapshot", "status", "error"].includes(incoming.kind)) return;
      extensionConnected = true;
      lastExtensionSeen = Date.now();
      syncError = incoming.kind === "error" ? String(incoming.message || "同步失败，请重试。").slice(0, 200) : "";
      if (typeof incoming.enabled === "boolean") extensionEnabled = incoming.enabled;
      if (incoming.settingChanged === true && typeof incoming.enabled === "boolean") {
        localStorage.setItem(SYNC_PAUSED_KEY, String(!incoming.enabled));
      }
      renderSync();
      if (incoming.kind !== "snapshot" || syncPaused() || !extensionEnabled) return;
      void queueVaultWrite(async () => {
        if (syncPaused()) return;
        NovaBookmarkStore.validate(incoming);
        const normalized = normalizeBookmarks(incoming.items);
        if (normalized.length !== incoming.items.length) throw new Error("部分收藏格式无效，原数据保持不变。");
        const result = await NovaBookmarkStore.apply(incoming, normalized);
        const previousRevision = syncState?.revision;
        syncState = result.state;
        if (result.changed || (!result.stale && previousRevision !== incoming.revision)) {
          bookmarks = normalized;
          hasSyncBackup = true;
          if (category !== "全部" && !bookmarks.some((item) => item.category === category)) category = "全部";
          renderBookmarks();
        }
        if (result.stale) { bookmarks = await readBookmarks(); renderBookmarks(); }
        if (result.changed) signalVaultChange();
        renderSync();
      }).catch((error) => {
        syncError = error.message || "保存失败，请检查浏览器存储空间。";
        renderSync();
      });
    });
    $("#bookmarkSyncNow").addEventListener("click", () => {
      syncError = "";
      requestSync();
      renderSync();
      window.setTimeout(() => {
        if (!extensionConnected) notify("尚未检测到扩展。安装后请刷新工作台，再检查连接。");
      }, 1800);
    });
    $("#bookmarkSyncToggle").addEventListener("click", () => {
      const resume = syncPaused() || !extensionEnabled;
      localStorage.setItem(SYNC_PAUSED_KEY, String(!resume));
      syncError = "";
      requestSync("SET_ENABLED", resume);
      renderSync();
    });
    $("#bookmarkSyncRestore").addEventListener("click", async () => {
      if (!window.confirm("暂停自动同步，并恢复首次同步前的工作台收藏？浏览器收藏夹不会改变，之后可重新开启同步。")) return;
      localStorage.setItem(SYNC_PAUSED_KEY, "true");
      requestSync("SET_ENABLED", false);
      try {
        await queueVaultWrite(async () => {
          const restored = await NovaBookmarkStore.restore();
          if (!restored) throw new Error("未找到同步前备份。");
          bookmarks = restored;
          syncState = null;
          signalVaultChange();
          category = "全部";
          page = 1;
          renderBookmarks();
        });
        notify("已暂停同步，并恢复同步前的收藏。");
      } catch (error) { notify(error.message); }
      renderSync();
    });
    window.addEventListener("storage", (event) => {
      if (event.key === SYNC_PAUSED_KEY || event.key === SYNC_CHANGED_KEY) {
        void queueVaultWrite(async () => { bookmarks = await readBookmarks(); renderBookmarks(); renderSync(); });
      }
    });
    const refresh = () => {
      if (document.hidden) return;
      if (lastExtensionSeen && Date.now() - lastExtensionSeen > 90000) extensionConnected = false;
      requestSync(syncPaused() ? "STATUS" : "SYNC");
      renderSync();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    window.setInterval(refresh, 60000);
    refresh();
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
    setupSync();
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
