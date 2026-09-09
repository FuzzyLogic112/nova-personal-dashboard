(() => {
  "use strict";

  const PLUS_KEY = "nova.plus.v1";
  const WORKSPACE_KEY = "nova.workspace.v1";
  const DB_NAME = "nova-private-vault-v1";
  const STORE_NAME = "bookmarks";
  const PAGE_SIZE = 12;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const todayKey = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const safeNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const emptyUsage = () => ({ remaining: null, resetAt: null, source: "manual", updatedAt: null, history: [] });
  const defaultState = () => ({
    version: 1,
    usage: { codex: { ...emptyUsage(), plan: null, windowMinutes: null }, claude: { ...emptyUsage(), tokens7d: 0, calls7d: 0, sessions7d: 0, models: {} } },
    habits: [
      { id: makeId(), name: "深度工作", log: {} },
      { id: makeId(), name: "阅读", log: {} },
      { id: makeId(), name: "运动", log: {} }
    ],
    bookmarkStats: {},
    lastPackAt: null
  });

  const loadState = () => {
    const defaults = defaultState();
    try {
      const saved = JSON.parse(localStorage.getItem(PLUS_KEY));
      if (!saved || typeof saved !== "object") return defaults;
      return {
        ...defaults,
        ...saved,
        usage: {
          codex: { ...defaults.usage.codex, ...(saved.usage?.codex || {}) },
          claude: { ...defaults.usage.claude, ...(saved.usage?.claude || {}) }
        },
        habits: Array.isArray(saved.habits) ? saved.habits : defaults.habits,
        bookmarkStats: saved.bookmarkStats && typeof saved.bookmarkStats === "object" ? saved.bookmarkStats : {}
      };
    } catch {
      return defaults;
    }
  };

  let state = loadState();
  let bookmarks = [];
  let category = "全部";
  let query = "";
  let page = 1;

  function saveState() {
    try { localStorage.setItem(PLUS_KEY, JSON.stringify(state)); } catch { notify("本地存储空间不足，请先导出数据"); }
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
    } catch { return ""; }
  }

  function hostname(value) {
    try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "未知域名"; }
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
    const match = CATEGORY_RULES.find(([, pattern]) => pattern.test(haystack));
    return match?.[0] || "待整理";
  }

  function normalizeBookmarks(rawItems) {
    const seen = new Map();
    return rawItems.map((item, index) => {
      const cleanUrl = canonicalUrl(item.url);
      if (!cleanUrl) return null;
      const path = Array.isArray(item.path) ? item.path.map(String) : String(item.path || item.folder || "").split(/[\\/›>]/).filter(Boolean);
      const normalized = {
        id: String(item.id || `bookmark-${index}-${cleanUrl}`),
        title: String(item.title || item.name || hostname(cleanUrl)).trim().slice(0, 240),
        url: cleanUrl,
        path,
        category: String(item.category || classifyBookmark({ ...item, url: cleanUrl, path })).slice(0, 40),
        addedAt: item.addedAt || item.dateAdded || null,
        duplicate: seen.has(cleanUrl)
      };
      if (!seen.has(cleanUrl)) seen.set(cleanUrl, normalized.id);
      return normalized;
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
    if (!payload?.usage || typeof payload.usage !== "object") return;
    ["codex", "claude"].forEach((provider) => {
      if (!payload.usage[provider]) return;
      const previous = state.usage[provider] || emptyUsage();
      state.usage[provider] = { ...previous, ...payload.usage[provider], source: "private-pack", updatedAt: payload.usage[provider].updatedAt || payload.createdAt || new Date().toISOString() };
      if (state.usage[provider].remaining != null) pushUsageHistory(provider, state.usage[provider].remaining);
    });
  }

  async function importPrivateFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* HTML export */ }
      const rawItems = extractImport(payload, text);
      const normalized = normalizeBookmarks(rawItems);
      if (!normalized.length && !payload?.usage) throw new Error("empty");
      if (normalized.length) {
        await replaceBookmarks(normalized);
        bookmarks = normalized;
        category = "全部";
        query = "";
        page = 1;
      }
      importUsageFromPack(payload);
      state.lastPackAt = new Date().toISOString();
      saveState();
      renderBookmarks();
      renderUsage();
      renderContext();
      const skipped = Math.max(0, safeNumber(payload?.sourceSummary?.urlNodes) - normalized.length);
      notify(normalized.length ? `已在本机整理 ${normalized.length} 个收藏网站${skipped ? `，跳过 ${skipped} 个浏览器内部项` : ""}` : "AI 额度快照已更新");
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
    const stat = state.bookmarkStats[item.url];
    if (!stat) return 0;
    const recencyDays = stat.last ? Math.max(0, (Date.now() - new Date(stat.last).getTime()) / 86400000) : 99;
    const hourAffinity = safeNumber(stat.hours?.[new Date().getHours()]);
    return safeNumber(stat.count) * 2 + Math.max(0, 8 - recencyDays) + hourAffinity * 3;
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
    const stat = state.bookmarkStats[item.url] || { count: 0, last: null, hours: Array(24).fill(0) };
    stat.count += 1;
    stat.last = new Date().toISOString();
    if (!Array.isArray(stat.hours) || stat.hours.length !== 24) stat.hours = Array(24).fill(0);
    stat.hours[new Date().getHours()] = safeNumber(stat.hours[new Date().getHours()]) + 1;
    state.bookmarkStats[item.url] = stat;
    saveState();
    renderContext();
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
      anchor.href = item.url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
      anchor.addEventListener("click", () => recordBookmarkOpen(item));
      const mark = document.createElement("i"); mark.textContent = hostname(item.url).slice(0, 1);
      const text = document.createElement("span"); text.textContent = item.title.slice(0, 20);
      anchor.append(mark, text); list.append(anchor);
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
      const label = document.createElement("span"); label.textContent = name;
      const total = document.createElement("em"); total.textContent = count;
      button.append(label, total);
      button.addEventListener("click", () => { category = name; page = 1; renderBookmarks(); });
      rail.append(button);
    });

    const results = $("#bookmarkResults");
    results.replaceChildren();
    if (!bookmarks.length) {
      results.innerHTML = '<div class="vault-empty"><svg class="icon"><use href="#i-bookmark"></use></svg><strong>导入你的浏览器收藏夹</strong><p>选择本机生成的 NOVA 私有包、Edge/Chrome Bookmarks JSON，或浏览器导出的 HTML。网址不会上传到服务器。</p></div>';
      $("#bookmarkPagination").hidden = true;
      $("#bookmarkRecallCount").textContent = "0";
      renderSmartLaunch();
      return;
    }
    const filtered = visibleBookmarks();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = clamp(page, 1, pages);
    const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!visible.length) results.innerHTML = '<div class="vault-empty"><strong>没有匹配的收藏</strong><p>试试更短的关键词，或切换到“全部”分类。</p></div>';
    else visible.forEach((item) => results.append(createBookmarkItem(item)));
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
    anchor.download = `nova-bookmarks-${todayKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    notify("收藏知识库已导出");
  }

  function formatReset(resetAt) {
    if (!resetAt) return "重置时间未知";
    const target = new Date(resetAt);
    if (Number.isNaN(target.getTime())) return "重置时间未知";
    const delta = target.getTime() - Date.now();
    if (delta <= 0) return "已到重置时间，请更新快照";
    const days = Math.floor(delta / 86400000);
    const hours = Math.floor((delta % 86400000) / 3600000);
    return days ? `${days} 天 ${hours} 小时后重置` : `${hours} 小时后重置`;
  }

  function formatTokens(value) {
    const number = safeNumber(value);
    if (number >= 1e6) return `${(number / 1e6).toFixed(number >= 1e7 ? 0 : 1)}M tokens`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(number >= 1e4 ? 0 : 1)}K tokens`;
    return `${number} tokens`;
  }

  function pushUsageHistory(provider, remaining) {
    const usage = state.usage[provider];
    usage.history = Array.isArray(usage.history) ? usage.history : [];
    const entry = { at: new Date().toISOString(), remaining: clamp(safeNumber(remaining), 0, 100) };
    const last = usage.history.at(-1);
    if (!last || Math.abs(new Date(last.at).getTime() - Date.now()) > 60000 || last.remaining !== entry.remaining) usage.history.push(entry);
    usage.history = usage.history.slice(-30);
  }

  function sparkPath(history, fallback = 50) {
    const values = (history || []).map((entry) => clamp(safeNumber(entry.remaining, fallback), 0, 100));
    while (values.length < 6) values.unshift(values[0] ?? fallback);
    const sliced = values.slice(-8);
    return sliced.map((value, index) => {
      const x = (index / Math.max(1, sliced.length - 1)) * 160;
      const y = 30 - value * .26;
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join("");
  }

  function consumptionForecast(usage) {
    const history = usage.history || [];
    if (history.length < 2 || usage.remaining == null) return "采样中";
    const first = history[0]; const last = history.at(-1);
    const days = Math.max(.04, (new Date(last.at) - new Date(first.at)) / 86400000);
    const burn = Math.max(0, safeNumber(first.remaining) - safeNumber(last.remaining)) / days;
    if (!burn) return "额度稳定";
    const remainingDays = safeNumber(last.remaining) / burn;
    return remainingDays > 99 ? ">99 天" : `约 ${Math.max(1, Math.round(remainingDays))} 天`;
  }

  function setQuotaRing(id, remaining) {
    const ring = $(id);
    const value = remaining == null ? 0 : clamp(safeNumber(remaining), 0, 100);
    ring.style.setProperty("--quota", `${value * 3.6}deg`);
  }

  function renderUsage() {
    const codex = state.usage.codex;
    const claude = state.usage.claude;
    $("#codexPlan").textContent = codex.plan ? `${codex.plan} · ${codex.source === "private-pack" ? "本机快照" : "手动快照"}` : "等待本地快照";
    $("#codexRemaining").textContent = codex.remaining == null ? "--" : `${Math.round(codex.remaining)}%`;
    $("#codexUsed").textContent = codex.remaining == null ? "尚未接入" : `已用 ${Math.round(100 - codex.remaining)}%`;
    $("#codexReset").textContent = formatReset(codex.resetAt);
    $("#codexForecast").textContent = consumptionForecast(codex);
    $("#codexSpark path").setAttribute("d", sparkPath(codex.history, codex.remaining ?? 50));
    setQuotaRing("#codexRing", codex.remaining);

    $("#claudePlan").textContent = claude.models && Object.keys(claude.models).length ? `${Object.keys(claude.models).length} 个模型 · 日志汇总` : "本地日志统计";
    $("#claudeRemaining").textContent = claude.remaining == null ? "--" : `${Math.round(claude.remaining)}%`;
    $("#claudeTokens").textContent = claude.tokens7d ? formatTokens(claude.tokens7d) : (claude.remaining == null ? "尚未接入" : `剩余 ${Math.round(claude.remaining)}%`);
    $("#claudeCalls").textContent = claude.calls7d ? `${claude.calls7d} 次响应 · ${claude.sessions7d || 0} 个会话` : "不会读取对话内容";
    $("#claudeForecast").textContent = consumptionForecast(claude);
    $("#claudeSpark path").setAttribute("d", sparkPath(claude.history, claude.remaining ?? 50));
    setQuotaRing("#claudeRing", claude.remaining);
  }

  function parseUsageInput() {
    const provider = $("#usageProvider").value;
    const text = $("#usagePaste").value.trim();
    let remaining = null;
    let resetAt = null;
    try {
      const payload = JSON.parse(text);
      const bucket = payload.rateLimitsByLimitId?.codex || payload.rateLimits?.primary || payload.primary || payload;
      if (bucket.remainingPercent != null) remaining = safeNumber(bucket.remainingPercent);
      else if (bucket.remaining != null && safeNumber(bucket.remaining) <= 100) remaining = safeNumber(bucket.remaining);
      else if (bucket.usedPercent != null) remaining = 100 - safeNumber(bucket.usedPercent);
      resetAt = bucket.resetsAt ? new Date(safeNumber(bucket.resetsAt) * (safeNumber(bucket.resetsAt) < 1e12 ? 1000 : 1)).toISOString() : bucket.resetAt || null;
    } catch {
      const remainingMatch = text.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:remaining|remain|left|剩余)/i) || text.match(/(?:remaining|remain|left|剩余)\D{0,12}(\d+(?:\.\d+)?)\s*%/i);
      const usedMatch = text.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:used|已用|使用)/i) || text.match(/(?:used|已用|使用)\D{0,12}(\d+(?:\.\d+)?)\s*%/i);
      if (remainingMatch) remaining = safeNumber(remainingMatch[1]);
      else if (usedMatch) remaining = 100 - safeNumber(usedMatch[1]);
    }
    if (remaining == null || !Number.isFinite(remaining)) return notify("没有识别到百分比，可在下方手动填写");
    $("#usageRemainingInput").value = String(Math.round(clamp(remaining, 0, 100)));
    if (resetAt) $("#usageResetInput").value = toLocalInput(resetAt);
    notify(`${provider === "codex" ? "Codex" : "Claude"} 快照解析成功`);
  }

  function toLocalInput(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openUsageDialog() {
    const provider = $("#usageProvider").value;
    const usage = state.usage[provider];
    $("#usageRemainingInput").value = usage.remaining ?? "";
    $("#usageResetInput").value = usage.resetAt ? toLocalInput(usage.resetAt) : "";
    $("#usagePaste").value = "";
    $("#usageDialog").showModal();
  }

  function saveUsage(event) {
    event.preventDefault();
    const provider = $("#usageProvider").value;
    const value = $("#usageRemainingInput").value;
    if (value === "") return notify("请填写剩余额度百分比");
    const usage = state.usage[provider];
    usage.remaining = clamp(safeNumber(value), 0, 100);
    usage.resetAt = $("#usageResetInput").value ? new Date($("#usageResetInput").value).toISOString() : null;
    usage.updatedAt = new Date().toISOString();
    usage.source = "manual";
    pushUsageHistory(provider, usage.remaining);
    saveState(); renderUsage(); renderContext(); $("#usageDialog").close();
    notify("AI 额度快照已保存在本机");
  }

  function habitStreak(habit) {
    let streak = 0;
    const cursor = new Date();
    if (!habit.log?.[todayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
    while (habit.log?.[todayKey(cursor)]) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
    return streak;
  }

  function renderHabits() {
    const key = todayKey();
    const list = $("#habitList");
    list.replaceChildren();
    state.habits.forEach((habit) => {
      const row = document.createElement("label"); row.className = "habit-row";
      const check = document.createElement("input"); check.type = "checkbox"; check.className = "habit-check"; check.checked = Boolean(habit.log?.[key]);
      check.addEventListener("change", () => {
        habit.log = habit.log || {};
        if (check.checked) habit.log[key] = true; else delete habit.log[key];
        saveState(); renderHabits(); renderContext();
        if (check.checked) notify(`${habit.name} · 今日已打卡`);
      });
      const name = document.createElement("span"); name.textContent = habit.name;
      const streak = document.createElement("small"); streak.textContent = `连续 ${habitStreak(habit)} 天`;
      row.append(check, name, streak); list.append(row);
    });
    const complete = state.habits.filter((habit) => habit.log?.[key]).length;
    const best = Math.max(0, ...state.habits.map(habitStreak));
    $("#habitToday").textContent = `${complete} / ${state.habits.length}`;
    $("#habitBestStreak").innerHTML = `${best} <small>天</small>`;
    const heatmap = $("#habitHeatmap"); heatmap.replaceChildren();
    for (let offset = 27; offset >= 0; offset -= 1) {
      const date = new Date(); date.setDate(date.getDate() - offset);
      const dateKey = todayKey(date);
      const count = state.habits.filter((habit) => habit.log?.[dateKey]).length;
      const level = count ? Math.ceil((count / Math.max(1, state.habits.length)) * 3) : 0;
      const cell = document.createElement("span"); cell.className = "heat-cell"; cell.dataset.level = String(level); cell.title = `${dateKey} · ${count}/${state.habits.length}`; heatmap.append(cell);
    }
  }

  function addHabit() {
    const name = window.prompt("新习惯名称（最多 12 个字）");
    if (!name?.trim()) return;
    state.habits.push({ id: makeId(), name: name.trim().slice(0, 12), log: {} });
    saveState(); renderHabits(); renderContext(); notify("新习惯已加入轨迹");
  }

  function workspaceState() {
    try { return JSON.parse(localStorage.getItem(WORKSPACE_KEY)) || {}; } catch { return {}; }
  }

  function renderContext() {
    const workspace = workspaceState();
    const tasks = Array.isArray(workspace.tasks) ? workspace.tasks : [];
    const remaining = tasks.filter((task) => !task.done);
    const completeHabits = state.habits.filter((habit) => habit.log?.[todayKey()]).length;
    const habitRatio = state.habits.length ? completeHabits / state.habits.length : 1;
    const codexRemaining = state.usage.codex.remaining;
    const hour = new Date().getHours();
    const knownSignals = 2 + (bookmarks.length > 0 ? 1 : 0) + (codexRemaining != null ? 1 : 0);
    let score = 46 + habitRatio * 17 + (remaining.length < 4 ? 13 : 6) + (bookmarks.length ? 12 : 0) + (codexRemaining != null ? 12 : 0);
    score = Math.round(clamp(score, 0, 100));
    let label = "系统建议";
    let action = "完成今天最关键的一项任务";
    let reason = remaining[0] ? `你的清单还有 ${remaining.length} 项未完成；先推进「${remaining[0].text}」，能最快降低认知负担。` : "任务清单已经清空。现在适合复盘、整理收藏，或为明天留下清晰起点。";
    if (hour < 6 || hour >= 23) {
      label = "低干扰模式"; action = "收束今天，避免开启高负荷工作"; reason = "当前处于恢复时段。记录未尽事项并休息，比再开一个任务更有长期收益。";
    } else if (remaining.length === 0 && completeHabits < state.habits.length) {
      label = "习惯补全"; action = `完成一个尚未打卡的习惯`;
      reason = `今日任务已清空，但还有 ${state.habits.length - completeHabits} 个习惯未完成，用一个小行动维持连续性。`;
    } else if (codexRemaining != null && codexRemaining < 20 && remaining.length) {
      label = "额度保护"; action = `先拆解「${remaining[0].text}」再调用 AI`;
      reason = `Codex 本周期仅余 ${Math.round(codexRemaining)}%。先明确输入与验收标准，可以减少无效消耗。`;
    } else if (hour >= 12 && hour < 14) {
      label = "轻量窗口"; action = bookmarks.length ? "从收藏知识库召回一条资料" : "做一项 10 分钟以内的小任务";
      reason = "午间更适合低切换成本的输入或整理，保留深度精力给下一段完整时间。";
    } else if ((hour >= 8 && hour < 12) || (hour >= 14 && hour < 18)) {
      label = "深度窗口"; action = remaining[0] ? `专注推进「${remaining[0].text}」` : "启动一个 25 分钟专注轮次";
      reason = `当前处于高价值工作窗口，${remaining.length ? `清单首项已经提供明确入口。` : "适合把最重要的想法变成可交付结果。"}`;
    }
    $("#contextLabel").textContent = label;
    $("#contextAction").textContent = action;
    $("#contextReason").textContent = reason;
    $("#contextScore").textContent = String(score);
    $("#contextRing").style.setProperty("--score", `${score * 3.6}deg`);
    $("#contextFreshness").textContent = `${knownSignals}/4 类本地信号已就绪`;
    const signals = [
      `${remaining.length} 项待办`,
      `${completeHabits}/${state.habits.length} 习惯`,
      bookmarks.length ? `${bookmarks.length} 条收藏` : "收藏待导入",
      codexRemaining == null ? "额度待接入" : `Codex ${Math.round(codexRemaining)}%`
    ];
    const host = $("#contextSignals"); host.replaceChildren();
    signals.forEach((text) => { const tag = document.createElement("span"); tag.className = "context-signal"; tag.innerHTML = `<i></i><span></span>`; tag.lastElementChild.textContent = text; host.append(tag); });
  }

  function setupMotion() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = $("#motionCanvas");
    const context = canvas.getContext("2d", { alpha: true });
    let width = 0; let height = 0; let frame = 0;
    const particles = Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .00009, vy: (Math.random() - .5) * .00009, size: Math.random() * 1.4 + .4 }));
    function resize() { const ratio = Math.min(devicePixelRatio || 1, 2); width = innerWidth; height = innerHeight; canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0); }
    function draw() {
      context.clearRect(0, 0, width, height);
      const styles = getComputedStyle(document.documentElement); const color = styles.getPropertyValue("--accent-rgb").trim() || "217, 255, 99";
      particles.forEach((particle) => { particle.x = (particle.x + particle.vx + 1) % 1; particle.y = (particle.y + particle.vy + 1) % 1; });
      for (let a = 0; a < particles.length; a += 1) {
        const first = particles[a];
        context.fillStyle = `rgba(${color}, .22)`; context.beginPath(); context.arc(first.x * width, first.y * height, first.size, 0, Math.PI * 2); context.fill();
        for (let b = a + 1; b < particles.length; b += 1) {
          const second = particles[b]; const dx = (first.x - second.x) * width; const dy = (first.y - second.y) * height; const distance = Math.hypot(dx, dy);
          if (distance < 145) { context.strokeStyle = `rgba(${color}, ${(.055 * (1 - distance / 145)).toFixed(3)})`; context.lineWidth = .6; context.beginPath(); context.moveTo(first.x * width, first.y * height); context.lineTo(second.x * width, second.y * height); context.stroke(); }
        }
      }
      frame = requestAnimationFrame(draw);
    }
    resize(); draw();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(frame); else draw(); });
    if (matchMedia("(pointer: fine)").matches) {
      document.addEventListener("pointermove", (event) => {
        document.body.classList.add("pointer-active");
        $("#cursorGlow").style.setProperty("--pointer-x", `${event.clientX}px`); $("#cursorGlow").style.setProperty("--pointer-y", `${event.clientY}px`);
      }, { passive: true });
      document.addEventListener("pointerleave", () => document.body.classList.remove("pointer-active"));
      $$(".card").forEach((card) => {
        card.dataset.tilt = "";
        card.addEventListener("pointermove", (event) => {
          const rect = card.getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width - .5; const y = (event.clientY - rect.top) / rect.height - .5;
          card.style.transform = `perspective(1000px) translateY(-2px) rotateX(${(-y * 1.2).toFixed(2)}deg) rotateY(${(x * 1.2).toFixed(2)}deg)`;
        });
        card.addEventListener("pointerleave", () => { card.style.transform = ""; });
      });
    }
  }

  function setupEvents() {
    $("#bookmarkImport").addEventListener("click", () => $("#privatePackFile").click());
    $("#privatePackFile").addEventListener("change", (event) => importPrivateFile(event.target.files[0]));
    $("#bookmarkExport").addEventListener("click", exportBookmarks);
    $("#bookmarkSearch").addEventListener("input", (event) => { query = event.target.value.trim(); page = 1; renderBookmarks(); });
    $("#bookmarkPrev").addEventListener("click", () => { page -= 1; renderBookmarks(); });
    $("#bookmarkNext").addEventListener("click", () => { page += 1; renderBookmarks(); });
    $("#usageUpdate").addEventListener("click", openUsageDialog);
    $("#usageParse").addEventListener("click", parseUsageInput);
    $("#usageForm").addEventListener("submit", saveUsage);
    $("#usageClose").addEventListener("click", () => $("#usageDialog").close());
    $("#usageCancel").addEventListener("click", () => $("#usageDialog").close());
    $("#usageProvider").addEventListener("change", openUsageDialogValues);
    $("#habitAdd").addEventListener("click", addHabit);
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !$("dialog[open]")) { event.preventDefault(); $("#bookmarks").scrollIntoView({ behavior: "smooth" }); setTimeout(() => $("#bookmarkSearch").focus(), 350); }
    });
    ["change", "click"].forEach((name) => document.addEventListener(name, (event) => {
      if (event.target.closest("#tasks, #focus")) setTimeout(renderContext, 30);
    }));
  }

  function openUsageDialogValues() {
    const usage = state.usage[$("#usageProvider").value];
    $("#usageRemainingInput").value = usage.remaining ?? "";
    $("#usageResetInput").value = usage.resetAt ? toLocalInput(usage.resetAt) : "";
  }

  async function init() {
    setupEvents();
    renderHabits(); renderUsage(); renderContext(); setupMotion();
    try { bookmarks = await readBookmarks(); } catch { notify("当前浏览器无法打开私有收藏库"); }
    renderBookmarks(); renderContext();
    window.setInterval(() => { renderUsage(); renderContext(); }, 60000);
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
