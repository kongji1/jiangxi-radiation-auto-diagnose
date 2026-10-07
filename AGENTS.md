# 项目维护规则

这是“江西省县域医共体 - 自动诊断候选”Tampermonkey 项目。先读 `docs/AI_HANDOFF.md`（当前接管入口）及 `docs/ARCHITECTURE.md`（症状到模块）。不用通读历史对话或历史文档。

## 源码与版本

- 唯一业务源码为 `src/manifest.json` 登记的 `src/*.js`，唯一业务版本为 manifest.version。
- 根目录 `jiangxi-radiation-auto-diagnose.user.js` 是生成产物。不要直接修改；用 `node tools/build-userscript.mjs --write` 生成，`--check` 检测漂移。
- manifest 定义初始化顺序。17 段仍共享 IIFE 作用域；模块移动、共享声明、bootstrap 或未知文件变化必须全量验证。
- `reference/app-bundles` 仅用于协议核对，不能直接修改。
- 版本升级使用 `python -B tools/maintain-project.py version <版本>`，同步源码版本和状态，运行态历史不改写。

## 维护流程

1. `maintain-project.py status` 核实源码/Git/当前 Edge 9333 运行态；不要据状态文件推断当前加载版本。
2. 客户异常优先 `maintain-project.py diagnose --name "客户姓名"`，默认只读本地日志，不刷新或进入、不发业务请求。
3. 定位单一模块改动，构建后运行 `maintain-project.py test --changed`。新增测试必须登记 `tools/test-suites.json`，遗漏即失败。
4. 共享/未知改动自动退回全量；发布必须 `test --all`，本地/CI/PowerShell 同用登记表，禁止复制测试列表。
5. 业务字节改变时再 `deploy`。报告页不刷新；`SAVED_PENDING_LOAD` 不是运行已更新。
6. 需要发布时用现有 `tools/publish-github.ps1`，另核实 Raw/远端 CI，不能把本地测试当成发布完成。

## 运行约束

- 保留 WebSocket 主提示、statusNum 轻量探测、500ms 实时冷却、低频完整列表、退避和并发保护。
- 严格待诊断与锁定门禁不可绕过；一份报告只自动进入一次；不重放临床进入/解锁作测试。
- 诊断互斥只限制下一位进入，不影响页面列表正常观察和刷新。
- 保留用户配置、开发者日志和日期时段授权；默认日志 60 分钟可配置。
- 只能使用目标 Edge 本地标准 CDP 9333。不可用明确报告，不循环授权、不操作其它浏览器、不关闭 Clash。
- 不把患者、身份证、Cookie、Authorization、密码或协议凭证写入源码、文档、提交、外部服务和通用维护缓存；业务请求凭证仅在当前内存使用。
- 维护使用本地工具，MCP 用于需要的边界测试；不要调用本项目无关的 EDW/CTMW 探测脚本。
