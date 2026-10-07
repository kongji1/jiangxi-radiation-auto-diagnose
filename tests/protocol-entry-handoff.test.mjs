import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/13-protocol-bridges.js', import.meta.url), 'utf8');
const start = source.indexOf('  function installProtocolEntryHandoff(');
const end = source.indexOf('  function installReportEntryPageObserver(', start);
assert(start >= 0 && end > start, 'real handoff helper exists');
const helper = source.slice(start, end);
const origin = 'http://10.10.94.90:22112';
const endpoint = `${origin}/api/ct/rays/rep/enter`;
const request = { repUid: 'synthetic-report-1', isList: false, isRemote: false, flag: 0 };
const body = JSON.stringify(request);
const payload = { code: 200, message: 'synthetic-loaded', data: { repUid: request.repUid, reportDoc: 'synthetic-doctor', finding: 'synthetic-report-body' } };
const responseText = JSON.stringify(payload);

class ProgressEvent extends Event {
  constructor(type, options = {}) { super(type); Object.assign(this, options); }
}

function runtime({ lockedProperty = false, lockedHook = false, noProgressEvent = false, unsupportedJson = false, missingLoadend = false, noAuth = false, store = true } = {}) {
  let now = 1000, serial = 0;
  const timers = new Map(), calls = [];
  class FakeXHR extends EventTarget {
    constructor() {
      super();
      this.readyState = 0; this.status = 0; this.statusText = ''; this.responseURL = '';
      this.response = null; this.responseText = ''; this.responseType = ''; this.nativeHeaders = new Map();
      this.onloadend = null;
      if (lockedProperty) Object.defineProperty(this, 'readyState', { configurable: false, writable: true, value: 0 });
      if (unsupportedJson) Object.defineProperty(this, 'responseType', { get: () => '', set: value => { if (value === 'json') throw new TypeError('unsupported response type'); } });
    }
    dispatchEvent(event) { const result = super.dispatchEvent(event); if (!missingLoadend) this[`on${event.type}`]?.call(this, event); return result; }
    open(...args) { calls.push({ method: 'open', args, xhr: this }); this.readyState = 1; this.dispatchEvent(new Event('readystatechange')); return 'native-open'; }
    send(...args) { calls.push({ method: 'send', args, xhr: this }); return 'native-send'; }
    abort(...args) { calls.push({ method: 'abort', args, xhr: this }); this.readyState = 0; return 'native-abort'; }
    setRequestHeader(key, value) { calls.push({ method: 'setRequestHeader', args: [key, value], xhr: this }); this.nativeHeaders.set(key.toLowerCase(), value); return 'native-header'; }
    getResponseHeader(...args) { calls.push({ method: 'getResponseHeader', args, xhr: this }); return 'native-response-header'; }
    getAllResponseHeaders(...args) { calls.push({ method: 'getAllResponseHeaders', args, xhr: this }); return 'native-all-response-headers'; }
  }
  if (lockedHook) Object.defineProperty(FakeXHR.prototype, 'send', { writable: false });
  const user = { currentWorkStation: '105701' };
  const app = store ? { __vue_app__: { config: { globalProperties: { $pinia: { _s: new Map([['user', user]]) } } } } } : null;
  const nativePromise = Promise.resolve(new Response('{}')), nativeResponses = [];
  const originalFetch = function (...args) { calls.push({ method: 'fetch', args, self: this }); return nativeResponses.length ? Promise.resolve(nativeResponses.shift()) : nativePromise; };
  const page = {
    location: { href: `${origin}/radiation`, origin },
    document: { cookie: `AUTH=${noAuth ? '' : 'synthetic-session'}; LOGINCODE=synthetic-account; WORKSTATION=105701`, getElementById: () => app },
    XMLHttpRequest: FakeXHR, fetch: originalFetch, Response, Headers, Event, ProgressEvent: noProgressEvent ? undefined : ProgressEvent, DOMException,
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  class ClockDate extends Date { static now() { return now; } }
  const context = vm.createContext({ page, URL, TextEncoder, Date: ClockDate });
  vm.runInContext(helper, context);
  const bridge = vm.runInContext('installProtocolEntryHandoff(page)', context);
  const baseline = calls.length;
  const flush = async () => {
    for (let turns = 0; turns < 30; turns++) {
      const due = [...timers].filter(([, timer]) => timer.at <= now);
      if (!due.length) break;
      for (const [id, timer] of due) { if (!timers.has(id)) continue; timers.delete(id); timer.fn(); }
    }
    await new Promise(resolve => setImmediate(resolve));
  };
  return {
    page, bridge, context, user, calls, nativePromise, nativeResponses, originalFetch, baseline, flush,
    advance: async ms => { now += ms; await flush(); },
    report: (id = request.repUid) => { page.location.href = `${origin}/radiation/report?id=${encodeURIComponent(id)}`; },
    stage: (value = body, text = responseText, status = 200, headers = { 'content-type': 'application/json', 'x-synthetic': 'present' }, ttl = 15000) => bridge.stage(value, text, status, headers, ttl),
    count: method => calls.slice(baseline).filter(call => call.method === method).length
  };
}

function xhr(r, { value = body, url = endpoint, method = 'POST', responseType = '', async = true, headers = true } = {}) {
  const valueXHR = new r.page.XMLHttpRequest();
  const events = [];
  for (const type of ['loadstart', 'readystatechange', 'progress', 'load', 'loadend', 'abort', 'error']) valueXHR.addEventListener(type, () => events.push({ type, state: valueXHR.readyState, status: valueXHR.status }));
  assert.equal(valueXHR.open(method, url, async), 'native-open');
  valueXHR.responseType = responseType;
  if (headers) { valueXHR.setRequestHeader('LOGIN-USER-KEY', 'synthetic-account'); valueXHR.setRequestHeader('Authorization', 'synthetic-session'); }
  const returned = valueXHR.send(value);
  return { xhr: valueXHR, events, returned };
}

function acknowledgeThroughRealObserver(r, { delayed = false } = {}) {
  const begin = source.indexOf('  function installReportEntryPageObserver(');
  const finish = source.indexOf('  function installReportEntryBridge(', begin);
  const observations = [], logs = [], queued = [];
  const deliver = event => {
    r.context.observedEvent = event;
    vm.runInContext('onReportEntryObserved(observedEvent)', r.context);
  };
  Object.assign(r.context, {
    Promise, TextDecoder, pageWindow: () => r.page,
    norm: value => String(value || '').trim(), loginIdentity: () => ({ name: 'synthetic-doctor' }),
    accountValueMatches: (expected, actual) => expected === actual,
    developerLog: (name, detail) => logs.push({ name, detail }),
    pendingFinalEntryState: () => null, readAutomaticEntry: () => null,
    consumeAutomaticEntry: () => true, releaseAutomaticEntry: () => true,
    completeFinalEntryPending: () => false,
    stopAutoOpenAfterAcquisitionFailure: () => assert.fail('no initial pending failure expected')
  });
  r.page.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  r.page.dispatchEvent = event => {
    observations.push(JSON.parse(event.detail));
    if (delayed) queued.push(event); else deliver(event);
    return true;
  };
  vm.runInContext(source.slice(begin, finish), r.context);
  vm.runInContext("installReportEntryPageObserver(page, 'synthetic-loaded-ack')", r.context);
  return { observations, logs, acknowledge: () => { for (const event of queued.splice(0)) deliver(event); } };
}

let tested = 0;
async function test(name, run) { await run(); tested++; console.log(`ok ${tested} - ${name}`); }

await test('capability probe executes native open but never sends a request', async () => {
  const r = runtime();
  assert.equal(r.bridge.ready, true); assert.equal(r.bridge.isReady(), true);
  assert.equal(r.bridge.isReady('json'), true); assert.equal(r.bridge.isReady('text'), true);
  assert.equal(r.bridge.isReady('blob'), false); assert.equal(r.bridge.isReady('arraybuffer'), false);
  assert.equal(r.calls.filter(call => call.method === 'open').length, 1);
  assert.equal(r.calls.filter(call => call.method === 'send' || call.method === 'fetch').length, 0);
  assert.equal(vm.runInContext('installProtocolEntryHandoff(page)', r.context), r.bridge);
});

await test('unshadowable properties, unwritable hooks and missing events disable preclaim', async () => {
  for (const options of [{ lockedProperty: true }, { lockedHook: true }, { noProgressEvent: true }, { unsupportedJson: true }, { missingLoadend: true }]) {
    const r = runtime(options);
    assert.equal(r.bridge.ready, false); assert.equal(r.bridge.isReady(), false); assert.equal(r.stage(), false);
    assert.equal(r.page.fetch, r.originalFetch, 'failed installation rolls back all installed hooks');
    assert.equal(r.page.XMLHttpRequest.prototype.open.toString().includes('native.open'), false);
    const x = new r.page.XMLHttpRequest(); x.open('POST', endpoint); assert.equal(x.send(body), 'native-send');
    assert.equal(r.count('send'), 1);
  }
});

await test('readiness requires readable account, auth and workstation', async () => {
  const r = runtime({ noAuth: true });
  assert.equal(r.bridge.ready, true); assert.equal(r.bridge.isReady(), false); assert.equal(r.stage(), false);
  r.page.document.cookie = 'AUTH=synthetic-session; WORKSTATION=105701';
  assert.equal(r.bridge.isReady(), false);
  r.page.document.cookie = 'AUTH=synthetic-session; LOGINCODE=synthetic-account'; r.user.currentWorkStation = '';
  assert.equal(r.bridge.isReady(), false);
});

await test('text XHR reuses the complete real response with native Axios event semantics', async () => {
  const r = runtime(); const id = r.stage(); assert.equal(typeof id, 'string'); r.report();
  const x = xhr(r); const loaded = [];
  x.xhr.onloadend = () => loaded.push({ status: x.xhr.status, response: x.xhr.response, headers: x.xhr.getAllResponseHeaders(), url: x.xhr.responseURL });
  assert.equal(x.returned, undefined); assert.equal(r.count('open'), 1); assert.equal(r.count('send'), 0);
  assert.equal(x.xhr.readyState, 1); assert.equal(x.xhr.status, 0); assert.equal(x.xhr.getResponseHeader('content-type'), null);
  await r.flush();
  assert.equal(x.xhr.readyState, 4); assert.equal(x.xhr.status, 200); assert.equal(x.xhr.statusText, 'OK');
  assert.equal(x.xhr.responseText, responseText); assert.equal(x.xhr.response, responseText);
  assert.equal(x.xhr.getResponseHeader('X-SYNTHETIC'), 'present');
  assert.equal(x.xhr.responseURL, endpoint); assert.equal(loaded.length, 1); assert.equal(loaded[0].response, responseText);
  assert.deepEqual(x.events.map(value => value.type), ['readystatechange', 'loadstart', 'readystatechange', 'readystatechange', 'progress', 'readystatechange', 'load', 'loadend']);
  assert.deepEqual(x.events.filter(value => value.type === 'readystatechange').map(value => value.state), [1, 2, 3, 4]);
  assert.equal(r.bridge.peek(id).pending, false);
  assert.equal(JSON.stringify(r.bridge.peek(id)).includes('synthetic-session'), false);
});

await test('json XHR returns the full object and responseText raises InvalidStateError', async () => {
  const r = runtime(); r.stage(); r.report(); const x = xhr(r, { responseType: 'json' });
  assert.equal(x.xhr.response, null); await r.flush();
  assert.equal(JSON.stringify(x.xhr.response), responseText);
  assert.throws(() => x.xhr.responseText, error => error.name === 'InvalidStateError');
  assert.equal(r.count('send'), 0);
});

await test('explicit text responseType and canonical field order match exactly', async () => {
  const r = runtime(); r.stage(request); r.report();
  const x = xhr(r, { responseType: 'text', value: JSON.stringify({ flag: 0, isRemote: false, repUid: request.repUid, isList: false }) });
  await r.flush(); assert.equal(x.xhr.responseText, responseText); assert.equal(r.count('send'), 0);
});

await test('one ticket cannot send a second network POST or be staged again', async () => {
  const r = runtime(); r.stage(); r.report(); xhr(r); await r.flush();
  const second = xhr(r); await r.flush();
  assert.equal(second.xhr.status, 0); assert.equal(second.events.some(value => value.type === 'error'), true);
  assert.equal(second.events.some(value => value.type === 'load'), false); assert.equal(r.count('send'), 0); assert.equal(r.stage(), false);
});

await test('TTL is at most 15 seconds and expiry fails locally without a lock retry', async () => {
  const r = runtime(); const id = r.stage(body, responseText, 200, {}, 60000);
  assert.equal(r.bridge.peek(id).expiresAt, 16000); await r.advance(15000); r.report();
  const x = xhr(r); await r.flush();
  assert.equal(r.bridge.peek(id).pending, false); assert.equal(x.xhr.status, 0); assert.equal(r.count('send'), 0);
  assert.equal(x.events.some(value => value.type === 'error'), true);
});

await test('discard removes response and prevents a second POST for that ticket', async () => {
  const r = runtime(); const id = r.stage(); assert.equal(r.bridge.discard(id), true); assert.equal(r.bridge.discard('absent'), false); r.report();
  const x = xhr(r); await r.flush(); assert.equal(x.xhr.responseText, ''); assert.equal(r.count('send'), 0);
});

await test('abort before completion emits abort/loadend and never load', async () => {
  const r = runtime(); r.stage(); r.report(); const x = xhr(r); x.xhr.abort(); await r.flush();
  assert.equal(x.xhr.readyState, 0); assert.equal(x.xhr.status, 0); assert.equal(x.xhr.responseText, '');
  assert.equal(x.events.filter(value => value.type === 'abort').length, 1);
  assert.equal(x.events.filter(value => value.type === 'loadend').length, 1);
  assert.equal(x.events.some(value => value.type === 'load'), false); assert.equal(r.count('send'), 0);
});

await test('abort during readystatechange stops later progress/load events', async () => {
  const r = runtime(); r.stage(); r.report(); const x = xhr(r);
  x.xhr.addEventListener('readystatechange', () => { if (x.xhr.readyState === 2) x.xhr.abort(); }); await r.flush();
  assert.equal(x.events.some(value => value.type === 'load' || value.type === 'progress'), false); assert.equal(r.count('send'), 0);
});

await test('unsupported responseType and synchronous XHR never repeat the preclaimed POST', async () => {
  for (const options of [{ responseType: 'blob' }, { responseType: 'arraybuffer' }, { async: false }]) {
    const r = runtime(); r.stage(); r.report(); const x = xhr(r, options); await r.flush();
    assert.equal(x.xhr.status, 0); assert.equal(x.events.some(value => value.type === 'error'), true); assert.equal(r.count('send'), 0);
  }
});

await test('reopening the same XHR executes native open and restores native methods on misses', async () => {
  const r = runtime(); r.stage(); r.report(); const x = xhr(r); await r.flush();
  assert.throws(() => x.xhr.send(body), error => error.name === 'InvalidStateError');
  assert.equal(x.xhr.open('GET', `${origin}/api/ct/rays/rep/list`), 'native-open');
  assert.equal(x.xhr.send(), 'native-send'); assert.equal(x.xhr.getResponseHeader('x'), 'native-response-header');
  assert.equal(x.xhr.getAllResponseHeaders(), 'native-all-response-headers'); assert.equal(r.count('send'), 1);
});

await test('other endpoints, methods, origins, queries and hashes are complete native misses', async () => {
  const r = runtime(); r.stage(); r.report();
  const cases = [{ url: `${endpoint}Extra` }, { url: `${endpoint}/synthetic-report-1/false`, method: 'GET' }, { url: endpoint.replace('10.10.94.90:22112', 'external.invalid') }, { url: `${endpoint}?unexpected=1` }, { url: `${endpoint}#fragment` }, { method: 'PUT' }];
  for (const options of cases) assert.equal(xhr(r, options).returned, 'native-send');
  assert.equal(r.count('send'), cases.length);
});

await test('different route/report and every payload mismatch use the native method', async () => {
  const r = runtime(); r.stage();
  assert.equal(xhr(r).returned, 'native-send'); r.report('synthetic-other'); assert.equal(xhr(r).returned, 'native-send'); r.report();
  const values = [{ ...request, repUid: 'synthetic-other' }, { ...request, isRemote: true }, { ...request, flag: 1 }, { ...request, isList: true }, { ...request, flag: '0' }, { ...request, extra: true }, { repUid: request.repUid }, 'not-json'];
  for (const value of values) assert.equal(xhr(r, { value: typeof value === 'string' ? value : JSON.stringify(value) }).returned, 'native-send');
  assert.equal(r.count('send'), values.length + 2);
});

await test('different account, AUTH or either workstation source cannot consume a response', async () => {
  for (const change of [r => { r.page.document.cookie = r.page.document.cookie.replace('synthetic-account', 'synthetic-other'); }, r => { r.page.document.cookie = r.page.document.cookie.replace('synthetic-session', 'synthetic-new-session'); }, r => { r.page.document.cookie = r.page.document.cookie.replace('WORKSTATION=105701', 'WORKSTATION=105702'); }, r => { r.user.currentWorkStation = '105702'; }]) {
    const r = runtime(); r.stage(); r.report(); change(r); const x = xhr(r, { headers: false });
    assert.equal(x.returned, 'native-send'); assert.equal(r.count('send'), 1);
  }
});

await test('different identity headers on the same staged ticket fail locally and spend the ticket', async () => {
  const r = runtime(); const id = r.stage(); r.report();
  const x = new r.page.XMLHttpRequest(); x.open('POST', endpoint); x.setRequestHeader('LOGIN-USER-KEY', 'synthetic-other');
  let errors = 0; x.addEventListener('error', () => { errors++; });
  assert.equal(x.send(body), undefined); await r.flush(); assert.equal(r.count('send'), 0); assert.equal(errors, 1); assert.equal(x.status, 0);
  assert.equal(r.bridge.peek(id).pending, false); assert.equal(r.stage(), false);
  const second = xhr(r); await r.flush(); assert.equal(second.xhr.status, 0); assert.equal(r.count('send'), 0);
});

await test('stage rejects malformed fields, invalid response, oversize and wrong workstation flag', async () => {
  const r = runtime();
  for (const value of [{ ...request, flag: true }, { ...request, repUid: 'unsafe/id' }, { ...request, extra: true }, { ...request, isList: true }, { ...request, flag: 1 }]) assert.equal(r.stage(value), false);
  assert.equal(r.stage(body, 'malformed'), false); assert.equal(r.stage(body, 'x'.repeat(1048577)), false);
  assert.equal(r.stage(body, responseText, 0), false); assert.equal(r.stage(body, responseText, 204), false);
  r.user.currentWorkStation = '105712'; assert.equal(typeof r.stage({ ...request, flag: 1 }), 'string');
});

await test('cookie workstation fallback is usable only when the store is absent', async () => {
  const r = runtime({ store: false }); assert.equal(r.bridge.isReady(), true); assert.equal(typeof r.stage(), 'string');
  const strict = runtime(); strict.user.currentWorkStation = ''; assert.equal(strict.bridge.isReady(), false);
});

await test('fetch returns a real full Response, headers and URL without making a second request', async () => {
  const r = runtime(); r.stage(); r.report();
  const response = await r.page.fetch(endpoint, { method: 'POST', body, headers: { Authorization: 'synthetic-session', 'LOGIN-USER-KEY': 'synthetic-account' } });
  assert(response instanceof Response); assert.equal(response.status, 200); assert.equal(response.statusText, 'OK'); assert.equal(response.url, endpoint);
  assert.equal(response.headers.get('x-synthetic'), 'present'); assert.deepEqual(await response.json(), payload); assert.equal(r.count('fetch'), 0);
  await assert.rejects(r.page.fetch(endpoint, { method: 'POST', body }), /no longer available/); assert.equal(r.count('fetch'), 0);
});

await test('fetch misses keep native promise identity and exact arguments', async () => {
  const r = runtime(); r.stage(); r.report(); const options = { method: 'POST', body: JSON.stringify({ ...request, isRemote: true }) };
  assert.equal(r.page.fetch(endpoint, options), r.nativePromise); assert.equal(r.calls.at(-1).args[1], options); assert.equal(r.calls.at(-1).self, r.page);
  assert.equal(r.page.fetch(endpoint, { method: 'POST', body, credentials: 'omit' }), r.nativePromise);
  assert.equal(r.count('fetch'), 2);
});

await test('fetch Request body can consume only its exact matching response', async () => {
  const r = runtime(); r.stage(); r.report();
  const requestObject = new Request(endpoint, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await (await r.page.fetch(requestObject)).json(), payload); assert.equal(r.count('fetch'), 0); assert.equal(requestObject.bodyUsed, false);
});

await test('aborted fetch never starts a second POST and leaves no readable response', async () => {
  const r = runtime(); r.stage(); r.report(); const controller = new AbortController(); controller.abort();
  await assert.rejects(r.page.fetch(endpoint, { method: 'POST', body, signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(r.count('fetch'), 0);
});

await test('helper before existing observer lets cached XHR/fetch produce normal final observations', async () => {
  for (const transport of ['xhr', 'fetch']) {
    const r = runtime(); const observed = [];
    const observerStart = source.indexOf('  function installReportEntryPageObserver(');
    const observerEnd = source.indexOf('  function onReportEntryObserved(', observerStart);
    r.page.CustomEvent = class extends Event { constructor(type, options) { super(type); this.detail = options.detail; } };
    r.page.dispatchEvent = value => { observed.push(JSON.parse(value.detail)); return true; };
    r.context.TextDecoder = TextDecoder;
    vm.runInContext(source.slice(observerStart, observerEnd), r.context);
    vm.runInContext("installReportEntryPageObserver(page, 'synthetic-observation')", r.context);
    assert.equal(r.bridge.isReady(), true); r.stage(); r.report();
    if (transport === 'xhr') xhr(r); else await r.page.fetch(endpoint, { method: 'POST', body });
    await r.flush();
    assert.equal(observed.length, 1); assert.equal(observed[0].outcome, 'complete'); assert.equal(observed[0].repUid, request.repUid);
    assert.equal(r.count('send'), 0); assert.equal(r.count('fetch'), 0);
    assert.equal(JSON.stringify(observed).includes('synthetic-report-body'), false);
  }
});

await test('unrelated native open preserves custom instance response properties', async () => {
  const r = runtime(); const x = new r.page.XMLHttpRequest();
  Object.defineProperty(x, 'response', { configurable: true, get: () => 'synthetic-custom-response' });
  x.open('GET', `${origin}/api/ct/rays/rep/list`); assert.equal(x.response, 'synthetic-custom-response');
  assert.equal(x.send(), 'native-send');
});

await test('different WORKCODE and duplicated auth headers fail locally without repeating the staged POST', async () => {
  for (const headers of [[['WORKCODE', '105702']], [['Authorization', 'synthetic-session'], ['Authorization', 'synthetic-session']]]) {
    const r = runtime(); const id = r.stage(); r.report(); const x = new r.page.XMLHttpRequest(); x.open('POST', endpoint);
    for (const [key, value] of headers) x.setRequestHeader(key, value);
    let errors = 0; x.addEventListener('error', () => { errors++; });
    assert.equal(x.send(body), undefined); await r.flush(); assert.equal(r.count('send'), 0); assert.equal(errors, 1); assert.equal(x.status, 0);
    assert.equal(r.bridge.peek(id).pending, false); assert.equal(r.stage(), false);
  }
});

await test('response progress counts UTF8 bytes and preserves supplied HTTP statusText', async () => {
  const r = runtime(); const text = JSON.stringify({ code: 200, data: { finding: '合成中文' } });
  r.bridge.stage(body, text, 201, new Headers({ 'x-synthetic': 'present' }), 15000, 'Synthetic Created'); r.report();
  const x = xhr(r); let loaded = 0; x.xhr.addEventListener('progress', event => { loaded = event.loaded; }); await r.flush();
  assert.equal(loaded, new TextEncoder().encode(text).byteLength); assert.equal(x.xhr.status, 201); assert.equal(x.xhr.statusText, 'Synthetic Created');
});

await test('fetch identity header mismatch spends the matching ticket and never calls native fetch', async () => {
  const r = runtime(); const id = r.stage(); r.report();
  await assert.rejects(r.page.fetch(endpoint, { method: 'POST', body, headers: { Authorization: 'synthetic-wrong-session' } }), /no longer available/);
  assert.equal(r.count('fetch'), 0); assert.equal(r.bridge.peek(id).pending, false); assert.equal(r.stage(), false);
  await assert.rejects(r.page.fetch(endpoint, { method: 'POST', body }), /no longer available/); assert.equal(r.count('fetch'), 0);
});

await test('only completed XHR delivery can be acknowledged, then native refresh is transparent', async () => {
  const r = runtime(); r.stage(); r.report();
  assert.equal(r.bridge.confirmLoaded(request.repUid), false, 'pending ticket cannot be acknowledged');
  const first = xhr(r);
  assert.equal(r.bridge.confirmLoaded(request.repUid), false, 'consumption is not delivery completion');
  first.xhr.onloadend = () => assert.equal(r.bridge.confirmLoaded(request.repUid), false, 'ack starts after successful loadend');
  await r.flush();
  assert.equal(r.bridge.confirmLoaded(request.repUid), true);
  assert.equal(r.bridge.confirmLoaded(request.repUid), false, 'ack is one transition');
  assert.equal(xhr(r).returned, 'native-send'); assert.equal(r.count('send'), 1);
  assert.equal(r.stage(), false, 'loaded key still cannot pre-acquire again');
});

await test('concurrent startup duplicate and delivered but unacknowledged requests never repeat POST', async () => {
  const r = runtime(); r.stage(); r.report(); const first = xhr(r), concurrent = xhr(r);
  await r.flush();
  assert.equal(first.xhr.status, 200); assert.equal(concurrent.xhr.status, 0);
  assert.equal(concurrent.events.some(event => event.type === 'error'), true);
  await r.advance(60000);
  const unacknowledged = xhr(r); await r.flush();
  assert.equal(unacknowledged.xhr.status, 0); assert.equal(r.count('send'), 0);
});

await test('expired, discarded, unsupported and aborted deliveries cannot be acknowledged', async () => {
  for (const failure of ['expired', 'discarded', 'unsupported', 'sync', 'abort-before', 'abort-during', 'abort-after']) {
    const r = runtime(); const id = r.stage(); r.report();
    if (failure === 'expired') await r.advance(15000);
    if (failure === 'discarded') r.bridge.discard(id);
    const first = xhr(r, { responseType: failure === 'unsupported' ? 'blob' : '', async: failure !== 'sync' });
    if (failure === 'abort-before') first.xhr.abort();
    if (failure === 'abort-during') first.xhr.addEventListener('readystatechange', () => { if (first.xhr.readyState === 2) first.xhr.abort(); });
    await r.flush();
    if (failure === 'abort-after') first.xhr.abort();
    assert.equal(r.bridge.confirmLoaded(request.repUid), false, failure);
    assert.equal(r.count('send'), 0, failure);
  }
});

await test('ack requires the same report route and complete original session identity', async () => {
  for (const change of [r => r.report('synthetic-other'), r => { r.page.document.cookie = r.page.document.cookie.replace('synthetic-account', 'synthetic-other'); }, r => { r.page.document.cookie = r.page.document.cookie.replace('synthetic-session', 'synthetic-new-session'); }, r => { r.page.document.cookie = r.page.document.cookie.replace('WORKSTATION=105701', 'WORKSTATION=105702'); }, r => { r.user.currentWorkStation = '105702'; }]) {
    const r = runtime(); r.stage(); r.report(); xhr(r); await r.flush(); change(r);
    assert.equal(r.bridge.confirmLoaded(request.repUid), false);
  }
  const r = runtime(); r.stage(); r.report(); xhr(r); await r.flush();
  assert.equal(r.bridge.confirmLoaded('synthetic-other'), false);
  assert.equal(r.bridge.confirmLoaded(123), false);
});

await test('fetch delivery allows live refresh only after acknowledgement and still rejects concurrent replay', async () => {
  const r = runtime(); r.stage(); r.report();
  const first = r.page.fetch(endpoint, { method: 'POST', body });
  await assert.rejects(r.page.fetch(endpoint, { method: 'POST', body }), /no longer available/);
  assert.deepEqual(await (await first).json(), payload); assert.equal(r.count('fetch'), 0);
  assert.equal(r.bridge.confirmLoaded(request.repUid), true);
  const options = { method: 'POST', body };
  assert.equal(r.page.fetch(endpoint, options), r.nativePromise);
  assert.equal(r.calls.at(-1).args[1], options); assert.equal(r.count('fetch'), 1);
  assert.equal(r.stage(), false);
});

await test('failed Response construction and pre-aborted fetch cannot unlock a ticket', async () => {
  for (const failure of ['response-construction', 'aborted']) {
    const r = runtime(); r.stage(); r.report();
    if (failure === 'response-construction') {
      r.page.Response = class { constructor() { throw new TypeError('synthetic-response-construction'); } };
      assert.throws(() => r.page.fetch(endpoint, { method: 'POST', body }), /synthetic-response-construction/);
    } else {
      const controller = new AbortController(); controller.abort();
      await assert.rejects(r.page.fetch(endpoint, { method: 'POST', body, signal: controller.signal }), error => error.name === 'AbortError');
    }
    assert.equal(r.bridge.confirmLoaded(request.repUid), false); assert.equal(r.count('fetch'), 0);
  }
});

await test('native terminal review success refreshes current report after real owner acknowledgement', async () => {
  const r = runtime(); const observed = acknowledgeThroughRealObserver(r); r.stage(); r.report();
  xhr(r); await r.flush();
  assert.equal(observed.observations.length, 1); assert.equal(observed.observations[0].outcome, 'complete');
  const reportBody = JSON.stringify({ repUid: request.repUid, button: 'tjbg', currentReportStatusCode: '102502', finding: 'synthetic-only', opinion: 'synthetic-only' });
  r.nativeResponses.push(new Response(JSON.stringify({ code: 200, data: true })));
  const result = await r.page.fetch(`${origin}/api/ct/rays/rep/report`, { method: 'POST', body: reportBody });
  assert.deepEqual(await result.json(), { code: 200, data: true });
  assert.equal(r.calls.at(-1).args[1].body, reportBody);
  const refreshed = xhr(r); assert.equal(refreshed.returned, 'native-send');
  await r.flush();
  assert.equal(refreshed.events.some(event => event.type === 'error'), false);
  assert.equal(r.count('send'), 1); assert.equal(r.count('fetch'), 1);
  assert.equal(r.stage(), false, 'refresh does not remove the auto acquisition tombstone');
});

await test('auto-save and submit-diagnosis requests preserve payload and native transport before acknowledgement', async () => {
  const r = runtime(); r.stage(); r.report(); xhr(r); await r.flush();
  for (const path of ['/api/ct/rays/rep/autoSaveRep', '/api/ct/rays/rep/report']) {
    const value = JSON.stringify({ repUid: request.repUid, button: 'tjsh', currentReportStatusCode: '102502', sign: 'synthetic-only' });
    assert.equal(xhr(r, { url: `${origin}${path}`, value }).returned, 'native-send');
    assert.equal(r.calls.at(-1).args[0], value);
    const options = { method: 'POST', body: value };
    assert.equal(r.page.fetch(`${origin}${path}`, options), r.nativePromise);
    assert.equal(r.calls.at(-1).args[1], options);
  }
  assert.equal(r.count('send'), 2); assert.equal(r.count('fetch'), 2);
  const blocked = xhr(r); await r.flush(); assert.equal(blocked.xhr.status, 0, 'unacknowledged enter remains protected');
});

await test('real observer refuses loaded acknowledgement for wrong owner or response UID', async () => {
  for (const data of [{ ...payload.data, reportDoc: 'synthetic-other-doctor' }, { ...payload.data, repUid: 'synthetic-other-report' }, { reportDoc: payload.data.reportDoc }]) {
    const r = runtime(); acknowledgeThroughRealObserver(r); r.stage(body, JSON.stringify({ ...payload, data })); r.report();
    xhr(r); await r.flush();
    const repeated = xhr(r); await r.flush();
    assert.equal(repeated.xhr.status, 0); assert.equal(r.count('send'), 0);
  }
});

await test('late fetch abort prevents delayed real observer from acknowledging loaded state', async () => {
  const r = runtime(); const observer = acknowledgeThroughRealObserver(r, { delayed: true }); r.stage(); r.report();
  const controller = new AbortController();
  const first = await r.page.fetch(endpoint, { method: 'POST', body, signal: controller.signal });
  assert.deepEqual(await first.json(), payload); await r.flush();
  assert.equal(observer.observations.length, 1, 'matching successful observation is waiting for acknowledgement');
  controller.abort(); observer.acknowledge();
  assert.equal(r.bridge.confirmLoaded(request.repUid), false);
  await assert.rejects(r.page.fetch(endpoint, { method: 'POST', body }), /no longer available/);
  assert.equal(r.count('fetch'), 0); assert.equal(r.stage(), false);
});

await test('fetch abort after real loaded acknowledgement does not revoke legitimate native refresh', async () => {
  const r = runtime(); const observer = acknowledgeThroughRealObserver(r); r.stage(); r.report();
  const controller = new AbortController();
  const first = await r.page.fetch(endpoint, { method: 'POST', body, signal: controller.signal });
  assert.deepEqual(await first.json(), payload); await r.flush();
  assert.equal(observer.observations.length, 1);
  assert.equal(r.bridge.confirmLoaded(request.repUid), false, 'real observer already acknowledged this ticket');
  controller.abort();
  const options = { method: 'POST', body };
  assert.equal(r.page.fetch(endpoint, options), r.nativePromise);
  assert.equal(r.count('fetch'), 1); assert.equal(r.calls.at(-1).args[1], options);
  assert.equal(r.stage(), false);
});

await test('synchronous abort during Response creation cannot complete fetch delivery', async () => {
  const r = runtime(); r.stage(); r.report(); const controller = new AbortController();
  r.page.Response = class extends Response { constructor(...args) { super(...args); controller.abort(); } };
  await assert.rejects(r.page.fetch(endpoint, { method: 'POST', body, signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(r.bridge.confirmLoaded(request.repUid), false); assert.equal(r.count('fetch'), 0);
});

console.log(`passed ${tested} protocol-entry handoff cases`);
