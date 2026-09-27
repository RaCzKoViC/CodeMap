// CM.MapQuery — pytania o mapę językiem naturalnym (PL / EN) → spec → pliki; bez modelu.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { CLI_MODULES } from '../cli/runtime.mjs';

const CM = loadCM([...CLI_MODULES, 'mapquery']);
const Q = CM.MapQuery;
const { Graph } = CM.Graph;
const F = (path, content) => ({ path, content, size: content.length, mtime: 1 });
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n') + '\n';
const branchy = (n) => lines(n, (i) => `  if (x > ${i}) { y += ${i}; } else if (x < -${i}) { y -= 1; }`);

function project() {
  const g = new Graph().build([
    F('src/big.js', 'export function big(x){ let y = 0;\n' + branchy(40) + 'return y; }\n' + lines(300, (i) => `// ${i}`)),
    F('src/small.js', "import { big } from './big.js';\nexport const s = big(1);\n"),
    F('src/util/helpers.ts', 'export function h(x: number){ let y = 0;\n' + branchy(12) + 'return y; }\n'),
    F('lib/orphan.js', 'export const lonely = 1;\n'),
    F('lib/a.js', "import { b } from './b.js';\nexport const a = 1;\n"), F('lib/b.js', "import { a } from './a.js';\nexport const b = 2;\n"),
    F('app/main.py', 'def main():\n' + lines(20, (i) => `    if x == ${i}: return ${i}`)),
    F('test/small.test.js', "import { s } from '../src/small.js';\n"),
  ], { name: 't', source: 'test' });
  CM.TestMap.mapTests(g);
  const T0 = Date.UTC(2026, 0, 1), cs = [];
  const c = (who, paths, day) => cs.push({ sha: 'c' + cs.length, parents: [], merge: false, author: { name: who, email: who.split(' ')[0].toLowerCase() + '@x.pl' },
    authorTime: T0 + day * 864e5, time: T0 + day * 864e5, message: 'm', files: paths.map((p) => ({ path: p, status: 'M' })) });
  for (let i = 0; i < 12; i++) c('Ala Kowalska', ['src/big.js'], i);
  for (let i = 0; i < 3; i++) c('Bob Nowak', ['src/small.js', 'lib/a.js'], 100 + i);
  c('Bob Nowak', ['app/main.py'], 200);
  CM.GitCore.applyToGraph(g, CM.GitCore.analyze(cs.reverse(), [...g.nodes.values()].filter((n) => n.type === 'file').map((n) => n.path)), { source: 'test' });
  return g;
}
const G = project();
const NOW = Date.UTC(2026, 6, 25);   // 25.07.2026: app/main.py zmieniony 20.07 (5 dni), lib/a.js w kwietniu
const ask = (q, lang) => { const p = Q.parse(q, G); const r = Q.run(G, p.spec, { now: NOW }); return { p, r, paths: host(r.files.map((n) => n.path)), text: Q.describe(r, p.spec, lang) }; };

