import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, ALL_FILTERS, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM([...CORE, 'export']);
const { Graph } = CM.Graph;
const E = CM.Export;
const build = () => new Graph().build(FILES.map((f) => ({ ...f })), META);
const depEdges = (vis) => vis.edges.filter((e) => e.type === 'import' || e.type === 'reference');

// mały ręczny „widok" z nazwami wymagającymi ucieczki (cudzysłowy, spacje, znaki XML/Mermaid)
function trickyVis() {
  const folder = { id: 'dir with space', type: 'folder', name: 'dir with space', path: 'dir with space', parent: '__root__', lang: '__folder__' };
  const a = { id: 'dir with space/say "hi".js', type: 'file', name: 'say "hi".js', path: 'dir with space/say "hi".js', parent: 'dir with space', lang: 'js', langInfo: { color: '#f7df1e' }, size: 10, metrics: { lines: 2 } };
  const b = { id: 'a<b>&c.js', type: 'file', name: 'a<b>&c.js', path: 'a<b>&c.js', parent: '__root__', lang: 'js', langInfo: { color: '#f7df1e' }, size: 5, metrics: { lines: 1 } };
  const ext = { id: 'ext:lodash', type: 'external', name: 'lodash', path: 'ext:lodash', parent: '__ext__', lang: '__external__' };
  return {
    nodes: [folder, a, b, ext],
    edges: [
      { source: b.id, target: a.id, type: 'import', weight: 3 },
      { source: a.id, target: ext.id, type: 'reference', weight: 1 },
      { source: folder.id, target: a.id, type: 'contains', weight: 1 },
    ],
  };
}

