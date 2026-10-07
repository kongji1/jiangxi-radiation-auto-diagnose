import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../jiangxi-radiation-auto-diagnose.user.js', import.meta.url), 'utf8');
const defaultsStart = source.indexOf('  const DEFAULT_CONFIG = {');
const defaultsEnd = source.indexOf('\n  const STORAGE_KEY =', defaultsStart);
const defaults = new Function(`${source.slice(defaultsStart, defaultsEnd)}; return DEFAULT_CONFIG;`)();
const configStart = source.indexOf('  function loadConfig()');
const configEnd = source.indexOf('  function configWithCurrentEntrySchedule(', configStart);
const configCode = source.slice(configStart, configEnd);
const key = 'jx-radiation-auto-diagnose-config-v1';
const mirrorKey = key + ':durable-v1';
const clone = value => structuredClone(value);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

function sharedStorage(saved = null) {
  const values = new Map();
  if (saved) values.set(key, JSON.stringify(saved));
  const mirror = new Map();
  return { values, local: { getItem: name => mirror.get(name) ?? null, setItem: (name, value) => mirror.set(name, String(value)) } };
}
function runtime(shared, version = '0.8.50', staleCache = false) {
  const cache = new Map(shared.values);
  const writes = [];
  return new Function(
    'GM_getValue', 'GM_setValue', 'developerLocalStorage', 'DEFAULT_CONFIG', 'SCRIPT_VERSION', 'structuredClone', 'autoEntryScheduleState', 'norm', 'console',
    `const STORAGE_KEY = '${key}'; let developerModeMigrationApplied = false; ${configCode}
     let config = loadConfig(); return { config, saveConfig, loadConfig, normalizeDeveloperRetentionMinutes, writes: null };`
  )(
    (name, fallback) => (staleCache ? cache : shared.values).get(name) ?? fallback,
    (name, value) => { shared.values.set(name, value); cache.set(name, value); writes.push(value); },
    () => shared.local, clone(defaults), version, structuredClone,
    () => ({ configured: false, requiresSelection: false, expired: false }),
    value => String(value ?? '').replace(/\s/g, ''), { warn() {} }
  );
}

test('new releases preserve an explicit disabled developer mode and custom filters', () => {
  const saved = { ...clone(defaults), developerMode: false, developerModeDebugWindowVersion: '0.8.49', developerModeDebugWindowSchema: 0, examNames: [], examNamesExtra: ['synthetic-extra'], age: { min: null, max: null, unlimited: true } };
  const shared = sharedStorage(saved);
  const upgraded = runtime(shared, '9.0.0');
  assert.equal(upgraded.config.developerMode, false);
  assert.deepEqual(upgraded.config.examNamesExtra, ['synthetic-extra']);
  assert.equal(upgraded.config.developerModeDebugWindowSchema, 2);
  const next = runtime(shared, '9.0.1');
  assert.equal(next.config.developerMode, false);
  assert.deepEqual(next.config.examNamesExtra, ['synthetic-extra']);
});

test('missing legacy developer switch is initialized once and remains user-controlled', () => {
  const saved = clone(defaults); delete saved.developerMode; delete saved.developerModeDebugWindowSchema;
  const shared = sharedStorage(saved);
  const first = runtime(shared);
  assert.equal(first.config.developerMode, true);
  first.config.developerMode = false; first.saveConfig();
  assert.equal(runtime(shared, '0.8.99').config.developerMode, false);
});

test('legacy disabled locked-report setting migrates to the mandatory hard gate', () => {
  const shared = sharedStorage({ ...clone(defaults), skipLockedRecords: false });
  assert.equal(runtime(shared).config.skipLockedRecords, true);
  assert.equal(JSON.parse(shared.values.get(key)).skipLockedRecords, true);
  assert.equal(runtime(shared, '9.0.1').config.skipLockedRecords, true);
});

