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

