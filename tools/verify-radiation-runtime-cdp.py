"""Read the loaded runtime version through standard Edge CDP.

Only the version/start time and the four settings labels are returned; console
payloads containing clinical data or credentials are not exported or saved.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from urllib.parse import urlsplit
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_tampermonkey_radiation_cdp import Cdp


class RuntimeCdp(Cdp):
    def __init__(self, url):
        super().__init__(url)
        self.versions = []
        self.active_contexts = set()
        self.writers = {}

    def observe(self, item):
        method, params = item.get("method"), item.get("params", {})
        if method == "Runtime.executionContextCreated":
            self.active_contexts.add(params["context"]["id"])
        elif method == "Runtime.executionContextDestroyed":
            self.active_contexts.discard(params.get("executionContextId"))
        elif method == "Runtime.executionContextsCleared":
            self.active_contexts.clear()
            self.writers.clear()
            self.versions.clear()
        elif method == "Runtime.consoleAPICalled":
            context = params.get("executionContextId")
            for arg in params.get("args", []):
                value = arg.get("value")
                if not isinstance(value, str) or not value.startswith("[自动诊断][开发者] "):
                    continue
                try:
                    event = json.loads(value.split(" ", 1)[1])
                except (ValueError, TypeError):
                    continue
                if not isinstance(event, dict):
                    continue
                writer = str(event.get("eventId", "")).rsplit(":", 1)[0]
                if re.fullmatch(r"[a-z0-9-]{8,100}", writer):
                    self.writers[writer] = context
                if event.get("event") == "运行版本":
                    self.versions.append({"version": event.get("version"), "at": event.get("at"), "context": context})

    def loaded_runtime(self, session):
        versions = [x for x in self.versions if x["context"] in self.active_contexts]
        method = "current execution-context console"
        if not versions:
            # A busy console can evict the startup event. Only accept a journal
            # whose writer was witnessed in a still-live context of THIS page.
            # No patient fields, report identifiers or authentication leave it.
            writers = sorted(w for w, c in self.writers.items() if c in self.active_contexts)
            if not writers:
                return None
            versions = self.evaluate(session, """(() => {
              const writers = new Set(""" + json.dumps(writers) + """);
              const result = [];
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key?.startsWith('jx-radiation-auto-diagnose-debug-journal-v3:')) continue;
                let journal;
                try { journal = JSON.parse(localStorage.getItem(key)); } catch (_) { continue; }
                if (!writers.has(journal?.writerId)) continue;
                for (const event of journal.events || []) {
                  if (event?.event === '运行版本' && event.source === 'runtime-start')
                    result.push({ version: event.version, at: event.at });
                }
              }
              return result;
            })()""") or []
            method = "current execution-context writer matched to startup journal"
        return select_runtime_version(versions, method)

    def session_call(self, session_id, method, params=None):
        self.next_id += 1
        ident = self.next_id
        self.browser.send(json.dumps({"id": ident, "sessionId": session_id,
                                      "method": method, "params": params or {}}))
        while True:
            item = json.loads(self.browser.recv())
            if item.get("sessionId") == session_id:
                self.observe(item)
            if item.get("id") == ident:
                if "error" in item:
                    raise RuntimeError(item["error"].get("message", "CDP failed"))
                return item.get("result", {})


def select_runtime_version(rows, method):
    valid = [x for x in rows if isinstance(x, dict)
             and re.fullmatch(r"\d+\.\d+\.\d+", str(x.get("version", "")))
             and isinstance(x.get("at"), str)]
    if not valid:
        return None
    if len({x["version"] for x in valid}) != 1:
        raise RuntimeError("Conflicting versions in the active page; refusing to guess")
    latest = max(valid, key=lambda x: x["at"])
    return {"version": latest["version"], "at": latest["at"], "evidence": method}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp", default="http://127.0.0.1:9333")
    parser.add_argument("--check-settings", action="store_true")
    parser.add_argument("--expected-version", help="Defaults to the local PROJECT_STATE version")
    parser.add_argument("--exclude-exam", action="append", default=[],
                        help="Add an exam exclusion using the current settings UI")
    args = parser.parse_args()
    expected_version = args.expected_version or json.loads(
        (Path(__file__).resolve().parents[1] / "PROJECT_STATE.json").read_text(encoding="utf-8-sig"))["version"]
    cdp = RuntimeCdp(args.cdp.rstrip("/"))
    opened = False
    trigger_clicked = False
    session = None
    try:
        pages = [x for x in cdp.target_infos() if x.get("type") == "page"
                 and urlsplit(x.get("url", "")).netloc == "10.10.94.90:22112"
                 and urlsplit(x.get("url", "")).path in ("/radiation", "/radiation/report")]
        if len(pages) != 1:
            raise RuntimeError("Expected exactly one radiation business page; no page was modified")
        session = cdp.call("Target.attachToTarget", {"targetId": pages[0]["targetId"], "flatten": True})["sessionId"]
        cdp.session_call(session, "Runtime.enable")
        cdp.evaluate(session, "Boolean(document.body)")
        settings = None
        if args.check_settings or args.exclude_exam:
            if cdp.evaluate(session, "location.pathname") != "/radiation":
                raise RuntimeError("Settings checks require the list page; no report was modified")
            existed = cdp.evaluate(session, "Boolean(document.getElementById('jx-auto-diagnose-panel'))")
            if not existed:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if not trigger_clicked:
                        trigger_clicked = bool(cdp.evaluate(session, """(() => {
                          const trigger = document.querySelector('.table-header-setting-btn, .el-table__header-wrapper .column-setting, .el-table__header-wrapper [data-column-setting]');
                          if (!trigger) return false;
                          trigger.click(); return true;
                        })()"""))
                    available = cdp.evaluate(session, "Boolean(document.querySelector('[data-jx-auto-entry]'))")
                    if available:
                        cdp.evaluate(session, "document.querySelector('[data-jx-auto-entry]')?.click()")
                        opened = True
                        break
                    time.sleep(0.05)
            if args.exclude_exam:
                changed = cdp.evaluate(session, """(() => {
                  const panel = document.getElementById('jx-auto-diagnose-panel');
                  if (!panel) return false;
                  const wanted = """ + json.dumps(args.exclude_exam) + """;
                  for (const name of wanted) {
                    const check = [...panel.querySelectorAll('[data-group-name="examNamesExcluded"]')].find(x => x.value === name);
                    if (!check) return false;
                  }
                  for (const name of wanted) {
                    const check = [...panel.querySelectorAll('[data-group-name="examNamesExcluded"]')].find(x => x.value === name);
                    if (!check.checked) check.click();
                  }
                  panel.querySelector('[data-a="apply"]').click();
                  return true;
                })()""")
                if not changed:
                    raise RuntimeError("Exam exclusion controls were unavailable; no configuration was saved")
            settings = cdp.evaluate(session, """(() => {
              const panel = document.getElementById('jx-auto-diagnose-panel');
              if (!panel) return { available: false };
              const slots = [...panel.querySelectorAll('[data-f="autoEntryTimeSlot"]')];
              const content = panel.querySelector('.jx-panel-content');
              const oldScroll = content?.scrollTop || 0;
              if (content) content.scrollTop = content.scrollHeight;
              const close = panel.querySelector('[data-a="close"]')?.getBoundingClientRect();
              const closeVisibleAtBottom = !!close && close.top >= 0 && close.bottom <= innerHeight;
              if (content) content.scrollTop = oldScroll;
              const search = panel.querySelector('[data-a="examSearch"]');
              const oldSearch = search?.value || '';
              if (search) { search.value = '肋骨'; search.dispatchEvent(new Event('input', { bubbles: true })); }
              const searchFiltersNonmatchingOptions = [...panel.querySelectorAll('[data-group-name="examNamesExcluded"]')]
                .filter(x => x.value !== '无排除' && !x.value.includes('肋骨')).every(x => x.closest('label')?.hidden);
              const selectedRibVisible = [...panel.querySelectorAll('[data-group-name="examNamesExcluded"]')]
                .some(x => x.value === '肋骨平扫' && !x.closest('label')?.hidden);
              if (search) { search.value = oldSearch; search.dispatchEvent(new Event('input', { bubbles: true })); }
              return { available: true, slots: slots.map(x => ({ value: x.value, type: x.type, name: x.name,
                label: x.parentElement.textContent.trim() })), selectedCount: slots.filter(x => x.checked).length,
                entrySwitchChecked: !!panel.querySelector('[data-f="enabled"]')?.checked,
                entrySwitchDisabled: !!panel.querySelector('[data-f="enabled"]')?.disabled,
                developerRetention: {
                  preset: panel.querySelector('[data-f="developerRetentionPreset"]')?.value,
                  minutes: panel.querySelector('[data-f="developerRetentionMinutes"]')?.value,
                  customHidden: panel.querySelector('[data-a="developerRetentionCustom"]')?.hidden,
                  choices: [...(panel.querySelector('[data-f="developerRetentionPreset"]')?.options || [])].map(x => ({ value: x.value, label: x.textContent.trim() }))
                },
                examExclusions: {
                  selected: [...panel.querySelectorAll('[data-group-name="examNamesExcluded"]:checked')].map(x => x.value).filter(x => x !== '无排除'),
                  count: panel.querySelector('[data-a="examExcludedCount"]')?.textContent,
                  customAddAvailable: !!panel.querySelector('[data-a="customExcludedExam"]') && !!panel.querySelector('[data-a="addExamExclusion"]'),
                  searchAvailable: !!panel.querySelector('[data-a="examSearch"]'),
                  searchFiltersNonmatchingOptions, selectedRibVisible, closeVisibleAtBottom,
                  allowedUnlimited: !!panel.querySelector('[data-group-name="examNames"][value="不限"]')?.checked,
                  persisted: JSON.parse(localStorage.getItem('jx-radiation-auto-diagnose-config-v1:durable-v1') || '{}').examNamesExcluded || []
                },
                state: panel.querySelector('[data-a="autoEntryTimeState"]')?.textContent };
            })()""")
        options = sum(1 for x in cdp.target_infos() if x.get("type") == "page"
                      and "chrome-extension://" in x.get("url", "") and "options.html" in x.get("url", ""))
        loaded_runtime = cdp.loaded_runtime(session)
        print(json.dumps({"loadedRuntime": loaded_runtime, "expectedVersion": expected_version,
                          "settings": settings, "visibleOptionsTargets": options}, ensure_ascii=True))
        if not loaded_runtime:
            raise SystemExit("No current-context runtime version evidence; no report was refreshed")
        if loaded_runtime["version"] != expected_version:
            raise SystemExit("Current runtime version differs from the expected source version")
        if (args.check_settings or args.exclude_exam) and not settings.get("available"):
            raise SystemExit("Settings controls were not available")
    finally:
        if opened and session:
            cdp.evaluate(session, "document.querySelector('#jx-auto-diagnose-panel [data-a=" + json.dumps("close") + "]')?.click()")
        if trigger_clicked and session:
            cdp.evaluate(session, "document.querySelector('.table-header-setting-btn, .el-table__header-wrapper .column-setting, .el-table__header-wrapper [data-column-setting]')?.click()")
        cdp.browser.close()


if __name__ == "__main__":
    main()
