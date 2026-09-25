/* ===================== localai.js — lokalne modele AI w przeglądarce (WebLLM / WebGPU) =====================
   CM.LocalAI — prawdziwe, darmowe modele LLM działające W CAŁOŚCI lokalnie (bez klucza, bez chmury):
   • silnik: @mlc-ai/web-llm ładowany dynamicznie z CDN, uruchamiany W WEB WORKERZE (UI nie zamarza),
   • wagi modelu pobierane RAZ z Hugging Face i trzymane w Cache Storage przeglądarki (persistent),
   • inferencja na GPU przez WebGPU (Chromium 113+); streaming tokenów jak w API Mistrala.
   MASZYNA STANÓW (po audycie cd.73): licznik EPOK unieważnia in-flight ładowanie (unload = realne
   anulowanie pobierania), ensureEngine re-checkuje cel po każdym awaicie (zmiana modelu w trakcie
   ładowania nigdy nie odda złego silnika), generacje przechodzą przez FIFO-MUTEX a interrupt ma
   WŁAŚCICIELA (stop czatu nie ubija równoległej analizy struktury), prompt ma budżet znaków
   (okno 2048 tokenów nigdy nie wybucha surowym błędem silnika). */
CM.LocalAI = (function(){
  const U=CM.util, I=CM.i18n;

  const PROV_KEY='codemap_ai_provider';          // 'mistral' (domyślnie) | 'local'
  const MODEL_KEY='codemap_local_model';
  const CDN='https://esm.run/@mlc-ai/web-llm@0.2.79';
  // wyselekcjonowane małe modele (prebuilt MLC; rozmiar = pobranie na dysk, VRAM podobny)
  // Wyselekcjonowane modele (prebuilt MLC; rozmiar = pobranie na dysk, VRAM podobny). Modele, których
  // ten build silnika nie zna, są automatycznie pomijane na listach (resolveId). Pełną listę silnika
  // daje listPrebuilt() — Ustawienia → AI → „Wszystkie modele silnika".
  const MODELS=[
    {id:'SmolLM2-360M-Instruct-q4f16_1-MLC',   label:'SmolLM2 · 360M  (~270 MB — mikro; tylko najprostsze akcje)'},
    {id:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',  label:'Qwen 2.5 · 0.5B  (~350 MB — najlżejszy; tylko proste akcje)'},
    {id:'Llama-3.2-1B-Instruct-q4f16_1-MLC',  label:'Llama 3.2 · 1B  (~880 MB — polecany na start)'},
    {id:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',  label:'Qwen 2.5 · 1.5B  (~1.6 GB)'},
    {id:'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', label:'Qwen 2.5 Coder · 1.5B  (~1.6 GB — do kodu)'},
    {id:'SmolLM2-1.7B-Instruct-q4f16_1-MLC',   label:'SmolLM2 · 1.7B  (~1.1 GB)'},
    {id:'gemma-2-2b-it-q4f16_1-MLC',           label:'Gemma 2 · 2B  (~1.6 GB)'},
    {id:'Llama-3.2-3B-Instruct-q4f16_1-MLC',  label:'Llama 3.2 · 3B  (~2.3 GB — dobry kompromis)'},
    {id:'Qwen2.5-3B-Instruct-q4f16_1-MLC',    label:'Qwen 2.5 · 3B  (~2.2 GB — dobrze po polsku)'},
    {id:'Phi-3.5-mini-instruct-q4f16_1-MLC',   label:'Phi 3.5 mini · 3.8B  (~2.5 GB)'},
    {id:'Qwen2.5-7B-Instruct-q4f16_1-MLC',    label:'Qwen 2.5 · 7B  (~4.7 GB — mocne GPU)'},
    {id:'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', label:'Qwen 2.5 Coder · 7B  (~4.7 GB — do kodu; mocne GPU)'},
    {id:'Llama-3.1-8B-Instruct-q4f16_1-MLC',  label:'Llama 3.1 · 8B  (~5 GB — mocne GPU)'},
    {id:'Mistral-7B-Instruct-v0.3-q4f16_1-MLC', label:'Mistral · 7B v0.3  (~4.6 GB — mocne GPU)'},
    {id:'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',   label:'Hermes 3 · 8B  (~5 GB — dobre wywołania narzędzi; mocne GPU)'},
    {id:'gemma-2-9b-it-q4f16_1-MLC',           label:'Gemma 2 · 9B  (~5.6 GB — mocne GPU)'},
    {id:'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', label:'DeepSeek R1 · 7B  (~4.3 GB — myślący: pokazuje rozumowanie; mocne GPU)', think:true},
    {id:'DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC', label:'DeepSeek R1 Llama · 8B  (~5 GB — myślący; mocne GPU)', think:true},
  ];
  const EXTRA_KEY='codemap_local_models_extra';   // id-y wybrane z pełnej listy silnika (poza MODELS)
  const extraIds=()=>{ try{ const a=JSON.parse(localStorage.getItem(EXTRA_KEY)||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } };
  const addExtraId=(id)=>{ const a=extraIds(); if(!a.includes(id)){ a.push(id); try{ localStorage.setItem(EXTRA_KEY, JSON.stringify(a.slice(-20))); }catch(e){} } };
  const known=(id)=>MODELS.some(m=>m.id===id)||extraIds().includes(id);
  const isThinking=(id)=>{ id=id||modelId(); const m=MODELS.find(m=>m.id===id); return m?!!m.think:/R1|Reason|Think/i.test(id); };

  let lib=null;            // WebLLM module (dynamic import, once)
  let engine=null;         // MLCEngine (worker-proxy lub main-thread fallback)
  let loadedModel=null;    // NASZ id modelu aktualnie w silniku
  let loading=null;        // in-flight init promise (dedup per model)
  let loadingId=null;      // NASZ id modelu, który loading właśnie ładuje
  let epoch=0;             // licznik epok: unload()/anulowanie unieważnia każdy in-flight load
  let curWorker=null, curWurl=null;   // worker tworzony w trakcie loadu (zanim trafi na engine.__worker)
  let _loadCancel=null;    // resolver anulujący await CreateEngine w locie (unload podczas pobierania)
  let progress={text:'', pct:0};
  const progressCbs=new Set();
  // FIFO-mutex generacji + własność interruptu
  let _q=Promise.resolve();
  let _curSig=null;        // AbortSignal generacji AKTYWNEJ w tej chwili (właściciel silnika)
  let _genActive=false;
  let _engineGoneRes=null; // rozstrzyga wiszący strumień, gdy silnik został zwolniony pod spodem

  const hasWebGPU=()=>!!navigator.gpu;
  // trzej dostawcy: 'mistral' (API, klucz) | 'local' (WebLLM w przeglądarce) | 'ollama' (natywny serwer)
  const provider=()=>{ const v=localStorage.getItem(PROV_KEY); return v==='local'?'local':(v==='ollama'?'ollama':'mistral'); };
  const setProvider=(p)=>{ try{ localStorage.setItem(PROV_KEY, (p==='local'||p==='ollama')?p:'mistral'); }catch(e){} };
  // SANITYZACJA: id zapisany przez starszą wersję może wskazywać model usunięty z listy
  // (np. dawny DeepSeek-1.5B / Gemma) — wtedy każdy czat umierał na resolveId. Heal-write do domyślnego.
  const DEFAULT_ID='Llama-3.2-1B-Instruct-q4f16_1-MLC';
  const modelId=()=>{
    const v=localStorage.getItem(MODEL_KEY);
    if(v && known(v)) return v;
    if(v) try{ localStorage.setItem(MODEL_KEY, DEFAULT_ID); }catch(e){}
    return DEFAULT_ID;
  };
  const setModel=(id)=>{ if(id && !MODELS.some(m=>m.id===id)) addExtraId(id); try{ localStorage.setItem(MODEL_KEY,id); }catch(e){} };
  const status=()=>engine&&loadedModel===modelId()?'ready':(loading?'loading':'unloaded');
  const busy=()=>!!loading||_genActive;
  const loadedId=()=>loadedModel;
  const label=(id)=>{ id=id||modelId(); const m=MODELS.find(m=>m.id===id); return m?m.label:prettyId(id); };
  // czytelna nazwa z id prebuilt: 'Qwen2.5-3B-Instruct-q4f16_1-MLC' → 'Qwen2.5 3B Instruct (q4f16)'
  const prettyId=(id)=>String(id||'').replace(/-MLC-1k$/,' [1k ctx]').replace(/-MLC$/,'').replace(/-(q\w+?)_\d+(?= |$)/,' ($1)').replace(/-/g,' ');
  const shortLabel=(id)=>label(id).split('(')[0].replace(/·/g,'').replace(/\s+/g,' ').trim();
  async function ensureLib(){ if(!lib) lib=await import(CDN); return lib; }
  // ---- appConfig + model-id resolution ----
  let _cfg=null;
  async function appCfg(){
    if(_cfg) return _cfg;
    const L=await ensureLib();
    _cfg=JSON.parse(JSON.stringify(L.prebuiltAppConfig));   // deep clone (czyste dane)
    return _cfg;
  }
  async function resolveId(id){
    const cfg=await appCfg();
    if(cfg.model_list.some(m=>m.model_id===id)) return id;
    // fuzzy fallback: ta sama rodzina+rozmiar, inny suffix kwantyzacji w tym buildzie WebLLM
    const fam=id.replace(/-q\w+_\d.*$/,'');
    const hit=cfg.model_list.find(m=>m.model_id.startsWith(fam)&&/q4f16/i.test(m.model_id))
           || cfg.model_list.find(m=>m.model_id.startsWith(fam));
    if(hit) return hit.model_id;
    throw new Error(I.t('lai.noModel','Ten model nie jest dostępny w tej wersji silnika WebLLM: ')+id);
    // NOTE: custom record z cudzym model_lib (próba dla R1-Distill-1.5B) dawał ŚMIECIOWY output
    // (tokenizer/lib mismatch) — nigdy nie parować wag z obcym wasm.
  }
  // ---- downloaded-weights management (Cache Storage) ----
  async function isDownloaded(id){ try{ const L=await ensureLib(); const cfg=await appCfg();
    return !!(await L.hasModelInCache(await resolveId(id||modelId()), cfg)); }catch(e){ return false; } }
  async function listDownloaded(){
    const out=[];
    const all=MODELS.concat(extraIds().filter(id=>!MODELS.some(m=>m.id===id)).map(id=>({id, label:prettyId(id)})));
    for(const m of all){
      // model, którego ten build silnika nie uruchomi, NIGDY nie jest listowany (zero dead-endów)
      try{ await resolveId(m.id); }catch(e){ continue; }
      out.push({id:m.id, label:m.label, downloaded:await isDownloaded(m.id), think:!!m.think});
    }
    return out;
  }
  // PEŁNA lista modeli czatu wbudowana w ten build WebLLM (bez embeddingów/wizji): [{id,label,vramMB,low}]
  async function listPrebuilt(){
    const cfg=await appCfg();
    return (cfg.model_list||[])
      .filter(m=>!/embed|snowflake|vision|-VL-|whisper/i.test(m.model_id))
      .map(m=>({id:m.model_id, label:prettyId(m.model_id), vramMB:Math.round(m.vram_required_MB||0), low:!!m.low_resource_required, think:/R1|Reason|Think/i.test(m.model_id)}))
      .sort((a,b)=>(a.vramMB||1e9)-(b.vramMB||1e9));
  }
  async function deleteModel(id){
    if(!id) return false;
    // usuwanie modelu ładowanego/załadowanego: najpierw pełny unload (anuluje też pobieranie),
    // potem poczekaj aż in-flight promise się rozstrzygnie — dopiero wtedy bezpiecznie kasuj cache
    if(loadedModel===id || (loading&&loadingId===id)) await unload();
    if(loading){ try{ await loading; }catch(e){} }
    try{ const L=await ensureLib(); const cfg=await appCfg();
      await L.deleteModelAllInfoInCache(await resolveId(id), cfg); return true; }catch(e){ return false; }
  }
  const onProgress=(fn)=>{ progressCbs.add(fn); return ()=>progressCbs.delete(fn); };
  function emitProgress(rep){
    progress={text:rep.text||'', pct:Math.round((rep.progress||0)*100)};
    for(const fn of progressCbs){ try{ fn(progress); }catch(e){} }
  }
  const abortErr=()=>Object.assign(new Error(I.t('lai.cancelled','Przerwano.')),{name:'AbortError'});

  // ensureEngine z RE-CHECKIEM CELU: pętla sprawdza modelId() po każdym awaicie, więc zmiana modelu
  // w trakcie cudzego ładowania nigdy nie odda silnika ze STARYM modelem, a osierocony silnik nie
  // zostaje w VRAM ze statusem 'unloaded'.
  async function ensureEngine(){
    if(!hasWebGPU()) throw new Error(I.t('lai.noWebGPU','Ta przeglądarka nie obsługuje WebGPU — lokalne modele wymagają Chrome/Edge 113+ z włączonym GPU.'));
    for(;;){
      if(engine && loadedModel===modelId()) return engine;
      if(loading){
        if(loadingId===modelId()) return loading;           // dedup tylko dla TEGO SAMEGO modelu
        try{ await loading; }catch(e){ if(e&&e.name==='AbortError') throw e; }
        continue;                                            // cel mógł się zmienić — re-check
      }
      loadingId=modelId();
      loading=(async()=>{
        try{
          await ensureLib();
          // PERSISTENT storage — bez tego przeglądarka może po cichu wyewiktować pobrane wagi
          try{ if(navigator.storage&&navigator.storage.persist) await navigator.storage.persist(); }catch(e){}
          const id=loadingId;
          emitProgress({text:I.t('lai.starting','Uruchamiam silnik…'), progress:0});
          await unload();                     // zwalnia poprzedni silnik; bumpuje epokę PRZED my
          const my=epoch;
          const chk=()=>{ if(my!==epoch) throw abortErr(); };
          const realId=await resolveId(id); chk();
          const cfg=await appCfg(); chk();
          // context_window_size 2048: o połowę mniejszy KV-cache = mniej pamięci GPU i szybszy
          // decode na zintegrowanych kartach; budżet promptu pilnowany w chat() (clampMsgs).
          let eng=null, w=null, wurl=null;
          const cancelP=new Promise((_,rej)=>{ _loadCancel=()=>rej(abortErr()); });
          cancelP.catch(()=>{});               // uzbrojony rejection nie może być "unhandled"
          const cleanup=()=>{ try{ if(w) w.terminate(); }catch(e){} try{ if(wurl) URL.revokeObjectURL(wurl); }catch(e){}
            if(curWorker===w) curWorker=null; if(curWurl===wurl) curWurl=null; };
          try{
            // SILNIK W WEB WORKERZE: JS modelu poza głównym wątkiem — UI nie zamarza, Stop działa.
            const src='import {WebWorkerMLCEngineHandler} from "'+CDN+'";'+
                      'const h=new WebWorkerMLCEngineHandler();self.onmessage=(m)=>h.onmessage(m);';
            wurl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
            w=new Worker(wurl,{type:'module'});
            curWorker=w; curWurl=wurl;
            // race z anulowaniem: unload() podczas pobierania NAPRAWDĘ przerywa (terminate workera
            // ubija fetch wag; wiszący Create przegrywa wyścig i nie robi stale-write)
            eng=await Promise.race([
              lib.CreateWebWorkerMLCEngine(w, realId, {initProgressCallback:emitProgress, appConfig:cfg}, {context_window_size:2048}),
              cancelP
            ]);
            eng.__worker=w; eng.__wurl=wurl;
          }catch(we){
            cleanup();
            if(we&&we.name==='AbortError') throw we;
            if(my!==epoch) throw abortErr();
            // fallback: silnik na głównym wątku (gdy module-worker nie wstał)
            eng=await Promise.race([
              lib.CreateMLCEngine(realId, {initProgressCallback:emitProgress, appConfig:cfg}, {context_window_size:2048}),
              cancelP
            ]);
          }
          if(my!==epoch){ try{ await eng.unload(); }catch(e){} cleanup(); throw abortErr(); }
          engine=eng; loadedModel=id;
          emitProgress({text:I.t('lai.ready','Model gotowy.'), progress:1});
          return engine;
        } finally { loading=null; loadingId=null; _loadCancel=null; }
      })();
      const p=loading;
      const eng=await p;                       // błąd własnego loadu propaguje do callera
      if(engine===eng && loadedModel===modelId()) return eng;
      // model zmienił się w trakcie naszego ładowania → pętla przeładuje na aktualny wybór
    }
  }

  // ---- budżet promptu vs okno 2048 tokenów (~3.5 znaka/token; zostaw miejsce na odpowiedź) ----
  // Zachowuje wiadomość system i OSTATNIĄ user; wycina najstarsze środkowe; w ostateczności
  // przycina największą wiadomość. Bez tego jedna wklejka kodu / duży projekt = surowy
  // ContextWindowSizeExceededError z silnika prosto w twarz użytkownika.
  function clampMsgs(msgs, budget){
    const keep=msgs.map(m=>({role:m.role, content:String(m.content||'')}));
    let tot=keep.reduce((s,m)=>s+m.content.length,0);
    while(tot>budget && keep.length>2){
      const i=keep.findIndex((m,j)=>j>0 && j<keep.length-1);
      if(i<0) break;
      tot-=keep[i].content.length; keep.splice(i,1);
    }
    if(tot>budget){
      let big=keep[0]; for(const m of keep){ if(m.content.length>big.content.length) big=m; }
      const cut=big.content.length-(tot-budget)-1;
      big.content = cut>0 ? big.content.slice(0,cut)+'…' : big.content.slice(0,Math.max(0,budget-64))+'…';
    }
    return keep;
  }
  const mapEngineErr=(e)=>{
    const m=String((e&&e.message)||e||'');
    if(/context|window.*size|token.*limit|exceed/i.test(m))
      return new Error(I.t('lai.ctxTooBig','Zapytanie lub projekt jest za duży dla lokalnego modelu — skróć pytanie albo wybierz większy model.'));
    return e;
  };

  // chat kompatybilny z aiChat()/mistralStream: messages=[{role,content}...]
  // opts: {temperature, maxTokens, onToken(delta, full), signal} → pełny tekst odpowiedzi.
  // FIFO-MUTEX: generacje wykonują się po kolei; abort requestu CZEKAJĄCEGO w kolejce = cichy
  // AbortError (bez dotykania silnika); interrupt trafia wyłącznie we WŁASNĄ generację.
  function chat(messages, opts){
    opts=opts||{};
    const run=_q.then(()=>_chatNow(messages, opts));
    _q=run.catch(()=>{});
    if(!opts.signal) return run;
    // abort requestu CZEKAJĄCEGO w kolejce uwalnia wołającego OD RAZU (race), a sam task po dojściu
    // do głosu wychodzi cichym AbortError z pre-checku — silnik nietknięty
    return Promise.race([ run,
      new Promise((_,rej)=>{ if(opts.signal.aborted) rej(abortErr());
        else opts.signal.addEventListener('abort',()=>rej(abortErr()),{once:true}); })
    ]);
  }
  async function _chatNow(messages, opts){
    if(opts.signal&&opts.signal.aborted) throw abortErr();   // abort w kolejce → nie ruszamy silnika
    const eng=await ensureEngine();
    if(opts.signal&&opts.signal.aborted) throw abortErr();
    // Prompt budget must leave room for the reply inside the 2048-token window, else long chats with a
    // big max_tokens (reasoning models: 1200) overflow → ContextWindowSizeExceeded. Reserve the reply,
    // convert the rest to chars (~3.6/token), floor at 1200 so we never starve the prompt entirely.
    const reserve=(opts.maxTokens||400)+96;
    const budget=Math.max(1200, Math.floor((2048-reserve)*3.6));
    messages=clampMsgs(messages, budget);
    let full='';
    const params={messages, temperature:opts.temperature==null?0.6:opts.temperature};
    if(opts.maxTokens) params.max_tokens=opts.maxTokens;
    if(opts.responseFormat) params.response_format=opts.responseFormat;   // {type:'json_object', schema} — gramatyka WebLLM
    if(opts.frequencyPenalty!=null) params.frequency_penalty=opts.frequencyPenalty;   // małe modele: przeciw pętlom powtórzeń
    _genActive=true; _curSig=opts.signal||null;
    const engineGone=new Promise(res=>{ _engineGoneRes=res; });
    try{
      if(opts.onToken){
        let chunks;
        try{ chunks=await Promise.race([eng.chat.completions.create(Object.assign({stream:true}, params)), engineGone]); }
        catch(e){ throw mapEngineErr(e); }
        if(chunks&&chunks.__gone) throw abortErr();
        // watchdog: zaklinowany strumień = błąd, nie wieczne kropki. Pierwszy token dostaje długi
        // budżet (prefill na iGPU bywa wolny), potem 60 s/token. Stop rozstrzyga wyścig OD RAZU.
        const iter=chunks[Symbol.asyncIterator]();
        const abortP=opts.signal?new Promise(res=>opts.signal.addEventListener('abort',()=>res({__abort:true}),{once:true})):null;
        let first=true;
        while(true){
          let timer=null;
          const races=[ iter.next(), engineGone, new Promise(res=>{ timer=setTimeout(()=>res({__stall:true}), first?180000:60000); }) ];
          if(abortP) races.push(abortP);
          const step=await Promise.race(races);
          clearTimeout(timer);
          if(step.__gone) throw abortErr();
          if(step.__abort){ try{ eng.interruptGenerate(); }catch(e){}
            throw abortErr(); }
          if(step.__stall){ try{ eng.interruptGenerate(); }catch(e){}
            throw new Error(I.t('lai.stalled','Model przestał odpowiadać (GPU). Spróbuj ponownie lub wybierz mniejszy model.')); }
          if(step.done) break;
          const ch=step.value;
          const d=(ch.choices&&ch.choices[0]&&ch.choices[0].delta&&ch.choices[0].delta.content)||'';
          if(d){ full+=d; opts.onToken(d, full); first=false; }
        }
        if(opts.signal&&opts.signal.aborted) throw abortErr();
        return full;
      }
      let res;
      try{ res=await Promise.race([eng.chat.completions.create(params), engineGone,
        new Promise(r=>setTimeout(()=>r({__stall:true}), 300000))]); }
      catch(e){ throw mapEngineErr(e); }
      if(res&&res.__gone) throw abortErr();
      if(res&&res.__stall){ try{ eng.interruptGenerate(); }catch(e){}
        throw new Error(I.t('lai.stalled','Model przestał odpowiadać (GPU). Spróbuj ponownie lub wybierz mniejszy model.')); }
      full=(res.choices&&res.choices[0]&&res.choices[0].message&&res.choices[0].message.content)||'';
      return full;
    } finally { _genActive=false; _curSig=null; _engineGoneRes=null; }
  }

  async function unload(){
    epoch++;                                            // unieważnij każdy in-flight load
    if(_loadCancel){ try{ _loadCancel(); }catch(e){} _loadCancel=null; }   // przerwij await Create
    try{ if(engine) engine.interruptGenerate(); }catch(e){}
    if(_engineGoneRes){ try{ _engineGoneRes({__gone:true}); }catch(e){} }  // uwolnij wiszący strumień
    if(engine){
      try{ await Promise.race([engine.unload(), new Promise(r=>setTimeout(r,3000))]); }catch(e){}
      try{ if(engine.__worker) engine.__worker.terminate(); }catch(e){}
      try{ if(engine.__wurl) URL.revokeObjectURL(engine.__wurl); }catch(e){}
    }
    // worker z NIEDOKOŃCZONEGO ładowania (jeszcze nie na engine.__worker) — też ubij
    try{ if(curWorker) curWorker.terminate(); }catch(e){}
    try{ if(curWurl) URL.revokeObjectURL(curWurl); }catch(e){}
    curWorker=null; curWurl=null;
    engine=null; loadedModel=null;
  }
  // twardy interrupt dla przycisku Stop — przerywa TYLKO gdy abortowany sygnał jest właścicielem
  // aktywnej generacji (stop czatu nie ubija równoległej „Przeanalizuj strukturę")
  function interrupt(){
    try{ if(engine && (!_curSig || _curSig.aborted)) engine.interruptGenerate(); }catch(e){}
  }
  // usuwa POBRANE wagi z Cache Storage przeglądarki (webllm/* + model-cache starszych wersji)
  async function deleteDownloads(){
    await unload();
    let n=0; try{ const ks=await caches.keys(); for(const k of ks){ if(/webllm|mlc/i.test(k)){ await caches.delete(k); n++; } } }catch(e){}
    return n;
  }
  // przybliżony rozmiar pobranych modeli (liczymy wpisy w cache'ach webllm/*)
  async function downloadedInfo(){
    const out={caches:0, entries:0};
    try{ const ks=await caches.keys(); for(const k of ks){ if(/webllm|mlc/i.test(k)){ out.caches++; const c=await caches.open(k); out.entries+=(await c.keys()).length; } } }catch(e){}
    return out;
  }

  return { MODELS, hasWebGPU, provider, setProvider, modelId, setModel, status, busy, loadedId, label, shortLabel, isThinking, listPrebuilt,
           isDownloaded, listDownloaded, deleteModel, interrupt,
           ensureEngine, chat, unload, deleteDownloads, downloadedInfo, onProgress,
           progress:()=>progress, _clampMsgs:clampMsgs };
})();
