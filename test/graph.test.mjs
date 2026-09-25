import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, ALL_FILTERS, host } from './harness.mjs';
import { FILES, META, EXPECTED_EDGES, EXPECTED_EXTERNALS } from './fixtures/sample-project.mjs';
import { FILES as MONO_FILES, META as MONO_META } from './fixtures/monorepo.mjs';
import { FILES as POLY_FILES, META as POLY_META } from './fixtures/polyglot.mjs';

const CM = loadCM();
const { Graph, diffSignatures } = CM.Graph;
const build = () => new Graph().build(FILES.map((f) => ({ ...f })), META);
const buildMono = () => new Graph().build(MONO_FILES.map((f) => ({ ...f })), MONO_META);
const buildPoly = () => new Graph().build(POLY_FILES.map((f) => ({ ...f })), POLY_META);
const edgeKeys = (g) => new Set(g.edges.filter((e) => e.type !== 'contains').map((e) => `${e.source}|${e.target}|${e.type}`));
/** Cele krawędzi import/reference wychodzących z pliku `src` (posortowane). */
const targetsOf = (g, src) => host(g.edges.filter((e) => e.source === src && e.type !== 'contains').map((e) => e.target).sort());

describe('Graph.build', () => {
  let g;
  beforeEach(() => { g = build(); });

  test('tworzy węzły plików, folderów i pakietów zewnętrznych', () => {
    const files = [...g.nodes.values()].filter((n) => n.type === 'file');
    const folders = [...g.nodes.values()].filter((n) => n.type === 'folder' && n.id !== '__root__' && n.id !== '__ext__');
    assert.equal(files.length, FILES.length);
    assert.deepEqual(host(folders.map((n) => n.id).sort()), ['assets', 'c', 'docs', 'go', 'go/cmd', 'go/pkg', 'go/pkg/util', 'java', 'java/com', 'java/com/x', 'java/com/x/util', 'py', 'py/pkg', 'src', 'src/lib', 'src/store', 'styles']);
    assert.equal(g.meta.name, 'sample');
    assert.equal(g.root.name, 'sample');
  });

  test('każdy plik ma rodzica, głębokość i krawędź contains', () => {
    for (const n of g.nodes.values()) {
      if (n.id === '__root__') continue;
      const p = g.nodes.get(n.parent);
      assert.ok(p, `parent of ${n.id}`);
      assert.equal(n.depth, p.depth + 1);
      assert.ok(p.children.includes(n.id));
      assert.ok(g.edges.some((e) => e.type === 'contains' && e.source === p.id && e.target === n.id));
    }
  });

  test('rozwiązuje oczekiwane importy i referencje', () => {
    const keys = edgeKeys(g);
    for (const [s, t, type] of EXPECTED_EDGES) assert.ok(keys.has(`${s}|${t}|${type}`), `missing ${s} → ${t} (${type})`);
  });

  test('import z komentarza nie tworzy krawędzi, brak duplikatów', () => {
    const keys = edgeKeys(g);
    assert.ok(![...keys].some((k) => k.includes('ghost')));
    assert.equal(keys.size, g.edges.filter((e) => e.type !== 'contains').length, 'edges must be unique');
  });

  test('pakiety zewnętrzne z importerami, wersją z package.json, bez <system> nagłówków', () => {
    for (const [name, importer] of EXPECTED_EXTERNALS) {
      const ex = g.externals.get(name);
      assert.ok(ex, `external ${name}`);
      assert.ok(ex.importers.includes(importer), `${name} imported by ${importer}`);
      assert.ok(g.nodes.has('ext:' + name));
    }
    assert.ok(!g.externals.has('stdio'), '<stdio.h> is a system include, not an external package');
    assert.equal(g.nodes.get('ext:react').version, '18.2.0');
    assert.equal(g.depVersions.get('lodash').version, '4.17.21');
  });

  test('metryki, symbole, hash i statystyki języków', () => {
    const idx = g.nodes.get('src/index.js');
    assert.equal(idx.metrics.lines, 9);
    assert.ok(idx.symbols.some((s) => s.name === 'main'));
    assert.match(idx.hash, /^[0-9a-f]+$/);
    assert.equal(g.nodes.get('assets/logo.png').hash, 'bin:1234');
    assert.equal(g.langStats.get('js').count, 8);
    assert.equal(g.langStats.get('py').count, 3);
  });

  test('stopnie importu i agregaty folderów', () => {
    assert.ok(g.nodes.get('src/lib/util.js').importsIn.includes('src/index.js'));
    assert.ok(g.nodes.get('src/index.js').importsOut.includes('src/app.js'));
    const src = g.nodes.get('src');
    assert.equal(src.descFiles, 8);
    assert.equal(src.langBreak.get('js'), 8);
    assert.ok(src.r > g.nodes.get('src/store').r, 'bigger folder → bigger radius');
  });
});

