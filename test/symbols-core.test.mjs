import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

// Rdzeń grafu symboli (js/symbols-core.js) bez tree-sittera: sztuczne drzewo składni z kursorem (API web-tree-sitter:
// walk / gotoFirstChild / gotoNextSibling / gotoParent, childForFieldName) i sztuczny parser w analyzeBatch.
const SC = loadCM(['symbols-core']).SymbolsCore;

// węzeł: typ, pola nazwane (też dzieci, w kolejności), dodatkowe dzieci, tekst, wiersz
function N(type, { f = {}, kids = [], text = '', row = 0, end } = {}) {
  const children = [...Object.values(f), ...kids];
  const n = { type, text, children, startPosition: { row }, endPosition: { row: end ?? row },
    childForFieldName: (k) => f[k] || null,
    get firstNamedChild() { return children[0] || null; }, get lastNamedChild() { return children.at(-1) || null; } };
  for (const c of children) c.parent = n;
  return n;
}
const id = (text, type = 'identifier') => N(type, { text });
const call = (fn) => N('call_expression', { f: { function: fn } });
function tree(root) {
  return { walk() {
    let cur = root; const stack = [];   // [rodzic, indeks]
    return {
      get nodeType() { return cur.type; }, get currentNode() { return cur; },
      gotoFirstChild() { if (!cur.children.length) return false; stack.push([cur, 0]); cur = cur.children[0]; return true; },
      gotoNextSibling() { const top = stack.at(-1); if (!top || top[1] + 1 >= top[0].children.length) return false; top[1]++; cur = top[0].children[top[1]]; return true; },
      gotoParent() { const top = stack.pop(); if (!top) return false; cur = top[0]; return true; },
      delete() { this.deleted = true; },
    };
  } };
}

describe('extract: definicje i wywołania', () => {
  test('funkcja, klasa z metodą, funkcja strzałkowa, def w klasie Pythona = metoda; wywołania bez duplikatów i this', () => {
    const root = N('program', { kids: [
      N('function_declaration', { row: 0, end: 5, f: { name: id('main'), body: N('statement_block', { kids: [
        call(id('helper')),
        call(N('member_expression', { f: { object: id('obj'), property: id('run', 'property_identifier') } })),
        call(id('helper')),
        N('new_expression', { f: { constructor: id('Foo') } }),
        call(id('this', 'this')),
        call(N('member_expression', { f: { object: id('std'), property: id('this', 'property_identifier') } })),
      ] }) } }),
      N('class_declaration', { row: 7, end: 12, f: { name: id('Foo', 'type_identifier'), body: N('class_body', { kids: [
        N('method_definition', { row: 8, f: { name: id('go', 'property_identifier'), body: N('statement_block', { kids: [call(id('main'))] }) } }),
      ] }) } }),
      N('lexical_declaration', { row: 14, kids: [N('variable_declarator', { row: 14, f: { name: id('arrow'), value: N('arrow_function', { kids: [call(id('x'))] }) } })] }),
      N('lexical_declaration', { kids: [N('variable_declarator', { f: { name: id('notfn'), value: N('number', { text: '1' }) } })] }),
      call(id('topLevel')),
      N('struct_specifier', { f: { name: id('P', 'type_identifier') } }),
      N('class_definition', { row: 20, f: { name: id('Py'), body: N('block', { kids: [N('function_definition', { row: 21, f: { name: id('m') } })] }) } }),
    ] });
    const t = tree(root);
    const syms = host(SC.extract(t));
    assert.deepEqual(syms.map((s) => [s.name, s.kind, s.line]),
      [['main', 'function', 1], ['Foo', 'class', 8], ['go', 'method', 9], ['arrow', 'function', 15], ['Py', 'class', 21], ['m', 'method', 22]]);
    assert.deepEqual(syms[0].calls, ['helper', 'run', 'Foo']);
    assert.equal(syms[0].endLine, 6);
    assert.deepEqual(syms[2].calls, ['main']);
    assert.deepEqual(syms[3].calls, ['x']);
    assert.ok(!syms.some((s) => s.name === 'P'), 'struct bez ciała to użycie typu');
  });
  test('C/C++: nazwa z łańcucha deklaratorów (wskaźnik, kwalifikacja std::), impl w Rust po typie', () => {
    const cfn = N('function_definition', { f: { declarator: N('pointer_declarator', { f: { declarator: N('function_declarator', { f: {
      declarator: N('qualified_identifier', { text: 'ns::Klass::run', f: { name: id('run') } }) } }) } }) } });
    const impl = N('impl_item', { f: { type: id('Vec<T>', 'generic_type') }, kids: [N('declaration_list', { kids: [N('function_item', { f: { name: id('push') } })] })] });
    const syms = host(SC.extract(tree(N('translation_unit', { kids: [cfn, impl] }))));
    assert.deepEqual(syms.map((s) => [s.name, s.kind]), [['run', 'function'], ['Vec', 'impl'], ['push', 'method']]);
  });
  test('limit 150 różnych wywołań na symbol; nazwy dłuższe niż 80 znaków pomijane', () => {
    const calls = Array.from({ length: 170 }, (_, i) => call(id('f' + i)));
    calls.unshift(call(id('x'.repeat(81))));
    const syms = SC.extract(tree(N('program', { kids: [N('function_declaration', { f: { name: id('big'), body: N('block', { kids: calls }) } })] })));
    assert.equal(syms[0].calls.length, 150);
    assert.equal(syms[0].calls[0], 'f0');
  });
});

