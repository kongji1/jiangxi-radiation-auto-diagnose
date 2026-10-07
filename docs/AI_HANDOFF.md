# AI 接管交接记录

> 目的：让下一次接管本项目的 AI 可以从当前状态继续，不需要重新猜测业务接口、脚本版本或已验证/未验证的事实。

## 0.8.55 当前源码补充（2026-10-07）

- 当前源码为 `0.8.55`。严格待诊断、排除项目和强制锁定门禁通过后，先调用只读 `assertAllowEnter`；原生 Vue router、当前医生身份和响应交接能力均可用时，再在导航前只发一次最终 `POST /api/ct/rays/rep/enter`。最终响应的诊断医生须与当前登录医生精确匹配，返回编号、状态及会话不能矛盾；其它用户锁定明确拒绝后按报告持久阻断，不导航、点击或解锁。
- 最终 POST 发出前持久保存消费记录；业务成功先确认取得，完整业务响应只驻页面内存，再通过 Vue router 交给当前报告页原生 XHR/fetch 消费一次。交接要求报告、payload、账号、会话和工作站一致，原生表单继续处理完整响应；提前请求旁听事件只记取得阶段，当前报告页消费后的原生最终事件才确认页面载入。
- 最终 POST 禁用认证重试。HTTP、网络、解析或医生归属无法确认时保留防重，不重试或回退点击，并保存关闭自动打开，提示核对当前诊断任务后再启用；取得后遇到完整路由/会话变化、授权截止、交接失败或导航取消/异常，同样保留已取得记录、清理可用交接票据并暂停自动打开，阻止继续取得下一份。已确认取得但原生交接消费异常/拒绝也暂停并保留记录。明确业务拒绝或其它用户锁定拒绝才允许继续选择其它候选。
- 实时窄列表空闲首条提示立即调度；频繁提示保留 250ms 合并边界和首次提示时间。列表在途时保存线索，由请求 `finally` 唤醒，仍遵守 500ms 实时请求冷却与普通列表低频补偿。
- 提前 POST 前确认原生 Pinia 登录码与会话 Cookie 一致，工作站须为与 Cookie 严格匹配的字符串；不能确认时回退原生进入。已暂存的同一交接票据若原生请求头异常，会本地失败，不再发网络 POST。
- 最终本地入口 49 项、响应交接 28 项、实时队列 17 项及 107 项源码契约检查通过，全量维护输出 `READY`。最终整包已再次无感保存并实际加载 `0.8.55`，当前启动时间 `2026-10-07T04:07:58.514Z`；源码与安装源码按 LF 计算的 SHA-256 严格一致：`e00c54332866974742a87b754bb99447070698216d0f8b21621df444ccf3e47a`。交接桥、会话准备和原生观察桥均 ready，Pinia 登录码/工作站与 Cookie 严格一致，扩展 options 遗留目标为 0。
- 最终重载抽查日志 129/129 条保留，所有配置指纹一致，用户已选择午班并开启自动打开，重载后保持。初次重载跨过 12:00 时，旧运行版本按早班截止正常关闭，日志 112/112 条保留；当时仅 enabled/schedule 因到期变化。已有其它医生锁定拒绝已恢复为 consumed 记录，`otherOwnerBlocked=1`、`confirmed=0`。
- 当前还没有真实新候选的提前取得事件，临床正常载入与一次真实网络最终 POST 尚未验证；GitHub `main` 已发布 `0.8.55`，canonical Raw 与安装/本地源码 SHA-256 一致；源码提交 `a236462` 的 Windows 与 Linux CI 已通过，验证记录同步提交不改变用户脚本源码。下方 `0.8.54` 运行记录保留为历史证据。客户端缩短竞争窗口，不能证明服务端排他锁已修复或必然先于其它账号进入。

## 快照

### 2026-10-07 工程收口补充（0.8.54 历史运行闭环）

