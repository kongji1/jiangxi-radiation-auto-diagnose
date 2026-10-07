# AI 接管入口

## 当前工作区

- 正式仓库：`PROJECT_STATE.json.projectRoot`，不要从旧 G 盘目录全盘搜索。
- 业务版本：以 `src/manifest.json.version` 为准，当前报告刷新修复 0.8.56；架构迁移基线 0.8.55。
- 源码：`src/*.js`，由 manifest 有序构建；根目录 `.user.js` 是 Tampermonkey/GitHub 安装产物，禁止直接修改。
- 首先执行 `python -B tools/maintain-project.py status`；读 `docs/ARCHITECTURE.md` 对照症状找模块。接口细节只在需要时读 `docs/PROTOCOL.md`。
- 当前模块保持同一 IIFE 作用域，构建迁移与基线按 LF 逐字一致，不意味着依赖已完全隔离。

## 五个常用命令

```powershell
python -B tools/maintain-project.py status
python -B tools/maintain-project.py diagnose --name "客户姓名"
node tools/build-userscript.mjs --write
python -B tools/maintain-project.py test --changed
python -B tools/maintain-project.py deploy
```

完整用法见 `docs/MAINTENANCE_COMMANDS.md`，候选证据边界见 `docs/DIAGNOSTICS.md`。源码修改后先构建，再用 `maintain-project.py version --to <版本>` 递增版本；完整发布回归用 `test --all`，不能拿增量缓存替代发布门禁。

## 业务事实及不能破坏的约束

1. WebSocket 是提示，缺失字段先窄列表补全；保持 500ms 实时请求冷却、普通列表低频补偿、失败退避及并发保护。不能改为高频完整列表。
2. 只有待诊断且未锁定允许进入；未知状态先补全；服务端拒绝不能页面点击绕过。
3. `assertAllowEnter` 成功不是报告载入。有能力时提前只发一次最终 POST，响应严格归属于当前医生，并交给原生报告页消费一次。0.8.56 在本次交接成功、当前报告/路由/医生/会话确认后，允许原生后续刷新，避免终审已成功但界面回读失败；未确认交接仍拒绝重复取得。
4. 取得、原生消费、页面载入三个阶段分别判断。网络/解析/医生归属或已取得后的交接未知，保留防重且暂停自动打开。
5. 每报告独立持久进入记录与日志保留窗口无关；手工进入同样登记；明确其它用户锁定持久跳过，不解锁、不抢占。
6. 列表观察不能因诊断锁停用；只阻止另一个自动进入。报告页不可为维护强制刷新。
7. 配置/日志/时段授权持久化；日志默认 60 分钟可配置；进入授权四段单选且不自动续期。
8. 所有临床进入测试都在隔离假环境中执行。不能重放真实患者锁定/进入请求作测试。

## 证据与运行路径

- Edge 标准 CDP：`http://127.0.0.1:9333`。本地直连绕过代理，不触碰 Clash；不可用只探测一次，不弹窗/重启。
- `status` 检查实际执行上下文；历史 `PROJECT_STATE` 不是新鲜运行证据。
- `deploy` 必须分别证明本地测试、原生保存、安装内容 SHA、本次列表加载和当前运行版本；活动报告只保存并返回 `SAVED_PENDING_LOAD`。
- 0.8.55 上一轮已验证安装 SHA、配置及日志保留；新真实候选的提前取得/原生载入仍待正常使用观察，不能宣称服务端锁排他问题已解决。
- 0.8.56 已隐藏保存并核对安装 SHA；两个既有报告文档保持旧完整运行态，已装页面兼容修复及返回列表后一次加载。当前会话已确认的交接允许原生刷新，另一旧会话交接保持原样；两个页面编辑内容及配置指纹一致。不要把兼容标记当成完整运行版本。
- 本次维护架构升级保留安装字节，无需为同一源码再次保存或刷新临床页。
- GitHub 发布、Raw 相等与远端 CI 需各自证明；既有仓库 `kongji1/jiangxi-radiation-auto-diagnose` 已存在，不重建。

## 文档定位

| 需求 | 文档 |
|---|---|
| 改哪里、依赖、测试选择 | `docs/ARCHITECTURE.md` |
| 一条命令维护及退出码 | `docs/MAINTENANCE_COMMANDS.md` |
| 历史候选快速诊断 | `docs/DIAGNOSTICS.md` |
| 接口/低负载/会话 | `docs/PROTOCOL.md` |
| 架构升级实测 | `docs/MAINTENANCE_UPGRADE_20261007.md` |
| 终审成功后回读修复 | `docs/REPORT_REFRESH_REPAIR_20261007.md` |
| 历史运行及验证 | `docs/VERIFICATION.md` |
| 旧交接全文，仅在需要历史时读 | `docs/history/AI_HANDOFF_20261007_pre_modules.md` |

历史文档中的旧版本、旧路径、404 和待办可能过期，不能替代当前 status。不得将患者/凭证写入源码、文档、提交或通用维护缓存。
