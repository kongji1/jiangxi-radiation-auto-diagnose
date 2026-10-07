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
