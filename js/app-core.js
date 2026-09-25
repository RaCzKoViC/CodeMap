/* ===================== app-core.js — CM.App: wspólny kontekst i rdzeń aplikacji ===================== */
// Tworzy CM.App (A) — kontekst współdzielony przez moduły app-*: A.graph (PODMIENIANY przy wczytywaniu),
// A.renderer, state, filters, handlers, THEME_PRESETS oraz rdzeń: init/boot, apply + seedUnplaced, ingest,
// loadFromJSON, clearAll, zaznaczenie/wpływ, autozapis sesji, tryby CodeMap/MindMap, proxy Web Workera fizyki.
// Pozostałe moduły (chrome, repo-hosts, compare, navigation, ai-bridge) dopisują się przez Object.assign(A, …)
// i wołają się nawzajem wyłącznie w czasie działania przez A.nazwa(…), więc ich kolejność ładowania nie ma znaczenia.
(function(){
  const A=CM.App={};   // wspólny kontekst modułów app-* (patrz nagłówek)
  const U=CM.util, $=U.$, el=U.el, I=CM.i18n;
  const Graph=CM.Graph.Graph, Layouts=CM.Layouts, Storage=CM.Storage, UI=CM.UI;

  A.graph=new Graph();          // PODMIENIANY przy wczytywaniu (ingest / loadFromJSON / clearAll / compareBranches) — zawsze czytaj A.graph w momencie wywołania
  A.renderer=undefined;         // tworzony w init()
  const state={
    layout:'pack',
    vis:{nodes:[],edges:[]},
    sim:null,
    counts:{nodes:0,edges:0},
    lastDiff:null,
    spacing:3,
    displayLayout:'pack',
    groups:[],           // loaded comparison schemas {gid,name,color}
    gidSeq:0,
    cyclesOn:false,
  };
  const filters={folders:true, files:true, externals:false, contains:true, import:true, reference:false, langsOff:new Set(), metric:'lines', minMetric:0};

  // ---------------- init ----------------
  function init(){
    CM.icons.hydrate();
    CM.i18n.apply();        // translate static UI to the persisted language (PL / EN)
    A.renderer=new CM.Renderer.Renderer($('#map-canvas'));
    A.renderer.onSelect = (n)=>select(n);
    A.renderer.onHover  = (n,e)=>{ onHover(n,e); };
    A.renderer.onToggleCollapse = (n)=>toggleCollapse(n);
    A.renderer.onDblFile = (n)=>{ select(n); A.renderer.centerOn(n); };
    A.renderer.onContext = (n,x,y)=>A.contextMenu(n,x,y);
    A.renderer.onEdgeSelect = (edge)=>selectEdge(edge);
    A.renderer.onChange = U.throttle(()=>{ updateStatus(); A.updateRotDial(); A.renderer.drawMinimap($('#minimap')); A.positionAuthors(); A.updateHash(); }, 55);
    A.renderer.onSettle = ()=>{
      // a pending view-restore (shared link) wins over fit-on-settle — otherwise the layout's own
      // settle would refit and discard the camera the link asked to restore
      if(state._pendingViewRestore){ const fn=state._pendingViewRestore; state._pendingViewRestore=null; state._fitOnSettle=false; fn(); saveSessionDebounced(); return; }
      if(state._fitOnSettle){ state._fitOnSettle=false; A.renderer.fit(); saveSessionDebounced(); } };

    A.wireToolbar(); A.wireMenus(); A.wireFilters(); A.wireViewControls(); A.wireSearch(); A.wireDnD();
    A.wireModals(); A.wireKeyboard(); A.wireGameNav(); A.wireMinimap(); A.wireRotDial();
    A.wirePanels(); A.wireAppearance(); A.wirePaste(); A.wireNodeAppearance();
    A.wireBrand(); A.wireCompare(); A.wireNeighborhood();
    wireModes(); A.startClock();
    A.wireLayoutMenu();      // custom layout dropdown (styled like the Wczytaj menu)
    A.wireCollapsibleSections(); // collapsible sections in the left panel
    A.wireSettingsUI();      // gear button + settings overlay handlers
    A.wireSettings();        // restore persisted appearance/filters; persist on change
    restoreSessionPrompt();// offer to reopen the last auto-saved map
    A.buildPalette();        // Ctrl/Cmd+K command palette
    A.wirePWA();             // service worker + installability
    // re-translate dynamic chrome whenever the language changes
    CM.i18n.onChange(()=>{ updateStatus(); refreshProjectLabel();
      if(A.graph && A.graph.nodes && A.graph.nodes.size){
        UI.renderDetails(A.renderer.selected||null, A.graph, handlers);
        UI.renderLangFilters(A.graph, {langsOff:filters.langsOff}, handlers);
      }
    });
    updateStatus(); refreshProjectLabel();
  }

  // ---------------- hover: quick tooltip + delayed code preview ----------------
  let _hoverTimer=null;
  function onHover(n, e){
    if(_hoverTimer){ clearTimeout(_hoverTimer); _hoverTimer=null; }
    UI.filePreview(null);                       // drop any open code card
    const px=e?e.clientX:0, py=e?e.clientY:0;
    UI.tooltip(n, px, py);
    $('#st-hover').textContent = n ? (n.path||n.name) : '';
    const cb=$('#opt-hover-preview');
    if(n && n.type==='file' && n.preview && (!cb || cb.checked)){
      _hoverTimer=setTimeout(()=>{
        _hoverTimer=null;
        if(A.renderer.hovered && A.renderer.hovered.id===n.id){ UI.tooltip(null); UI.filePreview(n, px, py); }
      }, 430);
    }
  }

  // named, professionally-curated theme presets: theme + canvas bg + window tint + accent
  const THEME_PRESETS={
    depth:    {theme:'dark',  bg:'#070a10', menu:'10,18,34',    accent:'#22d3ee'},
    graphite: {theme:'dark',  bg:'#10131c', menu:'14,19,28',    accent:'#60a5fa'},
    ghdark:   {theme:'dark',  bg:'#0d1117', menu:'16,21,30',    accent:'#58a6ff'},
    forest:   {theme:'dark',  bg:'#05140f', menu:'12,22,20',    accent:'#34d399'},
    plum:     {theme:'dark',  bg:'#14101f', menu:'20,18,34',    accent:'#a78bfa'},
    paper:    {theme:'light', bg:'#f4f6fb', menu:'236,239,246', accent:'#2563eb'},
    parchment:{theme:'light', bg:'#fbf6e9', menu:'245,240,230', accent:'#b45309'},
    mist:     {theme:'light', bg:'#e7ecf3', menu:'224,231,242', accent:'#0f766e'},
  };
  A._applyThemePreset=null;   // bound in wireAppearance (chrome.js; needs renderer + root)

  // ---------------- auto-saved session (reopen last map) ----------------
  const saveSessionDebounced=U.debounce(()=>{ if(A.graph && state.counts.nodes>0){ try{ Storage.saveSession(A.graph.toJSON()); }catch(e){} } }, 1500);
  function restoreSessionPrompt(){
    if(!Storage.loadSession) return;
    Storage.loadSession().then(s=>{
      if(!s || !s.map || !(s.map.nodes&&s.map.nodes.length)) return;
      const btn=$('#empty-restore'); if(!btn) return;
      btn.classList.remove('hidden');
      btn.title=I.t('ca.lastMap','Ostatnia mapa')+(s.ts?(' — '+U.relTime(s.ts)):'');
      btn.onclick=()=>{ try{ loadFromJSON(s.map); }catch(e){ U.toast(I.t('ca.restoreFail','Nie udało się przywrócić mapy.'),'error'); } };
    }).catch(()=>{});
  }

  // ---------------- work modes: CodeMap <-> MindMap ----------------
  let mode='codemap';
  function setMode(m){
    mode=m;
    document.querySelectorAll('#mode-switch .mode-btn').forEach(b=>b.classList.toggle('on', b.dataset.mode===m));
    document.body.classList.toggle('mode-mindmap', m==='mindmap');
    if(m==='mindmap'){
      CM.MindMap.activate();
      $('#empty-state').classList.add('hidden');
    } else {
      CM.MindMap.deactivate();
      if(state.counts.nodes===0) $('#empty-state').classList.remove('hidden');
      A.renderer.kick(); if(state.counts.nodes===0) A.minimizeMinimap(); else A.expandMinimap();
    }
  }
  function wireModes(){
    document.querySelectorAll('#mode-switch .mode-btn').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
    const pc=$('#pick-codemap'), pm=$('#pick-mindmap');
    if(pc) pc.onclick=()=>{ setMode('codemap'); };
    if(pm) pm.onclick=()=>setMode('mindmap');
  }

  // edge clicked on the map -> show dependency details + direction
  function selectEdge(edge){
    select(null);
    const s=A.graph.nodes.get(edge.source), t=A.graph.nodes.get(edge.target);
    UI.renderEdgeDetails(edge, s, t, A.graph, handlers);
    if($('#right-panel').classList.contains('collapsed')) A.togglePanel('right');
  }

  const handlers={
    focus:(id)=>focusNode(id),
    toggleCollapse:(n)=>toggleCollapse(n),
    toggleLang:(k)=>toggleLang(k),
    biggest:(folder)=>biggestInFolder(folder),
    pick:(id)=>{ $('#search-input').value=''; focusNode(id); },
    compare:(a,b)=>A.doCompare(a,b),
    compareToCurrent:(s)=>A.doCompare(s, {label:I.t('ca.currentState','stan bieżący'), ts:Date.now(), signature:A.graph.signature()}),
    del:(id)=>Storage.deleteSnapshot(id).then(A.openHistory),
    openFile:(node)=>{ UI.renderFileView(node, A.graph, handlers); A.openModal('modal-fileview'); },
    repoUrl:(node)=>A.nodeRepoUrl(node),
    openRepoUrl:(node)=>{ const u=A.nodeRepoUrl(node); if(u) window.open(u,'_blank','noopener'); },
    repoHostName:()=>A.repoHostName(),
    openRepo:()=>{ const m=A.graph.meta; if(m&&m.html) window.open(m.html,'_blank','noopener'); },
    aiConfigured:()=>A.aiConfigured(),   // Ask-AI box appears only when at least one key is set
    aiAskNode:(node,q)=>A.aiAskNode(node,q),
  };

  // ---------------- Web Worker force-sim (off main thread for large graphs) ----------------
  // Single source of truth for the version: the worker is fetched at the SAME ?v= as app-core.js itself
  // (read off our own <script> tag), so bumping index.html bumps the worker too — no drift.
  const SIM_WORKER_URL=(()=>{
    const s=document.currentScript || document.querySelector('script[src*="js/app-core.js"]');
    const v=s && s.src && (s.src.match(/[?&]v=([\w.-]+)/)||[])[1];
    return 'js/sim-worker.js'+(v?('?v='+v):'');
  })();
  let _workerOK = (typeof window.Worker==='function');
  // Offload physics to the Web Worker for anything beyond a trivially small map, so the main thread
  // is never blocked by the force simulation. Tiny graphs (< threshold) settle main-thread in a blink.
  function useWorker(n){ return _workerOK && n >= (window.__simWorkerMin||120); }
  // returns a sim-like proxy (running:false so the renderer never ticks it); the worker streams
  // positions which we write back into the live nodes, then refit on settle. reheat() = user took
  // over (drag) -> stop the worker and freeze current positions.
  function startWorkerSim(nodes, edges, simOpts){
    let worker;
    try{ worker=new Worker(SIM_WORKER_URL); }catch(e){ _workerOK=false; return null; }
    const N=nodes.length, idx=new Map(nodes.map((n,i)=>[n.id,i]));
    const initNodes=nodes.map(n=>({x:n.x||0, y:n.y||0, r:n.r||6, fixed:!!n.fixed}));
    const initEdges=[];
    for(const e of edges){ const s=idx.get(e.source), t=idx.get(e.target); if(s==null||t==null) continue;
      initEdges.push({s, t, c:e.type==='contains'?1:0, w:e.weight||1}); }
    let dead=false;
    const cleanup=()=>{ if(dead) return; dead=true; try{ worker.terminate(); }catch(e){} };
    const writeBack=(p)=>{ for(let i=0;i<N;i++){ nodes[i].x=p[i*2]; nodes[i].y=p[i*2+1]; } };
    worker.onmessage=(ev)=>{ const d=ev.data;
      if(d.type==='pos'){ if(!dead){ writeBack(d.pos); A.renderer.kick(); } }
      else if(d.type==='settled'){ if(!dead){ writeBack(d.pos); cleanup(); A.renderer.kick(); A.renderer.onSettle(); } }
    };
    worker.onerror=()=>{ _workerOK=false; cleanup(); };
    worker.postMessage({type:'init', nodes:initNodes, edges:initEdges, spacing:state.spacing,
      opts:{alphaMin:simOpts&&simOpts.alphaMin, alphaDecay:simOpts&&simOpts.alphaDecay, velDecay:simOpts&&simOpts.velDecay}});
    return { running:false, _worker:true, tick(){}, reheat(){ cleanup(); }, stop(){ cleanup(); } };
  }

  // cosmic palettes per layout (core -> outskirts)
  const COSMIC_LAYOUTS={
    nebula:       ['#fffdf0','#ffd27a','#ff7ac0','#7c5cff','#1b1740'],
    spiralgalaxy: ['#fff7d6','#ffd27a','#5ad1ff','#3b5bdb','#10173a'],
    cosmicrings:  ['#eafff7','#34d399','#22d3ee','#7c5cff','#2a1840'],
    solar:        ['#fff7d6','#ffd27a','#ff9b6b','#7c5cff','#10173a'],
    helix:        ['#e8fff6','#7afcd0','#34d1ff','#5b6bff','#0a1130'],
    constellation:['#ffffff','#cfe3ff','#8fb6ff','#3a57c8','#070b22'],
    vortex:       ['#fff0fb','#ffadf0','#c46bff','#5a2bd6','#0c0726'],
  };

  // ---------------- core view pipeline ----------------
  // persist: zapis sesji (IndexedDB + ewentualny push do chmury) tylko gdy zmienia się to, co sesja
  // przechowuje — pozycje/układ/zwinięcia. Filtry, metryka i języki żyją w codemap_settings, więc ich
  // przełączanie nie serializuje całego grafu (na dużych mapach = dziesiątki MB na każde kliknięcie).
  function apply({relayout=true, refit=false, persist=relayout}={}){
    // Halt ANY running simulation (worker OR main-thread) before re-filtering / relaying out.
    // Critical for performance: a filter/layer toggle must never leave the force physics churning on
    // the main thread — that is what tanked FPS to a crawl on medium+ graphs and made the panel unusable.
    if(state.sim){ if(state.sim._worker) state.sim.stop(); else state.sim.running=false; }
    // Mapa wczytana z pliku ('saved') ma pozycje użytkownika — 'saved' nie jest układem, więc każdy
    // relayout (rozwiń/zwiń wszystko, pokaż różnice) wpadał w default = force i niszczył je.
    // Zostajemy przy pozycjach; nowo odsłonięte węzły dostają miejsce przez seedUnplaced.
    if(relayout && state.layout==='saved' && !state.groups.length) relayout=false;
    state.vis=A.graph.getVisible(filters);
    if(relayout){
      if(state.groups.length){ A.relayoutGroups(); }   // keep multiple schemas separated side-by-side
      else {
        const res=Layouts.apply(state.layout, A.graph, state.vis, {spacing:state.spacing});
        state.sim=res.sim||null;
        // animated layouts (force/galaxy/modules): settle live (non-blocking) and refit on settle.
        state._fitOnSettle = !!(res.sim && refit);
        if(res.sim){
          const n=state.vis.nodes.length;
          if(useWorker(n)){
            // physics runs in a Web Worker (off the main thread) — the renderer never ticks this sim,
            // it only paints positions the worker streams back. Scales to the largest repositories.
            const proxy=startWorkerSim(state.vis.nodes, state.vis.edges, res.sim);
            if(proxy) state.sim=proxy;
          } else if(n>400){
            // Worker unavailable on a big graph: settle SYNCHRONOUSLY in one bounded pass, then freeze —
            // so the render loop never runs physics frame-by-frame on the main thread (no sustained FPS hit).
            // Tick budget scales inversely with size so even huge graphs can't lock the thread for long.
            let i=0; const cap=Math.max(60, Math.min(240, Math.round(180000/n)));
            while(state.sim.running && i++<cap) state.sim.tick();
            state.sim.running=false; state._fitOnSettle=false;
            if(refit) requestAnimationFrame(()=>A.renderer.fit());
          }
          // else: tiny graph — the main-thread sim animates live per frame (negligible cost).
        }
        for(const n of state.vis.nodes) n._placed=true;
      }
    } else {
      seedUnplaced(state.vis.nodes);    // only newly-revealed nodes get a position; rest stay put
    }
    // cosmic colour mode for nebula / galaxy layouts (palette per layout)
    const pal=COSMIC_LAYOUTS[state.layout];
    A.renderer.opts.cosmic=!!pal; if(pal){ A.renderer.opts.cosmicPalette=pal; A.renderer._cosmicLUT=null; }
    A.renderer.setData(A.graph, state.vis, state.sim);
    UI.renderLangFilters(A.graph, {langsOff:filters.langsOff}, handlers);
    updateStatus();
    A.renderer.drawMinimap($('#minimap'));
    A.refreshAuthors();
    // static layouts fit immediately; animated ones fit once the live simulation settles (onSettle)
    if(refit && !state._fitOnSettle) requestAnimationFrame(()=>A.renderer.fit());
    if(persist) saveSessionDebounced();
  }

  // seed only nodes that have never been placed (e.g. just-revealed by a filter) near their parent,
  // so toggling filters never re-scrambles the whole map
  function seedUnplaced(nodes){
    const byId=new Map(nodes.map(n=>[n.id,n]));
    for(const n of nodes){
      if(n._placed) continue;
      let px=0, py=0;
      let p=n.parent!=null?A.graph.nodes.get(n.parent):null;
      while(p){ if(byId.has(p.id)&&p._placed){ px=p.x; py=p.y; break; } p=p.parent!=null?A.graph.nodes.get(p.parent):null; }
      const ang=(n.id.length*0.7)% (Math.PI*2), rad=46+(n.r||8);
      n.x=px+Math.cos(ang)*rad; n.y=py+Math.sin(ang)*rad; n.vx=0; n.vy=0; n._placed=true;
    }
  }

  function select(node){
    A.renderer.setSelected(node);
    UI.renderDetails(node, A.graph, handlers);
    applyImpact();
    A.updateHash();
  }

  // ---- dependency impact view (upstream / downstream) ----
  A.impactOn=false;
  function applyImpact(){
    if(A.impactOn && A.renderer.selected){ try{ A.renderer.setImpact(A.graph.impactSet(A.renderer.selected.id)); }catch(e){ A.renderer.setImpact(null); } }
    else A.renderer.setImpact(null);
  }
  function toggleImpact(){
    A.impactOn=!A.impactOn;
    const b=$('#vc-impact'); if(b){ b.classList.toggle('active', A.impactOn); b.setAttribute('aria-pressed', A.impactOn?'true':'false'); }
    if(A.impactOn && !A.renderer.selected) U.toast(I.t('ca.impactHint','Widok wpływu: zaznacz plik, aby zobaczyć od czego zależy (w dół) i co od niego zależy (w górę).'),'',3200);
    applyImpact();
  }
  function toggleCollapse(node){ node.collapsed=!node.collapsed; apply({relayout:false, persist:true}); if(A.renderer.selected) UI.renderDetails(A.renderer.selected, A.graph, handlers); }
  function toggleLang(key){ if(filters.langsOff.has(key)) filters.langsOff.delete(key); else filters.langsOff.add(key); apply({relayout:false}); }

  function revealNode(id){
    const n=A.graph.nodes.get(id); if(!n) return null;
    let changed=false, cur=n.parent!=null?A.graph.nodes.get(n.parent):null;
    while(cur){ if(cur.collapsed){cur.collapsed=false;changed=true;} cur=cur.parent!=null?A.graph.nodes.get(cur.parent):null; }
    if(n.type==='file' && filters.langsOff.has(n.lang)){ filters.langsOff.delete(n.lang); changed=true; }
    if((n.type==='external'||n.id==='__ext__') && !filters.externals){ filters.externals=true; $('#show-externals').checked=true; changed=true; }
    if(changed) apply({relayout:false});
    return n;
  }
  function focusNode(id){ const n=revealNode(id); if(!n) return; select(n); A.renderer.centerOn(n, Math.max(A.renderer.cam.zoom,1.1)); }

  function biggestInFolder(folder){
    const out=[];
    const walk=(f)=>{ for(const cid of (f.children||[])){ const c=A.graph.nodes.get(cid); if(!c)continue; if(c.type==='file')out.push(c); else walk(c); } };
    walk(folder); out.sort((a,b)=>(b.metrics?b.metrics.lines:b.size)-(a.metrics?a.metrics.lines:a.size)); return out;
  }

  // ---------------- ingest ----------------
  const tick=()=>new Promise(r=>setTimeout(r,16));
  function showLoading(t){ $('#loading-text').textContent=t||I.t('loading.text','Wczytywanie…'); $('#progress-bar').style.width='0';
    const p=$('#loading-pct'); if(p) p.textContent='0%'; const c=$('#loading-count'); if(c) c.textContent='';
    if(!$('#loading-cancel')){
      const b=el('button',{id:'loading-cancel',type:'button',text:I.t('ca.cancelLoad','Anuluj')});
      b.onclick=()=>{ A._ingestGen++; hideLoading(); U.toast(I.t('ca.loadCancelled','Anulowano wczytywanie.')); };
      $('#loading').appendChild(b);
    } else $('#loading-cancel').textContent=I.t('ca.cancelLoad','Anuluj');
    $('#loading').classList.remove('hidden'); }
  function setLoadingText(t){ $('#loading-text').textContent=t; }
  function setProgress(d,t){ const pct=t?Math.round(d/t*100):0; $('#progress-bar').style.width=pct+'%';
    const p=$('#loading-pct'); if(p) p.textContent=pct+'%';
    const c=$('#loading-count'); if(c) c.textContent=t?(U.fmtNum(d)+' / '+U.fmtNum(t)+I.t('ca.filesSuffix',' plików')):''; }
  function hideLoading(){ $('#loading').classList.add('hidden'); }
  function hideEmpty(){ $('#empty-state').classList.add('hidden'); A.positionMinimap(); }

  // Every project-scoped bit of state that must NOT leak from one loaded project into the next.
  // Shared by ingest / loadFromJSON / clearAll.
  function resetProjectState(){
    if(state.sim){ if(state.sim._worker) state.sim.stop(); else state.sim.running=false; }
    state.sim=null;
    state.groups=[]; state.gidSeq=0; A.renderer.setGroups([]);
    state.cyclesOn=false; A.renderer.setCycles(null);
    A.renderer.diffMode=false; state.lastDiff=null;
    A.renderer.selected=null; A.renderer.hovered=null; A.renderer.highlight=null;
    UI.tooltip(null); UI.filePreview(null);
    filters.langsOff.clear(); filters.minMetric=0; const mr=$('#rng-minmetric'); if(mr){ mr.value=0; } A.updateMetricLabel();
    // a shared-view hash describes the PREVIOUS project — drop it (but not while restoring from it)
    if(!A._restoring && location.hash.startsWith('#v=')){ try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){} }
  }

  // generation token: a newer load (or Cancel) invalidates every still-running older ingest,
  // so a slow fetch can never clobber the project the user loaded afterwards
  A._ingestGen=0;
  async function ingest(factory, statusText){
    const gen=++A._ingestGen;
    showLoading(statusText);
    try{
      await tick();
      const {files, meta}=await factory(setProgress, setLoadingText);
      if(gen!==A._ingestGen) return;   // superseded / cancelled — discard silently
      if(!files || !files.length){ U.toast(I.t('ca.noMatchingFiles','Nie znaleziono pasujących plików.'),'error'); hideLoading(); return; }
      setLoadingText(I.t('ca.buildingMapPre','Analiza i budowanie mapy (')+files.length+I.t('ca.buildingMapPost',' plików)…')); await tick();
      if(gen!==A._ingestGen) return;
      resetProjectState();
      A.graph=new Graph(); A.graph.build(files, meta);
      state.layout=$('#sel-layout').value; state.displayLayout=state.layout;
      if(A.graph.nodes.size>1400) A.graph.collapseToBudget(2600);   // adaptive: works for deep AND wide-flat repos
      // BIG repos: declutter automatically — no edges, tiny nodes, huge spacing
      autoTuneView();
      countsInit();
      A.refreshMetricRange();
      hideEmpty();
      A.expandMinimap();   // file structure now on the map → reveal the minimap
      select(null);
      apply({refit:true});
      if(meta.html && /^(github|gitlab|bitbucket)$/.test(meta.kind||'')) A.pushRecentRepo(meta);
      U.toast(I.t('ca.loadedPre','Wczytano <b>')+U.fmtNum(files.length)+I.t('ca.loadedMid','</b> plików — „')+meta.name+I.t('ca.loadedPost','".'),'success');
      // (AI no longer runs automatically on load — view tuning is purely the local heuristic autoTuneView())
      if(meta.warnings && meta.warnings.length) U.toast(I.t('ca.skippedArchivesPre','Pominięto nieobsługiwane archiwa (RAR/7z itp.): ')+meta.warnings.join(', ')+I.t('ca.skippedArchivesPost','. Rozpakuj je lub użyj ZIP / TAR.'),'',6500);
    }catch(e){ if(gen!==A._ingestGen) return; console.error(e); U.toast(I.t('ca.loadError','Błąd wczytywania: ')+e.message,'error',6500); }
    if(gen===A._ingestGen) hideLoading();
  }

  // big repo -> auto-declutter: turn off all edge types + externals, tiny nodes, huge spacing
  // professional auto-tuning: every loaded project gets node sizes + spacing scaled smoothly to its
  // scale (file count) so it reads well whether it's 12 files or 12 000. File sizes are already encoded
  // in each node's radius (graph.computeAggregates), so this only sets the global scale + spread.
  function autoTuneView(){
    const N = A.graph.nodes.size || 1;
    // smooth curves (no hard threshold): small projects → bold & tight, huge → small & spread out
    const scale   = U.clamp(11 / Math.pow(N + 6, 0.42), 0.42, 2.6);   // node-size multiplier (slider 42–260%)
    const spacing = U.clamp(0.5 * Math.pow(N, 0.45), 2, 25);          // spread multiplier (slider 200–2500%)
    A.renderer.opts.nodeScale = scale; state.spacing = spacing;
    const ns=$('#rng-nscale'); if(ns){ ns.value=Math.round(scale*100); $('#val-nscale').textContent=Math.round(scale*100)+'%'; }
    const sp=$('#rng-spacing'); if(sp){ sp.value=Math.round(spacing*100); $('#val-spacing').textContent=Math.round(spacing*100)+'%'; }
    // very large graphs: declutter (drop edges + externals) so the structure stays legible
    if(N > 1200){
      filters.contains=false; filters.import=false; filters.reference=false; filters.externals=false;
      const set=(id,v)=>{ const e=$('#'+id); if(e) e.checked=v; };
      set('edge-contains',false); set('edge-import',false); set('edge-reference',false); set('show-externals',false);
      U.toast(I.t('ca.bigRepo','Duże repozytorium — automatycznie odchudzono widok (bez połączeń, małe figury, duży rozrzut).'),'',4200);
    }
  }

  function countsInit(){
    let nodes=0, imp=0;
    for(const n of A.graph.nodes.values()){ if(n.type==='file'||n.type==='folder') nodes++; }
    for(const e of A.graph.edges){ if(e.type==='import'||e.type==='reference') imp++; }
    state.counts={nodes, edges:imp};
    refreshProjectLabel();
  }
  function updateStatus(){
    const I=CM.i18n;
    $('#st-nodes').textContent=U.fmtNum(state.counts.nodes)+' '+I.t('st.u.nodes');
    $('#st-edges').textContent=U.fmtNum(state.counts.edges)+' '+I.t('st.u.edges');
    $('#st-visible').textContent=U.fmtNum(state.vis.nodes.length)+' '+I.t('st.u.visible');
    $('#st-zoom').textContent=Math.round(A.renderer.cam.zoom*100)+'%';
  }
  // project label: name when loaded, translated "no project" otherwise (kept out of data-i18n
  // so a language switch never clobbers the loaded project's name)
  function refreshProjectLabel(){
    const has = A.graph && A.graph.meta && A.graph.meta.name && state.counts.nodes>0;
    const name = has ? A.graph.meta.name : '';
    $('#st-project').textContent = has ? name : CM.i18n.t('st.noproject');
    const tb=$('#tb-project-name');                       // toolbar badge next to the Projekt menu
    if(tb){ tb.textContent=name; tb.title=has?((A.graph.meta.source||name)):''; tb.classList.toggle('hidden', !has); }
  }

  function clearAll(){
    A.graph=new Graph();
    resetProjectState();
    state.vis={nodes:[],edges:[]}; state.counts={nodes:0,edges:0};
    A.renderer.setData(A.graph, state.vis, null);
    A.refreshAuthors();
    UI.renderDetails(null, A.graph, handlers);
    UI.renderLangFilters(A.graph, {langsOff:filters.langsOff}, handlers);
    $('#empty-state').classList.remove('hidden'); A.minimizeMinimap();   // no structure → minimize again
    refreshProjectLabel();
    $('#search-input').value=''; UI.renderSearch([], handlers);
    updateStatus(); A.renderer.drawMinimap($('#minimap'));
    U.toast(I.t('ca.cleared','🧹 Wyczyszczono dane.'),'success');
  }

  const MAP_FORMAT_VERSION=2;   // = Graph.toJSON().version; starsze wczytujemy (format zgodny wstecz), nowsze odrzucamy
  function loadFromJSON(obj){
    if(!obj || obj.format!=='codemap'){ U.toast(I.t('ca.notCodemapFile','To nie jest plik mapy CodeMap.'),'error'); return; }
    if((Number(obj.version)||1)>MAP_FORMAT_VERSION){ U.toast(I.t('ca.mapTooNew','Ten plik pochodzi z nowszej wersji CodeMap — zaktualizuj aplikację.'),'error',6000); return; }
    resetProjectState();
    A.graph=Graph.fromJSON(obj);
    for(const n of A.graph.nodes.values()){ if(Number.isFinite(n.x)&&Number.isFinite(n.y)) n._placed=true; }
    countsInit(); A.refreshMetricRange(); hideEmpty(); A.expandMinimap();
    select(null);
    state.layout='saved';
    // use stored positions, no relayout
    state.vis=A.graph.getVisible(filters);
    A.renderer.setData(A.graph, state.vis, null);
    UI.renderLangFilters(A.graph, {langsOff:filters.langsOff}, handlers);
    updateStatus(); A.renderer.drawMinimap($('#minimap'));
    requestAnimationFrame(()=>A.renderer.fit());
    U.toast(I.t('ca.mapLoaded','📂 Mapa wczytana z pliku.'),'success');
  }

  // ---------------- go ----------------
  function boot(){ init();
    if(location.hash==='#demo') setTimeout(A.loadDemo,150);
    else if(location.hash.startsWith('#v=')) setTimeout(()=>{ A.restoreView().catch(()=>{}); },150);
    autoTutorial();
  }
  // First launch of the INSTALLED app (also after a re-install) → start the tutorial automatically.
  // 'appinstalled' sets a flag consumed on the next standalone launch; the legacy no-flag case
  // (installed before this feature) runs once via codemap_tut_auto.
  window.addEventListener('appinstalled',()=>{ try{ localStorage.setItem('codemap_fresh_install','1'); }catch(e){} });
  function autoTutorial(){
    let standalone=false;
    try{ standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone===true; }catch(e){}
    if(!standalone) return;
    let go=false;
    try{
      if(localStorage.getItem('codemap_fresh_install')==='1'){ localStorage.removeItem('codemap_fresh_install'); go=true; }
      else if(!localStorage.getItem('codemap_tut_auto')) go=true;
      if(go) localStorage.setItem('codemap_tut_auto','1');
    }catch(e){}
    if(go) setTimeout(()=>{ try{ if(CM.Settings&&CM.Settings.startTutorial) CM.Settings.startTutorial('codemap'); }catch(e){} }, 1100);
  }

  Object.assign(A, {
    state, filters, init, onHover, THEME_PRESETS, saveSessionDebounced, restoreSessionPrompt, setMode,
    wireModes, selectEdge, handlers, useWorker, startWorkerSim, apply, seedUnplaced, select,
    applyImpact, toggleImpact, toggleCollapse, toggleLang, revealNode, focusNode, biggestInFolder, tick,
    showLoading, setLoadingText, setProgress, hideLoading, hideEmpty, resetProjectState, ingest, autoTuneView,
    countsInit, updateStatus, refreshProjectLabel, clearAll, loadFromJSON, boot, autoTutorial,
  });
})();
