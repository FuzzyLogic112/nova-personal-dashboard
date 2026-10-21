"use strict";
importScripts("shared.js");

let queue = Promise.resolve();
let requested = false;
let running = false;
const serial = (task) => {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
};

async function settings() {
  const saved = await chrome.storage.local.get(["enabled", "sourceId", "lastReadAt"]);
  if (!saved.sourceId) {
    saved.sourceId = crypto.randomUUID();
    await chrome.storage.local.set({ sourceId: saved.sourceId });
  }
  return { enabled: saved.enabled !== false, sourceId: saved.sourceId, lastReadAt: saved.lastReadAt };
}

async function snapshot() {
  const config = await settings();
  if (!config.enabled) return { kind: "status", enabled: false };
  const { items, skipped } = NovaSync.flatten(await chrome.bookmarks.getTree());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(items)));
  const revision = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
  // Keep message order stable even within one millisecond or after a clock adjustment.
  const generatedAt = Math.max(Date.now(), (Number(config.lastReadAt) || 0) + 1);
  await chrome.storage.local.set({ lastReadAt: generatedAt, count: items.length, skipped });
  return { kind: "snapshot", version: 1, enabled: true, sourceId: config.sourceId,
    revision, generatedAt, items, skipped };
}

async function broadcast(payload) {
  const tabs = await chrome.tabs.query({ url: "https://fuzzylogic112.github.io/nova-personal-dashboard/*" });
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id,
    { channel: NovaSync.CHANNEL, payload }, { frameId: 0 }).catch(() => {})));
}

function scheduleSync() {
  requested = true;
  if (running) return;
  running = true;
  void serial(async () => {
    try {
      while (requested) {
        requested = false;
        try { await broadcast(await snapshot()); }
        catch { await broadcast({ kind: "error", message: "读取收藏夹失败，请在扩展中重试。" }); }
      }
    } finally { running = false; }
  }).catch(() => {});
}

function trustedSender(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab) return sender.frameId === 0 && NovaSync.isDashboard(sender.url);
  return sender.url === chrome.runtime.getURL("popup.html");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!trustedSender(sender) || message?.channel !== NovaSync.CHANNEL) return false;
  if (!["SYNC", "STATUS", "SET_ENABLED"].includes(message.command)) return false;
  serial(async () => {
    if (message.command === "STATUS") {
      const saved = await chrome.storage.local.get(["enabled", "lastReadAt", "count", "skipped"]);
      return { kind: "status", ...saved, enabled: saved.enabled !== false };
    }
    if (message.command === "SET_ENABLED") {
      if (typeof message.enabled !== "boolean") throw new Error("Invalid setting");
      await chrome.storage.local.set({ enabled: message.enabled });
    }
    const payload = await snapshot();
    if (message.command === "SET_ENABLED") payload.settingChanged = true;
    await broadcast(payload);
    return payload;
  }).then(respond, () => respond({ kind: "error", message: "同步未完成，请重试或重新加载扩展。" }));
  return true;
});

for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onChanged,
  chrome.bookmarks.onMoved, chrome.bookmarks.onRemoved,
  chrome.bookmarks.onChildrenReordered, chrome.bookmarks.onImportEnded]) {
  event.addListener(scheduleSync);
}
chrome.runtime.onStartup.addListener(scheduleSync);
chrome.runtime.onInstalled.addListener(() => {
  scheduleSync();
  void chrome.tabs.create({ url: `${NovaSync.URL}#bookmarks` });
});
