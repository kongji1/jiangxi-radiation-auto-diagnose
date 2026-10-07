"""Read one named candidate's native operation history without entering a report."""
from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_tampermonkey_radiation_cdp import Cdp


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--date", default=datetime.date.today().isoformat())
    parser.add_argument("--other-doctor", default="")
    parser.add_argument("--cdp", default="http://127.0.0.1:9333")
    args = parser.parse_args()
    datetime.date.fromisoformat(args.date)
    cdp = Cdp(args.cdp.rstrip("/"))
    try:
        pages = [item for item in cdp.target_infos() if item.get("type") == "page"
                 and urlsplit(item.get("url", "")).netloc == "10.10.94.90:22112"
                 and urlsplit(item.get("url", "")).path in ("/radiation", "/radiation/report")]
        if len(pages) != 1:
            raise RuntimeError("Cannot uniquely select the radiation business page")
        session = cdp.call("Target.attachToTarget", {"targetId": pages[0]["targetId"], "flatten": True})["sessionId"]
        expression = """(async (name, date, otherDoctor) => {
          try {
            const native = await import('/assets/index-BjDrsRb7.js');
            const report = (await import('/assets/report-DpTgcvrz.js')).C;
            if (typeof native.f !== 'function' || !report?.getRadiationList || !report?.getReportLog)
              return { ok: false, error: 'Native API contract changed' };
            const user = await native.f({ url: '/admin/user/info', method: 'get' });
            if (user?.code !== 200 || !user.data?.oid)
              return { ok: false, stage: 'identity', code: user?.code ?? null };
            const list = await report.getRadiationList({
              patName: name, checkOrgId: user.data.oid, pageNum: 1, pageSize: 10,
              checkinStartTime: date + ' 00:00:00', checkinEndTime: date + ' 23:59:59',
              reportStatusCodeList: [], modalityList: [],
              sortByParams: [{ sortField: 'checkinTime', sortRule: 'DESC' }]
            });
            const records = (list.data?.records || []).filter(r => r.patName === name &&
              String(r.checkinTime || '').startsWith(date)).sort((a,b) => String(b.checkinTime).localeCompare(String(a.checkinTime)));
            if (list.code !== 200 || !records.length)
              return { ok: false, stage: 'named-list', code: list.code, found: false };
            const record = records[0];
            const response = await report.getReportLog(record.repUid);
            const knownCurrent = [user.data.name, user.data.realName, user.data.userName,
              user.data.loginCode, user.data.account].filter(Boolean).map(String);
            const actor = value => {
              const text = typeof value === 'string' ? value : JSON.stringify(value || '');
              if (otherDoctor && text.includes(otherDoctor)) return otherDoctor;
              if (knownCurrent.some(v => text.includes(v))) return '当前账号';
              return '其他账号';
            };
            const safeAction = value => {
              const text = String(value || '');
              return /^(锁定报告|解锁报告|待诊断开始诊断|诊断中开始诊断|退出诊断|取消诊断|提交报告|审核报告)$/.test(text) ? text : '';
            };
            const rows = Array.isArray(response.data) ? response.data : response.data?.records || [];
            return { ok: response.code === 200, code: response.code,
              applicationTime: record.checkinTime, status: record.reportStatus,
              modality: record.modality, examName: record.examName, age: record.patAge,
              statusCode: record.reportStatusCode, reportDoctor: actor(record.reportDoc),
              matchedReports: records.length,
              events: rows.map(r => ({ at: r.operateTime, status: r.status,
                operationCode: r.operationCode, actor: actor(r.user), action: safeAction(r.remark) }))
                .sort((a,b) => String(a.at).localeCompare(String(b.at))) };
          } catch (error) {
            return { ok: false, error: 'Native read-only operation-history query failed', errorClass: error?.name };
          }
        })(""" + ",".join(json.dumps(value) for value in (args.name, args.date, args.other_doctor)) + ")"
        result = cdp.evaluate(session, expression)
        if result is None:
            raise RuntimeError("Native audit query returned no result")
        print(json.dumps(result, ensure_ascii=True))
    finally:
        cdp.browser.close()


if __name__ == "__main__":
    main()
