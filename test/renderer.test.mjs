import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

// Renderer w Node: DOMMatrix (2D, mnożenie z prawej jak w przeglądarce), canvas i kontekst 2D jako atrapy,
// bez pętli requestAnimationFrame — _draw() wołany ręcznie. Kamera, trafianie, dopasowanie, przybliżanie,
// wybór backendu, rysowanie bez wyjątków i eksport SVG.
class DOMMatrix {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  static of(o) { return Object.assign(new DOMMatrix(), o); }
  multiplySelf(o) { const { a, b, c, d, e, f } = this;
    this.a = a * o.a + c * o.b; this.b = b * o.a + d * o.b; this.c = a * o.c + c * o.d; this.d = b * o.c + d * o.d;
    this.e = a * o.e + c * o.f + e; this.f = b * o.e + d * o.f + f; return this; }
  multiply(o) { return DOMMatrix.of(this).multiplySelf(o); }
  translateSelf(x, y) { return this.multiplySelf(DOMMatrix.of({ e: x, f: y || 0 })); }
  scaleSelf(x, y) { return this.multiplySelf(DOMMatrix.of({ a: x, d: y == null ? x : y })); }
  scale(x, y) { return DOMMatrix.of(this).scaleSelf(x, y); }
  rotateSelf(deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return this.multiplySelf(DOMMatrix.of({ a: c, b: s, c: -s, d: c })); }
  inverse() { const { a, b, c, d, e, f } = this, det = a * d - b * c;
    return DOMMatrix.of({ a: d / det, b: -b / det, c: -c / det, d: a / det, e: (c * f - d * e) / det, f: (b * e - a * f) / det }); }
  transformPoint(p) { return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f }; }
}
class DOMPoint { constructor(x, y) { this.x = x; this.y = y; } }
// kontekst 2D: każda metoda to no-op (licznik wywołań), measureText z szerokością
function ctxStub() {
  const calls = {};
  return new Proxy({ calls, measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get(o, k) { if (k in o) return o[k]; return (...a) => { calls[k] = (calls[k] || 0) + 1; }; },
    set(o, k, v) { o[k] = v; return true; },
  });
}
function canvasStub(w = 800, h = 600) {
  const ctx = ctxStub();
  return { ctx, width: 0, height: 0, style: {}, getContext: () => ctx, addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    classList: { add() {}, remove() {}, contains() { return false; } }, parentNode: null };
}
const CM = loadCM(['util', 'i18n', 'languages', 'analysis', 'graph', 'renderer'], {
  DOMMatrix, DOMPoint, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
});
const R0 = CM.Renderer;
const node = (id, x, y, r = 10, extra = {}) => ({ id, name: id, path: id, type: 'file', x, y, r, metrics: { lines: 10, complexity: 1 }, ...extra });
function make(nodes, edges = []) {
  const cv = canvasStub(); const R = new R0.Renderer(cv);
  R.opts.nodeScale = 1;
  const graph = { nodes: new Map(nodes.map((n) => [n.id, n])), neighbors: () => ({ out: [], inc: [] }), edges };
  R.setData(graph, { nodes, edges }, null);
  return { R, cv };
}

describe('kamera', () => {
  test('świat ↔ ekran w obie strony przy obrocie i pochyleniu; xf = te same liczby co macierz', () => {
    const { R } = make([node('a', 0, 0)]);
    Object.assign(R.cam, { x: 40, y: -20, zoom: 1.7, rot: 0.6, tilt: 0.3 }); R.cam._k = '';
    for (const [x, y] of [[0, 0], [123, -45], [-300, 210]]) {
      const s = R.cam.toScreen(x, y, R.w, R.h), w = R.cam.toWorld(s.x, s.y, R.w, R.h);
      assert.ok(Math.abs(w.x - x) < 1e-6 && Math.abs(w.y - y) < 1e-6, x + ',' + y);
    }
    const m = R.cam.matrix(R.w, R.h), xf = R.cam.xf(R.w, R.h);
    assert.deepEqual(host([xf.a, xf.b, xf.c, xf.d, xf.e, xf.f]), host([m.a, m.b, m.c, m.d, m.e, m.f]));
  });
  test('pamięć macierzy: zmiana pola kamery albo _k="" daje nową macierz', () => {
    const { R } = make([node('a', 0, 0)]);
    const m1 = R.cam.matrix(R.w, R.h); assert.equal(R.cam.matrix(R.w, R.h), m1, 'ta sama przy braku zmian');
    R.cam.zoom = 2; assert.notEqual(R.cam.matrix(R.w, R.h), m1);
    const m2 = R.cam.matrix(R.w, R.h); R.cam._k = ''; assert.notEqual(R.cam.matrix(R.w, R.h), m2);
  });
  test('zoomBy trzyma punkt pod kursorem w miejscu', () => {
    const { R } = make([node('a', 0, 0)]);
    const before = R.cam.toWorld(200, 150, R.w, R.h);
    R.zoomBy(2.5, 200, 150);
    const after = R.cam.toWorld(200, 150, R.w, R.h);
    assert.ok(Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6);
    assert.ok(Math.abs(R.cam.zoom - 2.5) < 1e-9);
  });
});