describe('analyzeBatch', () => {
  function fakeTS(log) {
    return class { setLanguage(L) { log.push('lang:' + L.name); }
      parse(src) { log.push('parse:' + src.length); return { walk: tree(N('program', { kids: [N('function_declaration', { f: { name: id('f' + src.length) } })] })).walk, delete() { log.push('tree.delete'); } }; }
      delete() { log.push('parser.delete'); } };
  }
  test('pomija pliki bez gramatyki i bez treści, język ustawiany tylko przy zmianie, błąd pliku nie przerywa partii', async () => {
    const log = [], langs = { javascript: { name: 'js' }, python: { name: 'py' } };
    const files = [
      { path: 'a.js', lang: 'js', content: 'x' }, { path: 'b.mjs', content: 'yy' }, { path: 'README.md', lang: 'md', content: '# t' },
      { path: 'c.js', lang: 'js', content: null }, { path: 'd.py', lang: 'py', content: 'zzz' }, { path: 'e.go', lang: 'go', content: 'package x' }];
    const load = async (g) => { if (g === 'go') throw new Error('brak wasm'); return langs[g] || null; };
    const out = host(await SC.analyzeBatch(fakeTS(log), files, load));
    assert.deepEqual(out.map((r) => [r.path, r.error || r.symbols.map((s) => s.name).join()]),
      [['a.js', 'f1'], ['b.mjs', 'f2'], ['d.py', 'f3'], ['e.go', 'brak wasm']]);
    assert.deepEqual(log.filter((l) => l.startsWith('lang:')), ['lang:js', 'lang:py']);
    assert.equal(log.at(-1), 'parser.delete');
    assert.equal(log.filter((l) => l === 'tree.delete').length, 3);
  });
  test('treść ponad 300 000 znaków ucinana; postęp co 20 plików i na końcu; anulowanie przerywa', async () => {
    const log = [], progress = [];
    const files = Array.from({ length: 45 }, (_, i) => ({ path: `f${i}.js`, lang: 'js', content: i === 0 ? 'a'.repeat(300500) : 'b' }));
    await SC.analyzeBatch(fakeTS(log), files, async () => ({ name: 'js' }), { onProgress: (d, t) => { progress.push([d, t]); } });
    assert.equal(log.find((l) => l.startsWith('parse:')), 'parse:300000');
    assert.deepEqual(progress, [[20, 45], [40, 45], [45, 45]]);
    let n = 0; const log2 = [];
    const out = await SC.analyzeBatch(fakeTS(log2), files, async () => ({ name: 'js' }), { cancelled: () => ++n > 3 });
    assert.equal(out.length, 3);
    assert.equal(log2.at(-1), 'parser.delete');
  });
  test('wyjątek z onProgress wychodzi na zewnątrz, ale parser jest zwolniony', async () => {
    const log = [];
    await assert.rejects(SC.analyzeBatch(fakeTS(log), [{ path: 'a.js', lang: 'js', content: 'x' }], async () => ({ name: 'js' }),
      { onProgress: () => { throw new Error('UI padło'); } }), /UI padło/);
    assert.equal(log.at(-1), 'parser.delete');
  });
});

describe('symbolId i KIND_CODE', () => {
  test('id = ścieżka#nazwa@linia; każdy rodzaj symbolu ma skrót', () => {
    assert.equal(SC.symbolId('src/a.js', { name: 'run', line: 12 }), 'src/a.js#run@12');
    for (const k of ['function', 'method', 'constructor', 'class', 'interface', 'struct', 'enum', 'trait', 'impl', 'type', 'module'])
      assert.match(SC.KIND_CODE[k], /^[A-Z]{2,3}$/, k);
    assert.ok(SC.GRAMMARS.length >= 12 && new Set(SC.GRAMMARS).size === SC.GRAMMARS.length);
  });
});
