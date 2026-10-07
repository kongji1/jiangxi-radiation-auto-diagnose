import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
const storageStart = source.indexOf('  const DEBUG_CLEANUP_INTERVAL_MS');
const storageEnd = source.indexOf('\n  function loadConfig()', storageStart);
const logStart = source.indexOf('  function pruneDeveloperEvents(');
const logEnd = source.indexOf('  function developerLogText()', logStart);
const unloadStart = source.indexOf("  window.addEventListener('beforeunload', () => {");
const unloadEnd = source.indexOf('\n  });', unloadStart) + '\n  });'.length;
const normalizeStart = source.indexOf('  function normalizeDeveloperRetentionMinutes(');
const normalizeEnd = source.indexOf('\n  function merge(', normalizeStart);
const setRetentionStart = source.indexOf('  function setDeveloperRetentionMinutes(');
const setRetentionEnd = source.indexOf('\n  // 页面偶尔', setRetentionStart);
assert.ok(storageStart >= 0 && storageEnd > storageStart && logStart >= 0 && logEnd > logStart && unloadStart >= 0 && unloadEnd > unloadStart);

const clone = value => JSON.parse(JSON.stringify(value));
function sharedStorage(initialEvents = []) {
  const values = new Map([['jx-radiation-auto-diagnose-debug-v1', clone(initialEvents)]]);
  const mirror = new Map();
  const localStorage = {
    get length() { return mirror.size; }, key: index => [...mirror.keys()][index] ?? null,
    getItem: key => mirror.get(key) ?? null, setItem: (key, value) => mirror.set(key, String(value)), removeItem: key => mirror.delete(key)
  };
  return { values, localStorage, listeners: [] };
}
function harness(initialEvents = [], enabled = true, shared = sharedStorage(initialEvents), staleCache = false, retentionMinutes = 60, initialNow = Date.parse('2026-10-07T00:00:00Z')) {
  let now = initialNow;
  let sequence = 0;
  const timers = new Map();
  const writes = [];
  const config = { developerMode: enabled, developerRetentionMinutes: retentionMinutes };
  const cached = new Map([...shared.values].map(([key, value]) => [key, clone(value)]));
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const timer = (fn, delay, interval = false) => {
    const id = ++sequence;
    timers.set(id, { fn, due: now + delay, interval: interval ? delay : 0 });
    return id;
  };
  const clear = id => timers.delete(id);
  const helpers = new Function(
    'config', 'GM_getValue', 'GM_setValue', 'GM_listValues', 'GM_deleteValue', 'GM_addValueChangeListener', 'localStorage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'console',
    `const STORAGE_KEY = 'jx-radiation-auto-diagnose-config-v1';
     const refreshDeveloperRetentionUI = () => {}, pruneCandidateLifecycle = () => {};
     ${source.slice(normalizeStart, normalizeEnd)}
     function saveConfig() { config.configurationSavedAt = Math.max(Date.now(), Number(config.configurationSavedAt || 0) + 1); const saved = JSON.stringify(config); localStorage.setItem(STORAGE_KEY + ':durable-v1', saved); GM_setValue(STORAGE_KEY, saved); }
     ${source.slice(storageStart, storageEnd)}
     ${source.slice(logStart, logEnd)}
     ${source.slice(setRetentionStart, setRetentionEnd)}
     let unload;
     const window = { addEventListener(_name, handler) { unload = handler; }, removeEventListener() {} };
     const document = { removeEventListener() {} };
     const stopRuntime = () => {};
     const onVisibilityChange = () => {}, watchRoute = () => {}, onRealtimeHint = () => {};
     const REALTIME_HINT_EVENT = 'test-only';
     const REPORT_ENTRY_EVENT = 'test-report-entry', onReportEntryObserved = () => {};
     let routeWatchTimer, loginRecoveryTimer, autoEntryScheduleTimer, timer, probeTimer, realtimeRefreshTimer, autoQueryFallbackTimer, pageQueryHeartbeatTimer;
     ${source.slice(unloadStart, unloadEnd)}
     return { developerLog, pruneDeveloperEvents, flushDeveloperEvents, persistDeveloperEvents, collectDeveloperEvents, clearDeveloperEvents, isCriticalDeveloperEvent, setDeveloperRetentionMinutes, developerRetentionMs, writerKey: debugJournalKey, events: debugEvents, unload: () => unload() };`
  )(
    config,
    (key, fallback) => { const values = staleCache ? cached : shared.values; return values.has(key) ? clone(values.get(key)) : fallback; },
    (key, value) => { const old = shared.values.get(key); shared.values.set(key, clone(value)); cached.set(key, clone(value)); writes.push({ at: now, key, value: clone(value), events: clone(Array.isArray(value) ? value : value.events || []) }); for (const listener of shared.listeners) if (listener.key === key) listener.fn(key, old, clone(value), true); },
    () => [...(staleCache ? cached : shared.values).keys()], key => { shared.values.delete(key); cached.delete(key); },
    (key, fn) => shared.listeners.push({ key, fn }), shared.localStorage,
    (fn, delay) => timer(fn, delay), clear,
    (fn, delay) => timer(fn, delay, true), clear,
    ClockDate, { info() {} }
  );
  return {
    ...helpers, writes, config, shared,
    advance(ms) {
      const target = now + ms;
      while (true) {
        const ready = [...timers.entries()].filter(([, value]) => value.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!ready) break;
        const [id, entry] = ready;
        now = entry.due;
        if (entry.interval) entry.due += entry.interval;
        else timers.delete(id);
        entry.fn();
      }
      now = target;
    }
  };
}

