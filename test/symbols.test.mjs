import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, CORE, ALL_FILTERS, host } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';
import { SAMPLES, loadTreeSitter, loadCore, checkSample } from '../tools/symbols-probe.mjs';

const CM = loadCM([...CORE, 'symbols-core']);
const Core = CM.SymbolsCore;
const { Graph } = CM.Graph;
const build = () => new Graph().build(FILES.map((f) => ({ ...f })), META);
const SYM_ON = { ...ALL_FILTERS, symbols: true, call: true };

// wyniki „jak z workera" dla projektu testowego: app.js woła helper (z importowanego lib/util.js),
// index.js tworzy App (z importowanego app.js), util.js woła siebie rekurencyjnie i nieznane `log`
const RESULTS = [
  { path: 'src/app.js', symbols: [
    { name: 'App', kind: 'class', line: 3, endLine: 3, calls: [] },
    { name: 'run', kind: 'method', line: 3, endLine: 3, calls: ['helper', 'store'] },
  ] },
  { path: 'src/lib/util.js', symbols: [
    { name: 'helper', kind: 'function', line: 2, endLine: 2, calls: ['helper', 'log'] },
  ] },
  { path: 'src/index.js', symbols: [
    { name: 'main', kind: 'function', line: 8, endLine: 8, calls: ['App', 'run'], member: ['run'] },   // new App().run()
  ] },
  { path: 'nie/istnieje.js', symbols: [{ name: 'x', kind: 'function', line: 1, endLine: 1, calls: [] }] },
];
const id = (path, name, line) => path + '#' + name + '@' + line;

describe('SymbolsCore', () => {
  test('grammarFor: klucz języka i rozszerzenie ścieżki', () => {
    assert.equal(Core.grammarFor('js'), 'javascript');
    assert.equal(Core.grammarFor('tsx'), 'tsx');
    assert.equal(Core.grammarFor('rs'), 'rust');
    assert.equal(Core.grammarFor('cs'), 'c_sharp');
    assert.equal(Core.grammarFor('h'), 'cpp', '.h parsujemy gramatyką C++ (nadzbiór C)');
    assert.equal(Core.grammarFor(null, 'a/b/c.rb'), 'ruby');
    assert.equal(Core.grammarFor('md', 'x.md'), null);
    assert.equal(host(Core.GRAMMARS).length, 12);
  });
  test('resolveCalls: ten sam plik → importowane pliki; bez rekurencji i duplikatów; nieznane pominięte', () => {
    const perFile = [
      { path: 'a.js', symbols: [{ id: 'a#f', name: 'f', calls: ['g', 'f', 'h', 'g', 'nope'] }, { id: 'a#g', name: 'g', calls: [] }] },
      { path: 'b.js', symbols: [{ id: 'b#h', name: 'h', calls: ['g'] }] },
      { path: 'c.js', symbols: [{ id: 'c#h', name: 'h', calls: [] }] },
    ];
    const imports = { 'a.js': ['b.js', 'c.js'], 'b.js': [] };
    const edges = host(Core.resolveCalls(perFile, (p) => imports[p] || []));
    assert.deepEqual(edges, [{ source: 'a#f', target: 'a#g' }, { source: 'a#f', target: 'b#h' }]);
  });
  test('resolveCalls z nazwami importów: goła nazwa tylko importowana, przez kropkę każdy import, bez metod wbudowanych (poza this.), metoda-owijka', () => {
    const perFile = [
      { path: 'a.js', symbols: [
        { id: 'a#caller', name: 'caller', calls: ['imported', 'notImported', 'method', 'get', 'wrap', 'viaDefault'], member: ['method', 'get'] },
        { id: 'a#wrap', name: 'wrap', calls: ['wrap'] },                                   // wrap(){ return wrap(x) } — z importu
        { id: 'a#own', name: 'own', calls: ['get'], member: ['get'], self: ['get'] },     // this.get()
        { id: 'a#get', name: 'get', calls: [] },
      ] },
      { path: 'b.js', symbols: ['imported', 'notImported', 'method', 'get', 'wrap'].map((n) => ({ id: 'b#' + n, name: n, calls: [] })) },
      { path: 'c.js', symbols: [{ id: 'c#viaDefault', name: 'viaDefault', calls: [] }] },
    ];
    const imports = { 'a.js': [{ path: 'b.js', names: ['imported', 'wrap'] }, { path: 'c.js', names: ['default'] }] };
    const edges = host(Core.resolveCalls(perFile, (p) => imports[p] || [])).map((e) => e.source + ' → ' + e.target).sort();
    assert.deepEqual(edges, [
      'a#caller → a#wrap',           // lokalna definicja inna niż wołający
      'a#caller → b#imported',
      'a#caller → b#method',         // przez kropkę: nazwa nie musi być importowana
      'a#caller → c#viaDefault',     // import domyślny — lokalna nazwa dowolna
      'a#own → a#get',               // this.get() — własna metoda, mimo nazwy wbudowanej
      'a#wrap → b#wrap',             // jedyna lokalna „wrap" to wołający, a wrap jest jawnie importowane
    ]);                              // bez: notImported (goła, nieimportowana), caller → get (x.get() — Map.get)
  });
  test('resolveCalls: lokalna definicja ma pierwszeństwo przed importem o tej samej nazwie', () => {
    const perFile = [
      { path: 'a.js', symbols: [{ id: 'a#f', name: 'f', calls: ['h'] }, { id: 'a#h', name: 'h', calls: [] }] },
      { path: 'b.js', symbols: [{ id: 'b#h', name: 'h', calls: [] }] },
    ];
    assert.deepEqual(host(Core.resolveCalls(perFile, () => ['b.js'])), [{ source: 'a#f', target: 'a#h' }]);
  });
});

