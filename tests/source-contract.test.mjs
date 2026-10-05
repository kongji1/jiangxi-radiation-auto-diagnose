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
const quickMaintenance = fs.readFileSync(path.join(root, 'tools', 'gpt6-quick-maintenance.ps1'), 'utf8');
const quickGuide = fs.readFileSync(path.join(root, 'docs', 'GPT6_QUICK_MAINTENANCE.md'), 'utf8');

execFileSync(process.execPath, ['--check', sourcePath], { stdio: 'inherit' });

const required = [
  ['metadata version', /@version\s+0\.8\.41/],
  ['runtime version telemetry', /developerLog\('运行版本'[\s\S]+SCRIPT_VERSION/],
  ['route re-entry restart', /isMonitorRoute\(path\) && changed[\s\S]+运行时重启[\s\S]+start\(\{ preserveDiagnosisLock: true \}\)/],
  ['route re-entry preserves diagnosis lock', /start\(\{ preserveDiagnosisLock: true \}\)/],
  ['stale async gate cleanup', /listRefreshRunning = false[\s\S]+realtimeRecordRunning = false/],
  ['monitor report route', /function isMonitorRoute[\s\S]+path === '\/radiation' \|\| path === '\/radiation\/report'/],
  ['list-only page query', /function isListRoute[\s\S]+path === '\/radiation';/],
  ['report route bootstrap', /\['\/login', '\/radiation', '\/radiation\/report'\]\.includes/],
  ['direct report conservative lock', /currentUrl\.pathname === '\/radiation\/report'[\s\S]+diagnosisActive = true/],
  ['numeric status fallback', /rawStatus\)\s*\?\s*rawStatus/],
  ['diagnosing numeric lock gate', /diagnosingCode[\s\S]+statusCode[\s\S]+diagnosingCode/],
  ['report page realtime guard', /processRealtimeHint[\s\S]+isMonitorRoute/],
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
  ['TOKEN_FAIL page query fallback', /TOKEN_FAIL页面查询兜底/],
  ['recovery does not redirect', /redirected: false/],
  ['unlimited sentinel migration', /Older builds could persist[\s\S]+empty-array representation/],
  ['runtime filter snapshot', /配置门禁快照/],
  ['runtime selected filter snapshot', /encounterTypes:\s*\[\.\.\.\(config\.encounterTypes[\s\S]+modalities:\s*\[\.\.\.\(config\.modalities/],
  ['developer rolling retention', /DEBUG_RETENTION_MS = 10 \* 60 \* 1000/],
  ['full candidate debug fields', /applicationNo: d\?\.applicationNo[\s\S]+patient: d\?\.patient/],
  ['full record debug snapshot', /record: d\?\.record \|\| null/],
  ['credential presence diagnostics', /debugCredentialShape[\s\S]+authCookie[\s\S]+authorizationHeader/],
  ['credential values not logged', /原始值只在当前请求内使用/],
  ['developer event pruning', /pruneDeveloperEvents/],
  ['developer periodic cleanup', /DEBUG_CLEANUP_INTERVAL_MS = 60 \* 1000/],
  ['developer cleanup persistence', /const changed = pruneDeveloperEvents[\s\S]+persistDeveloperEvents/],
  ['developer mode upgrade migration', /developerModeDebugWindowVersion !== SCRIPT_VERSION/],
  ['direct login from radiation', /directLoginRoute = currentUrl\.pathname === '\/login' \|\| currentUrl\.pathname === '\/radiation'/],
  ['captcha OCR bridge', /recognizeCaptcha\(capJson\.data\.img\)/],
  ['captcha OCR fallback', /await recognizeCaptcha\(capJson\.data\.img\) \|\| await askCaptcha/],
  ['direct login session probe', /sessionProbe = await fetch\('\/api\/admin\/user\/info'/],
  ['case-insensitive auth cookie lookup', /function readCookie\(name\)[\s\S]+?toLowerCase\(\)[\s\S]+?item\.slice\(item\.indexOf\('\='\) \+ 1\)/],
  ['direct login auth cookie guard', /if \(readCookie\('Auth'\)\) return false/],
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

// Execute the small cookie reader against the casing used by the live page.
// This catches a regression where AUTH/LOGINCODE/WORKSTATION are present but
// the protocol path silently sees empty authentication headers.
const cookieReaderMatch = source.match(/function readCookie\(name\) \{[\s\S]*?\n  \}/);
if (!cookieReaderMatch) throw new Error('source contract failed: readCookie implementation missing');
const readCookie = new Function('document', `${cookieReaderMatch[0]}; return readCookie;`)({ cookie: 'AUTH=auth-value; LOGINCODE=3607320012067; WORKSTATION=ws-value' });
if (readCookie('Auth') !== 'auth-value' || readCookie('LoginCode') !== '3607320012067' || readCookie('WorkStation') !== 'ws-value') {
  throw new Error('source contract failed: uppercase auth cookie lookup behavior');
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
if (state.version !== '0.8.41') throw new Error(`PROJECT_STATE version mismatch: ${state.version}`);
if (state.performance?.realtimeListMinCooldownMs !== 500) throw new Error('PROJECT_STATE realtime cooldown mismatch');
if (state.performance?.developerModeDefault !== true) throw new Error('PROJECT_STATE developer mode default mismatch');
if (state.performance?.developerDebugRetentionMs !== 600000) throw new Error('PROJECT_STATE developer retention mismatch');
if (state.performance?.developerDebugFullCandidateFields !== true) throw new Error('PROJECT_STATE full debug fields mismatch');
if (state.performance?.credentialShapeDiagnostics !== true) throw new Error('PROJECT_STATE credential diagnostics mismatch');
if (state.performance?.credentialValuesPersisted !== false) throw new Error('PROJECT_STATE credential persistence boundary mismatch');
if (state.performance?.cookieNameCaseInsensitive !== true) throw new Error('PROJECT_STATE cookie case-insensitive lookup mismatch');
if (state.lastObservedRuntime?.statusProbe !== 'code=2002 repeated; auth headers absent in script context') throw new Error('PROJECT_STATE runtime evidence mismatch');
if (state.lastObservedRuntime?.entryEventsObserved !== 0) throw new Error('PROJECT_STATE runtime entry evidence mismatch');
if (!readme.includes('源码版本：`0.8.41`')) throw new Error('README version mismatch');
if (!readme.includes('127.0.0.1:18766')) throw new Error('README OCR endpoint missing');
if (!readme.includes('GPT6_MAINTENANCE.md')) throw new Error('README GPT-6 guide missing');
if (!gpt6Guide.includes('dispatchDelayMs') || !gpt6Guide.includes('diagnosisActive')) throw new Error('GPT-6 maintenance guide incomplete');
if (!/source-contract\.test\.mjs/.test(releaseTool) || !/captcha_ocr\.test\.py/.test(releaseTool)) throw new Error('release verification tool incomplete');
if (!/git ls-remote/.test(publishTool) || !/git push origin/.test(publishTool) || !/raw\.githubusercontent\.com/.test(publishTool)) throw new Error('GitHub publish tool incomplete');
if (!/node --check/.test(quickMaintenance) || !/release-failure\.test\.mjs/.test(quickMaintenance) || !/READY/.test(quickMaintenance)) throw new Error('GPT-6 quick maintenance tool incomplete');
if (!/RequireClean/.test(quickMaintenance) || !/workingTree/.test(quickMaintenance)) throw new Error('GPT-6 quick maintenance dirty mode incomplete');
if (!quickGuide.includes('五分钟') || !quickGuide.includes('配置门禁快照') || !quickGuide.includes('认证上下文')) throw new Error('GPT-6 quick maintenance guide incomplete');

console.log(`source-contract: passed ${required.length} checks; version=${state.version}`);
