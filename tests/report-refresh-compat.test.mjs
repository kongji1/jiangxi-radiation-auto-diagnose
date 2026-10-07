import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installReportRefreshCompat, reportRefreshCompatFunctionDeclaration } from '../tools/report-refresh-compat.mjs';

const origin = 'http://synthetic.invalid:22112';
const uid = 'synthetic-report';
function fixture({ state = 'consumed', ticket = true, expiredAt = 1, proof = {}, guard = false } = {}) {
  let identity = { account: 'synthetic-account', auth: 'synthetic-auth', workstation: '105701', key: '["synthetic-account","105701","105701","synthetic-hash"]' };
  let loginName = 'Synthetic Doctor', reloads = 0, serial = 0;
  const intervals = new Map();
  const page = {
    location: { href: `${origin}/radiation/report?id=${uid}`, reload() { reloads++; } },
    document: { querySelector() { return { textContent: loginName }; } },
    setInterval(fn) { const id = ++serial; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); }
  };
  const key = `${identity.key}|${JSON.stringify([uid, false, 0, false])}`;
  const value = { id: 'synthetic-handoff', key, state, status: 200, auth: '', text: '', headers: null, expiresAt: expiredAt, url: `${origin}/api/ct/rays/rep/enter` };
  const tickets = new Map(ticket ? [[key, value]] : []);
  const evidence = {
    transportCompleted: true, outcome: 'complete', phase: 'report-enter', requestMethod: 'POST',
    endpointKind: 'radiation-entry', httpStatus: 200, code: 200, repUid: uid,
    route: '/radiation/report', responseRoute: '/radiation/report', routeReportId: uid,
    responseRouteReportId: uid, responseRepUid: uid, reportDoctor: loginName,
    account: identity.account, workstation: identity.workstation, sessionKey: identity.key,
    deferListReload: guard, ...proof
  };
  const session = () => identity;
  const reportId = () => { const url = new URL(page.location.href); return url.pathname === '/radiation/report' ? url.searchParams.get('id') || '' : ''; };
  return { page, tickets, key, value, evidence, intervals, session, reportId,
    install: (input = evidence) => installReportRefreshCompat(tickets, session, reportId, page, input),
    tick: () => { for (const fn of [...intervals.values()]) fn(); },
    route: path => { page.location.href = path.startsWith('http') ? path : `${origin}${path}`; },
    identity: values => { identity = { ...identity, ...values }; },
    owner: name => { loginName = name; },
    get reloads() { return reloads; }
  };
}
let tested = 0;
async function test(name, run) { await run(); console.log(`ok ${++tested} - ${name}`); }

await test('confirmed historical ticket allows only later native refresh; stage has remains blocked', () => {
  const r = fixture(); const nativeGet = Map.prototype.get;
  const result = r.install();
  assert.equal(result.installed, true); assert.equal(result.confirmedCount, 1);
  assert.equal(r.tickets.get(r.key), undefined);
  assert.equal(r.tickets.has(r.key), true, 'existing stage has gate still rejects duplicate acquisition');
  assert.equal(Map.prototype.get, nativeGet, 'global Map implementation is unchanged');
  assert.equal(Map.prototype.get.call(r.tickets, r.key), r.value, 'spent tombstone remains stored');
  assert.equal(r.value.state, 'consumed');
  assert.equal(r.reloads, 0);
});

await test('expired and discarded states cannot be released; consumed historical expiry is legitimate', () => {
  for (const state of ['pending', 'expired', 'discarded', 'identity-mismatch']) {
    const r = fixture({ state }); assert.equal(r.install().installed, false);
    assert.equal(r.tickets.get(r.key), r.value); assert.equal(r.tickets.has(r.key), true);
  }
  assert.equal(fixture({ expiredAt: 1 }).install().confirmedCount, 1, 'old consumed ticket may be older than staging TTL');
});

await test('future complete event is insufficient without verified transport completion', () => {
  const r = fixture({ proof: { transportCompleted: false } });
  assert.equal(r.install().installed, false); assert.equal(r.tickets.get(r.key), r.value);
  assert.equal(r.page.addEventListener, undefined, 'compat never subscribes to ambiguous old completion events');
});

