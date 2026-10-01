import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'jiangxi-radiation-auto-diagnose.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const gpt6Guide = fs.readFileSync(path.join(root, 'docs', 'GPT6_MAINTENANCE.md'), 'utf8');
const updateTool = fs.readFileSync(path.join(root, 'tools', 'configure-github-hot-update.ps1'), 'utf8');
const releaseTool = fs.readFileSync(path.join(root, 'tools', 'verify-release.ps1'), 'utf8');
const publishTool = fs.readFileSync(path.join(root, 'tools', 'publish-github.ps1'), 'utf8');

execFileSync(process.execPath, ['--check', sourcePath], { stdio: 'inherit' });

const required = [
  ['metadata version', /@version\s+0\.8\.34/],
  ['login route', /\/api\/admin\/userLogin\/login/],
  ['read-only status probe', /\/api\/ct\/rays\/rep\/statusNum/],
  ['unfiltered status probe fallback', /radiationListPayload\(\{ pageSize: 1, ignoreStatusFilter: true, ignoreModalityFilter: true, ignoreInstitutionFilter: true, ignoreBodyPartFilter: true \}\)/],
  ['client-side list fallback', /列表筛选退回客户端过滤/],
  ['unfiltered list fallback', /match: null, pageSize: 100, ignoreStatusFilter: true/],
  ['realtime server status gate', /__realtimeNeedsServerStatus/],
  ['realtime subsecond dispatch window', /const minGap = 250/],
  ['single active diagnosis guard', /diagnosisActive/],
  ['realtime dispatch timing telemetry', /实时列表请求发起/],
  ['one second dispatch assertion', /withinOneSecond/],
  ['read-only entry assertion', /assertAllowEnter/],
  ['strict pending gate', /pendingCode/],
  ['locked-record gate', /recordLockState/],
  ['age-unlimited setting', /ageUnlimited/],
  ['exam weights', /examWeights/],
  ['institution weights', /institutionWeights/],
  ['body-part filter', /bodyParts/],
  ['hospital filter', /checkHospitals/],
  ['diagnosis-doctor filter', /diagnosisDoctors/],
  ['audit-time filter', /auditTime/],
  ['dynamic option catalog', /columnOptionsCatalog/],
  ['hot-update runtime probe', /checkUpdateSource/],
  ['raw update host permission', /@connect\s+raw\.githubusercontent\.com/],
  ['hot-update version comparison', /updateSource\.version === SCRIPT_VERSION/],
  ['conclusion-only priority', /hasPreliminaryConclusion/],
  ['selector self-healing', /queryBodyRows/],
  ['interactive self-check', /runSelfCheck/],
  ['TOKEN_FAIL recovery', /__tokenRecoveryRetry/],
  ['TOKEN_FAIL recovery cooldown', /tokenRecoveryLastAt.*15000/],
  ['in-page token recovery', /会话自愈保持当前页/],
  ['recovery does not redirect', /redirected: false/],
  ['direct login from radiation', /directLoginRoute = currentUrl\.pathname === '\/login' \|\| currentUrl\.pathname === '\/radiation'/],
  ['captcha OCR bridge', /recognizeCaptcha\(capJson\.data\.img\)/],
  ['captcha OCR fallback', /await recognizeCaptcha\(capJson\.data\.img\) \|\| await askCaptcha/],
  ['direct login session probe', /sessionProbe = await fetch\('\/api\/admin\/user\/info'/],
  ['probe before password prompt', /sessionProbe\.ok && sessionPayload\?\.code === 200 && sessionPayload\.data[\s\S]+?directPassword = window\.prompt/],
  ['active app shell login guard', /hasAuthenticatedAppShell\(\)[\s\S]+?跳过协议登录提示/],
  ['no password persistence', /directPassword = ''/],
  ['radiation route guard', /pathname !== '\/radiation'/],
  ['route cleanup', /stopRuntime\('route-exit'\)/],
  ['narrow header settings binding', /\.el-table__header-wrapper/]
];

const missing = required.filter(([, pattern]) => !pattern.test(source));
if (missing.length) {
  throw new Error(`source contract failed: ${missing.map(([name]) => name).join(', ')}`);
}

// diagnosisActive is an entry mutex only. Monitoring and list refresh must keep
// running while a report page still exposes the pending list on the right.
for (const functionName of ['refreshRemoteCandidates', 'probeStatus', 'queueRealtimeRefresh', 'processRealtimeHint', 'scan']) {
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) throw new Error(`source contract failed: missing ${functionName}`);
  const next = source.indexOf('\n  function ', start + 10);
  const body = source.slice(start, next < 0 ? source.length : next);
  if (/diagnosisActive\s*\|\|/.test(body)) {
    throw new Error(`source contract failed: diagnosis lock still blocks ${functionName}`);
  }
}
if (!/已有客户处于诊断中，仅继续观察列表/.test(source) || !/仅保留列表刷新/.test(source)) {
  throw new Error('source contract failed: entry-only diagnosis lock telemetry missing');
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
if (state.version !== '0.8.34') throw new Error(`PROJECT_STATE version mismatch: ${state.version}`);
if (state.performance?.realtimeListMinCooldownMs !== 500) throw new Error('PROJECT_STATE realtime cooldown mismatch');
if (!readme.includes('源码版本：`0.8.34`')) throw new Error('README version mismatch');
if (!readme.includes('127.0.0.1:18766')) throw new Error('README OCR endpoint missing');
if (!readme.includes('GPT6_MAINTENANCE.md')) throw new Error('README GPT-6 guide missing');
if (!gpt6Guide.includes('dispatchDelayMs') || !gpt6Guide.includes('diagnosisActive')) throw new Error('GPT-6 maintenance guide incomplete');
if (!/source-contract\.test\.mjs/.test(releaseTool) || !/captcha_ocr\.test\.py/.test(releaseTool)) throw new Error('release verification tool incomplete');
if (!/git ls-remote/.test(publishTool) || !/git push origin/.test(publishTool) || !/raw\.githubusercontent\.com/.test(publishTool)) throw new Error('GitHub publish tool incomplete');

console.log(`source-contract: passed ${required.length} checks; version=${state.version}`);