- 业务源码保持 0.8.54；本轮修复维护入口的失败误报、Windows CI 覆盖、当前运行版本证据和更新器的硬编码源码路径，未改变临床筛选规则。
- GitHub 仓库已重新确认存在，默认 `main`；旧 404 待办已失效。正式目录见下方及 `PROJECT_STATE.json.projectRoot`，不要重走旧 `G:\bu\0430` 的全盘定位过程。
- 当前页面版本读回为 0.8.54，当前文档启动记录时间 `2026-10-07T01:52:14.683Z`。控制台启动事件已被挤出，使用当前活跃执行上下文 writer 与本地启动日志严格对应后确认，不接受其它页面或历史 writer。
- 实际 UI 与持久化镜像均为肋骨平扫排除、允许项目不限、日志 60 分钟；当前早班时段保持。维护未刷新报告、未重放进入或锁定请求。
- 本地测试、远端发布与运行态是三份独立证据；快速维护不再把状态文件里的历史版本标成新鲜运行核验。最终交付证据见 `docs/CLOSEOUT_20261007.md`。

- 快照日期：2026-10-07
- 工作目录：`C:\Users\Lenovo\AppData\Roaming\Quant000150v9.5\Quant\Strategy\用户策略\app\江西省县域医共体-自动诊断候选`
- 源码文件：`jiangxi-radiation-auto-diagnose.user.js`
- 源码版本：`0.8.55`
- 当前目标：通过已有 WebSocket 和只读协议稳定发现候选，服务端授权通过后进入诊断；保持单客户诊断串行、服务器低负载和可回退。

### GPT-6 接管须知

- 0.8.54：每报告独立持久进入记录 `jx-radiation-auto-entry-once-v1:`，与日志窗口及 seenLimit 无关；DOM 补全编号后再次检查，导航/点击前保存，明确最终拒绝才释放未确认消费，未知网络结果保留防重。启动从现有本地成功事件回填旧版本记录；当前账号手工进入成功也标记处理。检查与机构增加 examNamesExcluded，多部位任意项目精确命中即排除，不限允许项不能绕过。
- 0.8.53：开发者日志默认 60 分钟，可快捷选择/自定义 developerRetentionMinutes，缺失旧值升级为 60、保留显式开关与过滤；所有清理/生命周期及本地分析工具按实际时长读取。新写入 journal-v3，兼容读取及封存 v2，避免活跃旧脚本十分钟清理删除新日志；多文档只同步保留时长，不改变业务配置。
- 0.8.52：锁定保护强制开启，姓名/UID 占用字段也识别；未知推送状态先窄列表补全，服务端明确允许且无锁定/非待诊断证据才导航，等待响应后重读页面。客户端 IP 初始化共享请求、失败缓存及收集完成立即结束，网络发出日志与调度日志分开。
- 0.8.51：日志每个文档独立分钟分片 `jx-radiation-auto-diagnose-debug-journal-v2:`，带稳定 `eventId`，不是整份数组互相覆盖；同源 localStorage 镜像与 GM 同 key；读取所有分片去重，只保留十分钟。统一 reset marker 防止旧页面清空后回写复活。配置固定 schema，升级不强制开关；表单 change 自动保存。
- 0.8.51：原生 Vue router 优先；自动进入前建立 sessionStorage 的 30 秒 final pending，直到当前尝试的 POST /rep/enter 响应、返回列表或超时。GET 详情和迟到旧请求不能释放。门禁只限制下一位进入，不停止观察。最终响应记录报告医生；不匹配只记录，不抢占/解锁。
- 查历史操作用 `python -B tools/read-candidate-audit-cdp.py --name "客户姓名" --other-doctor "医生姓名"`，它复用页面原生认证，只请求用户信息、指定姓名当天列表和该报告操作记录，不读取报告正文。秒级操作记录不能判断同一秒的先后次序。

- 0.8.50 修复开发者记录被 240 条提前挤掉的问题：只按十分钟剪枝，普通日志每秒合并保存，关键/退出事件立即保存。原生报告 `/api/ct/rays/rep/enter` 的只读 XHR/fetch 观察桥在 document-start 安装，不重放请求；`协议进入成功` 的 `phase=assert-allowed` 不代表报告载入，最终结果看 `报告进入完成/拒绝/异常`。直接运行 `python -B tools/read-candidate-debug-cdp.py --name "客户姓名"` 读取最小时间线；不导出原始候选、认证数据或其它姓名。

