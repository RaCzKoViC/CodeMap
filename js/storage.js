/* ===================== storage.js — snapshots, save/load, diff ===================== */
CM.Storage = (function(){
  const U = CM.util;
  const DB_NAME='codemap-db', STORE='snapshots', SESSION='session';
  let _db=null;

  function openDB(){
    return new Promise((resolve)=>{
      if(_db) return resolve(_db);
      if(!('indexedDB' in window)) return resolve(null);
      const req=indexedDB.open(DB_NAME,2);
      req.onupgradeneeded=()=>{ const db=req.result;
        if(!db.objectStoreNames.contains(STORE)){ const os=db.createObjectStore(STORE,{keyPath:'id'}); os.createIndex('project','projectKey',{unique:false}); }
        if(!db.objectStoreNames.contains(SESSION)){ db.createObjectStore(SESSION,{keyPath:'id'}); }
      };
      req.onsuccess=()=>{ _db=req.result; resolve(_db); };
      req.onerror=()=>resolve(null);
    });
  }
  function tx(mode){ return openDB().then(db=> db ? db.transaction(STORE,mode).objectStore(STORE) : null); }
  function sessTx(mode){ return openDB().then(db=> db ? db.transaction(SESSION,mode).objectStore(SESSION) : null); }

  // ---- auto-saved "current session" (one slot, restored on next visit) ----
  const SESS_LS='codemap-session';
  async function saveSession(mapJSON){
    const rec={id:'current', ts:Date.now(), map:mapJSON};
    try{ const os=await sessTx('readwrite'); if(os){ os.put(rec); return; } }catch(e){}
    try{ localStorage.setItem(SESS_LS, JSON.stringify(rec)); }catch(e){}   // fallback (may overflow on big maps)
  }
  async function loadSession(){
    try{ const os=await sessTx('readonly'); if(os){ return await new Promise(res=>{ const r=os.get('current'); r.onsuccess=()=>res(r.result||null); r.onerror=()=>res(null); }); } }catch(e){}
    try{ return JSON.parse(localStorage.getItem(SESS_LS)||'null'); }catch(e){ return null; }
  }
  async function clearSession(){
    try{ const os=await sessTx('readwrite'); if(os) os.delete('current'); }catch(e){}
    try{ localStorage.removeItem(SESS_LS); }catch(e){}
  }

  // localStorage fallback ------------------------------------------------
  const LS_KEY='codemap-snapshots';
  function lsAll(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'[]'); }catch(e){ return []; } }
  function lsSave(arr){ try{ localStorage.setItem(LS_KEY, JSON.stringify(arr)); }catch(e){ U.toast(CM.i18n.t('cs.noStorageSpace','Brak miejsca w pamięci przeglądarki.'),'error'); } }

  async function addSnapshot(graph, label){
    const sig=graph.signature();
    const snap={
      id: Date.now()+'-'+Math.floor(Math.random()*1e6),
      projectKey: graph.meta.source || graph.meta.name || 'projekt',
      ts: Date.now(),
      label: label || ('Migawka '+U.fmtDate(Date.now())),
      name: graph.meta.name, source: graph.meta.source||'',
      signature: sig,
    };
    const os=await tx('readwrite');
    if(os){ os.put(snap); } else { const arr=lsAll(); arr.push(snap); lsSave(arr); }
    return snap;
  }

  async function listSnapshots(projectKey){
    const os=await tx('readonly');
    if(!os){ return lsAll().filter(s=>!projectKey||s.projectKey===projectKey).sort((a,b)=>b.ts-a.ts); }
    return new Promise(res=>{
      const out=[]; const req=os.openCursor();
      req.onsuccess=()=>{ const c=req.result; if(c){ if(!projectKey||c.value.projectKey===projectKey) out.push(c.value); c.continue(); } else res(out.sort((a,b)=>b.ts-a.ts)); };
      req.onerror=()=>res([]);
    });
  }
  async function allSnapshots(){
    const os=await tx('readonly');
    if(!os) return lsAll().sort((a,b)=>b.ts-a.ts);
    return new Promise(res=>{ const out=[]; const req=os.openCursor();
      req.onsuccess=()=>{ const c=req.result; if(c){ out.push(c.value); c.continue(); } else res(out.sort((a,b)=>b.ts-a.ts)); };
      req.onerror=()=>res([]); });
  }
  async function deleteSnapshot(id){
    const os=await tx('readwrite');
    if(os){ os.delete(id); } else { lsSave(lsAll().filter(s=>s.id!==id)); }
  }
  async function importSnapshots(arr){
    for(const s of arr){ if(!s.id) s.id=Date.now()+'-'+Math.floor(Math.random()*1e6);
      const os=await tx('readwrite'); if(os) os.put(s); else { const a=lsAll(); a.push(s); lsSave(a); } }
  }

  // save / open full map -------------------------------------------------
  function saveMap(graph){
    const json=graph.toJSON();
    json.savedAt=Date.now();
    const safe=(graph.meta.name||'mapa').replace(/[^\w.-]+/g,'_');
    U.download(safe+'.codemap.json', JSON.stringify(json));
  }
  function openMap(file){
    return new Promise((res,rej)=>{
      const fr=new FileReader();
      fr.onload=()=>{ try{ const obj=JSON.parse(fr.result); res(obj); }catch(e){ rej(new Error(CM.i18n.t('cs.invalidMapFile','Nieprawidłowy plik mapy.'))); } };
      fr.onerror=()=>rej(new Error(CM.i18n.t('cs.fileReadError','Błąd odczytu pliku.')));
      fr.readAsText(file);
    });
  }

  // apply diff onto current graph (marks node.diff) ----------------------
  function applyDiffToGraph(graph, diff){
    for(const n of graph.nodes.values()) delete n.diff;
    const mark=(arr,kind)=>{ for(const f of arr){ const n=graph.nodes.get(f.path); if(n) n.diff=kind; } };
    mark(diff.added,'added'); mark(diff.modified,'modified');
    // removed files don't exist in current graph; create ghost nodes
    for(const f of diff.removed){
      if(graph.nodes.has(f.path)) continue;
      const A=CM.Analysis, parent=graph.ensureFolder(A.dirname(f.path));
      const info=CM.languages.lookup(A.basename(f.path));
      const n={id:f.path,type:'file',name:A.basename(f.path),path:f.path,parent:parent.id,depth:parent.depth+1,
               lang:info.key,langInfo:info,size:f.size,metrics:{lines:f.lines},importsIn:[],importsOut:[],deps:[],
               x:0,y:0,vx:0,vy:0,r:6,diff:'removed',ghost:true};
      graph.nodes.set(f.path,n); parent.children.push(f.path);
      graph.edges.push({id:'g'+graph.edges.length,source:parent.id,target:f.path,type:'contains'});
    }
    graph.computeAggregates();
  }

  return {addSnapshot, listSnapshots, allSnapshots, deleteSnapshot, importSnapshots,
          saveMap, openMap, applyDiffToGraph, saveSession, loadSession, clearSession};
})();
