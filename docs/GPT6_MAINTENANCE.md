# GPT-6 维护接管说明

## 先读什么

1. `AGENTS.md`：项目边界和安全约束。
2. `PROJECT_STATE.json`：当前版本、运行态证据和下一步。
3. `docs/AI_HANDOFF.md`：历次变更和未完成验证。
4. `docs/PROTOCOL.md`：接口、字段和负载限制。
5. `docs/VERIFICATION.md`：已经验证与仍需浏览器验证的项目。

唯一业务源码是 `jiangxi-radiation-auto-diagnose.user.js`。`reference/app-bundles` 只用于核对页面协议，不直接改动。

## 维护顺序

每次接管按以下顺序执行：

1. `git status`、读取当前版本和最近提交。
2. 检查是否有用户正在使用的浏览器运行态；不要用本地源码存在推断 Tampermonkey 已加载。
3. 先做只读协议和字段核对，再修改脚本。
4. 修改后运行 `node --check jiangxi-radiation-auto-diagnose.user.js` 和 `node tests/source-contract.test.mjs`。
5. 对状态、锁定、申请时间和账号门禁做正向与反向测试。
6. 更新 `PROJECT_STATE.json`、`AI_HANDOFF.md`、`VERIFICATION.md`，区分源码证据和浏览器证据。

## 行为不变量

- 只有待诊断状态 `102501` 且未被其它用户锁定的记录可以调用 `assertAllowEnter`。
- 协议失败必须退避、排队或回退到只读/页面同步路径，不能用高频完整列表请求冲击服务器。
- WebSocket 只观察页面已有连接，不重复创建业务连接。
- 患者姓名、申请单号、报告编号、Cookie、Authorization、密码和身份证号不得写入日志、文档、导出配置或提交记录。
- 报告“初写优先”只接受结论字段，描述和备注不能充当结论。

## 配置语义

- `age.unlimited=true` 时忽略年龄上下限。
- `examWeights`、`institutionWeights` 使用 `名称=权重`，权重越大越先处理。
- `preliminaryReportFirst=true` 时有非空结论的记录优先。
- `allowedAccounts=[]` 表示不限制账号。
- `directLogin` 只保存账号，不保存密码；密码仅当前页面会话使用。

## GitHub 热更新

GitHub Actions 的 `validate.yml` 会执行语法和源码契约测试。仓库地址确定后，在用户脚本元数据中加入 GitHub Raw 的 `@updateURL` 和 `@downloadURL`，再推送递增版本。GitHub 推送成功不等同于浏览器已经更新，必须在 Tampermonkey 和业务页面运行态确认版本。
