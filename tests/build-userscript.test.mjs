import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildUserscript, normalizeLF, validateManifest } from '../tools/build-userscript.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const builder = path.join(projectRoot, 'tools/build-userscript.mjs');
const outputName = 'jiangxi-radiation-auto-diagnose.user.js';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jx-build-test-'));
const fixture = path.join(sandbox, '项目 with spaces');
const sourceDirectory = path.join(fixture, 'src');
const metadata = '// ==UserScript==\n// @name Fixture\n// @version 1.2.3\n// ==/UserScript==\n\n(function () {\n  \'use strict\';\n  const SCRIPT_VERSION = \'1.2.3\';\n';
const body = '  let count = 0;\n  function step() { count += 1; }\n  step();\n';
const footer = '})();\n';
const expected = metadata + body + footer;
let count = 0;
function check(name, fn) { fn(); count++; }
function manifest() {
  return { schemaVersion: 1, version: '1.2.3', output: outputName, modules: [
    { id: 'header', file: 'src/header.js', order: 0 },
    { id: 'body', file: 'src/body.js', order: 1, description: 'Fixture state and functions' },
    { id: 'footer', file: 'src/footer.js', order: 2 },
  ] };
}
function writeManifest(value = manifest()) { fs.writeFileSync(path.join(sourceDirectory, 'manifest.json'), JSON.stringify(value)); }
function writeTemplate() {
  writeManifest({ ...manifest(), versionToken: '{{SCRIPT_VERSION}}' });
  fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace('@version 1.2.3', '@version {{SCRIPT_VERSION}}').replace("SCRIPT_VERSION = '1.2.3'", "SCRIPT_VERSION = '{{SCRIPT_VERSION}}'"));
}
function removeFixtureTarget(target) {
  const resolved = path.resolve(target), relative = path.relative(sandbox, resolved);
  assert.ok(resolved === sandbox || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)));
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    try { fs.unlinkSync(resolved); }
    catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM') throw error; fs.rmdirSync(resolved); }
  } else if (stat.isDirectory()) {
    for (const name of fs.readdirSync(resolved)) removeFixtureTarget(path.join(resolved, name));
    fs.rmdirSync(resolved);
  } else fs.unlinkSync(resolved);
}
function reset() {
  fs.mkdirSync(sourceDirectory, { recursive: true });
  for (const name of fs.readdirSync(sourceDirectory)) removeFixtureTarget(path.join(sourceDirectory, name));
  assert.deepEqual(fs.readdirSync(sourceDirectory), [], 'fixture cleanup must remove old linked sources');
  writeManifest();
  fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata);
  fs.writeFileSync(path.join(sourceDirectory, 'body.js'), body);
  fs.writeFileSync(path.join(sourceDirectory, 'footer.js'), footer);
  const output = path.join(fixture, outputName);
  if (fs.existsSync(output)) removeFixtureTarget(output);
  fs.writeFileSync(output, expected);
}
function rejects(change, message, mode = 'check') {
  reset(); change();
  const output = path.join(fixture, outputName);
  const before = fs.existsSync(output) ? fs.readFileSync(output) : null;
  assert.throws(() => buildUserscript({ root: fixture, mode }), message);
  if (before) assert.deepEqual(fs.readFileSync(output), before, 'a failed build must not alter the existing output');
}
function run(args) { return spawnSync(process.execPath, [builder, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true }); }

