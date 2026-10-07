"""Meaningful offline candidate diagnoses; no clinical data or browser required."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch


path = Path(__file__).resolve().parents[1] / "tools/diagnose-candidate.py"
spec = importlib.util.spec_from_file_location("candidate_diagnostics", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def event(name, second=0, **fields):
    return {"at": f"2026-10-07T03:16:{second:02d}.000Z", "event": name, **fields}


def fixture(*events, **fields):
    return {"debug": {"timeline": list(events), "settings": {"enabled": True}, **fields}}


class CandidateDiagnosisTests(unittest.TestCase):
    def test_final_other_owner_rejection_is_not_success_after_assertion(self):
        result = module.diagnose(fixture(event("协议进入成功", phase="assert-allowed"),
            event("报告进入拒绝", 1, code=500, httpStatus=200, serverMessage="当前报告已被其他用户锁定！", durationMs=367)))
        self.assertEqual(result["diagnosis"]["code"], "server-other-owner-lock")
        self.assertEqual(result["diagnosis"]["certainty"], "confirmed")
        self.assertEqual(result["latencies"]["assertionAllowedToFinalRequestMs"], 633)

    def test_assertion_and_navigation_without_native_final_remain_unconfirmed(self):
        result = module.diagnose(fixture(event("协议进入成功", phase="assert-allowed", finalReportLoaded=False),
            event("诊断路由导航", 1)))
        self.assertEqual(result["diagnosis"]["code"], "assert-allowed-no-final")
        self.assertEqual(result["diagnosis"]["certainty"], "insufficient")

    def test_network_unknown_does_not_claim_no_lock_or_retry(self):
        result = module.diagnose(fixture(event("协议最终进入异常", errorClass="TimeoutError")))
        self.assertEqual(result["diagnosis"]["code"], "final-result-unknown")
        self.assertEqual(result["diagnosis"]["certainty"], "insufficient")

    def test_business_200_invalid_owner_is_unknown_not_known_rejection(self):
        result = module.diagnose(fixture(event("协议最终进入拒绝", code=200, httpStatus=200, ownerMatches=False)))
        self.assertEqual(result["diagnosis"]["code"], "final-result-unknown")

    def test_http_500_is_unknown_even_with_business_500(self):
        result = module.diagnose(fixture(event("协议最终进入拒绝", code=500, httpStatus=503)))
        self.assertEqual(result["diagnosis"]["code"], "final-result-unknown")

    def test_http_failure_with_lock_text_still_cannot_confirm_other_owner(self):
        result = module.diagnose(fixture(event("协议最终进入拒绝", code=500, httpStatus=503,
            serverMessage="当前报告已被其他用户锁定")))
        self.assertEqual(result["diagnosis"]["code"], "final-result-unknown")

    def test_generic_lock_rejection_does_not_identify_other_account(self):
        result = module.diagnose(fixture(event("协议最终进入拒绝", code=500, httpStatus=200,
            serverMessage="报告已锁定")))
        self.assertEqual(result["diagnosis"]["code"], "server-lock-rejected")

    def test_lock_service_failure_is_not_an_other_owner_lock(self):
        result = module.diagnose(fixture(event("协议最终进入拒绝", code=500, httpStatus=200,
            serverMessage="锁定服务不可用")))
        self.assertEqual(result["diagnosis"]["code"], "final-entry-rejected")

    def test_success_requires_final_report_loaded(self):
        self.assertEqual(module.diagnose(fixture(event("报告进入完成", code=200, finalReportLoaded=False)))["diagnosis"]["code"], "native-load-unconfirmed")
        self.assertEqual(module.diagnose(fixture(event("报告进入完成", code=200, finalReportLoaded=True)))["diagnosis"]["code"], "entered")

    def test_acquisition_is_not_native_load_and_handoff_failure_is_separate(self):
        acquired = event("协议最终进入取得", code=200, finalReportLoaded=False)
        self.assertEqual(module.diagnose(fixture(acquired))["diagnosis"]["code"], "acquired-native-load-unconfirmed")
        failed = event("已取得报告但页面交接失败，自动打开暂停", 1)
        self.assertEqual(module.diagnose(fixture(acquired, failed))["diagnosis"]["code"], "acquired-handoff-failed")

    def test_observation_disabled_describes_historical_event_not_current_toggle(self):
        result = module.diagnose(fixture(event("观察模式跳过自动打开", reason="自动打开已关闭")))
        self.assertTrue(result["configuration"]["current"]["enabled"])
        self.assertEqual(result["diagnosis"]["code"], "auto-open-disabled")
        self.assertIn("historical-config-missing", [e["code"] for e in result["evidenceGaps"]])

    def test_historical_filter_remains_true_when_current_config_unlimited(self):
        value = fixture(event("候选过滤", 1, failedRules=["检查类型不符"]),
            historicalGateSnapshots=[{"at": "2026-10-07T03:15:00.000Z", "modalities": ["CT"]}],
            settings={"modalities": [], "enabled": True})
        result = module.diagnose(value)
        self.assertEqual(result["diagnosis"]["code"], "rules-blocked")
        self.assertEqual(result["configuration"]["differences"], [{"field": "modalities", "snapshotValue": ["CT"], "currentValue": []}])
        self.assertTrue(result["configuration"]["comparisonOnly"])

    def test_future_snapshot_cannot_explain_previous_event(self):
        result = module.diagnose(fixture(event("候选命中"), historicalGateSnapshots=[
            {"at": "2026-10-07T03:17:00.000Z", "autoOpenEnabled": False}]))
        self.assertIsNone(result["configuration"]["historicalSnapshot"])
        self.assertEqual(result["diagnosis"]["certainty"], "insufficient")

    def test_effective_schedule_gate_is_not_renamed_to_saved_checkbox(self):
        result = module.diagnose(fixture(event("候选命中", 1), historicalGateSnapshots=[
            {"at": "2026-10-07T03:15:00Z", "autoOpenEnabled": False,
             "autoEntrySchedule": {"slot": "afternoon", "date": "2026-10-07", "state": "pending"}}],
            settings={"enabled": True, "autoEntrySchedule": {"slot": "afternoon", "date": "2026-10-07", "requiresSelection": False}}))
        self.assertNotIn("enabled", result["configuration"]["historicalSnapshot"])
        self.assertEqual(result["configuration"]["differences"], [])

    def test_other_context_snapshot_cannot_explain_selected_context(self):
        result = module.diagnose(fixture(event("候选过滤", 1, contextLabel="context-1", failedRules=["检查类型"]),
            historicalGateSnapshots=[
                {"at": "2026-10-07T03:14:00Z", "contextLabel": "context-1", "modalities": ["CT"]},
                {"at": "2026-10-07T03:15:00Z", "contextLabel": "context-2", "modalities": ["DR"]}],
            settings={"modalities": []}))
        self.assertEqual(result["configuration"]["historicalSnapshot"]["modalities"], ["CT"])

    def test_failed_exact_correlation_downgrades_old_reader_conclusion(self):
        result = module.diagnose(fixture(event("报告进入拒绝", code=500, httpStatus=200,
            serverMessage="当前报告已被其他用户锁定"), targetCorrelation="reader-only"))
        self.assertEqual(result["diagnosis"]["certainty"], "insufficient")
        self.assertIn("exact-case-correlation-unavailable", [e["code"] for e in result["evidenceGaps"]])

    def test_later_eligibility_supersedes_earlier_filter(self):
        result = module.diagnose(fixture(event("候选过滤", failedRules=["申请不足5分钟"]), event("候选命中", 2)))
        self.assertEqual(result["diagnosis"]["code"], "evidence-insufficient")

    def test_active_diagnosis_is_waiting_not_list_monitor_stop(self):
        result = module.diagnose(fixture(event("候选命中"), event("候选等待进入", 1, reason="已有客户处于诊断中，仅继续刷新列表")))
        self.assertEqual(result["diagnosis"]["code"], "diagnosis-active")

    def test_expired_versus_mixed_cancellation_reason(self):
        expired = module.diagnose(fixture(event("协议进入取消", reason="自动进入时段到期")))
        mixed = module.diagnose(fixture(event("协议进入取消", reason="自动进入已关闭、时段到期或当前入口不可用")))
        self.assertEqual(expired["diagnosis"]["code"], "authorization-expired")
        self.assertEqual(mixed["diagnosis"]["code"], "authorization-or-entry-unavailable")
        self.assertEqual(mixed["diagnosis"]["certainty"], "insufficient")

    def test_duplicate_report_gate_is_preserved(self):
        result = module.diagnose(fixture(event("进入前硬门禁拒绝", reason="本检查报告已自动进入，只允许一次")))
        self.assertEqual(result["diagnosis"]["code"], "already-consumed")

    def test_repeated_attempts_do_not_join_assertion_to_wrong_final(self):
        result = module.diagnose(fixture(event("协议进入成功", phase="assert-allowed"),
            event("协议进入成功", 1, phase="assert-allowed"), event("报告进入拒绝", 2, code=500, durationMs=100)))
        self.assertIsNone(result["latencies"]["assertionAllowedToFinalRequestMs"])
        self.assertIn("multiple-attempt-timing-ambiguous", [e["code"] for e in result["evidenceGaps"]])

    def test_same_name_multiple_reports_is_not_single_case(self):
        result = module.diagnose(fixture(event("报告进入完成", finalReportLoaded=True), matchedReportCount=2))
        self.assertEqual(result["diagnosis"]["code"], "ambiguous-report")
        self.assertEqual(result["diagnosis"]["certainty"], "insufficient")

    def test_only_case_timeline_not_global_route_events_is_used(self):
        value = fixture(event("候选命中"))
        value["debug"]["recentEntryAndRouteEvents"] = [event("报告进入完成", finalReportLoaded=True)]
        self.assertEqual(module.diagnose(value)["diagnosis"]["certainty"], "insufficient")

    def test_missing_logs_current_toggle_cannot_be_reason(self):
        result = module.diagnose({"timeline": [], "settings": {"enabled": False}})
        self.assertEqual(result["diagnosis"]["code"], "missing-observation")
        self.assertEqual(result["diagnosis"]["certainty"], "insufficient")

    def test_server_clock_and_expired_coverage_are_explicit(self):
        value = fixture(event("协议进入成功", phase="assert-allowed"), **{"from": "2026-10-07T03:16:00Z"})
        value["audit"] = {"ok": True, "applicationTime": "2026-10-07 10:15:00", "events": [
            {"at": "2026-10-07 11:16:00", "action": "锁定报告", "actor": "当前账号"}]}
        result = module.diagnose(value)
        gaps = [e["code"] for e in result["evidenceGaps"]]
        self.assertIn("server-clock-order-not-proven", gaps)
        self.assertIn("application-before-retained-window", gaps)
        self.assertEqual(result["serverAudit"]["events"][0]["at"], "2026-10-07T11:16:00.000+08:00")

    def test_not_exporting_clinical_credentials_or_identity(self):
        value = fixture(event("候选过滤", failedRules=["年龄范围"], record={"finding": "private-clinical"},
            patientName="synthetic-private-name", Authorization="private-token"),
            settings={"directLoginUsername": "private-account", "password": "private-password", "enabled": True})
        result = module.diagnose(value)
        text = json.dumps(result)
        for private in ("private-clinical", "synthetic-private-name", "private-token", "private-account", "private-password"):
            self.assertNotIn(private, text)
        redacted = module.diagnose(fixture(event("协议进入跳过", reason="Authorization: private-token")))
        self.assertNotIn("private-token", json.dumps(redacted))

    def test_invalid_time_is_not_used_to_order_or_compute(self):
        result = module.diagnose({"timeline": [{"at": "invalid", "event": "候选命中"}]})
        self.assertIsNone(result["timeline"][0]["localTime"])
        self.assertIn("invalid-event-time", [e["code"] for e in result["evidenceGaps"]])

    def test_invalid_hint_time_cannot_crash_or_generate_latency(self):
        value = fixture(event("候选命中", 1))
        value["debug"]["timeline"].append({"at": "invalid", "event": "实时推送收到"})
        self.assertIsNone(module.diagnose(value)["latencies"]["hintToEligibleMs"])

    def test_huge_numeric_time_is_invalid_not_an_overflow(self):
        result = module.diagnose({"timeline": [{"at": 10 ** 100, "event": "候选命中"}]})
        self.assertIsNone(result["timeline"][0]["localTime"])

    def test_empty_log_does_not_infer_history_from_current_retention_or_switch(self):
        result = module.diagnose({"timeline": [], "retentionMinutes": 120,
            "settings": {"enabled": False, "developerMode": False}})
        self.assertEqual(result["diagnosis"]["code"], "missing-observation")
        self.assertIn("retention-not-continuous-history-proof", [e["code"] for e in result["evidenceGaps"]])

    def test_single_acquisition_then_native_load_are_not_two_attempts(self):
        result = module.diagnose(fixture(event("协议进入成功", phase="assert-allowed"),
            event("协议最终进入取得", 1, code=200, networkDurationMs=100),
            event("报告进入完成", 2, code=200, finalReportLoaded=True, durationMs=3)))
        self.assertEqual(result["diagnosis"]["code"], "entered")
        self.assertEqual(result["latencies"]["assertionAllowedToFinalRequestMs"], 900)
        self.assertNotIn("multiple-attempt-timing-ambiguous", [e["code"] for e in result["evidenceGaps"]])

    def test_pure_offline_cli_never_calls_readers_or_cdp(self):
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "fixture.json"
            input_path.write_text(json.dumps(fixture(event("候选过滤", failedRules=["检查类型"]))), encoding="utf-8")
            out = io.StringIO()
            with patch.object(module, "run_reader", side_effect=AssertionError("network forbidden")), \
                 patch.object(module, "read_historical_context", side_effect=AssertionError("CDP forbidden")), contextlib.redirect_stdout(out):
                code = module.main(["--input-json", str(input_path)])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out.getvalue())["diagnosis"]["code"], "rules-blocked")

    def test_default_live_collection_does_not_request_server_audit(self):
        out = io.StringIO()
        reader = Mock(return_value={"timeline": []})
        with patch.object(module, "run_reader", reader), patch.object(module, "read_historical_context", return_value={}), contextlib.redirect_stdout(out):
            self.assertEqual(module.main(["--name", "synthetic-fixture"]), 0)
        reader.assert_not_called()
        self.assertFalse(json.loads(out.getvalue())["collection"]["serverRequestsRequested"])

    def test_audit_collection_failure_keeps_local_diagnosis(self):
        out = io.StringIO()
        reader = Mock(side_effect=RuntimeError("audit unavailable"))
        debug = {"timeline": [event("候选过滤", failedRules=["检查类型"])]}
        with patch.object(module, "run_reader", reader), patch.object(module, "read_historical_context", return_value=debug), contextlib.redirect_stdout(out):
            self.assertEqual(module.main(["--name", "synthetic-fixture", "--with-audit"]), 0)
        result = json.loads(out.getvalue())
        self.assertEqual(result["diagnosis"]["code"], "rules-blocked")
        self.assertIn("server-audit-unavailable", [e["code"] for e in result["evidenceGaps"]])

    def test_collection_failure_is_safe_and_nonzero(self):
        error = io.StringIO()
        with patch.object(module, "run_reader", side_effect=RuntimeError("Authorization: secret")), \
             patch.object(module, "read_historical_context", side_effect=RuntimeError("unavailable")), contextlib.redirect_stderr(error):
            self.assertEqual(module.main(["--name", "synthetic-fixture"]), 2)
        self.assertNotIn("secret", error.getvalue())

    def test_primary_storage_failure_uses_reader_but_downgrades_correlation(self):
        out = io.StringIO()
        with patch.object(module, "read_historical_context", side_effect=RuntimeError("unavailable")), \
             patch.object(module, "run_reader", return_value={"timeline": [event("报告进入完成", finalReportLoaded=True)]}), contextlib.redirect_stdout(out):
            self.assertEqual(module.main(["--name", "synthetic-fixture"]), 0)
        result = json.loads(out.getvalue())
        self.assertEqual(result["diagnosis"]["certainty"], "insufficient")
        self.assertTrue(result["collection"]["historicalContextReadFailed"])

    def test_background_absent_uses_existing_mirror_without_navigation_or_network(self):
        cdp = Mock()
        cdp.target_infos.return_value = [{"targetId": "fixture-page", "type": "page", "url": "http://10.10.94.90:22112/radiation/report?id=fixture"}]
        cdp.call.return_value = {"sessionId": "fixture-session"}
        cdp.evaluate.return_value = {"timeline": [], "storageSource": "same-origin-mirror"}
        transport = types.SimpleNamespace(Cdp=Mock(return_value=cdp), EXTENSION_ID="fixture-extension")
        with patch.dict(sys.modules, {"update_tampermonkey_radiation_cdp": transport}):
            result = module.read_historical_context("synthetic-fixture", "http://127.0.0.1:9333", "fixture-uuid")
        self.assertEqual(result["storageSource"], "same-origin-mirror")
        expression = cdp.evaluate.call_args.args[1]
        self.assertIn("localStorage.getItem", expression)
        self.assertIn("same-origin-mirror", expression)
        for forbidden in ("fetch(", ".click(", "location.reload", "setItem(", "removeItem("):
            self.assertNotIn(forbidden, expression)
        self.assertEqual(cdp.call.call_args.args[0], "Target.attachToTarget")
        cdp.browser.close.assert_called_once()

    def test_mirror_fallback_rejects_multiple_business_pages(self):
        cdp = Mock()
        cdp.target_infos.return_value = [{"targetId": str(i), "type": "page", "url": "http://10.10.94.90:22112/radiation"} for i in range(2)]
        transport = types.SimpleNamespace(Cdp=Mock(return_value=cdp), EXTENSION_ID="fixture-extension")
        with patch.dict(sys.modules, {"update_tampermonkey_radiation_cdp": transport}):
            with self.assertRaisesRegex(RuntimeError, "Cannot uniquely select"):
                module.read_historical_context("synthetic-fixture", "http://127.0.0.1:9333", "fixture-uuid")
        cdp.evaluate.assert_not_called()
        cdp.browser.close.assert_called_once()

    def test_reader_uses_utf8_and_handles_non_utf8_error_safely(self):
        failed = subprocess.CompletedProcess([], 1, "", "synthetic localized failure")
        with patch.object(module.subprocess, "run", return_value=failed) as run:
            with self.assertRaisesRegex(RuntimeError, "Read-only diagnostic dependency failed"):
                module.run_reader("read-candidate-debug-cdp.py", "--name", "synthetic-fixture")
        self.assertEqual(run.call_args.kwargs["errors"], "replace")
        self.assertEqual(run.call_args.kwargs["env"]["PYTHONUTF8"], "1")


if __name__ == "__main__":
    unittest.main()
