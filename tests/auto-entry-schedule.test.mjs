import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
function block(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `missing source block: ${startText}`);
  return source.slice(start, end);
}
const helpers = block('  const AUTO_ENTRY_TIME_SLOTS', '  // 所有业务规则');
const gates = block('  function isAutoOpenEnabled()', '  // Vue 表格行');
const entry = block('  async function protocolEnter(d)', '  const REPORT_STATUS_CODES');
const migrations = block('  function normalizeDeveloperRetentionMinutes(raw)', '  function saveConfig()');
const profileHelper = block('  function configWithCurrentEntrySchedule(saved)', '  function entryDelayPlan()');
const at = (day, time) => new Date(`${day}T${time}`).getTime();
const candidate = () => ({ record: { repUid: 'schedule-test', statusCode: '102501' }, row: {}, statusCode: '102501' });

function runtime(day = '2026-10-07', time = '09:00:00', overrides = {}) {
  let clock = at(day, time);
  const timers = new Map();
  let timerId = 0;
  const calls = { saves: 0, requests: 0, clicks: 0, events: [], navigations: [] };
  const config = { enabled: true, autoEntrySchedule: { slot: '', date: '', requiresSelection: false }, entryMode: 'protocol-only', selectors: { operatorItems: '' } };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const location = {};
  Object.defineProperty(location, 'href', { set: value => calls.navigations.push(value) });
  const context = vm.createContext({
    config, Date: ClockDate, URLSearchParams, structuredClone,
    DEFAULT_CONFIG: structuredClone(config), console: { info() {}, warn() {} },
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, when: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, autoEntryScheduleTimer: null,
    saveConfig: () => calls.saves++, developerLog: (event, detail) => calls.events.push({ event, detail }),
    debugCandidate: data => ({ key: data?.record?.repUid }), debugError: error => String(error),
    entryRunning: false, diagnosisActive: false, entryDiagnosisLockActive: () => false,
    isExcludedExam: () => false, automaticEntryBlockReason: () => '',
    reserveAutomaticEntry: data => { data.__automaticEntryKey = `rep:${data.record?.repUid}`; data.__automaticEntryToken = 'synthetic-token'; return true; },
    consumeAutomaticEntry: () => true, releaseAutomaticEntry: () => true, readAutomaticEntry: () => null,
    finalEntryPending: {}, persistFinalEntryPending: () => {},
    isMonitorRoute: () => true, shouldSkipLocked: () => false, isPendingReport: () => true,
    rowData: data => data, recordData: data => data, findRowRecord: () => null,
    findRowRecordByApi: async () => null, observeCandidateLifecycle: () => ({}), lifecycleDebug: () => ({}),
    ensureSessionIdentity: async () => {}, waitBeforeEntry: async () => {},
    beginFinalEntryPending: () => {}, finishFinalEntryPending: () => false,
    navigateToDiagnosisReport: async url => { location.href = url; return true; },
    fetchJson: async () => { calls.requests++; return { response: { ok: true, status: 200 }, payload: { code: 200, data: true } }; },
    norm: value => String(value || '').trim(), pageWindow: () => ({ location }),
    diagnoseOperator: () => ({ click: () => calls.clicks++ }),
    ...overrides
  });
  vm.runInContext(`${helpers}\n${gates}\n${entry}\n${migrations}\n${profileHelper}`, context);
  return {
    context, config, calls, timers,
    setClock: (nextDay, nextTime) => { clock = at(nextDay, nextTime); },
    tick(nextDay, nextTime) {
      clock = at(nextDay, nextTime);
      for (const [id, timer] of [...timers]) if (timer.when <= clock) { timers.delete(id); timer.callback(); }
    }
  };
}

let tested = 0;
function test(name, run) {
  const result = run();
  if (result instanceof Promise) return result.then(() => { tested++; });
  tested++;
}

