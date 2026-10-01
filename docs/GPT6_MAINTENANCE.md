# GPT-6 维护入口

本文是下一次 GPT-6 接管本项目时的最短可靠入口。它记录当前架构、不可破坏的业务门禁、运行时证据和发布顺序。

## 项目边界

主源码只有 `jiangxi-radiation-auto-diagnose.user.js`。`reference/app-bundles` 用于读取业务前端协议，不直接修改；`tools/captcha_ocr_server.py` 是独立的本机回环 OCR 辅助服务；`ctm-mcp-full` 是 CUA/CTM 的独立工程，不属于业务脚本运行时。

## 运行链路

```text
业务页已有 WebSocket
       |
       +-- 有报告编号 --> 本地规则 --> assertAllowEnter --> /radiation/report
       |
       +-- 无编号/协议失败 --> 只读列表 --> 客户端状态、锁定和过滤门禁
       |
       +-- statusNum 全局计数 --> 只在计数变化或补偿窗口触发列表
```

WebSocket 线索的正常调度窗口为 250ms，强制刷新冷却为 500ms。事件会记录 `dispatchDelayMs` 和 `withinOneSecond`，以后必须用浏览器日志或 CDP Network 时间戳验证，而不能只看源码。

## 不可破坏的门禁

1. 只有服务端 `assertAllowEnter` 明确允许时才打开诊断路由。
2. 已锁定、被其他用户占用、诊断中、待审核、审核中、已审核、已打印的记录不得进入。
3. 当前客户进入诊断后设置 `diagnosisActive`，它只作为“禁止再次进入其它客户”的入口互斥锁。列表扫描、WebSocket 候选、状态探测和列表刷新继续运行；候选只记录观察日志并跳过进入。当列表中已经没有带诊断医生姓名的“诊断中”记录，或返回 `/radiation` 重新初始化时，运行时清除锁，允许下一位客户进入；列表暂时不可读时保持锁，并继续交给服务端门禁兜底。
4. 设置面板的动态表头过滤包括检查医院、检查部位、诊断医生和审核时间。选项来自当前 DOM 列表，旧配置中缺失的新数组由默认配置补齐；不要把“没有当前页选项”误判为业务端没有该字段。
4. WebSocket 没有状态字段时可以调用服务端授权校验，但不能把空状态直接当成待诊断。
5. `code=2002` 不是允许无限重试的信号。状态探测必须使用无状态筛选的全局计数；列表失败时最多退回最近列表并在客户端过滤。

## 修改与验证顺序

```powershell
node --check .\jiangxi-radiation-auto-diagnose.user.js
node .\tests\source-contract.test.mjs
python .\tests\captcha_ocr.test.py
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-release.ps1 -SkipOcrHealth -RequireClean
```

再用 CUA 验证运行态：

- 读取当前 Edge 业务页，不同时操作门户和影像页；
- 监听 `statusNum`、`rep/list`、`assertAllowEnter`；
- 检查 `实时列表请求发起` 的 `dispatchDelayMs`；
- 确认诊断页打开后没有第二个客户的进入请求；
- 读取 Tampermonkey 实际日志或元数据，确认加载版本。

## 发布证据

Git 提交只能证明本地源码已变更。热更新完成还必须同时证明：

1. 目标 GitHub 仓库存在且公开 Raw 可读；
2. Raw 文件头部版本与本地提交一致；
3. Tampermonkey 更新检查或实际运行日志已加载该版本；
4. CUA CDP 看到新版本行为，而不是只看到旧版日志。

任何一项缺失，都只能报告为“源码已完成，运行态或发布态未确认”。
