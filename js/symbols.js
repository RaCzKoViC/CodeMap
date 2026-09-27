/* ===================== symbols.js — orkiestracja grafu symboli (CM.Symbols) =====================
   Opt-in: nic nie jest pobierane, dopóki użytkownik nie włączy „Symbole (tree-sitter)". Wtedy:
   pliki z treścią (node.preview, ≤ 64 KB) w obsługiwanych językach idą do js/symbols-worker.js,
   który ładuje web-tree-sitter i potrzebne gramatyki z jsdelivr; bez Workera (file://) — ten sam
   kod na głównym wątku z oddawaniem sterowania. Wynik trafia do graph.addSymbols().
   Źródła: web-tree-sitter@0.22.6 + tree-sitter-wasms@0.1.12 (para sprawdzona: tools/symbols-probe.mjs). */
CM.Symbols = (function(){
  const I = CM.i18n;
  const LIB = 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.22.6/';
  const GRAMMARS = 'https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/';
  const V = (()=>{ const s = document.currentScript || document.querySelector('script[src*="js/symbols.js"]');
    return (s && s.src && (s.src.match(/[?&]v=([\w.-]+)/) || [])[1]) || ''; })();
  const WORKER_URL = 'js/symbols-worker.js' + (V ? '?v=' + V : '');
  let gen = 0, worker = null, state = {status:'idle', error:null, done:0, total:0};

  // pliki do analizy: węzły plików z treścią w językach, dla których jest gramatyka
  function filesOf(graph){
    const Core = CM.SymbolsCore, out = [];
    for(const n of graph.nodes.values()){
      if(n.type !== 'file' || !n.preview) continue;
      if(!Core.grammarFor(n.lang, n.path)) continue;
      out.push({path:n.id, lang:n.lang, content:n.preview});
    }
    return out;
  }
  function supportedCount(graph){ return graph ? filesOf(graph).length : 0; }

  // ---- pigułka postępu (jeden element aktualizowany w miejscu, zamiast serii toastów) ----
  let pill = null;
  function showPill(text){
    let wrap = document.getElementById('toast-wrap');
    if(!wrap){ wrap = document.createElement('div'); wrap.id = 'toast-wrap'; document.body.appendChild(wrap); }
    if(!pill){ pill = document.createElement('div'); pill.className = 'toast sym-pill'; wrap.appendChild(pill); }
    pill.textContent = text;
  }
  function hidePill(){ if(pill){ const p = pill; pill = null; p.style.transition = 'opacity .3s'; p.style.opacity = '0'; setTimeout(()=>p.remove(), 300); } }

  function stopWorker(){ if(worker){ try{ worker.terminate(); }catch(e){} worker = null; } }
  function cancel(){ gen++; stopWorker(); state = {status:'idle', error:null, done:0, total:0}; hidePill(); }

  // Analiza w workerze → Promise<results>; null = worker niedostępny (fallback na główny wątek)
  function viaWorker(files, my, onProgress){
    return new Promise((resolve, reject)=>{
      let w; try{ w = new Worker(WORKER_URL); }catch(e){ resolve(null); return; }
      worker = w; let started = false;
      w.onerror = (e)=>{ stopWorker(); if(!started){ resolve(null); return; } reject(new Error((e && e.message) || 'worker')); };
      w.onmessage = (ev)=>{
        const d = ev.data || {}; if(d.gen !== my) return; started = true;
        if(d.type === 'progress'){ if(onProgress) onProgress(d.done, d.total); }
        else if(d.type === 'done'){ stopWorker(); resolve(d.results || []); }
        else if(d.type === 'error'){ stopWorker(); reject(new Error(d.message || 'tree-sitter')); }
      };
      w.postMessage({type:'analyze', gen:my, files, urls:{lib:LIB, grammars:GRAMMARS}});
    });
  }
  let mainTS = null; const mainLangs = new Map();
  // bez workera (file://): natywne SRI dla skryptu (integrity + crossorigin), WASM z bajtów sprawdzonych przez CM.SRI
  function loadScript(src){ return new Promise((res, rej)=>{ const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous';
    const i = CM.SRI && CM.SRI.integrity(src); if(i) s.integrity = i; else return rej(new Error('SRI: brak przypiętego skrótu dla ' + src));
    s.onload = res; s.onerror = ()=>rej(new Error('CDN / SRI: ' + src)); document.head.appendChild(s); }); }
  async function viaMainThread(files, my, onProgress){
    if(!mainTS){ if(!window.TreeSitter) await loadScript(LIB + 'tree-sitter.js');
      await window.TreeSitter.init({locateFile:(f)=>LIB + f, wasmBinary:new Uint8Array(await CM.SRI.fetchVerified(LIB + 'tree-sitter.wasm'))}); mainTS = window.TreeSitter; }
    const load = (g)=>{ if(!mainLangs.has(g)) mainLangs.set(g, CM.SRI.fetchVerified(GRAMMARS + 'tree-sitter-' + g + '.wasm').then((b)=>mainTS.Language.load(new Uint8Array(b))).catch((e)=>{ mainLangs.delete(g); throw e; })); return mainLangs.get(g); };
    return CM.SymbolsCore.analyzeBatch(mainTS, files, load, {
      cancelled:()=>my !== gen,
      onProgress:(d, t)=>{ if(onProgress) onProgress(d, t); return new Promise((r)=>setTimeout(r, 0)); },
    });
  }

  // Główne wejście: analizuje graf i zwraca {results, files}. Anulowanie: cancel() albo kolejne run().
  async function run(graph, opts){
    opts = opts || {};
    cancel();
    const my = ++gen;
    const files = filesOf(graph);
    state = {status:'running', error:null, done:0, total:files.length};
    if(!files.length){ state.status = 'done'; return {results:[], files:0}; }
    const onProgress = (d, t)=>{ if(my !== gen) return; state.done = d; state.total = t;
      showPill(I.t('sym.progress', 'Symbole (tree-sitter): ') + d + ' / ' + t + I.t('sym.progressFiles', ' plików…'));
      if(opts.onProgress) opts.onProgress(d, t); };
    showPill(I.t('sym.loading', 'Symbole: ładuję parser tree-sitter…'));
    try{
      let results = await viaWorker(files, my, onProgress);
      if(results === null && my === gen) results = await viaMainThread(files, my, onProgress);
      if(my !== gen) return null;                               // anulowane / zastąpione
      state.status = 'done'; hidePill();
      return {results:results || [], files:files.length};
    }catch(e){
      if(my !== gen) return null;
      state = {status:'error', error:(e && e.message) || String(e), done:0, total:files.length};
      hidePill(); throw e;
    }
  }

  return { run, cancel, state:()=>Object.assign({}, state), supportedCount, filesOf, urls:{lib:LIB, grammars:GRAMMARS} };
})();
