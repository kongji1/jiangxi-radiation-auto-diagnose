# 统一维护命令

在项目根目录运行 `python -B tools/maintain-project.py`。命令输出单份 JSON，包含 `readiness` 和各阶段 `elapsedMs`。默认使用本机 Edge 标准 CDP `http://127.0.0.1:9333`，不启动浏览器，不触发远程调试授权重试。

## 日常入口

```powershell
python -B tools/maintain-project.py status
python -B tools/maintain-project.py test --changed
python -B tools/maintain-project.py test --all
python -B tools/maintain-project.py deploy
python -B tools/maintain-project.py diagnose --name "客户姓名"
python -B tools/maintain-project.py version --to 0.8.56 --dry-run
```

`status` 只读取当前 Git、manifest 版本、产物版本与 hash，执行只读构建检查，并读取本地 CDP 健康和当前页面运行版本。`manifestVersion` 与 `artifactVersion` 分开列出，`buildDrift` 指出产物是否需要重建。CDP 不可用时只探测一次，不自动启动浏览器或请求授权。`--no-runtime` 跳过业务页面运行读取。历史 `PROJECT_STATE.json` 的运行记录不能替代当前执行上下文证据。

`diagnose` 委托 `tools/diagnose-candidate.py`，仅在终端显示当前请求的排查结果；维护入口不缓存姓名、病例或认证数据。候选分析工具的默认路径只读取本地保留信息。

## 测试注册与选择

`tools/test-suites.json` 是 Node/Python 测试的唯一登记表。新增可执行的 `*.test.mjs`、`*.test.py` 若未登记，维护直接失败，防止悄悄漏测。

- 默认 `test` 等于 `test --changed`：比较 `HEAD`、暂存区、工作区及未跟踪文件。
- `--base origin/main` 还纳入从指定基线开始的变化。文件重命名按删除和新增两条路径处理。
- 每次选择都包含 `core`、`always` 及递归 `dependsOn` 闭包。
- `sharedPaths` 命中或出现未知路径时，退回全部测试。
- 仅 `ignorePaths` 明确列出的文档等路径可以不新增专项测试；仍运行核心测试。
- `test --all` 强制完整重跑，不使用通过缓存。发布必须使用这个入口。
- `--no-cache` 关闭本次增量测试缓存。

注册格式：

```json
{
  "schemaVersion": 1,
  "source": "jiangxi-radiation-auto-diagnose.user.js",
  "build": ["node", "tools/build-userscript.mjs", "--check"],
  "checks": [],
  "core": ["locked-entry", "automatic-once"],
  "always": ["source-contract"],
  "sharedPaths": ["src/manifest.json", "tools/test-suites.json"],
  "ignorePaths": ["docs/**", "README.md"],
  "suites": [
    {
      "id": "locked-entry",
      "runner": "node",
      "path": "tests/locked-entry-hard-gate.test.mjs",
      "includes": ["src/entry/**"],
      "dependsOn": ["automatic-once"]
    }
  ]
}
```

所有命令按 argv 调用，不经过 shell 字符串拼接。构建 `--check`、产物 `node --check`、Git 工作区/暂存区空白检查每次强制执行，不使用缓存。缓存依据模块、全部测试、维护代码、manifest、登记表、主产物、文档/状态、CMD/BAT 启动器及 CI 内容的 SHA-256，版本号相同不能使缓存生效。测试期间内容变化时拒绝保存验证结果。失败输出包含命令、suite ID 和退出码，原始子进程正文不落盘。

缓存只保存 hash、测试 ID 和验证时间到 `.runtime-maintenance/verified-tests.json`。该目录已被 Git 忽略。

## 保存、加载与确认

`deploy` 先构建检查和相关测试，再调用现有原生 Tampermonkey 更新器。更新器使用隐藏目标，并在结束时关闭；维护入口不打开可见编辑器。保存后在已有扩展 service worker 内读取安装源码并计算 SHA-256，只返回摘要，再用当前业务页执行上下文核对实际加载版本。

- `DEPLOYED`：保存成功、安装源码 hash 相同、列表页已重新加载、当前运行版本相同，而且重载后的运行启动时间严格晚于保存前，排除仍读到旧文档的竞态。
- `SAVED_PENDING_LOAD`：保存及 hash 核验成功，但本次没有重载列表页，例如当前停留在有未保存内容的报告页或使用 `--no-reload`。退出码为 `2`，不得宣称运行代码已升级。
- `INSTALLED_HASH_UNCONFIRMED`：保存成功但不能证明安装内容与刚测试源码一致；部署失败，不能仅凭版本号宣称成功。
- `SAVE_FAILED` / `DEPLOY_BLOCKED`：保存或前置验证失败，没有可交付部署结论。

报告页不会为了维护被刷新。返回列表后的加载可以由现有无感加载流程完成，然后再次 `status` 查看当前运行证据。仅运行版本相同不能证明同版本修改已加载，因此部署会独立要求本次列表重载、晚于旧文档的启动证据与安装源码 hash。如果保存前无法确认唯一业务页的当前运行证据，维护返回 `CURRENT_BUSINESS_PAGE_UNCONFIRMED`，不保存或刷新任意窗口。

## 下一次业务版本升级

业务版本唯一来源是 `src/manifest.json.version`，模块只保留两处 `{{SCRIPT_VERSION}}`，构建时生成 Tampermonkey 元数据与运行版本。需要真正递增版本时使用：

```powershell
python -B tools/maintain-project.py version --to 0.8.56 --dry-run
python -B tools/maintain-project.py version --to 0.8.56
```

版本工具先验证现有构建与 manifest/`PROJECT_STATE.version` 一致，再同步 manifest、本地状态版本并构建产物。仅接受规范 `major.minor.patch`、拒绝降级，同版本是只读 no-op。失败按原始字节回滚这三份文件；`--dry-run` 不写入。运行态版本、历史启动时间、CI 验证和发布记录保留原值，README/指南的历史记录不跟着改写，也不创建或改写发布元数据。

三秒目标仅指 **原生保存＋列表加载＋安装 hash/当前运行核验**；`hotReloadElapsedMs` 单独测量并与 `hotReloadBudgetMs=3000` 比较。完整测试、构建和远端 CI 不计入这三秒，也不因目标而省略测试。当前机器实际是否达标以命令读回为准。

## 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 只读状态完成、本地验证通过，或完整部署已确认 |
| `1` | 构建、检查、测试、保存或核验失败 |
| `2` | 已安全保存，但本次运行页尚未加载新内容 |

本地验证只证明本地构建与隔离测试。GitHub 发布、Raw 内容和真实候选正常运行仍需各自证据。
