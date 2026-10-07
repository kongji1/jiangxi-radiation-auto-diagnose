# GitHub 推送与 Tampermonkey 热更新

## 目标

Tampermonkey 会读取用户脚本头部的 `@updateURL` 和 `@downloadURL`。脚本发布到 GitHub 后，只要推送新版本并递增 `@version`，Tampermonkey 就能按自己的更新周期检查并安装新版本。

## 当前状态

2026-10-07 已重新确认：`kongji1/jiangxi-radiation-auto-diagnose` 为现有公开仓库，默认分支 `main`，当前连接有推送权限。本地 `origin` 指向该仓库，接管基线 `master` 与 `origin/main` 同为 `6eeefd8`。发布必须绑定这个已确认的远程，不能推送到未知地址。

旧记录中的“仓库 404／需要创建仓库”已失效。仓库存在不等于新版本已发布；每次交付仍需分别确认远端提交、Raw 内容、Actions 和当前页面运行版本。

```text
// @updateURL   https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js
// @downloadURL https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js
```

不要把 `@updateURL` 指向会生成 HTML 的 GitHub 页面地址，必须使用 `raw.githubusercontent.com` 的原始文件地址。

## 推送前检查

本地发布检查可运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/verify-release.ps1
```

如果暂时没有启动 OCR 服务，可使用 `-SkipOcrHealth`，但不能把该结果当作登录链路验证。

OCR 默认端口为 `18766`。启动脚本会先检查端口归属；若检测到其它本地服务占用，使用 `-Port 18767` 等空闲端口启动，并在设置界面同步修改 OCR 地址。

完成验证、提交并确认 Git 认证后，可使用下面的发布脚本：

```powershell
powershell -ExecutionPolicy Bypass -File tools/publish-github.ps1 -Repository kongji1/jiangxi-radiation-auto-diagnose
```

脚本会先执行完整发布检查，再验证远端仓库、推送当前提交，并读取 Raw 文件确认版本为当前源码版本 `0.8.54`。仓库不存在或 Raw 仍返回 404 时会直接失败。

在项目根目录运行：

```text
node --check jiangxi-radiation-auto-diagnose.user.js
node tests/source-contract.test.mjs
```

GitHub Actions 在 Linux 和 Windows 上执行全部 JavaScript 测试、验证码和运行版本核验测试。Windows 还实际执行 PowerShell 失败注入；Linux 不把这一平台特定测试的跳过当作 Windows 验证通过。只有检查通过的提交才应作为更新源。

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

