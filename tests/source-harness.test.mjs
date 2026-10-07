import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createSourceHarness } from './helpers/source-harness.mjs';

let tested = 0;
function test(name, run) { run(); tested++; }
const fixtureSource = `
  // A neighbouring name is deliberately irrelevant.
  function before() { return 0; }
  /*
  function target() { throw new Error('comment'); }
  */
  const template = \`function target() { fake }\`;
  const state = { count: 0, nested: { brace: '}' } };
  async function target(value = { text: '}' }) {
    const regex = /[{}]/;
    const quoted = '}';
    const text = \`literal } \${{ nested: \`inside \${value.text}\` }.nested}\`;
    // }
    /* } */
    function inner() { return '{'; }
    return { regex: regex.test(quoted), text, value: value.text, inner: inner() };
  }
  function afterRenamed() { return 'after'; }
  const bump = () => { state.count++; return state.count; };
`;
const harness = createSourceHarness({ sources: { sample: { file: 'fixture/sample.js', source: fixtureSource } } });
test('parser determines function end across regex strings templates comments and nested functions', () => {
  const selected = harness.declaration('sample', 'target');
  assert.ok(selected.code.includes('function inner()'));
  assert.ok(selected.code.endsWith('  }'));
  assert.ok(!selected.code.includes('afterRenamed'));
  assert.equal(selected.file, 'fixture/sample.js');
  assert.equal(selected.line, 9);
  assert.ok(selected.endLine > selected.line);
});
test('neighbour renaming cannot change extraction', () => {
  const renamed = createSourceHarness({ sources: { sample: { source: fixtureSource.replaceAll('before', 'entirelyDifferent').replaceAll('afterRenamed', 'alsoDifferent') } } });
  assert.equal(renamed.select('sample', ['target']), harness.select('sample', ['target']));
});
test('nested declaration cannot be mistaken for a top-level declaration', () => assert.throws(() => harness.declaration('sample', 'inner'), /found 0/));
test('comment-only declarations cannot be extracted', () => {
  const h = createSourceHarness({ sources: { sample: { source: '/*\n function ghost() {}\n*/\n' } } });
  assert.throws(() => h.declaration('sample', 'ghost'), /found 0/);
});
test('template text cannot pretend to be a declaration', () => {
  const h = createSourceHarness({ sources: { sample: { source: 'const text = `\n function ghost() {}\n`;\n' } } });
  assert.throws(() => h.declaration('sample', 'ghost'), /found 0/);
});
test('duplicate actual declaration is rejected instead of silently selecting one', () => {
  const h = createSourceHarness({ sources: { sample: { source: 'function repeated() {}\nfunction repeated() {}\n' } } });
  assert.throws(() => h.declaration('sample', 'repeated'), /found 2/);
});
test('incomplete declaration has source-specific failure', () => {
  const h = createSourceHarness({ sources: { sample: { file: 'fixture/broken.js', source: 'function broken() { const x = 1;' } } });
  assert.throws(() => h.declaration('sample', 'broken'), /broken.js: declaration broken is incomplete/);
});
test('selecting source never executes its initializer', () => {
  const h = createSourceHarness({ sources: { sample: { source: 'const danger = forbidden();\n' } } });
  assert.equal(h.select('sample', ['danger']), 'const danger = forbidden();');
});
test('variable and arrow boundaries ignore semicolons inside their body', () => {
  assert.equal(harness.declaration('sample', 'bump').code.trim(), 'const bump = () => { state.count++; return state.count; };');
});
test('explicit selections share lexical state in the same VM sandbox', () => {
  const context = vm.createContext({});
  harness.load(context, [{ module: 'sample', names: ['state', 'bump'] }]);
  assert.equal(vm.runInContext('bump()', context), 1);
  assert.equal(vm.runInContext('state.count', context), 1);
});
test('full fragment load preserves its state and functions', () => {
  const context = vm.createContext({});
  harness.load(context, [{ module: 'sample' }]);
  assert.equal(context.afterRenamed(), 'after');
  assert.equal(vm.runInContext('bump()', context), 1);
});
test('load failure reports actual fragment provenance', () => {
  const h = createSourceHarness({ sources: { sample: { file: 'fixture/error.js', source: 'const error = missing();\n' } } });
  assert.throws(() => h.load(vm.createContext({}), [{ module: 'sample', names: ['error'] }]), /Sources: fixture\/error.js:error/);
});
test('explicit context and unambiguous selection are required', () => {
  assert.throws(() => harness.load({}, [{ module: 'sample' }]), /explicit vm.createContext/);
  assert.throws(() => harness.load(vm.createContext({}), []), /explicit module selections/);
  assert.throws(() => harness.select('sample', ['target', 'target']), /distinct explicit/);
  assert.throws(() => harness.declaration('sample', 'x); throw 1;'), /invalid declaration name/);
  assert.throws(() => harness.module('missing'), /unknown module/);
});
test('real manifest resolves production declarations with original source filenames', () => {
  const h = createSourceHarness();
  assert.equal(h.moduleIds.length, 17);
  assert.equal(h.declaration('entry-protocol', 'protocolEnter').file, 'src/10-entry-protocol.js');
  assert.ok(h.select('record-list', ['findRowRecordByApi']).includes('async function findRowRecordByApi'));
});
test('real version template is rendered exactly as the generated runtime', () => {
  const h = createSourceHarness();
  const context = vm.createContext({});
  h.load(context, [{ module: 'schedule-defaults', names: ['SCRIPT_VERSION'] }]);
  assert.match(vm.runInContext('SCRIPT_VERSION', context), /^\d+\.\d+\.\d+$/);
});
console.log(`source-harness: ${tested} tests passed`);
