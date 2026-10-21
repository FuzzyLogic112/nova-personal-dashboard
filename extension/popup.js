"use strict";
const enabled = document.querySelector("#enabled");
const sync = document.querySelector("#sync");
const status = document.querySelector("#status");
const details = document.querySelector("#details");
async function send(command, value) {
  return chrome.runtime.sendMessage({ channel: NovaSync.CHANNEL, command, enabled: value });
}
function render(data) {
  if (!data || data.kind === "error") throw new Error(data?.message || "连接失败");
  enabled.checked = data.enabled !== false;
  sync.disabled = !enabled.checked;
  status.textContent = enabled.checked ? "已开启 · 工作台打开时自动更新" : "已暂停 · 保留工作台现有收藏";
  const count = data.items?.length ?? data.count;
  const time = data.generatedAt || data.lastReadAt;
  details.textContent = count == null ? "打开工作台后开始同步" : `${count} 个网页收藏${data.skipped ? ` · 跳过 ${data.skipped} 个内部/特殊链接` : ""}${time ? ` · ${new Date(time).toLocaleTimeString()}` : ""}`;
}
async function run(command, value) {
  enabled.disabled = sync.disabled = true;
  try { render(await send(command, value)); }
  catch (error) { status.textContent = error.message; }
  finally { enabled.disabled = false; sync.disabled = !enabled.checked; }
}
enabled.addEventListener("change", () => run("SET_ENABLED", enabled.checked));
sync.addEventListener("click", () => run("SYNC"));
document.querySelector("#open").addEventListener("click", () => chrome.tabs.create({ url: `${NovaSync.URL}#bookmarks` }));
void run("STATUS");
