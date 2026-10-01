# GitHub 推送与 Tampermonkey 热更新

## 目标

Tampermonkey 会读取用户脚本头部的 `@updateURL` 和 `@downloadURL`。脚本发布到 GitHub 后，只要推送新版本并递增 `@version`，Tampermonkey 就能按自己的更新周期检查并安装新版本。

## 当前状态

本地项目已有 Git 仓库；发布必须绑定到用户明确指定的远程仓库，不能擅自推送到未知地址。真实仓库地址确定后，再把下面两行加入脚本元数据：

当前配置目标 `kongji1/jiangxi-radiation-auto-diagnose` 仍返回 GitHub 404，且已连接的 GitHub MCP 没有创建仓库接口；因此 Raw 热更新地址已经写入源码，但在仓库真正创建并推送前不会宣称热更新已生效。

```text
// @updateURL   https://raw.githubusercontent.com/<owner>/<repo>/main/jiangxi-radiation-auto-diagnose.user.js
// @downloadURL https://raw.githubusercontent.com/<owner>/<repo>/main/jiangxi-radiation-auto-diagnose.user.js
```

不要把 `@updateURL` 指向会生成 HTML 的 GitHub 页面地址，必须使用 `raw.githubusercontent.com` 的原始文件地址。

## 推送前检查

本地发布检查可运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/verify-release.ps1
```

如果暂时没有启动 OCR 服务，可使用 `-SkipOcrHealth`，但不能把该结果当作登录链路验证。

仓库创建并完成 Git 认证后，使用下面的发布脚本：

```powershell
powershell -ExecutionPolicy Bypass -File tools/publish-github.ps1 -Repository kongji1/jiangxi-radiation-auto-diagnose
```

脚本会先执行完整发布检查，再验证远端仓库、推送当前提交，并读取 Raw 文件确认版本为当前源码版本 `0.8.36`。仓库不存在或 Raw 仍返回 404 时会直接失败。

在项目根目录运行：

```text
node --check jiangxi-radiation-auto-diagnose.user.js
node tests/source-contract.test.mjs
```

GitHub Actions 会在每次 push 和 pull request 上执行语法、源码契约、发布失败保护和验证码测试。只有检查通过的提交才应作为 Tampermonkey 更新源。

## 发布约定

1. 修改脚本后递增 `@version`。
2. 同步更新 `PROJECT_STATE.json`、`docs/AI_HANDOFF.md` 和 `docs/VERIFICATION.md`。
3. 推送到主分支后等待 `Validate Tampermonkey script` 通过。
4. Tampermonkey 检查到新版本后，再在实际业务页面确认脚本版本和运行日志。

配置真实仓库地址时可运行：

```powershell
.\tools\configure-github-hot-update.ps1 -Repository kongji1/<仓库名>
```

该工具只写入 GitHub Raw 地址，不会提交或推送，也不会读取任何凭据。

GitHub 推送只解决代码分发，不等同于业务页面已经加载新脚本；运行态仍需浏览器证据确认。

