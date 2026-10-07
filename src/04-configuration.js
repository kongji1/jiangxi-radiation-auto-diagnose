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

