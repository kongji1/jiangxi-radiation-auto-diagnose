# GPT-6 五分钟维护入口

目标是让下一次 GPT-6 接管后，在五分钟内完成一次可信的本地维护判断，而不是先重复浏览历史对话。

## 0–30 秒：读取真相源

按顺序读取：

1. `PROJECT_STATE.json`：版本、运行态确认、待办和性能边界。
2. `docs/AI_HANDOFF.md`：最近变更和已知限制。
3. `docs/PROTOCOL.md`：接口、TOKEN_FAIL、自愈和负载边界。
4. `git status --short`：确认是否有未提交修改。

主源码唯一来源是 `jiangxi-radiation-auto-diagnose.user.js`。`reference/app-bundles` 只用于核对协议字段。

正式目录以 `PROJECT_STATE.json.projectRoot` 为准。旧会话 `G:\bu\0430` 是归档工作目录，不是本项目 Git 根；不要从那里递归扫描其它项目。当前远端仓库已存在，不要重复创建。

## 30 秒–2 分钟：自动回归

在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\gpt6-quick-maintenance.ps1 -SkipOcrHealth
```

脚本会核对源码和状态版本，执行语法、源码契约、生命周期诊断、原生失败保护和 OCR 测试。开发过程中即使工作树有修改也会输出 `READY` 并标记 `workingTree=dirty`；提交前使用 `-RequireClean` 才要求工作树干净。

## 2–4 分钟：按证据定位

若本次维护是在已打开的审核/报告页面进行，先保持“启用自动打开”关闭并开启“启用只读监控”。此组合仍收集实时提示、状态计数、只读列表、路由/会话自愈和按实际保留时长的开发者记录，但不调用 `assertAllowEnter`、不点击诊断按钮。看到“观察模式跳过自动打开”后，才能确认候选链路已到达而没有产生进入副作用。

若协议登录验证码识别失败，先运行 `tools/start-captcha-ocr.ps1`。脚本会检查 18766 是否被其它本地服务占用；出现占用提示时，用 `-Port 18767` 启动并把设置中的 OCR 地址同步改为 `http://127.0.0.1:18767/ocr`，不要让两个服务共用一个端口。

- 候选没有出现：先看 `实时推送收到`、`实时列表请求发起`、`列表请求结果`。
- 候选出现但没进入：看 `配置门禁快照`、`候选过滤`、`进入前硬门禁拒绝`、`协议进入拒绝`。
- 候选先符合规则、随后被别人进入：按同一 `lifecycleKey` 串联 `候选首次观察`、`候选等待进入`、`协议进入开始`、`协议进入拒绝`、`候选被其他用户占用` 或 `候选未在后续列表出现`；重点比较 `firstSeenAt`、`eligibleAt`、`dispatchDelayMs`、`durationMs`、前后 `status/statusCode/locked/doctor`。
- 返回 2002：看 `认证上下文` 和 `协议响应认证上下文`，只比较存在性、长度、短哈希和请求路径，不读取原始凭证。
- 页面列表晚更新：区分协议列表结果、页面查询心跳和 DOM 行状态，不能把手工刷新时间当成候选首次出现时间。
- 报告锁定：锁定保护始终开启，发现锁定或非待诊断立即跳过，不能用页面点击绕过。
- 退出后又自动进入：先用姓名读取候选时间线，同时看 automaticEntrySummary；每份报告的持久进入记录与开发者日志清理独立。没有稳定报告编号或不能唯一对应时不自动进入。
- 检查排除：查看配置门禁快照中的 examNamesExcluded 及“检查项目排除”原因；允许“不限”仍受排除约束。

开发者日志默认开启，浏览器本地默认保留最近 1 小时完整候选事件，可在开发者设置中自定义时长，每分钟清理一次并回写 `GM_*`；认证原文、密码和可复用凭证不保存。

## 4–5 分钟：修改与交付

1. 只修改主脚本和对应测试/文档。
2. 递增 `@version`，同步 `PROJECT_STATE.json`、README、变更记录和验证记录。
3. 重跑 `gpt6-quick-maintenance.ps1 -RequireClean`。
4. GitHub 发布必须同时证明仓库存在、Raw 可读、Raw 版本一致、Tampermonkey 已加载；缺一项只能报告为未完成发布。

在已有 Edge 9333 会话中，运行项目根目录的更新器即可隐藏保存同一脚本；只重新加载列表页。运行版本与排除控件可用 tools/verify-radiation-runtime-cdp.py --check-settings 读回；--exclude-exam "完整项目名" 可在真实设置中勾选并保存。诊断页不强制刷新。

当前 EDW 的 MCP PATH Python 不含 `websocket-client`，浏览器核验使用已安装依赖的 `G:\Program Files\Python311\python.exe -B tools/verify-radiation-runtime-cdp.py --check-settings`。不要为版本核验重新安装业务脚本、刷新报告或读取报告正文。控制台启动事件被挤出时，核验器只接受当前活跃执行上下文已见 writer 对应的本地启动记录；不能用任意历史记录替代。默认还要求版本等于 `PROJECT_STATE.json.version`。

两个 PowerShell 入口现在逐项检查原生命令退出码，包括语法、登录、生命周期、失败注入、Python 和 Git。`READY` 只表示本地回归通过；`runtimeRecorded` 是历史字段，不代表本次已核验浏览器。未传 `-SkipOcrHealth` 时还要求 5 秒内确认服务身份为 `captcha-ocr`。

## 不可简化的边界

- 不把 HTTP 200 当成业务成功，必须检查业务 `code`。
- `2002/TOKEN_FAIL` 不等于没有候选，也不能无限重试。
- 不用高频完整列表轮询替代 WebSocket、statusNum 和低频补偿。
- 不把源码版本当成 Tampermonkey 已加载版本。
- 不把患者信息、Cookie、Authorization、密码写入源码、文档、提交或外部服务。
