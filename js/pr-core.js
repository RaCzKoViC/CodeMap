/* ===================== pr-core.js — mapa wpływu PR (bez DOM) ===================== */
// Wejście: graf mapy (gałąź bazowa) + lista plików zmienionych w PR {path, status:'A'|'M'|'D'|'R', from?, add?, del?}.
// Wyjście: zmienione pliki z oceną ryzyka 0–100 i jej składnikami, pliki zależne (odwrotny BFS po importach
// z odległością), sugerowani recenzenci z historii git i podsumowanie PR. Ryzyko pliku łączy to, co mapa już wie:
// częstość zmian (git), złożoność, liczbę zależnych, brak testów / pokrycia, rozmiar zmiany i to, czy autor PR
// zna plik. Czyste funkcje — testy w Node; interfejs w pr.js, CLI korzysta z tego samego.
CM.PRCore = (function(){
  // wagi składników (suma 1); brak danych dla składnika = jego waga rozkładana na pozostałe
  const W={churn:0.22, complexity:0.22, dependents:0.18, tests:0.16, size:0.12, familiarity:0.10};
  const logn=(v, max)=>max>0?Math.min(1, Math.log1p(Math.max(0,v))/Math.log1p(max)):0;
  // złożoność i testy mają sens tylko dla kodu — README, konfiguracja czy obrazy ich nie mają
  const CODE_RE=/\.(m?[jt]sx?|cjs|cts|mts|vue|svelte|py|java|kt|kts|scala|go|rs|rb|php|cs|c|cc|cpp|cxx|h|hpp|swift|dart|ex|exs|lua|zig|hs|clj|groovy|sh)$/i;
  const isCode=(p)=>(CM.TestMap&&CM.TestMap.isCodeFile)?CM.TestMap.isCodeFile(p):CODE_RE.test(String(p||''));

  // odwrotny BFS: kto (przechodnio) importuje zmienione pliki; depth ≤ maxDepth
  function dependents(graph, ids, maxDepth){
    maxDepth=maxDepth||3;
    const rev=new Map();
    for(const e of graph.edges){ if(e.type!=='import'&&e.type!=='reference') continue; let a=rev.get(e.target); if(!a){ a=[]; rev.set(e.target,a); } a.push(e.source); }
    const dist=new Map(), q=[];
    for(const id of ids){ dist.set(id,0); q.push(id); }
    for(let h=0; h<q.length; h++){ const cur=q[h], d=dist.get(cur); if(d>=maxDepth) continue;
      for(const w of (rev.get(cur)||[])) if(!dist.has(w)){ dist.set(w,d+1); q.push(w); } }
    for(const id of ids) dist.delete(id);
    return dist;   // id → odległość (1 = importuje zmieniony plik bezpośrednio)
  }
  function fileIndex(graph){ const m=new Map(); for(const n of graph.nodes.values()) if(n.type==='file'&&n.path&&(!n.gid||n.gid==='base')) m.set(n.path,n); return m; }
  function authorMatches(gi, ai, login, name){
    const a=gi&&gi.authors&&gi.authors[ai]; if(!a) return false;
    const L=String(login||'').toLowerCase(), N=String(name||'').toLowerCase();
    return (!!L && String(a.login||'').toLowerCase()===L) || (!!N && String(a.name||'').toLowerCase()===N);
  }

  // files: pliki PR (ścieżki względem korzenia mapy — podkatalog odcina wywołujący); pr: {author:{login,name}}
  function analyze(graph, files, pr){
    pr=pr||{};
    const idx=fileIndex(graph), gi=graph.gitInfo||null, ti=graph.testInfo||null;
    const hasTests=!!(ti&&((ti.tests||0)>0)), hasCov=!!(ti&&ti.coverage&&ti.coverage.files>0);
    const changed=[], outside=[];
    for(const f of (files||[])){
      const n=idx.get(f.path)||(f.from?idx.get(f.from):null);
      if(!n){ outside.push({path:f.path, status:f.status, add:f.add||0, del:f.del||0}); continue; }
      changed.push({id:n.id, path:f.path, status:f.status, from:f.from||null, add:f.add||0, del:f.del||0, node:n});
    }
    const dep=dependents(graph, changed.map(c=>c.id), 3);
    // maksima do normalizacji — z całego projektu (ryzyko względem reszty kodu, nie tylko w obrębie PR)
    let maxC=1, maxCx=1, maxIn=1, maxSize=1;
    for(const n of idx.values()){ if(n.git) maxC=Math.max(maxC,n.git.c); if(n.metrics&&isCode(n.path)) maxCx=Math.max(maxCx,n.metrics.complexity||0); maxIn=Math.max(maxIn,(n.importsIn||[]).length); }
    for(const c of changed) maxSize=Math.max(maxSize, c.add+c.del);
    const direct=new Map(); for(const [id,d] of dep) if(d===1) direct.set(id,true);
    for(const c of changed){
      const n=c.node, parts={};
      const code=isCode(n.path||c.path);
      if(gi&&n.git) parts.churn=logn(n.git.c+(n.git.recent||0), maxC*1.5);
      if(code && n.metrics) parts.complexity=logn(n.metrics.complexity||0, maxCx);
      parts.dependents=logn((n.importsIn||[]).length, maxIn);
      if(code && hasCov && n.coverage && n.coverage.pct!=null) parts.tests=1-n.coverage.pct/100;
      else if(code && hasTests && !n.isTest) parts.tests=(n.testedBy&&n.testedBy.length)?0.15:1;
      parts.size=logn(c.add+c.del, Math.max(200, maxSize));
      if(gi && n.git && (pr.author&&(pr.author.login||pr.author.name))){
        const knows=n.git.a.some(x=>authorMatches(gi, x[0], pr.author.login, pr.author.name));
        parts.familiarity=knows?0:1;
      }
      if(c.status==='D'){ parts.size=Math.max(parts.size||0, 0.5); }   // usunięcie pliku, od którego coś zależy, boli
      let wsum=0, s=0; for(const k in parts){ wsum+=W[k]; s+=W[k]*parts[k]; }
      c.parts=parts; c.risk=Math.round(wsum?100*s/wsum:0);
      c.importers=(n.importsIn||[]).length;
      delete c.node;
    }
    changed.sort((a,b)=>b.risk-a.risk);
    const top=changed.slice(0,3).map(c=>c.risk);
    const risk=changed.length?Math.round(0.6*top[0]+0.4*(top.reduce((s,v)=>s+v,0)/top.length)):0;
    return {changed, outside, impacted:dep, direct:direct.size, risk, level:risk>=60?'high':risk>=35?'med':'low',
      reviewers:reviewers(graph, changed, pr), add:changed.reduce((s,c)=>s+c.add,0)+outside.reduce((s,c)=>s+c.add,0),
      del:changed.reduce((s,c)=>s+c.del,0)+outside.reduce((s,c)=>s+c.del,0)};
  }

  // recenzenci: autorzy zmienianych plików ważeni udziałem w pliku i ryzykiem pliku (bez autora PR i botów)
  function reviewers(graph, changed, pr){
    const gi=graph.gitInfo; if(!gi||!gi.authors) return [];
    const idx=fileIndex(graph), score=new Map(), files=new Map();
    for(const c of changed){ const n=idx.get(c.path)||(c.from?idx.get(c.from):null); if(!n||!n.git) continue;
      const tot=n.git.a.reduce((s,x)=>s+x[1],0)||1;
      for(const [ai,k] of n.git.a){ const a=gi.authors[ai]; if(!a||a.bot) continue;
        if(pr&&pr.author&&authorMatches(gi, ai, pr.author.login, pr.author.name)) continue;
        score.set(ai,(score.get(ai)||0)+(k/tot)*(0.5+(c.risk||0)/100)); files.set(ai,(files.get(ai)||0)+1); } }
    return [...score.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5)
      .map(([ai,s])=>({author:ai, name:gi.authors[ai].name, login:gi.authors[ai].login||null, score:+s.toFixed(2), files:files.get(ai)}));
  }

  // numer PR z adresu albo „#12" / „12"
  function parsePR(input){
    const s=String(input||'').trim();
    let m=/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i.exec(s); if(m) return {host:'github', repo:m[1], number:+m[2]};
    m=/gitlab\.com\/(.+?)\/-\/merge_requests\/(\d+)/i.exec(s); if(m) return {host:'gitlab', repo:m[1], number:+m[2]};
    m=/bitbucket\.org\/([^/]+\/[^/]+)\/pull-requests\/(\d+)/i.exec(s); if(m) return {host:'bitbucket', repo:m[1], number:+m[2]};
    m=/^#?(\d{1,7})$/.exec(s); if(m) return {number:+m[1]};
    return null;
  }

  // krótkie podsumowanie Markdown (komentarz w PR z CLI / Action, raport z aplikacji)
  function summaryMarkdown(res, pr, opts){
    opts=opts||{}; const L=opts.lang==='en';
    const lvl={high:L?'🔴 high':'🔴 wysokie', med:L?'🟠 medium':'🟠 średnie', low:L?'🟢 low':'🟢 niskie'}[res.level];
    const out=[];
    out.push('### CodeMap — '+(L?'PR impact':'wpływ PR')+(pr&&pr.number?(' #'+pr.number):'')+(pr&&pr.title?(': '+pr.title):''));
    out.push('');
    out.push((L?'**Risk:** ':'**Ryzyko:** ')+lvl+' ('+res.risk+'/100) · '+(L?'files: ':'plików: ')+(res.changed.length+res.outside.length)
      +' (+'+res.add+' / −'+res.del+') · '+(L?'dependents: ':'zależne: ')+res.impacted.size+(L?' (direct ':' (bezpośrednio ')+res.direct+')');
    if(res.changed.length){
      out.push(''); out.push(L?'| File | Change | Risk | Why |':'| Plik | Zmiana | Ryzyko | Dlaczego |'); out.push('|---|---|---|---|');
      const why=(p)=>Object.entries(p).filter(([,v])=>v>=0.6).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>({churn:L?'changes often':'częste zmiany', complexity:L?'complex':'złożony', dependents:L?'many dependents':'dużo zależnych', tests:L?'weak tests':'słabe testy', size:L?'large change':'duża zmiana', familiarity:L?'new area for the author':'nowy obszar autora'}[k])).join(', ');
      for(const c of res.changed.slice(0,opts.max||10)) out.push('| `'+c.path+'` | '+c.status+' +'+c.add+'/−'+c.del+' | '+c.risk+' | '+(why(c.parts)||'—')+' |');
      if(res.changed.length>(opts.max||10)) out.push((L?'…and ':'…i ')+(res.changed.length-(opts.max||10))+(L?' more':' więcej'));
    }
    if(res.reviewers.length){ out.push(''); out.push((L?'**Suggested reviewers:** ':'**Sugerowani recenzenci:** ')+res.reviewers.slice(0,3).map(r=>r.login?('@'+r.login):r.name).join(', ')); }
    if(opts.link){ out.push(''); out.push('[🗺️ '+(L?'Open the impact map':'Otwórz mapę wpływu')+']('+opts.link+')'); }
    return out.join('\n');
  }

  return {analyze, dependents, reviewers, parsePR, summaryMarkdown, W};
})();
