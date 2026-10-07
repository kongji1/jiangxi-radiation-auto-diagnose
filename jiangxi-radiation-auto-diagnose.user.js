// ==UserScript==
// @name         江西省县域医共体 - 自动诊断候选
// @namespace    local.jiangxi.radiation
// @version      0.8.56
// @updateURL   https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js
// @downloadURL https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js
// @description  以页面实时推送为主、轻量协议探测为兜底，按可配置规则识别后优先通过系统协议进入诊断；支持可控开发者诊断日志。
// @match        http://10.10.94.90:22112/*
// @match        http://10.10.94.90:22100/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      raw.githubusercontent.com
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.8.56';

  const AUTO_ENTRY_TIME_SLOTS = Object.freeze([
    { id: 'morning', label: '08:00–12:00', startMinutes: 8 * 60, endMinutes: 12 * 60, overnight: false },
    { id: 'noon', label: '12:00–14:30', startMinutes: 12 * 60, endMinutes: 14 * 60 + 30, overnight: false },
    { id: 'afternoon', label: '14:30–17:30', startMinutes: 14 * 60 + 30, endMinutes: 17 * 60 + 30, overnight: false },
    { id: 'night', label: '17:30–次日 08:00', startMinutes: 17 * 60 + 30, endMinutes: 8 * 60, overnight: true }
  ]);

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function localDateFromKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) || localDateKey(date) !== value ? null : date;
  }

  function autoEntrySlot(id) {
    return AUTO_ENTRY_TIME_SLOTS.find(slot => slot.id === String(id || '')) || null;
  }

  function autoEntryScheduleState(now = new Date(), schedule = config?.autoEntrySchedule || {}) {
    const slot = autoEntrySlot(schedule.slot);
    const anchorDate = localDateFromKey(schedule.date);
    if (!slot || !anchorDate) return { configured: false, requiresSelection: !!(schedule.requiresSelection || schedule.slot || schedule.date), active: false, pending: false, expired: false, slot: null, startAt: 0, endAt: 0 };
    const start = new Date(anchorDate);
    start.setHours(Math.floor(slot.startMinutes / 60), slot.startMinutes % 60, 0, 0);
    const end = new Date(anchorDate);
    if (slot.overnight) end.setDate(end.getDate() + 1);
    end.setHours(Math.floor(slot.endMinutes / 60), slot.endMinutes % 60, 0, 0);
    const nowAt = now.getTime();
    const startAt = start.getTime();
    const endAt = end.getTime();
    const expired = nowAt >= endAt;
    const pending = nowAt < startAt;
    return { configured: true, requiresSelection: false, active: !expired && !pending, pending, expired, slot, date: schedule.date, startAt, endAt };
  }

  function clearExpiredAutoEntrySchedule(state) {
    if (!state?.configured || !state.expired) return false;
    const oldSlot = state.slot?.label || String(config.autoEntrySchedule?.slot || '');
    config.autoEntrySchedule = { slot: '', date: '', requiresSelection: true };
    config.enabled = false;
    saveConfig();
    developerLog('自动进入时段到期关闭', { source: 'auto-entry-schedule', slot: oldSlot, date: state.date || '' }, { force: true });
    refreshAutoEntryScheduleUI();
    return true;
  }

  function setAutoEntrySchedule(slotId, now = new Date()) {
    const slot = autoEntrySlot(slotId);
    if (!slot) return false;
    // 在跨午夜时段的次日凌晨选择时，将时段归属到前一天，保证 08:00 到点自动失效。
    let anchor = new Date(now);
    const minute = now.getHours() * 60 + now.getMinutes();
    if (slot.overnight && minute < slot.endMinutes) {
      anchor.setDate(anchor.getDate() - 1);
    }
    const schedule = { slot: slot.id, date: localDateKey(anchor), requiresSelection: false };
    if (autoEntryScheduleState(now, schedule).expired) return false;
    config.autoEntrySchedule = schedule;
    config.enabled = true;
    return true;
  }

  function autoEntryScheduleText(state = autoEntryScheduleState()) {
    if (state.requiresSelection) return '自动进入已关闭，请重新选择一个时间段；选择后立即保存并开启。';
    if (!state.configured) return '未选择时段：沿用“启用自动打开”开关，不限制时间。';
    if (state.expired) return `时段已到期：${state.slot.label}，自动打开已关闭，请重新选择。`;
    if (state.pending) {
      const start = new Date(state.startAt);
      return `已选择 ${state.slot.label}，将在 ${start.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 开始。`;
    }
    const end = new Date(state.endAt);
    return `当前时段生效：${state.slot.label}，到 ${end.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 自动关闭。`;
  }

  function refreshAutoEntryScheduleUI() {
    const box = document.getElementById('jx-auto-diagnose-panel');
    if (!box) return;
    const state = autoEntryScheduleState();
    const enabled = box.querySelector('[data-f="enabled"]');
    if (enabled) { enabled.checked = !!config.enabled; enabled.disabled = state.requiresSelection; }
    box.querySelectorAll('[data-f="autoEntryTimeSlot"]').forEach(input => {
      input.checked = input.value === (config.autoEntrySchedule?.slot || '');
    });
    const text = box.querySelector('[data-a="autoEntryTimeState"]');
    if (text) text.textContent = autoEntryScheduleText(state);
  }

  // 所有业务规则和页面定位都集中在这里，也可以从表头设置弹窗进入配置面板修改。
  const DEFAULT_CONFIG = {
    configSchema: 2,
    enabled: true,
    // 只读监控与自动打开分离。关闭自动打开时仍可观察 WebSocket、协议列表、状态和开发者日志。
    monitoringEnabled: true,
    // 默认开启完整诊断记录；保留时长可配置，关闭后按用户选择持久化。
    developerMode: true,
    developerRetentionMinutes: 60,
    developerModeDebugWindowSchema: 2,
    // [] 表示不限登录账号；填写账号编号或登录名后，仅对匹配账号启用自动诊断。
    allowedAccounts: [],
    // 协议登录只保存账号，不保存密码；密码仅在当前页面会话内存中使用。
    directLogin: { enabled: false, username: '', ocrEnabled: true, ocrEndpoint: 'http://127.0.0.1:18766/ocr' },
    // DOM 扫描只在本地进行；服务器探测单独使用 statusNum，前台默认 5 秒一次，后台自动降到较低频率并带退避。
    pollMs: 2000,
    statusProbeMs: 5000,
    // 页面已有 WebSocket 推送时即时触发；没有推送或消息不完整时按此间隔补偿一次列表。
    realtimeHints: true,
    listHeartbeatMs: 15000,
    // 后台候选处理默认只走协议，不替用户点击页面“查询”；需要同步可见表格时再手动开启。
    pageQueryRefresh: true,
    clickDelayMs: 700,
    // 自动进入前的可配置等待；0 秒且模拟人工程度为“无”时立即响应。
    entryDelaySeconds: 0,
    humanizeEntryLevel: 0,
    // 可选的当日自动进入时段；未选择时沿用 enabled 的不限时兼容行为。
    // 选择后只在该时段内允许自动进入，跨午夜时段以选择日 17:30 为起点。
    autoEntrySchedule: { slot: '', date: '', requiresSelection: false },
    // 待诊断在当前系统中的状态值；脚本会优先点击这个复选框，再读取表格。
    pendingStatusValue: '102501',
    reportStatuses: ['待诊断'],
    // 兼容旧配置字段；其它用户已锁定/占用的报告始终禁止自动进入。
    skipLockedRecords: true,
    imageStatuses: [],
    encounterTypes: ['门诊', '急诊'], // [] 表示不限；住院不会被默认放行
    gender: [],                         // [] 表示不限；可填 ['男'] 或 ['女']
    age: { min: 18, max: 40, unlimited: false }, // unlimited=true 或边界为空表示不限
    modalities: ['CT'],                // [] 表示不限
    patientNameContains: '',
    applicationNoContains: '',
    applyInstitution: [],               // [] 表示不限；填写后按行文本或数据属性匹配
    checkHospitals: [],                 // [] 表示不限；动态来源于“检查医院”表头/协议记录
    bodyParts: [],                      // [] 表示不限；动态来源于“检查部位”表头/协议记录
    // 数值越大越优先；未列出的项目按 0 处理。设置界面支持“名称=权重”逐行编辑。
    examWeights: ['头颅平扫=100', '颅脑平扫=95', '腰椎间盘平扫=80', '颈椎间盘平扫=75', '肋骨平扫=10'],
    institutionWeights: [],
    preliminaryReportFirst: true,
    diagnosisDoctors: [],               // [] 表示不限；动态来源于“诊断医生”表头/协议记录
    auditDoctors: [],                   // [] 表示不限
    applicationTime: { mode: 'window', minMinutes: 5, maxMinutes: 30, days: 3, start: '00:00' },
    diagnosisTime: { mode: 'all', days: 3, start: '00:00' },
    auditTime: { mode: 'all', days: 3, start: '00:00' },
    examNames: [
      '头颅平扫',
      '颅脑平扫',
      '腰椎间盘平扫',
      '腰椎椎间盘平扫',
      '颈椎间盘平扫',
      '颈椎椎间盘平扫'
    ],
    examNamesExtra: [],
    // 排除先于允许项目；每个拆分检查项目按规范化后的完整名称匹配。
    examNamesExcluded: [],
    // 动态收集当前列表中出现过的检查项目，供设置界面勾选。
    examNamesCatalog: [],
    // “更新所有可选项目”会把其它动态表头的选项也缓存到这里，避免翻页后选项消失。
    columnOptionsCatalog: { checkHospitals: [], bodyParts: [], diagnosisDoctors: [], applyInstitution: [] },
    // 兼容旧版本字段；新版本使用 examSiteCount，默认不限检查部位数量。
    singleSiteOnly: false,
    examSiteCount: { min: null, max: null },
    // 协议优先会先调用系统的允许进入接口，再打开诊断页；取不到记录编号时回退到页面按钮。
    entryMode: 'protocol-first',
    // 同一行多个检查项目的分隔符。需要支持其它医院命名时可扩展。
    examSeparators: /[,，、+＋;；\\/]/,
    selectors: {
      bodyRows: 'table.el-table__body tbody tr',
      statusInput: 'input[type="checkbox"][value="{pendingStatusValue}"]',
      searchButton: 'button.el-button--primary',
      operatorItems: '.operator .table-operator-item',
      // 找不到诊断图标时的兼容回退序号；正常情况按图标名称识别。
      diagnoseOperatorIndex: 0
    },
    // 防止同一检查在刷新/翻页后再次打开。仅保存短字符串，不保存患者姓名等额外信息。
    seenLimit: 500
  };

  const STORAGE_KEY = 'jx-radiation-auto-diagnose-config-v1';
  let developerModeMigrationApplied = false;
  let config = loadConfig();
  let timer = null;
  let probeTimer = null;
  let running = false;
  let entryRunning = false;
  // 诊断锁只限制再次进入其它客户；列表、WebSocket 和状态观察继续运行。
  let diagnosisActive = false;
  let probeRunning = false;
  let listRefreshRunning = false;
  let lastStatusHash = '';
  let statusProbeFailures = 0;
  let lastListFetchAt = 0;
  let realtimeRefreshTimer = null;
  let realtimeRecordRunning = false;
  let lastRealtimeRefreshAt = 0;
  let lastRealtimeHintAt = 0;
  // WebSocket 提示可能先于列表请求完成；保存最近一条可识别线索，避免并发请求时丢失。
  let queuedRealtimeMatch = null;
  let queuedRealtimeHintAt = 0;
  let queuedRealtimeReadyAt = 0;
  // 页面 Axios 还会发送登录用户 UID/USER-INFO；按需读取一次当前会话，值只留在内存中。
  let sessionIdentity = { info: null, uid: '', loading: false, lastAttemptAt: 0, loadedAt: 0 };
  let sessionIdentityRequest = null;
  let directPassword = '';
  let directLoginRunning = false;
  // 业务前端会从 WebRTC ICE 候选中附带客户端地址；缺少该头时只读接口会返回 TOKEN_FAIL(2002)。
  let clientIp = '';
  let clientIpRequest = null;
  let clientIpRetryAfter = 0;
  let clientIpRefreshInBackground = false;
  let tokenRecoveryLastAt = 0;
  let tokenFailureLoggedAt = 0;
  let pageQueryRunning = false;
  let lastPageQueryAt = 0;
  // statusNum/WS 均不可用时，低频复用页面原生查询作为兜底。
  let autoQueryFallbackTimer = null;
  // 页面本身只有点击“查询”才会重新取表格；用低频单次定时器代替人工点击。
  let pageQueryHeartbeatTimer = null;
  let autoEntryScheduleTimer = null;
  let visibilityBound = false;
  let headerObserver = null;
  let routeWatchTimer = null;
  let loginRecoveryTimer = null;
  let lastObservedPath = '';
  let accountGateState = '';
  const seen = new Map();
  // 开发者诊断用的候选生命周期索引。它只保留内存中的短期关联，不参与
  // 进入决策，也不写入独立存储；详细事件按用户选择的保留窗口落盘。
  const candidateLifecycle = new Map();
  let candidateSnapshotSequence = 0;
  const REALTIME_HINT_EVENT = '__jx_auto_diagnose_ws_hint_v1';
  const DEBUG_CLEANUP_INTERVAL_MS = 60 * 1000;
  const DEBUG_PERSIST_INTERVAL_MS = 1000;
  const DEBUG_EVENT_THROTTLE_MS = 3000;
  const DEBUG_STORAGE_KEY = 'jx-radiation-auto-diagnose-debug-v1';
  // A separate namespace prevents a still-open old page's fixed ten-minute
  // cleanup from deleting records retained by the new configurable window.
  const DEBUG_JOURNAL_PREFIX = 'jx-radiation-auto-diagnose-debug-journal-v3:';
  const DEBUG_LEGACY_JOURNAL_PREFIX = 'jx-radiation-auto-diagnose-debug-journal-v2:';
  const DEBUG_RESET_KEY = 'jx-radiation-auto-diagnose-debug-reset-v2';
  const debugWriterId = `${Date.now().toString(36)}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
  const debugJournalKey = DEBUG_JOURNAL_PREFIX + debugWriterId;
  const debugJournalSignatures = new Map();
  const debugEvents = [];
  const debugWriterEvents = [];
  const debugLastAt = new Map();
  let debugEventSequence = 0;
  let debugResetMarker = { at: 0, token: '' };
  let debugCleanupTimer = null;
  let debugPersistTimer = null;
  let developerRetentionConfigurationSavedAt = Number(config.configurationSavedAt || 0);

  function developerRetentionMs() {
    return normalizeDeveloperRetentionMinutes(config.developerRetentionMinutes) * 60000;
  }
  function developerRetentionLabel() {
    const minutes = normalizeDeveloperRetentionMinutes(config.developerRetentionMinutes);
    return minutes % 1440 === 0 ? `${minutes / 1440}天` : minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`;
  }
  function synchronizeDeveloperRetention(raw = null) {
    const values = [decodeDeveloperStorage(raw)];
    try { values.push(decodeDeveloperStorage(GM_getValue(STORAGE_KEY, null))); } catch (_) {}
    try { values.push(decodeDeveloperStorage(developerLocalStorage()?.getItem(STORAGE_KEY + ':durable-v1'))); } catch (_) {}
    // Old pages may save an older whole config without this field. Such a save
    // must not undo a retention duration selected in the newer document.
    const latest = values.filter(value => value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'developerRetentionMinutes'))
      .sort((a, b) => Number(b.configurationSavedAt || 0) - Number(a.configurationSavedAt || 0))[0];
    if (!latest || Number(latest.configurationSavedAt || 0) < developerRetentionConfigurationSavedAt) return false;
    const next = normalizeDeveloperRetentionMinutes(latest.developerRetentionMinutes);
    const changed = config.developerRetentionMinutes !== next;
    config.developerRetentionMinutes = next;
    developerRetentionConfigurationSavedAt = Number(latest.configurationSavedAt || 0);
    config.configurationSavedAt = Math.max(Number(config.configurationSavedAt || 0), developerRetentionConfigurationSavedAt);
    return changed;
  }

  function decodeDeveloperStorage(raw) {
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
  }
  function developerLocalStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
  }
  function readDeveloperReset() {
    const markers = [debugResetMarker];
    try { markers.push(decodeDeveloperStorage(GM_getValue(DEBUG_RESET_KEY, null))); } catch (_) {}
    try { markers.push(decodeDeveloperStorage(developerLocalStorage()?.getItem(DEBUG_RESET_KEY))); } catch (_) {}
    debugResetMarker = markers.filter(value => value && Number.isFinite(Number(value.at))).sort((a, b) => Number(b.at) - Number(a.at) || String(b.token || '').localeCompare(String(a.token || '')))[0] || { at: 0, token: '' };
    return debugResetMarker;
  }
  function developerEventId(event) {
    if (event.eventId) return String(event.eventId);
    // Older arrays have no IDs. Stable content identity prevents duplicate migration reads.
    const text = JSON.stringify(event);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return `legacy:${event.at || ''}:${text.length}:${(hash >>> 0).toString(36)}`;
  }
  function retainedDeveloperEvents(events, now = Date.now()) {
    const cutoff = now - developerRetentionMs();
    return (Array.isArray(events) ? events : []).filter(event => {
      const at = Date.parse(event?.at || '');
      return Number.isFinite(at) && at >= cutoff && (at > Number(debugResetMarker.at) || (at === Number(debugResetMarker.at) && event.debugResetId === debugResetMarker.token));
    });
  }
  function developerJournalKeys() {
    const keys = new Set();
    try { if (typeof GM_listValues === 'function') for (const key of GM_listValues()) if (key.startsWith(DEBUG_JOURNAL_PREFIX) || key.startsWith(DEBUG_LEGACY_JOURNAL_PREFIX)) keys.add(key); } catch (_) {}
    try {
      const storage = developerLocalStorage();
      for (let i = 0; storage && i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(DEBUG_JOURNAL_PREFIX) || key?.startsWith(DEBUG_LEGACY_JOURNAL_PREFIX)) keys.add(key); }
    } catch (_) {}
    return [...keys];
  }
  function sealLegacyDeveloperEvents(events) {
    const buckets = new Map();
    for (const event of events) {
      const bucketStart = Math.floor(Date.parse(event.at) / 60000) * 60000;
      if (!buckets.has(bucketStart)) buckets.set(bucketStart, new Map());
      const eventId = developerEventId(event);
      buckets.get(bucketStart).set(eventId, { ...event, eventId });
    }
    for (const [bucketStart, items] of buckets) {
      const snapshot = [...items.values()].sort((a, b) => a.eventId.localeCompare(b.eventId));
      const text = JSON.stringify(snapshot);
      let first = 2166136261, second = 3339675911;
      for (let i = 0; i < text.length; i++) {
        first = Math.imul(first ^ text.charCodeAt(i), 16777619);
        second = Math.imul(second ^ text.charCodeAt(i), 2246822519);
      }
      const writerId = `legacy-${text.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
      const key = `${DEBUG_JOURNAL_PREFIX}${writerId}:${bucketStart}`;
      const journal = { schema: 2, writerId, bucketStart, events: snapshot };
      // Seal only legacy records not already present in an immutable snapshot.
      // The old script may overwrite its array later; this key remains independent.
      try { if (!developerLocalStorage()?.getItem(key)) developerLocalStorage()?.setItem(key, JSON.stringify(journal)); } catch (_) {}
      try { if (!GM_getValue(key, null)) GM_setValue(key, journal); } catch (_) {}
    }
  }
  function collectDeveloperEvents(cleanup = false) {
    readDeveloperReset();
    const all = [...debugEvents, ...debugWriterEvents];
    let legacyToSeal = [];
    const journalIds = new Set();
    try {
      const legacy = decodeDeveloperStorage(GM_getValue(DEBUG_STORAGE_KEY, []));
      if (Array.isArray(legacy)) {
        const retained = retainedDeveloperEvents(legacy);
        legacyToSeal = retained;
        for (const event of retained) all.push(event);
        // Read legacy data for compatibility, then remove only expired entries.
        if (cleanup && retained.length !== legacy.length) GM_setValue(DEBUG_STORAGE_KEY, retained);
      }
    } catch (_) {}
    for (const key of developerJournalKeys()) {
      const legacyJournal = key.startsWith(DEBUG_LEGACY_JOURNAL_PREFIX);
      const bucketStart = Number(key.slice(key.lastIndexOf(':') + 1));
      if (cleanup && Number.isFinite(bucketStart) && bucketStart + 60000 <= Date.now() - developerRetentionMs()) {
        try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (_) {}
        try { developerLocalStorage()?.removeItem(key); } catch (_) {}
        debugJournalSignatures.delete(key);
        continue;
      }
      const copies = [];
      try { copies.push(decodeDeveloperStorage(GM_getValue(key, null))); } catch (_) {}
      try { copies.push(decodeDeveloperStorage(developerLocalStorage()?.getItem(key))); } catch (_) {}
      const events = copies.flatMap(copy => Array.isArray(copy?.events) ? copy.events : []);
      const retained = retainedDeveloperEvents(events);
      for (const event of retained) all.push(event);
      if (legacyJournal) for (const event of retained) legacyToSeal.push(event);
      else for (const event of retained) journalIds.add(developerEventId(event));
      if (cleanup && !retained.length) {
        try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (_) {}
        try { developerLocalStorage()?.removeItem(key); } catch (_) {}
        debugJournalSignatures.delete(key);
      }
    }
    sealLegacyDeveloperEvents(legacyToSeal.filter(event => !journalIds.has(developerEventId(event))));
    const unique = new Map();
    for (const event of retainedDeveloperEvents(all)) {
      const eventId = developerEventId(event);
      if (!unique.has(eventId)) unique.set(eventId, { ...event, eventId });
    }
    debugEvents.length = 0;
    for (const event of [...unique.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) debugEvents.push(event);
    const own = retainedDeveloperEvents(debugWriterEvents);
    debugWriterEvents.length = 0;
    for (const event of own) debugWriterEvents.push(event);
  }
  function persistDeveloperEvents() {
    if (debugPersistTimer) clearTimeout(debugPersistTimer);
    debugPersistTimer = null;
    // Writes only touch this document's events; aggregation is done on load,
    // minute cleanup or explicit read, rather than scanning an hour every second.
    synchronizeDeveloperRetention();
    pruneDeveloperEvents();
    const buckets = new Map();
    for (const event of debugWriterEvents) {
      const bucketStart = Math.floor(Date.parse(event.at) / 60000) * 60000;
      if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
      buckets.get(bucketStart).push(event);
    }
    // Each document owns its minute keys. Closed writers can be cleaned by deleting
    // expired buckets without rewriting an active writer's newer observations.
    for (const [bucketStart, events] of buckets) {
      const key = `${debugJournalKey}:${bucketStart}`;
      const signature = events.map(event => event.eventId).join('|');
      if (debugJournalSignatures.get(key) === signature) continue;
      const journal = { schema: 2, writerId: debugWriterId, bucketStart, events };
      try { developerLocalStorage()?.setItem(key, JSON.stringify(journal)); } catch (_) {}
      try { GM_setValue(key, journal); } catch (_) {}
      debugJournalSignatures.set(key, signature);
    }
  }
  function scheduleDeveloperPersistence(immediate = false) {
    if (immediate) { persistDeveloperEvents(); return; }
    if (debugPersistTimer) return;
    debugPersistTimer = setTimeout(persistDeveloperEvents, DEBUG_PERSIST_INTERVAL_MS);
  }
  function flushDeveloperEvents() {
    if (debugPersistTimer) persistDeveloperEvents();
  }
  function isCriticalDeveloperEvent(event, options = {}) {
    return !!options.force || /协议进入|进入(?:成功|失败|异常)|路由变化|运行版本|运行时(?:停止|重启)|异常|拒绝|失败|候选被其他用户占用|自动进入时段到期关闭/.test(event);
  }
  function scheduleDeveloperCleanup() {
    if (debugCleanupTimer) return;
    debugCleanupTimer = setInterval(() => {
      synchronizeDeveloperRetention();
      const changed = pruneDeveloperEvents(Date.now());
      if (changed || debugPersistTimer) persistDeveloperEvents();
      collectDeveloperEvents(true);
      if (typeof pruneCandidateLifecycle === 'function') pruneCandidateLifecycle();
      refreshDeveloperRetentionUI();
    }, DEBUG_CLEANUP_INTERVAL_MS);
  }

  function loadDeveloperEvents() {
    collectDeveloperEvents(true);
    try {
      if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(DEBUG_RESET_KEY, (_key, _oldValue, newValue) => {
        const marker = decodeDeveloperStorage(newValue);
        if (marker && Number(marker.at) >= Number(debugResetMarker.at)) debugResetMarker = marker;
        readDeveloperReset(); pruneDeveloperEvents(); debugLastAt.clear();
      });
      if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(STORAGE_KEY, (_key, _oldValue, newValue) => {
        if (!synchronizeDeveloperRetention(newValue)) return;
        pruneDeveloperEvents(); persistDeveloperEvents(); collectDeveloperEvents(true);
        if (typeof pruneCandidateLifecycle === 'function') pruneCandidateLifecycle();
        refreshDeveloperRetentionUI();
      });
    } catch (_) {}
    scheduleDeveloperCleanup();
  }
  function clearDeveloperEvents() {
    debugResetMarker = { at: Date.now(), token: `${debugWriterId}:clear:${++debugEventSequence}` };
    try { developerLocalStorage()?.setItem(DEBUG_RESET_KEY, JSON.stringify(debugResetMarker)); } catch (_) {}
    try { GM_setValue(DEBUG_RESET_KEY, debugResetMarker); GM_setValue(DEBUG_STORAGE_KEY, []); } catch (_) {}
    debugEvents.length = 0;
    debugWriterEvents.length = 0;
    debugJournalSignatures.clear();
    debugLastAt.clear();
    collectDeveloperEvents(true);
    persistDeveloperEvents();
  }
  loadDeveloperEvents();

  function loadConfig() {
    try {
      let saved = GM_getValue(STORAGE_KEY, null);
      // Same-origin mirror survives a reload before Tampermonkey transports its write.
      try {
        const mirror = JSON.parse(developerLocalStorage()?.getItem(STORAGE_KEY + ':durable-v1') || 'null');
        const current = typeof saved === 'string' ? JSON.parse(saved) : saved;
        if (mirror && Number(mirror.configurationSavedAt || 0) > Number(current?.configurationSavedAt || 0)) saved = mirror;
      } catch (_) {}
      if (!saved) return structuredClone(DEFAULT_CONFIG);
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      if (parsed.examSeparators?.__regexp) parsed.examSeparators = new RegExp(parsed.examSeparators.__regexp);
      if (typeof parsed.examNamesExtra === 'string') parsed.examNamesExtra = parsed.examNamesExtra.split(/[,，\n]/).map(norm).filter(Boolean);
      if (!Array.isArray(parsed.examNamesCatalog)) parsed.examNamesCatalog = [];
      // 补齐旧配置的调试字段；用户在设置中关闭后保持其明确选择。
      if (parsed.developerMode == null) {
        parsed.developerMode = true;
        developerModeMigrationApplied = true;
      }
      // Persistence migration has a fixed schema, independent of release version.
      // An explicit user switch or filter choice must survive every code update.
      if (Number(parsed.developerModeDebugWindowSchema || 0) < 2) {
        parsed.developerModeDebugWindowSchema = 2;
        developerModeMigrationApplied = true;
      }
      if (parsed.realtimeHints == null) parsed.realtimeHints = true;
      if (parsed.monitoringEnabled == null) parsed.monitoringEnabled = true;
      if (!parsed.listHeartbeatMs) parsed.listHeartbeatMs = 15000;
      if (parsed.pageQueryRefresh == null) parsed.pageQueryRefresh = true;
      if (!parsed.examSiteCount) parsed.examSiteCount = parsed.singleSiteOnly ? { min: 1, max: 1 } : { min: null, max: null };
      if (parsed.applicationTime && parsed.applicationTime.mode === 'today' && parsed.applicationTime.minMinutes == null && parsed.applicationTime.maxMinutes == null) parsed.applicationTime = { ...parsed.applicationTime, mode: 'window', minMinutes: 5, maxMinutes: 30 };
      const merged = merge(structuredClone(DEFAULT_CONFIG), parsed);
      const migrated = migrateConfig(merged, parsed);
      // 将一次性兼容修正写回存储；不因脚本版本变化重设用户配置。
      if (developerModeMigrationApplied || parsed.developerRetentionMinutes !== migrated.developerRetentionMinutes || parsed.enabled !== migrated.enabled || parsed.skipLockedRecords !== migrated.skipLockedRecords || JSON.stringify(parsed.autoEntrySchedule) !== JSON.stringify(migrated.autoEntrySchedule)) {
        try { persistConfigValue(migrated); } catch (_) {}
      }
      return migrated;
    } catch (e) {
      console.warn('[自动诊断] 配置读取失败，使用默认配置', e);
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  function normalizeDeveloperRetentionMinutes(raw) {
    if ((typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && !raw.trim())) return 60;
    const minutes = Number(raw);
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 10080 ? Math.floor(minutes) : 60;
  }

  function normalizeExamNameList(raw) {
    const values = typeof raw === 'string' ? raw.split(/[,，;；\n]/) : Array.isArray(raw) ? raw : [];
    return [...new Set(values.filter(value => typeof value === 'string').map(norm).filter(value => value && value !== '不限' && value !== '无排除'))];
  }

  function buildExamOptionCatalog(value, observed = []) {
    return normalizeExamNameList([
      ...normalizeExamNameList(value?.examNamesCatalog), ...normalizeExamNameList(value?.examNames),
      ...normalizeExamNameList(value?.examNamesExtra), ...normalizeExamNameList(value?.examNamesExcluded),
      ...normalizeExamNameList(observed), ...DEFAULT_CONFIG.examNames,
      '肋骨平扫', '左侧肋骨平扫', '右侧肋骨平扫', '双侧肋骨平扫'
    ]);
  }

  function merge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    for (const [k, v] of Object.entries(extra)) {
      if (v && typeof v === 'object' && !(v instanceof RegExp) && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
        base[k] = merge(base[k], v);
      } else if (v !== undefined) base[k] = v;
    }
    return base;
  }

  function migrateConfig(value, original = value) {
    value.developerRetentionMinutes = normalizeDeveloperRetentionMinutes(value.developerRetentionMinutes);
    value.examNamesExcluded = normalizeExamNameList(value.examNamesExcluded);
    value.examNamesCatalog = normalizeExamNameList(value.examNamesCatalog);
    // 已锁定的报告是进入硬门禁，旧方案不能通过关闭配置放宽。
    value.skipLockedRecords = true;
    const schedule = value.autoEntrySchedule;
    const state = autoEntryScheduleState(new Date(), schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule : {});
    if (state.expired || state.requiresSelection) {
      value.autoEntrySchedule = { slot: '', date: '', requiresSelection: true };
      value.enabled = false;
    } else if (!state.configured) {
      value.autoEntrySchedule = { slot: '', date: '', requiresSelection: false };
    }
    // 0.8.10 期间曾保存过 pageQueryRefresh=false；升级到协议+可见列表同步后，
    // 旧配置只迁移一次，避免用户必须手动点击查询。之后用户主动关闭会保持关闭。
    if (Number(original?.configSchema || 0) < 2) {
      value.pageQueryRefresh = true;
      value.configSchema = 2;
    }
    // Older builds could persist the visual “不限” sentinel instead of the
    // internal empty-array representation.  Treat both forms identically so
    // a saved unlimited setting cannot silently become a restrictive filter.
    for (const field of ['reportStatuses', 'imageStatuses', 'encounterTypes', 'gender', 'modalities', 'applyInstitution', 'checkHospitals', 'bodyParts', 'diagnosisDoctors', 'examNames', 'examNamesExtra']) {
      if (Array.isArray(value[field]) && value[field].some(item => norm(item) === '不限')) value[field] = [];
    }
    if (!value.age || typeof value.age !== 'object') value.age = { min: null, max: null, unlimited: true };
    if (value.age.unlimited || (value.age.min == null && value.age.max == null)) {
      value.age.unlimited = true;
      value.age.min = null;
      value.age.max = null;
    }
    return value;
  }

  function saveConfig() {
    config.developerRetentionMinutes = normalizeDeveloperRetentionMinutes(config.developerRetentionMinutes);
    config.examNamesExcluded = normalizeExamNameList(config.examNamesExcluded);
    config.examNamesCatalog = normalizeExamNameList(config.examNamesCatalog);
    persistConfigValue(config);
  }
  function persistConfigValue(value) {
    value.configurationSavedAt = Math.max(Date.now(), Number(value.configurationSavedAt || 0) + 1);
    const encoded = JSON.stringify(value, (k, v) => v instanceof RegExp ? { __regexp: v.source } : v);
    try { developerLocalStorage()?.setItem(STORAGE_KEY + ':durable-v1', encoded); } catch (_) {}
    GM_setValue(STORAGE_KEY, encoded);
  }

  function configWithCurrentEntrySchedule(saved) {
    // 筛选方案、导入与恢复默认均不能签发新的日期授权；时段必须明确点击选择。
    const autoEntrySchedule = structuredClone(config.autoEntrySchedule || DEFAULT_CONFIG.autoEntrySchedule);
    return migrateConfig(merge(structuredClone(DEFAULT_CONFIG), { ...saved, autoEntrySchedule }), saved);
  }

  function entryDelayPlan() {
    const seconds = Math.max(0, Math.min(300, Number(config.entryDelaySeconds) || 0));
    const level = Math.max(0, Math.min(3, Number(config.humanizeEntryLevel) || 0));
    const jitterRanges = [[0, 0], [50, 250], [200, 700], [500, 1500]];
    const [minJitter, maxJitter] = jitterRanges[level];
    const jitterMs = maxJitter > minJitter
      ? Math.floor(minJitter + Math.random() * (maxJitter - minJitter + 1))
      : minJitter;
    return { seconds, level, baseMs: seconds * 1000, jitterMs, totalMs: seconds * 1000 + jitterMs };
  }

  async function waitBeforeEntry() {
    const plan = entryDelayPlan();
    if (!plan.totalMs) return plan;
    developerLog('协议进入延迟等待', {
      source: 'entry-gate',
      seconds: plan.seconds,
      humanizeLevel: plan.level,
      jitterMs: plan.jitterMs,
      totalMs: plan.totalMs
    }, { force: true });
    await new Promise(resolve => setTimeout(resolve, plan.totalMs));
    return plan;
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
    // 同时保留不可逆短标签用于聚合；完整字段仅在本机滚动调试记录中使用。
    const raw = [d.key, d.applicationNo, d.patient, d.applyTime, d.exam, d.modality].filter(Boolean).join('|');
    return raw ? `候选-${debugHash(raw)}` : '';
  }
  function debugApplyAgeMinutes(d) {
    const date = parseDate(d?.applyTime);
    if (!date || Number.isNaN(date.getTime())) return null;
    return Math.round((Date.now() - date.getTime()) / 60000 * 10) / 10;
  }
  function debugCandidate(d, extra = {}) {
    return {
      tag: debugTag(d),
      key: d?.key || '',
      applicationNo: d?.applicationNo || '',
      patientName: d?.patientName || d?.record?.patName || d?.record?.patientName || '',
      patient: d?.patient || '',
      applyTime: d?.applyTime || '',
      record: d?.record || null,
      status: norm(d?.status),
      statusCode: norm(d?.statusCode || d?.record?.reportStatusCode || d?.record?.checkStatusCode || d?.record?.statusCode),
      locked: !!(d?.locked || recordLockState(d?.record)),
      imageStatus: norm(d?.imageStatus),
      modality: norm(d?.modality),
      exam: norm(d?.exam),
      age: d?.age == null ? null : Number(d.age),
      gender: norm(d?.gender),
      applyAgeMinutes: debugApplyAgeMinutes(d),
      recordId: d?.record?.repUid || d?.record?.reportUid || d?.record?.reportId || d?.record?.id || '',
      ...extra
    };
  }
  function debugError(error) {
    const text = String(error?.message || error || 'unknown');
    return text.replace(/\b\d{6,}\b/g, '[id]').slice(0, 160);
  }
  function pruneDeveloperEvents(now = Date.now()) {
    const before = debugEvents.length;
    readDeveloperReset();
    for (const events of [debugEvents, debugWriterEvents]) {
      const retained = retainedDeveloperEvents(events, now);
      events.length = 0;
      for (const event of retained) events.push(event);
    }
    return before !== debugEvents.length;
  }
  function developerLog(event, detail = {}, options = {}) {
    if (!config.developerMode) return;
    const now = Date.now();
    pruneDeveloperEvents(now);
    const key = `${event}|${detail.tag || ''}|${detail.reason || ''}`;
    if (!options.force && now - (debugLastAt.get(key) || 0) < DEBUG_EVENT_THROTTLE_MS) return;
    debugLastAt.set(key, now);
    const item = { at: new Date(now).toISOString(), event, ...detail, eventId: `${debugWriterId}:${++debugEventSequence}`, debugResetId: debugResetMarker.token };
    debugEvents.push(item);
    debugWriterEvents.push(item);
    pruneDeveloperEvents(now);
    scheduleDeveloperPersistence(isCriticalDeveloperEvent(event, options));
    scheduleDeveloperCleanup();
    // CUA/浏览器日志桥会把第二个对象参数折叠成“Object”，导致无法判断
    // 候选究竟在哪一步被过滤、排队或拒绝；直接输出完整调试对象供复盘。
    console.info(`[自动诊断][开发者] ${JSON.stringify(item)}`);
  }
  function developerLogText() {
    collectDeveloperEvents(true);
    return JSON.stringify({ version: SCRIPT_VERSION, exportedAt: new Date().toISOString(), retentionMinutes: normalizeDeveloperRetentionMinutes(config.developerRetentionMinutes), events: debugEvents }, null, 2);
  }
  function developerModeStateText() {
    return `${config.developerMode ? (developerModeMigrationApplied ? '当前开启（已迁移）' : '当前开启') : '当前关闭'}（最近${developerRetentionLabel()} ${debugEvents.length} 条）`;
  }
  function refreshDeveloperRetentionUI() {
    const box = document.getElementById('jx-auto-diagnose-panel');
    if (!box) return;
    const minutes = normalizeDeveloperRetentionMinutes(config.developerRetentionMinutes);
    const preset = box.querySelector('[data-f="developerRetentionPreset"]');
    if (preset) preset.value = [10, 30, 60, 120, 360, 1440].includes(minutes) ? String(minutes) : 'custom';
    const custom = box.querySelector('[data-f="developerRetentionMinutes"]');
    if (custom) custom.value = minutes;
    const customLabel = box.querySelector('[data-a="developerRetentionCustom"]');
    if (customLabel) customLabel.hidden = preset?.value !== 'custom';
    const state = box.querySelector('[data-a="debugState"]');
    if (state) state.textContent = developerModeStateText();
    const help = box.querySelector('[data-a="developerRetentionHelp"]');
    if (help) help.textContent = `自动保留最近${developerRetentionLabel()}完整调试记录，超时每分钟自动清理；修改后立即保存，刷新和升级后仍有效。缩短会删除超时记录，延长不能恢复已删除记录。自检只读，不修改报告状态。记录不保存 Cookie、Authorization 或密码。`;
    const copy = box.querySelector('[data-a="copyDebug"]');
    if (copy) copy.title = `复制最近${developerRetentionLabel()}内的诊断记录`;
  }
  function setDeveloperRetentionMinutes(raw) {
    const previous = normalizeDeveloperRetentionMinutes(config.developerRetentionMinutes);
    config.developerRetentionMinutes = normalizeDeveloperRetentionMinutes(raw);
    saveConfig();
    pruneDeveloperEvents(); persistDeveloperEvents(); collectDeveloperEvents(true);
    pruneCandidateLifecycle(); refreshDeveloperRetentionUI();
    developerLog('开发者记录保留时长修改', { source: 'settings', previousMinutes: previous, retentionMinutes: config.developerRetentionMinutes }, { force: true });
    refreshDeveloperRetentionUI();
  }

  // 页面偶尔会在姓名/机构之间插入不可见空白；统一清理后再做字段和账号匹配。
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
  function parseAge(text) {
    const m = norm(text).match(/(?:男|女)?(?:[♀♂])?(\d{1,3})岁/);
    return m ? Number(m[1]) : null;
  }
  function parseGender(text) {
    const t = norm(text);
    if (t.includes('女')) return '女';
    if (t.includes('男')) return '男';
    return null;
  }
  function parseDate(text) {
    // norm() 会去掉页面时间中的空格，因此这里同时接受“2026-09-2910:00:00”和带空格/中文日期分隔的格式。
    const m = String(text || '').match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})(?:[日T\s]*?(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  const REPORT_STATUS_NAMES = Object.freeze({
    '102501': '待诊断', '102502': '诊断中', '102503': '待审核',
    '102504': '审核中', '102505': '已审核', '102506': '已打印'
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
    const patient = norm(at('患者信息')?.innerText);
    const patientName = norm(patient.replace(/(门诊|急诊|住院|体检).*$/, '').replace(/(?:男|女)?\d{1,3}岁$/, ''));
    const status = norm(at('检查状态')?.innerText);
    // DOM 行通常没有原始 statusCode；用固定状态字典补齐开发者诊断证据，
    // 但只把它作为观测值，不用它改动页面筛选条件。
    const statusCode = norm(
      row.dataset?.reportStatusCode || row.dataset?.checkStatusCode ||
      row.getAttribute('data-report-status-code') || row.getAttribute('data-check-status-code') ||
      (/^\d+$/.test(status) ? status : REPORT_STATUS_CODES?.[status] || '')
    );
    const modality = norm(at('检查类型')?.innerText);
    const applyTime = norm(at('申请时间')?.innerText);
    const exam = norm(at('检查项目')?.innerText);
    const bodyPart = norm(at('检查部位')?.innerText);
    const diagnosisTime = norm(at('诊断时间')?.innerText);
    const auditTime = norm(at('审核时间')?.innerText);
    const doctor = norm(at('诊断医生')?.innerText);
    const auditDoctor = norm(at('审核医生')?.innerText);
    const conclusion = norm(at('结论')?.innerText || row.dataset?.conclusion || row.dataset?.reportConclusion);
    const description = norm(at('描述')?.innerText || at('报告描述')?.innerText || row.dataset?.description);
    const imageStatus = norm(at('影像状态')?.innerText);
    const rowText = norm(row.innerText);
    const applyNo = norm(at('申请单号')?.innerText) || row.dataset.applyNo || row.dataset.applicationNo || '';
    const institution = norm(at('申请机构')?.innerText) || row.dataset.applyInstitution || row.dataset.institution || '';
    const hospital = norm(at('检查医院')?.innerText);
    const checkbox = row.querySelector('input[type="checkbox"]');
    const key = checkbox?.id || [patient, applyTime, modality, exam].join('|');
    return { row, record: null, patientName, patient, status, statusCode, locked: domRowLocked(row), imageStatus, modality, applyTime, diagnosisTime, auditTime, doctor, diagnosisDoctor: doctor, auditDoctor, conclusion, description, exam, bodyPart, applicationNo: applyNo, institution, hospital, rowText, age: parseAge(patient), gender: parseGender(patient), key };
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
    const numericAge = ageValue == null || ageValue === '' ? NaN : Number(String(ageValue).replace(/岁/g, ''));
    const age = Number.isFinite(numericAge) ? numericAge : parseAge(String(record.patName || record.patientName || ''));
    const patientName = norm(record.patName || record.patientName);
    const patient = norm([patientName, encounter, gender, Number.isFinite(age) ? `${age}岁` : ''].filter(Boolean).join(' '));
    const repUid = record.repUid || record.reportUid || record.reportId || record.id;
    const applicationNo = norm(record.applyNo || record.applicationNo || record.orderId);
    const exam = norm(record.examName || record.exam);
    const imageStatus = norm(record.imageStatus || (record.imageIsChange === 0 ? '正常' : record.imageIsChange === 1 ? '异常' : ''));
    const rawStatus = norm(record.reportStatus || record.reportStatusName || record.checkStatusName || record.status);
    const explicitStatusCode = norm(record.reportStatusCode || record.checkStatusCode || record.statusCode);
    const statusCode = norm(explicitStatusCode || (/^\d+$/.test(rawStatus) ? rawStatus : REPORT_STATUS_CODES?.[rawStatus] || ''));
    const status = norm(REPORT_STATUS_NAMES[statusCode] || rawStatus || statusCode);
    const locked = recordLockState(record);
    const modality = norm(Array.isArray(record.modality) ? record.modality.join(',') : (record.modality || record.modalityName));
    const applyTime = norm(record.checkinTime || record.applyTime || record.initiateTime);
    const bodyPart = norm(record.bodyPartName || record.bodyPart || record.checkPartName || record.checkPart);
    const conclusion = norm(record.conclusion || record.reportConclusion || record.diagnosisConclusion || record.opinion || record.reportOpinion);
    const description = norm(record.description || record.reportDescription || record.reportDesc || record.remark || record.remarkText);
    const rowText = norm([patient, status, imageStatus, modality, applyTime, exam, bodyPart, record.applyOrgName, record.checkOrgName, applicationNo, record.orderId].filter(Boolean).join('|'));
    return {
      row: null, record, patientName, patient, status, statusCode, locked, imageStatus, modality,
      applyTime,
      diagnosisTime: norm(record.repTime || record.diagnosisTime), auditTime: norm(record.auditTime || record.auditDate), doctor: norm(record.reportDoc), diagnosisDoctor: norm(record.reportDoc),
      auditDoctor: norm(record.auditDoc || record.auditDoctor), exam, bodyPart, applicationNo, conclusion, description,
      institution: norm(record.applyOrgName || record.applyOrg), hospital: norm(record.checkOrgName || record.checkOrg),
      rowText, age: Number.isFinite(age) ? age : null, gender: gender || parseGender(patient),
      key: repUid ? `rep:${repUid}` : [patient, applicationNo, exam].join('|')
    };
  }

  function currentCheckOrgId(options = {}) {
    const info = sessionIdentity.info || {};
    return norm(options.checkOrgId || info.oid || info.orgId || info.checkOrgId || info.orgCode || info.userInfo?.oid || '');
  }

  function parseWeights(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(/[,，\n]/);
    const out = new Map();
    for (const item of list) {
      const text = String(item || '').trim(); if (!text) continue;
      const m = text.match(/^(.+?)\s*[=:：]\s*(-?\d+(?:\.\d+)?)\s*$/);
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
    // 结论字段优先；描述/备注不参与“初写报告”判断，避免把备注误判成报告正文。
    return !!norm(d?.conclusion);
  }
  function candidatePriority(d) {
    const exam = weightOf(d?.exam, config.examWeights);
    const institution = weightOf(d?.institution, config.institutionWeights);
    const preliminary = config.preliminaryReportFirst && hasPreliminaryConclusion(d) ? 100000 : 0;
    const applyTime = d?.applyTime ? (parseDate(d.applyTime)?.getTime() || 0) / 1e10 : 0;
    return preliminary + exam * 100 + institution * 10 + applyTime;
  }

  function isExcludedExam(d) {
    const excluded = normalizeExamNameList(config.examNamesExcluded);
    if (!excluded.length) return false;
    const exam = String(d?.exam || d?.record?.examName || d?.record?.exam || '');
    return exam.split(config.examSeparators).map(norm).filter(Boolean).some(part => excluded.includes(part));
  }

  function lockValue(value) {
    if (value === true || (typeof value === 'number' && Number.isFinite(value) && value > 0)) return true;
    const text = norm(value).toLowerCase();
    if (['', 'false', '0', 'no', '否', '无', '空', 'none', 'null', 'nil', 'unlocked', 'not locked', 'not occupied', '未锁定', '未占用', '未被占用', '未加锁'].includes(text)) return false;
    return ['true', '1', 'yes', '是', 'locked', 'lock', '锁定', '占用'].includes(text) || (/^\d+$/.test(text) && Number(text) > 0) || /锁|占用|其他用户|occupied|locked/.test(text);
  }
  function recordLockState(record) {
    if (!record || typeof record !== 'object') return false;
    if ([record.isLock, record.isLocked, record.locked, record.lock, record.lockedByOther, record.lockStatus, record.lockReason, record.occupyStatus, record.isOccupied].some(lockValue)) return true;
    // 锁定医生通常只是姓名/编号，没有“锁定”字样；存在有效归属即视为占用。
    return [record.lockUser, record.lockUserName, record.lockUserId, record.lockUserUid, record.lockedBy, record.occupyUser, record.occupyUserName, record.occupyUserId].some(value => {
      const text = norm(value).toLowerCase();
      return !!text && !['false', '0', 'no', 'none', 'null', 'nil', 'undefined', '无', '空', '未锁定', '未占用'].includes(text);
    });
  }
  function lockedRecordDetected(d) {
    if (!d) return false;
    if (d.locked || recordLockState(d.record)) return true;
    const status = norm(d.status || d.record?.reportStatus || d.record?.reportStatusName || d.record?.checkStatusName);
    return /占用|锁定/.test(status) && !/未锁定/.test(status);
  }
  function shouldSkipLocked(d) {
    return lockedRecordDetected(d);
  }
  function domRowLocked(row) {
    if (!row) return false;
    const rowLabel = [row.title, row.getAttribute('aria-label'), row.dataset?.lockStatus, row.dataset?.locked, row.textContent].map(norm).join('|');
    if (/当前报告已被其他用户锁定|已被其他用户锁定|其他用户占用|报告已锁定|报告被占用/.test(rowLabel)) return true;
    const items = [...row.querySelectorAll(config.selectors.operatorItems)];
    return items.some(item => {
      const icon = operatorIconName(item).toLowerCase();
      const label = [item.getAttribute('title'), item.getAttribute('aria-label'), item.dataset?.tip, item.dataset?.title, item.textContent].map(norm).join('|');
      return /(?:unlock|un-lock)/.test(icon) || /lock|locked/.test(String(item.className || '').toLowerCase()) || /解锁|已锁定|被锁定|其他用户占用/.test(label);
    });
  }
  function isPendingReport(d) {
    if (!d) return false;
    if (shouldSkipLocked(d)) return false;
    const pendingCode = norm(config.pendingStatusValue || '102501');
    const statusCode = norm(d.statusCode || d.record?.reportStatusCode || d.record?.checkStatusCode || d.record?.statusCode);
    const status = norm(d.status || d.record?.reportStatus || d.record?.reportStatusName || d.record?.checkStatusName);
    if (/诊断中|待审核|审核中|已审核|已打印/.test(status)) return false;
    if (statusCode) return statusCode === pendingCode;
    return status === '待诊断' || status.includes('待诊断');
  }

  function matchFailureReasons(d) {
    const reasons = [];
    if (!isPendingReport(d)) reasons.push(shouldSkipLocked(d) ? '报告已锁定/占用' : '报告状态非待诊断');
    if (config.reportStatuses?.length && !config.reportStatuses.some(x => norm(d.status).includes(norm(x)))) reasons.push('报告状态');
    if (config.imageStatuses?.length && !config.imageStatuses.some(x => norm(d.imageStatus).includes(norm(x)))) reasons.push('影像状态');
    if (config.encounterTypes?.length && !config.encounterTypes.some(x => norm(d.patient).includes(norm(x)))) reasons.push('就诊类型');
    if (config.gender?.length && !config.gender.includes(d.gender)) reasons.push('性别');
    if (!config.age?.unlimited) {
      if (config.age?.min != null && (d.age == null || d.age < Number(config.age.min))) reasons.push('年龄下限');
      if (config.age?.max != null && (d.age == null || d.age > Number(config.age.max))) reasons.push('年龄上限');
    }
    if (config.modalities?.length && !config.modalities.some(x => norm(d.modality) === norm(x))) reasons.push('检查类型');
    if (config.patientNameContains && !norm(d.patient).includes(norm(config.patientNameContains))) reasons.push('姓名');
    if (config.applicationNoContains && !norm(d.applicationNo || d.rowText).includes(norm(config.applicationNoContains))) reasons.push('申请单号');
    if (config.applyInstitution?.length && !config.applyInstitution.some(x => norm(d.institution || d.rowText).includes(norm(x)))) reasons.push('申请机构');
    if (config.checkHospitals?.length && !config.checkHospitals.some(x => norm(d.hospital || d.rowText).includes(norm(x)))) reasons.push('检查医院');
    if (config.bodyParts?.length && !config.bodyParts.some(x => norm(d.bodyPart || d.rowText).includes(norm(x)))) reasons.push('检查部位');
    if (config.diagnosisDoctors?.length && !config.diagnosisDoctors.some(x => norm(d.diagnosisDoctor || d.doctor || d.rowText).includes(norm(x)))) reasons.push('诊断医生');
    if (config.auditDoctors?.length && !config.auditDoctors.some(x => norm(d.auditDoctor || d.doctor).includes(norm(x)))) reasons.push('医生');
    if (!matchTime(d.applyTime, config.applicationTime)) reasons.push('申请时间');
    if (!matchTime(d.diagnosisTime, config.diagnosisTime)) reasons.push('诊断审核时间');
    if (!matchTime(d.auditTime, config.auditTime)) reasons.push('审核时间');
    const parts = String(d.exam || '').split(config.examSeparators).map(norm).filter(Boolean);
    if (isExcludedExam(d)) reasons.push('检查项目排除');
    const siteRule = config.examSiteCount || (config.singleSiteOnly ? { min: 1, max: 1 } : { min: null, max: null });
    if (siteRule.min != null && parts.length < Number(siteRule.min)) reasons.push('检查部位过少');
    if (siteRule.max != null && parts.length > Number(siteRule.max)) reasons.push('检查部位过多');
    const acceptedExams = [...(config.examNames || []), ...(config.examNamesExtra || [])];
    if (acceptedExams.length && !acceptedExams.some(x => norm(parts[0] || d.exam) === norm(x))) reasons.push('检查项目');
    return reasons;
  }
  function matches(d) {
    return matchFailureReasons(d).length === 0;
  }

  function pendingSelector() {
    return String(config.selectors.statusInput).replace('{pendingStatusValue}', CSS.escape(String(config.pendingStatusValue)));
  }

  // 不再修改页面的状态复选框。页面筛选属于用户交互，协议链路使用
  // config.reportStatuses 自己构造请求条件，避免后台脚本把用户切换的列表重置为“待诊断”。
  async function ensurePendingFilter() { return; }

  function operatorIconName(item) {
    const use = item?.querySelector?.('use');
    return norm(use?.getAttribute('xlink:href') || use?.getAttribute('href') || '');
  }

  function operatorDisabled(item) {
    if (!item) return true;
    return item.disabled === true || item.hasAttribute?.('disabled') || item.classList.contains('is-disabled') || item.classList.contains('disabled') || item.getAttribute('aria-disabled') === 'true';
  }

  function diagnoseOperator(row) {
    const items = [...row.querySelectorAll(config.selectors.operatorItems)];
    // 页面在部分状态下会把锁定/解锁图标放在最前面，不能再依赖固定序号。
    const report = items.find(item => /(?:^|-)report$/i.test(operatorIconName(item)));
    if (report) return operatorDisabled(report) ? null : report;
    const titled = items.find(item => /诊断/.test([item.getAttribute('title'), item.getAttribute('aria-label'), item.dataset?.tip, item.dataset?.title].filter(Boolean).join(' ')));
    if (titled) return operatorDisabled(titled) ? null : titled;
    const configured = items[Number(config.selectors.diagnoseOperatorIndex)];
    return configured && !operatorDisabled(configured) ? configured : null;
  }

  // 最终进入仍由原生报告页发起。导航与回包之间只阻止第二次进入，
  // 不停止 WebSocket、只读列表或页面观察；按标签页保存以覆盖全页导航。
  const FINAL_ENTRY_PENDING_KEY = 'jx-radiation-final-entry-pending-v1';
  const FINAL_ENTRY_PENDING_MS = 30000;
  let finalEntryPending = null;
  let finalEntryPendingLoaded = false;
  let finalEntryPendingTimer = null;

  function persistFinalEntryPending() {
    try {
      const storage = pageWindow().sessionStorage;
      if (finalEntryPending) storage?.setItem(FINAL_ENTRY_PENDING_KEY, JSON.stringify(finalEntryPending));
      else storage?.removeItem(FINAL_ENTRY_PENDING_KEY);
    } catch (_) {}
  }

  function finishFinalEntryPending(reason, repUid = '', detail = {}) {
    if (!finalEntryPending || (repUid && String(repUid) !== finalEntryPending.repUid)) return false;
    const pending = finalEntryPending;
    finalEntryPending = null;
    if (finalEntryPendingTimer) clearTimeout(finalEntryPendingTimer);
    finalEntryPendingTimer = null;
    persistFinalEntryPending();
    developerLog('最终进入等待结束', {
      key: pending.repUid ? `rep:${pending.repUid}` : '', recordId: pending.repUid,
      source: pending.source, reason, durationMs: Math.max(0, Date.now() - pending.startedAt), ...detail
    }, { force: true });
    return true;
  }

  function scheduleFinalEntryPendingExpiry() {
    if (finalEntryPendingTimer) clearTimeout(finalEntryPendingTimer);
    finalEntryPendingTimer = null;
    if (!finalEntryPending) return;
    const repUid = finalEntryPending.repUid;
    finalEntryPendingTimer = setTimeout(() => {
      finalEntryPendingTimer = null;
      finishFinalEntryPending('final-response-timeout', repUid, { finalReportLoaded: false });
    }, Math.max(1, finalEntryPending.expiresAt - Date.now()));
  }

  function pendingFinalEntryState() {
    if (!finalEntryPendingLoaded) {
      finalEntryPendingLoaded = true;
      try {
        const saved = JSON.parse(pageWindow().sessionStorage?.getItem(FINAL_ENTRY_PENDING_KEY) || 'null');
        if (saved && typeof saved.repUid === 'string' && saved.repUid.length <= 96 &&
            Number.isFinite(saved.startedAt) && Number.isFinite(saved.expiresAt) &&
            saved.startedAt <= Date.now() && saved.expiresAt <= Date.now() + FINAL_ENTRY_PENDING_MS &&
            saved.expiresAt > saved.startedAt && saved.expiresAt <= saved.startedAt + FINAL_ENTRY_PENDING_MS) {
          finalEntryPending = {
            repUid: saved.repUid, startedAt: saved.startedAt, expiresAt: saved.expiresAt,
            source: saved.source === 'page-click' ? 'page-click' : 'protocol', reportRouteSeen: !!saved.reportRouteSeen,
            entryKey: typeof saved.entryKey === 'string' ? saved.entryKey.slice(0, 100) : '',
            entryToken: typeof saved.entryToken === 'string' ? saved.entryToken.slice(0, 200) : ''
          };
          scheduleFinalEntryPendingExpiry();
        }
      } catch (_) {}
    }
    if (finalEntryPending && Date.now() >= finalEntryPending.expiresAt) {
      finishFinalEntryPending('final-response-timeout', finalEntryPending.repUid, { finalReportLoaded: false });
    }
    if (finalEntryPending?.reportRouteSeen && pageWindow().location.pathname === '/radiation') {
      finishFinalEntryPending('returned-to-list', finalEntryPending.repUid, { finalReportLoaded: false });
    }
    if (finalEntryPending && pageWindow().location.pathname === '/radiation/report' && !finalEntryPending.reportRouteSeen) {
      finalEntryPending.reportRouteSeen = true;
      if (!finalEntryPending.repUid) {
        try { finalEntryPending.repUid = new URL(pageWindow().location.href).searchParams.get('id')?.slice(0, 96) || ''; } catch (_) {}
      }
      persistFinalEntryPending();
    }
    return finalEntryPending;
  }

  function beginFinalEntryPending(repUid, source) {
    pendingFinalEntryState();
    finalEntryPending = {
      repUid: String(repUid || '').slice(0, 96), startedAt: Date.now(), expiresAt: Date.now() + FINAL_ENTRY_PENDING_MS,
      source: source === 'page-click' ? 'page-click' : 'protocol', reportRouteSeen: false
    };
    persistFinalEntryPending();
    scheduleFinalEntryPendingExpiry();
    developerLog('最终进入等待开始', {
      key: finalEntryPending.repUid ? `rep:${finalEntryPending.repUid}` : '', recordId: finalEntryPending.repUid,
      source: finalEntryPending.source, timeoutMs: FINAL_ENTRY_PENDING_MS, finalReportLoaded: false
    }, { force: true });
  }

  function maintainFinalEntryPendingRoute(path, previous = '') {
    const pending = pendingFinalEntryState();
    if (!pending) return;
    if (path === '/radiation' && (previous === '/radiation/report' || pending.reportRouteSeen)) {
      finishFinalEntryPending('returned-to-list', pending.repUid, { finalReportLoaded: false });
    } else if (!isMonitorRoute(path)) {
      finishFinalEntryPending('left-report-flow', pending.repUid, { finalReportLoaded: false });
    }
  }

  function completeFinalEntryPending(detail) {
    if (detail.endpointKind !== 'radiation-entry' || detail.requestMethod !== 'POST') return false;
    const pending = pendingFinalEntryState();
    const repUid = String(detail.repUid || '').slice(0, 96);
    if (!pending || !repUid || pending.repUid !== repUid) return false;
    // An old response cannot release a later attempt of the same report.
    const startedAt = Number(detail.startedAt) || (Date.now() - Math.max(0, Number(detail.durationMs) || 0));
    if (startedAt < pending.startedAt) return false;
    return finishFinalEntryPending(`native-${detail.outcome}`, repUid, {
      code: detail.code ?? null, httpStatus: Number(detail.httpStatus) || 0,
      finalReportLoaded: detail.outcome === 'complete' && detail.reportIdMatches !== false &&
        detail.responseRoute === '/radiation/report' && String(detail.responseRouteReportId || '') === repUid
    });
  }

  function existingRadiationRouter() {
    try {
      const doc = pageWindow().document || document;
      const root = doc.getElementById?.('app') || doc.querySelector?.('[data-v-app]');
      const router = root?.__vue_app__?.config?.globalProperties?.$router ||
        root?.__vueParentComponent?.appContext?.config?.globalProperties?.$router;
      return typeof router?.push === 'function' ? router : null;
    } catch (_) { return null; }
  }

  async function navigateToDiagnosisReport(url, repUid, entryData = null) {
    const router = existingRadiationRouter();
    if (router) {
      try {
        const result = await router.push(url);
        if (result && typeof result === 'object' && Number(result.type)) {
          if (entryData) releaseAutomaticEntry(entryData, 'navigation-cancelled');
          finishFinalEntryPending('navigation-cancelled', String(repUid), { navigationFailureType: Number(result.type), finalReportLoaded: false });
          developerLog('诊断路由导航取消', { key: `rep:${repUid}`, recordId: String(repUid), source: 'vue-router', navigationFailureType: Number(result.type) }, { force: true });
          return false;
        }
        developerLog('诊断路由导航', { key: `rep:${repUid}`, recordId: String(repUid), source: 'vue-router', fullReload: false }, { force: true });
        return true;
      } catch (error) {
        developerLog('诊断路由导航回退', { key: `rep:${repUid}`, recordId: String(repUid), source: 'vue-router', error: debugError(error), fullReload: true }, { force: true });
      }
    }
    // Full navigation can terminate this userscript before its awaiting caller
    // resumes. Persist the dispatched entry synchronously before assigning href.
    if (entryData) consumeAutomaticEntry(entryData, 'automatic-navigation');
    pageWindow().location.href = url;
    return true;
  }

  // diagnosisActive 是本脚本刚发起进入后的短期互斥锁。列表仍会继续刷新；
  // 如果列表中已没有带诊断医生姓名的“诊断中”记录，视为当前入口已释放，
  // 允许下一位客户再次走协议校验。列表暂时不可读时保持锁，交给服务端门禁兜底。
  function entryDiagnosisLockActive() {
    if (pendingFinalEntryState()) return true;
    if (!diagnosisActive) return false;
    const rows = queryBodyRows();
    if (!rows.length) return true;
    const dataRows = rows.map(rowData).filter(d => d.patient || d.status || d.exam || d.applicationNo);
    // 报告页可能先渲染其它表格，再异步挂载右侧待诊断列表；
    // 未识别到业务行时保持锁，避免误把报告编辑表格当成“无诊断中客户”。
    if (!dataRows.length) return true;
    const diagnosingCode = REPORT_STATUS_CODES?.['诊断中'] || '102502';
    const owned = dataRows.some(d => {
      return (/诊断中/.test(norm(d.status)) || norm(d.statusCode) === diagnosingCode) && !!norm(d.doctor);
    });
    if (owned) return true;
    diagnosisActive = false;
    developerLog('诊断锁释放', { reason: '列表中没有带诊断医生姓名的诊断中记录' });
    return false;
  }

  function isMonitorRoute(path = pageWindow().location.pathname) {
    return path === '/radiation' || path === '/radiation/report';
  }
  function isListRoute(path = pageWindow().location.pathname) {
    return path === '/radiation';
  }
  // 观察链路和“自动打开”是两个独立门禁：用户关闭自动打开后，WebSocket、
  // statusNum、只读列表和生命周期日志仍然运行，但任何协议校验或页面点击都被硬挡住。
  function isMonitoringEnabled() {
    return config.monitoringEnabled !== false;
  }
  function isAutoOpenEnabled() {
    const state = autoEntryScheduleState();
    if (state.expired) {
      clearExpiredAutoEntrySchedule(state);
      return false;
    }
    if (state.requiresSelection) return false;
    // 未选择时段时保留旧版本的不限时行为；一旦选择时段，只有当前时段内才允许进入。
    return config.enabled === true && (!state.configured || state.active);
  }

  function scheduleAutoEntryScheduleExpiry() {
    if (autoEntryScheduleTimer) { clearTimeout(autoEntryScheduleTimer); autoEntryScheduleTimer = null; }
    const state = autoEntryScheduleState();
    if (!state.configured) return;
    if (state.expired) {
      clearExpiredAutoEntrySchedule(state);
      return;
    }
    const waitMs = Math.max(1000, (state.active ? state.endAt : state.startAt) - Date.now() + 50);
    autoEntryScheduleTimer = setTimeout(() => {
      autoEntryScheduleTimer = null;
      const current = autoEntryScheduleState();
      if (current.expired) clearExpiredAutoEntrySchedule(current);
      else { refreshAutoEntryScheduleUI(); scheduleAutoEntryScheduleExpiry(); }
    }, Math.min(waitMs, 2147483647));
  }

  function clickDiagnose(d) {
    if (isExcludedExam(d)) {
      d.__entryBlocked = '检查项目排除';
      developerLog('页面点击跳过', { ...debugCandidate(d), reason: d.__entryBlocked });
      return false;
    }
    if (!isAutoOpenEnabled()) {
      developerLog('观察模式跳过自动打开', { ...debugCandidate(d), source: 'page-click', reason: '自动打开已关闭' });
      return false;
    }
    if (entryDiagnosisLockActive()) return false;
    if (!d?.row) return false;
    if (shouldSkipLocked(d)) {
      developerLog('页面点击跳过', { ...debugCandidate(d), reason: '报告已锁定/占用' });
      return false;
    }
    const current = rowData(d.row);
    if (!isPendingReport(current)) {
      developerLog('页面点击跳过', { ...debugCandidate(current), reason: shouldSkipLocked(current) ? '报告已锁定/占用' : '报告状态非待诊断' });
      return false;
    }
    const item = diagnoseOperator(d.row);
    if (!item) {
      const items = [...d.row.querySelectorAll(config.selectors.operatorItems)].map((x, i) => ({ index: i, icon: operatorIconName(x), className: x.className }));
      console.warn('[自动诊断] 找不到可用的诊断操作按钮', { items });
      return false;
    }
    const record = d.record || current.record || findRowRecord(d);
    const repUid = record?.repUid || record?.reportUid || record?.reportId || record?.id || '';
    if (record) d.record = record;
    if (automaticEntryBlockReason(d) || !reserveAutomaticEntry(d)) {
      developerLog('页面点击跳过', { ...debugCandidate(d), reason: automaticEntryBlockReason(d) || '缺少稳定报告编号或无法保存进入记录' });
      return false;
    }
    beginFinalEntryPending(repUid, 'page-click');
    finalEntryPending.entryKey = d.__automaticEntryKey;
    finalEntryPending.entryToken = d.__automaticEntryToken;
    persistFinalEntryPending();
    diagnosisActive = true;
    item.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    try {
      if (!consumeAutomaticEntry(d, 'automatic-page-click')) {
        releaseAutomaticEntry(d, 'entry-not-durable');
        finishFinalEntryPending('entry-not-durable', String(repUid), { finalReportLoaded: false });
        diagnosisActive = false;
        return false;
      }
      if (typeof item.click === 'function') item.click();
      else item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (error) {
      releaseAutomaticEntry(d, 'page-click-threw');
      finishFinalEntryPending('page-click-threw', String(repUid), { error: debugError(error), finalReportLoaded: false });
      throw error;
    }
    return true;
  }

  // Vue 表格行没有把 repUid 渲染到 DOM。用户脚本仍可从 Vue 的 vnode/component
  // 引用中取到行对象；遍历范围刻意限制在当前行附近，避免扫描整棵组件树。
  function stableReportRecordUid(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return '';
    const raw = record.repUid || record.reportUid || record.reportId || record.id;
    if (typeof raw !== 'string' && typeof raw !== 'number') return '';
    const value = String(raw).trim();
    return value && value.length <= 96 && !/[\u0000-\u0020\u007f]/.test(value) ? value : '';
  }

  function reportRecordMatchScore(record, d) {
    if (!stableReportRecordUid(record) || !d) return 0;
    const wantedName = candidatePatientName(d), actualName = norm(record.patName || record.patientName);
    const wantedApplication = norm(d.applicationNo);
    const applications = [record.applyNo, record.applicationNo, record.orderId].map(norm).filter(Boolean);
    const applicationMatches = !!wantedApplication && applications.includes(wantedApplication);
    // 姓名或申请单号相矛盾时，不能用相同检查项目补偿身份不匹配。
    if (wantedName && actualName && wantedName !== actualName) return 0;
    if (wantedApplication && applications.length && !applicationMatches) return 0;
    const wantedExam = norm(d.exam), actualExam = norm(record.examName || record.exam);
    const examMatches = !!wantedExam && wantedExam === actualExam;
    if (wantedExam && actualExam && !examMatches) return 0;
    const wantedTime = norm(d.applyTime), actualTime = norm(record.checkinTime || record.applyTime || record.initiateTime);
    let timeMatches = false;
    if (wantedTime && actualTime) {
      const left = parseDate(wantedTime), right = parseDate(actualTime);
      timeMatches = left && right ? left.getTime() === right.getTime() : wantedTime === actualTime;
      if (!timeMatches) return 0;
    }
    const nameMatches = !!wantedName && wantedName === actualName;
    // 无申请单号时，姓名必须精确匹配，并至少有一个检查/申请时间辅助证据。
    if (!applicationMatches && !(nameMatches && (examMatches || timeMatches))) return 0;
    return (applicationMatches ? 100 : 0) + (nameMatches ? 10 : 0) + (examMatches ? 4 : 0) + (timeMatches ? 3 : 0);
  }

  function selectReportRecord(records, d) {
    const matches = new Map();
    for (const record of records || []) {
      const uid = stableReportRecordUid(record), score = reportRecordMatchScore(record, d);
      if (!uid || !score) continue;
      if (!matches.has(uid) || matches.get(uid).score < score) matches.set(uid, { record, score });
    }
    const ordered = [...matches.values()].sort((a, b) => b.score - a.score);
    // 同名同项目/同申请单的多个报告无法唯一对应时，不猜第一条。
    return ordered.length && (ordered.length === 1 || ordered[0].score > ordered[1].score) ? ordered[0].record : null;
  }

  function findRowRecord(d) {
    if (stableReportRecordUid(d?.record)) return d.record;
    const isolatedRoot = d?.row;
    const page = pageWindow();
    let root = isolatedRoot;
    // Vue 的 __vnode/组件引用位于页面世界；Tampermonkey 隔离世界中的同一 DOM
    // 节点看不到这些 expando，因此按行序号取一个页面世界节点再读取。
    try {
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
    const records = [];
    const seenObj = new WeakSet();
    for (let i = 0; i < queue.length && i < 80; i++) {
      const value = queue[i];
      if (!value || (typeof value !== 'object' && typeof value !== 'function') || seenObj.has(value)) continue;
      seenObj.add(value);
      if (stableReportRecordUid(value) && reportRecordMatchScore(value, d)) records.push(value);
      let keys = [];
      try { keys = Object.keys(value); } catch (_) {}
      for (const key of keys.slice(0, 120)) {
        let child;
        try { child = value[key]; } catch (_) { continue; }
        if (child && typeof child === 'object') add(child);
      }
      // Vue 3 的组件实例常把原始 props/响应式行对象放在这些位置。
      for (const key of ['proxy', 'props', 'setupState', 'data', 'subTree', 'children', 'component', 'ctx', 'exposed']) {
        try { add(value[key]); } catch (_) {}
      }
    }
    return selectReportRecord(records, d);
  }

  function radiationListPayload(options = {}) {
    const match = options.match || null;
    const timeRange = options.ignoreApplicationTime ? { start: '', end: '' } : (options.timeRange || applicationTimeRange(config.applicationTime));
    const checkOrgId = currentCheckOrgId(options);
    const payload = {
      modalityList: [], patName: '', startDiagTime: '', endDiagTime: '', diagDate: '',
      checkinStartTime: timeRange.start, checkinEndTime: timeRange.end, studyDate: '', status: '', patId: '',
      orderId: '', checkinDoc: '', reportDoc: '', auditDoc: '', applyNo: '', applyDoc: '',
      applyDep: '', applyOrgName: '', opinion: '', patSource: '', bodyPartName: '', examName: '',
      reportStatusCodeList: [], did: '', roomId: '', repGroupList: [], auditGroupList: [],
      sortColumnName: '', sortStatus: '', recentAudit: false, recentDiagnosis: false,
      docUid: null, patAgeUnit: '岁', sortByParams: [{ sortField: 'checkinTime', sortRule: 'DESC' }], checkOrgId, clinicalInfo: '',
      tailOrderIds: [], gender: '', pageNum: 1, pageSize: Math.max(1, Math.min(100, Number(options.pageSize) || 30))
    };
    if (!options.ignoreStatusFilter) payload.reportStatusCodeList = probeStatusCodes();
    if (!options.ignoreModalityFilter) payload.modalityList = Array.isArray(config.modalities) ? [...config.modalities] : [];
    if (!options.ignoreInstitutionFilter && config.applyInstitution?.length === 1) payload.applyOrgName = config.applyInstitution[0];
    if (!options.ignoreBodyPartFilter && config.bodyParts?.length === 1) payload.bodyPartName = config.bodyParts[0];
    if (match) {
      const patientName = candidatePatientName(match);
      if (patientName) payload.patName = patientName;
      if (match.applicationNo) {
        payload.applyNo = match.applicationNo;
      }
      if (match.exam) payload.examName = match.exam;
    }
    return payload;
  }

  async function fetchRadiationRecords(options = {}) {
    // 列表接口只读，不会改变报告状态；同时用于协议兜底和更新可选项目。
    const startedAt = Date.now();
    const requestId = `list-${startedAt}-${debugHash(`${options.reason || 'list'}|${debugTag(options.match)}`)}`;
    let scopeId = currentCheckOrgId(options);
    developerLog('列表请求开始', {
      requestId,
      source: options.reason || 'list', narrow: !!options.match,
      candidateTag: debugTag(options.match),
      pageSize: Math.max(1, Math.min(100, Number(options.pageSize) || 30)),
      hintAt: options.hintAt || null,
      dispatchDelayMs: options.hintAt ? Math.max(0, startedAt - Number(options.hintAt) || 0) : null,
      diagnosisActive,
      entryRunning,
      statusProbeFailures,
      checkOrgId: debugCredentialShape(scopeId)
    });
    try {
      const identityStartedAt = Date.now();
      await ensureSessionIdentity();
      const identityWaitMs = Date.now() - identityStartedAt;
      scopeId = currentCheckOrgId(options);
      let { response, payload: json, timing } = await fetchJson('/api/ct/rays/rep/list', {
        method: 'POST', credentials: 'include', __hintAt: options.hintAt, __requestId: requestId, __identityWaitMs: identityWaitMs,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(radiationListPayload(options))
      }, options.timeoutMs || 5000);
      // 某些部署对组合筛选返回 2002。退回到轻量的全量最近列表，再由客户端过滤，
      // 避免服务端筛选错误让实时轮询进入退避状态。
      if (json?.code === 2002 && !options.ignoreStatusFilter) {
        developerLog('列表筛选退回客户端过滤', { requestId, source: options.reason || 'list', code: json.code });
        ({ response, payload: json, timing } = await fetchJson('/api/ct/rays/rep/list', {
          method: 'POST', credentials: 'include', __hintAt: options.hintAt, __requestId: requestId, __identityWaitMs: identityWaitMs,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(radiationListPayload({ ...options, match: null, pageSize: 100, ignoreStatusFilter: true, ignoreModalityFilter: true, ignoreInstitutionFilter: true, ignoreBodyPartFilter: true }))
        }, options.timeoutMs || 5000));
      }
      const records = json?.data?.records || json?.data?.list || (Array.isArray(json?.data) ? json.data : []);
      if (!response.ok || json?.code !== 200 || !Array.isArray(records)) {
        developerLog('列表请求结果', { requestId, ...timing, source: options.reason || 'list', ok: false, httpOk: !!response.ok, httpStatus: response.status ?? null, code: json?.code ?? null, count: 0, durationMs: Date.now() - startedAt, diagnosisActive, entryRunning, checkOrgId: debugCredentialShape(scopeId) });
        // When the protocol session is rejected but the rendered workbench is
        // still usable, let the page's own Axios request refresh its session
        // headers once.  This is a bounded visible-page fallback, not a new
        // polling loop; the existing 15-second query gate remains in force.
        if (json?.code === 2002 && options.reason && options.reason !== 'status-probe') {
          const refreshed = await refreshPageListOnFocus({ automatic: true });
          developerLog('TOKEN_FAIL页面查询兜底', { source: options.reason, refreshed, code: 2002 });
        }
        return [];
      }
      // WebSocket 线索经常只有报告编号、姓名和检查项目，服务端按当前页面
      // 的状态/检查类型/时间组合筛选可能返回空数组。对单条实时线索只做一次
      // 精确姓名兜底，并清除服务端组合筛选，让客户端拿到完整记录后再判断；
      // 普通心跳不走这个分支，避免增加服务器负载。
      if (!records.length && options.match && !options._matchFallbackTried) {
        const fallbackMatch = { ...options.match, exam: '' };
        developerLog('实时线索窄列表为空，退回精确查询', {
          requestId,
          source: options.reason || 'list',
          candidateTag: debugTag(options.match),
          patientName: candidatePatientName(options.match),
          reason: '服务端组合筛选返回空，改用姓名精确查询补全记录'
        }, { force: true });
        const fallback = await fetchRadiationRecords({
          ...options,
          match: fallbackMatch,
          pageSize: Math.max(30, Number(options.pageSize) || 30),
          ignoreApplicationTime: true,
          ignoreStatusFilter: true,
          ignoreModalityFilter: true,
          ignoreInstitutionFilter: true,
          ignoreBodyPartFilter: true,
          _matchFallbackTried: true,
          reason: `${options.reason || 'list'}-match-fallback`
        });
        if (fallback.length) return fallback;
      }
      developerLog('列表请求结果', { requestId, ...timing, source: options.reason || 'list', ok: true, httpStatus: response.status ?? null, code: json?.code ?? null, count: records.length, durationMs: Date.now() - startedAt, diagnosisActive, entryRunning, checkOrgId: debugCredentialShape(scopeId) });
      return records;
    } catch (e) {
      console.warn('[自动诊断] 列表协议查询失败', String(e));
      developerLog('列表请求异常', { requestId, source: options.reason || 'list', error: debugError(e), durationMs: Date.now() - startedAt, diagnosisActive, entryRunning });
      return [];
    }
  }

  async function findRowRecordByApi(d) {
    if (stableReportRecordUid(d?.record)) return d.record;
    try {
      const records = await fetchRadiationRecords({ match: d, pageSize: 20, timeoutMs: 4500 });
      return selectReportRecord(records, d);
    } catch (e) {
      return null;
    }
  }

  let protocolFinalEntryRepUid = '';

  function protocolFinalEntryContext(repUid) {
    try {
      const page = pageWindow(), bridge = page.__JX_PROTOCOL_ENTRY_HANDOFF__;
      const router = existingRadiationRouter(), identity = loginIdentity();
      if (!router || !norm(identity.name) || !bridge?.ready || !bridge.isReady()) return null;
      const root = page.document.getElementById('app');
      const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia ||
        root?.__vueParentComponent?.appContext?.config?.globalProperties?.$pinia;
      const nativeUser = pinia?._s?.get('user');
      const nativeLoginCode = nativeUser?.userInfo?.logincode;
      if (typeof nativeLoginCode !== 'string' || !nativeLoginCode || nativeLoginCode !== readCookie('LOGINCODE')) return null;
      const station = nativeUser?.currentWorkStation ?? readCookie('WORKSTATION');
      // Native Axios uses the Pinia station while sessionHeaders uses the
      // cookie. Pre-acquire only when both identify the same native request.
      if (typeof station !== 'string' || station !== readCookie('WORKSTATION')) return null;
      const body = { repUid: String(repUid), isList: false, isRemote: false, flag: station === '105712' ? 1 : 0 };
      const session = [readCookie('LOGINCODE'), readCookie('AUTH'), station].join('|');
      return { bridge, router, body, session, href: page.location.href };
    } catch (_) { return null; }
  }

  function stopAutoOpenAfterAcquisitionFailure(reason, uncertain = false) {
    // A dispatched write may already own the report. Preserve it for manual
    // recovery and stop acquiring another report until the outcome is clear.
    config.enabled = false;
    saveConfig();
    refreshAutoEntryScheduleUI();
    developerLog(uncertain ? '最终进入结果未知，自动打开暂停' : '已取得报告但页面交接失败，自动打开暂停', { reason, source: 'protocol-final-entry' }, { force: true });
    try {
      const page = pageWindow(), doc = page.document;
      const notice = doc.createElement('div');
      notice.textContent = uncertain ? '最终进入结果未确认；自动打开已暂停，请核对当前诊断任务后重新启用。' : '已取得报告，但页面交接未完成；自动打开已暂停，请手动打开当前报告后重新启用。';
      notice.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:12px 18px;background:#fdf6ec;color:#b36b00;border:1px solid #f3d19e;border-radius:6px';
      doc.body?.appendChild(notice);
      setTimeout(() => notice.remove(), 15000);
    } catch (_) {}
  }

  async function acquireProtocolReport(d, entryData, repUid, url, context) {
    const startedAt = Date.now(), requestId = 'final-' + startedAt + '-' + Math.random().toString(36).slice(2, 9);
    let acquired = false, ticket = '';
    if (!consumeAutomaticEntry(d, 'protocol-final-dispatched')) {
      d.__entryBlocked = '无法持久保存最终进入记录';
      return false;
    }
    // After the write is dispatched, uncertainty must never fall back to
    // clicking or issue a second POST. The final service response is decisive.
    d.__protocolFinalAttempted = true;
    diagnosisActive = true;
    beginFinalEntryPending(repUid, 'protocol');
    finalEntryPending.entryKey = d.__automaticEntryKey;
    finalEntryPending.entryToken = d.__automaticEntryToken;
    persistFinalEntryPending();
    protocolFinalEntryRepUid = String(repUid);
    try {
      const { response, payload, timing } = await fetchJson('/api/ct/rays/rep/enter', {
        __requestId: requestId, __tokenRecoveryRetry: true,
        method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(context.body)
      }, 4500);
      const data = payload?.data;
      const validData = data && typeof data === 'object' && !Array.isArray(data);
      const owner = norm(data?.reportDoc || data?.reportDoctor || data?.diagnosisDoctor);
      const ownName = norm(loginIdentity().name);
      const responseUid = String(data?.repUid || data?.reportUid || data?.reportId || '');
      const status = norm(data?.reportStatusCode || data?.checkStatusCode);
      const ownerMatches = !!owner && !!ownName && owner === ownName;
      const lockedMessage = /锁定|占用|其他用户/.test(norm(payload?.message || payload?.msg));
      const success = response.ok && payload?.code === 200 && validData && ownerMatches &&
        (!responseUid || responseUid === String(repUid)) && (!status || status === '102502') && !lockedMessage;
      developerLog(success ? '协议最终进入取得' : '协议最终进入拒绝', {
        ...debugCandidate(entryData), requestId, ...timing, phase: 'protocol-acquire',
        code: payload?.code ?? null, httpStatus: response.status, ownerMatches, serverMessage: norm(payload?.message || payload?.msg).slice(0, 240),
        finalReportLoaded: false, durationMs: Date.now() - startedAt
      }, { force: true });
      if (!success) {
        const knownRejected = response.ok && Number.isFinite(payload?.code) && payload.code !== 200;
        if (lockedMessage) consumeAutomaticEntry(d, 'server-locked-other');
        if (knownRejected && !lockedMessage) releaseAutomaticEntry(d, 'protocol-final-rejected');
        d.__entryBlocked = lockedMessage ? '报告已被其他用户锁定，本报告不再自动尝试' :
          validData && !ownerMatches ? '最终进入医生归属未确认' : '最终进入未确认，禁止重复请求';
        finishFinalEntryPending('protocol-final-rejected', String(repUid), { finalReportLoaded: false });
        if (!knownRejected && !lockedMessage) stopAutoOpenAfterAcquisitionFailure(d.__entryBlocked, true);
        diagnosisActive = false;
        return false;
      }
      acquired = true;
      // A real successful lock cannot be undone by navigation cancellation,
      // older response callbacks, log cleanup or returning to the list.
      if (!consumeAutomaticEntry(d, 'protocol-final-acquired', true)) {
        d.__entryBlocked = '最终进入已取得，持久确认失败';
        stopAutoOpenAfterAcquisitionFailure(d.__entryBlocked);
        return false;
      }
      const current = protocolFinalEntryContext(repUid);
      if (!current || current.session !== context.session || pageWindow().location.href !== context.href || !isAutoOpenEnabled()) {
        d.__entryBlocked = '最终进入后会话、页面或自动打开授权已变化';
        finishFinalEntryPending('protocol-session-changed', String(repUid), { finalReportLoaded: false });
        stopAutoOpenAfterAcquisitionFailure(d.__entryBlocked);
        return false;
      }
      ticket = context.bridge.stage(context.body, JSON.stringify(payload), response.status, response.headers, 15000, response.statusText);
      if (!ticket) {
        d.__entryBlocked = '最终进入响应交接失败，禁止重复请求';
        finishFinalEntryPending('protocol-handoff-failed', String(repUid), { finalReportLoaded: false });
        stopAutoOpenAfterAcquisitionFailure(d.__entryBlocked);
        return false;
      }
      const result = await context.router.push(url);
      if (result && typeof result === 'object' && Number(result.type)) {
        context.bridge.discard(ticket);
        ticket = '';
        d.__entryBlocked = '已取得报告，页面导航取消';
        finishFinalEntryPending('protocol-navigation-cancelled', String(repUid), { finalReportLoaded: false });
        stopAutoOpenAfterAcquisitionFailure(d.__entryBlocked);
        return false;
      }
      developerLog('协议响应交接导航', { key: 'rep:' + repUid, recordId: String(repUid), requestId,
        source: 'protocol-final-entry', phase: 'handoff-navigation', finalReportLoaded: false,
        durationMs: Date.now() - startedAt }, { force: true });
      return true;
    } catch (error) {
      if (ticket) context.bridge.discard(ticket);
      d.__entryBlocked = '最终进入结果未知，禁止重复请求';
      finishFinalEntryPending('protocol-final-uncertain', String(repUid), { finalReportLoaded: false });
      stopAutoOpenAfterAcquisitionFailure(d.__entryBlocked, !acquired);
      developerLog('协议最终进入异常', { ...debugCandidate(entryData), requestId, phase: 'protocol-acquire',
        error: debugError(error), finalReportLoaded: false, durationMs: Date.now() - startedAt }, { force: true });
      return false;
    } finally {
      protocolFinalEntryRepUid = '';
    }
  }

  async function protocolEnter(d) {
    if (!isAutoOpenEnabled()) {
      developerLog('观察模式跳过自动打开', { ...debugCandidate(d), source: 'protocol', reason: '自动打开已关闭' });
      return false;
    }
    const pageBlock = pageEntryBlockReason(d);
    if (pageBlock) {
      d.__entryBlocked = pageBlock;
      developerLog('协议进入跳过', { ...debugCandidate(d), reason: pageBlock });
      return false;
    }
    const record = d?.record || findRowRecord(d) || await findRowRecordByApi(d);
    // Keep the resolved UID on the original DOM candidate as well as the
    // protocol view: a later DOM observation must see the same stable identity.
    if (record) d.record = record;
    if (!isAutoOpenEnabled() || !isMonitorRoute() || entryDiagnosisLockActive()) return false;
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
    if (isExcludedExam(entryData)) {
      d.__entryBlocked = '检查项目排除';
      developerLog('协议进入跳过', { ...debugCandidate(entryData), reason: d.__entryBlocked });
      return false;
    }
    const lifecycle = observeCandidateLifecycle(entryData, 'assertAllowEnter', {
      eligible: isPendingReport(entryData) && !shouldSkipLocked(entryData),
      stage: 'assertAllowEnter'
    });
    if (!isPendingReport(entryData)) {
      d.__entryBlocked = shouldSkipLocked(entryData) ? '报告已锁定/占用' : '报告状态非待诊断';
      developerLog('协议进入跳过', { ...debugCandidate(entryData, { lifecycle: lifecycleDebug(lifecycle) }), reason: d.__entryBlocked });
      return false;
    }
    if (!repUid) {
      console.warn('[自动诊断] 当前行未取得报告编号，协议进入暂不可用，将尝试页面按钮');
      developerLog('协议进入跳过', { ...debugCandidate(entryData), reason: '缺少记录编号' });
      return false;
    }
    const alreadyEntered = automaticEntryBlockReason(entryData);
    if (alreadyEntered || !reserveAutomaticEntry(d)) {
      d.__entryBlocked = alreadyEntered || '缺少稳定报告编号或无法保存进入记录';
      developerLog('协议进入跳过', { ...debugCandidate(entryData), reason: d.__entryBlocked });
      return false;
    }
    entryData.__automaticEntryToken = d.__automaticEntryToken;
    entryData.__automaticEntryKey = d.__automaticEntryKey;
    const startedAt = Date.now();
    const requestId = `assert-${startedAt}-${Math.random().toString(36).slice(2, 9)}`;
    if (lifecycle) lifecycle.attemptCount = Number(lifecycle.attemptCount || 0) + 1;
    developerLog('协议进入开始', { ...debugCandidate(entryData, { lifecycle: lifecycleDebug(lifecycle) }), requestId, reason: '校验允许进入' });
    try {
      const identityStartedAt = Date.now();
      await ensureSessionIdentity();
      const identityWaitMs = Date.now() - identityStartedAt;
      if (!isAutoOpenEnabled() || !isMonitorRoute() || entryDiagnosisLockActive()) return false;
      const url = `/api/ct/rays/rep/assertAllowEnter?repUid=${encodeURIComponent(String(repUid))}`;
      const { response, payload, timing } = await fetchJson(url, { __requestId: requestId, __identityWaitMs: identityWaitMs, method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }, 4500);
      if (!isAutoOpenEnabled() || !isMonitorRoute() || entryDiagnosisLockActive()) {
        developerLog('协议进入取消', { ...debugCandidate(entryData), reason: '自动进入已关闭、时段到期或当前入口不可用', durationMs: Date.now() - startedAt });
        return false;
      }
      const serverMessage = norm(payload?.message);
      const serverBlock = protocolEntryBlockReason(payload);
      const lockedMessage = serverBlock === '报告已锁定/占用';
      const protocolAllowed = protocolAllowsEntry(payload);
      if (!response.ok || payload?.code !== 200 || serverBlock || !protocolAllowed) {
        console.warn('[自动诊断] 系统不允许进入诊断', { code: payload?.code, message: payload?.message });
        const rejectReason = serverBlock || '业务校验拒绝';
        if (serverBlock || (response.ok && payload?.code === 200 && payload?.data !== undefined && !protocolAllowed)) d.__entryBlocked = serverBlock || '业务校验未允许';
        const serverData = lockedMessage ? { ...entryData, status: serverMessage || entryData.status, locked: true } : entryData;
        const serverLifecycle = observeCandidateLifecycle(serverData, 'assertAllowEnter', {
          eligible: false,
          stage: 'server-rejected',
          previousEligible: !!lifecycle?.eligibleAt
        });
        developerLog('协议进入拒绝', {
          ...debugCandidate(entryData, { lifecycle: lifecycleDebug(serverLifecycle || lifecycle) }),
          requestId, ...timing,
          code: payload?.code ?? null,
          httpStatus: response.status ?? null,
          reason: rejectReason,
          serverMessage: serverMessage.slice(0, 240),
          protocolAllowed,
          responseDataShape: payload?.data == null ? 'none' : Array.isArray(payload.data) ? 'array' : typeof payload.data,
          durationMs: Date.now() - startedAt
        }, { force: lockedMessage });
        return false;
      }
      // 等待服务端校验时页面可能已更新为其他用户占用；导航前再读一次当前行。
      const currentPageBlock = pageEntryBlockReason(d);
      const currentRecordView = recordData(record);
      const duplicateBlock = automaticEntryBlockReason(d);
      const excludedBlock = isExcludedExam(currentRecordView || entryData) || isExcludedExam(d) ? '检查项目排除' : '';
      if (duplicateBlock || excludedBlock || currentPageBlock || shouldSkipLocked(d) || !isPendingReport(currentRecordView || entryData)) {
        d.__entryBlocked = duplicateBlock || excludedBlock || currentPageBlock || (shouldSkipLocked(d) || shouldSkipLocked(currentRecordView) ? '报告已锁定/占用' : '报告状态非待诊断');
        developerLog('协议进入取消', { ...debugCandidate(entryData), reason: d.__entryBlocked, durationMs: Date.now() - startedAt });
        return false;
      }
      const applyOrgCode = record?.applyOrgCode || record?.applyOrg || d?.row?.dataset?.applyOrgCode || '';
      const query = new URLSearchParams({ id: String(repUid) });
      if (applyOrgCode) query.set('applyOrgCode', String(applyOrgCode));
      const finalContext = typeof protocolFinalEntryContext === 'function' ? protocolFinalEntryContext(repUid) : null;
      if (finalContext) {
        return await acquireProtocolReport(d, entryData, repUid, `/radiation/report?${query.toString()}`, finalContext);
      }
      console.info('[自动诊断] 协议校验通过，打开诊断页', { hasReportId: true });
      developerLog('协议进入成功', { ...debugCandidate(entryData, { lifecycle: lifecycleDebug(lifecycle) }), requestId, ...timing, phase: 'assert-allowed', finalReportLoaded: false, durationMs: Date.now() - startedAt });
      // 直接使用业务路由，诊断页会按系统原流程继续获取并锁定记录。
      diagnosisActive = true;
      beginFinalEntryPending(repUid, 'protocol');
      finalEntryPending.entryKey = d.__automaticEntryKey;
      finalEntryPending.entryToken = d.__automaticEntryToken;
      persistFinalEntryPending();
      if (!consumeAutomaticEntry(d, 'automatic-navigation')) {
        finishFinalEntryPending('entry-not-durable', String(repUid), { finalReportLoaded: false });
        return false;
      }
      const navigated = await navigateToDiagnosisReport(`/radiation/report?${query.toString()}`, repUid, d);
      if (!navigated) d.__entryBlocked = '页面导航已取消';
      return navigated;
    } catch (e) {
      console.warn('[自动诊断] 协议进入失败，将尝试页面按钮', { error: String(e) });
      if (!d.__protocolFinalAttempted) releaseAutomaticEntry(d, 'protocol-exception');
      if (finishFinalEntryPending('navigation-error', String(repUid), { error: debugError(e), finalReportLoaded: false })) diagnosisActive = false;
      developerLog('协议进入异常', { ...debugCandidate(entryData, { lifecycle: lifecycleDebug(lifecycle) }), error: debugError(e), durationMs: Date.now() - startedAt });
      return false;
    } finally {
      // Only pre-navigation reservations are released here. A dispatched
      // navigation remains consumed until a matching native failure is observed.
      if (readAutomaticEntry(d.__automaticEntryKey)?.state === 'reserved') releaseAutomaticEntry(d, 'protocol-not-dispatched');
    }
  }

  function pageEntryBlockReason(d) {
    if (!d?.row) return '';
    const current = rowData(d.row);
    if (shouldSkipLocked(current)) return '报告已锁定/占用';
    if (!isPendingReport(current)) return '报告状态非待诊断';
    if (!diagnoseOperator(d.row)) return '诊断操作不可用/已禁用';
    return '';
  }

  function protocolEntryBlockReason(payload) {
    const data = payload?.data;
    const records = data && typeof data === 'object' && !Array.isArray(data) ? [data, data.record, data.report, data.reportInfo].filter(value => value && typeof value === 'object') : [];
    const messages = [payload?.message, payload?.msg, ...records.flatMap(value => [value.message, value.msg, value.lockReason])].map(norm);
    if (messages.some(value => /锁定|占用|其他用户|诊断中|审核中/.test(value) && !/^(?:未锁定|未占用|unlocked|not locked)$/i.test(value))) return '报告已锁定/占用';
    if (records.some(record => recordLockState(record))) return '报告已锁定/占用';
    for (const record of records) {
      const statusCode = norm(record.reportStatusCode || record.checkStatusCode || record.statusCode);
      const status = norm(record.reportStatus || record.reportStatusName || record.checkStatusName || record.status);
      if (/锁定|占用/.test(status) && !/未锁定|未占用/.test(status)) return '报告已锁定/占用';
      if ((statusCode && statusCode !== norm(config.pendingStatusValue || '102501')) || /诊断中|待审核|审核中|已审核|已打印/.test(status)) return '报告状态非待诊断';
    }
    return '';
  }

  function protocolAllowsEntry(payload) {
    if (payload?.code !== 200 || protocolEntryBlockReason(payload)) return false;
    const data = payload?.data;
    const allowed = value => value === true || value === 1 || (typeof value === 'string' && ['true', '1'].includes(value.trim().toLowerCase()));
    if (typeof data !== 'object' || data === null) return allowed(data);
    if (Array.isArray(data)) return false;
    const flags = ['allow', 'allowed', 'canEnter', 'isAllow', 'success', 'pass'].filter(key => data[key] !== undefined);
    return flags.length > 0 && flags.every(key => allowed(data[key]));
  }

  async function enterDiagnosis(d) {
    if (!isAutoOpenEnabled()) {
      developerLog('观察模式跳过自动打开', { ...debugCandidate(d), source: 'entry-gate', reason: '自动打开已关闭' });
      return false;
    }
    if (entryRunning || entryDiagnosisLockActive() || !isMonitorRoute()) return false;
    if (isExcludedExam(d)) {
      d.__entryBlocked = '检查项目排除';
      developerLog('进入前硬门禁拒绝', { ...debugCandidate(d), reason: d.__entryBlocked });
      return false;
    }
    const duplicateBlock = automaticEntryBlockReason(d);
    if (duplicateBlock) {
      d.__entryBlocked = duplicateBlock;
      developerLog('进入前硬门禁拒绝', { ...debugCandidate(d), reason: duplicateBlock });
      return false;
    }
    if (d?.__entryBlocked) {
      developerLog('进入前硬门禁拒绝', { ...debugCandidate(d), reason: d.__entryBlocked });
      return false;
    }
    if (!isPendingReport(d)) {
      developerLog('进入前硬门禁拒绝', { ...debugCandidate(d), reason: shouldSkipLocked(d) ? '报告已锁定/占用' : '报告状态非待诊断' });
      return false;
    }
    entryRunning = true;
    try {
      await waitBeforeEntry();
      if (!isAutoOpenEnabled() || !isMonitorRoute() || entryDiagnosisLockActive()) return false;
      if (isExcludedExam(d)) { d.__entryBlocked = '检查项目排除'; return false; }
      if (automaticEntryBlockReason(d)) return false;
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
      return text === '待诊断' ? String(config.pendingStatusValue || REPORT_STATUS_CODES[text]) : (REPORT_STATUS_CODES[text] || text);
    }).filter(Boolean))];
  }
  function statusProbePayload() {
    // statusNum 对带 reportStatusCodeList 的请求返回 code=2002（权限/筛选组合不被服务端接受）。
    // 状态探测只需要判断全局计数变化，具体的待诊断、锁定和其它筛选继续在客户端执行。
    const payload = radiationListPayload({ pageSize: 1, ignoreStatusFilter: true, ignoreModalityFilter: true, ignoreInstitutionFilter: true, ignoreBodyPartFilter: true });
    payload.reportStatusCodeList = [];
    payload.modalityList = [];
    payload.applyOrgName = '';
    return payload;
  }
  function statusHash(data) {
    if (!data || typeof data !== 'object') return JSON.stringify(data ?? null);
    return JSON.stringify(Object.keys(data).sort().reduce((out, key) => { out[key] = data[key]; return out; }, {}));
  }
  function dataKeys(d) {
    const reportKey = automaticEntryKey(d);
    // A report UID is the identity. Sharing an application or a patient name
    // must not merge two independent checks into one handled candidate.
    return reportKey ? [reportKey] : [d?.key].filter(Boolean);
  }
  function candidatePatientName(d) {
    const explicit = norm(d?.patientName || d?.record?.patName || d?.record?.patientName);
    if (explicit) return explicit;
    return norm(d?.patient)
      .replace(/(门诊|急诊|住院|体检).*$/, '')
      .replace(/(?:男|女)?\d{1,3}岁$/, '');
  }
  const AUTOMATIC_ENTRY_PREFIX = 'jx-radiation-auto-entry-once-v1:';
  const AUTOMATIC_ENTRY_RESERVATION_MS = 30000;
  const automaticEntryCache = new Map();
  let automaticEntrySequence = 0;

  function automaticEntryKey(d) {
    if (!d) return '';
    let record = d.record;
    if (!record && d.row) {
      try { record = findRowRecord(d); if (record) d.record = record; } catch (_) {}
    }
    const repUid = record?.repUid || record?.reportUid || record?.reportId || record?.id ||
      (String(d.key || '').startsWith('rep:') ? String(d.key).slice(4) : '') ||
      d.repUid || d.recordId || d.row?.dataset?.repUid;
    const value = String(repUid || '').trim();
    return value && value.length <= 96 && !/[\u0000-\u0020\u007f]/.test(value) ? `rep:${value}` : '';
  }
  function automaticEntryStorageKey(key) { return AUTOMATIC_ENTRY_PREFIX + encodeURIComponent(key); }
  function readAutomaticEntry(key) {
    if (!key) return null;
    const storageKey = automaticEntryStorageKey(key), copies = [automaticEntryCache.get(key)];
    try { copies.push(decodeDeveloperStorage(GM_getValue(storageKey, null))); } catch (_) {}
    try { copies.push(decodeDeveloperStorage(developerLocalStorage()?.getItem(storageKey))); } catch (_) {}
    const entries = copies.filter(value => value?.schema === 1 && value.key === key &&
      ['reserved', 'consumed', 'released'].includes(value.state) && Number.isFinite(value.updatedAt));
    // A confirmed native success can never be erased by an old page releasing
    // its earlier reservation, delayed storage transport or a debug clear.
    const confirmed = entries.filter(value => value.state === 'consumed' && value.confirmed === true);
    const selected = (confirmed.length ? confirmed : entries).sort((a, b) => b.updatedAt - a.updatedAt ||
      (b.state === 'consumed' ? 1 : 0) - (a.state === 'consumed' ? 1 : 0))[0] || null;
    if (selected) automaticEntryCache.set(key, selected);
    return selected;
  }
  function writeAutomaticEntry(key, value) {
    const entry = { schema: 1, key, ...value }, storageKey = automaticEntryStorageKey(key);
    automaticEntryCache.set(key, entry);
    let durable = false;
    try { const storage = developerLocalStorage(); if (storage) { storage.setItem(storageKey, JSON.stringify(entry)); durable = true; } } catch (_) {}
    try { GM_setValue(storageKey, entry); durable = true; } catch (_) {}
    return durable;
  }
  function automaticEntryBlockReason(d) {
    const key = automaticEntryKey(d), entry = readAutomaticEntry(key);
    if (entry?.state === 'consumed' && entry.reason === 'server-locked-other') return '本检查报告已被其他用户锁定，不再自动进入';
    if (entry?.state === 'consumed') return '本检查报告已进入过，不再自动进入';
    if (entry?.state === 'reserved' && entry.expiresAt > Date.now() && entry.token !== d?.__automaticEntryToken) return '本检查报告正在进入';
    return '';
  }
  function reserveAutomaticEntry(d) {
    const key = automaticEntryKey(d);
    if (!key) return false;
    if (automaticEntryBlockReason(d)) return false;
    const current = readAutomaticEntry(key);
    if (current?.state === 'reserved' && current.token === d.__automaticEntryToken && current.expiresAt > Date.now()) return true;
    const token = `${debugWriterId}:entry:${++automaticEntrySequence}`;
    const now = Date.now();
    if (!writeAutomaticEntry(key, { state: 'reserved', token, startedAt: now, updatedAt: Math.max(now, Number(current?.updatedAt || 0) + 1), expiresAt: now + AUTOMATIC_ENTRY_RESERVATION_MS, confirmed: false })) return false;
    d.__automaticEntryToken = token;
    d.__automaticEntryKey = key;
    return readAutomaticEntry(key)?.token === token;
  }
  function consumeAutomaticEntry(d, reason, confirmed = false) {
    const key = automaticEntryKey(d);
    if (!key) return false;
    const current = readAutomaticEntry(key);
    if (current?.state === 'consumed' && current.confirmed) return true;
    if (!confirmed && current?.token !== d?.__automaticEntryToken) return false;
    const now = Date.now();
    return writeAutomaticEntry(key, { state: 'consumed', token: current?.token || d.__automaticEntryToken || '',
      startedAt: current?.startedAt || now, updatedAt: Math.max(now, Number(current?.updatedAt || 0) + 1),
      confirmed, reason, expiresAt: 0 });
  }
  function releaseAutomaticEntry(d, reason) {
    const key = d?.__automaticEntryKey || automaticEntryKey(d), current = readAutomaticEntry(key);
    if (!key || !current || current.confirmed || current.token !== d?.__automaticEntryToken || current.state === 'released') return false;
    const now = Date.now();
    return writeAutomaticEntry(key, { ...current, state: 'released', reason, updatedAt: Math.max(now, Number(current.updatedAt) + 1), expiresAt: 0 });
  }
  function restoreAutomaticEntryHistory() {
    const ownName = norm(loginIdentity().name);
    let restored = 0;
    for (const event of debugEvents) {
      const key = automaticEntryKey({ key: event.key, recordId: event.recordId, record: event.record });
      const at = Date.parse(event.at);
      if (!key || !Number.isFinite(at)) continue;
      const previous = readAutomaticEntry(key);
      if (event.event === '报告进入拒绝' && event.endpointKind === 'radiation-entry' &&
          event.requestMethod === 'POST' && /锁定|占用|其他用户/.test(norm(event.serverMessage)) &&
          !(previous?.state === 'consumed' && previous.confirmed)) {
        writeAutomaticEntry(key, { state: 'consumed', token: previous?.token || 'retained-server-lock',
          startedAt: at, updatedAt: Math.max(at, Number(previous?.updatedAt || 0) + 1), expiresAt: 0,
          confirmed: false, reason: 'server-locked-other' });
        continue;
      }
      if (event.event === '报告进入拒绝' && event.requestMethod === 'POST' &&
          previous?.reason === 'retained-entry-history' && !previous.confirmed && previous.updatedAt <= at) {
        writeAutomaticEntry(key, { ...previous, state: 'released', updatedAt: at, reason: 'retained-native-failure' });
        continue;
      }
      const automatic = ['候选进入成功', '实时推送进入成功', '诊断路由导航'].includes(event.event);
      const native = event.event === '报告进入完成' && event.finalReportLoaded === true &&
        event.requestMethod === 'POST' && event.endpointKind === 'radiation-entry' &&
        event.route === '/radiation/report' && event.responseRoute === '/radiation/report' &&
        String(event.routeReportId || '') === String(event.recordId || '') &&
        String(event.responseRouteReportId || '') === String(event.recordId || '') && ownName &&
        event.reportDoctor && accountValueMatches(ownName, norm(event.reportDoctor));
      if (!automatic && !native) continue;
      if (!key || readAutomaticEntry(key)?.confirmed) continue;
      const current = readAutomaticEntry(key);
      if (current && current.updatedAt >= at && !native) continue;
      if (writeAutomaticEntry(key, { state: 'consumed', token: 'retained-entry-history',
        startedAt: at, updatedAt: at, expiresAt: 0, confirmed: !!native, reason: 'retained-entry-history' })) restored++;
    }
    if (restored) developerLog('已恢复进入一次记录', { count: restored, source: 'retained-local-history' }, { force: true });
  }
  function dataSeen(d) {
    const key = automaticEntryKey(d);
    return key ? !!automaticEntryBlockReason(d) : dataKeys(d).some(value => seen.has(value));
  }
  function rememberData(d) {
    for (const key of dataKeys(d)) seen.set(key, Date.now());
    while (seen.size > Number(config.seenLimit || 500)) seen.delete(seen.keys().next().value);
  }

  function lifecycleKey(d) {
    const recordId = d?.record?.repUid || d?.record?.reportUid || d?.record?.reportId || d?.record?.id;
    if (recordId != null && String(recordId)) return `rep:${String(recordId)}`;
    return dataKeys(d)[0] || debugTag(d);
  }

  function lifecycleSnapshot(d) {
    return {
      status: norm(d?.status || d?.record?.reportStatus || d?.record?.reportStatusName || d?.record?.checkStatusName),
      statusCode: norm(d?.statusCode || d?.record?.reportStatusCode || d?.record?.checkStatusCode || d?.record?.statusCode),
      locked: lockedRecordDetected(d),
      doctor: norm(d?.doctor || d?.diagnosisDoctor || d?.record?.reportDoc),
      recordId: d?.record?.repUid || d?.record?.reportUid || d?.record?.reportId || d?.record?.id || '',
      applicationNo: norm(d?.applicationNo),
      applyTime: norm(d?.applyTime)
    };
  }

  function lifecycleDebug(state) {
    if (!state) return {};
    return {
      lifecycleKey: state.key,
      firstSeenAt: new Date(state.firstSeenAt).toISOString(),
      lastSeenAt: new Date(state.lastSeenAt).toISOString(),
      firstSource: state.firstSource,
      lastSource: state.lastSource,
      firstToLastMs: Math.max(0, state.lastSeenAt - state.firstSeenAt),
      eligibleAt: state.eligibleAt ? new Date(state.eligibleAt).toISOString() : '',
      firstEligibleAt: state.everEligibleAt ? new Date(state.everEligibleAt).toISOString() : '',
      eligibleWaitMs: state.everEligibleAt ? Math.max(0, state.lastSeenAt - state.everEligibleAt) : null,
      currentlyEligible: !!state.eligibleAt,
      lastStage: state.lastStage || '',
      attemptCount: state.attemptCount || 0
    };
  }

  function pruneCandidateLifecycle(now = Date.now()) {
    const cutoff = now - developerRetentionMs();
    for (const [key, state] of candidateLifecycle) {
      if (!state || state.lastSeenAt < cutoff) candidateLifecycle.delete(key);
    }
    while (candidateLifecycle.size > Number(config.seenLimit || 500)) candidateLifecycle.delete(candidateLifecycle.keys().next().value);
  }

  function observeCandidateLifecycle(d, source, meta = {}) {
    const key = lifecycleKey(d);
    if (!key) return null;
    const now = Date.now();
    pruneCandidateLifecycle(now);
    const current = lifecycleSnapshot(d);
    const failedRules = Array.isArray(meta.failedRules) ? meta.failedRules : matchFailureReasons(d);
    const eligible = meta.eligible === true || (!failedRules.length && !shouldSkipLocked(d));
    let state = candidateLifecycle.get(key);
    if (!state) {
      state = {
        key,
        firstSeenAt: now,
        lastSeenAt: now,
        firstSource: source,
        lastSource: source,
        eligibleAt: eligible ? now : 0,
        everEligibleAt: eligible ? now : 0,
        lastStage: meta.stage || 'observed',
        attemptCount: 0,
        snapshot: current,
        data: d,
        lastSnapshotSequence: meta.snapshotSequence || 0
      };
      candidateLifecycle.set(key, state);
      developerLog('候选首次观察', {
        ...debugCandidate(d, { source, lifecycle: lifecycleDebug(state), failedRules }),
        reason: eligible ? '当前规则通过' : '当前规则未通过'
      }, { force: true });
      return state;
    }

    const previous = state.snapshot || {};
    const previousData = state.data;
    const statusChanged = previous.status !== current.status || previous.statusCode !== current.statusCode;
    const lockChanged = previous.locked !== current.locked;
    const doctorChanged = previous.doctor !== current.doctor;
    state.lastSeenAt = now;
    state.lastSource = source;
    state.lastStage = meta.stage || state.lastStage || 'observed';
    state.snapshot = current;
    state.data = d;
    state.lastSnapshotSequence = meta.snapshotSequence || state.lastSnapshotSequence || 0;
    if (!state.eligibleAt && eligible) state.eligibleAt = now;
    if (!state.everEligibleAt && eligible) state.everEligibleAt = now;
    if (meta.attempted) state.attemptCount = Number(state.attemptCount || 0) + 1;

    const becameOccupied = (statusChanged || lockChanged || doctorChanged) &&
      (current.locked || /诊断中|待审核|审核中|占用|锁定/.test(current.status) || !!current.doctor) &&
      (state.everEligibleAt || meta.previousEligible);
    if (becameOccupied) {
      developerLog('候选被其他用户占用', {
        source,
        reason: current.locked || /锁定|占用/.test(current.status) ? '锁定或占用状态' : '状态变为诊断中/已有诊断医生',
        previous: debugCandidate(previousData, { source: state.firstSource, lifecycle: lifecycleDebug(state) }),
        current: debugCandidate(d, { source, lifecycle: lifecycleDebug(state) }),
        transition: { statusChanged, lockChanged, doctorChanged }
      }, { force: true });
    } else if (statusChanged || lockChanged || doctorChanged) {
      developerLog('候选状态变化', {
        source,
        previous: debugCandidate(previousData, { source: state.firstSource, lifecycle: lifecycleDebug(state) }),
        current: debugCandidate(d, { source, lifecycle: lifecycleDebug(state) }),
        transition: { statusChanged, lockChanged, doctorChanged }
      }, { force: true });
    }
    return state;
  }

  function reconcileCandidateSnapshot(records, source, snapshotSequence, options = {}) {
    const now = Date.now();
    const currentKeys = new Set((records || []).map(record => lifecycleKey(recordData(record))).filter(Boolean));
    // 只有完整的常规列表才记录“本次响应中未出现”。窄列表、WebSocket 线索
    // 和分页结果不能据此断定客户已被别人抢先进入，避免制造误诊日志。
    if (!options.complete) return;
    for (const state of candidateLifecycle.values()) {
      if (state.lastSnapshotSequence === snapshotSequence || !state.eligibleAt || currentKeys.has(state.key)) continue;
      if (now - state.lastSeenAt > developerRetentionMs()) continue;
      const disappearedAt = now;
      developerLog('候选未在后续列表出现', {
        source,
        reason: '之前符合规则的候选未出现在本次完整响应，可能已被其它用户进入或离开当前筛选窗口',
        lifecycle: lifecycleDebug({ ...state, lastSeenAt: disappearedAt }),
        previous: debugCandidate(state.data, { source: state.lastSource }),
        elapsedSinceLastSeenMs: Math.max(0, disappearedAt - state.lastSeenAt),
        snapshotCount: Array.isArray(records) ? records.length : 0
      }, { force: true });
      // 同一候选在下一次完整列表中仍缺失时，不重复写入告警；等它重新出现后
      // 由状态变化/重新观察建立新的可解释时间线。
      state.eligibleAt = 0;
      state.lastSnapshotSequence = snapshotSequence;
    }
  }

  async function processRemoteRecords(records, options = {}) {
    if (config.entryMode === 'click') return false;
    const snapshotSequence = ++candidateSnapshotSequence;
    developerLog('列表候选处理', { source: 'remote-list', count: Array.isArray(records) ? records.length : 0, snapshotSequence });
    const orderedRecords = [...(records || [])].map(record => ({ record, data: recordData(record) })).filter(x => x.data).sort((a, b) => candidatePriority(b.data) - candidatePriority(a.data));
    for (const { record, data: prebuilt } of orderedRecords) {
      const d = prebuilt;
      if (!d) {
        developerLog('候选无效', { source: 'remote-list', reason: '无法解析记录' });
        continue;
      }
      const reasons = matchFailureReasons(d);
      const lifecycle = observeCandidateLifecycle(d, 'remote-list', { failedRules: reasons, eligible: !reasons.length, snapshotSequence, stage: 'listed' });
      if (dataSeen(d)) {
        developerLog('候选跳过', { ...debugCandidate(d, { source: 'remote-list', lifecycle: lifecycleDebug(lifecycle) }), reason: '已处理' });
        continue;
      }
      if (reasons.length) {
        developerLog('候选过滤', { ...debugCandidate(d, { source: 'remote-list', lifecycle: lifecycleDebug(lifecycle) }), reason: '规则不匹配', failedRules: reasons });
        continue;
      }
      developerLog('候选命中', { ...debugCandidate(d, { source: 'remote-list', lifecycle: lifecycleDebug(lifecycle) }), reason: '规则通过' });
      if (!isAutoOpenEnabled()) {
        developerLog('观察模式跳过自动打开', { ...debugCandidate(d, { source: 'remote-list', lifecycle: lifecycleDebug(lifecycle) }), reason: '自动打开已关闭' });
        continue;
      }
      if (entryDiagnosisLockActive()) {
        developerLog('候选等待进入', { ...debugCandidate(d, { source: 'remote-list', lifecycle: lifecycleDebug(lifecycle) }), reason: '已有客户处于诊断中，仅继续刷新列表', waitMs: lifecycle?.eligibleAt ? Date.now() - lifecycle.eligibleAt : null });
        continue;
      }
      if (lifecycle) lifecycle.lastStage = 'entry-attempt';
      if (!await enterDiagnosis(d)) {
        if (lifecycle) lifecycle.attemptCount = Number(lifecycle.attemptCount || 0) + 1;
        developerLog('候选进入失败', { ...debugCandidate(d, { source: 'remote-list', lifecycle: lifecycleDebug(lifecycle) }), reason: '协议和页面入口均未成功', waitMs: lifecycle?.eligibleAt ? Date.now() - lifecycle.eligibleAt : null });
        continue;
      }
      rememberData(d);
      console.info('[自动诊断] 轻量探测命中，协议进入诊断：', { exam: d.exam, modality: d.modality });
      await new Promise(resolve => setTimeout(resolve, Number(config.clickDelayMs) || 0));
      return true;
    }
    reconcileCandidateSnapshot(records, 'remote-list', snapshotSequence, { complete: options.complete === true });
    return false;
  }
  async function refreshRemoteCandidates(options = {}) {
    // 诊断锁只禁止再次进入客户，不暂停列表读取。诊断页右侧仍可能显示待诊断列表，
    // 因此协议列表和实时线索继续运行，由 enterDiagnosis() 统一挡住第二次进入。
    if (!isMonitorRoute()) return false;
    const now = Date.now();
    const force = options.force === true;
    const match = options.match && typeof options.match === 'object' ? options.match : null;
    const normalCooldown = Math.max(10000, Number(config.listHeartbeatMs) || 15000);
    const cooldown = force ? 500 : normalCooldown;
    if (listRefreshRunning || now - lastListFetchAt < cooldown) {
      // 保留 WebSocket 携带的精确线索，待当前请求结束或冷却结束后再按该线索取列表。
      if (force || match) queueRealtimeRefresh({ match, hintAt: options.hintAt });
      developerLog('列表请求排队', { source: options.reason || 'list', reason: listRefreshRunning ? '已有请求进行中' : '冷却保护', waitMs: Math.max(0, cooldown - (now - lastListFetchAt)), narrow: !!match, candidateTag: debugTag(match), diagnosisActive, entryRunning });
      return false;
    }
    listRefreshRunning = true;
    lastListFetchAt = now;
    try {
      if (options.hintAt) {
        developerLog('实时列表请求发起', {
          source: options.reason || 'list',
          dispatchDelayMs: Math.max(0, now - Number(options.hintAt) || 0),
          withinOneSecond: now - Number(options.hintAt) <= 1000,
          phase: 'scheduler-start', networkSent: false,
          candidateTag: debugTag(match),
          diagnosisActive,
          entryRunning
        });
      }
      // 有精确线索时缩小请求范围；没有线索才取常规的最近列表。
      const records = await fetchRadiationRecords({ match, pageSize: match ? 20 : 30, timeoutMs: 5000, reason: options.reason || 'list', hintAt: options.hintAt });
      return await processRemoteRecords(records, { complete: !match && options.complete !== false });
    } finally {
      listRefreshRunning = false;
      scheduleQueuedRealtimeRefresh();
    }
  }
  async function probeStatus() {
    // 协议探测不依赖表格 DOM，隐藏标签页也继续工作；浏览器冻结页面时则由 WebSocket
    // 消息在恢复后补上。DOM 扫描仍由 scan() 自己限制为前台执行。
    if (!isMonitoringEnabled() || config.entryMode === 'click' || probeRunning || !isMonitorRoute()) return;
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
      developerLog('状态探测结果', { ok: true, changed, heartbeatDue, durationMs: Date.now() - startedAt });
      if (changed || heartbeatDue) await refreshRemoteCandidates({ reason: changed ? 'status-change' : 'heartbeat' });
    } catch (e) {
      statusProbeFailures = Math.min(statusProbeFailures + 1, 4);
      console.debug('[自动诊断] 轻量状态探测失败，稍后退避重试', String(e));
      developerLog('状态探测失败', { ok: false, error: debugError(e), failureCount: statusProbeFailures, durationMs: Date.now() - startedAt });
      scheduleAutoQueryFallback();
    } finally {
      probeRunning = false;
    }
  }
  function probeBaseMs() {
    const configured = Math.max(3000, Number(config.statusProbeMs) || 5000);
    // WebSocket 最近有业务提示时，计数请求只做较低频健康兜底；长时间无提示再恢复配置频率。
    if (lastRealtimeHintAt && Date.now() - lastRealtimeHintAt < 60000) return Math.max(15000, configured);
    // 隐藏标签页只做低频计数兜底，实时性由同一条 WebSocket 连接负责，避免后台高频完整列表请求。
    return document.visibilityState === 'hidden' ? Math.max(15000, configured) : configured;
  }
  function nextProbeDelay() {
    const base = probeBaseMs();
    if (statusProbeFailures) return Math.min(60000, base * (2 ** statusProbeFailures));
    return Math.round(base * (0.85 + Math.random() * 0.3));
  }
  function scheduleProbe(delay = 0) {
    if (probeTimer) clearTimeout(probeTimer);
    if (!isMonitoringEnabled()) return;
    probeTimer = setTimeout(async () => {
      await probeStatus();
      scheduleProbe(nextProbeDelay());
    }, Math.max(0, Number(delay) || 0));
  }

  function clearRealtimeRefreshQueue() {
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = null;
    queuedRealtimeMatch = null;
    queuedRealtimeHintAt = 0;
    queuedRealtimeReadyAt = 0;
  }

  function scheduleQueuedRealtimeRefresh() {
    if (!queuedRealtimeHintAt) return;
    if (!isMonitoringEnabled() || config.entryMode === 'click' || !config.realtimeHints || !isMonitorRoute() || !accountAllowed()) {
      clearRealtimeRefreshQueue();
      return;
    }
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = null;
    // 请求进行中不轮询等待；其 finally 会唤醒已合并的线索。
    if (listRefreshRunning) return;
    const now = Date.now();
    const delay = Math.max(0, queuedRealtimeReadyAt - now, 500 - (now - lastListFetchAt));
    developerLog('实时列表调度', { source: 'websocket', delayMs: delay, narrow: !!queuedRealtimeMatch });
    const scheduledTimer = setTimeout(async () => {
      if (realtimeRefreshTimer !== scheduledTimer) return;
      realtimeRefreshTimer = null;
      if (!queuedRealtimeHintAt) return;
      if (!isMonitoringEnabled() || config.entryMode === 'click' || !config.realtimeHints || !isMonitorRoute() || !accountAllowed()) {
        clearRealtimeRefreshQueue();
        return;
      }
      if (listRefreshRunning || Date.now() < queuedRealtimeReadyAt || Date.now() - lastListFetchAt < 500) {
        scheduleQueuedRealtimeRefresh();
        return;
      }
      const match = queuedRealtimeMatch;
      const hintAt = queuedRealtimeHintAt;
      clearRealtimeRefreshQueue();
      lastRealtimeRefreshAt = Date.now();
      try {
        await refreshRemoteCandidates({ force: true, reason: 'websocket-hint', match, hintAt });
      } catch (e) {
        // 已尝试的线索不因异常自动重试；只有新的推送才会再排队。
        developerLog('实时列表刷新异常', { source: 'websocket', error: debugError(e), hintAt });
      }
    }, delay);
    realtimeRefreshTimer = scheduledTimer;
  }

  function queueRealtimeRefresh(options = {}) {
    if (!isMonitoringEnabled() || config.entryMode === 'click' || !config.realtimeHints || !isMonitorRoute() || !accountAllowed()) {
      clearRealtimeRefreshQueue();
      return;
    }
    if (options.match && typeof options.match === 'object') queuedRealtimeMatch = options.match;
    if (!queuedRealtimeHintAt) {
      const hintAt = Number(options.hintAt);
      queuedRealtimeHintAt = Number.isFinite(hintAt) && hintAt > 0 ? hintAt : Date.now();
      // 空闲首条提示立即调度；频繁提示沿用上次调度后的短合并窗口。
      // 后续推送不会延长窗口或覆盖首次收到提示的时间。
      const minGap = 250;
      queuedRealtimeReadyAt = Math.max(Date.now(), lastRealtimeRefreshAt + minGap);
    }
    scheduleQueuedRealtimeRefresh();
  }

  async function processRealtimeHint(hint) {
    if (!isMonitoringEnabled() || config.entryMode === 'click' || !config.realtimeHints || !isMonitorRoute()) return;
    if (!accountAllowed()) return;
    if (!hint || typeof hint !== 'object') {
      queueRealtimeRefresh({ hintAt: Date.now() });
      return;
    }
    lastRealtimeHintAt = Date.now();
    const rawRecord = hint.record && typeof hint.record === 'object'
      ? { ...hint.record, ...(hint.repUid ? { repUid: hint.record.repUid || hint.repUid } : {}) }
      : hint;
    const d = recordData(rawRecord);
    const recordId = d?.record?.repUid || d?.record?.reportUid || d?.record?.reportId || d?.record?.id || '';
    const hasIdentity = !!(d && (recordId || d.applicationNo || d.patient || d.applyTime || d.exam));
    developerLog('实时推送收到', { ...debugCandidate(d), source: 'websocket', hasIdentity, hasRecordId: !!recordId });
    if (!hasIdentity) {
      developerLog('实时推送降级', { source: 'websocket', reason: '线索字段不足' });
      queueRealtimeRefresh({ hintAt: lastRealtimeHintAt });
      return;
    }
    let entered = false;
    if (!realtimeRecordRunning) {
      realtimeRecordRunning = true;
      try {
        const seenAlready = !!d && dataSeen(d);
        const statusUnknown = !!recordId && d && !norm(
          d.status || d.statusCode || d.record?.reportStatus || d.record?.reportStatusName ||
          d.record?.reportStatusCode || d.record?.checkStatusName || d.record?.checkStatusCode
        );
        // WebSocket 的 reportInfo 线索经常只有 repUid、姓名、年龄和检查名称，
        // modality/报告状态会在随后列表接口中补全。不能在补全前把它当作
        // “检查类型不匹配”直接淘汰，否则窄列表稍有延迟就会丢掉实时候选。
        const modalityUnknown = !!recordId && d && !norm(
          d.modality || d.record?.modality || d.record?.checkModality || d.record?.patSource
        );
        const examUnknown = !!recordId && d && !norm(
          d.exam || d.examName || d.record?.examName || d.record?.exam
        );
        const failedRules = d ? matchFailureReasons(d).filter(reason =>
          (!statusUnknown || !['报告状态非待诊断', '报告状态'].includes(reason)) &&
          (!modalityUnknown || reason !== '检查类型') &&
          (!examUnknown || reason !== '检查项目')
        ) : [];
        const lifecycle = d ? observeCandidateLifecycle(d, 'websocket', {
          failedRules,
          eligible: !failedRules.length && !shouldSkipLocked(d),
          stage: 'websocket',
          snapshotSequence: candidateSnapshotSequence
        }) : null;
        if (statusUnknown) d.__realtimeNeedsServerStatus = true;
        if (modalityUnknown || examUnknown) d.__realtimeNeedsServerEnrichment = true;
        if (seenAlready) developerLog('候选跳过', { ...debugCandidate(d, { source: 'websocket', lifecycle: lifecycleDebug(lifecycle) }), reason: '已处理' });
        else if (d && failedRules.length) developerLog('候选过滤', { ...debugCandidate(d, { source: 'websocket', lifecycle: lifecycleDebug(lifecycle) }), reason: '规则不匹配', failedRules });
        else if (d && !recordId) developerLog('实时推送降级', { ...debugCandidate(d, { source: 'websocket' }), reason: '线索没有记录编号' });
        let entrySkippedByObservation = false;
        const needsServerEnrichment = !!(d && (d.__realtimeNeedsServerStatus || d.__realtimeNeedsServerEnrichment));
        if (d && !seenAlready && !failedRules.length && recordId && !needsServerEnrichment) {
          developerLog(isAutoOpenEnabled() ? '实时推送直接协议校验' : '实时推送候选观察', { ...debugCandidate(d, { source: 'websocket', lifecycle: lifecycleDebug(lifecycle) }), serverStatusCheck: statusUnknown, autoOpenEnabled: isAutoOpenEnabled() });
          if (!isAutoOpenEnabled()) {
            entrySkippedByObservation = true;
            developerLog('观察模式跳过自动打开', { ...debugCandidate(d, { source: 'websocket', lifecycle: lifecycleDebug(lifecycle) }), reason: '自动打开已关闭' });
          } else if (entryDiagnosisLockActive()) {
            developerLog('候选等待进入', { ...debugCandidate(d, { source: 'websocket', lifecycle: lifecycleDebug(lifecycle) }), reason: '已有客户处于诊断中，仅保留列表刷新', waitMs: lifecycle?.eligibleAt ? Date.now() - lifecycle.eligibleAt : null });
          } else {
            if (lifecycle) lifecycle.lastStage = 'entry-attempt';
            entered = await enterDiagnosis(d);
          }
          if (entered) rememberData(d);
          else if (!entrySkippedByObservation) {
            if (lifecycle) lifecycle.attemptCount = Number(lifecycle.attemptCount || 0) + 1;
            developerLog('候选进入失败', { ...debugCandidate(d, { source: 'websocket', lifecycle: lifecycleDebug(lifecycle) }), reason: '协议入口失败，等待窄列表兜底', waitMs: lifecycle?.eligibleAt ? Date.now() - lifecycle.eligibleAt : null });
          }
        } else if (d && !seenAlready && !failedRules.length && recordId && needsServerEnrichment) {
          developerLog('实时推送等待协议补全', {
            ...debugCandidate(d, { source: 'websocket', lifecycle: lifecycleDebug(lifecycle) }),
            reason: '线索缺少检查类型或报告状态，先取窄列表再判定',
            statusUnknown,
            modalityUnknown,
            examUnknown
          });
        }
      } catch (e) {
        console.debug('[自动诊断] 实时提示处理失败，转入列表兜底', String(e));
        developerLog('实时推送处理异常', { ...debugCandidate(d), source: 'websocket', error: debugError(e) });
      } finally {
        realtimeRecordRunning = false;
      }
    }
    // 推送消息没有完整记录或协议进入失败时，按该条线索取一次窄列表，
    // 不再从第一页的全量候选中盲目扫描。
    if (!entered) queueRealtimeRefresh({ match: d, hintAt: lastRealtimeHintAt });
    else developerLog('实时推送进入成功', { ...debugCandidate(d), source: 'websocket' });
  }

  // 初次进入提前取得一次并交接完整响应；确认载入后，原生报告刷新照常请求。
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
      try { ticket.abortCleanup?.(); } catch (_) {}
      ticket.abortCleanup = null;
    };
    const lookup = (body, requestHeaders = null) => {
      const payload = canonical(body), identity = session();
      if (!payload || !identity || reportId() !== payload.repUid) return null;
      const ticket = tickets.get(`${identity.key}|${payload.key}`);
      if (!ticket) return null;
      // The initial native load was acknowledged for this report/session.
      // Later native refreshes (including after terminal review) are live requests.
      if (ticket.state === 'loaded') return null;
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
    const synthesize = (xhr, meta, response, ticket = null) => {
      const state = { phase: 1, response, ticket, cancelled: false, failed: !response, timer: null, json: null };
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
        if (!state.cancelled) {
          event(xhr, 'loadend', response.bytes);
          if (!state.cancelled && ticket?.state === 'consumed') ticket.deliveryCompleted = true;
        }
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
        synthesize(this, meta, supported ? consume(ticket) : null, ticket);
        return undefined;
      },
      abort: function () {
        const state = requests.get(this)?.synthetic;
        if (!state) return native.abort.apply(this, arguments);
        const active = !state.cancelled && state.phase > 0 && state.phase < 4;
        state.cancelled = true; state.failed = true; state.response = null; state.json = null;
        if (state.ticket?.state === 'consumed') state.ticket.deliveryCompleted = false;
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
      const revokeDelivery = () => {
        if (ticket.state !== 'consumed') return;
        ticket.deliveryCompleted = false;
        erase(ticket);
      };
      if (typeof signal?.addEventListener === 'function') {
        ticket.abortCleanup = () => signal.removeEventListener('abort', revokeDelivery);
        signal.addEventListener('abort', revokeDelivery, { once: true });
      }
      // Construction can synchronously abort the signal before the listener
      // is attached. An abort before loaded acknowledgement remains fail closed.
      if (signal?.aborted) {
        revokeDelivery();
        return Promise.reject(new page.DOMException('Request aborted', 'AbortError'));
      }
      if (ticket.state === 'consumed') ticket.deliveryCompleted = true;
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
          const ticket = { id: `entry-handoff:${Date.now()}:${++serial}`, key, repUid: payload.repUid, sessionKey: identity.key, auth: identity.auth, text: responseText, bytes, status: response.status, statusText: response.statusText || (response.status === 200 ? 'OK' : ''), headers: responseHeaders, url: new URL(endpoint, page.location.href).href, state: 'pending', deliveryCompleted: false, expiresAt: Date.now() + Math.max(1, Math.min(15000, Number(ttl) || 15000)), timer: null };
          ticket.timer = page.setTimeout(() => { if (ticket.state === 'pending') ticket.state = 'expired'; erase(ticket); }, ticket.expiresAt - Date.now());
          tickets.set(key, ticket); return ticket.id;
        } catch (_) { return false; }
      },
      confirmLoaded: repUid => {
        const identity = session();
        if (!identity || typeof repUid !== 'string' || !repUid || reportId() !== repUid) return false;
        let confirmed = false;
        for (const ticket of tickets.values()) {
          if (ticket.sessionKey === identity.key && ticket.repUid === repUid && ticket.state === 'consumed' && ticket.deliveryCompleted === true) {
            ticket.state = 'loaded'; erase(ticket); confirmed = true;
          }
        }
        return confirmed;
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
      } else if (currentAccountName && record.requestMethod === 'POST' && record.responseRepUid === repUid) {
        try { pageWindow().__JX_PROTOCOL_ENTRY_HANDOFF__?.confirmLoaded?.(repUid); } catch (_) {}
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
  async function scan() {
    if (!isMonitoringEnabled() || running || document.visibilityState === 'hidden') return;
    if (!accountAllowed()) return;
    running = true;
    try {
      const rows = queryBodyRows().map(rowData);
      for (const d of rows) {
        const reasons = matchFailureReasons(d);
        const lifecycle = observeCandidateLifecycle(d, 'dom', {
          failedRules: reasons,
          eligible: !reasons.length,
          stage: 'dom'
        });
        if (config.developerMode && d.row) {
          const operator = diagnoseOperator(d.row);
          developerLog('页面行状态', {
            ...debugCandidate(d, { source: 'dom', lifecycle: lifecycleDebug(lifecycle), reason: reasons[0] || '规则通过' }),
            diagnoseEntryFound: !!operator,
            diagnoseEntryDisabled: !!operator && operatorDisabled(operator),
            operatorCount: d.row.querySelectorAll(config.selectors.operatorItems).length
          });
        }
        if (dataSeen(d)) {
          developerLog('候选跳过', { ...debugCandidate(d, { source: 'dom', lifecycle: lifecycleDebug(lifecycle) }), reason: '已处理' });
          continue;
        }
        if (reasons.length) {
          developerLog('候选过滤', { ...debugCandidate(d, { source: 'dom', lifecycle: lifecycleDebug(lifecycle) }), reason: '规则不匹配', failedRules: reasons });
          continue;
        }
        developerLog('候选命中', { ...debugCandidate(d, { source: 'dom', lifecycle: lifecycleDebug(lifecycle) }), reason: '规则通过' });
        if (!isAutoOpenEnabled()) {
          developerLog('观察模式跳过自动打开', { ...debugCandidate(d, { source: 'dom', lifecycle: lifecycleDebug(lifecycle) }), reason: '自动打开已关闭' });
          continue;
        }
        if (entryDiagnosisLockActive()) {
          developerLog('候选等待进入', { ...debugCandidate(d, { source: 'dom', lifecycle: lifecycleDebug(lifecycle) }), reason: '已有客户处于诊断中，仅继续观察列表', waitMs: lifecycle?.eligibleAt ? Date.now() - lifecycle.eligibleAt : null });
          continue;
        }
        // 只有真正找到可点击的诊断入口后才记入 seen；按钮暂时禁用时下一轮继续尝试。
        if (lifecycle) lifecycle.lastStage = 'entry-attempt';
        if (!await enterDiagnosis(d)) {
          if (lifecycle) lifecycle.attemptCount = Number(lifecycle.attemptCount || 0) + 1;
          developerLog('候选进入失败', { ...debugCandidate(d, { source: 'dom', lifecycle: lifecycleDebug(lifecycle) }), reason: '协议和页面入口均未成功', waitMs: lifecycle?.eligibleAt ? Date.now() - lifecycle.eligibleAt : null });
          continue;
        }
        rememberData(d);
        console.info('[自动诊断] 命中过滤规则，打开诊断：', { age: d.age, gender: d.gender, exam: d.exam, modality: d.modality });
        developerLog('候选进入成功', { ...debugCandidate(d, { source: 'dom' }) });
        await new Promise(r => setTimeout(r, Number(config.clickDelayMs) || 700));
        // 一次只打开一个，等待页面完成诊断跳转后下一轮再处理。
        break;
      }
    } catch (e) {
      console.error('[自动诊断] 扫描失败', e);
    } finally { running = false; }
  }

  function queryButton() {
    return [...document.querySelectorAll('button')].find(button => norm(button.innerText || button.textContent) === '查询' && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  }

  async function refreshPageListOnFocus(options = {}) {
    const automatic = options.automatic === true;
    if (!config.pageQueryRefresh) {
      developerLog('页面查询跳过', { source: 'protocol-only', reason: '协议模式不触碰页面查询控件' });
      return false;
    }
    if (!isMonitoringEnabled() || pageQueryRunning || (!automatic && document.visibilityState !== 'visible') || pageWindow().location.pathname !== '/radiation') return false;
    if (!accountAllowed() || Date.now() - lastPageQueryAt < 5000) return false;
    if (automatic && Date.now() - lastPageQueryAt < 15000) return false;
    const button = queryButton();
    if (!button) return false;
    pageQueryRunning = true;
    lastPageQueryAt = Date.now();
    const startedAt = Date.now();
    developerLog('页面查询开始', { source: automatic ? 'protocol-fallback' : 'focus' });
    try {
      button.click();
      await new Promise(resolve => setTimeout(resolve, 300));
      developerLog('页面查询完成', { source: automatic ? 'protocol-fallback' : 'focus', durationMs: Date.now() - startedAt });
      return true;
    } finally {
      pageQueryRunning = false;
    }
  }

  function scheduleAutoQueryFallback() {
    if (!isMonitoringEnabled() || config.entryMode === 'click' || !config.realtimeHints || !isMonitorRoute()) return;
    if (!config.pageQueryRefresh) return;
    if (document.visibilityState === 'visible' && lastRealtimeHintAt && Date.now() - lastRealtimeHintAt < 60000) return;
    if (autoQueryFallbackTimer || Date.now() - lastPageQueryAt < 15000) return;
    autoQueryFallbackTimer = setTimeout(async () => {
      autoQueryFallbackTimer = null;
      if (statusProbeFailures < 2 || (lastRealtimeHintAt && Date.now() - lastRealtimeHintAt < 60000)) return;
      const refreshed = await refreshPageListOnFocus({ automatic: true });
      developerLog('协议兜底查询', { source: 'protocol-fallback', refreshed, failureCount: statusProbeFailures });
    }, 15000);
  }

  function schedulePageQueryHeartbeat(delay) {
    if (pageQueryHeartbeatTimer) clearTimeout(pageQueryHeartbeatTimer);
    if (!isMonitoringEnabled() || config.entryMode === 'click' || !config.pageQueryRefresh || !isListRoute()) return;
    const interval = Math.max(15000, Number(config.listHeartbeatMs) || 15000);
    pageQueryHeartbeatTimer = setTimeout(async () => {
      pageQueryHeartbeatTimer = null;
      if (isMonitoringEnabled() && config.entryMode !== 'click' && isListRoute()) {
        const stale = Date.now() - lastPageQueryAt >= interval;
        // 实时提示刚到达时让 WebSocket 处理链路先完成；超过一个刷新周期仍无提示，
        // 自动查询一次页面，避免列表长期停留在旧结果。
        const websocketQuiet = !lastRealtimeHintAt || Date.now() - lastRealtimeHintAt >= 15000;
        if (stale && websocketQuiet) {
          const refreshed = await refreshPageListOnFocus({ automatic: true });
          developerLog('自动查询心跳', { source: 'page-query-heartbeat', refreshed, intervalMs: interval });
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

  function start(options = {}) {
    if (!isMonitorRoute()) return;
    developerLog('运行版本', { source: 'runtime-start', version: SCRIPT_VERSION }, { force: true });
    // 提前准备一次客户端地址；共享 Promise 和失败退避保证反复 start 不重复等待。
    void ensureClientIp().catch(() => {});
    // 首次启动可以清空旧锁；从诊断页/设置页返回列表时保留锁，
    // 等列表行真正出现后由 entryDiagnosisLockActive 判断是否释放，
    // 防止表格尚未渲染时抢先进入第二位客户。
    const preserveDiagnosisLock = options.preserveDiagnosisLock ?? pageWindow().location.pathname === '/radiation/report';
    if (!preserveDiagnosisLock) diagnosisActive = false;
    if (timer) clearInterval(timer);
    if (probeTimer) clearTimeout(probeTimer);
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    if (autoQueryFallbackTimer) clearTimeout(autoQueryFallbackTimer);
    if (pageQueryHeartbeatTimer) clearTimeout(pageQueryHeartbeatTimer);
    scheduleAutoEntryScheduleExpiry();
    lastStatusHash = '';
    statusProbeFailures = 0;
    lastRealtimeHintAt = 0;
    queuedRealtimeMatch = null;
    queuedRealtimeHintAt = 0;
    developerLog('配置门禁快照', {
      source: 'runtime-start',
      autoOpenEnabled: isAutoOpenEnabled(),
      autoEntrySchedule: {
        slot: config.autoEntrySchedule?.slot || '',
        date: config.autoEntrySchedule?.date || '',
        state: autoEntryScheduleState().requiresSelection ? 'requires-selection' : autoEntryScheduleState().configured ? (autoEntryScheduleState().active ? 'active' : autoEntryScheduleState().pending ? 'pending' : 'expired') : 'unlimited'
      },
      monitoringEnabled: isMonitoringEnabled(),
      observationOnly: isMonitoringEnabled() && !isAutoOpenEnabled(),
      encounterUnlimited: !(config.encounterTypes || []).length,
      ageUnlimited: !!config.age?.unlimited || (config.age?.min == null && config.age?.max == null),
      modalityUnlimited: !(config.modalities || []).length,
      examUnlimited: !(config.examNames || []).length && !(config.examNamesExtra || []).length,
      institutionUnlimited: !(config.applyInstitution || []).length,
      encounterTypes: [...(config.encounterTypes || [])],
      modalities: [...(config.modalities || [])],
      examNames: [...(config.examNames || []), ...(config.examNamesExtra || [])],
      examNamesExcluded: [...(config.examNamesExcluded || [])],
      examExcludedCount: (config.examNamesExcluded || []).length,
      applyInstitution: [...(config.applyInstitution || [])],
      age: { min: config.age?.min ?? null, max: config.age?.max ?? null, unlimited: !!config.age?.unlimited },
      applicationTimeMode: config.applicationTime?.mode || 'all',
      applicationTime: { minMinutes: config.applicationTime?.minMinutes ?? null, maxMinutes: config.applicationTime?.maxMinutes ?? null, days: config.applicationTime?.days ?? null, start: config.applicationTime?.start || '' },
      checkOrgId: debugCredentialShape(currentCheckOrgId()),
      reportStatusCount: (config.reportStatuses || []).length,
      skipLockedRecords: true,
      lockedRecordPolicy: '已锁定/占用报告始终禁止自动进入'
    }, { force: true });
    // 先以当前页面表格为基线，避免打开脚本时因为“不限时间”一次性抢走旧记录。
    lastListFetchAt = Date.now();
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

  function stopRuntime(reason = 'route-change') {
    if (timer) { clearInterval(timer); timer = null; }
    if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
    if (realtimeRefreshTimer) { clearTimeout(realtimeRefreshTimer); realtimeRefreshTimer = null; }
    if (autoQueryFallbackTimer) { clearTimeout(autoQueryFallbackTimer); autoQueryFallbackTimer = null; }
    if (pageQueryHeartbeatTimer) { clearTimeout(pageQueryHeartbeatTimer); pageQueryHeartbeatTimer = null; }
    if (headerObserver) { headerObserver.disconnect(); headerObserver = null; }
    running = false; entryRunning = false; probeRunning = false; pageQueryRunning = false;
    // 路由切换期间可能有旧的列表/推送 Promise 尚未完成；清掉运行门闩，
    // 让返回列表后的新事件立即得到处理。异步完成时 enterDiagnosis 仍会
    // 通过当前 pathname 硬门禁，不能在诊断页误进入。
    listRefreshRunning = false;
    realtimeRecordRunning = false;
    developerLog('运行时停止', { source: 'route-guard', reason, route: pageWindow().location.pathname });
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
  function parseList(v) { return String(v || '').split(/[,，\n]/).map(norm).filter(Boolean); }
  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])); }

  async function runSelfCheck() {
    const checks = [];
    const path = pageWindow().location.pathname;
    checks.push(`路由：${path}`);
    const entryModeText = config.entryMode === 'click' ? '仅页面点击' : config.entryMode === 'protocol-only' ? '仅协议' : '协议优先';
    checks.push(`配置：自动打开${config.enabled ? '启用' : '停用'} / 只读监控${isMonitoringEnabled() ? '启用' : '停用'} / 进入方式 ${entryModeText}`);
    checks.push(`自动进入时段：${autoEntryScheduleText()}`);
    if (config.entryMode === 'click') checks.push('页面点击模式：协议列表仍可观察，但仅自动打开启用时才允许点击诊断');
    checks.push(`页面行：${queryBodyRows().length}；账号门禁：${accountAllowed() ? '通过' : '未通过'}`);
    checks.push(`开发者采集：${config.developerMode ? '开启' : '关闭'}；保留最近${developerRetentionLabel()}；记录 ${debugEvents.length} 条；生命周期 ${candidateLifecycle.size} 个`);
    checks.push(`权重：检查项目 ${parseWeights(config.examWeights).size} 项，机构 ${parseWeights(config.institutionWeights).size} 项`);
    checks.push(`年龄：${config.age?.unlimited ? '不限' : `${config.age?.min ?? ''}-${config.age?.max ?? ''}`}`);
    const updateSource = await checkUpdateSource();
    checks.push(`热更新源：${updateSource.ok ? `可读 ${updateSource.version || '未识别版本'}（${updateSource.version === SCRIPT_VERSION ? '与本地同步' : `本地 ${SCRIPT_VERSION}，版本不一致`}）` : updateSource.reason}`);
    if (path === '/radiation') {
      try {
        const result = await fetchJson('/api/admin/user/info', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }, 5000);
        checks.push(`会话：${result.payload?.code === 200 ? '有效' : `业务码 ${result.payload?.code ?? '未知'}`}`);
      } catch (e) { checks.push(`会话：请求失败（${String(e.message || e).slice(0, 80)}）`); }
      try {
        const result = await fetchJson('/api/ct/rays/rep/statusNum', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(radiationListPayload({ pageSize: 1 })) }, 5000);
        checks.push(`状态协议：${result.payload?.code === 200 ? '可用' : `业务码 ${result.payload?.code ?? '未知'}`}`);
      } catch (e) { checks.push(`状态协议：请求失败（${String(e.message || e).slice(0, 80)}）`); }
    }
    developerLog('脚本自检', { source: 'self-check', checkCount: checks.length, route: path }, { force: true });
    return checks.join('\n');
  }

  function checkUpdateSource() {
    const url = 'https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js';
    return new Promise(resolve => {
      if (typeof GM_xmlhttpRequest !== 'function') return resolve({ ok: false, reason: 'GM 网络权限不可用' });
      let settled = false;
      const finish = result => { if (!settled) { settled = true; resolve(result); } };
      try {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: 4000,
          onload: response => {
            const text = String(response.responseText || '');
            const match = text.match(/@version\s+([^\s]+)/);
            finish(response.status === 200 && match ? { ok: true, version: match[1] } : { ok: false, reason: `HTTP ${response.status || '未知'}` });
          },
          ontimeout: () => finish({ ok: false, reason: '请求超时' }),
          onerror: () => finish({ ok: false, reason: '网络不可达' })
        });
      } catch (_) { finish({ ok: false, reason: 'GM 网络调用失败' }); }
    });
  }

  function panel() {
    const old = document.getElementById('jx-auto-diagnose-panel');
    if (old) { old.remove(); return; }
    const box = document.createElement('div');
    box.id = 'jx-auto-diagnose-panel';
    box.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;background:#fff;color:#1f2937;border:1px solid #409eff;border-radius:10px;padding:0;box-shadow:0 12px 42px #0005;font:13px/1.45 Segoe UI,Microsoft Yahei,sans-serif';
    box.innerHTML = `
      <div class="jx-panel-header" style="padding:12px 14px;background:linear-gradient(135deg,#409eff,#67c23a);color:white;display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">自动诊断设置</b><button type="button" data-a="close" aria-label="关闭设置" title="关闭设置" style="border:0;background:#ffffff33;color:white;border-radius:6px;padding:2px 10px;font-size:18px;line-height:1.25;cursor:pointer">×</button></div>
      <div class="jx-panel-content" style="padding:10px 14px;overflow:auto;min-height:0;flex:1 1 auto">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:9px"><select data-f="profile" style="flex:1;padding:5px"></select><button data-a="loadProfile">切换</button><input data-f="profileName" placeholder="方案名" style="width:90px;padding:5px"><button data-a="saveProfile">保存方案</button><button data-a="deleteProfile">删除</button></div>
         <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><label><input type="checkbox" data-f="enabled"> 启用自动打开</label><label><input type="checkbox" data-f="monitoringEnabled"> 开启只读监控</label><span style="color:#909399;font-size:12px">自动打开关闭时仍接收推送、读取列表并记录诊断信息，不会进入客户</span><label>本地扫描 <input data-f="pollMs" type="number" min="1000" step="500" style="width:70px"> ms</label><label>状态探测 <input data-f="statusProbeMs" type="number" min="3000" step="1000" style="width:70px"> ms</label><label>列表补偿 <input data-f="listHeartbeatMs" type="number" min="10000" step="1000" style="width:80px"> ms</label><label>操作延迟 <input data-f="clickDelayMs" type="number" min="0" style="width:60px"> ms</label><label>进入等待 <input data-f="entryDelaySeconds" type="number" min="0" max="300" step="1" style="width:60px"> 秒</label><label>模拟人工 <select data-f="humanizeEntryLevel" style="width:auto"><option value="0">无（及时）</option><option value="1">轻微</option><option value="2">中等</option><option value="3">明显</option></select></label><label>进入方式 <select data-f="entryMode" style="width:auto"><option value="protocol-first">协议优先（失败回退点击）</option><option value="protocol-only">仅协议</option><option value="click">页面点击</option></select></label><label><input type="checkbox" data-f="pageQueryRefresh"> 允许脚本点击查询</label></div>
         <fieldset><legend>自动进入时段</legend><div class="jx-time-slots" role="radiogroup" aria-label="自动进入时段"><label class="jx-time-slot"><input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="morning"><span>08:00–12:00</span></label><label class="jx-time-slot"><input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="noon"><span>12:00–14:30</span></label><label class="jx-time-slot"><input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="afternoon"><span>14:30–17:30</span></label><label class="jx-time-slot"><input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="night"><span>17:30–次日 08:00</span></label><button type="button" data-a="clearAutoEntryTimeSlot" title="清除当天自动进入时段">关闭并清除</button></div><small data-a="autoEntryTimeState" style="display:block;color:#909399;margin-top:4px">未选择时段时沿用自动进入开关，不限制时间。</small></fieldset>
        <small style="display:block;color:#909399;margin:-3px 0 7px">进入等待为基础延迟；模拟人工会增加随机抖动。0 秒且选择“无（及时）”时不等待。</small>
        <small style="display:block;color:#909399;margin:-3px 0 7px">候选发现优先使用 WebSocket、状态计数和只读列表协议；默认每个列表补偿周期同步一次当前筛选条件下的可见表格，不会修改报告状态复选框。</small>
        <fieldset><legend>开发者模式</legend><div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><label class="jx-dev-toggle"><input type="checkbox" data-f="developerMode"> 开启开发者模式</label><button type="button" data-a="selfCheck">运行自检</button><button type="button" data-a="copyDebug">复制最近诊断记录</button><button type="button" data-a="clearDebug">清空记录</button><span data-a="debugState" style="color:#909399"></span></div><div class="jx-grid"><label>记录保留时长<select data-f="developerRetentionPreset" aria-label="记录保留时长"><option value="10">10 分钟</option><option value="30">30 分钟</option><option value="60">1 小时（默认）</option><option value="120">2 小时</option><option value="360">6 小时</option><option value="1440">24 小时</option><option value="custom">自定义分钟</option></select></label><label data-a="developerRetentionCustom" hidden>自定义分钟<input data-f="developerRetentionMinutes" type="number" min="1" max="10080" step="1" aria-label="自定义记录保留分钟"><small style="color:#909399">1–10080 分钟，最多 7 天</small></label></div><small data-a="developerRetentionHelp" style="color:#909399"></small></fieldset>
        <fieldset><legend>登录账号</legend><div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><span>当前账号：<b data-a="currentAccount">读取中</b></span><button type="button" data-a="useCurrentAccount">仅允许当前账号</button><button type="button" data-a="clearAccountLimit">清空限制</button></div><label>允许自动诊断的账号（留空不限）<input data-f="allowedAccounts" placeholder="可填账号编号或登录名，多个用逗号分隔"></label><small style="color:#909399">支持账号编号和登录名；留空时所有登录账号都启用。</small><div style="margin-top:8px;padding-top:7px;border-top:1px dashed #dcdfe6"><label><input type="checkbox" data-f="directLoginEnabled"> 未登录时启用协议登录</label><label>协议登录账号<input data-f="directLoginUsername" autocomplete="username" placeholder="账号编号"></label><label><input type="checkbox" data-f="directLoginOcrEnabled"> 使用本机 OCR 自动填写验证码</label><label>OCR 地址<input data-f="directLoginOcrEndpoint" value="http://127.0.0.1:18766/ocr" placeholder="http://127.0.0.1:18766/ocr"></label><div style="display:flex;gap:6px;margin-top:5px"><button type="button" data-a="directLoginNow">立即协议登录</button></div><small style="color:#909399">密码只在点击登录时临时输入，不写入配置。验证码优先使用本机 ddddocr，识别失败再显示手工输入。</small></div></fieldset>
        <fieldset><legend>报告/影像状态</legend><div class="jx-checks" data-group="reportStatuses"></div><div class="jx-checks" data-group="imageStatuses"></div><label class="jx-check"><input type="checkbox" data-f="skipLockedRecords" checked disabled> 检测到其他用户锁定的记录时跳过（始终开启）</label><small style="color:#909399">已锁定、占用或非待诊断报告禁止自动进入；旧配置和方案不能关闭此保护。</small></fieldset>
        <fieldset><legend>患者信息</legend><div class="jx-checks" data-group="encounterTypes"></div><div class="jx-checks" data-group="gender"></div><label class="jx-check"><input type="checkbox" data-f="ageUnlimited"> 年龄不限</label><div class="jx-grid"><label>年龄从<input data-f="ageMin" type="number"></label><label>年龄到<input data-f="ageMax" type="number"></label><label>姓名包含<input data-f="patientNameContains"></label><label>申请单号包含<input data-f="applicationNoContains"></label></div></fieldset>
        <fieldset><legend>检查与机构</legend>
          <div class="jx-checks" data-group="modalities"></div>
          <div class="jx-exam-head"><b>检查项目</b><button type="button" data-a="refreshExamOptions" title="同时更新检查项目、医院、部位、医生和申请机构选项">更新所有可选项目</button></div>
          <label>搜索可选项目<input type="search" data-a="examSearch" placeholder="输入项目名，允许与排除选项同时筛选" aria-label="搜索检查项目"></label>
          <section class="jx-exam-section"><div class="jx-exam-head"><b>允许项目</b><span data-a="examAllowedCount"></span></div><div class="jx-checks" data-group="examNames"></div><div class="jx-checks" data-group="examNamesExtra"></div></section>
          <section class="jx-exam-section jx-exam-excluded"><div class="jx-exam-head"><b>排除项目</b><span data-a="examExcludedCount"></span><button type="button" data-a="clearExamExclusions">清空排除</button></div><div class="jx-checks" data-group="examNamesExcluded"></div><div class="jx-custom-exam"><input data-a="customExcludedExam" placeholder="未列出的项目：输入完整名称" aria-label="自定义排除检查项目"><button type="button" data-a="addExamExclusion">添加并排除</button></div><small class="jx-exam-help">排除优先；允许项目“不限”时仍生效。多项检查中任一项目被排除，整条记录都跳过。按完整名称匹配，左右侧等不同名称可分别勾选。</small></section>
          <details class="jx-institution-section" open><summary>申请机构、检查医院与部位</summary><div class="jx-checks" data-group="applyInstitution"></div><div class="jx-checks" data-group="checkHospitals"></div><div class="jx-checks" data-group="bodyParts"></div></details>
          <details><summary>进入优先顺序</summary><small class="jx-exam-help">权重越大越优先；被排除的项目不会参与进入，格式为“名称=权重”，每行一项。</small><label>检查项目权重<textarea data-f="examWeights" rows="4" placeholder="头颅平扫=100&#10;肋骨平扫=10"></textarea></label><label>申请机构权重<textarea data-f="institutionWeights" rows="3" placeholder="机构名称=权重"></textarea></label><label class="jx-check"><input type="checkbox" data-f="preliminaryReportFirst"> 有结论的初写报告优先</label><small class="jx-exam-help">只识别结论字段；描述、备注不会被当作结论。没有结论的记录仍可处理，只是排序靠后。</small></details>
          <div class="jx-grid"><label>检查部位最少数量<select data-f="siteMin"><option value="">不限</option><option value="1">1 个</option><option value="2">2 个</option><option value="3">3 个</option><option value="4">4 个</option><option value="5">5 个</option></select></label><label>检查部位最多数量<select data-f="siteMax"><option value="">不限</option><option value="1">1 个</option><option value="2">2 个</option><option value="3">3 个</option><option value="4">4 个</option><option value="5">5 个</option></select></label></div><div class="jx-checks" data-group="diagnosisDoctors"></div><label>审核医生（留空不限）<input data-f="auditDoctors"></label>
        </fieldset>
        <fieldset><legend>申请时间</legend><div class="jx-grid"><label>快捷范围<select data-f="applicationTimeMode"><option value="window">最近 5–30 分钟</option><option value="all">不限</option><option value="today">当天</option><option value="recent">最近 N 天</option><option value="fromTime">当天从指定时间</option></select></label><label>最早分钟<input data-f="applicationTimeMin" type="number" min="0" step="1"></label><label>最晚分钟<input data-f="applicationTimeMax" type="number" min="1" step="1"></label><label>最近天数<input data-f="applicationTimeDays" type="number" min="0" step="1"></label><label>开始时间<input data-f="applicationTimeStart" type="time"></label></div><small style="color:#909399">“最近 5–30 分钟”表示 5 分钟内不处理，超过 30 分钟也不处理。</small></fieldset>
        <details><summary>诊断/审核时间（通常不用，默认不限）</summary><div class="jx-grid"><label>诊断时间模式<select data-f="diagnosisTimeMode"><option value="all">不限</option><option value="today">当天</option><option value="recent">最近 N 天</option><option value="fromTime">当天从指定时间</option></select></label><label>诊断最近天数<input data-f="diagnosisTimeDays" type="number" min="0"></label><label>诊断开始时间<input data-f="diagnosisTimeStart" type="time"></label><label>审核时间模式<select data-f="auditTimeMode"><option value="all">不限</option><option value="today">当天</option><option value="recent">最近 N 天</option><option value="fromTime">当天从指定时间</option></select></label><label>审核最近天数<input data-f="auditTimeDays" type="number" min="0"></label><label>审核开始时间<input data-f="auditTimeStart" type="time"></label></div></details>
        <details><summary>高级：表格选择器与操作按钮</summary><label>诊断操作图标序号<input data-f="diagnoseOperatorIndex" type="number" min="0" style="width:60px"></label><label>待诊断状态值<input data-f="pendingStatusValue"></label><label>表格行选择器<input data-f="bodyRows"></label><label>操作项选择器<input data-f="operatorItems"></label></details>
        <div class="jx-panel-actions" style="display:flex;gap:7px;margin-top:10px"><button type="button" data-a="apply" style="background:#409eff;color:white;border:0;border-radius:4px;padding:7px 14px">应用并保存</button><button type="button" data-a="reset">恢复默认</button><button type="button" data-a="export">导出配置</button><button type="button" data-a="import">导入配置</button><span data-a="msg" style="color:#67c23a;align-self:center"></span></div>
      </div>`;
    document.body.appendChild(box);
     const style = document.createElement('style'); style.textContent = '#jx-auto-diagnose-panel .jx-panel-header{position:sticky;top:0;z-index:3;flex:0 0 auto;box-shadow:0 1px 5px #0002}#jx-auto-diagnose-panel .jx-panel-content{overscroll-behavior:contain}#jx-auto-diagnose-panel .jx-panel-actions{position:sticky;bottom:0;z-index:2;background:#fff;padding:8px 0 2px;box-shadow:0 -1px 5px #0001}#jx-auto-diagnose-panel fieldset{border:1px solid #dcdfe6;border-radius:6px;margin:7px 0;padding:7px}#jx-auto-diagnose-panel legend{padding:0 4px;color:#409eff}#jx-auto-diagnose-panel label{display:block;margin:4px 0}#jx-auto-diagnose-panel input,#jx-auto-diagnose-panel select,#jx-auto-diagnose-panel textarea{box-sizing:border-box;padding:4px;border:1px solid #dcdfe6;border-radius:4px;margin-top:2px;width:100%;font:inherit}#jx-auto-diagnose-panel .jx-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}#jx-auto-diagnose-panel .jx-checks{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin:4px 0}#jx-auto-diagnose-panel .jx-check{display:inline-flex;align-items:center;gap:3px;margin:0;color:#606266}#jx-auto-diagnose-panel .jx-check input{width:auto;margin:0}#jx-auto-diagnose-panel .jx-group-label{color:#909399;margin-right:3px}#jx-auto-diagnose-panel .jx-exam-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;color:#909399}#jx-auto-diagnose-panel .jx-exam-head button{padding:3px 8px;color:#409eff;border-color:#b3d8ff;background:#ecf5ff}#jx-auto-diagnose-panel button{border:1px solid #c0c4cc;background:#fff;border-radius:4px;padding:5px 8px;cursor:pointer}#jx-auto-diagnose-panel button:focus-visible{outline:2px solid #409eff;outline-offset:1px}#jx-auto-diagnose-panel [data-a="close"]{min-width:34px;min-height:30px}#jx-auto-diagnose-panel .jx-dev-toggle{display:inline-flex;align-items:center;gap:4px;color:#e6a23c;font-weight:600}#jx-auto-diagnose-panel .jx-dev-toggle input{width:auto;margin:0}#jx-auto-diagnose-panel .jx-time-slots{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}#jx-auto-diagnose-panel .jx-time-slot{display:inline-flex;align-items:center;gap:4px;margin:0;padding:4px 7px;border:1px solid #dcdfe6;border-radius:4px;cursor:pointer;color:#606266}#jx-auto-diagnose-panel .jx-time-slot:has(input:checked){border-color:#409eff;color:#409eff;background:#ecf5ff}#jx-auto-diagnose-panel .jx-time-slot input{width:auto;margin:0}'; box.appendChild(style);
    style.textContent += '#jx-auto-diagnose-panel [hidden]{display:none!important}';
    style.textContent += '#jx-auto-diagnose-panel .jx-exam-section{padding:7px 9px;border:1px solid #dcdfe6;border-radius:6px;margin:7px 0;background:#fafcff}#jx-auto-diagnose-panel .jx-exam-section .jx-checks{max-height:180px;overflow:auto;padding:3px 0}#jx-auto-diagnose-panel .jx-exam-section .jx-exam-head{margin:0 0 5px;color:#606266}#jx-auto-diagnose-panel .jx-exam-excluded{border-color:#f3d19e;background:#fdf6ec}#jx-auto-diagnose-panel .jx-exam-excluded b{color:#b36b00}#jx-auto-diagnose-panel .jx-custom-exam{display:flex;align-items:center;gap:7px;margin:8px 0}#jx-auto-diagnose-panel .jx-custom-exam input{flex:1;min-width:0}#jx-auto-diagnose-panel .jx-custom-exam button{flex:0 0 auto}#jx-auto-diagnose-panel .jx-exam-help{display:block;color:#909399;margin-top:5px}#jx-auto-diagnose-panel details{margin:7px 0}#jx-auto-diagnose-panel summary{cursor:pointer;color:#606266;padding:4px 0}#jx-auto-diagnose-panel [data-a="examAllowedCount"],#jx-auto-diagnose-panel [data-a="examExcludedCount"]{color:#909399;font-size:12px}';
    const f = n => box.querySelector(`[data-f="${n}"]`);
    const GROUPS = { reportStatuses: ['不限','待诊断','诊断中','待审核','审核中','已审核','已打印'], imageStatuses: ['不限','正常','异常'], encounterTypes: ['不限','门诊','急诊','住院','体检'], gender: ['不限','男','女'], modalities: ['不限','CT','MR','DR','DSA','乳腺'], examNames: ['不限', ...DEFAULT_CONFIG.examNames], examNamesExtra: [], examNamesExcluded: [], checkHospitals: [], bodyParts: [], diagnosisDoctors: [] };
    const DYNAMIC_GROUP_FIELDS = { checkHospitals: 'hospital', bodyParts: 'bodyPart', diagnosisDoctors: 'diagnosisDoctor' };
    function availableExamOptions() {
      const fromRows = queryBodyRows().flatMap(row => {
        const value = rowData(row).exam;
        return String(value || '').split(config.examSeparators).map(norm).filter(Boolean);
      });
      return buildExamOptionCatalog(config, fromRows);
    }
    function drawGroups() {
      for (const [name, baseOptions] of Object.entries(GROUPS)) {
        const commonExams = normalizeExamNameList([...DEFAULT_CONFIG.examNames, ...normalizeExamNameList(config.examNames)]);
        let options = name === 'examNames' ? ['不限', ...commonExams] : name === 'examNamesExtra' ? availableExamOptions().filter(x => !commonExams.includes(x)) : name === 'examNamesExcluded' ? ['无排除', ...availableExamOptions()] : baseOptions;
        if (DYNAMIC_GROUP_FIELDS[name]) {
          const current = queryBodyRows().map(rowData).map(d => d[DYNAMIC_GROUP_FIELDS[name]]).filter(Boolean);
          options = ['不限', ...new Set([...(config[name] || []), ...(config.columnOptionsCatalog?.[name] || []), ...current].map(norm).filter(Boolean))];
        }
        const host = box.querySelector(`[data-group="${name}"]`); if (!host) continue;
        const label = {reportStatuses:'报告状态',imageStatuses:'影像状态',encounterTypes:'就诊类型',gender:'性别',modalities:'检查类型',examNames:'常用项目',examNamesExtra:'更多项目',examNamesExcluded:'跳过项目',checkHospitals:'检查医院',bodyParts:'检查部位',diagnosisDoctors:'诊断医生'}[name];
        host.innerHTML = `<span class="jx-group-label">${label}：</span>` + options.map(x => `<label class="jx-check"><input type="checkbox" data-group-name="${name}" value="${esc(x)}"><span>${esc(x)}</span></label>`).join('');
      }
      const values = [...new Set([...(config.applyInstitution || []), ...(config.columnOptionsCatalog?.applyInstitution || []), ...queryBodyRows().map(rowData).map(d => d.institution).filter(Boolean)])];
      const host = box.querySelector('[data-group="applyInstitution"]');
      if (host) host.innerHTML = '<span class="jx-group-label">申请机构：</span>' + ['不限', ...values].map(x => `<label class="jx-check"><input type="checkbox" data-group-name="applyInstitution" value="${esc(x)}"><span>${esc(x === '不限' ? '不限申请机构' : x)}</span></label>`).join('');
      box.querySelectorAll('input[data-group-name]').forEach(check => check.addEventListener('change', () => {
        const group = check.dataset.groupName;
        const peers = [...box.querySelectorAll(`input[data-group-name="${group}"]`)];
        const sentinel = group === 'examNamesExcluded' ? '无排除' : '不限';
        const unlimited = peers.find(item => item.value === sentinel);
        if (check.checked && check.value === sentinel) {
          peers.forEach(item => { if (item !== check) item.checked = false; });
          // “检查项目不限”必须同时清除此前保存在“可选项目”组里的旧勾选。
          // 否则 examNames 为空但 examNamesExtra 仍有值，运行时会继续过滤，
          // 用户看到的“不限”与实际规则不一致。
          if (group === 'examNames') {
            box.querySelectorAll('[data-group-name="examNamesExtra"]').forEach(item => { item.checked = false; });
          }
        }
        if (check.checked && check.value !== sentinel && unlimited) unlimited.checked = false;
        if (group === 'examNamesExtra' && check.checked) {
          const allowAll = box.querySelector('[data-group-name="examNames"][value="不限"]'); if (allowAll) allowAll.checked = false;
        }
        if (group === 'examNames' || group === 'examNamesExtra') {
          const allowAll = box.querySelector('[data-group-name="examNames"][value="不限"]');
          const selected = [...box.querySelectorAll('[data-group-name="examNames"], [data-group-name="examNamesExtra"]')].some(item => item.value !== '不限' && item.checked);
          if (allowAll) allowAll.checked = !selected;
        }
        if (group === 'examNamesExcluded') {
          const hasExclusions = peers.some(item => item.value !== sentinel && item.checked);
          if (unlimited) unlimited.checked = !hasExclusions;
        }
        refreshExamUI();
      }));
    }
    function setGroup(name, values) { const selected = new Set(values || []); const sentinel = name === 'examNamesExcluded' ? '无排除' : '不限'; box.querySelectorAll(`[data-group-name="${name}"]`).forEach(c => { c.checked = selected.has(c.value) || (c.value === sentinel && !values?.length); }); }
    function getGroup(name) { const all = [...box.querySelectorAll(`[data-group-name="${name}"]:checked`)].map(x => x.value); return all.includes(name === 'examNamesExcluded' ? '无排除' : '不限') ? [] : all; }
    function refreshExamUI() {
      const allowed = [...getGroup('examNames'), ...getGroup('examNamesExtra')];
      box.querySelector('[data-a="examAllowedCount"]').textContent = allowed.length ? `已选 ${allowed.length} 项` : '不限';
      const excluded = getGroup('examNamesExcluded');
      box.querySelector('[data-a="examExcludedCount"]').textContent = excluded.length ? `已排除 ${excluded.length} 项` : '未排除项目';
      const search = norm(box.querySelector('[data-a="examSearch"]').value).toLocaleLowerCase();
      for (const name of ['examNames', 'examNamesExtra', 'examNamesExcluded']) {
        box.querySelectorAll(`[data-group-name="${name}"]`).forEach(input => {
          const sentinel = input.value === '不限' || input.value === '无排除';
          const host = input.closest('label'); if (host) host.hidden = !sentinel && !!search && !norm(input.value).toLocaleLowerCase().includes(search);
        });
      }
    }
    function render() {
      drawGroups();
      const scheduleState = autoEntryScheduleState();
      if (scheduleState.expired) clearExpiredAutoEntrySchedule(scheduleState);
      f('enabled').checked = !!config.enabled; f('monitoringEnabled').checked = isMonitoringEnabled(); f('developerMode').checked = !!config.developerMode; f('pageQueryRefresh').checked = !!config.pageQueryRefresh; f('skipLockedRecords').checked = true; f('pollMs').value = config.pollMs; f('statusProbeMs').value = config.statusProbeMs || 5000; f('listHeartbeatMs').value = config.listHeartbeatMs || 15000; f('clickDelayMs').value = config.clickDelayMs; f('entryDelaySeconds').value = Math.max(0, Number(config.entryDelaySeconds) || 0); f('humanizeEntryLevel').value = String(Math.max(0, Math.min(3, Number(config.humanizeEntryLevel) || 0)));
      box.querySelectorAll('input[data-f="autoEntryTimeSlot"]').forEach(input => { input.checked = input.value === (config.autoEntrySchedule?.slot || ''); });
      const scheduleStateText = box.querySelector('[data-a="autoEntryTimeState"]'); if (scheduleStateText) scheduleStateText.textContent = autoEntryScheduleText();
      refreshAutoEntryScheduleUI();
      const debugState = box.querySelector('[data-a="debugState"]'); if (debugState) debugState.textContent = developerModeStateText();
      refreshDeveloperRetentionUI();
      const currentAccount = box.querySelector('[data-a="currentAccount"]'); if (currentAccount) currentAccount.textContent = accountDisplay();
      f('allowedAccounts').value = listValue(config.allowedAccounts);
      f('directLoginEnabled').checked = !!directLoginConfig().enabled; f('directLoginUsername').value = directLoginConfig().username || ''; f('directLoginOcrEnabled').checked = directLoginConfig().ocrEnabled !== false; f('directLoginOcrEndpoint').value = directLoginConfig().ocrEndpoint || 'http://127.0.0.1:18766/ocr';
      f('entryMode').value = config.entryMode || 'protocol-first';
      for (const n of ['reportStatuses','imageStatuses','encounterTypes','gender','modalities','examNames','examNamesExtra','examNamesExcluded','checkHospitals','bodyParts','diagnosisDoctors']) setGroup(n, config[n]);
      const allowAll = box.querySelector('[data-group-name="examNames"][value="不限"]'); if (allowAll) allowAll.checked = !(config.examNames?.length || config.examNamesExtra?.length);
      refreshExamUI();
      setGroup('applyInstitution', config.applyInstitution);
      f('ageUnlimited').checked = !!config.age.unlimited; f('ageMin').value = config.age.min ?? ''; f('ageMax').value = config.age.max ?? ''; f('patientNameContains').value = config.patientNameContains || ''; f('applicationNoContains').value = config.applicationNoContains || '';
      f('examWeights').value = listValue(config.examWeights).replace(/, /g, '\n'); f('institutionWeights').value = listValue(config.institutionWeights).replace(/, /g, '\n'); f('preliminaryReportFirst').checked = config.preliminaryReportFirst !== false;
      f('auditDoctors').value = listValue(config.auditDoctors); f('siteMin').value = config.examSiteCount?.min ?? ''; f('siteMax').value = config.examSiteCount?.max ?? '';
      f('applicationTimeMode').value = config.applicationTime.mode; f('applicationTimeMin').value = config.applicationTime.minMinutes ?? 5; f('applicationTimeMax').value = config.applicationTime.maxMinutes ?? 30; f('applicationTimeDays').value = config.applicationTime.days ?? ''; f('applicationTimeStart').value = config.applicationTime.start || '00:00';
      f('diagnosisTimeMode').value = config.diagnosisTime.mode; f('diagnosisTimeDays').value = config.diagnosisTime.days ?? ''; f('diagnosisTimeStart').value = config.diagnosisTime.start || '00:00'; f('auditTimeMode').value = config.auditTime.mode; f('auditTimeDays').value = config.auditTime.days ?? ''; f('auditTimeStart').value = config.auditTime.start || '00:00';
      f('diagnoseOperatorIndex').value = config.selectors.diagnoseOperatorIndex; f('pendingStatusValue').value = config.pendingStatusValue; f('bodyRows').value = config.selectors.bodyRows; f('operatorItems').value = config.selectors.operatorItems;
      const ps = profiles(); f('profile').innerHTML = '<option value="">选择已保存方案</option>' + Object.keys(ps).sort().map(x => `<option>${esc(x)}</option>`).join('');
    }
    function read() {
      config.enabled = f('enabled').checked; config.monitoringEnabled = f('monitoringEnabled').checked; config.developerMode = f('developerMode').checked; config.pageQueryRefresh = f('pageQueryRefresh').checked; config.skipLockedRecords = true; config.pollMs = Math.max(1000, Number(f('pollMs').value) || 2000); config.statusProbeMs = Math.max(3000, Number(f('statusProbeMs').value) || 5000); config.listHeartbeatMs = Math.max(10000, Number(f('listHeartbeatMs').value) || 15000); config.clickDelayMs = Number(f('clickDelayMs').value) || 0; config.entryDelaySeconds = Math.max(0, Math.min(300, Number(f('entryDelaySeconds').value) || 0)); config.humanizeEntryLevel = Math.max(0, Math.min(3, Number(f('humanizeEntryLevel').value) || 0)); config.entryMode = f('entryMode').value || 'protocol-first';
      // 日期授权仅在点击时段时生成；保存其它选项不能把昨日授权延长到今天。
      if (autoEntryScheduleState().requiresSelection) config.enabled = false;
      config.allowedAccounts = parseList(f('allowedAccounts').value);
      config.directLogin = { enabled: f('directLoginEnabled').checked, username: f('directLoginUsername').value.trim(), ocrEnabled: f('directLoginOcrEnabled').checked, ocrEndpoint: f('directLoginOcrEndpoint').value.trim() || 'http://127.0.0.1:18766/ocr' };
      for (const n of ['reportStatuses','imageStatuses','encounterTypes','gender','modalities','examNames','examNamesExtra','examNamesExcluded','checkHospitals','bodyParts','diagnosisDoctors']) config[n] = getGroup(n);
      // 兼容旧配置：选择过“不限”后，旧版本可能留下 examNamesExtra。
      // 以界面上的“不限”勾选为最终语义，保证实际请求和界面一致。
      const examUnlimited = box.querySelector('[data-group-name="examNames"][value="不限"]')?.checked;
      if (examUnlimited) { config.examNames = []; config.examNamesExtra = []; }
      config.applyInstitution = getGroup('applyInstitution'); config.auditDoctors = parseList(f('auditDoctors').value);
      config.age.unlimited = f('ageUnlimited').checked; config.age.min = config.age.unlimited || f('ageMin').value === '' ? null : Number(f('ageMin').value); config.age.max = config.age.unlimited || f('ageMax').value === '' ? null : Number(f('ageMax').value); config.patientNameContains = f('patientNameContains').value.trim(); config.applicationNoContains = f('applicationNoContains').value.trim(); config.examWeights = parseList(f('examWeights').value.replace(/\n/g, ',')); config.institutionWeights = parseList(f('institutionWeights').value.replace(/\n/g, ',')); config.preliminaryReportFirst = f('preliminaryReportFirst').checked; config.examSiteCount = { min: f('siteMin').value === '' ? null : Number(f('siteMin').value), max: f('siteMax').value === '' ? null : Number(f('siteMax').value) };
      config.applicationTime = { mode: f('applicationTimeMode').value, minMinutes: Number(f('applicationTimeMin').value) || 0, maxMinutes: Number(f('applicationTimeMax').value) || 0, days: Number(f('applicationTimeDays').value) || 0, start: f('applicationTimeStart').value || '00:00' }; config.diagnosisTime = { mode: f('diagnosisTimeMode').value, days: Number(f('diagnosisTimeDays').value) || 0, start: f('diagnosisTimeStart').value || '00:00' }; config.auditTime = { mode: f('auditTimeMode').value, days: Number(f('auditTimeDays').value) || 0, start: f('auditTimeStart').value || '00:00' };
      config.pendingStatusValue = f('pendingStatusValue').value.trim() || '102501'; config.selectors.diagnoseOperatorIndex = Number(f('diagnoseOperatorIndex').value) || 0; config.selectors.bodyRows = f('bodyRows').value.trim() || DEFAULT_CONFIG.selectors.bodyRows; config.selectors.operatorItems = f('operatorItems').value.trim() || DEFAULT_CONFIG.selectors.operatorItems;
    }
    const msg = t => { const el = box.querySelector('[data-a="msg"]'); if (!el) return; el.textContent = t; setTimeout(() => { const current = box.querySelector('[data-a="msg"]'); if (current) current.textContent = ''; }, 1800); };
    box.querySelector('[data-a="apply"]').onclick = () => { read(); saveConfig(); scheduleAutoEntryScheduleExpiry(); start(); msg('已保存并应用'); };
    box.querySelectorAll('input[data-f="autoEntryTimeSlot"]').forEach(input => input.addEventListener('click', () => {
      if (!setAutoEntrySchedule(input.value)) {
        refreshAutoEntryScheduleUI();
        return msg('该时段今天已结束，请选择其它时段');
      }
      saveConfig();
      scheduleAutoEntryScheduleExpiry();
      refreshAutoEntryScheduleUI();
      developerLog('自动进入时段选择', { source: 'settings', ...config.autoEntrySchedule }, { force: true });
      msg('时段已保存，自动进入已开启');
    }));
    box.querySelector('[data-a="clearAutoEntryTimeSlot"]').onclick = () => {
      config.autoEntrySchedule = { slot: '', date: '', requiresSelection: true };
      config.enabled = false;
      saveConfig();
      scheduleAutoEntryScheduleExpiry();
      render();
      msg('自动进入已关闭，请重新选择时段');
    };
    box.querySelector('[data-f="developerMode"]').onchange = () => { config.developerMode = f('developerMode').checked; saveConfig(); const state = box.querySelector('[data-a="debugState"]'); if (state) state.textContent = developerModeStateText(); if (config.developerMode) developerLog('开发者模式开启', { source: 'settings' }, { force: true }); };
    box.querySelector('[data-f="developerRetentionPreset"]').onchange = () => {
      const preset = f('developerRetentionPreset').value;
      if (preset === 'custom') { const custom = box.querySelector('[data-a="developerRetentionCustom"]'); if (custom) custom.hidden = false; f('developerRetentionMinutes').focus(); return; }
      setDeveloperRetentionMinutes(preset); msg('保留时长已保存');
    };
    box.querySelector('[data-f="developerRetentionMinutes"]').onchange = () => { setDeveloperRetentionMinutes(f('developerRetentionMinutes').value); msg('保留时长已保存'); };
    box.querySelector('[data-a="copyDebug"]').onclick = async () => { try { await navigator.clipboard?.writeText(developerLogText()); msg(debugEvents.length ? '诊断记录已复制' : '当前没有诊断记录'); } catch (_) { msg('复制失败，请打开控制台查看'); } };
    box.querySelector('[data-a="clearDebug"]').onclick = () => { clearDeveloperEvents(); const state = box.querySelector('[data-a="debugState"]'); if (state) state.textContent = developerModeStateText(); msg('诊断记录已清空'); };
    box.querySelector('[data-a="selfCheck"]').onclick = async () => { msg('正在运行自检…'); const result = await runSelfCheck(); alert(result); msg('自检完成'); };
    box.querySelector('[data-a="useCurrentAccount"]').onclick = () => { const identity = loginIdentity(); const value = identity.loginCode || identity.name; if (!value) return msg('当前账号暂未识别'); f('allowedAccounts').value = value; msg('已填入当前账号'); };
    box.querySelector('[data-a="clearAccountLimit"]').onclick = () => { f('allowedAccounts').value = ''; msg('已清空账号限制'); };
    box.querySelector('[data-a="directLoginNow"]').onclick = async () => { read(); saveConfig(); msg('正在协议登录…'); const ok = await ensureDirectLogin(); msg(ok ? '协议登录成功' : '协议登录未完成'); if (ok) { render(); start(); } };
    box.querySelector('[data-a="examSearch"]').oninput = refreshExamUI;
    box.querySelector('[data-a="clearExamExclusions"]').onclick = () => {
      read(); config.examNamesExcluded = []; saveConfig(); setGroup('examNamesExcluded', []); refreshExamUI(); msg('已清空排除项目');
    };
    box.querySelector('[data-a="addExamExclusion"]').onclick = () => {
      const input = box.querySelector('[data-a="customExcludedExam"]');
      const names = normalizeExamNameList(input.value);
      if (!names.length) { input.focus(); return msg('请输入完整检查项目名'); }
      read();
      config.examNamesExcluded = normalizeExamNameList([...config.examNamesExcluded, ...names]);
      config.examNamesCatalog = buildExamOptionCatalog(config, names);
      saveConfig(); render(); input.value = ''; input.focus(); msg(`已添加并排除 ${names.length} 项`);
    };
    box.querySelector('[data-a="customExcludedExam"]').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); box.querySelector('[data-a="addExamExclusion"]').click(); }
    });
    box.querySelector('[data-a="refreshExamOptions"]').onclick = async () => {
      read();
      msg('正在更新可选项目…');
      const records = await fetchRadiationRecords({ pageSize: 100, timeoutMs: 8000, ignoreApplicationTime: true, ignoreStatusFilter: true, ignoreModalityFilter: true, ignoreInstitutionFilter: true, ignoreBodyPartFilter: true });
      const fromApi = records.flatMap(record => String(record?.examName || record?.exam || '').split(config.examSeparators).map(norm).filter(Boolean));
      const options = buildExamOptionCatalog(config, [...availableExamOptions(), ...fromApi]);
      config.examNamesCatalog = options;
      const dynamic = {
        checkHospitals: records.map(record => record?.checkOrgName || record?.checkOrg),
        bodyParts: records.map(record => record?.bodyPartName || record?.bodyPart || record?.checkPartName || record?.checkPart),
        diagnosisDoctors: records.map(record => record?.reportDoc),
        applyInstitution: records.map(record => record?.applyOrgName || record?.applyOrg)
      };
      config.columnOptionsCatalog = config.columnOptionsCatalog || {};
      for (const [name, values] of Object.entries(dynamic)) {
        config.columnOptionsCatalog[name] = [...new Set([...(config.columnOptionsCatalog[name] || []), ...values.map(norm).filter(Boolean)])];
      }
      saveConfig();
      render();
      const dynamicCount = Object.values(dynamic).flat().map(norm).filter(Boolean).length;
      msg(`已更新 ${options.length + dynamicCount} 个可选项目`);
    };
    box.querySelector('[data-a="reset"]').onclick = () => { config = configWithCurrentEntrySchedule(DEFAULT_CONFIG); saveConfig(); render(); start(); msg('已恢复默认筛选，时段保持当前选择'); };
    box.querySelector('[data-a="saveProfile"]').onclick = () => { read(); const n = f('profileName').value.trim(); if (!n) return msg('请填写方案名'); const p = profiles(); p[n] = config; saveProfiles(p); render(); f('profile').value = n; msg('方案已保存'); };
    box.querySelector('[data-a="loadProfile"]').onclick = () => { const n = f('profile').value; const p = profiles(); if (!n || !p[n]) return msg('请选择方案'); config = configWithCurrentEntrySchedule(p[n]); saveConfig(); render(); start(); msg('方案已切换，时段保持当前选择'); };
    box.querySelector('[data-a="deleteProfile"]').onclick = () => { const n = f('profile').value; const p = profiles(); if (n && p[n]) { delete p[n]; saveProfiles(p); render(); msg('方案已删除'); } };
    box.querySelector('[data-a="export"]').onclick = async () => { await navigator.clipboard?.writeText(JSON.stringify(config, (k, v) => v instanceof RegExp ? { __regexp: v.source } : v, 2)); msg('配置 JSON 已复制'); };
    box.querySelector('[data-a="import"]').onclick = () => { const s = prompt('粘贴配置 JSON'); if (!s) return; try { const n = JSON.parse(s); if (n.examSeparators?.__regexp) n.examSeparators = new RegExp(n.examSeparators.__regexp); config = configWithCurrentEntrySchedule(n); saveConfig(); render(); start(); msg('已导入，时段保持当前选择'); } catch (e) { msg('JSON 无效'); } };
    box.querySelector('[data-a="close"]').onclick = () => box.remove();
    box.addEventListener('change', event => {
      const target = event.target;
      if (!target?.matches?.('input[data-f], select[data-f], textarea[data-f], input[data-group-name]')) return;
      if (['autoEntryTimeSlot', 'developerMode', 'developerRetentionPreset', 'developerRetentionMinutes', 'profile', 'profileName'].includes(target.dataset.f)) return;
      read(); saveConfig(); scheduleAutoEntryScheduleExpiry(); msg('已自动保存');
    });
    render();
  }

  function attachToHeaderSettings() {
    if (pageWindow().location.pathname !== '/radiation') return;
    const trigger = document.querySelector('.table-header-setting-btn, .el-table__header-wrapper .column-setting, .el-table__header-wrapper [data-column-setting]');
    if (!trigger || trigger.dataset.jxAutoBound) return;
    trigger.dataset.jxAutoBound = '1';
    trigger.addEventListener('click', () => setTimeout(() => {
      const title = document.querySelector('.table-header-setting-wrap__title, .el-popover__title, .el-dialog__header');
      if (!title || title.querySelector('[data-jx-auto-entry]')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.jxAutoEntry = '1'; b.textContent = '⚙ 自动诊断设置';
      b.style.cssText = 'margin-left:10px;padding:3px 8px;border:1px solid #409eff;border-radius:4px;background:#ecf5ff;color:#409eff;cursor:pointer;font:12px Segoe UI,Microsoft Yahei,sans-serif';
      b.addEventListener('click', panel); title.appendChild(b);
    }, 80));
  }

  GM_registerMenuCommand('自动诊断：配置', panel);
  GM_registerMenuCommand('自动诊断：启用/停用', () => {
    isAutoOpenEnabled();
    if (autoEntryScheduleState().requiresSelection) { panel(); return; }
    config.enabled = !config.enabled; saveConfig(); refreshAutoEntryScheduleUI();
    console.info('[自动诊断] enabled =', config.enabled);
  });
  window.addEventListener('beforeunload', () => {
    stopRuntime('beforeunload');
    flushDeveloperEvents();
    if (debugCleanupTimer) clearInterval(debugCleanupTimer);
    if (routeWatchTimer) clearInterval(routeWatchTimer);
    if (loginRecoveryTimer) clearTimeout(loginRecoveryTimer);
    if (autoEntryScheduleTimer) clearTimeout(autoEntryScheduleTimer);
    if (timer) clearInterval(timer);
    if (probeTimer) clearTimeout(probeTimer);
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    if (autoQueryFallbackTimer) clearTimeout(autoQueryFallbackTimer);
    if (pageQueryHeartbeatTimer) clearTimeout(pageQueryHeartbeatTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onVisibilityChange);
    window.removeEventListener('popstate', watchRoute);
    window.removeEventListener('hashchange', watchRoute);
    window.removeEventListener(REALTIME_HINT_EVENT, onRealtimeHint);
    window.removeEventListener(REPORT_ENTRY_EVENT, onReportEntryObserved);
  });
  restoreAutomaticEntryHistory();
  installReportEntryBridge();
  installRealtimeHintBridge();
  scheduleAutoEntryScheduleExpiry();
  let bootstrapped = false;
  function scheduleLoginRecovery() {
    if (loginRecoveryTimer) clearTimeout(loginRecoveryTimer);
    if (pageWindow().location.pathname !== '/login') return;
    loginRecoveryTimer = setTimeout(() => {
      loginRecoveryTimer = null;
      if (pageWindow().location.pathname !== '/login') return;
      // 不在这里弹出密码框：密码只允许当前页面会话临时使用。
      // 仅当用户已在当前会话输入过密码时自动重试，避免登录路由切换反复打断页面。
      const canRetry = !!directPassword;
      developerLog('登录路由恢复等待', {
        source: 'route-guard',
        canRetry,
        hasAuthCookie: !!readCookie('Auth'),
        directLoginConfigured: !!(directLoginConfig().enabled && directLoginConfig().username)
      }, { force: true });
      if (canRetry) {
        bootstrapped = false;
        bootstrap();
      }
    }, 1200);
  }
  function watchRoute() {
    const path = pageWindow().location.pathname;
    let changed = false;
    if (path !== lastObservedPath) {
      const previous = lastObservedPath; lastObservedPath = path;
      changed = true;
      maintainFinalEntryPendingRoute(path, previous);
      developerLog('路由变化', { source: 'route-guard', from: previous || '(初始)', to: path }, { force: true });
      if (!isMonitorRoute(path)) {
        stopRuntime('route-exit');
        // 允许 /login -> /radiation 时重新走一次初始化和会话检查。
        // 旧逻辑保留 bootstrapped=true，登录路由回来后只重启定时器，
        // 会跳过一次必要的直接登录/身份恢复检查。
        bootstrapped = false;
        if (path === '/login') scheduleLoginRecovery();
      }
    }
    // SPA 从诊断页返回列表时 bootstrapped 仍为 true，但 stopRuntime 已经
    // 清掉了所有定时器、Observer 和运行状态。必须在每次真正回到列表页时
    // 重建运行时，否则第一次进入成功后后续候选永远不会再被处理。
    if (isMonitorRoute(path) && changed) {
      if (!bootstrapped) bootstrap();
      else {
        headerObserver = new MutationObserver(attachToHeaderSettings);
        if (document.body) headerObserver.observe(document.body, { childList: true, subtree: true });
        attachToHeaderSettings();
        developerLog('运行时重启', { source: 'route-guard', reason: '返回待诊断列表' }, { force: true });
        start({ preserveDiagnosisLock: true });
      }
    }
  }
  const bootstrap = async () => {
    // 门户跳转到影像页时，Vue 可能先替换文档再触发 DOMContentLoaded；
    // 登录页也需要启动，用于第二次以后直接协议登录。
    const currentUrl = pageWindow().location;
    if (currentUrl.host === '10.10.94.90:22100' || !['/login', '/radiation', '/radiation/report'].includes(currentUrl.pathname)) {
      return;
    }
    if (bootstrapped) return;
    bootstrapped = true;
    // 先完成同源协议登录，再启动列表探测；未启用时保持原有登录流程。
    // 允许从 /radiation 直接触发协议登录：用户未主动打开 /login 时，
    // 只要配置了账号，仍然可以完成登录后继续启动列表；/setting/profile 等其它路由不触发。
    const directLoginRoute = currentUrl.pathname === '/login' || currentUrl.pathname === '/radiation';
    if (directLoginRoute && directLoginConfig().enabled && String(directLoginConfig().username || '').trim() && !readCookie('Auth')) {
      const ok = await ensureDirectLogin();
      if (ok && currentUrl.pathname === '/login') {
        pageWindow().location.replace('/radiation');
        return;
      }
    }
    if (currentUrl.pathname === '/login') return;
    headerObserver = new MutationObserver(attachToHeaderSettings);
    if (document.body) headerObserver.observe(document.body, { childList: true, subtree: true });
    attachToHeaderSettings();
    // 直接打开诊断页时无法证明右侧待诊断列表已经挂载；先保守锁住入口，
    // 待业务行出现后由 entryDiagnosisLockActive 决定是否释放。
    if (currentUrl.pathname === '/radiation/report') diagnosisActive = true;
    start({ preserveDiagnosisLock: currentUrl.pathname === '/radiation/report' });
  };
  lastObservedPath = pageWindow().location.pathname;
  routeWatchTimer = setInterval(watchRoute, 1000);
  window.addEventListener('popstate', watchRoute);
  window.addEventListener('hashchange', watchRoute);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
})();
