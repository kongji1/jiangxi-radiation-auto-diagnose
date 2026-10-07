# 五分钟维护入口

先读短版 `AI_HANDOFF.md`，按 `ARCHITECTURE.md` 定位职责，不通读历史。

```powershell
# 一次核对版本、Git、CDP 与当前运行态
python -B tools/maintain-project.py status
# 客户异常优先查看保留证据，默认不发业务请求
python -B tools/maintain-project.py diagnose --name "客户姓名"
# 只改 src 模块，然后生成产物、验证受影响范围
node tools/build-userscript.mjs --write
python -B tools/maintain-project.py test --changed
# 业务字节改变时隐藏保存并核验，报告页不会刷新
python -B tools/maintain-project.py deploy
```

版本用 `maintain-project.py version <版本>`，单一版本源是 manifest，不能手改产物。完整发布用 `test --all`；兼容 PowerShell 入口共用同一测试登记，不维护重复名单。

定位先看配置门禁快照、实时提示/网络发出、状态/锁定、assert、最终 POST、原生交接/载入。认证上下文只比较形状；当前配置不能解释过去。默认日志 60 分钟，可配置；缺失信息必须明确为不足。详见 `DIAGNOSTICS.md`。

`LOCAL_VERIFIED/READY` 只表示本地回归；`SAVED_PENDING_LOAD` 只表示安装保存，尚未加载；`DEPLOYED` 才有本次保存、安装 SHA 和运行证据。源文件版本、历史状态或单一 listener 都不能代表页面已加载。

不可简化：低负载、失败退避、待诊断/锁定门禁、诊断互斥只限制下一位、持久进入一次、配置/时段/日志保留、报告页不强制刷新；不重放真实病例进入请求。Clash 保持运行，CDP 9333 不可用只探测一次，不不停弹授权。

完整命令/退出码见 `MAINTENANCE_COMMANDS.md`；历史运行记录只按需要查 `VERIFICATION.md` 和 `history/AI_HANDOFF_20261007_pre_modules.md`。