try {
  reset();
  check('ordered exact assembly', () => {
    const result = buildUserscript({ root: fixture, mode: 'check' });
    assert.equal(result.inSync, true);
    assert.equal(result.moduleCount, 3);
    assert.equal(result.written, false);
    assert.equal(fs.readFileSync(path.join(fixture, outputName), 'utf8'), expected);
  });
  check('newline normalization adds no separators', () => {
    fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replaceAll('\n', '\r\n'));
    fs.writeFileSync(path.join(sourceDirectory, 'body.js'), body.replaceAll('\n', '\r'));
    fs.writeFileSync(path.join(fixture, outputName), expected.replaceAll('\n', '\r\n'));
    assert.equal(buildUserscript({ root: fixture }).inSync, true);
    const modulesBefore = fs.readFileSync(path.join(sourceDirectory, 'header.js'));
    assert.equal(buildUserscript({ root: fixture, mode: 'write' }).written, true);
    assert.equal(fs.readFileSync(path.join(fixture, outputName), 'utf8'), expected);
    assert.deepEqual(fs.readFileSync(path.join(sourceDirectory, 'header.js')), modulesBefore, '--write must never backfill source from output');
  });
  check('stable repeated write', () => {
    const first = buildUserscript({ root: fixture, mode: 'write' });
    const second = buildUserscript({ root: fixture, mode: 'write' });
    assert.equal(first.sha256, second.sha256);
    assert.equal(second.written, false);
  });
  check('source edits produce exact generated bytes', () => {
    const changed = body.replace('count += 1', 'count += 2');
    fs.writeFileSync(path.join(sourceDirectory, 'body.js'), changed);
    assert.throws(() => buildUserscript({ root: fixture }), /out of sync/);
    const result = buildUserscript({ root: fixture, mode: 'write' });
    assert.equal(result.written, true);
    assert.equal(fs.readFileSync(path.join(fixture, outputName), 'utf8'), metadata + changed + footer);
  });
  check('manual output edits are detected without source overwrite', () => rejects(() => fs.appendFileSync(path.join(fixture, outputName), '// hand edited\n'), /out of sync/));
  check('missing output check rejects, explicit write creates', () => {
    reset(); fs.unlinkSync(path.join(fixture, outputName));
    assert.throws(() => buildUserscript({ root: fixture }), /out of sync/);
    assert.equal(buildUserscript({ root: fixture, mode: 'write' }).written, true);
    assert.equal(fs.readFileSync(path.join(fixture, outputName), 'utf8'), expected);
  });
  check('missing module fails before writing', () => rejects(() => fs.unlinkSync(path.join(sourceDirectory, 'body.js')), /missing source file/, 'write'));
  check('empty module rejected', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'body.js'), ''), /is empty/, 'write'));
  check('manifest JSON errors reject', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'manifest.json'), '{'), /invalid src\/manifest.json/));
  check('manifest schema errors reject', () => {
    assert.throws(() => validateManifest([]), /must be an object/);
    assert.throws(() => validateManifest({ ...manifest(), schemaVersion: 2 }), /schemaVersion/);
    assert.throws(() => validateManifest({ ...manifest(), versions: '1.2.3' }), /unknown key/);
    assert.throws(() => validateManifest({ ...manifest(), version: 'latest' }), /major.minor.patch/);
    assert.throws(() => validateManifest({ ...manifest(), modules: [] }), /at least two/);
    assert.throws(() => validateManifest({ ...manifest(), modules: [null, null] }), /module 0/);
  });
  check('missing order rejected', () => rejects(() => { const value = manifest(); delete value.modules[1].order; writeManifest(value); }, /order must be 1/));
  check('gapped order rejected', () => rejects(() => { const value = manifest(); value.modules[1].order = 5; writeManifest(value); }, /order must be 1/));
  check('implicit reordered modules rejected', () => rejects(() => { const value = manifest(); value.modules.reverse(); writeManifest(value); }, /order must be 0/));
  check('duplicate module id rejected', () => rejects(() => { const value = manifest(); value.modules[1].id = 'header'; writeManifest(value); }, /duplicate module id/));
  check('duplicate portable module path rejected', () => rejects(() => { const value = manifest(); value.modules[1].file = 'src/HEADER.js'; writeManifest(value); }, /duplicate module file/));
  check('relative traversal rejected', () => rejects(() => { const value = manifest(); value.modules[1].file = 'src/../outside.js'; writeManifest(value); }, /unsafe path segment/, 'write'));
  check('Windows and POSIX absolute paths rejected on every platform', () => {
    for (const file of ['C:/outside.js', 'C:\\outside.js', '/outside.js', '\\\\server\\share\\outside.js', 'src/C:/outside.js', 'src\\body.js']) {
      const value = manifest(); value.modules[1].file = file;
      assert.throws(() => validateManifest(value), /relative src/);
    }
  });
  check('empty and dot path segments rejected', () => {
    for (const file of ['src//body.js', 'src/./body.js']) {
      const value = manifest(); value.modules[1].file = file;
      assert.throws(() => validateManifest(value), /unsafe path segment/);
    }
  });
  check('arbitrary output rejected before write', () => rejects(() => writeManifest({ ...manifest(), output: '../outside.js' }), /output must be/, 'write'));
  check('module metadata typos rejected', () => {
    const value = manifest(); value.modules[1].path = value.modules[1].file;
    assert.throws(() => validateManifest(value), /unknown key/);
    value.modules[1] = { id: 'Body', file: 'src/body.js', order: 1 };
    assert.throws(() => validateManifest(value), /lower-case slug/);
  });
  check('metadata mismatch rejected', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace('@version 1.2.3', '@version 9.9.9')), /version mismatch|mismatch/, 'write'));
  check('runtime mismatch rejected', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace("SCRIPT_VERSION = '1.2.3'", "SCRIPT_VERSION = '9.9.9'")), /mismatch/, 'write'));
  check('manifest mismatch rejected', () => rejects(() => writeManifest({ ...manifest(), version: '9.9.9' }), /mismatch/, 'write'));
  check('duplicate metadata rejected', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace('// @version 1.2.3', '// @version 1.2.3\n// @version 1.2.3')), /exactly one @version/));
  check('duplicate header rejected', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'body.js'), '// ==UserScript==\n// ==/UserScript==\n' + body), /exactly one complete/));
  check('missing header boundary rejected', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace('// ==/UserScript==\n', '')), /complete userscript header/));
  check('wrapper removal rejected', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace("  'use strict';", '')), /strict IIFE/));
  check('commented version cannot pretend to be the runtime declaration', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace("  const SCRIPT_VERSION = '1.2.3';", "  /*\n  const SCRIPT_VERSION = '1.2.3';\n  */")), /first declaration/));
  check('syntax error rejects before write', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'body.js'), '  function {\n'), /syntax is invalid/, 'write'));
  check('invalid UTF-8 rejected', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'body.js'), Buffer.from([0xc3, 0x28])), /UTF-8/));
  check('BOM cannot silently alter header', () => rejects(() => fs.writeFileSync(path.join(sourceDirectory, 'header.js'), '\uFEFF' + metadata), /must start/));
  check('hardlink duplicate source rejected', () => rejects(() => { fs.unlinkSync(path.join(sourceDirectory, 'body.js')); fs.linkSync(path.join(sourceDirectory, 'header.js'), path.join(sourceDirectory, 'body.js')); }, /duplicate physical source file/));
  check('hardlink output cannot mutate another file', () => {
    reset(); const output = path.join(fixture, outputName), outside = path.join(sandbox, 'outside-hardlink.js');
    fs.writeFileSync(outside, expected); fs.unlinkSync(output); fs.linkSync(outside, output);
    assert.throws(() => buildUserscript({ root: fixture, mode: 'write' }), /non-linked/);
    assert.equal(fs.readFileSync(outside, 'utf8'), expected);
  });
  check('source junction cannot escape project', () => {
    reset(); const nested = path.join(sourceDirectory, 'linked'), outside = path.join(sandbox, 'external-src');
    fs.mkdirSync(outside, { recursive: true }); fs.writeFileSync(path.join(outside, 'body.js'), body);
    fs.symlinkSync(outside, nested, process.platform === 'win32' ? 'junction' : 'dir');
    const value = manifest(); value.modules[1].file = 'src/linked/body.js'; writeManifest(value);
    assert.throws(() => buildUserscript({ root: fixture, mode: 'write' }), /source link escapes/);
    assert.equal(fs.readFileSync(path.join(outside, 'body.js'), 'utf8'), body);
  });
  check('CLI root supports spaces and Unicode', () => {
    reset(); const result = run(['--check', '--root', fixture]);
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).version, '1.2.3');
  });
  check('CLI validates requested operation', () => {
    for (const args of [[], ['--check', '--write'], ['--root'], ['--check', '--root', '--write'], ['--delete'], ['--check', '--root', fixture, '--root', fixture]]) {
      const result = run(args); assert.ifError(result.error); assert.notEqual(result.status, 0, JSON.stringify(args));
    }
    const result = run(['--help']); assert.equal(result.status, 0); assert.ok(result.stdout.includes('src/manifest.json'));
  });
  check('two permitted templates render without changing source bytes', () => {
    reset(); writeTemplate();
    const originalTemplate = fs.readFileSync(path.join(sourceDirectory, 'header.js'));
    assert.equal(buildUserscript({ root: fixture }).inSync, true);
    assert.equal(buildUserscript({ root: fixture, mode: 'write' }).written, false);
    assert.equal(fs.readFileSync(path.join(fixture, outputName), 'utf8'), expected);
    assert.deepEqual(fs.readFileSync(path.join(sourceDirectory, 'header.js')), originalTemplate);
  });
  check('manifest alone owns both generated version values', () => {
    reset(); writeTemplate(); writeManifest({ ...manifest(), version: '2.0.0', versionToken: '{{SCRIPT_VERSION}}' });
    assert.throws(() => buildUserscript({ root: fixture }), /out of sync/);
    assert.equal(buildUserscript({ root: fixture, mode: 'write' }).written, true);
    assert.equal(fs.readFileSync(path.join(fixture, outputName), 'utf8'), expected.replaceAll('1.2.3', '2.0.0'));
  });
  check('undeclared template rejected', () => rejects(() => { writeTemplate(); writeManifest(); }, /requires manifest.versionToken/, 'write'));
  check('missing template rejected', () => rejects(() => { writeTemplate(); fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace('@version 1.2.3', '@version {{SCRIPT_VERSION}}')); }, /occur exactly twice/, 'write'));
  check('extra template rejected', () => rejects(() => { writeTemplate(); fs.appendFileSync(path.join(sourceDirectory, 'body.js'), "  const arbitrary = '{{SCRIPT_VERSION}}';\n"); }, /occur exactly twice/, 'write'));
  check('business-string template cannot be substituted', () => rejects(() => {
    writeTemplate(); fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace('@version 1.2.3', '@version {{SCRIPT_VERSION}}'));
    fs.appendFileSync(path.join(sourceDirectory, 'body.js'), "  const arbitrary = '{{SCRIPT_VERSION}}';\n");
  }, /permitted only/, 'write'));
  check('metadata template outside header rejected', () => rejects(() => {
    writeTemplate(); fs.writeFileSync(path.join(sourceDirectory, 'header.js'), metadata.replace("SCRIPT_VERSION = '1.2.3'", "SCRIPT_VERSION = '{{SCRIPT_VERSION}}'"));
    fs.appendFileSync(path.join(sourceDirectory, 'body.js'), '// @version {{SCRIPT_VERSION}}\n');
  }, /permitted only/, 'write'));
  check('template embedded in extra statements rejected', () => rejects(() => {
    writeTemplate(); const value = fs.readFileSync(path.join(sourceDirectory, 'header.js'), 'utf8');
    fs.writeFileSync(path.join(sourceDirectory, 'header.js'), value.replace("'{{SCRIPT_VERSION}}';", "'{{SCRIPT_VERSION}}'; count = 3;"));
  }, /permitted only/, 'write'));
  check('custom tokens and injected versions rejected by schema', () => {
    for (const token of ['%%VERSION%%', '', false, null]) assert.throws(() => validateManifest({ ...manifest(), versionToken: token }), /versionToken must be/);
    for (const version of ["1.2.3'; throw 1; '", '1.2.3\n', '1.2', 123]) assert.throws(() => validateManifest({ ...manifest(), version, versionToken: '{{SCRIPT_VERSION}}' }), /major.minor.patch/);
  });
  check('production modules equal generated source', () => {
    const result = buildUserscript({ root: projectRoot, mode: 'check' });
    assert.equal(result.inSync, true);
    assert.ok(result.moduleCount > 1);
    const raw = fs.readFileSync(path.join(projectRoot, outputName), 'utf8');
    assert.ok(normalizeLF(raw).startsWith('// ==UserScript==\n'));
  });
  console.log(`build-userscript: ${count} tests passed`);
} finally {
  // Only this freshly created, resolved fixture tree is removed.
  const resolved = path.resolve(sandbox);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('jx-build-test-'));
  removeFixtureTarget(resolved);
}
