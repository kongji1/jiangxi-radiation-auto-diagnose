  // 校验通过后提前取得最终进入响应，报告页复用完整响应；同一报告只请求一次。
  // 旁听仍区分提前取得与原生页面载入，只有最终业务响应成功才确认进入。
  const REPORT_ENTRY_EVENT = 'jx-auto-diagnose-report-entry-observed';
  let reportEntryBridgeBound = false;
  function installProtocolEntryHandoff(page) {
    const name = '__JX_PROTOCOL_ENTRY_HANDOFF__';
    if (!page || page[name]) return page?.[name];
    const endpoint = '/api/ct/rays/rep/enter';
    const tickets = new Map(), requests = new WeakMap();
    const prototype = page.XMLHttpRequest?.prototype;
    const native = prototype && Object.fromEntries(['open', 'send', 'abort', 'setRequestHeader', 'getResponseHeader', 'getAllResponseHeaders'].map(key => [key, prototype[key]]));
    const nativeFetch = page.fetch;
    const properties = ['readyState', 'status', 'statusText', 'responseURL', 'response', 'responseText'];
    let serial = 0, ready = false;
    const cookie = name => {
      try {
        const item = String(page.document.cookie || '').split(';').map(value => value.trim()).find(value => value.slice(0, value.indexOf('=')).toLowerCase() === name);
        return item ? decodeURIComponent(item.slice(item.indexOf('=') + 1)) : '';
      } catch (_) { return ''; }
    };
    // The exact AUTH value is held only while the response is pending. The
    // non-reversible tag lets spent tickets reject a replay after it is erased.
    const tag = value => {
      let a = 2166136261, b = 2246822507;
      for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b ^ value.charCodeAt(i), 3266489909); }
      return `${a >>> 0}:${b >>> 0}:${value.length}`;
    };
    const session = () => {
      try {
        const root = page.document.getElementById?.('app');
        const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia || root?.__vueParentComponent?.appContext?.config?.globalProperties?.$pinia;
        const store = pinia?._s?.get?.('user');
        const account = cookie('logincode'), auth = cookie('auth'), workstationCookie = cookie('workstation');
        const workstation = store ? String(store.currentWorkStation || '') : workstationCookie;
        if (!account || !auth || !workstation) return null;
        return { account, auth, workstation, key: JSON.stringify([account, workstationCookie, workstation, tag(auth)]) };
      } catch (_) { return null; }
    };
    const canonical = body => {
      try {
        const value = typeof body === 'string' && body.length <= 4096 ? JSON.parse(body) : body;
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'flag,isList,isRemote,repUid') return null;
        if (typeof value.repUid !== 'string' || !value.repUid || value.repUid.length > 96 || /[/\\\u0000-\u0020\u007f]/.test(value.repUid) || typeof value.isRemote !== 'boolean' || value.isList !== false || ![0, 1].includes(value.flag)) return null;
        return { repUid: value.repUid, key: JSON.stringify([value.repUid, value.isRemote, value.flag, value.isList]), flag: value.flag };
      } catch (_) { return null; }
    };
    const target = (url, method) => {
      try {
        const value = new URL(typeof url === 'string' ? url : url?.url || '', page.location.href);
        return String(method || 'GET').toUpperCase() === 'POST' && value.origin === page.location.origin && value.pathname === endpoint && !value.search && !value.hash ? value.href : '';
      } catch (_) { return ''; }
    };
    const reportId = () => {
      try { const url = new URL(page.location.href); return url.pathname === '/radiation/report' ? url.searchParams.get('id') || '' : ''; }
      catch (_) { return ''; }
    };
    const erase = ticket => {
      ticket.text = ''; ticket.auth = ''; ticket.headers = null;
      if (ticket.timer) page.clearTimeout(ticket.timer);
      ticket.timer = null;
    };
    const lookup = (body, requestHeaders = null) => {
      const payload = canonical(body), identity = session();
      if (!payload || !identity || reportId() !== payload.repUid) return null;
      const ticket = tickets.get(`${identity.key}|${payload.key}`);
      if (!ticket) return null;
      if ((requestHeaders?.get('login-user-key') && requestHeaders.get('login-user-key') !== identity.account) ||
          (requestHeaders?.get('authorization') && requestHeaders.get('authorization') !== identity.auth) ||
          (requestHeaders?.get('workcode') && requestHeaders.get('workcode') !== identity.workstation)) {
        // This exact report and session already sent its lock POST. Identity
        // header differences cannot turn the staged response into a new POST.
        ticket.state = 'identity-mismatch'; erase(ticket); return ticket;
      }
      if (ticket.state === 'pending' && (Date.now() >= ticket.expiresAt || ticket.auth !== identity.auth)) { ticket.state = 'expired'; erase(ticket); }
      return ticket;
    };
    const consume = ticket => {
      if (ticket.state !== 'pending') return null;
      const value = { text: ticket.text, bytes: ticket.bytes, status: ticket.status, statusText: ticket.statusText, headers: ticket.headers, url: ticket.url };
      ticket.state = 'consumed'; erase(ticket);
      return value;
    };
    const restore = xhr => { for (const key of properties) { try { delete xhr[key]; } catch (_) {} } };
    const event = (xhr, type, loaded = 0) => {
      const value = type === 'readystatechange' ? new page.Event(type) : new page.ProgressEvent(type, { lengthComputable: true, loaded, total: loaded });
      xhr.dispatchEvent(value);
    };
    const synthesize = (xhr, meta, response) => {
      const state = { phase: 1, response, cancelled: false, failed: !response, timer: null, json: null };
      if (response && xhr.responseType === 'json') { try { state.json = JSON.parse(response.text); } catch (_) {} }
      meta.synthetic = state;
      Object.defineProperties(xhr, {
        readyState: { configurable: true, get: () => state.phase },
        status: { configurable: true, get: () => !state.failed && state.phase >= 2 ? response.status : 0 },
        statusText: { configurable: true, get: () => !state.failed && state.phase >= 2 ? response.statusText : '' },
        responseURL: { configurable: true, get: () => !state.failed && state.phase >= 2 ? response.url : '' },
        response: { configurable: true, get: () => xhr.responseType === 'json' ? state.phase === 4 && !state.failed ? state.json : null : state.phase >= 3 && !state.failed ? response.text : '' },
        responseText: { configurable: true, get: () => {
          if (xhr.responseType && xhr.responseType !== 'text') throw new page.DOMException('Response is not text', 'InvalidStateError');
          return state.phase >= 3 && !state.failed ? response.text : '';
        } }
      });
      state.timer = page.setTimeout(() => {
        state.timer = null;
        if (state.cancelled) return;
        event(xhr, 'loadstart');
        if (state.cancelled) return;
        if (state.failed) { state.phase = 4; event(xhr, 'readystatechange'); if (!state.cancelled) event(xhr, 'error'); if (!state.cancelled) event(xhr, 'loadend'); return; }
        for (const phase of [2, 3, 4]) {
          state.phase = phase; event(xhr, 'readystatechange');
          if (state.cancelled) return;
          if (phase === 3) { event(xhr, 'progress', response.bytes); if (state.cancelled) return; }
        }
        event(xhr, 'load', response.bytes);
        if (!state.cancelled) event(xhr, 'loadend', response.bytes);
      }, 0);
    };
    const wrapped = {
      open: function (method, url, async = true) {
        const previous = requests.get(this)?.synthetic;
        if (previous) { previous.cancelled = true; if (previous.timer) page.clearTimeout(previous.timer); restore(this); }
        requests.delete(this);
        const value = native.open.apply(this, arguments), endpointUrl = target(url, method);
        if (endpointUrl) requests.set(this, { url: endpointUrl, async: async !== false, headers: new Map() });
        return value;
      },
      setRequestHeader: function (key, value) {
        const result = native.setRequestHeader.apply(this, arguments);
        const meta = requests.get(this);
        if (meta) {
          const name = String(key).toLowerCase();
          if (['authorization', 'login-user-key', 'workcode'].includes(name)) {
            const previous = meta.headers.get(name); meta.headers.set(name, previous ? `${previous}, ${value}` : String(value));
          }
        }
        return result;
      },
      send: function (body) {
        const meta = requests.get(this);
        if (!meta) return native.send.apply(this, arguments);
        if (meta.synthetic) throw new page.DOMException('Request has already been sent', 'InvalidStateError');
        const ticket = lookup(body, meta.headers);
        // Request identity headers are needed only for this synchronous check.
        meta.headers.clear();
        if (!ticket) return native.send.apply(this, arguments);
        // A ticket proves the POST already happened. Unsupported consumers and
        // expired/spent tickets must fail locally, never repeat the lock POST.
        const supported = meta.async && ['', 'text', 'json'].includes(this.responseType || '');
        synthesize(this, meta, supported ? consume(ticket) : null);
        return undefined;
      },
      abort: function () {
        const state = requests.get(this)?.synthetic;
        if (!state) return native.abort.apply(this, arguments);
        const active = !state.cancelled && state.phase > 0 && state.phase < 4;
        state.cancelled = true; state.failed = true; state.response = null; state.json = null;
        if (state.timer) page.clearTimeout(state.timer);
        if (active) { state.phase = 4; event(this, 'readystatechange'); event(this, 'abort'); event(this, 'loadend'); }
        state.phase = 0;
        return undefined;
      },
      getResponseHeader: function (key) {
        const state = requests.get(this)?.synthetic;
        return state ? !state.failed && state.phase >= 2 ? state.response.headers.get(String(key)) : null : native.getResponseHeader.apply(this, arguments);
      },
      getAllResponseHeaders: function () {
        const state = requests.get(this)?.synthetic;
        return state ? !state.failed && state.phase >= 2 ? Array.from(state.response.headers, ([key, value]) => `${key}: ${value}\r\n`).join('') : '' : native.getAllResponseHeaders.apply(this, arguments);
      }
    };
    const deliverFetch = (ticket, signal) => {
      if (signal?.aborted) return Promise.reject(new page.DOMException('Request aborted', 'AbortError'));
      const value = consume(ticket);
      if (!value) return Promise.reject(new TypeError('Entry handoff is no longer available'));
      const response = new page.Response(value.text, { status: value.status, statusText: value.statusText, headers: value.headers });
      Object.defineProperty(response, 'url', { configurable: true, value: value.url });
      return Promise.resolve(response);
    };
    const wrappedFetch = function (input, options) {
      if (!target(input, options?.method || input?.method) || options?.credentials === 'omit') return nativeFetch.apply(this, arguments);
      const headers = new page.Headers(options?.headers || input?.headers || {});
      const ticket = lookup(options?.body, headers);
      if (ticket) return deliverFetch(ticket, options?.signal || input?.signal);
      // Request bodies are asynchronous; only inspect them while a report
      // ticket exists, and forward every nonmatching request unchanged.
      if (options?.body === undefined && typeof input?.clone === 'function' && reportId() && tickets.size) {
        const self = this, args = arguments;
        return input.clone().text().then(body => {
          const requestTicket = lookup(body, headers);
          return requestTicket ? deliverFetch(requestTicket, options?.signal || input?.signal) : nativeFetch.apply(self, args);
        });
      }
      return nativeFetch.apply(this, arguments);
    };
    try {
      if (!native || Object.values(native).some(value => typeof value !== 'function') || typeof nativeFetch !== 'function' || !page.Response || !page.Headers || !page.Event || !page.ProgressEvent || !page.DOMException || !page.setTimeout || !page.clearTimeout) throw new Error('handoff-capability-unavailable');
      const probe = new page.XMLHttpRequest();
      native.open.call(probe, 'POST', new URL(endpoint, page.location.href).href, true);
      if (typeof probe.dispatchEvent !== 'function' || typeof probe.addEventListener !== 'function') throw new Error('handoff-events-unavailable');
      for (const type of ['', 'text', 'json']) { probe.responseType = type; if (probe.responseType !== type) throw new Error('handoff-response-type-unavailable'); }
      let delivered = false;
      probe.onloadend = () => { delivered = true; };
      probe.dispatchEvent(new page.ProgressEvent('loadend'));
      if (!delivered) throw new Error('handoff-loadend-unavailable');
      probe.onloadend = null;
      for (const key of properties) { Object.defineProperty(probe, key, { configurable: true, get: () => 0 }); if (probe[key] !== 0) throw new Error('handoff-property-unavailable'); }
      restore(probe); native.abort.call(probe);
      const response = new page.Response('{}', { status: 200 }); Object.defineProperty(response, 'url', { value: '' });
      for (const key of Object.keys(wrapped)) { prototype[key] = wrapped[key]; if (prototype[key] !== wrapped[key]) throw new Error('handoff-hook-unavailable'); }
      page.fetch = wrappedFetch; if (page.fetch !== wrappedFetch) throw new Error('handoff-fetch-unavailable');
      ready = true;
    } catch (_) {
      if (native) for (const key of Object.keys(wrapped)) { try { if (prototype[key] === wrapped[key]) prototype[key] = native[key]; } catch (_) {} }
      try { if (page.fetch === wrappedFetch) page.fetch = nativeFetch; } catch (_) {}
    }
    const bridge = {
      ready,
      isReady: (responseType = '') => ready && ['', 'text', 'json'].includes(responseType) && !!session(),
      stage: (body, responseText, status = 200, headers = {}, ttl = 15000, statusText = '') => {
        const payload = canonical(body), identity = session();
        if (!ready || !payload || !identity || payload.flag !== (identity.workstation === '105712' ? 1 : 0) || typeof responseText !== 'string' || responseText.length > 1048576) return false;
        const key = `${identity.key}|${payload.key}`;
        if (tickets.has(key)) return false;
        try {
          const bytes = new TextEncoder().encode(responseText).byteLength;
          if (bytes > 1048576) return false;
          JSON.parse(responseText);
          const responseHeaders = new page.Headers(typeof headers === 'string' ? headers.split(/\r?\n/).filter(Boolean).map(line => { const at = line.indexOf(':'); if (at <= 0) throw new Error('invalid-header'); return [line.slice(0, at), line.slice(at + 1).trim()]; }) : headers);
          const response = new page.Response(responseText, { status: Number(status), statusText: String(statusText || ''), headers: responseHeaders });
          const ticket = { id: `entry-handoff:${Date.now()}:${++serial}`, key, auth: identity.auth, text: responseText, bytes, status: response.status, statusText: response.statusText || (response.status === 200 ? 'OK' : ''), headers: responseHeaders, url: new URL(endpoint, page.location.href).href, state: 'pending', expiresAt: Date.now() + Math.max(1, Math.min(15000, Number(ttl) || 15000)), timer: null };
          ticket.timer = page.setTimeout(() => { if (ticket.state === 'pending') ticket.state = 'expired'; erase(ticket); }, ticket.expiresAt - Date.now());
          tickets.set(key, ticket); return ticket.id;
        } catch (_) { return false; }
      },
      discard: id => { const ticket = Array.from(tickets.values()).find(value => value.id === id); if (!ticket) return false; ticket.state = 'discarded'; erase(ticket); return true; },
      peek: id => { const ticket = Array.from(tickets.values()).find(value => value.id === id); return ticket ? { id: ticket.id, expiresAt: ticket.expiresAt, pending: ticket.state === 'pending' && Date.now() < ticket.expiresAt } : null; }
    };
    page[name] = Object.freeze(bridge);
    return page[name];
  }
  function installReportEntryPageObserver(page, eventName, maxBytes = 1048576) {
    if (!page || page.__JX_AUTO_DIAGNOSE_REPORT_ENTRY_BRIDGE__) return;
    const cap = Math.max(1, Math.min(1048576, Number(maxBytes) || 1048576));
    const xhrRequests = new WeakMap();
    let serial = 0;
    const text = (value, length = 160) => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, length) : '';
    const routeIdentity = () => {
      try {
        const url = new URL(page.location.href);
        return { route: url.pathname, routeReportId: text(url.searchParams.get('id'), 96) };
      } catch (_) { return { route: '', routeReportId: '' }; }
    };
    const metadata = (url, method, body, transport) => {
      try {
        const target = new URL(typeof url === 'string' ? url : url?.url || '', page.location.href);
        if (target.origin !== page.location.origin) return null;
        const requestMethod = String(method || 'GET').toUpperCase();
        // The native API has both getReportDetail (GET/id/boolean) and
        // getRadiationDetail (POST). Observe each exact shape, never a prefix.
        const detailMatch = target.pathname.match(/^\/api\/ct\/rays\/rep\/enter\/([^/]{1,288})\/(true|false)$/);
        const postEnter = requestMethod === 'POST' && target.pathname === '/api/ct/rays/rep/enter';
        const getEnter = requestMethod === 'GET' && !!detailMatch;
        if (!postEnter && !getEnter) return null;
        const route = routeIdentity();
        // getReportDetail is also used by other modules. Only watch it while
        // an identified radiation report is open; it is not a lock assertion.
        if (getEnter && (route.route !== '/radiation/report' || !route.routeReportId)) return null;
        let repUid = route.routeReportId;
        if (getEnter) {
          repUid = decodeURIComponent(detailMatch[1]);
          if (!repUid || repUid.length > 96 || /[/\\\u0000-\u0020\u007f]/.test(repUid)) return null;
        }
        // Native Axios sends a small JSON body. Read only repUid, never headers.
        if (postEnter && typeof body === 'string' && body.length <= 4096) {
          try { repUid = text(JSON.parse(body)?.repUid, 96) || repUid; } catch (_) {}
        }
        return { requestId: `native-enter:${Date.now()}:${++serial}`, transport, requestMethod, endpointKind: getEnter ? 'report-detail' : 'radiation-entry', repUid, ...route, startedAt: Date.now() };
      } catch (_) { return null; }
    };
    const publish = (meta, outcome, extra = {}) => {
      try {
        const current = routeIdentity();
        const detail = {
          ...meta, ...extra, outcome, phase: 'report-enter', durationMs: Date.now() - meta.startedAt,
          responseRoute: current.route, responseRouteReportId: current.routeReportId
        };
        page.dispatchEvent(new page.CustomEvent(eventName, { detail: JSON.stringify(detail) }));
      } catch (_) {}
    };
    const result = (meta, payload, httpStatus) => {
      const data = payload?.data;
      const report = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      const responseRepUid = text(report.repUid || report.reportUid || report.reportId || report.id, 96);
      const allowed = httpStatus >= 200 && httpStatus < 300 && payload?.code === 200 && !!data;
      publish(meta, allowed ? 'complete' : 'rejected', {
        httpStatus, code: typeof payload?.code === 'number' || typeof payload?.code === 'string' ? payload.code : null,
        message: text(payload?.message, 240), responseRepUid,
        reportIdMatches: !responseRepUid || !meta.repUid || responseRepUid === meta.repUid,
        patientName: text(report.patName || report.patientName), status: text(report.reportStatus || report.reportStatusName),
        statusCode: text(report.reportStatusCode || report.statusCode, 40),
        reportDoctor: text(report.reportDoc), lockUserName: text(report.lockUserName || report.lockUser),
        modality: text(report.modality, 40), title: text(report.examName || report.reportTitle || report.title),
        responseDataShape: data == null ? 'none' : Array.isArray(data) ? 'array' : typeof data
      });
    };
    const parseText = (meta, responseText, httpStatus) => {
      if (typeof responseText !== 'string' || responseText.length > cap || new TextEncoder().encode(responseText).byteLength > cap) {
        publish(meta, 'error', { httpStatus, error: 'response-too-large-or-unreadable' });
        return;
      }
      try { result(meta, JSON.parse(responseText), httpStatus); }
      catch (_) { publish(meta, 'error', { httpStatus, error: 'response-json-invalid' }); }
    };
    const inspectFetch = async (response, meta) => {
      const httpStatus = Number(response.status) || 0;
      let reader;
      try {
        const length = Number(response.headers?.get('content-length'));
        if (Number.isFinite(length) && length > cap) {
          publish(meta, 'error', { httpStatus, error: 'response-too-large' }); return;
        }
        const clone = response.clone();
        if (!clone.body?.getReader) {
          // Without a streaming reader only a declared, bounded response is safe.
          if (!(length > 0 && length <= cap)) {
            publish(meta, 'error', { httpStatus, error: 'response-reader-unavailable' }); return;
          }
          parseText(meta, await clone.text(), httpStatus); return;
        }
        reader = clone.body.getReader();
        const decoder = new TextDecoder();
        let size = 0, body = '';
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > cap) {
            // Cancel only the clone branch; the application's original is untouched.
            Promise.resolve(reader.cancel()).catch(() => {});
            publish(meta, 'error', { httpStatus, error: 'response-too-large' }); return;
          }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        parseText(meta, body, httpStatus);
      } catch (error) {
        publish(meta, 'error', { httpStatus, error: 'response-read-failed', errorClass: text(error?.name, 60) });
      } finally { try { reader?.releaseLock(); } catch (_) {} }
    };
    let installed = false;
    if (typeof page.fetch === 'function') {
      const nativeFetch = page.fetch;
      page.fetch = function () {
        const [input, options] = arguments;
        const meta = metadata(input, options?.method || input?.method || 'GET', options?.body, 'fetch');
        let promise;
        try { promise = nativeFetch.apply(this, arguments); }
        catch (error) {
          if (meta) Promise.resolve().then(() => publish(meta, 'error', { httpStatus: 0, error: 'request-threw', errorClass: text(error?.name, 60) }));
          throw error;
        }
        if (meta) promise.then(
          response => { inspectFetch(response, meta).catch(() => {}); },
          error => { publish(meta, 'error', { httpStatus: 0, error: 'request-rejected', errorClass: text(error?.name, 60) }); }
        );
        // Preserve native promise identity, timing and rejection for the caller.
        return promise;
      };
      installed = true;
    }
    const prototype = page.XMLHttpRequest?.prototype;
    if (prototype && typeof prototype.open === 'function' && typeof prototype.send === 'function') {
      const nativeOpen = prototype.open, nativeSend = prototype.send;
      prototype.open = function (method, url) {
        const value = nativeOpen.apply(this, arguments);
        xhrRequests.delete(this);
        const meta = metadata(url, method, null, 'xhr');
        if (meta) xhrRequests.set(this, meta);
        return value;
      };
      prototype.send = function (body) {
        const meta = xhrRequests.get(this);
        if (!meta) return nativeSend.apply(this, arguments);
        if (meta.requestMethod === 'POST' && typeof body === 'string' && body.length <= 4096) {
          try { meta.repUid = text(JSON.parse(body)?.repUid, 96) || meta.repUid; } catch (_) {}
        }
        meta.startedAt = Date.now();
        let finished = false;
        const cleanup = () => {
          for (const name of ['load', 'error', 'abort', 'timeout']) this.removeEventListener(name, finish);
        };
        const finish = event => {
          if (finished) return;
          finished = true; cleanup();
          const httpStatus = Number(this.status) || 0;
          if (event.type !== 'load') {
            Promise.resolve().then(() => publish(meta, 'error', { httpStatus, error: `request-${event.type}` })); return;
          }
          try {
            // Snapshot completed native values before an application reuses the XHR.
            const type = this.responseType;
            const payload = type === 'json' ? this.response : null;
            const responseText = !type || type === 'text' ? this.responseText : null;
            Promise.resolve().then(() => type === 'json' ? result(meta, payload, httpStatus) : parseText(meta, responseText, httpStatus)).catch(() => {});
          } catch (_) {
            Promise.resolve().then(() => publish(meta, 'error', { httpStatus, error: 'response-read-failed' }));
          }
        };
        for (const name of ['load', 'error', 'abort', 'timeout']) this.addEventListener(name, finish);
        try { return nativeSend.apply(this, arguments); }
        catch (error) {
          if (!finished) {
            finished = true; cleanup();
            Promise.resolve().then(() => publish(meta, 'error', { httpStatus: 0, error: 'request-threw', errorClass: text(error?.name, 60) }));
          }
          throw error;
        }
      };
      installed = true;
    }
    if (installed) {
      page.__JX_AUTO_DIAGNOSE_REPORT_ENTRY_BRIDGE__ = true;
      page.__JX_AUTO_DIAGNOSE_REPORT_ENTRY_PROTOCOLS__ = Object.freeze(['POST-enter', 'GET-report-detail']);
    }
  }

  function onReportEntryObserved(event) {
    let detail = event?.detail;
    if (typeof detail !== 'string' || detail.length > 6000) return;
    try { detail = JSON.parse(detail); } catch (_) { return; }
    if (!['complete', 'rejected', 'error'].includes(detail?.outcome) || detail.phase !== 'report-enter') return;
    const bounded = (value, max = 160) => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';
    const repUid = bounded(detail.repUid || detail.routeReportId || detail.responseRepUid, 96);
    const endpointKind = detail.endpointKind === 'report-detail' ? 'report-detail' : 'radiation-entry';
    const matchesCurrentReport = !!repUid && detail.route === '/radiation/report' && detail.responseRoute === '/radiation/report' &&
      bounded(detail.routeReportId, 96) === repUid && bounded(detail.responseRouteReportId, 96) === repUid && detail.reportIdMatches !== false;
    const record = {
      key: repUid ? `rep:${repUid}` : '', recordId: repUid,
      patientName: bounded(detail.patientName), status: bounded(detail.status), statusCode: bounded(detail.statusCode, 40),
      reportDoctor: bounded(detail.reportDoctor), lockUserName: bounded(detail.lockUserName),
      modality: bounded(detail.modality, 40), title: bounded(detail.title), source: 'native-report-enter', phase: 'report-enter',
      requestId: bounded(detail.requestId, 96), transport: bounded(detail.transport, 16), requestMethod: bounded(detail.requestMethod, 8), endpointKind,
      httpStatus: Number(detail.httpStatus) || 0, code: typeof detail.code === 'number' ? detail.code : bounded(detail.code, 40) || null,
      serverMessage: bounded(detail.message, 240), error: bounded(detail.error, 80), errorClass: bounded(detail.errorClass, 60),
      durationMs: Math.max(0, Number(detail.durationMs) || 0), responseRepUid: bounded(detail.responseRepUid, 96),
      routeReportId: bounded(detail.routeReportId, 96), responseRouteReportId: bounded(detail.responseRouteReportId, 96),
      route: bounded(detail.route, 80), responseRoute: bounded(detail.responseRoute, 80), reportIdMatches: detail.reportIdMatches !== false,
      responseDataShape: bounded(detail.responseDataShape, 20), finalReportLoaded: detail.outcome === 'complete' && matchesCurrentReport
    };
    const label = endpointKind === 'report-detail' ? '报告详情读取' : '报告进入';
    // Clone parsing may finish after the acquisition flag has cleared. Use
    // the captured request route instead of timing to distinguish pre-acquire.
    if (endpointKind === 'radiation-entry' && record.requestMethod === 'POST' &&
        (detail.route !== '/radiation/report' || bounded(detail.routeReportId, 96) !== repUid)) {
      developerLog('提前协议进入响应旁听', { ...record, phase: 'protocol-acquire-observed', finalReportLoaded: false });
      return;
    }
    const name = `${label}${detail.outcome === 'complete' ? '完成' : detail.outcome === 'rejected' ? '拒绝' : '异常'}`;
    developerLog(name, record, { force: true });
    if (endpointKind === 'radiation-entry' && record.requestMethod === 'POST' && repUid) {
      const pending = pendingFinalEntryState();
      const startedAt = Number(detail.startedAt) || (Date.now() - record.durationMs);
      const automaticAttempt = pending?.repUid === repUid && pending.entryKey && pending.entryToken && startedAt >= pending.startedAt;
      const currentAccountName = norm(loginIdentity().name);
      const ownerMatches = !!currentAccountName && !!record.reportDoctor && accountValueMatches(currentAccountName, norm(record.reportDoctor));
      const explicitOwnerMismatch = !!currentAccountName && !!record.reportDoctor && !ownerMatches;
      const enteredData = { key: `rep:${repUid}`, __automaticEntryKey: pending?.entryKey || `rep:${repUid}`, __automaticEntryToken: pending?.entryToken || '' };
      const acquisition = readAutomaticEntry(`rep:${repUid}`);
      const handoffFailed = automaticAttempt && acquisition?.confirmed === true && acquisition.reason === 'protocol-final-acquired' &&
        (detail.outcome !== 'complete' || !matchesCurrentReport || explicitOwnerMismatch);
      if (handoffFailed) {
        stopAutoOpenAfterAcquisitionFailure('已取得报告，原生页面载入未完成');
      } else if (detail.outcome === 'complete' && matchesCurrentReport && !explicitOwnerMismatch && (automaticAttempt || ownerMatches)) {
        consumeAutomaticEntry(enteredData, automaticAttempt ? 'automatic-native-complete' : 'manual-native-complete', true);
      } else if (automaticAttempt && detail.outcome === 'rejected') {
        if (/锁定|占用|其他用户/.test(record.serverMessage)) consumeAutomaticEntry(enteredData, 'server-locked-other');
        else releaseAutomaticEntry(enteredData, `native-${detail.outcome}`);
      }
    }
    if (endpointKind === 'radiation-entry' && detail.outcome === 'complete' && matchesCurrentReport && record.reportDoctor) {
      const currentAccountName = norm(loginIdentity().name);
      if (currentAccountName && !accountValueMatches(currentAccountName, record.reportDoctor)) {
        developerLog('报告进入后所属医生不匹配', {
          ...record, currentAccountName, reportOwnerMatches: false, reason: '最终进入响应的诊断医生与当前登录账号不同'
        }, { force: true });
      }
    }
    completeFinalEntryPending({ ...detail, repUid, endpointKind });
  }

  function installReportEntryBridge() {
    if (reportEntryBridgeBound || pageWindow().location.host !== '10.10.94.90:22112') return;
    reportEntryBridgeBound = true;
    window.addEventListener(REPORT_ENTRY_EVENT, onReportEntryObserved);
    const inject = () => {
      const root = document.documentElement || document.head || document.body;
      if (!root) return false;
      try {
        const script = document.createElement('script');
        script.textContent = `(${installProtocolEntryHandoff.toString()})(window);(${installReportEntryPageObserver.toString()})(window,${JSON.stringify(REPORT_ENTRY_EVENT)})`;
        root.appendChild(script); script.remove();
        return true;
      } catch (_) { return false; }
    };
    if (inject()) return;
    // At document-start the root can be absent; install when it first appears,
    // before waiting for DOMContentLoaded and the report component's mount.
    const observer = new MutationObserver(() => { if (inject()) observer.disconnect(); });
    observer.observe(document, { childList: true });
    document.addEventListener('DOMContentLoaded', () => { inject(); observer.disconnect(); }, { once: true });
  }

  let realtimeBridgeBound = false;
  function onRealtimeHint(event) {
    let detail = event?.detail;
    if (typeof detail === 'string') {
      try { detail = JSON.parse(detail); } catch (_) { detail = null; }
    }
    if (detail && typeof detail === 'object') processRealtimeHint(detail);
  }
  function installRealtimeHintBridge() {
    if (realtimeBridgeBound || !config.realtimeHints) return;
    realtimeBridgeBound = true;
    window.addEventListener(REALTIME_HINT_EVENT, onRealtimeHint);
    const page = pageWindow();
    if (page.__JX_AUTO_DIAGNOSE_WS_BRIDGE__) return;
    const inject = () => {
      const root = document.documentElement || document.head || document.body;
      if (!root) return;
      try {
        const source = function (eventName) {
          try {
            const NativeWebSocket = window.WebSocket;
            if (!NativeWebSocket || NativeWebSocket.__jxAutoDiagnoseWrapped) return;
            const attached = new WeakSet();
            const nativeSend = NativeWebSocket.prototype.send;
            const copyKeys = ['repUid', 'reportUid', 'reportId', 'id', 'patName', 'patientName', 'patId', 'gender', 'sex', 'patAge', 'age', 'patSourceValue', 'patSource', 'source', 'encounterType', 'visitType', 'patType', 'reportStatus', 'reportStatusName', 'reportStatusCode', 'checkStatusName', 'checkStatusCode', 'status', 'isLock', 'isLocked', 'locked', 'lock', 'lockedByOther', 'lockStatus', 'lockUser', 'lockUserName', 'lockReason', 'occupyStatus', 'occupyUser', 'isOccupied', 'modality', 'modalityName', 'checkinTime', 'applyTime', 'initiateTime', 'checkTime', 'studyDate', 'examName', 'exam', 'applyOrgName', 'applyOrg', 'applyOrgCode', 'applyNo', 'applicationNo', 'orderId', 'imageStatus', 'imageIsChange', 'repTime', 'diagnosisTime', 'reportDoc', 'auditDoc', 'auditDoctor', 'conclusion', 'reportConclusion', 'diagnosisConclusion', 'opinion', 'reportOpinion', 'description', 'reportDescription', 'reportDesc', 'remark', 'remarkText', 'checkOrgName', 'checkOrg', 'checkOrgId', 'emgFlag', 'pushType'];
            const attach = (socket, suppliedUrl) => {
              const url = String(suppliedUrl || socket?.url || '');
              if (!/\/api\/ct\/websocket(?:\?|$)/.test(url) || attached.has(socket)) return;
              attached.add(socket);
              socket.addEventListener('message', event => {
                if (typeof event.data !== 'string' || event.data.length > 200000) return;
                let envelope;
                try { envelope = JSON.parse(event.data); } catch (_) { return; }
                if (!envelope || envelope.type === 'pong' || envelope.type === 'ping') return;
                const code = envelope.code;
                if (code !== undefined && code !== null && String(code) !== '200') return;
                let item = code !== undefined && code !== null
                  ? (envelope.data ?? envelope.result ?? envelope.payload)
                  : (envelope.data ?? envelope.result ?? envelope.payload ?? envelope);
                if (typeof item === 'string') {
                  try { item = JSON.parse(item); } catch (_) { return; }
                }
                for (let depth = 0; depth < 3 && item && !Array.isArray(item) && !item.repUid && !item.reportUid && !item.reportId && !item.id; depth++) {
                  if (item.data && typeof item.data === 'object') item = item.data;
                  else if (item.result && typeof item.result === 'object') item = item.result;
                  else break;
                }
                const candidates = Array.isArray(item) ? item.slice(0, 10) : [item];
                for (const value of candidates) {
                  if (!value || typeof value !== 'object' || value.pushType === 'dicomChange') continue;
                  const repUid = value.repUid || value.reportUid || value.reportId || value.id || '';
                  const hasIdentity = repUid || value.applyNo || value.applicationNo || value.orderId || value.patName || value.patientName || value.checkinTime || value.applyTime || value.examName || value.exam;
                  if (!hasIdentity) continue;
                  const record = {};
                  for (const key of copyKeys) if (value[key] !== undefined && value[key] !== null) record[key] = value[key];
                  window.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify({ repUid, record }) }));
                }
              });
            };
            function WrappedWebSocket(url, protocols) {
              const socket = arguments.length > 1 ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
              attach(socket, url);
              return socket;
            }
            WrappedWebSocket.prototype = NativeWebSocket.prototype;
            try { Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket); } catch (_) {}
            for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
              try { Object.defineProperty(WrappedWebSocket, key, { value: NativeWebSocket[key] }); } catch (_) {}
            }
            try {
              NativeWebSocket.prototype.send = function () {
                attach(this, this.url);
                return nativeSend.apply(this, arguments);
              };
            } catch (_) {}
            WrappedWebSocket.__jxAutoDiagnoseWrapped = true;
            window.WebSocket = WrappedWebSocket;
            window.__JX_AUTO_DIAGNOSE_WS_BRIDGE__ = true;
          } catch (_) {}
        };
        const script = document.createElement('script');
        script.textContent = `(${source.toString()})(${JSON.stringify(REALTIME_HINT_EVENT)})`;
        root.appendChild(script);
        script.remove();
      } catch (e) {
        console.debug('[自动诊断] 实时推送桥接安装失败，将使用轻量状态探测', String(e));
      }
    };
    if (document.documentElement) inject();
    else document.addEventListener('DOMContentLoaded', inject, { once: true });
  }