- 最新增量：0.8.49 的自动进入时段是一次明确选择的日期授权，四段单选，点击立即保存；截止后关闭并要求重选。`autoEntrySchedule.requiresSelection` 不允许用旧方案或“启用自动打开”绕过。切换方案/导入/恢复默认使用 `configWithCurrentEntrySchedule` 保留当前时段，不能自动续期。测试入口 `tests/auto-entry-schedule.test.mjs` 覆盖午夜、截止和异步响应。
- 项目内 `Update-Tampermonkey-Radiation.cmd` 使用同目录更新器，连接 Edge 标准 CDP 9333、隐藏目标调用 Tampermonkey 原生保存并关闭目标；默认刷新列表页，`--no-reload` 只保存。确认运行版本需同时查看实际启动日志，安装元数据本身不能证明页面已重载。

- 以主文件元数据、Git 提交和浏览器运行日志为三类独立证据；源码版本不等于 Tampermonkey 已加载版本。
- 当前源码版本为 `0.8.55`，最新提交以当前仓库 `HEAD` 为准。0.8.34 将 WebSocket 列表调度窗口压到 250ms，并记录 `dispatchDelayMs`/`withinOneSecond`；0.8.35 规范化“不限”配置并在 TOKEN_FAIL 后使用受控页面查询兜底；0.8.36 将开发者记录改为默认开启并保留最近 10 分钟完整候选字段；0.8.37 增加认证上下文形状诊断；0.8.38 在启动事件中保存实际选中的过滤值；0.8.39 每分钟清理并回写过期调试记录，保证十分钟窗口真正落盘生效；0.8.40 在启动记录中明确写入运行版本，方便确认 Tampermonkey 实际加载的是哪一版；0.8.41 修复 SPA 返回 `/radiation` 后运行时不重启导致后续客户不再处理的问题，并兼容 `AUTH/LOGINCODE/WORKSTATION` 这类大写会话 Cookie，避免协议请求缺少认证头；报告页 `/radiation/report` 继续运行 WebSocket、状态探测和只读列表处理，页面查询按钮仍只在 `/radiation` 使用；直接打开报告页先保守保持诊断锁，等右侧业务列表可读后再释放；0.8.42 将“检测到其他用户锁定的记录时跳过”做成可保存设置，默认开启，关闭后仍保留待诊断状态和服务端允许进入门禁；0.8.43 增加候选生命周期关联，记录首次/最近观察、规则通过、入口等待、协议响应、前后状态变化和疑似被其它用户抢先进入的完整十分钟证据；0.8.44 修复 WebSocket 只带部分字段时按错误患者字符串查询、服务端组合筛选返回空导致候选无法补全的问题，对单条实时线索执行一次有界的姓名精确兜底查询，再由客户端重新执行完整规则；0.8.45 将自动打开与只读监控拆成独立开关：关闭“启用自动打开”时仍保持 WebSocket、statusNum、只读列表、页面观察、自愈和十分钟开发者日志，但任何协议进入或页面点击都被硬门禁拦截；0.8.46 修复协议登录认证链路，统一复用业务会话头，写入大写会话 Cookie，并严格计算算式验证码。GPT-6 可先运行 `tools/gpt6-quick-maintenance.ps1` 在五分钟内完成回归和证据定位。`diagnosisActive` 只防止诊断中再次进入其它客户，不暂停列表刷新、状态探测或 WebSocket 观察。若列表中没有带诊断医生姓名的“诊断中”记录，入口锁会自动释放。设置面板现已补齐检查医院、检查部位、诊断医生和审核时间筛选，并可通过“更新所有可选项目”缓存动态选项；自检会比较本地版本与 GitHub Raw 版本并提示是否同步。CI 还覆盖发布失败保护测试。
- WebSocket 状态或检查类型缺失时先只读窄列表补全；已知非待诊断或锁定记录不能调用进入校验或回退点击。
- 服务端 `statusNum` 或窄列表返回业务码 2002 时，不能循环高频重试；状态探测使用无筛选全局计数，列表回退使用最近列表并在客户端过滤。
- 锁定保护始终开启；锁定、非待诊断或服务端拒绝均禁止自动进入及点击兜底。
- CUA/CTM 源码独立 checkout 在 `G:\bu\0430\02_项目源码\ctm-mcp-full`，扩展来源校验提交为 `3bf21b1`；它不是业务脚本运行态证据。
- GitHub 目标仓库 `kongji1/jiangxi-radiation-auto-diagnose` 当前连接器读回 404，热更新尚未达到“公开 Raw 可读”的完成条件。

## 已完成