describe('getVisible', () => {
  test('domyślne filtry: bez __root__, wszystkie pliki, agregacja przy zwiniętym folderze', () => {
    const g = build();
    const v1 = g.getVisible(ALL_FILTERS);
    assert.ok(!v1.nodes.some((n) => n.id === '__root__'));
    assert.equal(v1.nodes.filter((n) => n.type === 'file').length, FILES.length);
    g.nodes.get('src/lib').collapsed = true;
    const v2 = g.getVisible(ALL_FILTERS);
    assert.ok(!v2.visSet.has('src/lib/util.js'), 'child of collapsed folder hidden');
    const agg = v2.edges.find((e) => e.source === 'src/index.js' && e.target === 'src/lib' && e.type === 'import');
    assert.ok(agg, 'edge re-targeted to the collapsed representative');
    const cyc = v2.edges.find((e) => e.source === 'src/lib' && e.target === 'src/app.js');
    assert.ok(cyc, 'reverse edge from representative');
  });
  test('filtry: bez plików, bez zależności zewnętrznych, języki wyłączone, próg metryki', () => {
    const g = build();
    assert.equal(g.getVisible({ ...ALL_FILTERS, files: false }).nodes.filter((n) => n.type === 'file').length, 0);
    assert.ok(!g.getVisible({ ...ALL_FILTERS, externals: false }).visSet.has('ext:react'));
    assert.ok(!g.getVisible({ ...ALL_FILTERS, langsOff: new Set(['py']) }).visSet.has('py/pkg/mod.py'));
    const big = g.getVisible({ ...ALL_FILTERS, minMetric: 5, metric: 'lines' });
    assert.ok(big.visSet.has('src/index.js') && !big.visSet.has('src/lazy.js'));
    assert.equal(g.getVisible({ ...ALL_FILTERS, import: false }).edges.filter((e) => e.type === 'import').length, 0);
  });
});

describe('analiza grafu', () => {
  test('importCycles znajduje cykl app ↔ lib/util i nic więcej', () => {
    const c = build().importCycles();
    assert.deepEqual(host(c.components.map((x) => x.sort())), [['src/app.js', 'src/lib/util.js']]);
    assert.ok(c.edges.has('src/app.js|src/lib/util.js') && c.edges.has('src/lib/util.js|src/app.js'));
    assert.deepEqual(host([...c.nodes].sort()), ['src/app.js', 'src/lib/util.js']);
  });
  test('impactSet: w górę i w dół po krawędziach kodu, bez fokusa', () => {
    const r = build().impactSet('src/store/reducer.js');
    assert.deepEqual(host([...r.up].sort()), ['index.html', 'src/app.js', 'src/index.js', 'src/lib/util.js', 'src/store/index.js']);   // index.html → src/index.js → … → reducer
    assert.equal(r.down.size, 0);
    assert.ok(!r.up.has('src/store/reducer.js'));
    const r2 = build().impactSet('src/index.js');
    assert.ok(r2.down.has('src/store/reducer.js') && r2.down.has('ext:react'));
  });
  test('neighbors', () => {
    const n = build().neighbors('src/app.js');
    assert.ok(n.out.has('src/store/index.js') && n.inc.has('src/index.js') && n.inc.has('src'));
  });
});