describe('MapQuery: parse', () => {
  test('warunki liczbowe PL/EN: słowny operator, znak, metryka po i przed liczbą; diakrytyki obojętne', () => {
    assert.deepEqual(host(Q.parse('pliki o złożoności powyżej 50').spec.conds), [{ metric: 'complexity', op: '>', value: 50 }]);
    assert.deepEqual(host(Q.parse('pliki ponad 300 linii').spec.conds), [{ metric: 'lines', op: '>', value: 300 }]);
    assert.deepEqual(host(Q.parse('files with more than 200 lines').spec.conds), [{ metric: 'lines', op: '>', value: 200 }]);
    assert.deepEqual(host(Q.parse('pliki z zlozonoscia >= 15 i co najwyzej 400 linii').spec.conds), [{ metric: 'complexity', op: '>=', value: 15 }, { metric: 'lines', op: '<=', value: 400 }]);
    assert.deepEqual(host(Q.parse('files larger than 2kb').spec.conds), [{ metric: 'size', op: '>', value: 2048 }]);
    assert.deepEqual(host(Q.parse('pliki zmieniane ponad 10 razy').spec.conds), [{ metric: 'changes', op: '>', value: 10 }]);
  });
  test('flagi, sortowanie i limit, język, folder (tylko istniejący), autor, okres', () => {
    const a = Q.parse('pokaż 5 najbardziej złożonych plików js bez testów w src', G).spec;
    assert.deepEqual(host([a.flags, a.sort, a.limit, a.lang, a.path]), [['untested'], { metric: 'complexity', dir: -1 }, 5, 'js', 'src']);
    assert.equal(Q.parse('pliki w nieistniejacym folderze', G).spec.path, null);
    assert.equal(Q.parse('files in util', G).spec.path, 'src/util');
    assert.equal(Q.parse('pliki autora Ala', G).spec.owner, 'ala');
    assert.equal(Q.parse('files changed in the last 2 weeks').spec.within, 14);
    assert.equal(Q.parse('pliki nieruszane od 3 miesięcy').spec.stale, 90);
    assert.deepEqual(host(Q.parse('hotspoty w cyklach').spec.flags), ['hotspot', 'cycle']);
    assert.equal(Q.parse('największe pliki').spec.limit, 10);
  });
  test('confident tylko z warunkiem/flagą/sortowaniem i kształtem pytania o pliki', () => {
    assert.equal(Q.parse('pliki bez testów').confident, true);
    assert.equal(Q.parse('które pliki są najważniejsze dla bezpieczeństwa?').confident, false);
    assert.equal(Q.parse('włącz jasny motyw').confident, false);
    assert.equal(Q.parse('show the largest files').confident, true);
  });
});

describe('MapQuery: run na grafie', () => {
  test('złożoność + bez testów; test małego pliku wyklucza go', () => {
    assert.deepEqual(ask('pliki bez testów o złożoności powyżej 10').paths, ['src/big.js', 'src/util/helpers.ts', 'app/main.py']);
    assert.ok(!ask('pliki bez testów').paths.includes('src/small.js'));
  });
  test('sortowanie + limit + język; opis z metryką', () => {
    const r = ask('top 2 największe pliki js w src');
    assert.deepEqual(r.paths, ['src/big.js', 'src/small.js']);
    assert.match(r.text, /^Pliki: 2 — src\/big\.js \(linie \d+\), src\/small\.js \(linie 3\)$/);
  });
  test('historia: zmiany, autor, okres, nieruszane; cykle i osierocone', () => {
    assert.deepEqual(ask('pliki zmieniane ponad 10 razy').paths, ['src/big.js']);
    assert.deepEqual(ask('pliki autora Bob').paths.sort(), ['app/main.py', 'lib/a.js', 'src/small.js']);
    assert.deepEqual(ask('pliki zmienione w ostatnim tygodniu').paths, ['app/main.py']);
    assert.ok(ask('pliki nieruszane od 3 miesięcy').paths.includes('src/big.js'));
    assert.deepEqual(ask('pliki w cyklach').paths.sort(), ['lib/a.js', 'lib/b.js']);
    assert.deepEqual(ask('osierocone pliki').paths.sort(), ['lib/orphan.js', 'src/util/helpers.ts']);   // main.py to plik wejściowy
  });
  test('folder i angielski opis; brak wyników', () => {
    assert.deepEqual(ask('files in util').paths, ['src/util/helpers.ts']);   // sam folder: wszystkie jego pliki (confident = false)
    assert.deepEqual(ask('files with more than 5 lines in util').paths, ['src/util/helpers.ts']);
    assert.equal(ask('pliki ponad 100000 linii').text, 'Brak pasujących plików.');
    assert.match(ask('largest files in lib', 'en').text, /^Files: 3 — /);
  });
});