1. 过滤设置已经集中在表头设置弹窗，窗口标题栏和底部操作栏固定，滚动到底部仍可关闭和保存。
2. 所有主要表头字段均可配置：报告状态、影像状态、就诊类型、性别、年龄、检查类型、检查项目、检查部位数量、申请机构、医生、申请时间、诊断/审核时间、登录账号。
3. 检查项目支持“不限”和复选框；“更新所有可选项目”会读取当前列表及协议列表中的检查项目并加入可勾选目录。
4. 申请时间默认是最近 5–30 分钟；支持不限、当天、最近 N 天、当天指定时间。
5. 登录账号留空表示不限；可填账号编号或登录名，也可用“仅允许当前账号”自动填入当前账号。
6. 进入方式支持协议优先、仅协议、页面点击。协议优先和仅协议使用记录编号校验业务接口后打开诊断路由。
7. 0.7.0 增加轻量响应：本地扫描和服务器状态探测分离，状态计数没有变化时不重复拉取完整列表。
8. 0.8.0 复用页面已经建立的 `/api/ct/websocket` 推送作为即时提示，不创建第二条业务连接；推送不能直接完成过滤时再触发一次受冷却保护的列表读取。
9. 0.8.0 把申请时间规则换算成 `checkinStartTime`/`checkinEndTime` 下传给状态和列表接口，并增加默认 15 秒列表补偿，覆盖计数不变但新记录替换旧记录的情况。
10. 0.8.0 的 WebSocket、列表和 DOM 扫描入口共用登录账号门禁；控制台调试信息不输出患者姓名或报告编号。
11. 2026-09-29 浏览器实测日志显示 `statusNum code=2002`；参考包把 2002 定义为 `TOKEN_FAIL`。0.8.1 已补充当前 `Auth` Cookie 对应的 `Authorization` 请求头，并仅在内存中转发，不写入配置或日志。
12. 0.8.2 增加页面重新聚焦后的低频“查询”补偿：只在 `visibilitychange` 或窗口 `focus` 时点击一次查询按钮，等待列表刷新后再扫描，避免后台停留后必须手工点击查询。
13. 0.8.3 将 WebSocket 提示设为主触发：完整推送直接协议进入，不完整推送按申请单号/患者/项目线索读取窄列表；状态探测不再因标签页隐藏而停止，后台改为至少 15 秒低频兜底，并保留并发、冷却和失败退避。
14. 0.8.3 首次协议请求按需读取 `/api/admin/user/info`，在内存补齐页面请求使用的 `LOGIN-USER-UID` 和必要 `USER-INFO` 头，针对真实页面曾出现的 `TOKEN_FAIL` 增加完整会话头路径。
15. 0.8.4 增加开发者模式开关；当前 0.8.50 默认开启，按时间滚动保留最近 10 分钟的完整候选字段和流程事件，无 240 条截断，便于直接复盘实时推送、规则过滤、协议校验、入口结果和耗时。认证上下文额外记录凭证存在性、长度、短哈希和请求头覆盖情况，但不保存 Cookie、Authorization 原文或密码；设置面板可复制或清空记录。
16. 进入安全门禁要求记录在真正进入前仍是待诊断（当前状态码 `102501`）。默认开启的“检测到其他用户锁定的记录时跳过”会检查列表原始 `isLock` 等字段和页面解锁图标；诊断中、待审核、审核中、已审核、已打印或页面明确提示“当前报告已被其他用户锁定”的记录必须跳过，不调用 `assertAllowEnter`，也不能通过页面按钮回退绕过门禁。关闭该设置后只允许客户端尝试锁定记录，服务端仍可拒绝。
17. 0.8.7 增加页面查询心跳：WebSocket 长时间无业务提示时，以不低于 15 秒的单次定时器自动触发页面原生“查询”，同时保留查询并发锁和冷却保护，避免必须手工点击。
18. 已通过 US 隧道建立只用于当前调试的门户访问链路：门户入口端口为 `19215`，影像入口端口为 `19213`；两者均已从公网路径返回 HTTP 200。
19. 当前 Tailscale 直连入口已建立并验证：同一 Tailnet 内的电脑使用 `http://100.66.170.11:22100/bbp-server/index.html#` 进入门户，使用 `http://100.66.170.11:22112/radiation` 进入影像页；本机和 US 节点访问均返回 HTTP 200。门户入口带内网地址重写，影像入口使用透明 TCP 转发以保留 WebSocket。
20. 0.8.8 移除了扫描循环对“待诊断”复选框的自动点击；页面报告状态现在完全由用户控制，协议请求仍按脚本配置独立筛选。
21. 0.8.9 将页面查询心跳对实时提示的让位窗口缩短为 15 秒；实时推送优先，连续一个刷新周期没有新提示时自动查询一次。

