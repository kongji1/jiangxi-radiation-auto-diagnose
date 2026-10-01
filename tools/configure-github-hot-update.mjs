import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valueOf = (name, fallback = '') => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const repository = valueOf('--repository');
const branch = valueOf('--branch', 'main');
if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error('Repository must be owner/name');

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'jiangxi-radiation-auto-diagnose.user.js');
let source = fs.readFileSync(sourcePath, 'utf8');
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
console.log(`GitHub hot-update URL configured: ${update}`);
console.log('Next: increment @version, run node tests/source-contract.test.mjs, then push to the repository.');
