"""Offline runtime-evidence tests; no browser, clinical data or network needed."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock

sys.modules.setdefault("websocket", types.ModuleType("websocket"))
path = Path(__file__).resolve().parents[1] / "tools/verify-radiation-runtime-cdp.py"
spec = importlib.util.spec_from_file_location("runtime_verifier", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RuntimeEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.cdp = module.RuntimeCdp.__new__(module.RuntimeCdp)
        self.cdp.versions = []
        self.cdp.active_contexts = {7}
        self.cdp.writers = {}
        self.cdp.evaluate = Mock(return_value=[])

    def event(self, name="运行版本", context=7, version="0.8.54"):
        return {"method": "Runtime.consoleAPICalled", "params": {
            "executionContextId": context, "args": [{"value": "[自动诊断][开发者] " + json.dumps({
                "event": name, "version": version, "at": "2026-10-07T01:52:14.683Z",
                "eventId": "runtime-writer-1234:3", "extra": "must not be returned",
            })}]}}

    def test_current_console_version_is_sanitized(self):
        self.cdp.observe(self.event())
        value = self.cdp.loaded_runtime("fixture")
        self.assertEqual(value["version"], "0.8.54")
        self.assertEqual(set(value), {"version", "at", "evidence"})
        self.cdp.evaluate.assert_not_called()

    def test_evicted_startup_uses_only_current_writer(self):
        self.cdp.observe(self.event("候选过滤"))
        self.cdp.evaluate.return_value = [{"version": "0.8.54", "at": "2026-10-07T01:52:14.683Z"}]
        value = self.cdp.loaded_runtime("fixture")
        self.assertIn("writer matched", value["evidence"])
        expression = self.cdp.evaluate.call_args.args[1]
        self.assertIn('"runtime-writer-1234"', expression)
        self.assertIn('writers.has(journal?.writerId)', expression)
        self.assertIn("source === 'runtime-start'", expression)
        self.assertNotIn("must not be returned", expression)

    def test_destroyed_context_cannot_supply_history(self):
        self.cdp.observe(self.event())
        self.cdp.observe({"method": "Runtime.executionContextDestroyed", "params": {"executionContextId": 7}})
        self.assertIsNone(self.cdp.loaded_runtime("fixture"))
        self.cdp.evaluate.assert_not_called()

    def test_context_clear_invalidates_all_witnesses(self):
        self.cdp.observe(self.event())
        self.cdp.observe({"method": "Runtime.executionContextsCleared"})
        self.assertFalse(self.cdp.writers)
        self.assertFalse(self.cdp.versions)
        self.assertIsNone(self.cdp.loaded_runtime("fixture"))

    def test_unknown_context_cannot_identify_runtime(self):
        self.cdp.observe(self.event(context=99))
        self.assertIsNone(self.cdp.loaded_runtime("fixture"))

    def test_conflicting_active_versions_fail_closed(self):
        self.cdp.observe(self.event())
        self.cdp.observe(self.event(version="0.8.53"))
        with self.assertRaisesRegex(RuntimeError, "Conflicting versions"):
            self.cdp.loaded_runtime("fixture")

    def test_invalid_events_are_ignored(self):
        for value in ("[自动诊断][开发者] invalid", "[自动诊断][开发者] []", "unrelated"):
            self.cdp.observe({"method": "Runtime.consoleAPICalled", "params": {
                "executionContextId": 7, "args": [{"value": value}]}})
        self.assertIsNone(self.cdp.loaded_runtime("fixture"))
        self.assertIsNone(module.select_runtime_version([{}, {"version": "bad", "at": "now"}], "fixture"))

    def test_new_context_and_missing_journal_are_explicit(self):
        self.cdp.observe({"method": "Runtime.executionContextCreated", "params": {"context": {"id": 9}}})
        self.cdp.observe(self.event("候选过滤", context=9))
        self.assertIsNone(self.cdp.loaded_runtime("fixture"))
        self.cdp.evaluate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
