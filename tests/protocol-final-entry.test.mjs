import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
function block(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `missing source block ${startText}`);
  return source.slice(start, end);
}
const ledger = block('  const AUTOMATIC_ENTRY_PREFIX', '  function rememberData(d)');
const dataKeys = block('  function dataKeys(d)', '  function candidatePatientName(d)');
const pending = block('  const FINAL_ENTRY_PENDING_KEY', '  function isMonitorRoute(');
const protocol = block("  let protocolFinalEntryRepUid = ''", '  async function enterDiagnosis(d)');
const entry = block('  async function enterDiagnosis(d)', '  const REPORT_STATUS_CODES');
const observer = block('  function onReportEntryObserved(event)', '  function installReportEntryBridge()');
const prefix = 'jx-radiation-auto-entry-once-v1:';
const storageKey = id => prefix + encodeURIComponent(`rep:${id}`);
const id = 'synthetic-final-report';
const owner = 'synthetic-owner';
const clean = value => JSON.parse(JSON.stringify(value));
const candidate = (uid = id, extra = {}) => ({
  key: `rep:${uid}`, exam: 'synthetic-exam', status: '待诊断', statusCode: '102501',
  record: { repUid: uid, status: '待诊断', statusCode: '102501', exam: 'synthetic-exam', applyOrgCode: 'synthetic-org' },
  ...extra
});
const finalPayload = (extra = {}) => ({ code: 200, data: {
  repUid: id, reportDoc: owner, reportStatusCode: '102502', modality: 'CT',
  finding: 'synthetic-finding', opinion: 'synthetic-opinion', measurementTableData: { htmlContent: '<p>synthetic</p>' },
  ...extra
} });
const result = payload => ({ response: { ok: true, status: 200, headers: { get: () => 'application/json' } }, payload, timing: {} });
let writer = 0;
function runtime(options = {}) {
  let clock = 1000, url = new URL('/radiation', 'http://10.10.94.90:22112'), sequence = 0;
  const events = [], requests = [], stages = [], discards = [], pushes = [], reloads = [], clicks = [];
  const saves = [], refreshes = [], notices = [];
  const gm = new Map(), local = new Map(), sessionStorageMap = new Map(), timers = new Map(), rows = [];
  const cookies = { AUTH: 'synthetic-auth', LOGINCODE: 'synthetic-account', WORKSTATION: '105701' };
  const account = { name: owner };
  const user = { currentWorkStation: options.station ?? '105701', userInfo: { logincode: 'synthetic-account' } };
  const bridge = {
    ready: true, isReady: () => true,
    stage(body, raw, httpStatus, headers, ttl) { stages.push({ body, raw, httpStatus, headers, ttl }); return 'synthetic-ticket'; },
    discard(ticket) { discards.push(ticket); }
  };
  const location = {
    get pathname() { return url.pathname; }, get href() { return url.href; },
    set href(value) { reloads.push(value); url = new URL(value, url); }
  };
  const router = { async push(value) { pushes.push(value); url = new URL(value, url); } };
  const root = { __vue_app__: { config: { globalProperties: { $router: router, $pinia: { _s: new Map([['user', user]]) } } } } };
  const document = {
    getElementById: () => root, querySelector: () => null,
    createElement: () => ({ textContent: '', style: {}, remove() {} }),
    body: { appendChild: notice => notices.push(notice) }
  };
  const page = { location, document, __JX_PROTOCOL_ENTRY_HANDOFF__: bridge, sessionStorage: {
    getItem: key => sessionStorageMap.get(key) ?? null,
    setItem: (key, value) => sessionStorageMap.set(key, value), removeItem: key => sessionStorageMap.delete(key)
  } };
  const config = { enabled: true, entryMode: 'protocol', pendingStatusValue: '102501', selectors: { operatorItems: '' } };
  const context = vm.createContext({
    URL, URLSearchParams, Map, Date: class extends Date { static now() { return clock; } },
    config, seen: new Map(), debugWriterId: `synthetic-final-writer-${++writer}`, debugEvents: [],
    saveConfig: () => saves.push({ enabled: config.enabled }),
    refreshAutoEntryScheduleUI: () => refreshes.push(config.enabled),
    pageWindow: () => page, document, diagnosisActive: false, entryRunning: false,
    developerLocalStorage: () => ({ getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) }),
    decodeDeveloperStorage: raw => typeof raw === 'string' ? JSON.parse(raw) : raw,
    GM_getValue: (key, fallback) => gm.get(key) ?? fallback, GM_setValue: (key, value) => gm.set(key, structuredClone(value)),
    developerLog: (event, detail) => events.push({ event, ...detail }), debugError: String,
    norm: value => String(value ?? '').normalize('NFC').replace(/[\s\u200B-\u200D\uFEFF]+/g, '').trim(),
    debugCandidate: data => ({ key: data.key, recordId: data.record?.repUid }),
    loginIdentity: () => account, accountValueMatches: (a, b) => a === b,
    readCookie: name => cookies[String(name).toUpperCase()] || '',
    setTimeout: (callback, delay) => { const key = ++sequence; timers.set(key, { callback, at: clock + delay }); return key; },
    clearTimeout: key => timers.delete(key),
    findRowRecord: data => data.record || data.row?.record || null, findRowRecordByApi: async () => null,
    recordData: record => ({ ...record, record, key: `rep:${record.repUid}`, statusCode: record.reportStatusCode || record.statusCode }),
    recordLockState: record => !!(record.locked || record.isLock), shouldSkipLocked: data => !!(data?.locked || data?.isLock),
    isPendingReport: data => data?.statusCode === '102501' && !(data.locked || data.isLock),
    isExcludedExam: data => !!data?.excluded, isAutoOpenEnabled: () => config.enabled,
    isMonitorRoute: () => ['/radiation', '/radiation/report'].includes(url.pathname),
    queryBodyRows: () => rows, rowData: row => row, REPORT_STATUS_CODES: { '诊断中': '102502' },
    diagnoseOperator: row => row.item || null, clickDiagnose: data => { clicks.push(data); return true; },
    observeCandidateLifecycle: () => ({}), lifecycleDebug: () => ({}), ensureSessionIdentity: async () => {}, waitBeforeEntry: async () => {},
    console: { info() {}, warn() {} },
    fetchJson: async (path, requestOptions, timeout) => {
      requests.push({ path, options: requestOptions, timeout });
      return requestOptions.method === 'POST' ? result(finalPayload()) : result({ code: 200, data: true });
    }
  });
  vm.runInContext(`${dataKeys}\n${ledger}\n${pending}\n${protocol}\n${entry}\n${observer}`, context);
  const r = { context, page, root, router, bridge, user, cookies, account, config, requests, stages, discards, pushes, reloads, clicks, events,
    saves, refreshes, notices,
    setTime: value => { clock = value; }, setRoute: value => { url = new URL(value, url); },
    record: (uid = id) => gm.get(storageKey(uid)),
    respond(handler) { context.fetchJson = async (path, requestOptions, timeout) => {
      const request = { path, options: requestOptions, timeout }; requests.push(request); return handler(request, r);
    }; },
    observed(extra = {}) { context.onReportEntryObserved({ detail: JSON.stringify({
      phase: 'report-enter', endpointKind: 'radiation-entry', requestMethod: 'POST', outcome: 'complete',
      repUid: id, startedAt: clock, durationMs: 1, code: 200, httpStatus: 200,
      route: '/radiation/report', responseRoute: '/radiation/report', routeReportId: id, responseRouteReportId: id,
      reportDoctor: owner, reportIdMatches: true, ...extra
    }) }); }
  };
  return r;
}
function finalResponse(r, handler) {
  r.respond(request => request.options.method === 'POST' ? handler(request, r) : result({ code: 200, data: true }));
}
function assertNoNavigation(r) { assert.equal(r.pushes.length, 0); assert.equal(r.reloads.length, 0); assert.equal(r.stages.length, 0); }
async function assertAcquiredFailurePaused(r, uncertain = false) {
  assert.equal(r.config.enabled, false);
  assert.deepEqual(r.saves, [{ enabled: false }]); assert.deepEqual(r.refreshes, [false]);
  assert.equal(r.notices.length, 1); assert.match(r.notices[0].textContent, /自动打开已暂停/);
  if (uncertain) assert.doesNotMatch(r.notices[0].textContent, /已取得/);
  for (const sensitive of [id, owner, 'synthetic-other-report', 'synthetic-other-owner', 'synthetic-switched-owner', 'synthetic-finding', 'synthetic-opinion']) {
    assert.equal(r.notices[0].textContent.includes(sensitive), false);
  }
  const count = r.requests.length;
  assert.equal(await r.context.enterDiagnosis(candidate('synthetic-next-report')), false);
  assert.equal(r.requests.length, count); assert.equal(r.clicks.length, 0);
}
function assertBusinessFailureRemainsEnabled(r) {
  assert.equal(r.config.enabled, true);
  assert.deepEqual(r.saves, []); assert.deepEqual(r.refreshes, []);
  assert.equal(r.notices.length, 0);
}
let tested = 0;
async function test(name, run) { await run(); console.log(`ok ${++tested} - ${name}`); }

