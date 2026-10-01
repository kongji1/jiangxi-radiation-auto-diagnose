// Exercises actual Windows PowerShell native-process failures in isolated fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
if (process.platform !== 'win32') {
  console.log('release-failure: Windows PowerShell required; skipped');
  process.exit(0);
}
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-release-test-'));
try {
  fs.mkdirSync(path.join(fixture, 'tools'));
  fs.mkdirSync(path.join(fixture, 'tests'));
  fs.copyFileSync(path.join(root, 'tools/verify-release.ps1'), path.join(fixture, 'tools/verify-release.ps1'));
  const cases = [
    ['syntax', 'function {', 'process.exit(0)', 'pass', 'JavaScript syntax check failed'],
    ['contract', 'void 0;', 'process.exit(2)', 'pass', 'Source contract check failed'],
    ['ocr', 'void 0;', 'process.exit(0)', 'raise SystemExit(3)', 'OCR tests failed'],
  ];
  for (const [name, source, contract, python, expected] of cases) {
    fs.writeFileSync(path.join(fixture, 'jiangxi-radiation-auto-diagnose.user.js'), source);
    fs.writeFileSync(path.join(fixture, 'tests/source-contract.test.mjs'), contract);
    fs.writeFileSync(path.join(fixture, 'tests/captcha_ocr.test.py'), python);
    const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(fixture, 'tools/verify-release.ps1'), '-SkipOcrHealth'], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `${name}: verification must fail`);
    assert.ok((result.stdout + result.stderr).includes(expected), `${name}: expected stage-specific failure`);
    assert.ok(!result.stdout.includes('source checks passed'), `${name}: no false success message`);
  }
  console.log('release-failure: passed 3 native-process failure cases');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
