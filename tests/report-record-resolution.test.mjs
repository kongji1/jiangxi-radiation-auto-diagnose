import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
function block(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `missing ${startText}`);
  return source.slice(start, end);
}
const normalization = block('  function norm(s)', '  function pageWindow()');
const dates = block('  function parseDate(text)', '  const REPORT_STATUS_NAMES');
const names = block('  function candidatePatientName(d)', '  const AUTOMATIC_ENTRY_PREFIX');
const resolver = block('  function stableReportRecordUid(record)', '  function radiationListPayload(');
const apiResolver = block('  async function findRowRecordByApi(d)', '  async function protocolEnter(d)');
const candidate = (extra = {}) => ({ patientName: 'synthetic-person', exam: 'synthetic-exam', applyTime: '2026-10-07 09:00:10', ...extra });
const record = (uid = 'synthetic-report', extra = {}) => ({ repUid: uid, patName: 'synthetic-person',
  examName: 'synthetic-exam', checkinTime: '2026-10-07 09:00:10', ...extra });

function runtime(records = []) {
  const rows = [], pageRows = [], requests = [];
  const pageDocument = {};
  const page = { document: pageDocument };
  const context = vm.createContext({
    Date, Map, WeakSet,
    pageWindow: () => page,
    queryBodyRows: doc => doc === pageDocument ? pageRows : rows,
    fetchRadiationRecords: async options => { requests.push(options); return records; }
  });
  vm.runInContext(`${normalization}\n${dates}\n${names}\n${resolver}\n${apiResolver}`, context);
  return { context, rows, pageRows, requests,
    withRow(data, values) {
      const row = { __vueParentComponent: { props: { records: values } } };
      rows.push(row); pageRows.push(row);
      return { ...data, row };
    }
  };
}
let tested = 0;
async function test(name, run) { await run(); console.log(`ok ${++tested} - ${name}`); }

