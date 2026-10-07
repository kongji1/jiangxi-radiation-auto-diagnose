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
