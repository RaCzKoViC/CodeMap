import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Nawigacja po mapie (js/navigation.js) na zaślepce CM.App i prawdziwym grafie: menu kontekstowe (pozycje zależne
// od węzła, rozszerzenia integracji), rozwijanie/zwijanie poddrzew, izolacja sąsiadów, eksport obrazu, tarcza obrotu.
const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
const FILES = [
  { path: 'src/a.js', size: 30, content: "import './lib/b.js';\nexport const a = 1;\n" },
  { path: 'src/lib/b.js', size: 20, content: 'export const b = 2;\n' },
  { path: 'src/lib/deep/c.js', size: 5, content: "import '../b.js';\n" },
  { path: 'README.md', size: 5, content: '# x\n' },
];

function load() {
  const doc = miniDocument(), log = [], toasts = [];
  let menu = null;
  const A = { state: {}, handlers: { openRepoUrl: (n) => log.push(['repo', n.id]) },
    renderer: { cam: { x: 5, y: 5, rot: 0, tilt: 0 }, w: 800, h: 600, opts: { showGrid: false }, diffMode: false,
      fit: () => log.push(['fit']), resetRotation: () => log.push(['resetRot']), setHighlight: (s) => log.push(['hl', s ? [...s].sort() : null]),
      setTilt: (t) => log.push(['tilt', t]), onChange() {}, kick() {}, centroidScreen: () => null },
    focusNode: (id) => log.push(['focus', id]), select: (n) => log.push(['select', n && n.id]), toggleCollapse: (n) => log.push(['toggle', n.id]),
    apply: () => log.push(['apply']), nodeRepoUrl: () => null, repoHostName: () => 'GitHub' };
  const UI = { ctxMenu: (items, x, y) => { menu = { items, x, y }; }, hideCtx() {} };
  const CM = loadCM([...CORE, 'navigation'], { document: doc, CM: { App: A, UI }, setTimeout: setTimeoutUnref, navigator: { clipboard: { writeText: async () => {} } } });
  CM.util.toast = (m, k) => toasts.push([String(m), k || '']);
  A.graph = new CM.Graph.Graph(); A.graph.build(FILES, { name: 'demo projekt' });
  return { A, CM, doc, log, toasts, menu: () => menu };
}
const labels = (m) => host(m.items.map((i) => (i.sep ? '—' : i.label)));
const item = (m, re) => m.items.find((i) => !i.sep && re.test(i.label));

describe('menu kontekstowe', () => {
  test('tło mapy: dopasuj, obrót, rozwijanie, siatka, 3D; „wyłącz tryb różnic" tylko w trybie różnic', () => {
    const { A, log, menu } = load();
    A.contextMenu(null, 10, 20);
    const m = menu();
    assert.deepEqual([m.x, m.y], [10, 20]);
    assert.ok(!labels(m).some((l) => /różnic/.test(l)));
    item(m, /Dopasuj widok/).action();
    assert.deepEqual(log.at(-1), ['fit']);
    item(m, /perspektywę 3D/).action();
    assert.deepEqual(log.at(-1), ['tilt', 0.62]);
    assert.ok(item(m, /Przełącz siatkę/) && item(m, /Zwiń do poziomu 1/));
    A.renderer.diffMode = true;
    A.graph.nodes.get('src/a.js').diff = 'added';
    A.contextMenu(null, 0, 0);
    item(menu(), /tryb różnic/).action();
    assert.equal(A.renderer.diffMode, false); assert.equal(A.graph.nodes.get('src/a.js').diff, undefined);
  });
  test('plik z importami: liczniki zależności, podświetlenie wychodzących; kopiowanie ścieżki; bez adresu repo — bez „Otwórz na…"', () => {
    const { A, log, menu } = load();
    const a = A.graph.nodes.get('src/a.js');
    A.contextMenu(a, 0, 0);
    const m = menu();
    assert.ok(!labels(m).some((l) => /Otwórz na/.test(l)));
    const out = item(m, /wychodzące/);
    assert.match(out.label, /\(1\)$/);
    assert.match(item(m, /przychodzące/).label, /\(0\)$/);
    out.action();
    assert.deepEqual(log.at(-1), ['hl', ['src/a.js', 'src/lib/b.js']]);
    assert.ok(item(m, /Kopiuj ścieżkę/));
    const readme = A.graph.nodes.get('README.md');
    A.contextMenu(readme, 0, 0);
    assert.ok(!labels(menu()).some((l) => /zależności/.test(l)), 'plik bez importów — bez pozycji zależności');
  });
  test('przypięcie i blokada: fixed = przypięty albo zablokowany; etykiety przełączają się', () => {
    const { A, menu } = load();
    const n = A.graph.nodes.get('src/a.js');
    A.contextMenu(n, 0, 0); item(menu(), /Przypnij/).action();
    assert.deepEqual([n.pinned, n.fixed], [true, true]);
    A.contextMenu(n, 0, 0); item(menu(), /Zablokuj/).action();
    A.contextMenu(n, 0, 0); item(menu(), /Odepnij/).action();
    assert.deepEqual([n.pinned, n.locked, n.fixed], [false, true, true]);
    A.contextMenu(n, 0, 0); item(menu(), /Odblokuj/).action();
    assert.equal(n.fixed, false);
  });
  test('rozszerzenia integracji na górze (wyjątek jednego ignorowany) i „Otwórz na GitHub", gdy jest adres', () => {
    const { A, log, menu } = load();
    A.ctxExtra = [() => { throw new Error('zła wtyczka'); }, (n) => ({ ic: 'code', label: 'Otwórz w edytorze: ' + n.name, action() {} }), () => null];
    A.nodeRepoUrl = () => 'https://github.com/o/r/blob/main/src/a.js';
    A.contextMenu(A.graph.nodes.get('src/a.js'), 0, 0);
    const l = labels(menu());
    assert.deepEqual(l.slice(0, 2), ['Otwórz w edytorze: a.js', '—']);
    item(menu(), /Otwórz na GitHub/).action();
    assert.deepEqual(log.at(-1), ['repo', 'src/a.js']);
  });
  test('folder: zwiń / rozwiń wszystko poniżej (tylko foldery), izolacja pokazuje sąsiadów', () => {
    const { A, log, menu } = load();
    const src = A.graph.nodes.get('src'), lib = A.graph.nodes.get('src/lib'), deep = A.graph.nodes.get('src/lib/deep');
    A.contextMenu(src, 0, 0);
    item(menu(), /Zwiń wszystko poniżej/).action();
    assert.deepEqual([src.collapsed, lib.collapsed, deep.collapsed], [src.collapsed, true, true]);
    assert.notEqual(src.collapsed, true, 'sam folder zostaje rozwinięty');
    A.expandBelow(src);
    assert.deepEqual([src.collapsed, lib.collapsed, deep.collapsed], [false, false, false]);
    A.isolateNode(A.graph.nodes.get('src/lib/b.js'));
    const hl = log.at(-1)[1];
    assert.ok(hl.includes('src/lib/b.js') && hl.includes('src/a.js') && hl.includes('src/lib/deep/c.js'));
    A.isolateNode(null);
  });
});

describe('eksport obrazu i tarcza obrotu', () => {
  test('SVG: nazwa pliku z nazwy projektu bez znaków specjalnych; pusty eksport / brak PNG / wyjątek → komunikaty', async () => {
    const { A, CM, toasts } = load();
    const dl = []; CM.util.download = (name, text, type) => dl.push([name, text, type]);
    A.renderer.exportSVG = () => '<svg/>';
    await A.exportImage('svg');
    assert.deepEqual(dl, [['demo_projekt.svg', '<svg/>', 'image/svg+xml']]);
    A.renderer.exportSVG = () => '';
    await A.exportImage('svg');
    assert.equal(toasts.at(-1)[0], 'Brak mapy do eksportu.');
    A.renderer.exportPNG = async () => null;
    await A.exportImage('png', 2);
    assert.equal(toasts.at(-1)[0], 'Eksport nie powiódł się.');
    A.renderer.exportPNG = async () => { throw new Error('canvas za duży'); };
    await A.exportImage('png');
    assert.match(toasts.at(-1)[0], /canvas za duży$/);
  });
  test('updateRotDial: igła wskazuje środek schematu (albo północ wg obrotu), etykieta w stopniach 0–359', () => {
    const { A, doc } = load();
    for (const id of ['rot-needle', 'rot-label']) { const e = doc.createElement('div'); e.id = id; doc.body.appendChild(e); }
    A.renderer.cam.rot = -Math.PI / 2;
    A.updateRotDial();
    assert.equal(doc.getElementById('rot-needle').style.transform, 'rotate(0deg)');
    assert.equal(doc.getElementById('rot-label').textContent, '270°');
    A.renderer.centroidScreen = () => ({ x: 600, y: 300 });
    A.updateRotDial();
    assert.equal(doc.getElementById('rot-needle').style.transform, 'rotate(90deg)');
    A.renderer.centroidScreen = () => ({ x: 400, y: 300 });
    A.renderer.cam.rot = Math.PI / 4;
    A.updateRotDial();
    assert.equal(doc.getElementById('rot-needle').style.transform, 'rotate(-45deg)');
    assert.equal(doc.getElementById('rot-label').textContent, '45°');
  });
  test('hoodPick: brak trafień przed narysowaniem radaru → null', () => {
    const { A } = load();
    assert.equal(A.hoodPick(10, 10), null);
    assert.deepEqual(host(A.offsetXY({ clientX: 30, clientY: 45 }, { getBoundingClientRect: () => ({ left: 10, top: 5 }) })), { x: 20, y: 40 });
  });
});
