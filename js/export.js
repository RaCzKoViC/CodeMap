/* ===================== export.js — eksport grafu do DOT / Mermaid / GraphML =====================
   CM.Export — czyste serializery „tego, co widać": wejściem jest wynik graph.getVisible(filters)
   ({nodes, edges}), wyjściem tekst. Zawieranie (foldery) jest oddawane strukturalnie: klastry (DOT),
   subgraph (Mermaid), zagnieżdżone <graph> (GraphML) — dlatego krawędzie `contains` nie są
   powielane jako linie; eksportowane są krawędzie import/reference (z wagą po agregacji
   zwiniętych folderów). Kolory węzłów pochodzą z n.langInfo.color (pliki), stałe dla folderów
   i pakietów zewnętrznych. Bez DOM — testowalne w Node (test/export.test.mjs). */
CM.Export = (function(){
  const FORMATS = ['dot', 'mermaid', 'graphml'];
  const COLOR_FOLDER = '#22d3ee', COLOR_EXT = '#a78bfa', COLOR_FILE = '#7d8aa0';
  const EDGE_TYPES = new Set(['import', 'reference']);

  /* ---------------- wspólne ---------------- */
  function nodeColor(n){
    if(n.type === 'folder') return COLOR_FOLDER;
    if(n.type === 'external') return COLOR_EXT;
    return (n.langInfo && n.langInfo.color) || COLOR_FILE;
  }
  function langKey(n){
    if(n.type === 'folder') return 'folder';
    if(n.type === 'external') return 'external';
    return n.lang || 'file';
  }
  // Drzewo widocznych węzłów: dziecko trafia do rodzica tylko, gdy rodzic też jest widoczny
  // (foldery wyłączone filtrem → wszystko na najwyższym poziomie). Kolejność stabilna (po id).
  function tree(vis){
    const nodes = (vis.nodes || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const kids = new Map();
    const roots = [];
    for(const n of nodes){
      const p = n.parent != null && byId.has(n.parent) ? n.parent : null;
      if(p == null){ roots.push(n); continue; }
      if(!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    }
    return { nodes, byId, roots, kids };
  }
  function depEdges(vis, byId){
    const out = [];
    for(const e of (vis.edges || [])){
      if(!EDGE_TYPES.has(e.type)) continue;
      if(!byId.has(e.source) || !byId.has(e.target)) continue;
      out.push(e);
    }
    return out;
  }
  function label(n){ return n.name || n.id; }

  /* ---------------- DOT (Graphviz) ---------------- */
  const dotStr = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
  const dotId = (s) => 'cluster_' + String(s).replace(/[^A-Za-z0-9_]/g, '_');
  function toDOT(vis, opts){
    opts = opts || {};
    const T = tree(vis);
    const L = [];
    L.push('digraph ' + dotStr(opts.name || 'codemap') + ' {');
    L.push('  graph [rankdir=LR, fontname="Helvetica", compound=true];');
    L.push('  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10, color="#334155"];');
    L.push('  edge [color="#64748b", arrowsize=0.7];');
    const emitNode = (n, ind) => {
      const attrs = ['label=' + dotStr(label(n)), 'fillcolor=' + dotStr(nodeColor(n) + '33'), 'color=' + dotStr(nodeColor(n))];
      if(n.type === 'external') attrs.push('shape=ellipse');
      if(n.path) attrs.push('tooltip=' + dotStr(n.path));
      L.push(ind + dotStr(n.id) + ' [' + attrs.join(', ') + '];');
    };
    const walk = (n, ind) => {
      const ch = T.kids.get(n.id);
      if(n.type === 'folder' && ch && ch.length){
        L.push(ind + 'subgraph ' + dotStr(dotId(n.id)) + ' {');
        L.push(ind + '  label=' + dotStr(label(n)) + '; style="rounded,dashed"; color=' + dotStr(nodeColor(n)) + ';');
        emitNode(n, ind + '  ');
        for(const c of ch) walk(c, ind + '  ');
        L.push(ind + '}');
      } else {
        emitNode(n, ind);
      }
    };
    for(const r of T.roots) walk(r, '  ');
    for(const e of depEdges(vis, T.byId)){
      const attrs = [];
      if(e.type === 'reference') attrs.push('style=dashed');
      if(e.weight > 1){ attrs.push('label=' + dotStr(String(e.weight))); attrs.push('penwidth=' + Math.min(4, 1 + Math.log2(e.weight)).toFixed(1)); }
      L.push('  ' + dotStr(e.source) + ' -> ' + dotStr(e.target) + (attrs.length ? ' [' + attrs.join(', ') + ']' : '') + ';');
    }
    L.push('}');
    return L.join('\n') + '\n';
  }

  /* ---------------- Mermaid (flowchart LR) ---------------- */
  // Identyfikatory Mermaid: tylko [A-Za-z0-9_]; ścieżki mapowane deterministycznie z deduplikacją.
  function mermaidIds(nodes){
    const map = new Map(), used = new Set();
    for(const n of nodes){
      let base = 'n_' + String(n.id).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
      if(base === 'n_') base = 'n_x';
      let id = base, k = 2;
      while(used.has(id)) id = base + '_' + (k++);
      used.add(id); map.set(n.id, id);
    }
    return map;
  }
  const mmStr = (s) => '"' + String(s).replace(/"/g, '#quot;').replace(/[<>]/g, c => (c === '<' ? '#lt;' : '#gt;')).replace(/\r?\n/g, ' ') + '"';
  const mmCls = (s) => 'lang_' + String(s).replace(/[^A-Za-z0-9_]/g, '_');
  function toMermaid(vis, opts){
    opts = opts || {};
    const T = tree(vis);
    const ids = mermaidIds(T.nodes);
    const L = ['flowchart LR'];
    const classes = new Map();   // lang → {color, members[]}
    const emitNode = (n, ind) => {
      const id = ids.get(n.id);
      const shape = n.type === 'external' ? '([' + mmStr(label(n)) + '])' : n.type === 'folder' ? '[[' + mmStr(label(n)) + ']]' : '[' + mmStr(label(n)) + ']';
      L.push(ind + id + shape);
      const k = langKey(n);
      if(!classes.has(k)) classes.set(k, { color: nodeColor(n), members: [] });
      classes.get(k).members.push(id);
    };
    const walk = (n, ind) => {
      const ch = T.kids.get(n.id);
      if(n.type === 'folder' && ch && ch.length){
        L.push(ind + 'subgraph sg_' + ids.get(n.id) + ' [' + mmStr(label(n)) + ']');
        emitNode(n, ind + '  ');
        for(const c of ch) walk(c, ind + '  ');
        L.push(ind + 'end');
      } else {
        emitNode(n, ind);
      }
    };
    for(const r of T.roots) walk(r, '  ');
    for(const e of depEdges(vis, T.byId)){
      const arrow = e.type === 'reference' ? '-.->' : '-->';
      const w = e.weight > 1 ? '|' + mmStr('×' + e.weight) + '|' : '';
      L.push('  ' + ids.get(e.source) + ' ' + arrow + w + ' ' + ids.get(e.target));
    }
    for(const [k, c] of classes){
      L.push('  classDef ' + mmCls(k) + ' fill:' + c.color + '33,stroke:' + c.color + ',color:inherit');
      L.push('  class ' + c.members.join(',') + ' ' + mmCls(k));
    }
    if(opts.name) L.unshift('%% ' + String(opts.name).replace(/\r?\n/g, ' '));
    return L.join('\n') + '\n';
  }

  /* ---------------- GraphML (yEd-kompatybilny) ---------------- */
  const xml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  function toGraphML(vis, opts){
    opts = opts || {};
    const T = tree(vis);
    const L = [];
    L.push('<?xml version="1.0" encoding="UTF-8"?>');
    L.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    L.push('  xmlns:y="http://www.yworks.com/xml/graphml"');
    L.push('  xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://www.yworks.com/xml/schema/graphml/1.1/ygraphml.xsd">');
    L.push('  <key id="d_label" for="node" attr.name="label" attr.type="string"/>');
    L.push('  <key id="d_type" for="node" attr.name="type" attr.type="string"/>');
    L.push('  <key id="d_lang" for="node" attr.name="lang" attr.type="string"/>');
    L.push('  <key id="d_path" for="node" attr.name="path" attr.type="string"/>');
    L.push('  <key id="d_size" for="node" attr.name="size" attr.type="long"/>');
    L.push('  <key id="d_lines" for="node" attr.name="lines" attr.type="int"/>');
    L.push('  <key id="d_ng" for="node" yfiles.type="nodegraphics"/>');
    L.push('  <key id="e_type" for="edge" attr.name="type" attr.type="string"/>');
    L.push('  <key id="e_weight" for="edge" attr.name="weight" attr.type="int"/>');
    L.push('  <key id="e_eg" for="edge" yfiles.type="edgegraphics"/>');
    L.push('  <graph id="G" edgedefault="directed">');
    const dataOf = (n) => {
      const lines = n.type === 'file' ? (n.metrics ? (n.metrics.lines || 0) : 0) : (n.totalLines || 0);
      const size = n.type === 'file' ? (n.size || 0) : (n.totalSize || 0);
      const col = nodeColor(n);
      return [
        '<data key="d_label">' + xml(label(n)) + '</data>',
        '<data key="d_type">' + xml(n.type) + '</data>',
        '<data key="d_lang">' + xml(langKey(n)) + '</data>',
        '<data key="d_path">' + xml(n.path || n.id) + '</data>',
        '<data key="d_size">' + (size | 0) + '</data>',
        '<data key="d_lines">' + (lines | 0) + '</data>',
        '<data key="d_ng"><y:ShapeNode><y:Fill color="' + xml(col) + '" transparent="false"/><y:BorderStyle color="#334155" type="line" width="1.0"/>' +
          '<y:NodeLabel>' + xml(label(n)) + '</y:NodeLabel><y:Shape type="' + (n.type === 'external' ? 'ellipse' : 'roundrectangle') + '"/></y:ShapeNode></data>',
      ];
    };
    let gseq = 0;
    const walk = (n, ind) => {
      const ch = T.kids.get(n.id);
      L.push(ind + '<node id="' + xml(n.id) + '">');
      for(const d of dataOf(n)) L.push(ind + '  ' + d);
      if(n.type === 'folder' && ch && ch.length){
        L.push(ind + '  <graph id="g' + (++gseq) + '" edgedefault="directed">');
        for(const c of ch) walk(c, ind + '    ');
        L.push(ind + '  </graph>');
      }
      L.push(ind + '</node>');
    };
    for(const r of T.roots) walk(r, '    ');
    let eseq = 0;
    for(const e of depEdges(vis, T.byId)){
      L.push('    <edge id="e' + (++eseq) + '" source="' + xml(e.source) + '" target="' + xml(e.target) + '">');
      L.push('      <data key="e_type">' + xml(e.type) + '</data>');
      L.push('      <data key="e_weight">' + ((e.weight || 1) | 0) + '</data>');
      L.push('      <data key="e_eg"><y:PolyLineEdge><y:LineStyle color="#64748b" type="' + (e.type === 'reference' ? 'dashed' : 'line') + '" width="1.0"/><y:Arrows source="none" target="standard"/></y:PolyLineEdge></data>');
      L.push('    </edge>');
    }
    L.push('  </graph>');
    L.push('</graphml>');
    return L.join('\n') + '\n';
  }

  /* ---------------- fasada dla UI / ChatBota ---------------- */
  const META = {
    dot:     { ext: '.dot',     mime: 'text/vnd.graphviz', fn: toDOT },
    mermaid: { ext: '.mmd',     mime: 'text/plain',        fn: toMermaid },
    graphml: { ext: '.graphml', mime: 'application/xml',   fn: toGraphML },
  };
  // graph + filtry aplikacji → {text, filename, mime}; eksportowane jest to, co widać na mapie
  function build(graph, filters, format){
    format = String(format || 'dot').toLowerCase();
    const m = META[format];
    if(!m) throw new Error('format: ' + FORMATS.join('|'));
    const F = filters || { folders: true, files: true, externals: true, contains: true, import: true, reference: true, langsOff: new Set(), metric: 'lines', minMetric: 0 };
    const vis = graph.getVisible(F);
    const name = (graph.meta && graph.meta.name) || 'codemap';
    const safe = String(name).replace(/[^\w.-]+/g, '_') || 'codemap';
    return { text: m.fn(vis, { name }), filename: safe + m.ext, mime: m.mime, nodes: vis.nodes.length, edges: vis.edges.filter(e => EDGE_TYPES.has(e.type)).length };
  }
  function download(graph, filters, format){
    const r = build(graph, filters, format);
    CM.util.download(r.filename, r.text, r.mime);
    return r;
  }

  return { FORMATS, toDOT, toMermaid, toGraphML, build, download };
})();