await test('stable UID aliases are accepted and malformed IDs rejected', () => {
  const r = runtime();
  for (const field of ['repUid', 'reportUid', 'reportId', 'id']) assert.equal(r.context.stableReportRecordUid({ [field]: 'synthetic-id' }), 'synthetic-id');
  for (const invalid of ['', 'invalid id', 'bad\u0000id', 'a'.repeat(97), {}, []]) assert.equal(r.context.stableReportRecordUid({ repUid: invalid }), '');
});
await test('already supplied stable record avoids DOM lookup and extra API requests', async () => {
  const r = runtime(), trusted = { repUid: 'synthetic-trusted' }, d = { record: trusted };
  assert.equal(r.context.findRowRecord(d), trusted);
  assert.equal(await r.context.findRowRecordByApi(d), trusted); assert.equal(r.requests.length, 0);
});
await test('invalid supplied record does not short-circuit protocol supplementation', async () => {
  const expected = record(), r = runtime([expected]);
  assert.equal(await r.context.findRowRecordByApi(candidate({ record: { repUid: 'invalid id' } })), expected);
  assert.equal(r.requests.length, 1);
});
await test('same examination of another patient is never accepted from a parent component', () => {
  const r = runtime(), wrong = record('synthetic-other', { patName: 'synthetic-other-person' });
  assert.equal(r.context.findRowRecord(r.withRow(candidate(), [wrong])), null);
});
await test('parent component finds the matching patient after an unrelated same-exam record', () => {
  const expected = record(), wrong = record('synthetic-other', { patName: 'synthetic-other-person' }), r = runtime();
  assert.equal(r.context.findRowRecord(r.withRow(candidate(), [wrong, expected])), expected);
});
await test('name substring match cannot resolve another patient', () => {
  const r = runtime(), wrong = record('synthetic-other', { patName: 'synthetic-person-extra' });
  assert.equal(r.context.findRowRecord(r.withRow(candidate(), [wrong])), null);
});
await test('name alone without examination or application-time corroboration is insufficient', () => {
  const r = runtime(), d = candidate({ exam: '', applyTime: '' });
  assert.equal(r.context.findRowRecord(r.withRow(d, [record()])), null);
});
await test('raw DOM patient text uses the actual name normalizer before exact comparison', () => {
  const expected = record('synthetic-report', { patName: 'synthetic-person' }), r = runtime();
  const d = { patient: 'synthetic-person 门诊 女 40岁', exam: 'synthetic-exam' };
  assert.equal(r.context.findRowRecord(r.withRow(d, [expected])), expected);
});
await test('exact application number can resolve a sparse record', () => {
  const expected = { repUid: 'synthetic-report', applyNo: 'synthetic-application' }, r = runtime();
  assert.equal(r.context.findRowRecord(r.withRow({ applicationNo: 'synthetic-application' }, [expected])), expected);
});
await test('application match wins over name/exam-only evidence', () => {
  const expected = record('synthetic-exact', { applyNo: 'synthetic-application' });
  const weaker = record('synthetic-weak'), r = runtime();
  const d = candidate({ applicationNo: 'synthetic-application' });
  assert.equal(r.context.findRowRecord(r.withRow(d, [weaker, expected])), expected);
});
await test('contradictory application number cannot be compensated by patient and exam', () => {
  const r = runtime(), wrong = record('synthetic-other', { applyNo: 'synthetic-other-application' });
  assert.equal(r.context.findRowRecord(r.withRow(candidate({ applicationNo: 'synthetic-application' }), [wrong])), null);
});
await test('a patient ID equal to an application number is not application evidence', async () => {
  const r = runtime([{ repUid: 'synthetic-other', patId: 'synthetic-application', examName: 'synthetic-exam' }]);
  assert.equal(await r.context.findRowRecordByApi({ applicationNo: 'synthetic-application', exam: 'synthetic-exam' }), null);
});
await test('contradictory patient name rejects even an exact application number', () => {
  const r = runtime(), wrong = record('synthetic-other', { patName: 'synthetic-other-person', applyNo: 'synthetic-application' });
  assert.equal(r.context.findRowRecord(r.withRow(candidate({ applicationNo: 'synthetic-application' }), [wrong])), null);
});
await test('same application and patient resolve distinct examinations without merging reports', () => {
  const first = record('synthetic-first', { applyNo: 'synthetic-application', examName: 'synthetic-first-exam' });
  const second = record('synthetic-second', { applyNo: 'synthetic-application', examName: 'synthetic-second-exam' });
  const r = runtime();
  assert.equal(r.context.findRowRecord(r.withRow(candidate({ applicationNo: 'synthetic-application', exam: 'synthetic-second-exam' }), [first, second])), second);
});
await test('same-name examinations are distinguished by application time', async () => {
  const earlier = record('synthetic-earlier', { checkinTime: '2026-10-07 08:59:10' }), expected = record('synthetic-later');
  const r = runtime([earlier, expected]);
  assert.equal(await r.context.findRowRecordByApi(candidate()), expected);
});
await test('different representations of the same timestamp compare equally', async () => {
  const expected = record('synthetic-report', { checkinTime: '2026-10-07T09:00:10' }), r = runtime([expected]);
  assert.equal(await r.context.findRowRecordByApi(candidate({ applyTime: '2026-10-0709:00:10' })), expected);
});
await test('multiple distinct UIDs with equally strong matches return null in DOM and API', async () => {
  const first = record('synthetic-first'), second = record('synthetic-second'), r = runtime([first, second]);
  assert.equal(r.context.findRowRecord(r.withRow(candidate(), [first, second])), null);
  assert.equal(await r.context.findRowRecordByApi(candidate()), null);
});
await test('duplicate proxies of the same report UID are one candidate', async () => {
  const expected = record(), duplicate = { ...expected }, r = runtime([expected, duplicate]);
  assert.equal(r.context.findRowRecord(r.withRow(candidate(), [expected, duplicate])), expected);
  assert.equal(await r.context.findRowRecordByApi(candidate()), expected);
});
await test('shared application with multiple UIDs and no examination evidence remains ambiguous', () => {
  const first = record('synthetic-first', { applyNo: 'synthetic-application' });
  const second = record('synthetic-second', { applyNo: 'synthetic-application' }), r = runtime();
  assert.equal(r.context.findRowRecord(r.withRow({ applicationNo: 'synthetic-application' }, [first, second])), null);
});
await test('empty row identity cannot pick the first UID in the component tree', () => {
  const r = runtime(); assert.equal(r.context.findRowRecord(r.withRow({}, [record()])), null);
});
await test('isolated row uses corresponding page-world Vue references and handles cycles', () => {
  const r = runtime(), isolated = {}, expected = record();
  const component = { props: { row: expected } }; component.parent = component;
  r.rows.push(isolated); r.pageRows.push({ __vueParentComponent: component });
  assert.equal(r.context.findRowRecord(candidate({ row: isolated })), expected);
});
await test('API supplementation uses the existing bounded read-only query and errors stay unresolved', async () => {
  const expected = record(), r = runtime([expected]), d = candidate();
  assert.equal(await r.context.findRowRecordByApi(d), expected);
  assert.equal(r.requests[0].match, d); assert.equal(r.requests[0].pageSize, 20); assert.equal(r.requests[0].timeoutMs, 4500);
  r.context.fetchRadiationRecords = async () => { throw new Error('synthetic-read-failure'); };
  assert.equal(await r.context.findRowRecordByApi(candidate()), null);
});
console.log(`${tested} report-record-resolution tests passed`);
