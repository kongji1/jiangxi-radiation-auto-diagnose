import fs from 'node:fs';
import assert from 'node:assert/strict';

const normalizeSource = text => text.replace(/\r\n/g, '\n');
const source = normalizeSource(fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8'));
const section = (start, end, input = source) => {
  const normalized = normalizeSource(input);
  const from = normalized.indexOf(start), to = normalized.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `source section ${start}`);
  return normalized.slice(from, to);
};
const defaults = new Function(`${section('  const DEFAULT_CONFIG = {', '\n  const STORAGE_KEY =')}; return DEFAULT_CONFIG;`)();
const configCode = section('  function loadConfig()', '  function entryDelayPlan(');
const matchingCode = section('  function isExcludedExam(', '  function pendingSelector(');
const normCode = section('  function norm(', '  function pageWindow(');
const key = 'jx-radiation-auto-diagnose-config-v1';
const clone = value => structuredClone(value);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

function runtime(saved = null, shared = new Map()) {
  if (saved) shared.set(key, JSON.stringify(saved));
  const r = new Function('GM_getValue', 'GM_setValue', 'developerLocalStorage', 'DEFAULT_CONFIG', 'structuredClone', 'autoEntryScheduleState', 'console', `
    const STORAGE_KEY = '${key}'; let developerModeMigrationApplied = false;
    ${normCode} ${configCode} let config = loadConfig(); ${matchingCode}
    function matchTime() { return true; }
    return { config, saveConfig, loadConfig, configWithCurrentEntrySchedule, normalizeExamNameList, buildExamOptionCatalog, isExcludedExam, matchFailureReasons };
  `)((name, fallback) => shared.get(name) ?? fallback, (name, value) => shared.set(name, value), () => null,
    clone(defaults), structuredClone, () => ({ configured: false, requiresSelection: false, expired: false }), { warn() {} });
  return { ...r, shared };
}
function unrestricted(extra = {}) {
  return { ...clone(defaults), reportStatuses: [], encounterTypes: [], gender: [], age: { unlimited: true, min: null, max: null }, modalities: [], examNames: [], examNamesExtra: [], applicationTime: { mode: 'all' }, ...extra };
}
function candidate(exam) { return { exam, patient: 'synthetic-patient', status: '待诊断', statusCode: '102501', modality: 'CT' }; }

await test('old configurations gain empty exclusions without changing accepted exams or other filters', () => {
  assert.deepEqual(defaults.examNamesExcluded, []);
  const saved = unrestricted({ examNamesExtra: ['synthetic-selected'], enabled: false }); delete saved.examNamesExcluded;
  const r = runtime(saved);
  assert.deepEqual(r.config.examNamesExcluded, []);
  assert.deepEqual(r.config.examNamesExtra, ['synthetic-selected']); assert.equal(r.config.enabled, false);
});

await test('unlimited allowed exams still reject a selected rib exam', () => {
  const r = runtime(unrestricted({ examNamesExcluded: ['肋骨平扫'] }));
  assert.equal(r.isExcludedExam(candidate('肋骨平扫')), true);
  assert.deepEqual(r.matchFailureReasons(candidate('肋骨平扫')), ['检查项目排除']);
  assert.deepEqual(r.matchFailureReasons(candidate('胸部平扫')), []);
});

await test('an excluded second or later item rejects the entire multi-part examination', () => {
  const r = runtime(unrestricted({ examNamesExcluded: ['肋骨平扫'] }));
  for (const separator of [',', '，', '、', '+', '＋', ';', '；', '/', '\\']) {
    assert.equal(r.isExcludedExam(candidate(`胸部平扫${separator}肋骨平扫`)), true, separator);
    assert.ok(r.matchFailureReasons(candidate(`头颅平扫${separator}胸部平扫${separator}肋骨平扫`)).includes('检查项目排除'), separator);
  }
});

await test('exclusion wins when an allowed examination or weight would otherwise admit it', () => {
  const r = runtime(unrestricted({ examNames: ['肋骨平扫'], examNamesExcluded: ['肋骨平扫'], examWeights: ['肋骨平扫=999'] }));
  assert.deepEqual(r.matchFailureReasons(candidate('肋骨平扫')), ['检查项目排除']);
});

