/* ===================== compare.js — porównywanie schematów i historia ===================== */
// Grupy schematów na jednej mapie (tagBaseGroup/mergeGraph/addCompareSource/clearCompare/relayoutGroups),
// cykle zależności (toggleCycles), historia migawek i diff (openHistory/doCompare), hotspoty i Inspect.
// Dopisuje się do CM.App (A).
(function(){
  const A=CM.App;
  const U=CM.util, $=U.$, I=CM.i18n;
  const Graph=CM.Graph.Graph, Layouts=CM.Layouts, Loaders=CM.Loaders, Storage=CM.Storage, UI=CM.UI;
  const state=A.state, filters=A.filters, handlers=A.handlers;   // pola stałe kontekstu (nigdy nie podmieniane)

  // lay each loaded schema out independently with the chosen layout, then line them up side-by-side
  function relayoutGroups(){
    let cursorX=0;
    for(const grp of state.groups){
      const sub=state.vis.nodes.filter(n=>(n.gid||'base')===grp.gid);
      if(!sub.length) continue;
      const ids=new Set(sub.map(n=>n.id));
      const subEdges=state.vis.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
      const res=Layouts.apply(state.layout, A.graph, {nodes:sub, edges:subEdges}, {spacing:state.spacing});
      if(res.sim){ let i=0; while(res.sim.running && i++<220) res.sim.tick(); }   // settle animated layouts synchronously
      const b=graphBounds(sub); const dx=cursorX-b.minX, dy=-((b.minY+b.maxY)/2);
      for(const n of sub){ n.x+=dx; n.y+=dy; n._placed=true; }
      cursorX += (b.maxX-b.minX) + Math.max(360,(b.maxX-b.minX)*0.1);
    }
    state.sim=null;
  }

  async function openHistory(){
    A.openModal('modal-history');
    const key=A.graph.meta.source||A.graph.meta.name;
    const snaps=await Storage.listSnapshots(state.counts.nodes? key : undefined);
    UI.renderHistory(snaps.length?snaps:await Storage.allSnapshots(), A.graph, handlers);
  }
  function doCompare(a,b){
    const diff=CM.Graph.diffSignatures(a.signature, b.signature);
    state.lastDiff=diff;
    A.closeModal($('#modal-history'));
    UI.renderDiff(diff, a, b);
    A.openModal('modal-diff');
  }

  // ---------------- multi-schema comparison ----------------
  const GROUP_COLORS=['#22d3ee','#fb7185','#34d399','#f59e0b','#a78bfa','#38bdf8'];
  function graphBounds(iter){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const n of iter){ if(n.id==='__root__'||!isFinite(n.x)) continue; const r=n.r||8;
      minX=Math.min(minX,n.x-r); maxX=Math.max(maxX,n.x+r); minY=Math.min(minY,n.y-r); maxY=Math.max(maxY,n.y+r); }
    if(!isFinite(minX)) return {minX:0,maxX:0,minY:0,maxY:0};
    return {minX,maxX,minY,maxY};
  }
  function tagBaseGroup(){
    if(state.groups.length) return;
    for(const n of A.graph.nodes.values()) if(n.gid==null) n.gid='base';
    state.groups.push({gid:'base', name:A.graph.meta.name||I.t('ca.schema1','schemat 1'), color:GROUP_COLORS[0], owner:A.graph.meta&&A.graph.meta.owner});
  }
  function mergeGraph(obj){
    if(!obj || obj.format!=='codemap'){ U.toast(I.t('ca.notCodemapFile','To nie jest plik mapy CodeMap.'),'error'); return; }
    if(state.counts.nodes===0){ A.loadFromJSON(obj); return; }
    mergeGraphInstance(Graph.fromJSON(obj), obj.meta&&obj.meta.name);
  }
  function mergeGraphInstance(g2, name){
    if(state.counts.nodes===0){ A.loadFromJSON(g2.toJSON()); return; }
    tagBaseGroup();
    const gid='g'+(++state.gidSeq);
    const color=GROUP_COLORS[state.groups.length%GROUP_COLORS.length];
    const pref=(id)=>gid+':'+id;
    for(const n of g2.nodes.values()){
      const c=Object.assign({}, n);
      c.id=pref(n.id); c.parent=n.parent!=null?pref(n.parent):null;
      c.children=(n.children||[]).map(pref);
      c.x=(n.x||0); c.y=(n.y||0); c.vx=0; c.vy=0; c.gid=gid; c._placed=false;
      c.importsIn=[]; c.importsOut=[];
      A.graph.nodes.set(c.id, c);
    }
    // merge language stats so left-panel tools cover ALL loaded schemas
    for(const [k,s] of g2.langStats){
      if(!A.graph.langStats.has(k)) A.graph.langStats.set(k, {key:k, info:s.info, count:0, bytes:0, lines:0, on:true});
      const d=A.graph.langStats.get(k); d.count+=s.count; d.bytes+=s.bytes||0; d.lines+=s.lines||0;
    }
    for(const e of g2.edges){
      const sid=pref(e.source), tid=pref(e.target);
      if(!A.graph.nodes.has(sid)||!A.graph.nodes.has(tid)) continue;
      A.graph.edges.push({id:gid+'e'+A.graph.edges.length, source:sid, target:tid, type:e.type});
      // recompute import degrees for the merged schema (was left at 0 → context menu / hotspots / details
      // showed "zależności wychodzące (0)" for every merged node). Only its OWN new edges, no double count.
      if(e.type==='import'||e.type==='reference'){ const s=A.graph.nodes.get(sid), t=A.graph.nodes.get(tid); s.importsOut.push(tid); t.importsIn.push(sid); }
    }
    const gname=name||g2.meta.name||(I.t('ca.schemaN','schemat ')+(state.groups.length+1));
    state.groups.push({gid, name:gname, color, owner:g2.meta&&g2.meta.owner});
    A.renderer.setGroups(state.groups);
    A.countsInit();
    // the new schema adopts the SAME layout as the one already on the map, lined up beside it
    state.layout=state.displayLayout||'force';
    A.apply({relayout:true, refit:true});
    U.toast(I.t('ca.schemaAddedPre','Dodano schemat „')+gname+I.t('ca.schemaAddedMid','" w układzie „')+state.layout+I.t('ca.schemaAddedPost','". Przeciągnij jego etykietę, aby go przesunąć.'),'success',5200);
  }
  // build a standalone graph from a source (files/GitHub) and merge it for comparison
  async function addCompareSource(factory, status){
    if(state.counts.nodes===0){ U.toast(I.t('ca.loadMainFirst','Najpierw wczytaj główny projekt.'),'error'); return; }
    const gen=++A._ingestGen;   // additive merge, but Cancel / a newer load must still abort it (no resetProjectState — that would wipe the base)
    A.showLoading(status);
    try{
      const {files, meta}=await factory(A.setProgress, A.setLoadingText);
      if(gen!==A._ingestGen) return;
      if(!files||!files.length){ U.toast(I.t('ca.noMatchingFiles','Nie znaleziono pasujących plików.'),'error'); A.hideLoading(); return; }
      A.setLoadingText(I.t('ca.buildingCompareSchema','Budowanie schematu porównawczego…')); await A.tick();
      if(gen!==A._ingestGen) return;
      const g2=new Graph(); g2.build(files, meta);
      const f2={folders:true,files:true,externals:false,contains:true,import:true,reference:true,langsOff:new Set()};
      const vis2=g2.getVisible(f2);
      Layouts.apply('force', g2, vis2, {spacing:state.spacing});
      mergeGraphInstance(g2, meta.name);
    }catch(e){ if(gen!==A._ingestGen) return; console.error(e); U.toast(I.t('ca.loadError','Błąd wczytywania: ')+e.message,'error',6000); }
    if(gen===A._ingestGen) A.hideLoading();
  }
  function clearCompare(){
    if(state.groups.length<=0){ U.toast(I.t('ca.noCompareSchemas','Brak schematów porównawczych.'),'error'); return; }
    for(const [id,n] of Array.from(A.graph.nodes.entries())){ if(n.gid && n.gid!=='base'){ A.graph.nodes.delete(id); } }
    A.graph.edges=A.graph.edges.filter(e=>{ return A.graph.nodes.has(e.source)&&A.graph.nodes.has(e.target); });
    for(const n of A.graph.nodes.values()) delete n.gid;
    state.groups=[]; A.renderer.setGroups([]);
    state.vis=A.graph.getVisible(filters); A.renderer.setData(A.graph, state.vis, null);
    A.countsInit(); A.updateStatus(); requestAnimationFrame(()=>A.renderer.fit());
    U.toast(I.t('ca.compareSchemasRemoved','Usunięto schematy porównawcze.'),'success');
  }
  function wireCompare(){
    $('#btn-compare-add').onclick=()=>{ if(state.counts.nodes===0){ U.toast(I.t('ca.loadMainFirst','Najpierw wczytaj główny projekt.'),'error'); return; } A.openModal('modal-compare'); };
    $('#cmp-gh-go').onclick=()=>{
      const url=$('#cmp-gh-url').value.trim(); if(!url){ U.toast(I.t('ca.enterRepoAddress','Podaj adres repozytorium.'),'error'); return; }
      A.closeModal($('#modal-compare'));
      addCompareSource((p,s)=>Loaders.fromRepoURL(url, {fetchContent:true}, p, s), I.t('ca.connectingToRepo','Łączenie z repozytorium…'));
    };
    $('#cmp-gh-url').onkeydown=(e)=>{ if(e.key==='Enter') $('#cmp-gh-go').click(); };
    $('#cmp-files').onclick=()=>$('#input-compare-files').click();
    $('#cmp-map').onclick=()=>$('#input-compare').click();
    $('#input-compare-files').onchange=(e)=>{ if(e.target.files.length){ A.closeModal($('#modal-compare'));
      const files=e.target.files; addCompareSource((p)=>Loaders.fromFileList(files,p),I.t('ca.readingFiles','Czytanie plików…')); } e.target.value=''; };
    $('#input-compare').onchange=async(e)=>{ const f=e.target.files[0]; if(!f)return; A.closeModal($('#modal-compare'));
      try{ const obj=await Storage.openMap(f); mergeGraph(obj); }catch(err){ U.toast(err.message,'error'); } e.target.value=''; };
    $('#btn-compare-clear').onclick=clearCompare;
    $('#btn-cycles').onclick=toggleCycles;
    $('#btn-hotspots').onclick=()=>{ if(state.counts.nodes===0){ U.toast(I.t('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; } UI.renderHotspots(A.graph, handlers); A.openModal('modal-hotspots'); };
    const bi=$('#btn-inspect'); if(bi) bi.onclick=()=>{ if(state.counts.nodes===0){ U.toast(I.t('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; } if(CM.Inspect) CM.Inspect.open(); };
  }
  // detect & highlight import dependency cycles (toggle)
  function toggleCycles(){
    if(state.cyclesOn){ state.cyclesOn=false; A.renderer.setCycles(null); U.toast(I.t('ca.cyclesOff','Wyłączono podświetlenie cykli.'),'',1600); return; }
    if(state.counts.nodes===0){ U.toast(I.t('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; }
    const res=A.graph.importCycles();
    if(!res.components.length){ U.toast(I.t('ca.noCycles','Nie wykryto cykli zależności. 🎉'),'success',3000); A.renderer.setCycles(null); return; }
    state.cyclesOn=true; A.renderer.setCycles(res.edges);
    const biggest=res.components.slice().sort((a,b)=>b.length-a.length)[0]||[];
    const sample=biggest.slice(0,4).map(id=>{ const n=A.graph.nodes.get(id); return n?n.name:id; }).join(' → ');
    U.toast(I.t('ca.cyclesFoundPre','Wykryto <b>')+res.components.length+I.t('ca.cyclesFoundMid','</b> cykli zależności (')+res.nodes.size+I.t('ca.cyclesFoundMid2',' plików). Największy: ')+sample+(biggest.length>4?' → …':'')+I.t('ca.cyclesFoundPost','. Kliknij ponownie, aby wyłączyć.'),'',7000);
  }

  Object.assign(A, {
    relayoutGroups, openHistory, doCompare, graphBounds, tagBaseGroup, mergeGraph, mergeGraphInstance, addCompareSource,
    clearCompare, wireCompare, toggleCycles,
  });
})();
