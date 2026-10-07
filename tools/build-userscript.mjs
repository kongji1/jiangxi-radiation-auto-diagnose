import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const OUTPUT_NAME = 'jiangxi-radiation-auto-diagnose.user.js';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const VERSION_TOKEN = '{{SCRIPT_VERSION}}';
const MANIFEST_KEYS = new Set(['schemaVersion', 'version', 'versionToken', 'output', 'modules']);
const MODULE_KEYS = new Set(['id', 'file', 'order', 'description']);

function fail(message) { throw new Error(`userscript build: ${message}`); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function contained(base, target) {
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
function requireKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} contains unknown key ${key}`);
}
function readUtf8(file) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file)); }
  catch (error) { fail(`cannot read UTF-8 file ${path.basename(file)}: ${error.code || error.message}`); }
}
export function normalizeLF(value) { return value.replace(/\r\n?/g, '\n'); }

export function validateManifest(manifest) {
  if (!isObject(manifest)) fail('manifest must be an object');
  requireKeys(manifest, MANIFEST_KEYS, 'manifest');
  if (manifest.schemaVersion !== 1) fail('manifest schemaVersion must be 1');
  if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) fail('manifest version must be numeric major.minor.patch');
  if (manifest.versionToken !== undefined && manifest.versionToken !== VERSION_TOKEN) fail(`manifest versionToken must be ${VERSION_TOKEN}`);
  if (manifest.output !== OUTPUT_NAME) fail(`manifest output must be ${OUTPUT_NAME}`);
  if (!Array.isArray(manifest.modules) || manifest.modules.length < 2) fail('manifest requires at least two ordered modules');
  const ids = new Set(), files = new Set();
  for (let index = 0; index < manifest.modules.length; index++) {
    const module = manifest.modules[index];
    if (!isObject(module)) fail(`module ${index} must be an object`);
    requireKeys(module, MODULE_KEYS, `module ${index}`);
    if (typeof module.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(module.id)) fail(`module ${index} id must be a lower-case slug`);
    if (ids.has(module.id)) fail(`duplicate module id ${module.id}`);
    ids.add(module.id);
    if (!Number.isInteger(module.order) || module.order !== index) fail(`module ${module.id} order must be ${index}`);
    if (typeof module.file !== 'string' || !module.file.startsWith('src/') || !module.file.endsWith('.js') || /[\\:\0]/.test(module.file)) fail(`module ${module.id} file must be a relative src/*.js path using /`);
    const segments = module.file.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) fail(`module ${module.id} file contains an unsafe path segment`);
    const portableFile = module.file.toLowerCase();
    if (files.has(portableFile)) fail(`duplicate module file ${module.file}`);
    files.add(portableFile);
    if (module.description !== undefined && typeof module.description !== 'string') fail(`module ${module.id} description must be a string`);
  }
  return manifest;
}

function sourceFile(root, sourceRoot, relative) {
  const lexical = path.resolve(root, relative);
  if (!contained(sourceRoot, lexical)) fail(`source path escapes src: ${relative}`);
  let actual, stat;
  try { actual = fs.realpathSync(lexical); stat = fs.statSync(actual, { bigint: true }); }
  catch (error) { fail(`missing source file ${relative}: ${error.code || error.message}`); }
  if (!contained(sourceRoot, actual)) fail(`source link escapes src: ${relative}`);
  if (!stat.isFile()) fail(`source is not a regular file: ${relative}`);
  return { actual, stat };
}

function renderVersion(source, manifest) {
  const occurrences = source.split(VERSION_TOKEN).length - 1;
  if (manifest.versionToken === undefined) {
    if (occurrences) fail('version template requires manifest.versionToken');
    return source;
  }
  if (occurrences !== 2) fail('version template must occur exactly twice');
  const metadata = [...source.matchAll(/^\/\/[ \t]*@version[ \t]+\{\{SCRIPT_VERSION\}\}[ \t]*$/gm)];
  const runtime = [...source.matchAll(/^[ \t]*const[ \t]+SCRIPT_VERSION[ \t]*=[ \t]*(['"])\{\{SCRIPT_VERSION\}\}\1[ \t]*;[ \t]*$/gm)];
  const headerEnd = source.indexOf('// ==/UserScript==\n');
  if (metadata.length !== 1 || runtime.length !== 1 || headerEnd < 0 || metadata[0].index >= headerEnd || runtime[0].index <= headerEnd) fail('version template is permitted only in the metadata @version line and const SCRIPT_VERSION definition');
  return source.split(VERSION_TOKEN).join(manifest.version);
}

function validateAssembly(source, version) {
  if (!source.startsWith('// ==UserScript==\n')) fail('assembled source must start with the userscript metadata header');
  const starts = source.match(/^\/\/ ==UserScript==$/gm) || [];
  const ends = source.match(/^\/\/ ==\/UserScript==$/gm) || [];
  if (starts.length !== 1 || ends.length !== 1) fail('assembled source must contain exactly one complete userscript header');
  const headerEnd = source.indexOf('// ==/UserScript==\n');
  if (headerEnd < 0) fail('metadata header must end on a complete line');
  const header = source.slice(0, headerEnd);
  const metadataVersions = [...header.matchAll(/^\/\/\s*@version\s+(\S+)\s*$/gm)].map(match => match[1]);
  const runtimeVersions = [...source.matchAll(/^\s*const\s+SCRIPT_VERSION\s*=\s*['"]([^'"]+)['"]\s*;/gm)].map(match => match[1]);
  if (metadataVersions.length !== 1 || runtimeVersions.length !== 1) fail('exactly one @version and const SCRIPT_VERSION are required');
  if (metadataVersions[0] !== version || runtimeVersions[0] !== version) fail(`manifest/@version/SCRIPT_VERSION mismatch: ${version}/${metadataVersions[0]}/${runtimeVersions[0]}`);
  const body = source.slice(headerEnd + '// ==/UserScript==\n'.length);
  if (!/^\s*\(function \(\) \{\s*['"]use strict['"];/s.test(body) || !/\}\)\(\);\n?$/.test(body)) fail('assembled source must preserve the existing strict IIFE wrapper');
  if (!/^\s*\(function \(\) \{\s*['"]use strict['"];\s*const\s+SCRIPT_VERSION\s*=\s*['"]\d+\.\d+\.\d+['"]\s*;/s.test(body)) fail('SCRIPT_VERSION must remain the first declaration in the strict IIFE');
  try { new Script(source, { filename: OUTPUT_NAME }); }
  catch (error) { fail(`assembled JavaScript syntax is invalid: ${error.message}`); }
}

function outputFile(root) {
  const output = path.join(root, OUTPUT_NAME);
  try {
    const stat = fs.lstatSync(output);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) fail('output must be a regular non-linked file in the project root');
    if (!contained(root, fs.realpathSync(output))) fail('output escapes project root');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return output;
}

export function buildUserscript({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), mode = 'check' } = {}) {
  if (!['check', 'write'].includes(mode)) fail('mode must be check or write');
  let realRoot, sourceRoot;
  try {
    realRoot = fs.realpathSync(path.resolve(root));
    if (!fs.statSync(realRoot).isDirectory()) fail('root must be a directory');
    sourceRoot = fs.realpathSync(path.join(realRoot, 'src'));
    if (!contained(realRoot, sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) fail('src must be a directory inside the project root');
  } catch (error) { if (error.message.startsWith('userscript build:')) throw error; fail(`cannot resolve project root/src: ${error.code || error.message}`); }
  const manifestFile = sourceFile(realRoot, sourceRoot, 'src/manifest.json').actual;
  let manifest;
  try { manifest = JSON.parse(readUtf8(manifestFile)); }
  catch (error) { fail(`invalid src/manifest.json: ${error.message}`); }
  validateManifest(manifest);
  const actualFiles = new Set(), identities = new Set();
  const modules = manifest.modules.map(module => {
    const file = sourceFile(realRoot, sourceRoot, module.file);
    const key = process.platform === 'win32' ? file.actual.toLowerCase() : file.actual;
    const identity = `${file.stat.dev}:${file.stat.ino}`;
    if (actualFiles.has(key) || identities.has(identity)) fail(`duplicate physical source file ${module.file}`);
    actualFiles.add(key); identities.add(identity);
    const source = normalizeLF(readUtf8(file.actual));
    if (!source) fail(`source module ${module.id} is empty`);
    return source;
  });
  const source = renderVersion(modules.join(''), manifest);
  validateAssembly(source, manifest.version);
  const output = outputFile(realRoot);
  let current = null;
  if (fs.existsSync(output)) current = readUtf8(output);
  const inSync = current !== null && normalizeLF(current) === source;
  if (mode === 'check' && !inSync) fail('generated userscript is missing or out of sync; edit src modules, then run --write');
  let written = false;
  if (mode === 'write' && current !== source) {
    const temporary = path.join(realRoot, `.userscript-build-${randomUUID()}.tmp`);
    try { fs.writeFileSync(temporary, source, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temporary, output); written = true; }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { mode, version: manifest.version, moduleCount: manifest.modules.length, sha256: createHash('sha256').update(source).digest('hex'), inSync: mode === 'write' || inSync, written };
}

function cli(args) {
  if (args.includes('--help')) {
    console.log('Usage: node tools/build-userscript.mjs --check|--write [--root PROJECT]\nSource: PROJECT/src/manifest.json; output: PROJECT/jiangxi-radiation-auto-diagnose.user.js\nModules are concatenated in explicit order with LF endings and no inserted text.');
    return;
  }
  let mode, root;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--check' || arg === '--write') {
      if (mode) fail('specify exactly one of --check or --write');
      mode = arg.slice(2);
    } else if (arg === '--root') {
      if (root !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) fail('--root requires one project path');
      root = args[++index];
    } else fail(`unknown argument ${arg}`);
  }
  if (!mode) fail('specify --check or --write');
  console.log(JSON.stringify(buildUserscript({ mode, root })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
