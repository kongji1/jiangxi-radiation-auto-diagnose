# 验证记录

## 0.8.17 本地回归验证（2026-10-01）

- `node --check jiangxi-radiation-auto-diagnose.user.js`：通过。
- `node tests/source-contract.test.mjs`：通过，覆盖 13 项源码契约，包括协议入口、严格待诊断门禁、锁定跳过、年龄不限、项目/机构权重、结论优先、自愈选择器和密码不持久化。
- `git diff --check`：通过。
- 已新增 GitHub Actions 工作流 `.github/workflows/validate.yml`，每次 push 和 pull request 自动执行上述检查。
- 已新增设置页“运行自检”，只读检查路由、页面行、账号门禁、登录会话和 `statusNum`，不修改报告状态。
- 已增加表格行选择器自愈：配置选择器无结果时依次尝试业务表格和 Element Plus 常见结构。

以下仍属于浏览器运行态验证，不能由本地测试替代：Tampermonkey 实际加载 0.8.17、登录会话下实时 WebSocket 字段、不同权重候选的真实排序、页面冻结后的恢复以及真实协议进入。

## 已完成的静态验证

验证日期：2026-09-29。

- `node --check jiangxi-radiation-auto-diagnose.user.js`：通过（`syntax-ok`）。
- 主文件版本头为 `0.8.6`。
- 已确认源码包含 `statusProbeMs`、`listHeartbeatMs`、`/api/ct/rays/rep/statusNum`、页面 WebSocket 观察桥、`refreshRemoteCandidates`、`processRealtimeHint`、`processRemoteRecords`、`recordData`、`dataSeen` 和列表页大小限制。
- 已确认申请时间规则会转换为 `checkinStartTime`/`checkinEndTime`，并且实时提示、状态变化、列表补偿均受冷却和并发保护。
- 已确认实时提示线索在列表请求重叠或冷却时进入排队，下一次请求使用申请单号、患者、检查项目等窄条件；状态探测在隐藏页面不再被 `visibilityState` 直接跳过。
- 已确认开发者模式默认关闭，旧配置缺少该字段时仅在首次升级内存临时开启；开发者事件不保存认证值、患者姓名、申请单号或报告编号，最多保留 240 条并按事件/候选标签限流。
- 已确认进入规则必须保留报告状态门禁：只有当前状态码等于待诊断值 `102501` 才能继续进入；诊断中等其它状态、明确被其它用户锁定或诊断操作禁用的记录必须在过滤/入口前跳过，不能由页面点击回退绕过。
- 已用 Node 隔离测试验证：WebSocket 提示桥能够提取 `repUid` 和过滤所需字段；“最近 5–30 分钟”会换算为正确的前后时间边界；时间字符串去空格后仍能被申请时间过滤解析；列表请求会携带报告状态、检查类型和申请时间窗口。
- 已用源码函数做 Node 隔离测试，覆盖 `102501` 待诊断可进入、`102502` 诊断中跳过、`isLock: true` 和“当前报告已被其他用户锁定”跳过，并覆盖 `isLock: false`/“未锁定”反向样例，避免把否定锁定文本误判为占用。浏览器端仍需按下面的反向步骤确认被跳过记录没有对应的 `assertAllowEnter` 请求和页面点击。
- 2026-09-29 浏览器实测：自动诊断日志连续返回 `statusNum code=2002`，参考包确认 2002 是 `TOKEN_FAIL`；页面世界未发现 0.8.x 的 WebSocket 桥。0.8.5 已包含会话 `Authorization` 头修复、重新聚焦查询补偿、后台协议链路、开发者模式和待诊断/锁定门禁，保存并刷新后需重新观察这些项。
- 项目目录只包含用户脚本、协议参考包和交接文档；未迁入无关 CTMW 临时脚本。

## 已完成的协议可达性验证

未登录的直接请求可以到达业务端点，但业务层返回权限错误包装（HTTP 仍为 200，业务 code 为 2002）。这证明路径存在，不能证明已登录会话可正常取数。真实验证必须在业务页面会话中完成。

手工进入诊断流程曾观察到业务页使用 `/radiation/report?id=...&applyOrgCode=...` 路由；这一事实用于实现协议优先进入。

## 必须在浏览器中完成的验证

1. 保存主文件到 Tampermonkey，并刷新 `/radiation`。
2. 确认脚本版本或控制台日志已经是 `0.8.5`。
3. 打开 Network，记录 1–2 分钟：
   - 前台无近期 WebSocket 消息时 `statusNum` 是否大约每 5 秒一次；最近有消息或页面隐藏时是否至少 15 秒一次，且请求不重叠；
   - 页面有新推送时，`rep/list` 是否在提示后触发且不短时间重复；没有推送时，是否约 15 秒最多一次补偿；
   - `rep/list` 的 `checkinStartTime`/`checkinEndTime` 是否与设置的申请时间窗口同步；
   - 页面隐藏后 WebSocket、协议进入和低频 statusNum 是否仍可执行；离开 `/radiation` 后是否停止候选处理。
4. 用一条符合规则、状态仍为待诊断且未被锁定的记录测试协议优先进入；确认进入诊断页且没有重复点击。
5. 用一条 `isLock: true`（页面显示解锁图标）或已处于诊断中的记录做反向测试：确认开发者记录给出“非待诊断/已锁定”原因，Network 中没有对应的 `assertAllowEnter`，页面也没有发生诊断按钮点击。
6. 若业务端状态字典或返回字段变化，保存实际 JSON 的字段名（去除姓名、身份证号、Cookie 和令牌）后再调整脚本；特别核对状态码和锁定字段的优先级。
7. 若具体候选未及时进入，打开开发者模式，复制最近诊断记录；不要把原始页面截图、姓名、申请单号或报告编号写入项目文档。