## 业务协议事实

这些事实来自页面前端包和一次真实的手工进入诊断流程，参考包在 `reference/app-bundles`：

- 列表：`POST /api/ct/rays/rep/list`
- 状态计数：`POST /api/ct/rays/rep/statusNum`
- 进入前校验：`GET /api/ct/rays/rep/assertAllowEnter?repUid=...`
- 诊断页路由：`/radiation/report?id=<repUid>&applyOrgCode=<applyOrgCode>`
- 请求必须使用当前页面会话，脚本通过 `credentials: include` 发起同源请求。
- 页面 Axios 还发送 `LOGIN-USER-KEY`、`LOGIN-USER-UID`、`WORKCODE`，非管理员请求会发送精简后的 `USER-INFO`；脚本只在内存按需复用这些值。
- 页面自身的列表定时刷新在前端包中是 30 秒一次；脚本只观察页面已有业务 WebSocket，不重复建立连接。
- 状态值目前映射为：待诊断 `102501`、诊断中 `102502`、待审核 `102503`、审核中 `102504`、已审核 `102505`、已打印 `102506`。如果业务端更改字典，先核对参考包再修改映射。

## 0.8.5 的低负载流程

```text
/radiation 且账号允许（是否可见不影响协议链路）
        │
        ├─ 本地 DOM 扫描（默认 2 秒，仅读当前页面）
        │       └─ 仅前台执行；用于同步当前表格显示
        │
        ├─ 页面已有 WebSocket 推送
        │       ├─ 完整记录 → 待诊断且未锁定 → matches → assertAllowEnter → 诊断路由
        │       └─ 字段不足/进入失败 → 按推送线索窄列表 → 状态/锁定门禁 → 协议进入
        │
        └─ statusNum 小请求（默认约 5 秒，带抖动/失败退避）
                ├─ 前台无近期推送约 5 秒；有近期推送或页面隐藏至少 15 秒
                ├─ 计数 hash 变化 → list 读取最多 30 条
                └─ 默认 15 秒补偿窗口 → list 读取最多 30 条
                                  └─ 规则匹配 → 协议进入
```

约束：探测请求不并发；普通列表请求最短间隔 10 秒（默认 15 秒），实时推送触发时先经过 250ms 合并窗口，实时列表请求最短间隔 500ms；实时线索在请求重叠或冷却时排队保留；单次请求有超时；失败会逐步退避到最多约 60 秒。浏览器若冻结或丢弃后台页面，页面脚本会随浏览器生命周期暂停，这是浏览器限制。

## 当前未完成 / 必须实测

1. **Tampermonkey 是否已经加载 0.8.45**：2026-10-05 通过当前 Edge 的 CUA/CDP 页面日志确认实际运行版本仍为 `0.8.44`；源码和本地维护结果为 `0.8.45`，因此热更新尚未在浏览器中生效，必须完成脚本更新后再次读取运行版本。
2. **登录会话下的真实 statusNum/list 响应**：匿名请求只能证明接口存在，返回业务权限错误；必须在已登录页面中确认响应结构和字段名。
3. **协议进入实测**：用一个仍处于待诊断且允许进入的测试记录，观察是否成功跳到 `/radiation/report?...`，并确认列表端没有重复点击；再用一个已被其他用户锁定或已进入诊断中的记录，确认不发起 `assertAllowEnter`，不点击诊断操作。
4. **状态门禁实测**：分别覆盖状态码 `102501`（待诊断）和 `102502`（诊断中）等非待诊断状态；非 `102501` 必须在过滤/状态门禁阶段跳过，即使文字或其它过滤条件匹配也不得进入。页面出现“当前报告已被其他用户锁定”或诊断操作禁用时，同样必须跳过。
5. **低负载观察**：浏览器开发者工具 Network 中观察 1–2 分钟，确认没有重叠请求；前台无近期推送时 `statusNum` 默认约每 5 秒一次，有近期推送或隐藏页面时至少 15 秒；普通 `rep/list` 最短间隔 10 秒（默认 15 秒），实时推送经过 250ms 合并窗口后最短间隔 500ms，没有推送时约 15 秒最多一次列表补偿。
6. **开发者模式排查**：遇到具体候选未及时进入时，在设置中打开“开发者模式”，优先运行 `python -B tools/read-candidate-debug-cdp.py --name "客户姓名"`，或点击“复制最近诊断记录”；重点看 `实时推送收到`、`候选过滤`（应能看到非待诊断/已锁定原因）、`协议进入拒绝`、`协议进入成功`（前置校验）、`报告进入完成/拒绝/异常`（最终载入）和 `候选进入失败` 事件。
7. **只读监控反向验证**：关闭“启用自动打开”、保持“开启只读监控”，确认 WebSocket、`statusNum`、只读 `rep/list`、页面观察、自愈和按实际保留时长的日志仍运行；同时确认没有 `assertAllowEnter`、协议进入、页面诊断点击，并出现“观察模式跳过自动打开”。

