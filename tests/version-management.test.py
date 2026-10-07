"""Version transactions on disposable fixtures; never mutate the actual project."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

file = Path(__file__).resolve().parents[1] / "tools/set-project-version.py"
spec = importlib.util.spec_from_file_location("version_management", file)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VersionManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.output = self.root / module.OUTPUT
        self.manifest = self.root / "src/manifest.json"
        self.state = self.root / "PROJECT_STATE.json"
        self.manifest.parent.mkdir()
        (self.root / "tools").mkdir()
        (self.root / "tools/build-userscript.mjs").write_text("// fixture", encoding="utf-8")
        self.manifest.write_text(json.dumps({"schemaVersion": 1, "version": "0.8.55", "versionToken": "{{SCRIPT_VERSION}}",
                                           "output": module.OUTPUT, "modules": []}), encoding="utf-8")
        self.state.write_text(json.dumps({"version": "0.8.55", "tampermonkeyLoadedVersion": "0.8.54 observed earlier",
                                         "latestRuntimeVerification": {"version": "0.8.54", "at": "historical"},
                                         "closeoutVerification": {"sourceVersion": "0.8.54"}}), encoding="utf-8")
        self.output.write_text(self.generated("0.8.55"), encoding="utf-8")
        self.original = self.snapshot()
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def generated(self, version):
        return f"// @version {version}\n(function () {{ const x=1;\n  const SCRIPT_VERSION = '{version}';\n}})();\n"

    def snapshot(self):
        return {name: (self.root / name).read_bytes() for name in module.FILES}

    def build(self, argv, root):
        self.calls.append(argv)
        if "--write" in argv:
            version = json.loads(self.manifest.read_text(encoding="utf-8"))["version"]
            self.output.write_text(self.generated(version), encoding="utf-8")
        return 0

    def test_manifest_state_and_generated_versions_move_together(self):
        value = module.set_version("0.8.56", self.root, run=self.build)
        self.assertEqual(value["readiness"], "VERSION_UPDATED")
        self.assertEqual(json.loads(self.manifest.read_text())["version"], "0.8.56")
        self.assertEqual(json.loads(self.state.read_text())["version"], "0.8.56")
        self.assertIn("// @version 0.8.56", self.output.read_text())
        self.assertIn("SCRIPT_VERSION = '0.8.56'", self.output.read_text())
        self.assertEqual(len(self.calls), 3)

    def test_historical_runtime_and_ci_records_are_retained(self):
        before = json.loads(self.original["PROJECT_STATE.json"])
        module.set_version("0.8.56", self.root, run=self.build)
        after = json.loads(self.state.read_text())
        del before["version"]
        del after["version"]
        self.assertEqual(after, before)

    def test_readme_guides_and_release_metadata_are_not_touched(self):
        for name in ("README.md", "release.json", "docs/GITHUB_HOT_UPDATE.md"):
            file = self.root / name
            file.parent.mkdir(exist_ok=True)
            file.write_bytes(b"historical record 0.8.55")
        module.set_version("0.8.56", self.root, run=self.build)
        for name in ("README.md", "release.json", "docs/GITHUB_HOT_UPDATE.md"):
            self.assertEqual((self.root / name).read_bytes(), b"historical record 0.8.55")

    def test_dry_run_performs_readonly_build_without_writing(self):
        value = module.set_version("0.8.56", self.root, dry_run=True, run=self.build)
        self.assertEqual(value["readiness"], "DRY_RUN")
        self.assertEqual(self.snapshot(), self.original)
        self.assertEqual(len(self.calls), 1)

    def test_same_version_is_noop_with_checks(self):
        value = module.set_version("0.8.55", self.root, run=self.build)
        self.assertEqual(value["readiness"], "NO_CHANGE")
        self.assertEqual(self.snapshot(), self.original)

    def test_numeric_upgrade_is_not_lexical(self):
        module.set_version("0.8.100", self.root, run=self.build)
        self.assertEqual(json.loads(self.manifest.read_text())["version"], "0.8.100")

    def test_prefixed_malformed_and_noncanonical_versions_are_rejected(self):
        for value in ("v0.8.56", "0.8", "0.8.56-beta", "00.8.56", "0.8.056", "0.8.56\n", "0.8.-1"):
            with self.subTest(value=value), self.assertRaises(module.VersionError):
                module.set_version(value, self.root, run=self.build)
        self.assertEqual(self.snapshot(), self.original)
        self.assertFalse(self.calls)

    def test_downgrade_is_rejected_before_writing(self):
        with self.assertRaisesRegex(module.VersionError, "downgrade"):
            module.set_version("0.8.54", self.root, run=self.build)
        self.assertEqual(self.snapshot(), self.original)

    def test_state_manifest_mismatch_is_not_silently_repaired(self):
        self.state.write_text('{"version":"0.8.54"}', encoding="utf-8")
        before = self.snapshot()
        with self.assertRaisesRegex(module.VersionError, "differs"):
            module.set_version("0.8.56", self.root, run=self.build)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.calls)

    def test_builder_preflight_failure_makes_zero_writes(self):
        with self.assertRaisesRegex(module.VersionError, "Current"):
            module.set_version("0.8.56", self.root, run=lambda *a: 1)
        self.assertEqual(self.snapshot(), self.original)

    def test_builder_failure_restores_original_bytes_including_generated_output(self):
        def broken(argv, root):
            if "--write" in argv:
                self.output.write_bytes(b"partial generated artifact")
                return 1
            return 0
        with self.assertRaisesRegex(module.VersionError, "restored"):
            module.set_version("0.8.56", self.root, run=broken)
        self.assertEqual(self.snapshot(), self.original)
        self.assertFalse(list(self.root.rglob(".version-*.tmp")))

    def test_wrong_generated_version_rolls_back_every_file(self):
        with self.assertRaisesRegex(module.VersionError, "mismatch"):
            module.set_version("0.8.56", self.root, run=lambda *a: 0)
        self.assertEqual(self.snapshot(), self.original)

    def test_concurrent_preflight_edit_is_not_overwritten(self):
        def edit(argv, root):
            self.state.write_bytes(b'{"version":"0.8.55","other":"new"}')
            return 0
        with self.assertRaisesRegex(module.VersionError, "changed"):
            module.set_version("0.8.56", self.root, run=edit)
        self.assertEqual(self.manifest.read_bytes(), self.original["src/manifest.json"])
        self.assertIn(b'"new"', self.state.read_bytes())

    def test_linked_file_escape_is_rejected(self):
        target = self.root / "outside.json"
        target.write_bytes(self.manifest.read_bytes())
        self.manifest.unlink()
        try:
            self.manifest.symlink_to(target)
        except OSError:
            self.skipTest("Creating symbolic links is not permitted on this host")
        with self.assertRaisesRegex(module.VersionError, "symbolic link"):
            module.set_version("0.8.56", self.root, run=self.build)

    def test_linked_root_is_rejected(self):
        alias = self.root.parent / (self.root.name + "-alias")
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except OSError:
            self.skipTest("Creating symbolic links is not permitted on this host")
        try:
            with self.assertRaisesRegex(module.VersionError, "real directory"):
                module.set_version("0.8.56", alias, run=self.build)
        finally:
            alias.unlink()


if __name__ == "__main__":
    unittest.main()