describe('trafianie i dopasowanie', () => {
  test('hitTest: węzeł pod kursorem (także przy pochyleniu), pusto → null, przy nakładaniu wygrywa rysowany później', () => {
    const { R } = make([node('a', 0, 0, 20), node('b', 10, 0, 20), node('c', 300, 300, 5)]);
    R.cam.tilt = 0.5; R.cam._k = '';
    const sb = R.cam.toScreen(10, 0, R.w, R.h), sc = R.cam.toScreen(300, 300, R.w, R.h);
    assert.equal(R.hitTest(sb.x, sb.y).id, 'b');
    assert.equal(R.hitTest(sc.x, sc.y + 8).id, 'c', 'pionowo w promieniu mimo pochylenia (billboard)');
    assert.equal(R.hitTest(sc.x + 100, sc.y + 100), null);
  });
  test('hitTestEdge: linia prosta i łuk (import), tolerancja ~8 px', () => {
    const a = node('a', -100, 0), b = node('b', 100, 0);
    const { R } = make([a, b], [{ source: 'a', target: 'b', type: 'contains' }]);
    const mid = R.cam.toScreen(0, 0, R.w, R.h);
    assert.ok(R.hitTestEdge(mid.x, mid.y + 3));
    assert.equal(R.hitTestEdge(mid.x, mid.y + 40), null);
    R.edges = [{ source: 'a', target: 'b', type: 'import' }];   // łuk: środek przesunięty prostopadle
    const off = Math.min(40, 200 * 0.12) / 2;                     // wierzchołek krzywej = połowa odsunięcia punktu kontrolnego
    const top = R.cam.toScreen(0, off, R.w, R.h);
    assert.ok(R.hitTestEdge(top.x, top.y), 'na łuku');
  });
  test('fit: wszystkie węzły w oknie z marginesem, także przy panelach (inset)', () => {
    const nodes = [node('a', -900, -400, 30), node('b', 1200, 700, 30), node('c', 50, 60, 10)];
    const { R } = make(nodes);
    R.inset = { l: 200, r: 150, t: 40, b: 30 };
    R.fit(70, false);
    for (const n of nodes) { const s = R.cam.toScreen(n.x, n.y, R.w, R.h);
      assert.ok(s.x >= R.inset.l && s.x <= R.w - R.inset.r && s.y >= R.inset.t && s.y <= R.h - R.inset.b, n.id + ' ' + JSON.stringify(s)); }
  });
});

describe('rysowanie i backend', () => {
  test('bez WebGL: backends() = canvas, tryb auto zostaje przy canvas 2D; setBackend zapamiętuje wybór', () => {
    const { R } = make([node('a', 0, 0)]);
    assert.deepEqual(host(R.backends()), ['canvas']);
    assert.equal(R._useGL(), false);
    assert.equal(R.setBackend('webgl'), 'webgl');
    assert.equal(R._useGL(), false, 'brak CM.GLLayer → canvas');
    assert.equal(R.setBackend('cokolwiek'), 'auto');
  });
  test('_draw na atrapie: tło, siatka, krawędzie, figury i etykiety bez wyjątków; zaznaczenie i podświetlenie', () => {
    const nodes = [node('src/a.js', 0, 0, 30, { langInfo: { color: '#f7df1e', name: 'JavaScript' } }), node('src/b.js', 200, 50, 30), node('lib', -150, 80, 40, { type: 'folder', collapsed: true })];
    const edges = [{ source: 'src/a.js', target: 'src/b.js', type: 'import' }, { source: 'lib', target: 'src/a.js', type: 'contains' }, { source: 'src/a.js', target: 'lib', type: 'reference' }];
    const { R, cv } = make(nodes, edges);
    R.fit(70, false); R._draw();
    const c = cv.ctx.calls;
    assert.ok(c.fillRect >= 1 && c.arc > 3 && c.stroke > 2 && c.fillText >= 1, JSON.stringify(c));
    const arc1 = c.arc;
    R.setSelected(nodes[0]); R.setHighlight(new Set(['src/a.js'])); R._draw();
    R.setImpact({ focus: 'src/a.js', up: [], down: ['src/b.js'] }); R._draw();
    assert.ok(cv.ctx.calls.arc > arc1, 'kolejne klatki rysują (pierścienie zaznaczenia i wpływu)');
  });
  test('exportSVG: węzły jako koła, etykiety escapowane, krawędzie jako ścieżki / linie', () => {
    const nodes = [node('a<b>.js', 0, 0, 30), node('c.js', 200, 0, 30)];
    const { R } = make(nodes, [{ source: 'a<b>.js', target: 'c.js', type: 'import' }, { source: 'c.js', target: 'a<b>.js', type: 'contains' }]);
    const svg = R.exportSVG();
    assert.equal((svg.match(/<circle /g) || []).length, 2);
    assert.ok(svg.includes('a&lt;b&gt;.js') && !svg.includes('a<b>.js'));
    assert.match(svg, /<path d="M/); assert.match(svg, /<line /);
  });
});
