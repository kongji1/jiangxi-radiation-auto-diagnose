import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
const start = source.indexOf('  function installReportEntryPageObserver(');
const end = source.indexOf('  function installReportEntryBridge()', start);
assert(start >= 0 && end > start, 'report observer source exists');
const observerSource = source.slice(start, end);
const observedEvent = 'test-report-entry-observed';
const endpoint = 'http://10.10.94.90:22112/api/ct/rays/rep/enter';
const detailEndpoint = `${endpoint}/synthetic-1/false`;
const body = JSON.stringify({ repUid: 'synthetic-1', isRemote: false, irrelevant: 'secret-request-value' });
const payload = {
  code: 200, message: 'loaded', data: {
    repUid: 'synthetic-1', patName: 'synthetic-patient', reportStatus: '诊断中', reportStatusCode: '102502',
    reportDoc: 'synthetic-doctor', lockUserName: 'synthetic-doctor',
    examName: 'synthetic-exam', finding: 'secret-report-body', opinion: 'secret-conclusion', Authorization: 'secret-auth'
  }
};

class FakeCustomEvent {
  constructor(type, options) { this.type = type; this.detail = options.detail; }
}

function runtime({ fetch, maxBytes, mode = 'text' } = {}) {
  const events = [];
  const logs = [];
  const nativeCalls = [];
  class FakeXHR {
    listeners = new Map();
    status = 0;
    responseType = mode === 'json' ? 'json' : '';
    response = null;
    responseText = '';
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    emit(type) { for (const listener of [...(this.listeners.get(type) || [])]) listener({ type }); }
    open(...args) { nativeCalls.push({ open: args }); return 'native-open'; }
    send(...args) { nativeCalls.push({ send: args }); return 'native-send'; }
    complete(value = payload, status = 200) {
      this.status = status;
      this.response = value;
      this.responseText = typeof value === 'string' ? value : JSON.stringify(value);
      this.emit('load');
    }
  }
  const page = {
    location: { href: 'http://10.10.94.90:22112/radiation/report?id=synthetic-1', origin: 'http://10.10.94.90:22112' },
    fetch: fetch || (() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))),
    XMLHttpRequest: FakeXHR, CustomEvent: FakeCustomEvent,
    dispatchEvent(event) { events.push(JSON.parse(event.detail)); return true; }
  };
  const context = vm.createContext({
    URL, Date, Promise, WeakMap, TextEncoder, TextDecoder,
    developerLog: (name, detail) => logs.push({ name, detail }),
    completeFinalEntryPending: () => false,
    norm: value => String(value || '').trim(), loginIdentity: () => ({ name: 'synthetic-doctor' }),
    accountValueMatches: (expected, actual) => expected === actual,
    page, observedEvent, maxBytes
  });
  vm.runInContext(observerSource, context);
  vm.runInContext('installReportEntryPageObserver(page, observedEvent, maxBytes)', context);
  return { page, events, logs, nativeCalls, context, flush: () => new Promise(resolve => setImmediate(resolve)) };
}

let tested = 0;
async function test(name, run) { await run(); tested++; console.log(`ok ${tested} - ${name}`); }

await test('fetch returns original promise and original response remains readable', async () => {
  const response = new Response(JSON.stringify(payload), { status: 200 });
  const originalPromise = Promise.resolve(response);
  let calls = 0;
  const r = runtime({ fetch: function (...args) { calls++; assert.equal(this, r.page); assert.equal(args[1].body, body); return originalPromise; } });
  const promise = r.page.fetch(endpoint, { method: 'POST', body, headers: { Authorization: 'secret-header' } });
  assert.equal(promise, originalPromise);
  assert.equal(await promise, response);
  assert.deepEqual(await response.json(), payload);
  await r.flush();
  assert.equal(calls, 1);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].outcome, 'complete');
  assert.equal(r.events[0].repUid, 'synthetic-1');
  assert.equal(r.events[0].patientName, 'synthetic-patient');
  assert.equal(r.events[0].title, 'synthetic-exam');
  assert.equal(r.events[0].reportDoctor, 'synthetic-doctor');
  assert.equal(r.events[0].lockUserName, 'synthetic-doctor');
  assert.equal(JSON.stringify(r.events).includes('secret-'), false, 'body, headers and report prose never cross bridge');
});

await test('only same-origin exact POST endpoint is observed', async () => {
  let calls = 0;
  const r = runtime({ fetch: () => { calls++; return Promise.resolve(new Response('{}')); } });
  await r.page.fetch(endpoint, { method: 'GET' });
  await r.page.fetch(`${endpoint}Extra`, { method: 'POST' });
  await r.page.fetch(endpoint.replace('10.10.94.90:22112', 'external.invalid'), { method: 'POST' });
  await r.page.fetch(endpoint.replace('/enter', '/list'), { method: 'POST' });
  await r.flush();
  assert.equal(calls, 4);
  assert.equal(r.events.length, 0);
});

