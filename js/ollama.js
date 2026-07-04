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
      return (j.message&&j.message.content)||'';
    }
    // NDJSON stream: {message:{content}, done:false} … {done:true}
    const reader=r.body.getReader(); const dec=new TextDecoder();
    let buf='', full='';
    const take=(line)=>{ line=line.trim(); if(!line) return false;
      let j; try{ j=JSON.parse(line); }catch(e){ return false; }
      if(j.error) throw new Error('Ollama: '+j.error);
      const d=(j.message&&j.message.content)||'';
      if(d){ full+=d; opts.onToken(d, full); }
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

  return { base, setBase, model, setModel, models, online, chat, DEF_BASE };
})();