let passed = 0;
function scenario(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}

scenario('more than 240 accepted events survive the full default one-hour window', () => {
  const h = harness();
  for (let i = 0; i < 1000; i++) h.developerLog('候选观察', { tag: `synthetic-${i}`, record: { repUid: `synthetic-${i}`, extra: { complete: true } } });
  assert.equal(h.events.length, 1000);
  h.advance(3599000);
  assert.equal(h.events.length, 1000);
  assert.equal(h.writes.at(-1).events.length, 1000);
  assert.deepEqual(h.writes.at(-1).events[999].record, { repUid: 'synthetic-999', extra: { complete: true } });
});

scenario('loading does not truncate recent saved events', () => {
  const saved = Array.from({ length: 1200 }, (_, i) => ({ at: '2026-10-06T23:59:00Z', event: '候选观察', tag: `synthetic-${i}` }));
  const h = harness(saved);
  assert.equal(h.events.length, 1200);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].value.writerId.startsWith('legacy-'), true);
});

scenario('expired and malformed timestamps are removed, including on load', () => {
  const h = harness([
    { at: '2026-10-06T22:59:59Z', event: 'expired' },
    { at: 'invalid', event: 'invalid' },
    { at: '2026-10-06T23:00:00Z', event: 'boundary' },
    { at: '2026-10-07T00:00:00Z', event: 'fresh' }
  ]);
  assert.deepEqual(h.events.map(value => value.event), ['boundary', 'fresh']);
  assert.equal(h.writes.filter(write => write.key === 'jx-radiation-auto-diagnose-debug-v1').length, 1);
  h.advance(1);
  h.pruneDeveloperEvents();
  assert.deepEqual(h.events.map(value => value.event), ['fresh']);
});

scenario('noncritical bursts merge into one write after one second', () => {
  const h = harness();
  for (let i = 0; i < 800; i++) h.developerLog('候选观察', { tag: `synthetic-${i}` });
  assert.equal(h.writes.length, 0);
  h.advance(999);
  assert.equal(h.writes.length, 0);
  h.advance(1);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].events.length, 800);
});

scenario('continuous logging cannot postpone the first scheduled write', () => {
  const h = harness();
  for (let i = 0; i < 4; i++) { h.developerLog('候选观察', { tag: `synthetic-${i}` }); h.advance(250); }
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].events.length, 4);
});

scenario('entry, final outcome, route, version, error and forced events persist immediately', () => {
  for (const event of ['协议进入开始', '协议进入成功', '候选进入成功', '实时推送进入成功', '协议进入拒绝', '列表请求异常', '路由变化', '运行版本']) {
    const h = harness();
    h.developerLog('候选观察', { tag: 'pending' });
    h.developerLog(event, { tag: 'critical' });
    assert.equal(h.writes.length, 1, event);
    assert.equal(h.writes[0].events.length, 2, event);
    h.advance(1000);
    assert.equal(h.writes.length, 1, `${event}: pending write cancelled`);
  }
  const forced = harness();
  forced.developerLog('自检', {}, { force: true });
  assert.equal(forced.writes.length, 1);
});

scenario('actual beforeunload handler flushes pending events without relying on runtime log', () => {
  const h = harness();
  h.developerLog('候选观察', { tag: 'pending' });
  h.config.developerMode = false;
  h.unload();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].events.length, 1);
  h.advance(1000);
  assert.equal(h.writes.length, 1);
});

