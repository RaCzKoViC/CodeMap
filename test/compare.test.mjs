import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE, ALL_FILTERS } from './harness.mjs';

// Porównywanie schematów (js/compare.js) na prawdziwym grafie (CM.Graph) i zaślepce CM.App: dołączanie drugiego
// schematu z prefiksem id, stopnie importów, języki, czyszczenie, cykle zależności, historia i diff migawek.
const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
const FILES_A = [
  { path: 'src/a.js', size: 30, content: "import './b.js';\nexport const a = 1;\n" },
  { path: 'src/b.js', size: 20, content: "import './a.js';\nexport const b = 2;\n" },
];
const FILES_B = [
  { path: 'lib/x.py', size: 10, content: 'import y\n' },
  { path: 'y.py', size: 5, content: 'print(1)\n' },
  { path: 'lib/z.js', size: 8, content: "import '../y.py';\n" },
];

function load({ files = FILES_A, empty = false } = {}) {
  const log = [], toasts = [];
  const A = { state: { groups: [], gidSeq: 0, counts: { nodes: 0 }, layout: 'pack', displayLayout: 'pack', spacing: 1, vis: { nodes: [], edges: [] } },
    filters: { ...ALL_FILTERS, langsOff: new Set() }, handlers: {}, _ingestGen: 0,
    renderer: { setGroups: (g) => log.push(['groups', g.length]), setData() {}, setCycles: (e) => log.push(['cycles', e ? (e.size ?? e.length) : null]), fit() {} },
    countsInit: () => { A.state.counts.nodes = A.graph.nodes.size; }, apply: (o) => log.push(['apply', o]), updateStatus() {},
    loadFromJSON: (obj) => log.push(['loadFromJSON', obj.format]), openModal: (id) => log.push(['open', id]), closeModal() {},
    showLoading: (s) => log.push(['loading', s]), hideLoading: () => log.push(['hide']), setProgress() {}, setLoadingText() {}, tick: async () => {},
    // pomocniki wczytywania z app-core.js (A.isMapFile / noFiles / loadError / needProject), których używa compare.js
    isMapFile: (obj) => { if (obj && obj.format === 'codemap') return true; toasts.push(['To nie jest plik mapy CodeMap.', 'error']); return false; },
    noFiles: (files) => { if (files && files.length) return false; toasts.push(['Nie znaleziono pasujących plików.', 'error']); A.hideLoading(); return true; },
    loadError: (e) => { toasts.push(['Błąd wczytywania: ' + e.message, 'error']); },
    needProject: () => { if (A.state.counts.nodes !== 0) return true; toasts.push(['Najpierw wczytaj projekt.', 'error']); return false; } };
  const UI = { renderDiff: (d, a, b) => log.push(['diff', d.added.length, d.removed.length, a.label, b.label]) };
  const CM = loadCM([...CORE, 'compare'], { CM: { App: A, UI, Loaders: {}, Storage: {} }, setTimeout: setTimeoutUnref, requestAnimationFrame: () => 0 });
  CM.util.toast = (m, k) => toasts.push([String(m), k || '']);
  A.graph = new CM.Graph.Graph();
  if (!empty) { A.graph.build(files, { name: 'baza', owner: { login: 'ala' } }); A.countsInit(); }
  return { A, CM, log, toasts };
}
const build = (CM, files, meta) => { const g = new CM.Graph.Graph(); g.build(files, meta); return g; };

