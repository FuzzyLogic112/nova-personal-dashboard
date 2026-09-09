(() => {
  "use strict";

  const STORAGE_KEY = "nova.workspace.v1";
  const AI_USAGE_KEY = "nova.ai-usage.v1";
  const CITY_MAP = {
    shanghai: { name: "上海", lat: 31.2304, lon: 121.4737 },
    beijing: { name: "北京", lat: 39.9042, lon: 116.4074 },
    shenzhen: { name: "深圳", lat: 22.5431, lon: 114.0579 },
    hangzhou: { name: "杭州", lat: 30.2741, lon: 120.1551 },
    chengdu: { name: "成都", lat: 30.5728, lon: 104.0668 },
    guangzhou: { name: "广州", lat: 23.1291, lon: 113.2644 }
  };
  const SEARCH_ENGINES = {
    bing: "https://www.bing.com/search?q=",
    baidu: "https://www.baidu.com/s?wd=",
    google: "https://www.google.com/search?q="
  };
  const WEATHER = {
    0: ["晴朗", "☀"], 1: ["大致晴朗", "🌤"], 2: ["多云", "⛅"], 3: ["阴天", "☁"],
    45: ["有雾", "🌫"], 48: ["雾凇", "🌫"], 51: ["小毛雨", "🌦"], 53: ["毛毛雨", "🌦"],
    55: ["较强毛雨", "🌧"], 56: ["冻毛雨", "🌧"], 57: ["强冻毛雨", "🌧"], 61: ["小雨", "🌦"],
    63: ["中雨", "🌧"], 65: ["大雨", "🌧"], 66: ["冻雨", "🌧"], 67: ["强冻雨", "🌧"],
    71: ["小雪", "🌨"], 73: ["中雪", "🌨"], 75: ["大雪", "❄"], 77: ["米雪", "🌨"],
    80: ["阵雨", "🌦"], 81: ["中阵雨", "🌧"], 82: ["强阵雨", "⛈"], 85: ["阵雪", "🌨"],
    86: ["强阵雪", "❄"], 95: ["雷暴", "⛈"], 96: ["雷暴冰雹", "⛈"], 99: ["强雷暴冰雹", "⛈"]
  };

  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const localDateKey = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const defaultState = () => ({
    version: 1,
    profile: { name: "旅行者", city: "shanghai", engine: "bing", theme: "dark", accent: "lime" },
    tasks: [
      { id: makeId(), text: "写下今天唯一必须完成的事", done: false },
      { id: makeId(), text: "完成一个 25 分钟专注轮次", done: false },
      { id: makeId(), text: "整理一个稍后要看的链接", done: false }
    ],
    quickLinks: [
      { id: makeId(), name: "GitHub", url: "https://github.com/", letter: "GH", color: "#91e6b9" },
      { id: makeId(), name: "Notion", url: "https://www.notion.so/", letter: "N", color: "#e8e4dc" },
      { id: makeId(), name: "Figma", url: "https://www.figma.com/", letter: "F", color: "#ff9c84" },
      { id: makeId(), name: "V2EX", url: "https://www.v2ex.com/", letter: "V", color: "#83b8ff" },
      { id: makeId(), name: "哔哩哔哩", url: "https://www.bilibili.com/", letter: "B", color: "#73d7ef" },
      { id: makeId(), name: "Product Hunt", url: "https://www.producthunt.com/", letter: "PH", color: "#ff8d75" }
    ],
    memo: "# 今日留白\n\n记录一个值得继续追踪的念头。",
    focusSessions: 0,
    activity: {},
    timer: { mode: "focus", duration: 1500, remaining: 1500, running: false, endAt: null }
  });

  const emptyUsage = () => ({ usedPercent: null, resetAt: null, plan: null, updatedAt: null, history: [] });
  const defaultUsageState = () => ({
    version: 1,
    codex: emptyUsage(),
    claude: emptyUsage()
  });

  const loadState = () => {
    const defaults = defaultState();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") return defaults;
      return {
        ...defaults,
        ...saved,
        profile: { ...defaults.profile, ...(saved.profile || {}) },
        tasks: Array.isArray(saved.tasks) ? saved.tasks : defaults.tasks,
        quickLinks: Array.isArray(saved.quickLinks) ? saved.quickLinks : defaults.quickLinks,
        activity: saved.activity && typeof saved.activity === "object" ? saved.activity : {},
        timer: { ...defaults.timer, ...(saved.timer || {}) }
      };
    } catch {
      return defaults;
    }
  };

  const loadUsageState = () => {
    const defaults = defaultUsageState();
    try {
      const saved = JSON.parse(localStorage.getItem(AI_USAGE_KEY));
      if (!saved || typeof saved !== "object") return defaults;
      return {
        version: 1,
        codex: { ...defaults.codex, ...(saved.codex || {}), history: Array.isArray(saved.codex?.history) ? saved.codex.history.slice(-30) : [] },
        claude: { ...defaults.claude, ...(saved.claude || {}), history: Array.isArray(saved.claude?.history) ? saved.claude.history.slice(-30) : [] }
      };
    } catch {
      return defaults;
    }
  };

  let state = loadState();
  let usageState = loadUsageState();
  let memoSaveTimer = null;
  let timerInterval = null;
  let commandIndex = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const saveState = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const saveUsageState = () => localStorage.setItem(AI_USAGE_KEY, JSON.stringify(usageState));
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const clampPercent = (value) => Math.min(100, Math.max(0, Number(value)));

  function toast(message) {
    const region = $("#toastRegion");
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    region.append(node);
    window.setTimeout(() => {
      node.classList.add("leaving");
      node.addEventListener("animationend", () => node.remove(), { once: true });
    }, 2800);
  }

  function normalizeResetAt(value) {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    const date = Number.isFinite(numeric)
      ? new Date(numeric * (numeric < 1e12 ? 1000 : 1))
      : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function extractUsageRecord(payload, provider) {
    if (!payload || typeof payload !== "object") return null;
    let record = payload[provider] || payload;
    if (provider === "codex") {
      record = payload.rateLimitsByLimitId?.codex?.primary
        || payload.rateLimits?.primary
        || payload.primary
        || record;
    } else if (provider === "claude") {
      record = payload.rate_limits?.seven_day
        || payload.rateLimits?.sevenDay
        || record;
    }
    const rawUsed = record.usedPercent ?? record.used_percentage ?? record.used;
    const rawRemaining = record.remainingPercent ?? record.remaining_percentage ?? record.remaining;
    const usedPercent = rawUsed != null ? Number(rawUsed) : rawRemaining != null ? 100 - Number(rawRemaining) : NaN;
    if (!Number.isFinite(usedPercent)) return null;
    return {
      usedPercent: clampPercent(usedPercent),
      resetAt: normalizeResetAt(record.resetsAt ?? record.resets_at ?? record.resetAt),
      plan: String(record.plan ?? record.planType ?? payload.rateLimitsByLimitId?.codex?.planType ?? payload.rateLimits?.planType ?? payload.plan ?? "").trim().slice(0, 30) || null,
      updatedAt: normalizeResetAt(record.updatedAt ?? payload.updatedAt) || new Date().toISOString()
    };
  }

  function updateUsageProvider(provider, record) {
    if (!record || !Number.isFinite(record.usedPercent)) return false;
    const current = usageState[provider] || emptyUsage();
    const remaining = clampPercent(100 - record.usedPercent);
    const history = Array.isArray(current.history) ? current.history.slice(-29) : [];
    const last = history.at(-1);
    if (!last || Math.abs(Number(last.remaining) - remaining) > .01 || Date.now() - new Date(last.at).getTime() > 60000) {
      history.push({ at: record.updatedAt || new Date().toISOString(), remaining });
    }
    usageState[provider] = {
      usedPercent: clampPercent(record.usedPercent),
      resetAt: record.resetAt || null,
      plan: record.plan || current.plan || null,
      updatedAt: record.updatedAt || new Date().toISOString(),
      history
    };
    return true;
  }

  function importUsagePayload(payload) {
    let changed = false;
    ["codex", "claude"].forEach((provider) => {
      if (!payload?.[provider]) return;
      changed = updateUsageProvider(provider, extractUsageRecord(payload[provider], provider)) || changed;
    });
    if (changed) saveUsageState();
    return changed;
  }

  function consumeUsageBootstrap() {
    const params = new URLSearchParams(location.hash.slice(1));
    const encoded = params.get("usage");
    if (!encoded) return false;
    let imported = false;
    try {
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      imported = importUsagePayload(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      imported = false;
    }
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return imported;
  }

  function formatUsageReset(value) {
    if (!value) return "未提供重置时间";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未提供重置时间";
    const difference = date.getTime() - Date.now();
    const when = date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    if (difference <= 0) return `${when} · 已到重置时间`;
    const hours = Math.ceil(difference / 3600000);
    const countdown = hours < 24 ? `${hours} 小时后` : `${Math.ceil(hours / 24)} 天后`;
    return `${when} 重置 · ${countdown}`;
  }

  function formatFreshness(value) {
    if (!value) return "等待同步";
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
    if (minutes < 1) return "刚刚更新";
    if (minutes < 60) return `${minutes} 分钟前`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
    return `${Math.floor(minutes / 1440)} 天前`;
  }

  function usageSparkPath(history, fallback = 50) {
    const values = (history || []).map((entry) => clampPercent(entry.remaining)).filter(Number.isFinite);
    while (values.length < 6) values.unshift(values[0] ?? fallback);
    const sliced = values.slice(-8);
    return sliced.map((value, index) => {
      const x = (index / Math.max(1, sliced.length - 1)) * 160;
      const y = 30 - value * .26;
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join("");
  }

  function renderUsageProvider(provider) {
    const usage = usageState[provider];
    const prefix = provider === "codex" ? "codex" : "claude";
    const remaining = usage.usedPercent == null ? null : clampPercent(100 - usage.usedPercent);
    $(`#${prefix}Plan`).textContent = usage.plan || "等待本地快照";
    $(`#${prefix}Remaining`).textContent = remaining == null ? "--" : `${Math.round(remaining)}%`;
    $(`#${prefix}Used`).textContent = remaining == null ? "尚未接入" : `已用 ${Math.round(usage.usedPercent)}%`;
    $(`#${prefix}Reset`).textContent = remaining == null ? "点击“更新数据”导入快照" : formatUsageReset(usage.resetAt);
    $(`#${prefix}Freshness`).textContent = formatFreshness(usage.updatedAt);
    $(`#${prefix}Spark path`).setAttribute("d", usageSparkPath(usage.history, remaining ?? 50));
    const ring = $(`#${prefix}Ring`);
    ring.style.setProperty("--quota", `${(remaining ?? 0) * 3.6}deg`);
    ring.setAttribute("aria-label", remaining == null ? `${provider} 尚未接入` : `${provider} 剩余 ${Math.round(remaining)}%`);
  }

  function renderAiUsage() {
    renderUsageProvider("codex");
    renderUsageProvider("claude");
  }

  function toLocalDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function fillUsageDialog() {
    const usage = usageState[$("#usageProvider").value];
    $("#usageUsedInput").value = usage.usedPercent ?? "";
    $("#usageResetInput").value = toLocalDateTime(usage.resetAt);
    $("#usagePlanInput").value = usage.plan || "";
    $("#usagePaste").value = "";
  }

  function openUsageDialog() {
    fillUsageDialog();
    $("#usageDialog").showModal();
  }

  function parseUsageInput() {
    const provider = $("#usageProvider").value;
    const text = $("#usagePaste").value.trim();
    if (!text) return toast("请先粘贴状态文本或 JSON");
    let record = null;
    try {
      record = extractUsageRecord(JSON.parse(text), provider);
    } catch {
      const usedMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:used|已用|使用)/i)
        || text.match(/(?:used|已用|使用)\D{0,12}(\d+(?:\.\d+)?)\s*%/i);
      const remainingMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:remaining|remain|left|剩余)/i)
        || text.match(/(?:remaining|remain|left|剩余)\D{0,12}(\d+(?:\.\d+)?)\s*%/i);
      const value = usedMatch ? Number(usedMatch[1]) : remainingMatch ? 100 - Number(remainingMatch[1]) : NaN;
      if (Number.isFinite(value)) record = { usedPercent: clampPercent(value), resetAt: null, plan: null, updatedAt: new Date().toISOString() };
    }
    if (!record) return toast("没有识别到额度百分比，可在下方手动填写");
    $("#usageUsedInput").value = String(Math.round(record.usedPercent));
    if (record.resetAt) $("#usageResetInput").value = toLocalDateTime(record.resetAt);
    if (record.plan) $("#usagePlanInput").value = record.plan;
    toast(`${provider === "codex" ? "Codex" : "Claude"} 快照解析成功`);
  }

  function saveUsage(event) {
    event.preventDefault();
    const provider = $("#usageProvider").value;
    const usedPercent = Number($("#usageUsedInput").value);
    if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return toast("请填写 0 到 100 之间的已用额度");
    updateUsageProvider(provider, {
      usedPercent,
      resetAt: normalizeResetAt($("#usageResetInput").value),
      plan: $("#usagePlanInput").value.trim().slice(0, 30) || null,
      updatedAt: new Date().toISOString()
    });
    saveUsageState();
    renderAiUsage();
    $("#usageDialog").close();
    toast("AI 额度快照已保存在当前浏览器");
  }

  function applyAppearance() {
    document.documentElement.dataset.theme = state.profile.theme;
    document.documentElement.dataset.accent = state.profile.accent;
    const themeColor = state.profile.theme === "dark" ? "#0b0d0c" : "#edebe2";
    $("meta[name='theme-color']")?.setAttribute("content", themeColor);
    const themeUse = $("#themeToggle use");
    themeUse?.setAttribute("href", state.profile.theme === "dark" ? "#i-sun" : "#i-moon");
  }

  function toggleTheme(announce = true) {
    state.profile.theme = state.profile.theme === "dark" ? "light" : "dark";
    saveState();
    applyAppearance();
    if (announce) toast(state.profile.theme === "dark" ? "已切换到深色外观" : "已切换到明亮外观");
  }

  function updateClock() {
    const now = new Date();
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    $("#topDate").textContent = `${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日 · ${weekdays[now.getDay()]}`;
    $("#topTime").textContent = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const hour = now.getHours();
    $("#greeting").textContent = hour < 6 ? "夜深了" : hour < 11 ? "上午好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear() + 1, 0, 1);
    const yearProgress = Math.floor(((now - start) / (end - start)) * 100);
    $("#dayOfYear").textContent = `YEAR ${yearProgress}%`;
    $("#footerYear").textContent = now.getFullYear();

    const dayStart = new Date(now); dayStart.setHours(8, 0, 0, 0);
    const dayEnd = new Date(now); dayEnd.setHours(22, 0, 0, 0);
    const progress = Math.max(0, Math.min(100, Math.round(((now - dayStart) / (dayEnd - dayStart)) * 100)));
    const ring = $("#dayProgressRing");
    ring.style.setProperty("--progress", `${progress}%`);
    ring.dataset.label = `${progress}%`;
    ring.textContent = "";
    $("#dayProgressText").textContent = `${progress}%`;
  }

  function updateProfile() {
    const name = state.profile.name.trim() || "旅行者";
    $("#profileName").textContent = name;
    $("#avatarLetter").textContent = [...name][0] || "N";
    document.title = `${name}的 NOVA · 个人工作台`;
    const city = CITY_MAP[state.profile.city] || CITY_MAP.shanghai;
    $(".coordinate").innerHTML = `${city.lat.toFixed(4)}° N<br>${city.lon.toFixed(4)}° E`;
  }

  function recordActivity(delta) {
    const key = localDateKey();
    state.activity[key] = Math.max(0, (Number(state.activity[key]) || 0) + delta);
  }

  function renderTasks() {
    const list = $("#taskList");
    const empty = $("#taskEmpty");
    list.replaceChildren();
    state.tasks.forEach((task) => {
      const item = document.createElement("li");
      item.className = `task-item${task.done ? " done" : ""}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "task-check";
      checkbox.checked = Boolean(task.done);
      checkbox.setAttribute("aria-label", `${task.done ? "标记为未完成" : "标记为完成"}：${task.text}`);
      checkbox.addEventListener("change", () => {
        task.done = checkbox.checked;
        recordActivity(task.done ? 1 : -1);
        saveState();
        renderTasks();
        renderRhythm();
        if (task.done) toast("完成一项，做得漂亮");
      });

      const text = document.createElement("span");
      text.className = "task-text";
      text.textContent = task.text;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "task-delete";
      remove.setAttribute("aria-label", `删除任务：${task.text}`);
      remove.innerHTML = icon("trash");
      remove.addEventListener("click", () => {
        if (task.done) recordActivity(-1);
        state.tasks = state.tasks.filter((itemTask) => itemTask.id !== task.id);
        saveState();
        renderTasks();
        renderRhythm();
      });
      item.append(checkbox, text, remove);
      list.append(item);
    });

    const complete = state.tasks.filter((task) => task.done).length;
    const remaining = state.tasks.length - complete;
    empty.hidden = state.tasks.length !== 0;
    $("#remainingTasks").textContent = `${remaining} 项`;
    $("#taskSummary").textContent = remaining ? `已完成 ${complete} 项` : "今天的清单已清空";
    $("#taskFoot").textContent = `${complete} / ${state.tasks.length} 已完成`;
    $("#taskProgress").style.width = state.tasks.length ? `${(complete / state.tasks.length) * 100}%` : "100%";
  }

  function addTask(text) {
    const clean = text.trim().slice(0, 120);
    if (!clean) return false;
    state.tasks.unshift({ id: makeId(), text: clean, done: false });
    saveState();
    renderTasks();
    toast("新任务已加入今日重点");
    return true;
  }

  function renderLinks() {
    const grid = $("#quickLinks");
    grid.replaceChildren();
    state.quickLinks.slice(0, 12).forEach((link) => {
      const wrap = document.createElement("div");
      wrap.className = "quick-link-wrap";
      const anchor = document.createElement("a");
      anchor.className = "quick-link";
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.style.setProperty("--link-color", link.color || "var(--accent)");
      anchor.setAttribute("aria-label", `打开 ${link.name}`);

      const mark = document.createElement("span");
      mark.className = "quick-link-icon";
      mark.textContent = (link.letter || [...link.name].slice(0, 2).join("")).toUpperCase();
      const name = document.createElement("strong");
      name.textContent = link.name;
      anchor.append(mark, name);
      anchor.insertAdjacentHTML("beforeend", icon("external"));

      const remove = document.createElement("button");
      remove.className = "quick-link-delete";
      remove.type = "button";
      remove.setAttribute("aria-label", `删除快捷入口：${link.name}`);
      remove.innerHTML = icon("trash");
      remove.addEventListener("click", () => {
        state.quickLinks = state.quickLinks.filter((item) => item.id !== link.id);
        saveState();
        renderLinks();
        toast("快捷入口已移除");
      });
      wrap.append(anchor, remove);
      grid.append(wrap);
    });

    if (!state.quickLinks.length) {
      const add = document.createElement("button");
      add.className = "quick-link";
      add.type = "button";
      add.innerHTML = `<span class="quick-link-icon">+</span><strong>添加第一个入口</strong>`;
      add.addEventListener("click", openLinkDialog);
      grid.append(add);
    }
  }

  function normalizeUrl(value) {
    const candidate = /^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
    const parsed = new URL(candidate);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid protocol");
    return parsed.href;
  }

  function renderCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
    $("#calendarTitle").textContent = monthNames[month];
    $("#calendarYear").textContent = year;
    const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysPrev = new Date(year, month, 0).getDate();
    const grid = $("#calendarGrid");
    grid.replaceChildren();
    for (let cell = 0; cell < 42; cell += 1) {
      const node = document.createElement("span");
      node.className = "calendar-day";
      let day;
      if (cell < firstOffset) {
        day = daysPrev - firstOffset + cell + 1;
        node.classList.add("muted");
      } else if (cell >= firstOffset + daysInMonth) {
        day = cell - firstOffset - daysInMonth + 1;
        node.classList.add("muted");
      } else {
        day = cell - firstOffset + 1;
        if (day === now.getDate()) {
          node.classList.add("today");
          node.setAttribute("aria-current", "date");
        }
      }
      node.textContent = day;
      grid.append(node);
    }
    const yearEnd = new Date(year + 1, 0, 1);
    const remaining = Math.ceil((yearEnd - new Date(year, month, now.getDate())) / 86400000) - 1;
    $("#yearRemaining").textContent = `今年还剩 ${remaining} 天`;
  }

  function renderRhythm() {
    const chart = $("#rhythmChart");
    chart.replaceChildren();
    const days = [];
    const now = new Date();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(now);
      day.setDate(now.getDate() - offset);
      days.push(day);
    }
    const values = days.map((day) => Number(state.activity[localDateKey(day)]) || 0);
    const max = Math.max(3, ...values);
    const labels = ["日", "一", "二", "三", "四", "五", "六"];
    days.forEach((day, index) => {
      const wrap = document.createElement("div");
      wrap.className = `rhythm-day${localDateKey(day) === localDateKey(now) ? " today" : ""}`;
      const bar = document.createElement("i");
      bar.className = "rhythm-bar";
      bar.style.height = `${Math.max(5, (values[index] / max) * 118)}px`;
      bar.dataset.value = values[index];
      const label = document.createElement("span");
      label.textContent = labels[day.getDay()];
      wrap.append(bar, label);
      chart.append(wrap);
    });
    const total = values.reduce((sum, value) => sum + value, 0);
    $("#weeklyTotal").innerHTML = `${total} <small>次行动</small>`;
    $("#rhythmNote").textContent = total >= 12 ? "节奏正在形成，记得给恢复留出空间。" : total > 0 ? "稳定的小步，会在一周后变成清晰的轨迹。" : "完成任务或专注轮次后，这里会长出你的节奏。";
  }

  function timerTick() {
    if (state.timer.running && state.timer.endAt) {
      state.timer.remaining = Math.max(0, Math.ceil((state.timer.endAt - Date.now()) / 1000));
      if (state.timer.remaining <= 0) completeTimer();
    }
    renderTimer();
  }

  function renderTimer() {
    const minutes = Math.floor(state.timer.remaining / 60);
    const seconds = state.timer.remaining % 60;
    $("#timerDisplay").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const elapsed = state.timer.duration - state.timer.remaining;
    const degrees = state.timer.duration ? Math.max(0, Math.min(360, (elapsed / state.timer.duration) * 360)) : 0;
    $("#timerRing").style.setProperty("--timer-progress", `${degrees}deg`);
    $("#timerLabel").textContent = state.timer.mode === "focus" ? (state.timer.running ? "正在专注" : "保持专注") : (state.timer.running ? "正在恢复" : "给大脑留白");
    const toggle = $("#timerToggle");
    toggle.querySelector("use").setAttribute("href", state.timer.running ? "#i-pause" : "#i-play");
    toggle.querySelector("span").textContent = state.timer.running ? "暂停" : "开始";
    $(".focus-card").classList.toggle("running", state.timer.running);
    $(".live-label").lastChild.textContent = state.timer.running ? "FLOW" : "READY";
    $$(".timer-modes button").forEach((button) => {
      const active = button.dataset.mode === state.timer.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("#focusSessions").textContent = `${state.focusSessions} 轮`;
  }

  function toggleTimer() {
    if (state.timer.running) {
      state.timer.remaining = Math.max(0, Math.ceil((state.timer.endAt - Date.now()) / 1000));
      state.timer.running = false;
      state.timer.endAt = null;
      toast("专注计时已暂停");
    } else {
      if (state.timer.remaining <= 0) state.timer.remaining = state.timer.duration;
      state.timer.running = true;
      state.timer.endAt = Date.now() + state.timer.remaining * 1000;
      toast(state.timer.mode === "focus" ? "专注舱已启动" : "休息计时已启动");
    }
    saveState();
    renderTimer();
  }

  function resetTimer() {
    state.timer.running = false;
    state.timer.endAt = null;
    state.timer.remaining = state.timer.duration;
    saveState();
    renderTimer();
    toast("计时器已重置");
  }

  function switchTimerMode(mode, minutes) {
    state.timer = { mode, duration: minutes * 60, remaining: minutes * 60, running: false, endAt: null };
    saveState();
    renderTimer();
  }

  function completeTimer() {
    const wasFocus = state.timer.mode === "focus";
    state.timer.running = false;
    state.timer.endAt = null;
    state.timer.remaining = 0;
    if (wasFocus) {
      state.focusSessions += 1;
      recordActivity(1);
      renderRhythm();
    }
    saveState();
    toast(wasFocus ? "专注完成，去喝口水吧" : "休息结束，准备好再继续");
  }

  async function fetchWeather(location = CITY_MAP[state.profile.city] || CITY_MAP.shanghai) {
    const cityNode = $("#weatherCity");
    cityNode.textContent = location.name;
    $("#weatherDesc").textContent = "正在获取天气";
    try {
      const params = new URLSearchParams({
        latitude: location.lat,
        longitude: location.lon,
        current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        timezone: "auto"
      });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!response.ok) throw new Error(`Weather ${response.status}`);
      const data = await response.json();
      const current = data.current;
      const weather = WEATHER[current.weather_code] || ["天气变化中", "◌"];
      $("#weatherTemp").textContent = Math.round(current.temperature_2m);
      $("#weatherDesc").textContent = weather[0];
      $("#weatherIcon").textContent = weather[1];
      $("#weatherRange").textContent = `体感 ${Math.round(current.apparent_temperature)}°`;
      $("#weatherWind").textContent = `${Math.round(current.wind_speed_10m)} km/h`;
      $("#weatherUpdated").textContent = new Date(current.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch {
      $("#weatherDesc").textContent = "天气暂时不可用";
      $("#weatherIcon").textContent = "◌";
    }
  }

  function locateWeather() {
    if (!navigator.geolocation) {
      toast("当前浏览器不支持定位");
      return;
    }
    $("#locateWeather").disabled = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        fetchWeather({ name: "当前位置", lat: position.coords.latitude, lon: position.coords.longitude });
        $("#locateWeather").disabled = false;
        toast("已更新当前位置天气");
      },
      () => {
        $("#locateWeather").disabled = false;
        toast("未获得位置权限，继续显示默认城市");
      },
      { timeout: 8000, maximumAge: 600000 }
    );
  }

  function openSettings() {
    $("#nameSetting").value = state.profile.name;
    $("#citySetting").value = state.profile.city;
    $("#engineSetting").value = state.profile.engine;
    const accent = $(`input[name='accent'][value='${state.profile.accent}']`);
    if (accent) accent.checked = true;
    $("#settingsDialog").showModal();
  }

  function saveSettings(event) {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      $("#settingsDialog").close();
      return;
    }
    state.profile.name = $("#nameSetting").value.trim() || "旅行者";
    state.profile.city = $("#citySetting").value;
    state.profile.engine = $("#engineSetting").value;
    state.profile.accent = $("input[name='accent']:checked")?.value || "lime";
    saveState();
    applyAppearance();
    updateProfile();
    fetchWeather();
    $("#settingsDialog").close();
    toast("偏好设置已保存");
  }

  function openLinkDialog() {
    if (state.quickLinks.length >= 12) {
      toast("最多保留 12 个快捷入口");
      return;
    }
    $("#linkForm").reset();
    $("#linkDialog").showModal();
    window.setTimeout(() => $("#linkName").focus(), 40);
  }

  function saveLink(event) {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      $("#linkDialog").close();
      return;
    }
    const name = $("#linkName").value.trim();
    try {
      const url = normalizeUrl($("#linkUrl").value);
      const palettes = ["#91e6b9", "#83b8ff", "#ff9c84", "#cbb7ff", "#f3cf78"];
      state.quickLinks.push({ id: makeId(), name, url, letter: $("#linkLetter").value.trim() || [...name].slice(0, 2).join(""), color: palettes[state.quickLinks.length % palettes.length] });
      saveState();
      renderLinks();
      $("#linkDialog").close();
      toast("快捷入口已添加");
    } catch {
      $("#linkUrl").setCustomValidity("请输入有效的 http(s) 网址");
      $("#linkUrl").reportValidity();
      $("#linkUrl").addEventListener("input", () => $("#linkUrl").setCustomValidity(""), { once: true });
    }
  }

  function visibleCommands() {
    return $$(".command-item").filter((item) => !item.hidden);
  }

  function markCommand() {
    const items = visibleCommands();
    commandIndex = Math.max(0, Math.min(commandIndex, items.length - 1));
    $$(".command-item").forEach((item) => item.classList.remove("active"));
    items[commandIndex]?.classList.add("active");
  }

  function openCommand() {
    const dialog = $("#commandDialog");
    if (dialog.open) return;
    $("#commandInput").value = "";
    $$(".command-item").forEach((item) => { item.hidden = false; });
    $("#commandEmpty").hidden = true;
    commandIndex = 0;
    markCommand();
    dialog.showModal();
    window.setTimeout(() => $("#commandInput").focus(), 30);
  }

  function filterCommands() {
    const query = $("#commandInput").value.trim().toLowerCase();
    let count = 0;
    $$(".command-item").forEach((item) => {
      item.hidden = !item.textContent.toLowerCase().includes(query);
      if (!item.hidden) count += 1;
    });
    $("#commandEmpty").hidden = count !== 0;
    commandIndex = 0;
    markCommand();
  }

  function runCommand(command) {
    $("#commandDialog").close();
    if (command === "add-task") {
      $("#tasks").scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => $("#taskInput").focus(), 350);
    } else if (command === "start-focus") {
      $("#focus").scrollIntoView({ behavior: "smooth", block: "center" });
      if (!state.timer.running) toggleTimer();
    } else if (command === "open-note") {
      $("#memo").scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => $("#memoInput").focus(), 350);
    } else if (command === "toggle-theme") toggleTheme();
    else if (command === "settings") openSettings();
    else if (command === "export") exportWorkspace();
    else if (command === "import") $("#importFile").click();
  }

  function exportWorkspace() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `nova-workspace-${localDateKey()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    toast("工作区备份已导出");
  }

  function importWorkspace(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported || imported.version !== 1 || !Array.isArray(imported.tasks) || !Array.isArray(imported.quickLinks)) throw new Error("bad file");
        const defaults = defaultState();
        state = {
          ...defaults,
          ...imported,
          profile: { ...defaults.profile, ...(imported.profile || {}) },
          timer: { ...defaults.timer, ...(imported.timer || {}), running: false, endAt: null }
        };
        saveState();
        initializeView();
        toast("工作区已从备份恢复");
      } catch {
        toast("无法导入：这不是有效的 NOVA 备份");
      }
      $("#importFile").value = "";
    });
    reader.readAsText(file);
  }

  function handleSearch(event) {
    event.preventDefault();
    const input = $("#searchInput");
    const query = input.value.trim();
    if (!query) {
      openCommand();
      return;
    }
    if (query.toLowerCase().startsWith("/task")) {
      const task = query.slice(5).trim();
      if (task) addTask(task);
      else {
        $("#tasks").scrollIntoView({ behavior: "smooth" });
        window.setTimeout(() => $("#taskInput").focus(), 350);
      }
    } else if (query.toLowerCase() === "/focus") {
      if (!state.timer.running) toggleTimer();
      $("#focus").scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (query.toLowerCase() === "/note") {
      $("#memo").scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => $("#memoInput").focus(), 350);
    } else {
      const engine = SEARCH_ENGINES[state.profile.engine] || SEARCH_ENGINES.bing;
      window.open(`${engine}${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
    }
    input.value = "";
  }

  function setMobileMenu(open, restoreFocus = true) {
    document.body.classList.toggle("menu-open", open);
    $("#main-content").inert = open;
    $(".mobile-dock").inert = open;
    if (open) window.setTimeout(() => $("#mobileClose").focus(), 20);
    else if (restoreFocus) $("#mobileMenu").focus();
  }

  function setupNavigation() {
    const links = $$(".nav-item");
    const mobileLinks = $$(".mobile-dock a");
    const sections = ["overview", "tasks", "bookmarks", "ai-usage", "focus", "launchpad", "memo"].map((id) => document.getElementById(id));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => link.classList.toggle("active", link.hash === `#${visible.target.id}`));
      mobileLinks.forEach((link) => link.classList.toggle("active", link.hash === `#${visible.target.id}`));
    }, { rootMargin: "-20% 0px -65%", threshold: [0, .2, .5] });
    sections.forEach((section) => section && observer.observe(section));
    links.forEach((link) => link.addEventListener("click", () => setMobileMenu(false, false)));
  }

  function setupEvents() {
    $("#taskForm").addEventListener("submit", (event) => {
      event.preventDefault();
      if (addTask($("#taskInput").value)) $("#taskInput").value = "";
    });
    $("#clearCompleted").addEventListener("click", () => {
      const removed = state.tasks.filter((task) => task.done).length;
      if (!removed) return toast("暂时没有已完成任务");
      state.tasks = state.tasks.filter((task) => !task.done);
      recordActivity(-removed);
      saveState(); renderTasks(); renderRhythm(); toast(`已清理 ${removed} 项完成任务`);
    });

    $("#memoInput").addEventListener("input", (event) => {
      state.memo = event.target.value;
      $("#memoCount").textContent = `${state.memo.length} / 1200`;
      $("#memoState").lastChild.textContent = "正在保存…";
      window.clearTimeout(memoSaveTimer);
      memoSaveTimer = window.setTimeout(() => {
        saveState();
        $("#memoState").lastChild.textContent = "已自动保存";
      }, 320);
    });

    $("#timerToggle").addEventListener("click", toggleTimer);
    $("#timerReset").addEventListener("click", resetTimer);
    $$(".timer-modes button").forEach((button) => button.addEventListener("click", () => switchTimerMode(button.dataset.mode, Number(button.dataset.minutes))));
    $("#dockFocus").addEventListener("click", () => { $("#focus").scrollIntoView({ behavior: "smooth", block: "center" }); if (!state.timer.running) toggleTimer(); });

    $("#themeToggle").addEventListener("click", () => toggleTheme());
    $("#settingsOpen").addEventListener("click", openSettings);
    $("#avatarSettings").addEventListener("click", openSettings);
    $("#dockSettings").addEventListener("click", openSettings);
    $("#settingsForm").addEventListener("submit", saveSettings);
    $("#linkAdd").addEventListener("click", openLinkDialog);
    $("#linkForm").addEventListener("submit", saveLink);
    $$(".settings-dialog [value='cancel'], .link-dialog [value='cancel']").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      button.closest("dialog").close();
    }));

    $("#usageUpdate").addEventListener("click", openUsageDialog);
    $("#usageParse").addEventListener("click", parseUsageInput);
    $("#usageForm").addEventListener("submit", saveUsage);
    $("#usageProvider").addEventListener("change", fillUsageDialog);
    $("#usageClose").addEventListener("click", () => $("#usageDialog").close());
    $("#usageCancel").addEventListener("click", () => $("#usageDialog").close());
    window.addEventListener("nova:usage-imported", () => {
      usageState = loadUsageState();
      renderAiUsage();
      toast("Codex 与 Claude 额度已从私有数据包更新");
    });

    $("#locateWeather").addEventListener("click", locateWeather);
    $("#globalSearch").addEventListener("submit", handleSearch);
    $("#commandOpen").addEventListener("click", openCommand);
    $$(".command-item").forEach((button) => button.addEventListener("click", () => runCommand(button.dataset.command)));
    $("#commandInput").addEventListener("input", filterCommands);
    $("#commandInput").addEventListener("keydown", (event) => {
      const items = visibleCommands();
      if (!items.length) return;
      if (event.key === "ArrowDown") { event.preventDefault(); commandIndex = (commandIndex + 1) % items.length; markCommand(); }
      if (event.key === "ArrowUp") { event.preventDefault(); commandIndex = (commandIndex - 1 + items.length) % items.length; markCommand(); }
      if (event.key === "Enter" && items.length) { event.preventDefault(); items[commandIndex].click(); }
    });
    $("#importFile").addEventListener("change", (event) => importWorkspace(event.target.files[0]));

    $("#mobileMenu").addEventListener("click", () => setMobileMenu(true));
    $("#mobileClose").addEventListener("click", () => setMobileMenu(false));
    document.addEventListener("click", (event) => {
      if (document.body.classList.contains("menu-open") && !event.target.closest(".sidebar") && !event.target.closest("#mobileMenu")) setMobileMenu(false);
    });

    document.addEventListener("keydown", (event) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openCommand(); return; }
      if (event.key === "Escape" && document.body.classList.contains("menu-open")) { event.preventDefault(); setMobileMenu(false); return; }
      if (typing || $("dialog[open]")) return;
      if (event.key.toLowerCase() === "d") toggleTheme();
      if (event.key.toLowerCase() === "t") { $("#tasks").scrollIntoView({ behavior: "smooth" }); window.setTimeout(() => $("#taskInput").focus(), 350); }
      if (event.key.toLowerCase() === "f") { $("#focus").scrollIntoView({ behavior: "smooth", block: "center" }); if (!state.timer.running) toggleTimer(); }
      if (event.key.toLowerCase() === "n") { $("#memo").scrollIntoView({ behavior: "smooth", block: "center" }); window.setTimeout(() => $("#memoInput").focus(), 350); }
    });
  }

  function initializeView() {
    const bootstrappedUsage = consumeUsageBootstrap();
    applyAppearance();
    updateProfile();
    updateClock();
    renderTasks();
    renderLinks();
    renderCalendar();
    renderRhythm();
    renderAiUsage();
    $("#memoInput").value = state.memo || "";
    $("#memoCount").textContent = `${(state.memo || "").length} / 1200`;
    if (state.timer.running && state.timer.endAt && state.timer.endAt <= Date.now()) completeTimer();
    renderTimer();
    fetchWeather();
    if (bootstrappedUsage) toast("Codex 与 Claude 额度已安全写入当前浏览器");
  }

  function init() {
    setupEvents();
    setupNavigation();
    initializeView();
    window.setInterval(updateClock, 30000);
    window.setInterval(renderAiUsage, 60000);
    timerInterval = window.setInterval(timerTick, 250);
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
