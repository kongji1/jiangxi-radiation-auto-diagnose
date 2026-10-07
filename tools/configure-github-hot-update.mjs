import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildUserscript } from './build-userscript.mjs';

const args = process.argv.slice(2);
const valueOf = (name, fallback = '') => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const repository = valueOf('--repository');
const branch = valueOf('--branch', 'main');
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repository must be owner/name');
if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(branch) || branch.split('/').includes('..')) throw new Error('Invalid branch');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Metadata belongs to its source module; the installable file is generated.
const sourcePath = path.join(root, 'src/00-header.js');
let source = fs.readFileSync(sourcePath, 'utf8');
const originalSource = source;
if (!source || !source.includes('// @version')) throw new Error('Unable to read userscript metadata; refusing to overwrite');
const update = `https://raw.githubusercontent.com/${repository}/${branch}/jiangxi-radiation-auto-diagnose.user.js`;
const updateLine = `// @updateURL   ${update}`;
const downloadLine = `// @downloadURL ${update}`;
const newline = source.includes('\r\n') ? '\r\n' : '\n';
const replaceLine = (text, name, line) => {
  const pattern = new RegExp(`^// @${name}[^\\r\\n]*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  const version = text.match(/^\/\/ @version[^\r\n]*$/m);
  if (!version || version.index == null) throw new Error('Unable to locate userscript version metadata');
  const end = version.index + version[0].length;
  return text.slice(0, end) + newline + line + text.slice(end);
};
source = replaceLine(source, 'updateURL', updateLine);
source = replaceLine(source, 'downloadURL', downloadLine);
fs.writeFileSync(sourcePath, source, { encoding: 'utf8' });
try {
  buildUserscript({ root, mode: 'write' });
} catch (error) {
  // The builder validates before touching the output. Restore the header too.
  fs.writeFileSync(sourcePath, originalSource, { encoding: 'utf8' });
  throw error;
}
console.log(`GitHub hot-update URL configured: ${update}`);
console.log('Next: run maintain-project.py version, test --all, then publish through the existing release tool.');
