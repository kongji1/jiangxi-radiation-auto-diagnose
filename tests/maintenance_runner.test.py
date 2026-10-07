"""Offline maintenance tests: no browser, protocol or clinical requests."""
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "tools/maintain-project.py"
spec = importlib.util.spec_from_file_location("maintenance_runner", path)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.registry = {
            "schemaVersion": 1, "source": "example.user.js",
            "build": ["node", "tools/build-userscript.mjs", "--check"],
            "core": ["core"], "always": ["syntax-contract"],
            "sharedPaths": ["src/manifest.json", "tools/test-suites.json"],
            "ignorePaths": ["docs/**", "README.md"],
            "suites": [
                {"id": "core", "runner": "node", "path": "tests/core.test.mjs", "includes": ["src/core.js"]},
                {"id": "syntax-contract", "runner": "python", "path": "tests/contract.test.py", "includes": []},
                {"id": "entry", "runner": "node", "path": "tests/entry.test.mjs", "includes": ["src/entry/**"], "dependsOn": ["auth"]},
                {"id": "auth", "runner": "node", "path": "tests/auth.test.mjs", "includes": ["src/auth/**"], "dependsOn": ["core"]},
            ],
        }
        self.write("example.user.js", "// @version 0.8.55\n(() => {})();\n")
        self.write("src/core.js", "const x=1;\n")
        self.write("src/manifest.json", '{"modules":["src/core.js"]}')
        self.write("tools/build-userscript.mjs", "// fixture\n")
        self.write("tools/maintain-project.py", "# fixture\n")
        for suite in self.registry["suites"]:
            self.write(suite["path"], "// fixture\n")
        self.write("tools/test-suites.json", json.dumps(self.registry))
        self.commands = []
        self.changed = ["src/entry/open.js"]
        self.runtime_count = 0

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, body):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")

    def command(self, argv, root, timeout=120):
        self.commands.append(argv)
        stdout = ""
        if argv[:3] == ["git", "diff", "--name-only"]:
            stdout = "\0".join(self.changed) + "\0"
        elif argv[:2] == ["git", "ls-files"]:
            stdout = ""
        elif "update_tampermonkey_radiation_cdp.py" in argv:
            stdout = json.dumps({"ok": True, "version": "0.8.55", "uuid": "fixture-uuid",
                                 "hiddenTargetClosed": True, "businessPageReloaded": "--no-reload" not in argv})
        elif "tools/verify-radiation-runtime-cdp.py" in argv:
            self.runtime_count += 1
            at = f"2026-10-07T04:00:0{self.runtime_count}.000Z"
            stdout = json.dumps({"loadedRuntime": {"version": "0.8.55", "at": at, "evidence": "current-context",
                                                   "secret": "must not return"}, "visibleOptionsTargets": 0})
        return {"returncode": 0, "stdout": stdout, "stderr": "", "elapsedMs": 1}

    def suite_commands(self):
        return [item for item in self.commands if any(str(arg).startswith("tests/") for arg in item)]

    def test_registry_discovers_undocumented_executable_tests(self):
        self.write("tests/forgotten.test.py", "# fixture")
        with self.assertRaisesRegex(runner.MaintenanceError, "missing from the registry"):
            runner.read_registry(self.root)

    def test_registry_rejects_duplicate_ids(self):
        self.registry["suites"][1]["id"] = "core"
        self.write("tools/test-suites.json", json.dumps(self.registry))
        with self.assertRaisesRegex(runner.MaintenanceError, "unique"):
            runner.read_registry(self.root)

    def test_registry_rejects_outside_paths(self):
        self.registry["suites"][0]["path"] = "../escape.test.mjs"
        self.write("tools/test-suites.json", json.dumps(self.registry))
        with self.assertRaisesRegex(runner.MaintenanceError, "outside"):
            runner.read_registry(self.root)

    def test_changed_selection_includes_core_and_dependency_closure(self):
        suites, reason = runner.select_suites(self.registry, ["src/entry/open.js"])
        self.assertEqual({x["id"] for x in suites}, {"core", "syntax-contract", "entry", "auth"})
        self.assertEqual(reason, "changed-with-core")

    def test_document_change_runs_required_core(self):
        suites, _ = runner.select_suites(self.registry, ["docs/HANDOFF.md"])
        self.assertEqual([x["id"] for x in suites], ["core", "syntax-contract"])

    def test_unknown_path_falls_back_to_all(self):
        suites, reason = runner.select_suites(self.registry, ["new-business-module.js"])
        self.assertEqual(len(suites), 4)
        self.assertEqual(reason, "unknown-path")

    def test_shared_path_falls_back_to_all(self):
        _, reason = runner.select_suites(self.registry, ["src/manifest.json"])
        self.assertEqual(reason, "shared-path")

    def test_test_path_selects_its_suite(self):
        suites, _ = runner.select_suites(self.registry, ["tests/auth.test.mjs"])
        self.assertIn("auth", {x["id"] for x in suites})

    def test_git_covers_worktree_index_base_and_untracked(self):
        responses = ["src/a.js\0", "src/b.js\0", "src/c.js\0", "tests/new.test.py\0"]
        def fake(argv, root):
            self.commands.append(argv)
            return {"returncode": 0, "stdout": responses.pop(0)}
        value = runner.git_paths(self.root, "origin/main", fake)
        self.assertEqual(value, ["src/a.js", "src/b.js", "src/c.js", "tests/new.test.py"])
        self.assertIn("origin/main", self.commands[0])
        self.assertIn("--no-renames", self.commands[1])

    def test_git_invalid_base_fails_closed(self):
        with self.assertRaisesRegex(runner.MaintenanceError, "base"):
            runner.git_paths(self.root, "unknown", lambda *a: {"returncode": 128})

    def test_cache_hash_covers_source_test_runner_manifest_registry(self):
        self.write("docs/HANDOFF.md", "fixture")
        self.write("README.md", "fixture")
        self.write("PROJECT_STATE.json", "{}")
        for filename in ("src/core.js", "tests/core.test.mjs", "tools/maintain-project.py", "src/manifest.json", "tools/test-suites.json", "docs/HANDOFF.md", "README.md", "PROJECT_STATE.json"):
            before = runner.project_hash(self.root)
            self.write(filename, (self.root / filename).read_text(encoding="utf-8") + " ")
            self.assertNotEqual(runner.project_hash(self.root), before, filename)

    def test_cache_hash_ignores_runtime_and_python_bytecode(self):
        before = runner.project_hash(self.root)
        self.write(".runtime-maintenance/log.json", "private fixture")
        self.write("tools/__pycache__/temp.pyc", "compiled fixture")
        self.assertEqual(runner.project_hash(self.root), before)

    def test_launchers_cmd_and_bat_invalidate_cached_test_proof(self):
        for filename in ("Update-Tampermonkey-Radiation.cmd", "launch-test.bat"):
            self.write(filename, "echo first")
            before = runner.project_hash(self.root)
            self.write(filename, "echo second")
            self.assertNotEqual(runner.project_hash(self.root), before)

    def test_cache_same_hash_skips_tests_but_never_checks(self):
        first = runner.test_project(self.root, run=self.command)
        self.assertTrue(first["ok"])
        self.commands.clear()
        second = runner.test_project(self.root, run=self.command)
        self.assertTrue(all(item["cached"] for item in second["suites"]))
        self.assertFalse(self.suite_commands())
        self.assertIn(["node", "--check", "example.user.js"], self.commands)
        self.assertIn(["node", "tools/build-userscript.mjs", "--check"], self.commands)

    def test_all_always_reruns_tests_even_when_hash_is_cached(self):
        runner.test_project(self.root, all_tests=True, run=self.command)
        self.commands.clear()
        result = runner.test_project(self.root, all_tests=True, run=self.command)
        self.assertEqual(len(self.suite_commands()), 4)
        self.assertTrue(all(not item["cached"] for item in result["suites"]))

    def test_same_version_source_change_invalidates_cache(self):
        runner.test_project(self.root, run=self.command)
        self.commands.clear()
        self.write("src/core.js", "const x=2;\n")
        result = runner.test_project(self.root, run=self.command)
        self.assertTrue(all(not item["cached"] for item in result["suites"]))

    def test_failed_check_stops_before_tests_and_cache(self):
        def fail(argv, root):
            return {"returncode": 1, "stdout": "", "elapsedMs": 1}
        result = runner.test_project(self.root, run=fail)
        self.assertEqual(result["readiness"], "CHECK_FAILED")
        self.assertFalse((self.root / runner.CACHE).exists())

    def test_failed_test_is_not_cached(self):
        def fail(argv, root):
            item = self.command(argv, root)
            if "tests/core.test.mjs" in argv:
                item["returncode"] = 1
            return item
        result = runner.test_project(self.root, run=fail)
        self.assertEqual(result["readiness"], "TEST_FAILED")
        self.assertFalse((self.root / runner.CACHE).exists())

    def test_cache_only_holds_hash_and_test_state(self):
        runner.test_project(self.root, run=self.command)
        value = json.loads((self.root / runner.CACHE).read_text(encoding="utf-8"))
        self.assertEqual(set(value), {"schemaVersion", "contentHash", "passedSuites", "verifiedAtUnix"})
        self.assertNotIn("stdout", value)

    def test_runtime_discards_any_unexpected_fields(self):
        value = runner.runtime_version(self.root, version="0.8.55", run=self.command)
        self.assertTrue(value["verified"])
        self.assertEqual(set(value["loadedRuntime"]), {"version", "at", "evidence"})
        self.assertNotIn("secret", json.dumps(value))

    def test_local_cdp_rejects_remote_or_authenticated_endpoint(self):
        for url in ("http://example.com:9333", "http://secret@127.0.0.1:9333", "http://127.0.0.1:9333/?token=secret"):
            with self.assertRaises(runner.MaintenanceError):
                runner.local_cdp(url)

    def test_missing_cdp_only_probes_once_and_never_starts_browser(self):
        calls = []
        def unavailable(url, timeout):
            calls.append(url)
            raise OSError("offline")
        value = runner.cdp_health(opener=unavailable)
        self.assertFalse(value["ready"])
        self.assertEqual(len(calls), 1)
        self.assertIn("NO_BROWSER_STARTED", value["reason"])

    def test_status_without_cdp_does_not_run_runtime_or_updater(self):
        with patch.object(runner, "cdp_health", return_value={"ready": False}):
            value = runner.status_project(self.root, run=self.command)
        self.assertIsNone(value["runtime"])
        self.assertFalse(any("update_tampermonkey_radiation_cdp.py" in x for x in self.commands))
        self.assertFalse(any("tools/verify-radiation-runtime-cdp.py" in x for x in self.commands))

    def test_status_detects_manifest_artifact_version_drift(self):
        self.write("src/manifest.json", '{"version":"0.8.56"}')
        with patch.object(runner, "cdp_health", return_value={"ready": False}):
            value = runner.status_project(self.root, run=self.command)
        self.assertEqual(value["manifestVersion"], "0.8.56")
        self.assertEqual(value["artifactVersion"], "0.8.55")
        self.assertTrue(value["buildDrift"])

    def test_deploy_native_save_hash_and_loaded_version_are_separate(self):
        source_hash = runner.source_info(self.root, self.registry)["sourceSha256Lf"]
        with patch.object(runner, "cdp_health", return_value={"ready": True}):
            value = runner.deploy_project(self.root, run=self.command,
                hash_reader=lambda cdp, uuid: {"verified": True, "sourceSha256Lf": source_hash})
        self.assertEqual(value["readiness"], "DEPLOYED")
        self.assertTrue(value["saved"] and value["installedHashVerified"] and value["runtimeLoaded"])
        self.assertIn("hotReloadElapsedMs", value)
        self.assertEqual(value["hotReloadBudgetMs"], 3000)

    def test_report_page_save_never_claims_runtime_has_loaded_new_source(self):
        source_hash = runner.source_info(self.root, self.registry)["sourceSha256Lf"]
        with patch.object(runner, "cdp_health", return_value={"ready": True}):
            value = runner.deploy_project(self.root, no_reload=True, run=self.command,
                hash_reader=lambda cdp, uuid: {"verified": True, "sourceSha256Lf": source_hash})
        self.assertEqual(value["readiness"], "SAVED_PENDING_LOAD")
        self.assertTrue(value["saved"])
        self.assertFalse(value["runtimeLoaded"])
        self.assertIn("--no-reload", next(x for x in self.commands if "update_tampermonkey_radiation_cdp.py" in x))

    def test_equal_version_cannot_mask_wrong_installed_source_hash(self):
        with patch.object(runner, "cdp_health", return_value={"ready": True}):
            value = runner.deploy_project(self.root, run=self.command,
                hash_reader=lambda cdp, uuid: {"verified": True, "sourceSha256Lf": "wrong"})
        self.assertEqual(value["readiness"], "INSTALLED_HASH_UNCONFIRMED")
        self.assertFalse(value["runtimeLoaded"])

    def test_same_version_old_document_during_reload_stays_pending(self):
        source_hash = runner.source_info(self.root, self.registry)["sourceSha256Lf"]
        def old_document(argv, root, timeout=120):
            value = self.command(argv, root, timeout)
            if "tools/verify-radiation-runtime-cdp.py" in argv:
                record = json.loads(value["stdout"])
                record["loadedRuntime"]["at"] = "2026-10-07T04:00:00.000Z"
                value["stdout"] = json.dumps(record)
            return value
        with patch.object(runner, "cdp_health", return_value={"ready": True}):
            value = runner.deploy_project(self.root, run=old_document,
                hash_reader=lambda cdp, uuid: {"verified": True, "sourceSha256Lf": source_hash})
        self.assertTrue(value["businessPageReloaded"])
        self.assertFalse(value["newDocumentRuntimeConfirmed"])
        self.assertFalse(value["runtimeLoaded"])
        self.assertEqual(value["readiness"], "SAVED_PENDING_LOAD")

    def test_runtime_start_comparison_requires_later_timezone_aware_evidence(self):
        self.assertFalse(runner.new_runtime_start({"at": "invalid"}, {"at": "invalid"}))
        self.assertFalse(runner.new_runtime_start({"at": "2026-10-07T04:00:02Z"}, {"at": "2026-10-07T04:00:01Z"}))
        self.assertTrue(runner.new_runtime_start({"at": "2026-10-07T04:00:01Z"}, {"at": "2026-10-07T04:00:02Z"}))

    def test_deploy_failed_tests_never_call_updater(self):
        def fail(argv, root):
            value = self.command(argv, root)
            if "tests/core.test.mjs" in argv:
                value["returncode"] = 1
            return value
        value = runner.deploy_project(self.root, run=fail)
        self.assertFalse(value["saved"])
        self.assertFalse(any("update_tampermonkey_radiation_cdp.py" in x for x in self.commands))

    def test_installed_source_hash_reads_only_existing_worker(self):
        calls = []
        fake = types.SimpleNamespace(
            target_infos=lambda: [{"type": "service_worker", "url": f"chrome-extension://{runner.EXTENSION_ID}/background.js", "targetId": "worker"}],
            call=lambda method, args: calls.append((method, args)) or {"sessionId": "fixture"},
            evaluate=lambda session, expr: calls.append(("evaluate", expr)) or {"available": True, "sourceSha256Lf": "hash"},
            browser=types.SimpleNamespace(close=lambda: calls.append(("close", None))))
        value = runner.installed_hash(runner.DEFAULT_CDP, "fixture", factory=lambda url: fake)
        self.assertTrue(value["verified"])
        self.assertNotIn("Target.createTarget", [item[0] for item in calls])
        expression = next(item[1] for item in calls if item[0] == "evaluate")
        self.assertIn("!extdb.@source#", expression)
        self.assertNotIn("@st#", expression)
        self.assertIn("crypto.subtle.digest", expression)

    def test_command_parser_has_safe_default_changed_mode(self):
        value = runner.parser().parse_args(["test"])
        self.assertFalse(value.all_tests)
        self.assertEqual(value.base, "HEAD")
        with self.assertRaises(SystemExit):
            runner.parser().parse_args(["test", "--all", "--changed"])


if __name__ == "__main__":
    unittest.main()
