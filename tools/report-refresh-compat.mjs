// A one-page, in-memory repair for an already loaded 0.8.55 report.
// The caller obtains these private closure objects through the local CDP session.
// No report request, persistent data, global Map prototype, or report text is changed.
export function installReportRefreshCompat(tickets, sessionFn, reportIdFn, page, evidence) {
  const markerName = '__JX_REPORT_REFRESH_COMPAT__';
  const fail = () => ({ patchVersion: '0.8.56', confirmedCount: 0, deferredReloadPending: false, installed: false });
  if (!tickets || typeof tickets.get !== 'function' || typeof tickets.has !== 'function' ||
      typeof sessionFn !== 'function' || typeof reportIdFn !== 'function' || !page?.document) return fail();
  const previous = Object.getOwnPropertyDescriptor(tickets, markerName)?.value;
  if (previous && typeof previous.confirm === 'function') { previous.confirm(evidence); return previous; }
  // Adopt the first deployed defer-only marker without replacing its running
  // timer. Its properties were deliberately configurable; stop still delegates
  // to that timer's original closure. A confirmed/foreign marker is not changed.
  const adopted = previous?.patchVersion === '0.8.56' && previous.installed === true &&
    previous.confirmedCount === 0 && typeof previous.stop === 'function' &&
    Object.getOwnPropertyDescriptor(tickets, markerName)?.configurable === true &&
    Object.getOwnPropertyDescriptor(page, markerName)?.value === previous &&
    Object.getOwnPropertyDescriptor(page, markerName)?.configurable === true;
  if (previous && !adopted) return previous;
  if (Object.getOwnPropertyDescriptor(tickets, 'get') || (Object.getOwnPropertyDescriptor(page, markerName) && !adopted)) return fail();
  const normalize = value => String(value || '').normalize('NFC').replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
  const owner = () => {
    for (const selector of [
      '.user-wrap .avatar-wrapper > div > div:first-child span',
      '.header-right .user-wrap .avatar-wrapper span:not(.el-tooltip__trigger)',
      '.avatar-wrapper span:not(.el-tooltip__trigger)',
      '[class*="user-wrap"] [class*="avatar-wrapper"] > div > div:first-child span'
    ]) {
      const name = normalize(page.document.querySelector?.(selector)?.textContent);
      if (name) return name;
    }
    const wrap = page.document.querySelector?.('.user-wrap, [class*="user-wrap"]');
    return String(wrap?.innerText || '').split(/\r?\n/).map(normalize).find(Boolean) || '';
  };
  const context = () => {
    try {
      const identity = sessionFn(), uid = reportIdFn(), url = new URL(page.location.href);
      if (!identity?.key || !identity.account || !identity.auth || !identity.workstation ||
          !uid || url.pathname !== '/radiation/report' || url.searchParams.get('id') !== uid) return null;
      return { identity, uid, url, owner: owner() };
    } catch (_) { return null; }
  };
  const initial = context();
  // Old 0.8.55 emits the observation from an XHR load snapshot, even if a later
  // listener aborts before loadend. Only explicit historical transport evidence
  // may release a ticket; future observation events alone are insufficient.
  const proofValid = (proof, current) => initial && current && current.owner && proof && proof.transportCompleted === true && !(
      proof.outcome !== 'complete' || proof.phase !== 'report-enter' || proof.requestMethod !== 'POST' ||
      proof.endpointKind !== 'radiation-entry' || proof.httpStatus !== 200 || proof.code !== 200 ||
      proof.route !== '/radiation/report' || proof.responseRoute !== '/radiation/report' ||
      proof.repUid !== current.uid || proof.routeReportId !== current.uid ||
      proof.responseRouteReportId !== current.uid || proof.responseRepUid !== current.uid ||
      proof.account !== current.identity.account || proof.workstation !== current.identity.workstation ||
      proof.sessionKey !== current.identity.key || normalize(proof.reportDoctor) !== current.owner);
  const originalGet = tickets.get;
  const confirmed = new Set();
  const validTicket = (key, ticket, current) => {
    try {
      if (!initial || !current || current.uid !== initial.uid || current.owner !== initial.owner ||
          current.identity.key !== initial.identity.key || current.identity.account !== initial.identity.account ||
          current.identity.workstation !== initial.identity.workstation || typeof key !== 'string' ||
          !key.startsWith(`${current.identity.key}|`) || ticket?.key !== key || ticket.state !== 'consumed' ||
          ticket.status !== 200 || ticket.auth !== '' || ticket.text !== '' || ticket.headers !== null) return false;
      const canonical = JSON.parse(key.slice(current.identity.key.length + 1));
      if (!Array.isArray(canonical) || canonical.length !== 4 || canonical[0] !== current.uid ||
          typeof canonical[1] !== 'boolean' || canonical[2] !== (current.identity.workstation === '105712' ? 1 : 0) ||
          canonical[3] !== false || JSON.stringify(canonical) !== key.slice(current.identity.key.length + 1)) return false;
      const endpoint = new URL(ticket.url, current.url);
      return endpoint.origin === current.url.origin && endpoint.pathname === '/api/ct/rays/rep/enter' &&
        !endpoint.search && !endpoint.hash;
    } catch (_) { return false; }
  };
  const get = function (key) {
    const ticket = originalGet.call(this, key);
    return this === tickets && confirmed.has(key) && validTicket(key, ticket, context()) ? undefined : ticket;
  };
  const confirm = proof => {
    const current = context();
    if (!proofValid(proof, current)) return false;
    const matches = [];
    for (const [key, ticket] of tickets) if (validTicket(key, ticket, current)) matches.push(key);
    if (matches.length !== 1) return false;
    if (!confirmed.size) Object.defineProperty(tickets, 'get', { configurable: true, writable: true, value: get });
    confirmed.add(matches[0]);
    return true;
  };
  confirm(evidence);
  let route;
  try { route = new URL(page.location.href); } catch (_) { return fail(); }
  const guard = !adopted && evidence?.deferListReload === true && route.pathname === '/radiation/report' &&
    !!route.searchParams.get('id') && typeof page.setInterval === 'function' &&
    typeof page.clearInterval === 'function' && typeof page.location.reload === 'function';
  if (!confirmed.size && !guard && !adopted) return fail();
  let timer = null, pending = guard;
  const stop = () => { pending = false; if (adopted) previous.stop(); if (timer !== null) page.clearInterval(timer); timer = null; };
  const state = {
    patchVersion: '0.8.56', installed: true,
    get confirmedCount() { return confirmed.size; },
    get deferredReloadPending() { return adopted ? previous.deferredReloadPending : pending; }
  };
  Object.defineProperty(state, 'stop', { value: stop });
  Object.defineProperty(state, 'confirm', { value: confirm });
  Object.freeze(state);
  Object.defineProperty(tickets, markerName, { configurable: true, value: state });
  Object.defineProperty(page, markerName, { configurable: true, value: state });
  if (guard) {
    timer = page.setInterval(() => {
      if (!pending) return;
      try {
        const current = new URL(page.location.href);
        if (current.origin !== route.origin) { stop(); return; }
        if (current.pathname === '/radiation') { stop(); page.location.reload(); }
      } catch (_) { stop(); }
    }, 250);
  }
  return state;
}

// Runtime.callFunctionOn objectId=tickets, with session/reportId function objects
// and the explicitly verified historical evidence as arguments. The result has
// booleans/counts only; no UID, account, auth, report content or cookie is returned.
export const reportRefreshCompatFunctionDeclaration = `function(sessionFn, reportIdFn, evidence) {
  return (${installReportRefreshCompat.toString()})(this, sessionFn, reportIdFn, window, evidence);
}`;
