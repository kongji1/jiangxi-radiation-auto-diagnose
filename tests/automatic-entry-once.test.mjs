import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
function block(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `missing ${startText}`);
  return source.slice(start, end);
}
const ledger = block('  const AUTOMATIC_ENTRY_PREFIX', '  function rememberData(d)');
const dataKeys = block('  function dataKeys(d)', '  function candidatePatientName(d)');
const pending = block('  const FINAL_ENTRY_PENDING_KEY', '  function isMonitorRoute(');
const protocol = block('  async function protocolEnter(d)', '  function protocolAllowsEntry(');
const entry = block('  async function enterDiagnosis(d)', '  const REPORT_STATUS_CODES');
const click = block('  function clickDiagnose(d)', '  // Vue 表格行');
const observer = block('  function onReportEntryObserved(event)', '  function installReportEntryBridge()');
const prefix = 'jx-radiation-auto-entry-once-v1:';
const storageKey = id => prefix + encodeURIComponent(`rep:${id}`);
let writer = 0;
const report = (id = 'synthetic-report-1', extra = {}) => ({ key: 'synthetic-DOM-key', exam: 'synthetic-exam', status: '待诊断',
  statusCode: '102501', record: { repUid: id, status: '待诊断', statusCode: '102501', exam: 'synthetic-exam' }, ...extra });

function runtime(shared = { gm: new Map(), local: new Map() }, path = '/radiation') {
  let clock = 1000, url = new URL(path, 'http://10.10.94.90:22112'), seq = 0;
  const events = [], timers = new Map(), session = new Map(), rows = [], pushes = [];
  const ls = {
    getItem: key => shared.local.get(key) ?? null,
    setItem: (key, value) => shared.local.set(key, value), removeItem: key => shared.local.delete(key)
  };
  const location = { get pathname() { return url.pathname; }, get href() { return url.href; }, set href(value) { url = new URL(value, url); } };
  const root = { __vue_app__: { config: { globalProperties: { $router: { async push(value) { pushes.push(value); url = new URL(value, url); } } } } } };
  const page = { location, document: { getElementById: () => root }, sessionStorage: {
    getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key)
  } };
  const config = { selectors: { operatorItems: '' }, entryMode: 'protocol-only', pendingStatusValue: '102501', enabled: true };
  const context = vm.createContext({
    URL, URLSearchParams, Date: class extends Date { static now() { return clock; } },
    Map, config, seen: new Map(), debugWriterId: `synthetic-writer-${++writer}`, debugEvents: [],
    developerLocalStorage: () => ls, decodeDeveloperStorage: raw => typeof raw === 'string' ? JSON.parse(raw) : raw,
    GM_getValue: (key, fallback) => shared.gm.get(key) ?? fallback,
    GM_setValue: (key, value) => shared.gm.set(key, structuredClone(value)),
    findRowRecord: d => d.record || d.row?.record || null, findRowRecordByApi: async d => d.lookupRecord || null,
    developerLog: (event, detail) => events.push({ event, ...detail }),
    norm: v => String(v ?? '').trim(), debugError: String, debugCandidate: d => ({ key: d.key, recordId: d.record?.repUid }),
    loginIdentity: () => ({ name: 'synthetic-owner' }), accountValueMatches: (a, b) => a === b,
    pageWindow: () => page, document: page.document, diagnosisActive: false,
    setTimeout: (callback, delay) => { const id = ++seq; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id), queryBodyRows: () => rows, rowData: row => row,
    REPORT_STATUS_CODES: { '诊断中': '102502' }, isMonitorRoute: () => ['/radiation', '/radiation/report'].includes(url.pathname),
    isAutoOpenEnabled: () => config.enabled, isPendingReport: d => d?.statusCode === '102501' && !d.locked,
    shouldSkipLocked: d => !!d?.locked, isExcludedExam: d => !!d?.excluded,
    diagnoseOperator: row => row.item || null, recordData: record => ({ ...record, record, key: `rep:${record.repUid}` }),
    observeCandidateLifecycle: () => ({}), lifecycleDebug: () => ({}), ensureSessionIdentity: async () => {},
    fetchJson: async () => ({ response: { ok: true, status: 200 }, payload: { code: 200, data: true }, timing: {} }),
    protocolAllowsEntry: payload => payload.code === 200 && payload.data === true,
    waitBeforeEntry: async () => {}, entryRunning: false, console: { info() {}, warn() {} },
    MouseEvent: class { constructor(type) { this.type = type; } }
  });
  vm.runInContext(`${dataKeys}\n${ledger}\n${pending}\n${protocol}\n${entry}\n${click}\n${observer}`, context);
  return { context, events, shared, config, session, pushes, page, root,
    setTime: value => { clock = value; }, setRoute: value => { url = new URL(value, url); },
    record: id => shared.gm.get(storageKey(id)),
    observed(id = 'synthetic-report-1', outcome = 'complete', extra = {}) {
      context.onReportEntryObserved({ detail: JSON.stringify({
        phase: 'report-enter', endpointKind: 'radiation-entry', requestMethod: 'POST', outcome,
        repUid: id, startedAt: 1000, durationMs: 1, code: outcome === 'complete' ? 200 : 500, httpStatus: 200,
        route: '/radiation/report', responseRoute: '/radiation/report', routeReportId: id, responseRouteReportId: id,
        reportDoctor: 'synthetic-owner', reportIdMatches: true, ...extra
      }) });
    }
  };
}
let tested = 0;
async function test(name, run) { await run(); console.log(`ok ${++tested} - ${name}`); }

