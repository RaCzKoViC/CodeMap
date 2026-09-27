/* ===================== health-trend.js — trend zdrowia w czasie (faza 10), bez DOM ===================== */
// Wspólne dla CLI (`codemap analyze --history N`, cli/history.mjs) i aplikacji (okno „Trend zdrowia", health-trend-ui.js):
// N commitów rozłożonych równo na historii pierwszego rodzica HEAD, drzewo każdego czytane wprost z .git
// (CM.GitLocal.open(...).snapshot — bez checkoutu), reguły wczytywania jak dla folderu (CM.Loaders.shouldSkip, globy
// wykluczeń, limit plików z treścią), potem graf, testy ↔ kod i reguły Inspect. Bez historii git i pokrycia — punkty
// mają być porównywalne (reguły git zależą od długości historii).
CM.HealthTrend = (function(){
  // równomiernie rozłożone indeksy 0 … len−1 (pierwszy i ostatni zawsze), rosnąco, bez powtórzeń
  function sampleIndexes(len, n){
    if(len <= 0 || n <= 0) return [];
    if(n >= len) return Array.from({length: len}, (_, i) => i);
    if(n === 1) return [len - 1];
    const out = new Set();
    for(let k = 0; k < n; k++) out.add(Math.round(k * (len - 1) / (n - 1)));
    return [...out].sort((a, b) => a - b);
  }
  // ścieżka z drzewa commita przechodzi reguły wczytywania: żaden przodek ani sam plik nie jest pomijany / wykluczony
  function accept(rel, exclude){
    const L = CM.Loaders, ex = (exclude || []).filter(Boolean);
    const bad = (r) => L.shouldSkip(r) || (ex.length > 0 && CM.Rules.matchGlob(ex, r));
    const segs = rel.split('/');
    for(let i = 1; i < segs.length; i++) if(bad(segs.slice(0, i).join('/'))) return false;
    return !bad(rel);
  }

  // repo = wynik CM.GitLocal.open(files); o: {n, sub, exclude, maxContent, maxCommits, signal, onPoint(p, i, total), tick(),
  //   cache:{get(sha) → punkt|undefined, set(sha, punkt)}} — punkt z pamięci nie jest liczony od nowa (drugie otwarcie od razu)
  // → {points:[{sha, date, time, message, score, files, lines, totals, rules}] od najstarszego, chain, sampled}
  async function compute(repo, o){
    o = o || {};
    const L = CM.Loaders, dec = new TextDecoder('utf-8');
    const aborted = () => o.signal && o.signal.aborted;
    const chain = [], maxCommits = o.maxCommits || 5000;
    let c = await repo.commit('HEAD');
    while(c && chain.length < maxCommits){
      if(aborted()) throw Object.assign(new Error('aborted'), {name: 'AbortError'});
      chain.push(c); c = c.parents.length ? await repo.commit(c.parents[0]).catch(() => null) : null;
    }
    chain.reverse();
    const idx = sampleIndexes(chain.length, Math.max(1, Math.floor(o.n || 8)));
    const pre = o.sub ? o.sub.replace(/\/+$/, '') + '/' : '';
    const maxContent = o.maxContent != null ? o.maxContent : L.MAX_CONTENT_FILES;
    const points = [];
    for(const i of idx){
      if(aborted()) throw Object.assign(new Error('aborted'), {name: 'AbortError'});
      const cm = chain[i], hit = o.cache && o.cache.get ? o.cache.get(cm.sha) : null;
      if(hit){ points.push(hit); if(o.onPoint) o.onPoint(hit, points.length, idx.length); continue; }
      const snap = await repo.snapshot(cm.sha), files = [];
      let withContent = 0;
      for(const f of snap.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))){
        if(pre && !f.path.startsWith(pre)) continue;
        const rel = f.path.slice(pre.length);
        if(!accept(rel, o.exclude)) continue;
        const name = rel.slice(rel.lastIndexOf('/') + 1);
        let content = null, size = 0;
        if(L.isTextFile(name, 0) && withContent < maxContent){
          const data = await repo.blob(f.sha);
          size = data ? data.length : 0;
          if(data && L.isTextFile(name, size)){ content = dec.decode(data); withContent++; }
        }
        files.push({path: rel, size, content, mtime: (cm.committer && cm.committer.time) || null});
      }
      const graph = new CM.Graph.Graph();
      graph.build(files, {name: 'history', source: 'history', kind: 'local'});
      if(CM.TestMap) CM.TestMap.mapTests(graph);
      const rep = await CM.Inspect.run(graph);
      const totals = {findings: 0, high: 0, med: 0, low: 0, info: 0}, rules = {};
      for(const f of rep.findings){
        totals.findings += f.count; rules[f.rule] = f.count;
        for(const it of f.items) totals[it.sev]++;
        totals[f.sev] += f.count - f.items.length;
      }
      let lines = 0; for(const nd of graph.nodes.values()) if(nd.type === 'file' && nd.metrics) lines += nd.metrics.lines;
      const time = (cm.author && cm.author.time) || (cm.committer && cm.committer.time) || null;
      const p = {sha: cm.sha, date: time ? new Date(time).toISOString().slice(0, 10) : null, time, message: String(cm.message || '').split('\n')[0].slice(0, 120),
        score: rep.score, files: files.length, lines, totals, rules};
      points.push(p);
      if(o.cache && o.cache.set) o.cache.set(cm.sha, p);
      if(o.onPoint) o.onPoint(p, points.length, idx.length);
      if(o.tick) await o.tick();
    }
    return {points, chain: chain.length, sampled: idx.length};
  }

  // największe zmiany reguł między pierwszym a ostatnim punktem: [[reguła, delta]] malejąco po |delta|
  function ruleDeltas(points, max){
    if(!points || points.length < 2) return [];
    const a = points[0], b = points[points.length - 1];
    const rules = new Set([...Object.keys(a.rules), ...Object.keys(b.rules)]);
    return [...rules].map(r => [r, (b.rules[r] || 0) - (a.rules[r] || 0)]).filter(([, x]) => x).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, max || 8);
  }

  return {sampleIndexes, accept, compute, ruleDeltas};
})();