test('legacy unlimited and disabled switch', () => {
  const r = runtime();
  assert.equal(r.context.isAutoOpenEnabled(), true);
  r.config.enabled = false;
  assert.equal(r.context.isAutoOpenEnabled(), false);
});
for (const [slot, start, end] of [
  ['morning', '08:00:00', '12:00:00'], ['noon', '12:00:00', '14:30:00'],
  ['afternoon', '14:30:00', '17:30:00'], ['night', '17:30:00', '08:00:00']
]) {
  test(`${slot} half-open boundary and once-only expiry`, () => {
    const r = runtime('2026-10-07', '07:59:59');
    r.config.autoEntrySchedule = { slot, date: '2026-10-07', requiresSelection: true };
    assert.equal(r.context.isAutoOpenEnabled(), false);
    r.setClock('2026-10-07', start);
    assert.equal(r.context.isAutoOpenEnabled(), true);
    const lastDate = slot === 'night' ? '2026-10-08' : '2026-10-07';
    r.setClock(lastDate, end);
    assert.equal(r.context.isAutoOpenEnabled(), false);
    assert.equal(r.config.enabled, false);
    assert.equal(r.config.autoEntrySchedule.slot, '');
    assert.equal(r.config.autoEntrySchedule.date, '');
    assert.equal(r.config.autoEntrySchedule.requiresSelection, true);
    const saved = r.calls.saves;
    r.config.enabled = true;
    assert.equal(r.context.isAutoOpenEnabled(), false, 'expired selection must not become unlimited');
    assert.equal(r.calls.saves, saved, 'expiry writes once');
    r.setClock('2026-10-09', start);
    assert.equal(r.context.isAutoOpenEnabled(), false, 'never repeats on another day');
  });
}
test('night crosses month and year, ends at 08:00', () => {
  for (const [date, next] of [['2026-10-31', '2026-11-01'], ['2026-12-31', '2027-01-01']]) {
    const r = runtime(date, '18:00:00');
    assert.equal(r.context.setAutoEntrySchedule('night'), true);
    r.setClock(next, '07:59:59');
    assert.equal(r.context.isAutoOpenEnabled(), true);
    r.setClock(next, '08:00:00');
    assert.equal(r.context.isAutoOpenEnabled(), false);
  }
});
test('night selected before dawn expires same morning', () => {
  const r = runtime('2026-10-08', '02:00:00');
  assert.equal(r.context.setAutoEntrySchedule('night'), true);
  assert.equal(r.config.autoEntrySchedule.date, '2026-10-07');
  r.setClock('2026-10-08', '08:00:00');
  assert.equal(r.context.isAutoOpenEnabled(), false);
});
test('invalid or already-ended daytime choice does not overwrite a valid choice', () => {
  const r = runtime('2026-10-07', '15:00:00');
  assert.equal(r.context.setAutoEntrySchedule('afternoon'), true);
  const before = JSON.stringify(r.config.autoEntrySchedule);
  assert.equal(r.context.setAutoEntrySchedule('morning'), false);
  assert.equal(r.context.setAutoEntrySchedule('invalid'), false);
  assert.equal(JSON.stringify(r.config.autoEntrySchedule), before);
});
test('expiry timer disables without a new candidate', () => {
  const r = runtime('2026-10-07', '11:59:59');
  r.context.setAutoEntrySchedule('morning');
  r.context.scheduleAutoEntryScheduleExpiry();
  assert(r.timers.size > 0);
  r.tick('2026-10-07', '12:00:01');
  assert.equal(r.config.enabled, false);
  assert.equal(r.config.autoEntrySchedule.requiresSelection, true);
});
test('saved profiles and imported config cannot renew an expired permit', () => {
  const r = runtime('2026-10-08', '09:00:00');
  r.config.autoEntrySchedule = { slot: 'night', date: '2026-10-07', requiresSelection: false };
  const loaded = r.context.configWithCurrentEntrySchedule({ enabled: true, autoEntrySchedule: { slot: 'night', date: '2026-10-08' } });
  assert.equal(loaded.enabled, false);
  assert.equal(loaded.autoEntrySchedule.requiresSelection, true);
  assert.equal(loaded.autoEntrySchedule.slot, '');
  r.config.autoEntrySchedule = loaded.autoEntrySchedule;
  const oldProfile = r.context.configWithCurrentEntrySchedule({ enabled: true });
  assert.equal(oldProfile.enabled, false);
  assert.equal(oldProfile.autoEntrySchedule.requiresSelection, true);
});
test('filter profile changes keep the current absolute date and time slot', () => {
  const r = runtime('2026-10-07', '10:00:00');
  r.context.setAutoEntrySchedule('morning');
  const loaded = r.context.configWithCurrentEntrySchedule({ enabled: true, autoEntrySchedule: { slot: 'night', date: '2026-10-08' }, modalities: ['CT'] });
  assert.equal(loaded.autoEntrySchedule.slot, 'morning');
  assert.equal(loaded.autoEntrySchedule.date, '2026-10-07');
  assert.deepEqual(Array.from(loaded.modalities), ['CT']);
});
test('selection click immediately enables and persists without reading other form fields', () => {
  const r = runtime('2026-10-07', '10:00:00');
  r.config.enabled = false;
  let clickHandler;
  r.context.box = { querySelectorAll: () => [{ value: 'morning', addEventListener: (event, handler) => { assert.equal(event, 'click'); clickHandler = handler; } }] };
  r.context.msg = () => {};
  r.context.read = () => assert.fail('time selection must not depend on Apply or read unrelated unsaved fields');
  vm.runInContext(block("    box.querySelectorAll('input[data-f=\"autoEntryTimeSlot\"]').forEach(input => input.addEventListener", "    box.querySelector('[data-a=\"clearAutoEntryTimeSlot\"]')"), r.context);
  assert.equal(typeof clickHandler, 'function');
  clickHandler();
  assert.equal(r.config.enabled, true);
  assert.equal(r.config.autoEntrySchedule.slot, 'morning');
  assert.equal(r.calls.saves, 1);
  assert(r.timers.size > 0);
  assert(!block('    function read()', '    const msg =').includes('setAutoEntrySchedule'), 'unrelated form save must not re-anchor the permit date');
});
await test('delay crossing deadline makes neither protocol request nor click', async () => {
  const r = runtime('2026-10-07', '11:59:59');
  r.context.setAutoEntrySchedule('morning');
  r.context.waitBeforeEntry = async () => r.setClock('2026-10-07', '12:00:00');
  r.config.entryMode = 'protocol-first';
  assert.equal(await r.context.enterDiagnosis(candidate()), false);
  assert.equal(r.calls.requests, 0);
  assert.equal(r.calls.clicks, 0);
  assert.equal(r.context.entryRunning, false);
});
await test('record lookup crossing deadline prevents assertAllowEnter', async () => {
  const r = runtime('2026-10-07', '11:59:59');
  r.context.setAutoEntrySchedule('morning');
  r.context.findRowRecordByApi = async () => { r.setClock('2026-10-07', '12:00:00'); return candidate().record; };
  assert.equal(await r.context.protocolEnter({ row: {}, statusCode: '102501' }), false);
  assert.equal(r.calls.requests, 0);
});
await test('identity lookup crossing deadline prevents assertAllowEnter', async () => {
  const r = runtime('2026-10-07', '11:59:59');
  r.context.setAutoEntrySchedule('morning');
  r.context.ensureSessionIdentity = async () => r.setClock('2026-10-07', '12:00:00');
  assert.equal(await r.context.protocolEnter(candidate()), false);
  assert.equal(r.calls.requests, 0);
});
await test('server allow after deadline never navigates or page-clicks', async () => {
  const r = runtime('2026-10-07', '11:59:59');
  r.context.setAutoEntrySchedule('morning');
  r.context.fetchJson = async () => {
    r.calls.requests++;
    r.setClock('2026-10-07', '12:00:00');
    return { response: { ok: true, status: 200 }, payload: { code: 200, data: true } };
  };
  r.config.entryMode = 'protocol-first';
  assert.equal(await r.context.enterDiagnosis(candidate()), false);
  assert.equal(r.calls.requests, 1);
  assert.equal(r.calls.navigations.length, 0);
  assert.equal(r.calls.clicks, 0);
  assert.equal(r.context.diagnosisActive, false);
});
await test('valid in-window protocol path still succeeds', async () => {
  const r = runtime();
  r.context.setAutoEntrySchedule('morning');
  assert.equal(await r.context.enterDiagnosis(candidate()), true);
  assert.equal(r.calls.requests, 1);
  assert.equal(r.calls.navigations.length, 1);
  assert.equal(r.context.diagnosisActive, true);
  assert.equal(r.context.entryRunning, false);
});
test('exactly four single-choice radios', () => {
  const radios = [...source.matchAll(/<input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(radios, ['morning', 'noon', 'afternoon', 'night']);
});
console.log(`auto-entry-schedule: ${tested} behavior cases passed`);