test('saved config survives reload with settings, custom selectors and RegExp intact', () => {
  const shared = sharedStorage();
  const first = runtime(shared);
  Object.assign(first.config, { enabled: false, monitoringEnabled: false, developerMode: false, entryDelaySeconds: 12, allowedAccounts: ['synthetic-account'], examNamesExtra: ['synthetic-exam'], examNamesExcluded: ['synthetic-excluded'], examNamesCatalog: ['synthetic-excluded'], applicationTime: { ...first.config.applicationTime, mode: 'window', minMinutes: 5, maxMinutes: 30 }, examSeparators: /[;|]/ });
  first.config.selectors.bodyRows = 'synthetic-selector';
  first.saveConfig();
  const next = runtime(shared);
  for (const field of ['enabled', 'monitoringEnabled', 'developerMode', 'entryDelaySeconds', 'allowedAccounts', 'examNamesExtra', 'examNamesExcluded', 'examNamesCatalog', 'applicationTime', 'selectors']) assert.deepEqual(next.config[field], first.config[field]);
  assert.equal(next.config.examSeparators.source, '[;|]');
});

test('same-origin config mirror wins over a stale document GM cache', () => {
  const shared = sharedStorage(clone(defaults));
  const first = runtime(shared, '0.8.50', true);
  const stale = runtime(shared, '0.8.50', true);
  first.config.enabled = false; first.config.developerMode = false; first.saveConfig();
  const restored = stale.loadConfig();
  assert.equal(restored.enabled, false);
  assert.equal(restored.developerMode, false);
  assert.ok(shared.local.getItem(mirrorKey));
});

test('configuration remains durable if the optional mirror is unavailable', () => {
  const shared = sharedStorage(); shared.local.setItem = () => { throw new Error('quota unavailable'); };
  const first = runtime(shared); first.config.developerMode = false; first.saveConfig();
  assert.equal(runtime(shared).config.developerMode, false);
});

test('actual developer-mode change handler saves immediately without Apply', () => {
  const line = source.split('\n').find(value => value.includes("box.querySelector('[data-f=\"developerMode\"]').onchange"));
  assert.ok(line);
  const shared = sharedStorage(); const r = runtime(shared);
  const input = { checked: false }; const box = { querySelector: selector => selector.includes('data-f') ? input : null };
  new Function('box', 'config', 'f', 'saveConfig', 'developerModeStateText', 'developerLog', line)(box, r.config, () => input, r.saveConfig, () => '', () => {});
  input.onchange();
  assert.equal(runtime(shared).config.developerMode, false);
});

test('actual generic settings change handler reads and saves without closing the panel', () => {
  const start = source.indexOf("    box.addEventListener('change', event => {");
  const end = source.indexOf('\n    });', start) + '\n    });'.length;
  assert.ok(start >= 0 && end > start);
  const shared = sharedStorage(); const r = runtime(shared);
  let handler; let reads = 0;
  const box = { addEventListener(_event, value) { handler = value; } };
  new Function('box', 'read', 'saveConfig', 'scheduleAutoEntryScheduleExpiry', 'msg', source.slice(start, end))(box, () => { reads++; r.config.entryDelaySeconds = 27; }, r.saveConfig, () => {}, () => {});
  handler({ target: { matches: () => true, dataset: { f: 'entryDelaySeconds' } } });
  assert.equal(reads, 1); assert.equal(runtime(shared).config.entryDelaySeconds, 27);
  handler({ target: { matches: () => true, dataset: { f: 'profile' } } });
  assert.equal(reads, 1);
});

test('default hour and missing legacy retention migrate without changing user switches or filters', () => {
  assert.equal(defaults.developerRetentionMinutes, 60);
  const saved = { ...clone(defaults), enabled: false, developerMode: false, modalities: ['synthetic-modality'], allowedAccounts: ['synthetic-account'] };
  delete saved.developerRetentionMinutes;
  const shared = sharedStorage(saved);
  const upgraded = runtime(shared);
  assert.equal(upgraded.config.developerRetentionMinutes, 60);
  for (const field of ['enabled', 'developerMode', 'modalities', 'allowedAccounts']) assert.deepEqual(upgraded.config[field], saved[field]);
  assert.equal(JSON.parse(shared.values.get(key)).developerRetentionMinutes, 60);
});

