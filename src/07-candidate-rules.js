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

