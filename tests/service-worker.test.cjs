const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./helpers.cjs');
const base = 'https://fuzzylogic112.github.io/nova-personal-dashboard/';
function worker() {
  const listeners = {}, stores = new Map(), preloaded = [];
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, base).pathname;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(requests) { preloaded.push(...requests); },
        async match(request) { return entries.get(key(request)); },
        async put(request, response) { entries.set(key(request), response); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match() { throw new Error('Must not search unrelated or retired caches'); }
  };
  class LocalRequest extends Request {
    constructor(url, options) { super(new URL(url, base), options); }
  }
  vm.runInNewContext(read('sw.js'), {
    caches, Request: LocalRequest, Response, URL, location: new URL(base),
    fetch: async () => new Response('network'),
    self: { addEventListener: (name, fn) => { listeners[name] = fn; },
      skipWaiting() {}, clients: { claim() {} } }
  });
  async function event(name, extra = {}) {
    const waits = []; let response;
    listeners[name]({ ...extra, waitUntil(p) { waits.push(p); }, respondWith(p) { response = p; } });
    const result = await response;
    await Promise.all(waits);
    return result;
  }
  return { caches, stores, preloaded, event };
}
test('a new offline shell re-fetches assets instead of reusing stale HTTP cache', async () => {
  const w = worker();
  await w.event('install');
  assert.ok(w.preloaded.some(r => r.url.endsWith('/time.js')));
  assert.ok(w.preloaded.some(r => r.url.endsWith('/index.html')));
  assert.ok(w.preloaded.every(r => r.cache === 'reload'));
});
test('a retired worker cache cannot shadow the newly deployed shell', async () => {
  const w = worker();
  const old = await w.caches.open('nova-shell-v7');
  await old.put('./index.html', new Response('old'));
  await w.caches.open('another-project');
  await w.event('install');
  const name = [...w.stores.keys()].find(k => k !== 'nova-shell-v7' && k.startsWith('nova-shell-'));
  const current = await w.caches.open(name);
  await current.put('./index.html', new Response('new'));
  await w.event('activate');
  assert.equal(w.stores.has('nova-shell-v7'), false);
  assert.equal(w.stores.has('another-project'), true);
  // A request still running in an old tab may recreate its retired cache.
  await (await w.caches.open('nova-shell-v7')).put('./index.html', new Response('stale'));
  const response = await w.event('fetch', { request: new Request(`${base}index.html?v=latest`) });
  assert.equal(await response.text(), 'new');
});