describe('graphBounds, tagBaseGroup', () => {
  test('graphBounds: promień węzła w granicach, korzeń i współrzędne nieskończone pomijane; pusto → zera', () => {
    const { A } = load();
    const b = host(A.graphBounds([{ id: '__root__', x: -999, y: 0 }, { id: 'a', x: 0, y: 0, r: 10 }, { id: 'b', x: 100, y: 50 }, { id: 'c', x: NaN, y: 0 }]));
    assert.deepEqual(b, { minX: -10, maxX: 108, minY: -10, maxY: 58 });
    assert.deepEqual(host(A.graphBounds([])), { minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });
  test('tagBaseGroup: węzły bazowe dostają gid „base", grupa z nazwą i właścicielem; drugi raz bez zmian', () => {
    const { A } = load();
    A.tagBaseGroup(); A.tagBaseGroup();
    assert.equal(A.state.groups.length, 1);
    assert.equal(A.state.groups[0].name, 'baza'); assert.equal(A.state.groups[0].owner.login, 'ala');
    assert.ok([...A.graph.nodes.values()].every((n) => n.gid === 'base'));
  });
});

describe('mergeGraphInstance / mergeGraph / clearCompare', () => {
  test('drugi schemat: id z prefiksem g1:, rodzice/dzieci przepisane, stopnie importów policzone, języki zsumowane', () => {
    const { A, CM, log, toasts } = load();
    const before = A.graph.nodes.size;
    A.mergeGraphInstance(build(CM, FILES_B, { name: 'porównanie' }));
    const x = A.graph.nodes.get('g1:lib/x.py');
    assert.ok(x); assert.equal(x.gid, 'g1'); assert.equal(x.parent, 'g1:lib');
    assert.ok(A.graph.nodes.get('g1:lib').children.includes('g1:lib/x.py'));
    const imports = A.graph.edges.filter((e) => e.source.startsWith('g1:') && e.type === 'import');
    assert.ok(imports.length >= 1);
    for (const e of imports) {
      assert.ok(A.graph.nodes.get(e.source).importsOut.includes(e.target));
      assert.ok(A.graph.nodes.get(e.target).importsIn.includes(e.source));
    }
    assert.equal(A.graph.nodes.get('src/a.js').gid, 'base');
    assert.equal(A.graph.langStats.get('py').count, 2);
    assert.equal(A.graph.langStats.get('js').count, 3);
    assert.deepEqual(host(A.state.groups.map((g) => [g.gid, g.name])), [['base', 'baza'], ['g1', 'porównanie']]);
    assert.notEqual(A.state.groups[0].color, A.state.groups[1].color);
    assert.equal(A.state.layout, 'pack');
    assert.deepEqual(host(log.filter((l) => l[0] === 'apply').at(-1)), ['apply', { relayout: true, refit: true }]);
    assert.ok(A.graph.nodes.size > before);
    assert.match(toasts.at(-1)[0], /porównanie/);
  });
  test('mergeGraph: nie-mapa → komunikat; pusta aplikacja → zwykłe wczytanie mapy', () => {
    const { A, CM, toasts } = load();
    A.mergeGraph({ format: 'inne' });
    assert.equal(toasts[0][1], 'error');
    const e = load({ empty: true });
    e.A.mergeGraph(build(CM, FILES_B, { name: 'x' }).toJSON());
    assert.deepEqual(e.log.at(-1), ['loadFromJSON', 'codemap']);
  });
  test('clearCompare: usuwa schematy porównawcze i ich krawędzie, gid zdjęty; bez schematów → komunikat', () => {
    const { A, CM, toasts } = load();
    A.clearCompare();
    assert.equal(toasts[0][1], 'error');
    const base = A.graph.nodes.size, edges = A.graph.edges.length;
    A.mergeGraphInstance(build(CM, FILES_B, { name: 'x' }));
    A.clearCompare();
    assert.equal(A.graph.nodes.size, base); assert.equal(A.graph.edges.length, edges);
    assert.ok([...A.graph.nodes.values()].every((n) => n.gid === undefined));
    assert.deepEqual(host(A.state.groups), []);
  });
});

describe('addCompareSource', () => {
  test('bez głównego projektu → komunikat; brak plików → komunikat i ukrycie ładowania; sukces → schemat dołączony', async () => {
    const e = load({ empty: true });
    await e.A.addCompareSource(async () => ({ files: FILES_B, meta: { name: 'x' } }), 'st');
    assert.equal(e.toasts[0][1], 'error');
    const { A, log, toasts } = load();
    await A.addCompareSource(async () => ({ files: [], meta: {} }), 'Czytanie…');
    assert.equal(toasts[0][0], 'Nie znaleziono pasujących plików.');
    assert.deepEqual(log.slice(0, 2), [['loading', 'Czytanie…'], ['hide']]);
    await A.addCompareSource(async () => ({ files: FILES_B, meta: { name: 'druga' } }), 's');
    assert.equal(A.state.groups.at(-1).name, 'druga');
  });
  test('anulowanie (nowsze wczytanie w trakcie) → wynik porzucony; błąd źródła → komunikat', async () => {
    const { A, toasts } = load();
    await A.addCompareSource(async () => { A._ingestGen++; return { files: FILES_B, meta: { name: 'x' } }; }, 's');
    assert.equal(A.state.groups.length, 0);
    const err = console.error; console.error = () => {};
    try { await A.addCompareSource(async () => { throw new Error('404 repo'); }, 's'); } finally { console.error = err; }
    assert.match(toasts.at(-1)[0], /404 repo$/);
  });
});

describe('cykle, historia, układ grup', () => {
  test('toggleCycles: cykl a ↔ b wykryty i podświetlony, drugi raz wyłącza; projekt bez cykli → komunikat sukcesu', () => {
    const { A, log, toasts } = load();
    A.toggleCycles();
    assert.equal(A.state.cyclesOn, true);
    assert.ok(log.some((l) => l[0] === 'cycles' && l[1] >= 2));
    assert.match(toasts.at(-1)[0], /<b>1<\/b>/);
    A.toggleCycles();
    assert.equal(A.state.cyclesOn, false);
    assert.deepEqual(log.at(-1), ['cycles', null]);
    const ok = load({ files: FILES_B });
    ok.A.toggleCycles();
    assert.equal(ok.toasts.at(-1)[1], 'success'); assert.notEqual(ok.A.state.cyclesOn, true);
  });
  test('doCompare: diff sygnatur migawek do okna różnic', () => {
    const { A, CM, log } = load();
    const sa = build(CM, FILES_A, {}).signature(), sb = build(CM, [...FILES_A.slice(0, 1), FILES_B[1]], {}).signature();
    A.doCompare({ label: 'v1', signature: sa }, { label: 'v2', signature: sb });
    assert.deepEqual(log.find((l) => l[0] === 'diff'), ['diff', 1, 1, 'v1', 'v2']);
    assert.deepEqual(log.at(-1), ['open', 'modal-diff']);
    assert.equal(A.state.lastDiff.added[0].path, 'y.py');
  });
  test('relayoutGroups: schematy ułożone obok siebie bez nakładania', () => {
    const { A, CM } = load();
    A.mergeGraphInstance(build(CM, FILES_B, { name: 'x' }));
    A.state.vis = A.graph.getVisible(A.filters);
    A.relayoutGroups();
    const box = (gid) => A.graphBounds(A.state.vis.nodes.filter((n) => (n.gid || 'base') === gid));
    assert.ok(box('g1').minX > box('base').maxX, 'drugi schemat na prawo od pierwszego');
    assert.equal(A.state.sim, null);
  });
});
