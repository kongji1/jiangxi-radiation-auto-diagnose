"""One local maintenance entry: source checks, selected tests, CDP and diagnosis.

The registry owns suite selection. Cache files contain only content hashes,
suite IDs, timestamps and timings. Status never launches a browser. Deployment
uses the existing hidden native updater and never refreshes a report page.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import fnmatch
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = "tools/test-suites.json"
CACHE = ".runtime-maintenance/verified-tests.json"
DEFAULT_CDP = "http://127.0.0.1:9333"
SCRIPT_UUID = "23e8f7dc-df23-419c-bf55-2dce8ade789b"
EXTENSION_ID = "iikmkjmpaadaobahmlepeloendndfphd"


class MaintenanceError(RuntimeError):
    """A bounded, non-sensitive explanation suitable for CLI output."""


def elapsed(start):
    return round((time.monotonic() - start) * 1000)


def relative_file(root, path):
    candidate = (root / path).resolve()
    if not candidate.is_relative_to(root.resolve()):
        raise MaintenanceError("Registry path is outside the project")
    return candidate


def execute(argv, root=ROOT, timeout=120):
    start = time.monotonic()
    try:
        item = subprocess.run(argv, cwd=root, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
        return {"returncode": item.returncode, "stdout": item.stdout,
                "stderr": item.stderr, "elapsedMs": elapsed(start)}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"returncode": -1, "stdout": "", "stderr": "",
                "failure": type(error).__name__, "elapsedMs": elapsed(start)}


def read_registry(root=ROOT):
    try:
        registry = json.loads((root / REGISTRY).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise MaintenanceError("Test registry is missing or invalid") from None
    if registry.get("schemaVersion") != 1 or not isinstance(registry.get("suites"), list):
        raise MaintenanceError("Unsupported test registry schema")
    suites = registry["suites"]
    ids = [item.get("id") for item in suites]
    if any(not isinstance(x, str) or not x for x in ids) or len(ids) != len(set(ids)):
        raise MaintenanceError("Test suite IDs must be unique nonempty strings")
    for suite in suites:
        if suite.get("runner") not in ("node", "python"):
            raise MaintenanceError("Unsupported test runner")
        path = relative_file(root, suite.get("path", ""))
        if not path.is_file():
            raise MaintenanceError("Registered test file is missing")
        if not isinstance(suite.get("includes", []), list):
            raise MaintenanceError("Test includes must be a pattern list")
        if not set(suite.get("dependsOn", [])).issubset(ids):
            raise MaintenanceError("Test dependency is not registered")
    if not set(registry.get("core", []) + registry.get("always", [])).issubset(ids):
        raise MaintenanceError("Core suite is not registered")
    registered = {item["path"].replace("\\", "/") for item in suites}
    discovered = {item.relative_to(root).as_posix() for item in (root / "tests").rglob("*")
                  if item.is_file() and (item.name.endswith(".test.mjs") or item.name.endswith(".test.py"))}
    if discovered - registered:
        raise MaintenanceError("An executable test is missing from the registry")
    return registry


def git_paths(root=ROOT, base="HEAD", run=execute):
    """Include base changes, index, worktree and untracked files, including renames."""
    paths = set()
    commands = (["git", "diff", "--name-only", "--no-renames", "-z", base, "--"],
                ["git", "diff", "--cached", "--name-only", "--no-renames", "-z", base, "--"],
                ["git", "diff", "--name-only", "--no-renames", "-z", "HEAD", "--"],
                ["git", "ls-files", "--others", "--exclude-standard", "-z"])
    for argv in commands:
        item = run(argv, root)
        if item["returncode"]:
            raise MaintenanceError("Cannot resolve Git changes or base")
        paths.update(x.replace("\\", "/") for x in item["stdout"].split("\0") if x)
    return sorted(paths)


def matches(path, patterns):
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def select_suites(registry, paths=None, all_tests=False):
    suites = registry["suites"]
    by_id = {item["id"]: item for item in suites}
    if all_tests:
        return suites, "all-requested"
    selected = set(registry.get("core", [])) | set(registry.get("always", []))
    reason = "changed-with-core"
    for path in paths or []:
        if matches(path, registry.get("sharedPaths", [])):
            return suites, "shared-path"
        found = {item["id"] for item in suites
                 if path == item["path"] or matches(path, item.get("includes", []))}
        if found:
            selected.update(found)
        elif not matches(path, registry.get("ignorePaths", [])):
            return suites, "unknown-path"
    pending = list(selected)
    while pending:
        for dependency in by_id[pending.pop()].get("dependsOn", []):
            if dependency not in selected:
                selected.add(dependency)
                pending.append(dependency)
    return [item for item in suites if item["id"] in selected], reason


def project_hash(root=ROOT):
    """Cover modules, all tests, all maintenance code and build/CI manifests."""
    files = set()
    for directory in ("src", "tests", "tools", "docs", ".github/workflows"):
        parent = root / directory
        if parent.exists():
            files.update(item for item in parent.rglob("*") if item.is_file()
                         and "__pycache__" not in item.parts and item.suffix != ".pyc")
    files.update(item for item in root.iterdir() if item.is_file() and
                 (item.suffix in (".json", ".mjs", ".py", ".ps1", ".md", ".cmd", ".bat") or item.name.endswith(".user.js")))
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda x: x.relative_to(root).as_posix()):
        name = path.relative_to(root).as_posix().encode("utf-8")
        body = path.read_bytes()
        digest.update(len(name).to_bytes(4, "big") + name)
        digest.update(len(body).to_bytes(8, "big") + body)
    return digest.hexdigest()


def source_info(root=ROOT, registry=None):
    source = (registry or {}).get("source", "jiangxi-radiation-auto-diagnose.user.js")
    path = relative_file(root, source)
    body = path.read_text(encoding="utf-8")
    match = re.search(r"^\s*//\s*@version\s+(\S+)", body, re.M)
    if not match:
        raise MaintenanceError("Userscript version is missing")
    return {"version": match.group(1), "source": source,
            "sourceSha256Lf": hashlib.sha256(body.replace("\r\n", "\n").encode("utf-8")).hexdigest()}


def command_for(suite):
    return (["node", suite["path"]] if suite["runner"] == "node"
            else [sys.executable, "-B", suite["path"]])


def required_checks(registry, root=ROOT, run=execute):
    """Never cache lint/build validation; require generated bytes and syntax."""
    build = registry.get("build", ["node", "tools/build-userscript.mjs", "--check"])
    source = registry.get("source", "jiangxi-radiation-auto-diagnose.user.js")
    checks = [build, ["node", "--check", source],
              ["git", "diff", "--check"], ["git", "diff", "--cached", "--check"]]
    checks.extend(item for item in registry.get("checks", []) if item not in checks)
    result = []
    for argv in checks:
        if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
            raise MaintenanceError("Check commands must be argv lists")
        item = run(argv, root)
        row = {"command": argv, "passed": item["returncode"] == 0,
               "exitCode": item["returncode"], "elapsedMs": item["elapsedMs"]}
        result.append(row)
        if not row["passed"]:
            return result, False
    return result, True


def read_cache(root=ROOT):
    try:
        value = json.loads((root / CACHE).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def save_cache(root, digest, suite_ids):
    path = root / CACHE
    path.parent.mkdir(parents=True, exist_ok=True)
    value = {"schemaVersion": 1, "contentHash": digest,
             "passedSuites": sorted(suite_ids), "verifiedAtUnix": int(time.time())}
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def test_project(root=ROOT, all_tests=False, base="HEAD", no_cache=False, run=execute):
    start = time.monotonic()
    registry = read_registry(root)
    checks, valid = required_checks(registry, root, run)
    if not valid:
        return {"readiness": "CHECK_FAILED", "ok": False, "checks": checks,
                "suites": [], "elapsedMs": elapsed(start)}
    paths = [] if all_tests else git_paths(root, base, run)
    suites, reason = select_suites(registry, paths, all_tests)
    digest = project_hash(root)
    cache = {} if all_tests or no_cache else read_cache(root)
    passed = set(cache.get("passedSuites", [])) if cache.get("contentHash") == digest else set()
    rows = []
    for suite in suites:
        if suite["id"] in passed:
            rows.append({"id": suite["id"], "passed": True, "cached": True, "exitCode": 0, "elapsedMs": 0})
            continue
        item = run(command_for(suite), root)
        ok = item["returncode"] == 0
        rows.append({"id": suite["id"], "command": command_for(suite), "passed": ok,
                     "cached": False, "exitCode": item["returncode"], "elapsedMs": item["elapsedMs"]})
        if not ok:
            return {"readiness": "TEST_FAILED", "ok": False, "checks": checks,
                    "suites": rows, "selection": reason, "contentHash": digest, "elapsedMs": elapsed(start)}
        passed.add(suite["id"])
    if project_hash(root) != digest:
        raise MaintenanceError("Project changed during tests; results were not cached")
    save_cache(root, digest, passed)
    return {"readiness": "LOCAL_VERIFIED", "ok": True, "checks": checks,
            "suites": rows, "selection": reason, "contentHash": digest, "elapsedMs": elapsed(start)}


def local_cdp(url):
    parsed = urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or not parsed.port:
        raise MaintenanceError("Use a local standard CDP HTTP endpoint")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise MaintenanceError("CDP endpoint must not contain credentials or a path")
    return url.rstrip("/")


def cdp_health(url=DEFAULT_CDP, opener=None):
    start = time.monotonic()
    url = local_cdp(url)
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({})).open
    try:
        with opener(url + "/json/version", timeout=1) as response:
            data = json.load(response)
        ready = bool(data.get("webSocketDebuggerUrl"))
        return {"ready": ready, "elapsedMs": elapsed(start),
                "endpoint": url, "browser": data.get("Browser") if ready else None}
    except (OSError, ValueError):
        return {"ready": False, "elapsedMs": elapsed(start), "endpoint": url,
                "reason": "CDP_UNAVAILABLE_NO_BROWSER_STARTED"}


def json_output(output):
    for line in reversed(output.splitlines()):
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
    return {}


def runtime_version(root=ROOT, cdp=DEFAULT_CDP, version=None, run=execute):
    argv = [sys.executable, "-B", "tools/verify-radiation-runtime-cdp.py", "--cdp", cdp]
    if version:
        argv.extend(["--expected-version", version])
    item = run(argv, root, timeout=8)
    value = json_output(item["stdout"])
    # Only the dedicated verifier's already-whitelisted version proof is accepted.
    loaded = value.get("loadedRuntime")
    if not isinstance(loaded, dict):
        loaded = None
    else:
        loaded = {key: loaded.get(key) for key in ("version", "at", "evidence")}
    return {"verified": item["returncode"] == 0 and loaded is not None
                       and (not version or loaded.get("version") == version),
            "loadedRuntime": loaded, "visibleOptionsTargets": value.get("visibleOptionsTargets"),
            "elapsedMs": item["elapsedMs"]}


def installed_hash(cdp_url, uuid, factory=None):
    """Hash only the installed source inside its existing extension worker."""
    start = time.monotonic()
    if factory is None:
        sys.path.insert(0, str(ROOT))
        from update_tampermonkey_radiation_cdp import Cdp
        factory = Cdp
    cdp = factory(cdp_url)
    try:
        target = next((x for x in cdp.target_infos() if x.get("type") == "service_worker"
                       and x.get("url") == f"chrome-extension://{EXTENSION_ID}/background.js"), None)
        if not target:
            return {"verified": False, "reason": "EXISTING_EXTENSION_WORKER_UNAVAILABLE", "elapsedMs": elapsed(start)}
        session = cdp.call("Target.attachToTarget", {"targetId": target["targetId"], "flatten": True})["sessionId"]
        expression = """(async uuid => {
          const key = '!extdb.@source#' + uuid;
          const stored = (await chrome.storage.local.get(key))[key];
          const value = stored?.value;
          const source = typeof value === 'string' ? value : typeof value?.data === 'string' ? value.data : null;
          if (source === null) return {available:false};
          const bytes = new TextEncoder().encode(source.replace(/\\r\\n/g, '\\n'));
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map(x => x.toString(16).padStart(2, '0')).join('');
          return {available:true, sourceSha256Lf:hash};
        })(""" + json.dumps(uuid) + ")"
        result = cdp.evaluate(session, expression) or {}
        return {"verified": bool(result.get("available")), "sourceSha256Lf": result.get("sourceSha256Lf"),
                "elapsedMs": elapsed(start)}
    finally:
        cdp.browser.close()


def status_project(root=ROOT, cdp=DEFAULT_CDP, no_runtime=False, run=execute):
    start = time.monotonic()
    registry = read_registry(root)
    source = source_info(root, registry)
    try:
        manifest = json.loads((root / "src/manifest.json").read_text(encoding="utf-8"))
        manifest_version = manifest.get("version")
    except (OSError, ValueError, AttributeError):
        manifest_version = None
    checked = run(registry.get("build", ["node", "tools/build-userscript.mjs", "--check"]), root)
    working = run(["git", "status", "--porcelain"], root)
    commit = run(["git", "rev-parse", "--short", "HEAD"], root)
    if working["returncode"] or commit["returncode"]:
        raise MaintenanceError("Cannot inspect the current Git repository")
    health = cdp_health(cdp)
    runtime = runtime_version(root, cdp, manifest_version, run) if health["ready"] and not no_runtime else None
    return {"readiness": "STATUS_READ_ONLY", **source, "version": manifest_version,
            "manifestVersion": manifest_version, "artifactVersion": source["version"],
            "buildDrift": checked["returncode"] != 0 or manifest_version != source["version"],
            "buildCheckElapsedMs": checked["elapsedMs"], "contentHash": project_hash(root),
            "commit": commit["stdout"].strip(), "workingTree": "dirty" if working["stdout"] else "clean",
            "registeredSuites": len(registry["suites"]), "cdp": health, "runtime": runtime,
            "elapsedMs": elapsed(start)}


def new_runtime_start(previous, current):
    """An unchanged version/startup can be the old document during reload."""
    try:
        before = datetime.fromisoformat(previous["at"].replace("Z", "+00:00"))
        after = datetime.fromisoformat(current["at"].replace("Z", "+00:00"))
        return before.tzinfo is not None and after.tzinfo is not None and after > before
    except (TypeError, KeyError, ValueError, AttributeError):
        return False


def deploy_project(root=ROOT, cdp=DEFAULT_CDP, base="HEAD", all_tests=False, no_reload=False,
                   run=execute, hash_reader=installed_hash):
    start = time.monotonic()
    tests = test_project(root, all_tests, base, run=run)
    result = {"readiness": "DEPLOY_BLOCKED", "ok": False, "tests": tests,
              "saved": False, "installedHashVerified": False, "runtimeLoaded": False}
    if not tests["ok"]:
        result["elapsedMs"] = elapsed(start)
        return result
    health = cdp_health(cdp)
    if not health["ready"]:
        return {**result, "cdp": health, "elapsedMs": elapsed(start)}
    registry = read_registry(root)
    source = source_info(root, registry)
    # Prevent a saved script that was never tested, even if it keeps the version.
    if project_hash(root) != tests["contentHash"]:
        raise MaintenanceError("Project changed after tests; deployment stopped")
    previous = runtime_version(root, cdp, source["version"], run)
    result["runtimeBeforeSave"] = previous
    if not previous.get("loadedRuntime"):
        return {**result, "readiness": "CURRENT_BUSINESS_PAGE_UNCONFIRMED", "elapsedMs": elapsed(start)}
    hot_start = time.monotonic()
    argv = [sys.executable, "-B", "update_tampermonkey_radiation_cdp.py",
            "--source", source["source"], "--cdp", cdp]
    if no_reload:
        argv.append("--no-reload")
    saved = run(argv, root, timeout=15)
    native = json_output(saved["stdout"])
    result.update({"source": source, "saveElapsedMs": saved["elapsedMs"],
                   "saved": saved["returncode"] == 0 and native.get("ok") is True,
                   "businessPageReloaded": native.get("businessPageReloaded") is True,
                   "hiddenTargetClosed": native.get("hiddenTargetClosed") is True})
    if not result["saved"]:
        return {**result, "readiness": "SAVE_FAILED", "hotReloadElapsedMs": elapsed(hot_start), "elapsedMs": elapsed(start)}
    if not result["hiddenTargetClosed"]:
        return {**result, "readiness": "SAVE_TARGET_CLOSE_UNCONFIRMED", "hotReloadElapsedMs": elapsed(hot_start), "elapsedMs": elapsed(start)}
    try:
        installed = hash_reader(cdp, native.get("uuid") or SCRIPT_UUID)
    except Exception:
        installed = {"verified": False, "reason": "INSTALLED_SOURCE_READBACK_UNAVAILABLE"}
    result["installed"] = installed
    result["installedHashVerified"] = installed.get("verified") is True and installed.get("sourceSha256Lf") == source["sourceSha256Lf"]
    if not result["installedHashVerified"]:
        return {**result, "readiness": "INSTALLED_HASH_UNCONFIRMED", "hotReloadElapsedMs": elapsed(hot_start), "elapsedMs": elapsed(start)}
    runtime = runtime_version(root, cdp, source["version"], run)
    result["runtime"] = runtime
    # With the same version, only an actual list reload binds runtime to new bytes.
    result["newDocumentRuntimeConfirmed"] = new_runtime_start(previous.get("loadedRuntime"), runtime.get("loadedRuntime"))
    result["runtimeLoaded"] = runtime["verified"] and result["businessPageReloaded"] and result["newDocumentRuntimeConfirmed"]
    hot_ms = elapsed(hot_start)
    result.update({"ok": result["runtimeLoaded"], "readiness": "DEPLOYED" if result["runtimeLoaded"] else "SAVED_PENDING_LOAD",
                   "hotReloadElapsedMs": hot_ms, "hotReloadBudgetMs": 3000,
                   "withinHotReloadBudget": hot_ms <= 3000, "elapsedMs": elapsed(start)})
    return result


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)
    status = sub.add_parser("status", help="Read Git/source/local CDP/runtime without modifying a page")
    status.add_argument("--no-runtime", action="store_true")
    status.add_argument("--cdp", default=DEFAULT_CDP)
    tests = sub.add_parser("test", help="Run registry-selected local verification")
    group = tests.add_mutually_exclusive_group()
    group.add_argument("--all", action="store_true", dest="all_tests")
    group.add_argument("--changed", action="store_true")
    tests.add_argument("--base", default="HEAD")
    tests.add_argument("--no-cache", action="store_true")
    deploy = sub.add_parser("deploy", help="Check/test, native save, list-only reload, hash/runtime readback")
    deploy.add_argument("--all", action="store_true", dest="all_tests")
    deploy.add_argument("--base", default="HEAD")
    deploy.add_argument("--no-reload", action="store_true")
    deploy.add_argument("--cdp", default=DEFAULT_CDP)
    diagnosis = sub.add_parser("diagnose", help="Read retained evidence for a named candidate; do not save it")
    diagnosis.add_argument("--name", required=True)
    diagnosis.add_argument("--cdp", default=DEFAULT_CDP)
    version = sub.add_parser("version", help="Advance manifest/state version and regenerate with rollback")
    version.add_argument("--to", required=True)
    version.add_argument("--dry-run", action="store_true")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "version":
            command = [sys.executable, "-B", "tools/set-project-version.py", "--to", args.to]
            if args.dry_run:
                command.append("--dry-run")
            return subprocess.run(command, cwd=ROOT).returncode
        if args.command == "diagnose":
            local_cdp(args.cdp)
            # Explicit diagnosis is displayed only in this terminal, never cached.
            process = subprocess.run([sys.executable, "-B", "tools/diagnose-candidate.py", "--name", args.name,
                                      "--cdp", args.cdp], cwd=ROOT)
            return process.returncode
        if args.command == "status":
            value = status_project(cdp=local_cdp(args.cdp), no_runtime=args.no_runtime)
        elif args.command == "test":
            value = test_project(all_tests=args.all_tests, base=args.base, no_cache=args.no_cache)
        else:
            value = deploy_project(cdp=local_cdp(args.cdp), base=args.base,
                                   all_tests=args.all_tests, no_reload=args.no_reload)
        print(json.dumps(value, ensure_ascii=False))
        verification = value.get("tests", value)
        if verification.get("readiness") in ("CHECK_FAILED", "TEST_FAILED"):
            failed = next((row for row in verification.get("suites", []) if not row["passed"]), None)
            check = next((row for row in verification.get("checks", []) if not row["passed"]), None)
            message = ("suite failed: " + failed["id"] + " exit=" + str(failed["exitCode"]) if failed
                       else "check failed: " + json.dumps((check or {}).get("command", []))
                       + " exit=" + str((check or {}).get("exitCode")))
            print("[maintenance] " + message, file=sys.stderr)
        if value.get("readiness") == "SAVED_PENDING_LOAD":
            return 2
        return 0 if value.get("ok", True) else 1
    except MaintenanceError as error:
        print(json.dumps({"ok": False, "readiness": "MAINTENANCE_FAILED", "reason": str(error)}, ensure_ascii=False))
        return 1
    except (OSError, ValueError, ImportError, RuntimeError) as error:
        # Do not print subprocess payloads, URLs or browser data in generic errors.
        print(json.dumps({"ok": False, "readiness": "MAINTENANCE_FAILED", "errorType": type(error).__name__}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
