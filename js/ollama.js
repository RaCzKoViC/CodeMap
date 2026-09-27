/* ===================== ollama.js — natywne lokalne modele przez serwer Ollama =====================
   CM.Ollama — trzeci dostawca AI: modele lokalne uruchamiane NATYWNIE (poza przeglądarką) przez
   zainstalowaną Ollamę (ollama.com). Błyskawiczne na tle WebLLM w przeglądarce: pełna moc CPU/GPU,
   zero konkurencji z renderowaniem mapy, zero pobierania wag do przeglądarki.
   API: GET /api/tags (lista modeli), POST /api/chat ze stream:true (NDJSON) — abort natychmiastowy
   przez AbortSignal fetcha. Modele myślące (deepseek-r1 itp.) emitują <think> — UI czatu już to
   obsługuje niezależnie od dostawcy. */
CM.Ollama = (function(){
  const I=CM.i18n, U=CM.util;
  const BASE_KEY='codemap_ollama_base';
  const MODEL_KEY='codemap_ollama_model';
  const DEF_BASE='http://localhost:11434';

  const base=()=>{ const v=(localStorage.getItem(BASE_KEY)||'').trim(); return (v||DEF_BASE).replace(/\/+$/,''); };
  const setBase=(u)=>{ U.lsSet(BASE_KEY,(u||'').trim()); };
  const model=()=>localStorage.getItem(MODEL_KEY)||'';
  const setModel=(m)=>{ U.lsSet(MODEL_KEY,m||''); };
  // pole `error` z odpowiedzi błędu Ollamy; treść bez JSON → '' (komunikat z kodu HTTP)
  const errBody=async(r)=>{ try{ return (await r.json()).error||''; }catch(e){ return ''; } };

  const offlineErr=()=>Object.assign(new Error(I.t('ol.offline','Ollama nie odpowiada pod ')+base()+I.t('ol.offlineHint',' — uruchom aplikację Ollama (lub `ollama serve`) i spróbuj ponownie.')), {code:'offline'});
  // origin tej strony do OLLAMA_ORIGINS (plik z dysku → „*")
  const pageOrigin=()=>{ try{ return location.origin && location.origin!=='null' ? location.origin : '*'; }catch(e){ return '*'; } };
  function corsHint(o){
    return 'Windows: setx OLLAMA_ORIGINS "'+o+'" · macOS: launchctl setenv OLLAMA_ORIGINS "'+o+'" · Linux: sudo systemctl edit ollama.service → [Service] Environment="OLLAMA_ORIGINS='+o+'"';
  }
  const corsErr=()=>{ const o=pageOrigin(), short=I.t('ol.cors','Ollama działa pod ')+base()+I.t('ol.corsMid',', ale blokuje zapytania z tej strony (CORS). Dopuść ją zmienną OLLAMA_ORIGINS i uruchom Ollamę ponownie (zamknij ją też z zasobnika): ');
    return Object.assign(new Error(short+corsHint(o)), {code:'cors', origin:o, short, hint:corsHint(o)}); };
  // fetch do Ollamy nie wyszedł (TypeError): serwer wyłączony ALBO odpowiedział bez nagłówka CORS dla tej strony — Ollama
  // z domyślnym OLLAMA_ORIGINS odrzuca obce originy (403 bez Access-Control-Allow-Origin), co przeglądarka zgłasza
  // identycznie. Rozróżnienie: zapytanie `no-cors` przechodzi (odpowiedź nieprzezroczysta), gdy serwer żyje, a pada,
  // gdy nikt nie słucha. Przekroczony czas to nie CORS — serwer żyje, ale nie odpowiada.
  async function unreachable(e){
    if(e && e.name==='TimeoutError') return offlineErr();
    try{ await fetch(base()+'/api/version', {mode:'no-cors', cache:'no-store', signal:AbortSignal.timeout?AbortSignal.timeout(2500):undefined}); return corsErr(); }
    catch(err){ return offlineErr(); }
  }
  // stan połączenia dla ustawień: {ok, code: 'cors' | 'offline' | null, message, hint}
  async function check(){
    try{ const list=await models(true); return {ok:true, code:null, models:list}; }
    catch(e){ return {ok:false, code:e.code||null, message:(e&&e.message)||String(e), hint:e.hint||''}; }
  }

  let _models=null;               // cache listy modeli (odświeżany przez models(true))
  let _raw=null;                  // surowa lista /api/tags (także modele embeddingów — dla RAG)
  async function models(force){
    if(_models && !force) return _models;
    let r;
    try{ r=await fetch(base()+'/api/tags',{signal:AbortSignal.timeout?AbortSignal.timeout(4000):undefined}); }
    catch(e){ throw await unreachable(e); }
    if(!r.ok) throw new Error('Ollama: HTTP '+r.status);
    const j=await r.json();
    _raw=j.models||[];
    _models=(j.models||[])
      // embedding-only models (bge/nomic/bert…) cannot chat — never list them (no dead-end errors)
      .filter(m=>{ const fam=((m.details&&m.details.family)||'').toLowerCase();
        return !/bert|nomic/.test(fam) && !/embed|bge-/.test(m.name.toLowerCase()); })
      .map(m=>({ name:m.name, sizeGB:m.size?(m.size/1073741824).toFixed(1):null }))
      .sort((a,b)=>a.name.localeCompare(b.name));
    // heal wyboru: zapamiętany model mógł zostać usunięty z Ollamy
    if(_models.length && !_models.some(m=>m.name===model())) setModel(_models[0].name);
    return _models;
  }
  async function online(){ try{ await models(true); return true; }catch(e){ return false; } }

  // ---- agent (agent.js): /api/chat z narzędziami, bez strumienia → {content, tool_calls, thinking} ----
  // model bez wsparcia narzędzi → błąd z code 'notools' (ChatBot wraca wtedy do zwykłego trybu RAG)
  async function chatTools(messages, tools, opts){
    opts=opts||{};
    const m=opts.model||model();
    if(!m) throw new Error(I.t('ol.noModel','Nie wybrano modelu Ollamy — otwórz Ustawienia → AI i odśwież listę modeli.'));
    const body={ model:m, stream:false,
      messages:messages.map(x=>{ const o={role:x.role, content:String(x.content||'')}; if(x.tool_calls) o.tool_calls=x.tool_calls; if(x.tool_name) o.tool_name=x.tool_name; return o; }),
      options:Object.assign({temperature:opts.temperature==null?0.2:opts.temperature}, opts.maxTokens?{num_predict:opts.maxTokens}:{}) };
    if(tools && tools.length) body.tools=tools;
    if(opts.think===false) body.think=false;
    let r;
    try{ r=await fetch(base()+'/api/chat',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:opts.signal}); }
    catch(e){ if(e&&e.name==='AbortError') throw e; throw await unreachable(e); }
    if(!r.ok){ const t=(await r.text().catch(()=>'')).slice(0,200); const e=new Error('Ollama: HTTP '+r.status+(t?' — '+t:'')); if(/does not support tools|tools? (are|is) not supported/i.test(t)) e.code='notools'; throw e; }
    const j=await r.json(); const msg=j.message||{};
    return {content:msg.content||'', tool_calls:msg.tool_calls||null, thinking:msg.thinking||''};
  }

  // ---- embeddingi (RAG w rag.js): modele embedujące z tej samej listy /api/tags ----
  const isEmbedModel=(m)=>{ const fam=((m.details&&m.details.family)||'').toLowerCase(), n=String(m.name||'').toLowerCase();
    return /bert|nomic/.test(fam) || /embed|bge-|minilm|e5-|gte-|arctic/.test(n); };
  async function embeddingModels(force){
    if(!_raw || force) await models(true);
    return (_raw||[]).filter(isEmbedModel).map(m=>({name:m.name, sizeGB:m.size?(m.size/1073741824).toFixed(1):null})).sort((a,b)=>a.name.localeCompare(b.name));
  }
  // POST /api/embed {model, input:[…]} → [[…], …]; starsze Ollamy (bez /api/embed) — /api/embeddings po jednym tekście
  let _legacyEmbed=false;
  async function embed(texts, opts){
    opts=opts||{}; const m=opts.model; if(!m) throw new Error('embed: model');
    const post=(path, body)=>fetch(base()+path,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:opts.signal})
      .catch(async e=>{ if(e&&e.name==='AbortError') throw e; throw await unreachable(e); });
    if(!_legacyEmbed){
      const r=await post('/api/embed', {model:m, input:texts, truncate:true});
      if(r.ok){ const j=await r.json(); if(Array.isArray(j.embeddings) && j.embeddings.length===texts.length) return j.embeddings; }
      else if(r.status!==404) throw new Error('Ollama embed: HTTP '+r.status+' '+((await r.text().catch(()=>'')).slice(0,160)));
      _legacyEmbed=true;
    }
    const out=[];
    for(const t of texts){ const r=await post('/api/embeddings', {model:m, prompt:t}); if(!r.ok) throw new Error('Ollama embeddings: HTTP '+r.status); out.push((await r.json()).embedding); }
    return out;
  }
  // rozmiar bieżącego modelu w GB z cache listy (null, gdy lista jeszcze nie pobrana)
  const modelSizeGB=(name)=>{ const m=(_models||[]).find(x=>x.name===(name||model())); return m&&m.sizeGB!=null?+m.sizeGB:null; };

  // chat kompatybilny z aiChat()/CM.LocalAI.chat: messages=[{role,content}...]
  // opts: {temperature, maxTokens, onToken(delta, full), signal, model} → pełny tekst odpowiedzi
  async function chat(messages, opts){
    opts=opts||{};
    const m=opts.model||model();
    if(!m) throw new Error(I.t('ol.noModel','Nie wybrano modelu Ollamy — otwórz Ustawienia → AI i odśwież listę modeli.'));
    const body={ model:m, messages:messages.map(x=>({role:x.role,content:String(x.content||'')})),
      stream:!!opts.onToken,
      options:Object.assign({ temperature:opts.temperature==null?0.6:opts.temperature },
                            opts.maxTokens?{num_predict:opts.maxTokens}:{}) };
    if(opts.format) body.format=opts.format;          // 'json' albo schemat JSON (Ollama ≥ 0.5) — wymusza strukturę
    if(opts.repeatPenalty!=null) body.options.repeat_penalty=opts.repeatPenalty;
    if(opts.think===false) body.think=false;          // modele myślące (qwen3, deepseek-r1): bez rozumowania (Ollama ≥ 0.9)
    let r;
    try{
      r=await fetch(base()+'/api/chat',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body), signal:opts.signal });
    }catch(e){
      if(e&&e.name==='AbortError') throw e;
      throw await unreachable(e);
    }
    if(!r.ok){ const d=await errBody(r);
      throw new Error('Ollama: '+(d||('HTTP '+r.status))); }
    if(!opts.onToken){
      const j=await r.json();
      const th=(j.message&&j.message.thinking)||'';
      return (th?('<think>'+th+'</think>'):'')+((j.message&&j.message.content)||'');
    }
    // NDJSON stream: {message:{content}, done:false} … {done:true}
    const reader=r.body.getReader(); const dec=new TextDecoder();
    let buf='', full='', inThink=false;
    // nowsze Ollamy oddzielają rozumowanie (message.thinking) od treści — składamy je w <think>…</think>,
    // które UI czatu już rozumie (podgląd „Myślę…" na żywo, zwijany panel po odpowiedzi)
    const take=(line)=>{ line=line.trim(); if(!line) return false;
      let j; try{ j=JSON.parse(line); }catch(e){ return false; }
      if(j.error) throw new Error('Ollama: '+j.error);
      const th=(j.message&&j.message.thinking)||'';
      if(th){ let d=th; if(!inThink){ d='<think>'+d; inThink=true; } full+=d; opts.onToken(d, full); }
      let d=(j.message&&j.message.content)||'';
      if(d && inThink){ d='</think>'+d; inThink=false; }
      if(d){ full+=d; opts.onToken(d, full); }
      if(j.done && inThink){ full+='</think>'; inThink=false; opts.onToken('</think>', full); }
      return !!j.done; };
    try{
      for(;;){
        const {done, value}=await reader.read();
        if(done) break;
        buf+=dec.decode(value,{stream:true});
        let nl;
        while((nl=buf.indexOf('\n'))>=0){
          const line=buf.slice(0,nl); buf=buf.slice(nl+1);
          if(take(line)) return full;
        }
      }
      // flush: multi-byte tail + a final line that never got its trailing '\n' (was silently dropped)
      buf+=dec.decode();
      if(buf.trim()) take(buf);
    } finally { try{ reader.cancel().catch(()=>{}); }catch(e){ /* strumień już zamknięty */ } }   // free the HTTP connection on early return/throw/abort
    return full;
  }

  // Pobieranie modelu do lokalnej Ollamy: POST /api/pull (NDJSON: {status, total, completed}) →
  // onProgress({status, pct}); abort przez signal. Po sukcesie lista modeli jest odświeżana.
  async function pull(name, onProgress, signal){
    name=String(name||'').trim(); if(!name) throw new Error('model');
    let r;
    try{ r=await fetch(base()+'/api/pull',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:name, stream:true}), signal }); }
    catch(e){ if(e&&e.name==='AbortError') throw e; throw await unreachable(e); }
    if(!r.ok){ const d=await errBody(r); throw new Error('Ollama: '+(d||('HTTP '+r.status))); }
    const reader=r.body.getReader(); const dec=new TextDecoder(); let buf='', last=null;
    try{
      for(;;){ const {done,value}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true}); let nl;
        while((nl=buf.indexOf('\n'))>=0){ const line=buf.slice(0,nl).trim(); buf=buf.slice(nl+1); if(!line) continue;
          let j; try{ j=JSON.parse(line); }catch(e){ continue; }
          if(j.error) throw new Error('Ollama: '+j.error);
          last=j; if(onProgress) onProgress({status:j.status||'', pct:(j.total&&j.completed)?Math.round(j.completed/j.total*100):null, total:j.total||0, completed:j.completed||0}); } }
    } finally { try{ reader.cancel().catch(()=>{}); }catch(e){ /* strumień już zamknięty */ } }
    _models=null; try{ await models(true); }catch(e){ /* lista odświeży się przy następnym odczycie */ }
    return last;
  }
  // propozycje do pobrania (nazwa, rozmiar, do czego)
  const SUGGESTED=[
    {name:'qwen2.5:3b', size:'1.9 GB', note:'szybki, dobrze po polsku'},
    {name:'llama3.2:3b', size:'2.0 GB', note:'lekki, uniwersalny'},
    {name:'gemma2:2b', size:'1.6 GB', note:'bardzo lekki'},
    {name:'phi3.5', size:'2.2 GB', note:'Microsoft, kompaktowy'},
    {name:'qwen2.5:7b', size:'4.7 GB', note:'polecany do sterowania aplikacją'},
    {name:'qwen2.5-coder:7b', size:'4.7 GB', note:'do kodu'},
    {name:'llama3.1:8b', size:'4.9 GB', note:'uniwersalny, wywołania narzędzi'},
    {name:'mistral:7b', size:'4.1 GB', note:'Mistral 7B'},
    {name:'bge-m3', size:'1.2 GB', note:'embeddingi do RAG („📚 kod"), wielojęzyczny'},
    {name:'nomic-embed-text', size:'0.3 GB', note:'embeddingi do RAG, lekki (angielski)'},
    {name:'qwen3:8b', size:'5.2 GB', note:'myślący (szybka odpowiedź = bez myśli)'},
    {name:'deepseek-r1:8b', size:'4.9 GB', note:'myślący (pokazuje tok rozumowania)'},
    {name:'gemma3:4b', size:'3.3 GB', note:'Google, wielojęzyczny'},
    {name:'gpt-oss:20b', size:'13 GB', note:'OpenAI open-weight (myślący; 16 GB+ RAM)'},
  ];
  return { base, setBase, model, setModel, models, online, check, chat, chatTools, pull, modelSizeGB, embeddingModels, embed, SUGGESTED, DEF_BASE };
})();
