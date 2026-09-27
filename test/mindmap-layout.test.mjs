import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Geometria układów MindMap (js/mindmap-layout.js): kierunki drzew, radialny, siatka, warstwy, oś czasu, gwiazda,
// wyprowadzanie hierarchii z wolnych krawędzi oraz okno „Schemat układu" na minimalnym DOM.
const MODS = ['util', 'icons', 'i18n', 'mindmap-strings', 'mindmap-templates', 'mindmap-layout'];
const CM = loadCM(MODS);
const L = CM.MindMapLayout;

const node = (id, parent = null, w = 100) => ({ id, parent, x: 0, y: 0, w, text: id });
// R → A (A1, A2), B, C
const treeMap = () => ({ nodes: [node('R'), node('A', 'R'), node('A1', 'A'), node('A2', 'A'), node('B', 'R'), node('C', 'R')], edges: [], spaceMain: 240, spaceCross: 70 });
const by = (st) => Object.fromEntries(st.nodes.map((n) => [n.id, n]));
const cx = (n) => n.x + n.w / 2, cy = (n) => n.y + 30;
const centroid = (st) => [st.nodes.reduce((s, n) => s + cx(n), 0) / st.nodes.length, st.nodes.reduce((s, n) => s + cy(n), 0) / st.nodes.length];
const near0 = (v) => Math.abs(v) < 1e-9;

describe('hierarchia', () => {
  test('forest: węzeł z nieistniejącym rodzicem jest korzeniem; dzieci w kolejności', () => {
    const f = L.forest({ nodes: [node('a'), node('b', 'a'), node('c', 'zniknął'), node('d', 'a')] });
    assert.deepEqual(host(f.roots), ['a', 'c']);
    assert.deepEqual(host(f.children.get('a')), ['b', 'd']);
  });
  test('ensureHierarchy: korzeń = węzeł o największym stopniu, krawędzie drzewa stają się rodzicami, reszta zostaje', () => {
    const st = { nodes: ['h', 'x', 'y', 'z', 'solo'].map((i) => node(i)),
      edges: [{ from: 'x', to: 'h' }, { from: 'h', to: 'y' }, { from: 'h', to: 'z' }, { from: 'y', to: 'z' }, { from: 'q', to: 'h' }] };
    L.ensureHierarchy(st);
    const n = by(st);
    assert.equal(n.h.parent, null); assert.equal(n.x.parent, 'h'); assert.equal(n.y.parent, 'h'); assert.equal(n.z.parent, 'h');
    assert.equal(n.solo.parent, null, 'osobny składnik = własny korzeń');
    assert.deepEqual(host(st.edges), [{ from: 'y', to: 'z' }, { from: 'q', to: 'h' }], 'krawędź poprzeczna i do nieistniejącego węzła zostają');
  });
  test('ensureHierarchy nie rusza map, które mają już rodziców albo nie mają krawędzi', () => {
    const st = treeMap(); st.edges = [{ from: 'B', to: 'C' }];
    L.ensureHierarchy(st);
    assert.equal(st.edges.length, 1);
    const empty = { nodes: [node('a'), node('b')], edges: [] };
    L.ensureHierarchy(empty);
    assert.ok(empty.nodes.every((n) => n.parent == null));
  });
});

