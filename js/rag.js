/* ===================== rag.js — wyszukiwanie w kodzie projektu (RAG) ===================== */
// Odpowiedzi ChatBota ugruntowane w kodzie: pliki dzielone na fragmenty wg granic symboli, wyszukiwanie
//  • leksykalne BM25 (zawsze, bez modelu; identyfikatory camelCase/snake_case rozbijane, pytania po polsku
//    rozszerzane o angielskie odpowiedniki pojęć programistycznych),
//  • semantyczne — embeddingi z lokalnej Ollamy (bge-m3, nomic-embed-text…), gdy jest model embeddingów;
//    wynik hybrydowy łączy oba. Wektory w IndexedDB, przeliczane tylko dla zmienionych fragmentów.
// Treść plików trafia WYŁĄCZNIE do modeli lokalnych (WebLLM / Ollama) — polityka prywatności z README.
CM.RAG = (function(){
  const U=CM.util;
  const T=(k,f)=>(CM.i18n&&CM.i18n.t)?CM.i18n.t(k,f):f;

  // ---------------- tokenizacja ----------------
  const STOP=new Set(('the a an and or of to in on for is are be it this that with as by from at not no if else then return '+
    'const let var function class new true false null undefined def self public private static void int string '+
    'jak jaki jaka jakie gdzie czy co ten ta to te jest są się w we na do z ze od po dla nie i a o że który która które '+
    'mi mnie jest być może można proszę pokaż wyjaśnij opisz działa działanie kod kodzie pliku plik projekt projekcie').split(' '));
  function splitIdent(w){ return w.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2').split(/[\s_\-$]+/); }
  function tokenize(s){
    const out=[];
    for(const raw of String(s||'').split(/[^A-Za-z0-9_$À-ſ]+/)){
      if(!raw) continue;
      const parts=splitIdent(raw);
      const whole=raw.toLowerCase();
      if(parts.length>1 && whole.length>=3 && !STOP.has(whole)) out.push(whole);   // pełny identyfikator też
      for(const p of parts){ const w=p.toLowerCase(); if(w.length<2 || STOP.has(w) || /^\d+$/.test(w)) continue; out.push(w); }
    }
    return out;
  }
  // polskie pojęcia → angielskie identyfikatory (rdzeń: prefiks słowa w pytaniu)
  const PL_EN=[['import','import imports require'],['zależn','dependency dependencies deps import'],['pars','parse parser parsing'],
    ['rysow','draw render canvas'],['render','render draw'],['wykres','graph chart'],['graf','graph node edge'],['węzeł','node'],['węzł','node nodes'],
    ['krawęd','edge edges link'],['plik','file files path'],['folder','folder dir directory'],['katalog','dir directory folder'],
    ['ścieżk','path'],['układ','layout'],['kolor','color colour'],['motyw','theme'],['ustawien','settings config'],['konfigur','config settings'],
    ['zapis','save write store persist'],['odczyt','read load'],['wczyt','load read ingest'],['ładow','load'],['pobier','fetch download'],
    ['wyszuk','search find query'],['szuk','search find'],['filtr','filter'],['sortow','sort'],['błęd','error err exception'],['wyjąt','exception error catch'],
    ['test','test tests spec'],['pokryc','coverage'],['historia','history commit log'],['commit','commit'],['autor','author'],
    ['użytkown','user'],['logow','login auth session'],['hasł','password'],['szyfr','encrypt crypto cipher'],['klucz','key'],
    ['sieć','network fetch http'],['zapyta','request query'],['odpowied','response reply'],['czat','chat message'],['wiadomoś','message'],
    ['model','model'],['szablon','template'],['przycisk','button'],['okno','window modal panel'],['panel','panel'],['menu','menu'],
    ['mysz','mouse pointer'],['klawisz','key keyboard shortcut'],['skrót','shortcut'],['zoom','zoom'],['przybliż','zoom'],['obrót','rotate'],
    ['kamer','camera'],['symul','sim simulation physics'],['fizyk','physics force'],['worker','worker'],['wątek','worker thread'],
    ['pamięć','cache memory storage'],['migawk','snapshot'],['porówn','compare diff'],['różnic','diff'],['metryk','metric metrics'],
    ['złożon','complexity'],['cykl','cycle cycles'],['eksport','export'],['tłumacz','i18n translate'],['język','lang language'],
    ['symbol','symbol symbols'],['wywoła','call calls'],['funkcj','function'],['klas','class'],['metod','method'],['zmienn','variable var']];
  function queryTokens(q){
    const base=tokenize(q), out=base.slice();
    const words=String(q||'').toLowerCase().split(/[^a-z0-9À-ſ]+/).filter(Boolean);
    for(const w of words) for(const [stem,en] of PL_EN) if(w.startsWith(stem)) out.push(...en.split(' '));
    return [...new Set(out)];
  }

  // ---------------- fragmenty (chunki) ----------------
  // granice z symboli analizy (n.symbols: {name, kind, line}); długie fragmenty dzielone oknem 60 linii
  const MIN_LINES=18, MAX_LINES=80, WIN=60, OVER=10, MAX_CHARS=2400;
  const SKIP_FILE=/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]+\.min\.(js|css)|[^/]+\.map)$/i;
  function chunkFile(n){
    const text=n&&n.preview; if(!text || n.type!=='file' || SKIP_FILE.test(n.path||'')) return [];
    const m=n.metrics; if(m && (m.longest>2500 || (m.lines>1 && m.chars/m.lines>600))) return [];   // zminifikowane
    const lines=String(text).split('\n'); const N=lines.length; if(!N || !String(text).trim()) return [];
    const syms=(n.symbols||[]).filter(s=>s&&s.line>=1&&s.line<=N).sort((a,b)=>a.line-b.line);
    const segs=[];
    if(syms.length){
      const starts=[1, ...syms.map(s=>s.line)].filter((v,i,a)=>i===0||v>a[i-1]);
      for(let i=0;i<starts.length;i++){ const a=starts[i], b=(i+1<starts.length?starts[i+1]-1:N); if(b>=a) segs.push({a,b, sym:(syms.find(s=>s.line===a)||{}).name||''}); }
      // scal krótkie sąsiednie odcinki
      const merged=[]; for(const s of segs){ const last=merged[merged.length-1];
        if(last && (last.b-last.a+1)<MIN_LINES && (s.b-last.a+1)<=MAX_LINES){ last.b=s.b; if(!last.sym) last.sym=s.sym; else if(s.sym) last.sym+=', '+s.sym; }
        else merged.push(Object.assign({}, s)); }
      segs.length=0; segs.push(...merged);
    } else segs.push({a:1, b:N, sym:''});
    const out=[];
    for(const s of segs){
      if(s.b-s.a+1<=MAX_LINES) out.push(s);
      else for(let a=s.a; a<=s.b; a+=WIN-OVER){ out.push({a, b:Math.min(s.b, a+WIN-1), sym:s.sym}); if(a+WIN-1>=s.b) break; }
    }
    return out.map(s=>{ const body=lines.slice(s.a-1, s.b).join('\n');
      return {path:n.path, id:n.id, start:s.a, end:s.b, sym:s.sym, lang:n.lang||'', text:body.length>MAX_CHARS?body.slice(0,MAX_CHARS):body}; })
      .filter(c=>c.text.trim().length>=20);
  }

  // ---------------- BM25 ----------------
  function buildLexical(chunks){
    const docs=[], df=new Map(); let total=0;
    for(const c of chunks){
      // ścieżka i nazwy symboli ważą podwójnie (pytania często trafiają w nazwy plików / funkcji)
      const toks=tokenize(c.text).concat(tokenize(c.path+' '+c.sym), tokenize(c.path+' '+c.sym));
      const tf=new Map(); for(const t of toks) tf.set(t,(tf.get(t)||0)+1);
      for(const t of tf.keys()) df.set(t,(df.get(t)||0)+1);
      docs.push({tf, len:toks.length}); total+=toks.length;
    }
    return {docs, df, N:docs.length, avg:docs.length?total/docs.length:1};
  }
  function bm25(lex, qt, k1, b){
    k1=k1||1.2; b=b==null?0.75:b;
    const sc=new Float32Array(lex.N);
    for(const t of qt){ const n=lex.df.get(t); if(!n) continue;
      const idf=Math.log(1+(lex.N-n+0.5)/(n+0.5));
      for(let i=0;i<lex.N;i++){ const f=lex.docs[i].tf.get(t); if(!f) continue;
        sc[i]+=idf*(f*(k1+1))/(f+k1*(1-b+b*lex.docs[i].len/lex.avg)); } }
    return sc;
  }
  // wynik hybrydowy: max-normalizacja BM25 i kosinusa w puli kandydatów (top z obu list)
  function rank(lexScores, cos, k, alpha){
    alpha=alpha==null?0.6:alpha;
    const N=lexScores.length, idx=[...Array(N).keys()];
    const topL=idx.slice().sort((a,b)=>lexScores[b]-lexScores[a]).slice(0,60).filter(i=>lexScores[i]>0);
    let pool=new Set(topL);
    if(cos){ const topC=idx.slice().sort((a,b)=>cos[b]-cos[a]).slice(0,60); topC.forEach(i=>pool.add(i)); }
    pool=[...pool];
    const lMax=Math.max(1e-9, ...pool.map(i=>lexScores[i]));
    let cMin=Infinity, cMax=-Infinity; if(cos) for(const i of pool){ cMin=Math.min(cMin,cos[i]); cMax=Math.max(cMax,cos[i]); }
    const span=Math.max(1e-9, cMax-cMin);
    const scored=pool.map(i=>({i, score:cos?(alpha*((cos[i]-cMin)/span)+(1-alpha)*(lexScores[i]/lMax)):lexScores[i]/lMax}));
    scored.sort((a,b)=>b.score-a.score);
    return scored.slice(0,k);
  }
  function dot(a, off, q){ let s=0; for(let j=0;j<q.length;j++) s+=a[off+j]*q[j]; return s; }
  function normalize(v){ let s=0; for(const x of v) s+=x*x; s=Math.sqrt(s)||1; const o=new Float32Array(v.length); for(let i=0;i<v.length;i++) o[i]=v[i]/s; return o; }

  // różnorodność: najwyżej 2 fragmenty z jednego pliku, sąsiednie fragmenty scalone
  function diversify(hits, chunks, k){
    const per=new Map(), out=[];
    for(const h of hits){ const c=chunks[h.i]; const n=per.get(c.path)||0; if(n>=2) continue; per.set(c.path,n+1); out.push(h); if(out.length>=k) break; }
    return out;
  }
  // blok kontekstu do promptu + lista źródeł [n] → plik:linie
  function contextBlock(hits, chunks, budget){
    budget=budget||6000; const parts=[], sources=[]; let used=0;
    for(const h of hits){ const c=chunks[h.i];
      const head='['+(sources.length+1)+'] '+c.path+':'+c.start+'-'+c.end+(c.sym?' ('+c.sym.slice(0,80)+')':'');
      let body=c.text; const room=budget-used-head.length-16; if(room<200) break;
      if(body.length>room) body=body.slice(0,room)+'\n…';
      parts.push(head+'\n```'+(c.lang||'')+'\n'+body+'\n```'); used+=head.length+body.length+16;
      sources.push({n:sources.length+1, id:c.id, path:c.path, start:c.start, end:c.end, sym:c.sym||'', score:+h.score.toFixed(3)});
    }
    return {text:parts.join('\n\n'), sources};
  }
  // prefiksy zapytań/dokumentów wymagane przez niektóre modele embeddingów
  function prefixes(model){
    const m=String(model||'').toLowerCase();
    if(/nomic/.test(m)) return {q:'search_query: ', d:'search_document: '};
    if(/mxbai|mixedbread/.test(m)) return {q:'Represent this sentence for searching relevant passages: ', d:''};
    if(/(^|\W)e5|multilingual-e5/.test(m)) return {q:'query: ', d:'passage: '};
    if(/arctic/.test(m)) return {q:'Represent this sentence for searching relevant passages: ', d:''};
    return {q:'', d:''};
  }
  function docText(c, pre){ return (pre||'')+c.path+(c.sym?' — '+c.sym:'')+'\n'+c.text.slice(0,1800); }

  // ================= część przeglądarkowa: indeks bieżącego projektu =================
  let S=null;          // {graph, key, chunks, lex, model, dim, vecs:Float32Array|null, status, hashes}
  let building=null;   // {ctrl, model}
  function projectKey(g){ const m=(g&&g.meta)||{}; return String(m.source||m.name||'projekt'); }
  const tick=()=>new Promise(r=>setTimeout(r,0));
  async function ensure(graph){
    graph=graph||(CM.App&&CM.App.graph); if(!graph||!graph.nodes) return null;
    if(S && S.graph===graph && S.n===graph.nodes.size) return S;
    const chunks=[]; let k=0;
    for(const n of graph.nodes.values()){ if(n.type!=='file'||(n.gid&&n.gid!=='base')) continue; const cs=chunkFile(n); for(const c of cs) chunks.push(c); if((++k&127)===0) await tick(); if(chunks.length>40000) break; }
    const lex=buildLexical(chunks);
    for(const c of chunks) c.hash=U.hashString(c.path+'\n'+c.text);
    S={graph, n:graph.nodes.size, key:projectKey(graph), chunks, lex, model:null, dim:0, vecs:null};
    await loadVectors();
    return S;
  }
  function reset(){ if(building){ try{ building.ctrl.abort(); }catch(e){} building=null; } S=null; }
  function stats(){ return S?{chunks:S.chunks.length, files:new Set(S.chunks.map(c=>c.path)).size, model:S.model, vectors:!!S.vecs, dim:S.dim, building:!!building}:{chunks:0, files:0, vectors:false, building:!!building}; }

  // ---- IndexedDB: wektory per projekt + model, klucz fragmentu = hash treści ----
  const DB='codemap-rag', STORE='vec';
  function db(){ return new Promise(res=>{ try{ const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); }catch(e){ res(null); } }); }
  async function idbGet(k){ const d=await db(); if(!d) return null; return new Promise(res=>{ try{ const q=d.transaction(STORE,'readonly').objectStore(STORE).get(k); q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null); }catch(e){ res(null); } }); }
  async function idbPut(k,v){ const d=await db(); if(!d) return false; return new Promise(res=>{ try{ const tx=d.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(v,k); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); }catch(e){ res(false); } }); }
  async function idbDel(k){ const d=await db(); if(!d) return; try{ d.transaction(STORE,'readwrite').objectStore(STORE).delete(k); }catch(e){} }
  function modelPref(){ try{ return localStorage.getItem('codemap_rag_model')||''; }catch(e){ return ''; } }
  function setModelPref(m){ try{ localStorage.setItem('codemap_rag_model', m||''); }catch(e){} }
  // wektory zapisane wcześniej dla tego projektu i modelu → dopasowanie po hashu fragmentu
  async function loadVectors(){
    const model=modelPref(); if(!S||!model) return false;
    const rec=await idbGet(S.key+'|'+model); if(!rec||!rec.vecs||!rec.dim) return false;
    const map=new Map(); rec.hashes.forEach((h,i)=>map.set(h,i));
    const src=new Float32Array(rec.vecs), dim=rec.dim, out=new Float32Array(S.chunks.length*dim); let hit=0;
    S.chunks.forEach((c,i)=>{ const j=map.get(c.hash); if(j!=null){ out.set(src.subarray(j*dim,(j+1)*dim), i*dim); c._v=true; hit++; } else c._v=false; });
    if(!hit) return false;
    S.model=model; S.dim=dim; S.vecs=out; S.partial=hit<S.chunks.length;
    return true;
  }
  async function embeddingModels(){ try{ return CM.Ollama&&CM.Ollama.embeddingModels ? await CM.Ollama.embeddingModels() : []; }catch(e){ return []; } }
  // domyślny model: zapamiętany → bge-m3 (wielojęzyczny) → nomic → pierwszy dostępny
  async function pickModel(){
    const list=(await embeddingModels()).map(m=>m.name); if(!list.length) return null;
    const pref=modelPref(); if(pref && list.includes(pref)) return pref;
    return list.find(n=>/bge-m3/.test(n))||list.find(n=>/nomic/.test(n))||list[0];
  }
  // liczenie brakujących wektorów w Ollamie (partiami), zapis do IndexedDB
  async function buildVectors(opts){
    opts=opts||{};
    const s=await ensure(); if(!s) throw new Error(T('rag.noProject','Najpierw wczytaj projekt.'));
    const model=opts.model||await pickModel();
    if(!model) throw new Error(T('rag.noEmbed','Brak modelu embeddingów w Ollamie — pobierz np. bge-m3 lub nomic-embed-text (Ustawienia → AI).'));
    if(building){ try{ building.ctrl.abort(); }catch(e){} }
    const ctrl=new AbortController(); building={ctrl, model};
    try{
      if(s.model!==model){ setModelPref(model); s.model=null; s.vecs=null; s.dim=0; await loadVectors(); }
      const pre=prefixes(model);
      const todo=s.chunks.map((c,i)=>i).filter(i=>!s.chunks[i]._v || s.model!==model);
      let vecs=s.vecs, dim=s.dim, done=s.chunks.length-todo.length;
      const B=24;
      for(let p=0;p<todo.length;p+=B){
        if(ctrl.signal.aborted) throw Object.assign(new Error('cancelled'),{name:'AbortError'});
        const ids=todo.slice(p,p+B);
        const res=await CM.Ollama.embed(ids.map(i=>docText(s.chunks[i], pre.d)), {model, signal:ctrl.signal});
        if(!dim){ dim=res[0].length; vecs=new Float32Array(s.chunks.length*dim); }
        ids.forEach((i,j)=>{ vecs.set(normalize(res[j]), i*dim); s.chunks[i]._v=true; });
        done+=ids.length; if(opts.onProgress) opts.onProgress(done, s.chunks.length);
      }
      if(S!==s) return null;   // projekt zmieniony w trakcie
      s.vecs=vecs; s.dim=dim; s.model=model; s.partial=false;
      await idbPut(s.key+'|'+model, {model, dim, hashes:s.chunks.map(c=>c.hash), vecs:vecs.buffer.slice(0), at:Date.now()});
      building=null; return stats();
    } finally { if(building&&building.ctrl===ctrl) building=null; }
  }
  async function clearVectors(){ if(S&&S.model) await idbDel(S.key+'|'+S.model); if(S){ S.vecs=null; S.model=null; S.dim=0; S.chunks.forEach(c=>c._v=false); } }

  // wyszukiwanie: BM25 zawsze; wektor zapytania z Ollamy, gdy indeks semantyczny gotowy (inaczej samo BM25)
  async function search(q, opts){
    opts=opts||{};
    const s=await ensure(); if(!s||!s.chunks.length) return {hits:[], mode:'none', s};
    const lex=bm25(s.lex, queryTokens(q));
    let cos=null, mode='lexical';
    if(s.vecs && !opts.lexicalOnly){ try{
      const qv=normalize((await CM.Ollama.embed([prefixes(s.model).q+q], {model:s.model, signal:opts.signal}))[0]);
      if(qv.length===s.dim){ cos=new Float32Array(s.chunks.length); for(let i=0;i<s.chunks.length;i++) cos[i]=s.chunks[i]._v?dot(s.vecs, i*s.dim, qv):-1; mode='hybrid'; }
    }catch(e){ if(e&&e.name==='AbortError') throw e; } }
    let hits=diversify(rank(lex, cos, 40), s.chunks, opts.k||6).filter(h=>h.score>0);
    // słabe dopasowania tylko rozpraszają mały model i wydłużają prefill — zostają fragmenty ≥ 60 % najlepszego (min. 2)
    if(!opts.all && hits.length>2){ const top=hits[0].score; hits=hits.filter((h,i)=>i<2||h.score>=top*(opts.cut||0.6)); }
    // plik wymieniony w pytaniu z nazwy („co robi agent.js…"), którego wyszukiwanie nie zwróciło → jego 2 najlepsze fragmenty
    for(const base of mentionedFiles(q).slice(0,2)){
      if(hits.some(h=>s.chunks[h.i].path.split('/').pop().toLowerCase()===base)) continue;
      const own=[]; s.chunks.forEach((c,i)=>{ if(c.path.split('/').pop().toLowerCase()===base) own.push(i); });
      own.sort((a,b)=>(lex[b]-lex[a])||(a-b));
      hits.unshift(...own.slice(0,2).map(i=>({i, score:hits.length?hits[0].score:1, mentioned:true})));   // na początek — budżet kontekstu ich nie odetnie
    }
    return {hits, mode, s};
  }
  // nazwy plików wymienione w pytaniu (bez ścieżki, małe litery)
  const FILE_RE=/\b[\w.-]+\.(m?[jt]sx?|cjs|py|go|java|kt|rs|rb|php|cs|c|cc|cpp|h|hpp|swift|dart|css|scss|html|vue|svelte|md|json|ya?ml|sql|sh)\b/gi;
  function mentionedFiles(q){ return [...new Set((String(q||'').match(FILE_RE)||[]).map(x=>x.toLowerCase()))]; }

  // kontekst dla ChatBota: {text, sources, mode}
  async function context(q, opts){
    opts=opts||{};
    const r=await search(q, opts);
    const cb=contextBlock(r.hits, r.s?r.s.chunks:[], opts.budget||6000);
    return {text:cb.text, sources:cb.sources, mode:r.mode};
  }

  return {mentionedFiles, tokenize, queryTokens, chunkFile, buildLexical, bm25, rank, diversify, contextBlock, prefixes, normalize,
    ensure, reset, stats, search, context, buildVectors, clearVectors, embeddingModels, pickModel, modelPref, setModelPref,
    isBuilding:()=>!!building, cancelBuild:()=>{ if(building){ try{ building.ctrl.abort(); }catch(e){} } }};
})();
