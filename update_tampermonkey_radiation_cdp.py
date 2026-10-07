"""Protocol-only Tampermonkey update for the Jiangxi radiation userscript.

The update uses Tampermonkey's own ``saveScript`` message from a hidden
extension target. No CodeMirror editor is opened and the temporary target is
closed before the command returns.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request
from urllib.parse import urlsplit
from pathlib import Path

import websocket


EXTENSION_ID = "iikmkjmpaadaobahmlepeloendndfphd"
DEFAULT_SOURCE = Path(__file__).resolve().parent / "jiangxi-radiation-auto-diagnose.user.js"
DEFAULT_CDP = "http://127.0.0.1:9333"


class Cdp:
    def __init__(self, url: str, timeout: float = 5):
        version = json.load(urllib.request.urlopen(url + "/json/version", timeout=timeout))
        self.browser = websocket.create_connection(version["webSocketDebuggerUrl"], timeout=timeout)
        self.next_id = 0

    def call(self, method: str, params: dict | None = None):
        self.next_id += 1
        ident = self.next_id
        self.browser.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
        while True:
            item = json.loads(self.browser.recv())
            if item.get("id") == ident:
                if "error" in item:
                    raise RuntimeError(f"{method}: {item['error'].get('message', item['error'])}")
                return item.get("result", {})

    def evaluate(self, session_id: str, expression: str):
        result = self.session_call(
            session_id,
            "Runtime.evaluate",
            {"expression": expression, "awaitPromise": True, "returnByValue": True},
        )
        remote = result.get("result", {})
        if remote.get("subtype") == "error":
            raise RuntimeError(remote.get("description", "Runtime.evaluate failed"))
        return remote.get("value")

    def target_infos(self):
        return self.call("Target.getTargets").get("targetInfos", [])

    def session_call(self, session_id: str, method: str, params: dict | None = None):
        self.next_id += 1
        ident = self.next_id
        self.browser.send(json.dumps({"id": ident, "sessionId": session_id, "method": method, "params": params or {}}))
        while True:
            item = json.loads(self.browser.recv())
            if item.get("id") == ident:
                if "error" in item:
                    raise RuntimeError(f"{method}: {item['error'].get('message', item['error'])}")
                return item.get("result", {})


def find_radiation_page():
    targets = json.load(urllib.request.urlopen(DEFAULT_CDP + "/json/list", timeout=5))
    # Reload only the list. An open report can contain unsaved work.
    return next((x for x in targets if x.get("type") == "page"
                 and urlsplit(x.get("url", "")).netloc == "10.10.94.90:22112"
                 and urlsplit(x.get("url", "")).path == "/radiation"), None)


def find_script(rows, name: str):
    """Find a userscript row in Tampermonkey's nested loadTree response."""
    matches = []

    def collect(items):
        for row in items or []:
            if not isinstance(row, dict):
                continue
            if row.get("name") == name and row.get("uuid"):
                matches.append(row)
            collect(row.get("items") or [])

    collect(rows)
    # Prefer the enabled, non-deleted copy when an earlier visible-editor
    # update left duplicate rows behind.  Fall back to the first matching row
    # so a disabled script can still be repaired and enabled by the caller.
    for row in matches:
        if row.get("enabled") is not False and not row.get("deleted"):
            return row
    if matches:
        return matches[0]
    return None