await test('native GET detail route captures decoded report ID without request body', async () => {
  for (const flag of ['false', 'true']) {
    const r = runtime();
    const response = await r.page.fetch(`${endpoint}/synthetic%2D1/${flag}`, { method: 'GET' });
    assert.deepEqual(await response.json(), payload);
    await r.flush();
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].outcome, 'complete');
    assert.equal(r.events[0].repUid, 'synthetic-1');
    assert.equal(r.events[0].requestMethod, 'GET');
    assert.equal(r.events[0].endpointKind, 'report-detail');
  }
});

await test('native GET detail business refusal is observed', async () => {
  const r = runtime({ fetch: () => Promise.resolve(new Response(JSON.stringify({ code: 403, message: 'locked', data: false }))) });
  await r.page.fetch(detailEndpoint);
  await r.flush();
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].outcome, 'rejected');
  assert.equal(r.events[0].repUid, 'synthetic-1');
  assert.equal(r.events[0].code, 403);
});

await test('native GET detail rejects wrong origin method shape or malformed bounded ID', async () => {
  let calls = 0;
  const r = runtime({ fetch: () => { calls++; return Promise.resolve(new Response('{}')); } });
  const ignored = [
    [detailEndpoint, 'POST'], [`${endpoint}/synthetic-1/1`, 'GET'],
    [`${endpoint}/synthetic-1/false/extra`, 'GET'], [`${endpoint}/%2F/false`, 'GET'],
    [`${endpoint}/%E0%A4/false`, 'GET'], [`${endpoint}/${'x'.repeat(97)}/false`, 'GET'],
    [detailEndpoint.replace('10.10.94.90:22112', 'external.invalid'), 'GET']
  ];
  for (const [url, method] of ignored) await r.page.fetch(url, { method });
  await r.flush();
  assert.equal(calls, ignored.length);
  assert.equal(r.events.length, 0);
});

await test('native XHR GET detail records the path report ID', async () => {
  const r = runtime();
  const xhr = new r.page.XMLHttpRequest();
  xhr.open('GET', detailEndpoint, true); xhr.send(); xhr.complete();
  await r.flush();
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].outcome, 'complete');
  assert.equal(r.events[0].repUid, 'synthetic-1');
  assert.equal(r.events[0].requestMethod, 'GET');
  assert.equal(r.nativeCalls.length, 2);
});

await test('GET detail outside an identified radiation report is ignored', async () => {
  for (const href of ['http://10.10.94.90:22112/radiation', 'http://10.10.94.90:22112/radiation/report', 'http://10.10.94.90:22112/other?id=synthetic-1']) {
    const r = runtime();
    r.page.location.href = href;
    await r.page.fetch(detailEndpoint);
    await r.flush();
    assert.equal(r.events.length, 0);
  }
});

await test('fetch business refusal and HTTP refusal are final rejection', async () => {
  for (const [value, status] of [[{ code: 403, message: 'locked', data: false }, 200], [payload, 403]]) {
    const r = runtime({ fetch: () => Promise.resolve(new Response(JSON.stringify(value), { status })) });
    await r.page.fetch(endpoint, { method: 'POST', body });
    await r.flush();
    assert.equal(r.events[0].outcome, 'rejected');
    assert.equal(r.events[0].httpStatus, status);
    assert.equal(r.events[0].code, value.code);
  }
});

await test('fetch rejection reaches original caller and observer records error', async () => {
  const failure = new TypeError('synthetic-failure');
  const originalPromise = Promise.reject(failure);
  const r = runtime({ fetch: () => originalPromise });
  const promise = r.page.fetch(endpoint, { method: 'POST', body });
  assert.equal(promise, originalPromise);
  await assert.rejects(promise, error => error === failure);
  await r.flush();
  assert.equal(r.events[0].error, 'request-rejected');
  assert.equal(r.events[0].errorClass, 'TypeError');
});

await test('fetch parse error and oversized stream leave original unchanged', async () => {
  for (const [responseBody, maxBytes, expected] of [['not json', 1048576, 'response-json-invalid'], ['x'.repeat(80), 32, 'response-too-large']]) {
    const response = new Response(responseBody);
    const r = runtime({ fetch: () => Promise.resolve(response), maxBytes });
    await r.page.fetch(endpoint, { method: 'POST', body });
    assert.equal(await response.text(), responseBody);
    await r.flush();
    assert.equal(r.events[0].outcome, 'error');
    assert.equal(r.events[0].error, expected);
  }
});

