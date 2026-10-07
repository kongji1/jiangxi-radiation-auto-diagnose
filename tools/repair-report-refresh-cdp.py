"""Repair an explicitly confirmed legacy report without reloading its edits.

No business request or report submission is made. --confirmed-transport is only
for a current report whose successful initial load was independently verified.
Otherwise this merely schedules a single list-only load of the installed fix.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from update_tampermonkey_radiation_cdp import Cdp


def closure_refs(cdp, session):
    result = cdp.session_call(session, "Runtime.evaluate", {
        "expression": "typeof window.__JX_PROTOCOL_ENTRY_HANDOFF__?.confirmLoaded === 'function' ? null : window.__JX_PROTOCOL_ENTRY_HANDOFF__?.stage",
        "returnByValue": False,
    }).get("result", {})
    if result.get("type") != "function":
        raise RuntimeError("LEGACY_BRIDGE_NOT_FOUND")
    properties = cdp.session_call(session, "Runtime.getProperties", {
        "objectId": result["objectId"], "ownProperties": True,
    })
    scopes = next((x["value"]["objectId"] for x in properties.get("internalProperties", [])
                   if x.get("name") == "[[Scopes]]"), None)
    if not scopes:
        raise RuntimeError("LEGACY_CLOSURE_UNAVAILABLE")
    for scope in cdp.session_call(session, "Runtime.getProperties", {
        "objectId": scopes, "ownProperties": True,
    }).get("result", []):
        value = scope.get("value", {})
        if not scope.get("name", "").isdigit() or not value.get("objectId"):
            continue
        fields = {p["name"]: p.get("value", {}) for p in cdp.session_call(session, "Runtime.getProperties", {
            "objectId": value["objectId"], "ownProperties": True,
        }).get("result", [])}
        if fields.get("tickets", {}).get("className") == "Map" and all(
                fields.get(name, {}).get("type") == "function" for name in ("session", "reportId")):
            return [fields[name]["objectId"] for name in ("tickets", "session", "reportId")]
    raise RuntimeError("LEGACY_CLOSURE_UNAVAILABLE")


def repair(target_id, confirmed_transport):
    spec = importlib.util.spec_from_file_location("maintenance", ROOT / "tools/maintain-project.py")
    maintenance = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(maintenance)
    expected = hashlib.sha256((ROOT / "jiangxi-radiation-auto-diagnose.user.js").read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    installed = maintenance.installed_hash("http://127.0.0.1:9333", maintenance.SCRIPT_UUID)
    if not installed.get("verified") or installed.get("sourceSha256Lf") != expected:
        raise RuntimeError("FIXED_SOURCE_NOT_INSTALLED")
    if json.loads((ROOT / "src/manifest.json").read_text(encoding="utf-8"))["version"] != "0.8.56":
        raise RuntimeError("COMPAT_REQUIRES_VERSION_0_8_56")
    function = subprocess.check_output([
        "node", "--input-type=module", "-e",
        "import {reportRefreshCompatFunctionDeclaration as f} from './tools/report-refresh-compat.mjs';process.stdout.write(f)",
    ], cwd=ROOT, text=True, encoding="utf-8")
    cdp = Cdp("http://127.0.0.1:9333")
    try:
        target = next((t for t in cdp.target_infos() if t.get("targetId") == target_id), None)
        url = urlsplit(target.get("url", "")) if target else None
        if not target or target.get("type") != "page" or url.netloc != "10.10.94.90:22112" or url.path != "/radiation/report":
            raise RuntimeError("CURRENT_REPORT_TARGET_REQUIRED")
        session = cdp.call("Target.attachToTarget", {"targetId": target_id, "flatten": True})["sessionId"]
        refs = closure_refs(cdp, session)
        # The original records, account and session remain solely in the page.
        wrapper = """function(sessionFn, reportIdFn, confirmed) {
          const uid=reportIdFn(), identity=sessionFn();
          const selectors=['.user-wrap .avatar-wrapper > div > div:first-child span','.header-right .user-wrap .avatar-wrapper span:not(.el-tooltip__trigger)','.avatar-wrapper span:not(.el-tooltip__trigger)','[class*="user-wrap"] [class*="avatar-wrapper"] > div > div:first-child span'];
          const norm=x=>String(x||'').normalize('NFC').replace(/[\\s\\u200b-\\u200d\\ufeff]/g,'');
          const account=norm(selectors.map(s=>document.querySelector(s)?.textContent).find(Boolean));
          const events=Object.keys(localStorage).filter(k=>/^jx-radiation-auto-diagnose-debug-journal-v[23]:/.test(k)).flatMap(k=>{try{return JSON.parse(localStorage.getItem(k))?.events||[]}catch{return[]}});
          const match=confirmed && events.filter(e=>e.event==='报告进入完成'&&e.recordId===uid&&e.routeReportId===uid&&e.responseRouteReportId===uid&&e.responseRepUid===uid&&e.route==='/radiation/report'&&e.responseRoute==='/radiation/report'&&e.finalReportLoaded===true&&e.requestMethod==='POST'&&e.endpointKind==='radiation-entry'&&e.httpStatus===200&&Number(e.code)===200&&norm(e.reportDoctor)===account).at(-1);
          const proof=match ? {...match, repUid:uid, outcome:'complete', phase:'report-enter', code:200, transportCompleted:true, account:identity?.account, workstation:identity?.workstation, sessionKey:identity?.key, deferListReload:true} : {deferListReload:true};
          return (COMPAT).call(this,sessionFn,reportIdFn,proof);
        }""".replace("COMPAT", function)
        result = cdp.session_call(session, "Runtime.callFunctionOn", {
            "objectId": refs[0], "functionDeclaration": wrapper,
            "arguments": [{"objectId": refs[1]}, {"objectId": refs[2]}, {"value": confirmed_transport}],
            "returnByValue": True,
        })
        if result.get("exceptionDetails"):
            raise RuntimeError("COMPAT_EVALUATION_FAILED")
        value = result.get("result", {}).get("value", {})
        if not value.get("installed"):
            raise RuntimeError("CURRENT_REPORT_CONFIRMATION_FAILED")
        # Another tab can have renewed the shared cookies. A spent old-session
        # ticket then no longer intercepts current requests: leave it untouched.
        value["readiness"] = "CURRENT_REFRESH_RELEASED" if value.get("confirmedCount") == 1 else "DEFERRED_LIST_LOAD_ONLY"
        return value
    finally:
        cdp.browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, help="Exact local Edge 9333 report target ID")
    parser.add_argument("--confirmed-transport", action="store_true", help="Only after independently confirming current report successfully loaded")
    args = parser.parse_args()
    try:
        print(json.dumps(repair(args.target, args.confirmed_transport), ensure_ascii=True))
    except Exception as error:
        # Do not echo browser exception details, scope values or credentials.
        reason = str(error) if isinstance(error, RuntimeError) and str(error).isupper() else "COMPAT_FAILED"
        print(json.dumps({"installed": False, "reason": reason}))
        raise SystemExit(1)
