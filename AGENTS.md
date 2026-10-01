# 项目接管规则

这是“江西省县域医共体 - 自动诊断候选”Tampermonkey 用户脚本项目。

开始任何工作前先阅读：

1. `docs/AI_HANDOFF.md`：当前进度、已验证事实和下一步。
2. `docs/PROTOCOL.md`：业务接口与低负载策略。
3. `docs/VERIFICATION.md`：哪些结论已验证、哪些仍需浏览器实测。

维护要求：

- 唯一源码是 `jiangxi-radiation-auto-diagnose.user.js`。
- `reference/app-bundles` 只用于协议核对，不直接修改。
- 不要把源码已更新当成 Tampermonkey 已加载；必须在浏览器确认版本或实际日志。
- 不要使用与本项目无关的 CTMW/EDW 探测脚本。开发者模式可在浏览器本地保留最近 10 分钟的完整候选信息用于当前排查，但不得把患者信息、身份证号、Cookie、Authorization 或密码写入源码、文档、提交记录或外传；原始凭证只能在当前请求内使用。
- 保持 statusNum 轻量探测、列表变化触发、失败退避和并发保护，不改成高频完整列表轮询。
- 修改后运行：`node --check .\jiangxi-radiation-auto-diagnose.user.js`。
- 若接口字段不确定，先查看参考包并在登录会话中做最小范围验证，再修改代码。
