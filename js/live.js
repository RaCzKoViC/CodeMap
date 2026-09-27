/* ===================== live.js — tryb na żywo: obserwacja folderu (faza 6) ===================== */
// Folder wybrany przez File System Access (showDirectoryPicker) — albo dowolny FileSystemDirectoryHandle, np. OPFS
// w testach — jest wczytany jak zwykły folder, a potem obserwowany: FileSystemObserver (Chrome 129+) jako szybki
// wyzwalacz + skan dat modyfikacji co kilka sekund (tylko gdy karta jest widoczna). Zmienione pliki są czytane
// i analizowane w workerze, graf przebudowany z zachowaniem pozycji, zwinięć, zaznaczenia, kamery, nakładki,
// danych git / testów / PR; zmiany świecą na mapie. Nowy commit (.git/logs/HEAD) przelicza historię git.
// Uchwyt folderu jest zapamiętany w IndexedDB: po przeładowaniu strony pasek stanu proponuje „Wznów na żywo”
// (kliknięcie = gest użytkownika, którego przeglądarka wymaga do ponownej zgody na odczyt).
(function(){
  const A=CM.App, U=CM.util, $=U.$, el=U.el, I=CM.i18n, L=CM.Loaders;
  const state=A.state, T=(k,f)=>I.t(k,f);
  I.extend('pl', {'load.live':'Folder na żywo (obserwuj zmiany)', 'live.resumeAsk':'Wznów na żywo: ', 'live.resumeTitle':'Folder obserwowany przed przeładowaniem strony — kliknij, aby wczytać go ponownie i dalej śledzić zmiany', 'live.forget':'Nie wznawiaj'});
  I.extend('en', {'load.live':'Live folder (watch changes)', 'live.on':'LIVE', 'live.pause':'Pause', 'live.resume':'Resume', 'live.stop':'Stop watching',
    'live.reading':'Reading folder…', 'live.changes':'Live: ', 'live.mod':' changed', 'live.add':' added', 'live.del':' removed',
    'live.stopped':'Stopped watching the folder.', 'live.denied':'No permission to read the folder.', 'live.unsupported':'This browser cannot watch folders (File System Access API — use Chrome or Edge).',
    'live.gitRerun':'New commit — refreshing git history…', 'live.title':'Watching the folder — changes are applied to the map automatically',
    'live.resumeAsk':'Resume live: ', 'live.resumeTitle':'Folder watched before the page was reloaded — click to load it again and keep following changes', 'live.forget':'Do not resume'});

  const DEF_POLL=2500;
  const S={on:false, paused:false, dir:null, name:'', files:new Map(), pre:new Map(), timer:0, observer:null, busy:false, again:false,
    gitStamp:'', pulses:new Map(), interval:DEF_POLL, gen:0};

  // ---------------- odczyt katalogu przez uchwyty ----------------
  // → {entries: Map path → {size, mtime, handle}, gitHandle, coverage:[{path, handle}], gitStamp}
  async function scan(dir){
    const entries=new Map(), coverage=[]; let gitHandle=null, gitStamp='';
    const walk=async(d, prefix, depth)=>{
      for await (const [name, h] of d.entries()){
        const path=prefix?prefix+'/'+name:name;
        if(h.kind==='directory'){
          if(depth===0 && name==='.git'){ gitHandle=h; gitStamp=await stampOf(h); continue; }
          if(L.shouldSkip(path)){ if(/^coverage$/i.test(name) && depth<=2) await collectCoverage(h, path, coverage); continue; }
          if(depth<40) await walk(h, path, depth+1);
        } else {
          if(L.shouldSkip(path)) continue;
          let f; try{ f=await h.getFile(); }catch(e){ continue; }
          entries.set(path, {size:f.size, mtime:f.lastModified, handle:h});
          if(L.RE_COVERAGE && L.RE_COVERAGE.test(path)) coverage.push({path, handle:h});
        }
      }
    };
    await walk(dir, '', 0);
    return {entries, gitHandle, coverage, gitStamp};
  }
  async function collectCoverage(d, prefix, out){
    for await (const [name, h] of d.entries()){ const p=prefix+'/'+name;
      if(h.kind==='file'){ if(L.RE_COVERAGE.test(p)) out.push({path:p, handle:h}); } else if(p.split('/').length<6) await collectCoverage(h, p, out); }
  }
  // „odcisk" historii: HEAD i logs/HEAD (zmieniają się przy commicie, checkout, merge)
  async function stampOf(gitDir){
    const part=async(get)=>{ try{ const f=await (await get()).getFile(); return f.size+':'+f.lastModified; }catch(e){ return '-'; } };
    const logs=async()=>(await gitDir.getDirectoryHandle('logs')).getFileHandle('HEAD');
    return (await part(()=>gitDir.getFileHandle('HEAD')))+'|'+(await part(logs));
  }
  // pliki .git jako [{path, file}] dla git-local.js (świeże obiekty File przy każdym przeliczeniu)
  async function gitFiles(gitDir){
    const out=[];
    const walk=async(d, prefix)=>{ for await (const [name, h] of d.entries()){ const p=prefix?prefix+'/'+name:name;
      if(h.kind==='directory'){ if(name!=='hooks') await walk(h, p); } else if(!/\.lock$/.test(name)){ try{ out.push({path:p, file:await h.getFile()}); }catch(e){ /* plik .git w trakcie zapisu — pominięty */ } } } };
    await walk(gitDir, '');
    return out;
  }
  async function readRecord(path, e, textBudget){
    const rec={path, size:e.size, mtime:e.mtime, content:null};
    if(textBudget.left>0 && L.isTextFile(path.split('/').pop(), e.size)){
      try{ rec.content=await (await e.handle.getFile()).text(); textBudget.left--; }catch(err){ /* plik zniknął/zablokowany — bez treści */ }
    }
    return rec;
  }

  // ---------------- zapamiętany folder (IndexedDB) — wznowienie po przeładowaniu ----------------
  const DB='codemap-live';
  function idb(){ return new Promise((res, rej)=>{ const r=indexedDB.open(DB, 1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function kv(op, val){
    try{ const db=await idb();
      try{ return await new Promise((res, rej)=>{ const tx=db.transaction('kv', op==='get'?'readonly':'readwrite'), st=tx.objectStore('kv');
        const q=op==='get'?st.get('last'):op==='put'?st.put(val, 'last'):st.delete('last'); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }
      finally{ db.close(); } }
    catch(e){ return null; }
  }
  const remember=(dir)=>kv('put', {handle:dir, name:dir.name, at:Date.now()});
  const forget=()=>{ const b=$('#st-live-resume'); if(b) b.remove(); return kv('del'); };
  const remembered=()=>kv('get');
  // pasek stanu: „↻ Wznów na żywo: nazwa” + „×” (nie wznawiaj)
  async function offerResume(){
    if(S.on || $('#st-live-resume')) return false;
    const r=await remembered(); if(!r || !r.handle || S.on) return false;
    const b=el('span',{id:'st-live-resume', class:'st-live st-live-resume', title:T('live.resumeTitle','Folder obserwowany przed przeładowaniem strony — kliknij, aby wczytać go ponownie i dalej śledzić zmiany')});
    b.appendChild(el('button',{class:'st-live-btn st-live-go', type:'button', text:'↻ '+T('live.resumeAsk','Wznów na żywo: ')+r.name,
      onclick:async()=>{ b.remove(); const ok=await start(r.handle); if(!ok) forget(); }}));
    b.appendChild(el('button',{class:'st-live-btn', type:'button', title:T('live.forget','Nie wznawiaj'), text:'×', onclick:()=>forget()}));
    const host=$('#st-project'); if(host&&host.parentNode) host.parentNode.insertBefore(b, host.nextSibling); else document.body.appendChild(b);
    return true;
  }

  // ---------------- start / stop ----------------
  async function pick(){
    if(typeof window.showDirectoryPicker!=='function'){ U.toast(T('live.unsupported','Ta przeglądarka nie potrafi obserwować folderów (File System Access API — użyj Chrome lub Edge).'),'error',7000); return false; }
    let dir; try{ dir=await window.showDirectoryPicker({mode:'read', id:'codemap-live'}); }catch(e){ return false; }   // anulowanie wyboru
    return start(dir);
  }
  async function start(dir, opts){
    opts=opts||{};
    try{ if(dir.queryPermission && (await dir.queryPermission({mode:'read'}))!=='granted' && (await dir.requestPermission({mode:'read'}))!=='granted'){ U.toast(T('live.denied','Brak uprawnień do odczytu folderu.'),'error'); return false; } }catch(e){ /* brak API uprawnień — próbujemy czytać */ }
    stop(true, true);
    const my=++S.gen;
    const ok=await A.ingest(async (onProgress, onStatus)=>{
      onStatus && onStatus(T('live.reading','Czytanie folderu…'));
      const sc=await scan(dir);
      const budget={left:L.MAX_CONTENT_FILES||4000}, files=[]; let done=0;
      for(const [path, e] of sc.entries){ files.push(await readRecord(path, e, budget)); if(onProgress && (++done&63)===0) onProgress(done, sc.entries.size); }
      S.files=new Map(files.map(f=>[f.path, f])); S.gitStamp=sc.gitStamp;
      const side={git:null, gitHandle:sc.gitHandle, gitFile:null, coverage:[], gitEntry:null, coverageEntries:[]};
      if(sc.gitHandle) side.git=await gitFiles(sc.gitHandle);
      for(const c of sc.coverage){ try{ side.coverage.push({path:c.path, file:await c.handle.getFile()}); }catch(e){ /* raport pokrycia zniknął — pomijamy */ } }
      return {files, meta:{name:dir.name, source:'live: '+dir.name, kind:'local', live:true, createdAt:Date.now()}, side};
    }, T('live.reading','Czytanie folderu…'));
    if(!ok || my!==S.gen) return false;
    S.on=true; S.paused=false; S.dir=dir; S.name=dir.name; S.interval=opts.interval||adaptive();
    remember(dir); const rb=$('#st-live-resume'); if(rb) rb.remove();
    rememberPre();
    observe(); schedule(); renderBadge();
    return true;
  }
  // keep = restart tego samego mechanizmu (bez zapominania folderu); zakończenie przez użytkownika albo inny projekt → zapomnij
  function stop(silent, keep){
    const was=S.on; S.on=false; S.paused=false; S.gen++;
    if(was && !keep) forget();
    clearTimeout(S.timer); S.timer=0;
    if(S.observer){ try{ S.observer.disconnect(); }catch(e){ /* obserwator już odłączony */ } S.observer=null; }
    S.dir=null; S.files=new Map(); S.pre=new Map(); S.pulses.clear(); renderBadge();
    if(was && !silent) U.toast(T('live.stopped','Zakończono obserwację folderu.'));
  }
  function setPaused(p){ S.paused=!!p; renderBadge(); if(!S.paused) schedule(0); }
  const adaptive=()=>{ const n=S.files.size||0; return n<2000?DEF_POLL:n<10000?5000:15000; };
  function observe(){
    if(typeof window.FileSystemObserver!=='function' || !S.dir) return;
    try{
      S.observer=new window.FileSystemObserver(()=>{ if(S.on && !S.paused) schedule(250); });
      const p=S.observer.observe(S.dir, {recursive:true}); if(p && p.catch) p.catch(()=>{ S.observer=null; });
    }catch(e){ S.observer=null; }
  }
  function schedule(ms){
    clearTimeout(S.timer); if(!S.on || S.paused) return;
    // z obserwatorem skan co 2× rzadziej (siatka bezpieczeństwa — zdarzenia obserwatora bywają gubione)
    const next=ms!=null?ms:(S.observer?S.interval*2:S.interval);
    S.timer=setTimeout(()=>{ if(document.hidden){ schedule(); return; } poll().finally(()=>schedule()); }, next);
  }

  // ---------------- wykrycie zmian i przebudowa ----------------
  // pozycje/stan starego grafu przenoszone na nowy (id = ścieżka); wyniki analizy niezmienionych plików z cache
  function rememberPre(){
    S.pre=new Map();
    const g=A.graph; if(!g) return;
    for(const n of g.nodes.values()) if(n.type==='file' && n.metrics && n.path) S.pre.set(n.path, {path:n.path, metrics:n.metrics, deps:n.deps||[], symbols:n.symbols||[], hash:n.hash});
  }
  async function poll(){
    if(!S.on || !S.dir) return null;
    if(S.busy){ S.again=true; return null; }
    S.busy=true; const my=S.gen;
    try{
      const sc=await scan(S.dir);
      if(my!==S.gen) return null;
      const added=[], changed=[], removed=[];
      for(const [path, e] of sc.entries){ const old=S.files.get(path); if(!old) added.push(path); else if(old.size!==e.size || old.mtime!==e.mtime) changed.push(path); }
      for(const path of S.files.keys()) if(!sc.entries.has(path)) removed.push(path);
      const gitMoved=sc.gitStamp!==S.gitStamp; S.gitStamp=sc.gitStamp;
      if(!added.length && !changed.length && !removed.length){ if(gitMoved) rerunGit(); return {added, changed, removed}; }
      const budget={left:Math.max(0,(L.MAX_CONTENT_FILES||4000)-[...S.files.values()].filter(f=>f.content!=null).length)};
      for(const p of removed) S.files.delete(p);
      for(const p of [...added, ...changed]){ const prev=S.files.get(p); if(prev&&prev.content!=null) budget.left++; S.files.set(p, await readRecord(p, sc.entries.get(p), budget)); S.pre.delete(p); }
      if(my!==S.gen) return null;
      await rebuild([...added, ...changed], removed);
      if(my!==S.gen) return null;
      const pulse=Date.now(); for(const p of added) S.pulses.set(p,{t:pulse, k:'A'}); for(const p of changed) S.pulses.set(p,{t:pulse, k:'M'});
      animate();
      const names=[...changed, ...added].slice(0,3).map(p=>p.split('/').pop()).join(', ');
      U.toast(T('live.changes','Na żywo: ')+[changed.length?changed.length+T('live.mod',' zmienionych'):'', added.length?added.length+T('live.add',' nowych'):'', removed.length?removed.length+T('live.del',' usuniętych'):''].filter(Boolean).join(', ')+(names?' — '+names:''), '', 3500);
      if(gitMoved) rerunGit();
      return {added, changed, removed};
    } finally { S.busy=false; if(S.again){ S.again=false; schedule(50); } }
  }
  async function rebuild(dirty, removed){
    const old=A.graph, meta=Object.assign({}, old.meta);
    const files=[...S.files.values()].map(f=>({path:f.path, size:f.size, mtime:f.mtime, content:f.content}));
    const toAnalyze=files.filter(f=>f.content!=null && dirty.includes(f.path));
    const fresh=toAnalyze.length ? await A.analyzeFiles(toAnalyze, A._ingestGen) : new Map();
    const pre=new Map(S.pre); if(fresh) for(const [k,v] of fresh) pre.set(k,v);
    const g=new CM.Graph.Graph(); g.build(files, meta, pre);
    // stan węzłów, które przetrwały
    for(const n of g.nodes.values()){ const o=old.nodes.get(n.id); if(!o) continue;
      if(Number.isFinite(o.x)){ n.x=o.x; n.y=o.y; n._placed=true; }
      if(o.collapsed!=null) n.collapsed=o.collapsed; if(o.locked) n.locked=true;
      if(o.git) n.git=o.git; if(o.coverage && !dirty.includes(n.path)) n.coverage=o.coverage; }
    g.gitInfo=old.gitInfo||null; g.prInfo=old.prInfo||null;
    if(old.testInfo && old.testInfo.coverage){ g.testInfo=Object.assign({}, old.testInfo); }
    const selId=A.renderer.selected&&A.renderer.selected.id;
    A.graph=g; rememberPre();
    if(CM.TestMap) try{ CM.TestMap.mapTests(g); }catch(e){ console.warn('[CodeMap] Live: mapa testów', e); }
    A.countsInit();
    A.refreshView();
    if(selId && g.nodes.has(selId)) A.select(g.nodes.get(selId)); else if(selId) A.select(null);
    if(old.symbolsInfo && A.filters.symbols) A.ensureSymbols();
    return g;
  }
  async function rerunGit(){
    if(!S.dir || !CM.Git) return;
    try{ const gd=await S.dir.getDirectoryHandle('.git'); if(state.side) { state.side.git=await gitFiles(gd); } U.toast(T('live.gitRerun','Nowy commit — odświeżam historię git…'),'',3000); CM.Git.run({auto:true}); }
    catch(e){ if(!e || e.name!=='NotFoundError') console.warn('[CodeMap] Live: odświeżenie historii git', e); }   // brak .git = norma
  }

  // ---------------- zmiany świecą na mapie (3 s) ----------------
  function animate(){ const tick=()=>{ if(!S.pulses.size) return; A.renderer.kick(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  function liveDecorator(ctx, R){
    if(!S.pulses.size) return;
    const now=Date.now(), z=R.cam.zoom, sc=R.opts.nodeScale, W=R.w, H=R.h, byId=R.nodeById;
    for(const [p, v] of S.pulses){ const age=(now-v.t)/3000; if(age>=1){ S.pulses.delete(p); continue; }
      const n=byId&&byId.get(p); if(!n) continue;
      const sp=R.cam.toScreen(n.x,n.y,W,H), r=n.r*sc*z;
      ctx.globalAlpha=1-age; ctx.strokeStyle=v.k==='A'?'#34d399':'#facc15'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r+4+age*18, 0, 6.2832); ctx.stroke(); }
    ctx.globalAlpha=1;
  }

  // ---------------- znacznik na pasku stanu ----------------
  function renderBadge(){
    let b=$('#st-live');
    if(!S.on){ if(b) b.remove(); return; }
    if(!b){ b=el('span',{id:'st-live',class:'st-live',title:T('live.title','Obserwuję folder — zmiany trafiają na mapę automatycznie')});
      const host=$('#st-project'); if(host&&host.parentNode) host.parentNode.insertBefore(b, host.nextSibling); else document.body.appendChild(b); }
    b.innerHTML='';
    b.appendChild(el('span',{class:'st-live-dot'+(S.paused?' paused':'')}));
    b.appendChild(el('span',{text:T('live.on','NA ŻYWO')}));
    b.appendChild(el('button',{class:'st-live-btn',type:'button',title:S.paused?T('live.resume','Wznów'):T('live.pause','Wstrzymaj'),text:S.paused?'▶':'❚❚',onclick:()=>setPaused(!S.paused)}));
    b.appendChild(el('button',{class:'st-live-btn',type:'button',title:T('live.stop','Zakończ obserwację'),text:'×',onclick:()=>stop()}));
  }

  // ---------------- okablowanie ----------------
  function wire(){
    if(!A.renderer){ setTimeout(wire, 40); return; }
    if(!A.renderer.decorators.includes(liveDecorator)) A.renderer.decorators.push(liveDecorator);
    const b=$('#btn-load-live');
    if(b){ if(typeof window.showDirectoryPicker!=='function') b.classList.add('hidden'); b.onclick=()=>{ document.querySelectorAll('.menu-panel').forEach(p=>p.classList.remove('open')); pick(); }; }
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && S.on && !S.paused) schedule(200); });
    setTimeout(()=>{ offerResume(); }, 1200);   // po przywróceniu sesji (mapa z poprzedniego razu jest już na ekranie)
  }
  // inny projekt (wczytanie, mapa z pliku, czyszczenie) kończy obserwację — ale nie nasz własny ingest
  // inny wczytany projekt albo „wyczyść” — propozycja wznowienia traci sens
  A.onProjectLoaded(({reason, meta})=>{ if(!S.on && (reason==='clear' || (reason==='ingest' && !(meta && meta.live)))) forget(); });
  A.onProjectLoaded(({reason, meta})=>{ if(!S.on) return; if(reason==='ingest' && meta && meta.live && meta.name===S.name) return; if(reason==='live') return; stop(true); });
  if(A.registerAction){
    A.registerAction({name:'liveFolder', sig:'', desc:'pick a local folder and keep the map in sync with its changes (File System Access; Chrome/Edge)', descPl:'folder na żywo — mapa nadąża za zmianami plików', auto:false, run:()=>{ pick(); return T('load.live','Folder na żywo (obserwuj zmiany)'); }});
    A.registerAction({name:'liveResume', sig:'', desc:'resume watching the folder that was live before the page was reloaded', descPl:'wznów folder na żywo sprzed przeładowania', auto:false,
      run:async()=>{ const r=await remembered(); if(!r||!r.handle) return '—'; const b=$('#st-live-resume'); if(b) b.remove(); const ok=await start(r.handle); return ok?T('load.live','Folder na żywo (obserwuj zmiany)')+': '+r.name:T('live.denied','Brak uprawnień do odczytu folderu.'); }});
    A.registerAction({name:'liveStop', sig:'', desc:'stop watching the live folder', descPl:'zakończ obserwację folderu', auto:true, run:()=>{ const was=S.on; stop(); return was?T('live.stopped','Zakończono obserwację folderu.'):'—'; }});
  }
  // zapis pliku w korzeniu obserwowanego folderu (np. zatwierdzone reguły architektury) — przeglądarka pyta
  // o uprawnienie do zapisu; kolejny poll wczytuje plik jak każdą inną zmianę
  async function writeFile(name, text){
    if(!S.on || !S.dir) throw new Error('live off');
    if(S.dir.queryPermission && await S.dir.queryPermission({mode:'readwrite'}) !== 'granted'
       && (!S.dir.requestPermission || await S.dir.requestPermission({mode:'readwrite'}) !== 'granted')) throw new Error('permission denied');
    const fh=await S.dir.getFileHandle(name, {create:true}), w=await fh.createWritable();
    await w.write(new Blob([text])); await w.close();
    poll();
    return true;
  }
  CM.Live={pick, start, stop, poll, writeFile, offerResume, remembered, forget, pause:()=>setPaused(true), resume:()=>setPaused(false), state:()=>({on:S.on, paused:S.paused, name:S.name, files:S.files.size, observer:!!S.observer, interval:S.interval})};
  setTimeout(wire, 0);
})();