test('custom retention normalizes to integer minutes and survives saves, reloads and new releases', () => {
  const shared = sharedStorage({ ...clone(defaults), developerRetentionMinutes: '90.9' });
  const first = runtime(shared);
  assert.equal(first.config.developerRetentionMinutes, 90);
  first.config.developerRetentionMinutes = 120; first.saveConfig();
  assert.equal(runtime(shared, '9.0.0').config.developerRetentionMinutes, 120);
  first.config.developerRetentionMinutes = 10080; first.saveConfig();
  assert.equal(runtime(shared, '9.0.1').config.developerRetentionMinutes, 10080);
});

test('invalid retention values migrate and save as the default 60 minutes', () => {
  for (const raw of [undefined, null, true, false, '', '  ', 0, -1, 10081, 'Infinity', 'invalid', {}, []]) {
    const shared = sharedStorage({ ...clone(defaults), developerRetentionMinutes: raw });
    const r = runtime(shared);
    assert.equal(r.config.developerRetentionMinutes, 60, JSON.stringify(raw));
    r.config.developerRetentionMinutes = raw; r.saveConfig();
    assert.equal(runtime(shared).config.developerRetentionMinutes, 60, JSON.stringify(raw));
  }
});

test('actual retention preset and custom change handlers save immediately without Apply', () => {
  const setStart = source.indexOf('  function setDeveloperRetentionMinutes(');
  const setEnd = source.indexOf('\n  // 页面偶尔', setStart);
  const shared = sharedStorage(); const r = runtime(shared);
  const actualSet = new Function('config', 'saveConfig', 'normalizeDeveloperRetentionMinutes', 'pruneDeveloperEvents', 'persistDeveloperEvents', 'collectDeveloperEvents', 'pruneCandidateLifecycle', 'refreshDeveloperRetentionUI', 'developerLog', `${source.slice(setStart, setEnd)} return setDeveloperRetentionMinutes;`)(r.config, r.saveConfig, r.normalizeDeveloperRetentionMinutes, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  const preset = { value: '120' }, custom = { value: '95' }, customLabel = { hidden: true };
  const f = name => name === 'developerRetentionPreset' ? preset : custom;
  const box = { querySelector: selector => selector.includes('developerRetentionCustom') ? customLabel : selector.includes('developerRetentionPreset') ? preset : custom };
  const start = source.indexOf("    box.querySelector('[data-f=\"developerRetentionPreset\"]').onchange");
  const end = source.indexOf("\n    box.querySelector('[data-a=\"copyDebug\"]')", start);
  new Function('box', 'f', 'setDeveloperRetentionMinutes', 'msg', source.slice(start, end))(box, f, actualSet, () => {});
  preset.onchange();
  assert.equal(runtime(shared).config.developerRetentionMinutes, 120);
  custom.onchange();
  assert.equal(runtime(shared).config.developerRetentionMinutes, 95);
});

test('exclusions preserve exact custom names and normalize legacy text and invalid entries on save', () => {
  const shared = sharedStorage({ ...clone(defaults), examNamesExcluded: 'synthetic-a， synthetic-b\nsynthetic-a' });
  const first = runtime(shared);
  assert.deepEqual(first.config.examNamesExcluded, ['synthetic-a', 'synthetic-b']);
  first.config.examNamesExcluded = [null, true, {}, '不限', '无排除', 'synthetic-custom', ' synthetic-custom '];
  first.saveConfig();
  assert.deepEqual(runtime(shared, '9.1.0').config.examNamesExcluded, ['synthetic-custom']);
});

test('missing exclusions remain unrestricted while preserving existing selected exams and institution filters', () => {
  const saved = { ...clone(defaults), examNames: [], examNamesExtra: ['synthetic-selected'], applyInstitution: ['synthetic-org'] };
  delete saved.examNamesExcluded;
  const shared = sharedStorage(saved); const first = runtime(shared);
  assert.deepEqual(first.config.examNamesExcluded, []);
  assert.deepEqual(first.config.examNamesExtra, ['synthetic-selected']);
  assert.deepEqual(first.config.applyInstitution, ['synthetic-org']);
  first.saveConfig(); assert.deepEqual(runtime(shared).config.examNamesExcluded, []);
});

console.log(`configuration-persistence: ${passed} scenarios passed`);
