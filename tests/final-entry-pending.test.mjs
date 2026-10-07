import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
function block(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `missing source block ${startText}`);
  return source.slice(start, end);
}
const helpers = block('  const FINAL_ENTRY_PENDING_KEY', '  function isMonitorRoute(');
const click = block('  function clickDiagnose(d)', '  // Vue 表格行');
const listener = block('  function onReportEntryObserved(event)', '  function installReportEntryBridge()');
const protocol = block('  async function protocolEnter(d)', '  function protocolAllowsEntry(');
const pendingKey = 'jx-radiation-final-entry-pending-v1';
const origin = 'http://10.10.94.90:22112';

function runtime(storage = new Map(), initialPath = '/radiation') {
  let clock = 1000, sequence = 0, current = new URL(initialPath, origin);
  const timers = new Map(), events = [], reloads = [], pushes = [], rows = [];
  const location = {
    get pathname() { return current.pathname; },
    get href() { return current.href; },
    set href(value) { reloads.push(value); current = new URL(value, origin); }
  };
  const sessionStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };
  let router = null;
  const root = { __vue_app__: { config: { globalProperties: {} } } };
  const document = {
    getElementById: id => id === 'app' ? root : null,
    querySelector: () => null
  };
  const page = { location, sessionStorage, document };
  const context = vm.createContext({
    URL, URLSearchParams, Date: class extends Date { static now() { return clock; } },
    document, pageWindow: () => page, diagnosisActive: false,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    developerLog: (event, detail) => events.push({ event, detail }), debugError: String,
    norm: value => String(value || '').trim(), REPORT_STATUS_CODES: { '诊断中': '102502' },
    queryBodyRows: () => rows, rowData: row => row,
    isMonitorRoute: path => ['/radiation', '/radiation/report'].includes(path || location.pathname),
    isAutoOpenEnabled: () => true, isPendingReport: () => true, shouldSkipLocked: () => false,
    isExcludedExam: () => false, automaticEntryBlockReason: () => '',
    reserveAutomaticEntry: data => { data.__automaticEntryKey = `rep:${data.record?.repUid}`; data.__automaticEntryToken = 'synthetic-token'; return true; },
    consumeAutomaticEntry: () => true, releaseAutomaticEntry: () => true, readAutomaticEntry: () => null,
    debugCandidate: data => ({ key: data.record?.repUid }),
    diagnoseOperator: row => row.item, findRowRecord: data => data.record || null,
    findRowRecordByApi: async () => null, recordData: record => record,
    observeCandidateLifecycle: () => ({}), lifecycleDebug: () => ({}),
    ensureSessionIdentity: async () => {},
    fetchJson: async () => ({ response: { ok: true, status: 200 }, payload: { code: 200, data: true } }),
    protocolAllowsEntry: payload => payload.data === true,
    loginIdentity: () => ({ name: 'synthetic-own-doctor' }), accountValueMatches: (a, b) => a === b,
    console: { info() {}, warn() {} }, config: { selectors: { operatorItems: '' } }
  });
  vm.runInContext(`${helpers}\n${click}\n${listener}\n${protocol}`, context);
  return {
    context, events, reloads, pushes, rows, storage, page, timers,
    setTime(value) { clock = value; },
    tick(value) {
      clock = value;
      for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
    },
    setRoute(value) { current = new URL(value, origin); },
    setRouter(push = value => { current = new URL(value, origin); }) {
      router = { async push(value) { pushes.push(value); return push(value); } };
      root.__vue_app__.config.globalProperties.$router = router;
    }
  };
}
const finalDetail = (id = 'synthetic-1', outcome = 'complete', extra = {}) => ({
  repUid: id, endpointKind: 'radiation-entry', requestMethod: 'POST', outcome, phase: 'report-enter',
  startedAt: 1000, durationMs: 1, route: '/radiation/report', routeReportId: id,
  responseRoute: '/radiation/report', responseRouteReportId: id, reportIdMatches: true,
  code: outcome === 'complete' ? 200 : 409, httpStatus: 200, ...extra
});
let tested = 0;
async function test(name, run) { await run(); console.log(`ok ${++tested} - ${name}`); }

