/* ===================== dsm.js — pakiety i macierz zależności (DSM), bez DOM ===================== */
// Jednostki: pakiety z manifestów (graph.packages — package.json, Cargo.toml, go.mod, pubspec.yaml, pyproject.toml;
// plik należy do najgłębszego pakietu nad nim), gdy są co najmniej dwa — inaczej foldery na poziomie `depth`.
// Macierz: komórka [i][j] = liczba importów (i referencji) z plików jednostki i do plików jednostki j. Kolejność:
// silnie spójne składowe (Tarjan) posortowane topologicznie — dostawcy u góry, konsumenci niżej — więc zależności
// leżą POD przekątną, a wszystko NAD nią to zależność „pod prąd", czyli cykl między jednostkami.
// Czyste funkcje (testy w Node): CM.DSM.units / matrix / cycles.
CM.DSM = (function(){
  const DEP = new Set(['import', 'reference']);
  const OUTSIDE = '__outside__';

  // → {mode:'packages'|'folders', list:[{id, name, dir, eco?, files}], of(fileNode) → id jednostki | null}
  function units(graph, opts){
    opts = opts || {};
    const pk = (graph.packages || []).filter(p => p && p.name);
    const files = [];
    for(const n of graph.nodes.values()) if(n.type === 'file' && n.path && (!n.gid || n.gid === 'base') && !n.external) files.push(n);
    const mode = opts.mode || (pk.length >= 2 ? 'packages' : 'folders');
    const list = [], byId = new Map();
    const unit = (id, name, dir, eco) => { let u = byId.get(id); if(!u){ u = {id, name, dir, files:0}; if(eco) u.eco = eco; byId.set(id, u); list.push(u); } return u; };
    let of;
    if(mode === 'packages' && pk.length){
      const sorted = pk.slice().sort((a, b) => b.dir.length - a.dir.length);   // najgłębszy pakiet pierwszy
      const cache = new Map();
      of = (n) => {
        const d = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
        if(cache.has(d)) return cache.get(d);
        const p = sorted.find(x => x.dir === '' || d === x.dir || d.startsWith(x.dir + '/'));
        const id = p ? 'pkg:' + p.dir : OUTSIDE;
        cache.set(d, id); return id;
      };
      for(const p of pk) unit('pkg:' + p.dir, p.name, p.dir, p.eco);
    } else {
      const depth = Math.max(1, opts.depth || 1);
      of = (n) => { const segs = n.path.split('/'); return segs.length > depth ? 'dir:' + segs.slice(0, depth).join('/') : OUTSIDE; };
      for(const n of files){ const id = of(n); if(id !== OUTSIDE) unit(id, id.slice(4), id.slice(4)); }
    }
    let outside = 0;
    for(const n of files){ const id = of(n); if(id === OUTSIDE){ outside++; continue; } byId.get(id).files++; }
    if(outside) unit(OUTSIDE, mode === 'packages' ? '(poza pakietami)' : '(korzeń)', '').files = outside;
    return {mode, list: list.filter(u => u.files > 0), of};
  }

  // Tarjan (iteracyjnie) na grafie jednostek adj: Map id → Set id → [[id…]] w kolejności odwrotnie topologicznej
  function scc(ids, adj){
    let idx = 0; const index = new Map(), low = new Map(), stack = [], on = new Set(), out = [];
    for(const s of ids){
      if(index.has(s)) continue;
      const work = [{v: s, it: [...(adj.get(s) || [])], i: 0}];
      index.set(s, idx); low.set(s, idx); idx++; stack.push(s); on.add(s);
      while(work.length){
        const f = work[work.length - 1];
        if(f.i < f.it.length){
          const w = f.it[f.i++];
          if(!index.has(w)){ index.set(w, idx); low.set(w, idx); idx++; stack.push(w); on.add(w); work.push({v: w, it: [...(adj.get(w) || [])], i: 0}); }
          else if(on.has(w)) low.set(f.v, Math.min(low.get(f.v), index.get(w)));
        } else {
          work.pop();
          if(work.length){ const p = work[work.length - 1].v; low.set(p, Math.min(low.get(p), low.get(f.v))); }
          if(low.get(f.v) === index.get(f.v)){ const c = []; let w; do{ w = stack.pop(); on.delete(w); c.push(w); } while(w !== f.v); out.push(c); }
        }
      }
    }
    return out;   // Tarjan zwraca składowe od „liści" (dostawców) — czyli już dostawcy przed konsumentami
  }

  // → {mode, units:[{id,name,dir,files,out,in}], cells:number[][] (w kolejności units), pairs: Map 'i>j' → [[src,tgt]…] (≤ maxPairs),
  //    cycles:[[id…]] (składowe > 1), above: liczba niepustych komórek nad przekątną}
  function matrix(graph, opts){
    opts = opts || {};
    const U = units(graph, opts), maxPairs = opts.maxPairs || 200;
    const ids = U.list.map(u => u.id), adj = new Map(ids.map(id => [id, new Set()]));
    const count = new Map(), pairs = new Map();
    for(const e of graph.edges){
      if(!DEP.has(e.type)) continue;
      const s = graph.nodes.get(e.source), t = graph.nodes.get(e.target);
      if(!s || !t || s.type !== 'file' || t.type !== 'file' || !s.path || !t.path) continue;
      const a = U.of(s), b = U.of(t);
      if(a === b || !adj.has(a) || !adj.has(b)) continue;
      adj.get(a).add(b);
      const k = a + '>' + b; count.set(k, (count.get(k) || 0) + 1);
      let l = pairs.get(k); if(!l){ l = []; pairs.set(k, l); } if(l.length < maxPairs) l.push([s.id, t.id]);
    }
    // kolejność: składowe od dostawców; wewnątrz składowej i przy remisach — po nazwie
    const byName = (x, y) => { const a = U.list.find(u => u.id === x).name, b = U.list.find(u => u.id === y).name; return a < b ? -1 : a > b ? 1 : 0; };
    const comps = scc(ids.slice().sort(byName), adj);
    const order = [];
    for(const c of comps) order.push(...c.sort(byName));
    const pos = new Map(order.map((id, i) => [id, i]));
    const byId = new Map(U.list.map(u => [u.id, u]));
    const units_ = order.map(id => Object.assign({}, byId.get(id), {out: 0, in: 0}));
    const cells = order.map(() => new Array(order.length).fill(0));
    let above = 0;
    for(const [k, n] of count){
      const [a, b] = k.split('>'), i = pos.get(a), j = pos.get(b);
      cells[i][j] = n; units_[i].out += n; units_[j].in += n;
      if(j > i) above++;
    }
    const cycles = comps.filter(c => c.length > 1).map(c => c.slice().sort(byName));
    const pairsOut = new Map();
    for(const [k, l] of pairs){ const [a, b] = k.split('>'); pairsOut.set(pos.get(a) + '>' + pos.get(b), l); }
    return {mode: U.mode, units: units_, cells, pairs: pairsOut, cycles, above};
  }

  // cykle między PAKIETAMI (dla reguły Inspect) — tylko gdy projekt ma ≥ 2 pakiety
  function packageCycles(graph){
    if(!graph.packages || graph.packages.length < 2) return [];
    const m = matrix(graph, {mode: 'packages'});
    const name = new Map(m.units.map(u => [u.id, u]));
    return m.cycles.map(c => c.map(id => name.get(id)));
  }

  // Propozycja `.codemap.rules.json` z warstw macierzy (faza 14): warstwa = jednostka (katalog pakietu albo folderu,
  // `dir/**`; zagnieżdżone przed rodzicem, bo liczy się pierwsze dopasowanie; pliki w korzeniu — `*`), zakazy: dostawca
  // (wyżej w macierzy) nie zależy od konsumentów (niżej) — tylko pary, między którymi DZIŚ nie ma zależności pod prąd,
  // więc reguły od razu przechodzą i pilnują, żeby nowe się nie pojawiły; istniejące zależności pod prąd = wyjątki
  // do naprawy. noCycles tylko, gdy projekt nie ma dziś cykli importów między plikami.
  // → {mode, rules:{layers, forbid, noCycles?}, exceptions:[{from, to, count}], text}
  function proposeRules(graph, opts){
    opts = opts || {};
    const en = opts.lang === 'en';
    const m = matrix(graph, opts);
    const keep = m.units.map((u, i) => ({u, i})).filter(({u}) => u.id !== OUTSIDE || m.mode === 'folders');
    // nazwa warstwy: nazwa jednostki, przy powtórce (dwa pakiety „app") z katalogiem
    const dup = new Set(), seenN = new Set();
    for(const {u} of keep){ if(seenN.has(u.name)) dup.add(u.name); seenN.add(u.name); }
    const nameOf = (u) => u.id === OUTSIDE ? '(root)' : dup.has(u.name) ? u.name + ' (' + (u.dir || '.') + ')' : u.name;
    // jednostka korzenia (tryb folderów) = pliki płytsze niż poziom: `*`, `*/*`… do głębokości
    const depth = Math.max(1, opts.depth || 1);
    const globOf = (u) => u.id === OUTSIDE ? (depth === 1 ? '*' : Array.from({length: depth}, (_, k) => Array(k + 1).fill('*').join('/'))) : (u.dir ? u.dir + '/**' : '**');
    // kolejność warstw do dopasowania: najpierw najgłębsze katalogi, `**` (pakiet w korzeniu) i korzeń na końcu
    const catchAll = (l) => (l.match === '**' || Array.isArray(l.match) || l.match === '*') ? 1 : 0;
    const layers = keep.map(({u}) => ({name: nameOf(u), match: globOf(u)}))
      .sort((a, b) => catchAll(a) - catchAll(b) || String(b.match).split('/').length - String(a.match).split('/').length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const forbid = [], exceptions = [];
    for(const {u, i} of keep){
      const to = [];
      for(const {u: v, i: j} of keep){
        if(j <= i) continue;                               // j niżej = konsument u
        if(m.cells[i][j]) exceptions.push({from: nameOf(u), to: nameOf(v), count: m.cells[i][j]});
        else to.push(nameOf(v));
      }
      if(to.length) forbid.push({from: nameOf(u), to: to.length === 1 ? to[0] : to,
        why: en ? 'layers from the dependency matrix: a provider does not depend on its consumers' : 'warstwy z macierzy zależności: dostawca nie zależy od konsumentów'});
    }
    const rules = {layers, forbid};
    const cyc = typeof graph.importCycles === 'function' ? graph.importCycles() : null;
    if(cyc && !(cyc.components || []).length) rules.noCycles = true;
    return {mode: m.mode, rules, exceptions, text: JSON.stringify(rules, null, 2) + '\n'};
  }

  return {units, matrix, packageCycles, proposeRules, OUTSIDE};
})();
