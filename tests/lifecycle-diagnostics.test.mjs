import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const source = fs.readFileSync(new URL('jiangxi-radiation-auto-diagnose.user.js', root), 'utf8');
const start = source.indexOf('  function lifecycleKey');
const end = source.indexOf('  async function processRemoteRecords', start);
if (start < 0 || end < 0) throw new Error('lifecycle helper block missing');

const candidateLifecycle = new Map();
const events = [];
const norm = value => String(value ?? '').trim();
const helpers = new Function(
  'candidateLifecycle', 'developerRetentionMs', 'config', 'norm', 'dataKeys', 'debugTag',
  'lockedRecordDetected', 'matchFailureReasons', 'shouldSkipLocked', 'debugCandidate',
  'developerLog', 'recordData',
  `${source.slice(start, end)}; return { observeCandidateLifecycle, reconcileCandidateSnapshot };`
)(
  candidateLifecycle,
  () => 3600000,
  { seenLimit: 500 },
  norm,
  data => [data?.key].filter(Boolean),
  data => data?.key || '',
  data => !!data?.locked,
  data => data?.locked ? ['报告已锁定/占用'] : [],
  data => !!data?.locked,
  (data, extra = {}) => ({ key: data?.key, status: data?.status, ...extra }),
  (event, detail) => events.push({ event, detail }),
  record => record
);

const eligible = {
  key: 'rep:diagnostic-test-1',
  record: { repUid: 'diagnostic-test-1' },
  status: '待诊断',
  statusCode: '102501',
  locked: false
};
helpers.observeCandidateLifecycle(eligible, 'remote-list', { eligible: true, failedRules: [] });

const occupied = {
  ...eligible,
  status: '诊断中',
  statusCode: '102502',
  locked: true,
  doctor: '其他用户'
};
helpers.observeCandidateLifecycle(occupied, 'remote-list', {
  eligible: false,
  failedRules: ['报告已锁定/占用']
});
helpers.reconcileCandidateSnapshot([], 'remote-list', 2, { complete: true });

const eventNames = events.map(item => item.event);
if (!eventNames.includes('候选首次观察')) throw new Error('initial lifecycle event missing');
if (!eventNames.includes('候选被其他用户占用')) throw new Error('takeover lifecycle event missing');
if (!eventNames.includes('候选未在后续列表出现')) throw new Error('disappearance lifecycle event missing');
const takeover = events.find(item => item.event === '候选被其他用户占用');
if (takeover?.detail?.current?.lifecycle?.lifecycleKey !== 'rep:diagnostic-test-1') {
  throw new Error('takeover lifecycle key correlation missing');
}

console.log('lifecycle-diagnostics: passed takeover, disappearance, and lifecycle-key correlation');
