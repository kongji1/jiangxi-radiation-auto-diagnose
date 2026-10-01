import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'jiangxi-radiation-auto-diagnose.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const updateTool = fs.readFileSync(path.join(root, 'tools', 'configure-github-hot-update.ps1'), 'utf8');

execFileSync(process.execPath, ['--check', sourcePath], { stdio: 'inherit' });

const required = [
  ['metadata version', /@version\s+0\.8\.21/],
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
  ['in-page token recovery', /会话自愈保持当前页/],
  ['recovery does not redirect', /redirected: false/],
  ['direct login from radiation', /directLoginRoute = currentUrl\.pathname === '\/login' \|\| currentUrl\.pathname === '\/radiation'/],
  ['captcha OCR bridge', /recognizeCaptcha\(capJson\.data\.img\)/],
  ['captcha OCR fallback', /await recognizeCaptcha\(capJson\.data\.img\) \|\| await askCaptcha/],
  ['no password persistence', /directPassword = ''/],
  ['radiation route guard', /pathname !== '\/radiation'/],
  ['route cleanup', /stopRuntime\('route-exit'\)/],
  ['narrow header settings binding', /\.el-table__header-wrapper/]
];

const missing = required.filter(([, pattern]) => !pattern.test(source));
if (missing.length) {
  throw new Error(`source contract failed: ${missing.map(([name]) => name).join(', ')}`);
}

if (/password\s*[:=]\s*['"][^'"]+['"]/.test(source)) {
  throw new Error('source contract failed: possible plaintext password literal');
}
if (!/raw\.githubusercontent\.com/.test(updateTool)) throw new Error('GitHub update tool missing raw URL');
const hotUpdateHelper = fs.readFileSync(path.join(root, 'tools', 'configure-github-hot-update.mjs'), 'utf8');
if (!/readFileSync\(sourcePath, 'utf8'\)/.test(hotUpdateHelper) || !/writeFileSync\(sourcePath, source/.test(hotUpdateHelper)) {
  throw new Error('GitHub hot-update helper must use explicit UTF-8 Node I/O');
}
const ocrServer = fs.readFileSync(path.join(root, 'tools', 'captcha_ocr_server.py'), 'utf8');
if (!/def captcha_answer/.test(ocrServer) || !/fullmatch/.test(ocrServer) || !/127\.0\.0\.1/.test(ocrServer)) {
  throw new Error('CAPTCHA OCR bridge must safely evaluate arithmetic challenges on loopback only');
}

const state = JSON.parse(fs.readFileSync(path.join(root, 'PROJECT_STATE.json'), 'utf8'));
if (state.version !== '0.8.21') throw new Error(`PROJECT_STATE version mismatch: ${state.version}`);

console.log(`source-contract: passed ${required.length} checks; version=${state.version}`);