## 下一次接管步骤

1. 先读本文件、`docs/PROTOCOL.md`、`docs/VERIFICATION.md`。
2. 检查主文件版本和 `node --check`。
3. 不要重新分析无关的 CTMW/EDW 文件，也不要读取或输出任何密钥。
4. 用浏览器会话验证 Tampermonkey 实际加载版本；如果没有加载，先解决安装/保存，再判断脚本行为。
5. 只在业务页面确认后调整 `statusProbeMs` 和“列表补偿”；建议状态探测 5–10 秒、列表补偿 15 秒以上，最低不要把状态探测设到 3 秒以下。
6. 任何性能结论都要以 Network 请求间隔和响应为依据，不以源码存在推断实时生效。

## 用户偏好和约束

- 用户希望自动完成脚本更新和验证，不希望反复手工复制粘贴。
- 用户明确不希望本项目调用 edwc、edac、eda 等无关 MCP。
- 用户重视服务器和终端负载，不能用高频完整列表轮询替代轻量探测。
- 变更应保持可回退；不要删除业务页面原有刷新或 WebSocket 机制。

## 2026-10-01 continuation: protocol-only list monitoring (0.8.11)

- Default `pageQueryRefresh=true`: protocol monitoring drives candidate discovery; the page query button is used only to mirror the current user-selected filters and never changes report-status checkboxes.
- Monitoring uses the existing WebSocket bridge, read-only `statusNum`, and read-only `rep/list`; `statusProbeMs` remains the lightweight cadence and `listHeartbeatMs` is the list fallback cadence.
- Developer logs now include inferred DOM `statusCode`, lock state, diagnostic-entry presence/disabled state, operation count, and filtered reason. For a visible `诊断中` row the expected strict-gate reason is `报告状态非待诊断`; if the raw row/API reports another-user occupation it is `报告已锁定/占用`.
- The optional setting `允许脚本点击查询` is on by default and should only be enabled when visible table synchronization is explicitly wanted.
- Verification: `node --check jiangxi-radiation-auto-diagnose.user.js` passed after the 0.8.11 changes. Runtime loading on the other workstation still needs an actual Tampermonkey reload and developer-log export.


## 2026-10-01 continuation: persistent developer evidence (0.8.12)

- Developer events are now persisted in Tampermonkey storage under a dedicated key, limited to the latest 240 sanitized events, so list-to-report navigation does not erase the evidence.
- The currently inspected local Edge Tampermonkey record is 0.8.11; the 0.8.12 source is syntax-checked but still needs to be loaded into the editor/runtime before persistent logs are active.

## 2026-10-01 continuation: TOKEN_FAIL root cause and client-IP header (0.8.14)

- Persistent developer logs from the installed 0.8.13 show repeated `statusNum code=2002`, followed by page-query fallback and 15-second heartbeat queries.
- The portal Axios interceptor also sends `LOGIN-CLIENT-IP`, derived from a WebRTC ICE candidate. The script did not send this header, so its read-only protocol calls were rejected even though page queries worked.
- 0.8.14 adds the same header derivation and sends only a boolean-presence diagnostic signal, never the address value. `node --check` passed.
- Installed local Edge record was 0.8.13 when this was diagnosed; runtime proof of 0.8.14 still requires the script record to advance.

