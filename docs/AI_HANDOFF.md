# AI 接管交接记录

> 目的：让下一次接管本项目的 AI 可以从当前状态继续，不需要重新猜测业务接口、脚本版本或已验证/未验证的事实。

## 快照

- 快照日期：2026-10-01
- 工作目录：`G:\bu\0430\02_项目源码\江西省县域医共体-自动诊断候选`
- 源码文件：`jiangxi-radiation-auto-diagnose.user.js`
- 源码版本：`0.8.9`
- 当前目标：降低待诊断列表响应延迟，用轻量状态探测接近实时发现新记录，同时不放大服务器和终端负载。

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
15. 0.8.4 增加开发者模式开关：新配置默认关闭；旧配置首次升级临时开启，用户关闭并保存后保持关闭。开启时记录实时推送、规则过滤、协议校验、入口结果和耗时，使用不可逆候选标签，不记录姓名、申请单号、报告编号或认证信息；设置面板可复制最近 240 条记录。
16. 进入安全门禁要求记录在真正进入前仍是待诊断（当前状态码 `102501`），且没有被其它用户锁定。列表原始记录已确认有 `isLock` 字段，页面通常以解锁图标表示占用；诊断中、待审核、审核中、已审核、已打印或页面明确提示“当前报告已被其他用户锁定”的记录必须跳过，不调用 `assertAllowEnter`，也不能通过页面按钮回退绕过门禁。
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

约束：探测请求不并发；普通列表至少间隔 15 秒，实时推送触发的列表至少间隔 3 秒；实时线索在请求重叠或冷却时排队保留；单次请求有超时；失败会逐步退避到最多约 60 秒。浏览器若冻结或丢弃后台页面，页面脚本会随浏览器生命周期暂停，这是浏览器限制。

## 当前未完成 / 必须实测

1. **Tampermonkey 是否已经加载 0.8.7**：源码已通过语法检查；浏览器实际加载版本仍必须在另一台调试电脑的 Tampermonkey 菜单或控制台中确认，不能用本机源码存在代替运行态证据。
2. **登录会话下的真实 statusNum/list 响应**：匿名请求只能证明接口存在，返回业务权限错误；必须在已登录页面中确认响应结构和字段名。
3. **协议进入实测**：用一个仍处于待诊断且允许进入的测试记录，观察是否成功跳到 `/radiation/report?...`，并确认列表端没有重复点击；再用一个已被其他用户锁定或已进入诊断中的记录，确认不发起 `assertAllowEnter`，不点击诊断操作。
4. **状态门禁实测**：分别覆盖状态码 `102501`（待诊断）和 `102502`（诊断中）等非待诊断状态；非 `102501` 必须在过滤/状态门禁阶段跳过，即使文字或其它过滤条件匹配也不得进入。页面出现“当前报告已被其他用户锁定”或诊断操作禁用时，同样必须跳过。
5. **低负载观察**：浏览器开发者工具 Network 中观察 1–2 分钟，确认没有重叠请求；前台无近期推送时 `statusNum` 约每 5 秒一次，有近期推送或隐藏页面时至少 15 秒；有 WebSocket 推送时列表请求应紧随提示且受 3 秒冷却保护，没有推送时约 15 秒最多一次列表补偿。
6. **开发者模式排查**：遇到具体候选未及时进入时，在设置中打开“开发者模式”，等待一次推送或列表补偿后点击“复制最近诊断记录”；重点看 `实时推送收到`、`候选过滤`（应能看到非待诊断/已锁定原因）、`协议进入拒绝`、`协议进入成功` 和 `候选进入失败` 事件。

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
- The CAPTCHA is shown in an in-page dialog for manual entry. The shopgpt-daily-benefit OCR design was used as a reference for the image/retry boundary, but its Python `ddddocr` runtime is not embedded in the userscript. An OCR endpoint field is reserved for a separately deployed, same-host helper and is not called unless implemented.
- Do not persist the supplied password or add it to logs, exports, profiles, or documentation. Runtime proof still requires loading 0.8.15 in Tampermonkey and completing one login with a test account.

## 2026-10-01 continuation: direct login from /login (0.8.16)

- The bootstrap route now accepts both /login and /radiation. When direct protocol login is enabled and the page has no Auth cookie, /login obtains the RSA key pair and CAPTCHA, submits the login request, then redirects to /radiation after success.
- The first portal jump remains supported; later visits can start at /login without opening the portal. Password remains session-only and is not stored.

## 2026-10-01 continuation: candidate priority and unlimited age (0.8.17)

- Added an explicit age-unlimited checkbox. When enabled, both age bounds are ignored; it is persisted with the profile.
- Added ordered numeric weights for exam names and application institutions. Candidates are sorted before entry: non-empty report conclusion first when enabled, then exam weight, institution weight, and newer application time.
- Preliminary-report priority only recognizes conclusion fields (`conclusion`, `reportConclusion`, `diagnosisConclusion`, `reportOpinion`); description and remark fields are retained separately and never count as a conclusion.
- WebSocket field copying now includes conclusion/description variants so priority works without a full list refresh.
- `node --check` passed for 0.8.17.


