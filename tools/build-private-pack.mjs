#!/usr/bin/env node
/**
 * Build a local-only NOVA import pack from Edge bookmarks and Claude Code logs.
 * The output directory is gitignored. Bookmark contents and prompts are never printed.
 */
import { createReadStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const next = process.argv[index + 1];
  args.set(key.slice(2), next && !next.startsWith("--") ? (index += 1, next) : true);
}

const userProfile = process.env.USERPROFILE || "";
const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, "AppData", "Local");
const edgePath = String(args.get("edge") || path.join(localAppData, "Microsoft", "Edge", "User Data", "Default", "Bookmarks"));
const claudePath = String(args.get("claude") || path.join(userProfile, ".claude"));
const outputPath = path.resolve(String(args.get("output") || path.join("private-import", "nova-private-pack.json")));
const since = Date.now() - 7 * 86400000;

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

function categoryFor(item) {
  const text = `${item.title} ${item.url} ${item.path.join(" ")}`;
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] || "待整理";
}

function chromiumTime(value) {
  const micros = Number(value);
  if (!Number.isFinite(micros)) return null;
  const date = new Date(micros / 1000 - 11644473600000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readEdgeBookmarks() {
  const source = JSON.parse(await fs.readFile(edgePath, "utf8"));
  const items = [];
  let urlNodes = 0;
  const skippedProtocols = {};
  function walk(node, folders = []) {
    if (!node || typeof node !== "object") return;
    if (node.type === "url" && node.url) {
      urlNodes += 1;
      const url = canonicalUrl(node.url);
      if (url) items.push({ id: node.guid || node.id || `edge-${items.length}`, title: String(node.name || new URL(url).hostname), url, path: folders, addedAt: chromiumTime(node.date_added) });
      else {
        let protocol = "invalid";
        try { protocol = new URL(String(node.url)).protocol.replace(":", "") || "invalid"; } catch { /* keep invalid */ }
        skippedProtocols[protocol] = (skippedProtocols[protocol] || 0) + 1;
      }
    }
    const nextFolders = node.type === "folder" && node.name ? [...folders, String(node.name)] : folders;
    if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, nextFolders));
  }
  Object.values(source.roots || {}).forEach((root) => walk(root, []));
  const seen = new Set();
  const bookmarks = items.map((item) => {
    const duplicate = seen.has(item.url);
    seen.add(item.url);
    return { ...item, category: categoryFor(item), duplicate };
  });
  return { bookmarks, sourceSummary: { urlNodes, importedWebsites: bookmarks.length, skippedProtocols } };
}

async function listJsonl(root) {
  const files = [];
  async function visit(directory) {
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
    }
  }
  await visit(root);
  return files;
}

function eventTimestamp(event) {
  for (const value of [event.timestamp, event.createdAt, event.created_at, event.message?.created_at]) {
    if (!value) continue;
    const stamp = typeof value === "number" && value < 1e12 ? value * 1000 : new Date(value).getTime();
    if (Number.isFinite(stamp)) return stamp;
  }
  return null;
}

async function summarizeClaude() {
  const files = await listJsonl(claudePath);
  const totals = { tokens7d: 0, inputTokens7d: 0, outputTokens7d: 0, cacheTokens7d: 0, calls7d: 0, sessions7d: 0, models: {}, daily: {} };
  const sessions = new Set();
  const messages = new Set();
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type !== "assistant" || !event.message?.usage) continue;
      const timestamp = eventTimestamp(event);
      if (!timestamp || timestamp < since || timestamp > Date.now() + 3600000) continue;
      const messageKey = `${event.sessionId || event.session_id || file}:${event.message.id || event.uuid || timestamp}`;
      if (messages.has(messageKey)) continue;
      messages.add(messageKey);
      const usage = event.message.usage;
      const input = Number(usage.input_tokens || 0);
      const output = Number(usage.output_tokens || 0);
      const cache = Number(usage.cache_creation_input_tokens || 0) + Number(usage.cache_read_input_tokens || 0);
      const total = input + output + cache;
      totals.inputTokens7d += input;
      totals.outputTokens7d += output;
      totals.cacheTokens7d += cache;
      totals.tokens7d += total;
      totals.calls7d += 1;
      const session = event.sessionId || event.session_id || path.basename(file);
      sessions.add(session);
      const model = String(event.message.model || "unknown");
      totals.models[model] = (totals.models[model] || 0) + 1;
      const day = new Date(timestamp).toISOString().slice(0, 10);
      totals.daily[day] = (totals.daily[day] || 0) + total;
    }
  }
  totals.sessions7d = sessions.size;
  return totals;
}

function codexSnapshot() {
  const usedPercent = args.has("codex-used") ? Number(args.get("codex-used")) : null;
  const resetsAtRaw = args.get("codex-resets-at");
  const resetsAtNumber = Number(resetsAtRaw);
  const resetAt = resetsAtRaw ? new Date(Number.isFinite(resetsAtNumber) ? resetsAtNumber * (resetsAtNumber < 1e12 ? 1000 : 1) : resetsAtRaw).toISOString() : null;
  return {
    remaining: Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, 100 - usedPercent)) : null,
    resetAt,
    windowMinutes: args.has("codex-window-minutes") ? Number(args.get("codex-window-minutes")) : null,
    plan: String(args.get("codex-plan") || "Codex"),
    source: "private-pack",
    updatedAt: new Date().toISOString(),
    history: []
  };
}

async function main() {
  const [{ bookmarks, sourceSummary }, claude] = await Promise.all([readEdgeBookmarks(), summarizeClaude()]);
  const payload = {
    kind: "nova-private-pack",
    version: 1,
    createdAt: new Date().toISOString(),
    privacy: { containsPrompts: false, containsCredentials: false, localImportOnly: true },
    sourceSummary,
    bookmarks,
    usage: {
      codex: codexSnapshot(),
      claude: { ...claude, remaining: null, resetAt: null, source: "private-pack", updatedAt: new Date().toISOString(), history: [] }
    }
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const categories = new Set(bookmarks.map((item) => item.category)).size;
  const duplicates = bookmarks.filter((item) => item.duplicate).length;
  console.log(`Private pack created: ${outputPath}`);
  console.log(`Bookmarks: ${bookmarks.length}; categories: ${categories}; duplicate candidates: ${duplicates}`);
  console.log(`Claude (7d): ${claude.calls7d} responses; ${claude.sessions7d} sessions; ${claude.tokens7d} tokens`);
  console.log("No prompts, cookies, API keys, or account identifiers were collected.");
}

main().catch((error) => {
  console.error(`Unable to build private pack: ${error.message}`);
  process.exitCode = 1;
});
