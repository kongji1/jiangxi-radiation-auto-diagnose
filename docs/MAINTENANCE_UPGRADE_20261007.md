# 维护架构升级实测（2026-10-07）

## 本次交付

业务版本保持 `0.8.55`。原 4186 行脚本按职责迁移为 manifest 登记的 17 个源码片段，生成单一 Tampermonkey 安装文件。构建结果与迁移前基线按 LF 逐字一致，SHA-256 为 `e00c54332866974742a87b754bb99447070698216d0f8b21621df444ccf3e47a`。

- `src/manifest.json` 是版本及模块顺序来源，根目录 `.user.js` 是生成产物；构建检查会拒绝漂移。GitHub 更新地址配置改为编辑源码 header 后构建，版本工具同步 manifest、本地版本及产物并支持失败回滚。
- `tools/maintain-project.py` 统一状态、诊断、构建验证、测试选择、版本及部署输出；PowerShell 和双平台 CI 使用同一测试登记表。
- `tools/test-suites.json` 登记全部 24 套件。未知或共享路径变化退回全量，漏登记测试直接失败；专项测试纳入实际跨模块依赖。进入时段覆盖 pending/protocol，报告对应覆盖 session/rules/protocol/ledger，最终进入覆盖 ledger。
- 通过缓存按全项目内容 hash 保存测试 ID 与验证时间；构建、语法和两项 Git 空白检查每次仍执行。`--all` 强制重跑，缓存不能证明浏览器加载或远端发布。
- 稳定源码测试 helper 按声明名及 V8 语法边界提取函数并提供模块定位。已迁移最终进入与报告对应两套复杂测试，保留原有 49 / 22 项场景。
- 候选诊断一条命令提供阶段、证据时间线、可关联的延迟、历史与当前配置区别及证据缺口。默认只读本地 CDP 日志，缺失历史快照或同名多报告时明确证据不足。
- 接管入口与历史归档分开；职责、依赖和症状定位见 [ARCHITECTURE.md](ARCHITECTURE.md)，日常命令见 [MAINTENANCE_COMMANDS.md](MAINTENANCE_COMMANDS.md)。

## 实测

Windows 本机 Python 3.11、Node 24，使用标准 Edge CDP `127.0.0.1:9333`。以下时间为该次运行读回值，不是固定性能保证。

| 验证 | 结果 | 耗时 |
|---|---|---|
| `maintain-project.py test --all` | 24 套件全通过，`LOCAL_VERIFIED` | 40,344 ms |
| 紧接同内容 `test --changed` | 24 套件缓存命中，四项检查重新执行 | 531 ms |
| 全量中的发布失败与恢复测试 | 真实隔离临时 Git/PowerShell 流程通过 | 34,187 ms |
| 只读 `status` | manifest/artifact 均 0.8.55，无构建漂移，CDP 可达 | 593 ms |
| 合成不存在姓名 `diagnose` | `missing-observation`、0 个事件 | 171 ms |

全量中的构建、语法、Git 工作区与暂存区空白检查分别耗时 109 / 63 / 62 / 47 ms。发布失败夹具约占本次全量时间的 85%；快速维护的实际收益来自单一入口、定位和有依据的缓存，发布验证仍保留完整失败覆盖。修复夹具缺少 `.runtime-maintenance/` 忽略规则造成的假 dirty 失败，没有放松 `RequireClean`。

新增的稳定源码 helper 15 项、候选诊断 39 项、维护入口 32 项、版本管理 15 项隔离测试均通过，并已纳入上述正式全量。

缓存实测在收口文档及状态摘要写入前完成；文档和状态也是 hash 输入，后续修改会使旧缓存失效。这是内容变化保护，不表示新的文件已由旧缓存验证。

## 运行证据边界

本次只读状态中 `cdpReady=true`、`runtimeVerified=false`：当前执行上下文没有足够证据确认实际加载版本，保留旧运行核验为历史记录，没有用安装或状态文件代替当前运行证据。

合成姓名诊断从已有同源日志镜像读取，`serverRequestsRequested=false`；没有创建标签页、刷新、修改配置、进入、重新锁定或请求病例服务端列表。`--with-audit` 是另外显式选择的窄只读操作记录查询，默认不执行。

本次业务安装字节未改变，没有实际 Tampermonkey 保存或重载，也没有远端发布。部署竞态、报告页保护、安装 hash 和运行启动时间约束使用离线夹具验证。三秒热加载目标本次未实测；不能由 531 ms 测试缓存命中推导实际热加载速度。

## 后续维护

```powershell
python -B tools/maintain-project.py status
python -B tools/maintain-project.py diagnose --name "客户姓名"
node tools/build-userscript.mjs --write
python -B tools/maintain-project.py test --changed
```

业务修改后按维护入口部署，发布前强制 `test --all`。配置/共享状态、bootstrap、原生协议桥等变化使用全量。新测试只登记一处；当前账号/临床页未知时先取明确证据，不循环弹出授权或重放进入。

仍需逐步改进的接缝：

- 17 个片段保留共享 IIFE 和可变状态，不是完全独立模块；顺序与跨函数依赖仍需测试闭包和共享路径保护。
- 稳定 helper 已迁移两套复杂测试，其余旧提取方式可以按后续实际修改逐步迁移。
- 跨异步事件尚无统一 attemptId/eventCode，配置变更也未全部带 revision/failedRules；无法唯一关联时延迟保持空值，不能用当前配置解释过去。
- 保留时间外的日志不能恢复。同名、多份报告、未校准的服务端秒级时间及客户端时间必须保留证据不足分类。
- 拆分与本地测试不证明服务端锁排他问题已解决，也不证明真实自动进入速度已改善；此类结论需要正常业务产生的独立运行证据。