await test('XHR native calls and return values survive with one final result', async () => {
  const r = runtime();
  const xhr = new r.page.XMLHttpRequest();
  assert.equal(xhr.open('POST', endpoint, true), 'native-open');
  assert.equal(xhr.send(body), 'native-send');
  xhr.complete();
  xhr.emit('error');
  assert.equal(r.events.length, 0, 'parsing does not run inside native load event');
  await r.flush();
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].outcome, 'complete');
  assert.equal(r.events[0].transport, 'xhr');
  assert.equal(r.nativeCalls.length, 2);
  assert.equal(JSON.stringify(r.events).includes('secret-'), false);
});

await test('XHR JSON and malformed text responses get correct final outcome', async () => {
  const r = runtime({ mode: 'json' });
  const xhr = new r.page.XMLHttpRequest();
  xhr.open('POST', endpoint); xhr.send(body); xhr.complete({ code: 2002, message: 'expired', data: null });
  await r.flush();
  assert.equal(r.events[0].outcome, 'rejected');
  assert.equal(r.events[0].code, 2002);
  const textRuntime = runtime();
  const textXHR = new textRuntime.page.XMLHttpRequest();
  textXHR.open('POST', endpoint); textXHR.send(body); textXHR.complete('malformed');
  await textRuntime.flush();
  assert.equal(textRuntime.events[0].error, 'response-json-invalid');
});

await test('XHR abort timeout and error are observed once without retries', async () => {
  for (const type of ['abort', 'timeout', 'error']) {
    const r = runtime();
    const xhr = new r.page.XMLHttpRequest();
    xhr.open('POST', endpoint); xhr.send(body); xhr.emit(type); xhr.emit(type);
    await r.flush();
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].error, `request-${type}`);
    assert.equal(r.nativeCalls.length, 2, 'observer never makes another request');
  }
});

await test('observer installation is idempotent and records identity mismatches', async () => {
  const r = runtime({ fetch: () => Promise.resolve(new Response(JSON.stringify({ ...payload, data: { ...payload.data, repUid: 'synthetic-other' } }))) });
  const installedFetch = r.page.fetch;
  assert.deepEqual(Array.from(r.page.__JX_AUTO_DIAGNOSE_REPORT_ENTRY_PROTOCOLS__), ['POST-enter', 'GET-report-detail']);
  vm.runInContext('installReportEntryPageObserver(page, observedEvent, maxBytes)', r.context);
  assert.equal(r.page.fetch, installedFetch);
  await r.page.fetch(endpoint, { method: 'POST', body });
  await r.flush();
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].reportIdMatches, false);
});

await test('userscript listener only logs permitted summary keys', async () => {
  const r = runtime();
  const detail = JSON.stringify({
    outcome: 'complete', phase: 'report-enter', repUid: 'synthetic-1', patientName: 'synthetic-patient',
    code: 200, httpStatus: 200, endpointKind: 'radiation-entry', route: '/radiation/report', responseRoute: '/radiation/report',
    routeReportId: 'synthetic-1', responseRouteReportId: 'synthetic-1', reportIdMatches: true,
    headers: { Authorization: 'secret-auth' }, finding: 'secret-prose', record: payload.data
  });
  r.context.detail = detail;
  vm.runInContext('onReportEntryObserved({ detail })', r.context);
  assert.equal(r.logs.length, 1);
  assert.equal(r.logs[0].name, '报告进入完成');
  assert.equal(r.logs[0].detail.recordId, 'synthetic-1');
  assert.equal(r.logs[0].detail.finalReportLoaded, true);
  assert.equal(JSON.stringify(r.logs).includes('secret-'), false);
});

await test('GET detail log is distinct from entry lock and final loading requires current identity', async () => {
  const r = runtime();
  r.context.detail = JSON.stringify({
    outcome: 'complete', phase: 'report-enter', endpointKind: 'report-detail', repUid: 'synthetic-1',
    route: '/radiation/report', responseRoute: '/radiation/report', routeReportId: 'synthetic-1', responseRouteReportId: 'synthetic-other'
  });
  vm.runInContext('onReportEntryObserved({ detail })', r.context);
  assert.equal(r.logs[0].name, '报告详情读取完成');
  assert.equal(r.logs[0].detail.endpointKind, 'report-detail');
  assert.equal(r.logs[0].detail.finalReportLoaded, false, 'navigation to another report cannot prove current report loaded');
});

console.log(`passed ${tested} report-entry observer cases`);
