import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
function block(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `missing real source block: ${startText}`);
  return source.slice(start, end);
}
const declarations = block('  let listRefreshRunning = false;', '  // 页面 Axios');
const refresh = block('  async function refreshRemoteCandidates(options', '  async function probeStatus()');
const queue = block('  function clearRealtimeRefreshQueue()', '  async function processRealtimeHint(');

function runtime() {
  let now = 1_000_000, timerId = 0, active = 0, maxActive = 0;
  const timers = new Map(), callbacks = new Map(), requests = [], logs = [], unexpected = [];
  const gates = { monitor: true, route: true, account: true };
  const config = { entryMode: 'protocol-only', realtimeHints: true, listHeartbeatMs: 15000 };
  const context = vm.createContext({
    config,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) {
      const id = ++timerId;
      const callback = () => {
        const result = fn();
        if (result?.catch) result.catch(error => unexpected.push(error));
      };
      callbacks.set(id, callback);
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    isMonitoringEnabled: () => gates.monitor,
    isMonitorRoute: () => gates.route,
    accountAllowed: () => gates.account,
    diagnosisActive: false, entryRunning: false,
    debugTag: match => match?.tag || '', debugError: error => String(error),
    developerLog: (event, data) => logs.push({ at: now, event, data }),
    fetchRadiationRecords(options) {
      active++;
      maxActive = Math.max(maxActive, active);
      let resolve, reject;
      const result = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = {
        at: now, options, completed: false,
        resolve(records = []) { request.completed = true; active--; resolve(records); },
        reject(error = new Error('delayed test failure')) { request.completed = true; active--; reject(error); }
      };
      requests.push(request);
      return result;
    },
    processRemoteRecords: async () => true
  });
  vm.runInContext(`${declarations}\n${refresh}\n${queue}\n
    globalThis.testApi = {
      refreshRemoteCandidates, queueRealtimeRefresh, scheduleQueuedRealtimeRefresh,
      state: () => ({ listRefreshRunning, queuedRealtimeMatch, queuedRealtimeHintAt, queuedRealtimeReadyAt, realtimeRefreshTimer }),
      lastFetchAt: value => { lastListFetchAt = value; }
    };
  `, context);
  const drain = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  async function advance(ms) {
    await drain();
    const target = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await drain();
    }
    now = target;
    await drain();
    assert.equal(unexpected.length, 0, 'timer rejection must be handled');
  }
  return {
    api: context.testApi, context, gates, config, requests, logs, timers, callbacks,
    drain, advance, now: () => now, maxActive: () => maxActive,
    async finish(index = requests.length - 1) { requests[index].resolve(); await drain(); }
  };
}

let count = 0;
async function test(name, run) {
  await run();
  count++;
  console.log(`ok ${count} - ${name}`);
}

await test('idle first hint dispatches immediately', async () => {
  const r = runtime(), hintAt = r.now(), match = { tag: 'idle-first' };
  r.api.queueRealtimeRefresh({ match, hintAt });
  await r.advance(0);
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].at, hintAt);
  assert.equal(r.requests[0].options.match, match);
  assert.equal(r.requests[0].options.hintAt, hintAt);
  await r.finish();
  await r.advance(60000);
  assert.equal(r.requests.length, 1, 'no hint means no further polling');
});

await test('frequent hints preserve the 250ms merge boundary and first pending hint time', async () => {
  const r = runtime(), firstAt = r.now();
  r.api.queueRealtimeRefresh({ hintAt: firstAt });
  await r.advance(0);
  await r.finish();
  await r.advance(100);
  const hintAt = r.now();
  const first = { tag: 'first-exact' }, last = { tag: 'last-exact' };
  r.api.queueRealtimeRefresh({ match: first, hintAt });
  assert.equal(r.api.state().queuedRealtimeReadyAt, firstAt + 250);
  await r.advance(100);
  r.api.queueRealtimeRefresh({ match: last, hintAt: r.now() });
  assert.equal(r.api.state().queuedRealtimeReadyAt, firstAt + 250);
  await r.advance(299);
  assert.equal(r.requests.length, 1);
  assert.equal(r.timers.size, 1);
  await r.advance(1);
  assert.equal(r.requests.length, 2);
  assert.equal(r.requests[1].at, firstAt + 500);
  assert.equal(r.requests[1].options.match, last);
  assert.equal(r.requests[1].options.hintAt, hintAt);
  await r.finish();
  await r.advance(60000);
  assert.equal(r.requests.length, 2, 'no hint means no further polling');
});