## 已知安装状态限制

截至本快照，之前从浏览器扩展存储看到的已安装脚本记录仍为 `0.5.0`；当前 Edge 主进程命令行虽然带有 `--remote-debugging-port=9222`，但 `http://127.0.0.1:9222/json/version` 和 `/json/list` 仍连接被拒绝，没有可用监听。因此不能把本目录的 `0.8.5` 源码等同于浏览器已经生效。下一次接管必须重新核实，不得沿用这个状态作未经验证的结论。
- 0.8.6 静态核验：当 `statusNum` 连续失败且无近期 WebSocket 提示时，`scheduleAutoQueryFallback` 最早 15 秒后复用页面查询按钮；该路径有并发锁、失败次数门槛和路由/启用状态门禁。
- 0.8.6 静态核验：Tampermonkey 元数据同时匹配 `/radiation*` 与 `/radiation/*`，bootstrap 在目标路由以外等待并只初始化一次，覆盖门户跳转后的初始化时序。

## 0.8.18 本地回归验证（2026-10-01）

- `node --check jiangxi-radiation-auto-diagnose.user.js`：通过。
- `node tests/source-contract.test.mjs`：通过，覆盖 15 项源码契约，新增 TOKEN_FAIL 单次恢复和自动重新登录调度检查。
- `git diff --check`：通过。
- TOKEN_FAIL 恢复策略限制为一次重试；仍失败时直接登录自愈调度有五分钟冷却，避免循环跳转和额外负载。
- 0.8.18 route-guard patch：`node --check`、15 项源码契约和 `git diff --check` 通过；路由离开 `/radiation` 时会停止运行时计时器和 MutationObserver，并记录 `路由变化`。当前源码没有 `/setting/profile` 字符串，因此该跳转仍需在真实浏览器运行时用开发者记录确认来源。
- 0.8.19 profile-redirect fix：浏览器存储日志已确认 `TOKEN_FAIL -> /login -> /setting/profile`；修复后 `/radiation` 中的 TOKEN_FAIL 只记录并保持当前页，自动流程不再导航 `/login`。当前仍需在 Tampermonkey 中确认 0.8.19 已加载。
- 0.8.20 direct-login route：当页面直接打开 `/radiation`、协议登录开关开启、账号非空且没有 Auth Cookie 时，会先执行现有密码/验证码协议登录，再启动列表扫描；不要求用户先访问 `/login`。
- 0.8.27 CAPTCHA OCR：`python -m py_compile tools/captcha_ocr_server.py` 通过；算式 `99-40=`、加法、四位数字和除零失败分支通过；本机 `8766` 已被 OAuth 代理占用，OCR 服务改为只监听 `127.0.0.1:18766`，识别失败回退手工输入。

仍需浏览器验证：真实登录会话下触发 2002 后是否能恢复、直接登录跳转是否成功，以及 Tampermonkey 是否已加载 0.8.27。

## 当前运行态补充验证（2026-10-01）

- CUA 读取到已登录的 `/radiation` 页面，用户为当前登录会话，报告状态筛选为“待诊断”。等待 8 秒后 URL 仍为 `/radiation`，没有再次跳转 `/setting/profile`。
- 这证明当前页面的路由保持修复在运行态没有立即回归；由于浏览器扩展编辑器页面不能由当前自动化接口读取，仍不能仅凭此观察确认加载的确切脚本版本。
- OCR 服务已由项目隔离 Python 环境启动，`GET http://127.0.0.1:18766/health` 返回 `{"ok":true,"service":"captcha-ocr"}`。四项 OCR 单元测试、22 项源码契约测试和脚本语法检查通过。
- 扩展存储的最新运行配置仍来自旧运行版本：配置中没有 0.8.27 新增的 OCR 字段；同一份运行日志连续记录 `statusNum code=2002` 后的“会话自愈保持当前页”且 `redirected:false`，并未再次导航到 `/setting/profile`。这确认路由修复已在旧运行版本生效，但不能把旧运行版本当作 0.8.27 已加载。
- 直接协议登录刷新保护：源码契约现在覆盖先调用 `/api/admin/user/info`、再显示密码提示的顺序。业务会话有效但 `Auth` 不可读时，应直接复用当前会话；真实浏览器刷新验证仍待加载 0.8.27 后完成。
- 浏览器运行态补充：扩展存储当前配置已经出现 `directLogin.ocrEnabled=true` 和 `directLogin.ocrEndpoint=http://127.0.0.1:18766/ocr`，这是 OCR 版本配置标记；刷新后的业务页仍在 `/radiation`，可访问性树中没有“请输入协议登录密码”弹窗。真实 OCR 识别和协议登录仍未执行，不把本次观察扩大为登录成功证明。
- 随后浏览器当前页可达 `/radiation/report` 诊断表单，报告页显示待诊断/诊断操作和已登录医生信息，证明登录会话与业务报告路由可达；进入动作来源可能包含用户操作，未将其作为脚本自动协议进入的单独证明。
- 在诊断页继续观察 15 秒后仍保持同一 `/radiation/report` 路由，页面自动保存提示正常更新，没有被列表脚本重新导航或弹出登录密码；这验证了路由离开 `/radiation` 后运行时停止的保护。
