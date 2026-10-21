const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const store = require('../bookmark-store.js');
const item = (id,title=id)=>({id,title,url:`https://example.com/${id}#section`,path:['收藏夹栏']});
const snapshot = (items,seq=1)=>({kind:'snapshot',version:1,enabled:true,sourceId:'test-source',revision:seq.toString(16).padStart(64,'0'),generatedAt:seq,items,skipped:0});
test.beforeEach(()=>{global.indexedDB=new IDBFactory();});
test('v1 database upgrades without losing existing bookmarks',async()=>{
  await new Promise((resolve,reject)=>{const r=indexedDB.open('nova-private-vault-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('bookmarks',{keyPath:'id'}).put(item('old'));r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);});
  assert.equal((await store.read()).items[0].id,'old');
});
test('first sync backs up old data; changes and empty snapshot retain backup',async()=>{
  await store.replace([item('manual')]);
  await store.apply(snapshot([item('one')]),[item('one')]);
  await store.apply(snapshot([item('two')],2),[item('two')]);
  assert.equal((await store.read()).items[0].id,'two');
  await store.apply(snapshot([],3),[]);
  assert.equal((await store.read()).items.length,0);
  assert.equal((await store.read()).state.count,0);
  assert.equal((await store.restore())[0].id,'manual');
  assert.equal((await store.read()).state,null);
});
test('unchanged snapshots do not replace data; older snapshots cannot roll it back',async()=>{
  await store.apply(snapshot([item('new')],4),[item('new')]);
  assert.equal((await store.apply(snapshot([item('new')],4),[item('new')])).changed,false);
  assert.equal((await store.apply(snapshot([item('old')],2),[item('old')])).stale,true);
  assert.equal((await store.read()).items[0].id,'new');
});
test('invalid snapshots, duplicate IDs, and script URLs leave existing data intact',async()=>{
  await store.replace([item('manual')]);
  for(const bad of [{...snapshot([]),items:null},snapshot([item('x'),item('x')]),snapshot([{...item('x'),url:'javascript:alert(1)'}])]) {
    assert.throws(()=>store.apply(bad,bad.items));
    assert.equal((await store.read()).items[0].id,'manual');
    assert.equal((await store.read()).hasBackup,false);
  }
});
test('simultaneous tabs serialize writes and keep the newest snapshot',async()=>{
  await Promise.all([store.apply(snapshot([item('a')],1),[item('a')]),store.apply(snapshot([item('b')],2),[item('b')])]);
  assert.equal((await store.read()).items[0].id,'b');
  assert.ok((await store.read()).hasBackup);
});
