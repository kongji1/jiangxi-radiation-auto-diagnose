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