await test('ordinary busy list completion wakes the precise pending hint immediately', async () => {
  const r = runtime();
  const ordinary = r.api.refreshRemoteCandidates({ reason: 'heartbeat' });
  await r.advance(100);
  const hintAt = r.now(), match = { tag: 'during-normal-list' };
  r.api.queueRealtimeRefresh({ match, hintAt });
  assert.equal(r.timers.size, 0, 'busy waiting must not create retry timers');
  await r.advance(1300);
  assert.equal(r.requests.length, 1);
  await r.finish(0);
  await ordinary;
  assert.equal(r.timers.size, 1);
  await r.advance(0);
  assert.equal(r.requests.length, 2);
  assert.equal(r.requests[1].at, r.now(), 'no arbitrary 500ms wait after completion');
  assert.equal(r.requests[1].options.match, match);
  assert.equal(r.requests[1].options.hintAt, hintAt);
  assert.equal(r.maxActive(), 1);
  await r.finish(1);
});

await test('quick busy completion keeps the 500ms request cooldown', async () => {
  const r = runtime(), startedAt = r.now();
  const ordinary = r.api.refreshRemoteCandidates({ reason: 'heartbeat' });
  await r.advance(100);
  r.api.queueRealtimeRefresh({ match: { tag: 'quick-list' }, hintAt: r.now() });
  await r.advance(100);
  await r.finish(0);
  await ordinary;
  await r.advance(299);
  assert.equal(r.requests.length, 1);
  await r.advance(1);
  assert.equal(r.requests[1].at, startedAt + 500);
  assert.equal(r.maxActive(), 1);
  await r.finish(1);
});

await test('generic hint without a record survives a busy list', async () => {
  const r = runtime();
  const ordinary = r.api.refreshRemoteCandidates({ reason: 'heartbeat' });
  await r.advance(700);
  const hintAt = r.now();
  r.api.queueRealtimeRefresh({ hintAt });
  await r.advance(300);
  await r.finish(0);
  await ordinary;
  await r.advance(0);
  assert.equal(r.requests.length, 2);
  assert.equal(r.requests[1].options.match, null);
  assert.equal(r.requests[1].options.hintAt, hintAt);
  assert.equal(r.requests[1].options.pageSize, 30);
  await r.finish(1);
});

await test('hint queued directly by the busy request guard keeps its original timestamp', async () => {
  const r = runtime();
  const ordinary = r.api.refreshRemoteCandidates({ reason: 'heartbeat' });
  await r.advance(100);
  const hintAt = r.now(), match = { tag: 'guard-requeue' };
  assert.equal(await r.api.refreshRemoteCandidates({ force: true, reason: 'websocket-hint', match, hintAt }), false);
  await r.advance(700);
  await r.finish(0);
  await ordinary;
  await r.advance(0);
  assert.equal(r.requests[1].options.match, match);
  assert.equal(r.requests[1].options.hintAt, hintAt);
  await r.finish(1);
});

await test('a generic later hint cannot erase an exact queued match', async () => {
  const r = runtime(), match = { tag: 'precise' }, hintAt = r.now();
  r.api.lastFetchAt(hintAt);
  r.api.queueRealtimeRefresh({ match, hintAt });
  await r.advance(100);
  r.api.queueRealtimeRefresh({ hintAt: r.now() });
  await r.advance(400);
  assert.equal(r.requests[0].options.match, match);
  assert.equal(r.requests[0].options.hintAt, hintAt);
  await r.finish();
});

await test('hint arriving during realtime fetch gets one following request and its own timestamp', async () => {
  const r = runtime();
  r.api.queueRealtimeRefresh({ match: { tag: 'first' }, hintAt: r.now() });
  await r.advance(250);
  await r.advance(100);
  const hintAt = r.now(), match = { tag: 'second' };
  r.api.queueRealtimeRefresh({ match, hintAt });
  await r.advance(700);
  assert.equal(r.requests.length, 1);
  assert.equal(r.timers.size, 0);
  await r.finish(0);
  await r.advance(0);
  assert.equal(r.requests.length, 2);
  assert.equal(r.requests[1].options.match, match);
  assert.equal(r.requests[1].options.hintAt, hintAt);
  assert.equal(r.maxActive(), 1);
  await r.finish(1);
});

await test('delayed realtime failure is caught once with no automatic retry flood', async () => {
  const r = runtime();
  r.api.queueRealtimeRefresh({ match: { tag: 'failed' }, hintAt: r.now() });
  await r.advance(250);
  await r.advance(1500);
  r.requests[0].reject();
  await r.drain();
  assert.equal(r.api.state().listRefreshRunning, false);
  assert.equal(r.timers.size, 0);
  await r.advance(60000);
  assert.equal(r.requests.length, 1);
  assert.equal(r.logs.filter(log => log.event === '实时列表刷新异常').length, 1);
});

await test('delayed failure still wakes a newer hint and does not replay the failed match', async () => {
  const r = runtime();
  r.api.queueRealtimeRefresh({ match: { tag: 'failed-first' }, hintAt: r.now() });
  await r.advance(250);
  await r.advance(100);
  const hintAt = r.now(), match = { tag: 'newer-during-failure' };
  r.api.queueRealtimeRefresh({ match, hintAt });
  await r.advance(1500);
  r.requests[0].reject();
  await r.drain();
  await r.advance(0);
  assert.equal(r.requests.length, 2);
  assert.equal(r.requests[1].options.match, match);
  assert.equal(r.requests[1].options.hintAt, hintAt);
  assert.equal(r.maxActive(), 1);
  await r.finish(1);
  await r.advance(60000);
  assert.equal(r.requests.length, 2);
});