scenario('minute cleanup still removes and saves expired events after developer mode is disabled', () => {
  const h = harness();
  h.developerLog('候选观察', { tag: 'pending' });
  h.advance(1000);
  h.config.developerMode = false;
  h.advance(3660000);
  assert.equal(h.events.length, 0);
  assert.equal([...h.shared.values.keys()].filter(key => key.startsWith('jx-radiation-auto-diagnose-debug-journal-v3:')).length, 0);
  assert.equal(h.shared.localStorage.length, 0);
});

scenario('disabled mode still prunes old saved records without accepting new events', () => {
  const h = harness([{ at: '2026-10-06T22:59:59Z', event: 'expired' }], false);
  assert.equal(h.events.length, 0);
  assert.deepEqual(h.writes[0].events, []);
  h.developerLog('候选观察', { tag: 'ignored' });
  assert.equal(h.events.length, 0);
});

scenario('reload restores persisted events without needing a new candidate', () => {
  const shared = sharedStorage();
  const first = harness([], true, shared);
  first.developerLog('协议进入开始', { tag: 'synthetic-reload' });
  const second = harness([], true, shared);
  assert.deepEqual(second.events.map(event => event.tag), ['synthetic-reload']);
  assert.equal(second.events[0].eventId, first.events[0].eventId);
});

scenario('stale Tampermonkey document cache restores from the synchronous same-origin mirror', () => {
  const shared = sharedStorage();
  const first = harness([], true, shared, true);
  const cachedBeforeWrite = harness([], true, shared, true);
  first.developerLog('协议进入成功', { tag: 'synthetic-transport' });
  cachedBeforeWrite.collectDeveloperEvents();
  assert.equal(cachedBeforeWrite.events.some(event => event.tag === 'synthetic-transport'), true);
});

scenario('old writer late unload cannot erase a new document event', () => {
  const shared = sharedStorage();
  const old = harness([], true, shared, true);
  const fresh = harness([], true, shared, true);
  fresh.developerLog('运行版本', { tag: 'fresh-document' }, { force: true });
  old.developerLog('候选观察', { tag: 'late-old-document' });
  old.unload();
  const reloaded = harness([], true, shared);
  assert.deepEqual(new Set(reloaded.events.map(event => event.tag)), new Set(['fresh-document', 'late-old-document']));
});

scenario('two documents save only their own events and aggregate without duplication', () => {
  const shared = sharedStorage();
  const first = harness([], true, shared);
  const second = harness([], true, shared);
  first.developerLog('协议进入开始', { tag: 'first-document' });
  second.developerLog('协议进入拒绝', { tag: 'second-document' });
  first.developerLog('运行版本', { tag: 'first-document-again' }, { force: true });
  const journals = [...shared.values.values()].filter(value => value?.schema === 2);
  assert.deepEqual(journals.map(journal => journal.events.length).sort(), [1, 2]);
  const reloaded = harness([], true, shared);
  reloaded.collectDeveloperEvents();
  reloaded.collectDeveloperEvents();
  assert.equal(reloaded.events.length, 3);
  assert.equal(new Set(reloaded.events.map(event => event.eventId)).size, 3);
});

scenario('clear marker prevents another stale writer from resurrecting earlier events', () => {
  const shared = sharedStorage();
  const old = harness([], true, shared, true);
  old.developerLog('候选观察', { tag: 'before-clear' });
  const clearing = harness([], true, shared, true);
  clearing.clearDeveloperEvents();
  old.unload();
  old.developerLog('协议进入开始', { tag: 'after-clear' });
  const reloaded = harness([], true, shared);
  assert.deepEqual(reloaded.events.map(event => event.tag), ['after-clear']);
});

scenario('minute buckets allow safe expiry cleanup of closed writers', () => {
  const shared = sharedStorage();
  const old = harness([], true, shared);
  old.developerLog('协议进入开始', { tag: 'expires' });
  const cleanup = harness([], false, shared);
  cleanup.advance(3660000);
  assert.equal(cleanup.events.length, 0);
  assert.equal([...shared.values.keys()].filter(key => key.startsWith('jx-radiation-auto-diagnose-debug-journal-v3:')).length, 0);
});

scenario('mirror failure still preserves the independent GM journal', () => {
  const shared = sharedStorage();
  shared.localStorage.setItem = () => { throw new Error('quota unavailable'); };
  const first = harness([], true, shared);
  first.developerLog('协议进入开始', { tag: 'gm-only' });
  const reloaded = harness([], true, shared);
  assert.equal(reloaded.events[0].tag, 'gm-only');
});