await test('empty exclusion lists do not add filtering or throw for missing exam fields', () => {
  const r = runtime(unrestricted());
  for (const exam of ['肋骨平扫', '', undefined, null]) assert.equal(r.isExcludedExam(candidate(exam)), false);
  assert.deepEqual(r.matchFailureReasons(candidate(undefined)), []);
});

await test('full names normalize whitespace and invisible characters without substring matching', () => {
  const r = runtime(unrestricted({ examNamesExcluded: [' 肋 骨 平 扫\u200b ', 'synthetic-exam'] }));
  assert.equal(r.isExcludedExam(candidate('肋骨 平扫')), true);
  for (const exam of ['肋骨平扫增强', '左侧肋骨平扫', '右侧肋骨平扫', '双侧肋骨平扫', 'synthetic-exam-extended']) assert.equal(r.isExcludedExam(candidate(exam)), false, exam);
});

await test('left right and bilateral names are explicit choices rather than implicit broad matches', () => {
  const r = runtime(unrestricted({ examNamesExcluded: ['左侧肋骨平扫', '双侧肋骨平扫'] }));
  assert.equal(r.isExcludedExam(candidate('左侧肋骨平扫')), true);
  assert.equal(r.isExcludedExam(candidate('双侧肋骨平扫')), true);
  assert.equal(r.isExcludedExam(candidate('右侧肋骨平扫')), false);
  const catalog = r.buildExamOptionCatalog(r.config);
  for (const name of ['肋骨平扫', '左侧肋骨平扫', '右侧肋骨平扫', '双侧肋骨平扫']) assert.ok(catalog.includes(name));
});

await test('protocol source field fallback and all split items use the same exclusion rule', () => {
  const r = runtime(unrestricted({ examNamesExcluded: ['synthetic-exam'] }));
  assert.equal(r.isExcludedExam({ record: { examName: 'other+synthetic-exam' } }), true);
  assert.equal(r.isExcludedExam({ record: { exam: 'synthetic-exam' } }), true);
  assert.equal(r.isExcludedExam(null), false);
});

await test('invalid non-text rules and unlimited sentinels cannot become blanket exclusions', () => {
  const r = runtime(unrestricted({ examNamesExcluded: [null, true, 3, {}, [], '', '不限', '无排除', 'synthetic-exam', ' synthetic-exam '] }));
  assert.deepEqual(r.config.examNamesExcluded, ['synthetic-exam']);
  for (const raw of [{ contains: '肋骨' }, true, 1, null]) assert.deepEqual(r.normalizeExamNameList(raw), []);
  assert.deepEqual(r.normalizeExamNameList('synthetic-a，synthetic-b\nsynthetic-a'), ['synthetic-a', 'synthetic-b']);
});

await test('custom selections survive save reload and saved-profile restoration', () => {
  const r = runtime(unrestricted({ examNamesExcluded: ['synthetic-custom'], examNamesCatalog: ['synthetic-custom'] }));
  r.saveConfig(); const next = runtime(null, r.shared);
  assert.deepEqual(next.config.examNamesExcluded, ['synthetic-custom']);
  assert.ok(next.buildExamOptionCatalog(next.config).includes('synthetic-custom'));
  const restored = next.configWithCurrentEntrySchedule(JSON.parse(JSON.stringify(next.config)));
  assert.deepEqual(restored.examNamesExcluded, ['synthetic-custom']);
});

await test('actual refresh handler preserves custom selected exclusions even when absent from returned rows', async () => {
  const r = runtime(unrestricted({ examNamesExcluded: ['synthetic-custom'], examNamesCatalog: ['synthetic-old'] }));
  const input = { onclick: null }; const box = { querySelector: () => input }; let renders = 0;
  const code = section("    box.querySelector('[data-a=\"refreshExamOptions\"]').onclick", "    box.querySelector('[data-a=\"reset\"]').onclick");
  new Function('box', 'read', 'msg', 'fetchRadiationRecords', 'config', 'norm', 'availableExamOptions', 'buildExamOptionCatalog', 'saveConfig', 'render', code)(
    box, () => {}, () => {}, async () => [{ examName: 'synthetic-new', applyOrgName: 'synthetic-org' }], r.config,
    value => String(value ?? '').replace(/\s/g, ''), () => r.buildExamOptionCatalog(r.config), r.buildExamOptionCatalog, r.saveConfig, () => { renders++; });
  await input.onclick();
  assert.equal(renders, 1); assert.deepEqual(r.config.examNamesExcluded, ['synthetic-custom']);
  for (const name of ['synthetic-custom', 'synthetic-old', 'synthetic-new']) assert.ok(r.config.examNamesCatalog.includes(name));
  assert.deepEqual(runtime(null, r.shared).config.examNamesExcluded, ['synthetic-custom']);
});

