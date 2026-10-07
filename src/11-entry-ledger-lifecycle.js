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

