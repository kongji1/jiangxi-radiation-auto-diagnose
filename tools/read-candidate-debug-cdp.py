"""Read a named candidate's retained timeline without exporting raw records.

The query runs within the exact Tampermonkey storage origin. Only event/status/
timing and effective entry settings leave that context; credentials and other
patients' records are never returned or written to a file.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_tampermonkey_radiation_cdp import Cdp, EXTENSION_ID


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--cdp", default="http://127.0.0.1:9333")
    parser.add_argument("--uuid", default="23e8f7dc-df23-419c-bf55-2dce8ade789b")
    args = parser.parse_args()
    cdp = Cdp(args.cdp.rstrip("/"))
    try:
        target = next(x for x in cdp.target_infos()
                      if x.get("url") == f"chrome-extension://{EXTENSION_ID}/background.js")
        session = cdp.call("Target.attachToTarget", {"targetId": target["targetId"], "flatten": True})["sessionId"]
        expression = """(async (uuid, name) => {
          const key = '!extdb.@st#' + uuid;
          const stored = (await chrome.storage.local.get(key))[key]?.value?.data;
          if (!stored) throw Error('Userscript storage unavailable');
          const decode = value => {
            if (typeof value !== 'string') return value;
            const body = /^[sobn]/.test(value) ? value.slice(1) : value;
            let result = JSON.parse(body);
            if (typeof result === 'string') { try { result = JSON.parse(result); } catch {} }
            return result;
          };
          const reset = stored['jx-radiation-auto-diagnose-debug-reset-v2'] ? decode(stored['jx-radiation-auto-diagnose-debug-reset-v2']) : null;
          const journalKeys = Object.keys(stored).filter(k => /^jx-radiation-auto-diagnose-debug-journal-v[23]:/.test(k));
          const legacy = stored['jx-radiation-auto-diagnose-debug-v1'] ? decode(stored['jx-radiation-auto-diagnose-debug-v1']) : [];
          const allEvents = [...(Array.isArray(legacy) ? legacy : [])];
          for (const key of journalKeys) {
            const journal = decode(stored[key]);
            if (Array.isArray(journal?.events)) allEvents.push(...journal.events);
          }
          const identityFor = event => {
            if (event.eventId) return String(event.eventId);
            const text = JSON.stringify(event); let hash = 2166136261;
            for (let i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i),16777619);
            return `legacy:${event.at || ''}:${text.length}:${(hash >>> 0).toString(36)}`;
          };
          const config = decode(stored['jx-radiation-auto-diagnose-config-v1']) || {};
          const rawMinutes = config.developerRetentionMinutes;
          const value = (typeof rawMinutes === 'number' || (typeof rawMinutes === 'string' && rawMinutes.trim())) ? Number(rawMinutes) : NaN;
          const retentionMinutes = Number.isFinite(value) && value >= 1 && value <= 10080 ? Math.floor(value) : 60;
          const retentionMs = retentionMinutes * 60000;
          const unique = new Map(), cutoff = Date.now() - retentionMs;
          for (const event of allEvents) {
            const at = Date.parse(event?.at || '');
            if (!Number.isFinite(at) || at < cutoff || (reset && (at < reset.at || (at === reset.at && event.debugResetId !== reset.token)))) continue;
            const identity = identityFor(event);
            if (!unique.has(identity)) unique.set(identity, event);
          }
          const events = [...unique.values()].sort((a,b) => Date.parse(a.at)-Date.parse(b.at));
          const matched = events.filter(e => JSON.stringify(e).includes(name));
          const identities = e => [e.key, e.recordId, e.repUid, e.record?.repUid, e.routeReportId, e.responseRepUid].filter(Boolean).map(v => String(v).replace(/^rep:/, ''));
          const keys = new Set(matched.flatMap(identities));
          const tags = new Set(matched.flatMap(e => [e.tag, e.candidateTag]).filter(Boolean));
          const requestIds = new Set(matched.map(e => e.requestId).filter(Boolean));
          const entryStates = [...keys].map(id => stored['jx-radiation-auto-entry-once-v1:' + encodeURIComponent('rep:' + id)]).filter(Boolean).map(decode);
          const automaticEntrySummary = { recordsFound: entryStates.length,
            consumed: entryStates.filter(e => e?.state === 'consumed').length,
            confirmed: entryStates.filter(e => e?.state === 'consumed' && e.confirmed === true).length,
            reserved: entryStates.filter(e => e?.state === 'reserved' && e.expiresAt > Date.now()).length };
          const related = events.filter(e => matched.includes(e) || identities(e).some(id => keys.has(id)) || tags.has(e.tag) || tags.has(e.candidateTag) || requestIds.has(e.requestId));
          const fields = ['at', 'event', 'source', 'reason', 'failedRules', 'status', 'statusCode',
            'locked', 'code', 'httpStatus', 'protocolAllowed', 'durationMs', 'dispatchDelayMs',
            'waitMs', 'version', 'diagnoseEntryFound', 'diagnoseEntryDisabled', 'stage', 'phase',
            'finalReportLoaded', 'reportIdMatches', 'error', 'errorClass', 'responseDataShape', 'serverMessage', 'endpointKind', 'reportDoctor', 'ownershipMatches', 'navigationMode', 'requestId', 'networkStartedAt', 'hintToNetworkMs', 'identityWaitMs', 'clientIpWaitMs', 'preparationMs', 'networkDurationMs', 'withinOneSecond', 'networkSent'];
          const pick = e => Object.fromEntries(fields.filter(k => k in e).map(k => [k, e[k]]));
          const seen = new Set();
          const timeline = related.filter(e => {
            const signature = JSON.stringify([e.event, e.reason, e.statusCode, e.code, e.failedRules]);
            if (/协议进入|报告进入|报告详情读取|首次|状态变化|占用|进入取消|进入成功|进入失败/.test(e.event)) return true;
            if (seen.has(signature)) return false;
            seen.add(signature); return true;
          });
          const from = events[0]?.at, to = events.at(-1)?.at;
          return { count: events.length, journalCount: journalKeys.length, retentionMinutes, retentionMs, from, to,
            retainedSpanSeconds: from && to ? Math.round((Date.parse(to)-Date.parse(from))/1000) : 0,
            automaticEntrySummary, targetEventCount: related.length, timeline: timeline.map(pick),
            recentRequestTimings: events.filter(e => e.event === '协议网络请求发起' || e.event === '协议响应认证上下文').slice(-20).map(pick),
            recentEntryAndRouteEvents: events.filter(e => /协议进入|报告进入|报告详情读取|路由变化|运行版本|时段到期/.test(e.event)).map(pick),
            settings: { enabled: config.enabled, monitoringEnabled: config.monitoringEnabled,
              developerMode: config.developerMode, developerRetentionMinutes: retentionMinutes, entryMode: config.entryMode,
              entryDelaySeconds: config.entryDelaySeconds, humanizeEntryLevel: config.humanizeEntryLevel,
              autoEntrySchedule: config.autoEntrySchedule } };
        })(""" + json.dumps(args.uuid) + "," + json.dumps(args.name) + ")"
        result = cdp.evaluate(session, expression)
        if result is None:
            raise RuntimeError("Candidate timeline query did not return a result")
        print(json.dumps(result, ensure_ascii=True))
    finally:
        cdp.browser.close()


if __name__ == "__main__":
    main()