describe('tree-sitter: prawdziwe parsowanie 12 języków', async () => {
  const ts = await loadTreeSitter();
  const RealCore = loadCore();
  for (const [key, sample] of Object.entries(SAMPLES)) {
    test(`${key} → ${RealCore.grammarFor(key)}`, { skip: ts ? false : 'brak web-tree-sitter / tree-sitter-wasms' }, async () => {
      const res = await RealCore.analyzeBatch(ts.Parser, [{ path: 'x.' + key, lang: key, content: sample.src }], ts.load, {});
      assert.equal(res.length, 1, 'one result');
      assert.ok(!res[0].error, res[0].error);
      assert.deepEqual(checkSample(key, sample, res[0].symbols), []);
      for (const s of res[0].symbols) { assert.ok(s.line >= 1 && s.endLine >= s.line); }
    });
  }
  test('extract: wywołania gołe, przez kropkę (member) i przez this. (self), także metody prywatne #p', { skip: ts ? false : 'brak pakietów' }, async () => {
    const src = 'class A { m(){ this.b(); x.get(); helper(); this.#p(); } b(){} #p(){} }\nfunction helper(){ return y.z(); }\n';
    const [r] = await RealCore.analyzeBatch(ts.Parser, [{ path: 'a.js', lang: 'js', content: src }], ts.load, {});
    const m = r.symbols.find((s) => s.name === 'm'), h = r.symbols.find((s) => s.name === 'helper');
    assert.deepEqual(host([m.calls, m.member, m.self]), [['b', 'get', 'helper', '#p'], ['b', 'get', '#p'], ['b', '#p']]);
    assert.deepEqual(host([h.calls, h.member, h.self || null]), [['z'], ['z'], null]);
  });
  test('analyzeBatch: plik bez gramatyki pominięty, anulowanie przerywa partię, postęp raportowany', { skip: ts ? false : 'brak pakietów' }, async () => {
    const files = [{ path: 'a.md', lang: 'md', content: '# x' }];
    for (let i = 0; i < 45; i++) files.push({ path: `f${i}.js`, lang: 'js', content: `function f${i}(){ return g(); }` });
    const progress = [];
    const all = await RealCore.analyzeBatch(ts.Parser, files, ts.load, { onProgress: (d, t) => { progress.push([d, t]); } });
    assert.equal(all.length, 45);
    assert.deepEqual(progress[progress.length - 1], [46, 46]);
    let n = 0;
    const cut = await RealCore.analyzeBatch(ts.Parser, files, ts.load, { cancelled: () => ++n > 10 });
    assert.ok(cut.length < 45, 'cancelled batch stops early');
  });
});

