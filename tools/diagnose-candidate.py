"""Diagnose one retained candidate without entering, locking or exporting reports.

The offline analyser deliberately does not infer past filters from present config.
Live collection uses the existing standard-CDP transport and Tampermonkey storage.
No browser navigation, storage writes or business request occurs by default.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
TIMEZONE = dt.timezone(dt.timedelta(hours=8), "Asia/Taipei")
EVENT_FIELDS = {
    "at", "event", "source", "reason", "failedRules", "status", "statusCode",
    "locked", "code", "httpStatus", "protocolAllowed", "durationMs",
    "dispatchDelayMs", "waitMs", "version", "stage", "phase", "finalReportLoaded",
    "reportIdMatches", "errorClass", "serverMessage", "endpointKind", "ownershipMatches",
    "ownerMatches", "networkStartedAt", "hintToNetworkMs", "identityWaitMs",
    "clientIpWaitMs", "preparationMs", "networkDurationMs", "withinOneSecond", "networkSent", "contextLabel",
}
CONFIG_FIELDS = {
    "enabled", "monitoringEnabled", "developerMode", "developerRetentionMinutes",
    "entryMode", "entryDelaySeconds", "humanizeEntryLevel", "examNamesExcluded",
    "autoEntrySchedule", "encounterTypes", "modalities", "examNames", "applyInstitution",
    "age", "applicationTime", "applicationTimeMode", "skipLockedRecords",
    "autoOpenEnabled", "observationOnly", "encounterUnlimited", "ageUnlimited",
    "modalityUnlimited", "examUnlimited", "institutionUnlimited", "reportStatusCount",
}
NESTED_FIELDS = {"slot", "date", "state", "requiresSelection", "startAt", "endAt",
                 "min", "max", "unlimited", "mode", "minMinutes", "maxMinutes", "days", "start"}


def timestamp(value):
    """Local timestamps in native audit are Taipei time; milliseconds stay local."""
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        seconds = float(value) / 1000
        try:
            dt.datetime.fromtimestamp(seconds, TIMEZONE)
            return seconds
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=TIMEZONE)).timestamp()
    except (OverflowError, OSError, ValueError):
        return None


def local_time(value):
    parsed = timestamp(value)
    return dt.datetime.fromtimestamp(parsed, TIMEZONE).isoformat(timespec="milliseconds") if parsed is not None else None


def safe_value(value):
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        # Values are summaries, never free-form request headers or report bodies.
        if re.search(r"(?i)authorization\s*[:=]|cookie\s*[:=]|(?:password|密码)\s*[:=]|bearer\s+", value):
            return "[credential text omitted]"
        return value[:500]
    if isinstance(value, list):
        return [safe_value(x) for x in value[:100] if isinstance(x, (str, int, float, bool)) or x is None]
    if isinstance(value, dict):
        return {k: safe_value(v) for k, v in value.items() if k in NESTED_FIELDS}
    return None


def pick(value, fields):
    return {k: safe_value(v) for k, v in value.items() if k in fields} if isinstance(value, dict) else {}


def normalize_config(value):
    result = pick(value, CONFIG_FIELDS)
    # autoOpenEnabled is an EFFECTIVE gate (schedule included), while enabled is
    # a saved checkbox. Never rename one into the other for historical comparison.
    if isinstance(result.get("applicationTime"), dict) and "applicationTimeMode" in result:
        result["applicationTime"].setdefault("mode", result["applicationTimeMode"])
    return result


def config_difference(key, historical, current):
    before, now = historical[key], current[key]
    if isinstance(before, dict) and isinstance(now, dict):
        common = before.keys() & now.keys()
        before, now = ({k: before[k] for k in common}, {k: now[k] for k in common})
    return {"field": key, "snapshotValue": before, "currentValue": now} if before != now else None


def elapsed(start, end):
    a, b = timestamp(start), timestamp(end)
    return round((b - a) * 1000) if a is not None and b is not None and b >= a else None


def metric_from(events, first_pattern, last_pattern):
    first = next((e for e in events if re.search(first_pattern, e.get("event", ""))), None)
    last = next((e for e in events if first and timestamp(first.get("at")) is not None
                 and re.search(last_pattern, e.get("event", ""))
                 and timestamp(e.get("at")) is not None and timestamp(e["at"]) >= timestamp(first["at"])), None)
    return elapsed(first.get("at"), last.get("at")) if first and last else None


def diagnose(payload):
    """Pure offline analysis; uses only explicitly observed case-related events."""
    if not isinstance(payload, dict):
        raise ValueError("Input must be a JSON object")
    debug = payload.get("debug", payload)
    if not isinstance(debug, dict):
        raise ValueError("debug must be a JSON object")
    events = [pick(x, EVENT_FIELDS) for x in debug.get("timeline", []) if isinstance(x, dict)]
    events = [e for e in events if isinstance(e.get("event"), str)]
    invalid_times = sum(timestamp(e.get("at")) is None for e in events)
    events.sort(key=lambda e: timestamp(e.get("at")) if timestamp(e.get("at")) is not None else float("inf"))
    gaps = []
    if invalid_times:
        gaps.append({"code": "invalid-event-time", "count": invalid_times,
                     "detail": "部分事件时间无效，不能据此计算先后或耗时。"})
    report_count = debug.get("matchedReportCount", 1)
    if not isinstance(report_count, (int, float)) or isinstance(report_count, bool):
        report_count = 0
    audit = payload.get("audit") if isinstance(payload.get("audit"), dict) else None
    if audit and isinstance(audit.get("matchedReports"), (int, float)):
        report_count = max(report_count, audit["matchedReports"])

    # A final response is stronger than an assertion, a route or later DOM status.
    finals = [e for e in events if re.search(r"^(报告进入|协议最终进入)(完成|取得|拒绝|异常)$", e["event"])]
    loaded = [e for e in finals if e["event"] == "报告进入完成" and e.get("finalReportLoaded") is True]
    acquisition = [e for e in finals if e["event"] == "协议最终进入取得"]
    pauses = [e for e in events if "交接" in e["event"] and ("失败" in e["event"] or "异常" in e["event"])]
    other_owner = [e for e in events if e["event"] == "候选被其他用户占用"]
    selected = None
    code, stage, certainty, summary = "evidence-insufficient", "unobserved", "insufficient", "没有足够病例事件确认未进入的原因。"
    if report_count > 1:
        code, stage, summary = "ambiguous-report", "identity", "同名关联了多份报告，不能把它们的进入链合成一个结论。"
        gaps.append({"code": "multiple-reports", "count": report_count,
                     "detail": "需要按申请时间/检查报告区分；本工具不会猜测或进入报告。"})
    elif loaded:
        selected = loaded[-1]
        if selected.get("ownershipMatches") is False or selected.get("ownerMatches") is False:
            code, stage, certainty, summary = "ownership-conflict", "native-load", "observed", "页面载入事件存在，但医生归属不一致，不能确认本账号取得。"
        elif other_owner and elapsed(selected.get("at"), other_owner[-1].get("at")) is not None:
            code, stage, certainty, summary = "entered-then-other-owner-observed", "ownership", "observed", "先记录本页载入，之后列表观察到其它用户占用；原因仍需服务端操作记录。"
        else:
            code, stage, certainty, summary = "entered", "native-load", "confirmed", "已记录当前报告页最终载入；校验/导航事件不被单独当作成功。"
    elif acquisition and pauses and elapsed(acquisition[-1].get("at"), pauses[-1].get("at")) is not None:
        selected = pauses[-1]
        code, stage, certainty, summary = "acquired-handoff-failed", "handoff", "observed", "最终协议已取得，之后页面交接失败；应核对当前任务，不能重新锁定。"
    elif finals:
        selected = finals[-1]
        text = " ".join(str(selected.get(k, "")) for k in ("event", "reason", "serverMessage"))
        if "异常" in selected["event"] or selected.get("httpStatus", 200) not in range(200, 300):
            code, stage, certainty, summary = "final-result-unknown", "final-entry", "insufficient", "最终请求结果不明确，不能认定未取得，也不能再次尝试进入。"
        elif re.search(r"其他用户|其它用户|他人", text) and re.search(r"锁定|占用", text) and "拒绝" in selected["event"]:
            code, stage, certainty, summary = "server-other-owner-lock", "final-entry", "confirmed", "最终进入响应明确拒绝其它用户锁定/占用；没有本账号最终成功证据。"
        elif re.search(r"已锁定|被锁定|已占用", text) and "拒绝" in selected["event"]:
            code, stage, certainty, summary = "server-lock-rejected", "final-entry", "observed", "最终进入响应记录锁定/占用拒绝，但没有明确其它账号的归属证据。"
        elif selected.get("code") == 2002:
            code, stage, certainty, summary = "authentication-rejected", "final-entry", "confirmed", "最终响应为 TOKEN_FAIL；不是没有候选。"
        elif "拒绝" in selected["event"] and (not isinstance(selected.get("code"), (int, float))
                or isinstance(selected.get("code"), bool) or selected.get("code") == 200):
            code, stage, certainty, summary = "final-result-unknown", "final-entry", "insufficient", "最终业务成功未能确认归属/数据；不能视为明确未取得，也不能重复进入。"
        elif "拒绝" in selected["event"]:
            code, stage, certainty, summary = "final-entry-rejected", "final-entry", "observed", "最终进入被拒绝；应以业务码及明确响应理由解释。"
        elif selected["event"] == "协议最终进入取得":
            code, stage, summary = "acquired-native-load-unconfirmed", "handoff", "协议已取得，但没有原生页最终载入证据；不要重复进入。"
        else:
            code, stage, summary = "native-load-unconfirmed", "native-load", "最终响应存在，但没有当前页最终载入证据。"
    else:
        decisions = [e for e in events if re.search(r"候选过滤|硬门禁拒绝|协议进入(拒绝|取消|跳过|异常)|页面点击跳过|观察模式跳过|候选等待进入", e["event"])]
        selected = decisions[-1] if decisions else None
        if selected:
            text = " ".join(str(selected.get(k, "")) for k in ("event", "reason", "failedRules"))
            # A later eligibility/assertion supersedes an earlier filter result.
            newer_progress = [e for e in events if elapsed(selected.get("at"), e.get("at")) not in (None, 0)
                              and (e["event"] == "候选命中" or e.get("phase") == "assert-allowed")]
            if not newer_progress:
                certainty = "observed"
                if re.search(r"时段到期|授权.*截止|requires-selection|时段.*过期", text) and "或" not in text:
                    code, stage, summary = "authorization-expired", "authorization", "当时事件明确记录自动进入授权/时段不可用。"
                elif "时段到期" in text and "或" in text:
                    code, stage, certainty, summary = "authorization-or-entry-unavailable", "entry-gate", "insufficient", "当时入口已取消，但混合理由未区分关闭、时段到期或已有诊断任务。"
                elif "观察模式跳过" in selected["event"]:
                    code, stage, summary = "auto-open-disabled", "authorization", "当时只读监控继续运行，自动打开门禁关闭。"
                elif "候选过滤" in selected["event"]:
                    code, stage, summary = "rules-blocked", "filter", "当时过滤事件明确记录未通过的规则。"
                elif "候选等待进入" in selected["event"]:
                    code, stage, summary = "diagnosis-active", "entry-gate", "当时正在诊断其它任务，候选等待；列表观察仍继续。"
                elif selected.get("code") == 2002:
                    code, stage, summary = "authentication-rejected", "assertion", "校验响应为 TOKEN_FAIL，不能解释成没有候选。"
                elif "协议进入拒绝" in selected["event"]:
                    code, stage, summary = "assertion-rejected", "assertion", "进入校验明确拒绝；未到最终进入阶段。"
                elif re.search(r"已处理|只.*一次|已.*进入|消费|重复", text):
                    code, stage, summary = "already-consumed", "entry-gate", "每报告进入一次门禁已阻断此份报告。"
                else:
                    code, stage, summary = "entry-gate-blocked", "entry-gate", "当时入口事件明确阻断，详见记录理由。"
        allowed = [e for e in events if e.get("phase") == "assert-allowed"]
        if code == "evidence-insufficient" and allowed:
            selected = allowed[-1]
            code, stage, summary = "assert-allowed-no-final", "final-entry", "校验已通过，但缺少最终进入响应；不能据导航判定载入。"
        elif code == "evidence-insufficient" and other_owner:
            selected = other_owner[-1]
            code, stage, summary = "other-owner-observed-cause-unknown", "ownership", "列表已观察到其他用户占用，但缺少此前进入链，无法判断为何未及时进入。"
        elif code == "evidence-insufficient" and not events:
            code, summary = "missing-observation", "保留窗口内没有此候选记录；可能未观察、已过期或采集未启用，不能直接归因。"

    if not loaded:
        gaps.append({"code": "native-final-load-unconfirmed", "detail": "没有 finalReportLoaded=true 的当前报告页最终事件。"})
    snapshots = debug.get("historicalGateSnapshots", [])
    snapshots = [s for s in snapshots if isinstance(s, dict) and timestamp(s.get("at")) is not None]
    first_at = next((e.get("at") for e in events if timestamp(e.get("at")) is not None), None)
    comparison_at = selected.get("at") if selected else first_at
    selected_context = selected.get("contextLabel") if selected else next((e.get("contextLabel") for e in events if e.get("contextLabel")), None)
    preceding = [s for s in snapshots if elapsed(s.get("at"), comparison_at) is not None
                 and (not selected_context or s.get("contextLabel") == selected_context)]
    snapshot = max(preceding, key=lambda s: timestamp(s["at"])) if preceding else None
    current = normalize_config(debug.get("settings", {}))
    historical = normalize_config(snapshot) if snapshot else None
    changes = [difference for key in sorted(historical or {}) if key in current
               if (difference := config_difference(key, historical, current)) is not None]
    if not snapshot:
        gaps.append({"code": "historical-config-missing", "detail": "没有关联的前置配置快照；当前配置不能用于反推过去门禁。"})
    else:
        gaps.append({"code": "snapshot-not-continuous-config-proof",
                     "detail": "这是前置已记录快照；未记录的自动保存/其它页面配置变化不能据此排除。事件 failedRules/reason 更直接。"})

    latencies = {
        "hintToEligibleMs": metric_from(events, r"^实时推送收到$", r"^候选命中$"),
        "hintToFinalResponseMs": metric_from(events, r"^实时推送收到$", r"^(报告进入|协议最终进入)(完成|取得|拒绝|异常)$"),
        "firstObservationToAssertionMs": metric_from(events, r"^候选首次观察$", r"^协议进入开始$"),
    }
    allowed = next((e for e in events if e.get("phase") == "assert-allowed"), None)
    final = next((e for e in finals if allowed and elapsed(allowed.get("at"), e.get("at")) is not None), None)
    if final:
        direct = timestamp(final.get("networkStartedAt"))
        duration = final.get("networkDurationMs", final.get("durationMs"))
        if direct is None and isinstance(duration, (int, float)) and not isinstance(duration, bool):
            direct = timestamp(final.get("at")) - duration / 1000
        latencies["assertionAllowedToFinalRequestMs"] = round((direct - timestamp(allowed["at"])) * 1000) if direct is not None and direct >= timestamp(allowed["at"]) else None
        latencies["finalRequestDurationMs"] = duration
    assertion_count = sum(e.get("phase") == "assert-allowed" for e in events)
    acquisition_count = sum(e["event"].startswith("协议最终进入") for e in finals)
    native_count = sum(e["event"].startswith("报告进入") for e in finals)
    if assertion_count > 1 or acquisition_count > 1 or native_count > 1 or report_count > 1:
        # Existing readers do not prove the link from assert ID to final ID.
        latencies["assertionAllowedToFinalRequestMs"] = None
        latencies["hintToFinalResponseMs"] = None
        gaps.append({"code": "multiple-attempt-timing-ambiguous",
                     "detail": "存在多个尝试/报告，原读者未证明校验与最终请求的一对一关联，跨阶段耗时不猜测。"})
    if any(v is None for v in latencies.values()):
        gaps.append({"code": "timing-evidence-missing", "detail": "缺少完整起止事件的耗时保持 null；不拼接其它患者或不同尝试。"})
    if debug.get("targetCorrelation") == "reader-only":
        certainty = "insufficient"
        gaps.append({"code": "exact-case-correlation-unavailable",
                     "detail": "精确姓名/报告关联补充读取失败；旧读者结果只能作线索，不能确认属于目标报告。"})
    if not events or not any(e["event"] in ("实时推送收到", "候选首次观察") for e in events):
        gaps.append({"code": "retention-not-continuous-history-proof",
                     "detail": "当前保存时长不证明此前连续采集；延长时长不能恢复旧版本已删除的事件。"})

    audit_summary = None
    if audit:
        audit_events = [{"at": local_time(e.get("at")), "action": safe_value(e.get("action")),
                         "actor": "current-account" if e.get("actor") == "当前账号" else "other-account"}
                        for e in audit.get("events", []) if isinstance(e, dict)]
        audit_summary = {"ok": audit.get("ok") is True, "code": safe_value(audit.get("code")),
                         "applicationTime": local_time(audit.get("applicationTime")),
                         "statusCode": safe_value(audit.get("statusCode")), "events": audit_events}
        if audit.get("ok") is not True:
            gaps.append({"code": "server-audit-unavailable", "detail": "只读服务端审计未成功，本地结论仍可使用；不能据失败响应判断病例不存在。"})
        gaps.append({"code": "server-clock-order-not-proven",
                     "detail": "服务器操作记录秒级且客户端/服务器时钟未校准；不能与本地毫秒事件推断谁早几百毫秒。"})
        application = timestamp(audit.get("applicationTime"))
        retained_from = timestamp(debug.get("from"))
        if application is not None and retained_from is not None and application < retained_from:
            gaps.append({"code": "application-before-retained-window", "detail": "申请时间早于当前留存事件范围，早期链路已不可用。"})
    else:
        gaps.append({"code": "server-audit-not-requested", "detail": "默认仅查本地日志；需要操作记录时显式加 --with-audit。"})
    return {
        "schemaVersion": 1, "timeZone": "Asia/Taipei",
        "diagnosis": {"code": code, "stage": stage, "certainty": certainty, "summary": summary,
                      "evidence": selected or {}},
        "coverage": {"eventCount": len(events), "matchedReportCount": report_count,
                     "retentionMinutes": safe_value(debug.get("retentionMinutes")),
                     "retainedFrom": local_time(debug.get("from")), "retainedTo": local_time(debug.get("to"))},
        "configuration": {"comparisonOnly": True, "historicalSnapshotAt": local_time(snapshot.get("at")) if snapshot else None,
                          "historicalSnapshot": historical, "current": current, "differences": changes},
        "latencies": latencies, "timeline": [{**e, "localTime": local_time(e.get("at"))} for e in events],
        "automaticEntrySummary": pick(debug.get("automaticEntrySummary", {}),
                                      {"recordsFound", "consumed", "confirmed", "reserved", "otherOwnerBlocked"}),
        "serverAudit": audit_summary, "evidenceGaps": gaps,
    }


def run_reader(filename, *arguments):
    result = subprocess.run([sys.executable, "-B", str(ROOT / "tools" / filename), *arguments],
                            capture_output=True, text=True, encoding="utf-8", errors="replace",
                            env={**os.environ, "PYTHONUTF8": "1"}, timeout=20, cwd=ROOT)
    if result.returncode:
        # Do not echo exceptions which could include session/target/request data.
        raise RuntimeError("Read-only diagnostic dependency failed: " + filename)
    value = json.loads(result.stdout)
    if not isinstance(value, dict):
        raise RuntimeError("Read-only diagnostic dependency returned no object: " + filename)
    return value


def read_historical_context(name, cdp_url, uuid):
    """Read safe metadata from GM storage or its existing same-origin mirror."""
    sys.path.insert(0, str(ROOT))
    from update_tampermonkey_radiation_cdp import Cdp, EXTENSION_ID
    cdp = Cdp(cdp_url.rstrip("/"))
    try:
        all_targets = cdp.target_infos()
        targets = [x for x in all_targets if x.get("url") == f"chrome-extension://{EXTENSION_ID}/background.js"]
        storage_source = "tampermonkey"
        if not targets:
            targets = [x for x in all_targets if x.get("type") == "page"
                       and urlsplit(x.get("url", "")).netloc == "10.10.94.90:22112"
                       and urlsplit(x.get("url", "")).path in ("/radiation", "/radiation/report")]
            storage_source = "same-origin-mirror"
        if len(targets) != 1:
            raise RuntimeError("Cannot uniquely select read-only local storage")
        session = cdp.call("Target.attachToTarget", {"targetId": targets[0]["targetId"], "flatten": True})["sessionId"]
        expression = r"""(async (uuid, name, storageSource) => {
          let stored;
          if (storageSource === 'tampermonkey') {
            stored = (await chrome.storage.local.get('!extdb.@st#' + uuid))['!extdb.@st#' + uuid]?.value?.data;
          } else {
            if (location.host !== '10.10.94.90:22112' || !['/radiation', '/radiation/report'].includes(location.pathname)) throw Error('Business route changed');
            stored = {};
            for (let i=0; i<localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && (key.startsWith('jx-radiation-auto-diagnose-') || key.startsWith('jx-radiation-auto-entry-once-v1:'))) stored[key] = localStorage.getItem(key);
            }
            stored['jx-radiation-auto-diagnose-config-v1'] = stored['jx-radiation-auto-diagnose-config-v1:durable-v1'];
          }
          if (!stored) throw Error('Userscript storage unavailable');
          const decode = v => { if (typeof v !== 'string') return v; let r = JSON.parse(/^[sobn]/.test(v) ? v.slice(1) : v); if (typeof r === 'string') { try { r = JSON.parse(r); } catch {} } return r; };
          const config = decode(stored['jx-radiation-auto-diagnose-config-v1']) || {};
          if (!Object.keys(config).length) throw Error('Configuration mirror unavailable');
          const minutes = Number(config.developerRetentionMinutes);
          const cutoff = Date.now() - (Number.isFinite(minutes) && minutes >= 1 && minutes <= 10080 ? Math.floor(minutes) : 60) * 60000;
          const reset = stored['jx-radiation-auto-diagnose-debug-reset-v2'] ? decode(stored['jx-radiation-auto-diagnose-debug-reset-v2']) : null;
          const events = [], identities = new Set();
          const legacy = stored['jx-radiation-auto-diagnose-debug-v1'] ? decode(stored['jx-radiation-auto-diagnose-debug-v1']) : [];
          if (Array.isArray(legacy)) events.push(...legacy);
          for (const key of Object.keys(stored).filter(k => /^jx-radiation-auto-diagnose-debug-journal-v[23]:/.test(k))) { const j = decode(stored[key]); if (Array.isArray(j?.events)) events.push(...j.events); }
          const retained = events.filter(e => { const at = Date.parse(e?.at || ''); return Number.isFinite(at) && at >= cutoff && (!reset || at > reset.at || (at === reset.at && e.debugResetId === reset.token)); });
          const norm = v => String(v || '').normalize('NFC').replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
          const named = retained.filter(e => [e.patientName, e.record?.patName, e.record?.patientName].some(v => v && norm(v) === norm(name)));
          for (const e of named) for (const v of [e.repUid, e.record?.repUid, e.record?.reportUid, e.record?.reportId,
            e.endpointKind === 'radiation-entry' ? e.recordId : '', /^rep:/.test(String(e.key || '')) ? String(e.key).slice(4) : '']) if (v) identities.add(String(v));
          const writer = e => String(e.eventId || '').replace(/:[^:]*$/, '');
          const writers = new Set(named.map(writer).filter(Boolean));
          const contexts = new Map([...writers].map((id, i) => [id, 'context-' + (i + 1)]));
          const snapshotFields = FIELDS;
          const snapshots = retained.filter(e => e.event === '配置门禁快照' && writers.has(writer(e)))
            .map(e => ({...Object.fromEntries(['at', ...snapshotFields].filter(k => k in e).map(k => [k,e[k]])), contextLabel: contexts.get(writer(e))}));
          const ids = e => [e.recordId, e.repUid, e.record?.repUid, e.record?.reportUid, e.record?.reportId, e.routeReportId, e.responseRepUid,
            /^rep:/.test(String(e.key || '')) ? String(e.key).slice(4) : ''].filter(Boolean).map(String);
          const candidateIds = new Set(named.flatMap(ids));
          const tags = new Set(named.flatMap(e => [e.tag, e.candidateTag]).filter(Boolean));
          const requestIds = new Set(named.map(e => e.requestId).filter(Boolean));
          const related = retained.filter(e => {
            if (named.includes(e)) return true;
            const found = ids(e);
            if (found.length) return found.some(id => candidateIds.has(id));
            return tags.has(e.tag) || tags.has(e.candidateTag) || (e.requestId && requestIds.has(e.requestId));
          });
          const eventFields = EVENTFIELDS;
          const seen = new Set();
          const timeline = related.filter(e => { const key = e.eventId || JSON.stringify(e); if (seen.has(key)) return false; seen.add(key); return true; })
            .map(e => ({...Object.fromEntries(eventFields.filter(k => k in e).map(k => [k,e[k]])), contextLabel: contexts.get(writer(e)) || ''}));
          const entryStates = [...identities].map(id => stored['jx-radiation-auto-entry-once-v1:' + encodeURIComponent('rep:' + id)]).filter(Boolean).map(decode);
          const automaticEntrySummary = { recordsFound: entryStates.length,
            consumed: entryStates.filter(e => e?.state === 'consumed').length,
            otherOwnerBlocked: entryStates.filter(e => e?.state === 'consumed' && e.reason === 'server-locked-other').length,
            confirmed: entryStates.filter(e => e?.state === 'consumed' && e.confirmed === true).length,
            reserved: entryStates.filter(e => e?.state === 'reserved' && e.expiresAt > Date.now()).length };
          const orderedTimes = retained.map(e => e.at).sort((a,b) => Date.parse(a)-Date.parse(b));
          return { matchedReportCount: identities.size, historicalGateSnapshots: snapshots,
            timeline, targetCorrelation: 'exact', automaticEntrySummary, storageSource,
            retentionMinutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 10080 ? Math.floor(minutes) : 60,
            from: orderedTimes[0] || null, to: orderedTimes.at(-1) || null,
            settings: Object.fromEntries(snapshotFields.filter(k => k in config).map(k => [k,config[k]])) };
        })(UUID, NAME, SOURCE)""".replace("EVENTFIELDS", json.dumps(sorted(EVENT_FIELDS))).replace("FIELDS", json.dumps(sorted(CONFIG_FIELDS))).replace("UUID", json.dumps(uuid)).replace("NAME", json.dumps(name)).replace("SOURCE", json.dumps(storage_source))
        value = cdp.evaluate(session, expression)
        if not isinstance(value, dict):
            raise RuntimeError("Historical context unavailable")
        return value
    finally:
        cdp.browser.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--name", help="Read one name from retained local developer logs")
    source.add_argument("--input-json", type=Path, help="Offline reader JSON or {debug, audit} fixture")
    parser.add_argument("--cdp", default="http://127.0.0.1:9333")
    parser.add_argument("--uuid", default="23e8f7dc-df23-419c-bf55-2dce8ade789b")
    parser.add_argument("--with-audit", action="store_true", help="Explicitly request the narrow read-only server operation history")
    parser.add_argument("--date", default=dt.datetime.now(TIMEZONE).date().isoformat(), help="Taipei date for --with-audit")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args(argv)
    if args.input_json and args.with_audit:
        parser.error("--with-audit cannot be used with offline --input-json")
    started = time.monotonic()
    try:
        if args.input_json:
            payload = json.loads(args.input_json.read_text(encoding="utf-8-sig"))
            timings = {"source": "offline", "serverRequestsRequested": False}
        else:
            if not args.name.strip():
                parser.error("--name cannot be blank")
            history_error = False
            try:
                debug = read_historical_context(args.name, args.cdp, args.uuid)
            except Exception:
                history_error = True
                debug = run_reader("read-candidate-debug-cdp.py", "--name", args.name, "--cdp", args.cdp, "--uuid", args.uuid)
                debug["targetCorrelation"] = "reader-only"
            payload = {"debug": debug}
            local_done = time.monotonic()
            if args.with_audit:
                dt.date.fromisoformat(args.date)
                try:
                    payload["audit"] = run_reader("read-candidate-audit-cdp.py", "--name", args.name, "--date", args.date, "--cdp", args.cdp)
                except Exception:
                    payload["audit"] = {"ok": False}
            timings = {"source": "local-cdp", "localReadMs": round((local_done - started) * 1000),
                       "auditReadMs": round((time.monotonic() - local_done) * 1000) if args.with_audit else 0,
                       "serverRequestsRequested": args.with_audit, "historicalContextReadFailed": history_error,
                       "storageSource": debug.get("storageSource", "legacy-reader")}
        result = diagnose(payload)
        result["collection"] = {**timings, "totalMs": round((time.monotonic() - started) * 1000)}
        print(json.dumps(result, ensure_ascii=True, allow_nan=False, indent=2 if args.pretty else None))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": "Read-only diagnostic collection failed", "errorClass": type(error).__name__}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