await test('wrong owner route UID response identity or status stays fail closed', () => {
  for (const proof of [
    { reportDoctor: 'Another Doctor' }, { route: '/radiation' }, { responseRoute: '/radiation' },
    { repUid: 'other' }, { routeReportId: 'other' }, { responseRouteReportId: 'other' }, { responseRepUid: 'other' },
    { account: 'other' }, { workstation: 'other' }, { sessionKey: 'other' },
    { requestMethod: 'GET' }, { endpointKind: 'report-detail' }, { outcome: 'rejected' },
    { httpStatus: 0 }, { code: 2002 }, { phase: 'other' }
  ]) {
    const r = fixture({ proof }); assert.equal(r.install().installed, false);
    assert.equal(r.tickets.get(r.key), r.value);
  }
});

await test('changed session owner or route restores original ticket lookup', () => {
  for (const change of [
    r => r.identity({ key: 'other-session' }), r => r.identity({ account: 'other' }),
    r => r.identity({ workstation: '105712' }), r => r.owner('Another Doctor'),
    r => r.route('/radiation/report?id=other'), r => r.route('/radiation')
  ]) {
    const r = fixture(); r.install(); change(r); assert.equal(r.tickets.get(r.key), r.value);
  }
});

await test('other tickets and noncanonical keys remain untouched', () => {
  const r = fixture(); const otherKey = `${r.session().key}|${JSON.stringify(['other-report', false, 0, false])}`;
  const other = { ...r.value, key: otherKey };
  r.tickets.set(otherKey, other); r.install();
  assert.equal(r.tickets.get(otherKey), other); assert.equal(r.tickets.has(otherKey), true);
  for (const suffix of ['["synthetic-report",false,0,true]', '["synthetic-report",false,1,false]', '["synthetic-report",false,0,false,1]']) {
    const f = fixture(); f.tickets.clear(); const key = `${f.session().key}|${suffix}`;
    f.tickets.set(key, { ...f.value, key }); assert.equal(f.install().installed, false);
  }
});

await test('future state discard and residual payload prevent release', () => {
  const r = fixture(); r.install(); r.value.state = 'discarded'; assert.equal(r.tickets.get(r.key), r.value);
  for (const patch of [{ text: 'unconsumed-response' }, { auth: 'unconsumed-auth' }, { headers: {} }, { status: 403 }, { url: `${origin}/api/ct/rays/rep/enter?other=1` }]) {
    const f = fixture(); Object.assign(f.value, patch); assert.equal(f.install().installed, false);
  }
});

await test('unknown tickets can arm only a deferred reload, without releasing any report', () => {
  const r = fixture({ ticket: false }); const result = r.install({ deferListReload: true });
  assert.equal(result.installed, true); assert.equal(result.confirmedCount, 0);
  assert.equal(result.deferredReloadPending, true);
  assert.equal(Object.hasOwn(r.tickets, 'get'), false);
  r.tick(); assert.equal(r.reloads, 0); assert.equal(result.deferredReloadPending, true);
});

await test('report remains unrefreshed; returning to same-origin list reloads exactly once', () => {
  const r = fixture({ guard: true }); const result = r.install();
  r.tick(); r.tick(); assert.equal(r.reloads, 0); assert.equal(result.deferredReloadPending, true);
  r.route('/radiation?view=pending'); r.tick(); r.tick();
  assert.equal(r.reloads, 1); assert.equal(result.deferredReloadPending, false); assert.equal(r.intervals.size, 0);
  r.install(); r.tick(); assert.equal(r.reloads, 1, 'repeat installation does not rearm after reload');
});

await test('other origin or similar path cannot trigger the reload', () => {
  const r = fixture({ guard: true }); const result = r.install();
  r.route('/radiation/other'); r.tick(); assert.equal(r.reloads, 0);
  r.route('http://other.invalid:22112/radiation'); r.tick();
  assert.equal(r.reloads, 0); assert.equal(result.deferredReloadPending, false); assert.equal(r.intervals.size, 0);
  r.route('/radiation'); r.tick(); assert.equal(r.reloads, 0);
});

await test('stopping and reinstalling cannot rearm the navigation reload', () => {
  const r = fixture({ guard: true }); const result = r.install();
  result.stop(); assert.equal(result.deferredReloadPending, false); assert.equal(r.intervals.size, 0);
  assert.equal(r.install(), result); r.route('/radiation'); r.tick(); assert.equal(r.reloads, 0);
});

await test('defer-only marker accepts later strict historical proof without a new timer', () => {
  const r = fixture(); const result = r.install({ deferListReload: true });
  const originalTimers = [...r.intervals.keys()];
  assert.equal(result.confirmedCount, 0); assert.equal(r.tickets.get(r.key), r.value);
  assert.equal(r.install(r.evidence), result);
  assert.equal(result.confirmedCount, 1); assert.equal(r.tickets.get(r.key), undefined);
  assert.equal(r.tickets.has(r.key), true); assert.deepEqual([...r.intervals.keys()], originalTimers);
  assert.equal(Object.keys(result).includes('confirm'), false);
});

