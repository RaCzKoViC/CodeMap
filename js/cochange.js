/* ===================== cochange.js — sprzężenie zmian (historia git) w panelu i dla ChatBota ===================== */
// Pliki zmieniane razem z wybranym (CM.GitCore.couplingFor na osi czasu z historii git, jak code-maat): sekcja panelu
// szczegółów ze stopniem i liczbą wspólnych commitów, oznaczenie „bez importu" (ukryta zależność), klik = przejście
// do pliku, „Pokaż na mapie" podświetla grupę. Akcja ChatBota `changeCoupling` — dla pliku albo najsilniejsze pary.
(function(){
  const A=CM.App, U=CM.util, I=CM.i18n, GC=CM.GitCore, el=U.el;
  const T=(k,f)=>(I&&I.t)?I.t(k,f):f;
  const pct=(d)=>Math.round(d*100)+' %';
  const linked=(a,b)=>!!(a&&b) && ((a.importsOut||[]).includes(b.id) || (b.importsOut||[]).includes(a.id));
  function fileIndex(g){ const m=new Map(); for(const n of g.nodes.values()) if(n.type==='file'&&n.path) m.set(n.path,n); return m; }

  function section(node, g){
    if(!node || node.type!=='file' || !g || !g.gitInfo || !GC || !GC.couplingFor) return null;
    if(node.gid && node.gid!=='base') return null;                   // węzeł symbolu / porównania
    const list=GC.couplingFor(g.gitInfo, node.path);
    if(!list.length) return null;
    const idx=fileIndex(g), ids=new Set([node.id]);
    const sec=el('div',{class:'det-section det-cochange'});
    sec.appendChild(el('h5',{title:T('cc.hint','Pliki zmieniane w tych samych commitach (historia git). Stopień = wspólne commity / średnia liczby zmian obu plików; bez masowych commitów > 30 plików.')},
      T('cc.title','Zmieniany razem z'), el('span',{class:'muted',text:list.length})));
    const box=el('div',{class:'cc-list'});
    for(const c of list.slice(0,10)){
      const n=idx.get(c.path); if(n) ids.add(n.id);
      const hidden=n && !linked(node, n) && !node.isTest && !n.isTest;
      box.appendChild(el('div',{class:'cc-row'+(n?'':' muted'), title:c.path+' — '+T('cc.shared','wspólne commity')+': '+c.shared+' / '+c.revs,
        onclick:()=>{ if(n && A.focusNode) A.focusNode(n.id); }},
        el('span',{class:'cc-bar', style:'width:'+Math.round(c.degree*100)+'%'}),
        el('span',{class:'cc-name', text:n?n.name:c.path}),
        hidden?el('span',{class:'tag hot', title:T('cc.noImportHint','Żaden z plików nie importuje drugiego — zależność ukryta (globalne nazwy, konfiguracja, klucze tekstów).'), text:T('cc.noImport','bez importu')}):null,
        el('span',{class:'cc-val', text:pct(c.degree)+' · '+c.shared})));
    }
    sec.appendChild(box);
    sec.appendChild(el('button',{class:'tb-btn', type:'button', text:T('cc.show','Pokaż na mapie'),
      onclick:()=>{ if(A.renderer && A.renderer.setHighlight) A.renderer.setHighlight(ids); }}));
    return sec;
  }
  if(CM.UI && CM.UI.addDetailSection) CM.UI.addDetailSection(section);

  function find(g, q){
    q=String(q||'').toLowerCase().trim(); if(!q) return null; let best=null, bs=-1;
    for(const n of g.nodes.values()){ if(n.type!=='file') continue; const nm=(n.name||'').toLowerCase(), p=(n.path||'').toLowerCase();
      const s=p===q||nm===q?3:p.endsWith('/'+q)?2:nm.includes(q)||p.includes(q)?1:-1; if(s>bs){ bs=s; best=n; } }
    return bs>0?best:null;
  }
  if(A.registerAction) A.registerAction({name:'changeCoupling', sig:'{query?}',
    desc:'files changed together in git history (change coupling, like code-maat): for a file, or the strongest pairs of the project; marks pairs without an import between them (hidden dependency) and highlights them on the map',
    descPl:'Sprzężenie zmian — pliki zmieniane razem (historia git), dla pliku albo najsilniejsze pary', auto:true, info:true,
    run:(a)=>{
      const g=A.graph; if(!g) throw new Error(T('cb.noProject','Najpierw wczytaj projekt (CodeMap).'));
      if(!g.gitInfo) throw new Error(T('cb.gitNoData','Brak historii git — uruchom gitHistory (lokalny folder z .git albo repozytorium z GitHub / GitLab / Bitbucket).'));
      const idx=fileIndex(g), q=a&&(a.query||a.path||a.file);
      if(q){
        const n=find(g, q); if(!n) throw new Error(T('cb.notFound','Nie znaleziono: ')+q);
        const list=GC.couplingFor(g.gitInfo, n.path).slice(0,10);
        if(A.focusNode) A.focusNode(n.id);
        if(!list.length) return n.name+': '+T('cc.none','brak plików zmienianych razem (za mało wspólnych commitów).');
        const ids=new Set([n.id]); list.forEach(c=>{ const m=idx.get(c.path); if(m) ids.add(m.id); });
        if(A.renderer && A.renderer.setHighlight) A.renderer.setHighlight(ids);
        return n.name+' — '+T('cc.title','Zmieniany razem z')+': '+list.map(c=>{ const m=idx.get(c.path);
          return c.path+' ('+pct(c.degree)+', '+c.shared+(m&&!linked(n,m)?', '+T('cc.noImport','bez importu'):'')+')'; }).join('; ');
      }
      const top=GC.coupling(g.gitInfo).slice(0,10);
      if(!top.length) return T('cc.noneAll','Brak par plików zmienianych razem w analizowanej historii.');
      const ids=new Set(); top.forEach(p=>{ for(const x of [p.a,p.b]){ const m=idx.get(x); if(m) ids.add(m.id); } });
      if(A.renderer && A.renderer.setHighlight) A.renderer.setHighlight(ids);
      return T('cc.top','Najsilniej sprzężone pary: ')+top.map(p=>{ const x=idx.get(p.a), y=idx.get(p.b);
        return p.a+' ↔ '+p.b+' ('+pct(p.degree)+', '+p.shared+(x&&y&&!linked(x,y)?', '+T('cc.noImport','bez importu'):'')+')'; }).join('; ');
    }});
})();
