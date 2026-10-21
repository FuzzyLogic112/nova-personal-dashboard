(() => {
  "use strict";
  if (window.top !== window || !NovaSync.isDashboard(location.href)) return;
  const publish = (payload) => window.postMessage({ channel: NovaSync.CHANNEL, direction: "extension", payload }, location.origin);
  let lastRequest = 0;
  async function request(command, enabled) {
    try {
      const result = await chrome.runtime.sendMessage({ channel: NovaSync.CHANNEL, command, enabled });
      if (result) publish(result);
    } catch { publish({ kind: "error", message: "扩展连接已断开，请刷新工作台。" }); }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.channel !== NovaSync.CHANNEL || message.direction !== "page") return;
    if (!["SYNC", "STATUS", "SET_ENABLED"].includes(message.command)) return;
    if (message.command === "SET_ENABLED" && typeof message.enabled !== "boolean") return;
    // Bound repeated page requests; bookmark event notifications are not throttled.
    if (message.command === "SYNC" && Date.now() - lastRequest < 500) return;
    lastRequest = Date.now();
    void request(message.command, message.enabled);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.channel === NovaSync.CHANNEL) publish(message.payload);
  });
  void request("SYNC");
})();