describe('zwijanie', () => {
  test('collapseToBudget wybiera najpłytszą głębokość mieszczącą się w budżecie', () => {
    const g = build();
    const depth = g.collapseToBudget(12);
    assert.equal(depth, 1);
    assert.ok(g.nodes.get('src').collapsed && g.nodes.get('src/lib').collapsed);
    assert.ok(g.getVisible(ALL_FILTERS).nodes.length <= 12 + 2, 'top level + collapsed chips fit the budget');
    const g2 = build();
    assert.ok(g2.collapseToBudget(10000) >= 4);
    assert.ok(!g2.nodes.get('src').collapsed);
  });
  test('expandAll odwraca collapseAll', () => {
    const g = build(); g.collapseAll(1); g.expandAll();
    assert.ok(![...g.nodes.values()].some((n) => n.collapsed));
  });
});

describe('serializacja', () => {
  test('toJSON/fromJSON zachowuje węzły, krawędzie, pozycje i meta', () => {
    const g = build();
    let i = 1; for (const n of g.nodes.values()) { n.x = i * 10.5; n.y = -i * 3.25; i++; }   // od 1: bez -0 (JSON gubi znak zera)
    g.nodes.get('src').collapsed = true;
    const j = JSON.parse(JSON.stringify(g.toJSON()));
    assert.equal(j.format, 'codemap');
    assert.equal(j.version, 2);
    assert.ok(!j.edges.some((e) => e.type === 'contains'), 'contains edges are rebuilt, not stored');
    const g2 = Graph.fromJSON(j);
    assert.equal(g2.nodes.size, g.nodes.size);
    assert.deepEqual(edgeKeys(g2), edgeKeys(g));
    for (const n of g.nodes.values()) {
      const m = g2.nodes.get(n.id);
      assert.ok(m, n.id); assert.equal(m.x, n.x); assert.equal(m.y, n.y); assert.equal(!!m.collapsed, !!n.collapsed);
    }
    assert.equal(g2.meta.name, 'sample');
    assert.equal(g2.nodes.get('src').descFiles, 8, 'aggregates recomputed');
    assert.equal(g2.langStats.get('js').count, 8);
    assert.ok(g2.nodes.get('src/lib/util.js').importsIn.includes('src/index.js'), 'import degrees recomputed');
  });
});

describe('aliasy tsconfig/jsconfig per katalog', () => {
  test('najbliższy config wygrywa; dwa pakiety z tym samym aliasem @/* się nie mieszają', () => {
    const g = buildMono();
    assert.deepEqual(targetsOf(g, 'packages/a/src/main.ts'), ['ext:@root/gen', 'packages/a/src/x.ts', 'packages/shared/src/util.ts']);
    assert.deepEqual(targetsOf(g, 'packages/b/src/main.ts'), ['ext:@shared/util', 'packages/b/lib/x.ts']);
  });
  test('extends scala paths i baseUrl z bazy (z rozszerzeniem .json i bez); root nie przecieka do pakietów', () => {
    const g = buildMono();
    // scripts/ nie ma własnego configu → root tsconfig.json (+ baza przez extends); `@/*` root nie zna
    assert.deepEqual(targetsOf(g, 'scripts/build.ts'), ['ext:@/x', 'packages/shared/src/util.ts', 'tools/gen.ts']);
    // `@root/*` z root tsconfig.json NIE obowiązuje w packages/a (a rozszerza tylko bazę)
    assert.ok(!edgeKeys(g).has('packages/a/src/main.ts|tools/gen.ts|import'));
  });
  test('manifestEntry: tsconfig z samym extends też jest konfiguracją; JSONC; uszkodzony → null', () => {
    const A = CM.Analysis;
    const e = host(A.manifestEntry('tsconfig.json', '{ "extends": "./base.json", /* c */ }', 'pkg'));
    assert.deepEqual(e, { kind: 'alias', dir: 'pkg', file: 'pkg/tsconfig.json', primary: true, baseUrl: null, paths: null, extends: './base.json' });
    assert.equal(host(A.manifestEntry('tsconfig.build.json', '{ "compilerOptions": { "baseUrl": "src" } }', '')).primary, false);
    assert.equal(A.manifestEntry('tsconfig.json', '{ not json', ''), null);
    assert.equal(A.manifestEntry('tsconfig.json', '{ "compilerOptions": { "strict": true } }', ''), null, 'bez paths/baseUrl/extends nie ma czego rozwiązywać');
  });
});