scenario('remote reset callback works with another origin and stale GM getter cache', () => {
  const shared = sharedStorage();
  const old = harness([], true, shared, true);
  old.developerLog('候选观察', { tag: 'before-remote-clear' });
  const otherOrigin = sharedStorage(); otherOrigin.values = shared.values; otherOrigin.listeners = shared.listeners;
  const clearing = harness([], true, otherOrigin, true);
  clearing.clearDeveloperEvents();
  old.unload();
  old.developerLog('协议进入开始', { tag: 'after-remote-clear' });
  const reloaded = harness([], true, shared);
  assert.deepEqual(reloaded.events.map(event => event.tag), ['after-remote-clear']);
});

scenario('sealed legacy events survive a late old-version full-array overwrite and reload', () => {
  const shared = sharedStorage([{ at: '2026-10-06T23:59:00Z', event: 'legacy-A', tag: 'synthetic-A' }]);
  const first = harness([], true, shared);
  assert.deepEqual(first.events.map(event => event.event), ['legacy-A']);
  shared.values.set('jx-radiation-auto-diagnose-debug-v1', [{ at: '2026-10-06T23:59:10Z', event: 'legacy-B', tag: 'synthetic-B' }]);
  const reloaded = harness([], true, shared);
  assert.deepEqual(reloaded.events.map(event => event.event), ['legacy-A', 'legacy-B']);
  const snapshotKeys = [...shared.values.keys()].filter(key => key.startsWith('jx-radiation-auto-diagnose-debug-journal-v3:legacy-'));
  assert.equal(snapshotKeys.length, 2);
  reloaded.collectDeveloperEvents();
  const anotherReload = harness([], true, shared);
  assert.equal(anotherReload.events.length, 2);
  assert.equal([...shared.values.keys()].filter(key => key.startsWith('jx-radiation-auto-diagnose-debug-journal-v3:legacy-')).length, 2);
});

scenario('legacy sealing writes only unseen old-version records, never the v2 aggregate', () => {
  const shared = sharedStorage([{ at: '2026-10-06T23:59:00Z', event: 'legacy-A' }]);
  const first = harness([], true, shared);
  first.developerLog('协议进入开始', { tag: 'new-v2' });
  shared.values.set('jx-radiation-auto-diagnose-debug-v1', [
    { at: '2026-10-06T23:59:00Z', event: 'legacy-A' },
    { at: '2026-10-06T23:59:10Z', event: 'legacy-B' }
  ]);
  first.collectDeveloperEvents();
  const snapshots = [...shared.values.values()].filter(value => value?.writerId?.startsWith('legacy-'));
  assert.deepEqual(snapshots.map(value => value.events.map(event => event.event)).flat().sort(), ['legacy-A', 'legacy-B']);
  assert.equal(snapshots.some(value => value.events.some(event => event.tag === 'new-v2')), false);
});

scenario('default window preserves a 45-minute event and removes a 61-minute event', () => {
  const h = harness([
    { at: '2026-10-06T23:15:00Z', event: '45-minutes' },
    { at: '2026-10-06T22:59:00Z', event: '61-minutes' }
  ]);
  assert.equal(h.developerRetentionMs(), 3600000);
  assert.deepEqual(h.events.map(event => event.event), ['45-minutes']);
});

scenario('custom shorter retention immediately prunes and longer retention keeps future observations', () => {
  const h = harness([{ at: '2026-10-06T23:40:00Z', event: '20-minutes' }]);
  h.setDeveloperRetentionMinutes(10);
  assert.equal(h.events.some(event => event.event === '20-minutes'), false);
  h.setDeveloperRetentionMinutes(120);
  h.developerLog('候选观察', { tag: 'longer-window' });
  h.advance(90 * 60000);
  assert.equal(h.events.some(event => event.tag === 'longer-window'), true);
  h.advance(31 * 60000);
  assert.equal(h.events.some(event => event.tag === 'longer-window'), false);
});

scenario('custom retention survives writer reload while retaining the same event identity', () => {
  const shared = sharedStorage();
  const first = harness([], true, shared, false, 120);
  first.developerLog('协议进入开始', { tag: 'custom-reload' });
  first.advance(90 * 60000);
  const second = harness([], true, shared, false, 120, Date.parse('2026-10-07T01:30:00Z'));
  assert.equal(second.events[0].eventId, first.events[0].eventId);
});

