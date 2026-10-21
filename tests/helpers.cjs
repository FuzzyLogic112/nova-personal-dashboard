const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { parseHTML } = require('linkedom');
const { IDBFactory } = require('fake-indexeddb');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, fire(...args) { for (const fn of this.listeners) fn(...args); } });
const nextTick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  for (let n = 0; n < 500; n++) { if (await check()) return; await nextTick(); }
  throw new Error('Timed out waiting for expected state');
}
function runtime(tree, data = {}) {
  const sent = [];
  const handlers = new Map();
  let reads = 0;
  const chrome = {
    bookmarks: { async getTree() { reads++; return structuredClone(tree); } },
    storage: { local: { async get(keys) { return Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])); }, async set(values) { Object.assign(data, values); } } },
    tabs: { async query() { return [...handlers.keys()].map(id => ({id})); }, async sendMessage(id, message) { sent.push(message); handlers.get(id)?.(message); }, async create() {} },
    runtime: { id:'nova-test-id', getURL: p => `chrome-extension://nova-test-id/${p}`, onMessage:event(), onStartup:event(), onInstalled:event() }
  };
  for (const name of ['onCreated','onChanged','onMoved','onRemoved','onChildrenReordered','onImportEnded']) chrome.bookmarks[name] = event();
  const context = vm.createContext({ chrome, console, crypto:webcrypto, TextEncoder, URL, Uint8Array });
  context.importScripts = file => vm.runInContext(read(`extension/${file}`), context);
  vm.runInContext(read('extension/background.js'), context);
  const sender = { id:chrome.runtime.id, frameId:0, url:'https://fuzzylogic112.github.io/nova-personal-dashboard/', tab:{id:1} };
  function request(command, enabled, from = sender) {
    return new Promise(resolve => {
      const accepted = chrome.runtime.onMessage.listeners[0]({channel:'nova-bookmark-sync-v1',command,enabled}, from, resolve);
      if (!accepted) resolve(null);
    });
  }
  return {chrome, data, sent, handlers, sender, request, reads:()=>reads, setTree(next) { tree=next; }};
}
async function page(rt, {manual=[], indexedDB=new IDBFactory(), id=1, storageData=new Map()} = {}) {
  const {document, Event} = parseHTML(read('index.html'));
  const events = new Map();
  const localStorage = {getItem:k=>storageData.get(k)??null, setItem:(k,v)=>storageData.set(k,String(v))};
  const window = { addEventListener(name, fn) { if (!events.has(name)) events.set(name,[]); events.get(name).push(fn); },
    postMessage(data, origin) { queueMicrotask(()=>window.emit('message',{source:window,origin,data})); },
    emit(name, e) { for(const fn of events.get(name)||[]) fn(e); }, setTimeout:()=>0, setInterval:()=>0, confirm:()=>true };
  window.top=window;
  const location = {href:rt.sender.url,origin:'https://fuzzylogic112.github.io'};
  const context = vm.createContext({document,window,location,localStorage,indexedDB,console,URL,Date,Blob,Math,DOMParser:require('linkedom').DOMParser,CustomEvent:require('linkedom').CustomEvent});
  vm.runInContext(read('bookmark-store.js'),context);
  if (manual.length) await context.NovaBookmarkStore.replace(manual);
  vm.runInContext(read('vault.js'),context);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await until(()=>document.querySelector('#bookmarkCategories').children.length>0);
  const messageEvent=event();
  rt.handlers.set(id,message=>messageEvent.fire(message));
  const contentChrome={runtime:{sendMessage:msg=>rt.request(msg.command,msg.enabled,{...rt.sender,tab:{id}}),onMessage:messageEvent}};
  const isolated=vm.createContext({chrome:contentChrome,window,location,console,Date,URL});
  vm.runInContext(read('extension/shared.js'),isolated);
  vm.runInContext(read('extension/content.js'),isolated);
  return {document,window,localStorage,context,store:context.NovaBookmarkStore,storageData,
    text:selector=>document.querySelector(selector).textContent,
    click:selector=>document.querySelector(selector).click(),
    emit:payload=>window.emit('message',{source:window,origin:location.origin,data:{channel:'nova-bookmark-sync-v1',direction:'extension',payload}})};
}
const sample = (title='Example', url='https://www.example.com/docs?from=library&utm_source=mine#part-2') => [{id:'0',title:'',children:[{id:'1',title:'收藏夹栏',children:[{id:'2',title:'学习',children:[{id:'3',title,url,dateAdded:123}]}]}]}];
module.exports={runtime,page,sample,until,read,event};
