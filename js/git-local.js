/* ===================== git-local.js — historia commitów z lokalnego katalogu .git (CM.GitLocal) =====================
   Czyta obiekty gita wprost z uchwytów plików katalogu .git wczytanego folderu (File/Blob), bez serwera
   i bez bibliotek: HEAD / refs / packed-refs, obiekty luźne (zlib przez DecompressionStream) i paczki
   (.idx v1/v2 + .pack z deltami OFS_DELTA/REF_DELTA). Paczki nie są wczytywane w całości — obiekt to
   wycinek Blob.slice(offset, następny offset), czytany blokami (commity i drzewa leżą w paczce razem).
   log() idzie od HEAD kolejką po czasie committera (jak `git log`) i dla commita liczy pliki zmienione
   względem pierwszego rodzica: diff drzew schodzi tylko do poddrzew o różnym sha, zmiany nazw tylko
   dokładne (ten sam blob). run() robi to w js/git-worker.js, a bez Workera — w bieżącym wątku.
   Klasyczny skrypt: w stronie, w workerze i w harnessie vm dopisuje się do self.CM.
   API:  repo = await open([{path, file}])  (ścieżki względem .git) → repo.head {ref|null, sha},
         repo.readObject(sha) → {type, data}, repo.log({ref, max, onProgress, signal}) → commity od najnowszego,
         repo.walk(opts) → {commits, truncated, ms}, repo.refs() → [{name, sha}];
         run(files, opts) → {head, commits, stats:{objects, ms, truncated}}; GitError.code: no-head | gitdir-file |
         sha256 | missing-object | bad-pack | cancelled | unsupported (brak DecompressionStream).
   Commit: {sha, parents, merge, boundary, author:{name, email}, authorTime, committer, time, message,
            files:[{path, status:A|M|D|R, from?, sha?, oldSha?}]} — czasy w ms, scalenia z files:[]. */
