  function norm(s) {
    return String(s ?? '').normalize('NFC').replace(/[\s\u200B-\u200D\uFEFF]+/g, '').trim();
  }
  function pageWindow() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }
  function debugCredentialShape(value) {
    const text = String(value || '');
    return { present: !!text, length: text.length, hash: text ? debugHash(text) : '' };
  }
  function debugAuthContext(headers = {}) {
    const cookieNames = String(document.cookie || '').split(';').map(x => x.trim().split('=')[0]).filter(Boolean);
    return {
      cookieNames,
      authCookie: debugCredentialShape(readCookie('Auth')),
      loginCodeCookie: debugCredentialShape(readCookie('LoginCode')),
      workstationCookie: debugCredentialShape(readCookie('WorkStation')),
      authorizationHeader: debugCredentialShape(headers.Authorization),
      loginUserKeyHeader: debugCredentialShape(headers['LOGIN-USER-KEY']),
      loginUserUidHeader: debugCredentialShape(headers['LOGIN-USER-UID']),
      userInfoHeader: debugCredentialShape(headers['USER-INFO']),
      workCodeHeader: debugCredentialShape(headers.WORKCODE),
      clientIpHeader: debugCredentialShape(headers['LOGIN-CLIENT-IP']),
      signHeader: debugCredentialShape(headers.sign),
      sessionIdentityLoaded: !!sessionIdentity.info,
      clientIpPresent: !!clientIp
    };
  }
  // 按业务前端的会话拦截器补齐认证和登录用户请求头；原始值只在当前请求内使用，
  // 调试记录仅保存存在性、长度和不可逆短哈希，便于判断 TOKEN_FAIL 的会话阶段。
  function sessionHeaders(input = {}) {
    const headers = { ...input };
    const auth = readCookie('Auth');
    if (auth && !headers.Authorization) headers.Authorization = auth;
    const info = sessionIdentity.info;
    const loginCode = norm(info?.logincode || readCookie('LoginCode'));
    if (loginCode && !headers['LOGIN-USER-KEY']) headers['LOGIN-USER-KEY'] = loginCode;
    const uid = norm(info?.uid);
    if (uid && !headers['LOGIN-USER-UID']) headers['LOGIN-USER-UID'] = uid;
    if (clientIp && !headers['LOGIN-CLIENT-IP']) headers['LOGIN-CLIENT-IP'] = clientIp;
    // 与页面拦截器保持一致；不发送菜单/工作站等大字段，也不持久化用户信息。
    if (info && !info.admin && !headers['USER-INFO']) {
      const safeInfo = { ...info };
      for (const key of ['menuList', 'workStationList', 'modalityList', 'consortium']) delete safeInfo[key];
      try { headers['USER-INFO'] = encodeURIComponent(JSON.stringify(safeInfo)); } catch (_) {}
    }
    try {
      const sign = pageWindow().sessionStorage?.getItem('shareSignKey');
      if (sign && !headers.sign) headers.sign = sign;
    } catch (_) {}
    const workCode = readCookie('WorkStation');
    if (workCode && !headers.WORKCODE) headers.WORKCODE = workCode;
    developerLog('认证上下文', debugAuthContext(headers));
    return headers;
  }
  async function ensureClientIp() {
    if (clientIp) return clientIp;
    if (clientIpRequest) return clientIpRefreshInBackground ? clientIp : clientIpRequest;
    if (Date.now() < clientIpRetryAfter || typeof RTCPeerConnection === 'undefined') return clientIp;
    const refreshInBackground = clientIpRetryAfter > 0;
    const request = new Promise(resolve => {
      let peer;
      let finished = false;
      let timeout;
      const done = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        try { peer?.close?.(); } catch (_) {}
        if (value) { clientIp = value; clientIpRetryAfter = 0; }
        // mDNS 或受限 WebRTC 可能始终不给数值地址，不能让每个业务请求都等 1.8 秒。
        else clientIpRetryAfter = Date.now() + 60000;
        resolve(clientIp);
      };
      timeout = setTimeout(() => done(''), 1800);
      try {
        peer = new RTCPeerConnection({ iceServers: [] });
        peer.createDataChannel('');
        peer.onicecandidate = event => {
          if (!event?.candidate) { done(''); return; }
          const candidate = event?.candidate?.candidate || '';
          const match = candidate.match(/(?:^|\s)([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){7})(?:\s|$)/i);
          if (match) done(match[1]);
        };
        peer.onicegatheringstatechange = () => {
          if (peer.iceGatheringState === 'complete') done('');
        };
        peer.createOffer().then(offer => peer.setLocalDescription(offer)).catch(() => done(''));
      } catch (_) { done(''); }
    });
    const sharedRequest = request.then(value => {
      if (clientIpRequest === sharedRequest) {
        clientIpRequest = null;
        clientIpRefreshInBackground = false;
      }
      return value;
    });
    clientIpRequest = sharedRequest;
    clientIpRefreshInBackground = refreshInBackground;
    // 首次准备仍被请求链等待；失败后的定期重试只在后台进行，不反复阻塞业务请求。
    return refreshInBackground ? clientIp : sharedRequest;
  }
  async function ensureSessionIdentity() {
    const now = Date.now();
    if (sessionIdentityRequest) return sessionIdentityRequest;
    if (sessionIdentity.uid && now - sessionIdentity.loadedAt < 10 * 60 * 1000) return;
    if (!sessionIdentity.uid && now - sessionIdentity.lastAttemptAt < 30000) return;
    sessionIdentity.loading = true;
    sessionIdentity.lastAttemptAt = now;
    const request = (async () => {
      const startedAt = Date.now();
      try {
        const { response, payload } = await fetchJson('/api/admin/user/info', {
          method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, __tokenRecoveryRetry: true
        }, 5000);
        const info = payload?.data;
        if (response.ok && payload?.code === 200 && info && typeof info === 'object') {
          sessionIdentity = { info, uid: norm(info.uid), loading: false, lastAttemptAt: now, loadedAt: Date.now() };
          return;
        }
      } catch (_) {}
      finally {
        sessionIdentity.loading = false;
        developerLog('会话身份准备完成', { durationMs: Date.now() - startedAt, loaded: !!sessionIdentity.uid });
      }
    })();
    sessionIdentityRequest = request;
    try { return await request; }
    finally { if (sessionIdentityRequest === request) sessionIdentityRequest = null; }
  }
  async function fetchJson(url, options = {}, timeoutMs = 4500) {
    const page = pageWindow();
    const request = typeof page.fetch === 'function' ? page.fetch.bind(page) : fetch;
    const run = async requestOptions => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 4500));
      try {
        const preparationStartedAt = Date.now();
        await ensureClientIp();
        const clientIpWaitMs = Date.now() - preparationStartedAt;
        const { __tokenRecoveryRetry: _internalRetry, __hintAt: hintAt, __identityWaitMs: identityWaitMs, __requestId: requestId, ...networkOptions } = requestOptions;
        const requestHeaders = sessionHeaders(networkOptions.headers || {});
        const networkStartedAt = Date.now();
        const responsePromise = request(url, { ...networkOptions, headers: requestHeaders, signal: controller.signal });
        const timing = {
          requestId: String(requestId || '').slice(0, 128),
          networkStartedAt,
          preparationMs: networkStartedAt - preparationStartedAt,
          identityWaitMs: Math.max(0, Number(identityWaitMs) || 0),
          clientIpWaitMs,
          hintToNetworkMs: Number(hintAt) > 0 ? Math.max(0, networkStartedAt - Number(hintAt)) : null,
          withinOneSecond: Number(hintAt) > 0 ? networkStartedAt - Number(hintAt) <= 1000 : null
        };
        // 在真正调用 fetch 后记录；此前的“列表请求发起”只代表调度开始。
        developerLog('协议网络请求发起', { path: String(url).split('?')[0], method: String(networkOptions.method || 'GET').toUpperCase(), ...timing, clientIpPresent: !!clientIp, clientIpRetryDeferred: !clientIp && Date.now() < clientIpRetryAfter });
        const response = await responsePromise;
        let payload = null;
        try { payload = await response.json(); } catch (_) {}
        timing.networkDurationMs = Date.now() - networkStartedAt;
        developerLog('协议响应认证上下文', { path: String(url).split('?')[0], code: payload?.code ?? null, auth: debugAuthContext(requestHeaders), ...timing });
        return { response, payload, timing };
      } finally { clearTimeout(timeout); }
    };
    const result = await run(options);
    // TOKEN_FAIL 常见于页面从门户跳转后旧的用户头已失效；只在明确的 2002
    // 返回时刷新一次会话身份并重试，避免把正常请求变成双倍流量。
    if (result.payload?.code === 2002 && !options.__tokenRecoveryRetry && Date.now() - tokenRecoveryLastAt >= 15000) {
      tokenRecoveryLastAt = Date.now();
      sessionIdentity = { info: null, uid: '', loading: false, lastAttemptAt: 0, loadedAt: 0 };
      await ensureSessionIdentity();
      return run({ ...options, __tokenRecoveryRetry: true });
    }
    if (result.payload?.code === 2002 && page.location?.pathname === '/radiation') {
      // 已经在影像列表页时，TOKEN_FAIL 只代表当前协议请求缺少/失效的业务头，
      // 不能把已登录用户强行送到 /login；门户的登录页可能继续跳到 /setting/profile。
      // 保留当前页面，让下一次低频探测、页面查询或用户主动登录完成恢复。
      if (Date.now() - tokenFailureLoggedAt >= 15000) {
        tokenFailureLoggedAt = Date.now();
        developerLog('会话自愈保持当前页', { source: 'token-recovery', reason: 'TOKEN_FAIL', redirected: false }, { force: true });
      }
    }
    return result;
  }

  function directLoginConfig() {
    if (!config.directLogin || typeof config.directLogin !== 'object') config.directLogin = { enabled: false, username: '' };
    return config.directLogin;
  }

  function rsaPassword(password, key) {
    const w = pageWindow();
    if (!w.RSAUtils || !key?.ownModulus || !key?.exponent) throw new Error('页面 RSA 加密模块尚未加载');
    const pair = w.RSAUtils.getKeyPair(key.exponent, '', key.ownModulus);
    return w.RSAUtils.encryptedString(pair, encodeURIComponent(password));
  }

  // 协议登录验证码有两种形态：门户通常是四位数字，影像协议登录常见
  // “99-40=”这类算式。只接受完整数字或受限算式，避免把 OCR 误识别的
  // “99-40=”直接拼成“9940”提交。
  function normalizeCaptchaAnswer(raw) {
    const text = String(raw ?? '').trim().replace(/[×xX]/g, '*').replace(/÷/g, '/');
    const expression = text.match(/^(\d{1,3})\s*([+\-*/])\s*(\d{1,3})\s*=?$/);
    if (expression) {
      const left = Number(expression[1]);
      const right = Number(expression[3]);
      let value;
      if (expression[2] === '+') value = left + right;
      else if (expression[2] === '-') value = left - right;
      else if (expression[2] === '*') value = left * right;
      else if (right !== 0) value = Math.floor(left / right);
      if (Number.isInteger(value) && value >= 0 && value <= 9999) return String(value);
      return '';
    }
    return /^\d{1,4}$/.test(text) ? text : '';
  }

  function setSessionCookie(name, value) {
    const text = String(value ?? '').trim();
    if (!text) return false;
    const canonical = String(name || '').toUpperCase();
    if (!canonical) return false;
    // The Vue app's storage helper uppercases these names before writing them
    // (AUTH/LOGINCODE/WORKSTATION). Remove values written by older script
    // versions first so a stale mixed-case value cannot win readCookie().
    const aliases = canonical === 'AUTH' ? ['Auth', 'AUTH'] : canonical === 'LOGINCODE' ? ['LoginCode', 'LOGINCODE'] : canonical === 'WORKSTATION' ? ['WorkStation', 'WORKSTATION'] : [name, canonical];
    for (const legacy of aliases) {
      try { document.cookie = `${legacy}=; Max-Age=0; path=/`; } catch (_) {}
    }
    try {
      document.cookie = `${canonical}=${encodeURIComponent(text)}; Max-Age=604800; path=/`;
      return true;
    } catch (_) {
      return false;
    }
  }

  async function directLoginRequest(url, options = {}, timeoutMs = 6000) {
    // Keep the login sequence on the same bounded protocol path as list/status
    // requests. __tokenRecoveryRetry prevents a failed anonymous probe from
    // recursively probing user info or redirecting the active page.
    const result = await fetchJson(url, { ...options, __tokenRecoveryRetry: true }, timeoutMs);
    if (!result?.payload || !result.response?.ok) {
      throw new Error(`协议登录请求失败(${result?.response?.status || 'network'})`);
    }
    return result.payload;
  }

  // Kept as a small dependency-injected unit so login behavior can be tested
  // with mocked keyPair/captcha/login/info responses without storing a password.
  async function performDirectLogin({ username, password, request, captchaResolver, encryptPassword, writeCookie } = {}) {
    if (!username || !password || typeof request !== 'function' || typeof captchaResolver !== 'function' || typeof encryptPassword !== 'function' || typeof writeCookie !== 'function') {
      throw new Error('协议登录参数不完整');
    }
    const keyJson = await request('/api/admin/userLogin/keyPair', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    const key = keyJson?.data;
    if (keyJson?.code !== 200 || !key?.ownModulus || !key?.exponent) throw new Error('登录密钥获取失败');
    const capJson = await request('/api/admin/userLogin/captcha', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    const captcha = capJson?.data;
    if (capJson?.code !== 200 || !captcha?.uuid) throw new Error('登录验证码参数获取失败');
    const captchaEnabled = captcha.captchaEnabled !== false;
    const code = captchaEnabled ? normalizeCaptchaAnswer(await captchaResolver(captcha.img || '')) : '';
    if (captchaEnabled && !code) throw new Error('验证码识别失败');
    const params = new URLSearchParams({ username: String(username), password: encryptPassword(password, key), code, uuid: String(captcha.uuid) });
    const loginJson = await request(`/api/admin/userLogin/login?${params.toString()}`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
    const authToken = typeof loginJson?.data === 'string' ? loginJson.data.trim() : '';
    if (loginJson?.code !== 200 || !authToken) throw new Error(loginJson?.message || '协议登录失败');
    if (!writeCookie('AUTH', authToken)) throw new Error('协议登录令牌写入失败');
    const infoJson = await request('/api/admin/user/info', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    if (infoJson?.code !== 200 || !infoJson.data || typeof infoJson.data !== 'object') throw new Error('登录成功但用户信息未返回');
    if (infoJson.data.logincode) writeCookie('LOGINCODE', infoJson.data.logincode);
    if (infoJson.data.workStationList?.[0]?.code) writeCookie('WORKSTATION', infoJson.data.workStationList[0].code);
    return { token: authToken, info: infoJson.data };
  }

  async function recognizeCaptcha(imageBase64) {
    const dl = directLoginConfig();
    if (dl.ocrEnabled === false || !dl.ocrEndpoint || !imageBase64) return '';
    const body = JSON.stringify({ imageBase64 });
    try {
      const result = await new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'function') {
          GM_xmlhttpRequest({
            method: 'POST', url: dl.ocrEndpoint, data: body,
            headers: { 'Content-Type': 'application/json' }, timeout: 2500,
            onload: response => resolve(response), ontimeout: () => reject(new Error('OCR 超时')),
            onerror: () => reject(new Error('OCR 服务不可用'))
          });
        } else {
          fetch(dl.ocrEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
            .then(response => response.text().then(text => ({ status: response.status, responseText: text })))
            .then(resolve, reject);
        }
      });
      if (Number(result.status) && Number(result.status) !== 200) throw new Error(`OCR HTTP ${result.status}`);
      const payload = JSON.parse(result.responseText || '{}');
      const code = normalizeCaptchaAnswer(payload.code);
      if (payload.ok === true && code) {
        developerLog('验证码自动识别成功', { source: 'local-ocr', digits: code.length });
        return code;
      }
    } catch (e) {
      developerLog('验证码自动识别不可用', { source: 'local-ocr', reason: String(e.message || e).slice(0, 60) });
    }
    return '';
  }

  function askCaptcha(imageBase64) {
    return new Promise(resolve => {
      const old = document.getElementById('jx-direct-login-captcha'); if (old) old.remove();
      const box = document.createElement('div'); box.id = 'jx-direct-login-captcha';
      box.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;border:1px solid #409eff;border-radius:8px;padding:14px;box-shadow:0 10px 35px #0005;font:14px Segoe UI,Microsoft Yahei,sans-serif;width:260px';
      box.innerHTML = '<b>协议登录验证码</b><div style="margin:10px 0;text-align:center"><img style="max-width:220px;height:64px;object-fit:contain;border:1px solid #ddd"/></div><input style="box-sizing:border-box;width:100%;padding:7px" maxlength="8" placeholder="请输入验证码"><div style="display:flex;gap:7px;justify-content:flex-end;margin-top:10px"><button type="button" data-c="cancel">取消</button><button type="button" data-c="ok" style="background:#409eff;color:#fff;border:0;border-radius:4px;padding:6px 12px">登录</button></div>';
      box.querySelector('img').src = `data:image/jpeg;base64,${imageBase64}`;
      const finish = value => { box.remove(); resolve(normalizeCaptchaAnswer(value)); };
      box.querySelector('[data-c="cancel"]').onclick = () => finish('');
      box.querySelector('[data-c="ok"]').onclick = () => finish(box.querySelector('input').value.trim());
      box.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') box.querySelector('[data-c="ok"]').click(); });
      document.body.appendChild(box); box.querySelector('input').focus();
    });
  }

  async function ensureDirectLogin() {
    const dl = directLoginConfig();
    if (!dl.enabled || !dl.username || directLoginRunning) return false;
    directLoginRunning = true;
    try {
      // The application interceptor always promotes AUTH to Authorization.
      // Probe through the same helper before asking for a password; a portal
      // session therefore never gets an unnecessary protocol-login prompt.
      let sessionPayload = null;
      try { sessionPayload = await directLoginRequest('/api/admin/user/info', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }); } catch (_) {}
      if (sessionPayload?.code === 200 && sessionPayload.data) {
        sessionIdentity = { info: sessionPayload.data, uid: norm(sessionPayload.data.uid), loading: false, lastAttemptAt: Date.now(), loadedAt: Date.now() };
        return true;
      }
      // 页面刚从门户跳转或刚完成刷新时，业务接口可能短暂返回 401/2002，
      // 但前端已经恢复了用户工作台。此时弹出密码框会打断正常操作。
      // 只读检查已渲染的用户头部；不向服务端写入任何内容，也不把它当作登录凭证。
      // Vue 工作台在部分机器上会在 2~3 秒后才挂载用户头部；过早弹窗会
      // 抢在工作台完成恢复前打断用户。把检查窗口延长到约 5 秒，仍然只读。
      // If AUTH exists but the server rejected it, the cookie is stale and the
      // configured account must be allowed to recover. Only use the visual
      // shell shortcut when AUTH is unavailable (for example HttpOnly).
      for (const delay of [0, 250, 800, 1600, 3000]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (readCookie('Auth')) {
          try {
            const retryPayload = await directLoginRequest('/api/admin/user/info', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
            if (retryPayload?.code === 200 && retryPayload.data) {
              sessionIdentity = { info: retryPayload.data, uid: norm(retryPayload.data.uid), loading: false, lastAttemptAt: Date.now(), loadedAt: Date.now() };
              return true;
            }
          } catch (_) {}
        } else if (hasAuthenticatedAppShell()) {
          console.info('[自动诊断] 检测到已登录工作台，跳过协议登录提示');
          return true;
        }
      }
      if (!directPassword) {
        directPassword = window.prompt('请输入协议登录密码（仅本次页面会话使用，不会保存）') || '';
        if (!directPassword) return false;
      }
      // Do not carry a previous account's LOGIN-USER-* / USER-INFO headers
      // into the fresh token exchange or its post-login user-info request.
      sessionIdentity = { info: null, uid: '', loading: false, lastAttemptAt: 0, loadedAt: 0 };
      const result = await performDirectLogin({
        username: dl.username,
        password: directPassword,
        request: directLoginRequest,
        captchaResolver: async image => await recognizeCaptcha(image) || await askCaptcha(image),
        encryptPassword: rsaPassword,
        writeCookie: setSessionCookie
      });
      sessionIdentity = { info: result.info, uid: norm(result.info.uid), loading: false, lastAttemptAt: Date.now(), loadedAt: Date.now() };
      directPassword = '';
      console.info('[自动诊断] 协议登录成功');
      return true;
    } catch (e) {
      directPassword = '';
      console.warn('[自动诊断] 协议登录失败', String(e.message || e));
      return false;
    } finally { directLoginRunning = false; }
  }
  function hasAuthenticatedAppShell() {
    if (!/^\/radiation(?:\/|$)/.test(location.pathname)) return false;
    const selectors = [
      '.user-wrap',
      '.header-right .avatar-wrapper',
      '[class*="user-wrap"]',
      '[class*="avatar-wrapper"]'
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = norm(node?.innerText || node?.textContent);
      if (node && text && !/(登录|未登录|请登录|login)/i.test(text)) return true;
    }
    // 低版本页面没有稳定的 class，但已渲染的工作台一定包含业务标题和菜单。
    const bodyText = norm(document.body?.innerText || '');
    return bodyText.includes('医学影像资源共享中心') && (bodyText.includes('诊断') || bodyText.includes('登记')) && !bodyText.includes('请输入协议登录密码');
  }
  function readCookie(name) {
    const wanted = encodeURIComponent(String(name || '')).toLowerCase();
    const item = String(document.cookie || '').split(';').map(x => x.trim()).find(x => {
      const index = x.indexOf('=');
      return index > 0 && x.slice(0, index).trim().toLowerCase() === wanted;
    });
    if (!item) return '';
    const value = item.slice(item.indexOf('=') + 1);
    try { return decodeURIComponent(value); } catch (_) { return value; }
  }
  function loginIdentity() {
    const loginCode = norm(readCookie('LoginCode'));
    const selectors = [
      '.user-wrap .avatar-wrapper > div > div:first-child span',
      '.header-right .user-wrap .avatar-wrapper span:not(.el-tooltip__trigger)',
      '.avatar-wrapper span:not(.el-tooltip__trigger)',
      '[class*="user-wrap"] [class*="avatar-wrapper"] > div > div:first-child span'
    ];
    let name = '';
    for (const selector of selectors) {
      name = norm(document.querySelector(selector)?.textContent);
      if (name) break;
    }
    // 某些页面版本没有稳定的 class，只保留头像区域第一行作为登录名。
    if (!name) {
      const userWrap = document.querySelector('.user-wrap, [class*="user-wrap"]');
      const firstLine = String(userWrap?.innerText || '').split(/\r?\n/).map(norm).find(Boolean);
      if (firstLine) name = firstLine;
    }
    return { loginCode, name, values: [loginCode, name].filter(Boolean) };
  }

  function accountValueMatches(rule, value) {
    const r = norm(rule).toLowerCase();
    const v = norm(value).toLowerCase();
    if (!r || !v) return false;
    // 登录编号要求精确匹配；中文姓名允许页面附带少量展示文字。
    if (/^\d+$/.test(r) || /^\d+$/.test(v)) return r === v;
    return r === v || (r.length >= 2 && (v.includes(r) || r.includes(v)));
  }

  function accountAllowed() {
    const rules = (config.allowedAccounts || []).map(norm).filter(Boolean);
    if (!rules.length) return true;
    const identity = loginIdentity();
    const key = identity.values.join('|') || '(未识别)';
    const matched = rules.some(rule => identity.values.some(value => accountValueMatches(rule, value)));
    if (key !== accountGateState) {
      accountGateState = key;
      console.info('[自动诊断] 登录账号检查', { matched, ruleCount: rules.length, identityFound: identity.values.length > 0 });
      developerLog('账号门禁', { matched, ruleCount: rules.length, identityFound: identity.values.length > 0 });
    }
    return matched;
  }
  function accountDisplay(identity = loginIdentity()) {
    if (identity.loginCode && identity.name) return `${identity.name}（${identity.loginCode}）`;
    return identity.loginCode || identity.name || '未识别';
  }