## 2026-10-01 continuation: optional direct protocol login (0.8.15)

- The script now has a settings section for an optional direct login account. It stores only the account name; the password is requested for the current page session and is cleared after the attempt.
- Login sequence matches the radiation app: `GET /api/admin/userLogin/keyPair`, `GET /api/admin/userLogin/captcha`, then `POST /api/admin/userLogin/login?username=...&password=...&code=...&uuid=...`; the password is RSA-encrypted with the returned key pair.
- The CAPTCHA is shown in an in-page dialog for manual entry. The shopgpt-daily-benefit OCR design was used as a reference for the image/retry boundary; the separately deployed loopback `ddddocr` helper is now called when enabled, with manual fallback.
- Do not persist the supplied password or add it to logs, exports, profiles, or documentation. Runtime proof still requires loading 0.8.15 in Tampermonkey and completing one login with a test account.

## 2026-10-01 continuation: direct login from /login (0.8.16)

- The bootstrap route now accepts both /login and /radiation. When direct protocol login is enabled and the page has no Auth cookie, /login obtains the RSA key pair and CAPTCHA, submits the login request, then redirects to /radiation after success.
- The first portal jump remains supported; later visits can start at /login without opening the portal. Password remains session-only and is not stored.

## 2026-10-06 continuation: direct login authentication repair (0.8.46)

- Live Edge evidence showed `/api/admin/user/info` returns business `2002` when called with cookies alone, but succeeds when `Authorization` is copied from uppercase `AUTH`. The direct-login sequence now uses the same bounded request wrapper as monitoring, so `Authorization`, `LOGIN-USER-KEY`, `LOGIN-USER-UID`, `LOGIN-CLIENT-IP`, `USER-INFO`, `WORKCODE` and `sign` are applied consistently.
- Login tokens are validated as non-empty strings and written as `AUTH`, `LOGINCODE` and `WORKSTATION`, matching the application storage helper. Mixed-case values from older script versions are removed before writing canonical values.
- CAPTCHA answers are validated without digit stripping; safe arithmetic is evaluated in the userscript as a second boundary, so `99-40=` becomes `59` and malformed OCR text is rejected. `tests/direct-login.test.mjs` covers the mocked flow and header/cookie behavior. Real login still requires browser runtime verification.

## 2026-10-01 continuation: candidate priority and unlimited age (0.8.17)

- Added an explicit age-unlimited checkbox. When enabled, both age bounds are ignored; it is persisted with the profile.
- Added ordered numeric weights for exam names and application institutions. Candidates are sorted before entry: non-empty report conclusion first when enabled, then exam weight, institution weight, and newer application time.
- Preliminary-report priority only recognizes conclusion fields (`conclusion`, `reportConclusion`, `diagnosisConclusion`, `reportOpinion`); description and remark fields are retained separately and never count as a conclusion.
- WebSocket field copying now includes conclusion/description variants so priority works without a full list refresh.
- `node --check` passed for 0.8.17.

## 2026-10-01 continuation: runtime unlimited-config evidence and TOKEN_FAIL fallback (0.8.35)

- Do not infer the active filters from `DEFAULT_CONFIG`. Runtime developer logs now emit a sanitized `配置门禁快照` at every `/radiation` start. It records only whether encounter type, age, modality, exam and institution filters are unlimited, plus application-time mode and report-status count.
- Config migration converts a persisted visual `不限` array sentinel to the internal empty-array representation and normalizes an age configuration with empty bounds to `unlimited=true`. This prevents an old saved profile from silently filtering an otherwise unlimited candidate.
- A live query for a historical realtime record showed an application time and eventual `已审核` state by another doctor. The active configuration must be checked from the runtime snapshot before attributing the miss to age, encounter type or exam.
- The same live session produced `TOKEN_FAIL (2002)` for the read-only list path with `count=0`. After the bounded protocol recovery path fails, 0.8.35 allows one existing page-query fallback when the page is usable; it is protected by the existing 15-second query gate and does not create a polling loop.
- Source contract, syntax, release-failure and CAPTCHA tests pass for 0.8.35. Tampermonkey runtime loading and the exact historical WebSocket event remain separate live evidence requirements.



## 2026-10-01 continuation: recovery and self-healing (0.8.18)

