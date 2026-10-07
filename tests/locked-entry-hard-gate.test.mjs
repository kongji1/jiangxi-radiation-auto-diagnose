import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
function block(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `missing source block: ${startText}`);
  return source.slice(start, end);
}
const locks = block('  function lockValue(value)', '  function matchFailureReasons(d)');
const operators = block('  function operatorDisabled(item)', '  // 最终进入仍由原生报告页发起');
const recordView = block('  function recordData(record)', '  function currentCheckOrgId(');
const entry = block('  async function protocolEnter(d)', '  const REPORT_STATUS_CODES');
const click = block('  function clickDiagnose(d)', '  // Vue 表格行');
const pending = () => ({
  status: '待诊断', statusCode: '102501',
  record: { repUid: 'synthetic-report', patName: 'synthetic-patient', reportStatus: '待诊断', reportStatusCode: '102501' }
});
const item = (icon = 'ct-report', disabled = false) => ({
  icon, disabled, classList: { contains: () => false }, dataset: {},
  getAttribute: () => null, hasAttribute: () => false, click() {},
  scrollIntoView() {}
});
function row(data = {}, items = [item()]) {
  return {
    data: { status: '待诊断', statusCode: '102501', ...data }, items,
    querySelectorAll: () => items
  };
}
function runtime(options = {}) {
  const calls = { requests: [], navigations: [], clicks: 0, events: [] };
  const context = vm.createContext({
    config: { skipLockedRecords: false, pendingStatusValue: '102501', entryMode: 'protocol-first', selectors: { operatorItems: '.item', diagnoseOperatorIndex: 1 } },
    norm: value => String(value ?? '').replace(/\s/g, ''),
    REPORT_STATUS_CODES: { '待诊断': '102501', '诊断中': '102502' },
    REPORT_STATUS_NAMES: { '102501': '待诊断', '102502': '诊断中' },
    parseAge: () => null, parseGender: () => '',
    rowData: value => value.data, operatorIconName: value => value.icon,
    entryRunning: false, diagnosisActive: false,
    // Once-per-report persistence has its own real-function regression suite;
    // this harness keeps candidates unseen so lock gates remain under test.
    isExcludedExam: () => false, automaticEntryBlockReason: () => '',
    reserveAutomaticEntry: data => { data.__automaticEntryKey = `rep:${data.record?.repUid}`; data.__automaticEntryToken = 'synthetic-token'; return true; },
    consumeAutomaticEntry: () => true, releaseAutomaticEntry: () => true, readAutomaticEntry: () => null,
    finalEntryPending: {}, persistFinalEntryPending: () => {},
    isAutoOpenEnabled: () => true, isMonitorRoute: () => true, entryDiagnosisLockActive: () => false,
    waitBeforeEntry: async () => {}, findRowRecord: data => data?.record || null, findRowRecordByApi: async () => null,
    ensureSessionIdentity: async () => {},
    fetchJson: async url => {
      calls.requests.push(url);
      options.onRequest?.();
      return { response: { ok: true, status: 200 }, payload: options.payload || { code: 200, data: true } };
    },
    beginFinalEntryPending: () => {}, finishFinalEntryPending: () => false,
    navigateToDiagnosisReport: async url => { calls.navigations.push(url); return true; },
    observeCandidateLifecycle: () => ({}), lifecycleDebug: () => ({}), debugCandidate: data => ({ key: data?.record?.repUid }), debugError: String,
    developerLog: (event, detail) => calls.events.push({ event, detail }),
    URLSearchParams, console: { warn() {}, info() {} },
    ...options.context
  });
  vm.runInContext(`${locks}\n${operators}\n${recordView}\n${click}\n${entry}`, context);
  return { context, calls };
}
let passed = 0;
async function test(name, run) { await run(); console.log(`ok ${++passed} - ${name}`); }