await test('only stable report UID is used, independent of shared patient/application/DOM keys', () => {
  const r = runtime(), a = report('synthetic-report-a'), b = report('synthetic-report-b');
  a.applicationNo = b.applicationNo = 'synthetic-same-application';
  assert.deepEqual(Array.from(r.context.dataKeys(a)), ['rep:synthetic-report-a']);
  assert.equal(r.context.consumeAutomaticEntry(a, 'native', true), true);
  assert.equal(r.context.dataSeen(a), true); assert.equal(r.context.dataSeen(b), false);
});
await test('DOM row resolves the same report as a prior remote-list observation', () => {
  const r = runtime(); r.context.consumeAutomaticEntry(report(), 'native', true);
  const dom = { key: 'synthetic-other-DOM-key', row: { record: report().record } };
  assert.equal(r.context.dataSeen(dom), true); assert.equal(dom.record.repUid, 'synthetic-report-1');
});
await test('one successful report remains handled across full reload and profile changes', () => {
  const a = runtime(); a.context.consumeAutomaticEntry(report(), 'native', true);
  const b = runtime(a.shared); b.config.entryMode = 'click';
  assert.equal(b.context.dataSeen(report()), true); assert.equal(b.context.automaticEntryBlockReason(report()), '本检查报告已进入过，不再自动进入');
});
await test('immediate same-origin mirror covers a delayed GM write during reload', () => {
  const a = runtime(); a.context.GM_setValue = () => {};
  a.context.consumeAutomaticEntry(report(), 'native', true);
  const b = runtime(a.shared); assert.equal(b.context.dataSeen(report()), true);
});
await test('GM copy covers unavailable local storage or a different-origin view', () => {
  const a = runtime(); a.context.developerLocalStorage = () => null;
  a.context.consumeAutomaticEntry(report(), 'native', true);
  const b = runtime({ gm: a.shared.gm, local: new Map() }); assert.equal(b.context.dataSeen(report()), true);
});
await test('clear debug, memory seen limits, and retention age cannot erase report history', () => {
  const r = runtime(); r.context.consumeAutomaticEntry(report(), 'native', true);
  r.context.debugEvents.length = 0; r.context.seen.clear(); r.config.seenLimit = 0; r.setTime(1000 + 366 * 86400000);
  assert.equal(r.context.dataSeen(report()), true);
});
await test('independent report writes in two documents do not overwrite each other', () => {
  const a = runtime(), b = runtime(a.shared);
  a.context.consumeAutomaticEntry(report('synthetic-a'), 'native', true);
  b.context.consumeAutomaticEntry(report('synthetic-b'), 'native', true);
  const c = runtime(a.shared); assert.equal(c.context.dataSeen(report('synthetic-a')), true); assert.equal(c.context.dataSeen(report('synthetic-b')), true);
});
await test('pending reservation blocks another document but permits the owning attempt', () => {
  const a = runtime(), b = runtime(a.shared), d = report();
  assert.equal(a.context.reserveAutomaticEntry(d), true);
  assert.equal(a.context.automaticEntryBlockReason(d), '');
  assert.equal(b.context.reserveAutomaticEntry(report()), false);
  assert.equal(b.context.dataSeen(report()), true);
});
await test('pre-navigation failure releases reservation and allows a fresh retry', () => {
  const r = runtime(), d = report(); r.context.reserveAutomaticEntry(d);
  assert.equal(r.context.releaseAutomaticEntry(d, 'precheck-failed'), true);
  const retry = report(); assert.equal(r.context.reserveAutomaticEntry(retry), true);
});
await test('expired reservation is recoverable without consuming the report', () => {
  const r = runtime(); r.context.reserveAutomaticEntry(report()); r.setTime(31001);
  assert.equal(r.context.dataSeen(report()), false); assert.equal(r.context.reserveAutomaticEntry(report()), true);
});
await test('old page release cannot erase a newer confirmed success', () => {
  const a = runtime(), b = runtime(a.shared), d = report(); a.context.reserveAutomaticEntry(d);
  b.context.consumeAutomaticEntry(report(), 'native', true);
  assert.equal(a.context.releaseAutomaticEntry(d, 'late-failure'), false); assert.equal(a.context.dataSeen(report()), true);
});
await test('precheck HTTP/network errors do not permanently consume candidates', async () => {
  const r = runtime(); r.context.fetchJson = async () => { throw new Error('synthetic-network-error'); };
  assert.equal(await r.context.protocolEnter(report()), false); assert.equal(r.context.dataSeen(report()), false);
});
await test('precheck business rejection releases reservation', async () => {
  const r = runtime(); r.context.fetchJson = async () => ({ response: { ok: true }, payload: { code: 500, data: false } });
  assert.equal(await r.context.protocolEnter(report()), false); assert.equal(r.context.dataSeen(report()), false);
});
await test('protocol UID enrichment rechecks an already consumed candidate before any precheck', async () => {
  const r = runtime(); r.context.consumeAutomaticEntry(report(), 'native', true); let requests = 0;
  r.context.fetchJson = async () => { requests++; throw new Error('must-not-request'); };
  const dom = { key: 'synthetic-DOM', statusCode: '102501', lookupRecord: report().record };
  assert.equal(await r.context.protocolEnter(dom), false); assert.equal(requests, 0); assert.equal(dom.record.repUid, 'synthetic-report-1');
});
await test('another document completion during async precheck prevents later navigation', async () => {
  const a = runtime(), b = runtime(a.shared); let done;
  a.context.fetchJson = () => new Promise(resolve => { done = resolve; });
  const attempt = a.context.protocolEnter(report()); await new Promise(resolve => setImmediate(resolve));
  b.context.consumeAutomaticEntry(report(), 'native', true);
  done({ response: { ok: true }, payload: { code: 200, data: true }, timing: {} });
  assert.equal(await attempt, false); assert.equal(a.pushes.length, 0);
});
await test('successful native-router navigation consumes before returning to list', async () => {
  const r = runtime(); assert.equal(await r.context.protocolEnter(report()), true);
  assert.equal(r.record('synthetic-report-1').state, 'consumed');
  r.setRoute('/radiation'); r.context.diagnosisActive = false; r.context.maintainFinalEntryPendingRoute('/radiation', '/radiation/report');
  assert.equal(await r.context.enterDiagnosis(report()), false); assert.equal(r.pushes.length, 1);
});
await test('navigation cancellation releases the dispatched tentative record', async () => {
  const r = runtime(); r.root.__vue_app__.config.globalProperties.$router.push = async () => ({ type: 4 });
  assert.equal(await r.context.protocolEnter(report()), false); assert.equal(r.context.dataSeen(report()), false);
});
await test('full navigation persists report consumption before assigning href', async () => {
  const r = runtime(); delete r.root.__vue_app__.config.globalProperties.$router;
  assert.equal(await r.context.protocolEnter(report()), true);
  const reloaded = runtime(r.shared, '/radiation'); assert.equal(reloaded.context.dataSeen(report()), true);
});
await test('native matching POST confirms actual automatic entry', async () => {
  const r = runtime(); await r.context.protocolEnter(report()); r.observed();
  assert.equal(r.record('synthetic-report-1').confirmed, true); assert.equal(r.context.pendingFinalEntryState(), null);
});
await test('manual native entry of own report prevents automatic reentry after exit', () => {
  const r = runtime(undefined, '/radiation/report?id=synthetic-report-1'); r.observed();
  assert.equal(r.record('synthetic-report-1').confirmed, true); assert.equal(r.context.dataSeen(report()), true);
});
await test('native response for another doctor does not migrate a manual handled report', () => {
  const r = runtime(undefined, '/radiation/report?id=synthetic-report-1'); r.observed('synthetic-report-1', 'complete', { reportDoctor: 'synthetic-other-owner' });
  assert.equal(r.context.dataSeen(report()), false);
});
await test('GET details and mismatched routes cannot mark a manual report handled', () => {
  const r = runtime(); r.observed('synthetic-report-1', 'complete', { endpointKind: 'report-detail', requestMethod: 'GET' });
  r.observed('synthetic-report-1', 'complete', { responseRouteReportId: 'synthetic-other-report' });
  assert.equal(r.context.dataSeen(report()), false);
});
await test('matching final business rejection permits retry, without erasing confirmed success', async () => {
  const r = runtime(); await r.context.protocolEnter(report()); r.observed('synthetic-report-1', 'rejected');
  assert.equal(r.context.dataSeen(report()), false);
  r.context.consumeAutomaticEntry(report(), 'native', true); r.observed('synthetic-report-1', 'rejected');
  assert.equal(r.context.dataSeen(report()), true);
});
await test('uncertain native network or parsing error retains dispatched consumption', async () => {
  const r = runtime(); await r.context.protocolEnter(report()); r.observed('synthetic-report-1', 'error');
  assert.equal(r.context.dataSeen(report()), true); assert.equal(r.record('synthetic-report-1').confirmed, false);
});
await test('old native rejection cannot release a later attempt of the same report', async () => {
  const r = runtime(); r.setTime(2000); await r.context.protocolEnter(report());
  r.observed('synthetic-report-1', 'rejected', { startedAt: 1000 }); assert.equal(r.context.dataSeen(report()), true);
});
await test('page click persists consumption and refuses the same UID afterward', () => {
  const r = runtime(); let clicks = 0;
  const d = report(); d.row = { statusCode: '102501', record: d.record, item: { click() { clicks++; } } };
  assert.equal(r.context.clickDiagnose(d), true); assert.equal(clicks, 1);
  r.context.finishFinalEntryPending('returned-to-list'); r.context.diagnosisActive = false;
  assert.equal(r.context.clickDiagnose(report('synthetic-report-1', { row: d.row })), false); assert.equal(clicks, 1);
});
await test('page click without a stable UID stays safe instead of using a patient name', () => {
  const r = runtime(); let clicks = 0;
  const d = { key: 'synthetic-person|synthetic-time', statusCode: '102501', row: { statusCode: '102501', item: { click() { clicks++; } } } };
  assert.equal(r.context.clickDiagnose(d), false); assert.equal(clicks, 0);
});
await test('page-click exception releases the unconfirmed record', () => {
  const r = runtime(); const d = report(); d.row = { statusCode: '102501', record: d.record, item: { click() { throw new Error('synthetic-click-error'); } } };
  assert.throws(() => r.context.clickDiagnose(d)); assert.equal(r.context.dataSeen(report()), false);
});
await test('existing retained native success is recovered using only report UID', () => {
  const r = runtime(); r.context.debugEvents.push({ event: '报告进入完成', at: new Date(500).toISOString(), recordId: 'synthetic-report-1',
    finalReportLoaded: true, requestMethod: 'POST', endpointKind: 'radiation-entry', reportDoctor: 'synthetic-owner',
    route: '/radiation/report', responseRoute: '/radiation/report', routeReportId: 'synthetic-report-1', responseRouteReportId: 'synthetic-report-1' });
  r.context.restoreAutomaticEntryHistory(); assert.equal(r.context.dataSeen(report()), true); assert.equal(r.record('synthetic-report-1').confirmed, true);
});
await test('assert success alone is not a handled report when recovering old logs', () => {
  const r = runtime(); r.context.debugEvents.push({ event: '协议进入成功', at: new Date(500).toISOString(), recordId: 'synthetic-report-1', phase: 'assert-allowed' });
  r.context.restoreAutomaticEntryHistory(); assert.equal(r.context.dataSeen(report()), false);
});
await test('old navigation remains tentative and a later known rejection releases it', () => {
  const r = runtime(); r.context.debugEvents.push(
    { event: '诊断路由导航', at: new Date(500).toISOString(), recordId: 'synthetic-report-1' },
    { event: '报告进入拒绝', at: new Date(600).toISOString(), recordId: 'synthetic-report-1', requestMethod: 'POST' }
  );
  r.context.restoreAutomaticEntryHistory(); assert.equal(r.context.dataSeen(report()), false);
});
await test('exclusions block protocol enrichment, post-response changes and direct click', async () => {
  const r = runtime(); let requests = 0;
  r.context.fetchJson = async () => { requests++; return { response: { ok: true }, payload: { code: 200, data: true } }; };
  const d = { key: 'synthetic-DOM', statusCode: '102501', lookupRecord: { ...report().record, excluded: true } };
  assert.equal(await r.context.protocolEnter(d), false); assert.equal(requests, 0);
  const c = report(); c.excluded = true; c.row = { statusCode: '102501', record: c.record, item: { click() { throw new Error('must-not-click'); } } };
  assert.equal(r.context.clickDiagnose(c), false);
  const a = report(); r.context.fetchJson = async () => { a.record.excluded = true; return { response: { ok: true }, payload: { code: 200, data: true } }; };
  assert.equal(await r.context.protocolEnter(a), false); assert.equal(r.pushes.length, 0);
});
console.log(`${tested} automatic-entry-once tests passed`);
