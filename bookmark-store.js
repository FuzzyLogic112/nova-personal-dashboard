/* Atomic local storage: the first browser snapshot and its backup commit together. */
"use strict";
var NovaBookmarkStore = (() => {
  const DB_NAME = "nova-private-vault-v1";
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      let blocked = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("bookmarks")) {
          const store = db.createObjectStore("bookmarks", { keyPath: "id" });
          store.createIndex("category", "category", { unique: false });
          store.createIndex("url", "url", { unique: false });
        }
        if (!db.objectStoreNames.contains("sync")) db.createObjectStore("sync", { keyPath: "id" });
      };
      request.onblocked = () => { blocked = true; reject(new Error("请关闭其他旧版工作台标签页，再刷新重试。")); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async function transaction(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["bookmarks", "sync"], mode);
      let result;
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error("本地保存失败，原数据保持不变。")); };
      try { work(tx.objectStore("bookmarks"), tx.objectStore("sync"), (value) => { result = value; }); }
      catch (error) { tx.abort(); db.close(); reject(error); }
    });
  }
  function read() {
    return transaction("readonly", (bookmarks, sync, done) => {
      const result = { items: [], state: null, hasBackup: false };
      bookmarks.getAll().onsuccess = (event) => { result.items = event.target.result; };
      sync.get("state").onsuccess = (event) => { result.state = event.target.result || null; };
      sync.getKey("before-sync").onsuccess = (event) => { result.hasBackup = event.target.result !== undefined; };
      done(result);
    });
  }
  function replace(items) {
    return transaction("readwrite", (bookmarks, sync) => {
      bookmarks.clear();
      for (const item of items) bookmarks.put(item);
      sync.delete("state");
    });
  }
  function validate(snapshot) {
    if (!snapshot || snapshot.kind !== "snapshot" || snapshot.version !== 1 || snapshot.enabled !== true ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(snapshot.sourceId) || !/^[a-f0-9]{64}$/.test(snapshot.revision) ||
      !Number.isSafeInteger(snapshot.generatedAt) || snapshot.generatedAt < 0 ||
      !Array.isArray(snapshot.items) || snapshot.items.length > 100000) throw new Error("收藏夹同步数据格式不正确。");
    const ids = new Set();
    for (const item of snapshot.items) {
      if (!item || typeof item.id !== "string" || !item.id || item.id.length > 256 || ids.has(item.id) ||
        typeof item.title !== "string" || item.title.length > 65536 ||
        typeof item.url !== "string" || item.url.length > 65536 ||
        !Array.isArray(item.path) || item.path.length > 100 || item.path.some((p) => typeof p !== "string" || p.length > 4096)) {
        throw new Error("收藏夹条目无效，已保留原数据。");
      }
      const url = new URL(item.url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("不支持的收藏链接。");
      ids.add(item.id);
    }
    return snapshot;
  }
  function apply(snapshot, items) {
    validate(snapshot);
    return transaction("readwrite", (bookmarks, sync, done) => {
      const currentRequest = sync.get("state");
      currentRequest.onsuccess = () => {
        const current = currentRequest.result;
        if (current?.sourceId === snapshot.sourceId && current.generatedAt > snapshot.generatedAt) {
          done({ changed: false, stale: true, state: current });
          return;
        }
        const state = { id: "state", sourceId: snapshot.sourceId, revision: snapshot.revision,
          generatedAt: snapshot.generatedAt, syncedAt: Date.now(), count: items.length, skipped: snapshot.skipped || 0 };
        if (current?.sourceId === snapshot.sourceId && current.revision === snapshot.revision) {
          sync.put(state);
          done({ changed: false, state });
          return;
        }
        // Requests run in the same read/write transaction: a failed write rolls back the backup too.
        const backupRequest = sync.getKey("before-sync");
        backupRequest.onsuccess = () => {
          if (backupRequest.result === undefined) {
            bookmarks.getAll().onsuccess = (event) => {
              sync.put({ id: "before-sync", savedAt: Date.now(), items: event.target.result });
              writeSnapshot();
            };
          } else writeSnapshot();
        };
        function writeSnapshot() {
          bookmarks.clear();
          for (const item of items) bookmarks.put(item);
          sync.put(state);
          done({ changed: true, state });
        }
      };
    });
  }
  function restore() {
    return transaction("readwrite", (bookmarks, sync, done) => {
      sync.get("before-sync").onsuccess = (event) => {
        const backup = event.target.result;
        if (!backup) { done(null); return; }
        bookmarks.clear();
        for (const item of backup.items) bookmarks.put(item);
        sync.delete("state");
        done(backup.items);
      };
    });
  }
  return { read, replace, apply, restore, validate };
})();
if (typeof module !== "undefined") module.exports = NovaBookmarkStore;
