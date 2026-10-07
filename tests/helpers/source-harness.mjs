import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { buildUserscript, normalizeLF, validateManifest } from '../../tools/build-userscript.mjs';

function failure(message) { throw new Error(`source harness: ${message}`); }
function parses(source, filename) {
  try { new vm.Script(`'use strict';\n${source}`, { filename }); return true; }
  catch { return false; }
}
function escapePattern(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Loads original ordered fragments by manifest id. Declaration boundaries are
 * accepted by the JavaScript parser, rather than by a neighbouring function's
 * name or manually counted braces. Parsing never executes candidate source.
 * This is a focused declaration harness, not an AST or automatic dependency resolver.
 */
export function createSourceHarness({ root = path.resolve(import.meta.dirname, '../..'), sources = null } = {}) {
  const modules = new Map(), declarations = new Map();
  if (sources !== null) {
    for (const [id, value] of Object.entries(sources)) modules.set(id, {
      id, file: value.file || `fixture/${id}.js`, source: normalizeLF(value.source),
    });
  } else {
    // Reuse build validation for paths, physical files, versions and output sync.
    buildUserscript({ root, mode: 'check' });
    const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8')));
    for (const entry of manifest.modules) modules.set(entry.id, {
      id: entry.id, file: entry.file, source: normalizeLF(fs.readFileSync(path.join(root, entry.file), 'utf8')).split(manifest.versionToken || '\u0000').join(manifest.version),
    });
  }
  function module(id) {
    const value = modules.get(id);
    if (!value) failure(`unknown module ${id}`);
    return value;
  }
  function declaration(id, name) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) failure(`invalid declaration name ${name}`);
    const key = `${id}:${name}`;
    if (declarations.has(key)) return declarations.get(key);
    const value = module(id), escaped = escapePattern(name);
    const pattern = new RegExp(`^[ \\t]*(?:(?:async[ \\t]+)?function[ \\t]+(${escaped})[ \\t]*\\(|(?:const|let|var)[ \\t]+(${escaped})(?=[ \\t=;,\\n]))`, 'gm');
    const candidates = [...value.source.matchAll(pattern)].filter(match => parses(value.source.slice(0, match.index), value.file));
    if (candidates.length !== 1) failure(`${value.file}: expected one top-level declaration ${name}, found ${candidates.length}`);
    const candidate = candidates[0], start = candidate.index, delimiter = candidate[1] ? '}' : ';';
    let end = value.source.indexOf(delimiter, start);
    while (end >= 0) {
      const code = value.source.slice(start, end + 1);
      if (parses(code, value.file)) {
        const line = value.source.slice(0, start).split('\n').length;
        const result = Object.freeze({ module: id, name, file: value.file, line,
          endLine: line + code.split('\n').length - 1, code });
        declarations.set(key, result);
        return result;
      }
      end = value.source.indexOf(delimiter, end + 1);
    }
    failure(`${value.file}: declaration ${name} is incomplete or invalid JavaScript`);
  }
  function select(id, names) {
    if (!Array.isArray(names) || names.length === 0 || new Set(names).size !== names.length) failure('select requires distinct explicit declaration names');
    return names.map(name => declaration(id, name).code).join('\n');
  }
  function load(context, selections, { filename = 'source-harness:selected-declarations' } = {}) {
    if (!vm.isContext(context)) failure('load requires an explicit vm.createContext sandbox');
    if (!Array.isArray(selections) || selections.length === 0) failure('load requires explicit module selections');
    const provenance = selections.map(selection => {
      const value = module(selection.module);
      return `${value.file}${selection.names ? `:${selection.names.join(',')}` : ':full'}`;
    });
    const code = selections.map(selection => selection.names ? select(selection.module, selection.names) : module(selection.module).source).join('\n');
    try { vm.runInContext(code, context, { filename }); }
    catch (error) { error.message = `${error.message}\nSources: ${provenance.join(' | ')}`; throw error; }
    return context;
  }
  return Object.freeze({ module, declaration, select, load, moduleIds: Object.freeze([...modules.keys()]) });
}
