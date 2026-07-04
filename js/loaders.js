/* ===================== loaders.js — file / folder / GitHub ingestion ===================== */
CM.Loaders = (function(){
  const L = CM.languages, U = CM.util;
  const TEXT_SIZE_LIMIT = 600*1024;     // don't read text bigger than this
  const MAX_CONTENT_FILES = 4000;       // safety cap for in-browser analysis

  // ---------- decompressor (uses browser DecompressionStream): 'deflate-raw' | 'deflate'(zlib) | 'gzip' ----------
  async function _inflate(data, fmt){
    if(!window.DecompressionStream) throw new Error('DecompressionStream not supported');
    const ds=new DecompressionStream(fmt||'deflate-raw');
    const w=ds.writable.getWriter(), r=ds.readable.getReader();
    w.write(data); w.close();
    const chunks=[];
    try{ while(true){ const {done,value}=await r.read(); if(done)break; chunks.push(value); } }catch(e){ throw new Error('Decompression error: '+e.message); }
    let len=0; for(const c of chunks) len+=c.length;
    const out=new Uint8Array(len); let off=0;
    for(const c of chunks){ out.set(c,off); off+=c.length; }
    return out;
  }

  // ---------- Minimal ZIP parser ----------
  async function _parseZip(buf){
    const data=new Uint8Array(buf), dv=new DataView(buf);
    let eocd=-1;
    for(let i=data.length-22;i>=Math.max(0,data.length-65558);i--){
      if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; }
    }
    if(eocd===-1) throw new Error(CM.i18n.t('cl.errZip','Nieprawidłowy plik ZIP'));
    const n=dv.getUint16(eocd+10,true);
    const cdOff=dv.getUint32(eocd+16,true);
    const dec=new TextDecoder('utf-8'), decFallback=new TextDecoder('windows-1252');
    const files=[]; let pos=cdOff;
    for(let i=0;i<n;i++){
      if(pos+46>data.length) break;
      if(dv.getUint32(pos,true)!==0x02014b50) break;
      const flags=dv.getUint16(pos+8,true);
      const compression=dv.getUint16(pos+10,true);
      const compSz=dv.getUint32(pos+20,true);
      const uncompSz=dv.getUint32(pos+24,true);
      const fnLen=dv.getUint16(pos+28,true);
      const exLen=dv.getUint16(pos+30,true);
      const cmLen=dv.getUint16(pos+32,true);
      const lhOff=dv.getUint32(pos+42,true);
      const nameBytes=data.slice(pos+46,pos+46+fnLen);
      const name=(flags&0x800)?dec.decode(nameBytes):decFallback.decode(nameBytes);
      pos+=46+fnLen+exLen+cmLen;
      if(name.endsWith('/')||name.endsWith('\\')) continue;
      if(lhOff+30>data.length) continue;
      const lfnLen=dv.getUint16(lhOff+26,true);
      const lexLen=dv.getUint16(lhOff+28,true);
      const dataOff=lhOff+30+lfnLen+lexLen;
      if(dataOff+compSz>data.length) continue;
      const compressed=data.slice(dataOff,dataOff+compSz);
      let content=null;
      try{
        const raw=compression===0?compressed:compression===8?await _inflate(compressed):null;
        if(raw!=null){ try{ content=dec.decode(raw); }catch(e){ content=null; } }
      }catch(e){}
      files.push({name, size:uncompSz, content});
    }
    return files;
  }

  // ---------- TAR parser (uncompressed; gzip handled by _inflate first) ----------
  function _parseTar(bytes){
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const files=[]; const dec=new TextDecoder('utf-8'); let off=0, guard=0;
    const str=(a,s,n)=>{ let r=''; for(let i=s;i<s+n && a[i]; i++) r+=String.fromCharCode(a[i]); return r; };
    while(off+512<=data.length && guard++<200000){
      const name=str(data,off,100);
      if(!name){ off+=512; continue; }                         // padding / end blocks
      let sizeStr=''; for(let i=off+124;i<off+136;i++){ const c=data[i]; if(c>=48&&c<=55) sizeStr+=String.fromCharCode(c); }
      const size=parseInt(sizeStr||'0',8)||0;
      const type=String.fromCharCode(data[off+156]||0);
      let prefix=''; if(data[off+257]===0x75) prefix=str(data,off+345,155);  // ustar prefix
      const full=(prefix?prefix+'/':'')+name;
      const dataStart=off+512;
      if((type==='0'||type==='\0'||type==='')&&!full.endsWith('/')){
        const fileBytes=data.subarray(dataStart, dataStart+size);
        const info=L.lookup(full); let content=null;
        if(info.text && size<=TEXT_SIZE_LIMIT){ try{ content=dec.decode(fileBytes); }catch(e){} }
        files.push({name:full, size, content});
      }
      off=dataStart + Math.ceil(size/512)*512;
    }
    return files;
  }

  // ---------- archive expansion (zip / tar / tar.gz|tgz / gz) ----------
  const RE_ARCHIVE=/\.(zip|tar\.gz|tgz|tar|gz)$/i;
  const RE_PDF=/\.pdf$/i;
  const RE_UNSUPPORTED=/\.(rar|7z|7zip|bz2|xz|lzma|lz|cab|iso|arj|ace|zst|zstd)$/i;
  async function _expandArchive(file){
    const name=file.name.toLowerCase(); const buf=await file.arrayBuffer();
    if(name.endsWith('.zip')) return {entries:await _parseZip(buf), base:file.name.replace(/\.zip$/i,''), flat:false};
    if(name.endsWith('.tgz')||name.endsWith('.tar.gz')){ const raw=await _inflate(new Uint8Array(buf),'gzip'); return {entries:_parseTar(raw), base:file.name.replace(/\.(tgz|tar\.gz)$/i,''), flat:false}; }
    if(name.endsWith('.tar')) return {entries:_parseTar(new Uint8Array(buf)), base:file.name.replace(/\.tar$/i,''), flat:false};
    if(name.endsWith('.gz')){ const raw=await _inflate(new Uint8Array(buf),'gzip'); const inner=file.name.replace(/\.gz$/i,'');
      const info=L.lookup(inner); let content=null; if(info.text&&raw.length<=TEXT_SIZE_LIMIT){ try{ content=new TextDecoder('utf-8').decode(raw); }catch(e){} }
      return {entries:[{name:inner,size:raw.length,content}], base:inner, flat:true}; }
    throw new Error('unsupported archive');
  }

  // ---------- PDF structure extraction (outline -> tree; page list fallback) ----------
  function _latin1(bytes){ let s=''; for(let i=0;i<bytes.length;i+=8192) s+=String.fromCharCode.apply(null, bytes.subarray(i,i+8192)); return s; }
  function _pdfUtf16(s){ if(s.charCodeAt(0)===0xFE&&s.charCodeAt(1)===0xFF){ let o=''; for(let i=2;i+1<s.length;i+=2) o+=String.fromCharCode((s.charCodeAt(i)<<8)|s.charCodeAt(i+1)); return o; } return s; }
  function _pdfDecodeStr(raw){
    raw=raw.replace(/^\s+/,'');
    if(raw[0]==='('){ let s='',depth=0;
      for(let i=1;i<raw.length;i++){ const c=raw[i];
        if(c==='\\'){ const nx=raw[i+1]; if(nx===undefined)break;
          if(nx==='('||nx===')'||nx==='\\'){ s+=nx; i++; }
          else if(nx>='0'&&nx<='7'){ let o=nx; i++; for(let k=0;k<2&&raw[i+1]>='0'&&raw[i+1]<='7';k++) o+=raw[++i]; s+=String.fromCharCode(parseInt(o,8)); }
          else if(nx==='n'){ s+='\n'; i++; } else if(nx==='r'){ s+='\r'; i++; } else if(nx==='t'){ s+='\t'; i++; } else { s+=nx; i++; } }
        else if(c==='('){ depth++; s+=c; } else if(c===')'){ if(depth===0) break; depth--; s+=c; } else s+=c; }
      return _pdfUtf16(s);
    }
    if(raw[0]==='<'){ const end=raw.indexOf('>'); if(end<0) return ''; const hex=raw.slice(1,end).replace(/\s+/g,'');
      let s=''; for(let i=0;i+1<hex.length;i+=2) s+=String.fromCharCode(parseInt(hex.substr(i,2),16)); return _pdfUtf16(s); }
    return '';
  }
  const _cleanTitle=(t)=>(t||'').replace(/[\/\\]/g,'∕').replace(/\s+/g,' ').trim();
  function _pdfRef(s){ const m=/^\s*(\d+)\s+\d+\s+R/.exec(s||''); return m?+m[1]:null; }
  function _pdfVal(body, key){ const i=(body||'').indexOf('/'+key); if(i<0) return null; return body.slice(i+key.length+1); }
  function _pdfOutline(objs){
    let catalog=null; for(const [,b] of objs){ if(/\/Type\s*\/Catalog/.test(b)){ catalog=b; break; } }
    if(!catalog) return null;
    const oRef=_pdfRef(_pdfVal(catalog,'Outlines')); if(oRef==null) return null;
    const outlines=objs.get(oRef); if(!outlines) return null;
    const first=_pdfRef(_pdfVal(outlines,'First')); if(first==null) return null;
    const paths=[]; const guard={c:0};
    const walk=(ref, parent)=>{
      let cur=ref, n=0;
      while(cur!=null && n++<8000 && guard.c++<40000){
        const b=objs.get(cur); if(!b) break;
        const title=_cleanTitle(_pdfDecodeStr(_pdfVal(b,'Title')||''))||CM.i18n.t('cl.pdfUntitled','(bez tytułu)');
        const path=parent?parent+'/'+title:title;
        const child=_pdfRef(_pdfVal(b,'First'));
        if(child!=null) walk(child, path); else paths.push(path);
        cur=_pdfRef(_pdfVal(b,'Next'));
      }
    };
    walk(first,''); return paths;
  }
  function _pdfPageCount(text){
    const m=/\/Type\s*\/Pages\b[\s\S]{0,500}?\/Count\s+(\d+)/.exec(text); if(m) return +m[1];
    return (text.match(/\/Type\s*\/Page\b(?!s)/g)||[]).length;
  }
  async function _pdfDecompress(S, bytes, cap){
    let out=''; let count=0; const re=/\/FlateDecode[\s\S]{0,300}?stream\r?\n/g; let m;
    while((m=re.exec(S)) && count<cap){
      const start=m.index+m[0].length; const end=S.indexOf('endstream', start); if(end<0) continue;
      const raw=bytes.subarray(start, end);
      try{ out+=_latin1(await _inflate(raw,'deflate')); count++; }
      catch(e){ try{ out+=_latin1(await _inflate(raw,'deflate-raw')); count++; }catch(e2){} }
    }
    return out;
  }
  async function _parsePdf(buf, fileName){
    const bytes=new Uint8Array(buf); const S=_latin1(bytes);
    const objs=new Map(); const re=/(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj/g; let m, guard=0;
    while((m=re.exec(S)) && guard++<200000){ if(!objs.has(+m[1])) objs.set(+m[1], m[2]); }
    let tree=null; try{ tree=_pdfOutline(objs); }catch(e){}
    let pages=0; try{ pages=_pdfPageCount(S); }catch(e){}
    let flat=null;
    if(!tree || !tree.length){
      let extra=''; try{ extra=await _pdfDecompress(S, bytes, 140); }catch(e){}
      if(extra){ try{ const p2=_pdfPageCount(extra); if(p2>pages) pages=p2; }catch(e){}
        try{ const t=[]; const r2=/\/Title\s*(\([\s\S]*?\)|<[0-9A-Fa-f\s]*>)/g; let mm, g2=0; while((mm=r2.exec(extra))&&g2++<8000){ const v=_cleanTitle(_pdfDecodeStr(mm[1])); if(v) t.push(v); } flat=t; }catch(e){} }
    }
    const base=fileName.replace(/\.pdf$/i,'');
    const files=[]; const add=(p)=>files.push({path:p, size:0, content:null, mtime:null});
    if(tree && tree.length){ for(const p of tree) add(p); }
    else if(flat && flat.length){ for(const t of flat) add(CM.i18n.t('cl.pdfBookmarks','Zakładki')+'/'+t); }
    else if(pages>0){ const cap=Math.min(pages,800); for(let i=1;i<=cap;i++) add(CM.i18n.t('cl.pdfPages','Strony')+'/'+CM.i18n.t('cl.pdfPage','Strona')+' '+i); }
    if(!files.length) add(CM.i18n.t('cl.pdfNoStructure','(nie udało się odczytać struktury PDF)'));
    return {files, meta:{name:base, source:'pdf: '+fileName, kind:'pdf', pages, createdAt:Date.now()}};
  }

  // expand a list of File objects that are archives/PDFs; returns {files, warnings}
  async function _expandSpecialFiles(files, onTick){
    const out=[], warnings=[];
    for(const f of files){ const n=f.name;
      try{
        if(RE_ARCHIVE.test(n)){ const {entries, base, flat}=await _expandArchive(f); const root=flat?'':base+'/';
          for(const e of entries){ if(!shouldSkip(e.name)) out.push({path:root+e.name, size:e.size, content:e.content, mtime:null}); } }
        else if(RE_PDF.test(n)){ const res=await _parsePdf(await f.arrayBuffer(), n); const root=n.replace(/\.pdf$/i,'')+'/';
          for(const e of res.files) out.push({path:root+e.path, size:0, content:null, mtime:null}); }
        else if(RE_UNSUPPORTED.test(n)){ warnings.push(n); }
      }catch(e){ console.warn('Nie udało się rozpakować '+n+':', e); warnings.push(n+CM.i18n.t('cl.readError',' (błąd odczytu)')); }
      if(onTick) onTick();
    }
    return {files:out, warnings};
  }

  function isTextFile(name, size){
    const info = L.lookup(name);
    return info.text && size <= TEXT_SIZE_LIMIT;
  }
  function readText(file){
    return new Promise(res=>{
      const fr=new FileReader();
      fr.onload=()=>res(fr.result);
      fr.onerror=()=>res(null);
      try{ fr.readAsText(file); }catch(e){ res(null); }
    });
  }

  // ---------- from <input> FileList (folder or files) ----------
  const isSpecial=(n)=>RE_ARCHIVE.test(n)||RE_PDF.test(n)||RE_UNSUPPORTED.test(n);
  async function fromFileList(fileList, onProgress){
    const allFiles = Array.from(fileList);
    const special = allFiles.filter(f=>isSpecial(f.name));
    const regular = allFiles.filter(f=>!isSpecial(f.name) && !shouldSkip(f.webkitRelativePath||f.name));

    // single PDF dropped on its own -> the whole project IS its internal structure
    if(special.length===1 && RE_PDF.test(special[0].name) && !regular.length){
      try{ return await _parsePdf(await special[0].arrayBuffer(), special[0].name); }
      catch(e){ throw new Error(CM.i18n.t('cl.pdfReadFail','Nie udało się odczytać PDF: ')+e.message); }
    }
    // only unsupported archive(s) -> clear message instead of an empty map
    if(special.length && special.every(f=>RE_UNSUPPORTED.test(f.name)) && !regular.length){
      const ext=special[0].name.split('.').pop().toUpperCase();
      throw new Error(CM.i18n.t('cl.fmtUnsupportedA','Format ')+ext+CM.i18n.t('cl.fmtUnsupportedB',' nie jest obsługiwany w przeglądarce (zamknięty algorytm kompresji). Rozpakuj go lub spakuj ponownie jako ZIP / TAR / TAR.GZ.'));
    }

    let projName='pliki';
    const firstRel=regular.find(f=>f.webkitRelativePath)?.webkitRelativePath;
    let stripRoot='';
    if(firstRel){ projName=firstRel.split('/')[0]; stripRoot=projName+'/'; }
    else if(regular.length===1&&!special.length){ projName=regular[0].name; }
    else if(special.length===1&&!regular.length){ projName=special[0].name.replace(/\.(zip|tar\.gz|tgz|tar|gz|pdf)$/i,''); }

    let textCount=0;
    const total=regular.length+special.length;
    let done=0;
    const regularOut = await U.pMap(regular, async (f)=>{
      let path = f.webkitRelativePath || f.name;
      if(stripRoot && path.startsWith(stripRoot)) path=path.slice(stripRoot.length);
      let content=null;
      if(isTextFile(f.name, f.size) && textCount<MAX_CONTENT_FILES){ content=await readText(f); textCount++; }
      if(onProgress) onProgress(++done, total);
      return {path, size:f.size, content, mtime:f.lastModified};
    }, 16);

    const {files:specialOut, warnings}=await _expandSpecialFiles(special, ()=>{ if(onProgress) onProgress(++done, total); });

    const combined=[...regularOut.filter(Boolean),...specialOut];
    return {files:combined, meta:{name:projName, source:'local: '+projName, kind:'local', createdAt:Date.now(), warnings}};
  }

  // ---------- from drag & drop: entries/files must be captured SYNCHRONOUSLY by the caller ----------
  async function fromDrop(entries, files, onProgress){
    if(entries && entries.length){
      const collected=[];
      let rootName = entries.length===1 ? entries[0].name : 'upuszczone';
      for(const ent of entries) await walkEntry(ent, '', collected, rootName);
      const specials=collected.filter(c=>isSpecial(c.file.name));
      const plain=collected.filter(c=>!isSpecial(c.file.name));
      // single PDF dropped alone -> its internal structure as the whole project
      if(specials.length===1 && RE_PDF.test(specials[0].file.name) && !plain.length){
        try{ return await _parsePdf(await specials[0].file.arrayBuffer(), specials[0].file.name); }catch(e){ throw new Error(CM.i18n.t('cl.pdfReadFail','Nie udało się odczytać PDF: ')+e.message); }
      }
      let textCount=0; let done=0; const total=plain.length+specials.length;
      const out = await U.pMap(plain, async (c)=>{
        let content=null;
        if(isTextFile(c.file.name, c.file.size) && textCount<MAX_CONTENT_FILES){ content=await readText(c.file); textCount++; }
        if(onProgress) onProgress(++done, total);
        return {path:c.path, size:c.file.size, content, mtime:c.file.lastModified};
      }, 16);
      const {files:specialOut, warnings}=await _expandSpecialFiles(specials.map(c=>c.file), ()=>{ if(onProgress) onProgress(++done, total); });
      const combined=[...out.filter(Boolean), ...specialOut];
      if(combined.length)
        return {files:combined, meta:{name:rootName, source:'upuszczone: '+rootName, kind:'local', createdAt:Date.now(), warnings}};
    }
    // fallback: plain dropped files (no directory entries available)
    return fromFileList(files||[], onProgress);
  }
  // back-compat wrapper (reads a live DataTransfer synchronously)
  async function fromDataTransfer(dt, onProgress){
    const items=Array.from(dt.items||[]).filter(i=>i.kind==='file');
    const entries=items.map(i=> i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    return fromDrop(entries, Array.from(dt.files||[]), onProgress);
  }
  function walkEntry(entry, prefix, out, rootName){
    return new Promise(resolve=>{
      if(entry.isFile){
        entry.file(file=>{
          const path = prefix ? prefix+'/'+file.name : file.name;
          if(!shouldSkip(path)) out.push({path, file});
          resolve();
        }, ()=>resolve());
      } else if(entry.isDirectory){
        if(shouldSkip(entry.name)){ resolve(); return; }
        const reader=entry.createReader(); const all=[];
        const readBatch=()=> reader.readEntries(async ents=>{
          if(!ents.length){
            for(const e of all) await walkEntry(e, prefix? prefix+'/'+entry.name : entry.name, out, rootName);
            resolve(); return;
          }
          all.push(...ents); readBatch();
        }, ()=>resolve());
        readBatch();
      } else resolve();
    });
  }

  // skip noise folders
  const SKIP=/(^|\/)(\.git|node_modules|\.next|\.nuxt|dist|build|out|target|\.venv|venv|__pycache__|\.idea|\.vscode|\.cache|vendor|\.gradle|bin|obj|coverage|\.DS_Store|Thumbs\.db)(\/|$)/i;
  function shouldSkip(path){ return SKIP.test(path); }

  // ---------- GitHub ----------
  function parseSource(url){
    url=url.trim();
    let m=url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)((?:\/[^?#]*)?))?(?:[?#].*)?$/i);
    if(m) return {owner:m[1], repo:m[2], branch:m[3]||'', sub:(m[4]||'').replace(/^\//,'')};
    m=url.match(/^([\w.-]+)\/([\w.-]+)$/);
    if(m) return {owner:m[1], repo:m[2].replace(/\.git$/,''), branch:'', sub:''};
    return null;
  }

  function b64utf8(b64){
    const bin=atob(b64.replace(/\n/g,'')); const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    try{ return new TextDecoder('utf-8').decode(bytes); }catch(e){ return bin; }
  }

  // fetch wrapper: a network/CORS/DNS failure rejects with a bare "TypeError: Failed to fetch";
  // convert it into a clear, localized message instead of leaking the raw browser error.
  async function netFetch(u, init){
    try{ return await fetch(u, init); }
    catch(e){ throw new Error(CM.i18n.t('cl.netFail','Brak połączenia — sprawdź internet i spróbuj ponownie. (Możliwa też blokada CORS / firewall / serwer offline.)')); }
  }

  async function fromGitHub(url, opts, onProgress, onStatus){
    opts=opts||{};
    const src=parseSource(url);
    if(!src) throw new Error(CM.i18n.t('cl.ghBadUrl','Nie rozpoznano adresu. Użyj np. https://github.com/owner/repo lub owner/repo'));
    const headers={'Accept':'application/vnd.github+json'};
    if(opts.token) headers['Authorization']='Bearer '+opts.token;
    const api='https://api.github.com';

    const ghFetch=async(u)=>{
      const r=await netFetch(u,{headers});
      if(r.status===403){ const rl=r.headers.get('x-ratelimit-remaining'); throw new Error(CM.i18n.t('cl.ghRateLimit','GitHub: limit zapytań')+(rl==='0'?CM.i18n.t('cl.ghRateExhausted',' wyczerpany — podaj token w opcjach.'):CM.i18n.t('cl.ghForbidden',' / brak dostępu (403).'))); }
      if(r.status===404) throw new Error(CM.i18n.t('cl.ghNotFound','GitHub: nie znaleziono repozytorium / gałęzi (404). Sprawdź adres')+(opts.token?'':CM.i18n.t('cl.ghNotFoundToken',' lub podaj token dla repo prywatnego.')));
      if(!r.ok) throw new Error('GitHub API: HTTP '+r.status);
      return r.json();
    };

    let branch=src.branch || opts.branch || '';   // URL ref wins, then the explicit branch/tag option
    if(onStatus) onStatus(CM.i18n.t('cl.stRepoInfo','Pobieranie informacji o repozytorium…'));
    // fetch repo info (default branch + OWNER avatar/login). On failure, fall back to github.com/<login>.png
    let owner={login:src.owner, avatar:`https://github.com/${src.owner}.png?size=120`, url:`https://github.com/${src.owner}`};
    let html=`https://github.com/${src.owner}/${src.repo}`, repoInfo=null;
    try{
      const info=await ghFetch(`${api}/repos/${src.owner}/${src.repo}`);
      if(!branch) branch=info.default_branch||'main';
      if(info.owner) owner={login:info.owner.login, avatar:info.owner.avatar_url, url:info.owner.html_url};
      html=info.html_url||html;
      repoInfo={desc:info.description||'', stars:info.stargazers_count, forks:info.forks_count, issues:info.open_issues_count,
        lang:info.language||'', license:(info.license&&(info.license.spdx_id||info.license.name))||'', url:html,
        defaultBranch:info.default_branch||branch, pushedAt:info.pushed_at||null, topics:info.topics||[]};
    }catch(e){ if(!branch) branch='main'; }

    if(onStatus) onStatus(CM.i18n.t('cl.stFileTree','Pobieranie drzewa plików…'));
    const tree=await ghFetch(`${api}/repos/${src.owner}/${src.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    if(tree.truncated && onStatus) onStatus(CM.i18n.t('cl.stTreeTooLarge','Uwaga: drzewo bardzo duże — część plików mogła zostać pominięta przez GitHub.'));
    let blobs=(tree.tree||[]).filter(t=>t.type==='blob');
    if(src.sub){ const pre=src.sub.replace(/\/$/,'')+'/'; blobs=blobs.filter(t=>t.path.startsWith(pre)).map(t=>({...t, path:t.path.slice(pre.length)})); }
    blobs=blobs.filter(t=>!shouldSkip(t.path));

    const projName=src.repo+(src.sub?('/'+src.sub):'');
    const files=blobs.map(b=>({path:b.path, size:b.size||0, content:null, mtime:null, sha:b.sha}));

    if(opts.fetchContent){
      const textFiles=files.filter(f=>isTextFile(f.path.split('/').pop(), f.size)).slice(0, MAX_CONTENT_FILES);
      if(onStatus) onStatus(CM.i18n.t('cl.stFetchContentA','Pobieranie zawartości ')+textFiles.length+CM.i18n.t('cl.stFetchContentB',' plików…'));
      let done=0;
      await U.pMap(textFiles, async (f)=>{
        try{
          if(opts.token){
            const blob=await ghFetch(`${api}/repos/${src.owner}/${src.repo}/git/blobs/${f.sha}`);
            if(blob.encoding==='base64') f.content=b64utf8(blob.content); else f.content=blob.content||'';
          } else {
            const raw=`https://raw.githubusercontent.com/${src.owner}/${src.repo}/${branch}/${src.sub?src.sub.replace(/\/$/,'')+'/':''}${f.path}`;
            const r=await fetch(raw); if(r.ok) f.content=await r.text();
          }
        }catch(e){}
        done++; if(onProgress) onProgress(done, textFiles.length);
      }, opts.token?10:14);
    }

    return {files, meta:{name:projName, source:`github: ${src.owner}/${src.repo}@${branch}${src.sub?'/'+src.sub:''}`,
            kind:'github', host:'github', repo:`${src.owner}/${src.repo}`, branch, sub:src.sub, html, repoInfo, owner, createdAt:Date.now()}};
  }

  // ---------- GitLab (API v4, CORS-enabled) ----------
  async function fromGitLab(url, opts, onProgress, onStatus){
    opts=opts||{};
    let m=url.match(/gitlab\.com\/([^?#]+)/i);
    let path=(m?m[1]:url).replace(/\.git$/,'').replace(/\/-\/.*$/,'').replace(/^\/|\/$/g,'');
    if(!path) throw new Error(CM.i18n.t('cl.glBadUrl','Nie rozpoznano adresu GitLab.'));
    const enc=encodeURIComponent(path), api='https://gitlab.com/api/v4';
    const headers={}; if(opts.token) headers['PRIVATE-TOKEN']=opts.token;
    const gl=async(u)=>{ const r=await netFetch(u,{headers}); if(r.status===404) throw new Error(CM.i18n.t('cl.glNotFound','GitLab: nie znaleziono projektu (404).')); if(!r.ok) throw new Error('GitLab API: HTTP '+r.status); return r.json(); };
    if(onStatus) onStatus(CM.i18n.t('cl.stProjectInfo','Pobieranie informacji o projekcie…'));
    const proj=await gl(`${api}/projects/${enc}`);
    const id=proj.id, branch=opts.branch||proj.default_branch||'main';
    const ns=proj.namespace||{};
    const owner={login:ns.path||path.split('/')[0], avatar:proj.avatar_url||ns.avatar_url||null, url:ns.web_url||('https://gitlab.com/'+(ns.path||path.split('/')[0])), host:'gitlab'};
    if(onStatus) onStatus(CM.i18n.t('cl.stFileTree','Pobieranie drzewa plików…'));
    let blobs=[], page=1;
    while(page<=50){ const r=await fetch(`${api}/projects/${id}/repository/tree?recursive=true&ref=${encodeURIComponent(branch)}&per_page=100&page=${page}`,{headers}); if(!r.ok) break; const arr=await r.json(); if(!Array.isArray(arr)||!arr.length) break;
      for(const t of arr) if(t.type==='blob' && !shouldSkip(t.path)) blobs.push(t.path);
      if(arr.length<100) break; page++; if(onStatus) onStatus(CM.i18n.t('cl.stTreeProgressA','Pobieranie drzewa… ')+blobs.length+CM.i18n.t('cl.stFilesSuffix',' plików')); }
    const files=blobs.map(p=>({path:p, size:0, content:null, mtime:null}));
    if(opts.fetchContent){
      const tf=files.filter(f=>isTextFile(f.path.split('/').pop(),0)).slice(0,MAX_CONTENT_FILES);
      if(onStatus) onStatus(CM.i18n.t('cl.stFetchContentA','Pobieranie zawartości ')+tf.length+CM.i18n.t('cl.stFetchContentB',' plików…')); let done=0;
      await U.pMap(tf, async(f)=>{ try{ const r=await fetch(`${api}/projects/${id}/repository/files/${encodeURIComponent(f.path)}/raw?ref=${encodeURIComponent(branch)}`,{headers}); if(r.ok) f.content=await r.text(); }catch(e){} done++; if(onProgress) onProgress(done,tf.length); }, 12);
    }
    const glHtml=proj.web_url||('https://gitlab.com/'+path);
    const glInfo={desc:proj.description||'', stars:proj.star_count, forks:proj.forks_count, issues:proj.open_issues_count,
      lang:'', license:(proj.license&&(proj.license.nickname||proj.license.name))||'', url:glHtml,
      defaultBranch:proj.default_branch||branch, pushedAt:proj.last_activity_at||null, topics:proj.topics||proj.tag_list||[]};
    return {files, meta:{name:path.split('/').pop(), source:`gitlab: ${path}@${branch}`, kind:'gitlab', host:'gitlab', repo:path, branch, html:glHtml, repoInfo:glInfo, owner, createdAt:Date.now()}};
  }

  // ---------- Bitbucket (API 2.0, CORS-enabled; recursive src walk) ----------
  async function fromBitbucket(url, opts, onProgress, onStatus){
    opts=opts||{};
    const m=url.match(/bitbucket\.org\/([^/]+)\/([^/?#]+)/i);
    if(!m) throw new Error(CM.i18n.t('cl.bbBadUrl','Nie rozpoznano adresu Bitbucket (oczekiwano bitbucket.org/workspace/repo).'));
    const ws=m[1], repo=m[2].replace(/\.git$/,''), api='https://api.bitbucket.org/2.0';
    const headers={}; if(opts.token) headers['Authorization']='Bearer '+opts.token;
    const bb=async(u)=>{ const r=await netFetch(u,{headers}); if(r.status===404) throw new Error(CM.i18n.t('cl.bbNotFound','Bitbucket: nie znaleziono repozytorium (404).')); if(!r.ok) throw new Error('Bitbucket API: HTTP '+r.status); return r.json(); };
    if(onStatus) onStatus(CM.i18n.t('cl.stRepoInfo','Pobieranie informacji o repozytorium…'));
    const info=await bb(`${api}/repositories/${ws}/${repo}`);
    const branch=opts.branch||(info.mainbranch&&info.mainbranch.name)||'main';
    if(onStatus) onStatus(CM.i18n.t('cl.stFileStructure','Pobieranie struktury plików…'));
    const files=[]; const queue=['']; let guard=0;
    while(queue.length && guard++<3000){
      const dir=queue.shift();
      let next=`${api}/repositories/${ws}/${repo}/src/${encodeURIComponent(branch)}/${dir}?pagelen=100`;
      let pg=0;
      while(next && pg++<40){ const r=await fetch(next,{headers}); if(!r.ok) break; const j=await r.json();
        for(const e of (j.values||[])){ if(shouldSkip(e.path)) continue;
          if(e.type==='commit_directory') queue.push(e.path+'/');
          else if(e.type==='commit_file') files.push({path:e.path, size:e.size||0, content:null, mtime:null}); }
        next=j.next||null; }
      if(onStatus) onStatus(CM.i18n.t('cl.stStructureProgressA','Pobieranie struktury… ')+files.length+CM.i18n.t('cl.stFilesSuffix',' plików'));
      if(files.length>MAX_CONTENT_FILES*2) break;
    }
    if(opts.fetchContent){
      const tf=files.filter(f=>isTextFile(f.path.split('/').pop(),0)).slice(0,MAX_CONTENT_FILES);
      if(onStatus) onStatus(CM.i18n.t('cl.stFetchContentA','Pobieranie zawartości ')+tf.length+CM.i18n.t('cl.stFetchContentB',' plików…')); let done=0;
      await U.pMap(tf, async(f)=>{ try{ const r=await fetch(`${api}/repositories/${ws}/${repo}/src/${encodeURIComponent(branch)}/${f.path}`,{headers}); if(r.ok) f.content=await r.text(); }catch(e){} done++; if(onProgress) onProgress(done,tf.length); }, 10);
    }
    const owner={login:ws, avatar:(info.links&&info.links.avatar&&info.links.avatar.href)||null, url:`https://bitbucket.org/${ws}`, host:'bitbucket'};
    const bbHtml=(info.links&&info.links.html&&info.links.html.href)||`https://bitbucket.org/${ws}/${repo}`;
    const bbInfo={desc:info.description||'', stars:null, forks:null, issues:null, lang:info.language||'', license:'',
      url:bbHtml, defaultBranch:(info.mainbranch&&info.mainbranch.name)||branch, pushedAt:info.updated_on||null, topics:[]};
    return {files, meta:{name:repo, source:`bitbucket: ${ws}/${repo}@${branch}`, kind:'bitbucket', host:'bitbucket', repo:`${ws}/${repo}`, branch, html:bbHtml, repoInfo:bbInfo, owner, createdAt:Date.now()}};
  }

  // ---------- dispatcher: detect host from URL ----------
  function repoHost(url){
    if(/gitlab\.com/i.test(url)) return 'gitlab';
    if(/bitbucket\.org/i.test(url)) return 'bitbucket';
    return 'github';   // github.com or bare owner/repo
  }
  function fromRepoURL(url, opts, onProgress, onStatus){
    const h=repoHost(url);
    if(h==='gitlab') return fromGitLab(url, opts, onProgress, onStatus);
    if(h==='bitbucket') return fromBitbucket(url, opts, onProgress, onStatus);
    return fromGitHub(url, opts, onProgress, onStatus);
  }

  // ---------- refs (branches + tags) for the picker ----------
  function _ghHeaders(token){ const h={'Accept':'application/vnd.github+json'}; if(token) h['Authorization']='Bearer '+token; return h; }
  function _glPath(url){ const m=url.match(/gitlab\.com\/([^?#]+)/i); return (m?m[1]:url).replace(/\.git$/,'').replace(/\/-\/.*$/,'').replace(/^\/|\/$/g,''); }
  async function fetchRefs(url, token){
    const host=repoHost(url);
    try{
      if(host==='gitlab'){
        const enc=encodeURIComponent(_glPath(url)), api='https://gitlab.com/api/v4', h={}; if(token) h['PRIVATE-TOKEN']=token;
        const proj=await fetch(`${api}/projects/${enc}`,{headers:h}).then(r=>r.json());
        const br=await fetch(`${api}/projects/${proj.id}/repository/branches?per_page=100`,{headers:h}).then(r=>r.ok?r.json():[]);
        const tg=await fetch(`${api}/projects/${proj.id}/repository/tags?per_page=100`,{headers:h}).then(r=>r.ok?r.json():[]);
        return {branches:(br||[]).map(x=>x.name), tags:(tg||[]).map(x=>x.name), default:proj.default_branch, host};
      }
      if(host==='bitbucket'){
        const m=url.match(/bitbucket\.org\/([^/]+)\/([^/?#]+)/i); if(!m) return {branches:[],tags:[],host};
        const ws=m[1], repo=m[2].replace(/\.git$/,''), api='https://api.bitbucket.org/2.0', h={}; if(token) h['Authorization']='Bearer '+token;
        const br=await fetch(`${api}/repositories/${ws}/${repo}/refs/branches?pagelen=100`,{headers:h}).then(r=>r.ok?r.json():{values:[]});
        const tg=await fetch(`${api}/repositories/${ws}/${repo}/refs/tags?pagelen=100`,{headers:h}).then(r=>r.ok?r.json():{values:[]});
        return {branches:(br.values||[]).map(x=>x.name), tags:(tg.values||[]).map(x=>x.name), host};
      }
      const src=parseSource(url); if(!src) return {branches:[],tags:[],host};
      const api='https://api.github.com', h=_ghHeaders(token);
      const br=await fetch(`${api}/repos/${src.owner}/${src.repo}/branches?per_page=100`,{headers:h}).then(r=>r.ok?r.json():[]);
      const tg=await fetch(`${api}/repos/${src.owner}/${src.repo}/tags?per_page=100`,{headers:h}).then(r=>r.ok?r.json():[]);
      return {branches:(br||[]).map(x=>x.name), tags:(tg||[]).map(x=>x.name), host};
    }catch(e){ return {branches:[],tags:[],host,error:e.message}; }
  }

  // ---------- lightweight signature of a ref (path + blob-sha) — branch/tag diff without content ----------
  function _sig(name, files){ files.sort((a,b)=>a.path<b.path?-1:1);
    return {name, fileCount:files.length, totalSize:files.reduce((s,f)=>s+(f.size||0),0), totalLines:0, files}; }
  async function fetchTreeSig(url, ref, token){
    const host=repoHost(url);
    if(host==='github'){
      const src=parseSource(url); if(!src) throw new Error(CM.i18n.t('cl.ghBadUrl','Nie rozpoznano adresu. Użyj np. https://github.com/owner/repo lub owner/repo'));
      const api='https://api.github.com', h=_ghHeaders(token);
      if(!ref){ const info=await netFetch(`${api}/repos/${src.owner}/${src.repo}`,{headers:h}).then(r=>{ if(!r.ok) throw new Error('GitHub API: HTTP '+r.status); return r.json(); }); ref=info.default_branch||'main'; }
      const tree=await netFetch(`${api}/repos/${src.owner}/${src.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,{headers:h}).then(r=>{ if(!r.ok) throw new Error('GitHub API: HTTP '+r.status); return r.json(); });
      let files=(tree.tree||[]).filter(t=>t.type==='blob' && !shouldSkip(t.path)).map(t=>({path:t.path, hash:t.sha, size:t.size||0, lines:0, lang:''}));
      if(src.sub){ const pre=src.sub.replace(/\/$/,'')+'/'; files=files.filter(f=>f.path.startsWith(pre)).map(f=>({...f,path:f.path.slice(pre.length)})); }
      return _sig(ref, files);
    }
    if(host==='gitlab'){
      const enc=encodeURIComponent(_glPath(url)), api='https://gitlab.com/api/v4', h={}; if(token) h['PRIVATE-TOKEN']=token;
      const proj=await netFetch(`${api}/projects/${enc}`,{headers:h}).then(r=>{ if(!r.ok) throw new Error('GitLab API: HTTP '+r.status); return r.json(); }); const id=proj.id; if(!ref) ref=proj.default_branch||'main';
      let files=[], page=1;
      while(page<=50){ const r=await netFetch(`${api}/projects/${id}/repository/tree?recursive=true&ref=${encodeURIComponent(ref)}&per_page=100&page=${page}`,{headers:h}); if(!r.ok) break; const arr=await r.json(); if(!Array.isArray(arr)||!arr.length) break;
        for(const t of arr) if(t.type==='blob' && !shouldSkip(t.path)) files.push({path:t.path, hash:t.id, size:0, lines:0, lang:''});
        if(arr.length<100) break; page++; }
      return _sig(ref, files);
    }
    throw new Error(CM.i18n.t('cl.cmpHostUnsupported','Porównanie gałęzi obsługuje obecnie GitHub i GitLab.'));
  }

  // ---------- GitHub API rate limit + Gist export ----------
  async function ghRateLimit(token){
    try{ const r=await fetch('https://api.github.com/rate_limit',{headers:_ghHeaders(token)}); if(!r.ok) return null; const j=await r.json(); return j.rate||(j.resources&&j.resources.core)||null; }catch(e){ return null; }
  }
  // ---------- optional AI (Mistral) — browser-direct (api.mistral.ai allows CORS); user's own key ----------
  async function mistralChat(messages, opts){
    opts=opts||{}; const key=opts.key; if(!key) throw new Error(CM.i18n.t('cl.aiNoKey','Brak klucza Mistral API.'));
    const body={model:opts.model||'mistral-small-latest', temperature:opts.temperature!=null?opts.temperature:0.3, messages};
    if(opts.json) body.response_format={type:'json_object'};   // ask for a parseable JSON object
    const r=await fetch('https://api.mistral.ai/v1/chat/completions',{method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify(body)});
    if(r.status===401){ const e=new Error(CM.i18n.t('cl.aiBadKey','Nieprawidłowy klucz Mistral API.')); e.status=401; throw e; }
    if(r.status===429){ const e=new Error(CM.i18n.t('cl.aiRate','Mistral: przekroczono limit zapytań.')); e.status=429; throw e; }
    if(!r.ok){ const e=new Error('Mistral API: HTTP '+r.status); e.status=r.status; throw e; }
    const j=await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  }

  // streaming chat — yields tokens via opts.onToken(delta, full); returns the full text. Server-Sent Events.
  async function mistralStream(messages, opts){
    opts=opts||{}; const key=opts.key; if(!key){ const e=new Error(CM.i18n.t('cl.aiNoKey','Brak klucza Mistral API.')); e.status=0; throw e; }
    const body={model:opts.model||'mistral-small-latest', temperature:opts.temperature!=null?opts.temperature:0.4, messages, stream:true};
    const r=await fetch('https://api.mistral.ai/v1/chat/completions',{method:'POST',
      headers:{'Content-Type':'application/json','Accept':'text/event-stream','Authorization':'Bearer '+key},
      body:JSON.stringify(body), signal:opts.signal});
    if(r.status===401){ const e=new Error(CM.i18n.t('cl.aiBadKey','Nieprawidłowy klucz Mistral API.')); e.status=401; throw e; }
    if(r.status===429){ const e=new Error(CM.i18n.t('cl.aiRate','Mistral: przekroczono limit zapytań.')); e.status=429; throw e; }
    if(!r.ok || !r.body){ const e=new Error('Mistral API: HTTP '+r.status); e.status=r.status; throw e; }
    const reader=r.body.getReader(), dec=new TextDecoder(); let buf='', full='';
    while(true){
      const {value,done}=await reader.read(); if(done) break;
      buf+=dec.decode(value,{stream:true});
      let nl;
      while((nl=buf.indexOf('\n'))>=0){
        const line=buf.slice(0,nl).trim(); buf=buf.slice(nl+1);
        if(!line || !line.startsWith('data:')) continue;
        const data=line.slice(5).trim();
        if(data==='[DONE]') return full;
        try{ const j=JSON.parse(data); const d=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content;
          if(d){ full+=d; if(opts.onToken) opts.onToken(d, full); } }catch(e){}
      }
    }
    return full;
  }

  async function createGist(content, desc, token, isPublic){
    const r=await fetch('https://api.github.com/gists',{method:'POST',
      headers:Object.assign(_ghHeaders(token),{'Content-Type':'application/json'}),
      body:JSON.stringify({description:desc||'CodeMap', public:!!isPublic, files:{'codemap.json':{content}}})});
    if(r.status===401||r.status===403) throw new Error(CM.i18n.t('cl.gistAuth','Gist wymaga tokenu GitHub z uprawnieniem „gist".'));
    if(!r.ok) throw new Error('Gist: HTTP '+r.status);
    const j=await r.json(); return {url:j.html_url, id:j.id};
  }

  return {fromFileList, fromDrop, fromDataTransfer, fromGitHub, fromGitLab, fromBitbucket, fromRepoURL, repoHost, parseSource, isTextFile, shouldSkip, fetchRefs, fetchTreeSig, ghRateLimit, createGist, mistralChat, mistralStream};
})();
