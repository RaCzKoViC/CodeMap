/* ===================== drive.js — Sejf (OPFS, szyfrowany) + Dysk (File System Access API) =====================
   CM.Drive — dedykowany magazyn plików dla CodeMap i MindMap.
   • Sejf  = OPFS (Origin Private File System): prywatny, trwały, bez promptów; opcjonalnie szyfrowany hasłem
             (Web Crypto: AES-GCM 256 + PBKDF2-SHA256).
   • Dysk  = File System Access API (showDirectoryPicker): prawdziwy folder użytkownika, uchwyt trwały w IndexedDB.
   Obsługuje DOWOLNY format na poziomie bajtów. Podgląd: kod (highlight), obrazy (object URL), tekst, reszta = pobierz. */
CM.Drive = (function(){
  const U=CM.util, el=U.el, ic=CM.icons, I=CM.i18n;

  /* ---------------- i18n (samodzielne STR, wzorzec jak settings.js) ---------------- */
  const STR={
  pl:{
    'title':'Dysk i Sejf',
    'tab.vault':'Sejf','tab.disk':'Dysk',
    'vault.head':'Sejf (wewnętrzny, szyfrowany)',
    'vault.desc':'Prywatna pamięć aplikacji (OPFS) — niewidoczna z zewnątrz, działa bez pytań o folder. Możesz ją zabezpieczyć hasłem (AES-GCM 256 + PBKDF2). Hasła nie da się odzyskać — zapamiętaj je.',
    'vault.unavailable':'Sejf niedostępny — ta przeglądarka nie obsługuje prywatnego systemu plików (OPFS). Użyj zakładki „Dysk”.',
    'vault.status.plain':'Sejf otwarty (bez hasła)','vault.status.locked':'Sejf zablokowany 🔒','vault.status.unlocked':'Sejf odblokowany 🔓',
    'vault.setpass':'Ustaw hasło','vault.changepass':'Zmień hasło','vault.removepass':'Usuń hasło','vault.lock':'Zablokuj','vault.unlock':'Odblokuj',
    'vault.pass':'Hasło','vault.pass2':'Powtórz hasło','vault.passOld':'Obecne hasło','vault.passNew':'Nowe hasło',
    'vault.passMismatch':'Hasła nie są identyczne.','vault.passEmpty':'Podaj hasło.','vault.passShort':'Hasło musi mieć co najmniej 8 znaków.',
    'vault.passWrong':'Nieprawidłowe hasło.','vault.encrypting':'Szyfruję sejf…','vault.decrypting':'Odszyfrowuję sejf…',
    'vault.passSet':'Hasło ustawione — sejf zaszyfrowany.','vault.passRemoved':'Hasło usunięte — sejf nie jest już szyfrowany.','vault.passChanged':'Hasło zmienione.',
    'vault.unlocked.msg':'Sejf odblokowany.','vault.locked.msg':'Sejf zablokowany.',
    'vault.lockedHint':'Wpisz hasło, aby zobaczyć i zapisywać pliki w sejfie.',
    'cloud.head':'Chmura','cloud.push':'Wyślij do chmury','cloud.pull':'Pobierz z chmury',
    'cloud.needLogin':'Zaloguj się (przycisk Konto), aby synchronizować z chmurą.',
    'cloud.needPass':'Chmura przyjmuje wyłącznie zaszyfrowane albumy — najpierw ustaw hasło.',
    'disk.head':'Dysk (folder na Twoim urządzeniu)',
    'disk.desc':'Zamontuj prawdziwy folder przez File System Access API. Po jednej zgodzie CodeMap czyta i zapisuje pliki bezpośrednio na dysku. Folder jest zapamiętywany — przy powrocie wystarczy jedno potwierdzenie.',
    'disk.unavailable':'Dysk niedostępny — ta przeglądarka nie obsługuje File System Access API. Działa w Chrome, Edge, Brave, Opera. Sejf (zakładka obok) działa wszędzie.',
    'disk.mount':'Zamontuj folder…','disk.remount':'Zmień folder…','disk.unmount':'Odłącz','disk.reconnect':'Połącz ponownie',
    'disk.none':'Nie zamontowano żadnego folderu.','disk.mounted':'Zamontowano:','disk.needPerm':'Folder zapamiętany — kliknij „Połącz ponownie”, aby przyznać dostęp.',
    'disk.permDenied':'Brak zgody na dostęp do folderu.','disk.mountFail':'Nie udało się zamontować folderu.','disk.mounted.msg':'Folder zamontowany.',
    'common.save':'Zapisz tutaj bieżącą mapę','common.saveHint':'Zapisuje aktualną mapę (CodeMap lub MindMap) jako plik w tym miejscu.',
    'common.refresh':'Odśwież','common.empty':'Brak plików.','common.up':'⬆ wyżej','common.root':'(katalog główny)',
    'common.noMap':'Brak mapy do zapisania. Wczytaj projekt (CodeMap) lub utwórz mapę myśli (MindMap).',
    'common.saved':'Zapisano: ','common.saving':'Zapisuję…','common.loading':'Wczytuję…','common.loaded':'Wczytano: ','common.deleted':'Usunięto: ',
    'common.delConfirm':'Usunąć plik „{n}”? Tej operacji nie można cofnąć.','common.openFail':'Nie udało się otworzyć pliku.',
    'common.loadFail':'Nieprawidłowy plik mapy CodeMap/MindMap.','common.dir':'folder','common.bytes':'bajtów',
    'add.btn':'Dodaj pliki / zdjęcia','add.hint':'Wgraj dowolne pliki (zdjęcia, dokumenty, archiwa…) — albo przeciągnij je tutaj.',
    'add.adding':'Dodaję pliki…','add.added':'Dodano plików: {n}.','add.none':'Nie dodano żadnego pliku.','add.drop':'Upuść pliki, aby je dodać',
    'col.name':'Nazwa','col.size':'Rozmiar','act.open':'Otwórz / podgląd','act.load':'Wczytaj jako mapę','act.download':'Pobierz na urządzenie','act.del':'Usuń',
    'pv.title':'Podgląd','pv.image':'Obraz','pv.binary':'Plik binarny — brak podglądu. Użyj „Pobierz”.','pv.close':'Zamknij podgląd',
    'save.asCode':'Mapa CodeMap (.codemap.json)','save.asMind':'Mapa myśli (.mindmap.json)','save.choose':'Co zapisać?',
    'load.askCode':'Wczytać ten plik jako mapę CodeMap?','load.askMind':'Wczytać ten plik jako mapę myśli (MindMap)?',
    'kind.codemap':'CodeMap','kind.mindmap':'MindMap','kind.image':'obraz','kind.text':'tekst','kind.file':'plik',
    'tab.fav':'Ulubione',
    'fav.head':'Ulubione (osobny album, szyfrowany)',
    'fav.desc':'Zdjęcia oznaczone serduszkiem trafiają tu jako kopie. Album możesz zabezpieczyć WŁASNYM, osobnym hasłem — niezależnym od sejfu.',
    'fav.status.plain':'Album otwarty (bez hasła)','fav.status.locked':'Album zablokowany 🔒','fav.status.unlocked':'Album odblokowany 🔓',
    'fav.lockedHint':'Wpisz hasło albumu Ulubione, aby zobaczyć i dodawać zdjęcia.',
    'fav.empty':'Brak ulubionych. Kliknij serduszko na miniaturce zdjęcia w Sejfie.',
    'fav.added':'Dodano do Ulubionych ❤','fav.removed':'Usunięto z Ulubionych.','fav.askUnlock':'Podaj hasło albumu „Ulubione”',
    'fav.plainWarn':'Album „Ulubione” nie ma hasła — kopia tego zdjęcia zostanie zapisana BEZ szyfrowania. Kontynuować?',
    'vault.metaCorrupt':'Metadane sejfu są uszkodzone i nie udało się ich odzyskać z kopii zapasowej. Pliki nie zostały zmienione — nie zapisuj nic, dopóki nie wykonasz kopii danych.',
    'gal.photos':'Zdjęcia','gal.files':'Pozostałe pliki','gal.empty':'Brak zdjęć.','gal.privateNote':'Dane sejfu są prywatne (OPFS) — nie pojawiają się na Dysku, dopóki ich tam nie przeniesiesz.',
    'photo.prev':'Poprzednie','photo.next':'Następne','photo.fav':'Dodaj do ulubionych','photo.unfav':'Usuń z ulubionych',
    'photo.download':'Pobierz','photo.del':'Usuń','photo.move':'Przenieś na Dysk',
    'move.noDisk':'Najpierw zamontuj folder w zakładce „Dysk”.','move.confirm':'Przenieść „{n}” z sejfu na Dysk? Plik zostanie usunięty z sejfu.','move.done':'Przeniesiono na Dysk: ',
    'ask.cancel':'Anuluj','ask.ok':'OK',
  },
  en:{
    'title':'Drive & Vault',
    'tab.vault':'Vault','tab.disk':'Drive',
    'vault.head':'Vault (internal, encrypted)',
    'vault.desc':'Private app storage (OPFS) — invisible from outside, works with no folder prompts. You can protect it with a password (AES-GCM 256 + PBKDF2). The password cannot be recovered — remember it.',
    'vault.unavailable':'Vault unavailable — this browser has no private file system (OPFS). Use the “Drive” tab.',
    'vault.status.plain':'Vault open (no password)','vault.status.locked':'Vault locked 🔒','vault.status.unlocked':'Vault unlocked 🔓',
    'vault.setpass':'Set password','vault.changepass':'Change password','vault.removepass':'Remove password','vault.lock':'Lock','vault.unlock':'Unlock',
    'vault.pass':'Password','vault.pass2':'Repeat password','vault.passOld':'Current password','vault.passNew':'New password',
    'vault.passMismatch':'Passwords do not match.','vault.passEmpty':'Enter a password.','vault.passShort':'The password must be at least 8 characters long.',
    'vault.passWrong':'Wrong password.','vault.encrypting':'Encrypting the vault…','vault.decrypting':'Decrypting the vault…',
    'vault.passSet':'Password set — vault encrypted.','vault.passRemoved':'Password removed — vault is no longer encrypted.','vault.passChanged':'Password changed.',
    'vault.unlocked.msg':'Vault unlocked.','vault.locked.msg':'Vault locked.',
    'vault.lockedHint':'Enter the password to view and save files in the vault.',
    'cloud.head':'Cloud','cloud.push':'Upload to cloud','cloud.pull':'Download from cloud',
    'cloud.needLogin':'Log in (Account button) to sync with the cloud.',
    'cloud.needPass':'The cloud accepts only encrypted albums — set a password first.',
    'disk.head':'Drive (a folder on your device)',
    'disk.desc':'Mount a real folder via the File System Access API. After one grant, CodeMap reads and writes files straight to disk. The folder is remembered — one confirmation on return.',
    'disk.unavailable':'Drive unavailable — this browser does not support the File System Access API. Works in Chrome, Edge, Brave, Opera. The Vault (next tab) works everywhere.',
    'disk.mount':'Mount folder…','disk.remount':'Change folder…','disk.unmount':'Detach','disk.reconnect':'Reconnect',
    'disk.none':'No folder mounted.','disk.mounted':'Mounted:','disk.needPerm':'Folder remembered — click “Reconnect” to grant access.',
    'disk.permDenied':'Permission to access the folder was denied.','disk.mountFail':'Could not mount the folder.','disk.mounted.msg':'Folder mounted.',
    'common.save':'Save current map here','common.saveHint':'Saves the current map (CodeMap or MindMap) as a file in this location.',
    'common.refresh':'Refresh','common.empty':'No files.','common.up':'⬆ up','common.root':'(root)',
    'common.noMap':'No map to save. Load a project (CodeMap) or create a mind map (MindMap).',
    'common.saved':'Saved: ','common.saving':'Saving…','common.loading':'Loading…','common.loaded':'Loaded: ','common.deleted':'Deleted: ',
    'common.delConfirm':'Delete file “{n}”? This cannot be undone.','common.openFail':'Could not open the file.',
    'common.loadFail':'Not a valid CodeMap/MindMap file.','common.dir':'folder','common.bytes':'bytes',
    'add.btn':'Add files / photos','add.hint':'Upload any files (photos, documents, archives…) — or drag them in here.',
    'add.adding':'Adding files…','add.added':'Files added: {n}.','add.none':'No files were added.','add.drop':'Drop files to add them',
    'col.name':'Name','col.size':'Size','act.open':'Open / preview','act.load':'Load as map','act.download':'Download to device','act.del':'Delete',
    'pv.title':'Preview','pv.image':'Image','pv.binary':'Binary file — no preview. Use “Download”.','pv.close':'Close preview',
    'save.asCode':'CodeMap map (.codemap.json)','save.asMind':'Mind map (.mindmap.json)','save.choose':'What to save?',
    'load.askCode':'Load this file as a CodeMap map?','load.askMind':'Load this file as a mind map (MindMap)?',
    'kind.codemap':'CodeMap','kind.mindmap':'MindMap','kind.image':'image','kind.text':'text','kind.file':'file',
    'tab.fav':'Favorites',
    'fav.head':'Favorites (separate, encrypted album)',
    'fav.desc':'Photos you heart are copied here. You can protect this album with its OWN separate password — independent of the vault.',
    'fav.status.plain':'Album open (no password)','fav.status.locked':'Album locked 🔒','fav.status.unlocked':'Album unlocked 🔓',
    'fav.lockedHint':'Enter the Favorites album password to view and add photos.',
    'fav.empty':'No favorites yet. Tap the heart on a photo thumbnail in the Vault.',
    'fav.added':'Added to Favorites ❤','fav.removed':'Removed from Favorites.','fav.askUnlock':'Enter the “Favorites” album password',
    'fav.plainWarn':'The “Favorites” album has no password — this photo’s copy will be stored UNENCRYPTED. Continue?',
    'vault.metaCorrupt':'Vault metadata is corrupted and could not be recovered from backup. Your files were not modified — do not save anything until you back up your data.',
    'gal.photos':'Photos','gal.files':'Other files','gal.empty':'No photos.','gal.privateNote':'Vault data is private (OPFS) — it never appears on the Drive until you move it there.',
    'photo.prev':'Previous','photo.next':'Next','photo.fav':'Add to favorites','photo.unfav':'Remove from favorites',
    'photo.download':'Download','photo.del':'Delete','photo.move':'Move to Drive',
    'move.noDisk':'Mount a folder first in the “Drive” tab.','move.confirm':'Move “{n}” from the vault to the Drive? It will be removed from the vault.','move.done':'Moved to Drive: ',
    'ask.cancel':'Cancel','ask.ok':'OK',
  }};
  function t(k,sub){ const l=I.getLang(); const d=STR[l]||STR.pl; let s=(d&&k in d)?d[k]:(STR.pl[k]||k); if(sub) for(const p in sub) s=s.replace('{'+p+'}',sub[p]); return s; }

  /* ---------------- feature detection ---------------- */
  const hasFSA  = (typeof window.showDirectoryPicker==='function');
  const hasOPFS = !!(navigator.storage && navigator.storage.getDirectory);
  const hasCrypto = !!(window.crypto && crypto.subtle);

  /* ---------------- tiny IndexedDB kv (persists the FSA directory handle) ---------------- */
  const DB='codemap-drive', KV='kv';
  function idb(){ return new Promise(res=>{ if(!('indexedDB' in window)) return res(null);
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>{ if(!r.result.objectStoreNames.contains(KV)) r.result.createObjectStore(KV); };
    r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); }); }
  async function kvGet(key){ const db=await idb(); if(!db) return null; return new Promise(res=>{ const q=db.transaction(KV,'readonly').objectStore(KV).get(key); q.onsuccess=()=>res(q.result==null?null:q.result); q.onerror=()=>res(null); }); }
  async function kvSet(key,val){ const db=await idb(); if(!db) return; return new Promise(res=>{ const tx=db.transaction(KV,'readwrite'); tx.objectStore(KV).put(val,key); tx.oncomplete=()=>res(); tx.onerror=()=>res(); }); }
  async function kvDel(key){ const db=await idb(); if(!db) return; return new Promise(res=>{ const tx=db.transaction(KV,'readwrite'); tx.objectStore(KV).delete(key); tx.oncomplete=()=>res(); tx.onerror=()=>res(); }); }

  /* ---------------- crypto helpers (AES-GCM 256 + PBKDF2-SHA256) ---------------- */
  const TE=new TextEncoder(), TD=new TextDecoder();
  const VERIFY='CODEMAP_VAULT_OK_v1';
  function b64(buf){ const b=new Uint8Array(buf); let s=''; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); }
  function unb64(str){ const s=atob(str); const b=new Uint8Array(s.length); for(let i=0;i<s.length;i++) b[i]=s.charCodeAt(i); return b; }
  // Liczba iteracji PBKDF2 dla NOWYCH kluczy (OWASP 2023: ≥600k dla SHA-256). Album trzyma swoją
  // wartość w meta.kdf — stare albumy (bez pola) odszyfrowują się z 210k, a przy zmianie hasła
  // przechodzą na bieżącą. Ma to znaczenie, bo szyfrogram synchronizowanego albumu leży na serwerze.
  const PBKDF2_ITER=600000;
  const LEGACY_ITER=210000;
  const kdfIter=(m)=>(m&&m.kdf&&Number.isFinite(+m.kdf.iter)&&+m.kdf.iter>0)?+m.kdf.iter:LEGACY_ITER;
  async function deriveKey(password, salt, iterations=PBKDF2_ITER){
    const base=await crypto.subtle.importKey('raw', TE.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations, hash:'SHA-256'},
      base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function encBytes(key, bytes){
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, bytes);
    const out=new Uint8Array(12+ct.byteLength); out.set(iv,0); out.set(new Uint8Array(ct),12); return out;
  }
  async function decBytes(key, blob){
    const b=(blob instanceof Uint8Array)?blob:new Uint8Array(blob);
    const iv=b.slice(0,12), ct=b.slice(12);
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct));
  }

  /* ---------------- OPFS albums (generic: main vault + separate encrypted "Favorites" album) ---------------- */
  // Each album = its own OPFS subdirectory + its own meta file + its own session key.
  // "vault" = main Sejf;  "fav" = the separately-password-encrypted "Ulubione" album.
  const ALB={ vault:{dir:'vault', metaFile:'codemap-vault.meta.json'}, fav:{dir:'vault-fav', metaFile:'codemap-fav.meta.json'} };
  const albKey={vault:null, fav:null};     // CryptoKey when that album is unlocked
  const albMeta={vault:null, fav:null};    // {enc, salt?, verifier?}

  async function opfsRoot(){ return navigator.storage.getDirectory(); }
  async function albDir(a){ const root=await opfsRoot(); return root.getDirectoryHandle(ALB[a].dir,{create:true}); }
  const TMPSUF='.cmtmp~';                       // in-transaction temp-file suffix (hidden from listings)
  const txnName=(a)=>ALB[a].metaFile+'.txn';    // per-album journal, lives next to the meta file
  const albTxnChecked={vault:false, fav:false};
  async function readRootJSON(name){ const root=await opfsRoot(); const fh=await root.getFileHandle(name); return JSON.parse(await (await fh.getFile()).text()); }
  async function writeRootFile(name, text){ const root=await opfsRoot(); const fh=await root.getFileHandle(name,{create:true}); const w=await fh.createWritable(); await w.write(new Blob([text])); await w.close(); }
  async function removeRootFile(name){ try{ const root=await opfsRoot(); await root.removeEntry(name); }catch(e){} }
  const validMeta=(m)=>!!m && typeof m==='object' && typeof m.enc==='boolean' && (!m.enc || (typeof m.salt==='string' && typeof m.verifier==='string'));
  async function albLoadMeta(a){
    if(albMeta[a]) return albMeta[a];
    await albRecoverTxn(a);                     // finish/roll back any interrupted re-encryption first
    let main, missing=false;
    try{ main=await readRootJSON(ALB[a].metaFile); }
    catch(e){ if(e && e.name==='NotFoundError') missing=true; main=null; }
    if(main && validMeta(main)){ albMeta[a]=main; return main; }
    if(missing){
      // no meta at all = fresh album (plain); honour a leftover backup from an interrupted flip
      try{ const bak=await readRootJSON(ALB[a].metaFile+'.bak'); if(validMeta(bak)){ albMeta[a]=bak; return bak; } }catch(e){}
      albMeta[a]={enc:false}; return albMeta[a];
    }
    // meta EXISTS but is unreadable/invalid → try the backup; NEVER pretend the album is plain
    // (that would overwrite ciphertext as if it were plaintext and destroy the files)
    try{ const bak=await readRootJSON(ALB[a].metaFile+'.bak'); if(validMeta(bak)){ albMeta[a]=bak; return bak; } }catch(e){}
    throw new Error(t('vault.metaCorrupt'));
  }
  async function albSaveMeta(a,m){ albMeta[a]=m; await writeRootFile(ALB[a].metaFile, JSON.stringify(m)); }
  async function albList(a){
    const dir=await albDir(a); const out=[];
    for await(const [name,h] of dir.entries()){ if(h.kind!=='file' || name.endsWith(TMPSUF)) continue; const f=await h.getFile(); out.push({name, size:f.size, ts:f.lastModified}); }
    return out.sort((x,y)=>y.ts-x.ts);
  }
  async function albWrite(a, name, bytes){
    const m=await albLoadMeta(a); let data=bytes;
    if(m.enc){ if(!albKey[a]) throw new Error('locked'); data=await encBytes(albKey[a], bytes); }
    const dir=await albDir(a); const fh=await dir.getFileHandle(name,{create:true}); const w=await fh.createWritable(); await w.write(new Blob([data])); await w.close();
  }
  async function albRead(a, name){
    const m=await albLoadMeta(a); const dir=await albDir(a); const fh=await dir.getFileHandle(name);
    const buf=new Uint8Array(await (await fh.getFile()).arrayBuffer());
    if(m.enc){ if(!albKey[a]) throw new Error('locked'); return decBytes(albKey[a], buf); }
    return buf;
  }
  // surowe bajty (szyfrogram) — dla synchronizacji z chmurą; nie dotykają kluczy ani szyfrowania
  async function albReadRaw(a, name){
    const dir=await albDir(a); const fh=await dir.getFileHandle(name);
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
  }
  async function albWriteRaw(a, name, bytes){
    const dir=await albDir(a); const fh=await dir.getFileHandle(name,{create:true});
    const w=await fh.createWritable(); await w.write(new Blob([bytes])); await w.close();
  }
  async function albDelete(a, name){ const dir=await albDir(a); await dir.removeEntry(name); }
  async function albHas(a, name){ try{ const dir=await albDir(a); await dir.getFileHandle(name); return true; }catch(e){ return false; } }
  async function albState(a){ const m=await albLoadMeta(a); if(!m.enc) return 'plain'; return albKey[a]?'unlocked':'locked'; }
  /* ---- transactional state change (set / remove / change password) ----
     Interruption-safe order: (1) journal with the target meta → (2) every file written in its NEW
     state under a temp name (originals untouched) → (3) previous meta kept as .bak, meta flipped
     (single-file OPFS writes are atomic) → (4) temps promoted over originals → (5) journal removed.
     Recovery on next open (albRecoverTxn): meta equals the journal target → finish promoting;
     otherwise the flip never happened → roll the temps back. Either way no file is half-converted. */
  async function albTransactState(a, newMeta, files){
    const dir=await albDir(a);
    const oldMeta=await albLoadMeta(a);
    await writeRootFile(txnName(a), JSON.stringify({target:newMeta, files:files.map(f=>f.name)}));
    for(const f of files){ const fh=await dir.getFileHandle(f.name+TMPSUF,{create:true}); const w=await fh.createWritable(); await w.write(new Blob([f.data])); await w.close(); }
    await writeRootFile(ALB[a].metaFile+'.bak', JSON.stringify(oldMeta));
    await albSaveMeta(a, newMeta);
    for(const f of files){ await promoteTmp(dir, f.name); }
    await removeRootFile(txnName(a));
    // Transaction fully committed — the .bak (previous, now-stale meta) must NOT linger: if the main
    // meta were ever lost, albLoadMeta's missing-branch would honour this stale backup and could treat
    // an encrypted album as plain (ciphertext read as data / plaintext written into a "vault").
    await removeRootFile(ALB[a].metaFile+'.bak');
  }
  async function promoteTmp(dir, name){
    const th=await dir.getFileHandle(name+TMPSUF);
    const bytes=new Uint8Array(await (await th.getFile()).arrayBuffer());
    const fh=await dir.getFileHandle(name,{create:true}); const w=await fh.createWritable(); await w.write(new Blob([bytes])); await w.close();
    await dir.removeEntry(name+TMPSUF);
  }
  async function albRecoverTxn(a){
    if(albTxnChecked[a]) return; albTxnChecked[a]=true;
    let txn=null; try{ txn=await readRootJSON(txnName(a)); }catch(e){}
    const dir=await albDir(a);
    if(!txn || !Array.isArray(txn.files)){
      // no (or unreadable) journal → drop any orphan temps from an even earlier interruption
      const orphans=[]; for await(const [name,h] of dir.entries()){ if(h.kind==='file' && name.endsWith(TMPSUF)) orphans.push(name); }
      for(const n of orphans){ try{ await dir.removeEntry(n); }catch(e){} }
      if(txn!==null || orphans.length) await removeRootFile(txnName(a));
      return;
    }
    let cur=null; try{ cur=await readRootJSON(ALB[a].metaFile); }catch(e){}
    const flipped=!!cur && JSON.stringify(cur)===JSON.stringify(txn.target);
    for(const name of txn.files){
      let has=true; try{ await dir.getFileHandle(name+TMPSUF); }catch(e){ has=false; }
      if(!has) continue;
      try{ if(flipped) await promoteTmp(dir, name); else await dir.removeEntry(name+TMPSUF); }catch(e){}
    }
    await removeRootFile(txnName(a));
  }
  // set password on a plain album OR re-key an unlocked one — same flow: read (decrypts if needed)
  // into RAM, encrypt with the NEW key in RAM, commit transactionally. Plaintext never hits disk.
  async function albRekey(a, pw){
    const names=(await albList(a)).map(f=>f.name);
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const key=await deriveKey(pw, salt, PBKDF2_ITER);
    const verifier=await encBytes(key, TE.encode(VERIFY));
    const files=[];
    for(const n of names){ files.push({name:n, data:await encBytes(key, await albRead(a, n))}); }
    await albTransactState(a, {enc:true, salt:b64(salt), verifier:b64(verifier), kdf:{name:'pbkdf2', hash:'SHA-256', iter:PBKDF2_ITER}}, files);
    albKey[a]=key;
  }
  const albSetPassword=albRekey;
  const albChangePassword=albRekey;
  async function albUnlock(a, pw){
    const m=await albLoadMeta(a); if(!m.enc) return true;
    const key=await deriveKey(pw, unb64(m.salt), kdfIter(m));
    try{ const v=await decBytes(key, unb64(m.verifier)); if(TD.decode(v)!==VERIFY) throw 0; }
    catch(e){ throw new Error('wrong'); }
    albKey[a]=key; return true;
  }
  function albLock(a){ albKey[a]=null; }
  async function albRemovePassword(a){   // requires unlocked
    const names=(await albList(a)).map(f=>f.name);
    const files=[];
    for(const n of names){ files.push({name:n, data:await albRead(a, n)}); }   // decrypt into RAM
    await albTransactState(a, {enc:false}, files);
    albKey[a]=null;
  }

  // ---- main vault wrappers (preserve existing API/tests) ----
  const vaultListRaw=()=>albList('vault');
  const vaultWrite=(n,b)=>albWrite('vault',n,b);
  const vaultRead=(n)=>albRead('vault',n);
  const vaultDelete=(n)=>albDelete('vault',n);
  const vaultState=()=>albState('vault');
  const setPassword=(pw)=>albSetPassword('vault',pw);
  const unlock=(pw)=>albUnlock('vault',pw);
  const lock=()=>albLock('vault');
  const removePassword=()=>albRemovePassword('vault');
  const changePassword=(pw)=>albChangePassword('vault',pw);

  // ---- favorites (heart) — copy into the separately-encrypted "Ulubione" album ----
  const isFav=(name)=>albHas('fav', name);
  async function ensureFavWritable(){
    const st=await albState('fav');
    if(st==='plain' || st==='unlocked') return true;
    const pw=await askPassword(t('fav.askUnlock'));   // album locked → ask its own password
    if(pw==null) return false;
    try{ await albUnlock('fav', pw); return true; }catch(e){ U.toast(t('vault.passWrong'),'error'); return false; }
  }
  // toggle: returns true=favorited, false=unfavorited, null=cancelled
  async function toggleFav(sourceAlbum, name){
    if(await albHas('fav', name)){ await albDelete('fav', name); return false; }
    if(!await ensureFavWritable()) return null;
    // copying out of an encrypted album into a password-less Favorites stores the copy in the clear
    if((await albState(sourceAlbum))!=='plain' && (await albState('fav'))==='plain' && !confirm(t('fav.plainWarn'))) return null;
    const bytes=await albRead(sourceAlbum, name);   // decrypt from source
    await albWrite('fav', name, bytes);             // encrypt copy into Favorites
    return true;
  }
  // move a vault file onto the (already mounted) Disk, then delete it from the vault
  async function moveToDisk(album, name){
    if(!diskHandle || !diskGranted){ U.toast(t('move.noDisk'),'error'); return false; }
    if(!confirm(t('move.confirm',{n:name}))) return false;
    const bytes=await albRead(album, name);
    await diskWrite([], name, bytes);
    await albDelete(album, name);
    if(album!=='fav'){ try{ await albDelete('fav', name); }catch(e){} }   // tidy any favorite copy too
    U.toast(t('move.done')+name,'success');
    return true;
  }

  /* ---------------- FSA disk ---------------- */
  let diskHandle=null, diskGranted=false;
  async function restoreDisk(){ if(!hasFSA) return; try{ diskHandle=await kvGet('diskHandle'); }catch(e){ diskHandle=null; } }
  async function verifyPerm(handle, rw){
    if(!handle) return false; const opts={mode:rw?'readwrite':'read'};
    if((await handle.queryPermission(opts))==='granted') return true;
    if((await handle.requestPermission(opts))==='granted') return true;
    return false;
  }
  async function mountDisk(){
    const h=await window.showDirectoryPicker({mode:'readwrite', id:'codemap-drive'});
    diskHandle=h; diskGranted=true; await kvSet('diskHandle', h); return h;
  }
  async function reconnectDisk(){ if(!diskHandle) return false; diskGranted=await verifyPerm(diskHandle,true); return diskGranted; }
  async function unmountDisk(){ diskHandle=null; diskGranted=false; await kvDel('diskHandle'); }
  async function diskNavigate(pathArr){ let d=diskHandle; for(const seg of (pathArr||[])) d=await d.getDirectoryHandle(seg); return d; }
  async function diskList(pathArr){
    const d=await diskNavigate(pathArr); const dirs=[], files=[];
    for await(const [name,h] of d.entries()){
      if(h.kind==='directory') dirs.push({name, kind:'dir'});
      else { let size=0; try{ size=(await h.getFile()).size; }catch(e){} files.push({name, kind:'file', size}); }
    }
    dirs.sort((a,b)=>a.name.localeCompare(b.name)); files.sort((a,b)=>a.name.localeCompare(b.name));
    return dirs.concat(files);
  }
  async function diskRead(pathArr, name){ const d=await diskNavigate(pathArr); const fh=await d.getFileHandle(name); return new Uint8Array(await (await fh.getFile()).arrayBuffer()); }
  async function diskWrite(pathArr, name, bytes){ const d=await diskNavigate(pathArr); const fh=await d.getFileHandle(name,{create:true}); const w=await fh.createWritable(); await w.write(new Blob([bytes])); await w.close(); }
  async function diskDelete(pathArr, name){ const d=await diskNavigate(pathArr); await d.removeEntry(name); }

  /* ---------------- current-map bridge (CodeMap / MindMap) ---------------- */
  function mindActive(){ return CM.MindMap && CM.MindMap.isActive && CM.MindMap.isActive(); }
  function currentMap(){
    if(mindActive() && CM.MindMap.nodeCount() > 0){
      return {kind:'mindmap', name:(CM.MindMap.mapName()||'mapa-mysli'), ext:'.mindmap.json', obj:CM.MindMap.exportState()};
    }
    const cj=window.CMApp && CMApp.mapJSON && CMApp.mapJSON();
    if(cj){ return {kind:'codemap', name:(CMApp.mapName()||'mapa'), ext:'.codemap.json', obj:cj}; }
    return null;
  }
  function safeName(s){ return String(s||'mapa').replace(/[^\w.\-]+/g,'_').slice(0,80); }
  function detectMapKind(name, obj){
    if(/\.mindmap\.json$/i.test(name)) return 'mindmap';
    if(/\.codemap\.json$/i.test(name)) return 'codemap';
    if(obj && Array.isArray(obj.nodes) && Array.isArray(obj.edges) && obj.seq!=null) return 'mindmap';
    if(obj && (obj.meta || obj.nodes)) return 'codemap';
    return null;
  }
  async function loadMapObj(name, obj){
    const kind=detectMapKind(name,obj); if(!kind) throw new Error(t('common.loadFail'));
    if(kind==='mindmap'){
      const sw=document.querySelector('.mode-btn[data-mode="mindmap"]'); if(sw && !mindActive()) sw.click();
      await new Promise(r=>setTimeout(r,60)); CM.MindMap.importState(obj);
    } else {
      const sw=document.querySelector('.mode-btn[data-mode="codemap"]'); if(sw && mindActive()) sw.click();
      await new Promise(r=>setTimeout(r,30)); CMApp.loadFromJSON(obj);
    }
    return kind;
  }

  /* image / text detection for preview */
  const IMG_EXT=/\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i;
  const TEXT_EXT=/\.(txt|md|markdown|json|js|mjs|cjs|ts|tsx|jsx|css|scss|less|html?|xml|yml|yaml|toml|ini|csv|py|rb|go|rs|java|c|h|cpp|cs|php|sh|sql|log|gitignore|env|svg)$/i;
  function fileKindOf(name){ if(IMG_EXT.test(name)) return 'image'; if(/\.(codemap|mindmap)\.json$/i.test(name)) return /mindmap/i.test(name)?'mindmap':'codemap'; if(TEXT_EXT.test(name)) return 'text'; return 'file'; }

  /* ====================================================================== */
  /* ============================== UI ==================================== */
  /* ====================================================================== */
  let overlay=null, curTab='vault', diskPath=[], builtLang=null;

  function open(tab){ build(); if(tab) curTab=tab; showTab(curTab); overlay.classList.remove('hidden'); document.body.classList.add('drive-open'); }
  function close(){ if(overlay) overlay.classList.add('hidden'); document.body.classList.remove('drive-open'); closePhoto(); revokeThumbs(); }

  function build(){
    const lang=I.getLang();
    if(!overlay){
      overlay=el('div',{id:'drive-overlay',class:'hidden'});
      document.body.appendChild(overlay);
      overlay.addEventListener('mousedown',(e)=>{ if(e.target===overlay) close(); });
      window.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && overlay && !overlay.classList.contains('hidden')) close(); });
    }
    builtLang=lang; overlay.innerHTML='';
    const panel=el('div',{class:'set-panel drv-panel'});
    panel.appendChild(el('div',{class:'set-head'},
      el('span',{class:'set-ic',html:ic.svg('package',{size:18})}),
      el('h2',{text:t('title')}),
      el('span',{class:'tb-spacer'}),
      el('button',{class:'set-x',title:I.t('common.close','Zamknij'),html:ic.svg('x',{size:18}),onclick:close})));
    const bodyWrap=el('div',{class:'set-wrap'});
    const nav=el('div',{class:'set-nav drv-nav'});
    [['vault','lock'],['fav','heart'],['disk','folder']].forEach(([key,icon])=>{
      const iconHtml = icon==='heart' ? heartIcon(true,16) : ic.svg(icon,{size:16});
      nav.appendChild(el('button',{class:'set-tab'+(key===curTab?' active':'')+(key==='fav'?' drv-tab-fav':''),'data-tab':key,
        html:iconHtml+'<span>'+t('tab.'+key)+'</span>',onclick:()=>showTab(key)}));
    });
    const content=el('div',{class:'set-content drv-content'});
    bodyWrap.appendChild(nav); bodyWrap.appendChild(content);
    panel.appendChild(bodyWrap); overlay.appendChild(panel); overlay._content=content;
  }
  function showTab(key){ curTab=key; if(!overlay) return;
    overlay.querySelectorAll('.set-tab').forEach(b=>b.classList.toggle('active', b.getAttribute('data-tab')===key));
    const c=overlay._content; if(!c) return; c.innerHTML='';
    const fn = key==='disk'?renderDisk : key==='fav'?renderFav : renderVault;
    fn(c); c.scrollTop=0;
  }
  function head(c, h, descKey){ c.appendChild(el('h3',{class:'set-h3',text:h})); if(descKey) c.appendChild(el('p',{class:'set-desc',text:t(descKey)})); }

  /* ---------------- VAULT / FAVORITES tabs (shared album renderer) ---------------- */
  function renderVault(c){ return renderAlbum(c, 'vault'); }
  function renderFav(c){ return renderAlbum(c, 'fav'); }

  async function renderAlbum(c, album){
    const fav=album==='fav';
    head(c, t(fav?'fav.head':'vault.head'), fav?'fav.desc':'vault.desc');
    if(!hasOPFS){ c.appendChild(el('p',{class:'drv-warn',text:t('vault.unavailable')})); return; }
    let st; try{ st=await albState(album); }
    catch(e){ c.appendChild(el('p',{class:'drv-warn',text:String(e.message||e)})); return; }
    const bar=el('div',{class:'drv-status drv-status-'+st});
    bar.appendChild(el('span',{class:'drv-status-dot'}));
    bar.appendChild(el('span',{text:t((fav?'fav.status.':'vault.status.')+st)}));
    c.appendChild(bar);

    c.appendChild(passwordControls(album, st));
    c.appendChild(cloudBar(album, st));
    if(st==='locked'){ c.appendChild(el('p',{class:'set-desc',text:t(fav?'fav.lockedHint':'vault.lockedHint')})); return; }

    c.appendChild(el('p',{class:'set-desc drv-privnote',text:t('gal.privateNote')}));
    if(!fav) c.appendChild(saveBar(async(kind)=>{ await saveCurrentTo('vault', kind); showTab('vault'); }));
    c.appendChild(uploadBar(album, ()=>showTab(album)));

    const galWrap=el('div',{class:'drv-albumbody'}); c.appendChild(galWrap);
    await fillAlbum(galWrap, album);
  }

  /* Synchronizacja albumu z chmurą — wyłącznie szyfrogram; wymaga hasła albumu i zalogowania. */
  function cloudBar(album, st){
    const box=el('div',{class:'drv-row drv-cloudbar'});
    const canSync=st!=='plain' && CM.Auth && CM.Auth.isLoggedIn() && CM.Sync;
    const mk=(label,fn)=>{ const b=el('button',{class:'drv-btn',html:ic.svg('cloud',{size:14})+' '+label,disabled:!canSync});
      b.onclick=async()=>{ b.disabled=true; try{ await fn(album); }finally{ b.disabled=false; showTab(album); } }; return b; };
    box.appendChild(el('span',{class:'muted small',text:t('cloud.head')+':'}));
    box.appendChild(mk(t('cloud.push'), (a)=>CM.Sync.pushAlbum(a)));
    box.appendChild(mk(t('cloud.pull'), (a)=>CM.Sync.pullAlbum(a)));
    if(!canSync){
      box.appendChild(el('span',{class:'muted small',
        text: (CM.Auth && CM.Auth.isLoggedIn()) ? t('cloud.needPass') : t('cloud.needLogin')}));
    }
    return box;
  }

  function passwordControls(album, st){
    const pwBox=el('div',{class:'drv-pwbox'}); const ref=()=>showTab(album);
    if(st==='plain' && hasCrypto){
      const p1=el('input',{type:'password',class:'drv-input',placeholder:t('vault.pass')});
      const p2=el('input',{type:'password',class:'drv-input',placeholder:t('vault.pass2')});
      const go=el('button',{class:'drv-btn drv-btn-primary',html:ic.svg('lock',{size:14})+' '+t('vault.setpass')});
      go.onclick=async()=>{ const a=p1.value,b=p2.value; if(!a){U.toast(t('vault.passEmpty'),'error');return;}
        if(a.length<8){U.toast(t('vault.passShort'),'error');return;} if(a!==b){U.toast(t('vault.passMismatch'),'error');return;}
        U.toast(t('vault.encrypting')); try{ await albSetPassword(album,a); U.toast(t('vault.passSet'),'success'); ref(); }catch(e){U.toast(String(e.message||e),'error');} };
      pwBox.appendChild(el('div',{class:'drv-row'},p1,p2,go));
    } else if(st==='locked'){
      const p=el('input',{type:'password',class:'drv-input',placeholder:t('vault.pass')});
      const go=el('button',{class:'drv-btn drv-btn-primary',html:ic.svg('unlock',{size:14})+' '+t('vault.unlock')});
      go.onclick=async()=>{ if(!p.value){U.toast(t('vault.passEmpty'),'error');return;}
        try{ await albUnlock(album,p.value); U.toast(t('vault.unlocked.msg'),'success'); ref(); }catch(e){U.toast(t('vault.passWrong'),'error');} };
      p.addEventListener('keydown',e=>{ if(e.key==='Enter') go.click(); });
      pwBox.appendChild(el('div',{class:'drv-row'},p,go));
    } else if(st==='unlocked'){
      const lockBtn=el('button',{class:'drv-btn',html:ic.svg('lock',{size:14})+' '+t('vault.lock'),onclick:()=>{ albLock(album); U.toast(t('vault.locked.msg')); ref(); }});
      const np=el('input',{type:'password',class:'drv-input',placeholder:t('vault.passNew')});
      const chg=el('button',{class:'drv-btn',html:ic.svg('refresh',{size:14})+' '+t('vault.changepass')});
      chg.onclick=async()=>{ if(!np.value||np.value.length<8){U.toast(t('vault.passShort'),'error');return;} U.toast(t('vault.encrypting')); try{ await albChangePassword(album,np.value); U.toast(t('vault.passChanged'),'success'); ref(); }catch(e){U.toast(String(e.message||e),'error');} };
      const rm=el('button',{class:'drv-btn drv-btn-danger',html:ic.svg('unlock',{size:14})+' '+t('vault.removepass')});
      rm.onclick=async()=>{ U.toast(t('vault.decrypting')); try{ await albRemovePassword(album); U.toast(t('vault.passRemoved'),'success'); ref(); }catch(e){U.toast(String(e.message||e),'error');} };
      pwBox.appendChild(el('div',{class:'drv-row'},lockBtn));
      pwBox.appendChild(el('div',{class:'drv-row'},np,chg,rm));
    }
    return pwBox;
  }

  async function fillAlbum(wrap, album){
    revokeThumbs(); wrap.innerHTML='';
    let files=[]; try{ files=await albList(album); }catch(e){}
    const reload=()=>fillAlbum(wrap, album);
    wrap.appendChild(el('div',{class:'drv-galbar'}, el('span',{class:'tb-spacer'}),
      el('button',{class:'drv-btn drv-btn-sm',html:ic.svg('refresh',{size:13})+' '+t('common.refresh'),onclick:reload})));
    if(!files.length){ wrap.appendChild(el('div',{class:'drv-empty',text:t(album==='fav'?'fav.empty':'common.empty')})); return; }
    const photos=files.filter(f=>fileKindOf(f.name)==='image');
    const others=files.filter(f=>fileKindOf(f.name)!=='image');
    if(photos.length){
      wrap.appendChild(el('div',{class:'drv-galhead',text:t('gal.photos')+' · '+photos.length}));
      const gal=el('div',{class:'drv-gallery'});
      for(let i=0;i<photos.length;i++) gal.appendChild(await thumbCell(album, photos, i, reload));
      wrap.appendChild(gal);
    }
    if(others.length){
      wrap.appendChild(el('div',{class:'drv-galhead',text:t('gal.files')+' · '+others.length}));
      const list=el('div',{class:'drv-list'});
      for(const f of others) list.appendChild(fileRow(f.name, f.size, fileKindOf(f.name), albRowHandlers(album, f, reload)));
      wrap.appendChild(list);
    }
  }

  async function thumbCell(album, photos, i, reload){
    const f=photos[i];
    const cell=el('div',{class:'drv-thumb',title:f.name});
    let url=''; try{ const bytes=await albRead(album, f.name); url=URL.createObjectURL(new Blob([bytes])); _thumbUrls.push(url); }catch(e){}
    cell.appendChild(el('img',{class:'drv-thumb-img',src:url,alt:f.name,loading:'lazy'}));
    cell.onclick=()=>openPhoto(album, photos, i, reload);
    const favd=await albHas('fav', f.name);
    const heart=el('button',{class:'drv-thumb-heart'+(favd?' on':''),title:t(favd?'photo.unfav':'photo.fav'),html:heartIcon(favd,16)});
    heart.onclick=async(e)=>{ e.stopPropagation(); const r=await toggleFav(album, f.name); if(r===null) return;
      U.toast(r?t('fav.added'):t('fav.removed'), r?'success':'');
      if(album==='fav') reload(); else { heart.classList.toggle('on',r); heart.innerHTML=heartIcon(r,16); heart.title=t(r?'photo.unfav':'photo.fav'); } };
    cell.appendChild(heart);
    cell.appendChild(el('span',{class:'drv-thumb-name',text:f.name}));
    return cell;
  }
  function albRowHandlers(album, f, reload){
    return {
      onLoad: async()=>{ try{ const bytes=await albRead(album,f.name); const obj=JSON.parse(TD.decode(bytes)); await loadMapObj(f.name,obj); close(); U.toast(t('common.loaded')+f.name,'success'); }catch(e){ U.toast(t('common.loadFail'),'error'); } },
      onOpen: async()=>{ try{ const bytes=await albRead(album,f.name); openPreview(f.name, bytes); }catch(e){ U.toast(t('common.openFail'),'error'); } },
      onDownload: async()=>{ try{ const bytes=await albRead(album,f.name); U.download(f.name, bytes, 'application/octet-stream'); }catch(e){ U.toast(t('common.openFail'),'error'); } },
      onDelete: async()=>{ if(!confirm(t('common.delConfirm',{n:f.name}))) return; await albDelete(album,f.name); U.toast(t('common.deleted')+f.name); reload(); },
    };
  }

  /* ---------------- DISK tab ---------------- */
  async function renderDisk(c){
    head(c, t('disk.head'), 'disk.desc');
    if(!hasFSA){ c.appendChild(el('p',{class:'drv-warn',text:t('disk.unavailable')})); return; }
    const mounted=!!diskHandle;
    const bar=el('div',{class:'drv-mountbar'});
    if(!mounted){
      bar.appendChild(el('span',{class:'drv-mount-none',text:t('disk.none')}));
      bar.appendChild(el('button',{class:'drv-btn drv-btn-primary',html:ic.svg('folder',{size:14})+' '+t('disk.mount'),
        onclick:async()=>{ try{ await mountDisk(); diskPath=[]; U.toast(t('disk.mounted.msg'),'success'); showTab('disk'); }catch(e){ if(e&&e.name==='AbortError') return; U.toast(t('disk.mountFail'),'error'); } }}));
    } else {
      bar.appendChild(el('span',{class:'drv-mount-name',html:ic.svg('folder',{size:14})+' <b>'+esc(diskHandle.name)+'</b>'}));
      if(!diskGranted){
        bar.appendChild(el('button',{class:'drv-btn drv-btn-primary',html:ic.svg('refresh',{size:14})+' '+t('disk.reconnect'),
          onclick:async()=>{ const ok=await reconnectDisk(); if(ok){ diskPath=[]; showTab('disk'); } else U.toast(t('disk.permDenied'),'error'); }}));
      }
      bar.appendChild(el('button',{class:'drv-btn',html:ic.svg('folder',{size:14})+' '+t('disk.remount'),
        onclick:async()=>{ try{ await mountDisk(); diskPath=[]; showTab('disk'); }catch(e){ if(e&&e.name==='AbortError')return; U.toast(t('disk.mountFail'),'error'); } }}));
      bar.appendChild(el('button',{class:'drv-btn drv-btn-danger',html:ic.svg('x',{size:14})+' '+t('disk.unmount'),
        onclick:async()=>{ await unmountDisk(); diskPath=[]; showTab('disk'); }}));
    }
    c.appendChild(bar);
    if(!mounted) return;
    if(!diskGranted){ c.appendChild(el('p',{class:'set-desc',text:t('disk.needPerm')})); return; }

    c.appendChild(saveBar(async(kind)=>{ await saveCurrentTo('disk', kind); showTab('disk'); }));
    c.appendChild(uploadBar('disk', ()=>showTab('disk')));

    // breadcrumb
    const crumbs=el('div',{class:'drv-crumbs'});
    const root=el('button',{class:'drv-crumb',text:diskHandle.name,onclick:()=>{ diskPath=[]; showTab('disk'); }});
    crumbs.appendChild(root);
    diskPath.forEach((seg,i)=>{ crumbs.appendChild(el('span',{class:'drv-crumb-sep',text:'/'}));
      crumbs.appendChild(el('button',{class:'drv-crumb',text:seg,onclick:()=>{ diskPath=diskPath.slice(0,i+1); showTab('disk'); }})); });
    c.appendChild(crumbs);

    const listWrap=el('div',{class:'drv-list'}); c.appendChild(listWrap);
    await fillDiskList(listWrap);
  }

  async function fillDiskList(wrap){
    wrap.innerHTML=''; let items=[];
    try{ items=await diskList(diskPath); }catch(e){ wrap.appendChild(el('div',{class:'drv-empty',text:t('disk.permDenied')})); return; }
    wrap.appendChild(listHeader(()=>fillDiskList(wrap)));
    if(diskPath.length){ const up=el('div',{class:'drv-frow drv-frow-up',onclick:()=>{ diskPath=diskPath.slice(0,-1); showTab('disk'); }});
      up.appendChild(el('span',{class:'drv-fic',html:ic.svg('open',{size:16})})); up.appendChild(el('span',{class:'drv-fname',text:t('common.up')})); wrap.appendChild(up); }
    if(!items.length){ wrap.appendChild(el('div',{class:'drv-empty',text:t('common.empty')})); return; }
    for(const it of items){
      if(it.kind==='dir'){ const r=el('div',{class:'drv-frow drv-frow-dir',onclick:()=>{ diskPath=diskPath.concat(it.name); showTab('disk'); }});
        r.appendChild(el('span',{class:'drv-fic',html:ic.svg('folder',{size:16})}));
        r.appendChild(el('span',{class:'drv-fname',text:it.name}));
        r.appendChild(el('span',{class:'drv-fmeta',text:t('common.dir')})); wrap.appendChild(r); continue; }
      wrap.appendChild(fileRow(it.name, it.size, fileKindOf(it.name), {
        onLoad: async()=>{ try{ const bytes=await diskRead(diskPath,it.name); const obj=JSON.parse(TD.decode(bytes)); await loadMapObj(it.name,obj); close(); U.toast(t('common.loaded')+it.name,'success'); }catch(e){ U.toast(t('common.loadFail'),'error'); } },
        onOpen: async()=>{ try{ const bytes=await diskRead(diskPath,it.name); openPreview(it.name, bytes); }catch(e){ U.toast(t('common.openFail'),'error'); } },
        onDownload: async()=>{ try{ const bytes=await diskRead(diskPath,it.name); U.download(it.name, bytes, 'application/octet-stream'); }catch(e){ U.toast(t('common.openFail'),'error'); } },
        onDelete: async()=>{ if(!confirm(t('common.delConfirm',{n:it.name}))) return; await diskDelete(diskPath,it.name); U.toast(t('common.deleted')+it.name); fillDiskList(wrap); },
      }));
    }
  }

  /* ---------------- shared UI bits ---------------- */
  function listHeader(onRefresh){
    const h=el('div',{class:'drv-lhead'});
    h.appendChild(el('span',{class:'drv-lh-name',text:t('col.name')}));
    h.appendChild(el('span',{class:'drv-lh-size',text:t('col.size')}));
    h.appendChild(el('button',{class:'drv-btn drv-btn-sm',html:ic.svg('refresh',{size:13})+' '+t('common.refresh'),onclick:onRefresh}));
    return h;
  }
  function fileRow(name, size, kind, h){
    const r=el('div',{class:'drv-frow'});
    const icMap={image:'image', codemap:'map', mindmap:'layers', text:'file', file:'file'};
    r.appendChild(el('span',{class:'drv-fic',html:ic.svg(icMap[kind]||'file',{size:16})}));
    const nm=el('span',{class:'drv-fname'}); nm.appendChild(el('b',{text:name}));
    if(kind==='codemap'||kind==='mindmap') nm.appendChild(el('span',{class:'drv-tag drv-tag-'+kind,text:t('kind.'+kind)}));
    r.appendChild(nm);
    r.appendChild(el('span',{class:'drv-fmeta',text:size==null?'':U.fmtBytes(size)}));
    const acts=el('span',{class:'drv-facts'});
    if(kind==='codemap'||kind==='mindmap') acts.appendChild(el('button',{class:'drv-iconbtn drv-iconbtn-go',title:t('act.load'),html:ic.svg('open',{size:14}),onclick:h.onLoad}));
    if(kind==='image'||kind==='text'||kind==='codemap'||kind==='mindmap') acts.appendChild(el('button',{class:'drv-iconbtn',title:t('act.open'),html:ic.svg('eye',{size:14}),onclick:h.onOpen}));
    acts.appendChild(el('button',{class:'drv-iconbtn',title:t('act.download'),html:ic.svg('download',{size:14}),onclick:h.onDownload}));
    acts.appendChild(el('button',{class:'drv-iconbtn drv-iconbtn-del',title:t('act.del'),html:ic.svg('trash',{size:14}),onclick:h.onDelete}));
    r.appendChild(acts);
    return r;
  }
  function saveBar(onSave){
    const box=el('div',{class:'drv-savebar'});
    box.appendChild(el('span',{class:'drv-save-lbl',html:ic.svg('save',{size:14})+' '+t('common.save')}));
    const m=currentMap();
    if(!m){ box.appendChild(el('span',{class:'drv-save-none',text:t('common.noMap')})); return box; }
    const btn=el('button',{class:'drv-btn drv-btn-primary',html:ic.svg('upload',{size:14})+' '+t(m.kind==='mindmap'?'save.asMind':'save.asCode')+' · '+esc(safeName(m.name))+m.ext,
      onclick:()=>onSave(m)});
    box.appendChild(btn);
    return box;
  }
  function safeFileName(s){ return String(s||'plik').replace(/[\\/:*?"<>|\x00-\x1f]+/g,'_').replace(/^\.+/,'_').slice(0,120) || 'plik'; }
  function uploadBar(where, onDone){
    const box=el('div',{class:'drv-uploadbar'});
    const inp=el('input',{type:'file',multiple:'',accept:'*/*',style:'display:none'});
    inp.onchange=async()=>{ const files=[...inp.files]; inp.value=''; if(files.length) await addFiles(where, files, onDone); };
    box.appendChild(el('span',{class:'drv-up-lbl',html:ic.svg('image',{size:14})+' '+t('add.hint')}));
    box.appendChild(el('button',{class:'drv-btn drv-btn-primary',html:ic.svg('upload',{size:14})+' '+t('add.btn'),onclick:()=>inp.click()}));
    box.appendChild(inp);
    const stop=e=>{ e.preventDefault(); e.stopPropagation(); };
    box.addEventListener('dragover',e=>{ stop(e); box.classList.add('drv-drag'); box.setAttribute('data-drop',t('add.drop')); });
    box.addEventListener('dragleave',e=>{ if(e.target===box){ box.classList.remove('drv-drag'); } });
    box.addEventListener('drop',async e=>{ stop(e); box.classList.remove('drv-drag'); const files=[...((e.dataTransfer&&e.dataTransfer.files)||[])]; if(files.length) await addFiles(where, files, onDone); });
    return box;
  }
  async function addFiles(where, files, onDone){
    if(where==='vault'||where==='fav'){
      let st; try{ st=await albState(where); }catch(e){ U.toast(String(e.message||e),'error'); return; }
      if(st==='locked'){ U.toast(t('vault.passWrong'),'error'); return; }
    }
    U.toast(t('add.adding')); let ok=0;
    for(const f of files){
      try{ const bytes=new Uint8Array(await f.arrayBuffer()); const name=safeFileName(f.name);
        if(where==='disk') await diskWrite(diskPath, name, bytes); else await albWrite(where, name, bytes); ok++; }
      catch(e){ U.toast(String(e.message||e),'error'); }
    }
    U.toast(ok?t('add.added',{n:ok}):t('add.none'), ok?'success':'error');
    if(onDone) onDone();
  }
  async function saveCurrentTo(where, m){
    if(!m) m=currentMap(); if(!m){ U.toast(t('common.noMap'),'error'); return; }
    const fname=safeName(m.name)+m.ext;
    const bytes=TE.encode(JSON.stringify(m.obj));
    U.toast(t('common.saving'));
    try{
      if(where==='vault') await vaultWrite(fname, bytes);
      else await diskWrite(diskPath, fname, bytes);
      U.toast(t('common.saved')+fname,'success');
    }catch(e){ U.toast(String(e.message||e),'error'); }
  }

  /* ---------------- preview ---------------- */
  let _pvUrl=null;
  function openPreview(name, bytes){
    closePreview();
    const kind=fileKindOf(name);
    const pv=el('div',{id:'drv-preview'});
    pv.addEventListener('mousedown',e=>{ if(e.target===pv) closePreview(); });
    const box=el('div',{class:'drv-pv-box'});
    box.appendChild(el('div',{class:'drv-pv-head'},
      el('span',{class:'drv-pv-title',text:name}),
      el('span',{class:'tb-spacer'}),
      el('button',{class:'set-x',title:t('pv.close'),html:ic.svg('x',{size:16}),onclick:closePreview})));
    const body=el('div',{class:'drv-pv-body'});
    if(kind==='image'){
      const blob=new Blob([bytes]); _pvUrl=URL.createObjectURL(blob);
      body.appendChild(el('img',{class:'drv-pv-img',src:_pvUrl,alt:name}));
    } else if(kind==='text'||kind==='codemap'||kind==='mindmap'){
      let txt=''; try{ txt=TD.decode(bytes); }catch(e){ txt=''; }
      const lang=(name.split('.').pop()||'').toLowerCase();
      const pre=el('pre',{class:'drv-pv-code hl'});
      try{ pre.innerHTML=(CM.UI&&CM.UI.highlight)?CM.UI.highlight(txt.slice(0,60000), lang):escTxt(txt.slice(0,60000)); }
      catch(e){ pre.textContent=txt.slice(0,60000); }
      body.appendChild(pre);
    } else {
      body.appendChild(el('div',{class:'drv-pv-bin',text:t('pv.binary')}));
    }
    box.appendChild(body); pv.appendChild(box); document.body.appendChild(pv);
    window.addEventListener('keydown', _pvEsc);
  }
  function _pvEsc(e){ if(e.key==='Escape') closePreview(); }
  function closePreview(){ const pv=document.getElementById('drv-preview'); if(pv) pv.remove(); if(_pvUrl){ URL.revokeObjectURL(_pvUrl); _pvUrl=null; } window.removeEventListener('keydown', _pvEsc); }

  function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function escTxt(s){ return esc(s); }

  /* ---------------- photo gallery: thumbnails, heart, fullscreen viewer ---------------- */
  let _thumbUrls=[];
  function revokeThumbs(){ for(const u of _thumbUrls){ try{ URL.revokeObjectURL(u); }catch(e){} } _thumbUrls=[]; }
  function heartIcon(filled, size){ size=size||16;
    return '<svg viewBox="0 0 24 24" width="'+size+'" height="'+size+'" '+(filled?'fill="currentColor" stroke="none"':'fill="none" stroke="currentColor" stroke-width="2"')
      +'><path d="M12 20.3l-1.45-1.32C5.4 14.24 2 11.16 2 7.5 2 4.92 4.02 3 6.5 3c1.74 0 3.41.81 4.5 2.09C12.09 3.81 13.76 3 15.5 3 17.98 3 20 4.92 20 7.5c0 3.66-3.4 6.74-8.55 11.49L12 20.3z"/></svg>'; }

  // small password prompt (used when adding to a locked Favorites album)
  function askPassword(title){
    return new Promise((resolve)=>{
      const ov=el('div',{id:'drv-ask'});
      const box=el('div',{class:'drv-ask-box'});
      box.appendChild(el('div',{class:'drv-ask-title',text:title}));
      const inp=el('input',{type:'password',class:'drv-input',placeholder:t('vault.pass')});
      box.appendChild(inp);
      const done=(val)=>{ ov.remove(); window.removeEventListener('keydown',onk); resolve(val); };
      const bar=el('div',{class:'drv-ask-bar'},
        el('button',{class:'drv-btn',text:t('ask.cancel'),onclick:()=>done(null)}),
        el('button',{class:'drv-btn drv-btn-primary',text:t('ask.ok'),onclick:()=>done(inp.value)}));
      box.appendChild(bar); ov.appendChild(box); document.body.appendChild(ov);
      ov.addEventListener('mousedown',e=>{ if(e.target===ov) done(null); });
      function onk(e){ e.stopPropagation(); if(e.key==='Escape') done(null); else if(e.key==='Enter') done(inp.value); }
      window.addEventListener('keydown',onk); setTimeout(()=>inp.focus(),30);
    });
  }

  // fullscreen photo viewer with prev/next, heart, download, move-to-disk, delete
  let _photoUrl=null, _photoKey=null;
  async function openPhoto(album, photos, index, reloadGrid){
    closePhoto();
    let i=index;
    const ov=el('div',{id:'drv-photo'}); document.body.appendChild(ov);
    ov.addEventListener('mousedown',e=>{ if(e.target===ov) closePhoto(); });
    async function show(){
      if(_photoUrl){ URL.revokeObjectURL(_photoUrl); _photoUrl=null; }
      ov.innerHTML=''; if(!photos.length){ closePhoto(); return; }
      if(i>=photos.length) i=photos.length-1; if(i<0) i=0;
      const f=photos[i];
      let url=''; try{ const bytes=await albRead(album, f.name); url=URL.createObjectURL(new Blob([bytes])); _photoUrl=url; }catch(e){}
      const top=el('div',{class:'drv-photo-top'});
      top.appendChild(el('span',{class:'drv-photo-name',text:f.name+'  ·  '+(i+1)+'/'+photos.length}));
      top.appendChild(el('span',{class:'tb-spacer'}));
      const favd=await albHas('fav', f.name);
      const heart=el('button',{class:'drv-photo-btn drv-photo-heart'+(favd?' on':''),title:t(favd?'photo.unfav':'photo.fav'),html:heartIcon(favd,20)});
      heart.onclick=async()=>{ const r=await toggleFav(album, f.name); if(r===null) return;
        U.toast(r?t('fav.added'):t('fav.removed'), r?'success':'');
        if(album==='fav' && r===false){ photos.splice(i,1); if(reloadGrid) reloadGrid(); show(); }
        else { heart.classList.toggle('on',r); heart.innerHTML=heartIcon(r,20); heart.title=t(r?'photo.unfav':'photo.fav'); } };
      top.appendChild(heart);
      top.appendChild(el('button',{class:'drv-photo-btn',title:t('photo.download'),html:ic.svg('download',{size:18}),
        onclick:async()=>{ try{ const bytes=await albRead(album,f.name); U.download(f.name,bytes,'application/octet-stream'); }catch(e){ U.toast(t('common.openFail'),'error'); } }}));
      top.appendChild(el('button',{class:'drv-photo-btn',title:t('photo.move'),html:ic.svg('upload',{size:18}),
        onclick:async()=>{ if(await moveToDisk(album, f.name)){ photos.splice(i,1); if(reloadGrid) reloadGrid(); show(); } }}));
      top.appendChild(el('button',{class:'drv-photo-btn drv-photo-del',title:t('photo.del'),html:ic.svg('trash',{size:18}),
        onclick:async()=>{ if(!confirm(t('common.delConfirm',{n:f.name}))) return; await albDelete(album,f.name); if(album!=='fav'){ try{ await albDelete('fav',f.name); }catch(e){} } U.toast(t('common.deleted')+f.name); photos.splice(i,1); if(reloadGrid) reloadGrid(); show(); }}));
      top.appendChild(el('button',{class:'drv-photo-btn',title:t('pv.close'),html:ic.svg('x',{size:18}),onclick:closePhoto}));
      ov.appendChild(top);
      const stage=el('div',{class:'drv-photo-stage'});
      stage.appendChild(el('img',{class:'drv-photo-img',src:url,alt:f.name}));
      ov.appendChild(stage);
      if(photos.length>1){
        ov.appendChild(el('button',{class:'drv-photo-nav drv-photo-prev',title:t('photo.prev'),html:'‹',onclick:()=>{ i=(i-1+photos.length)%photos.length; show(); }}));
        ov.appendChild(el('button',{class:'drv-photo-nav drv-photo-next',title:t('photo.next'),html:'›',onclick:()=>{ i=(i+1)%photos.length; show(); }}));
      }
    }
    await show();
    _photoKey=(e)=>{ if(e.key==='Escape') closePhoto(); else if(e.key==='ArrowLeft'&&photos.length>1){ i=(i-1+photos.length)%photos.length; show(); } else if(e.key==='ArrowRight'&&photos.length>1){ i=(i+1)%photos.length; show(); } };
    window.addEventListener('keydown', _photoKey);
  }
  function closePhoto(){ const ov=document.getElementById('drv-photo'); if(ov) ov.remove();
    if(_photoUrl){ URL.revokeObjectURL(_photoUrl); _photoUrl=null; } if(_photoKey){ window.removeEventListener('keydown',_photoKey); _photoKey=null; } }

  /* ---------------- wiring ---------------- */
  function wireButton(){
    const btn=document.getElementById('btn-drive');
    if(btn){ btn.onclick=()=>open(); refreshBtnTitle(); }
  }
  function refreshBtnTitle(){ const btn=document.getElementById('btn-drive'); if(btn) btn.title=t('title'); }

  I.onChange(()=>{ if(overlay){ build(); showTab(curTab); } refreshBtnTitle(); });

  // restore the persisted disk handle on load (permission re-requested on use)
  restoreDisk();

  return { open, close, wireButton,
    // headless/test API
    _addFiles:addFiles,
    _vault:{ state:vaultState, setPassword, unlock, lock, removePassword, write:vaultWrite, read:vaultRead, list:vaultListRaw, del:vaultDelete },
    _alb:{ state:albState, setPassword:albSetPassword, unlock:albUnlock, lock:albLock, removePassword:albRemovePassword,
           write:albWrite, read:albRead, list:albList, del:albDelete, has:albHas },
    // sync z chmurą: wyłącznie surowy szyfrogram + meta (salt/verifier); nigdy plaintext
    _cloud:{
      state:albState, listRaw:albList, readRaw:albReadRaw, writeRaw:albWriteRaw,
      getMeta:albLoadMeta,
      writeMeta:async(a,m)=>{ if(!validMeta(m)||m.enc!==true) throw new Error('meta'); albKey[a]=null; await albSaveMeta(a,m); },
    },
    refreshAlbum:(a)=>{ try{ if(overlay && !overlay.classList.contains('hidden') && curTab===a) showTab(a); }catch(e){} },
    _fav:{ is:isFav, toggle:toggleFav, move:moveToDisk },
    _disk:{ mount:mountDisk, reconnect:reconnectDisk, list:diskList, read:diskRead, write:diskWrite },
    _has:{ fsa:hasFSA, opfs:hasOPFS, crypto:hasCrypto } };
})();
