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

