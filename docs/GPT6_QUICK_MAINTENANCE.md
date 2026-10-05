# GPT-6 五分钟维护入口

目标是让下一次 GPT-6 接管后，在五分钟内完成一次可信的本地维护判断，而不是先重复浏览历史对话。

## 0–30 秒：读取真相源

按顺序读取：

1. `PROJECT_STATE.json`：版本、运行态确认、待办和性能边界。
2. `docs/AI_HANDOFF.md`：最近变更和已知限制。
3. `docs/PROTOCOL.md`：接口、TOKEN_FAIL、自愈和负载边界。
4. `git status --short`：确认是否有未提交修改。

主源码唯一来源是 `jiangxi-radiation-auto-diagnose.user.js`。`reference/app-bundles` 只用于核对协议字段。

## 30 秒–2 分钟：自动回归

在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\gpt6-quick-maintenance.ps1 -SkipOcrHealth
```

脚本会核对源码和状态版本，执行语法、源码契约、原生失败保护和 OCR 测试。开发过程中即使工作树有修改也会输出 `READY` 并标记 `workingTree=dirty`；提交前使用 `-RequireClean` 才要求工作树干净。

## 2–4 分钟：按证据定位

- 候选没有出现：先看 `实时推送收到`、`实时列表请求发起`、`列表请求结果`。
- 候选出现但没进入：看 `配置门禁快照`、`候选过滤`、`进入前硬门禁拒绝`、`协议进入拒绝`。
- 返回 2002：看 `认证上下文` 和 `协议响应认证上下文`，只比较存在性、长度、短哈希和请求路径，不读取原始凭证。
- 页面列表晚更新：区分协议列表结果、页面查询心跳和 DOM 行状态，不能把手工刷新时间当成候选首次出现时间。
- 报告锁定：默认跳过其它用户锁定的记录；若设置关闭该选项，也只允许继续到服务端待诊断和 `assertAllowEnter` 校验，不能用页面点击绕过。

开发者日志默认开启，浏览器本地保留最近 10 分钟完整候选事件，每分钟清理一次并回写 `GM_*`；认证原文、密码和可复用凭证不保存。

## 4–5 分钟：修改与交付

1. 只修改主脚本和对应测试/文档。
2. 递增 `@version`，同步 `PROJECT_STATE.json`、README、变更记录和验证记录。
3. 重跑 `gpt6-quick-maintenance.ps1 -RequireClean`。
4. GitHub 发布必须同时证明仓库存在、Raw 可读、Raw 版本一致、Tampermonkey 已加载；缺一项只能报告为未完成发布。

## 不可简化的边界

- 不把 HTTP 200 当成业务成功，必须检查业务 `code`。
- `2002/TOKEN_FAIL` 不等于没有候选，也不能无限重试。
- 不用高频完整列表轮询替代 WebSocket、statusNum 和低频补偿。
- 不把源码版本当成 Tampermonkey 已加载版本。
- 不把患者信息、Cookie、Authorization、密码写入源码、文档、提交或外部服务。