await test('a stale replaced timer callback cannot dispatch or clear the current timer', async () => {
  const r = runtime();
  r.api.lastFetchAt(r.now());
  r.api.queueRealtimeRefresh({ match: { tag: 'first' }, hintAt: r.now() });
  const staleTimer = r.api.state().realtimeRefreshTimer;
  await r.advance(100);
  r.api.queueRealtimeRefresh({ hintAt: r.now() });
  const currentTimer = r.api.state().realtimeRefreshTimer;
  assert.notEqual(currentTimer, staleTimer);
  r.callbacks.get(staleTimer)();
  await r.drain();
  assert.equal(r.api.state().realtimeRefreshTimer, currentTimer);
  assert.equal(r.requests.length, 0);
  await r.advance(400);
  assert.equal(r.requests.length, 1);
  await r.finish();
});

await test('ordinary request starting after a timer was queued prevents overlap and wakes on completion', async () => {
  const r = runtime();
  r.api.queueRealtimeRefresh({ match: { tag: 'pending' }, hintAt: r.now() });
  const ordinary = r.api.refreshRemoteCandidates({ reason: 'status-change' });
  await r.advance(250);
  assert.equal(r.requests.length, 1);
  assert.equal(r.timers.size, 0);
  await r.advance(700);
  await r.finish(0);
  await ordinary;
  await r.advance(0);
  assert.equal(r.requests.length, 2);
  assert.equal(r.maxActive(), 1);
  await r.finish(1);
});

await test('account denial before the timer fires drops work without spinning', async () => {
  const r = runtime();
  r.api.queueRealtimeRefresh({ match: { tag: 'account-denied' }, hintAt: r.now() });
  r.gates.account = false;
  await r.advance(60000);
  assert.equal(r.requests.length, 0);
  assert.equal(r.timers.size, 0);
  assert.equal(r.api.state().queuedRealtimeHintAt, 0);
  r.gates.account = true;
  r.api.queueRealtimeRefresh({ match: { tag: 'allowed-new' }, hintAt: r.now() });
  await r.advance(250);
  assert.equal(r.requests.length, 1);
  await r.finish();
});

await test('account denial when a busy request finishes creates no retry timer', async () => {
  const r = runtime();
  const ordinary = r.api.refreshRemoteCandidates({ reason: 'heartbeat' });
  r.api.queueRealtimeRefresh({ match: { tag: 'denied-on-finish' }, hintAt: r.now() });
  await r.advance(1000);
  r.gates.account = false;
  await r.finish(0);
  await ordinary;
  await r.advance(60000);
  assert.equal(r.requests.length, 1);
  assert.equal(r.timers.size, 0);
  assert.equal(r.api.state().queuedRealtimeHintAt, 0);
});

await test('monitor, route, click mode and realtime gates cancel pending work', async () => {
  for (const gate of ['monitor', 'route', 'click', 'hints']) {
    const r = runtime();
    r.api.queueRealtimeRefresh({ hintAt: r.now() });
    if (gate === 'click') r.config.entryMode = 'click';
    else if (gate === 'hints') r.config.realtimeHints = false;
    else r.gates[gate] = false;
    await r.advance(60000);
    assert.equal(r.requests.length, 0, gate);
    assert.equal(r.timers.size, 0, gate);
    assert.equal(r.api.state().queuedRealtimeHintAt, 0, gate);
  }
});

await test('missing or invalid hint time still marks generic work and preserves a finite timestamp', async () => {
  for (const hintAt of [undefined, 0, -1, Infinity, 'invalid']) {
    const r = runtime(), at = r.now();
    r.api.queueRealtimeRefresh({ hintAt });
    await r.advance(250);
    assert.equal(r.requests.length, 1);
    assert.equal(r.requests[0].options.hintAt, at);
    await r.finish();
  }
});

await test('normal heartbeat retains its long cooldown while realtime keeps its 500ms minimum', async () => {
  const r = runtime(), firstAt = r.now();
  const first = r.api.refreshRemoteCandidates({ reason: 'heartbeat' });
  await r.finish(0);
  await first;
  await r.advance(1000);
  assert.equal(await r.api.refreshRemoteCandidates({ reason: 'heartbeat' }), false);
  assert.equal(r.requests.length, 1);
  assert.equal(r.timers.size, 0, 'ordinary cooldown must not introduce realtime work');
  r.api.queueRealtimeRefresh({ hintAt: r.now() });
  await r.advance(250);
  assert.equal(r.requests.length, 2);
  assert(r.requests[1].at - firstAt >= 500);
  await r.finish(1);
});

console.log(`realtime-queue: ${count} behavior cases passed`);
