const CACHE = "nova-shell-v10";
const SHELL = ["./", "./index.html", "./styles.css", "./time.js", "./app.js", "./vault.js", "./bookmark-store.js", "./sync-setup.html", "./manifest.webmanifest", "./assets/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("nova-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  if (new URL(event.request.url).pathname.includes("/downloads/")) return;
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(cache.put(event.request, copy));
      }
      return response;
    }).catch(() => event.request.mode === "navigate" ? cache.match("./index.html") : Response.error())))
  );
});
