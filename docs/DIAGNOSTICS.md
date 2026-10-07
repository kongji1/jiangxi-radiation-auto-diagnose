# 一条命令定位候选

在项目根目录执行：

```powershell
python -B .\tools\diagnose-candidate.py --name "客户姓名" --pretty
```

默认只读当前 Tampermonkey 留存日志和配置，不刷新页面、不打开报告、不调用进入校验/锁定、不发送业务服务请求、不写分析文件。连接当前 Edge 标准 CDP `http://127.0.0.1:9333`，沿用更新器的 CDP 传输。扩展后台目标休眠/不存在时，自动读取唯一当前业务页的既有同源 localStorage 镜像，`collection.storageSource` 标明来源；它不唤醒扩展、不另开页面。镜像仅包含已有持久化内容，通常落后内存最多一次日志保存周期。仅当新采集器失败时回退旧 `read-candidate-debug-cdp.py` 并标记精确关联证据不足。姓名只用于浏览器本地匹配，不出现在输出中。

输出包含 `diagnosis`（阻塞阶段、证据等级、明确理由）、`timeline`（台北时区）、`latencies`、`automaticEntrySummary`、`configuration` 和 `evidenceGaps`。`collection` 记录实际采集耗时，方便区分工具连接等待和业务链路耗时。缺少起止证据的耗时为 `null`；当前配置只作比较，不用于解释过去。

需要服务端操作记录时显式执行：

```powershell
python -B .\tools\diagnose-candidate.py --name "客户姓名" --with-audit --date 2026-10-07 --pretty
```

这会复用现有只读审计器，最多进行身份读取、指定姓名当天的窄列表与一份报告操作记录查询。没有全量扫描。当前原生查询限定最新 10 份列表结果；同名多份报告直接标为 `ambiguous-report`，不猜测某份报告。审计失败不会丢失本地诊断。服务端秒级日志与客户端毫秒日志未校准，不能据此断言其它账号早几百毫秒。

## 证据边界

- `assert-allowed` 和导航都不能证明报告载入；`finalReportLoaded=true` 的当前页最终事件才是载入证据。提前协议取得与原生页面载入分开判断。
- 明确其它用户锁定的最终业务拒绝与网络/归属结果未知分开；后者不能解释成“没有取得”，不能建议重复进入。
- 前置 `配置门禁快照` 属于当时已记录快照，不能保证中间没有未记录的自动保存/其它页面修改。直接事件中的 `failedRules`/`reason` 优先；快照缺失会明确提示。
- 快照与候选事件按同一文档上下文对应，避免把另一标签页较新的配置快照套到本页历史。精确病例关联补充读取失败时，旧读者输出会降为证据不足。`contextLabel` 是当次采集内的匿名标签，不是患者或账号编号。
- 同名多报告、多个进入尝试、无效时间、早于日志保留窗口、只有全局路由事件均明确标为证据不足；不拼接多个尝试来计算锁定窗口。
- 当前开发者模式或保存时长不能证明过去有没有连续采集；延长时长不会恢复已删除日志。HTTP 失败中的锁定文字不能证明其它账号已取得，泛指“报告已锁定”也不被当作明确其它账号归属。
- 只输出许可的事件、状态、配置与耗时字段；不输出报告正文、患者姓名/编号、密码、Cookie 或 Authorization，不创建诊断文件。

## 离线复现

输入支持既有 debug 读者 JSON，或 `{ "debug": {...}, "audit": {...} }`。扩展字段 `debug.historicalGateSnapshots` 是已记录的配置快照数组，`debug.matchedReportCount` 是精确姓名关联的稳定报告数。fixture 使用虚构事件，不保存真实临床信息。

```powershell
python -B .\tools\diagnose-candidate.py --input-json .\fixture.json --pretty
python -B .\tests\candidate-diagnostics.test.py
```

离线模式不加载 CDP 依赖、不访问浏览器或网络。退出码 `0` 表示已完成分析（可以是证据不足），`2` 表示输入/采集失败；失败输出不回显原始异常中的会话或请求数据。
