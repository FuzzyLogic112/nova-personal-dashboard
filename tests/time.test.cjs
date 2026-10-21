const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { read, runtime, page, sample, until } = require('./helpers.cjs');
const time = require('../time.js');

test('Beijing display and date inputs agree on an instant regardless of the host zone', () => {
  const instant = '2026-10-21T07:44:00.000Z';
  assert.equal(time.format(instant, { hour: '2-digit', minute: '2-digit' }), '15:44');
  assert.equal(time.dateKey(instant), '2026-10-21');
  assert.equal(time.toInput(instant), '2026-10-21T15:44');
  assert.equal(time.fromInput('2026-10-21T15:44'), instant);
  assert.equal(time.fromInput(''), null);
  assert.equal(time.fromInput('2026-10-21T15:44Z'), null);
});

test('browser overrides of Date locale methods cannot override the chosen display zone', () => {
  const original = Date.prototype.toLocaleString;
  try {
    Date.prototype.toLocaleString = () => '07:44';
    assert.equal(time.format('2026-10-21T07:44:00Z', { hour: '2-digit', minute: '2-digit' }), '15:44');
    assert.ok(time.format('2026-10-21T07:44:00Z').includes('15:44:00'));
  } finally { Date.prototype.toLocaleString = original; }
});

function clockPage(instant) {
  let now = Date.parse(instant);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const { document } = parseHTML(read('index.html'));
  const context = vm.createContext({ document, Date: Clock, console,
    localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(read('time.js'), context);
  // Expose the production renderers only within the isolated test context.
  vm.runInContext(read('app.js').replace(
    'document.addEventListener("DOMContentLoaded", init, { once: true });',
    'globalThis.testView = { updateClock, formatUsageReset, toLocalDateTime, localDateKey };'
  ), context);
  return { document, view: context.testView, setTime(value) { now = Date.parse(value); } };
}

test('07:44 UTC renders 15:44, afternoon greeting and matching calendar/day progress', () => {
  const { document, view } = clockPage('2026-10-21T07:44:00Z');
  view.updateClock();
  assert.equal(document.querySelector('#topTime').textContent, '15:44');
  assert.equal(document.querySelector('#greeting').textContent, '下午好');
  assert.equal(document.querySelector('#dayProgressText').textContent, '55%');
  assert.equal(document.querySelector('#topDate').textContent, '10月21日 · 星期三');
  assert.equal(document.querySelector('#calendarGrid [aria-current="date"]').textContent, '21');
  assert.equal(document.querySelector('.rhythm-day.today span').textContent, '三');
});

test('an open dashboard rolls calendar, year and activity date over at Beijing midnight', () => {
  const p = clockPage('2026-12-31T15:59:59Z');
  p.view.updateClock();
  assert.equal(p.document.querySelector('#calendarYear').textContent, '2026');
  p.setTime('2026-12-31T16:00:00Z');
  p.view.updateClock();
  assert.equal(p.document.querySelector('#topTime').textContent, '00:00');
  assert.equal(p.document.querySelector('#topDate').textContent, '01月01日 · 星期五');
  assert.equal(p.document.querySelector('#calendarTitle').textContent, '一月');
  assert.equal(p.document.querySelector('#calendarYear').textContent, '2027');
  assert.equal(p.document.querySelector('#calendarGrid [aria-current="date"]').textContent, '1');
  assert.equal(p.document.querySelector('#footerYear').textContent, '2027');
  assert.equal(p.view.localDateKey(), '2027-01-01');
});

test('bookmark sync confirms the same Beijing timestamp without changing saved instants', async () => {
  const rt = runtime(sample());
  const p = await page(rt);
  await until(() => p.text('#bookmarkSyncStatus') === '收藏夹自动同步已连接');
  const { state } = await p.store.read();
  assert.ok(p.text('#bookmarkSyncDetails').includes(time.format(state.syncedAt)));
  assert.ok(p.text('#bookmarkSyncDetails').includes('北京时间'));
  assert.ok(Math.abs(state.syncedAt - Date.now()) < 10000);
});