describe('workspaces monorepo', () => {
  test('import po nazwie pakietu → main / exports["."] / exports subpath + wzorzec / string exports / folder', () => {
    const g = buildMono();
    assert.deepEqual(targetsOf(g, 'packages/a/src/uses.ts'), [
      'ext:left-pad',
      'packages/b/lib/feat/one.ts',      // exports["./feat/*"]
      'packages/b/lib/index.mjs',        // exports["."].import
      'packages/b/lib/x.ts',             // exports["./x"]
      'packages/c/c.ts',                 // exports jako string
      'packages/shared/src/index.ts',    // main
      'packages/util',                   // brak main/index → folder pakietu
      'packages/util/helper.ts',         // podścieżka bez exports → plik w pakiecie
    ]);
  });
  test('pakiety workspace nie są zależnościami zewnętrznymi; nieznany pakiet nadal jest', () => {
    const g = buildMono();
    for (const name of ['@mono/shared', '@mono/b', '@mono/c', 'util-pkg']) assert.ok(!g.externals.has(name), `${name} nie może być external`);
    assert.ok(g.externals.has('left-pad'));
    assert.equal(host(CM.Analysis.manifestEntry('package.json', '{ "name": "@s/p", "main": "x.js" }', 'pk')).name, '@s/p');
    assert.equal(CM.Analysis.manifestEntry('package.json', '{ "private": true }', ''), null, 'bez nazwy nie ma czego mapować');
  });
});

describe('dynamiczne odwołania JS', () => {
  test('Worker / SharedWorker / new URL(import.meta.url) / require.resolve / import.meta.glob → krawędzie import', () => {
    const g = buildPoly();
    assert.deepEqual(targetsOf(g, 'web/main.js'), [
      'web/assets/mod.wasm',        // new URL('./assets/mod.wasm', import.meta.url) — też zasób binarny
      'web/config.js',              // require.resolve('./config')
      'web/plugins/p1.js', 'web/plugins/p2.js',          // glob './plugins/*.js' — bez nested/p3.js
      'web/views/Home.vue', 'web/views/admin/Users.vue', // glob './views/**/*.vue' minus '!./views/**/skip.vue'
      'web/workers/heavy.js',       // new Worker('./workers/heavy.js', {type:'module'})
      'web/workers/shared.js',      // new SharedWorker(new URL('./workers/shared.js', import.meta.url))
    ]);
    assert.ok(g.edges.filter((e) => e.source === 'web/main.js' && e.type !== 'contains').every((e) => e.type === 'import'));
    assert.deepEqual(targetsOf(g, 'web/workers/heavy.js'), ['web/workers/b.js', 'web/workers/lib/a.js']);   // importScripts
    assert.ok(!g.externals.has('api') && !g.externals.has('https'), 'URL-e absolutne i /api nie są zależnościami');
  });
});

describe('sygnatury i diff', () => {
  test('diffSignatures: dodane, zmienione, usunięte, delty', () => {
    const a = build().signature();
    const files2 = FILES.filter((f) => f.path !== 'docs/arch.md').map((f) => ({ ...f }));
    const idx = files2.find((f) => f.path === 'src/lazy.js'); idx.content = 'export const lazy = false;\n// extra\n'; idx.size = idx.content.length;
    files2.push({ path: 'src/new.js', content: 'export const n = 1;\n', size: 20, mtime: 1 });
    const b = new Graph().build(files2, META).signature();
    const d = diffSignatures(a, b);
    assert.deepEqual(host(d.added.map((f) => f.path)), ['src/new.js']);
    assert.deepEqual(host(d.removed.map((f) => f.path)), ['docs/arch.md']);
    assert.deepEqual(host(d.modified.map((f) => [f.path, f.dLines])), [['src/lazy.js', 1]]);
    assert.equal(d.unchanged.length, FILES.length - 2);
    assert.equal(d.dFiles, 0);
    assert.equal(a.files.length, FILES.length);
    assert.ok(a.files.every((f, i) => i === 0 || a.files[i - 1].path < f.path), 'sorted by path');
  });
});
