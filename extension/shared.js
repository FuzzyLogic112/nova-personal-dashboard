/* Shared by the service worker and the isolated content script. No network I/O. */
"use strict";
var NovaSync = (() => {
  const URL = "https://fuzzylogic112.github.io/nova-personal-dashboard/";
  const CHANNEL = "nova-bookmark-sync-v1";
  const MAX_ITEMS = 100000;
  function isDashboard(value) {
    try {
      const url = new globalThis.URL(value);
      return url.origin === "https://fuzzylogic112.github.io" &&
        ["/nova-personal-dashboard/", "/nova-personal-dashboard/index.html"].includes(url.pathname);
    } catch { return false; }
  }
  function flatten(tree) {
    const items = [];
    let skipped = 0;
    function visit(node, path) {
      if (node.url) {
        let allowed = false;
        try { allowed = /^https?:$/.test(new globalThis.URL(node.url).protocol); } catch {}
        if (!allowed) { skipped++; return; }
        items.push({ id: `browser-${node.id}`, title: node.title || node.url,
          url: node.url, path, addedAt: node.dateAdded || null });
        if (items.length > MAX_ITEMS) throw new Error("收藏夹超过 100000 条，已停止同步，原数据保持不变。");
      } else {
        const nextPath = node.title ? [...path, node.title] : path;
        for (const child of node.children || []) visit(child, nextPath);
      }
    }
    for (const root of tree) visit(root, []);
    return { items, skipped };
  }
  return { URL, CHANNEL, MAX_ITEMS, isDashboard, flatten };
})();
if (typeof module !== "undefined") module.exports = NovaSync;
