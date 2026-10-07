  const PROFILE_KEY = 'jx-radiation-auto-diagnose-profiles-v1';
  function profiles() {
    try {
      const raw = GM_getValue(PROFILE_KEY, {});
      const p = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      for (const x of Object.values(p)) if (x.examSeparators?.__regexp) x.examSeparators = new RegExp(x.examSeparators.__regexp);
      return p;
    } catch (_) { return {}; }
  }
  function saveProfiles(p) { GM_setValue(PROFILE_KEY, JSON.stringify(p, (k, v) => v instanceof RegExp ? { __regexp: v.source } : v)); }
  function listValue(v) { return Array.isArray(v) ? v.join(', ') : String(v || ''); }
  function parseList(v) { return String(v || '').split(/[,，\n]/).map(norm).filter(Boolean); }
  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])); }

  async function runSelfCheck() {
    const checks = [];
    const path = pageWindow().location.pathname;
    checks.push(`路由：${path}`);
    const entryModeText = config.entryMode === 'click' ? '仅页面点击' : config.entryMode === 'protocol-only' ? '仅协议' : '协议优先';
    checks.push(`配置：自动打开${config.enabled ? '启用' : '停用'} / 只读监控${isMonitoringEnabled() ? '启用' : '停用'} / 进入方式 ${entryModeText}`);
    checks.push(`自动进入时段：${autoEntryScheduleText()}`);
    if (config.entryMode === 'click') checks.push('页面点击模式：协议列表仍可观察，但仅自动打开启用时才允许点击诊断');
    checks.push(`页面行：${queryBodyRows().length}；账号门禁：${accountAllowed() ? '通过' : '未通过'}`);
    checks.push(`开发者采集：${config.developerMode ? '开启' : '关闭'}；保留最近${developerRetentionLabel()}；记录 ${debugEvents.length} 条；生命周期 ${candidateLifecycle.size} 个`);
    checks.push(`权重：检查项目 ${parseWeights(config.examWeights).size} 项，机构 ${parseWeights(config.institutionWeights).size} 项`);
    checks.push(`年龄：${config.age?.unlimited ? '不限' : `${config.age?.min ?? ''}-${config.age?.max ?? ''}`}`);
    const updateSource = await checkUpdateSource();
    checks.push(`热更新源：${updateSource.ok ? `可读 ${updateSource.version || '未识别版本'}（${updateSource.version === SCRIPT_VERSION ? '与本地同步' : `本地 ${SCRIPT_VERSION}，版本不一致`}）` : updateSource.reason}`);
    if (path === '/radiation') {
      try {
        const result = await fetchJson('/api/admin/user/info', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }, 5000);
        checks.push(`会话：${result.payload?.code === 200 ? '有效' : `业务码 ${result.payload?.code ?? '未知'}`}`);
      } catch (e) { checks.push(`会话：请求失败（${String(e.message || e).slice(0, 80)}）`); }
      try {
        const result = await fetchJson('/api/ct/rays/rep/statusNum', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(radiationListPayload({ pageSize: 1 })) }, 5000);
        checks.push(`状态协议：${result.payload?.code === 200 ? '可用' : `业务码 ${result.payload?.code ?? '未知'}`}`);
      } catch (e) { checks.push(`状态协议：请求失败（${String(e.message || e).slice(0, 80)}）`); }
    }
    developerLog('脚本自检', { source: 'self-check', checkCount: checks.length, route: path }, { force: true });
    return checks.join('\n');
  }

  function checkUpdateSource() {
    const url = 'https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js';
    return new Promise(resolve => {
      if (typeof GM_xmlhttpRequest !== 'function') return resolve({ ok: false, reason: 'GM 网络权限不可用' });
      let settled = false;
      const finish = result => { if (!settled) { settled = true; resolve(result); } };
      try {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: 4000,
          onload: response => {
            const text = String(response.responseText || '');
            const match = text.match(/@version\s+([^\s]+)/);
            finish(response.status === 200 && match ? { ok: true, version: match[1] } : { ok: false, reason: `HTTP ${response.status || '未知'}` });
          },
          ontimeout: () => finish({ ok: false, reason: '请求超时' }),
          onerror: () => finish({ ok: false, reason: '网络不可达' })
        });
      } catch (_) { finish({ ok: false, reason: 'GM 网络调用失败' }); }
    });
  }

  function panel() {
    const old = document.getElementById('jx-auto-diagnose-panel');
    if (old) { old.remove(); return; }
    const box = document.createElement('div');
    box.id = 'jx-auto-diagnose-panel';
    box.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;background:#fff;color:#1f2937;border:1px solid #409eff;border-radius:10px;padding:0;box-shadow:0 12px 42px #0005;font:13px/1.45 Segoe UI,Microsoft Yahei,sans-serif';
    box.innerHTML = `
      <div class="jx-panel-header" style="padding:12px 14px;background:linear-gradient(135deg,#409eff,#67c23a);color:white;display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">自动诊断设置</b><button type="button" data-a="close" aria-label="关闭设置" title="关闭设置" style="border:0;background:#ffffff33;color:white;border-radius:6px;padding:2px 10px;font-size:18px;line-height:1.25;cursor:pointer">×</button></div>
      <div class="jx-panel-content" style="padding:10px 14px;overflow:auto;min-height:0;flex:1 1 auto">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:9px"><select data-f="profile" style="flex:1;padding:5px"></select><button data-a="loadProfile">切换</button><input data-f="profileName" placeholder="方案名" style="width:90px;padding:5px"><button data-a="saveProfile">保存方案</button><button data-a="deleteProfile">删除</button></div>
         <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><label><input type="checkbox" data-f="enabled"> 启用自动打开</label><label><input type="checkbox" data-f="monitoringEnabled"> 开启只读监控</label><span style="color:#909399;font-size:12px">自动打开关闭时仍接收推送、读取列表并记录诊断信息，不会进入客户</span><label>本地扫描 <input data-f="pollMs" type="number" min="1000" step="500" style="width:70px"> ms</label><label>状态探测 <input data-f="statusProbeMs" type="number" min="3000" step="1000" style="width:70px"> ms</label><label>列表补偿 <input data-f="listHeartbeatMs" type="number" min="10000" step="1000" style="width:80px"> ms</label><label>操作延迟 <input data-f="clickDelayMs" type="number" min="0" style="width:60px"> ms</label><label>进入等待 <input data-f="entryDelaySeconds" type="number" min="0" max="300" step="1" style="width:60px"> 秒</label><label>模拟人工 <select data-f="humanizeEntryLevel" style="width:auto"><option value="0">无（及时）</option><option value="1">轻微</option><option value="2">中等</option><option value="3">明显</option></select></label><label>进入方式 <select data-f="entryMode" style="width:auto"><option value="protocol-first">协议优先（失败回退点击）</option><option value="protocol-only">仅协议</option><option value="click">页面点击</option></select></label><label><input type="checkbox" data-f="pageQueryRefresh"> 允许脚本点击查询</label></div>
         <fieldset><legend>自动进入时段</legend><div class="jx-time-slots" role="radiogroup" aria-label="自动进入时段"><label class="jx-time-slot"><input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="morning"><span>08:00–12:00</span></label><label class="jx-time-slot"><input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="noon"><span>12:00–14:30</span></label><label class="jx-time-slot"><input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="afternoon"><span>14:30–17:30</span></label><label class="jx-time-slot"><input type="radio" name="jx-auto-entry-slot" data-f="autoEntryTimeSlot" value="night"><span>17:30–次日 08:00</span></label><button type="button" data-a="clearAutoEntryTimeSlot" title="清除当天自动进入时段">关闭并清除</button></div><small data-a="autoEntryTimeState" style="display:block;color:#909399;margin-top:4px">未选择时段时沿用自动进入开关，不限制时间。</small></fieldset>
        <small style="display:block;color:#909399;margin:-3px 0 7px">进入等待为基础延迟；模拟人工会增加随机抖动。0 秒且选择“无（及时）”时不等待。</small>
        <small style="display:block;color:#909399;margin:-3px 0 7px">候选发现优先使用 WebSocket、状态计数和只读列表协议；默认每个列表补偿周期同步一次当前筛选条件下的可见表格，不会修改报告状态复选框。</small>
        <fieldset><legend>开发者模式</legend><div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><label class="jx-dev-toggle"><input type="checkbox" data-f="developerMode"> 开启开发者模式</label><button type="button" data-a="selfCheck">运行自检</button><button type="button" data-a="copyDebug">复制最近诊断记录</button><button type="button" data-a="clearDebug">清空记录</button><span data-a="debugState" style="color:#909399"></span></div><div class="jx-grid"><label>记录保留时长<select data-f="developerRetentionPreset" aria-label="记录保留时长"><option value="10">10 分钟</option><option value="30">30 分钟</option><option value="60">1 小时（默认）</option><option value="120">2 小时</option><option value="360">6 小时</option><option value="1440">24 小时</option><option value="custom">自定义分钟</option></select></label><label data-a="developerRetentionCustom" hidden>自定义分钟<input data-f="developerRetentionMinutes" type="number" min="1" max="10080" step="1" aria-label="自定义记录保留分钟"><small style="color:#909399">1–10080 分钟，最多 7 天</small></label></div><small data-a="developerRetentionHelp" style="color:#909399"></small></fieldset>
        <fieldset><legend>登录账号</legend><div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><span>当前账号：<b data-a="currentAccount">读取中</b></span><button type="button" data-a="useCurrentAccount">仅允许当前账号</button><button type="button" data-a="clearAccountLimit">清空限制</button></div><label>允许自动诊断的账号（留空不限）<input data-f="allowedAccounts" placeholder="可填账号编号或登录名，多个用逗号分隔"></label><small style="color:#909399">支持账号编号和登录名；留空时所有登录账号都启用。</small><div style="margin-top:8px;padding-top:7px;border-top:1px dashed #dcdfe6"><label><input type="checkbox" data-f="directLoginEnabled"> 未登录时启用协议登录</label><label>协议登录账号<input data-f="directLoginUsername" autocomplete="username" placeholder="账号编号"></label><label><input type="checkbox" data-f="directLoginOcrEnabled"> 使用本机 OCR 自动填写验证码</label><label>OCR 地址<input data-f="directLoginOcrEndpoint" value="http://127.0.0.1:18766/ocr" placeholder="http://127.0.0.1:18766/ocr"></label><div style="display:flex;gap:6px;margin-top:5px"><button type="button" data-a="directLoginNow">立即协议登录</button></div><small style="color:#909399">密码只在点击登录时临时输入，不写入配置。验证码优先使用本机 ddddocr，识别失败再显示手工输入。</small></div></fieldset>
        <fieldset><legend>报告/影像状态</legend><div class="jx-checks" data-group="reportStatuses"></div><div class="jx-checks" data-group="imageStatuses"></div><label class="jx-check"><input type="checkbox" data-f="skipLockedRecords" checked disabled> 检测到其他用户锁定的记录时跳过（始终开启）</label><small style="color:#909399">已锁定、占用或非待诊断报告禁止自动进入；旧配置和方案不能关闭此保护。</small></fieldset>
        <fieldset><legend>患者信息</legend><div class="jx-checks" data-group="encounterTypes"></div><div class="jx-checks" data-group="gender"></div><label class="jx-check"><input type="checkbox" data-f="ageUnlimited"> 年龄不限</label><div class="jx-grid"><label>年龄从<input data-f="ageMin" type="number"></label><label>年龄到<input data-f="ageMax" type="number"></label><label>姓名包含<input data-f="patientNameContains"></label><label>申请单号包含<input data-f="applicationNoContains"></label></div></fieldset>
        <fieldset><legend>检查与机构</legend>
          <div class="jx-checks" data-group="modalities"></div>
          <div class="jx-exam-head"><b>检查项目</b><button type="button" data-a="refreshExamOptions" title="同时更新检查项目、医院、部位、医生和申请机构选项">更新所有可选项目</button></div>
          <label>搜索可选项目<input type="search" data-a="examSearch" placeholder="输入项目名，允许与排除选项同时筛选" aria-label="搜索检查项目"></label>
          <section class="jx-exam-section"><div class="jx-exam-head"><b>允许项目</b><span data-a="examAllowedCount"></span></div><div class="jx-checks" data-group="examNames"></div><div class="jx-checks" data-group="examNamesExtra"></div></section>
          <section class="jx-exam-section jx-exam-excluded"><div class="jx-exam-head"><b>排除项目</b><span data-a="examExcludedCount"></span><button type="button" data-a="clearExamExclusions">清空排除</button></div><div class="jx-checks" data-group="examNamesExcluded"></div><div class="jx-custom-exam"><input data-a="customExcludedExam" placeholder="未列出的项目：输入完整名称" aria-label="自定义排除检查项目"><button type="button" data-a="addExamExclusion">添加并排除</button></div><small class="jx-exam-help">排除优先；允许项目“不限”时仍生效。多项检查中任一项目被排除，整条记录都跳过。按完整名称匹配，左右侧等不同名称可分别勾选。</small></section>
          <details class="jx-institution-section" open><summary>申请机构、检查医院与部位</summary><div class="jx-checks" data-group="applyInstitution"></div><div class="jx-checks" data-group="checkHospitals"></div><div class="jx-checks" data-group="bodyParts"></div></details>
          <details><summary>进入优先顺序</summary><small class="jx-exam-help">权重越大越优先；被排除的项目不会参与进入，格式为“名称=权重”，每行一项。</small><label>检查项目权重<textarea data-f="examWeights" rows="4" placeholder="头颅平扫=100&#10;肋骨平扫=10"></textarea></label><label>申请机构权重<textarea data-f="institutionWeights" rows="3" placeholder="机构名称=权重"></textarea></label><label class="jx-check"><input type="checkbox" data-f="preliminaryReportFirst"> 有结论的初写报告优先</label><small class="jx-exam-help">只识别结论字段；描述、备注不会被当作结论。没有结论的记录仍可处理，只是排序靠后。</small></details>
          <div class="jx-grid"><label>检查部位最少数量<select data-f="siteMin"><option value="">不限</option><option value="1">1 个</option><option value="2">2 个</option><option value="3">3 个</option><option value="4">4 个</option><option value="5">5 个</option></select></label><label>检查部位最多数量<select data-f="siteMax"><option value="">不限</option><option value="1">1 个</option><option value="2">2 个</option><option value="3">3 个</option><option value="4">4 个</option><option value="5">5 个</option></select></label></div><div class="jx-checks" data-group="diagnosisDoctors"></div><label>审核医生（留空不限）<input data-f="auditDoctors"></label>
        </fieldset>
        <fieldset><legend>申请时间</legend><div class="jx-grid"><label>快捷范围<select data-f="applicationTimeMode"><option value="window">最近 5–30 分钟</option><option value="all">不限</option><option value="today">当天</option><option value="recent">最近 N 天</option><option value="fromTime">当天从指定时间</option></select></label><label>最早分钟<input data-f="applicationTimeMin" type="number" min="0" step="1"></label><label>最晚分钟<input data-f="applicationTimeMax" type="number" min="1" step="1"></label><label>最近天数<input data-f="applicationTimeDays" type="number" min="0" step="1"></label><label>开始时间<input data-f="applicationTimeStart" type="time"></label></div><small style="color:#909399">“最近 5–30 分钟”表示 5 分钟内不处理，超过 30 分钟也不处理。</small></fieldset>
        <details><summary>诊断/审核时间（通常不用，默认不限）</summary><div class="jx-grid"><label>诊断时间模式<select data-f="diagnosisTimeMode"><option value="all">不限</option><option value="today">当天</option><option value="recent">最近 N 天</option><option value="fromTime">当天从指定时间</option></select></label><label>诊断最近天数<input data-f="diagnosisTimeDays" type="number" min="0"></label><label>诊断开始时间<input data-f="diagnosisTimeStart" type="time"></label><label>审核时间模式<select data-f="auditTimeMode"><option value="all">不限</option><option value="today">当天</option><option value="recent">最近 N 天</option><option value="fromTime">当天从指定时间</option></select></label><label>审核最近天数<input data-f="auditTimeDays" type="number" min="0"></label><label>审核开始时间<input data-f="auditTimeStart" type="time"></label></div></details>
        <details><summary>高级：表格选择器与操作按钮</summary><label>诊断操作图标序号<input data-f="diagnoseOperatorIndex" type="number" min="0" style="width:60px"></label><label>待诊断状态值<input data-f="pendingStatusValue"></label><label>表格行选择器<input data-f="bodyRows"></label><label>操作项选择器<input data-f="operatorItems"></label></details>
        <div class="jx-panel-actions" style="display:flex;gap:7px;margin-top:10px"><button type="button" data-a="apply" style="background:#409eff;color:white;border:0;border-radius:4px;padding:7px 14px">应用并保存</button><button type="button" data-a="reset">恢复默认</button><button type="button" data-a="export">导出配置</button><button type="button" data-a="import">导入配置</button><span data-a="msg" style="color:#67c23a;align-self:center"></span></div>
      </div>`;
    document.body.appendChild(box);
     const style = document.createElement('style'); style.textContent = '#jx-auto-diagnose-panel .jx-panel-header{position:sticky;top:0;z-index:3;flex:0 0 auto;box-shadow:0 1px 5px #0002}#jx-auto-diagnose-panel .jx-panel-content{overscroll-behavior:contain}#jx-auto-diagnose-panel .jx-panel-actions{position:sticky;bottom:0;z-index:2;background:#fff;padding:8px 0 2px;box-shadow:0 -1px 5px #0001}#jx-auto-diagnose-panel fieldset{border:1px solid #dcdfe6;border-radius:6px;margin:7px 0;padding:7px}#jx-auto-diagnose-panel legend{padding:0 4px;color:#409eff}#jx-auto-diagnose-panel label{display:block;margin:4px 0}#jx-auto-diagnose-panel input,#jx-auto-diagnose-panel select,#jx-auto-diagnose-panel textarea{box-sizing:border-box;padding:4px;border:1px solid #dcdfe6;border-radius:4px;margin-top:2px;width:100%;font:inherit}#jx-auto-diagnose-panel .jx-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}#jx-auto-diagnose-panel .jx-checks{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin:4px 0}#jx-auto-diagnose-panel .jx-check{display:inline-flex;align-items:center;gap:3px;margin:0;color:#606266}#jx-auto-diagnose-panel .jx-check input{width:auto;margin:0}#jx-auto-diagnose-panel .jx-group-label{color:#909399;margin-right:3px}#jx-auto-diagnose-panel .jx-exam-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;color:#909399}#jx-auto-diagnose-panel .jx-exam-head button{padding:3px 8px;color:#409eff;border-color:#b3d8ff;background:#ecf5ff}#jx-auto-diagnose-panel button{border:1px solid #c0c4cc;background:#fff;border-radius:4px;padding:5px 8px;cursor:pointer}#jx-auto-diagnose-panel button:focus-visible{outline:2px solid #409eff;outline-offset:1px}#jx-auto-diagnose-panel [data-a="close"]{min-width:34px;min-height:30px}#jx-auto-diagnose-panel .jx-dev-toggle{display:inline-flex;align-items:center;gap:4px;color:#e6a23c;font-weight:600}#jx-auto-diagnose-panel .jx-dev-toggle input{width:auto;margin:0}#jx-auto-diagnose-panel .jx-time-slots{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}#jx-auto-diagnose-panel .jx-time-slot{display:inline-flex;align-items:center;gap:4px;margin:0;padding:4px 7px;border:1px solid #dcdfe6;border-radius:4px;cursor:pointer;color:#606266}#jx-auto-diagnose-panel .jx-time-slot:has(input:checked){border-color:#409eff;color:#409eff;background:#ecf5ff}#jx-auto-diagnose-panel .jx-time-slot input{width:auto;margin:0}'; box.appendChild(style);
    style.textContent += '#jx-auto-diagnose-panel [hidden]{display:none!important}';
    style.textContent += '#jx-auto-diagnose-panel .jx-exam-section{padding:7px 9px;border:1px solid #dcdfe6;border-radius:6px;margin:7px 0;background:#fafcff}#jx-auto-diagnose-panel .jx-exam-section .jx-checks{max-height:180px;overflow:auto;padding:3px 0}#jx-auto-diagnose-panel .jx-exam-section .jx-exam-head{margin:0 0 5px;color:#606266}#jx-auto-diagnose-panel .jx-exam-excluded{border-color:#f3d19e;background:#fdf6ec}#jx-auto-diagnose-panel .jx-exam-excluded b{color:#b36b00}#jx-auto-diagnose-panel .jx-custom-exam{display:flex;align-items:center;gap:7px;margin:8px 0}#jx-auto-diagnose-panel .jx-custom-exam input{flex:1;min-width:0}#jx-auto-diagnose-panel .jx-custom-exam button{flex:0 0 auto}#jx-auto-diagnose-panel .jx-exam-help{display:block;color:#909399;margin-top:5px}#jx-auto-diagnose-panel details{margin:7px 0}#jx-auto-diagnose-panel summary{cursor:pointer;color:#606266;padding:4px 0}#jx-auto-diagnose-panel [data-a="examAllowedCount"],#jx-auto-diagnose-panel [data-a="examExcludedCount"]{color:#909399;font-size:12px}';
    const f = n => box.querySelector(`[data-f="${n}"]`);
    const GROUPS = { reportStatuses: ['不限','待诊断','诊断中','待审核','审核中','已审核','已打印'], imageStatuses: ['不限','正常','异常'], encounterTypes: ['不限','门诊','急诊','住院','体检'], gender: ['不限','男','女'], modalities: ['不限','CT','MR','DR','DSA','乳腺'], examNames: ['不限', ...DEFAULT_CONFIG.examNames], examNamesExtra: [], examNamesExcluded: [], checkHospitals: [], bodyParts: [], diagnosisDoctors: [] };
    const DYNAMIC_GROUP_FIELDS = { checkHospitals: 'hospital', bodyParts: 'bodyPart', diagnosisDoctors: 'diagnosisDoctor' };
    function availableExamOptions() {
      const fromRows = queryBodyRows().flatMap(row => {
        const value = rowData(row).exam;
        return String(value || '').split(config.examSeparators).map(norm).filter(Boolean);
      });
      return buildExamOptionCatalog(config, fromRows);
    }
    function drawGroups() {
      for (const [name, baseOptions] of Object.entries(GROUPS)) {
        const commonExams = normalizeExamNameList([...DEFAULT_CONFIG.examNames, ...normalizeExamNameList(config.examNames)]);
        let options = name === 'examNames' ? ['不限', ...commonExams] : name === 'examNamesExtra' ? availableExamOptions().filter(x => !commonExams.includes(x)) : name === 'examNamesExcluded' ? ['无排除', ...availableExamOptions()] : baseOptions;
        if (DYNAMIC_GROUP_FIELDS[name]) {
          const current = queryBodyRows().map(rowData).map(d => d[DYNAMIC_GROUP_FIELDS[name]]).filter(Boolean);
          options = ['不限', ...new Set([...(config[name] || []), ...(config.columnOptionsCatalog?.[name] || []), ...current].map(norm).filter(Boolean))];
        }
        const host = box.querySelector(`[data-group="${name}"]`); if (!host) continue;
        const label = {reportStatuses:'报告状态',imageStatuses:'影像状态',encounterTypes:'就诊类型',gender:'性别',modalities:'检查类型',examNames:'常用项目',examNamesExtra:'更多项目',examNamesExcluded:'跳过项目',checkHospitals:'检查医院',bodyParts:'检查部位',diagnosisDoctors:'诊断医生'}[name];
        host.innerHTML = `<span class="jx-group-label">${label}：</span>` + options.map(x => `<label class="jx-check"><input type="checkbox" data-group-name="${name}" value="${esc(x)}"><span>${esc(x)}</span></label>`).join('');
      }
      const values = [...new Set([...(config.applyInstitution || []), ...(config.columnOptionsCatalog?.applyInstitution || []), ...queryBodyRows().map(rowData).map(d => d.institution).filter(Boolean)])];
      const host = box.querySelector('[data-group="applyInstitution"]');
      if (host) host.innerHTML = '<span class="jx-group-label">申请机构：</span>' + ['不限', ...values].map(x => `<label class="jx-check"><input type="checkbox" data-group-name="applyInstitution" value="${esc(x)}"><span>${esc(x === '不限' ? '不限申请机构' : x)}</span></label>`).join('');
      box.querySelectorAll('input[data-group-name]').forEach(check => check.addEventListener('change', () => {
        const group = check.dataset.groupName;
        const peers = [...box.querySelectorAll(`input[data-group-name="${group}"]`)];
        const sentinel = group === 'examNamesExcluded' ? '无排除' : '不限';
        const unlimited = peers.find(item => item.value === sentinel);
        if (check.checked && check.value === sentinel) {
          peers.forEach(item => { if (item !== check) item.checked = false; });
          // “检查项目不限”必须同时清除此前保存在“可选项目”组里的旧勾选。
          // 否则 examNames 为空但 examNamesExtra 仍有值，运行时会继续过滤，
          // 用户看到的“不限”与实际规则不一致。
          if (group === 'examNames') {
            box.querySelectorAll('[data-group-name="examNamesExtra"]').forEach(item => { item.checked = false; });
          }
        }
        if (check.checked && check.value !== sentinel && unlimited) unlimited.checked = false;
        if (group === 'examNamesExtra' && check.checked) {
          const allowAll = box.querySelector('[data-group-name="examNames"][value="不限"]'); if (allowAll) allowAll.checked = false;
        }
        if (group === 'examNames' || group === 'examNamesExtra') {
          const allowAll = box.querySelector('[data-group-name="examNames"][value="不限"]');
          const selected = [...box.querySelectorAll('[data-group-name="examNames"], [data-group-name="examNamesExtra"]')].some(item => item.value !== '不限' && item.checked);
          if (allowAll) allowAll.checked = !selected;
        }
        if (group === 'examNamesExcluded') {
          const hasExclusions = peers.some(item => item.value !== sentinel && item.checked);
          if (unlimited) unlimited.checked = !hasExclusions;
        }
        refreshExamUI();
      }));
    }
    function setGroup(name, values) { const selected = new Set(values || []); const sentinel = name === 'examNamesExcluded' ? '无排除' : '不限'; box.querySelectorAll(`[data-group-name="${name}"]`).forEach(c => { c.checked = selected.has(c.value) || (c.value === sentinel && !values?.length); }); }
    function getGroup(name) { const all = [...box.querySelectorAll(`[data-group-name="${name}"]:checked`)].map(x => x.value); return all.includes(name === 'examNamesExcluded' ? '无排除' : '不限') ? [] : all; }
    function refreshExamUI() {
      const allowed = [...getGroup('examNames'), ...getGroup('examNamesExtra')];
      box.querySelector('[data-a="examAllowedCount"]').textContent = allowed.length ? `已选 ${allowed.length} 项` : '不限';
      const excluded = getGroup('examNamesExcluded');
      box.querySelector('[data-a="examExcludedCount"]').textContent = excluded.length ? `已排除 ${excluded.length} 项` : '未排除项目';
      const search = norm(box.querySelector('[data-a="examSearch"]').value).toLocaleLowerCase();
      for (const name of ['examNames', 'examNamesExtra', 'examNamesExcluded']) {
        box.querySelectorAll(`[data-group-name="${name}"]`).forEach(input => {
          const sentinel = input.value === '不限' || input.value === '无排除';
          const host = input.closest('label'); if (host) host.hidden = !sentinel && !!search && !norm(input.value).toLocaleLowerCase().includes(search);
        });
      }
    }
    function render() {
      drawGroups();
      const scheduleState = autoEntryScheduleState();
      if (scheduleState.expired) clearExpiredAutoEntrySchedule(scheduleState);
      f('enabled').checked = !!config.enabled; f('monitoringEnabled').checked = isMonitoringEnabled(); f('developerMode').checked = !!config.developerMode; f('pageQueryRefresh').checked = !!config.pageQueryRefresh; f('skipLockedRecords').checked = true; f('pollMs').value = config.pollMs; f('statusProbeMs').value = config.statusProbeMs || 5000; f('listHeartbeatMs').value = config.listHeartbeatMs || 15000; f('clickDelayMs').value = config.clickDelayMs; f('entryDelaySeconds').value = Math.max(0, Number(config.entryDelaySeconds) || 0); f('humanizeEntryLevel').value = String(Math.max(0, Math.min(3, Number(config.humanizeEntryLevel) || 0)));
      box.querySelectorAll('input[data-f="autoEntryTimeSlot"]').forEach(input => { input.checked = input.value === (config.autoEntrySchedule?.slot || ''); });
      const scheduleStateText = box.querySelector('[data-a="autoEntryTimeState"]'); if (scheduleStateText) scheduleStateText.textContent = autoEntryScheduleText();
      refreshAutoEntryScheduleUI();
      const debugState = box.querySelector('[data-a="debugState"]'); if (debugState) debugState.textContent = developerModeStateText();
      refreshDeveloperRetentionUI();
      const currentAccount = box.querySelector('[data-a="currentAccount"]'); if (currentAccount) currentAccount.textContent = accountDisplay();
      f('allowedAccounts').value = listValue(config.allowedAccounts);
      f('directLoginEnabled').checked = !!directLoginConfig().enabled; f('directLoginUsername').value = directLoginConfig().username || ''; f('directLoginOcrEnabled').checked = directLoginConfig().ocrEnabled !== false; f('directLoginOcrEndpoint').value = directLoginConfig().ocrEndpoint || 'http://127.0.0.1:18766/ocr';
      f('entryMode').value = config.entryMode || 'protocol-first';
      for (const n of ['reportStatuses','imageStatuses','encounterTypes','gender','modalities','examNames','examNamesExtra','examNamesExcluded','checkHospitals','bodyParts','diagnosisDoctors']) setGroup(n, config[n]);
      const allowAll = box.querySelector('[data-group-name="examNames"][value="不限"]'); if (allowAll) allowAll.checked = !(config.examNames?.length || config.examNamesExtra?.length);
      refreshExamUI();
      setGroup('applyInstitution', config.applyInstitution);
      f('ageUnlimited').checked = !!config.age.unlimited; f('ageMin').value = config.age.min ?? ''; f('ageMax').value = config.age.max ?? ''; f('patientNameContains').value = config.patientNameContains || ''; f('applicationNoContains').value = config.applicationNoContains || '';
      f('examWeights').value = listValue(config.examWeights).replace(/, /g, '\n'); f('institutionWeights').value = listValue(config.institutionWeights).replace(/, /g, '\n'); f('preliminaryReportFirst').checked = config.preliminaryReportFirst !== false;
      f('auditDoctors').value = listValue(config.auditDoctors); f('siteMin').value = config.examSiteCount?.min ?? ''; f('siteMax').value = config.examSiteCount?.max ?? '';
      f('applicationTimeMode').value = config.applicationTime.mode; f('applicationTimeMin').value = config.applicationTime.minMinutes ?? 5; f('applicationTimeMax').value = config.applicationTime.maxMinutes ?? 30; f('applicationTimeDays').value = config.applicationTime.days ?? ''; f('applicationTimeStart').value = config.applicationTime.start || '00:00';
      f('diagnosisTimeMode').value = config.diagnosisTime.mode; f('diagnosisTimeDays').value = config.diagnosisTime.days ?? ''; f('diagnosisTimeStart').value = config.diagnosisTime.start || '00:00'; f('auditTimeMode').value = config.auditTime.mode; f('auditTimeDays').value = config.auditTime.days ?? ''; f('auditTimeStart').value = config.auditTime.start || '00:00';
      f('diagnoseOperatorIndex').value = config.selectors.diagnoseOperatorIndex; f('pendingStatusValue').value = config.pendingStatusValue; f('bodyRows').value = config.selectors.bodyRows; f('operatorItems').value = config.selectors.operatorItems;
      const ps = profiles(); f('profile').innerHTML = '<option value="">选择已保存方案</option>' + Object.keys(ps).sort().map(x => `<option>${esc(x)}</option>`).join('');
    }
    function read() {
      config.enabled = f('enabled').checked; config.monitoringEnabled = f('monitoringEnabled').checked; config.developerMode = f('developerMode').checked; config.pageQueryRefresh = f('pageQueryRefresh').checked; config.skipLockedRecords = true; config.pollMs = Math.max(1000, Number(f('pollMs').value) || 2000); config.statusProbeMs = Math.max(3000, Number(f('statusProbeMs').value) || 5000); config.listHeartbeatMs = Math.max(10000, Number(f('listHeartbeatMs').value) || 15000); config.clickDelayMs = Number(f('clickDelayMs').value) || 0; config.entryDelaySeconds = Math.max(0, Math.min(300, Number(f('entryDelaySeconds').value) || 0)); config.humanizeEntryLevel = Math.max(0, Math.min(3, Number(f('humanizeEntryLevel').value) || 0)); config.entryMode = f('entryMode').value || 'protocol-first';
      // 日期授权仅在点击时段时生成；保存其它选项不能把昨日授权延长到今天。
      if (autoEntryScheduleState().requiresSelection) config.enabled = false;
      config.allowedAccounts = parseList(f('allowedAccounts').value);
      config.directLogin = { enabled: f('directLoginEnabled').checked, username: f('directLoginUsername').value.trim(), ocrEnabled: f('directLoginOcrEnabled').checked, ocrEndpoint: f('directLoginOcrEndpoint').value.trim() || 'http://127.0.0.1:18766/ocr' };
      for (const n of ['reportStatuses','imageStatuses','encounterTypes','gender','modalities','examNames','examNamesExtra','examNamesExcluded','checkHospitals','bodyParts','diagnosisDoctors']) config[n] = getGroup(n);
      // 兼容旧配置：选择过“不限”后，旧版本可能留下 examNamesExtra。
      // 以界面上的“不限”勾选为最终语义，保证实际请求和界面一致。
      const examUnlimited = box.querySelector('[data-group-name="examNames"][value="不限"]')?.checked;
      if (examUnlimited) { config.examNames = []; config.examNamesExtra = []; }
      config.applyInstitution = getGroup('applyInstitution'); config.auditDoctors = parseList(f('auditDoctors').value);
      config.age.unlimited = f('ageUnlimited').checked; config.age.min = config.age.unlimited || f('ageMin').value === '' ? null : Number(f('ageMin').value); config.age.max = config.age.unlimited || f('ageMax').value === '' ? null : Number(f('ageMax').value); config.patientNameContains = f('patientNameContains').value.trim(); config.applicationNoContains = f('applicationNoContains').value.trim(); config.examWeights = parseList(f('examWeights').value.replace(/\n/g, ',')); config.institutionWeights = parseList(f('institutionWeights').value.replace(/\n/g, ',')); config.preliminaryReportFirst = f('preliminaryReportFirst').checked; config.examSiteCount = { min: f('siteMin').value === '' ? null : Number(f('siteMin').value), max: f('siteMax').value === '' ? null : Number(f('siteMax').value) };
      config.applicationTime = { mode: f('applicationTimeMode').value, minMinutes: Number(f('applicationTimeMin').value) || 0, maxMinutes: Number(f('applicationTimeMax').value) || 0, days: Number(f('applicationTimeDays').value) || 0, start: f('applicationTimeStart').value || '00:00' }; config.diagnosisTime = { mode: f('diagnosisTimeMode').value, days: Number(f('diagnosisTimeDays').value) || 0, start: f('diagnosisTimeStart').value || '00:00' }; config.auditTime = { mode: f('auditTimeMode').value, days: Number(f('auditTimeDays').value) || 0, start: f('auditTimeStart').value || '00:00' };
      config.pendingStatusValue = f('pendingStatusValue').value.trim() || '102501'; config.selectors.diagnoseOperatorIndex = Number(f('diagnoseOperatorIndex').value) || 0; config.selectors.bodyRows = f('bodyRows').value.trim() || DEFAULT_CONFIG.selectors.bodyRows; config.selectors.operatorItems = f('operatorItems').value.trim() || DEFAULT_CONFIG.selectors.operatorItems;
    }
    const msg = t => { const el = box.querySelector('[data-a="msg"]'); if (!el) return; el.textContent = t; setTimeout(() => { const current = box.querySelector('[data-a="msg"]'); if (current) current.textContent = ''; }, 1800); };
    box.querySelector('[data-a="apply"]').onclick = () => { read(); saveConfig(); scheduleAutoEntryScheduleExpiry(); start(); msg('已保存并应用'); };
    box.querySelectorAll('input[data-f="autoEntryTimeSlot"]').forEach(input => input.addEventListener('click', () => {
      if (!setAutoEntrySchedule(input.value)) {
        refreshAutoEntryScheduleUI();
        return msg('该时段今天已结束，请选择其它时段');
      }
      saveConfig();
      scheduleAutoEntryScheduleExpiry();
      refreshAutoEntryScheduleUI();
      developerLog('自动进入时段选择', { source: 'settings', ...config.autoEntrySchedule }, { force: true });
      msg('时段已保存，自动进入已开启');
    }));
    box.querySelector('[data-a="clearAutoEntryTimeSlot"]').onclick = () => {
      config.autoEntrySchedule = { slot: '', date: '', requiresSelection: true };
      config.enabled = false;
      saveConfig();
      scheduleAutoEntryScheduleExpiry();
      render();
      msg('自动进入已关闭，请重新选择时段');
    };
    box.querySelector('[data-f="developerMode"]').onchange = () => { config.developerMode = f('developerMode').checked; saveConfig(); const state = box.querySelector('[data-a="debugState"]'); if (state) state.textContent = developerModeStateText(); if (config.developerMode) developerLog('开发者模式开启', { source: 'settings' }, { force: true }); };
    box.querySelector('[data-f="developerRetentionPreset"]').onchange = () => {
      const preset = f('developerRetentionPreset').value;
      if (preset === 'custom') { const custom = box.querySelector('[data-a="developerRetentionCustom"]'); if (custom) custom.hidden = false; f('developerRetentionMinutes').focus(); return; }
      setDeveloperRetentionMinutes(preset); msg('保留时长已保存');
    };
    box.querySelector('[data-f="developerRetentionMinutes"]').onchange = () => { setDeveloperRetentionMinutes(f('developerRetentionMinutes').value); msg('保留时长已保存'); };
    box.querySelector('[data-a="copyDebug"]').onclick = async () => { try { await navigator.clipboard?.writeText(developerLogText()); msg(debugEvents.length ? '诊断记录已复制' : '当前没有诊断记录'); } catch (_) { msg('复制失败，请打开控制台查看'); } };
    box.querySelector('[data-a="clearDebug"]').onclick = () => { clearDeveloperEvents(); const state = box.querySelector('[data-a="debugState"]'); if (state) state.textContent = developerModeStateText(); msg('诊断记录已清空'); };
    box.querySelector('[data-a="selfCheck"]').onclick = async () => { msg('正在运行自检…'); const result = await runSelfCheck(); alert(result); msg('自检完成'); };
    box.querySelector('[data-a="useCurrentAccount"]').onclick = () => { const identity = loginIdentity(); const value = identity.loginCode || identity.name; if (!value) return msg('当前账号暂未识别'); f('allowedAccounts').value = value; msg('已填入当前账号'); };
    box.querySelector('[data-a="clearAccountLimit"]').onclick = () => { f('allowedAccounts').value = ''; msg('已清空账号限制'); };
    box.querySelector('[data-a="directLoginNow"]').onclick = async () => { read(); saveConfig(); msg('正在协议登录…'); const ok = await ensureDirectLogin(); msg(ok ? '协议登录成功' : '协议登录未完成'); if (ok) { render(); start(); } };
    box.querySelector('[data-a="examSearch"]').oninput = refreshExamUI;
    box.querySelector('[data-a="clearExamExclusions"]').onclick = () => {
      read(); config.examNamesExcluded = []; saveConfig(); setGroup('examNamesExcluded', []); refreshExamUI(); msg('已清空排除项目');
    };
    box.querySelector('[data-a="addExamExclusion"]').onclick = () => {
      const input = box.querySelector('[data-a="customExcludedExam"]');
      const names = normalizeExamNameList(input.value);
      if (!names.length) { input.focus(); return msg('请输入完整检查项目名'); }
      read();
      config.examNamesExcluded = normalizeExamNameList([...config.examNamesExcluded, ...names]);
      config.examNamesCatalog = buildExamOptionCatalog(config, names);
      saveConfig(); render(); input.value = ''; input.focus(); msg(`已添加并排除 ${names.length} 项`);
    };
    box.querySelector('[data-a="customExcludedExam"]').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); box.querySelector('[data-a="addExamExclusion"]').click(); }
    });
    box.querySelector('[data-a="refreshExamOptions"]').onclick = async () => {
      read();
      msg('正在更新可选项目…');
      const records = await fetchRadiationRecords({ pageSize: 100, timeoutMs: 8000, ignoreApplicationTime: true, ignoreStatusFilter: true, ignoreModalityFilter: true, ignoreInstitutionFilter: true, ignoreBodyPartFilter: true });
      const fromApi = records.flatMap(record => String(record?.examName || record?.exam || '').split(config.examSeparators).map(norm).filter(Boolean));
      const options = buildExamOptionCatalog(config, [...availableExamOptions(), ...fromApi]);
      config.examNamesCatalog = options;
      const dynamic = {
        checkHospitals: records.map(record => record?.checkOrgName || record?.checkOrg),
        bodyParts: records.map(record => record?.bodyPartName || record?.bodyPart || record?.checkPartName || record?.checkPart),
        diagnosisDoctors: records.map(record => record?.reportDoc),
        applyInstitution: records.map(record => record?.applyOrgName || record?.applyOrg)
      };
      config.columnOptionsCatalog = config.columnOptionsCatalog || {};
      for (const [name, values] of Object.entries(dynamic)) {
        config.columnOptionsCatalog[name] = [...new Set([...(config.columnOptionsCatalog[name] || []), ...values.map(norm).filter(Boolean)])];
      }
      saveConfig();
      render();
      const dynamicCount = Object.values(dynamic).flat().map(norm).filter(Boolean).length;
      msg(`已更新 ${options.length + dynamicCount} 个可选项目`);
    };
    box.querySelector('[data-a="reset"]').onclick = () => { config = configWithCurrentEntrySchedule(DEFAULT_CONFIG); saveConfig(); render(); start(); msg('已恢复默认筛选，时段保持当前选择'); };
    box.querySelector('[data-a="saveProfile"]').onclick = () => { read(); const n = f('profileName').value.trim(); if (!n) return msg('请填写方案名'); const p = profiles(); p[n] = config; saveProfiles(p); render(); f('profile').value = n; msg('方案已保存'); };
    box.querySelector('[data-a="loadProfile"]').onclick = () => { const n = f('profile').value; const p = profiles(); if (!n || !p[n]) return msg('请选择方案'); config = configWithCurrentEntrySchedule(p[n]); saveConfig(); render(); start(); msg('方案已切换，时段保持当前选择'); };
    box.querySelector('[data-a="deleteProfile"]').onclick = () => { const n = f('profile').value; const p = profiles(); if (n && p[n]) { delete p[n]; saveProfiles(p); render(); msg('方案已删除'); } };
    box.querySelector('[data-a="export"]').onclick = async () => { await navigator.clipboard?.writeText(JSON.stringify(config, (k, v) => v instanceof RegExp ? { __regexp: v.source } : v, 2)); msg('配置 JSON 已复制'); };
    box.querySelector('[data-a="import"]').onclick = () => { const s = prompt('粘贴配置 JSON'); if (!s) return; try { const n = JSON.parse(s); if (n.examSeparators?.__regexp) n.examSeparators = new RegExp(n.examSeparators.__regexp); config = configWithCurrentEntrySchedule(n); saveConfig(); render(); start(); msg('已导入，时段保持当前选择'); } catch (e) { msg('JSON 无效'); } };
    box.querySelector('[data-a="close"]').onclick = () => box.remove();
    box.addEventListener('change', event => {
      const target = event.target;
      if (!target?.matches?.('input[data-f], select[data-f], textarea[data-f], input[data-group-name]')) return;
      if (['autoEntryTimeSlot', 'developerMode', 'developerRetentionPreset', 'developerRetentionMinutes', 'profile', 'profileName'].includes(target.dataset.f)) return;
      read(); saveConfig(); scheduleAutoEntryScheduleExpiry(); msg('已自动保存');
    });
    render();
  }

  function attachToHeaderSettings() {
    if (pageWindow().location.pathname !== '/radiation') return;
    const trigger = document.querySelector('.table-header-setting-btn, .el-table__header-wrapper .column-setting, .el-table__header-wrapper [data-column-setting]');
    if (!trigger || trigger.dataset.jxAutoBound) return;
    trigger.dataset.jxAutoBound = '1';
    trigger.addEventListener('click', () => setTimeout(() => {
      const title = document.querySelector('.table-header-setting-wrap__title, .el-popover__title, .el-dialog__header');
      if (!title || title.querySelector('[data-jx-auto-entry]')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.jxAutoEntry = '1'; b.textContent = '⚙ 自动诊断设置';
      b.style.cssText = 'margin-left:10px;padding:3px 8px;border:1px solid #409eff;border-radius:4px;background:#ecf5ff;color:#409eff;cursor:pointer;font:12px Segoe UI,Microsoft Yahei,sans-serif';
      b.addEventListener('click', panel); title.appendChild(b);
    }, 80));
  }

  GM_registerMenuCommand('自动诊断：配置', panel);
  GM_registerMenuCommand('自动诊断：启用/停用', () => {
    isAutoOpenEnabled();
    if (autoEntryScheduleState().requiresSelection) { panel(); return; }
    config.enabled = !config.enabled; saveConfig(); refreshAutoEntryScheduleUI();
    console.info('[自动诊断] enabled =', config.enabled);
  });
  window.addEventListener('beforeunload', () => {
    stopRuntime('beforeunload');
    flushDeveloperEvents();
    if (debugCleanupTimer) clearInterval(debugCleanupTimer);
    if (routeWatchTimer) clearInterval(routeWatchTimer);
    if (loginRecoveryTimer) clearTimeout(loginRecoveryTimer);
    if (autoEntryScheduleTimer) clearTimeout(autoEntryScheduleTimer);
    if (timer) clearInterval(timer);
    if (probeTimer) clearTimeout(probeTimer);
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    if (autoQueryFallbackTimer) clearTimeout(autoQueryFallbackTimer);
    if (pageQueryHeartbeatTimer) clearTimeout(pageQueryHeartbeatTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onVisibilityChange);
    window.removeEventListener('popstate', watchRoute);
    window.removeEventListener('hashchange', watchRoute);
    window.removeEventListener(REALTIME_HINT_EVENT, onRealtimeHint);
    window.removeEventListener(REPORT_ENTRY_EVENT, onReportEntryObserved);
  });
  restoreAutomaticEntryHistory();
  installReportEntryBridge();
  installRealtimeHintBridge();
  scheduleAutoEntryScheduleExpiry();
