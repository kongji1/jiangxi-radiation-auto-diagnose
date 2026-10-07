// Real PowerShell entrypoints and real registry runner; isolated stubs never
// contact a browser or service. A failed command must never produce READY.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const runners = ['verify-release.ps1', 'gpt6-quick-maintenance.ps1'];
const registry = JSON.parse(fs.readFileSync(path.join(root, 'tools/test-suites.json'), 'utf8'));
const discovered = fs.readdirSync(path.join(root, 'tests')).filter(x => /\.test\.(mjs|py)$/.test(x));
for (const name of discovered) assert.ok(registry.suites.some(x => x.path === `tests/${name}`), `registry omits ${name}`);
const workflow = fs.readFileSync(path.join(root, '.github/workflows/validate.yml'), 'utf8');
assert.ok(workflow.includes('python -B tools/maintain-project.py test --all'), 'CI must use the shared full registry');
assert.ok(workflow.includes('windows-latest'), 'Native failure fixtures need Windows CI');
for (const runner of runners) {
  assert.ok(fs.readFileSync(path.join(root, 'tools', runner), 'utf8').includes('invoke-local-verification.ps1'), `${runner} must delegate`);
}
if (process.platform !== 'win32') {
  console.log('release-failure: registry/CI coverage passed; native fixtures run on Windows');
  process.exit(0);
}
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-release-test-'));
const tmpRoot = path.resolve(os.tmpdir()) + path.sep;
assert.ok(path.resolve(fixture).startsWith(tmpRoot), 'fixture cleanup must stay inside the temp directory');
try {
  fs.mkdirSync(path.join(fixture, 'tools'));
  fs.mkdirSync(path.join(fixture, 'tests'));
  // The real maintenance runner persists its verified-test cache. This
  // isolated Git checkout must mirror the production ignore rule so that a
  // successful verification does not manufacture an untracked dirty file.
  fs.writeFileSync(path.join(fixture, '.gitignore'), '.runtime-maintenance/\n');
  fs.mkdirSync(path.join(fixture, 'src'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'));
  for (const file of ['src/manifest.json', ...manifest.modules.map(x => x.file)]) {
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  }
  for (const name of [...runners, 'invoke-local-verification.ps1', 'maintain-project.py', 'build-userscript.mjs', 'test-suites.json']) {
    fs.copyFileSync(path.join(root, 'tools', name), path.join(fixture, 'tools', name));
  }
  const sourceName = 'jiangxi-radiation-auto-diagnose.user.js';
  const validSource = fs.readFileSync(path.join(root, sourceName), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'src/07-candidate-rules.js'), 'utf8');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8')).version;
  const reset = () => {
    fs.writeFileSync(path.join(fixture, sourceName), validSource);
    fs.writeFileSync(path.join(fixture, 'src/07-candidate-rules.js'), rules);
    fs.writeFileSync(path.join(fixture, 'PROJECT_STATE.json'), JSON.stringify({ version, tampermonkeyLoadedVersion: 'historical fixture only' }));
    fs.writeFileSync(path.join(fixture, 'notes.md'), 'fixture\n');
    for (const suite of registry.suites) {
      fs.mkdirSync(path.dirname(path.join(fixture, suite.path)), { recursive: true });
      fs.writeFileSync(path.join(fixture, suite.path), suite.runner === 'node' ? 'process.exit(0);\n' : 'pass\n');
    }
  };
  const run = (command, args) => spawnSync(command, args, {
    cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 90000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(fixture, 'empty-git-config') },
  });
  const git = (...args) => {
    const result = run('git', args);
    assert.ifError(result.error);
    assert.equal(result.status, 0, `fixture git failed: ${result.stderr}`);
  };
  reset();
  git('init', '--quiet');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'core.autocrlf', 'false');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'isolated release fixture');
  const cases = [
    ['artifact-drift', sourceName, validSource + '\n// fixture drift\n', 'build-userscript.mjs'],
    ['module-syntax', 'src/07-candidate-rules.js', rules + '\nfunction {', 'build-userscript.mjs'],
    ['contract', 'tests/source-contract.test.mjs', 'process.exit(2);', 'source-contract'],
    ['direct-login', 'tests/direct-login.test.mjs', 'process.exit(3);', 'direct-login'],
    ['lifecycle', 'tests/lifecycle-diagnostics.test.mjs', 'process.exit(4);', 'lifecycle'],
    ['ocr', 'tests/captcha_ocr.test.py', 'raise SystemExit(6)', 'captcha-ocr'],
    ['runtime-verifier', 'tests/runtime-verifier.test.py', 'raise SystemExit(7)', 'runtime-verifier'],
    ['diff', 'notes.md', 'fixture   \n', 'diff'],
  ];
  let count = 0;
  const invoke = (runner, extra = []) => run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(fixture, 'tools', runner), '-SkipOcrHealth', ...extra]);
  const rejected = (result, name, expected) => {
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `${name}: verification must fail`);
    assert.ok((result.stdout + result.stderr).includes(expected), `${name}: missing failed stage ${expected}`);
    assert.ok(!result.stdout.includes('"READY"'), `${name}: no false READY`);
    count++;
  };
  for (const runner of runners) {
    for (const [name, file, body, expected] of cases) {
      reset();
      fs.writeFileSync(path.join(fixture, file), body);
      rejected(invoke(runner), `${runner}/${name}`, expected);
    }
    reset();
    fs.writeFileSync(path.join(fixture, 'notes.md'), 'staged whitespace   \n');
    git('add', 'notes.md');
    fs.writeFileSync(path.join(fixture, 'notes.md'), 'fixture\n');
    rejected(invoke(runner), `${runner}/staged-diff`, 'diff');
    git('add', 'notes.md');
    reset();
    fs.writeFileSync(path.join(fixture, 'uncommitted.txt'), 'fixture only');
    rejected(invoke(runner, ['-RequireClean']), `${runner}/dirty`, runner === runners[0] ? 'Publication requires a clean Git working tree' : 'working tree is not clean');
    fs.rmSync(path.join(fixture, 'uncommitted.txt'));
    fs.renameSync(path.join(fixture, '.git'), path.join(fixture, '.git-disabled'));
    try { rejected(invoke(runner), `${runner}/missing-git`, 'diff'); }
    finally { fs.renameSync(path.join(fixture, '.git-disabled'), path.join(fixture, '.git')); }
    const success = invoke(runner, ['-RequireClean']);
    assert.ifError(success.error);
    assert.equal(success.status, 0, `${runner}/success: ${success.stdout}\n${success.stderr}`);
    assert.ok(success.stdout.includes('"READY"'));
    assert.ok(success.stdout.includes('LOCAL_VERIFIED'));
    assert.ok(success.stdout.includes('not performed by local regression'));
    count++;
  }
  console.log(`release-failure: passed ${count} actual PowerShell failure/success cases; one registry covers CI and local tests`);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
