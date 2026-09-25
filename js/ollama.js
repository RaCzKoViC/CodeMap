/* ===================== ollama.js — natywne lokalne modele przez serwer Ollama =====================
   CM.Ollama — trzeci dostawca AI: modele lokalne uruchamiane NATYWNIE (poza przeglądarką) przez
   zainstalowaną Ollamę (ollama.com). Błyskawiczne na tle WebLLM w przeglądarce: pełna moc CPU/GPU,
   zero konkurencji z renderowaniem mapy, zero pobierania wag do przeglądarki.
   API: GET /api/tags (lista modeli), POST /api/chat ze stream:true (NDJSON) — abort natychmiastowy
   przez AbortSignal fetcha. Modele myślące (deepseek-r1 itp.) emitują <think> — UI czatu już to
   obsługuje niezależnie od dostawcy. */
CM.Ollama = (function(){
  const I=CM.i18n;
  const BASE_KEY='codemap_ollama_base';
  const MODEL_KEY='codemap_ollama_model';
  const DEF_BASE='http://localhost:11434';

  const base=()=>{ const v=(localStorage.getItem(BASE_KEY)||'').trim(); return (v||DEF_BASE).replace(/\/+$/,''); };
  const setBase=(u)=>{ try{ localStorage.setItem(BASE_KEY,(u||'').trim()); }catch(e){} };
  const model=()=>localStorage.getItem(MODEL_KEY)||'';
  const setModel=(m)=>{ try{ localStorage.setItem(MODEL_KEY,m||''); }catch(e){} };

  const offlineErr=()=>new Error(I.t('ol.offline','Ollama nie odpowiada pod ')+base()+I.t('ol.offlineHint',' — uruchom aplikację Ollama (lub `ollama serve`) i spróbuj ponownie.'));

  let _models=null;               // cache listy modeli (odświeżany przez models(true))
  async function models(force){
    if(_models && !force) return _models;
    let r;
    try{ r=await fetch(base()+'/api/tags',{signal:AbortSignal.timeout?AbortSignal.timeout(4000):undefined}); }
    catch(e){ throw offlineErr(); }
    if(!r.ok) throw new Error('Ollama: HTTP '+r.status);
    const j=await r.json();
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
      throw offlineErr();
    }
    if(!r.ok){ let d=''; try{ d=(await r.json()).error||''; }catch(e){}
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
    } finally { try{ reader.cancel(); }catch(e){} }   // free the HTTP connection on early return/throw/abort
    return full;
  }

  // Pobieranie modelu do lokalnej Ollamy: POST /api/pull (NDJSON: {status, total, completed}) →
  // onProgress({status, pct}); abort przez signal. Po sukcesie lista modeli jest odświeżana.
  async function pull(name, onProgress, signal){
    name=String(name||'').trim(); if(!name) throw new Error('model');
    let r;
    try{ r=await fetch(base()+'/api/pull',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:name, stream:true}), signal }); }
    catch(e){ if(e&&e.name==='AbortError') throw e; throw offlineErr(); }
    if(!r.ok){ let d=''; try{ d=(await r.json()).error||''; }catch(e){} throw new Error('Ollama: '+(d||('HTTP '+r.status))); }
    const reader=r.body.getReader(); const dec=new TextDecoder(); let buf='', last=null;
    try{
      for(;;){ const {done,value}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true}); let nl;
        while((nl=buf.indexOf('\n'))>=0){ const line=buf.slice(0,nl).trim(); buf=buf.slice(nl+1); if(!line) continue;
          let j; try{ j=JSON.parse(line); }catch(e){ continue; }
          if(j.error) throw new Error('Ollama: '+j.error);
          last=j; if(onProgress) onProgress({status:j.status||'', pct:(j.total&&j.completed)?Math.round(j.completed/j.total*100):null, total:j.total||0, completed:j.completed||0}); } }
    } finally { try{ reader.cancel(); }catch(e){} }
    _models=null; try{ await models(true); }catch(e){}
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
    {name:'qwen3:8b', size:'5.2 GB', note:'myślący (szybka odpowiedź = bez myśli)'},
    {name:'deepseek-r1:8b', size:'4.9 GB', note:'myślący (pokazuje tok rozumowania)'},
    {name:'gemma3:4b', size:'3.3 GB', note:'Google, wielojęzyczny'},
    {name:'gpt-oss:20b', size:'13 GB', note:'OpenAI open-weight (myślący; 16 GB+ RAM)'},
  ];
  return { base, setBase, model, setModel, models, online, chat, pull, modelSizeGB, SUGGESTED, DEF_BASE };
})();
