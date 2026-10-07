// Exercises both real PowerShell entrypoints; fixtures never contact a service.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const runners = ['verify-release.ps1', 'gpt6-quick-maintenance.ps1'];
const testFiles = fs.readdirSync(path.join(root, 'tests')).filter(x => x.endsWith('.test.mjs'));
const workflow = fs.readFileSync(path.join(root, '.github/workflows/validate.yml'), 'utf8');
for (const name of testFiles) {
  assert.ok(workflow.includes(`node tests/${name}`), `CI omits ${name}`);
  for (const runner of runners) {
    assert.ok(fs.readFileSync(path.join(root, 'tools', runner), 'utf8').includes(`tests\\${name}`), `${runner} omits ${name}`);
  }
}
assert.ok(workflow.includes('windows-latest'), 'Windows failure tests must not be skipped by all CI jobs');
if (process.platform !== 'win32') {
  console.log('release-failure: runner/CI coverage passed; native failure fixtures require Windows');
  process.exit(0);
}
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-release-test-'));
try {
  fs.mkdirSync(path.join(fixture, 'tools'));
  fs.mkdirSync(path.join(fixture, 'tests'));
  for (const runner of runners) fs.copyFileSync(path.join(root, 'tools', runner), path.join(fixture, 'tools', runner));
  const sourceName = 'jiangxi-radiation-auto-diagnose.user.js';
  const validSource = '// @version 0.0.0\nvoid 0;\n';
  const reset = () => {
    fs.writeFileSync(path.join(fixture, sourceName), validSource);
    fs.writeFileSync(path.join(fixture, 'PROJECT_STATE.json'), JSON.stringify({ version: '0.0.0', tampermonkeyLoadedVersion: 'fixture only' }));
    // Includes this test itself, avoiding recursive failure-test execution.
    for (const name of testFiles) fs.writeFileSync(path.join(fixture, 'tests', name), 'process.exit(0);\n');
    fs.writeFileSync(path.join(fixture, 'tests/captcha_ocr.test.py'), 'pass\n');
    fs.writeFileSync(path.join(fixture, 'tests/runtime-verifier.test.py'), 'pass\n');
  };
  const run = (command, args, extra = {}) => spawnSync(command, args, {
    cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(fixture, 'empty-git-config') }, ...extra,
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
    ['syntax', sourceName, '// @version 0.0.0\nfunction {', 'JavaScript syntax check failed'],
    ['contract', 'tests/source-contract.test.mjs', 'process.exit(2);', 'Source contract check failed'],
    ['direct-login', 'tests/direct-login.test.mjs', 'process.exit(3);', 'Direct login tests failed'],
    ['lifecycle', 'tests/lifecycle-diagnostics.test.mjs', 'process.exit(4);', 'Lifecycle diagnostics check failed'],
    ['release-failure', 'tests/release-failure.test.mjs', 'process.exit(5);', 'Release failure tests failed'],
    ['ocr', 'tests/captcha_ocr.test.py', 'raise SystemExit(6)', 'OCR tests failed'],
    ['runtime-verifier', 'tests/runtime-verifier.test.py', 'raise SystemExit(7)', 'Runtime verifier tests failed'],
    ['diff', sourceName, validSource + '// invalid trailing whitespace   \n', 'Git diff check failed'],
  ];
  let count = 0;
  const invoke = (runner, extra = []) => run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(fixture, 'tools', runner), '-SkipOcrHealth', ...extra]);
  const rejected = (result, name, expected) => {
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `${name}: verification must fail`);
    assert.ok((result.stdout + result.stderr).includes(expected), `${name}: expected stage-specific failure`);
    assert.ok(!result.stdout.includes('source checks passed'), `${name}: no false success message`);
    assert.ok(!result.stdout.includes('"READY"'), `${name}: no false READY`);
    count++;
  };
  for (const runner of runners) {
    for (const [name, file, text, expected] of cases) {
      reset();
      fs.writeFileSync(path.join(fixture, file), text);
      rejected(invoke(runner), `${runner}/${name}`, expected);
    }
    reset();
    fs.writeFileSync(path.join(fixture, sourceName), validSource + '// staged trailing whitespace   \n');
    git('add', sourceName);
    rejected(invoke(runner), `${runner}/staged-diff`, 'Git staged diff check failed');
    reset();
    git('add', sourceName);
    fs.writeFileSync(path.join(fixture, 'uncommitted.txt'), 'fixture only');
    rejected(invoke(runner, ['-RequireClean']), `${runner}/dirty`, runner === runners[0] ? 'Publication requires a clean Git working tree' : 'working tree is not clean');
    fs.rmSync(path.join(fixture, 'uncommitted.txt'));
    fs.renameSync(path.join(fixture, '.git'), path.join(fixture, '.git-disabled'));
    try { rejected(invoke(runner), `${runner}/missing-git`, 'Git diff check failed'); }
    finally { fs.renameSync(path.join(fixture, '.git-disabled'), path.join(fixture, '.git')); }
    const success = invoke(runner, ['-RequireClean']);
    assert.ifError(success.error);
    assert.equal(success.status, 0, `${runner}/success: ${success.stderr}`);
    assert.ok(success.stdout.includes(runner === runners[0] ? 'working tree clean' : '"READY"'));
    count++;
  }
  console.log(`release-failure: passed ${count} actual PowerShell failure/success cases; CI covers every JS suite`);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