describe('układy drzewa w 6 kierunkach', () => {
  test('right / left / down / up: dzieci po właściwej stronie rodzica, mapa wyśrodkowana', () => {
    const cases = { right: (p, c) => c.x > p.x, left: (p, c) => c.x < p.x, down: (p, c) => c.y > p.y, up: (p, c) => c.y < p.y };
    for (const [mode, side] of Object.entries(cases)) {
      const st = treeMap(); L.apply(st, mode);
      const n = by(st);
      assert.equal(st.layout, mode);
      for (const k of ['A', 'B', 'C']) assert.ok(side(n.R, n[k]), `${mode}: ${k}`);
      for (const k of ['A1', 'A2']) assert.ok(side(n.A, n[k]), `${mode}: ${k}`);
      const [x, y] = centroid(st); assert.ok(near0(x) && near0(y), `${mode}: środek`);
    }
  });
  test('rodzic na środku swoich dzieci (oś poprzeczna); liście w odstępach spaceCross', () => {
    const st = treeMap(); L.apply(st, 'right');
    const n = by(st);
    assert.equal(cy(n.A), (cy(n.A1) + cy(n.A2)) / 2);
    assert.equal(n.A2.y - n.A1.y, 70);
  });
  test('leftright / updown: połowa gałęzi korzenia po każdej stronie', () => {
    const st = treeMap(); L.apply(st, 'leftright');
    const n = by(st);
    assert.ok(n.A.x > n.R.x && n.B.x > n.R.x, 'pierwsza połowa w prawo');
    assert.ok(n.C.x < n.R.x, 'druga połowa w lewo');
    const s2 = treeMap(); L.apply(s2, 'updown'); const m = by(s2);
    assert.ok(m.A.y > m.R.y && m.C.y < m.R.y);
  });
  test('free: pozycje bez zmian', () => {
    const st = treeMap(); st.nodes[1].x = 123;
    L.apply(st, 'free');
    assert.equal(st.layout, 'free'); assert.equal(by(st).A.x, 123);
  });
});

describe('układy geometryczne', () => {
  test('radial: dzieci korzenia na pierwszym pierścieniu, wnuki na drugim (odległość od korzenia)', () => {
    const st = treeMap(); L.radial(st);
    const n = by(st), d = (a) => Math.hypot(cx(a) - cx(n.R), cy(a) - cy(n.R)), ring = 240 * 0.8;
    for (const k of ['A', 'B', 'C']) assert.ok(Math.abs(d(n[k]) - ring) < 1e-6, k);
    for (const k of ['A1', 'A2']) assert.ok(Math.abs(d(n[k]) - 2 * ring) < 1e-6, k);
  });
  test('grid: ceil(√N) kolumn, wiersze co spaceCross+78', () => {
    const st = treeMap(); L.grid(st);
    const cols = new Set(st.nodes.map((n) => Math.round(cx(n)))).size, rows = new Set(st.nodes.map((n) => n.y)).size;
    assert.equal(cols, 3); assert.equal(rows, 2);
    const ys = [...new Set(st.nodes.map((n) => n.y))].sort((a, b) => a - b);
    assert.equal(ys[1] - ys[0], 70 + 78);
  });
  test('layers: głębokość = pas; timeAxis: x rośnie w kolejności, y na przemian', () => {
    const st = treeMap(); L.layers(st);
    const n = by(st);
    assert.ok(n.R.y < n.A.y && n.A.y === n.B.y && n.A.y < n.A1.y);
    const t = treeMap(); L.timeAxis(t);
    const order = L.hierarchyOrder(t).map((o) => o.n);
    for (let i = 1; i < order.length; i++) { assert.ok(order[i].x > order[i - 1].x); assert.equal(Math.sign(order[i].y - order[i - 1].y) !== 0, true); }
  });
  test('spiral: skończone, wyśrodkowane; fishbone: głowa po prawej, ości na przemian; pusta mapa → false', () => {
    const st = treeMap(); L.spiral(st);
    const [x, y] = centroid(st); assert.ok(near0(x) && near0(y));
    const f = treeMap(); assert.equal(L.fishbone(f), true);
    const n = by(f);
    assert.ok(n.R.x > n.A.x && n.R.x > n.C.x);
    assert.ok(Math.sign(n.A.y) !== Math.sign(n.B.y));
    assert.equal(L.fishbone({ nodes: [], edges: [] }), false);
  });
  test('arrange: węzeł o największej liczbie połączeń w centrum, reszta na okręgu R ≥ 300', () => {
    const st = { nodes: ['a', 'hub', 'b', 'c'].map((i) => node(i)), edges: [{ from: 'hub', to: 'a' }, { from: 'hub', to: 'b' }, { from: 'c', to: 'hub' }] };
    L.arrange(st);
    const n = by(st);
    assert.deepEqual([cx(n.hub), cy(n.hub)], [0, 0]);
    for (const k of ['a', 'b', 'c']) assert.ok(Math.abs(Math.hypot(cx(n[k]), cy(n[k])) - 300) < 1e-6);
  });
  test('paintSchema: kolejne gałęzie dostają kolejne kolory palety (z zawijaniem)', () => {
    const st = treeMap(); const pal = ['#000', '#111', '#222'];
    L.paintSchema(st, pal);
    const n = by(st);
    assert.deepEqual([n.R.color, n.A.color, n.A1.color, n.B.color, n.C.color], ['#000', '#111', '#111', '#222', '#111']);
  });
});

