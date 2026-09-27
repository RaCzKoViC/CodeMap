// Tryb MindMap bez DOM: moduły CM.MindMapStrings / Templates / Layout / IO (czysta część) + ładowanie
// całego łańcucha (mmdraw → mindmap-* → mindmap.js) w kolejności z index.html, bez cyklicznych zależności.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

const MM = ['mindmap-strings', 'mindmap-templates', 'mindmap-layout', 'mindmap-io'];
const CM = loadCM(['util', 'icons', 'i18n', ...MM]);
const S = CM.MindMapStrings, T = CM.MindMapTemplates, L = CM.MindMapLayout, IO = CM.MindMapIO;

const fresh = () => ({ nodes: [], edges: [], seq: 1, layout: 'free', line: 'curved', spaceMain: 240, spaceCross: 70 });
const built = (k) => { const st = fresh(); T.build(k, st); return st; };
// spójność grafu: unikalne id, krawędzie i rodzice wskazują istniejące węzły, seq wyprzedza wszystkie id
function assertValidMap(st, label) {
  const ids = st.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: zduplikowane id`);
  const has = new Set(ids);
  for (const e of st.edges) assert.ok(has.has(e.from) && has.has(e.to), `${label}: krawędź ${e.from}→${e.to} do nieistniejącego węzła`);
  for (const n of st.nodes) if (n.parent != null) assert.ok(has.has(n.parent), `${label}: rodzic ${n.parent} nie istnieje`);
  assert.ok(st.seq > IO.maxSeq(st.nodes), `${label}: seq ${st.seq} nie wyprzedza id`);
}
const outline = (st) => { const byId = new Map(st.nodes.map((n) => [n.id, n]));
  return st.nodes.map((n) => [n.text, n.parent == null ? null : byId.get(n.parent).text]); };
const importMd = (md) => IO.outlineToNodes(IO.parseOutline(md), fresh());

describe('szablony kart i typy diagramów', () => {
  test('16 ramek kart z etykietami, 34 typy diagramów z nazwą i opisem', () => {
    assert.equal(T.FRAMES.length, 16);
    assert.equal(new Set(T.FRAMES).size, 16);
    for (const k of T.FRAMES) { const name = T.frameName(k); assert.ok(name && name !== k, `ramka ${k} bez etykiety`); }
    assert.equal(T.DIAGRAMS.length, 34);
    assert.equal(new Set(T.DIAGRAMS.map((d) => d.k)).size, 34);
    for (const d of T.DIAGRAMS) {
      assert.ok(d.name && d.name !== d.k && d.desc, `diagram ${d.k} bez nazwy / opisu`);
      assert.ok(T.thumb(d).startsWith('<svg') && T.thumb(d).endsWith('</svg>'), `miniatura ${d.k}`);
    }
  });

  test('każdy typ diagramu tworzy poprawne węzły (unikalne id, krawędzie do istniejących węzłów, znane ramki)', () => {
    const frames = new Set(T.FRAMES);
    for (const d of T.DIAGRAMS) {
      const st = built(d.k);
      assert.ok(st.nodes.length >= 3, `${d.k}: za mało węzłów (${st.nodes.length})`);
      assertValidMap(st, d.k);
      assert.equal(st.seq, st.nodes.length + 1, `${d.k}: seq`);
      for (const n of st.nodes) {
        assert.ok(frames.has(n.template), `${d.k}: nieznana ramka ${n.template}`);
        assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y) && n.w > 0, `${d.k}: geometria ${n.id}`);
        assert.equal(typeof n.text, 'string');
      }
    }
    assert.equal(T.build('nie-ma-takiego', fresh()), null);
  });

  test('budowa kontynuuje licznik seq bieżącej mapy (id bez kolizji)', () => {
    const st = fresh(); st.seq = 41;
    T.build('flowchart', st);
    assert.equal(st.nodes[0].id, 'n41');
    assertValidMap(st, 'flowchart@41');
  });

  test('każda ramka karty daje poprawny węzeł (builder)', () => {
    const st = fresh(); const { mk, lk } = T.builder(st);
    const nodes = T.FRAMES.map((k, i) => mk(i * 10, 0, { template: k, text: k }));
    nodes.slice(1).forEach((n) => lk(nodes[0], n));
    assertValidMap(st, 'ramki');
    assert.deepEqual(host(st.nodes.map((n) => n.template)), host(T.FRAMES));
    assert.equal(st.edges.length, 15);
  });

  test('nazwy diagramów i ramek podążają za językiem (bez ręcznej relokalizacji)', () => {
    const d = T.find('mindmap');
    assert.equal(d.name, 'Mapa myśli');
    CM.i18n.setLang('en');
    try {
      assert.equal(d.name, 'Mind map');
      assert.equal(T.frameName('card'), 'Card');
      assert.equal(S.lineName('curved') !== 'Drzewo — linie krzywe', true);
    } finally { CM.i18n.setLang('pl'); }
    assert.equal(T.frameName('card'), 'Karta');
  });

  test('detekcja języka karty „kod”', () => {
    assert.equal(T.detectCodeLang(''), '');
    assert.equal(T.detectCodeLang('def f(x):\n    return x'), 'py');
    assert.equal(T.detectCodeLang('const a = 1;'), 'js');
    assert.equal(T.detectCodeLang('SELECT id FROM users'), 'sql');
    assert.equal(T.detectCodeLang('{ "a": 1 }'), 'json');
  });
});

describe('Markdown ↔ mapa', () => {
  test('nagłówki i zagnieżdżone listy: Markdown → mapa → Markdown bez strat', () => {
    const md = '# Projekt\n- Cele\n  - Szybkość\n  - Prostota\n- Ryzyka\n  - Budżet\n    - Kurs walut\n# Drugi korzeń\n- Punkt\n';
    const st = importMd(md);
    assertValidMap(st, 'md');
    assert.equal(st.nodes.length, 9);
    assert.equal(st.nodes.filter((n) => n.parent == null).length, 2);
    assert.equal(IO.toMarkdown(st.nodes), md);
    // krawędzie rodzic → dziecko towarzyszą linkom rodzica (jak w imporcie z UI)
    assert.equal(st.edges.length, 7);
  });

  test('nagłówki ## / ### stają się poziomami, a wynik eksportu jest punktem stałym', () => {
    const st = importMd('# A\n## B\n### C\n- d\n1. e\n');
    assert.deepEqual(host(outline(st)), [['A', null], ['B', 'A'], ['C', 'B'], ['d', 'A'], ['e', 'A']]);
    const md1 = IO.toMarkdown(st.nodes);
    assert.equal(md1, '# A\n- B\n  - C\n- d\n- e\n');
    assert.equal(IO.toMarkdown(importMd(md1).nodes), md1);
  });

  test('parser: tabulatory, zwykłe linie, normalizacja głębokości i przycięcie skoków', () => {
    const items = host(IO.parseOutline('\r\n  - a\r\n\t- b\r\n      - c\r\nzwykła\r\n'));
    assert.deepEqual(items.map((i) => i.depth), [2, 2, 4, 0]);
    // najpłytszy poziom = korzenie; skok o kilka poziomów → najwyżej jeden głębiej niż rodzic
    const st = importMd('    - x\n    - y\n            - z\n');
    assert.deepEqual(host(outline(st)), [['x', null], ['y', null], ['z', 'y']]);
    assert.equal(IO.parseOutline('\n  \n').length, 0);
  });

  test('eksport diagramu do Markdown i import z powrotem zachowuje liczbę węzłów i drzewo', () => {
    for (const k of ['kanban', 'orgchart', 'swot', 'timeline', 'mindmap']) {
      const st = built(k);
      const back = importMd(IO.toMarkdown(st.nodes));
      assert.equal(back.nodes.length, st.nodes.length, `${k}: liczba węzłów`);
      assertValidMap(back, `${k} (import)`);
      const sorted = (x) => host(outline(x)).map((r) => JSON.stringify(r)).sort();   // kolejność = DFS konspektu
      assert.deepEqual(sorted(back), sorted(st), `${k}: struktura`);
    }
    // teksty wielolinijkowe / puste spłaszczane do jednej linii konspektu
    assert.equal(IO.toMarkdown([{ id: 'n1', text: 'a\nb' }, { id: 'n2', text: '  ', parent: 'n1' }]), '# a b\n- (bez nazwy)\n');
  });
});

describe('plik .mindmap.json, SVG i migawki', () => {
  test('toFile → readInto: te same dane, seq wyprzedza id, mapId z nazwy dla starych zapisów', () => {
    const st = built('pert'); st.name = 'Plan Q1'; st.mapId = 'm1'; st.layout = 'right';
    const file = JSON.parse(JSON.stringify(IO.toFile(st, [{ id: 'd1' }])));
    assert.equal(file.format, 'codemap-mindmap');
    const back = IO.readInto(fresh(), file);
    assert.deepEqual(host(back.nodes), host(st.nodes));
    assert.equal(back.layout, 'right');
    assert.equal(back.mapId, 'm1');
    const old = IO.readInto(fresh(), { name: 'Stara mapa!', nodes: [{ id: 'n7' }, { id: 'n3' }], seq: 2 });
    assert.equal(old.seq, 8);
    assert.equal(old.mapId, 'name_Stara_mapa_');
    assert.equal(old.layout, 'free');
  });

  test('buildSvg: samodzielny SVG z tekstem każdego widocznego węzła i escapowaniem', () => {
    const st = built('flowchart');
    st.nodes[0].text = 'A <b> & "c"';
    const hiddenId = st.nodes[1].id;
    const { svg, w, h } = IO.buildSvg(st, { pad: 10, hidden: (n) => n.id === hiddenId, heightOf: () => 50, bg: '#000' });
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.endsWith('</svg>'));
    assert.ok(w > 0 && h > 0);
    assert.ok(svg.includes('A &lt;b&gt; &amp; &quot;c&quot;'));
    assert.ok(!svg.includes('<b>'));
    assert.equal((svg.match(/<text /g) || []).length, st.nodes.length - 1);
    assert.equal(IO.wrapText('jeden dwa trzy cztery pięć', 60, 14).length > 1, true);
  });

  test('migawki: diff dodanych / usuniętych / zmienionych i odrzucanie duplikatów', () => {
    const a = [{ id: 'n1', x: 0, y: 0, text: 'a' }, { id: 'n2', x: 0, y: 0, text: 'b' }];
    const b = [{ id: 'n1', x: 5, y: 0, text: 'a' }, { id: 'n3', x: 0, y: 0, text: 'c' }];
    const d = IO.snapDiff(a, b);
    assert.deepEqual([d.added.map((n) => n.id), d.removed.map((n) => n.id), d.changed.map((n) => n.id)].map(host), [['n3'], ['n2'], ['n1']]);
    const st = built('okr');
    const s1 = IO.makeSnap(st, 'test', []);
    st.nodes[0].x = 999;
    assert.notEqual(s1.nodes[0].x, 999, 'migawka musi być głęboką kopią');
    assert.equal(IO.isDupSnap(s1, { ...s1, ts: s1.ts + 1000 }), true);
    assert.equal(IO.isDupSnap(s1, { ...s1, ts: s1.ts + 5000 }), false);
    assert.equal(IO.snapKey('m1'), 'codemap_mm_snaps_m1');
  });
});

describe('schematy układu', () => {
  test('każda konstrukcja z okna układu na każdym diagramie daje skończone współrzędne i spójny graf', () => {
    for (const d of T.DIAGRAMS) {
      for (const [line] of L.LINES) {
        const st = built(d.k);
        const ok = L.choose(st, line, 'down');
        assert.equal(ok, true, `${d.k}/${line}`);
        assertValidMap(st, `${d.k}/${line}`);
        for (const n of st.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${d.k}/${line}: ${n.id} poza liczbami`);
      }
    }
    assert.equal(L.fishbone(fresh()), false, 'fishbone na pustej mapie');
  });

  test('łączniki (wspólne dla ekranu i eksportu SVG): kotwice wg układu, ścieżka, obrys kart', () => {
    const p = { x: 0, y: 0, w: 100 }, n = { x: 300, y: 10, w: 100 };
    assert.deepEqual(host(L.anchorDirs('right', n, p)), ['r', 'l']);
    assert.deepEqual(host(L.anchorDirs('radial', n, p)), ['c', 'c']);
    assert.deepEqual(host(L.anchorDirs('down', n, p)), ['b', 't']);
    assert.deepEqual(host(L.anchorDirs('leftright', { x: -300, y: 0, w: 100 }, p)), ['l', 'r']);
    assert.deepEqual(host(L.anchorDirs('free', { x: 0, y: 400, w: 100 }, p)), ['b', 't']);
    assert.deepEqual(host(L.anchorPoint(p, 'r', 60)), { x: 100, y: 30 });
    assert.deepEqual(host(L.anchorPoint(p, 'b', 50)), { x: 50, y: 50 });
    assert.equal(L.connectorSvg({ x: 0, y: 0 }, { x: 10, y: 20 }, false, '#fff', false).includes('d="M0 0 H 5 V 20 H 10"'), true);
    assert.match(L.connectorSvg({ x: 0, y: 0 }, { x: 100, y: 10 }, true, '#fff', true), /d="M0 0 C 50 0, 50 10, 100 10" stroke="#fff" stroke-width="2.6"/);
    const st = { nodes: [{ id: 'a', x: 0, y: 0, w: 100 }, { id: 'b', x: 300, y: 0, w: 80, parent: 'a', color: '#f00' }, { id: 'c', x: 0, y: 200, w: 50, parent: 'b' }],
      edges: [{ from: 'a', to: 'c' }], layout: 'right' };
    const seen = []; L.eachConnector(st, () => 60, (x) => x.id === 'c', (from, to, col, wide) => seen.push([from.x, to.x, col, wide]));
    assert.deepEqual(host(seen), [[100, 300, '#f00', true]], 'zwinięte węzły bez łączników, gruba linia drzewa w kolorze dziecka');
    assert.deepEqual(host(L.cardBounds(st.nodes, () => 70, (x) => x.id === 'c')), { minX: 0, minY: 0, maxX: 380, maxY: 70 });
  });

  test('schemat kolorów: korzeń = pierwszy kolor palety, gałęź dziedziczy kolor', () => {
    const st = importMd('# R\n- A\n  - A1\n- B\n');
    L.paintSchema(st, T.SCHEMA_PALETTES.sunset);
    const c = Object.fromEntries(st.nodes.map((n) => [n.text, n.color]));
    assert.equal(c.R, T.SCHEMA_PALETTES.sunset[0]);
    assert.equal(c.A1, c.A);
    assert.notEqual(c.A, c.B);
  });
});

describe('ładowanie całego trybu MindMap', () => {
  test('łańcuch z index.html ładuje się bez DOM, a publiczne API CM.MindMap jest zgodne', () => {
    const C = loadCM(['util', 'icons', 'i18n', 'mmdraw', ...MM, 'mindmap-ui', 'mindmap']);
    const api = Object.keys(C.MindMap).sort();
    assert.deepEqual(host(api), ['_build', '_diags', '_state', '_tpls', 'activate', 'deactivate', 'exportState', 'importState', 'isActive', 'mapName', 'nodeCount'].sort());
    assert.equal(C.MindMap.isActive(), false);
    assert.equal(C.MindMap.nodeCount(), 0);
    assert.equal(C.MindMap._diags().length, 34);
    assert.equal(C.MindMap._tpls().length, 16);
    const snap = C.MindMap.exportState();
    assert.deepEqual(host(Object.keys(snap)), ['nodes', 'edges', 'seq', 'name', 'layout', 'line', 'spaceMain', 'spaceCross', 'draw']);
  });
});