await test('all positive lock flags and ordinary owner names are detected', () => {
  const { context: c } = runtime();
  for (const field of ['isLock', 'isLocked', 'locked', 'lock', 'lockedByOther', 'lockStatus', 'occupyStatus', 'isOccupied']) {
    for (const value of [true, 1, '1', 2, '2', '锁定']) assert.equal(c.recordLockState({ [field]: value }), true, `${field}=${value}`);
  }
  for (const field of ['lockUser', 'lockUserName', 'lockUserId', 'lockUserUid', 'lockedBy', 'occupyUser', 'occupyUserName', 'occupyUserId']) assert.equal(c.recordLockState({ [field]: 'synthetic-other-doctor' }), true, field);
});
await test('explicit empty and unlocked values remain eligible', () => {
  const { context: c } = runtime();
  for (const value of [false, 0, '0', 'false', null, '', '未锁定', '未占用', 'unlocked']) assert.equal(c.recordLockState({ isLock: value }), false, String(value));
  for (const value of [false, 0, '0', 'false', null, '', '无', 'none']) assert.equal(c.recordLockState({ lockUserName: value }), false, String(value));
  assert.equal(c.isPendingReport(pending()), true);
});
await test('legacy disabled skip setting cannot relax any entry path', async () => {
  const r = runtime(), d = pending(); d.record.isLock = true; d.row = row();
  assert.equal(r.context.shouldSkipLocked(d), true);
  assert.equal(r.context.isPendingReport(d), false);
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.equal(await r.context.protocolEnter(d), false);
  assert.equal(r.context.clickDiagnose(d), false);
  assert.equal(r.calls.requests.length, 0); assert.equal(r.calls.navigations.length, 0);
});
await test('unknown WebSocket status cannot use old source flag to bypass enrichment', async () => {
  const r = runtime(); const d = { record: { repUid: 'synthetic-report' }, __realtimeNeedsServerStatus: true };
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.equal(await r.context.protocolEnter(d), false);
  assert.equal(r.calls.requests.length, 0); assert.equal(r.calls.navigations.length, 0);
});
await test('known diagnosing state cannot use a WebSocket flag to bypass state gate', async () => {
  const r = runtime(); const d = pending();
  d.status = '诊断中'; d.statusCode = '102502'; d.record.reportStatus = '诊断中'; d.record.reportStatusCode = '102502'; d.__realtimeNeedsServerStatus = true;
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.equal(await r.context.protocolEnter(d), false); assert.equal(r.calls.requests.length, 0);
});
await test('disabled real diagnosis icon never falls back to another available operation', async () => {
  const r = runtime(); const d = pending(); d.row = row({}, [item('ct-report', true), item('application')]);
  assert.equal(r.context.diagnoseOperator(d.row), null);
  assert.equal(await r.context.protocolEnter(d), false);
  assert.equal(r.context.clickDiagnose(d), false); assert.equal(r.calls.requests.length, 0);
});
await test('ordinary pending unlocked protocol entry remains functional', async () => {
  const r = runtime(); const d = pending(); d.row = row();
  assert.equal(await r.context.enterDiagnosis(d), true);
  assert.equal(r.calls.requests.length, 1); assert.equal(r.calls.navigations.length, 1);
  assert.equal(r.calls.requests.some(value => value.includes('/rep/enter')), false);
});
for (const payload of [
  { code: 200, data: true, message: '当前报告已被其他用户锁定' },
  { code: 200, data: { allow: true, isLock: true } },
  { code: 200, data: { allow: true, lockUserName: 'synthetic-other-doctor' } },
  { code: 200, data: { allow: true, report: { lockUserId: 'synthetic-other-doctor' } } },
  { code: 200, data: { allow: true, reportStatusCode: '102502' } }
]) await test('assert allowed value cannot override lock or current status evidence', async () => {
  const r = runtime({ payload }); const d = pending(); d.row = row();
  assert.equal(r.context.protocolAllowsEntry(payload), false);
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.equal(r.calls.requests.length, 1); assert.equal(r.calls.navigations.length, 0);
  assert.ok(d.__entryBlocked);
});
await test('false strings, arbitrary objects and contradictory permission flags fail closed', () => {
  const { context: c } = runtime();
  for (const data of [false, 0, 'false', '0', 'not allowed', null, {}, [], { allow: false }, { allow: true, canEnter: false }]) assert.equal(c.protocolAllowsEntry({ code: 200, data }), false, JSON.stringify(data));
  for (const data of [true, 1, 'true', '1', { allow: true }, { canEnter: 1 }, { allow: true, canEnter: 'true' }]) assert.equal(c.protocolAllowsEntry({ code: 200, data }), true, JSON.stringify(data));
  assert.equal(c.protocolAllowsEntry({ code: 409, data: true }), false);
});
await test('page turns locked while assert request waits: no navigation or click fallback', async () => {
  const d = pending(); d.row = row();
  const r = runtime({ onRequest: () => { d.row.data.locked = true; } });
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.equal(d.__entryBlocked, '报告已锁定/占用'); assert.equal(r.calls.navigations.length, 0);
});
await test('page diagnosis operation disables while assert request waits: no navigation', async () => {
  const d = pending(); d.row = row();
  const r = runtime({ onRequest: () => { d.row.items[0].disabled = true; } });
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.equal(d.__entryBlocked, '诊断操作不可用/已禁用'); assert.equal(r.calls.navigations.length, 0);
});
await test('record transitions to another doctor while assert request waits: no navigation', async () => {
  const d = pending();
  const r = runtime({ onRequest: () => { d.record.lockUserName = 'synthetic-other-doctor'; } });
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.equal(d.__entryBlocked, '报告已锁定/占用'); assert.equal(r.calls.navigations.length, 0);
});
await test('record transitions to diagnosing while assert request waits: no navigation', async () => {
  const d = pending();
  const r = runtime({ onRequest: () => { d.record.reportStatusCode = '102502'; d.record.reportStatus = '诊断中'; } });
  assert.equal(await r.context.enterDiagnosis(d), false);
  assert.equal(d.__entryBlocked, '报告状态非待诊断'); assert.equal(r.calls.navigations.length, 0);
});
console.log(`passed ${passed} locked-entry hard gate cases`);
