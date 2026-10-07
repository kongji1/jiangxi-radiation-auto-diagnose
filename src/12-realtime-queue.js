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

