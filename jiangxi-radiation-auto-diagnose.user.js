// ==UserScript==
// @name         姹熻タ鐪佸幙鍩熷尰鍏变綋 - 鑷姩璇婃柇鍊欓€?// @namespace    local.jiangxi.radiation
// @version      0.8.18
// @updateURL   https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js
// @downloadURL https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js
// @description  浠ラ〉闈㈠疄鏃舵帹閫佷负涓汇€佽交閲忓崗璁帰娴嬩负鍏滃簳锛屾寜鍙厤缃鍒欒瘑鍒悗浼樺厛閫氳繃绯荤粺鍗忚杩涘叆璇婃柇锛涙敮鎸佸彲鎺у紑鍙戣€呰瘖鏂棩蹇椼€?// @match        http://10.10.94.90:22112/*
// @match        http://10.10.94.90:22100/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  // 鎵€鏈変笟鍔¤鍒欏拰椤甸潰瀹氫綅閮介泦涓湪杩欓噷锛屼篃鍙互浠庤〃澶磋缃脊绐楄繘鍏ラ厤缃潰鏉夸慨鏀广€?  const DEFAULT_CONFIG = {
    configSchema: 2,
    enabled: true,
    // 榛樿鍏抽棴锛涙湰娆℃棫閰嶇疆杩佺Щ浼氫复鏃跺紑鍚紝鍏抽棴鍚庝細鎸夌敤鎴烽€夋嫨鎸佷箙鍖栥€?    developerMode: false,
    // [] 琛ㄧず涓嶉檺鐧诲綍璐﹀彿锛涘～鍐欒处鍙风紪鍙锋垨鐧诲綍鍚嶅悗锛屼粎瀵瑰尮閰嶈处鍙峰惎鐢ㄨ嚜鍔ㄨ瘖鏂€?    allowedAccounts: [],
    // 鍗忚鐧诲綍鍙繚瀛樿处鍙凤紝涓嶄繚瀛樺瘑鐮侊紱瀵嗙爜浠呭湪褰撳墠椤甸潰浼氳瘽鍐呭瓨涓娇鐢ㄣ€?    directLogin: { enabled: false, username: '' },
    // DOM 鎵弿鍙湪鏈湴杩涜锛涙湇鍔″櫒鎺㈡祴鍗曠嫭浣跨敤 statusNum锛屽墠鍙伴粯璁?5 绉掍竴娆★紝鍚庡彴鑷姩闄嶅埌杈冧綆棰戠巼骞跺甫閫€閬裤€?    pollMs: 2000,
    statusProbeMs: 5000,
    // 椤甸潰宸叉湁 WebSocket 鎺ㄩ€佹椂鍗虫椂瑙﹀彂锛涙病鏈夋帹閫佹垨娑堟伅涓嶅畬鏁存椂鎸夋闂撮殧琛ュ伩涓€娆″垪琛ㄣ€?    realtimeHints: true,
    listHeartbeatMs: 15000,
    // 鍚庡彴鍊欓€夊鐞嗛粯璁ゅ彧璧板崗璁紝涓嶆浛鐢ㄦ埛鐐瑰嚮椤甸潰鈥滄煡璇⑩€濓紱闇€瑕佸悓姝ュ彲瑙佽〃鏍兼椂鍐嶆墜鍔ㄥ紑鍚€?    pageQueryRefresh: true,
    clickDelayMs: 700,
    // 寰呰瘖鏂湪褰撳墠绯荤粺涓殑鐘舵€佸€硷紱鑴氭湰浼氫紭鍏堢偣鍑昏繖涓閫夋锛屽啀璇诲彇琛ㄦ牸銆?    pendingStatusValue: '102501',
    reportStatuses: ['寰呰瘖鏂?],
    imageStatuses: [],
    encounterTypes: ['闂ㄨ瘖', '鎬ヨ瘖'], // [] 琛ㄧず涓嶉檺锛涗綇闄笉浼氳榛樿鏀捐
    gender: [],                         // [] 琛ㄧず涓嶉檺锛涘彲濉?['鐢?] 鎴?['濂?]
    age: { min: 18, max: 40, unlimited: false }, // unlimited=true 鎴栬竟鐣屼负绌鸿〃绀轰笉闄?    modalities: ['CT'],                // [] 琛ㄧず涓嶉檺
    patientNameContains: '',
    applicationNoContains: '',
    applyInstitution: [],               // [] 琛ㄧず涓嶉檺锛涘～鍐欏悗鎸夎鏂囨湰鎴栨暟鎹睘鎬у尮閰?    // 鏁板€艰秺澶ц秺浼樺厛锛涙湭鍒楀嚭鐨勯」鐩寜 0 澶勭悊銆傝缃晫闈㈡敮鎸佲€滃悕绉?鏉冮噸鈥濋€愯缂栬緫銆?    examWeights: ['澶撮骞虫壂=100', '棰呰剳骞虫壂=95', '鑵版闂寸洏骞虫壂=80', '棰堟闂寸洏骞虫壂=75', '鑲嬮骞虫壂=10'],
    institutionWeights: [],
    preliminaryReportFirst: true,
    auditDoctors: [],                   // [] 琛ㄧず涓嶉檺
    applicationTime: { mode: 'window', minMinutes: 5, maxMinutes: 30, days: 3, start: '00:00' },
    diagnosisTime: { mode: 'all', days: 3, start: '00:00' },
    examNames: [
      '澶撮骞虫壂',
      '棰呰剳骞虫壂',
      '鑵版闂寸洏骞虫壂',
      '鑵版妞庨棿鐩樺钩鎵?,
      '棰堟闂寸洏骞虫壂',
      '棰堟妞庨棿鐩樺钩鎵?
    ],
    examNamesExtra: [],
    // 鍔ㄦ€佹敹闆嗗綋鍓嶅垪琛ㄤ腑鍑虹幇杩囩殑妫€鏌ラ」鐩紝渚涜缃晫闈㈠嬀閫夈€?    examNamesCatalog: [],
    // 鍏煎鏃х増鏈瓧娈碉紱鏂扮増鏈娇鐢?examSiteCount锛岄粯璁や笉闄愭鏌ラ儴浣嶆暟閲忋€?    singleSiteOnly: false,
    examSiteCount: { min: null, max: null },
    // 鍗忚浼樺厛浼氬厛璋冪敤绯荤粺鐨勫厑璁歌繘鍏ユ帴鍙ｏ紝鍐嶆墦寮€璇婃柇椤碉紱鍙栦笉鍒拌褰曠紪鍙锋椂鍥為€€鍒伴〉闈㈡寜閽€?    entryMode: 'protocol-first',
    // 鍚屼竴琛屽涓鏌ラ」鐩殑鍒嗛殧绗︺€傞渶瑕佹敮鎸佸叾瀹冨尰闄㈠懡鍚嶆椂鍙墿灞曘€?    examSeparators: /[,锛屻€?锛?锛沑\/]/,
    selectors: {
      bodyRows: 'table.el-table__body tbody tr',
      statusInput: 'input[type="checkbox"][value="{pendingStatusValue}"]',
      searchButton: 'button.el-button--primary',
      operatorItems: '.operator .table-operator-item',
      // 鎵句笉鍒拌瘖鏂浘鏍囨椂鐨勫吋瀹瑰洖閫€搴忓彿锛涙甯告儏鍐垫寜鍥炬爣鍚嶇О璇嗗埆銆?      diagnoseOperatorIndex: 0
    },
    // 闃叉鍚屼竴妫€鏌ュ湪鍒锋柊/缈婚〉鍚庡啀娆℃墦寮€銆備粎淇濆瓨鐭瓧绗︿覆锛屼笉淇濆瓨鎮ｈ€呭鍚嶇瓑棰濆淇℃伅銆?    seenLimit: 500
  };

  const STORAGE_KEY = 'jx-radiation-auto-diagnose-config-v1';
  let developerModeMigrationApplied = false;
  let config = loadConfig();
  let timer = null;
  let probeTimer = null;
  let running = false;
  let entryRunning = false;
  let probeRunning = false;
  let listRefreshRunning = false;
  let lastStatusHash = '';
  let statusProbeFailures = 0;
  let lastListFetchAt = 0;
  let realtimeRefreshTimer = null;
  let realtimeRecordRunning = false;
  let lastRealtimeRefreshAt = 0;
  let lastRealtimeHintAt = 0;
  // WebSocket 鎻愮ず鍙兘鍏堜簬鍒楄〃璇锋眰瀹屾垚锛涗繚瀛樻渶杩戜竴鏉″彲璇嗗埆绾跨储锛岄伩鍏嶅苟鍙戣姹傛椂涓㈠け銆?  let queuedRealtimeMatch = null;
  // 椤甸潰 Axios 杩樹細鍙戦€佺櫥褰曠敤鎴?UID/USER-INFO锛涙寜闇€璇诲彇涓€娆″綋鍓嶄細璇濓紝鍊煎彧鐣欏湪鍐呭瓨涓€?  let sessionIdentity = { info: null, uid: '', loading: false, lastAttemptAt: 0, loadedAt: 0 };
  let sessionIdentityRequest = null;
  let directPassword = '';
  let directLoginRunning = false;
  let reauthScheduledAt = 0;
  // 涓氬姟鍓嶇浼氫粠 WebRTC ICE 鍊欓€変腑闄勫甫瀹㈡埛绔湴鍧€锛涚己灏戣澶存椂鍙鎺ュ彛浼氳繑鍥?TOKEN_FAIL(2002)銆?  let clientIp = '';
  let clientIpRequest = null;
  let pageQueryRunning = false;
  let lastPageQueryAt = 0;
  // statusNum/WS 鍧囦笉鍙敤鏃讹紝浣庨澶嶇敤椤甸潰鍘熺敓鏌ヨ浣滀负鍏滃簳銆?  let autoQueryFallbackTimer = null;
  // 椤甸潰鏈韩鍙湁鐐瑰嚮鈥滄煡璇⑩€濇墠浼氶噸鏂板彇琛ㄦ牸锛涚敤浣庨鍗曟瀹氭椂鍣ㄤ唬鏇夸汉宸ョ偣鍑汇€?  let pageQueryHeartbeatTimer = null;
  let visibilityBound = false;
  let accountGateState = '';
  const seen = new Map();
  const REALTIME_HINT_EVENT = '__jx_auto_diagnose_ws_hint_v1';
  const DEBUG_EVENT_LIMIT = 240;
  const DEBUG_EVENT_THROTTLE_MS = 3000;
  const DEBUG_STORAGE_KEY = 'jx-radiation-auto-diagnose-debug-v1';
  const debugEvents = [];
  const debugLastAt = new Map();

  function loadDeveloperEvents() {
    if (!config.developerMode) return;
    try {
      const raw = GM_getValue(DEBUG_STORAGE_KEY, []);
      const events = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(events)) debugEvents.push(...events.slice(-DEBUG_EVENT_LIMIT));
    } catch (_) {}
  }
  loadDeveloperEvents();

  function loadConfig() {
    try {
      const saved = GM_getValue(STORAGE_KEY, null);
      if (!saved) return structuredClone(DEFAULT_CONFIG);
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      if (parsed.examSeparators?.__regexp) parsed.examSeparators = new RegExp(parsed.examSeparators.__regexp);
      if (typeof parsed.examNamesExtra === 'string') parsed.examNamesExtra = parsed.examNamesExtra.split(/[,锛孿n]/).map(norm).filter(Boolean);
      if (!Array.isArray(parsed.examNamesCatalog)) parsed.examNamesCatalog = [];
      // 鏃ч厤缃病鏈夎瀛楁锛氫负褰撳墠鎺掓煡涓存椂鎵撳紑涓€娆★紱鐢ㄦ埛鍦ㄨ缃腑鍏抽棴鍚庝細淇濆瓨涓?false銆?      if (parsed.developerMode == null) {
        parsed.developerMode = true;
        developerModeMigrationApplied = true;
      }
      if (parsed.realtimeHints == null) parsed.realtimeHints = true;
      if (!parsed.listHeartbeatMs) parsed.listHeartbeatMs = 15000;
      if (parsed.pageQueryRefresh == null) parsed.pageQueryRefresh = true;
      if (!parsed.examSiteCount) parsed.examSiteCount = parsed.singleSiteOnly ? { min: 1, max: 1 } : { min: null, max: null };
      if (parsed.applicationTime && parsed.applicationTime.mode === 'today' && parsed.applicationTime.minMinutes == null && parsed.applicationTime.maxMinutes == null) parsed.applicationTime = { ...parsed.applicationTime, mode: 'window', minMinutes: 5, maxMinutes: 30 };
      const merged = merge(structuredClone(DEFAULT_CONFIG), parsed);
      return migrateConfig(merged, parsed);
    } catch (e) {
      console.warn('[鑷姩璇婃柇] 閰嶇疆璇诲彇澶辫触锛屼娇鐢ㄩ粯璁ら厤缃?, e);
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  function merge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    for (const [k, v] of Object.entries(extra)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
        base[k] = merge(base[k], v);
      } else if (v !== undefined) base[k] = v;
    }
    return base;
  }

  function migrateConfig(value, original = value) {
    // 0.8.10 鏈熼棿鏇句繚瀛樿繃 pageQueryRefresh=false锛涘崌绾у埌鍗忚+鍙鍒楄〃鍚屾鍚庯紝
    // 鏃ч厤缃彧杩佺Щ涓€娆★紝閬垮厤鐢ㄦ埛蹇呴』鎵嬪姩鐐瑰嚮鏌ヨ銆備箣鍚庣敤鎴蜂富鍔ㄥ叧闂細淇濇寔鍏抽棴銆?    if (Number(original?.configSchema || 0) < 2) {
      value.pageQueryRefresh = true;
      value.configSchema = 2;
    }
    return value;
  }

  function saveConfig() {
    GM_setValue(STORAGE_KEY, JSON.stringify(config, (k, v) => v instanceof RegExp ? { __regexp: v.source } : v));
  }

  function debugHash(value) {
    let hash = 2166136261;
    for (const ch of String(value ?? '')) {
      hash ^= ch.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function debugTag(d) {
    if (!d) return '';
    // 鍙緭鍑轰笉鍙€嗙煭鏍囩锛岄伩鍏嶅紑鍙戣€呮棩蹇楀甫鍑烘偅鑰呭鍚嶃€佺敵璇峰崟鍙锋垨鎶ュ憡缂栧彿銆?    const raw = [d.key, d.applicationNo, d.patient, d.applyTime, d.exam, d.modality].filter(Boolean).join('|');
    return raw ? `鍊欓€?${debugHash(raw)}` : '';
  }
  function debugApplyAgeMinutes(d) {
    const date = parseDate(d?.applyTime);
    if (!date || Number.isNaN(date.getTime())) return null;
    return Math.round((Date.now() - date.getTime()) / 60000 * 10) / 10;
  }
  function debugCandidate(d, extra = {}) {
    return {
      tag: debugTag(d),
      status: norm(d?.status),
      statusCode: norm(d?.statusCode || d?.record?.reportStatusCode || d?.record?.checkStatusCode || d?.record?.statusCode),
      locked: !!(d?.locked || recordLockState(d?.record)),
      imageStatus: norm(d?.imageStatus),
      modality: norm(d?.modality),
      exam: norm(d?.exam),
      age: d?.age == null ? null : Number(d.age),
      gender: norm(d?.gender),
      applyAgeMinutes: debugApplyAgeMinutes(d),
      hasRecordId: !!(d?.record?.repUid || d?.record?.reportUid || d?.record?.reportId || d?.record?.id),
      ...extra
    };
  }
  function debugError(error) {
    const text = String(error?.message || error || 'unknown');
    return text.replace(/\b\d{6,}\b/g, '[id]').slice(0, 160);
  }
  function developerLog(event, detail = {}, options = {}) {
    if (!config.developerMode) return;
    const now = Date.now();
    const key = `${event}|${detail.tag || ''}|${detail.reason || ''}`;
    if (!options.force && now - (debugLastAt.get(key) || 0) < DEBUG_EVENT_THROTTLE_MS) return;
    debugLastAt.set(key, now);
    const item = { at: new Date(now).toISOString(), event, ...detail };
    debugEvents.push(item);
    while (debugEvents.length > DEBUG_EVENT_LIMIT) debugEvents.shift();
    try { GM_setValue(DEBUG_STORAGE_KEY, debugEvents); } catch (_) {}
    console.info('[鑷姩璇婃柇][寮€鍙戣€匽', item);
  }
  function developerLogText() {
    return JSON.stringify({ version: '0.8.14', exportedAt: new Date().toISOString(), events: debugEvents }, null, 2);
  }
  function developerModeStateText() {
    if (!config.developerMode) return '褰撳墠鍏抽棴';
    return `${developerModeMigrationApplied ? '褰撳墠寮€鍚紙涓存椂鎺掓煡锛? : '褰撳墠寮€鍚?}锛?{debugEvents.length} 鏉★級`;
  }

  // 椤甸潰鍋跺皵浼氬湪濮撳悕/鏈烘瀯涔嬮棿鎻掑叆涓嶅彲瑙佺┖鐧斤紱缁熶竴娓呯悊鍚庡啀鍋氬瓧娈靛拰璐﹀彿鍖归厤銆?  function norm(s) {
    return String(s ?? '').normalize('NFC').replace(/[\s\u200B-\u200D\uFEFF]+/g, '').trim();
  }
  function pageWindow() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }
  // 鎸変笟鍔″墠绔殑浼氳瘽鎷︽埅鍣ㄨˉ榻愯璇佸拰鐧诲綍鐢ㄦ埛璇锋眰澶达紱鍙湪褰撳墠椤甸潰鍐呭瓨/璇锋眰涓娇鐢紝
  // 涓嶅啓鍏?GM_*銆佷笉杈撳嚭鏃ュ織锛屼篃涓嶆妸璁よ瘉鍊兼斁鍏ヤ换浣曟寔涔呭寲缁撴瀯銆?  function sessionHeaders(input = {}) {
    const headers = { ...input };
    const auth = readCookie('Auth');
    if (auth && !headers.Authorization) headers.Authorization = auth;
    const info = sessionIdentity.info;
    const loginCode = norm(info?.logincode || readCookie('LoginCode'));
    if (loginCode && !headers['LOGIN-USER-KEY']) headers['LOGIN-USER-KEY'] = loginCode;
    const uid = norm(info?.uid);
    if (uid && !headers['LOGIN-USER-UID']) headers['LOGIN-USER-UID'] = uid;
    if (uid && !headers['LOGIN-USER-UID']) headers['LOGIN-USER-UID'] = uid;
    if (clientIp && !headers['LOGIN-CLIENT-IP']) headers['LOGIN-CLIENT-IP'] = clientIp;
    // 涓庨〉闈㈡嫤鎴櫒淇濇寔涓€鑷达紱涓嶅彂閫佽彍鍗?宸ヤ綔绔欑瓑澶у瓧娈碉紝涔熶笉鎸佷箙鍖栫敤鎴蜂俊鎭€?    if (info && !info.admin && !headers['USER-INFO']) {
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
    return headers;
  }
  async function ensureClientIp() {
    if (clientIp || clientIpRequest || typeof RTCPeerConnection === 'undefined') return clientIp;
    clientIpRequest = new Promise(resolve => {
      let peer;
      let finished = false;
      const done = value => {
        if (finished) return;
        finished = true;
        try { peer?.close?.(); } catch (_) {}
        if (value) clientIp = value;
        resolve(clientIp);
      };
      const timeout = setTimeout(() => done(''), 1800);
      try {
        peer = new RTCPeerConnection({ iceServers: [] });
        peer.createDataChannel('');
        peer.onicecandidate = event => {
          const candidate = event?.candidate?.candidate || '';
          const match = candidate.match(/(?:^|\s)([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){7})(?:\s|$)/i);
          if (match) { clearTimeout(timeout); done(match[1]); }
        };
        peer.createOffer().then(offer => peer.setLocalDescription(offer)).catch(() => done(''));
      } catch (_) { clearTimeout(timeout); done(''); }
    });
    try { return await clientIpRequest; } finally { clientIpRequest = null; }
  }
  async function ensureSessionIdentity() {
    const now = Date.now();
    if (sessionIdentityRequest) return sessionIdentityRequest;
    if (sessionIdentity.uid && now - sessionIdentity.loadedAt < 10 * 60 * 1000) return;
    if (!sessionIdentity.uid && now - sessionIdentity.lastAttemptAt < 30000) return;
    sessionIdentity.loading = true;
    sessionIdentity.lastAttemptAt = now;
    const request = (async () => {
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
      sessionIdentity.loading = false;
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
        await ensureClientIp();
        const { __tokenRecoveryRetry: _internalRetry, ...networkOptions } = requestOptions;
        const response = await request(url, { ...networkOptions, headers: sessionHeaders(networkOptions.headers || {}), signal: controller.signal });
        let payload = null;
        try { payload = await response.json(); } catch (_) {}
        return { response, payload };
      } finally { clearTimeout(timeout); }
    };
    const result = await run(options);
    // TOKEN_FAIL 甯歌浜庨〉闈粠闂ㄦ埛璺宠浆鍚庢棫鐨勭敤鎴峰ご宸插け鏁堬紱鍙湪鏄庣‘鐨?2002
    // 杩斿洖鏃跺埛鏂颁竴娆′細璇濊韩浠藉苟閲嶈瘯锛岄伩鍏嶆妸姝ｅ父璇锋眰鍙樻垚鍙屽€嶆祦閲忋€?    if (result.payload?.code === 2002 && !options.__tokenRecoveryRetry) {
      sessionIdentity = { info: null, uid: '', loading: false, lastAttemptAt: 0, loadedAt: 0 };
      await ensureSessionIdentity();
      return run({ ...options, __tokenRecoveryRetry: true });
    }
    if (result.payload?.code === 2002 && directLoginConfig().enabled && page.location?.pathname === '/radiation' && Date.now() - reauthScheduledAt > 300000) {
      reauthScheduledAt = Date.now();
      developerLog('浼氳瘽鑷剤璋冨害', { source: 'token-recovery', reason: 'TOKEN_FAIL' }, { force: true });
      setTimeout(() => { if (page.location?.pathname === '/radiation') page.location.replace('/login'); }, 800);
    }
    return result;
  }

  function directLoginConfig() {
    if (!config.directLogin || typeof config.directLogin !== 'object') config.directLogin = { enabled: false, username: '' };
    return config.directLogin;
  }

  function rsaPassword(password, key) {
    const w = pageWindow();
    if (!w.RSAUtils || !key?.ownModulus || !key?.exponent) throw new Error('椤甸潰 RSA 鍔犲瘑妯″潡灏氭湭鍔犺浇');
    const pair = w.RSAUtils.getKeyPair(key.exponent, '', key.ownModulus);
    return w.RSAUtils.encryptedString(pair, encodeURIComponent(password));
  }

  function askCaptcha(imageBase64) {
    return new Promise(resolve => {
      const old = document.getElementById('jx-direct-login-captcha'); if (old) old.remove();
      const box = document.createElement('div'); box.id = 'jx-direct-login-captcha';
      box.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;border:1px solid #409eff;border-radius:8px;padding:14px;box-shadow:0 10px 35px #0005;font:14px Segoe UI,Microsoft Yahei,sans-serif;width:260px';
      box.innerHTML = '<b>鍗忚鐧诲綍楠岃瘉鐮?/b><div style="margin:10px 0;text-align:center"><img style="max-width:220px;height:64px;object-fit:contain;border:1px solid #ddd"/></div><input style="box-sizing:border-box;width:100%;padding:7px" maxlength="8" placeholder="璇疯緭鍏ラ獙璇佺爜"><div style="display:flex;gap:7px;justify-content:flex-end;margin-top:10px"><button type="button" data-c="cancel">鍙栨秷</button><button type="button" data-c="ok" style="background:#409eff;color:#fff;border:0;border-radius:4px;padding:6px 12px">鐧诲綍</button></div>';
      box.querySelector('img').src = `data:image/jpeg;base64,${imageBase64}`;
      const finish = value => { box.remove(); resolve(value); };
      box.querySelector('[data-c="cancel"]').onclick = () => finish('');
      box.querySelector('[data-c="ok"]').onclick = () => finish(box.querySelector('input').value.trim());
      box.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') box.querySelector('[data-c="ok"]').click(); });
      document.body.appendChild(box); box.querySelector('input').focus();
    });
  }

  async function ensureDirectLogin() {
    const dl = directLoginConfig();
    if (!dl.enabled || !dl.username || directLoginRunning) return false;
    if (document.cookie.includes('Auth=')) return false;
    directLoginRunning = true;
    try {
      if (!directPassword) {
        directPassword = window.prompt('璇疯緭鍏ュ崗璁櫥褰曞瘑鐮侊紙浠呮湰娆￠〉闈細璇濅娇鐢紝涓嶄細淇濆瓨锛?) || '';
        if (!directPassword) return false;
      }
      const keyRes = await fetch('/api/admin/userLogin/keyPair', { credentials: 'include', headers: { Accept: 'application/json' } });
      const keyJson = await keyRes.json();
      const capRes = await fetch('/api/admin/userLogin/captcha', { credentials: 'include', headers: { Accept: 'application/json' } });
      const capJson = await capRes.json();
      if (keyJson.code !== 200 || capJson.code !== 200 || !capJson.data?.img || !capJson.data?.uuid) throw new Error('鐧诲綍鍙傛暟鑾峰彇澶辫触');
      const code = await askCaptcha(capJson.data.img);
      if (!code) return false;
      const params = new URLSearchParams({ username: dl.username, password: rsaPassword(directPassword, keyJson.data), code, uuid: capJson.data.uuid });
      const loginRes = await fetch(`/api/admin/userLogin/login?${params.toString()}`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      const loginJson = await loginRes.json();
      if (loginJson.code !== 200 || !loginJson.data) throw new Error(loginJson.message || '鍗忚鐧诲綍澶辫触');
      document.cookie = `Auth=${encodeURIComponent(loginJson.data)}; path=/`;
      const info = await fetch('/api/admin/user/info', { credentials: 'include', headers: { Accept: 'application/json' } }).then(r => r.json());
      if (info.code !== 200 || !info.data) throw new Error('鐧诲綍鎴愬姛浣嗙敤鎴蜂俊鎭湭杩斿洖');
      if (info.data.logincode) document.cookie = `LoginCode=${encodeURIComponent(info.data.logincode)}; path=/`;
      if (info.data.workStationList?.[0]?.code) document.cookie = `WorkStation=${encodeURIComponent(info.data.workStationList[0].code)}; path=/`;
      directPassword = '';
      console.info('[鑷姩璇婃柇] 鍗忚鐧诲綍鎴愬姛');
      return true;
    } catch (e) {
      directPassword = '';
      console.warn('[鑷姩璇婃柇] 鍗忚鐧诲綍澶辫触', String(e.message || e));
      return false;
    } finally { directLoginRunning = false; }
  }
  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const item = String(document.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(prefix));
    if (!item) return '';
    try { return decodeURIComponent(item.slice(prefix.length)); } catch (_) { return item.slice(prefix.length); }
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
    // 鏌愪簺椤甸潰鐗堟湰娌℃湁绋冲畾鐨?class锛屽彧淇濈暀澶村儚鍖哄煙绗竴琛屼綔涓虹櫥褰曞悕銆?    if (!name) {
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
    // 鐧诲綍缂栧彿瑕佹眰绮剧‘鍖归厤锛涗腑鏂囧鍚嶅厑璁搁〉闈㈤檮甯﹀皯閲忓睍绀烘枃瀛椼€?    if (/^\d+$/.test(r) || /^\d+$/.test(v)) return r === v;
    return r === v || (r.length >= 2 && (v.includes(r) || r.includes(v)));
  }

  function accountAllowed() {
    const rules = (config.allowedAccounts || []).map(norm).filter(Boolean);
    if (!rules.length) return true;
    const identity = loginIdentity();
    const key = identity.values.join('|') || '(鏈瘑鍒?';
    const matched = rules.some(rule => identity.values.some(value => accountValueMatches(rule, value)));
    if (key !== accountGateState) {
      accountGateState = key;
      console.info('[鑷姩璇婃柇] 鐧诲綍璐﹀彿妫€鏌?, { matched, ruleCount: rules.length, identityFound: identity.values.length > 0 });
      developerLog('璐﹀彿闂ㄧ', { matched, ruleCount: rules.length, identityFound: identity.values.length > 0 });
    }
    return matched;
  }
  function accountDisplay(identity = loginIdentity()) {
    if (identity.loginCode && identity.name) return `${identity.name}锛?{identity.loginCode}锛塦;
    return identity.loginCode || identity.name || '鏈瘑鍒?;
  }
  function parseAge(text) {
    const m = norm(text).match(/(?:鐢穦濂??(?:[鈾€鈾俔)?(\d{1,3})宀?);
    return m ? Number(m[1]) : null;
  }
  function parseGender(text) {
    const t = norm(text);
    if (t.includes('濂?)) return '濂?;
    if (t.includes('鐢?)) return '鐢?;
    return null;
  }
  function parseDate(text) {
    // norm() 浼氬幓鎺夐〉闈㈡椂闂翠腑鐨勭┖鏍硷紝鍥犳杩欓噷鍚屾椂鎺ュ彈鈥?026-09-2910:00:00鈥濆拰甯︾┖鏍?涓枃鏃ユ湡鍒嗛殧鐨勬牸寮忋€?    const m = String(text || '').match(/(\d{4})[-骞碷(\d{1,2})[-鏈圿(\d{1,2})(?:[鏃\s]*?(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  const REPORT_STATUS_NAMES = Object.freeze({
    '102501': '寰呰瘖鏂?, '102502': '璇婃柇涓?, '102503': '寰呭鏍?,
    '102504': '瀹℃牳涓?, '102505': '宸插鏍?, '102506': '宸叉墦鍗?
  });
  function formatDateTime(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  function applicationTimeRange(rule, now = new Date()) {
    const mode = rule?.mode || 'all';
    if (mode === 'all') return { start: '', end: '' };
    if (mode === 'window') {
      const min = Math.max(0, Number(rule.minMinutes) || 0);
      const max = Math.max(min, Number(rule.maxMinutes) || min);
      return { start: formatDateTime(new Date(now.getTime() - max * 60000)), end: formatDateTime(new Date(now.getTime() - min * 60000)) };
    }
    if (mode === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { start: formatDateTime(start), end: formatDateTime(now) };
    }
    if (mode === 'recent') {
      const days = Math.max(0, Number(rule.days) || 0);
      return { start: formatDateTime(new Date(now.getTime() - days * 86400000)), end: formatDateTime(now) };
    }
    if (mode === 'fromTime') {
      const [hours, minutes] = String(rule.start || '00:00').split(':').map(Number);
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hours) || 0, Number(minutes) || 0, 0);
      return { start: formatDateTime(start), end: formatDateTime(now) };
    }
    return { start: '', end: '' };
  }
  function matchTime(text, rule) {
    if (!rule || rule.mode === 'all') return true;
    const date = parseDate(text);
    if (!date || Number.isNaN(date.getTime())) return false;
    const now = new Date();
    if (rule.mode === 'window') {
      const ageMinutes = (now.getTime() - date.getTime()) / 60000;
      const min = Math.max(0, Number(rule.minMinutes) || 0);
      const max = Math.max(min, Number(rule.maxMinutes) || min);
      return ageMinutes >= min && ageMinutes <= max;
    }
    if (rule.mode === 'today' || rule.mode === 'fromTime') {
      if (date.toDateString() !== now.toDateString()) return false;
      if (rule.mode === 'fromTime') {
        const [h, m] = String(rule.start || '00:00').split(':').map(Number);
        if (date.getHours() * 60 + date.getMinutes() < (h || 0) * 60 + (m || 0)) return false;
      }
      return true;
    }
    if (rule.mode === 'recent') return date.getTime() >= now.getTime() - Math.max(0, Number(rule.days) || 0) * 86400000;
    return true;
  }
  function rowData(row) {
    const cells = [...row.querySelectorAll(':scope > td')];
    const headerTable = document.querySelector('table.el-table__header');
    const headers = headerTable ? [...headerTable.querySelectorAll('thead th .cell')].map(e => norm(e.innerText)) : [];
    const at = (...names) => { const i = headers.findIndex(x => names.includes(x)); return i >= 0 ? cells[i] : null; };
    const patient = norm(at('鎮ｈ€呬俊鎭?)?.innerText);
    const status = norm(at('妫€鏌ョ姸鎬?)?.innerText);
    // DOM 琛岄€氬父娌℃湁鍘熷 statusCode锛涚敤鍥哄畾鐘舵€佸瓧鍏歌ˉ榻愬紑鍙戣€呰瘖鏂瘉鎹紝
    // 浣嗗彧鎶婂畠浣滀负瑙傛祴鍊硷紝涓嶇敤瀹冩敼鍔ㄩ〉闈㈢瓫閫夋潯浠躲€?    const statusCode = norm(
      row.dataset?.reportStatusCode || row.dataset?.checkStatusCode ||
      row.getAttribute('data-report-status-code') || row.getAttribute('data-check-status-code') ||
      REPORT_STATUS_CODES?.[status] || ''
    );
    const modality = norm(at('妫€鏌ョ被鍨?)?.innerText);
    const applyTime = norm(at('鐢宠鏃堕棿')?.innerText);
    const exam = norm(at('妫€鏌ラ」鐩?)?.innerText);
    const diagnosisTime = norm(at('璇婃柇鏃堕棿')?.innerText);
    const doctor = norm(at('璇婃柇鍖荤敓')?.innerText);
    const auditDoctor = norm(at('瀹℃牳鍖荤敓')?.innerText);
    const conclusion = norm(at('缁撹')?.innerText || row.dataset?.conclusion || row.dataset?.reportConclusion);
    const description = norm(at('鎻忚堪')?.innerText || at('鎶ュ憡鎻忚堪')?.innerText || row.dataset?.description);
    const imageStatus = norm(at('褰卞儚鐘舵€?)?.innerText);
    const rowText = norm(row.innerText);
    const applyNo = norm(at('鐢宠鍗曞彿')?.innerText) || row.dataset.applyNo || row.dataset.applicationNo || '';
    const institution = norm(at('鐢宠鏈烘瀯')?.innerText) || row.dataset.applyInstitution || row.dataset.institution || '';
    const hospital = norm(at('妫€鏌ュ尰闄?)?.innerText);
    const checkbox = row.querySelector('input[type="checkbox"]');
    const key = checkbox?.id || [patient, applyTime, modality, exam].join('|');
    return { row, record: null, patient, status, statusCode, locked: domRowLocked(row), imageStatus, modality, applyTime, diagnosisTime, doctor, auditDoctor, conclusion, description, exam, applicationNo: applyNo, institution, hospital, rowText, age: parseAge(patient), gender: parseGender(patient), key };
  }

  function queryBodyRows(root = document) {
    const selectors = [config.selectors.bodyRows, 'table.el-table__body tbody tr', '.el-table__body-wrapper tbody tr', '.el-table__body tbody tr'];
    for (const selector of [...new Set(selectors.filter(Boolean))]) {
      try { const rows = [...root.querySelectorAll(selector)]; if (rows.length) return rows; } catch (_) {}
    }
    return [];
  }

  function recordData(record) {
    if (!record) return null;
    const encounter = norm(record.patSourceValue || record.encounterType || record.visitType || record.patType);
    const gender = norm(record.gender || record.sex);
    const ageValue = record.patAge ?? record.age;
    const numericAge = ageValue == null || ageValue === '' ? NaN : Number(String(ageValue).replace(/宀?g, ''));
    const age = Number.isFinite(numericAge) ? numericAge : parseAge(String(record.patName || record.patientName || ''));
    const patient = norm([record.patName || record.patientName, encounter, gender, Number.isFinite(age) ? `${age}宀乣 : ''].filter(Boolean).join(' '));
    const repUid = record.repUid || record.reportUid || record.reportId || record.id;
    const applicationNo = norm(record.applyNo || record.applicationNo || record.orderId);
    const exam = norm(record.examName || record.exam);
    const imageStatus = norm(record.imageStatus || (record.imageIsChange === 0 ? '姝ｅ父' : record.imageIsChange === 1 ? '寮傚父' : ''));
    const statusCode = norm(record.reportStatusCode || record.checkStatusCode || record.statusCode);
    const status = norm(record.reportStatus || record.reportStatusName || record.checkStatusName || record.status || REPORT_STATUS_NAMES[statusCode] || statusCode);
    const locked = recordLockState(record);
    const modality = norm(Array.isArray(record.modality) ? record.modality.join(',') : (record.modality || record.modalityName));
    const applyTime = norm(record.checkinTime || record.applyTime || record.initiateTime);
    const conclusion = norm(record.conclusion || record.reportConclusion || record.diagnosisConclusion || record.opinion || record.reportOpinion);
    const description = norm(record.description || record.reportDescription || record.reportDesc || record.remark || record.remarkText);
    const rowText = norm([patient, status, imageStatus, modality, applyTime, exam, record.applyOrgName, applicationNo, record.orderId].filter(Boolean).join('|'));
    return {
      row: null, record, patient, status, statusCode, locked, imageStatus, modality,
      applyTime,
      diagnosisTime: norm(record.repTime || record.diagnosisTime), doctor: norm(record.reportDoc),
      auditDoctor: norm(record.auditDoc || record.auditDoctor), exam, applicationNo, conclusion, description,
      institution: norm(record.applyOrgName || record.applyOrg), hospital: norm(record.checkOrgName || record.checkOrg),
      rowText, age: Number.isFinite(age) ? age : null, gender: gender || parseGender(patient),
      key: repUid ? `rep:${repUid}` : [patient, applicationNo, exam].join('|')
    };
  }

  function parseWeights(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(/[,锛孿n]/);
    const out = new Map();
    for (const item of list) {
      const text = String(item || '').trim(); if (!text) continue;
      const m = text.match(/^(.+?)\s*[=:锛歖\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) out.set(norm(m[1]), Number(m[2]));
      else out.set(norm(text), Math.max(0, 100 - out.size));
    }
    return out;
  }
  function weightOf(value, weights) {
    const text = norm(value); if (!text) return 0;
    let best = 0;
    for (const [name, score] of parseWeights(weights)) if (text === name || text.includes(name)) best = Math.max(best, Number(score) || 0);
    return best;
  }
  function hasPreliminaryConclusion(d) {
    // 缁撹瀛楁浼樺厛锛涙弿杩?澶囨敞涓嶅弬涓庘€滃垵鍐欐姤鍛娾€濆垽鏂紝閬垮厤鎶婂娉ㄨ鍒ゆ垚鎶ュ憡姝ｆ枃銆?    return !!norm(d?.conclusion);
  }
  function candidatePriority(d) {
    const exam = weightOf(d?.exam, config.examWeights);
    const institution = weightOf(d?.institution, config.institutionWeights);
    const preliminary = config.preliminaryReportFirst && hasPreliminaryConclusion(d) ? 100000 : 0;
    const applyTime = d?.applyTime ? (parseDate(d.applyTime)?.getTime() || 0) / 1e10 : 0;
    return preliminary + exam * 100 + institution * 10 + applyTime;
  }

  function lockValue(value) {
    if (value === true || value === 1) return true;
    const text = norm(value).toLowerCase();
    if (['', 'false', '0', 'no', '鍚?, '鏃?, '绌?, 'none', 'null', 'nil', 'unlocked', 'not locked', 'not occupied', '鏈攣瀹?, '鏈崰鐢?, '鏈鍗犵敤', '鏈姞閿?].includes(text)) return false;
    return ['true', '1', 'yes', '鏄?, 'locked', 'lock', '閿佸畾', '鍗犵敤'].includes(text) || /閿亅鍗犵敤|鍏朵粬鐢ㄦ埛|occupied|locked/.test(text);
  }
  function recordLockState(record) {
    if (!record || typeof record !== 'object') return false;
    return [record.isLock, record.isLocked, record.locked, record.lock, record.lockedByOther, record.lockStatus, record.lockUser, record.lockUserName, record.lockReason, record.occupyStatus, record.occupyUser, record.isOccupied]
      .some(lockValue);
  }
  function domRowLocked(row) {
    if (!row) return false;
    const rowLabel = [row.title, row.getAttribute('aria-label'), row.dataset?.lockStatus, row.dataset?.locked, row.textContent].map(norm).join('|');
    if (/褰撳墠鎶ュ憡宸茶鍏朵粬鐢ㄦ埛閿佸畾|宸茶鍏朵粬鐢ㄦ埛閿佸畾|鍏朵粬鐢ㄦ埛鍗犵敤|鎶ュ憡宸查攣瀹殀鎶ュ憡琚崰鐢?.test(rowLabel)) return true;
    const items = [...row.querySelectorAll(config.selectors.operatorItems)];
    return items.some(item => {
      const icon = operatorIconName(item).toLowerCase();
      const label = [item.getAttribute('title'), item.getAttribute('aria-label'), item.dataset?.tip, item.dataset?.title, item.textContent].map(norm).join('|');
      return /(?:unlock|un-lock)/.test(icon) || /lock|locked/.test(String(item.className || '').toLowerCase()) || /瑙ｉ攣|宸查攣瀹殀琚攣瀹殀鍏朵粬鐢ㄦ埛鍗犵敤/.test(label);
    });
  }
  function isPendingReport(d) {
    if (!d) return false;
    if (d.locked || recordLockState(d.record)) return false;
    const pendingCode = norm(config.pendingStatusValue || '102501');
    const statusCode = norm(d.statusCode || d.record?.reportStatusCode || d.record?.checkStatusCode || d.record?.statusCode);
    const status = norm(d.status || d.record?.reportStatus || d.record?.reportStatusName || d.record?.checkStatusName);
    if (/璇婃柇涓瓅寰呭鏍竱瀹℃牳涓瓅宸插鏍竱宸叉墦鍗皘鍗犵敤/.test(status) || (/閿佸畾/.test(status) && !/鏈攣瀹?.test(status))) return false;
    if (statusCode) return statusCode === pendingCode;
    return status === '寰呰瘖鏂? || status.includes('寰呰瘖鏂?);
  }

  function matchFailureReasons(d) {
    const reasons = [];
    if (!isPendingReport(d)) reasons.push(d?.locked || recordLockState(d?.record) ? '鎶ュ憡宸查攣瀹?鍗犵敤' : '鎶ュ憡鐘舵€侀潪寰呰瘖鏂?);
    if (config.reportStatuses?.length && !config.reportStatuses.some(x => norm(d.status).includes(norm(x)))) reasons.push('鎶ュ憡鐘舵€?);
    if (config.imageStatuses?.length && !config.imageStatuses.some(x => norm(d.imageStatus).includes(norm(x)))) reasons.push('褰卞儚鐘舵€?);
    if (config.encounterTypes?.length && !config.encounterTypes.some(x => norm(d.patient).includes(norm(x)))) reasons.push('灏辫瘖绫诲瀷');
    if (config.gender?.length && !config.gender.includes(d.gender)) reasons.push('鎬у埆');
    if (!config.age?.unlimited) {
      if (config.age?.min != null && (d.age == null || d.age < Number(config.age.min))) reasons.push('骞撮緞涓嬮檺');
      if (config.age?.max != null && (d.age == null || d.age > Number(config.age.max))) reasons.push('骞撮緞涓婇檺');
    }
    if (config.modalities?.length && !config.modalities.some(x => norm(d.modality) === norm(x))) reasons.push('妫€鏌ョ被鍨?);
    if (config.patientNameContains && !norm(d.patient).includes(norm(config.patientNameContains))) reasons.push('濮撳悕');
    if (config.applicationNoContains && !norm(d.applicationNo || d.rowText).includes(norm(config.applicationNoContains))) reasons.push('鐢宠鍗曞彿');
    if (config.applyInstitution?.length && !config.applyInstitution.some(x => norm(d.institution || d.rowText).includes(norm(x)))) reasons.push('鐢宠鏈烘瀯');
    if (config.auditDoctors?.length && !config.auditDoctors.some(x => norm(d.auditDoctor || d.doctor).includes(norm(x)))) reasons.push('鍖荤敓');
    if (!matchTime(d.applyTime, config.applicationTime)) reasons.push('鐢宠鏃堕棿');
    if (!matchTime(d.diagnosisTime, config.diagnosisTime)) reasons.push('璇婃柇瀹℃牳鏃堕棿');
    const parts = d.exam.split(config.examSeparators).map(norm).filter(Boolean);
    const siteRule = config.examSiteCount || (config.singleSiteOnly ? { min: 1, max: 1 } : { min: null, max: null });
    if (siteRule.min != null && parts.length < Number(siteRule.min)) reasons.push('妫€鏌ラ儴浣嶈繃灏?);
    if (siteRule.max != null && parts.length > Number(siteRule.max)) reasons.push('妫€鏌ラ儴浣嶈繃澶?);
    const acceptedExams = [...(config.examNames || []), ...(config.examNamesExtra || [])];
    if (acceptedExams.length && !acceptedExams.some(x => norm(parts[0] || d.exam) === norm(x))) reasons.push('妫€鏌ラ」鐩?);
    return reasons;
  }
  function matches(d) {
    return matchFailureReasons(d).length === 0;
  }

  function pendingSelector() {
    return String(config.selectors.statusInput).replace('{pendingStatusValue}', CSS.escape(String(config.pendingStatusValue)));
  }

  // 涓嶅啀淇敼椤甸潰鐨勭姸鎬佸閫夋銆傞〉闈㈢瓫閫夊睘浜庣敤鎴蜂氦浜掞紝鍗忚閾捐矾浣跨敤
  // config.reportStatuses 鑷繁鏋勯€犺姹傛潯浠讹紝閬垮厤鍚庡彴鑴氭湰鎶婄敤鎴峰垏鎹㈢殑鍒楄〃閲嶇疆涓衡€滃緟璇婃柇鈥濄€?  async function ensurePendingFilter() { return; }

  function operatorIconName(item) {
    const use = item?.querySelector?.('use');
    return norm(use?.getAttribute('xlink:href') || use?.getAttribute('href') || '');
  }

  function operatorDisabled(item) {
    if (!item) return true;
    return item.classList.contains('is-disabled') || item.classList.contains('disabled') || item.getAttribute('aria-disabled') === 'true';
  }

  function diagnoseOperator(row) {
    const items = [...row.querySelectorAll(config.selectors.operatorItems)];
    // 椤甸潰鍦ㄩ儴鍒嗙姸鎬佷笅浼氭妸閿佸畾/瑙ｉ攣鍥炬爣鏀惧湪鏈€鍓嶉潰锛屼笉鑳藉啀渚濊禆鍥哄畾搴忓彿銆?    const report = items.find(item => /(?:^|-)report$/i.test(operatorIconName(item)) && !operatorDisabled(item));
    if (report) return report;
    const titled = items.find(item => /璇婃柇/.test([item.getAttribute('title'), item.getAttribute('aria-label'), item.dataset?.tip, item.dataset?.title].filter(Boolean).join(' ')) && !operatorDisabled(item));
    if (titled) return titled;
    const configured = items[Number(config.selectors.diagnoseOperatorIndex)];
    return configured && !operatorDisabled(configured) ? configured : null;
  }

  function clickDiagnose(d) {
    if (!d?.row) return false;
    const current = rowData(d.row);
    if (!isPendingReport(current)) {
      developerLog('椤甸潰鐐瑰嚮璺宠繃', { ...debugCandidate(current), reason: current.locked ? '鎶ュ憡宸查攣瀹?鍗犵敤' : '鎶ュ憡鐘舵€侀潪寰呰瘖鏂? });
      return false;
    }
    const item = diagnoseOperator(d.row);
    if (!item) {
      const items = [...d.row.querySelectorAll(config.selectors.operatorItems)].map((x, i) => ({ index: i, icon: operatorIconName(x), className: x.className }));
      console.warn('[鑷姩璇婃柇] 鎵句笉鍒板彲鐢ㄧ殑璇婃柇鎿嶄綔鎸夐挳', { items });
      return false;
    }
    item.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    if (typeof item.click === 'function') item.click();
    else item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }

  // Vue 琛ㄦ牸琛屾病鏈夋妸 repUid 娓叉煋鍒?DOM銆傜敤鎴疯剼鏈粛鍙粠 Vue 鐨?vnode/component
  // 寮曠敤涓彇鍒拌瀵硅薄锛涢亶鍘嗚寖鍥村埢鎰忛檺鍒跺湪褰撳墠琛岄檮杩戯紝閬垮厤鎵弿鏁存５缁勪欢鏍戙€?  function findRowRecord(d) {
    const isolatedRoot = d?.row;
    const page = pageWindow();
    let root = isolatedRoot;
    // Vue 鐨?__vnode/缁勪欢寮曠敤浣嶄簬椤甸潰涓栫晫锛汿ampermonkey 闅旂涓栫晫涓殑鍚屼竴 DOM
    // 鑺傜偣鐪嬩笉鍒拌繖浜?expando锛屽洜姝ゆ寜琛屽簭鍙峰彇涓€涓〉闈笘鐣岃妭鐐瑰啀璇诲彇銆?    try {
      const rows = queryBodyRows();
      const index = rows.indexOf(isolatedRoot);
      const pageRows = queryBodyRows(page.document);
      root = pageRows[index] || isolatedRoot;
    } catch (_) {}
    if (!root) return null;
    const queue = [];
    const add = value => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
      if (queue.some(x => x === value)) return;
      queue.push(value);
    };
    add(root.__vueParentComponent);
    add(root.__vnode);
    add(root.parentElement?.__vueParentComponent);
    add(root.parentElement?.__vnode);
    add(root.parentElement?.parentElement?.__vueParentComponent);
    add(root.parentElement?.parentElement?.__vnode);
    const patientName = norm(d.patient).split(/闂ㄨ瘖|鎬ヨ瘖|浣忛櫌|浣撴/)[0];
    const wanted = [norm(d.applicationNo), patientName, norm(d.applyTime), norm(d.exam)].filter(Boolean);
    const isRecord = value => {
      if (!value || typeof value !== 'object' || !value.repUid) return false;
      const text = norm([value.patName, value.patientName, value.applyNo, value.applicationNo, value.orderId, value.examName, value.checkTime, value.checkinTime, value.applyTime, value.studyDate, value.reportStatus].filter(Boolean).join('|'));
      // 鍙帴鍙楄兘涓庡綋鍓嶈浠讳竴瀛楁瀵瑰簲鐨勮褰曪紝閬垮厤璇彇鍚屼竴缁勪欢鏍戜腑鐨勫叾瀹冭銆?      return !wanted.length || wanted.some(x => text.includes(x));
    };
    const seenObj = new WeakSet();
    for (let i = 0; i < queue.length && i < 80; i++) {
      const value = queue[i];
      if (!value || (typeof value !== 'object' && typeof value !== 'function') || seenObj.has(value)) continue;
      seenObj.add(value);
      if (isRecord(value)) return value;
      let keys = [];
      try { keys = Object.keys(value); } catch (_) {}
      for (const key of keys.slice(0, 120)) {
        let child;
        try { child = value[key]; } catch (_) { continue; }
        if (child && typeof child === 'object') add(child);
      }
      // Vue 3 鐨勭粍浠跺疄渚嬪父鎶婂師濮?props/鍝嶅簲寮忚瀵硅薄鏀惧湪杩欎簺浣嶇疆銆?      for (const key of ['proxy', 'props', 'setupState', 'data', 'subTree', 'children', 'component', 'ctx', 'exposed']) {
        try { add(value[key]); } catch (_) {}
      }
    }
    return null;
  }

  function radiationListPayload(options = {}) {
    const match = options.match || null;
    const timeRange = options.ignoreApplicationTime ? { start: '', end: '' } : (options.timeRange || applicationTimeRange(config.applicationTime));
    const payload = {
      modalityList: [], patName: '', startDiagTime: '', endDiagTime: '', diagDate: '',
      checkinStartTime: timeRange.start, checkinEndTime: timeRange.end, studyDate: '', status: '', patId: '',
      orderId: '', checkinDoc: '', reportDoc: '', auditDoc: '', applyNo: '', applyDoc: '',
      applyDep: '', applyOrgName: '', opinion: '', patSource: '', bodyPartName: '', examName: '',
      reportStatusCodeList: [], did: '', roomId: '', repGroupList: [], auditGroupList: [],
      sortColumnName: '', sortStatus: '', recentAudit: false, recentDiagnosis: false,
      docUid: null, patAgeUnit: '宀?, sortByParams: [{ sortField: 'checkinTime', sortRule: 'DESC' }], checkOrgId: '', clinicalInfo: '',
      tailOrderIds: [], gender: '', pageNum: 1, pageSize: Math.max(1, Math.min(100, Number(options.pageSize) || 30))
    };
    if (!options.ignoreStatusFilter) payload.reportStatusCodeList = probeStatusCodes();
    if (!options.ignoreModalityFilter) payload.modalityList = Array.isArray(config.modalities) ? [...config.modalities] : [];
    if (!options.ignoreInstitutionFilter && config.applyInstitution?.length === 1) payload.applyOrgName = config.applyInstitution[0];
    if (match) {
      const patientName = norm(match.patient).split(/闂ㄨ瘖|鎬ヨ瘖|浣忛櫌|浣撴/)[0];
      if (patientName) payload.patName = patientName;
      if (match.applicationNo) {
        payload.applyNo = match.applicationNo;
      }
      if (match.exam) payload.examName = match.exam;
    }
    return payload;
  }

  async function fetchRadiationRecords(options = {}) {
    // 鍒楄〃鎺ュ彛鍙锛屼笉浼氭敼鍙樻姤鍛婄姸鎬侊紱鍚屾椂鐢ㄤ簬鍗忚鍏滃簳鍜屾洿鏂板彲閫夐」鐩€?    const startedAt = Date.now();
    developerLog('鍒楄〃璇锋眰寮€濮?, {
      source: options.reason || 'list', narrow: !!options.match,
      pageSize: Math.max(1, Math.min(100, Number(options.pageSize) || 30))
    });
    try {
      await ensureSessionIdentity();
      const { response, payload: json } = await fetchJson('/api/ct/rays/rep/list', {
        method: 'POST', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(radiationListPayload(options))
      }, options.timeoutMs || 5000);
      const records = json?.data?.records || json?.data?.list || (Array.isArray(json?.data) ? json.data : []);
      if (!response.ok || json?.code !== 200 || !Array.isArray(records)) {
        developerLog('鍒楄〃璇锋眰缁撴灉', { source: options.reason || 'list', ok: false, httpOk: !!response.ok, code: json?.code ?? null, count: 0, durationMs: Date.now() - startedAt });
        return [];
      }
      developerLog('鍒楄〃璇锋眰缁撴灉', { source: options.reason || 'list', ok: true, count: records.length, durationMs: Date.now() - startedAt });
      return records;
    } catch (e) {
      console.warn('[鑷姩璇婃柇] 鍒楄〃鍗忚鏌ヨ澶辫触', String(e));
      developerLog('鍒楄〃璇锋眰寮傚父', { source: options.reason || 'list', error: debugError(e), durationMs: Date.now() - startedAt });
      return [];
    }
  }

  async function findRowRecordByApi(d) {
    try {
      const records = await fetchRadiationRecords({ match: d, pageSize: 20, timeoutMs: 4500 });
      const patientName = norm(d.patient).split(/闂ㄨ瘖|鎬ヨ瘖|浣忛櫌|浣撴/)[0];
      const score = record => {
        let n = 0;
        if (d.applicationNo && [record.applyNo, record.applicationNo].some(x => norm(x) === norm(d.applicationNo))) n += 20;
        if ([record.orderId, record.patId].some(x => norm(x) && norm(x) === norm(d.applicationNo))) n += 10;
        if (patientName && norm(record.patName || record.patientName).includes(patientName)) n += 5;
        if (d.exam && norm(record.examName).includes(norm(d.exam))) n += 4;
        if (d.applyTime && norm(record.checkinTime || record.applyTime).includes(norm(d.applyTime))) n += 3;
        return n;
      };
      let best = null, bestScore = 0;
      for (const record of records) {
        const recordId = record?.repUid || record?.reportUid || record?.reportId || record?.id;
        if (!recordId) continue;
        const current = score(record);
        if (current > bestScore) { best = record; bestScore = current; }
      }
      return bestScore >= 4 ? best : null;
    } catch (e) {
      return null;
    }
  }

  async function protocolEnter(d) {
    const record = d?.record || findRowRecord(d) || await findRowRecordByApi(d);
    const repUid = record?.repUid || record?.reportUid || record?.reportId || record?.id;
    const recordView = record ? recordData(record) : null;
    const entryData = {
      ...(d || {}),
      ...(recordView || {}),
      status: recordView?.status || d?.status || '',
      statusCode: recordView?.statusCode || d?.statusCode || '',
      locked: !!(recordView?.locked || d?.locked),
      record
    };
    if (!isPendingReport(entryData)) {
      d.__entryBlocked = entryData.locked ? '鎶ュ憡宸查攣瀹?鍗犵敤' : '鎶ュ憡鐘舵€侀潪寰呰瘖鏂?;
      developerLog('鍗忚杩涘叆璺宠繃', { ...debugCandidate(entryData), reason: d.__entryBlocked });
      return false;
    }
    if (!repUid) {
      console.warn('[鑷姩璇婃柇] 褰撳墠琛屾湭鍙栧緱鎶ュ憡缂栧彿锛屽崗璁繘鍏ユ殏涓嶅彲鐢紝灏嗗皾璇曢〉闈㈡寜閽?);
      developerLog('鍗忚杩涘叆璺宠繃', { ...debugCandidate(entryData), reason: '缂哄皯璁板綍缂栧彿' });
      return false;
    }
    const startedAt = Date.now();
    developerLog('鍗忚杩涘叆寮€濮?, { ...debugCandidate(entryData), reason: '鏍￠獙鍏佽杩涘叆' });
    try {
      await ensureSessionIdentity();
      const url = `/api/ct/rays/rep/assertAllowEnter?repUid=${encodeURIComponent(String(repUid))}`;
      const { response, payload } = await fetchJson(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }, 4500);
      const serverMessage = norm(payload?.message);
      const lockedMessage = /閿佸畾|鍗犵敤|鍏朵粬鐢ㄦ埛|璇婃柇涓瓅瀹℃牳涓?.test(serverMessage);
      const protocolAllowed = protocolAllowsEntry(payload);
      if (!response.ok || payload?.code !== 200 || !protocolAllowed) {
        console.warn('[鑷姩璇婃柇] 绯荤粺涓嶅厑璁歌繘鍏ヨ瘖鏂?, { code: payload?.code, message: payload?.message });
        if (lockedMessage || (response.ok && payload?.code === 200 && payload?.data !== undefined && !protocolAllowed)) d.__entryBlocked = lockedMessage ? '鎶ュ憡宸查攣瀹?鍗犵敤' : '涓氬姟鏍￠獙鏈厑璁?;
        developerLog('鍗忚杩涘叆鎷掔粷', { ...debugCandidate(entryData), code: payload?.code ?? null, reason: lockedMessage ? '鎶ュ憡宸查攣瀹?鍗犵敤' : '涓氬姟鏍￠獙鎷掔粷', durationMs: Date.now() - startedAt });
        return false;
      }
      const applyOrgCode = record?.applyOrgCode || record?.applyOrg || d?.row?.dataset?.applyOrgCode || '';
      const query = new URLSearchParams({ id: String(repUid) });
      if (applyOrgCode) query.set('applyOrgCode', String(applyOrgCode));
      console.info('[鑷姩璇婃柇] 鍗忚鏍￠獙閫氳繃锛屾墦寮€璇婃柇椤?, { hasReportId: true });
      developerLog('鍗忚杩涘叆鎴愬姛', { ...debugCandidate(entryData), durationMs: Date.now() - startedAt });
      // 鐩存帴浣跨敤涓氬姟璺敱锛岃瘖鏂〉浼氭寜绯荤粺鍘熸祦绋嬬户缁幏鍙栧苟閿佸畾璁板綍銆?      pageWindow().location.href = `/radiation/report?${query.toString()}`;
      return true;
    } catch (e) {
      console.warn('[鑷姩璇婃柇] 鍗忚杩涘叆澶辫触锛屽皢灏濊瘯椤甸潰鎸夐挳', { error: String(e) });
      developerLog('鍗忚杩涘叆寮傚父', { ...debugCandidate(entryData), error: debugError(e), durationMs: Date.now() - startedAt });
      return false;
    }
  }

  function protocolAllowsEntry(payload) {
    const data = payload?.data;
    if (!data) return false;
    if (typeof data !== 'object') return !!data;
    const flags = ['allow', 'allowed', 'canEnter', 'isAllow', 'success', 'pass'].filter(key => data[key] !== undefined);
    return !flags.length || flags.some(key => data[key] === true || data[key] === 1 || String(data[key]).toLowerCase() === 'true');
  }

  async function enterDiagnosis(d) {
    if (entryRunning) return false;
    if (d?.__entryBlocked) {
      developerLog('杩涘叆鍓嶇‖闂ㄧ鎷掔粷', { ...debugCandidate(d), reason: d.__entryBlocked });
      return false;
    }
    if (!isPendingReport(d)) {
      developerLog('杩涘叆鍓嶇‖闂ㄧ鎷掔粷', { ...debugCandidate(d), reason: d?.locked ? '鎶ュ憡宸查攣瀹?鍗犵敤' : '鎶ュ憡鐘舵€侀潪寰呰瘖鏂? });
      return false;
    }
    entryRunning = true;
    try {
      if (config.entryMode !== 'click') {
        const entered = await protocolEnter(d);
        if (entered || config.entryMode === 'protocol-only' || d?.__entryBlocked) return entered;
      }
      return d?.row ? clickDiagnose(d) : false;
    } finally {
      entryRunning = false;
    }
  }

  const REPORT_STATUS_CODES = Object.fromEntries(Object.entries(REPORT_STATUS_NAMES).map(([code, name]) => [name, code]));
  function probeStatusCodes() {
    const rules = config.reportStatuses || [];
    if (!rules.length) return [];
    return [...new Set(rules.map(value => {
      const text = norm(value);
      return text === '寰呰瘖鏂? ? String(config.pendingStatusValue || REPORT_STATUS_CODES[text]) : (REPORT_STATUS_CODES[text] || text);
    }).filter(Boolean))];
  }
  function statusProbePayload() {
    const payload = radiationListPayload({ pageSize: 1 });
    payload.reportStatusCodeList = probeStatusCodes();
    payload.modalityList = Array.isArray(config.modalities) ? [...config.modalities] : [];
    if (config.applyInstitution?.length === 1) payload.applyOrgName = config.applyInstitution[0];
    return payload;
  }
  function statusHash(data) {
    if (!data || typeof data !== 'object') return JSON.stringify(data ?? null);
    return JSON.stringify(Object.keys(data).sort().reduce((out, key) => { out[key] = data[key]; return out; }, {}));
  }
  function dataKeys(d) {
    return [...new Set([
      d?.key,
      d?.record?.repUid != null ? `rep:${d.record.repUid}` : '',
      d?.applicationNo ? `apply:${norm(d.applicationNo)}` : ''
    ].filter(Boolean))];
  }
  function dataSeen(d) { return dataKeys(d).some(key => seen.has(key)); }
  function rememberData(d) {
    for (const key of dataKeys(d)) seen.set(key, Date.now());
    while (seen.size > Number(config.seenLimit || 500)) seen.delete(seen.keys().next().value);
  }
  async function processRemoteRecords(records) {
    if (config.entryMode === 'click') return false;
    developerLog('鍒楄〃鍊欓€夊鐞?, { source: 'remote-list', count: Array.isArray(records) ? records.length : 0 });
    const orderedRecords = [...(records || [])].map(record => ({ record, data: recordData(record) })).filter(x => x.data).sort((a, b) => candidatePriority(b.data) - candidatePriority(a.data));
    for (const { record, data: prebuilt } of orderedRecords) {
      const d = prebuilt;
      if (!d) {
        developerLog('鍊欓€夋棤鏁?, { source: 'remote-list', reason: '鏃犳硶瑙ｆ瀽璁板綍' });
        continue;
      }
      const reasons = matchFailureReasons(d);
      if (dataSeen(d)) {
        developerLog('鍊欓€夎烦杩?, { ...debugCandidate(d, { source: 'remote-list' }), reason: '宸插鐞? });
        continue;
      }
      if (reasons.length) {
        developerLog('鍊欓€夎繃婊?, { ...debugCandidate(d, { source: 'remote-list' }), reason: '瑙勫垯涓嶅尮閰?, failedRules: reasons });
        continue;
      }
      developerLog('鍊欓€夊懡涓?, { ...debugCandidate(d, { source: 'remote-list' }), reason: '瑙勫垯閫氳繃' });
      if (!await enterDiagnosis(d)) {
        developerLog('鍊欓€夎繘鍏ュけ璐?, { ...debugCandidate(d, { source: 'remote-list' }), reason: '鍗忚鍜岄〉闈㈠叆鍙ｅ潎鏈垚鍔? });
        continue;
      }
      rememberData(d);
      console.info('[鑷姩璇婃柇] 杞婚噺鎺㈡祴鍛戒腑锛屽崗璁繘鍏ヨ瘖鏂細', { exam: d.exam, modality: d.modality });
      await new Promise(resolve => setTimeout(resolve, Number(config.clickDelayMs) || 0));
      return true;
    }
    return false;
  }
  async function refreshRemoteCandidates(options = {}) {
    const now = Date.now();
    const force = options.force === true;
    const match = options.match && typeof options.match === 'object' ? options.match : null;
    const normalCooldown = Math.max(10000, Number(config.listHeartbeatMs) || 15000);
    const cooldown = force ? 3000 : normalCooldown;
    if (listRefreshRunning || now - lastListFetchAt < cooldown) {
      // 淇濈暀 WebSocket 鎼哄甫鐨勭簿纭嚎绱紝寰呭綋鍓嶈姹傜粨鏉熸垨鍐峰嵈缁撴潫鍚庡啀鎸夎绾跨储鍙栧垪琛ㄣ€?      if (match) queuedRealtimeMatch = match;
      developerLog('鍒楄〃璇锋眰鎺掗槦', { source: options.reason || 'list', reason: listRefreshRunning ? '宸叉湁璇锋眰杩涜涓? : '鍐峰嵈淇濇姢', waitMs: Math.max(0, cooldown - (now - lastListFetchAt)), narrow: !!match });
      return false;
    }
    listRefreshRunning = true;
    lastListFetchAt = now;
    try {
      // 鏈夌簿纭嚎绱㈡椂缂╁皬璇锋眰鑼冨洿锛涙病鏈夌嚎绱㈡墠鍙栧父瑙勭殑鏈€杩戝垪琛ㄣ€?      const records = await fetchRadiationRecords({ match, pageSize: match ? 20 : 30, timeoutMs: 5000, reason: options.reason || 'list' });
      return await processRemoteRecords(records);
    } finally {
      listRefreshRunning = false;
    }
  }
  async function probeStatus() {
    // 鍗忚鎺㈡祴涓嶄緷璧栬〃鏍?DOM锛岄殣钘忔爣绛鹃〉涔熺户缁伐浣滐紱娴忚鍣ㄥ喕缁撻〉闈㈡椂鍒欑敱 WebSocket
    // 娑堟伅鍦ㄦ仮澶嶅悗琛ヤ笂銆侱OM 鎵弿浠嶇敱 scan() 鑷繁闄愬埗涓哄墠鍙版墽琛屻€?    if (!config.enabled || config.entryMode === 'click' || probeRunning || pageWindow().location.pathname !== '/radiation') return;
    if (!accountAllowed()) return;
    probeRunning = true;
    const startedAt = Date.now();
    try {
      await ensureSessionIdentity();
      const { response, payload } = await fetchJson('/api/ct/rays/rep/statusNum', {
        method: 'POST', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(statusProbePayload())
      }, Math.min(5000, Math.max(2500, Number(config.statusProbeMs) || 5000)));
      const data = payload?.data;
      if (!response.ok || payload?.code !== 200 || !data) throw new Error(`statusNum code=${payload?.code ?? 'unknown'}`);
      const hash = statusHash(data);
      const changed = !!lastStatusHash && hash !== lastStatusHash;
      lastStatusHash = hash;
      statusProbeFailures = 0;
      const heartbeatMs = Math.max(10000, Number(config.listHeartbeatMs) || 15000);
      const heartbeatDue = Date.now() - lastListFetchAt >= heartbeatMs;
      developerLog('鐘舵€佹帰娴嬬粨鏋?, { ok: true, changed, heartbeatDue, durationMs: Date.now() - startedAt });
      if (changed || heartbeatDue) await refreshRemoteCandidates({ reason: changed ? 'status-change' : 'heartbeat' });
    } catch (e) {
      statusProbeFailures = Math.min(statusProbeFailures + 1, 4);
      console.debug('[鑷姩璇婃柇] 杞婚噺鐘舵€佹帰娴嬪け璐ワ紝绋嶅悗閫€閬块噸璇?, String(e));
      developerLog('鐘舵€佹帰娴嬪け璐?, { ok: false, error: debugError(e), failureCount: statusProbeFailures, durationMs: Date.now() - startedAt });
      scheduleAutoQueryFallback();
    } finally {
      probeRunning = false;
    }
  }
  function probeBaseMs() {
    const configured = Math.max(3000, Number(config.statusProbeMs) || 5000);
    // WebSocket 鏈€杩戞湁涓氬姟鎻愮ず鏃讹紝璁℃暟璇锋眰鍙仛杈冧綆棰戝仴搴峰厹搴曪紱闀挎椂闂存棤鎻愮ず鍐嶆仮澶嶉厤缃鐜囥€?    if (lastRealtimeHintAt && Date.now() - lastRealtimeHintAt < 60000) return Math.max(15000, configured);
    // 闅愯棌鏍囩椤靛彧鍋氫綆棰戣鏁板厹搴曪紝瀹炴椂鎬х敱鍚屼竴鏉?WebSocket 杩炴帴璐熻矗锛岄伩鍏嶅悗鍙伴珮棰戝畬鏁村垪琛ㄨ姹傘€?    return document.visibilityState === 'hidden' ? Math.max(15000, configured) : configured;
  }
  function nextProbeDelay() {
    const base = probeBaseMs();
    if (statusProbeFailures) return Math.min(60000, base * (2 ** statusProbeFailures));
    return Math.round(base * (0.85 + Math.random() * 0.3));
  }
  function scheduleProbe(delay = 0) {
    if (probeTimer) clearTimeout(probeTimer);
    if (!config.enabled) return;
    probeTimer = setTimeout(async () => {
      await probeStatus();
      scheduleProbe(nextProbeDelay());
    }, Math.max(0, Number(delay) || 0));
  }

  function queueRealtimeRefresh(options = {}) {
    if (!config.enabled || config.entryMode === 'click' || !config.realtimeHints || pageWindow().location.pathname !== '/radiation') return;
    if (!accountAllowed()) return;
    if (options.match && typeof options.match === 'object') queuedRealtimeMatch = options.match;
    if (realtimeRefreshTimer) return;
    const minGap = 3000;
    const delay = Math.max(0, minGap - (Date.now() - lastRealtimeRefreshAt));
    developerLog('瀹炴椂鍒楄〃璋冨害', { source: 'websocket', delayMs: delay, narrow: !!options.match });
    realtimeRefreshTimer = setTimeout(async () => {
      realtimeRefreshTimer = null;
      lastRealtimeRefreshAt = Date.now();
      const match = queuedRealtimeMatch;
      queuedRealtimeMatch = null;
      await refreshRemoteCandidates({ force: true, reason: 'websocket-hint', match });
      // 璇锋眰閲嶅彔鎴栧喎鍗翠繚鎶ゆ椂锛宺efreshRemoteCandidates 浼氭妸绾跨储鏀惧洖闃熷垪锛涚◢鍚庨噸璇曪紝
      // 鏃笉涓㈠疄鏃朵簨浠讹紝涔熶笉鎶婂垪琛ㄦ帴鍙ｅ彉鎴愰珮棰戣疆璇€?      if (queuedRealtimeMatch) {
        const pending = queuedRealtimeMatch;
        queuedRealtimeMatch = null;
        setTimeout(() => queueRealtimeRefresh({ match: pending }), 500);
      }
    }, delay);
  }

  async function processRealtimeHint(hint) {
    if (!config.enabled || config.entryMode === 'click' || !config.realtimeHints || pageWindow().location.pathname !== '/radiation') return;
    if (!accountAllowed()) return;
    if (!hint || typeof hint !== 'object') {
      queueRealtimeRefresh();
      return;
    }
    lastRealtimeHintAt = Date.now();
    const rawRecord = hint.record && typeof hint.record === 'object'
      ? { ...hint.record, ...(hint.repUid ? { repUid: hint.record.repUid || hint.repUid } : {}) }
      : hint;
    const d = recordData(rawRecord);
    const recordId = d?.record?.repUid || d?.record?.reportUid || d?.record?.reportId || d?.record?.id || '';
    const hasIdentity = !!(d && (recordId || d.applicationNo || d.patient || d.applyTime || d.exam));
    developerLog('瀹炴椂鎺ㄩ€佹敹鍒?, { ...debugCandidate(d), source: 'websocket', hasIdentity, hasRecordId: !!recordId });
    if (!hasIdentity) {
      developerLog('瀹炴椂鎺ㄩ€侀檷绾?, { source: 'websocket', reason: '绾跨储瀛楁涓嶈冻' });
      queueRealtimeRefresh();
      return;
    }
    let entered = false;
    if (!realtimeRecordRunning) {
      realtimeRecordRunning = true;
      try {
        const seenAlready = !!d && dataSeen(d);
        const failedRules = d ? matchFailureReasons(d) : [];
        if (seenAlready) developerLog('鍊欓€夎烦杩?, { ...debugCandidate(d, { source: 'websocket' }), reason: '宸插鐞? });
        else if (d && failedRules.length) developerLog('鍊欓€夎繃婊?, { ...debugCandidate(d, { source: 'websocket' }), reason: '瑙勫垯涓嶅尮閰?, failedRules });
        else if (d && !recordId) developerLog('瀹炴椂鎺ㄩ€侀檷绾?, { ...debugCandidate(d, { source: 'websocket' }), reason: '绾跨储娌℃湁璁板綍缂栧彿' });
        if (d && !seenAlready && !failedRules.length && recordId) {
          entered = await enterDiagnosis(d);
          if (entered) rememberData(d);
          else developerLog('鍊欓€夎繘鍏ュけ璐?, { ...debugCandidate(d, { source: 'websocket' }), reason: '鍗忚鍏ュ彛澶辫触锛岀瓑寰呯獎鍒楄〃鍏滃簳' });
        }
      } catch (e) {
        console.debug('[鑷姩璇婃柇] 瀹炴椂鎻愮ず澶勭悊澶辫触锛岃浆鍏ュ垪琛ㄥ厹搴?, String(e));
        developerLog('瀹炴椂鎺ㄩ€佸鐞嗗紓甯?, { ...debugCandidate(d), source: 'websocket', error: debugError(e) });
      } finally {
        realtimeRecordRunning = false;
      }
    }
    // 鎺ㄩ€佹秷鎭病鏈夊畬鏁磋褰曟垨鍗忚杩涘叆澶辫触鏃讹紝鎸夎鏉＄嚎绱㈠彇涓€娆＄獎鍒楄〃锛?    // 涓嶅啀浠庣涓€椤电殑鍏ㄩ噺鍊欓€変腑鐩茬洰鎵弿銆?    if (!entered) queueRealtimeRefresh({ match: d });
    else developerLog('瀹炴椂鎺ㄩ€佽繘鍏ユ垚鍔?, { ...debugCandidate(d), source: 'websocket' });
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
        console.debug('[鑷姩璇婃柇] 瀹炴椂鎺ㄩ€佹ˉ鎺ュ畨瑁呭け璐ワ紝灏嗕娇鐢ㄨ交閲忕姸鎬佹帰娴?, String(e));
      }
    };
    if (document.documentElement) inject();
    else document.addEventListener('DOMContentLoaded', inject, { once: true });
  }

  async function scan() {
    if (!config.enabled || running || document.visibilityState === 'hidden') return;
    if (!accountAllowed()) return;
    running = true;
    try {
      const rows = queryBodyRows().map(rowData);
      for (const d of rows) {
        const reasons = matchFailureReasons(d);
        if (config.developerMode && d.row) {
          const operator = diagnoseOperator(d.row);
          developerLog('椤甸潰琛岀姸鎬?, {
            ...debugCandidate(d, { source: 'dom', reason: reasons[0] || '瑙勫垯閫氳繃' }),
            diagnoseEntryFound: !!operator,
            diagnoseEntryDisabled: !!operator && operatorDisabled(operator),
            operatorCount: d.row.querySelectorAll(config.selectors.operatorItems).length
          });
        }
        if (dataSeen(d)) {
          developerLog('鍊欓€夎烦杩?, { ...debugCandidate(d, { source: 'dom' }), reason: '宸插鐞? });
          continue;
        }
        if (reasons.length) {
          developerLog('鍊欓€夎繃婊?, { ...debugCandidate(d, { source: 'dom' }), reason: '瑙勫垯涓嶅尮閰?, failedRules: reasons });
          continue;
        }
        developerLog('鍊欓€夊懡涓?, { ...debugCandidate(d, { source: 'dom' }), reason: '瑙勫垯閫氳繃' });
        // 鍙湁鐪熸鎵惧埌鍙偣鍑荤殑璇婃柇鍏ュ彛鍚庢墠璁板叆 seen锛涙寜閽殏鏃剁鐢ㄦ椂涓嬩竴杞户缁皾璇曘€?        if (!await enterDiagnosis(d)) {
          developerLog('鍊欓€夎繘鍏ュけ璐?, { ...debugCandidate(d, { source: 'dom' }), reason: '鍗忚鍜岄〉闈㈠叆鍙ｅ潎鏈垚鍔? });
          continue;
        }
        rememberData(d);
        console.info('[鑷姩璇婃柇] 鍛戒腑杩囨护瑙勫垯锛屾墦寮€璇婃柇锛?, { age: d.age, gender: d.gender, exam: d.exam, modality: d.modality });
        developerLog('鍊欓€夎繘鍏ユ垚鍔?, { ...debugCandidate(d, { source: 'dom' }) });
        await new Promise(r => setTimeout(r, Number(config.clickDelayMs) || 700));
        // 涓€娆″彧鎵撳紑涓€涓紝绛夊緟椤甸潰瀹屾垚璇婃柇璺宠浆鍚庝笅涓€杞啀澶勭悊銆?        break;
      }
    } catch (e) {
      console.error('[鑷姩璇婃柇] 鎵弿澶辫触', e);
    } finally { running = false; }
  }

  function queryButton() {
    return [...document.querySelectorAll('button')].find(button => norm(button.innerText || button.textContent) === '鏌ヨ' && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  }

  async function refreshPageListOnFocus(options = {}) {
    const automatic = options.automatic === true;
    if (!config.pageQueryRefresh) {
      developerLog('椤甸潰鏌ヨ璺宠繃', { source: 'protocol-only', reason: '鍗忚妯″紡涓嶈Е纰伴〉闈㈡煡璇㈡帶浠? });
      return false;
    }
    if (!config.enabled || pageQueryRunning || (!automatic && document.visibilityState !== 'visible') || pageWindow().location.pathname !== '/radiation') return false;
    if (!accountAllowed() || Date.now() - lastPageQueryAt < 5000) return false;
    if (automatic && Date.now() - lastPageQueryAt < 15000) return false;
    const button = queryButton();
    if (!button) return false;
    pageQueryRunning = true;
    lastPageQueryAt = Date.now();
    const startedAt = Date.now();
    developerLog('椤甸潰鏌ヨ寮€濮?, { source: automatic ? 'protocol-fallback' : 'focus' });
    try {
      button.click();
      await new Promise(resolve => setTimeout(resolve, 300));
      developerLog('椤甸潰鏌ヨ瀹屾垚', { source: automatic ? 'protocol-fallback' : 'focus', durationMs: Date.now() - startedAt });
      return true;
    } finally {
      pageQueryRunning = false;
    }
  }

  function scheduleAutoQueryFallback() {
    if (!config.enabled || config.entryMode === 'click' || !config.realtimeHints || pageWindow().location.pathname !== '/radiation') return;
    if (!config.pageQueryRefresh) return;
    if (document.visibilityState === 'visible' && lastRealtimeHintAt && Date.now() - lastRealtimeHintAt < 60000) return;
    if (autoQueryFallbackTimer || Date.now() - lastPageQueryAt < 15000) return;
    autoQueryFallbackTimer = setTimeout(async () => {
      autoQueryFallbackTimer = null;
      if (statusProbeFailures < 2 || (lastRealtimeHintAt && Date.now() - lastRealtimeHintAt < 60000)) return;
      const refreshed = await refreshPageListOnFocus({ automatic: true });
      developerLog('鍗忚鍏滃簳鏌ヨ', { source: 'protocol-fallback', refreshed, failureCount: statusProbeFailures });
    }, 15000);
  }

  function schedulePageQueryHeartbeat(delay) {
    if (pageQueryHeartbeatTimer) clearTimeout(pageQueryHeartbeatTimer);
    if (!config.enabled || config.entryMode === 'click' || !config.pageQueryRefresh || pageWindow().location.pathname !== '/radiation') return;
    const interval = Math.max(15000, Number(config.listHeartbeatMs) || 15000);
    pageQueryHeartbeatTimer = setTimeout(async () => {
      pageQueryHeartbeatTimer = null;
      if (config.enabled && config.entryMode !== 'click' && pageWindow().location.pathname === '/radiation') {
        const stale = Date.now() - lastPageQueryAt >= interval;
        // 瀹炴椂鎻愮ず鍒氬埌杈炬椂璁?WebSocket 澶勭悊閾捐矾鍏堝畬鎴愶紱瓒呰繃涓€涓埛鏂板懆鏈熶粛鏃犳彁绀猴紝
        // 鑷姩鏌ヨ涓€娆￠〉闈紝閬垮厤鍒楄〃闀挎湡鍋滅暀鍦ㄦ棫缁撴灉銆?        const websocketQuiet = !lastRealtimeHintAt || Date.now() - lastRealtimeHintAt >= 15000;
        if (stale && websocketQuiet) {
          const refreshed = await refreshPageListOnFocus({ automatic: true });
          developerLog('鑷姩鏌ヨ蹇冭烦', { source: 'page-query-heartbeat', refreshed, intervalMs: interval });
        }
      }
      schedulePageQueryHeartbeat(interval);
    }, Math.max(1000, Number(delay) || interval));
  }

  async function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    await refreshPageListOnFocus();
    await scan();
    scheduleProbe(0);
  }

  function start() {
    if (timer) clearInterval(timer);
    if (probeTimer) clearTimeout(probeTimer);
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    if (autoQueryFallbackTimer) clearTimeout(autoQueryFallbackTimer);
    if (pageQueryHeartbeatTimer) clearTimeout(pageQueryHeartbeatTimer);
    lastStatusHash = '';
    statusProbeFailures = 0;
    lastRealtimeHintAt = 0;
    queuedRealtimeMatch = null;
    // 鍏堜互褰撳墠椤甸潰琛ㄦ牸涓哄熀绾匡紝閬垮厤鎵撳紑鑴氭湰鏃跺洜涓衡€滀笉闄愭椂闂粹€濅竴娆℃€ф姠璧版棫璁板綍銆?    lastListFetchAt = Date.now();
    lastRealtimeRefreshAt = 0;
    timer = setInterval(scan, Math.max(1000, Number(config.pollMs) || 2000));
    if (!visibilityBound) {
      visibilityBound = true;
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', onVisibilityChange);
    }
    scan();
    scheduleProbe(0);
    schedulePageQueryHeartbeat();
  }

  const PROFILE_KEY = 'jx-radiation-auto-diagnose-profiles-v1';
  function profiles() {
    try {
      const raw = GM_getValue(PROFILE_KEY, {});
      const p = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      for (const x of Object.values(p)) if (x.examSeparators?.__regexp) x.examSeparators = new RegExp(x.examSeparators.__regexp);
      return p;
    } catch (_) { return {}; }
  }
  function saveProfiles(p) { GM_setValue(PROFILE_KEY, JSON.stringify(p, (k, v) => v instanceof RegExp ? { __regexp: v.source } : v)); }
  function listValue(v) { return Array.isArray(v) ? v.join(', ') : String(v || ''); }
  function parseList(v) { return String(v || '').split(/[,锛孿n]/).map(norm).filter(Boolean); }
  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])); }

  async function runSelfCheck() {
    const checks = [];
    const path = pageWindow().location.pathname;
    checks.push(`璺敱锛?{path}`);
    checks.push(`閰嶇疆锛?{config.enabled ? '鍚敤' : '鍋滅敤'} / 杩涘叆鏂瑰紡 ${config.entryMode}`);
    checks.push(`椤甸潰琛岋細${queryBodyRows().length}锛涜处鍙烽棬绂侊細${accountAllowed() ? '閫氳繃' : '鏈€氳繃'}`);
    checks.push(`鏉冮噸锛氭鏌ラ」鐩?${parseWeights(config.examWeights).size} 椤癸紝鏈烘瀯 ${parseWeights(config.institutionWeights).size} 椤筦);
    checks.push(`骞撮緞锛?{config.age?.unlimited ? '涓嶉檺' : `${config.age?.min ?? ''}-${config.age?.max ?? ''}`}`);
    if (path === '/radiation') {
      try {
        const result = await fetchJson('/api/admin/user/info', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }, 5000);
        checks.push(`浼氳瘽锛?{result.payload?.code === 200 ? '鏈夋晥' : `涓氬姟鐮?${result.payload?.code ?? '鏈煡'}`}`);
      } catch (e) { checks.push(`浼氳瘽锛氳姹傚け璐ワ紙${String(e.message || e).slice(0, 80)}锛塦); }
      try {
        const result = await fetchJson('/api/ct/rays/rep/statusNum', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(statusProbePayload()) }, 5000);
        checks.push(`鐘舵€佸崗璁細${result.payload?.code === 200 ? '鍙敤' : `涓氬姟鐮?${result.payload?.code ?? '鏈煡'}`}`);
      } catch (e) { checks.push(`鐘舵€佸崗璁細璇锋眰澶辫触锛?{String(e.message || e).slice(0, 80)}锛塦); }
    }
    developerLog('鑴氭湰鑷', { source: 'self-check', checkCount: checks.length, route: path }, { force: true });
    return checks.join('\n');
  }

  function panel() {
    const old = document.getElementById('jx-auto-diagnose-panel');
    if (old) { old.remove(); return; }
    const box = document.createElement('div');
    box.id = 'jx-auto-diagnose-panel';
    box.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;background:#fff;color:#1f2937;border:1px solid #409eff;border-radius:10px;padding:0;box-shadow:0 12px 42px #0005;font:13px/1.45 Segoe UI,Microsoft Yahei,sans-serif';
    box.innerHTML = `
      <div class="jx-panel-header" style="padding:12px 14px;background:linear-gradient(135deg,#409eff,#67c23a);color:white;display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">鑷姩璇婃柇璁剧疆</b><button type="button" data-a="close" aria-label="鍏抽棴璁剧疆" title="鍏抽棴璁剧疆" style="border:0;background:#ffffff33;color:white;border-radius:6px;padding:2px 10px;font-size:18px;line-height:1.25;cursor:pointer">脳</button></div>
      <div class="jx-panel-content" style="padding:10px 14px;overflow:auto;min-height:0;flex:1 1 auto">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:9px"><select data-f="profile" style="flex:1;padding:5px"></select><button data-a="loadProfile">鍒囨崲</button><input data-f="profileName" placeholder="鏂规鍚? style="width:90px;padding:5px"><button data-a="saveProfile">淇濆瓨鏂规</button><button data-a="deleteProfile">鍒犻櫎</button></div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><label><input type="checkbox" data-f="enabled"> 鍚敤鑷姩鎵撳紑</label><label>鏈湴鎵弿 <input data-f="pollMs" type="number" min="1000" step="500" style="width:70px"> ms</label><label>鐘舵€佹帰娴?<input data-f="statusProbeMs" type="number" min="3000" step="1000" style="width:70px"> ms</label><label>鍒楄〃琛ュ伩 <input data-f="listHeartbeatMs" type="number" min="10000" step="1000" style="width:80px"> ms</label><label>鎿嶄綔寤惰繜 <input data-f="clickDelayMs" type="number" min="0" style="width:60px"> ms</label><label>杩涘叆鏂瑰紡 <select data-f="entryMode" style="width:auto"><option value="protocol-first">鍗忚浼樺厛锛堝け璐ュ洖閫€鐐瑰嚮锛?/option><option value="protocol-only">浠呭崗璁?/option><option value="click">椤甸潰鐐瑰嚮</option></select></label><label><input type="checkbox" data-f="pageQueryRefresh"> 鍏佽鑴氭湰鐐瑰嚮鏌ヨ</label></div>
        <small style="display:block;color:#909399;margin:-3px 0 7px">鍊欓€夊彂鐜颁紭鍏堜娇鐢?WebSocket銆佺姸鎬佽鏁板拰鍙鍒楄〃鍗忚锛涢粯璁ゆ瘡涓垪琛ㄨˉ鍋垮懆鏈熷悓姝ヤ竴娆″綋鍓嶇瓫閫夋潯浠朵笅鐨勫彲瑙佽〃鏍硷紝涓嶄細淇敼鎶ュ憡鐘舵€佸閫夋銆?/small>
        <fieldset><legend>寮€鍙戣€呮ā寮?/legend><div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><label class="jx-dev-toggle"><input type="checkbox" data-f="developerMode"> 寮€鍚紑鍙戣€呮ā寮?/label><button type="button" data-a="selfCheck">杩愯鑷</button><button type="button" data-a="copyDebug">澶嶅埗鏈€杩戣瘖鏂褰?/button><button type="button" data-a="clearDebug">娓呯┖璁板綍</button><span data-a="debugState" style="color:#909399">褰撳墠鍏抽棴</span></div><small style="color:#909399">榛樿鍏抽棴銆傝嚜妫€鍙褰撳墠椤甸潰銆佺櫥褰曚細璇濆拰鐘舵€佸崗璁紝涓嶄慨鏀规姤鍛婄姸鎬侊紱璇婃柇璁板綍涓嶈褰曟偅鑰呭鍚嶃€佺敵璇峰崟鍙枫€佹姤鍛婄紪鍙锋垨璁よ瘉淇℃伅銆?/small></fieldset>
        <fieldset><legend>鐧诲綍璐﹀彿</legend><div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><span>褰撳墠璐﹀彿锛?b data-a="currentAccount">璇诲彇涓?/b></span><button type="button" data-a="useCurrentAccount">浠呭厑璁稿綋鍓嶈处鍙?/button><button type="button" data-a="clearAccountLimit">娓呯┖闄愬埗</button></div><label>鍏佽鑷姩璇婃柇鐨勮处鍙凤紙鐣欑┖涓嶉檺锛?input data-f="allowedAccounts" placeholder="鍙～璐﹀彿缂栧彿鎴栫櫥褰曞悕锛屽涓敤閫楀彿鍒嗛殧"></label><small style="color:#909399">鏀寔璐﹀彿缂栧彿鍜岀櫥褰曞悕锛屼緥濡傝处鍙风紪鍙锋垨鐧诲綍鍚嶏紱鐣欑┖鏃舵墍鏈夌櫥褰曡处鍙烽兘鍚敤銆?/small><div style="margin-top:8px;padding-top:7px;border-top:1px dashed #dcdfe6"><label><input type="checkbox" data-f="directLoginEnabled"> 鏈櫥褰曟椂鍚敤鍗忚鐧诲綍</label><label>鍗忚鐧诲綍璐﹀彿<input data-f="directLoginUsername" autocomplete="username" placeholder="璐﹀彿缂栧彿"></label><div style="display:flex;gap:6px;margin-top:5px"><button type="button" data-a="directLoginNow">绔嬪嵆鍗忚鐧诲綍</button></div><small style="color:#909399">瀵嗙爜鍙湪鐐瑰嚮鐧诲綍鏃朵复鏃惰緭鍏ワ紝涓嶅啓鍏ラ厤缃€傞獙璇佺爜鏄剧ず鍦ㄥ脊绐椾腑锛岀洿鎺ョ偣鍑诲畬鎴愩€?/small></div></fieldset>
        <fieldset><legend>鎶ュ憡/褰卞儚鐘舵€?/legend><div class="jx-checks" data-group="reportStatuses"></div><div class="jx-checks" data-group="imageStatuses"></div></fieldset>
        <fieldset><legend>鎮ｈ€呬俊鎭?/legend><div class="jx-checks" data-group="encounterTypes"></div><div class="jx-checks" data-group="gender"></div><label class="jx-check"><input type="checkbox" data-f="ageUnlimited"> 骞撮緞涓嶉檺</label><div class="jx-grid"><label>骞撮緞浠?input data-f="ageMin" type="number"></label><label>骞撮緞鍒?input data-f="ageMax" type="number"></label><label>濮撳悕鍖呭惈<input data-f="patientNameContains"></label><label>鐢宠鍗曞彿鍖呭惈<input data-f="applicationNoContains"></label></div></fieldset>
        <fieldset><legend>妫€鏌ヤ笌鏈烘瀯</legend><div class="jx-checks" data-group="modalities"></div><div class="jx-checks" data-group="applyInstitution"></div><div class="jx-checks" data-group="examNames"></div><div class="jx-exam-head"><span>鍏朵粬妫€鏌ラ」鐩?/span><button type="button" data-a="refreshExamOptions" title="浠庡綋鍓嶅垪琛ㄦ洿鏂板叏閮ㄥ彲鍕鹃€夐」鐩?>鏇存柊鎵€鏈夊彲閫夐」鐩?/button></div><div class="jx-checks" data-group="examNamesExtra"></div><small style="color:#909399">妫€鏌ラ」鐩嬀閫夆€滀笉闄愨€濆嵆鍙尮閰嶅叏閮ㄩ」鐩紱鏉冮噸瓒婂ぇ瓒婁紭鍏堬紝鏍煎紡涓衡€滈」鐩?鏉冮噸鈥濓紝姣忚涓€椤广€?/small><label>妫€鏌ラ」鐩潈閲?textarea data-f="examWeights" rows="4" placeholder="澶撮骞虫壂=100&#10;鑲嬮骞虫壂=10"></textarea></label><label>鐢宠鏈烘瀯鏉冮噸<textarea data-f="institutionWeights" rows="3" placeholder="鏈烘瀯鍚嶇О=鏉冮噸"></textarea></label><label class="jx-check"><input type="checkbox" data-f="preliminaryReportFirst"> 鏈夌粨璁虹殑鍒濆啓鎶ュ憡浼樺厛</label><small style="color:#909399">鍙瘑鍒粨璁哄瓧娈碉紱鎻忚堪銆佸娉ㄤ笉浼氳褰撲綔缁撹銆傛病鏈夌粨璁虹殑璁板綍浠嶅彲澶勭悊锛屽彧鏄帓搴忛潬鍚庛€?/small><div class="jx-grid"><label>妫€鏌ラ儴浣嶆渶灏戞暟閲?select data-f="siteMin"><option value="">涓嶉檺</option><option value="1">1 涓?/option><option value="2">2 涓?/option><option value="3">3 涓?/option><option value="4">4 涓?/option><option value="5">5 涓?/option></select></label><label>妫€鏌ラ儴浣嶆渶澶氭暟閲?select data-f="siteMax"><option value="">涓嶉檺</option><option value="1">1 涓?/option><option value="2">2 涓?/option><option value="3">3 涓?/option><option value="4">4 涓?/option><option value="5">5 涓?/option></select></label></div><label>瀹℃牳/璇婃柇鍖荤敓锛堢暀绌轰笉闄愶級<input data-f="auditDoctors"></label></fieldset>
        <fieldset><legend>鐢宠鏃堕棿</legend><div class="jx-grid"><label>蹇嵎鑼冨洿<select data-f="applicationTimeMode"><option value="window">鏈€杩?5鈥?0 鍒嗛挓</option><option value="all">涓嶉檺</option><option value="today">褰撳ぉ</option><option value="recent">鏈€杩?N 澶?/option><option value="fromTime">褰撳ぉ浠庢寚瀹氭椂闂?/option></select></label><label>鏈€鏃╁垎閽?input data-f="applicationTimeMin" type="number" min="0" step="1"></label><label>鏈€鏅氬垎閽?input data-f="applicationTimeMax" type="number" min="1" step="1"></label><label>鏈€杩戝ぉ鏁?input data-f="applicationTimeDays" type="number" min="0" step="1"></label><label>寮€濮嬫椂闂?input data-f="applicationTimeStart" type="time"></label></div><small style="color:#909399">鈥滄渶杩?5鈥?0 鍒嗛挓鈥濊〃绀?5 鍒嗛挓鍐呬笉澶勭悊锛岃秴杩?30 鍒嗛挓涔熶笉澶勭悊銆?/small></fieldset>
        <details><summary>璇婃柇/瀹℃牳鏃堕棿锛堥€氬父涓嶇敤锛岄粯璁や笉闄愶級</summary><div class="jx-grid"><label>妯″紡<select data-f="diagnosisTimeMode"><option value="all">涓嶉檺</option><option value="today">褰撳ぉ</option><option value="recent">鏈€杩?N 澶?/option><option value="fromTime">褰撳ぉ浠庢寚瀹氭椂闂?/option></select></label><label>鏈€杩戝ぉ鏁?input data-f="diagnosisTimeDays" type="number" min="0"></label><label>寮€濮嬫椂闂?input data-f="diagnosisTimeStart" type="time"></label></div></details>
        <details><summary>楂樼骇锛氳〃鏍奸€夋嫨鍣ㄤ笌鎿嶄綔鎸夐挳</summary><label>璇婃柇鎿嶄綔鍥炬爣搴忓彿<input data-f="diagnoseOperatorIndex" type="number" min="0" style="width:60px"></label><label>寰呰瘖鏂姸鎬佸€?input data-f="pendingStatusValue"></label><label>琛ㄦ牸琛岄€夋嫨鍣?input data-f="bodyRows"></label><label>鎿嶄綔椤归€夋嫨鍣?input data-f="operatorItems"></label></details>
        <div class="jx-panel-actions" style="display:flex;gap:7px;margin-top:10px"><button type="button" data-a="apply" style="background:#409eff;color:white;border:0;border-radius:4px;padding:7px 14px">搴旂敤骞朵繚瀛?/button><button type="button" data-a="reset">鎭㈠榛樿</button><button type="button" data-a="export">瀵煎嚭閰嶇疆</button><button type="button" data-a="import">瀵煎叆閰嶇疆</button><span data-a="msg" style="color:#67c23a;align-self:center"></span></div>
      </div>`;
    document.body.appendChild(box);
    const style = document.createElement('style'); style.textContent = '#jx-auto-diagnose-panel .jx-panel-header{position:sticky;top:0;z-index:3;flex:0 0 auto;box-shadow:0 1px 5px #0002}#jx-auto-diagnose-panel .jx-panel-content{overscroll-behavior:contain}#jx-auto-diagnose-panel .jx-panel-actions{position:sticky;bottom:0;z-index:2;background:#fff;padding:8px 0 2px;box-shadow:0 -1px 5px #0001}#jx-auto-diagnose-panel fieldset{border:1px solid #dcdfe6;border-radius:6px;margin:7px 0;padding:7px}#jx-auto-diagnose-panel legend{padding:0 4px;color:#409eff}#jx-auto-diagnose-panel label{display:block;margin:4px 0}#jx-auto-diagnose-panel input,#jx-auto-diagnose-panel select,#jx-auto-diagnose-panel textarea{box-sizing:border-box;padding:4px;border:1px solid #dcdfe6;border-radius:4px;margin-top:2px;width:100%;font:inherit}#jx-auto-diagnose-panel .jx-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}#jx-auto-diagnose-panel .jx-checks{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin:4px 0}#jx-auto-diagnose-panel .jx-check{display:inline-flex;align-items:center;gap:3px;margin:0;color:#606266}#jx-auto-diagnose-panel .jx-check input{width:auto;margin:0}#jx-auto-diagnose-panel .jx-group-label{color:#909399;margin-right:3px}#jx-auto-diagnose-panel .jx-exam-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;color:#909399}#jx-auto-diagnose-panel .jx-exam-head button{padding:3px 8px;color:#409eff;border-color:#b3d8ff;background:#ecf5ff}#jx-auto-diagnose-panel button{border:1px solid #c0c4cc;background:#fff;border-radius:4px;padding:5px 8px;cursor:pointer}#jx-auto-diagnose-panel button:focus-visible{outline:2px solid #409eff;outline-offset:1px}#jx-auto-diagnose-panel [data-a="close"]{min-width:34px;min-height:30px}#jx-auto-diagnose-panel .jx-dev-toggle{display:inline-flex;align-items:center;gap:4px;color:#e6a23c;font-weight:600}#jx-auto-diagnose-panel .jx-dev-toggle input{width:auto;margin:0}'; box.appendChild(style);
    const f = n => box.querySelector(`[data-f="${n}"]`);
    const GROUPS = { reportStatuses: ['涓嶉檺','寰呰瘖鏂?,'璇婃柇涓?,'寰呭鏍?,'瀹℃牳涓?,'宸插鏍?,'宸叉墦鍗?], imageStatuses: ['涓嶉檺','姝ｅ父','寮傚父'], encounterTypes: ['涓嶉檺','闂ㄨ瘖','鎬ヨ瘖','浣忛櫌','浣撴'], gender: ['涓嶉檺','鐢?,'濂?], modalities: ['涓嶉檺','CT','MR','DR','DSA','涔宠吅'], examNames: ['涓嶉檺', ...DEFAULT_CONFIG.examNames], examNamesExtra: [] };
    function availableExamOptions() {
      const fromRows = queryBodyRows().flatMap(row => {
        const value = rowData(row).exam;
        return String(value || '').split(config.examSeparators).map(norm).filter(Boolean);
      });
      const known = [...(config.examNamesCatalog || []), ...(config.examNamesExtra || []), ...fromRows, ...DEFAULT_CONFIG.examNames].map(norm).filter(Boolean);
      return [...new Set(known)].filter(x => !DEFAULT_CONFIG.examNames.some(y => norm(y) === norm(x)));
    }
    function drawGroups() {
      for (const [name, baseOptions] of Object.entries(GROUPS)) {
        const options = name === 'examNamesExtra' ? availableExamOptions() : baseOptions;
        const host = box.querySelector(`[data-group="${name}"]`); if (!host) continue;
        const label = {reportStatuses:'鎶ュ憡鐘舵€?,imageStatuses:'褰卞儚鐘舵€?,encounterTypes:'灏辫瘖绫诲瀷',gender:'鎬у埆',modalities:'妫€鏌ョ被鍨?,examNames:'妫€鏌ラ」鐩?,examNamesExtra:'鍙€夐」鐩?}[name];
        host.innerHTML = `<span class="jx-group-label">${label}锛?/span>` + options.map(x => `<label class="jx-check"><input type="checkbox" data-group-name="${name}" value="${esc(x)}"><span>${esc(x)}</span></label>`).join('');
      }
      const values = [...new Set([...(config.applyInstitution || []), ...queryBodyRows().map(rowData).map(d => d.institution).filter(Boolean)])];
      const host = box.querySelector('[data-group="applyInstitution"]');
      if (host) host.innerHTML = '<span class="jx-group-label">鐢宠鏈烘瀯锛?/span>' + ['涓嶉檺', ...values].map(x => `<label class="jx-check"><input type="checkbox" data-group-name="applyInstitution" value="${esc(x)}"><span>${esc(x === '涓嶉檺' ? '涓嶉檺鐢宠鏈烘瀯' : x)}</span></label>`).join('');
      box.querySelectorAll('input[data-group-name]').forEach(check => check.addEventListener('change', () => {
        const group = check.dataset.groupName;
        const peers = [...box.querySelectorAll(`input[data-group-name="${group}"]`)];
        const unlimited = peers.find(item => item.value === '涓嶉檺');
        if (check.checked && check.value === '涓嶉檺') peers.forEach(item => { if (item !== check) item.checked = false; });
        if (check.checked && check.value !== '涓嶉檺' && unlimited) unlimited.checked = false;
      }));
    }
    function setGroup(name, values) { const selected = new Set(values || []); box.querySelectorAll(`[data-group-name="${name}"]`).forEach(c => { c.checked = selected.has(c.value) || (c.value === '涓嶉檺' && !values?.length); }); }
    function getGroup(name) { const all = [...box.querySelectorAll(`[data-group-name="${name}"]:checked`)].map(x => x.value); return all.includes('涓嶉檺') ? [] : all; }
    function render() {
      drawGroups();
      f('enabled').checked = !!config.enabled; f('developerMode').checked = !!config.developerMode; f('pageQueryRefresh').checked = !!config.pageQueryRefresh; f('pollMs').value = config.pollMs; f('statusProbeMs').value = config.statusProbeMs || 5000; f('listHeartbeatMs').value = config.listHeartbeatMs || 15000; f('clickDelayMs').value = config.clickDelayMs;
      const debugState = box.querySelector('[data-a="debugState"]'); if (debugState) debugState.textContent = developerModeStateText();
      const currentAccount = box.querySelector('[data-a="currentAccount"]'); if (currentAccount) currentAccount.textContent = accountDisplay();
      f('allowedAccounts').value = listValue(config.allowedAccounts);
      f('directLoginEnabled').checked = !!directLoginConfig().enabled; f('directLoginUsername').value = directLoginConfig().username || '';
      f('entryMode').value = config.entryMode || 'protocol-first';
      for (const n of ['reportStatuses','imageStatuses','encounterTypes','gender','modalities','examNames','examNamesExtra']) setGroup(n, config[n]);
      setGroup('applyInstitution', config.applyInstitution);
      f('ageUnlimited').checked = !!config.age.unlimited; f('ageMin').value = config.age.min ?? ''; f('ageMax').value = config.age.max ?? ''; f('patientNameContains').value = config.patientNameContains || ''; f('applicationNoContains').value = config.applicationNoContains || '';
      f('examWeights').value = listValue(config.examWeights).replace(/, /g, '\n'); f('institutionWeights').value = listValue(config.institutionWeights).replace(/, /g, '\n'); f('preliminaryReportFirst').checked = config.preliminaryReportFirst !== false;
      f('auditDoctors').value = listValue(config.auditDoctors); f('siteMin').value = config.examSiteCount?.min ?? ''; f('siteMax').value = config.examSiteCount?.max ?? '';
      f('applicationTimeMode').value = config.applicationTime.mode; f('applicationTimeMin').value = config.applicationTime.minMinutes ?? 5; f('applicationTimeMax').value = config.applicationTime.maxMinutes ?? 30; f('applicationTimeDays').value = config.applicationTime.days ?? ''; f('applicationTimeStart').value = config.applicationTime.start || '00:00';
      f('diagnosisTimeMode').value = config.diagnosisTime.mode; f('diagnosisTimeDays').value = config.diagnosisTime.days ?? ''; f('diagnosisTimeStart').value = config.diagnosisTime.start || '00:00';
      f('diagnoseOperatorIndex').value = config.selectors.diagnoseOperatorIndex; f('pendingStatusValue').value = config.pendingStatusValue; f('bodyRows').value = config.selectors.bodyRows; f('operatorItems').value = config.selectors.operatorItems;
      const ps = profiles(); f('profile').innerHTML = '<option value="">閫夋嫨宸蹭繚瀛樻柟妗?/option>' + Object.keys(ps).sort().map(x => `<option>${esc(x)}</option>`).join('');
    }
    function read() {
      config.enabled = f('enabled').checked; config.developerMode = f('developerMode').checked; config.pageQueryRefresh = f('pageQueryRefresh').checked; config.pollMs = Math.max(1000, Number(f('pollMs').value) || 2000); config.statusProbeMs = Math.max(3000, Number(f('statusProbeMs').value) || 5000); config.listHeartbeatMs = Math.max(10000, Number(f('listHeartbeatMs').value) || 15000); config.clickDelayMs = Number(f('clickDelayMs').value) || 0; config.entryMode = f('entryMode').value || 'protocol-first';
      config.allowedAccounts = parseList(f('allowedAccounts').value);
      config.directLogin = { enabled: f('directLoginEnabled').checked, username: f('directLoginUsername').value.trim() };
      for (const n of ['reportStatuses','imageStatuses','encounterTypes','gender','modalities','examNames','examNamesExtra']) config[n] = getGroup(n);
      config.applyInstitution = getGroup('applyInstitution'); config.auditDoctors = parseList(f('auditDoctors').value);
      config.age.unlimited = f('ageUnlimited').checked; config.age.min = config.age.unlimited || f('ageMin').value === '' ? null : Number(f('ageMin').value); config.age.max = config.age.unlimited || f('ageMax').value === '' ? null : Number(f('ageMax').value); config.patientNameContains = f('patientNameContains').value.trim(); config.applicationNoContains = f('applicationNoContains').value.trim(); config.examWeights = parseList(f('examWeights').value.replace(/\n/g, ',')); config.institutionWeights = parseList(f('institutionWeights').value.replace(/\n/g, ',')); config.preliminaryReportFirst = f('preliminaryReportFirst').checked; config.examSiteCount = { min: f('siteMin').value === '' ? null : Number(f('siteMin').value), max: f('siteMax').value === '' ? null : Number(f('siteMax').value) };
      config.applicationTime = { mode: f('applicationTimeMode').value, minMinutes: Number(f('applicationTimeMin').value) || 0, maxMinutes: Number(f('applicationTimeMax').value) || 0, days: Number(f('applicationTimeDays').value) || 0, start: f('applicationTimeStart').value || '00:00' }; config.diagnosisTime = { mode: f('diagnosisTimeMode').value, days: Number(f('diagnosisTimeDays').value) || 0, start: f('diagnosisTimeStart').value || '00:00' };
      config.pendingStatusValue = f('pendingStatusValue').value.trim() || '102501'; config.selectors.diagnoseOperatorIndex = Number(f('diagnoseOperatorIndex').value) || 0; config.selectors.bodyRows = f('bodyRows').value.trim() || DEFAULT_CONFIG.selectors.bodyRows; config.selectors.operatorItems = f('operatorItems').value.trim() || DEFAULT_CONFIG.selectors.operatorItems;
    }
    const msg = t => { const el = box.querySelector('[data-a="msg"]'); if (!el) return; el.textContent = t; setTimeout(() => { const current = box.querySelector('[data-a="msg"]'); if (current) current.textContent = ''; }, 1800); };
    box.querySelector('[data-a="apply"]').onclick = () => { read(); saveConfig(); start(); msg('宸蹭繚瀛樺苟搴旂敤'); };
    box.querySelector('[data-f="developerMode"]').onchange = () => { config.developerMode = f('developerMode').checked; const state = box.querySelector('[data-a="debugState"]'); if (state) state.textContent = developerModeStateText(); if (config.developerMode) developerLog('寮€鍙戣€呮ā寮忓紑鍚?, { source: 'settings' }, { force: true }); };
    box.querySelector('[data-a="copyDebug"]').onclick = async () => { try { await navigator.clipboard?.writeText(developerLogText()); msg(debugEvents.length ? '璇婃柇璁板綍宸插鍒? : '褰撳墠娌℃湁璇婃柇璁板綍'); } catch (_) { msg('澶嶅埗澶辫触锛岃鎵撳紑鎺у埗鍙版煡鐪?); } };
    box.querySelector('[data-a="clearDebug"]').onclick = () => { debugEvents.length = 0; debugLastAt.clear(); try { GM_setValue(DEBUG_STORAGE_KEY, []); } catch (_) {} const state = box.querySelector('[data-a="debugState"]'); if (state) state.textContent = developerModeStateText(); msg('璇婃柇璁板綍宸叉竻绌?); };
    box.querySelector('[data-a="selfCheck"]').onclick = async () => { msg('姝ｅ湪杩愯鑷鈥?); const result = await runSelfCheck(); alert(result); msg('鑷瀹屾垚'); };
    box.querySelector('[data-a="useCurrentAccount"]').onclick = () => { const identity = loginIdentity(); const value = identity.loginCode || identity.name; if (!value) return msg('褰撳墠璐﹀彿鏆傛湭璇嗗埆'); f('allowedAccounts').value = value; msg('宸插～鍏ュ綋鍓嶈处鍙?); };
    box.querySelector('[data-a="clearAccountLimit"]').onclick = () => { f('allowedAccounts').value = ''; msg('宸叉竻绌鸿处鍙烽檺鍒?); };
    box.querySelector('[data-a="directLoginNow"]').onclick = async () => { read(); saveConfig(); msg('姝ｅ湪鍗忚鐧诲綍鈥?); const ok = await ensureDirectLogin(); msg(ok ? '鍗忚鐧诲綍鎴愬姛' : '鍗忚鐧诲綍鏈畬鎴?); if (ok) { render(); start(); } };
    box.querySelector('[data-a="refreshExamOptions"]').onclick = async () => {
      read();
      msg('姝ｅ湪鏇存柊鍙€夐」鐩€?);
      const records = await fetchRadiationRecords({ pageSize: 100, timeoutMs: 8000, ignoreApplicationTime: true, ignoreStatusFilter: true, ignoreModalityFilter: true, ignoreInstitutionFilter: true });
      const fromApi = records.flatMap(record => String(record?.examName || record?.exam || '').split(config.examSeparators).map(norm).filter(Boolean));
      const options = [...new Set([...availableExamOptions(), ...fromApi])].filter(x => !DEFAULT_CONFIG.examNames.some(y => norm(y) === norm(x)));
      config.examNamesCatalog = [...new Set([...(config.examNamesCatalog || []), ...options])];
      saveConfig();
      render();
      msg(`宸叉洿鏂?${options.length} 涓彲閫夐」鐩甡);
    };
    box.querySelector('[data-a="reset"]').onclick = () => { config = structuredClone(DEFAULT_CONFIG); saveConfig(); render(); start(); msg('宸叉仮澶嶉粯璁?); };
    box.querySelector('[data-a="saveProfile"]').onclick = () => { read(); const n = f('profileName').value.trim(); if (!n) return msg('璇峰～鍐欐柟妗堝悕'); const p = profiles(); p[n] = config; saveProfiles(p); render(); f('profile').value = n; msg('鏂规宸蹭繚瀛?); };
    box.querySelector('[data-a="loadProfile"]').onclick = () => { const n = f('profile').value; const p = profiles(); if (!n || !p[n]) return msg('璇烽€夋嫨鏂规'); config = migrateConfig(merge(structuredClone(DEFAULT_CONFIG), p[n]), p[n]); saveConfig(); render(); start(); msg('鏂规宸插垏鎹?); };
    box.querySelector('[data-a="deleteProfile"]').onclick = () => { const n = f('profile').value; const p = profiles(); if (n && p[n]) { delete p[n]; saveProfiles(p); render(); msg('鏂规宸插垹闄?); } };
    box.querySelector('[data-a="export"]').onclick = async () => { await navigator.clipboard?.writeText(JSON.stringify(config, (k, v) => v instanceof RegExp ? { __regexp: v.source } : v, 2)); msg('閰嶇疆 JSON 宸插鍒?); };
    box.querySelector('[data-a="import"]').onclick = () => { const s = prompt('绮樿创閰嶇疆 JSON'); if (!s) return; try { const n = JSON.parse(s); if (n.examSeparators?.__regexp) n.examSeparators = new RegExp(n.examSeparators.__regexp); config = migrateConfig(merge(structuredClone(DEFAULT_CONFIG), n), n); saveConfig(); render(); start(); msg('宸插鍏?); } catch (e) { msg('JSON 鏃犳晥'); } };
    box.querySelector('[data-a="close"]').onclick = () => box.remove();
    render();
  }

  function attachToHeaderSettings() {
    const trigger = document.querySelector('.table-header-setting-btn, [aria-label*="琛ㄥご"], [title*="琛ㄥご"], [aria-label*="鍒楄缃?], [title*="鍒楄缃?]');
    if (!trigger || trigger.dataset.jxAutoBound) return;
    trigger.dataset.jxAutoBound = '1';
    trigger.addEventListener('click', () => setTimeout(() => {
      const title = document.querySelector('.table-header-setting-wrap__title, .el-popover__title, .el-dialog__header');
      if (!title || title.querySelector('[data-jx-auto-entry]')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.jxAutoEntry = '1'; b.textContent = '鈿?鑷姩璇婃柇璁剧疆';
      b.style.cssText = 'margin-left:10px;padding:3px 8px;border:1px solid #409eff;border-radius:4px;background:#ecf5ff;color:#409eff;cursor:pointer;font:12px Segoe UI,Microsoft Yahei,sans-serif';
      b.addEventListener('click', panel); title.appendChild(b);
    }, 80));
  }

  GM_registerMenuCommand('鑷姩璇婃柇锛氶厤缃?, panel);
  GM_registerMenuCommand('鑷姩璇婃柇锛氬惎鐢?鍋滅敤', () => { config.enabled = !config.enabled; saveConfig(); console.info('[鑷姩璇婃柇] enabled =', config.enabled); });
  window.addEventListener('beforeunload', () => {
    if (timer) clearInterval(timer);
    if (probeTimer) clearTimeout(probeTimer);
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    if (autoQueryFallbackTimer) clearTimeout(autoQueryFallbackTimer);
    if (pageQueryHeartbeatTimer) clearTimeout(pageQueryHeartbeatTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onVisibilityChange);
    window.removeEventListener(REALTIME_HINT_EVENT, onRealtimeHint);
  });
  installRealtimeHintBridge();
  let bootstrapped = false;
  const bootstrap = async () => {
    // 闂ㄦ埛璺宠浆鍒板奖鍍忛〉鏃讹紝Vue 鍙兘鍏堟浛鎹㈡枃妗ｅ啀瑙﹀彂 DOMContentLoaded锛?    // 鐧诲綍椤典篃闇€瑕佸惎鍔紝鐢ㄤ簬绗簩娆′互鍚庣洿鎺ュ崗璁櫥褰曘€?    const currentUrl = pageWindow().location;
    if (currentUrl.host === '10.10.94.90:22100' || !['/login', '/radiation'].includes(currentUrl.pathname)) {
      setTimeout(bootstrap, 2000);
      return;
    }
    if (bootstrapped) return;
    bootstrapped = true;
    // 鍏堝畬鎴愬悓婧愬崗璁櫥褰曪紝鍐嶅惎鍔ㄥ垪琛ㄦ帰娴嬶紱鏈惎鐢ㄦ椂淇濇寔鍘熸湁鐧诲綍娴佺▼銆?    if (directLoginConfig().enabled && directLoginConfig().username && !document.cookie.includes('Auth=')) {
      const ok = await ensureDirectLogin();
      if (ok && currentUrl.pathname === '/login') {
        pageWindow().location.replace('/radiation');
        return;
      }
    }
    if (currentUrl.pathname === '/login') return;
    const observer = new MutationObserver(attachToHeaderSettings);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    attachToHeaderSettings();
    start();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
})();






