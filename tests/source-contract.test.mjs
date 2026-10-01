import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'jiangxi-radiation-auto-diagnose.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const updateTool = fs.readFileSync(path.join(root, 'tools', 'configure-github-hot-update.ps1'), 'utf8');

execFileSync(process.execPath, ['--check', sourcePath], { stdio: 'inherit' });

const required = [
  ['metadata version', /@version\s+0\.8\.18/],
  ['login route', /\/api\/admin\/userLogin\/login/],
  ['read-only status probe', /\/api\/ct\/rays\/rep\/statusNum/],
  ['read-only entry assertion', /assertAllowEnter/],
  ['strict pending gate', /pendingCode/],
  ['locked-record gate', /recordLockState/],
  ['age-unlimited setting', /ageUnlimited/],
  ['exam weights', /examWeights/],
  ['institution weights', /institutionWeights/],
  ['conclusion-only priority', /hasPreliminaryConclusion/],
  ['selector self-healing', /queryBodyRows/],
  ['interactive self-check', /runSelfCheck/],
  ['TOKEN_FAIL recovery', /__tokenRecoveryRetry/],
  ['automatic re-auth navigation', /会话自愈调度/],
  ['no password persistence', /directPassword = ''/]
];

const missing = required.filter(([, pattern]) => !pattern.test(source));
if (missing.length) {
  throw new Error(`source contract failed: ${missing.map(([name]) => name).join(', ')}`);
}

if (/password\s*[:=]\s*['"][^'"]+['"]/.test(source)) {
  throw new Error('source contract failed: possible plaintext password literal');
}
if (!/raw\.githubusercontent\.com/.test(updateTool)) throw new Error('GitHub update tool missing raw URL');

const state = JSON.parse(fs.readFileSync(path.join(root, 'PROJECT_STATE.json'), 'utf8'));
if (state.version !== '0.8.18') throw new Error(`PROJECT_STATE version mismatch: ${state.version}`);

console.log(`source-contract: passed ${required.length} checks; version=${state.version}`);