(function(root){
  const CM = root.CM = root.CM || {};

  class GitError extends Error {
    constructor(code, message){ super(message || code); this.name = 'GitError'; this.code = code; }
  }

  // ---- drobne narzędzia ----
  const utf8 = new TextDecoder('utf-8');
  // dekoder jednobajtowy (bajt → jeden znak): drzewo czytane jednym wywołaniem, nazwy przez slice
  const latin1 = (()=>{ try{ return new TextDecoder('latin1'); }catch(e){ return null; } })();
  const NON_ASCII = /[^\x00-\x7f]/;
  const HEX = []; for(let i=0; i<256; i++) HEX.push((i < 16 ? '0' : '') + i.toString(16));
  const hexOf = (b, o)=>{ let s = ''; for(let i=0; i<20; i++) s += HEX[b[o+i]]; return s; };
  const bytesOf = (hex)=>{ const b = new Uint8Array(20); for(let i=0; i<20; i++) b[i] = parseInt(hex.substr(2*i, 2), 16); return b; };
  const isSha = (s)=>/^[0-9a-f]{40}$/.test(s);
  const now = ()=>(typeof performance !== 'undefined' ? performance.now() : Date.now());
  // bajty → tekst; szybka ścieżka ASCII (nazwy w drzewach), reszta przez TextDecoder
  function str(b, s, e){
    if(e - s > 64) return utf8.decode(b.subarray(s, e));
    let out = '';
    for(let i=s; i<e; i++){ const c = b[i]; if(c >= 0x80) return utf8.decode(b.subarray(s, e)); out += String.fromCharCode(c); }
    return out;
  }
  // oddanie sterowania pętli zdarzeń: w oknie przez MessageChannel (setTimeout w ukrytej karcie jest
  // dławiony do ~1/s), w workerze i w Node przez setTimeout
  const yieldTask = (()=>{
    if(!root.document || typeof MessageChannel === 'undefined') return ()=>new Promise((r)=>setTimeout(r, 0));
    let ch = null; const q = [];
    return ()=>new Promise((r)=>{
      if(!ch){ ch = new MessageChannel(); ch.port1.onmessage = ()=>{ const f = q.shift(); if(f) f(); }; }
      q.push(r); ch.port2.postMessage(0);
    });
  })();
  async function bytes(blob){ return new Uint8Array(await blob.arrayBuffer()); }
  async function text(blob){ return utf8.decode(await bytes(blob)); }
  function concat(chunks, len){
    // jeden kawałek bez kopii — chyba że to wycinek dużo większego bufora (zlib w Node trzyma 16 KB na strumień)
    if(chunks.length === 1 && chunks[0].buffer.byteLength <= len + 4096) return chunks[0];
    const out = new Uint8Array(len); let o = 0;
    for(const c of chunks){ out.set(c, o); o += c.length; }
    return out;
  }

  // zlib → bajty. Wycinek z paczki kończy się dokładnie na następnym obiekcie, ale gdyby
  // DecompressionStream rzucił na końcówce (śmieci / suma adler32), wystarczą poprawnie odczytane dane.
  async function inflate(data){
    const ds = new DecompressionStream('deflate');
    const w = ds.writable.getWriter();
    w.write(data).catch(()=>{}); w.close().catch(()=>{});
    const r = ds.readable.getReader();
    const chunks = []; let len = 0, broken = null;
    try{
      for(;;){ const {done, value} = await r.read(); if(done) break; chunks.push(value); len += value.length; }
    }catch(e){ broken = e; }
    return {data:concat(chunks, len), broken};
  }

  // delta gita: rozmiar bazy, rozmiar wyniku (varinty), potem kopiuj z bazy (bit 7) / wstaw (1–127 bajtów)
  function applyDelta(base, delta){
    let p = 0;
    const varint = ()=>{ let v = 0, s = 0, c; do{ c = delta[p++]; v += (c & 0x7f) * 2**s; s += 7; }while(c & 0x80); return v; };
    const srcLen = varint(), dstLen = varint();
    if(srcLen !== base.length) throw new GitError('bad-pack', 'Delta: rozmiar bazy ' + base.length + ' ≠ ' + srcLen);
    const out = new Uint8Array(dstLen); let o = 0;
    while(p < delta.length){
      const op = delta[p++];
      if(op & 0x80){
        let off = 0, size = 0;
        if(op & 0x01) off |= delta[p++];
        if(op & 0x02) off |= delta[p++] << 8;
        if(op & 0x04) off |= delta[p++] << 16;
        if(op & 0x08) off = (off | (delta[p++] << 24)) >>> 0;
        if(op & 0x10) size |= delta[p++];
        if(op & 0x20) size |= delta[p++] << 8;
        if(op & 0x40) size |= delta[p++] << 16;
        if(size === 0) size = 0x10000;
        if(off + size > base.length || o + size > dstLen) throw new GitError('bad-pack', 'Delta: kopiowanie poza zakres');
        out.set(base.subarray(off, off + size), o); o += size;
      }else if(op){
        if(o + op > dstLen || p + op > delta.length) throw new GitError('bad-pack', 'Delta: wstawianie poza zakres');
        out.set(delta.subarray(p, p + op), o); o += op; p += op;
      }else throw new GitError('bad-pack', 'Delta: zarezerwowana instrukcja 0');
    }
    if(o !== dstLen) throw new GitError('bad-pack', 'Delta: wynik ' + o + ' ≠ ' + dstLen + ' bajtów');
    return out;
  }

  // LRU po bajtach (Map zachowuje kolejność wstawiania: pierwszy klucz = najdawniej używany)
  function lru(limit){
    const m = new Map(); let bytes = 0;
    return {
      get(k){ const v = m.get(k); if(v === undefined) return undefined; m.delete(k); m.set(k, v); return v.v; },
      set(k, v, size){
        if(size > limit / 4) return;
        const old = m.get(k); if(old){ bytes -= old.s; m.delete(k); }
        m.set(k, {v, s:size}); bytes += size;
        for(const [key, e] of m){ if(bytes <= limit) break; m.delete(key); bytes -= e.s; }
      },
      clear(){ m.clear(); bytes = 0; },
      get bytes(){ return bytes; },
    };
  }

  // kolejka priorytetowa commitów: nowszy czas committera pierwszy, remis → kolejność wstawienia (jak git log)
  function heap(){
    const a = [];
    const before = (x, y)=>x.time > y.time || (x.time === y.time && x.seq < y.seq);
    return {
      get size(){ return a.length; },
      push(x){ a.push(x); let i = a.length - 1; while(i > 0){ const p = (i - 1) >> 1; if(!before(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } },
      pop(){
        const top = a[0], last = a.pop();
        if(a.length){ a[0] = last; let i = 0; for(;;){ const l = 2*i + 1, r = l + 1; let m = i;
          if(l < a.length && before(a[l], a[m])) m = l; if(r < a.length && before(a[r], a[m])) m = r;
          if(m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
        return top;
      },
    };
  }

  // ---- paczki: .idx (v1 bez magii, v2 z magią \377tOc) ----
  function parseIdx(b, name){
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const bad = (why)=>new GitError('bad-pack', 'Uszkodzony indeks paczki ' + name + ': ' + why);
    let v2 = b.length >= 8 && dv.getUint32(0) === 0xff744f63;
    const fanAt = v2 ? 8 : 0;
    if(v2 && dv.getUint32(4) !== 2) throw bad('nieobsługiwana wersja ' + dv.getUint32(4));
    if(b.length < fanAt + 1024) throw bad('za krótki');
    const fan = new Array(256);
    for(let i=0; i<256; i++) fan[i] = dv.getUint32(fanAt + 4*i);
    const n = fan[255];
    const offsets = new Float64Array(n);
    let shaAt, stride;
    if(v2){
      shaAt = fanAt + 1024; stride = 20;
      const offAt = shaAt + n*24, bigAt = offAt + n*4;   // po SHA: CRC32 (4 B) i offsety 32-bit (MSB → tablica 64-bit)
      if(b.length < bigAt + 40) throw bad('za krótki');
      for(let i=0; i<n; i++){
        const v = dv.getUint32(offAt + 4*i);
        if(v & 0x80000000){
          const k = bigAt + 8*(v & 0x7fffffff);
          if(k + 8 > b.length) throw bad('offset 64-bit poza plikiem');
          offsets[i] = dv.getUint32(k) * 4294967296 + dv.getUint32(k + 4);
        }else offsets[i] = v;
      }
    }else{
      shaAt = 1024 + 4; stride = 24;                        // v1: wpisy [offset 4 B][sha 20 B]
      if(b.length < 1024 + n*24 + 40) throw bad('za krótki');
      for(let i=0; i<n; i++) offsets[i] = dv.getUint32(1024 + 24*i);
    }
    return {name, fan, n, shas:b, shaAt, stride, offsets, sorted:null};
  }
  function findInPack(pk, sb){
    const b0 = sb[0], S = pk.shas;
    let lo = b0 ? pk.fan[b0 - 1] : 0, hi = pk.fan[b0];
    while(lo < hi){
      const mid = (lo + hi) >>> 1, o = pk.shaAt + mid*pk.stride;
      let c = 0; for(let i=0; i<20; i++){ const d = S[o + i] - sb[i]; if(d){ c = d; break; } }
      if(c === 0) return mid;
      if(c < 0) lo = mid + 1; else hi = mid;
    }
    return -1;
  }
  // koniec obiektu = następny offset w paczce (ostatni: rozmiar paczki − 20 bajtów sumy SHA-1)
  function endOf(pk, off){
    const s = pk.sorted || (pk.sorted = Float64Array.from(pk.offsets).sort());   // przy pierwszym odczycie z paczki
    let lo = 0, hi = s.length;
    while(lo < hi){ const mid = (lo + hi) >>> 1; if(s[mid] <= off) lo = mid + 1; else hi = mid; }
    return lo < s.length ? s[lo] : pk.size - 20;
  }

  const TYPES = [null, 'commit', 'tree', 'blob', 'tag'];
  const BLOCK = 256 * 1024;                                 // odczyt paczki blokami: mniej wywołań File.slice w przeglądarce
  const MAX_DEPTH = 10000;

  // ---- repozytorium ----
  async function open(files){
    if(typeof DecompressionStream === 'undefined')
      throw new GitError('unsupported', 'Ta przeglądarka nie ma DecompressionStream — odczyt historii git wymaga nowszej przeglądarki.');
    const map = new Map();
    for(const f of files || []){
      if(!f || !f.file) continue;
      map.set(String(f.path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''), f.file);
    }
    if(!map.has('HEAD') && map.has('.git/HEAD')){                    // tolerancja: ścieżki z prefiksem .git/
      const m2 = new Map(); for(const [p, b] of map) if(p.startsWith('.git/')) m2.set(p.slice(5), b);
      map.clear(); for(const [p, b] of m2) map.set(p, b);
    }
    if(!map.has('HEAD')){
      const gf = map.get('.git') || map.get('');
      if(gf){ const t = await text(gf); if(/^gitdir:/m.test(t)) throw new GitError('gitdir-file', explainGitdirFile(t)); }
      throw new GitError('no-head', 'Brak pliku HEAD w katalogu .git — to nie jest kompletne repozytorium git.');
    }
    if(map.has('config')){
      const cfg = await text(map.get('config'));
      if(/^\s*objectformat\s*=\s*sha256\s*$/im.test(cfg)) throw new GitError('sha256', 'Repozytorium używa skrótów SHA-256 (objectformat = sha256) — obsługiwane są tylko repozytoria SHA-1.');
      if(/^\s*refstorage\s*=\s*reftable\s*$/im.test(cfg)) throw new GitError('no-head', 'Repozytorium trzyma refy w formacie reftable — ta wersja CodeMap czyta tylko pliki refs/ i packed-refs.');
    }

    // obiekty luźne i paczki
    const loose = new Map(), packs = [];
    const idxJobs = [];
    for(const [p, blob] of map){
      let m = /^objects\/([0-9a-f]{2})\/([0-9a-f]{38})$/.exec(p);
      if(m){ loose.set(m[1] + m[2], blob); continue; }
      m = /^objects\/pack\/(pack-[^/]+)\.idx$/.exec(p);
      if(m){
        const packBlob = map.get('objects/pack/' + m[1] + '.pack');
        if(!packBlob) continue;                             // indeks bez paczki (niepełna kopia) — pomijamy
        idxJobs.push(bytes(blob).then((b)=>{ const pk = parseIdx(b, m[1]); pk.blob = packBlob; pk.size = packBlob.size; packs.push(pk); }));
      }
    }
    await Promise.all(idxJobs);
    packs.sort((a, b)=>b.n - a.n);                          // największa paczka pierwsza — tam jest większość obiektów
    packs.forEach((pk, i)=>{ pk.i = i; });
    const alternates = map.has('objects/info/alternates');

    // refy: pliki luźne + packed-refs (linię nagłówka # i linie ^ = obiekt po odwinięciu taga pomijamy —
    // tagi adnotowane odwija readCommit)
    const packed = new Map();
    if(map.has('packed-refs')){
      for(const line of (await text(map.get('packed-refs'))).split(/\r?\n/)){
        if(!line || line[0] === '#' || line[0] === '^' || line.indexOf(' ') !== 40) continue;
        packed.set(line.slice(41).trim(), line.slice(0, 40));
      }
    }
    async function resolveRef(name, depth){
      if((depth || 0) > 8) return null;
      const f = map.get(name);
      if(f){
        const t = (await text(f)).trim();
        if(t.startsWith('ref:')) return resolveRef(t.slice(4).trim(), (depth || 0) + 1);
        if(isSha(t)) return t;
        return null;
      }
      return packed.get(name) || null;
    }

    const headText = (await text(map.get('HEAD'))).trim();
    let head;
    if(headText.startsWith('ref:')){
      const ref = headText.slice(4).trim();
      const sha = await resolveRef(ref);
      if(!sha) throw new GitError('no-head', 'Gałąź „' + ref.replace(/^refs\/heads\//, '') + '” nie ma jeszcze żadnego commita.');
      head = {ref, sha};
    }else if(isSha(headText)) head = {ref:null, sha:headText};
    else if(/^[0-9a-f]{64}$/.test(headText)) throw new GitError('sha256', 'Repozytorium używa skrótów SHA-256 — obsługiwane są tylko repozytoria SHA-1.');
    else throw new GitError('no-head', 'Nieczytelny plik HEAD: „' + headText.slice(0, 60) + '”.');

    const shallow = new Set();
    if(map.has('shallow')) for(const l of (await text(map.get('shallow'))).split(/\s+/)) if(isSha(l)) shallow.add(l);

    // ---- odczyt obiektów ----
    const stats = {objects:0};
    const objCache = lru(48 * 1024 * 1024);                 // zdekodowane obiekty (bazy delt się powtarzają)
    const blocks = lru(32 * 1024 * 1024);                   // bloki paczek (obietnice)
    const checked = new Set();

    function locate(sha){
      const sb = bytesOf(sha);
      for(const pk of packs){ const i = findInPack(pk, sb); if(i >= 0) return {pk, off:pk.offsets[i]}; }
      const lb = loose.get(sha);
      return lb ? {loose:lb} : null;
    }
    function missing(sha){
      return new GitError('missing-object', 'Brak obiektu ' + sha + ' w katalogu .git' +
        (alternates ? ' (repozytorium korzysta z objects/info/alternates — obiekty leżą w innym katalogu).' : ' (niepełna kopia albo częściowy klon).'));
    }
    async function readRange(pk, start, end){
      const b0 = Math.floor(start / BLOCK);
      if(end - start > BLOCK / 4 || Math.floor((end - 1) / BLOCK) !== b0) return bytes(pk.blob.slice(start, end));
      const key = pk.i + ':' + b0;
      let p = blocks.get(key);
      if(!p){
        p = bytes(pk.blob.slice(b0 * BLOCK, Math.min(pk.size, (b0 + 1) * BLOCK)));
        blocks.set(key, p, Math.min(BLOCK, pk.size - b0 * BLOCK));
        p.catch(()=>blocks.set(key, null, 0));
      }
      const blk = await p;
      return blk.subarray(start - b0 * BLOCK, end - b0 * BLOCK);
    }
    async function checkPack(pk){
      if(checked.has(pk)) return;
      const h = await readRange(pk, 0, 12);
      const dv = new DataView(h.buffer, h.byteOffset, 12);
      if(h.length < 12 || dv.getUint32(0) !== 0x5041434b || (dv.getUint32(4) !== 2 && dv.getUint32(4) !== 3))
        throw new GitError('bad-pack', 'Plik ' + pk.name + '.pack nie jest paczką gita.');
      checked.add(pk);
    }
    // surowy wpis paczki: typ, rozmiar po rozpakowaniu, baza delty, dane zlib
    async function readEntry(pk, off){
      await checkPack(pk);
      const end = endOf(pk, off);
      if(!(end > off) || end > pk.size) throw new GitError('bad-pack', 'Paczka ' + pk.name + ': zły offset ' + off);
      const b = await readRange(pk, off, end);
      let p = 0, c = b[p++];
      const type = (c >> 4) & 7;
      let size = c & 15, shift = 4;
      while(c & 0x80){ c = b[p++]; size += (c & 0x7f) * 2**shift; shift += 7; }
      let baseOff = null, baseSha = null;
      if(type === 6){                                       // OFS_DELTA: ujemny offset w kodowaniu gita
        c = b[p++]; let ofs = c & 0x7f;
        while(c & 0x80){ c = b[p++]; ofs = (ofs + 1) * 128 + (c & 0x7f); }
        baseOff = off - ofs;
        if(baseOff < 12) throw new GitError('bad-pack', 'Paczka ' + pk.name + ': baza delty poza paczką');
      }else if(type === 7){ baseSha = hexOf(b, p); p += 20; }   // REF_DELTA: sha bazy (inna paczka albo luźny)
      else if(!(type >= 1 && type <= 4)) throw new GitError('bad-pack', 'Paczka ' + pk.name + ': nieznany typ obiektu ' + type + ' @' + off);
      const z = await inflate(b.subarray(p));
      stats.objects++;
      if(z.data.length < size) throw new GitError('bad-pack', 'Paczka ' + pk.name + ': uszkodzony obiekt @' + off + (z.broken ? ' (' + z.broken.message + ')' : ''));
      return {type, data:z.data.length > size ? z.data.subarray(0, size) : z.data, baseOff, baseSha};
    }
    async function readLoose(sha, blob){
      const key = 'L' + sha;
      const hit = objCache.get(key); if(hit) return hit;
      const z = await inflate(await bytes(blob));
      stats.objects++;
      const d = z.data, sp = d.indexOf(0x20), nul = d.indexOf(0, sp + 1);
      const type = sp > 0 ? str(d, 0, sp) : '', size = +str(d, sp + 1, nul);
      if(sp < 0 || nul < 0 || !TYPES.includes(type) || !(d.length - nul - 1 >= size))
        throw new GitError('bad-pack', 'Uszkodzony obiekt luźny ' + sha + (z.broken ? ' (' + z.broken.message + ')' : ''));
      const obj = {type, data:d.subarray(nul + 1, nul + 1 + size)};
      objCache.set(key, obj, size + 64);
      return obj;
    }
    // obiekt z paczki: schodzimy łańcuchem delt do obiektu pełnego (albo z cache), potem nakładamy delty w górę.
    // Równoległe diffy często potrzebują tych samych baz — obiekty w trakcie dekodowania są w `pending`.
    // Żeby nie było zakleszczeń: łańcuch rejestruje i czeka na cudze obiekty tylko do pierwszego kroku REF_DELTA,
    // a wtedy wszystkie jego kroki idą w tej samej paczce ku MNIEJSZYM offsetom (czekanie zawsze „w dół”).
    const pending = new Map();
    function deferred(){
      let resolve, reject;
      const promise = new Promise((a, b)=>{ resolve = a; reject = b; });
      promise.catch(()=>{});
      return {promise, resolve, reject};
    }
    async function readPacked(pk, off){
      const key = pk.i + ':' + off;
      const hit = objCache.get(key); if(hit) return hit;
      const wait = pending.get(key); if(wait) return wait;
      const chain = [], mine = [];
      let base = null, curPk = pk, curOff = off, refStep = false;
      try{
        for(let depth = 0; ; depth++){
          if(depth > MAX_DEPTH) throw new GitError('bad-pack', 'Paczka ' + pk.name + ': zapętlony łańcuch delt');
          const k = curPk.i + ':' + curOff;
          if(depth){
            const c = objCache.get(k); if(c){ base = c; break; }
            const w = !refStep && pending.get(k); if(w){ base = await w; break; }
          }
          let d = null;
          if(!refStep){ d = deferred(); pending.set(k, d.promise); mine.push([k, d]); }
          const e = await readEntry(curPk, curOff);
          if(e.type <= 4){ base = {type:TYPES[e.type], data:e.data}; objCache.set(k, base, e.data.length + 64); if(d) d.resolve(base); break; }
          chain.push({k, delta:e.data, d});
          if(e.type === 6){ curOff = e.baseOff; continue; }
          refStep = true;
          const loc = locate(e.baseSha);
          if(!loc) throw missing(e.baseSha);
          if(loc.loose){ base = await readLoose(e.baseSha, loc.loose); break; }
          curPk = loc.pk; curOff = loc.off;
        }
        for(let i = chain.length - 1; i >= 0; i--){
          base = {type:base.type, data:applyDelta(base.data, chain[i].delta)};
          objCache.set(chain[i].k, base, base.data.length + 64);
          if(chain[i].d) chain[i].d.resolve(base);
        }
        return base;
      }catch(err){
        for(const [, d] of mine) d.reject(err);
        throw err;
      }finally{
        for(const [k, d] of mine) if(pending.get(k) === d.promise) pending.delete(k);
      }
    }
    async function readObject(sha){
      sha = String(sha || '').toLowerCase();
      if(!isSha(sha)) throw new GitError('missing-object', 'Niepoprawny identyfikator obiektu: „' + sha + '”');
      const loc = locate(sha);
      if(!loc) throw missing(sha);
      return loc.loose ? readLoose(sha, loc.loose) : readPacked(loc.pk, loc.off);
    }

    // ---- commity i drzewa ----
    function decoderFor(enc){
      if(!enc || /^utf-?8$/i.test(enc)) return utf8;
      try{ return new TextDecoder(enc); }catch(e){ return utf8; }
    }
    function person(s){
      const lt = s.indexOf('<'), gt = lt >= 0 ? s.indexOf('>', lt) : -1;
      if(lt < 0 || gt < 0) return {name:s.trim(), email:'', time:0};
      const t = parseInt(s.slice(gt + 1).trim().split(' ')[0], 10);
      return {name:s.slice(0, lt).trim(), email:s.slice(lt + 1, gt).trim(), time:isFinite(t) ? t * 1000 : 0};
    }
    function parseCommit(sha, d){
      const n = d.length; let p = 0;
      let tree = null, a = null, c = null, enc = null; const parents = [];
      while(p < n){
        let e = d.indexOf(10, p); if(e < 0) e = n;
        if(e === p){ p++; break; }                          // pusta linia → dalej wiadomość
        if(d[p] !== 0x20){                                  // linie od spacji = kontynuacja (gpgsig, mergetag)
          let sp = d.indexOf(0x20, p); if(sp < 0 || sp > e) sp = e;
          const key = str(d, p, sp);
          if(key === 'tree') tree = str(d, sp + 1, e);
          else if(key === 'parent') parents.push(str(d, sp + 1, e));
          else if(key === 'author') a = d.subarray(sp + 1, e);
          else if(key === 'committer') c = d.subarray(sp + 1, e);
          else if(key === 'encoding') enc = str(d, sp + 1, e).trim();
        }
        p = e + 1;
      }
      const dec = decoderFor(enc);
      let me = d.indexOf(10, p); if(me < 0) me = n;
      const author = person(a ? dec.decode(a) : ''), committer = person(c ? dec.decode(c) : '');
      return {sha, tree, parents, author, committer, message:dec.decode(d.subarray(p, me)).replace(/\r$/, '')};
    }
    async function readCommit(sha){
      const loc = locate(sha);
      if(!loc) return null;
      let o = await (loc.loose ? readLoose(sha, loc.loose) : readPacked(loc.pk, loc.off));
      for(let i = 0; o.type === 'tag' && i < 10; i++){      // tag adnotowany → obiekt, na który wskazuje
        const m = /^object ([0-9a-f]{40})/.exec(str(o.data, 0, Math.min(o.data.length, 48)));
        if(!m) break; sha = m[1]; o = await readObject(sha);
      }
      if(o.type !== 'commit') throw new GitError('missing-object', 'Obiekt ' + sha + ' to ' + o.type + ', a nie commit.');
      return parseCommit(sha, o.data);
    }

    // drzewo → [{name, ord, sha, k:'t'|'b'|'g', m:tryb}] + flaga ascii; ord = klucz kolejności gita (katalog z '/' na końcu).
    // Cache po sha (z obietnicami, żeby równoległe diffy nie dublowały pracy).
    const trees = new Map(); let treeEntries = 0;
    const TREE_LIMIT = 300000;
    function parseTree(d){
      const out = []; let p = 0, ascii = true; const n = d.length;
      const s = latin1 ? latin1.decode(d) : null;           // jeden natywny odczyt na drzewo; indeksy znaków = bajtów
      while(p < n){
        const sp = d.indexOf(0x20, p), nul = sp < 0 ? -1 : d.indexOf(0, sp + 1);
        if(sp < 0 || nul < 0 || nul + 21 > n) throw new GitError('bad-pack', 'Uszkodzone drzewo');
        let m = 0; for(let i=p; i<sp; i++) m = m*8 + (d[i] - 48);
        const t = m & 0o170000, k = t === 0o040000 ? 't' : t === 0o160000 ? 'g' : 'b';
        let name = s ? s.slice(sp + 1, nul) : str(d, sp + 1, nul);
        if(NON_ASCII.test(name)){ ascii = false; if(s) name = utf8.decode(d.subarray(sp + 1, nul)); }
        out.push({name, ord:k === 't' ? name + '/' : name, sha:hexOf(d, nul + 1), k, m});
        p = nul + 21;
      }
      out.ascii = ascii;
      return out;
    }
    function tree(sha){
      const hit = trees.get(sha);
      if(hit){ trees.delete(sha); trees.set(sha, hit); return hit; }
      const p = readObject(sha).then((o)=>{
        if(o.type !== 'tree') throw new GitError('missing-object', 'Obiekt ' + sha + ' to ' + o.type + ', a nie drzewo.');
        return parseTree(o.data);
      });
      trees.set(sha, p);
      p.then((t)=>{
        if(trees.get(sha) !== p) return;
        trees.set(sha, t); treeEntries += t.length;
        for(const [k, v] of trees){ if(treeEntries <= TREE_LIMIT) break; if(Array.isArray(v)){ treeEntries -= v.length; trees.delete(k); } }
      }, ()=>{ trees.delete(sha); });
      return p;
    }
    const EMPTY = [];
    // różnice drzew; schodzi tylko do poddrzew o różnym sha. Wynik: płaska lista {path, status, sha?, oldSha?}
    async function diffTrees(oldSha, newSha, prefix, out){
      const [a, b] = await Promise.all([oldSha ? tree(oldSha) : EMPTY, newSha ? tree(newSha) : EMPTY]);
      const sub = [];
      const add = (e)=>{ const path = prefix + e.name; if(e.k === 't') sub.push(diffTrees(null, e.sha, path + '/', out)); else if(e.k === 'b') out.push({path, status:'A', sha:e.sha}); };
      const del = (o)=>{ const path = prefix + o.name; if(o.k === 't') sub.push(diffTrees(o.sha, null, path + '/', out)); else if(o.k === 'b') out.push({path, status:'D', oldSha:o.sha}); };
      const change = (o, e)=>{
        if(o.sha === e.sha && o.m === e.m) return;
        if(o.k === 't' && e.k === 't') sub.push(diffTrees(o.sha, e.sha, prefix + e.name + '/', out));
        else if(o.k === 'b' && e.k === 'b') out.push({path:prefix + e.name, status:'M', sha:e.sha, oldSha:o.sha});
        else{ del(o); add(e); }                             // zmiana rodzaju (plik ↔ submoduł)
      };
      if(a.ascii !== false && b.ascii !== false){
        // oba drzewa posortowane w kolejności gita — scalanie dwoma wskaźnikami (dla ASCII porównanie
        // napisów = porównanie bajtów; plik „a” i katalog „a/” to różne klucze → D + A)
        let i = 0, j = 0;
        while(i < a.length && j < b.length){
          const o = a[i], e = b[j];
          if(o.ord === e.ord){ i++; j++; change(o, e); }
          else if(o.ord < e.ord){ i++; del(o); }
          else{ j++; add(e); }
        }
        for(; i < a.length; i++) del(a[i]);
        for(; j < b.length; j++) add(b[j]);
      }else{
        const olds = new Map(); for(const o of a) olds.set(o.ord, o);   // nazwy spoza ASCII: parowanie przez mapę
        for(const e of b){ const o = olds.get(e.ord); if(o){ olds.delete(e.ord); change(o, e); } else add(e); }
        for(const o of olds.values()) del(o);
      }
      if(sub.length) await Promise.all(sub);
      return out;
    }
    // dokładne zmiany nazw: usunięta i dodana ścieżka z tym samym blobem → R (przy kilku kandydatach ta sama nazwa pliku)
    function pairRenames(files){
      const dels = new Map();
      files.forEach((f, i)=>{ if(f.status === 'D'){ const l = dels.get(f.oldSha); if(l) l.push(i); else dels.set(f.oldSha, [i]); } });
      if(!dels.size) return files;
      const drop = new Set(), base = (p)=>p.slice(p.lastIndexOf('/') + 1);
      for(const f of files){
        if(f.status !== 'A') continue;
        const c = dels.get(f.sha); if(!c || !c.length) continue;
        let k = c.findIndex((i)=>base(files[i].path) === base(f.path)); if(k < 0) k = 0;
        const i = c.splice(k, 1)[0];
        drop.add(i); f.status = 'R'; f.from = files[i].path; f.oldSha = files[i].oldSha;
      }
      return drop.size ? files.filter((_, i)=>!drop.has(i)) : files;
    }
    // zmiany nazw z edycją (jak git -M50%): pozostałe pary usunięty × dodany w commicie, podobieństwo linii
    // (2·wspólne / suma, wielozbiór skrótów linii), tylko tekst ≤ 1 MB, zachłannie od najlepszej pary, przy remisie ta
    // sama nazwa pliku. Limity: najwyżej SIM_PAIRS par na commit i SIM_BUDGET odczytów blobów na całą historię.
    const SIM_MIN = 0.5, SIM_PAIRS = 400, SIM_MAX = 1 << 20; let simBudget = 4000;
    const bagCache = new Map();
    async function lineBag(sha){
      if(bagCache.has(sha)) return bagCache.get(sha);
      if(simBudget-- <= 0) return null;
      let bag = null;
      try{
        const o = await readObject(sha), d = o && o.type === 'blob' ? o.data : null;
        if(d && d.length <= SIM_MAX && d.subarray(0, 8000).indexOf(0) < 0){   // NUL w nagłówku = binarny
          bag = new Map(); let n = 0, h = 0x811c9dc5, empty = true;
          for(let i = 0; i <= d.length; i++){
            const c = i < d.length ? d[i] : 10;
            if(c === 10){ if(!empty){ bag.set(h >>> 0, (bag.get(h >>> 0) || 0) + 1); n++; } h = 0x811c9dc5; empty = true; }
            else if(c !== 13 && c !== 32 && c !== 9){ h ^= c; h = Math.imul(h, 0x01000193); empty = false; }   // bez białych znaków
          }
          bag.n = n;
        }
      }catch(e){ bag = null; }
      if(bagCache.size > 2000) bagCache.clear();
      bagCache.set(sha, bag);
      return bag;
    }
    function similarity(a, b){
      if(!a || !b || !(a.n + b.n)) return 0;
      let common = 0; const [s, l] = a.size < b.size ? [a, b] : [b, a];
      for(const [k, c] of s){ const d = l.get(k); if(d) common += Math.min(c, d); }
      return 2 * common / (a.n + b.n);
    }
    async function pairSimilar(files){
      const dels = [], adds = [];
      files.forEach((f, i)=>{ if(f.status === 'D' && f.oldSha) dels.push(i); else if(f.status === 'A' && f.sha) adds.push(i); });
      if(!dels.length || !adds.length || dels.length * adds.length > SIM_PAIRS) return files;
      const base = (p)=>p.slice(p.lastIndexOf('/') + 1), pairs = [];
      const bags = new Map();
      for(const i of dels.concat(adds)){ const f = files[i], sha = f.status === 'D' ? f.oldSha : f.sha; if(!bags.has(sha)) bags.set(sha, await lineBag(sha)); }
      for(const i of dels) for(const j of adds){
        const s = similarity(bags.get(files[i].oldSha), bags.get(files[j].sha));
        if(s >= SIM_MIN) pairs.push({i, j, s, same: base(files[i].path) === base(files[j].path)});
      }
      if(!pairs.length) return files;
      pairs.sort((x, y)=>(y.s - x.s) || (y.same - x.same));
      const usedD = new Set(), usedA = new Set();
      for(const p of pairs){
        if(usedD.has(p.i) || usedA.has(p.j)) continue;
        usedD.add(p.i); usedA.add(p.j);
        const f = files[p.j]; f.status = 'R'; f.from = files[p.i].path; f.oldSha = files[p.i].oldSha; f.similarity = Math.round(p.s * 100);
      }
      return files.filter((_, i)=>!usedD.has(i));
    }
    async function changedFiles(treeSha, parentTree){
      const files = await diffTrees(parentTree, treeSha, '', []);
      files.sort((x, y)=>(x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
      return pairSimilar(pairRenames(files));
    }

    async function startSha(ref){
      if(!ref || ref === 'HEAD') return head.sha;
      ref = String(ref);
      if(isSha(ref)) return ref;
      for(const c of [ref, 'refs/' + ref, 'refs/tags/' + ref, 'refs/heads/' + ref, 'refs/remotes/' + ref, 'refs/remotes/' + ref + '/HEAD']){
        const sha = await resolveRef(c); if(sha) return sha;
      }
      throw new GitError('no-head', 'Nie znaleziono refa „' + ref + '”.');
    }

    // historia: kolejka po czasie committera, deduplikacja, limit max; diffy do WINDOW commitów naraz
    const WINDOW = 8;
    async function walk(opts){
      opts = opts || {};
      const max = opts.max > 0 ? Math.floor(opts.max) : 2000;
      const signal = opts.signal, onProgress = opts.onProgress;
      const t0 = now();
      const cancelled = ()=>new GitError('cancelled', 'Przerwano czytanie historii git.');
      if(signal && signal.aborted) throw cancelled();
      const start = await startSha(opts.ref);
      const first = await readCommit(start);
      if(!first) throw missing(start);
      const q = heap(), seen = new Set([first.sha]), treeOf = new Map([[first.sha, first.tree]]), absent = new Set();
      let seq = 0, failure = null, lastYield = now();
      first.time = first.committer.time; first.seq = seq++;
      q.push(first);
      const out = [], inflight = new Set();
      while(q.size && out.length < max){
        if(signal && signal.aborted) throw cancelled();
        if(failure) throw failure;
        const c = q.pop();
        const hidden = shallow.has(c.sha);                  // płytki klon: git traktuje ten commit jak korzeń
        let boundary = hidden && c.parents.length > 0;
        for(const p of hidden ? [] : c.parents){
          if(seen.has(p)) continue;
          seen.add(p);
          const pc = await readCommit(p);
          if(!pc){ absent.add(p); continue; }
          pc.time = pc.committer.time; pc.seq = seq++;
          treeOf.set(p, pc.tree); q.push(pc);
        }
        const merge = !hidden && c.parents.length > 1;
        let parentTree = null;
        if(!hidden && c.parents.length){
          if(absent.has(c.parents[0])) boundary = true;     // rodzica brak w obiektach → pliki względem pustego drzewa
          else parentTree = treeOf.get(c.parents[0]) || null;
        }
        const rec = {sha:c.sha, parents:c.parents.slice(), merge, boundary,
          author:{name:c.author.name, email:c.author.email}, authorTime:c.author.time,
          committer:{name:c.committer.name, email:c.committer.email}, time:c.committer.time,
          message:c.message, files:[]};
        out.push(rec);
        if(!merge){
          const job = changedFiles(c.tree, parentTree).then((f)=>{ rec.files = f; }, (e)=>{ failure = failure || e; });
          inflight.add(job); job.then(()=>inflight.delete(job));
          if(inflight.size >= WINDOW) await Promise.race(inflight);
        }
        if(out.length % 25 === 0){
          if(onProgress) onProgress({done:out.length, total:max});
          if(now() - lastYield > 30){ await yieldTask(); lastYield = now(); }   // okno / komunikat 'cancel'
        }
      }
      await Promise.all(inflight);
      if(failure) throw failure;
      if(signal && signal.aborted) throw cancelled();
      if(onProgress && out.length % 25 !== 0) onProgress({done:out.length, total:max});
      return {commits:out, truncated:q.size > 0, ms:Math.round(now() - t0)};
    }

    // lista gałęzi i tagów (bez refów symbolicznych), posortowana po nazwie
    async function refs(){
      const names = new Set(packed.keys());
      for(const p of map.keys()) if(p.startsWith('refs/')) names.add(p);
      const out = [];
      for(const name of [...names].sort()){
        const f = map.get(name);
        if(f && (await text(f)).trim().startsWith('ref:')) continue;
        const sha = await resolveRef(name); if(sha) out.push({name, sha});
      }
      return out;
    }

    return {
      head, stats, shallow:shallow.size > 0,
      readObject, refs, walk,
      async log(opts){ return (await walk(opts)).commits; },
    };
  }

  // ---- plik .git zamiast katalogu (worktree / submoduł) ----
  function explainGitdirFile(t){
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(String(t || ''));
    if(!m) return 'Zamiast katalogu .git jest plik, który nie wskazuje repozytorium (brak „gitdir:”) — historia commitów jest niedostępna.';
    const dir = m[1].replace(/\\/g, '/');
    if(/\/worktrees\/[^/]+\/?$/.test(dir))
      return 'Ten folder to dodatkowe drzewo robocze (git worktree): zamiast katalogu .git ma plik wskazujący na „' + dir + '”. Przeglądarka widzi tylko wczytany folder — żeby zobaczyć historię, wczytaj folder głównego repozytorium (ten z katalogiem .git).';
    if(/\/modules\//.test(dir))
      return 'Ten folder to submoduł: zamiast katalogu .git ma plik wskazujący na „' + dir + '” w repozytorium nadrzędnym. Przeglądarka widzi tylko wczytany folder, więc historii submodułu nie da się odczytać — sklonuj go osobno albo wczytaj jako samodzielne repozytorium.';
    return 'Katalog .git leży gdzie indziej (plik .git wskazuje na „' + dir + '”). Przeglądarka widzi tylko wczytany folder — historii nie da się odczytać.';
  }

  // ---- run: w oknie przez Worker, bez niego (albo gdy padnie przy starcie) w bieżącym wątku ----
  const V = (()=>{ try{ const d = root.document; if(!d) return '';
    const s = d.currentScript || (d.querySelector && d.querySelector('script[src*="js/git-local.js"]'));
    return (s && s.src && (s.src.match(/[?&]v=([\w.-]+)/) || [])[1]) || ''; }catch(e){ return ''; } })();
  const WORKER_URL = 'js/git-worker.js' + (V ? '?v=' + V : '');
  let jobSeq = 0;

  async function runInThread(files, opts){
    opts = opts || {};
    const t0 = now();
    const repo = await open(files);
    const r = await repo.walk(opts);
    return {head:repo.head, commits:r.commits, stats:{objects:repo.stats.objects, ms:Math.round(now() - t0), truncated:r.truncated}};
  }
  function viaWorker(files, opts){
    return new Promise((resolve, reject)=>{
      let w; try{ w = new Worker(WORKER_URL); }catch(e){ resolve(null); return; }
      const id = ++jobSeq, signal = opts.signal;
      let started = false, finished = false;
      const finish = (fn, v)=>{
        if(finished) return; finished = true;
        if(signal) signal.removeEventListener('abort', onAbort);
        try{ w.terminate(); }catch(e){}
        fn(v);
      };
      const onAbort = ()=>{ try{ w.postMessage({type:'cancel', id}); }catch(e){} finish(reject, new GitError('cancelled', 'Przerwano czytanie historii git.')); };
      w.onerror = (e)=>{ if(e && e.preventDefault) e.preventDefault(); if(!started) finish(resolve, null); else finish(reject, new GitError('error', 'git-worker: ' + ((e && e.message) || 'błąd'))); };
      w.onmessage = (ev)=>{
        const d = ev.data || {}; if(d.id !== id) return; started = true;
        if(d.type === 'progress'){ if(opts.onProgress) opts.onProgress({done:d.done, total:d.total}); }
        else if(d.type === 'done') finish(resolve, {head:d.head, commits:d.commits, stats:d.stats});
        else if(d.type === 'error') finish(reject, new GitError(d.code || 'error', d.message));
      };
      if(signal){ if(signal.aborted){ onAbort(); return; } signal.addEventListener('abort', onAbort); }
      try{ w.postMessage({type:'log', id, files:(files || []).map((f)=>({path:f.path, file:f.file})), opts:{max:opts.max, ref:opts.ref}}); }
      catch(e){ finish(resolve, null); }                    // np. DataCloneError — ten sam odczyt w wątku
    });
  }
  async function run(files, opts){
    opts = opts || {};
    if(opts.signal && opts.signal.aborted) throw new GitError('cancelled', 'Przerwano czytanie historii git.');
    if(root.document && typeof Worker !== 'undefined'){
      const r = await viaWorker(files, opts);
      if(r) return r;
    }
    return runInThread(files, opts);
  }

  CM.GitLocal = { open, run, runInThread, explainGitdirFile, GitError, workerUrl:WORKER_URL,
    _internals:{ applyDelta, inflate, parseIdx } };
})(typeof self !== 'undefined' ? self : this);