def main():
    global DEFAULT_CDP
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=str(DEFAULT_SOURCE))
    parser.add_argument("--cdp", default=DEFAULT_CDP)
    parser.add_argument("--no-reload", action="store_true")
    parser.add_argument("--script-name", default="江西省县域医共体 - 自动诊断候选")
    args = parser.parse_args()
    DEFAULT_CDP = args.cdp.rstrip("/")
    source = Path(args.source)
    text = source.read_text(encoding="utf-8")
    version = (next((line.split()[-1] for line in text.splitlines() if "@version" in line), "unknown"))
    cdp = Cdp(DEFAULT_CDP)
    # Create a hidden about:blank target first. Navigating a target created
    # directly at options.html can be promoted to a visible Tampermonkey tab
    # by some Edge/Tampermonkey builds.
    created = cdp.call("Target.createTarget", {"url": "about:blank", "hidden": True})
    target_id = created["targetId"]
    uuid = None
    try:
        attached = cdp.call("Target.attachToTarget", {"targetId": target_id, "flatten": True})
        session_id = attached["sessionId"]
        cdp.session_call(session_id, "Page.navigate", {"url": f"chrome-extension://{EXTENSION_ID}/options.html#nav=settings"})
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if cdp.evaluate(session_id, "typeof window.sendMessage") == "function":
                break
            time.sleep(0.02)
        else:
            raise TimeoutError("Tampermonkey options bridge did not load")

        load_expr = """new Promise(resolve => window.sendMessage({
          method: 'loadTree', referrer: 'options.scripts'
        }, resolve))"""
        loaded = cdp.evaluate(session_id, load_expr)
        items = loaded.get("items", []) if isinstance(loaded, dict) else []
        current = find_script(items, args.script_name)
        if not current:
            raise RuntimeError(f"Tampermonkey script not found: {args.script_name}")
        uuid = current["uuid"]
        payload = json.dumps(text, ensure_ascii=True)
        # Tampermonkey's own saveScript message updates the installed script
        # without opening the editor or invoking its UI lifecycle.
        save_expr = f"""new Promise(resolve => window.sendMessage({{
          method: 'saveScript', uuid: {json.dumps(uuid)},
          code: {payload}, reload: true, auto_save: true, new_script: false
        }}, resolve))"""
        save_value = cdp.evaluate(session_id, save_expr)
        if isinstance(save_value, dict) and save_value.get("error"):
            raise RuntimeError(f"Tampermonkey saveScript failed: {save_value}")
        # saveScript preserves the installed script's enabled flag.  A prior
        # visible-editor update left this copy disabled, so explicitly enable
        # the same UUID through Tampermonkey's options bridge after saving.
        enable_expr = f"""new Promise(resolve => window.sendMessage({{
          method: 'modifyScriptOptions', uuid: {json.dumps(uuid)},
          enabled: true, reload: true
        }}, resolve))"""
        enable_value = cdp.evaluate(session_id, enable_expr)
        if isinstance(enable_value, dict) and enable_value.get("error"):
            raise RuntimeError(f"Tampermonkey enableScript failed: {enable_value}")
        updated = cdp.evaluate(session_id, load_expr)
        updated_items = updated.get("items", []) if isinstance(updated, dict) else []
        updated_script = find_script(updated_items, args.script_name)
        if not updated_script or updated_script.get("version") != version or updated_script.get("enabled") is False:
            actual = updated_script.get("version") if updated_script else None
            enabled = updated_script.get("enabled") if updated_script else None
            raise RuntimeError(f"Tampermonkey verification failed: expected {version}/enabled, got {actual}/{enabled}")
    finally:
        cdp.call("Target.closeTarget", {"targetId": target_id})
        cdp.browser.close()
    page = find_radiation_page()
    reloaded = False
    if page and not args.no_reload:
        reload_cdp = Cdp(DEFAULT_CDP)
        try:
            attached = reload_cdp.call("Target.attachToTarget", {"targetId": page["id"], "flatten": True})
            # The native router can open a report between target discovery and
            # this call. Check and reload atomically to preserve report edits.
            reloaded = bool(reload_cdp.evaluate(attached["sessionId"], "(() => { if (location.host !== '10.10.94.90:22112' || location.pathname !== '/radiation') return false; location.reload(); return true; })()"))
        finally:
            reload_cdp.browser.close()
    print(json.dumps({"ok": True, "version": version, "uuid": uuid, "hiddenTargetClosed": True, "businessPageReloaded": reloaded}, ensure_ascii=False))


if __name__ == "__main__":
    main()
