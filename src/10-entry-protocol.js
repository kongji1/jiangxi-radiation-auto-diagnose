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

