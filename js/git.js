/* ===================== git.js — historia git na mapie (Faza 3) ===================== */
// Źródła: lokalny katalog .git wczytanego folderu (CM.GitLocal, w workerze, bez sieci — uruchamiane samo)
// albo API hostingu dla repozytoriów z adresu URL (CM.GitRemote, na żądanie — zużywa limit zapytań).
// Analiza: CM.GitCore → node.git (zmiany, autorzy, właściciel) + graph.gitInfo (autorzy, bus factor, oś czasu).
// UI: nakładki „Koloruj wg" (właściciel, częstość zmian, hotspoty, ostatnia zmiana), sekcja „Historia git"
// w panelu szczegółów, awatary właścicieli na węzłach, oś czasu (Gource-lite), akcje ChatBota.
(function(){
  const A=CM.App, U=CM.util, $=U.$, el=U.el, I=CM.i18n, GC=CM.GitCore, OV=CM.Overlays;
  const state=A.state;
  const T=(k,f)=>I.t(k,f);
  const MAX_LOCAL=3000;

  // elementy z data-i18n (menu) potrzebują klucza także w słowniku PL
  I.extend('pl', {'project.git':'Historia git (autorzy, zmiany)','project.timeline':'Oś czasu — ewolucja projektu'});
  I.extend('en', {
    'git.reading':'Git history: reading…','git.readingN':'Git history: ','git.commitsSuffix':' commits…','git.listing':'Git history: listing commits ',
    'git.details':'Git history: changed files ','git.noSource':'No history: load a folder that contains its .git directory (Load → Folder) or a GitHub / GitLab / Bitbucket repository.',
    'git.gitfile':'This folder is a git worktree or submodule (.git is a file pointing elsewhere) — load the main repository folder to read its history.',
    'git.noModule':'The .git reader module is not available.','git.cancelled':'Git history analysis cancelled.','git.fail':'Git history: ',
    'git.doneA':'Git history: ','git.doneCommits':' commits · ','git.doneAuthors':' authors · bus factor ','git.doneFiles':'. Files with history: ',
    'git.partial':' File lists for the ','git.partialB':' newest commits only (API limit — add a token for the full history).','git.truncated':' (history truncated to the newest commits)',
    'git.e.no-head':'No HEAD found in the .git directory.','git.e.sha256':'SHA-256 repositories are not supported yet.','git.e.missing-object':'An object is missing from .git (incomplete repository?).',
    'git.e.bad-pack':'Unreadable pack file in .git.','git.needRun':'Run the git history analysis first (Project → Git history).',
    'ov.owner':'Owner (git)','ov.churn':'Change frequency (git)','ov.hotspot':'Hotspots: changes × complexity (git)','ov.age':'Last change (git)',
    'ov.others':'others','ov.noHistory':'no history','ov.churnNote':'Commits that changed the file (renames followed).',
    'ov.hotspotNote':'Frequently changed AND complex files — refactoring pays off most here.','ov.ageNote':'Date of the last commit touching the file.',
    'ov.ownerNote':'Author with the most changes in the file (bots skipped). Click a name to highlight their files.',
    'git.section':'Git history','git.changes':'changes','git.recent':'last 90 days','git.last':'last change','git.born':'created',
    'git.owner':'Owner','git.authors':'Authors','git.busFactor':'Bus factor','git.busHint':'How many people would have to leave before more than half of the files lose everyone who knows them.',
    'git.noFileHistory':'No changes to this file in the analysed history.','git.commits':'commits','git.files':'files','git.run':'Analyse git history',
    'git.runLocal':'Reads the local .git directory — nothing leaves your device.','git.runRemote':'Uses the repository host API (commit lists + changed files).',
    'git.refresh':'Refresh','git.timeline':'Timeline','git.hotspots':'Hotspots','git.source':'source','git.range':'range',
    'git.tlNeed':'The timeline needs git history (Project → Git history) or at least one snapshot of the project.','git.tlNow':'current state',
    'git.tlPlay':'Play / pause','git.tlClose':'Close the timeline','git.tlSpeed':'Speed','git.tlAria':'Project history timeline','git.tlSnap':'snapshot',
    'git.tlFrom':'Timeline: ','git.tlCommits':' commits — press ▶.','git.fileHistory':'File history on ',
    'project.git':'Git history (authors, changes)','project.timeline':'Timeline — project evolution',
    'cb.gitRun':'Git history analysis started (source: ','cb.gitNoData':'No git history yet — run gitHistory (local .git folder or GitHub/GitLab/Bitbucket repository).',
    'cb.owners':'Authors (commits · files owned): ','cb.bus':'Bus factor: ','cb.busFolder':'Bus factor of ','cb.churn':'Most changed: ','cb.tl':'Timeline: ',
  });

  // ---------------- źródło historii ----------------
  function sourceOf(){
    const side=state.side, m=A.graph&&A.graph.meta;
    if(side && ((side.git&&side.git.length) || side.gitEntry)) return 'local';
    if(CM.GitRemote && CM.GitRemote.supported(m)) return m.host;
    if(side && side.gitFile) return 'gitfile';
    return null;
  }
  function tokenFor(){ return (($('#gh-token')&&$('#gh-token').value.trim())||state._ghToken||'')||undefined; }
  function fileMap(g){ const m=new Map(); for(const n of g.nodes.values()) if(n.type==='file'&&n.path&&(!n.gid||n.gid==='base')) m.set(n.path,n); return m; }

  // ---------------- postęp (pigułka jak przy symbolach) + anulowanie ----------------
  let pillEl=null;
  function pill(text){
    let wrap=$('#toast-wrap'); if(!wrap){ wrap=el('div',{id:'toast-wrap'}); document.body.appendChild(wrap); }
    if(!pillEl){ pillEl=el('div',{class:'toast sym-pill git-pill'}); pillEl.appendChild(el('span',{class:'gp-t'}));
      pillEl.appendChild(el('button',{class:'gp-x',title:T('ca.cancelLoad','Anuluj'),text:'×',onclick:()=>cancel(true)})); wrap.appendChild(pillEl); }
    pillEl.querySelector('.gp-t').textContent=text;
  }
  function hidePill(){ if(pillEl){ const p=pillEl; pillEl=null; p.style.transition='opacity .3s'; p.style.opacity='0'; setTimeout(()=>p.remove(),300); } }

  let job=null, gen=0;
  function cancel(user){ const had=!!job; if(job){ try{ job.ctrl.abort(); }catch(e){} job=null; } gen++; hidePill(); if(user&&had) U.toast(T('git.cancelled','Anulowano analizę historii git.')); }
  function errText(e){ const c=e&&e.code; const k='git.e.'+c; const t=c?I.t(k,''):''; if(t&&t!==k) return t;
    const PL={'no-head':'Nie znaleziono HEAD w katalogu .git.','sha256':'Repozytoria SHA-256 nie są jeszcze obsługiwane.','missing-object':'W .git brakuje obiektu (niekompletne repozytorium?).','bad-pack':'Nieczytelny plik paczki w .git.'};
    return (c&&PL[c]&&I.getLang()!=='en')?PL[c]:((e&&e.message)||String(e)); }

  async function run(opts){
    opts=opts||{};
    if(!A.graph || !state.counts.nodes){ if(!opts.auto) U.toast(T('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return null; }
    const src=sourceOf();
    if(!src || src==='gitfile'){ if(!opts.auto) U.toast(src==='gitfile'?T('git.gitfile','Ten folder to worktree albo submoduł gita (.git jest plikiem wskazującym gdzie indziej) — wczytaj folder głównego repozytorium, aby odczytać historię.'):T('git.noSource','Brak historii: wczytaj folder razem z katalogiem .git (Wczytaj → Folder) albo repozytorium z GitHub / GitLab / Bitbucket.'),'',8000); return null; }
    cancel(false);
    const my=++gen, ctrl=new AbortController(); job={ctrl}; const g=A.graph, meta=g.meta||{};
    pill(T('git.reading','Historia git: czytanie…'));
    try{
      let r;
      if(src==='local'){
        await CM.Loaders.resolveSide(state.side);
        if(!CM.GitLocal || !CM.GitLocal.run) throw new Error(T('git.noModule','Moduł czytania .git jest niedostępny.'));
        r=await CM.GitLocal.run(state.side.git, {max:opts.max||MAX_LOCAL, signal:ctrl.signal,
          onProgress:(p)=>{ if(my===gen) pill(T('git.readingN','Historia git: ')+U.fmtNum((p&&p.done)||0)+T('git.commitsSuffix',' commitów…')); }});
      } else {
        const token=tokenFor();
        r=await CM.GitRemote.fetchHistory(meta, {token, max:opts.max||(token?2000:300), signal:ctrl.signal,
          onProgress:(p)=>{ if(my!==gen) return; pill(p.phase==='list'?(T('git.listing','Historia git: lista commitów ')+U.fmtNum(p.done)):(T('git.details','Historia git: zmienione pliki ')+p.done+' / '+p.total)); }});
      }
      if(my!==gen || g!==A.graph) return null;
      let commits=r.commits||[]; if(meta.sub && src!=='local') commits=GC.rebase(commits, meta.sub);
      const paths=[...fileMap(g).keys()];
      const res=GC.analyze(commits, paths);
      const st=r.stats||{};
      const hit=GC.applyToGraph(g, res, {source:src, head:r.head||null, truncated:!!st.truncated, listed:st.listed||commits.length,
        detailed:st.detailed!=null?st.detailed:null, rateLimited:!!st.rateLimited});
      job=null; hidePill();
      invalidate();
      A.refreshView();
      const bf=g.gitInfo.busFactor, au=g.gitInfo.authors;
      let msg=T('git.doneA','Historia git: ')+U.fmtNum(res.commits)+T('git.doneCommits',' commitów · ')+U.fmtNum(au.filter(a=>!a.bot).length)
        +T('git.doneAuthors',' autorów · bus factor ')+bf.value+(bf.authors.length?' ('+bf.authors.slice(0,3).map(i=>au[i].name).join(', ')+')':'')
        +T('git.doneFiles','. Pliki z historią: ')+U.fmtNum(hit)+' / '+U.fmtNum(paths.length)+'.';
      if(st.detailed!=null && st.listed && st.detailed<st.listed-res.merges) msg+=T('git.partial',' Listy plików tylko dla ')+st.detailed+T('git.partialB',' najnowszych commitów (limit API — dodaj token, aby pobrać pełną historię).');
      else if(st.truncated) msg+=T('git.truncated',' (historia ucięta do najnowszych commitów)');
      U.toast(msg,'success',9000);
      if(!opts.auto && OV.current()==='lang'){ try{ OV.set('churn'); }catch(e){} }
      return g.gitInfo;
    }catch(e){
      if(my!==gen) return null;
      job=null; hidePill();
      if(e && e.code==='cancelled') return null;
      console.warn('git history', e);
      U.toast(T('git.fail','Historia git: ')+errText(e),'error',9000);
      return null;
    }
  }

  // ---------------- kolory autorów: ranga wg liczby posiadanych plików, potem commitów ----------------
  let colorCache=null;
  function invalidate(){ colorCache=null; avatarCache.clear(); }
  function authorColors(gi){
    if(colorCache && colorCache.gi===gi) return colorCache.cols;
    const au=(gi&&gi.authors)||[], order=au.map((a,i)=>i).sort((x,y)=>(au[y].owned-au[x].owned)||(au[y].commits-au[x].commits));
    const cols=new Array(au.length).fill('#94a3b8'); let k=0;
    for(const i of order){ if(au[i].bot){ cols[i]='#64748b'; continue; } if(k<OV.PALETTE.length-1) cols[i]=OV.PALETTE[k++]; }
    colorCache={gi, cols}; return cols;
  }

  // ---------------- nakładki ----------------
  const hasGit=(g)=>!!(g&&g.gitInfo&&g.gitInfo.authors);
  const needRun=()=>T('git.needRun','Najpierw uruchom analizę historii git (Projekt → Historia git).');
  const fileNodes=(g)=>[...g.nodes.values()].filter(n=>n.type==='file');
  function fmtDay(t){ return t?new Date(t).toISOString().slice(0,10):'—'; }
  OV.register({id:'owner', order:20, label:()=>T('ov.owner','Właściciel (git)'), available:hasGit, unavailable:needRun,
    compute(g){
      const gi=g.gitInfo, au=gi.authors, cols=authorColors(gi);
      const own=new Map(), folderVotes=new Map(); let none=0;
      for(const n of fileNodes(g)){
        if(!n.git||n.git.own==null){ none++; continue; }
        const o=n.git.own; if(!own.has(o)) own.set(o,new Set()); own.get(o).add(n.id);
        let p=n.parent!=null?g.nodes.get(n.parent):null;
        while(p){ let v=folderVotes.get(p.id); if(!v){ v=new Map(); folderVotes.set(p.id,v); } v.set(o,(v.get(o)||0)+1); p=p.parent!=null?g.nodes.get(p.parent):null; }
      }
      const folderCol=new Map();
      for(const [fid,v] of folderVotes){ let b=null,bc=-1; for(const [o,c] of v) if(c>bc){ bc=c; b=o; } folderCol.set(fid, OV.mixHex(cols[b]||'#94a3b8', '#0f172a', 0.45)); }
      const ranked=[...own.entries()].sort((a,b)=>b[1].size-a[1].size);
      const items=[], other=new Set();
      for(const [o,ids] of ranked){ if(cols[o]==='#94a3b8'||items.length>=11) ids.forEach(i=>other.add(i)); else items.push({color:cols[o], label:au[o].name, count:ids.size, ids, title:au[o].name+(au[o].email?' <'+au[o].email+'>':'')}); }
      if(other.size) items.push({color:'#94a3b8', label:T('ov.others','inni'), count:other.size, ids:other});
      if(none) items.push({color:OV.NONE, label:T('ov.noHistory','bez historii'), count:none});
      return {colorOf:(n)=>n.type==='file'?(n.git&&n.git.own!=null?cols[n.git.own]:OV.NONE):(n.type==='folder'?(folderCol.get(n.id)||OV.FOLDER):OV.NONE),
        legend:{items, note:T('ov.ownerNote','Autor z największą liczbą zmian w pliku (boty pominięte). Kliknij nazwisko, aby podświetlić jego pliki.')}};
    }});
  OV.register({id:'churn', order:21, label:()=>T('ov.churn','Częstość zmian (git)'), available:hasGit, unavailable:needRun,
    compute(g){
      let max=1; const files=fileNodes(g); for(const n of files) if(n.git) max=Math.max(max,n.git.c);
      const heat=OV.ramp(OV.HEAT), L=Math.log1p(max), col=new Map();
      for(const n of files) if(n.git) col.set(n.id, heat(Math.log1p(n.git.c)/L));
      return {colorOf:(n)=>n.type==='file'?(col.get(n.id)||OV.NONE):(n.type==='folder'?OV.FOLDER:OV.NONE),
        legend:{gradient:{stops:OV.HEAT, min:1, max}, note:T('ov.churnNote','Liczba commitów zmieniających plik (ze śledzeniem zmian nazw).')}};
    }});
  OV.register({id:'hotspot', order:22, label:()=>T('ov.hotspot','Hotspoty: zmiany × złożoność (git)'), available:hasGit, unavailable:needRun,
    compute(g){
      const files=fileNodes(g).filter(n=>n.git); let max=0; const sc=new Map();
      for(const n of files){ const s=GC.hotspotScore(n); sc.set(n.id,s); if(s>max) max=s; }
      const heat=OV.ramp(OV.HEAT), L=Math.log1p(max||1), col=new Map();
      for(const [id,s] of sc) col.set(id, heat(Math.log1p(s)/L));
      const top=[...sc.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
      const items=top.map(([id])=>{ const n=g.nodes.get(id); return {color:col.get(id), label:n.name, count:n.git.c, ids:new Set([id]), title:n.path}; });
      return {colorOf:(n)=>n.type==='file'?(col.get(n.id)||OV.NONE):(n.type==='folder'?OV.FOLDER:OV.NONE),
        legend:{gradient:{stops:OV.HEAT, min:'', max:''}, items, note:T('ov.hotspotNote','Pliki często zmieniane I złożone — tu refaktoryzacja zwraca się najbardziej.')}};
    }});
  OV.register({id:'age', order:23, label:()=>T('ov.age','Ostatnia zmiana (git)'), available:hasGit, unavailable:needRun,
    compute(g){
      const files=fileNodes(g).filter(n=>n.git&&n.git.last); let lo=Infinity, hi=-Infinity;
      for(const n of files){ lo=Math.min(lo,n.git.last); hi=Math.max(hi,n.git.last); }
      const stops=['#1e293b','#1d4ed8','#22d3ee','#facc15'], r=OV.ramp(stops), span=Math.max(1,hi-lo), col=new Map();
      for(const n of files) col.set(n.id, r((n.git.last-lo)/span));
      return {colorOf:(n)=>n.type==='file'?(col.get(n.id)||OV.NONE):(n.type==='folder'?OV.FOLDER:OV.NONE),
        legend:{gradient:{stops, min:fmtDay(lo), max:fmtDay(hi)}, note:T('ov.ageNote','Data ostatniego commita zmieniającego plik.')}};
    }});

  // ---------------- awatary / inicjały właścicieli na węzłach (nakładka „Właściciel") ----------------
  // Obrazki tylko dla historii z API hostingu (sieć i tak była użyta); dla lokalnego .git — inicjały, bez żądań.
  const avatarCache=new Map();
  function avatarImg(gi, au){
    if(!au || gi.source==='local') return null;
    const url=au.avatar || (au.login&&gi.source==='github'?'https://github.com/'+encodeURIComponent(au.login)+'.png?size=64':null);
    if(!url || !/^https:\/\//.test(url)) return null;
    let im=avatarCache.get(url);
    if(!im){ im=new Image(); im.crossOrigin='anonymous'; im.onload=()=>A.renderer&&A.renderer.kick(); im.onerror=()=>{ im._bad=true; }; im.src=url; avatarCache.set(url,im); }
    return im.complete && im.naturalWidth>0 && !im._bad ? im : null;
  }
  function badge(ctx, gi, cols, ai, x, y, s){
    const au=gi.authors[ai]; if(!au) return;
    const img=avatarImg(gi, au);
    ctx.save(); ctx.beginPath(); ctx.arc(x,y,s,0,6.2832); ctx.fillStyle=cols[ai]||'#94a3b8'; ctx.fill();
    if(img){ ctx.clip(); ctx.drawImage(img, x-s, y-s, 2*s, 2*s); }
    else if(s>=7){ ctx.fillStyle='#05080e'; ctx.font='700 '+Math.round(s*0.9)+'px system-ui,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(GC.initials(au.name), x, y+0.5); }
    ctx.restore();
    ctx.strokeStyle='rgba(8,18,30,.85)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(x,y,s,0,6.2832); ctx.stroke();
  }
  function ownerDecorator(ctx, R){
    if(OV.current()!=='owner' || TL.open) return;
    const gi=A.graph&&A.graph.gitInfo; if(!gi) return;
    const cols=authorColors(gi), z=R.cam.zoom, sc=R.opts.nodeScale, W=R.w, H=R.h; let k=0;
    for(const n of R.nodes){
      if(n.type!=='file'||!n.git||n.git.own==null) continue;
      const rPx=n.r*sc*z; if(rPx<9) continue;
      const sp=R.cam.toScreen(n.x,n.y,W,H); if(sp.x<-30||sp.x>W+30||sp.y<-30||sp.y>H+30) continue;
      const s=Math.max(6,Math.min(15,rPx*0.42));
      badge(ctx, gi, cols, n.git.own, sp.x+rPx*0.72, sp.y-rPx*0.72, s);
      if(++k>=350) break;
    }
  }

  // ---------------- oś czasu (Gource-lite) ----------------
  // Klatka = commit (albo migawka). Pliki powstałe później są ukryte, foldery bez widocznych plików też;
  // pliki zmienione w ostatnich krokach świecą kolorem autora, a imię autora wisi nad nimi z „promieniami".
  const TL={open:false, step:0, playing:false, cps:6, acc:0, timer:0, data:null, births:null, ids:null, birthOf:null, anc:null, hasFiles:null};
  const TRAIL=10;
  function ensureBar(){
    let b=$('#git-timeline'); if(b) return b;
    b=el('div',{id:'git-timeline',class:'git-tl hidden',role:'group','aria-label':T('git.tlAria','Oś czasu historii projektu')});
    const play=el('button',{class:'tl-btn tl-play',title:T('git.tlPlay','Odtwórz / pauza'),'aria-label':T('git.tlPlay','Odtwórz / pauza')});
    play.onclick=()=>{ if(TL.playing) pause(); else play_(); };
    const range=el('input',{type:'range',class:'tl-range',min:'0',max:'0',value:'0','aria-label':T('git.tlAria','Oś czasu historii projektu')});
    range.oninput=()=>{ pause(); setStep(+range.value); };
    const info=el('div',{class:'tl-info'}, el('div',{class:'tl-top'}, el('b',{class:'tl-date'}), el('span',{class:'tl-count'})), el('div',{class:'tl-msg'}));
    const speed=el('select',{class:'tl-speed',title:T('git.tlSpeed','Prędkość')});
    for(const [v,l] of [[2,'0,5×'],[6,'1×'],[18,'3×'],[60,'10×'],[240,'40×']]){ const o=el('option',{value:String(v),text:l}); if(v===6) o.selected=true; speed.appendChild(o); }
    speed.onchange=()=>{ TL.cps=+speed.value; };
    const close=el('button',{class:'tl-btn tl-close',title:T('git.tlClose','Zamknij oś czasu'),'aria-label':T('git.tlClose','Zamknij oś czasu'),text:'×',onclick:()=>closeTimeline()});
    b.appendChild(play); b.appendChild(info); b.appendChild(range); b.appendChild(speed); b.appendChild(close);
    ($('#stage')||document.body).appendChild(b);
    return b;
  }
  function playIcon(){ const p=$('#git-timeline .tl-play'); if(p) p.innerHTML=TL.playing?'<svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="2" width="3.6" height="12" rx="1" fill="currentColor"/><rect x="9.4" y="2" width="3.6" height="12" rx="1" fill="currentColor"/></svg>':CM.icons.svg('play',{size:16}); }
  async function openTimeline(opts){
    opts=opts||{};
    if(!A.graph || !state.counts.nodes){ U.toast(T('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return false; }
    let data=A.graph.gitInfo&&A.graph.gitInfo.timeline;
    if(!data || !data.commits || !data.commits.length){
      let snaps=[]; try{ snaps=await CM.Storage.listSnapshots(A.graph.meta.source||A.graph.meta.name); }catch(e){}
      if(!snaps.length){ U.toast(T('git.tlNeed','Oś czasu potrzebuje historii git (Projekt → Historia git) albo co najmniej jednej migawki projektu.'),'',7000); return false; }
      data=GC.timelineFromSnapshots(snaps, A.graph.signature(), T('git.tlNow','stan bieżący'));
    }
    const g=A.graph, byPath=fileMap(g);
    TL.data=data; TL.births=GC.births(data);
    TL.ids=data.files.map(p=>{ const n=byPath.get(p); return n?n.id:null; });
    TL.birthOf=new Map(); data.files.forEach((p,i)=>{ const id=TL.ids[i]; if(id) TL.birthOf.set(id, TL.births[i]); });
    TL.anc=new Map(); TL.hasFiles=new Set();
    for(const n of g.nodes.values()){ if(n.type!=='file') continue; const a=[]; let p=n.parent!=null?g.nodes.get(n.parent):null;
      while(p){ a.push(p.id); TL.hasFiles.add(p.id); p=p.parent!=null?g.nodes.get(p.parent):null; } TL.anc.set(n.id,a); }
    const b=ensureBar(); b.classList.remove('hidden'); document.body.classList.add('git-tl-on');
    const range=b.querySelector('.tl-range'); range.max=String(data.commits.length-1);
    TL.open=true; TL.playing=false;
    if(!A.renderer.decorators.includes(tlDecorator)) A.renderer.decorators.push(tlDecorator);
    setStep(opts.step!=null?opts.step:0); playIcon();
    if(opts.play!==false) play_();
    return true;
  }
  function frameVis(step){
    const g=A.graph, vis=state.vis, cnt=new Map(), hidden=new Set();
    for(const n of g.nodes.values()){ if(n.type!=='file') continue;
      const b=TL.birthOf.get(n.id); if(b!=null && b>step){ hidden.add(n.id); continue; }
      for(const a of (TL.anc.get(n.id)||[])) cnt.set(a,(cnt.get(a)||0)+1); }
    const nodes=vis.nodes.filter(n=> n.type==='file' ? !hidden.has(n.id)
      : n.type==='folder' ? (n.id==='__root__' || !TL.hasFiles.has(n.id) || cnt.get(n.id)>0)
      : n.type==='symbol' ? !hidden.has(n.parent) : true);
    const ids=new Set(nodes.map(n=>n.id));
    // symulacja (jeśli jeszcze osiada) liczy dalej wszystkie węzły — renderer pokazuje tylko istniejące w tej chwili
    A.renderer.setData(g, {nodes, edges:vis.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))}, state.sim&&!state.sim._worker?state.sim:null);
    TL.visible=ids;
  }
  function setStep(i){
    if(!TL.open || !TL.data) return;
    const N=TL.data.commits.length; i=Math.max(0,Math.min(N-1,Math.round(i))); TL.step=i;
    frameVis(i);
    const b=$('#git-timeline'); if(!b) return;
    const c=TL.data.commits[i], gi=A.graph.gitInfo, au=c[1]>=0&&gi?gi.authors[c[1]]:null;
    b.querySelector('.tl-range').value=String(i);
    b.querySelector('.tl-date').textContent=U.fmtDate(c[0]);
    b.querySelector('.tl-count').textContent=(i+1)+' / '+N;
    const msg=b.querySelector('.tl-msg'); msg.innerHTML='';
    if(au){ const cols=authorColors(gi); msg.appendChild(el('span',{class:'tl-dot',style:'background:'+cols[c[1]]})); msg.appendChild(el('b',{class:'tl-author',text:au.name})); }
    else if(TL.data.snapshots) msg.appendChild(el('b',{class:'tl-author',text:'📌 '+T('git.tlSnap','migawka')}));
    msg.appendChild(el('span',{class:'tl-subj',text:(c[4]?c[4].slice(0,7)+' · ':'')+(c[2]||'')}));
    A.renderer.kick();
  }
  function play_(){
    if(!TL.open) return; if(TL.step>=TL.data.commits.length-1) setStep(0);
    TL.playing=true; TL.acc=0; playIcon(); clearInterval(TL.timer);
    TL.timer=setInterval(()=>{
      if(!TL.open){ pause(); return; }
      TL.acc+=TL.cps/12; const k=Math.floor(TL.acc); if(!k) return; TL.acc-=k;
      const next=Math.min(TL.data.commits.length-1, TL.step+k); setStep(next);
      if(next>=TL.data.commits.length-1) pause();
    }, 1000/12);
  }
  function pause(){ TL.playing=false; clearInterval(TL.timer); TL.timer=0; playIcon(); }
  function closeTimeline(silent){
    if(!TL.open) return; pause(); TL.open=false;
    const i=A.renderer.decorators.indexOf(tlDecorator); if(i>=0) A.renderer.decorators.splice(i,1);
    const b=$('#git-timeline'); if(b) b.classList.add('hidden'); document.body.classList.remove('git-tl-on');
    TL.data=null; TL.visible=null;
    if(!silent && A.graph && state.counts.nodes) A.apply({relayout:false});
  }
  // świecenie zmienionych plików + etykiety autorów z promieniami (ekran)
  function tlDecorator(ctx, R){
    if(!TL.open || !TL.data) return;
    const g=A.graph, gi=g.gitInfo, cols=gi?authorColors(gi):[], z=R.cam.zoom, sc=R.opts.nodeScale, W=R.w, H=R.h;
    const byId=R.nodeById, groups=new Map();
    for(let k=TRAIL-1;k>=0;k--){
      const ci=TL.step-k; if(ci<0) continue;
      const c=TL.data.commits[ci], ev=c[3], fade=1-k/TRAIL, col=c[1]>=0?(cols[c[1]]||'#94a3b8'):'#22d3ee';
      let grp=groups.get(c[1]); if(!grp){ grp={pts:[], fade:0, col}; groups.set(c[1],grp); } grp.fade=Math.max(grp.fade,fade);
      for(let j=0;j<ev.length;j+=2){
        const id=TL.ids[ev[j]]; const n=id&&byId.get(id); if(!n) continue;
        const sp=R.cam.toScreen(n.x,n.y,W,H), r=n.r*sc*z;
        const st=ev[j+1], ring=st===0?'#34d399':(st===2?'#f87171':col);
        ctx.globalAlpha=0.9*fade; ctx.strokeStyle=ring; ctx.lineWidth=2+2*fade;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r+3+(1-fade)*10, 0, 6.2832); ctx.stroke();
        if(k<3 && grp.pts.length<60) grp.pts.push(sp);
      }
    }
    // autorzy ostatnich commitów: etykieta nad środkiem ich plików + promienie do plików (jak w Gource)
    for(const [ai,grp] of groups){
      if(!grp.pts.length) continue;
      let cx=0, cy=0; for(const p of grp.pts){ cx+=p.x; cy+=p.y; } cx/=grp.pts.length; cy/=grp.pts.length;
      const lx=Math.max(60,Math.min(W-60,cx+34)), ly=Math.max(24,Math.min(H-24,cy-46));
      ctx.globalAlpha=0.55*grp.fade; ctx.strokeStyle=grp.col; ctx.lineWidth=1.2; ctx.beginPath();
      for(const p of grp.pts){ ctx.moveTo(lx,ly); ctx.lineTo(p.x,p.y); } ctx.stroke();
      const name=ai>=0&&gi?gi.authors[ai].name:(TL.data.snapshots?T('git.tlSnap','migawka'):'');
      if(!name) continue;
      ctx.globalAlpha=Math.min(1,0.35+grp.fade); ctx.font='600 12px system-ui,sans-serif';
      const w=ctx.measureText(name).width+22;
      ctx.fillStyle='rgba(8,14,24,.82)'; ctx.beginPath(); ctx.roundRect?ctx.roundRect(lx-w/2,ly-11,w,22,11):ctx.rect(lx-w/2,ly-11,w,22); ctx.fill();
      ctx.fillStyle=grp.col; ctx.beginPath(); ctx.arc(lx-w/2+10,ly,4,0,6.2832); ctx.fill();
      ctx.fillStyle='#e6edf6'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(name, lx-w/2+18, ly+0.5);
    }
    ctx.globalAlpha=1;
  }

  // ---------------- panel szczegółów: „Historia git" ----------------
  function authorBars(gi, list, total, cols){
    const box=el('div',{class:'git-authors'});
    const max=list.length?list[0][1]:1;
    for(const [ai,c] of list.slice(0,6)){ const au=gi.authors[ai]; if(!au) continue;
      box.appendChild(el('div',{class:'bar-row',title:au.name+(au.email?' <'+au.email+'>':'')},
        el('span',{class:'bl git-an'}, el('span',{class:'tl-dot',style:'background:'+(cols[ai]||'#94a3b8')}), el('span',{text:au.name})),
        el('div',{class:'bar-track'}, el('div',{class:'bar-fill',style:'width:'+Math.max(4,c/max*100)+'%;background:'+(cols[ai]||'#94a3b8')})),
        el('span',{class:'bv',text:total?Math.round(c/total*100)+'%':String(c)}))); }
    return box;
  }
  function busLine(gi, bf, cols){
    const row=el('div',{class:'git-bus',title:T('git.busHint','Ilu osób odejście sprawi, że ponad połowa plików straci wszystkich, którzy je znają.')});
    row.appendChild(el('span',{class:'tag'+(bf.value<=1?' hot':''),text:T('git.busFactor','Bus factor')+' '+bf.value}));
    if(bf.authors.length) row.appendChild(el('span',{class:'muted small',text:bf.authors.slice(0,4).map(i=>gi.authors[i]&&gi.authors[i].name).filter(Boolean).join(', ')}));
    return row;
  }
  function projectCard(g){
    const gi=g.gitInfo;
    if(!gi){
      const src=sourceOf(); if(!src||src==='gitfile') return null;
      const sec=el('div',{class:'det-section git-card'}, el('h5',{}, T('git.section','Historia git')));
      sec.appendChild(el('p',{class:'muted small',text:src==='local'?T('git.runLocal','Czyta lokalny katalog .git — nic nie opuszcza urządzenia.'):T('git.runRemote','Korzysta z API hostingu repozytorium (lista commitów + zmienione pliki).')}));
      sec.appendChild(el('button',{class:'tb-btn primary',text:T('git.run','Analizuj historię git'),onclick:()=>run()}));
      return sec;
    }
    const cols=authorColors(gi), au=gi.authors;
    const sec=el('div',{class:'det-section git-card'}, el('h5',{}, T('git.section','Historia git'), el('span',{class:'muted',text:gi.source})));
    const tags=el('div',{});
    tags.appendChild(el('span',{class:'tag',text:U.fmtNum(gi.commits)+' '+T('git.commits','commitów')}));
    tags.appendChild(el('span',{class:'tag',text:U.fmtNum(au.filter(a=>!a.bot).length)+' '+T('git.authors','autorów').toLowerCase()}));
    if(gi.range&&gi.range.from) tags.appendChild(el('span',{class:'tag',text:fmtDay(gi.range.from)+' → '+fmtDay(gi.range.to)}));
    sec.appendChild(tags);
    sec.appendChild(busLine(gi, gi.busFactor, cols));
    const top=au.map((a,i)=>[i,a.commits]).filter(([i])=>!au[i].bot).sort((a,b)=>b[1]-a[1]);
    sec.appendChild(authorBars(gi, top, gi.commits, cols));
    const acts=el('div',{class:'git-acts'});
    acts.appendChild(el('button',{class:'tb-btn',text:'▶ '+T('git.timeline','Oś czasu'),onclick:()=>openTimeline()}));
    acts.appendChild(el('button',{class:'tb-btn',text:T('git.hotspots','Hotspoty'),onclick:()=>{ const b=$('#btn-hotspots'); if(b) b.click(); }}));
    if(sourceOf()&&sourceOf()!=='gitfile') acts.appendChild(el('button',{class:'tb-btn',text:'↻ '+T('git.refresh','Odśwież'),onclick:()=>run()}));
    sec.appendChild(acts);
    return sec;
  }
  function fileSection(n, g){
    const gi=g.gitInfo, x=n.git, sec=el('div',{class:'det-section git-card'}, el('h5',{}, T('git.section','Historia git')));
    if(!x){ sec.appendChild(el('p',{class:'muted small',text:T('git.noFileHistory','Brak zmian tego pliku w analizowanej historii.')})); return sec; }
    const cols=authorColors(gi), tags=el('div',{});
    tags.appendChild(el('span',{class:'tag'+(x.c>=20?' hot':''),text:U.fmtNum(x.c)+' '+T('git.changes','zmian')}));
    if(x.recent) tags.appendChild(el('span',{class:'tag',text:x.recent+' · '+T('git.recent','ostatnie 90 dni')}));
    if(x.last) tags.appendChild(el('span',{class:'tag',title:U.fmtDate(x.last),text:T('git.last','ostatnia zmiana')+': '+U.relTime(x.last)}));
    if(x.born) tags.appendChild(el('span',{class:'tag',text:T('git.born','powstał')+': '+fmtDay(x.born)}));
    if(x.add!=null) tags.appendChild(el('span',{class:'tag',text:'+'+U.fmtNum(x.add)+' / −'+U.fmtNum(x.del)}));
    sec.appendChild(tags);
    if(x.own!=null && gi.authors[x.own]) sec.appendChild(el('div',{class:'git-owner'}, el('span',{class:'muted small',text:T('git.owner','Właściciel')+': '}),
      el('span',{class:'tl-dot',style:'background:'+cols[x.own]}), el('b',{text:gi.authors[x.own].name}), el('span',{class:'muted small',text:' ('+Math.round(x.share*100)+'%)'})));
    sec.appendChild(authorBars(gi, x.a.map(a=>[a[0],a[1]]), x.c, cols));
    const url=A.nodeRepoUrl&&A.nodeRepoUrl(n);
    if(url && g.meta && g.meta.host==='github'){ const hist=url.replace('/blob/','/commits/');
      sec.appendChild(el('a',{class:'tb-btn git-hist',href:hist,target:'_blank',rel:'noopener',text:'↗ '+T('git.fileHistory','Historia pliku na ')+'GitHub'})); }
    return sec;
  }
  function folderSection(n, g){
    const fs=GC.folderStats(g, n); if(!fs) return null;
    const gi=g.gitInfo, cols=authorColors(gi), sec=el('div',{class:'det-section git-card'}, el('h5',{}, T('git.section','Historia git')));
    const tags=el('div',{});
    tags.appendChild(el('span',{class:'tag',text:U.fmtNum(fs.c)+' '+T('git.changes','zmian')}));
    tags.appendChild(el('span',{class:'tag',text:U.fmtNum(fs.files)+' '+T('git.files','plików')}));
    if(fs.recent) tags.appendChild(el('span',{class:'tag',text:fs.recent+' · '+T('git.recent','ostatnie 90 dni')}));
    if(fs.last) tags.appendChild(el('span',{class:'tag',title:U.fmtDate(fs.last),text:T('git.last','ostatnia zmiana')+': '+U.relTime(fs.last)}));
    sec.appendChild(tags);
    sec.appendChild(busLine(gi, fs.busFactor, cols));
    const tot=fs.authors.reduce((s,a)=>s+a[1],0);
    sec.appendChild(authorBars(gi, fs.authors, tot, cols));
    return sec;
  }
  CM.UI.addDetailSection((node, g)=>{
    if(!g || !g.nodes) return null;
    if(node===null) return projectCard(g);
    if(!g.gitInfo) return null;
    if(node.type==='file' && (!node.gid||node.gid==='base')) return fileSection(node, g);
    if(node.type==='folder' && !node.external && node.id!=='__ext__') return folderSection(node, g);
    return null;
  });

  // ---------------- menu, hooki projektu, akcje ChatBota ----------------
  function wire(){
    if(!A.renderer){ setTimeout(wire, 40); return; }     // boot (app.js) tworzy renderer w DOMContentLoaded
    const bg=$('#btn-git'); if(bg) bg.onclick=()=>run();
    const bt=$('#btn-timeline'); if(bt) bt.onclick=()=>openTimeline();
    if(!A.renderer.decorators.includes(ownerDecorator)) A.renderer.decorators.push(ownerDecorator);
  }
  A.onProjectLoaded(({reason})=>{
    cancel(false); closeTimeline(true); invalidate();
    // lokalny .git czytamy sami (bez sieci, w workerze); API hostingu tylko na żądanie — szkoda limitu zapytań
    if(reason==='ingest' && sourceOf()==='local') setTimeout(()=>{ if(sourceOf()==='local' && !(A.graph&&A.graph.gitInfo)) run({auto:true}); }, 350);
  });

  const need=()=>{ if(!A.graph||!state.counts.nodes) throw new Error(T('cb.noProject','Najpierw wczytaj projekt (CodeMap).')); if(!A.graph.gitInfo) throw new Error(T('cb.gitNoData','Brak historii git — uruchom gitHistory (lokalny folder z .git albo repozytorium GitHub/GitLab/Bitbucket).')); return A.graph.gitInfo; };
  function findNode(q){ q=String(q||'').toLowerCase().trim(); if(!q) return null; let best=null,bs=-1;
    for(const n of A.graph.nodes.values()){ if(n.id==='__root__'||n.id==='__ext__'||(n.type!=='file'&&n.type!=='folder')) continue; const nm=(n.name||'').toLowerCase(), pt=(n.path||'').toLowerCase();
      const s=nm===q||pt===q?100:(nm.indexOf(q)===0?70:(nm.indexOf(q)>=0?50:(pt.indexOf(q)>=0?30:-1))); if(s>bs){ bs=s; best=n; } }
    return best; }
  function reg(o){ if(A.registerAction) A.registerAction(o); }
  reg({name:'gitHistory', sig:'', desc:'analyse git history (local .git of a loaded folder, or the GitHub/GitLab/Bitbucket API): authors, owners, change frequency, bus factor, timeline',
    descPl:'analizuj historię git (lokalny .git albo API GitHub/GitLab/Bitbucket)', auto:false,
    run:()=>{ const src=sourceOf(); if(!src||src==='gitfile') throw new Error(T('git.noSource','Brak historii: wczytaj folder razem z katalogiem .git albo repozytorium z GitHub / GitLab / Bitbucket.')); run(); return T('cb.gitRun','Uruchomiono analizę historii git (źródło: ')+src+').'; }});
  reg({name:'owners', sig:'{query?}', desc:'who owns the project / a file or folder according to git history (authors, shares, bus factor)', descPl:'właściciele projektu, pliku lub folderu wg historii git', auto:true, info:true,
    run:(a)=>{ const gi=need(), au=gi.authors;
      if(a&&a.query){ const n=findNode(a.query); if(!n) throw new Error(T('cb.notFound','Nie znaleziono: ')+a.query);
        A.focusNode(n.id);
        if(n.type==='file'){ if(!n.git) return n.name+': '+T('git.noFileHistory','Brak zmian tego pliku w analizowanej historii.');
          return n.name+' — '+n.git.c+' '+T('git.changes','zmian')+': '+n.git.a.map(x=>au[x[0]].name+' '+Math.round(x[1]/n.git.c*100)+'%').join(', '); }
        const fs=GC.folderStats(A.graph,n); if(!fs) return n.name+': '+T('git.noFileHistory','Brak zmian w analizowanej historii.');
        const tot=fs.authors.reduce((s,x)=>s+x[1],0)||1;
        return n.name+' — '+fs.authors.slice(0,8).map(x=>au[x[0]].name+' '+Math.round(x[1]/tot*100)+'%').join(', ')+' · '+T('cb.bus','Bus factor: ')+fs.busFactor.value; }
      const top=au.map((x,i)=>i).filter(i=>!au[i].bot).sort((x,y)=>au[y].commits-au[x].commits).slice(0,10);
      try{ OV.set('owner'); }catch(e){}
      return T('cb.owners','Autorzy (commity · posiadane pliki): ')+top.map(i=>au[i].name+' '+au[i].commits+' · '+au[i].owned).join(', ')+'\n'+T('cb.bus','Bus factor: ')+gi.busFactor.value+' ('+gi.busFactor.authors.map(i=>au[i].name).join(', ')+')'; }});
  reg({name:'busFactor', sig:'{query?}', desc:'bus (truck) factor of the project or of a folder from git history', descPl:'bus factor projektu albo folderu', auto:true, info:true,
    run:(a)=>{ const gi=need(), au=gi.authors;
      if(a&&a.query){ const n=findNode(a.query); if(!n||n.type!=='folder') throw new Error(T('cb.notFound','Nie znaleziono: ')+a.query);
        const fs=GC.folderStats(A.graph,n); const bf=fs?fs.busFactor:{value:0,authors:[]};
        return T('cb.busFolder','Bus factor folderu ')+n.name+': '+bf.value+(bf.authors.length?' ('+bf.authors.map(i=>au[i].name).join(', ')+')':''); }
      return T('cb.bus','Bus factor: ')+gi.busFactor.value+' ('+gi.busFactor.authors.map(i=>au[i].name).join(', ')+') — '+gi.busFactor.files+' '+T('git.files','plików'); }});
  reg({name:'churn', sig:'{n?}', desc:'most frequently changed files according to git history (highlighted on the map)', descPl:'najczęściej zmieniane pliki wg historii git', auto:true, info:true,
    run:(a)=>{ need(); const k=Math.max(1,Math.min(50,+(a&&a.n)||10));
      const list=fileNodes(A.graph).filter(n=>n.git).sort((x,y)=>y.git.c-x.git.c).slice(0,k);
      A.renderer.setHighlight(new Set(list.map(n=>n.id)));
      return T('cb.churn','Najczęściej zmieniane: ')+list.map(n=>n.name+' ('+n.git.c+')').join(', '); }});
  reg({name:'timeline', sig:'{action?:"open"|"play"|"pause"|"close", step?}', desc:'animated project evolution from git history or snapshots (Gource-like)', descPl:'oś czasu — animowana ewolucja projektu', auto:true,
    run:(a)=>{ const act=String((a&&a.action)||'open').toLowerCase();
      if(act==='close'){ closeTimeline(); return T('cb.tl','Oś czasu: ')+'close'; }
      if(act==='pause'){ pause(); return T('cb.tl','Oś czasu: ')+'pause'; }
      if(!TL.open){ openTimeline({play:act!=='open'||a.step==null, step:a&&a.step!=null?+a.step:undefined}); return T('cb.tl','Oś czasu: ')+'open'; }
      if(a&&a.step!=null) setStep(+a.step); if(act==='play') play_(); return T('cb.tl','Oś czasu: ')+act; }});

  CM.Git={run, cancel, sourceOf, openTimeline, closeTimeline, setStep, pause, play:play_, timeline:()=>({open:TL.open, step:TL.step, total:TL.data?TL.data.commits.length:0, playing:TL.playing}), authorColors, wire};
  setTimeout(wire, 0);
})();
