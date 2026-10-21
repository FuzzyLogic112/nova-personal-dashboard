const test=require('node:test');
const assert=require('node:assert/strict');
const {runtime,sample,read,until}=require('./helpers.cjs');
const shared=require('../extension/shared.js');
test('only exact NOVA pages are allowed, no sibling project, iframe URL or impostor host',()=>{
  for(const url of [shared.URL,shared.URL+'index.html?x=1#bookmarks'])assert.ok(shared.isDashboard(url));
  for(const url of ['https://fuzzylogic112.github.io/other/','https://fuzzylogic112.github.io/nova-personal-dashboard/sync-setup.html','https://fuzzylogic112.github.io.evil.test/nova-personal-dashboard/','http://fuzzylogic112.github.io/nova-personal-dashboard/'])assert.equal(shared.isDashboard(url),false);
});
test('bookmark paths and destinations survive; special URLs are skipped',()=>{
  const tree=sample();tree[0].children.push({id:'9',url:'javascript:alert(1)'},{id:'10',url:'edge://settings'});
  const result=shared.flatten(tree);
  assert.equal(result.items[0].url,'https://www.example.com/docs?from=library&utm_source=mine#part-2');
  assert.deepEqual(result.items[0].path,['收藏夹栏','学习']);assert.equal(result.skipped,2);
});
test('worker rejects other extensions, sites and child frames',async()=>{
  const rt=runtime(sample());
  for(const sender of [{...rt.sender,id:'other'}, {...rt.sender,url:'https://evil.test/'}, {...rt.sender,frameId:1}])assert.equal(await rt.request('SYNC',null,sender),null);
  assert.equal(rt.reads(),0);
});
test('read-only worker syncs edits, folder moves and deletions including empty tree',async()=>{
  const rt=runtime(sample());rt.handlers.set(1,()=>{});
  assert.equal((await rt.request('SYNC')).items.length,1);
  rt.setTree(sample('Renamed'));rt.chrome.bookmarks.onChanged.fire('3',{});await rt.request('STATUS');
  assert.equal(rt.sent.at(-1).payload.items[0].title,'Renamed');
  const moved=sample();moved[0].children[0].title='新的文件夹';rt.setTree(moved);rt.chrome.bookmarks.onMoved.fire('2',{});await rt.request('STATUS');
  assert.equal(rt.sent.at(-1).payload.items[0].path[0],'新的文件夹');
  rt.setTree([{id:'0',children:[]}]);rt.chrome.bookmarks.onRemoved.fire('3',{});await rt.request('STATUS');
  assert.equal(rt.sent.at(-1).payload.items.length,0);
  assert.ok(!JSON.stringify(rt.data).includes('example.com'));
});
test('pause stops reads and survives worker restart; resume exports current bookmarks',async()=>{
  const rt=runtime(sample());await rt.request('SET_ENABLED',false);const before=rt.reads();
  await rt.request('SYNC');assert.equal(rt.reads(),before);
  const restarted=runtime(sample('After restart'),rt.data);
  assert.equal((await restarted.request('SYNC')).enabled,false);assert.equal(restarted.reads(),0);
  assert.equal((await restarted.request('SET_ENABLED',true)).items[0].title,'After restart');
});
test('snapshot timestamps advance across rapid changes and worker restarts',async()=>{
  const rt=runtime(sample(),{lastReadAt:Date.now()+100000});
  const first=await rt.request('SYNC');const second=await rt.request('SYNC');
  assert.ok(second.generatedAt>first.generatedAt);
  const next=await runtime(sample(),rt.data).request('SYNC');
  assert.ok(next.generatedAt>second.generatedAt);
});
test('manifest has scoped content scripts and no history, cookies or broad access',()=>{
  const manifest=JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['bookmarks','storage']);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://fuzzylogic112.github.io/nova-personal-dashboard/*']);
  assert.equal(manifest.content_scripts[0].all_frames,false);
  assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);
  for(const file of ['background.js','content.js','popup.js'])assert.doesNotMatch(read('extension/'+file),/\bfetch\s*\(|XMLHttpRequest|chrome\.bookmarks\.(create|update|move|remove)\s*\(/);
});