await test('readable pending rows cannot release final response barrier', () => {
  const r = runtime();
  r.rows.push({ patient: 'synthetic', status: '待诊断', doctor: '' });
  r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  assert.equal(r.context.entryDiagnosisLockActive(), true);
  assert.equal(JSON.parse(r.storage.get(pendingKey)).repUid, 'synthetic-1');
});
await test('success releases barrier and retains existing diagnosing doctor rule', () => {
  const r = runtime();
  r.context.diagnosisActive = true;
  r.rows.push({ patient: 'synthetic', status: '诊断中', doctor: 'synthetic-own-doctor' });
  r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  assert.equal(r.context.completeFinalEntryPending(finalDetail()), true);
  assert.equal(r.storage.has(pendingKey), false);
  assert.equal(r.context.entryDiagnosisLockActive(), true);
  r.rows[0].status = '待诊断'; r.rows[0].doctor = '';
  assert.equal(r.context.entryDiagnosisLockActive(), false);
});
for (const outcome of ['rejected', 'error']) {
  await test(`${outcome} releases pending and never records final loading success`, () => {
    const r = runtime();
    r.context.beginFinalEntryPending('synthetic-1', 'protocol');
    assert.equal(r.context.completeFinalEntryPending(finalDetail('synthetic-1', outcome)), true);
    assert.equal(r.events.at(-1).detail.reason, `native-${outcome}`);
    assert.equal(r.events.at(-1).detail.finalReportLoaded, false);
  });
}
await test('GET detail cannot release final lock barrier', () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  assert.equal(r.context.completeFinalEntryPending(finalDetail('synthetic-1', 'complete', { endpointKind: 'report-detail', requestMethod: 'GET' })), false);
  assert.equal(r.context.entryDiagnosisLockActive(), true);
});
await test('late different report cannot release newer candidate barrier', () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-2', 'protocol');
  assert.equal(r.context.completeFinalEntryPending(finalDetail()), false);
  assert.equal(r.context.pendingFinalEntryState().repUid, 'synthetic-2');
});
await test('late older attempt for same report cannot release new attempt', () => {
  const r = runtime(); r.setTime(2000); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  assert.equal(r.context.completeFinalEntryPending(finalDetail()), false);
  assert.equal(r.context.pendingFinalEntryState().startedAt, 2000);
});
await test('30 second timeout is bounded and removes persistent barrier', () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  r.tick(30999); assert.equal(r.context.entryDiagnosisLockActive(), true);
  r.tick(31000); assert.equal(r.context.pendingFinalEntryState(), null);
  assert.equal(r.storage.has(pendingKey), false);
  assert.equal(r.events.at(-1).detail.reason, 'final-response-timeout');
});
await test('time check expires barrier even if background timer was suspended', () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  r.setTime(31001); assert.equal(r.context.entryDiagnosisLockActive(), false);
});
await test('session storage survives full reload and preserves original deadline', () => {
  const first = runtime(); first.context.beginFinalEntryPending('synthetic-1', 'protocol');
  const second = runtime(first.storage, '/radiation/report?id=synthetic-1');
  second.setTime(2500); second.rows.push({ patient: 'synthetic', status: '待诊断' });
  assert.equal(second.context.entryDiagnosisLockActive(), true);
  assert.equal(second.context.pendingFinalEntryState().expiresAt, 31000);
  assert.equal(second.context.completeFinalEntryPending(finalDetail()), true);
});
await test('returning to list cancels pending without waiting for timeout', () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  r.setRoute('/radiation/report?id=synthetic-1'); r.context.maintainFinalEntryPendingRoute('/radiation/report', '/radiation');
  r.setRoute('/radiation'); r.context.maintainFinalEntryPendingRoute('/radiation', '/radiation/report');
  assert.equal(r.context.pendingFinalEntryState(), null);
  assert.equal(r.events.at(-1).detail.reason, 'returned-to-list');
});
await test('leaving report flow cancels pending and GET cannot restore it', () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  r.setRoute('/setting/profile'); r.context.maintainFinalEntryPendingRoute('/setting/profile', '/radiation/report');
  assert.equal(r.context.pendingFinalEntryState(), null);
});
await test('full reload on returned list cancels a remembered report pending', () => {
  const first = runtime(); first.context.beginFinalEntryPending('synthetic-1', 'protocol');
  first.setRoute('/radiation/report?id=synthetic-1'); first.context.pendingFinalEntryState();
  const second = runtime(first.storage, '/radiation');
  assert.equal(second.context.pendingFinalEntryState(), null);
  assert.equal(second.storage.has(pendingKey), false);
});
await test('Vue router is preferred and causes no full page reload', async () => {
  const r = runtime(); r.setRouter(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  assert.equal(await r.context.navigateToDiagnosisReport('/radiation/report?id=synthetic-1', 'synthetic-1'), true);
  assert.equal(r.pushes.length, 1); assert.equal(r.reloads.length, 0);
  assert.equal(r.context.entryDiagnosisLockActive(), true);
});
await test('missing router falls back to full navigation without losing stored barrier', async () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  assert.equal(await r.context.navigateToDiagnosisReport('/radiation/report?id=synthetic-1', 'synthetic-1'), true);
  assert.equal(r.reloads.length, 1); assert.equal(r.storage.has(pendingKey), true);
});
await test('router exception falls back once and preserves pending state', async () => {
  const r = runtime(); r.setRouter(() => { throw new Error('synthetic-router-error'); });
  r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  await r.context.navigateToDiagnosisReport('/radiation/report?id=synthetic-1', 'synthetic-1');
  assert.equal(r.pushes.length, 1); assert.equal(r.reloads.length, 1); assert.equal(r.storage.has(pendingKey), true);
});
await test('router cancellation respects native navigation guard', async () => {
  const r = runtime(); r.setRouter(() => ({ type: 4 })); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  assert.equal(await r.context.navigateToDiagnosisReport('/radiation/report?id=synthetic-1', 'synthetic-1'), false);
  assert.equal(r.reloads.length, 0); assert.equal(r.storage.has(pendingKey), false);
});
await test('automatic protocol entry establishes pending before original router executes', async () => {
  const r = runtime();
  r.setRouter(value => { assert.equal(r.context.entryDiagnosisLockActive(), true); r.setRoute(value); });
  const candidate = { record: { repUid: 'synthetic-1', statusCode: '102501' } };
  assert.equal(await r.context.protocolEnter(candidate), true);
  assert.equal(r.pushes.length, 1); assert.equal(r.reloads.length, 0);
});
await test('page click establishes pending before native click handler', () => {
  const r = runtime(); let calls = 0;
  const row = { item: { click() { assert.equal(r.context.entryDiagnosisLockActive(), true); calls++; } } };
  assert.equal(r.context.clickDiagnose({ row, record: { repUid: 'synthetic-1' } }), true);
  assert.equal(calls, 1); assert.equal(r.context.pendingFinalEntryState().source, 'page-click');
});
await test('native response listener releases matching pending only after POST result', () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  r.context.onReportEntryObserved({ detail: JSON.stringify(finalDetail()) });
  assert.equal(r.context.pendingFinalEntryState(), null);
  assert.equal(r.events.some(event => event.event === '报告进入完成'), true);
});
await test('different report doctor is explicitly diagnosed without new business request', () => {
  const r = runtime(); r.context.beginFinalEntryPending('synthetic-1', 'protocol');
  r.context.onReportEntryObserved({ detail: JSON.stringify(finalDetail('synthetic-1', 'complete', { reportDoctor: 'synthetic-other-doctor', lockUserName: 'synthetic-other-doctor' })) });
  const mismatch = r.events.find(event => event.event === '报告进入后所属医生不匹配');
  assert.equal(mismatch.detail.reportOwnerMatches, false);
  assert.equal(mismatch.detail.reportDoctor, 'synthetic-other-doctor');
  assert.equal(r.pushes.length, 0); assert.equal(r.reloads.length, 0);
});
console.log(`passed ${tested} final-entry pending cases`);