await test('context requires matching string Pinia and cookie stations before building exact native payload', () => {
  const r = runtime({ station: '105712' }); r.cookies.WORKSTATION = '105701';
  assert.equal(r.context.protocolFinalEntryContext(id), null, 'different native and script WORKCODE contexts cannot pre-acquire');
  r.cookies.WORKSTATION = '105712';
  const context = r.context.protocolFinalEntryContext(id);
  assert.deepEqual(clean(context.body), { repUid: id, isList: false, isRemote: false, flag: 1 });
  r.user.currentWorkStation = '1057120'; assert.equal(r.context.protocolFinalEntryContext(id), null);
  r.cookies.WORKSTATION = '1057120'; assert.equal(r.context.protocolFinalEntryContext(id).body.flag, 0);
  delete r.root.__vue_app__.config.globalProperties.$pinia;
  r.cookies.WORKSTATION = '105712'; assert.equal(r.context.protocolFinalEntryContext(id), null, 'missing native login header context cannot pre-acquire');
});
await test('numeric Pinia station cannot pre-acquire even when the cookie contains matching digits', async () => {
  const r = runtime({ station: 105712 }); r.cookies.WORKSTATION = '105712';
  assert.equal(r.context.protocolFinalEntryContext(id), null);
  assert.equal(await r.context.enterDiagnosis(candidate()), true);
  assert.deepEqual(r.requests.map(request => request.options.method), ['GET']);
  assert.equal(r.stages.length, 0); assert.equal(r.pushes.length, 1);
  assert.equal(r.record().confirmed, false); assertBusinessFailureRemainsEnabled(r);
});
for (const [name, change] of [
  ['login alias', r => { r.user.userInfo.logincode = 'synthetic-account-alias'; }],
  ['login case difference', r => { r.user.userInfo.logincode = 'SYNTHETIC-ACCOUNT'; }],
  ['missing native login code', r => { delete r.user.userInfo.logincode; }],
  ['missing native user info', r => { delete r.user.userInfo; }],
  ['non-string native login code', r => { r.user.userInfo.logincode = 12345; }],
  ['empty native login code', r => { r.user.userInfo.logincode = ''; }]
]) await test(`${name} refuses early POST context and uses native navigation without a script POST`, async () => {
  const r = runtime(); change(r);
  assert.equal(r.context.protocolFinalEntryContext(id), null);
  assert.equal(await r.context.enterDiagnosis(candidate()), true);
  assert.deepEqual(r.requests.map(request => request.options.method), ['GET']);
  assert.equal(r.stages.length, 0); assert.equal(r.pushes.length, 1); assert.equal(r.clicks.length, 0);
  assert.equal(r.record().confirmed, false); assertBusinessFailureRemainsEnabled(r);
});
await test('unavailable handoff or router cannot construct an early POST context', () => {
  const r = runtime(); r.bridge.ready = false; assert.equal(r.context.protocolFinalEntryContext(id), null);
  r.bridge.ready = true; r.bridge.isReady = () => false; assert.equal(r.context.protocolFinalEntryContext(id), null);
  r.bridge.isReady = () => true; delete r.root.__vue_app__.config.globalProperties.$router;
  assert.equal(r.context.protocolFinalEntryContext(id), null);
});
await test('unknown current account cannot construct an early POST context', () => {
  const r = runtime(); r.account.name = ''; assert.equal(r.context.protocolFinalEntryContext(id), null);
});
await test('successful entry performs one GET and one POST with retries disabled and consumption persisted before POST', async () => {
  const r = runtime(), payload = finalPayload();
  finalResponse(r, request => {
    assert.equal(r.record().state, 'consumed'); assert.equal(r.record().confirmed, false);
    assert.equal(request.options.__tokenRecoveryRetry, true);
    assert.deepEqual(JSON.parse(request.options.body), { repUid: id, isList: false, isRemote: false, flag: 0 });
    return result(payload);
  });
  assert.equal(await r.context.enterDiagnosis(candidate()), true);
  assert.deepEqual(r.requests.map(request => request.options.method), ['GET', 'POST']);
  assert.equal(r.requests[1].path, '/api/ct/rays/rep/enter'); assert.equal(r.record().confirmed, true);
  assert.equal(r.stages.length, 1); assert.deepEqual(JSON.parse(r.stages[0].raw), payload);
  assert.equal(r.stages[0].ttl, 15000); assert.equal(r.pushes.length, 1); assert.equal(r.reloads.length, 0);
  assert.equal(r.clicks.length, 0); assert(r.context.pendingFinalEntryState());
  assert.equal(r.events.some(event => event.finalReportLoaded === true), false);
  r.observed(); assert.equal(r.context.pendingFinalEntryState(), null);
  assert(r.events.some(event => event.event === '报告进入完成' && event.finalReportLoaded === true));
});
await test('POST payload follows exact flag 105712 through real protocol entry', async () => {
  const r = runtime({ station: '105712' }); r.cookies.WORKSTATION = '105712';
  assert.equal(await r.context.protocolEnter(candidate()), true);
  assert.equal(JSON.parse(r.requests[1].options.body).flag, 1);
});
for (const [name, patch] of [
  ['different response report', { repUid: 'synthetic-other-report' }],
  ['different owner', { reportDoc: 'synthetic-other-owner' }],
  ['owner substring match', { reportDoc: owner + '-suffix' }],
  ['missing owner', { reportDoc: '' }],
  ['unexpected report status', { reportStatusCode: '102505' }]
]) await test(`${name} retains consumption and never navigates or clicks`, async () => {
  const r = runtime(); finalResponse(r, () => result(finalPayload(patch)));
  const d = candidate(); assert.equal(await r.context.enterDiagnosis(d), false);
  assertNoNavigation(r); assert.equal(r.clicks.length, 0); assert.equal(r.record().state, 'consumed');
  assert.equal(r.record().confirmed, false); assert(d.__entryBlocked);
  await assertAcquiredFailurePaused(r, true);
});
await test('explicit locked rejection persists a permanent reason and blocks a fresh candidate after exit', async () => {
  const r = runtime(); finalResponse(r, () => result({ code: 409, data: false, message: '当前报告已被其他用户锁定' }));
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
  assert.equal(r.record().reason, 'server-locked-other'); assert.equal(r.record().state, 'consumed');
  assert.match(r.context.automaticEntryBlockReason(candidate()), /其他用户锁定/);
  const count = r.requests.length; assert.equal(await r.context.enterDiagnosis(candidate()), false);
  assert.equal(r.requests.length, count); assert.equal(r.clicks.length, 0);
  assertBusinessFailureRemainsEnabled(r);
});
await test('explicit business 500 other-user lock keeps automatic opening enabled for a different report', async () => {
  const r = runtime(); finalResponse(r, () => result({ code: 500, data: null, message: '当前报告已被其他用户锁定' }));
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
  assert.equal(r.record().reason, 'server-locked-other'); assert.equal(r.record().state, 'consumed');
  assertBusinessFailureRemainsEnabled(r);
  const count = r.requests.length;
  assert.equal(await r.context.enterDiagnosis(candidate('synthetic-next-report')), false);
  assert.deepEqual(r.requests.slice(count).map(request => request.options.method), ['GET', 'POST']);
  assertBusinessFailureRemainsEnabled(r);
});
await test('known non-lock business rejection releases tentative consumption and blocks same-attempt click fallback', async () => {
  const r = runtime(); finalResponse(r, () => result({ code: 422, data: false, message: 'synthetic-rejection' }));
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
  assert.equal(r.record().state, 'released'); assert.equal(r.clicks.length, 0);
  assertBusinessFailureRemainsEnabled(r);
});
await test('TOKEN_FAIL final response is exactly one POST without navigation or local retry', async () => {
  const r = runtime(); finalResponse(r, () => result({ code: 2002, data: false }));
  assert.equal(await r.context.enterDiagnosis(candidate()), false);
  assert.equal(r.requests.filter(request => request.options.method === 'POST').length, 1);
  assert.equal(r.requests[1].options.__tokenRecoveryRetry, true); assertNoNavigation(r); assert.equal(r.clicks.length, 0);
  assert.equal(r.record().state, 'released'); assertBusinessFailureRemainsEnabled(r);
  const count = r.requests.length;
  assert.equal(await r.context.enterDiagnosis(candidate('synthetic-next-report')), false);
  assert.deepEqual(r.requests.slice(count).map(request => request.options.method), ['GET', 'POST']);
  assertBusinessFailureRemainsEnabled(r);
});
for (const [name, payload] of [
  ['missing data', { code: 200 }], ['unparseable response', null], ['array data', { code: 200, data: [] }],
  ['null success data', { code: 200, data: null }], ['false success data', { code: 200, data: false }],
  ['missing business code', { data: finalPayload().data }], ['null business code', { code: null, data: finalPayload().data }]
]) {
  await test(`${name} is uncertain and retains consumed state without retry`, async () => {
    const r = runtime(); finalResponse(r, () => result(payload));
    assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
    assert.equal(r.record().state, 'consumed'); assert.equal(r.record().confirmed, false);
    assert.equal(r.requests.length, 2); assert.equal(r.clicks.length, 0);
    await assertAcquiredFailurePaused(r, true);
  });
}
await test('POST network or parsing exception retains consumed state and no click fallback', async () => {
  for (const ErrorType of [Error, SyntaxError]) {
    const r = runtime(); finalResponse(r, () => { throw new ErrorType('synthetic-unknown-final-result'); });
    assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
    assert.equal(r.record().state, 'consumed'); assert.equal(r.record().confirmed, false); assert.equal(r.clicks.length, 0);
    await assertAcquiredFailurePaused(r, true);
  }
});
await test('delayed final POST timeout preserves uncertain consumption and blocks every next-report request', async () => {
  const r = runtime();
  let rejectPost;
  finalResponse(r, () => new Promise((_, reject) => { rejectPost = reject; }));
  const attempt = r.context.enterDiagnosis(candidate());
  for (let i = 0; i < 15; i++) await Promise.resolve();
  assert.equal(typeof rejectPost, 'function');
  assert.deepEqual(r.requests.map(request => request.options.method), ['GET', 'POST']);
  assert.equal(r.requests[1].timeout, 4500); assert.equal(r.config.enabled, true);
  r.setTime(5500);
  rejectPost(Object.assign(new Error('synthetic-final-timeout'), { name: 'AbortError' }));
  assert.equal(await attempt, false); assertNoNavigation(r);
  assert.equal(r.record().state, 'consumed'); assert.equal(r.record().confirmed, false);
  assert(r.events.some(event => event.event === '协议最终进入异常' && event.durationMs === 4500));
  await assertAcquiredFailurePaused(r, true);
});
await test('HTTP failure with success-shaped data is not accepted as an acquired report', async () => {
  const r = runtime(); finalResponse(r, () => ({ ...result(finalPayload()), response: { ok: false, status: 500 } }));
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r); assert.equal(r.record().state, 'consumed');
  await assertAcquiredFailurePaused(r, true);
});
await test('session and station changes during POST retain actual acquisition but prevent response handoff', async () => {
  for (const change of [r => { r.cookies.AUTH = 'synthetic-new-auth'; }, r => { r.cookies.LOGINCODE = 'synthetic-new-login'; },
    r => { r.user.currentWorkStation = '105712'; }]) {
    const r = runtime(); finalResponse(r, () => { change(r); return result(finalPayload()); });
    assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
    assert.equal(r.record().confirmed, true); assert.equal(r.record().state, 'consumed'); assert.equal(r.clicks.length, 0);
  }
});
await test('current account change before response fails strict owner validation', async () => {
  const r = runtime(); finalResponse(r, () => { r.account.name = 'synthetic-switched-owner'; return result(finalPayload()); });
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
  assert.equal(r.record().state, 'consumed'); assert.equal(r.record().confirmed, false);
  await assertAcquiredFailurePaused(r, true);
});
await test('route change during POST retains acquisition and suppresses navigation', async () => {
  const r = runtime(); finalResponse(r, () => { r.setRoute('/radiation/report?id=synthetic-other-report'); return result(finalPayload()); });
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r); assert.equal(r.record().confirmed, true);
});
await test('stage failure cannot trigger navigation, duplicate POST or release confirmed acquisition', async () => {
  const r = runtime(); r.bridge.stage = () => false;
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
  assert.equal(r.record().confirmed, true); assert.equal(r.requests.length, 2); assert.equal(r.clicks.length, 0);
  await assertAcquiredFailurePaused(r);
});
await test('router cancellation discards the staged response and retains confirmed acquisition without full fallback', async () => {
  const r = runtime(); r.router.push = async value => { r.pushes.push(value); return { type: 4 }; };
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assert.equal(r.pushes.length, 1);
  assert.deepEqual(r.discards, ['synthetic-ticket']); assert.equal(r.reloads.length, 0);
  assert.equal(r.record().confirmed, true); assert.equal(r.requests.length, 2); assert.equal(r.clicks.length, 0);
  await assertAcquiredFailurePaused(r);
});
await test('router exception after acquisition retains confirmed report and never full reloads', async () => {
  const r = runtime(); r.router.push = async value => { r.pushes.push(value); throw new Error('synthetic-route-error'); };
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assert.equal(r.pushes.length, 1);
  assert.equal(r.reloads.length, 0); assert.equal(r.record().confirmed, true); assert.equal(r.clicks.length, 0);
  assert.deepEqual(r.discards, ['synthetic-ticket']);
  await assertAcquiredFailurePaused(r);
});
await test('same report-route pathname with a changed ID is detected before handing off an acquired report', async () => {
  const r = runtime(); r.setRoute('/radiation/report?id=synthetic-start-report');
  finalResponse(r, () => { r.setRoute('/radiation/report?id=synthetic-user-selected-report'); return result(finalPayload()); });
  assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
  assert.equal(r.record().confirmed, true); assert.equal(r.context.pendingFinalEntryState(), null);
  await assertAcquiredFailurePaused(r);
});
await test('automatic-open authorization ending during POST preserves acquisition and suppresses all later entry', async () => {
  for (const change of [r => { r.config.enabled = false; }, r => { r.context.isAutoOpenEnabled = () => false; }]) {
    const r = runtime(); finalResponse(r, () => { change(r); return result(finalPayload()); });
    assert.equal(await r.context.enterDiagnosis(candidate()), false); assertNoNavigation(r);
    assert.equal(r.record().confirmed, true); assert.equal(r.context.pendingFinalEntryState(), null);
    await assertAcquiredFailurePaused(r);
  }
});
await test('navigation exceptions discard the staged response exactly once before persisting pause', async () => {
  const r = runtime();
  r.router.push = async value => { r.pushes.push(value); throw new Error('synthetic-navigation-exception'); };
  assert.equal(await r.context.protocolEnter(candidate()), false);
  assert.deepEqual(r.discards, ['synthetic-ticket']); assert.equal(r.stages.length, 1);
  assert.equal(r.record().confirmed, true); assert.equal(r.reloads.length, 0);
  await assertAcquiredFailurePaused(r);
});
await test('pre-acquire observer does not release pending or claim final UI loading', async () => {
  const r = runtime(); finalResponse(r, () => {
    r.observed({ route: '/radiation', routeReportId: '', responseRoute: '/radiation', responseRouteReportId: '' });
    assert(r.context.pendingFinalEntryState());
    assert.equal(r.events.some(event => event.event === '报告进入完成'), false);
    return result(finalPayload());
  });
  assert.equal(await r.context.enterDiagnosis(candidate()), true); assert(r.context.pendingFinalEntryState());
  r.observed({ repUid: 'synthetic-other-report', routeReportId: 'synthetic-other-report', responseRouteReportId: 'synthetic-other-report' });
  assert.equal(r.context.pendingFinalEntryState().repUid, id);
  r.observed(); assert.equal(r.context.pendingFinalEntryState(), null);
});
await test('late pre-acquire clone parsing cannot complete pending after the acquisition flag has cleared', async () => {
  const r = runtime(); assert.equal(await r.context.enterDiagnosis(candidate()), true);
  assert.equal(vm.runInContext('protocolFinalEntryRepUid', r.context), '');
  assert(r.context.pendingFinalEntryState());
  r.observed({ route: '/radiation', routeReportId: '', responseRoute: '/radiation/report', responseRouteReportId: id });
  assert.equal(r.context.pendingFinalEntryState().repUid, id);
  assert.equal(r.events.some(event => event.event === '报告进入完成'), false);
  assert.equal(r.events.at(-1).event, '提前协议进入响应旁听');
  assert.equal(r.events.at(-1).finalReportLoaded, false);
  r.observed(); assert.equal(r.context.pendingFinalEntryState(), null);
  assert(r.events.some(event => event.event === '报告进入完成' && event.finalReportLoaded === true));
});
for (const outcome of ['error', 'rejected']) await test(`cached native ${outcome} after confirmed acquisition pauses opening and blocks the next report`, async () => {
  const r = runtime();
  assert.equal(await r.context.enterDiagnosis(candidate()), true);
  assert.equal(r.record().confirmed, true); assert.equal(r.record().reason, 'protocol-final-acquired');
  r.observed({ outcome, code: outcome === 'error' ? null : 500, httpStatus: outcome === 'error' ? 0 : 200,
    reportDoctor: '', error: 'synthetic-cache-header-error', message: 'synthetic-cache-rejected' });
  assert.equal(r.context.pendingFinalEntryState(), null);
  assert.equal(r.record().state, 'consumed'); assert.equal(r.record().confirmed, true);
  assert.equal(r.events.some(event => event.finalReportLoaded === true), false);
  await assertAcquiredFailurePaused(r);
});
await test('manual native report failure without confirmed automatic acquisition never activates the acquisition pause', () => {
  for (const outcome of ['error', 'rejected']) {
    const r = runtime(); r.setRoute(`/radiation/report?id=${id}`);
    r.observed({ outcome, code: null, reportDoctor: '', error: 'synthetic-manual-failure' });
    assert.equal(r.record(), undefined); assert.equal(r.requests.length, 0);
    assertBusinessFailureRemainsEnabled(r);
  }
});
await test('old unconfirmed native navigation failures keep automatic opening enabled', async () => {
  for (const outcome of ['error', 'rejected']) {
    const r = runtime(); r.bridge.ready = false;
    assert.equal(await r.context.enterDiagnosis(candidate()), true);
    assert.deepEqual(r.requests.map(request => request.options.method), ['GET']);
    assert.equal(r.record().confirmed, false); assert.equal(r.record().reason, 'automatic-navigation');
    r.observed({ outcome, code: null, reportDoctor: '', error: 'synthetic-old-native-failure' });
    assert.equal(r.context.pendingFinalEntryState(), null);
    assert.equal(r.record().confirmed, false); assertBusinessFailureRemainsEnabled(r);
  }
});
await test('disabled, locked and excluded candidates never issue GET, POST, navigation or click', async () => {
  for (const mutate of [r => { r.config.enabled = false; }, (r, d) => { d.locked = true; },
    (r, d) => { d.record.locked = true; }, (r, d) => { d.excluded = true; },
    (r, d) => { d.record.statusCode = '102502'; }]) {
    const r = runtime(), d = candidate(); mutate(r, d);
    assert.equal(await r.context.enterDiagnosis(d), false); assert.equal(r.requests.length, 0);
    assertNoNavigation(r); assert.equal(r.clicks.length, 0);
  }
});
await test('lock appearing during GET precheck prevents final POST', async () => {
  const r = runtime(), d = candidate();
  r.respond(() => { d.record.locked = true; return result({ code: 200, data: true }); });
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.deepEqual(r.requests.map(request => request.options.method), ['GET']); assertNoNavigation(r); assert.equal(r.clicks.length, 0);
});
await test('failed durable consumption prevents POST dispatch', async () => {
  const r = runtime(); r.context.consumeAutomaticEntry = () => false;
  assert.equal(await r.context.enterDiagnosis(candidate()), false);
  assert.deepEqual(r.requests.map(request => request.options.method), ['GET']); assertNoNavigation(r); assert.equal(r.clicks.length, 0);
});
console.log(`${tested} protocol-final-entry tests passed`);
