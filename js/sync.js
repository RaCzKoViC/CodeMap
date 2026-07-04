/* ===================== sync.js — synchronizacja z chmurą (kolejka offline, LWW) ===================== */
CM.Sync = (function(){
  const U=CM.util, I=CM.i18n;

  const STR={
  pl:{
    'synced':'Zsynchronizowano z chmurą.','syncFail':'Synchronizacja nieudana — spróbuję później.',
    'quota':'Brak miejsca w chmurze — usuń stare dane lub zmniejsz projekt.',
    'sessionRestored':'Pobrano sesję z chmury — odśwież stronę, aby ją wczytać.',
    'settingsPulled':'Pobrano ustawienia z chmury (część zmian po odświeżeniu).',
    'vaultNeedPass':'Ustaw hasło albumu, aby synchronizować go z chmurą.',
    'vaultPassDiffers':'Album w chmurze ma inne hasło niż lokalny — ujednolić hasła i spróbuj ponownie.',
    'vaultPushed':'Wysłano do chmury: ','vaultPulled':'Pobrano z chmury: ','vaultNothing':'Wszystko aktualne.',
  },
  en:{
    'synced':'Synced with the cloud.','syncFail':'Sync failed — will retry later.',
    'quota':'Cloud storage full — remove old data or shrink the project.',
    'sessionRestored':'Session fetched from the cloud — refresh the page to load it.',
    'settingsPulled':'Settings fetched from the cloud (some apply after refresh).',
    'vaultNeedPass':'Set an album password to sync it with the cloud.',
    'vaultPassDiffers':'The cloud album uses a different password than the local one — unify passwords and retry.',
    'vaultPushed':'Uploaded to cloud: ','vaultPulled':'Downloaded from cloud: ','vaultNothing':'Everything up to date.',
  }};
  function t(k){ const d=STR[I.getLang()]||STR.pl; return (k in d)?d[k]:(STR.pl[k]||k); }

  // Klucze ustawień synchronizowane z serwerem. ŚWIADOMIE pomijamy sekrety
  // (codemap_mistral_keys) i ustawienia specyficzne dla urządzenia (codemap_ollama_base, flagi instalacji).
  const SYNC_KEYS=[
    'codemap_lang','codemap_theme','codemap_accent','codemap_bg','codemap_tint',
    'codemap_trans_win','codemap_trans_menu','codemap_trans_blur',
    'codemap_nscale','codemap_fscale','codemap_spacing',
    'codemap_animate','codemap_particles','codemap_glow','codemap_grid','codemap_curved','codemap_hover_preview',
    'codemap_filters','codemap_metric','codemap_minmetric',
    'codemap_ai_provider','codemap_mistral_model','codemap_local_model','codemap_ollama_model',
  ];
  const LS_PULLED_TS='codemap_sync_settings_ts';
  const LS_AUTO='codemap_sync_auto';

  const loggedIn=()=> CM.Auth && CM.Auth.isLoggedIn();
  const isAuto=()=> localStorage.getItem(LS_AUTO)!=='0';
  const setAuto=(on)=>{ try{ localStorage.setItem(LS_AUTO, on?'1':'0'); }catch(e){} };

  // ---------------- kolejka operacji (IndexedDB, przeżywa restart) ----------------
  let _qdb=null;
  function qdb(){
    return new Promise((res)=>{
      if(_qdb) return res(_qdb);
      if(!('indexedDB' in window)) return res(null);
      const req=indexedDB.open('codemap-sync',1);
      req.onupgradeneeded=()=>{ const db=req.result;
        if(!db.objectStoreNames.contains('queue')) db.createObjectStore('queue',{keyPath:'qid',autoIncrement:true}); };
      req.onsuccess=()=>{ _qdb=req.result; res(_qdb); };
      req.onerror=()=>res(null);
    });
  }
  function qAll(){ return qdb().then(db=>new Promise(res=>{
    if(!db) return res([]);
    const out=[], r=db.transaction('queue','readonly').objectStore('queue').openCursor();
    r.onsuccess=()=>{ const c=r.result; if(c){ out.push(c.value); c.continue(); } else res(out); };
    r.onerror=()=>res([]);
  })); }
  function qAdd(op){ return qdb().then(db=>new Promise(res=>{
    if(!db) return res(false);
    const tx=db.transaction('queue','readwrite'); tx.objectStore('queue').add(op);
    tx.oncomplete=()=>res(true); tx.onerror=()=>res(false);
  })); }
  function qDel(qid){ return qdb().then(db=>new Promise(res=>{
    if(!db) return res(false);
    const tx=db.transaction('queue','readwrite'); tx.objectStore('queue').delete(qid);
    tx.oncomplete=()=>res(true); tx.onerror=()=>res(false);
  })); }

  async function enqueue(op){
    if(op.kind==='settings'||op.kind==='session'){       // te operacje czytają stan przy wysyłce — jedna w kolejce wystarczy
      const all=await qAll();
      if(all.some(o=>o.kind===op.kind)) return;
    }
    await qAdd(op);
    schedulePush();
  }

  // ---------------- hooki wywoływane przez resztę aplikacji ----------------
  function onSnapshot(snap, mapJSONString){
    if(!loggedIn()||!isAuto()) return;
    enqueue({kind:'snapshot', id:snap.id,
      meta:{projectKey:snap.projectKey, ts:snap.ts, label:snap.label, name:snap.name, source:snap.source, signature:snap.signature},
      blob:mapJSONString});
  }
  function onSnapshotDeleted(id){
    if(!loggedIn()||!isAuto()) return;
    enqueue({kind:'snapdel', id});
  }
  const onSessionSaved=U.debounce(()=>{ if(loggedIn()&&isAuto()) enqueue({kind:'session'}); }, 15000);
  const onSettingsChanged=U.debounce(()=>{ if(loggedIn()&&isAuto()) enqueue({kind:'settings'}); }, 5000);

  // Wykrywanie zmian ustawień: jeden przechwyt localStorage.setItem zamiast edycji
  // każdego settera w app.js/settings.js — łapie też przyszłe miejsca zapisu.
  let applyingPull=false;   // zapisy z pull() nie mają wracać na serwer jako "zmiana"
  try{
    const rawSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){
      rawSet.apply(this,arguments);
      try{ if(!applyingPull && this===window.localStorage && SYNC_KEYS.includes(k)) onSettingsChanged(); }catch(e){}
    };
  }catch(e){}

  // ---------------- push (drenaż kolejki) ----------------
  let pushing=false;
  const schedulePush=U.debounce(()=>{ push().catch(()=>{}); }, 800);

  function collectSettings(){
    const out={};
    for(const k of SYNC_KEYS){ const v=localStorage.getItem(k); if(v!=null) out[k]=v; }
    return out;
  }

  async function pushOp(op){
    const api=CM.Auth.api;
    if(op.kind==='settings'){
      const ts=Date.now();
      await api('/api/settings',{method:'PUT',json:{json:JSON.stringify(collectSettings()), updatedAt:ts}});
      try{ applyingPull=true; localStorage.setItem(LS_PULLED_TS, String(ts)); }finally{ applyingPull=false; }
    }
    else if(op.kind==='session'){
      const rec=await CM.Storage.loadSession();
      if(!rec||!rec.map) return;
      await api('/api/session?ts='+(rec.ts||Date.now()),{method:'PUT',
        body:JSON.stringify(rec.map), headers:{'Content-Type':'application/octet-stream'}});
    }
    else if(op.kind==='snapshot'){
      const m=op.meta||{};
      const qs=new URLSearchParams({projectKey:m.projectKey||'', ts:String(m.ts||''), label:m.label||'', name:m.name||'', source:m.source||''});
      await api('/api/snapshots/'+encodeURIComponent(op.id)+'?'+qs,{method:'PUT',
        body:op.blob||'{}', headers:{'Content-Type':'application/octet-stream'}});
      if(m.signature!=null){
        await api('/api/snapshots/'+encodeURIComponent(op.id)+'/meta',{method:'PUT',json:{signature:JSON.stringify(m.signature)}});
      }
    }
    else if(op.kind==='snapdel'){
      try{ await api('/api/snapshots/'+encodeURIComponent(op.id),{method:'DELETE'}); }
      catch(e){ if(e.status!==404) throw e; }
    }
  }

  async function push(){
    if(pushing||!loggedIn()||!navigator.onLine) return;
    pushing=true;
    try{
      const ops=await qAll();
      for(const op of ops.sort((a,b)=>a.qid-b.qid)){
        try{ await pushOp(op); await qDel(op.qid); }
        catch(e){
          if(e.status===409){ await qDel(op.qid); continue; }             // serwer ma nowsze — pull to wyrówna
          if(e.status===507||e.status===413){ await qDel(op.qid); U.toast(t('quota'),'error'); continue; }
          throw e;                                                        // sieć/5xx — przerwij, spróbujemy później
        }
      }
    } finally { pushing=false; }
  }

  // ---------------- pull ----------------
  async function pull(){
    if(!loggedIn()||!navigator.onLine) return;
    const api=CM.Auth.api;
    const man=await api('/api/sync/manifest');

    // ustawienia (LWW — bierzemy serwerowe, jeśli nowsze niż ostatnio pobrane/wysłane)
    if(man.settings && man.settings.updatedAt > Number(localStorage.getItem(LS_PULLED_TS)||0)){
      const s=await api('/api/settings');
      if(s && s.json){
        try{
          applyingPull=true;
          const obj=JSON.parse(s.json);
          for(const k of SYNC_KEYS) if(k in obj) localStorage.setItem(k, obj[k]);
          localStorage.setItem(LS_PULLED_TS, String(s.updatedAt));
          U.toast(t('settingsPulled'));
        }catch(e){}
        finally{ applyingPull=false; }
      }
    } else if(man.settings){
      localStorage.setItem(LS_PULLED_TS, String(man.settings.updatedAt));
    }

    // migawki: uzupełnij lokalną historię o brakujące metadane
    if(man.snapshots && man.snapshots.length && CM.Storage.allSnapshots){
      const local=new Set((await CM.Storage.allSnapshots()).map(s=>s.id));
      const missing=man.snapshots.filter(s=>!local.has(s.id))
        .map(s=>{
          let sig=s.signature;
          if(typeof sig==='string'){ try{ sig=JSON.parse(sig); }catch(e){ sig=null; } }
          return {id:s.id, projectKey:s.projectKey, ts:s.ts, label:s.label, name:s.name, source:s.source, signature:sig};
        });
      if(missing.length) await CM.Storage.importSnapshots(missing);
    }

    // sesja: tylko na „świeżym" urządzeniu (lokalnie pusto) — nie nadpisujemy trwającej pracy
    if(man.session){
      const localSess=await CM.Storage.loadSession();
      if(!localSess||!localSess.map){
        try{
          const res=await api('/api/session');
          const map=await res.json();
          await CM.Storage.saveSession(map);
          U.toast(t('sessionRestored'),'success',6000);
        }catch(e){}
      }
    }

    try{ CM.Auth.refresh(); }catch(e){}
  }

  let syncing=false;
  async function syncNow(){
    if(syncing) return;
    syncing=true;
    try{ await push(); await pull(); U.toast(t('synced'),'success'); }
    catch(e){ U.toast(t('syncFail'),'error'); }
    finally{ syncing=false; }
  }

  function onLogin(){ if(isAuto()) syncNow().catch(()=>{}); }

  // ---------------- Sejf / Ulubione (szyfrogram ↔ chmura) ----------------
  async function pushAlbum(album){
    const D=CM.Drive&&CM.Drive._cloud, api=CM.Auth.api;
    if(!D) return;
    if(D.state(album)==='plain'){ U.toast(t('vaultNeedPass'),'error'); return; }
    const meta=await D.getMeta(album);
    if(!meta||meta.enc!==true){ U.toast(t('vaultNeedPass'),'error'); return; }
    const remote=await api('/api/vault/'+album);
    if(remote.meta){
      try{ const rm=JSON.parse(remote.meta.json);
        if(rm.salt && meta.salt && rm.salt!==meta.salt){ U.toast(t('vaultPassDiffers'),'error'); return; } }catch(e){}
    }
    await api('/api/vault/'+album+'/meta',{method:'PUT',json:{json:JSON.stringify(meta), updatedAt:Date.now()}});
    const remoteByName=new Map((remote.files||[]).map(f=>[f.name,f]));
    const local=await D.listRaw(album);
    let sent=0;
    for(const f of local){
      const r=remoteByName.get(f.name);
      if(r && r.size===f.size && r.mtime>=(f.mtime||0)) continue;
      const bytes=await D.readRaw(album, f.name);
      if(!bytes) continue;
      await api('/api/vault/'+album+'/files/'+encodeURIComponent(f.name)+'?mtime='+(f.mtime||Date.now()),
        {method:'PUT', body:bytes, headers:{'Content-Type':'application/octet-stream'}});
      sent++;
    }
    U.toast(sent? t('vaultPushed')+sent : t('vaultNothing'),'success');
    try{ CM.Auth.refresh(); }catch(e){}
  }

  async function pullAlbum(album){
    const D=CM.Drive&&CM.Drive._cloud, api=CM.Auth.api;
    if(!D) return;
    const remote=await api('/api/vault/'+album);
    if(!remote.meta){ U.toast(t('vaultNothing')); return; }
    const localMeta=await D.getMeta(album);
    let rMeta=null; try{ rMeta=JSON.parse(remote.meta.json); }catch(e){}
    if(localMeta && localMeta.enc && rMeta && rMeta.salt && localMeta.salt && rMeta.salt!==localMeta.salt){
      U.toast(t('vaultPassDiffers'),'error'); return;
    }
    if(!localMeta || !localMeta.enc){
      if(D.state(album)==='plain' && (await D.listRaw(album)).length){ U.toast(t('vaultPassDiffers'),'error'); return; }
      await D.writeMeta(album, rMeta);                    // świeże urządzenie przejmuje meta (salt/verifier) z chmury
    }
    const localByName=new Map((await D.listRaw(album)).map(f=>[f.name,f]));
    let got=0;
    for(const f of (remote.files||[])){
      const l=localByName.get(f.name);
      if(l && l.size===f.size) continue;
      const res=await api('/api/vault/'+album+'/files/'+encodeURIComponent(f.name));
      const buf=new Uint8Array(await res.arrayBuffer());
      await D.writeRaw(album, f.name, buf, f.mtime);
      got++;
    }
    U.toast(got? t('vaultPulled')+got : t('vaultNothing'),'success');
    try{ if(CM.Drive.refreshAlbum) CM.Drive.refreshAlbum(album); }catch(e){}
  }

  // ---------------- start ----------------
  window.addEventListener('online', ()=>{ if(loggedIn()&&isAuto()) push().catch(()=>{}); });
  document.addEventListener('cm-auth-change', (e)=>{ if(e.detail&&e.detail.user&&isAuto()) setTimeout(()=>syncNow().catch(()=>{}),500); });

  return { onSnapshot, onSnapshotDeleted, onSessionSaved, onSettingsChanged,
    push, pull, syncNow, onLogin, isAuto, setAuto, pushAlbum, pullAlbum };
})();