describe('Graph + symbole', () => {
  test('addSymbols: węzły symboli pod plikiem, plik zwinięty, contains, wywołania przez import', () => {
    const g = build(); const nodes0 = g.nodes.size;
    const info = host(g.addSymbols(RESULTS));
    assert.deepEqual({ count: info.count, calls: info.calls, files: info.files }, { count: 4, calls: 3, files: 3 });
    assert.equal(g.nodes.size, nodes0 + 4, 'plik spoza projektu pominięty');
    const run = g.nodes.get(id('src/app.js', 'run', 3));
    assert.equal(run.type, 'symbol'); assert.equal(run.kind, 'method'); assert.equal(run.parent, 'src/app.js');
    assert.equal(run.depth, g.nodes.get('src/app.js').depth + 1);
    assert.equal(run.lang, 'js'); assert.ok(run.langInfo && run.langInfo.color);
    const app = g.nodes.get('src/app.js');
    assert.equal(app.collapsed, true); assert.equal(app.symbolCount, 2);
    assert.ok(app.children.includes(run.id));
    assert.ok(g.edges.some((e) => e.type === 'contains' && e.source === 'src/app.js' && e.target === run.id));
    const calls = g.edges.filter((e) => e.type === 'call').map((e) => e.source + ' → ' + e.target).sort();
    assert.deepEqual(host(calls), [
      id('src/app.js', 'run', 3) + ' → ' + id('src/lib/util.js', 'helper', 2),     // import ./lib/util
      id('src/index.js', 'main', 8) + ' → ' + id('src/app.js', 'App', 3),          // import ./app
      id('src/index.js', 'main', 8) + ' → ' + id('src/app.js', 'run', 3),
    ].sort());
    assert.equal(g.nodes.get(id('src/lib/util.js', 'helper', 2)).callsIn, 1);
    assert.ok(run.r >= 3.5 && run.r <= 6);
  });
  test('getVisible: symbole ukryte bez filtra; przy zwiniętym pliku wywołania agregują się do plik → plik', () => {
    const g = build(); g.addSymbols(RESULTS);
    const off = g.getVisible(ALL_FILTERS);
    assert.ok(!off.nodes.some((n) => n.type === 'symbol'));
    assert.ok(!off.edges.some((e) => e.type === 'call'));
    const on = g.getVisible(SYM_ON);
    assert.ok(!on.nodes.some((n) => n.type === 'symbol'), 'pliki zwinięte → symbole schowane');
    assert.ok(on.edges.some((e) => e.type === 'call' && e.source === 'src/app.js' && e.target === 'src/lib/util.js'));
    g.nodes.get('src/app.js').collapsed = false;
    const exp = g.getVisible(SYM_ON);
    assert.ok(exp.visSet.has(id('src/app.js', 'run', 3)));
    assert.ok(exp.edges.some((e) => e.type === 'call' && e.source === id('src/app.js', 'run', 3) && e.target === 'src/lib/util.js'));
    assert.ok(!g.getVisible({ ...SYM_ON, call: false }).edges.some((e) => e.type === 'call'));
  });
  test('toJSON/fromJSON: symbole, wywołania i zwinięcie przeżywają zapis mapy', () => {
    const g = build(); g.addSymbols(RESULTS);
    const g2 = Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    const run = g2.nodes.get(id('src/app.js', 'run', 3));
    assert.ok(run && run.type === 'symbol' && run.kind === 'method' && run.line === 3 && run.endLine === 3);
    assert.ok(run.langInfo && run.langInfo.color, 'kolor języka odziedziczony po pliku');
    assert.equal(g2.edges.filter((e) => e.type === 'call').length, 3);
    assert.equal(g2.nodes.get('src/app.js').collapsed, true);
    assert.equal(g2.nodes.get('src/app.js').symbolCount, 2);
    assert.ok(g2.edges.some((e) => e.type === 'contains' && e.target === run.id));
    assert.equal(host(g2.symbolsInfo).count, 4);
    assert.equal(g2.nodes.get(id('src/lib/util.js', 'helper', 2)).callsIn, 1);
    assert.equal(g2.nodes.get('src').descFiles, 8, 'symbole nie liczą się jako pliki');
  });
  test('removeSymbols przywraca graf sprzed analizy; ponowne addSymbols nie dubluje', () => {
    const g = build(); const n0 = g.nodes.size, e0 = g.edges.length;
    g.addSymbols(RESULTS); g.addSymbols(RESULTS);
    assert.equal(g.nodes.size, n0 + 4);
    g.removeSymbols();
    assert.equal(g.nodes.size, n0); assert.equal(g.edges.length, e0);
    assert.equal(g.nodes.get('src/app.js').collapsed, false);
    assert.equal(g.nodes.get('src/app.js').symbolCount, undefined);
    assert.equal(g.symbolsInfo, null);
  });
});