describe('DOT', () => {
  test('nagłówek, liczba węzłów i krawędzi, klastry = foldery', () => {
    const g = build();
    const vis = g.getVisible(ALL_FILTERS);
    const dot = E.toDOT(vis, { name: 'sample' });
    assert.ok(dot.startsWith('digraph "sample" {'));
    assert.ok(dot.trimEnd().endsWith('}'));
    const nodeDecl = dot.match(/^\s*"[^"\n]+" \[label=/gm) || [];
    assert.equal(nodeDecl.length, vis.nodes.length);
    const edgeDecl = dot.match(/^\s*"[^"\n]+" -> "[^"\n]+"/gm) || [];
    assert.equal(edgeDecl.length, depEdges(vis).length);
    const folders = vis.nodes.filter((n) => n.type === 'folder');
    assert.equal((dot.match(/subgraph "cluster_/g) || []).length, folders.length);
    assert.ok(dot.includes('"src/index.js" -> "src/app.js";'));
    assert.ok(dot.includes('"index.html" -> "src/index.js" [style=dashed];'), 'reference edges are dashed');
    assert.ok(!dot.includes('contains'), 'containment is expressed by clusters, not edges');
  });
  test('kolor z langInfo.color, brak klastrów gdy foldery wyłączone, waga agregatu', () => {
    const g = build();
    // folders:false zostawia jeszcze __ext__ (klaster pakietów zewnętrznych) — bez externals nie ma żadnego klastra
    const noFolders = E.toDOT(g.getVisible({ ...ALL_FILTERS, folders: false, externals: false }));
    assert.ok(!noFolders.includes('subgraph'));
    const extOnly = E.toDOT(g.getVisible({ ...ALL_FILTERS, folders: false }));
    assert.equal((extOnly.match(/subgraph "cluster_/g) || []).length, 1);
    const js = g.nodes.get('src/index.js');
    assert.ok(E.toDOT(g.getVisible(ALL_FILTERS)).includes('color="' + js.langInfo.color + '"'));
    // zwinięty folder: krawędzie idą do reprezentanta, ukryte dzieci nie są deklarowane
    g.nodes.get('src/lib').collapsed = true;
    const agg = E.toDOT(g.getVisible(ALL_FILTERS));
    assert.ok(agg.includes('"src/app.js" -> "src/lib";') && agg.includes('"src/lib" -> "src/app.js";'));
    assert.ok(!agg.includes('"src/lib/util.js"'));
  });
  test('ucieczka cudzysłowów i znaków specjalnych', () => {
    const dot = E.toDOT(trickyVis());
    assert.ok(dot.includes('"dir with space/say \\"hi\\".js" [label="say \\"hi\\".js"'));
    assert.ok(dot.includes('subgraph "cluster_dir_with_space" {'));
    assert.ok(dot.includes('"a<b>&c.js" -> "dir with space/say \\"hi\\".js" [label="3", penwidth='));
    assert.ok(dot.includes('"ext:lodash" [label="lodash"') && dot.includes('shape=ellipse'));
  });
});

describe('Mermaid', () => {
  test('flowchart LR, subgraph per folder, liczba węzłów/krawędzi, klasy języków', () => {
    const g = build();
    const vis = g.getVisible(ALL_FILTERS);
    const mm = E.toMermaid(vis, { name: 'sample' });
    const lines = mm.split('\n');
    assert.equal(lines[0], '%% sample');
    assert.equal(lines[1], 'flowchart LR');
    const folders = vis.nodes.filter((n) => n.type === 'folder');
    assert.equal((mm.match(/^\s*subgraph sg_/gm) || []).length, folders.length);
    assert.equal((mm.match(/^\s*end$/gm) || []).length, folders.length);
    const nodeDecl = mm.match(/^\s*n_\w+(\[|\(\[)/gm) || [];
    assert.equal(nodeDecl.length, vis.nodes.length);
    const edgeDecl = mm.match(/^\s*n_\w+ (-->|-\.->)/gm) || [];
    assert.equal(edgeDecl.length, depEdges(vis).length);
    assert.ok(mm.includes('n_src_index_js --> n_src_app_js'));
    assert.ok(mm.includes('n_index_html -.-> n_src_index_js'), 'reference edges are dotted');
    assert.ok(mm.includes('classDef lang_js fill:'));
    assert.match(mm, /class (n_\w+,)*n_src_index_js(,n_\w+)* lang_js/);
  });
  test('bezpieczne identyfikatory (bez kolizji) i ucieczka etykiet', () => {
    const mm = E.toMermaid(trickyVis());
    assert.ok(mm.includes('n_dir_with_space_say_hi_js["say #quot;hi#quot;.js"]'));
    assert.ok(mm.includes('n_a_b_c_js["a#lt;b#gt;&c.js"]'));
    assert.ok(mm.includes('subgraph sg_n_dir_with_space ["dir with space"]'));
    assert.ok(mm.includes('n_a_b_c_js -->|"×3"| n_dir_with_space_say_hi_js'));
    assert.ok(mm.includes('n_ext_lodash(["lodash"])'));
    assert.ok(!/^\s*[^\s"%]*[^\w\s"\[\]\(\)\|\-\.>:,#×]/m.test(mm.split('\n').filter((l) => /^\s*n_/.test(l)).map((l) => l.split(/[\[\(]/)[0]).join('\n')), 'ids contain only [A-Za-z0-9_]');
    // kolizja: dwa różne id sanityzujące się do tego samego
    const vis = { nodes: [{ id: 'a-b.js', type: 'file', name: 'x', lang: 'js' }, { id: 'a_b.js', type: 'file', name: 'y', lang: 'js' }], edges: [{ source: 'a-b.js', target: 'a_b.js', type: 'import', weight: 1 }] };
    const m2 = E.toMermaid(vis);
    assert.ok(m2.includes('n_a_b_js["x"]') && m2.includes('n_a_b_js_2["y"]') && m2.includes('n_a_b_js --> n_a_b_js_2'));
  });
});

describe('GraphML', () => {
  test('nagłówek yEd, klucze atrybutów, węzły z type/lang/size/lines, krawędzie z type', () => {
    const g = build();
    const vis = g.getVisible(ALL_FILTERS);
    const x = E.toGraphML(vis);
    assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns"'));
    assert.ok(x.includes('xmlns:y="http://www.yworks.com/xml/graphml"'));
    for (const k of ['label', 'type', 'lang', 'size', 'lines', 'path']) assert.ok(x.includes('attr.name="' + k + '"'), 'key ' + k);
    assert.ok(x.includes('yfiles.type="nodegraphics"') && x.includes('yfiles.type="edgegraphics"'));
    assert.equal((x.match(/<node id="/g) || []).length, vis.nodes.length);
    assert.equal((x.match(/<edge id="/g) || []).length, depEdges(vis).length);
    assert.equal((x.match(/<\/node>/g) || []).length, vis.nodes.length);
    const folders = vis.nodes.filter((n) => n.type === 'folder');
    assert.equal((x.match(/<graph id="g\d+"/g) || []).length, folders.length, 'nested graph per folder');
    const idx = x.slice(x.indexOf('<node id="src/index.js">'), x.indexOf('</node>', x.indexOf('<node id="src/index.js">')));
    assert.ok(idx.includes('<data key="d_type">file</data>') && idx.includes('<data key="d_lang">js</data>') && idx.includes('<data key="d_lines">9</data>'));
    assert.match(idx, /<data key="d_size">\d+<\/data>/);
    assert.ok(x.includes('<data key="e_type">reference</data>') && x.includes('<data key="e_type">import</data>'));
    assert.ok(!x.includes('<data key="e_type">contains</data>'));
    assert.ok(x.trimEnd().endsWith('</graphml>'));
  });
  test('ucieczka XML w id, etykietach i ścieżkach', () => {
    const x = E.toGraphML(trickyVis());
    assert.ok(x.includes('<node id="dir with space/say &quot;hi&quot;.js">'));
    assert.ok(x.includes('<data key="d_label">a&lt;b&gt;&amp;c.js</data>'));
    assert.ok(x.includes('<y:NodeLabel>say &quot;hi&quot;.js</y:NodeLabel>'));
    assert.ok(x.includes('source="a&lt;b&gt;&amp;c.js" target="dir with space/say &quot;hi&quot;.js"'));
    assert.ok(x.includes('<data key="e_weight">3</data>'));
    assert.ok(!/[^&]<(?![\/?a-zA-Z!])/.test(x), 'no unescaped < in text');
  });
});

describe('build (fasada)', () => {
  test('nazwa pliku, mime, liczby; nieznany format → błąd', () => {
    const g = build();
    const r = E.build(g, ALL_FILTERS, 'dot');
    assert.equal(r.filename, 'sample.dot'); assert.equal(r.mime, 'text/vnd.graphviz');
    assert.equal(r.nodes, g.getVisible(ALL_FILTERS).nodes.length);
    assert.equal(E.build(g, ALL_FILTERS, 'mermaid').filename, 'sample.mmd');
    assert.equal(E.build(g, ALL_FILTERS, 'GraphML').filename, 'sample.graphml');
    assert.throws(() => E.build(g, ALL_FILTERS, 'png'), /format/);
    // filtry aplikacji ograniczają eksport do tego, co widać
    const only = E.build(g, { ...ALL_FILTERS, files: false, externals: false }, 'dot');
    assert.ok(only.nodes < r.nodes && !only.text.includes('src/index.js'));
  });
});