describe('okno „Schemat układu" i podglądy', () => {
  test('choose: styl linii zależny od konstrukcji; dirIndep dla konstrukcji bez kierunku', () => {
    const cases = [['radial', 'curved', 'radial'], ['org', 'straight', 'down'], ['horizontal', 'curved', 'right'], ['grid', 'straight', 'free'], ['straight', 'straight', 'up']];
    for (const [line, style, layout] of cases) { const st = treeMap(); L.choose(st, line, 'up'); assert.deepEqual([st.line, st.layout], [style, layout], line); }
    assert.equal(L.dirIndep('radial'), true); assert.equal(L.dirIndep('curved'), false); assert.equal(L.dirIndep('nie-ma'), false);
  });
  test('previewSVG: linie proste vs krzywe Béziera, temat w bieżącym języku', () => {
    assert.match(L.previewSVG('right', 'curved'), /<path d="M[^"]* C /);
    assert.doesNotMatch(L.previewSVG('right', 'straight'), / C /);
    assert.match(L.previewSVG('right', 'curved'), />Temat</);
    CM.i18n.setLang('en');
    try { assert.match(L.previewSVG('down', 'grid'), />Topic</); } finally { CM.i18n.setLang('pl'); }
  });
  test('createDialog: show z bieżącym układem, Zastosuj układa mapę i woła render/krawędzie; Szablony budują diagram', () => {
    const doc = miniDocument();
    const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };   // autoSnap po 2 s
    const C = loadCM(MODS, { document: doc, setTimeout: setTimeoutUnref });
    const root = doc.createElement('div'); doc.body.appendChild(root);
    const st = treeMap(); st.layout = 'free';
    const calls = [];
    const ctx = { root, state: st, pushUndo: () => calls.push('undo'), render: () => calls.push('render'), positionSurround: () => calls.push('surround'),
      drawEdges: () => calls.push('edges'), autoSnap: () => {}, buildDiagram: (k) => calls.push('build:' + k) };
    const dlg = C.MindMapLayout.createDialog(ctx);
    assert.equal(dlg.isOpen(), false);
    dlg.show();
    assert.equal(dlg.isOpen(), true);
    const body = root.querySelector('.mm-ld-body');
    assert.equal(body.querySelectorAll('.mm-ld-line').length, C.MindMapLayout.LINES.length);
    assert.ok(body.querySelector('.mm-ld-line.on'), 'zaznaczona konstrukcja free-form');
    assert.ok(body.querySelector('.mm-ld-dirs.disabled'), 'kierunki wyłączone dla free-form');
    body.querySelectorAll('.mm-ld-line')[2].click();   // „straight"
    root.querySelector('.mm-ld-foot .primary').click();
    assert.deepEqual(calls, ['undo', 'render', 'surround', 'edges']);
    assert.equal(st.line, 'straight'); assert.equal(st.layout, 'right');
    assert.equal(dlg.isOpen(), false);
    dlg.show('tpl');
    assert.ok(root.querySelectorAll('.mm-ld-tpl').length >= 30);
    root.querySelector('.mm-ld-foot .primary').click();
    assert.equal(calls.at(-1), 'build:' + C.MindMapTemplates.DIAGRAMS[0].k);
  });
});