await test('actual allowed and excluded checkbox handlers keep unlimited and no-exclusion semantics separate', () => {
  const groups = {
    examNames: [{ value: '不限', checked: true }, { value: '头颅平扫', checked: false }],
    examNamesExtra: [{ value: 'synthetic-extra', checked: false }],
    examNamesExcluded: [{ value: '无排除', checked: false }, { value: '肋骨平扫', checked: true }]
  };
  const all = Object.entries(groups).flatMap(([name, checks]) => checks.map(check => ({ ...check, dataset: { groupName: name }, addEventListener(_event, fn) { this.change = fn; } })));
  const select = selector => {
    if (selector === 'input[data-group-name]') return all;
    const names = [...selector.matchAll(/data-group-name="([^"]+)"/g)].map(match => match[1]);
    return all.filter(check => names.includes(check.dataset.groupName) && (!selector.includes('[value="不限"]') || check.value === '不限'));
  };
  const box = { querySelectorAll: select, querySelector: selector => select(selector)[0] };
  const code = section("      box.querySelectorAll('input[data-group-name]').forEach", '\n    }\n    function setGroup');
  new Function('box', 'refreshExamUI', code)(box, () => {});
  const allowAll = all.find(check => check.value === '不限');
  const extra = all.find(check => check.value === 'synthetic-extra');
  const excluded = all.find(check => check.value === '肋骨平扫');
  const noExclude = all.find(check => check.value === '无排除');
  extra.checked = true; extra.change(); assert.equal(allowAll.checked, false);
  allowAll.checked = true; allowAll.change(); assert.equal(extra.checked, false); assert.equal(excluded.checked, true);
  excluded.checked = false; excluded.change(); assert.equal(noExclude.checked, true); assert.equal(allowAll.checked, true);
  excluded.checked = true; excluded.change(); assert.equal(noExclude.checked, false); assert.equal(allowAll.checked, true);
});

await test('actual Add and clear buttons persist custom exclusions without Apply', () => {
  const r = runtime(unrestricted()); const input = { value: 'synthetic-new', focus() {} }; const add = {};
  const box = { querySelector: selector => selector.includes('customExcludedExam') ? input : add };
  const addCode = section("    box.querySelector('[data-a=\"addExamExclusion\"]').onclick", "    box.querySelector('[data-a=\"customExcludedExam\"]').addEventListener");
  new Function('box', 'normalizeExamNameList', 'read', 'config', 'buildExamOptionCatalog', 'saveConfig', 'render', 'msg', addCode)(
    box, r.normalizeExamNameList, () => {}, r.config, r.buildExamOptionCatalog, r.saveConfig, () => {}, () => {});
  add.onclick(); assert.equal(input.value, '');
  assert.deepEqual(runtime(null, r.shared).config.examNamesExcluded, ['synthetic-new']);
  assert.ok(r.config.examNamesCatalog.includes('synthetic-new'));
  const clear = {}; const clearBox = { querySelector: () => clear };
  const clearCode = section("    box.querySelector('[data-a=\"clearExamExclusions\"]').onclick", "    box.querySelector('[data-a=\"addExamExclusion\"]').onclick");
  new Function('box', 'read', 'config', 'saveConfig', 'setGroup', 'refreshExamUI', 'msg', clearCode)(
    clearBox, () => {}, r.config, r.saveConfig, () => {}, () => {}, () => {});
  clear.onclick(); assert.deepEqual(runtime(null, r.shared).config.examNamesExcluded, []);
  assert.ok(r.config.examNamesCatalog.includes('synthetic-new'));
});

await test('actual multiline handler extraction is identical after LF and CRLF checkouts', () => {
  const start = "      box.querySelectorAll('input[data-group-name]').forEach";
  const end = '\n    }\n    function setGroup';
  const lf = section(start, end, source);
  const crlf = section(start, end, source.replace(/\n/g, '\r\n'));
  assert.equal(crlf, lf);
  assert.ok(lf.includes('addEventListener'));
  assert.doesNotThrow(() => new Function('box', 'refreshExamUI', crlf));
});

console.log(`exam-exclusions: ${passed} scenarios passed`);
