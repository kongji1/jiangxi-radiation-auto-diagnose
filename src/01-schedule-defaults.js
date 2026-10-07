  const SCRIPT_VERSION = '{{SCRIPT_VERSION}}';

  const AUTO_ENTRY_TIME_SLOTS = Object.freeze([
    { id: 'morning', label: '08:00–12:00', startMinutes: 8 * 60, endMinutes: 12 * 60, overnight: false },
    { id: 'noon', label: '12:00–14:30', startMinutes: 12 * 60, endMinutes: 14 * 60 + 30, overnight: false },
    { id: 'afternoon', label: '14:30–17:30', startMinutes: 14 * 60 + 30, endMinutes: 17 * 60 + 30, overnight: false },
    { id: 'night', label: '17:30–次日 08:00', startMinutes: 17 * 60 + 30, endMinutes: 8 * 60, overnight: true }
  ]);

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function localDateFromKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) || localDateKey(date) !== value ? null : date;
  }

  function autoEntrySlot(id) {
    return AUTO_ENTRY_TIME_SLOTS.find(slot => slot.id === String(id || '')) || null;
  }

  function autoEntryScheduleState(now = new Date(), schedule = config?.autoEntrySchedule || {}) {
    const slot = autoEntrySlot(schedule.slot);
    const anchorDate = localDateFromKey(schedule.date);
    if (!slot || !anchorDate) return { configured: false, requiresSelection: !!(schedule.requiresSelection || schedule.slot || schedule.date), active: false, pending: false, expired: false, slot: null, startAt: 0, endAt: 0 };
    const start = new Date(anchorDate);
    start.setHours(Math.floor(slot.startMinutes / 60), slot.startMinutes % 60, 0, 0);
    const end = new Date(anchorDate);
    if (slot.overnight) end.setDate(end.getDate() + 1);
    end.setHours(Math.floor(slot.endMinutes / 60), slot.endMinutes % 60, 0, 0);
    const nowAt = now.getTime();
    const startAt = start.getTime();
    const endAt = end.getTime();
    const expired = nowAt >= endAt;
    const pending = nowAt < startAt;
    return { configured: true, requiresSelection: false, active: !expired && !pending, pending, expired, slot, date: schedule.date, startAt, endAt };
  }

  function clearExpiredAutoEntrySchedule(state) {
    if (!state?.configured || !state.expired) return false;
    const oldSlot = state.slot?.label || String(config.autoEntrySchedule?.slot || '');
    config.autoEntrySchedule = { slot: '', date: '', requiresSelection: true };
    config.enabled = false;
    saveConfig();
    developerLog('自动进入时段到期关闭', { source: 'auto-entry-schedule', slot: oldSlot, date: state.date || '' }, { force: true });
    refreshAutoEntryScheduleUI();
    return true;
  }

  function setAutoEntrySchedule(slotId, now = new Date()) {
    const slot = autoEntrySlot(slotId);
    if (!slot) return false;
    // 在跨午夜时段的次日凌晨选择时，将时段归属到前一天，保证 08:00 到点自动失效。
    let anchor = new Date(now);
    const minute = now.getHours() * 60 + now.getMinutes();
    if (slot.overnight && minute < slot.endMinutes) {
      anchor.setDate(anchor.getDate() - 1);
    }
    const schedule = { slot: slot.id, date: localDateKey(anchor), requiresSelection: false };
    if (autoEntryScheduleState(now, schedule).expired) return false;
    config.autoEntrySchedule = schedule;
    config.enabled = true;
    return true;
  }

  function autoEntryScheduleText(state = autoEntryScheduleState()) {
    if (state.requiresSelection) return '自动进入已关闭，请重新选择一个时间段；选择后立即保存并开启。';
    if (!state.configured) return '未选择时段：沿用“启用自动打开”开关，不限制时间。';
    if (state.expired) return `时段已到期：${state.slot.label}，自动打开已关闭，请重新选择。`;
    if (state.pending) {
      const start = new Date(state.startAt);
      return `已选择 ${state.slot.label}，将在 ${start.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 开始。`;
    }
    const end = new Date(state.endAt);
    return `当前时段生效：${state.slot.label}，到 ${end.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 自动关闭。`;
  }

  function refreshAutoEntryScheduleUI() {
    const box = document.getElementById('jx-auto-diagnose-panel');
    if (!box) return;
    const state = autoEntryScheduleState();
    const enabled = box.querySelector('[data-f="enabled"]');
    if (enabled) { enabled.checked = !!config.enabled; enabled.disabled = state.requiresSelection; }
    box.querySelectorAll('[data-f="autoEntryTimeSlot"]').forEach(input => {
      input.checked = input.value === (config.autoEntrySchedule?.slot || '');
    });
    const text = box.querySelector('[data-a="autoEntryTimeState"]');
    if (text) text.textContent = autoEntryScheduleText(state);
  }

  // 所有业务规则和页面定位都集中在这里，也可以从表头设置弹窗进入配置面板修改。
  const DEFAULT_CONFIG = {
    configSchema: 2,
    enabled: true,
    // 只读监控与自动打开分离。关闭自动打开时仍可观察 WebSocket、协议列表、状态和开发者日志。
    monitoringEnabled: true,
    // 默认开启完整诊断记录；保留时长可配置，关闭后按用户选择持久化。
    developerMode: true,
    developerRetentionMinutes: 60,
    developerModeDebugWindowSchema: 2,
    // [] 表示不限登录账号；填写账号编号或登录名后，仅对匹配账号启用自动诊断。
    allowedAccounts: [],
    // 协议登录只保存账号，不保存密码；密码仅在当前页面会话内存中使用。
    directLogin: { enabled: false, username: '', ocrEnabled: true, ocrEndpoint: 'http://127.0.0.1:18766/ocr' },
    // DOM 扫描只在本地进行；服务器探测单独使用 statusNum，前台默认 5 秒一次，后台自动降到较低频率并带退避。
    pollMs: 2000,
    statusProbeMs: 5000,
    // 页面已有 WebSocket 推送时即时触发；没有推送或消息不完整时按此间隔补偿一次列表。
    realtimeHints: true,
    listHeartbeatMs: 15000,
    // 后台候选处理默认只走协议，不替用户点击页面“查询”；需要同步可见表格时再手动开启。
    pageQueryRefresh: true,
    clickDelayMs: 700,
    // 自动进入前的可配置等待；0 秒且模拟人工程度为“无”时立即响应。
    entryDelaySeconds: 0,
    humanizeEntryLevel: 0,
    // 可选的当日自动进入时段；未选择时沿用 enabled 的不限时兼容行为。
    // 选择后只在该时段内允许自动进入，跨午夜时段以选择日 17:30 为起点。
    autoEntrySchedule: { slot: '', date: '', requiresSelection: false },
    // 待诊断在当前系统中的状态值；脚本会优先点击这个复选框，再读取表格。
    pendingStatusValue: '102501',
    reportStatuses: ['待诊断'],
    // 兼容旧配置字段；其它用户已锁定/占用的报告始终禁止自动进入。
    skipLockedRecords: true,
    imageStatuses: [],
    encounterTypes: ['门诊', '急诊'], // [] 表示不限；住院不会被默认放行
    gender: [],                         // [] 表示不限；可填 ['男'] 或 ['女']
    age: { min: 18, max: 40, unlimited: false }, // unlimited=true 或边界为空表示不限
    modalities: ['CT'],                // [] 表示不限
    patientNameContains: '',
    applicationNoContains: '',
    applyInstitution: [],               // [] 表示不限；填写后按行文本或数据属性匹配
    checkHospitals: [],                 // [] 表示不限；动态来源于“检查医院”表头/协议记录
    bodyParts: [],                      // [] 表示不限；动态来源于“检查部位”表头/协议记录
    // 数值越大越优先；未列出的项目按 0 处理。设置界面支持“名称=权重”逐行编辑。
    examWeights: ['头颅平扫=100', '颅脑平扫=95', '腰椎间盘平扫=80', '颈椎间盘平扫=75', '肋骨平扫=10'],
    institutionWeights: [],
    preliminaryReportFirst: true,
    diagnosisDoctors: [],               // [] 表示不限；动态来源于“诊断医生”表头/协议记录
    auditDoctors: [],                   // [] 表示不限
    applicationTime: { mode: 'window', minMinutes: 5, maxMinutes: 30, days: 3, start: '00:00' },
    diagnosisTime: { mode: 'all', days: 3, start: '00:00' },
    auditTime: { mode: 'all', days: 3, start: '00:00' },
    examNames: [
      '头颅平扫',
      '颅脑平扫',
      '腰椎间盘平扫',
      '腰椎椎间盘平扫',
      '颈椎间盘平扫',
      '颈椎椎间盘平扫'
    ],
    examNamesExtra: [],
    // 排除先于允许项目；每个拆分检查项目按规范化后的完整名称匹配。
    examNamesExcluded: [],
    // 动态收集当前列表中出现过的检查项目，供设置界面勾选。
    examNamesCatalog: [],
    // “更新所有可选项目”会把其它动态表头的选项也缓存到这里，避免翻页后选项消失。
    columnOptionsCatalog: { checkHospitals: [], bodyParts: [], diagnosisDoctors: [], applyInstitution: [] },
    // 兼容旧版本字段；新版本使用 examSiteCount，默认不限检查部位数量。
    singleSiteOnly: false,
    examSiteCount: { min: null, max: null },
    // 协议优先会先调用系统的允许进入接口，再打开诊断页；取不到记录编号时回退到页面按钮。
    entryMode: 'protocol-first',
    // 同一行多个检查项目的分隔符。需要支持其它医院命名时可扩展。
    examSeparators: /[,，、+＋;；\\/]/,
    selectors: {
      bodyRows: 'table.el-table__body tbody tr',
      statusInput: 'input[type="checkbox"][value="{pendingStatusValue}"]',
      searchButton: 'button.el-button--primary',
      operatorItems: '.operator .table-operator-item',
      // 找不到诊断图标时的兼容回退序号；正常情况按图标名称识别。
      diagnoseOperatorIndex: 0
    },
    // 防止同一检查在刷新/翻页后再次打开。仅保存短字符串，不保存患者姓名等额外信息。
    seenLimit: 500
  };