- `fetchJson` now retries a single explicit `TOKEN_FAIL` (business code 2002) after refreshing the in-memory session identity; it does not retry normal responses or create a high-frequency loop.
- If the recovered request still returns 2002 and direct login is enabled, the list route schedules one delayed navigation to `/login`, allowing the existing direct-login flow to re-establish the session. The schedule is rate-limited to five minutes.
- The settings panel now exposes a read-only self-check for route, page rows, account gate, session info, and `statusNum`. Body-row discovery tries the configured selector and common Element Plus fallbacks.
- Source version is 0.8.18. Browser runtime loading and a real logged-in recovery cycle remain unverified.

## 2026-10-01 continuation: route guard for profile redirect

- The source does not contain a `/setting/profile` navigation target. 0.8.18 now records route changes in developer mode and stops all timers, observers, and candidate processing as soon as the page leaves `/radiation`.
- Header settings integration is restricted to known table-column controls. Broad `title`/`aria-label` matching was removed so unrelated profile/navigation controls cannot receive the settings handler.
- The GitHub hot-update helper now delegates source editing to `tools/configure-github-hot-update.mjs`, which uses explicit UTF-8 reads/writes and refuses to overwrite the userscript when metadata cannot be read. The PowerShell wrapper only locates Node and passes the repository/branch arguments. Do not run an older copy of the helper against the Chinese userscript.

## 2026-10-01 continuation: root cause of profile redirect

- Browser extension storage diagnostics captured the actual sequence: `statusNum code=2002` -> `会话自愈调度` -> `/login` -> `/setting/profile`.
- The saved configuration had direct-login enabled but no protocol login username. More fundamentally, a logged-in `/radiation` page should never be redirected because one read-only request returned 2002.
- Recovery now keeps the current `/radiation` route, records the failure, and lets the existing low-frequency probe/page query or an explicit user login recover the session. It never sends the active list to `/login` automatically.
- This fix is released as source version 0.8.19. The browser extension storage previously observed 0.8.17, so runtime verification must confirm that 0.8.19 is installed.
- Direct login is also allowed when the page opens directly at `/radiation`: with the feature enabled, a non-empty configured account, and no `Auth` cookie, the existing password/CAPTCHA dialog runs before the list scanner starts. Users do not need to visit `/login` first. This behavior is released as 0.8.20.
- 0.8.34 adds the local OCR bridge from `tools/captcha_ocr_server.py`. The protocol-login CAPTCHA is an arithmetic challenge such as `99-40=`; the bridge recognizes the expression and calculates the answer. The portal's four-digit CAPTCHA remains supported. OCR failure falls back to the existing manual input dialog.
- The bridge is installed in the ignored `.captcha-ocr-venv` environment from `tools/requirements-captcha-ocr.txt` and runs on `127.0.0.1:18766`; `8766` is reserved by the existing OAuth proxy. Start it with `tools/start-captcha-ocr.ps1` and verify `GET /health` before testing login. The service is loopback-only and does not log images or answers.
- 0.8.34 also rate-limits TOKEN_FAIL recovery to one session-identity refresh per 15 seconds and throttles the corresponding developer event to the same interval. The `/radiation` route protection and single retry remain unchanged; this reduces duplicate recovery traffic when `statusNum` repeatedly returns 2002.
- Direct-login bootstrap now probes `/api/admin/user/info` before prompting for a password. This handles HttpOnly or delayed `Auth` cookies: an already logged-in page returns through the existing session and never shows the protocol-password dialog on refresh.

## 2026-10-05 continuation: read-only monitoring mode (0.8.45)

- `monitoringEnabled` is independent from `enabled`. The former keeps WebSocket, `statusNum`, read-only `rep/list`, route/session self-healing, candidate lifecycle evidence, and developer diagnostics running; the latter controls automatic opening of a customer.
- With “启用自动打开” off and “启用只读监控” on, matching candidates are logged with “观察模式跳过自动打开” and no `assertAllowEnter` or page diagnose click is attempted. This is the safe mode for testing against an already audited/open report.
- Settings and self-check expose both states. Existing persisted `enabled` values remain the automatic-opening preference; new configurations default to read-only monitoring enabled.
- Static tests now require the 0.8.45 metadata/state/README version, the monitoring default and UI, the no-entry telemetry, and an explicit automatic-opening gate. Browser loading and GitHub Raw publication still require independent runtime evidence.




