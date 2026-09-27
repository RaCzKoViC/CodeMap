/* ===================== git-core.js — analiza historii git (bez DOM) ===================== */
// Wejście: commity z git-local.js (lokalny .git) albo git-remote.js (API GitHub/GitLab/Bitbucket),
// NAJNOWSZE PIERWSZE: {sha, parents, merge, boundary, author:{name, email, login?, avatar?}, authorTime, time,
//   message, files:[{path, status:'A'|'M'|'D'|'R', from?, add?, del?}]}
// analyze() liczy statystyki per BIEŻĄCY plik (zmiany nazw śledzone wstecz), scala tożsamości autorów,
// wyznacza własność plików, bus factor (truck factor) i zdarzenia osi czasu. Czyste funkcje — testy w Node.
CM.GitCore = (function(){
  const DAY=864e5, RECENT_DAYS=90;
  const ST_CODE={A:0, M:1, D:2, R:3}, ST_CHAR=['A','M','D','R'];

  // ---------------- tożsamości autorów ----------------
  // Ta sama osoba bywa pod kilkoma e-mailami (praca/dom, noreply GitHuba) albo pisownią imienia —
  // union-find po e-mailu, loginie i znormalizowanym imieniu (tylko „prawdziwe" imiona: ze spacją lub ≥ 5 znaków).
  const GENERIC=new Set(['root','admin','administrator','user','unknown','github','gitlab','bitbucket','web flow','ubuntu','runner','git']);
  function normName(s){ return String(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
  function loginFromEmail(e){ const m=/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(String(e||'').trim()); return m?m[1]:null; }
  function isBot(a){ const n=String(a&&a.name||'')+' '+String(a&&a.email||'')+' '+String(a&&a.login||''); return /\[bot\]|\bbot\b|dependabot|renovate|github-actions|greenkeeper|snyk-bot/i.test(n); }
  function identities(commits){
    const parent=new Map();
    const find=(k)=>{ let r=k; while(parent.get(r)!==r) r=parent.get(r); let x=k; while(parent.get(x)!==r){ const nx=parent.get(x); parent.set(x,r); x=nx; } return r; };
    const add=(k)=>{ if(!parent.has(k)) parent.set(k,k); return k; };
    const union=(a,b)=>{ const ra=find(a), rb=find(b); if(ra!==rb) parent.set(rb,ra); };
    const keysOf=(a)=>{
      const out=[]; if(!a) return out;
      const email=String(a.email||'').trim().toLowerCase(), login=String(a.login||loginFromEmail(a.email)||'').trim().toLowerCase();
      const nn=normName(a.name);
      if(email) out.push('e:'+email);
      if(login) out.push('l:'+login);
      if(nn && !GENERIC.has(nn) && (nn.includes(' ') || nn.length>=5)) out.push('n:'+nn);
      if(!out.length) out.push('r:'+(nn||email||'?'));
      return out;
    };
    for(const c of commits){ const ks=keysOf(c.author); ks.forEach(add); for(let i=1;i<ks.length;i++) union(ks[0],ks[i]); }
    const idxOfRoot=new Map(), authors=[];
    const idx=(a)=>{
      const r=find(keysOf(a)[0]||'r:?');
      let i=idxOfRoot.get(r);
      if(i==null){ i=authors.length; idxOfRoot.set(r,i); authors.push({name:'', email:'', login:null, avatar:null, commits:0, lines:0, files:0, owned:0, first:Infinity, last:0, bot:false, _names:new Map()}); }
      const au=authors[i];
      if(a){
        const nm=String(a.name||'').trim(); if(nm) au._names.set(nm,(au._names.get(nm)||0)+1);
        if(!au.email && a.email) au.email=String(a.email).trim();
        const lg=a.login||loginFromEmail(a.email); if(lg && !au.login) au.login=lg;
        if(a.avatar && !au.avatar) au.avatar=a.avatar;
        if(isBot(a)) au.bot=true;
      }
      return i;
    };
    return {idx, authors};
  }

  // ---------------- podkatalog: repo wczytane od „sub/" → ścieżki względem mapy ----------------
  function rebase(commits, sub){
    const pre=String(sub||'').replace(/^\/+|\/+$/g,''); if(!pre) return commits;
    const P=pre+'/', cut=(p)=>p&&p.startsWith(P)?p.slice(P.length):null;
    return commits.map(c=>{
      const files=[];
      for(const f of (c.files||[])){ const p=cut(f.path); if(p==null) continue; const g=Object.assign({}, f, {path:p}); if(f.from!=null){ const fr=cut(f.from); if(fr==null){ g.status='A'; delete g.from; } else g.from=fr; } files.push(g); }
      return Object.assign({}, c, {files});
    });
  }

  // ścieżki git są względem korzenia repozytorium, a mapa bywa zbudowana z folderem korzenia na początku
  // (przeciągnięty folder: „Projekt/src/x.js"). Zwraca prefiks „Projekt/", jeśli z nim dopasowuje się więcej
  // ścieżek z historii niż bez niego; inaczej ''.
  function detectPrefix(commits, mapPaths){
    const paths=[...mapPaths]; if(!paths.length) return '';
    const first=paths[0].split('/')[0]; if(!first || paths[0]===first) return '';
    const pre=first+'/'; if(!paths.every(p=>p.startsWith(pre))) return '';
    const set=new Set(paths); let plain=0, pref=0, k=0;
    outer: for(const c of commits||[]) for(const f of (c.files||[])){ if(set.has(f.path)) plain++; if(set.has(pre+f.path)) pref++; if(++k>=4000) break outer; }
    return pref>plain?pre:'';
  }
  function prefixPaths(commits, pre){
    if(!pre) return commits;
    return commits.map(c=>Object.assign({}, c, {files:(c.files||[]).map(f=>{ const g=Object.assign({}, f, {path:pre+f.path}); if(f.from!=null) g.from=pre+f.from; return g; })}));
  }

  // ---------------- analiza ----------------
  // currentPaths: ścieżki plików na mapie (względem jej korzenia). opts: {maxTimeline=3000, maxEventsPerCommit=300}
  function analyze(commits, currentPaths, opts){
    opts=opts||{};
    const list=(commits||[]).filter(Boolean);
    const cur=new Set(currentPaths||[]);
    const alias=new Map(); for(const p of cur) alias.set(p,p);
    const ids=identities(list);
    const files=new Map();          // bieżąca ścieżka → statystyki
    let newest=0, oldest=Infinity, nonMerge=0;
    for(const c of list){ const t=c.authorTime||c.time||0; if(t>newest) newest=t; if(t&&t<oldest) oldest=t; }
    const recentFrom=newest-RECENT_DAYS*DAY;
    const tlFiles=[], tlIdx=new Map(), tl=[];
    const fileIdx=(p)=>{ let i=tlIdx.get(p); if(i==null){ i=tlFiles.length; tlIdx.set(p,i); tlFiles.push(p); } return i; };
    const maxEv=opts.maxEventsPerCommit||300;
    let untracked=0;                // zmiany plików, których już nie ma na mapie (usunięte / spoza wczytanego drzewa)

    for(const c of list){           // od najnowszego do najstarszego — alias prowadzi starą nazwę do bieżącej
      const ai=ids.idx(c.author);
      if(c.merge) continue;
      nonMerge++;
      const t=c.authorTime||c.time||0, au=ids.authors[ai];
      au.commits++; if(t<au.first) au.first=t; if(t>au.last) au.last=t;
      const ev=[];
      for(const f of (c.files||[])){
        let p;
        if(f.status==='R'){ p=alias.get(f.path); alias.delete(f.path); if(p && f.from) alias.set(f.from,p); }
        else if(f.status==='A'){ p=alias.get(f.path); if(p) alias.delete(f.path); }
        else p=alias.get(f.path);
        const lines=(f.add||0)+(f.del||0); au.lines+=lines;
        if(!p){ untracked++; continue; }
        let st=files.get(p);
        if(!st){ st={c:0, add:0, del:0, lines:false, first:Infinity, last:0, recent:0, born:null, a:new Map()}; files.set(p,st); }
        st.c++; if(f.add!=null){ st.add+=f.add||0; st.del+=f.del||0; st.lines=true; }
        if(t<st.first) st.first=t; if(t>st.last) st.last=t; if(t>=recentFrom) st.recent++;
        if(f.status==='A' && !c.boundary) st.born=t;        // najstarsze dodanie wygrywa (idziemy wstecz)
        const x=st.a.get(ai)||{c:0,l:0}; x.c++; x.l+=lines; st.a.set(ai,x);
        if(ev.length<maxEv*2){ const code=(c.boundary&&f.status==='A')?ST_CODE.M:ST_CODE[f.status]; ev.push(fileIdx(p), code==null?1:code); }
      }
      if(ev.length) tl.push([t, ai, String(c.message||'').split('\n')[0].slice(0,140), ev, c.sha?String(c.sha).slice(0,10):'']);
    }
    tl.reverse();                   // oś czasu: od najstarszego
    const maxTl=opts.maxTimeline||3000;
    const timeline={files:tlFiles, commits:tl.length>maxTl?tl.slice(tl.length-maxTl):tl, truncated:tl.length>maxTl};

    // autorzy: najczęstsza pisownia imienia, bez pól roboczych
    const authors=ids.authors.map(a=>{
      // najczęstsza pisownia; przy remisie „prawdziwe" imię (ze spacją) wygrywa z samym loginem
      const lg=String(a.login||'').toLowerCase();
      let best='', bc=-1; for(const [nm,cnt] of a._names){ const s=cnt+(nm.includes(' ')?0.5:0)-(nm.toLowerCase()===lg?0.25:0); if(s>bc){ bc=s; best=nm; } }
      return {name:best||a.login||a.email||'?', email:a.email||'', login:a.login||null, avatar:a.avatar||null, commits:a.commits, lines:a.lines,
        files:0, owned:0, first:Number.isFinite(a.first)?a.first:null, last:a.last||null, bot:!!a.bot};
    });

    // per plik: kompaktowe node.git; właściciel = autor z największą liczbą zmian (remis: więcej linii)
    const out=new Map();
    for(const [p,st] of files){
      const arr=[...st.a.entries()].sort((x,y)=>y[1].c-x[1].c||y[1].l-x[1].l);
      for(const [ai] of arr) authors[ai].files++;
      const human=arr.find(([ai])=>!authors[ai].bot)||arr[0];
      const own=human?human[0]:null; if(own!=null) authors[own].owned++;
      out.set(p, {c:st.c, recent:st.recent, first:Number.isFinite(st.first)?st.first:null, last:st.last||null, born:st.born,
        add:st.lines?st.add:null, del:st.lines?st.del:null, own, share:human?+(human[1].c/st.c).toFixed(3):0, n:arr.length,
        a:arr.slice(0,6).map(([ai,x])=>[ai, x.c, x.l])});
    }
    const bf=busFactor(out, authors);
    return {files:out, authors, busFactor:bf, timeline,
      commits:nonMerge, merges:list.length-nonMerge, range:{from:Number.isFinite(oldest)?oldest:null, to:newest||null},
      untracked, tracked:out.size};
  }

  // ---------------- bus factor (truck factor, zachłannie wg Avelino i in. 2016) ----------------
  // Autorzy „główni" pliku: udział ≥ 25 % zmian albo największy udział (boty pomijane).
  // Zdejmujemy kolejno autora, który jest głównym dla najwięcej jeszcze nieosieroconych plików, aż
  // ponad połowa plików zostanie bez żadnego głównego autora. Liczba zdjętych = bus factor.
  function busFactor(fileStats, authors, paths){
    const entries=[];
    for(const [p,g] of (fileStats instanceof Map?fileStats:new Map(Object.entries(fileStats||{})))){
      if(paths && !paths.has(p)) continue;
      if(!g || !g.a || !g.a.length) continue;
      const tot=g.a.reduce((s,x)=>s+x[1],0)||1;
      const humans=g.a.filter(x=>!(authors[x[0]]&&authors[x[0]].bot));
      if(!humans.length) continue;
      const main=new Set(humans.filter(x=>x[1]/tot>=0.25).map(x=>x[0])); main.add(humans[0][0]);
      entries.push(main);
    }
    const n=entries.length; if(!n) return {value:0, authors:[], files:0};
    const removed=[], gone=new Set();
    const orphaned=()=>{ let k=0; for(const m of entries){ let alive=false; for(const a of m) if(!gone.has(a)){ alive=true; break; } if(!alive) k++; } return k; };
    while(orphaned()<=n/2){
      const cnt=new Map();
      for(const m of entries){ let alive=false; for(const a of m) if(!gone.has(a)){ alive=true; break; } if(!alive) continue; for(const a of m) if(!gone.has(a)) cnt.set(a,(cnt.get(a)||0)+1); }
      let best=null, bc=0; for(const [a,c] of cnt) if(c>bc||(c===bc&&best!=null&&a<best)){ best=a; bc=c; }
      if(best==null) break;
      gone.add(best); removed.push(best);
    }
    return {value:removed.length, authors:removed, files:n};
  }

  // bus factor dla podzbioru (folder na mapie): paths = Set ścieżek plików
  function busFactorFor(gitInfo, graph, paths){
    const m=new Map(); for(const p of paths){ const n=graph&&graph.nodes&&findByPath(graph,p); if(n&&n.git) m.set(p,n.git); }
    return busFactor(m, (gitInfo&&gitInfo.authors)||[]);
  }
  function findByPath(graph, p){ if(graph._byPath&&graph._byPathN===graph.nodes.size) return graph._byPath.get(p);
    const m=new Map(); for(const n of graph.nodes.values()) if(n.type==='file'&&n.path) m.set(n.path,n); graph._byPath=m; graph._byPathN=graph.nodes.size; return m.get(p); }

  // ---------------- hotspoty: częstość zmian × złożoność (CodeScene) ----------------
  // churn = liczba zmian + zmiany z ostatnich 90 dni (świeże liczą się podwójnie); złożoność z metryk
  // (plik bez rozgałęzień — np. CSS/JSON — dostaje liczbę linii/40, żeby nie znikał z rankingu).
  function hotspotScore(n){
    const g=n&&n.git; if(!g||!g.c) return 0;
    const m=n.metrics||{}; const cx=m.complexity||((m.lines||0)/40);
    return (g.c+(g.recent||0))*(1+cx);
  }

  // ---------------- oś czasu: widoczność i zdarzenia do kroku ----------------
  // births[i] = indeks commita, w którym plik timeline.files[i] powstał (A), albo -1 = istniał od początku okna
  function births(timeline){
    const b=new Int32Array(timeline.files.length).fill(-1), seen=new Uint8Array(timeline.files.length);
    timeline.commits.forEach((c,ci)=>{ const ev=c[3]; for(let k=0;k<ev.length;k+=2){ const fi=ev[k]; if(seen[fi]) continue; seen[fi]=1; if(ev[k+1]===ST_CODE.A) b[fi]=ci; } });
    return b;
  }

  // oś czasu z migawek (bez historii git): klatka = migawka (+ stan bieżący na końcu), zdarzenia = pliki
  // dodane (A) i zmienione (M) względem poprzedniej klatki; tylko ścieżki obecne na mapie
  // snaps = [{ts, label, signature}] (dowolna kolejność), current = graph.signature()
  function timelineFromSnapshots(snaps, current, currentLabel){
    const frames=(snaps||[]).filter(s=>s&&s.signature&&s.signature.files).sort((a,b)=>a.ts-b.ts)
      .map(s=>({t:s.ts, label:s.label||'', files:s.signature.files}));
    if(current&&current.files) frames.push({t:Date.now(), label:currentLabel||'', files:current.files});
    const onMap=new Set(current&&current.files?current.files.map(f=>f.path):[]);
    const files=[], idx=new Map(), commits=[];
    const fi=(p)=>{ let i=idx.get(p); if(i==null){ i=files.length; idx.set(p,i); files.push(p); } return i; };
    let prev=new Map();
    for(const fr of frames){
      const ev=[], now=new Map();
      for(const f of fr.files){ now.set(f.path, f.hash); if(!onMap.has(f.path)) continue;
        if(!prev.has(f.path)) ev.push(fi(f.path), ST_CODE.A); else if(prev.get(f.path)!==f.hash) ev.push(fi(f.path), ST_CODE.M); }
      commits.push([fr.t, -1, fr.label, ev, '']);
      prev=now;
    }
    return {files, commits, truncated:false, snapshots:true};
  }

  // ---------------- zapis do grafu ----------------
  // pathOf(node) → ścieżka pliku względem korzenia mapy (domyślnie node.path)
  function applyToGraph(graph, res, meta){
    for(const n of graph.nodes.values()) if(n.type==='file') delete n.git;
    let hit=0;
    for(const n of graph.nodes.values()){ if(n.type!=='file'||!n.path) continue; const g=res.files.get(n.path); if(g){ n.git=g; hit++; } }
    graph.gitInfo=Object.assign({
      authors:res.authors, busFactor:res.busFactor, timeline:res.timeline, commits:res.commits, merges:res.merges,
      range:res.range, untracked:res.untracked, tracked:hit, at:Date.now(),
    }, meta||{});
    delete graph._byPath;
    return hit;
  }

  // agregat folderu: suma zmian plików, autorzy wg liczby zmian, ostatnia zmiana, bus factor
  function folderStats(graph, folder){
    const gi=graph.gitInfo; if(!gi) return null;
    const paths=new Set(), per=new Map(); let c=0, recent=0, last=0, files=0;
    const walk=(f)=>{ for(const id of (f.children||[])){ const x=graph.nodes.get(id); if(!x) continue;
      if(x.type==='file'){ if(x.git){ files++; paths.add(x.path); c+=x.git.c; recent+=x.git.recent||0; if(x.git.last>last) last=x.git.last;
        for(const [ai,k] of x.git.a) per.set(ai,(per.get(ai)||0)+k); } }
      else if(x.type==='folder') walk(x); } };
    walk(folder);
    if(!files) return null;
    const top=[...per.entries()].sort((a,b)=>b[1]-a[1]);
    const m=new Map(); walkMap(graph, folder, m);
    return {files, c, recent, last, authors:top, busFactor:busFactor(m, gi.authors||[])};
  }
  function walkMap(graph, f, m){ for(const id of (f.children||[])){ const x=graph.nodes.get(id); if(!x) continue; if(x.type==='file'&&x.git) m.set(x.path,x.git); else if(x.type==='folder') walkMap(graph,x,m); } }

  function initials(name){ const p=normName(name).split(' ').filter(Boolean); return ((p[0]||'?')[0]+(p.length>1?p[p.length-1][0]:(p[0]||'')[1]||'')).toUpperCase(); }

  return {analyze, identities, rebase, detectPrefix, prefixPaths, busFactor, busFactorFor, hotspotScore, births, timelineFromSnapshots, applyToGraph, folderStats,
    initials, normName, loginFromEmail, isBot, ST_CODE, ST_CHAR, RECENT_DAYS};
})();