scenario('another document adopts a longer window before its shorter cleanup can delete records', () => {
  const shared = sharedStorage();
  const shorter = harness([], false, shared, true, 10);
  const changing = harness([], true, shared, false, 10);
  changing.setDeveloperRetentionMinutes(60);
  assert.equal(shorter.config.developerRetentionMinutes, 60);
  changing.developerLog('协议进入开始', { tag: '45-minute-shared' });
  shorter.advance(45 * 60000);
  assert.equal(shorter.events.some(event => event.tag === '45-minute-shared'), true);
});

scenario('shorter window synchronizes both documents and immediately removes expired records', () => {
  const shared = sharedStorage([{ at: '2026-10-06T23:15:00Z', event: '45-minutes' }]);
  const old = harness([], false, shared, true, 60);
  const changing = harness([], true, shared, false, 60);
  assert.equal(old.events.length, 1);
  changing.setDeveloperRetentionMinutes(10);
  assert.equal(old.config.developerRetentionMinutes, 10);
  assert.equal(old.events.length, 0);
  assert.equal(changing.events.some(event => event.event === '45-minutes'), false);
});

scenario('minute cleanup adopts latest same-origin retention when GM callback is delayed', () => {
  const shared = sharedStorage();
  const old = harness([], false, shared, true, 10);
  shared.localStorage.setItem('jx-radiation-auto-diagnose-config-v1:durable-v1', JSON.stringify({ developerRetentionMinutes: 60, configurationSavedAt: 1 }));
  old.advance(60000);
  assert.equal(old.config.developerRetentionMinutes, 60);
});

scenario('v2 journals are sealed into protected v3 before old-document expiry deletes v2', () => {
  const event = { at: '2026-10-06T23:55:00Z', event: 'v2-kept', eventId: 'synthetic-v2:1' };
  const shared = sharedStorage();
  const v2Key = 'jx-radiation-auto-diagnose-debug-journal-v2:synthetic-v2:1791330900000';
  const journal = { schema: 2, writerId: 'synthetic-v2', events: [event] };
  shared.values.set(v2Key, journal); shared.localStorage.setItem(v2Key, JSON.stringify(journal));
  const modern = harness([], true, shared);
  assert.equal(modern.events[0].eventId, event.eventId);
  assert.ok([...shared.values.keys()].some(key => key.startsWith('jx-radiation-auto-diagnose-debug-journal-v3:')));
  shared.values.delete(v2Key); shared.localStorage.removeItem(v2Key);
  const reloaded = harness([], true, shared);
  assert.deepEqual(reloaded.events.map(value => value.eventId), [event.eventId]);
});

scenario('own-event persistence does not rescan all historic journal keys on every forced event', () => {
  const shared = sharedStorage();
  const h = harness([], true, shared);
  let scans = 0;
  const previous = shared.localStorage.key;
  shared.localStorage.key = index => { scans++; return previous(index); };
  for (let i = 0; i < 20; i++) h.developerLog('运行版本', { tag: `write-${i}` }, { force: true });
  assert.equal(scans, 0);
  assert.equal(h.events.length, 20);
});

scenario('expired v2 journals are physically deleted using the configured window', () => {
  const shared = sharedStorage();
  const key = 'jx-radiation-auto-diagnose-debug-journal-v2:synthetic-old:1791327540000';
  const journal = { schema: 2, writerId: 'synthetic-old', events: [{ at: '2026-10-06T22:59:00Z', event: 'expired-v2', eventId: 'synthetic-old:1' }] };
  shared.values.set(key, journal); shared.localStorage.setItem(key, JSON.stringify(journal));
  const h = harness([], false, shared);
  assert.equal(h.events.length, 0);
  assert.equal(shared.values.has(key), false);
  assert.equal(shared.localStorage.getItem(key), null);
});

scenario('legacy config save without the retention field does not reset a selected custom window', () => {
  const shared = sharedStorage();
  const modern = harness([], true, shared, true, 120);
  shared.localStorage.setItem('jx-radiation-auto-diagnose-config-v1:durable-v1', JSON.stringify({ developerMode: true, configurationSavedAt: 1 }));
  for (const listener of shared.listeners) if (listener.key === 'jx-radiation-auto-diagnose-config-v1') listener.fn(listener.key, null, JSON.stringify({ developerMode: true, configurationSavedAt: 1 }), true);
  modern.advance(60000);
  assert.equal(modern.config.developerRetentionMinutes, 120);
});

console.log(`developer-retention: ${passed} scenarios passed`);
