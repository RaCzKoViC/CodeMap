// CM.TestGen — szkielety testów: konwencja położenia z istniejących par test ↔ kod, framework z projektu, import
// eksportowanych symboli, przypadki od najbardziej złożonych funkcji; JS/TS, Python, Go, Rust, Java.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { CLI_MODULES } from '../cli/runtime.mjs';

const CM = loadCM([...CLI_MODULES, 'testgen']);
const TG = CM.TestGen;
const { Graph } = CM.Graph;
const F = (path, content) => ({ path, content, size: content.length, mtime: 1 });
const build = (files) => { const g = new Graph().build(files, { name: 't', source: 'test' }); CM.TestMap.mapTests(g); return g; };
const gen = (g, p, lang) => host(TG.generate(g, g.nodes.get(p), { lang }));
const CART = "export function total(items) {\n  let s = 0;\n  for (const i of items) { if (!i) throw new Error('x'); if (i.qty > 0) s += i.qty * i.price; else if (i.free) s += 0; }\n  return s;\n}\n" +
  'export class Cart { add(x) { return x; } }\nfunction hidden() { return 1; }\nexport const fmt = (v) => v ? String(v) : "";\n';

describe('TestGen: konwencje i framework z projektu', () => {
  test('płaski test/ z .test.mjs (jak w projekcie) + node:test z package.json; import z względną ścieżką', () => {
    const g = build([F('package.json', '{ "scripts": { "test": "node --test test/" } }'), F('js/util.js', 'export const u = 1;\n'),
      F('test/util.test.mjs', "import { u } from '../js/util.js';\n"), F('js/cart.js', CART)]);
    const r = gen(g, 'js/cart.js');
    assert.equal(r.framework, 'node');
    assert.match(r.path, /^test\/cart\.test\.mjs$/);
    assert.match(r.code, /import \{ describe, it \} from 'node:test';/);
    assert.match(r.code, /import \{ total, Cart, fmt \} from '\.\.\/js\/cart\.js';/);
    assert.ok(!r.code.includes('hidden'));
    assert.ok(r.code.indexOf("describe('total'") < r.code.indexOf("describe('fmt'"), 'najbardziej złożona pierwsza');
    assert.match(r.code, /assert\.throws\(\(\) => total\(/);
    assert.match(r.code, /const obj = new Cart\(/);
  });
  test('vitest + obok pliku (sibling) z .spec.ts; import TS bez rozszerzenia', () => {
    const g = build([F('package.json', '{ "devDependencies": { "vitest": "^1" } }'), F('src/a.ts', 'export const a = 1;\n'), F('src/a.spec.ts', "import { a } from './a';\n"),
      F('src/cart.ts', CART)]);
    const r = gen(g, 'src/cart.ts', 'en');
    assert.deepEqual([r.path, r.framework], ['src/cart.spec.ts', 'vitest']);
    assert.match(r.code, /import \{ describe, it, expect \} from 'vitest';/);
    assert.match(r.code, /from '\.\/cart';/);
    assert.match(r.code, /expect\(result\)\.toEqual/);
    assert.match(r.code, /it\('typical input'/);
  });
  test('jest + __tests__; bez eksportów — uwaga zamiast importu', () => {
    const g = build([F('package.json', '{ "devDependencies": { "jest": "^29" } }'), F('lib/x.js', 'export const x = 1;\n'), F('lib/__tests__/x.test.js', "import { x } from '../x';\n"),
      F('lib/iife.js', '(function(){\n  function inner(a){ if(a) return 1; return 2; }\n  window.I = { inner };\n})();\n')]);
    const r = gen(g, 'lib/iife.js');
    assert.deepEqual([r.path, r.framework, r.note], ['lib/__tests__/iife.test.js', 'jest', 'noexports']);
    assert.match(r.code, /Moduł niczego nie eksportuje/);
    assert.ok(!/^import \{/m.test(r.code));
  });
});

describe('TestGen: głosowanie konwencji', () => {
  test('2 × obok pliku (.test.js i .test.jsx) wygrywa z 1 × tests/; przyrostek wg rozszerzenia pliku', () => {
    const g = build([F('src/a.js', 'export const a = 1;\n'), F('src/a.test.js', "import { a } from './a.js';\n"),
      F('src/B.jsx', 'export const B = 1;\n'), F('src/B.test.jsx', "import { B } from './B.jsx';\n"),
      F('src/u/fmt.js', 'export const f = 1;\n'), F('tests/fmt.test.js', "import { f } from '../src/u/fmt.js';\n"),
      F('src/cart.js', CART), F('src/View.jsx', 'export function View(p){ return p ? 1 : 2; }\n')]);
    assert.equal(gen(g, 'src/cart.js').path, 'src/cart.test.js');
    assert.equal(gen(g, 'src/View.jsx').path, 'src/View.test.jsx');
  });
});

describe('TestGen: inne języki', () => {
  test('Python: pytest (conftest), tests/test_x.py, import z modułu bez src/, publiczne funkcje', () => {
    const g = build([F('conftest.py', ''), F('src/shop/cart.py', 'def total(items):\n    if not items:\n        raise ValueError()\n    return sum(items)\n\ndef _private():\n    pass\n\nclass Cart:\n    def add(self, x):\n        return x\n')]);
    const r = gen(g, 'src/shop/cart.py');
    assert.deepEqual([r.path, r.framework], ['tests/test_cart.py', 'pytest']);
    assert.match(r.code, /from shop\.cart import total, Cart/);
    assert.match(r.code, /def test_total_typowe_wejscie\(\):/);
    assert.match(r.code, /with pytest\.raises\(Exception\)/);
    assert.ok(!r.code.includes('_private'));
  });
  test('Go: _test.go obok, pakiet z pliku, tabela przypadków; Rust: moduł testów w tym samym pliku; Java: src/test', () => {
    const g = build([F('pkg/calc/calc.go', 'package calc\n\nfunc Add(a, b int) int { if a > 0 { return a + b }; return b }\n'),
      F('src/lib.rs', 'pub fn parse(s: &str) -> i32 { if s.is_empty() { 0 } else { 1 } }\n'),
      F('src/main/java/com/x/Calc.java', 'package com.x;\npublic class Calc { public int add(int a, int b) { return a + b; } }\n')]);
    const go = gen(g, 'pkg/calc/calc.go');
    assert.deepEqual([go.path, go.framework], ['pkg/calc/calc_test.go', 'testing']);
    assert.match(go.code, /^package calc$/m); assert.match(go.code, /func TestAdd\(t \*testing\.T\)/);
    const rs = gen(g, 'src/lib.rs');
    assert.equal(rs.path, 'src/lib.rs'); assert.match(rs.code, /#\[cfg\(test\)\]\nmod tests \{\n    use super::\*;/);
    const jv = gen(g, 'src/main/java/com/x/Calc.java');
    assert.deepEqual([jv.path, jv.framework], ['src/test/java/com/x/CalcTest.java', 'JUnit 5']);
    assert.match(jv.code, /^package com\.x;$/m); assert.match(jv.code, /class CalcTest \{/);
  });
  test('relPath', () => {
    assert.equal(TG.relPath('test', 'js/a.js'), '../js/a.js');
    assert.equal(TG.relPath('src', 'src/a'), './a');
    assert.equal(TG.relPath('', 'a.js'), './a.js');
  });
});
