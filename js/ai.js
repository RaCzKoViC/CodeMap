/* ===================== ai.js — klucze API i dostawcy chmurowi (CM.AI) =====================
   Jedna warstwa dla wszystkich dostawców „z kluczem": Mistral, OpenAI, Anthropic, Google Gemini,
   Groq, OpenRouter, DeepSeek, xAI, Together. Klucze (dowolna liczba) żyją w localStorage pod
   `codemap_ai_keys` jako [{id, key, provider, model, status, models}] — dostawca jest WYKRYWANY
   po formacie klucza i POTWIERDZANY testem (lista modeli danego API), więc użytkownik wkleja
   klucz i widzi, czyj on jest, czy działa i jakie modele ma do wyboru.
   Trzy style API: 'openai' (chat/completions + SSE; Mistral/Groq/OpenRouter/DeepSeek/xAI/Together
   są zgodne), 'anthropic' (messages + SSE content_block_delta), 'gemini' (generateContent + SSE).
   Wszystko z przeglądarki, bezpośrednio do dostawcy — klucze nigdy nie idą na serwer CodeMap. */
CM.AI = (function(){
  const I=CM.i18n;
  const STORE='codemap_ai_keys';
  const LEGACY_SLOTS='codemap_mistral_keys', LEGACY_ONE='codemap_mistral_key', LEGACY_MODEL='codemap_mistral_model';

  const STR={
    pl:{ noKey:'Brak działającego klucza API — dodaj i przetestuj klucz w Ustawieniach → AI.',
         badKey:'Nieprawidłowy lub nieaktywny klucz', rate:'przekroczono limit zapytań — spróbuj za chwilę',
         net:'brak połączenia z API (sieć lub CORS)', unknown:'nie rozpoznano dostawcy — żadne z obsługiwanych API nie przyjęło klucza',
         noModel:'brak modelu' },
    en:{ noKey:'No working API key — add and test a key in Settings → AI.',
         badKey:'Invalid or inactive key', rate:'rate limit exceeded — try again in a moment',
         net:'cannot reach the API (network or CORS)', unknown:'provider not recognised — none of the supported APIs accepted the key',
         noModel:'no model' },
  };
  const t=(k)=>{ const d=STR[I.getLang()]||STR.pl; return (k in d)?d[k]:(STR.pl[k]||k); };

  // ---------------- rejestr dostawców ----------------
  // match: szybkie rozpoznanie po formacie klucza (bez sieci); test() rozstrzyga niejednoznaczne (sk-…)
  const PROVIDERS={
    anthropic: {name:'Anthropic (Claude)', style:'anthropic', base:'https://api.anthropic.com/v1',
                model:'claude-sonnet-4-5', match:(k)=>/^sk-ant-/.test(k), prefer:/sonnet/i},
    openrouter:{name:'OpenRouter', style:'openai', base:'https://openrouter.ai/api/v1',
                model:'openai/gpt-4o-mini', match:(k)=>/^sk-or-/.test(k), json:true},
    gemini:    {name:'Google Gemini', style:'gemini', base:'https://generativelanguage.googleapis.com/v1beta',
                model:'gemini-2.5-flash', match:(k)=>/^AIza[0-9A-Za-z_-]{30,}$/.test(k), prefer:/flash/i, json:true},
    groq:      {name:'Groq', style:'openai', base:'https://api.groq.com/openai/v1',
                model:'llama-3.3-70b-versatile', match:(k)=>/^gsk_/.test(k), json:true},
    xai:       {name:'xAI (Grok)', style:'openai', base:'https://api.x.ai/v1',
                model:'grok-3-mini', match:(k)=>/^xai-/.test(k), prefer:/grok/i},
    deepseek:  {name:'DeepSeek', style:'openai', base:'https://api.deepseek.com/v1',
                model:'deepseek-chat', match:(k)=>/^sk-[0-9a-f]{32}$/.test(k), json:true},
    openai:    {name:'OpenAI', style:'openai', base:'https://api.openai.com/v1',
                model:'gpt-4o-mini', match:(k)=>/^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/.test(k)&&!/^sk-(ant|or)-/.test(k), prefer:/^gpt-4o-mini|^gpt-4\.1-mini|^gpt-5-mini/i, json:true},
    mistral:   {name:'Mistral', style:'openai', base:'https://api.mistral.ai/v1',
                model:'mistral-small-latest', match:(k)=>/^[A-Za-z0-9]{32}$/.test(k), prefer:/^mistral-small-latest$/, json:true},
    together:  {name:'Together AI', style:'openai', base:'https://api.together.xyz/v1',
                model:'meta-llama/Llama-3.3-70B-Instruct-Turbo', match:(k)=>/^[0-9a-f]{64}$/.test(k), json:false},
  };
  const ORDER=Object.keys(PROVIDERS);
  const providerName=(p)=>(PROVIDERS[p]&&PROVIDERS[p].name)||p||'?';
  function detect(key){
    key=String(key||'').trim();
    const hits=ORDER.filter(p=>{ try{ return PROVIDERS[p].match(key); }catch(e){ return false; } });
    return hits;
  }
  const mask=(k)=>{ k=String(k||''); return k.length<=10?'•'.repeat(k.length):(k.slice(0,4)+'…'+k.slice(-4)); };

  // ---------------- magazyn kluczy ----------------
  let _cache=null;
  const uid=()=>'k'+Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-3);
  function load(){
    if(_cache) return _cache;
    let arr=null; try{ arr=JSON.parse(localStorage.getItem(STORE)||'null'); }catch(e){}
    if(!Array.isArray(arr)){ arr=migrate(); }
    _cache=arr.filter(e=>e&&typeof e==='object').map(e=>({
      id:e.id||uid(), key:String(e.key||'').trim(), provider:PROVIDERS[e.provider]?e.provider:null,
      model:e.model||null, status:e.status||null, models:Array.isArray(e.models)?e.models.slice(0,200):null, label:e.label||'' }));
    return _cache;
  }
  // stare 4 sloty Mistral (i pojedynczy klucz) → wpisy z dostawcą 'mistral' i dotychczasowym modelem
  function migrate(){
    let slots=[]; try{ slots=JSON.parse(localStorage.getItem(LEGACY_SLOTS)||'[]'); }catch(e){}
    if(!Array.isArray(slots)) slots=[];
    const one=(localStorage.getItem(LEGACY_ONE)||'').trim();
    const model=localStorage.getItem(LEGACY_MODEL)||null;
    const seen=new Set(); const out=[];
    for(const k of slots.concat([one])){ const key=String(k||'').trim(); if(!key||seen.has(key)) continue; seen.add(key);
      out.push({id:uid(), key, provider:'mistral', model, status:null, models:null, label:''}); }
    if(out.length){ try{ localStorage.setItem(STORE, JSON.stringify(out)); }catch(e){} }
    return out;
  }
  function save(list){
    _cache=list;
    try{ localStorage.setItem(STORE, JSON.stringify(list)); }catch(e){}
    // lustro dla starszych ścieżek (mistralKeySlots): działające klucze Mistral w dawnych slotach
    try{ const m=list.filter(e=>e.provider==='mistral'&&e.key).map(e=>e.key).slice(0,4); while(m.length<4) m.push('');
      localStorage.setItem(LEGACY_SLOTS, JSON.stringify(m)); localStorage.setItem(LEGACY_ONE, m.find(Boolean)||''); }catch(e){}
    fire();
  }
  const keys=()=>load().slice();
  function add(key){ const e={id:uid(), key:String(key||'').trim(), provider:detect(key)[0]||null, model:null, status:null, models:null, label:''};
    const list=load().slice(); list.push(e); save(list); return e; }
  function update(id, patch){ const list=load().map(e=>e.id===id?Object.assign({}, e, patch):e); save(list); return list.find(e=>e.id===id); }
  function remove(id){ save(load().filter(e=>e.id!==id)); }
  const listeners=new Set();
  const onChange=(fn)=>{ listeners.add(fn); return ()=>listeners.delete(fn); };
  const fire=()=>{ for(const fn of listeners){ try{ fn(); }catch(e){} } };

  // klucze zdatne do użycia: przetestowane OK albo jeszcze nietestowane z rozpoznanym dostawcą
  const usable=()=>load().filter(e=>e.key&&e.provider&&(!e.status||e.status.ok!==false));
  const primary=()=>usable().find(e=>e.status&&e.status.ok)||usable()[0]||null;
  const hasKey=()=>usable().length>0;
  const modelFor=(e)=>e.model||(PROVIDERS[e.provider]&&PROVIDERS[e.provider].model)||'';

  // ---------------- błędy ----------------
  function httpErr(p, r, body){
    const e=new Error(''); e.status=r.status; e.provider=p;
    let detail=''; try{ const j=JSON.parse(body||''); detail=(j.error&&(j.error.message||j.error))||j.message||''; if(typeof detail!=='string') detail=JSON.stringify(detail); }catch(_){ detail=String(body||'').slice(0,160); }
    if(r.status===401||r.status===403) e.message=t('badKey')+' ('+providerName(p)+')'+(detail?': '+detail.slice(0,120):'');
    else if(r.status===429) e.message=providerName(p)+': '+t('rate');
    else e.message=providerName(p)+': HTTP '+r.status+(detail?' — '+detail.slice(0,160):'');
    return e;
  }
  function netErr(p, err){ const e=new Error(providerName(p)+': '+t('net')); e.code='net'; e.provider=p; e.cause=err; return e; }
  async function doFetch(p, url, init){
    let r; try{ r=await fetch(url, init); }catch(err){ if(err&&err.name==='AbortError') throw err; throw netErr(p, err); }
    return r;
  }
  const headersFor=(p, key, accept)=>{
    const P=PROVIDERS[p]; const h={'Content-Type':'application/json','Accept':accept||'application/json'};
    if(P.style==='anthropic'){ h['x-api-key']=key; h['anthropic-version']='2023-06-01'; h['anthropic-dangerous-direct-browser-access']='true'; }
    else if(P.style==='openai'){ h['Authorization']='Bearer '+key; if(p==='openrouter'){ h['HTTP-Referer']=location.origin; h['X-Title']='CodeMap'; } }
    return h;
  };

  // ---------------- lista modeli = test klucza ----------------
  async function listModels(p, key, signal){
    const P=PROVIDERS[p]; if(!P) throw new Error('provider');
    if(P.style==='gemini'){
      const r=await doFetch(p, P.base+'/models?pageSize=200&key='+encodeURIComponent(key), {signal});
      if(!r.ok) throw httpErr(p, r, await r.text().catch(()=>''));
      const j=await r.json();
      return (j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent'))
        .map(m=>String(m.name||'').replace(/^models\//,'')).filter(Boolean);
    }
    const r=await doFetch(p, P.base+'/models', {headers:headersFor(p, key), signal});
    if(!r.ok) throw httpErr(p, r, await r.text().catch(()=>''));
    const j=await r.json();
    const arr=Array.isArray(j.data)?j.data:(Array.isArray(j.models)?j.models:[]);
    return arr.map(m=>m.id||m.name||'').filter(Boolean);
  }
  function pickModel(p, models, current){
    if(current && models.includes(current)) return current;
    const P=PROVIDERS[p];
    if(P.model && models.includes(P.model)) return P.model;
    if(P.prefer){ const hit=models.find(m=>P.prefer.test(m)); if(hit) return hit; }
    return models[0]||P.model||'';
  }
  // Test: potwierdza dostawcę (kandydaci po formacie klucza, potem reszta), zapisuje listę modeli
  // i wynik. Zwraca {ok, provider, models, model, ms} albo {ok:false, error}.
  async function test(id, signal){
    const e=load().find(x=>x.id===id); if(!e) throw new Error('key');
    const key=e.key; if(!key) return {ok:false, error:t('badKey')};
    const cands=[]; const push=(p)=>{ if(p&&PROVIDERS[p]&&!cands.includes(p)) cands.push(p); };
    push(e.provider); detect(key).forEach(push);
    if(!cands.length) ORDER.forEach(push);   // nieznany format → sprawdź wszystkich (401 = następny)
    let last=null; const t0=performance.now();
    for(const p of cands){
      try{ const models=await listModels(p, key, signal);
        const model=pickModel(p, models, e.provider===p?e.model:null);
        const status={ok:true, at:Date.now(), ms:Math.round(performance.now()-t0), count:models.length};
        update(id, {provider:p, models, model, status});
        return {ok:true, provider:p, models, model, ms:status.ms};
      }catch(err){ if(err&&err.name==='AbortError') throw err; last=err; }
    }
    const error=(last&&last.code==='net')?last.message:(cands.length===1?(last&&last.message)||t('badKey'):t('unknown')+(last?(' — '+last.message):''));
    update(id, {status:{ok:false, at:Date.now(), error}});
    return {ok:false, error};
  }

  // ---------------- czat (3 style API) ----------------
  // opts: {entry?, model?, temperature, maxTokens, json, onToken(delta, full), signal}
  async function chat(messages, opts){
    opts=opts||{};
    const e=opts.entry||primary();
    if(!e) { const err=new Error(t('noKey')); err.status=0; throw err; }
    const p=e.provider, P=PROVIDERS[p]; if(!P){ const err=new Error(t('unknown')); err.status=0; throw err; }
    const model=opts.model||modelFor(e); if(!model) throw new Error(providerName(p)+': '+t('noModel'));
    if(P.style==='anthropic') return chatAnthropic(e, model, messages, opts);
    if(P.style==='gemini') return chatGemini(e, model, messages, opts);
    return chatOpenAI(e, model, messages, opts);
  }
  // round-robin po wszystkich działających kluczach + automatyczne przejście na następny przy
  // 401/429/5xx (jak dawny aiChat dla 4 kluczy Mistral) — używane przez analizę struktury i pytania
  let _rot=0;
  async function chatAny(messages, opts){
    const list=usable(); if(!list.length){ const err=new Error(t('noKey')); err.status=0; throw err; }
    let lastErr=null;
    for(let i=0;i<list.length;i++){
      const e=list[(_rot+i)%list.length];
      try{ const r=await chat(messages, Object.assign({}, opts, {entry:e, model:(opts&&opts.model)||modelFor(e)}));
        _rot=(_rot+i+1)%list.length; return r; }
      catch(err){ lastErr=err; if(err&&err.name==='AbortError') throw err;
        const recoverable=err&&(err.status===401||err.status===403||err.status===429||err.status>=500||err.code==='net');
        if(!recoverable) throw err; }
    }
    throw lastErr||new Error(t('noKey'));
  }

  async function readSSE(r, onData){
    const reader=r.body.getReader(), dec=new TextDecoder(); let buf='';
    try{
      for(;;){
        const {value, done}=await reader.read(); if(done) break;
        buf+=dec.decode(value,{stream:true});
        let nl;
        while((nl=buf.indexOf('\n'))>=0){
          const line=buf.slice(0,nl).trim(); buf=buf.slice(nl+1);
          if(!line.startsWith('data:')) continue;
          const data=line.slice(5).trim();
          if(data==='[DONE]') return;
          let j; try{ j=JSON.parse(data); }catch(e){ continue; }
          if(onData(j)===false) return;
        }
      }
    } finally { try{ reader.cancel(); }catch(e){} }
  }

  async function chatOpenAI(e, model, messages, opts){
    const p=e.provider, P=PROVIDERS[p];
    const body={model, messages:messages.map(m=>({role:m.role, content:String(m.content||'')})),
      temperature:opts.temperature==null?0.4:opts.temperature, stream:!!opts.onToken};
    if(opts.maxTokens) body.max_tokens=opts.maxTokens;
    if(opts.json && P.json) body.response_format={type:'json_object'};
    const r=await doFetch(p, P.base+'/chat/completions', {method:'POST', headers:headersFor(p, e.key, body.stream?'text/event-stream':'application/json'), body:JSON.stringify(body), signal:opts.signal});
    if(!r.ok) throw httpErr(p, r, await r.text().catch(()=>''));
    if(!body.stream){ const j=await r.json(); return (j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||''; }
    let full='';
    await readSSE(r, (j)=>{ const d=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content; if(d){ full+=d; opts.onToken(d, full); } });
    return full;
  }
  async function chatAnthropic(e, model, messages, opts){
    const p=e.provider, P=PROVIDERS[p];
    const system=messages.filter(m=>m.role==='system').map(m=>String(m.content||'')).join('\n\n');
    const conv=messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'assistant':'user', content:String(m.content||'')}));
    if(!conv.length||conv[0].role!=='user') conv.unshift({role:'user', content:'(start)'});
    const body={model, max_tokens:opts.maxTokens||1024, messages:conv, temperature:opts.temperature==null?0.4:opts.temperature, stream:!!opts.onToken};
    if(system) body.system=system;
    const r=await doFetch(p, P.base+'/messages', {method:'POST', headers:headersFor(p, e.key, body.stream?'text/event-stream':'application/json'), body:JSON.stringify(body), signal:opts.signal});
    if(!r.ok) throw httpErr(p, r, await r.text().catch(()=>''));
    if(!body.stream){ const j=await r.json(); return (j.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(''); }
    let full='';
    await readSSE(r, (j)=>{ if(j.type==='content_block_delta'&&j.delta&&j.delta.type==='text_delta'){ full+=j.delta.text; opts.onToken(j.delta.text, full); }
      if(j.type==='error'){ throw new Error(providerName(p)+': '+((j.error&&j.error.message)||'error')); } });
    return full;
  }
  async function chatGemini(e, model, messages, opts){
    const p=e.provider, P=PROVIDERS[p];
    const system=messages.filter(m=>m.role==='system').map(m=>String(m.content||'')).join('\n\n');
    const contents=messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user', parts:[{text:String(m.content||'')}]}));
    if(!contents.length) contents.push({role:'user', parts:[{text:'(start)'}]});
    const body={contents, generationConfig:{temperature:opts.temperature==null?0.4:opts.temperature}};
    if(opts.maxTokens) body.generationConfig.maxOutputTokens=opts.maxTokens;
    if(opts.json) body.generationConfig.responseMimeType='application/json';
    if(system) body.systemInstruction={parts:[{text:system}]};
    const stream=!!opts.onToken;
    const url=P.base+'/models/'+encodeURIComponent(model)+(stream?':streamGenerateContent?alt=sse&key=':':generateContent?key=')+encodeURIComponent(e.key);
    const r=await doFetch(p, url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:opts.signal});
    if(!r.ok) throw httpErr(p, r, await r.text().catch(()=>''));
    const textOf=(j)=>((j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts)||[]).map(x=>x.text||'').join('');
    if(!stream){ const j=await r.json(); return textOf(j); }
    let full='';
    await readSSE(r, (j)=>{ const d=textOf(j); if(d){ full+=d; opts.onToken(d, full); } });
    return full;
  }

  return { PROVIDERS, providerName, detect, mask, keys, add, update, remove, save, test, listModels, usable, primary, hasKey, modelFor, chat, chatAny, onChange, t };
})();
