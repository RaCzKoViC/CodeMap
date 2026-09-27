// CM.DSM — pakiety monorepo i macierz zależności: jednostki (pakiety / foldery), kolejność dostawcy → konsumenci,
// zależności pod przekątną, cykle między pakietami nad nią; zapis mapy zachowuje pakiety.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { FILES as MONO } from './fixtures/monorepo.mjs';

const CM = loadCM([...CORE, 'dsm']);
const { Graph } = CM.Graph;
const F = (path, content) => ({ path, content, size: content.length, mtime: 1 });
const build = (files) => new Graph().build(files.map((f) => ({ ...f })), { name: 't', source: 'test' });

describe('DSM: monorepo z workspaces', () => {
  const g = build(MONO);
  test('pakiety z package.json → jednostki; plik należy do najgłębszego pakietu, packages/a (bez manifestu) do korzenia', () => {
    assert.deepEqual(host(g.packages.map((p) => p.dir + '=' + p.name)), ['=mono', 'packages/b=@mono/b', 'packages/c=@mono/c', 'packages/shared=@mono/shared', 'packages/util=util-pkg']);
    const U = CM.DSM.units(g);
    assert.equal(U.mode, 'packages');
    assert.equal(U.of(g.nodes.get('packages/a/src/uses.ts')), 'pkg:');
    assert.equal(U.of(g.nodes.get('packages/b/lib/feat/one.ts')), 'pkg:packages/b');
  });
  test('macierz: konsument (mono) na dole, zależności pod przekątną, bez cykli; pary plików w komórkach', () => {
    const m = CM.DSM.matrix(g);
    assert.deepEqual(host(m.units.map((u) => u.name)), ['@mono/b', '@mono/c', '@mono/shared', 'util-pkg', 'mono']);
    assert.deepEqual(host(m.cells[4]), [3, 1, 3, 1, 0]);
    assert.ok(m.cells.slice(0, 4).every((r) => r.every((x) => x === 0)));
    assert.equal(m.above, 0); assert.deepEqual(host(m.cycles), []);
    assert.deepEqual(host(m.pairs.get('4>2').map((p) => p[0]).sort()), ['packages/a/src/main.ts', 'packages/a/src/uses.ts', 'scripts/build.ts']);
    assert.deepEqual(host(m.units.map((u) => [u.out, u.in])), [[0, 3], [0, 1], [0, 3], [0, 1], [8, 0]]);
  });
  test('zapis mapy zachowuje pakiety i tę samą macierz', () => {
    const back = Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    assert.deepEqual(host(back.packages), host(g.packages));
    assert.deepEqual(host(CM.DSM.matrix(back).cells), host(CM.DSM.matrix(g).cells));
  });
});

describe('DSM: cykle i tryb folderów', () => {
  test('cykl między pakietami: oba w jednej składowej, jedna komórka nad przekątną; konsument cyklu niżej', () => {
    const g = build([
      F('p1/package.json', '{ "name": "p1" }'), F('p2/package.json', '{ "name": "p2" }'), F('app/package.json', '{ "name": "app" }'),
      F('p1/a.js', "import { b } from '../p2/b.js';\nexport const a = 1;\n"),
      F('p2/b.js', "import { a } from '../p1/a.js';\nexport const b = 2;\n"),
      F('app/main.js', "import { a } from '../p1/a.js';\n"),
    ]);
    const m = CM.DSM.matrix(g);
    assert.deepEqual(host(m.units.map((u) => u.name)), ['p1', 'p2', 'app']);
    assert.deepEqual(host(m.cycles), [['pkg:p1', 'pkg:p2']]);
    assert.equal(m.above, 1);
    assert.equal(m.cells[0][1] + m.cells[1][0], 2);
    assert.deepEqual(host(CM.DSM.packageCycles(g).map((c) => c.map((u) => u.name))), [['p1', 'p2']]);
  });
  test('mniej niż 2 pakiety → foldery pierwszego poziomu; pliki w korzeniu jako osobna jednostka; głębokość 2', () => {
    const g = build([
      F('package.json', '{ "name": "solo" }'), F('index.js', "import './src/app.js';\n"),
      F('src/app.js', "import { u } from '../lib/util.js';\nimport { v } from './ui/view.js';\n"), F('src/ui/view.js', 'export const v = 1;\n'),
      F('lib/util.js', 'export const u = 1;\n'),
    ]);
    const m = CM.DSM.matrix(g);
    assert.equal(m.mode, 'folders');
    assert.deepEqual(host(m.units.map((u) => u.name)), ['lib', 'src', '(korzeń)']);
    assert.deepEqual(host(m.cells), [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    assert.deepEqual(host(CM.DSM.packageCycles(g)), []);
    const m2 = CM.DSM.matrix(g, { depth: 2 });
    assert.ok(host(m2.units.map((u) => u.name)).includes('src/ui'));
  });
  test('pyproject.toml ([project] i [tool.poetry]) → pakiet pip', () => {
    const g = build([F('svc/pyproject.toml', '[build-system]\nrequires = []\n[project]\nname = "svc-core"\n'),
      F('tools/pyproject.toml', '[tool.poetry]\nname = \'svc-tools\'\n'), F('svc/core.py', 'X = 1\n'), F('tools/run.py', 'import os\n')]);
    assert.deepEqual(host(g.packages), [{ name: 'svc-core', eco: 'pip', dir: 'svc' }, { name: 'svc-tools', eco: 'pip', dir: 'tools' }]);
  });
});
