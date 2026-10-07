import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve(import.meta.dirname, '../jiangxi-radiation-auto-diagnose.user.js'), 'utf8');
const start = source.indexOf('  async function ensureClientIp()');
const end = source.indexOf('  function directLoginConfig()', start);
assert(start >= 0 && end > start, 'real request preparation functions must exist');

function runtime({ rtcMode = 'pending', responseDelayMs = 0 } = {}) {
  let now = 1_000_000, timerId = 0;
  const timers = new Map(), peers = [], calls = [], logs = [];
  class Peer {
    constructor() {
      if (rtcMode === 'constructor-failure') throw new Error('RTC unavailable');
      peers.push(this);
      this.iceGatheringState = 'gathering';
      this.closed = false;
    }
    createDataChannel() {}
    createOffer() { return rtcMode === 'offer-failure' ? Promise.reject(new Error('offer failed')) : Promise.resolve({}); }
    setLocalDescription() { return Promise.resolve(); }
    close() { this.closed = true; }
  }
  const page = {
    location: { pathname: '/radiation' },
    fetch(url, options) {
      calls.push({ at: now, url, options });
      const response = { ok: true, status: 200, json: async () => ({ code: 200, data: { uid: 'test-user', logincode: 'test-account' } }) };
      return responseDelayMs ? new Promise(resolve => context.setTimeout(() => resolve(response), responseDelayMs)) : Promise.resolve(response);
    }
  };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    RTCPeerConnection: Peer,
    AbortController,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    pageWindow: () => page,
    norm: value => String(value ?? '').trim(),
    sessionHeaders: input => ({ ...input }),
    debugAuthContext: () => ({ sessionIdentityLoaded: true }),
    developerLog: (event, data) => logs.push({ event, data })
  });
  vm.runInContext(`
    let clientIp = '', clientIpRequest = null, clientIpRetryAfter = 0, clientIpRefreshInBackground = false;
    let sessionIdentity = { info: null, uid: '', loading: false, lastAttemptAt: 0, loadedAt: 0 };
    let sessionIdentityRequest = null, tokenRecoveryLastAt = 0, tokenFailureLoggedAt = 0;
    ${source.slice(start, end)}
    globalThis.testApi = { ensureClientIp, ensureSessionIdentity, fetchJson };
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
      next[1].fn();
      await drain();
    }
    now = target;
    await drain();
  }
  return { api: context.testApi, context, peers, calls, logs, timers, drain, advance, now: () => now };
}

let count = 0;
async function test(name, fn) {
  await fn();
  count++;
  console.log(`ok ${count} - ${name}`);
}

await test('initial concurrent requests wait for one shared RTC attempt', async () => {
  const r = runtime();
  let firstDone = false, secondDone = false;
  const first = r.api.ensureClientIp().then(() => { firstDone = true; });
  const second = r.api.ensureClientIp().then(() => { secondDone = true; });
  await r.drain();
  assert.equal(r.peers.length, 1);
  assert.equal(firstDone, false);
  assert.equal(secondDone, false);
  await r.advance(1799);
  assert.equal(secondDone, false);
  await r.advance(1);
  await Promise.all([first, second]);
  assert.equal(r.timers.size, 0);
});

await test('numeric IP succeeds and is reused without another attempt', async () => {
  const r = runtime();
  const first = r.api.ensureClientIp();
  r.peers[0].onicecandidate({ candidate: { candidate: 'candidate:1 1 UDP 1 192.0.2.8 12345 typ host' } });
  assert.equal(await first, '192.0.2.8');
  assert.equal(await r.api.ensureClientIp(), '192.0.2.8');
  assert.equal(r.peers.length, 1);
  assert.equal(r.timers.size, 0);
});

await test('failed attempt is cached for 60 seconds without request waiting', async () => {
  const r = runtime();
  const first = r.api.ensureClientIp();
  await r.advance(1800);
  await first;
  const at = r.now();
  assert.equal(await r.api.ensureClientIp(), '');
  await r.advance(59999);
  assert.equal(await r.api.ensureClientIp(), '');
  assert.equal(r.peers.length, 1);
  assert.equal(r.now(), at + 59999);
  assert.equal(r.timers.size, 0);
});

await test('ICE final null candidate finishes immediately with no IP', async () => {
  const r = runtime();
  const at = r.now();
  const first = r.api.ensureClientIp();
  r.peers[0].onicecandidate({ candidate: null });
  assert.equal(await first, '');
  assert.equal(r.now(), at);
  assert.equal(r.timers.size, 0);
  assert.equal(r.peers[0].closed, true);
});

await test('ICE gathering complete finishes immediately with no IP', async () => {
  const r = runtime();
  const first = r.api.ensureClientIp();
  r.peers[0].iceGatheringState = 'complete';
  r.peers[0].onicegatheringstatechange();
  assert.equal(await first, '');
  assert.equal(r.timers.size, 0);
});

await test('mDNS candidate is not mistaken for a numeric IP', async () => {
  const r = runtime();
  let done = false;
  const first = r.api.ensureClientIp().then(value => { done = true; return value; });
  r.peers[0].onicecandidate({ candidate: { candidate: 'candidate:1 1 UDP 1 device-test.local 12345 typ host' } });
  await r.drain();
  assert.equal(done, false);
  r.peers[0].onicecandidate({ candidate: null });
  assert.equal(await first, '');
});

await test('expired failure cache retries in the background and shares the attempt', async () => {
  const r = runtime();
  const first = r.api.ensureClientIp();
  r.peers[0].onicecandidate({ candidate: null });
  await first;
  await r.advance(60000);
  const at = r.now();
  assert.equal(await r.api.ensureClientIp(), '');
  assert.equal(await r.api.ensureClientIp(), '');
  assert.equal(r.peers.length, 2);
  assert.equal(r.now(), at);
  r.peers[1].onicecandidate({ candidate: { candidate: 'candidate:1 1 UDP 1 192.0.2.9 12345 typ host' } });
  await r.drain();
  assert.equal(await r.api.ensureClientIp(), '192.0.2.9');
  assert.equal(r.peers.length, 2);
  assert.equal(r.timers.size, 0);
});

await test('background failure does not leave timers or retry per request', async () => {
  const r = runtime();
  const first = r.api.ensureClientIp();
  await r.advance(1800); await first;
  await r.advance(60000);
  assert.equal(await r.api.ensureClientIp(), '');
  await r.advance(1800);
  assert.equal(await r.api.ensureClientIp(), '');
  assert.equal(r.peers.length, 2);
  assert.equal(r.timers.size, 0);
});

await test('RTC constructor failure returns immediately and removes timeout', async () => {
  const r = runtime({ rtcMode: 'constructor-failure' });
  assert.equal(await r.api.ensureClientIp(), '');
  assert.equal(r.timers.size, 0);
  assert.equal(await r.api.ensureClientIp(), '');
});

await test('RTC offer failure returns immediately and removes timeout', async () => {
  const r = runtime({ rtcMode: 'offer-failure' });
  assert.equal(await r.api.ensureClientIp(), '');
  assert.equal(r.timers.size, 0);
  assert.equal(r.peers.length, 1);
});

await test('request evidence uses actual fetch start and separates preparation from network time', async () => {
  const r = runtime({ responseDelayMs: 100 });
  const hintAt = r.now();
  const pending = r.api.fetchJson('/api/test/read?private=not-for-log', { method: 'GET', headers: { Authorization: 'test-secret-value' }, __hintAt: hintAt, __identityWaitMs: 123, __requestId: 'read-test-1', __tokenRecoveryRetry: true });
  await r.advance(1800);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].at, hintAt + 1800);
  const started = r.logs.find(log => log.event === '协议网络请求发起').data;
  assert.equal(started.networkStartedAt, r.calls[0].at);
  assert.equal(started.clientIpWaitMs, 1800);
  assert.equal(started.identityWaitMs, 123);
  assert.equal(started.requestId, 'read-test-1');
  assert.equal(started.hintToNetworkMs, 1800);
  assert.equal(started.preparationMs, 1800);
  assert.equal(started.path, '/api/test/read');
  assert.equal('__hintAt' in r.calls[0].options, false);
  assert.equal('__tokenRecoveryRetry' in r.calls[0].options, false);
  assert.equal('__identityWaitMs' in r.calls[0].options, false);
  assert.equal('__requestId' in r.calls[0].options, false);
  await r.advance(100);
  const result = await pending;
  assert.equal(result.timing.networkDurationMs, 100);
  assert.doesNotMatch(JSON.stringify(r.logs), /test-secret-value|not-for-log/);
});

await test('subsequent read request does not repeat the failed preparation delay', async () => {
  const r = runtime({ responseDelayMs: 100 });
  const initial = r.api.ensureClientIp();
  await r.advance(1800); await initial;
  const at = r.now();
  const pending = r.api.fetchJson('/api/test/read', { method: 'GET' });
  await r.drain();
  assert.equal(r.calls[0].at, at);
  await r.advance(100);
  const result = await pending;
  assert.equal(result.timing.clientIpWaitMs, 0);
  assert.equal(r.peers.length, 1);
});

await test('identity preparation reports its wait once and warm identity is reused', async () => {
  const r = runtime({ responseDelayMs: 100 });
  const at = r.now();
  const identity = r.api.ensureSessionIdentity();
  await r.advance(1900);
  await identity;
  const log = r.logs.find(item => item.event === '会话身份准备完成').data;
  assert.equal(log.durationMs, 1900);
  assert.equal(log.loaded, true);
  await r.api.ensureSessionIdentity();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, '/api/admin/user/info');
  assert.equal(r.now(), at + 1900);
});

await test('fetch during background retry sends immediately without waiting for RTC', async () => {
  const r = runtime();
  const first = r.api.ensureClientIp();
  r.peers[0].onicecandidate({ candidate: null });
  await first;
  await r.advance(60000);
  const at = r.now();
  const result = await r.api.fetchJson('/api/test/read', { method: 'GET' });
  assert.equal(r.calls[0].at, at);
  assert.equal(result.timing.clientIpWaitMs, 0);
  assert.equal(r.peers.length, 2);
});

console.log(`request-preparation: ${count} isolated behavior tests passed; no live network requests`);