await test('defer-only marker rejects wrong proof or changed session without changing its timer', () => {
  for (const mutate of [
    r => ({ ...r.evidence, reportDoctor: 'Another Doctor' }),
    r => ({ ...r.evidence, transportCompleted: false }),
    r => { r.identity({ key: 'different-session' }); return { ...r.evidence, sessionKey: 'different-session' }; }
  ]) {
    const r = fixture(); const result = r.install({ deferListReload: true });
    const originalTimers = [...r.intervals.keys()]; const proof = mutate(r);
    assert.equal(r.install(proof), result); assert.equal(result.confirmedCount, 0);
    assert.equal(r.tickets.get(r.key), r.value); assert.deepEqual([...r.intervals.keys()], originalTimers);
  }
});

await test('confirmation after stopping releases only the historical ticket and never rearms', () => {
  const r = fixture(); const result = r.install({ deferListReload: true });
  result.stop(); assert.equal(r.intervals.size, 0);
  assert.equal(r.install(r.evidence), result); assert.equal(result.confirmedCount, 1);
  assert.equal(result.deferredReloadPending, false); assert.equal(r.intervals.size, 0);
  r.route('/radiation'); r.tick(); assert.equal(r.reloads, 0);
});

await test('previous frozen defer-only deployment adopts its existing timer without stopping or rearming', () => {
  const r = fixture(); let pending = true, stops = 0;
  const oldTimer = r.page.setInterval(() => {
    if (pending && new URL(r.page.location.href).pathname === '/radiation') {
      pending = false; r.page.clearInterval(oldTimer); r.page.location.reload();
    }
  });
  const previous = { patchVersion: '0.8.56', installed: true, confirmedCount: 0, get deferredReloadPending() { return pending; } };
  Object.defineProperty(previous, 'stop', { value: () => { stops++; pending = false; r.page.clearInterval(oldTimer); } });
  Object.freeze(previous);
  for (const target of [r.tickets, r.page]) Object.defineProperty(target, '__JX_REPORT_REFRESH_COMPAT__', { configurable: true, value: previous });
  const result = r.install(r.evidence);
  assert.notEqual(result, previous); assert.equal(result.confirmedCount, 1);
  assert.equal(stops, 0); assert.deepEqual([...r.intervals.keys()], [oldTimer]);
  assert.equal(result.deferredReloadPending, true); assert.equal(r.tickets.get(r.key), undefined);
  r.route('/radiation'); r.tick(); assert.equal(r.reloads, 1);
  assert.equal(result.deferredReloadPending, false); assert.equal(r.intervals.size, 0);
  r.install(r.evidence); assert.equal(r.intervals.size, 0); assert.equal(stops, 0);
});

await test('markers and return values contain only patch identification booleans and counts', () => {
  const r = fixture({ guard: true }); const result = r.install();
  assert.equal(result, r.page.__JX_REPORT_REFRESH_COMPAT__);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { patchVersion: '0.8.56', installed: true, confirmedCount: 1, deferredReloadPending: true });
  const printed = JSON.stringify(result);
  for (const privateValue of [uid, r.session().auth, r.session().account, r.session().key]) assert.equal(printed.includes(privateValue), false);
});

await test('CDP declaration has no module dependencies and uses only the passed private objects', () => {
  const r = fixture({ guard: true }); const context = vm.createContext({ window: r.page, URL });
  const factory = vm.runInContext(`(${reportRefreshCompatFunctionDeclaration})`, context);
  const result = factory.call(r.tickets, r.session, r.reportId, r.evidence);
  assert.equal(result.confirmedCount, 1); assert.equal(result.deferredReloadPending, true);
  assert.equal(r.tickets.get(r.key), undefined); assert.equal(r.tickets.has(r.key), true);
});

await test('missing capabilities preexisting get override and wrong initial route are untouched', () => {
  assert.equal(installReportRefreshCompat(null, null, null, null, null).installed, false);
  const r = fixture(); const get = () => 'existing-override'; r.tickets.get = get;
  assert.equal(r.install().installed, false); assert.equal(r.tickets.get, get);
  const other = fixture({ guard: true }); other.route('/setting/profile');
  assert.equal(other.install().installed, false); assert.equal(other.intervals.size, 0);
});

console.log(`passed ${tested} report refresh compatibility tests`);
