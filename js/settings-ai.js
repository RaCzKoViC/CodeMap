/* ===================== settings-ai.js — zakładka „AI” w Ustawieniach ===================== */
// Dostawca (klucze API w chmurze / model lokalny WebLLM / Ollama), klucze API z testem, wspólna sekcja
// indeksu kodu (RAG), analiza struktury i licznik ocen ChatBota. Rejestruje się przez CM.Settings.addTab.
(function(){
  const K=CM.Settings.kit, U=K.U, el=K.el, ic=K.ic, t=K.t, section=K.section;

  function tabAI(c){
    section(c, t('ai.head'), 'ai.desc');
    // ---- provider: Mistral API (cloud) vs LOCAL in-browser model (WebLLM/WebGPU, free, no key) ----
    if(CM.LocalAI) providerSection(c, CM.LocalAI);
    keysSection(c);
    analyzeSection(c);
    votesSection(c);
    // NOTE: "Ask about the project" moved to the selected element's Details panel; "Arrange map via AI"
    // now runs automatically on load (when AI auto-tune is on) — both removed from Settings by design.
  }

  // ---- wybór dostawcy + panele: model lokalny (WebLLM) i Ollama ----
  function providerSection(c, LA){
    c.appendChild(el('div',{class:'set-label',text:t('ai.provider')}));
    c.appendChild(el('p',{class:'set-desc',text:t('ai.providerHint')}));
    const provSel=el('select',{class:'set-ai-input'});
    [['mistral',t('ai.provMistral')],['local',t('ai.provLocal')],['ollama',t('ai.provOllama')]].forEach(([v,n])=>{
      const o=el('option',{value:v,text:n}); if(v===LA.provider()) o.selected=true; provSel.appendChild(o); });
    c.appendChild(provSel);
    const localBox=el('div',{class:'set-localai'});
    c.appendChild(localBox);
    const ollamaBox=el('div',{class:'set-localai'});
    c.appendChild(ollamaBox);
    const renderOllama=ollamaPanel(LA, ollamaBox), renderLocal=localPanel(LA, localBox);
    provSel.onchange=()=>{ LA.setProvider(provSel.value); renderLocal(); renderOllama(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); };
    renderLocal(); renderOllama();
    c.appendChild(el('div',{class:'set-sep'}));
  }

  // sekcja „Indeks kodu (RAG)” — ta sama przy Ollamie i przy WebLLM (modele embeddingów z obu źródeł)
  async function ragSection(ragBox){
    if(!CM.RAG) return; ragBox.innerHTML='';
    ragBox.appendChild(el('div',{class:'set-label set-mt',text:t('ai.rag')}));
    ragBox.appendChild(el('p',{class:'set-desc',text:t('ai.ragDesc')}));
    const eSel=el('select',{class:'set-ai-input'}), rstat=el('div',{class:'set-localai-stat'});
    const rbar=el('div',{class:'set-localai-bar'}, el('div',{class:'set-localai-fill'})); rbar.style.display='none';
    const brow=el('div',{class:'set-localai-row'});
    const bBuild=el('button',{class:'tb-btn primary',html:ic.svg('refresh',{size:14})+' '+t('ai.ragBuild')});
    const bClear=el('button',{class:'tb-btn',text:t('ai.ragClear')});
    brow.appendChild(bBuild); brow.appendChild(bClear);
    ragBox.appendChild(el('div',{class:'set-desc',text:t('ai.ragModel')})); ragBox.appendChild(eSel); ragBox.appendChild(brow); ragBox.appendChild(rbar); ragBox.appendChild(rstat);
    const agentCb=el('input',{type:'checkbox'}); try{ agentCb.checked=localStorage.getItem('codemap_chatbot_agent')!=='0'; }catch(e){ agentCb.checked=true; }
    agentCb.onchange=()=>{ U.lsSet('codemap_chatbot_agent', agentCb.checked?'1':'0'); };
    ragBox.appendChild(el('label',{class:'chk set-mt'}, agentCb, el('span',{text:t('ai.ragAgent')})));
    const showStat=async()=>{
      const g=window.CMApp&&CMApp.graph; if(!g||!g.nodes||g.nodes.size<2){ rstat.textContent=t('ai.ragNoProject'); return; }
      await CM.RAG.ensure(g); const s=CM.RAG.stats();
      rstat.textContent=t('ai.ragStat').replace('{c}',s.chunks).replace('{f}',s.files).replace('{v}', s.vectors?t('ai.ragYes').replace('{m}',s.model).replace('{d}',s.dim):t('ai.ragNo'));
      rstat.className='set-localai-stat'+(s.vectors?' ok':'');
    };
    let models=[]; try{ models=await CM.RAG.embeddingModels(); }catch(e){ /* brak modeli → komunikat niżej */ }
    eSel.innerHTML='';
    if(!models.length){ eSel.appendChild(el('option',{value:'',text:'—'})); eSel.disabled=true; bBuild.disabled=true; rstat.textContent=t('ai.ragNoModel'); rstat.className='set-localai-stat err'; }
    else { const cur=await CM.RAG.pickModel();
      models.forEach(m=>{ const o=el('option',{value:m.name,text:m.web?('🌐 '+m.name.replace(/^webllm:/,'')+' — '+t('ai.ragWeb')+(m.vramMB?(' · '+m.vramMB+' MB'):'')):(m.name+(m.sizeGB?(' ('+m.sizeGB+' GB)'):''))}); if(m.name===cur) o.selected=true; eSel.appendChild(o); });
      showStat(); }
    eSel.onchange=()=>{ CM.RAG.setModelPref(eSel.value); showStat(); };
    bBuild.onclick=async()=>{
      if(CM.RAG.isBuilding()){ CM.RAG.cancelBuild(); return; }
      bBuild.innerHTML=t('ai.ragCancel'); rbar.style.display='block'; rstat.className='set-localai-stat';
      try{ const s=await CM.RAG.buildVectors({model:eSel.value, onProgress:(d,n)=>{ rstat.textContent=d+' / '+n; rbar.firstChild.style.width=Math.round(d/Math.max(1,n)*100)+'%'; },
          onLoad:(p)=>{ rstat.textContent=(p.text||'')+(p.pct?' '+p.pct+'%':''); rbar.firstChild.style.width=(p.pct||0)+'%'; }});
        if(s){ rstat.textContent=t('ai.ragDone')+s.chunks+' · '+s.model; rstat.className='set-localai-stat ok'; } }
      catch(e){ rstat.textContent=(e&&e.name==='AbortError')?'—':((e&&e.message)||String(e)); rstat.className='set-localai-stat err'; }
      finally{ bBuild.innerHTML=ic.svg('refresh',{size:14})+' '+t('ai.ragBuild'); rbar.style.display='none'; }
    };
    bClear.onclick=async()=>{ await CM.RAG.clearVectors(); showStat(); };
  }

  // ---- Ollama: adres serwera, modele, pobieranie modeli, RAG ----
  function ollamaPanel(LA, ollamaBox){
    const renderOllama=async()=>{
      ollamaBox.innerHTML='';
      if(LA.provider()!=='ollama' || !CM.Ollama) return;
      ollamaBox.appendChild(el('p',{class:'set-desc',text:t('ai.ollamaDesc')}));
      const row=el('div',{class:'set-localai-row'});
      const baseInp=el('input',{class:'set-ai-input',style:'flex:1;min-width:0',value:CM.Ollama.base(),placeholder:CM.Ollama.DEF_BASE});
      const btn=el('button',{class:'tb-btn primary',html:ic.svg('refresh',{size:14})+' '+t('ai.ollamaCheck')});
      row.appendChild(baseInp); row.appendChild(btn); ollamaBox.appendChild(row);
      ollamaBox.appendChild(el('div',{class:'set-label set-mt',text:t('ai.ollamaModel')}));
      const mSel=el('select',{class:'set-ai-input'});
      const stat=el('div',{class:'set-localai-stat'});
      ollamaBox.appendChild(mSel); ollamaBox.appendChild(stat);
      // ---- pobieranie modeli do Ollamy z poziomu aplikacji ----
      const pullBox=el('div',{class:'set-localai-pull'}); ollamaBox.appendChild(pullBox);
      let pullCtl=null;
      const renderPull=()=>{
        if(pullBox.childElementCount) return;   // raz — odświeżenie listy modeli nie kasuje statusu pobierania
        pullBox.innerHTML='';
        pullBox.appendChild(el('div',{class:'set-label set-mt',text:t('ai.ollamaPull')}));
        pullBox.appendChild(el('p',{class:'set-desc',text:t('ai.ollamaPullHint')}));
        const prow=el('div',{class:'set-localai-row'});
        const pinp=el('input',{class:'set-ai-input',style:'flex:1;min-width:0',placeholder:'qwen2.5:3b',spellcheck:'false',autocomplete:'off'});
        const pbtn=el('button',{class:'tb-btn primary',html:ic.svg('download',{size:14})+' '+t('ai.ollamaPullBtn')});
        prow.appendChild(pinp); prow.appendChild(pbtn); pullBox.appendChild(prow);
        const pbar=el('div',{class:'set-localai-bar'}, el('div',{class:'set-localai-fill'})); pbar.style.display='none';
        const pstat=el('div',{class:'set-localai-stat'}); pullBox.appendChild(pbar); pullBox.appendChild(pstat);
        const sug=el('div',{class:'set-localai-sug'}); sug.appendChild(el('span',{class:'set-desc',text:t('ai.ollamaSuggest')}));
        (CM.Ollama.SUGGESTED||[]).forEach(m=>{ const b=el('button',{class:'set-localai-sugbtn',type:'button',title:m.note+' · '+m.size,text:m.name,onclick:()=>{ pinp.value=m.name; pbtn.click(); }}); sug.appendChild(b); });
        pullBox.appendChild(sug);
        pbtn.onclick=async()=>{ const name=pinp.value.trim(); if(!name) return;
          if(pullCtl){ pullCtl.abort(); return; }
          pullCtl=new AbortController(); pbtn.innerHTML=t('ai.ollamaPullCancel'); pinp.disabled=true; pbar.style.display='block'; pstat.className='set-localai-stat';
          try{ await CM.Ollama.pull(name, (p)=>{ pstat.textContent=(p.status||'')+(p.pct!=null?(' '+p.pct+'%'):''); pbar.firstChild.style.width=(p.pct||0)+'%'; }, pullCtl.signal);
            pstat.textContent=t('ai.ollamaPullDone')+name; pstat.className='set-localai-stat ok'; CM.Ollama.setModel(name); await fill(); }
          catch(e){ pstat.textContent=(e&&e.name==='AbortError')?'—':((e&&e.message)||String(e)); pstat.className='set-localai-stat err'; }
          finally{ pullCtl=null; pbtn.innerHTML=ic.svg('download',{size:14})+' '+t('ai.ollamaPullBtn'); pinp.disabled=false; pbar.style.display='none'; } };
      };
      const fill=async()=>{
        stat.className='set-localai-stat'; stat.textContent='…';
        try{
          const list=await CM.Ollama.models(true);
          mSel.innerHTML='';
          list.forEach(m=>{ const o=el('option',{value:m.name,text:m.name+(m.sizeGB?(' ('+m.sizeGB+' GB)'):'')}); if(m.name===CM.Ollama.model()) o.selected=true; mSel.appendChild(o); });
          stat.textContent=t('ai.ollamaOnline')+list.length; stat.className='set-localai-stat ok';
        }catch(e){ mSel.innerHTML=''; stat.textContent=(e&&e.message)||String(e); stat.className='set-localai-stat err'; }
        if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh();
        renderPull(); renderRag();
      };
      mSel.onchange=()=>{ CM.Ollama.setModel(mSel.value); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); };
      // ---- indeks kodu (RAG): model embeddingów + budowanie wektorów ----
      const ragBox=el('div',{class:'set-localai-pull set-rag'}); ollamaBox.appendChild(ragBox);
      const renderRag=()=>ragSection(ragBox);
      btn.onclick=()=>{ CM.Ollama.setBase(baseInp.value); fill(); };
      baseInp.onchange=()=>CM.Ollama.setBase(baseInp.value);
      fill();
    };
    return renderOllama;
  }

  // ---- model lokalny w przeglądarce (WebLLM): pobieranie, uruchamianie, lista pobranych ----
  function localPanel(LA, localBox){
    const renderLocal=async()=>{
      const tok=(renderLocal._tok=(renderLocal._tok||0)+1);                // race guard: the LAST call wins
      if(renderLocal._off){ renderLocal._off(); renderLocal._off=null; }   // drop the previous live-progress hook
      if(LA.provider()!=='local'){ localBox.innerHTML=''; return; }
      if(!LA.hasWebGPU()){ localBox.innerHTML=''; localBox.appendChild(el('p',{class:'drv-warn',text:t('ai.localNoGPU')})); return; }
      const dlmap=await LA.listDownloaded();   // ONLY models this engine build actually supports
      if(tok!==renderLocal._tok || !localBox.isConnected) return;          // superseded mid-await / tab closed
      localBox.innerHTML='';
      localBox.appendChild(el('div',{class:'set-label',text:t('ai.localModel')}));
      const mSel=el('select',{class:'set-ai-input'});
      dlmap.forEach(m=>{ const o=el('option',{value:m.id,text:(m.downloaded?'✓ ':'')+m.label}); if(m.id===LA.modelId()) o.selected=true; mSel.appendChild(o); });
      mSel.onchange=()=>{ LA.setModel(mSel.value); renderLocal(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); };
      localBox.appendChild(mSel);
      localBox.appendChild(el('p',{class:'set-desc',text:t('ai.localDlHint')}));
      const stat=el('div',{class:'set-localai-stat'});
      const bar=el('div',{class:'set-localai-bar'}, el('div',{class:'set-localai-fill'}));
      const dl=el('button',{class:'tb-btn primary',html:ic.svg('download',{size:14})+' '+t('ai.localDl')});
      const row=el('div',{class:'set-localai-row'}, dl);
      const unl=el('button',{class:'tb-btn',text:t('ai.localUnload'),onclick:async()=>{ await LA.unload(); renderLocal(); }});
      row.appendChild(unl);
      localBox.appendChild(row); localBox.appendChild(bar); localBox.appendChild(stat);
      bar.style.display='none';
      const showProg=(p)=>{ stat.className='set-localai-stat'; stat.textContent=(p&&p.text)||t('ai.localLoading');
        bar.style.display='block'; bar.firstChild.style.width=((p&&p.pct)||0)+'%'; };
      // ---- downloaded-models inventory: mark ✓, block re-download, per-model delete ----
      const listBox=el('div',{class:'set-localai-list'});
      localBox.appendChild(el('div',{class:'set-label set-mt',text:t('ai.localList')}));
      localBox.appendChild(listBox);
      const curDl=(dlmap.find(m=>m.id===LA.modelId())||{}).downloaded;
      const isReady=LA.status()==='ready';
      // main button: downloaded → "Uruchom" (loads from cache, NO re-download); loaded → disabled ✓
      if(isReady){ dl.innerHTML='✓ '+t('ai.localLoaded'); dl.disabled=true; stat.textContent=t('ai.localReady'); stat.className='set-localai-stat ok'; }
      else if(curDl){ dl.innerHTML=ic.svg('flow',{size:14})+' '+t('ai.localRun'); }
      else { dl.innerHTML=ic.svg('download',{size:14})+' '+t('ai.localDl'); }
      dl.onclick=async()=>{
        dl.disabled=true; mSel.disabled=true; unl.textContent=t('ai.localCancel');
        const off=LA.onProgress(showProg); showProg(LA.progress());   // LIVE % also for click-started loads
        try{ await LA.ensureEngine(); }
        catch(e){ if(!e||e.name!=='AbortError'){ stat.textContent=(e&&e.message)||String(e); stat.className='set-localai-stat err'; } }
        finally{ off(); }
        renderLocal(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh();
      };
      // a download/load is ALREADY running (started here earlier or from the ChatBot) →
      // re-attach: current % immediately, live updates, auto-refresh when it SETTLES (success
      // AND failure — hooking the promise, not the 'ready' status, so a failed load can't leak
      // the subscription). This makes the progress survive closing/reopening the AI tab.
      if(LA.status()==='loading'){
        dl.disabled=true; mSel.disabled=true; unl.textContent=t('ai.localCancel'); showProg(LA.progress());
        renderLocal._off=LA.onProgress(p=>{
          if(!localBox.isConnected){ if(renderLocal._off){ renderLocal._off(); renderLocal._off=null; } return; }
          showProg(p); });
        LA.ensureEngine().catch(()=>{}).then(()=>{
          if(renderLocal._off){ renderLocal._off(); renderLocal._off=null; if(localBox.isConnected) renderLocal(); } });
      }
      // ---- pełna lista modeli wbudowanych w silnik (na żądanie — wymaga załadowania biblioteki WebLLM) ----
      const allBox=el('div',{class:'set-localai-all'});
      localBox.appendChild(el('div',{class:'set-label set-mt',text:t('ai.localAll')}));
      localBox.appendChild(el('p',{class:'set-desc',text:t('ai.localAllHint')}));
      const allBtn=el('button',{class:'tb-btn',html:ic.svg('layers',{size:14})+' '+t('ai.localAllShow')});
      allBtn.onclick=async()=>{ allBtn.disabled=true; allBtn.textContent='…';
        try{ const list=await LA.listPrebuilt(); allBox.innerHTML='';
          const sel=el('select',{class:'set-ai-input'}); sel.appendChild(el('option',{value:'',text:t('ai.localAllPick')+' ('+list.length+')'}));
          list.forEach(m=>sel.appendChild(el('option',{value:m.id,text:(m.think?'🧠 ':'')+m.label+(m.vramMB?(' — '+m.vramMB+' MB'):'')+(m.low?' · low':'')})));
          sel.onchange=()=>{ if(!sel.value) return; LA.setModel(sel.value); renderLocal(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); };
          allBox.appendChild(sel); allBtn.remove(); }
        catch(e){ allBtn.disabled=false; allBtn.textContent=t('ai.localAllShow'); U.toast((e&&e.message)||String(e),'error'); } };
      allBox.appendChild(allBtn); localBox.appendChild(allBox);
      const ragLocal=el('div',{class:'set-localai-pull set-rag'}); localBox.appendChild(ragLocal); ragSection(ragLocal);
      const dled=dlmap.filter(m=>m.downloaded);
      if(!dled.length){ listBox.appendChild(el('p',{class:'set-desc',text:t('ai.localNone')})); }
      else for(const m of dled){
        const r=el('div',{class:'set-localai-mrow'});
        r.appendChild(el('span',{class:'set-localai-mname',text:'✓ '+m.label}));
        if(m.id===LA.loadedId()) r.appendChild(el('span',{class:'set-localai-mtag',text:t('ai.localLoaded')}));
        const db=el('button',{class:'drv-btn drv-btn-sm drv-btn-danger',text:t('ai.localDelOne'),onclick:async()=>{
          if(!confirm(t('ai.localDelConfirm').replace('{n}',m.label))) return;
          db.disabled=true; await LA.deleteModel(m.id); renderLocal(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); }});
        r.appendChild(db);
        listBox.appendChild(r);
      }
    };
    return renderLocal;
  }

  function keysSection(c){
    // ---- klucze API: dowolna liczba; dostawca wykrywany po formacie i potwierdzany testem (CM.AI) ----
    c.appendChild(el('div',{class:'set-label',text:t('ai.keys')}));
    c.appendChild(el('p',{class:'set-desc',text:t('ai.keysHint')}));
    const AI=CM.AI;
    const keysBox=el('div',{class:'set-ai-keys'}); c.appendChild(keysBox);
    const countEl=el('div',{class:'set-ai-keycount'}); c.appendChild(countEl);
    const addRow=el('div',{class:'set-ai-keyrow set-ai-keyadd'});
    const addInp=el('input',{class:'set-ai-input set-ai-keyinp',type:'password',placeholder:t('ai.keyPh'),autocomplete:'off',spellcheck:'false'});
    const addBtn=el('button',{class:'tb-btn primary set-ai-keybtn',type:'button',html:ic.svg('plus',{size:14})+' '+t('ai.keyAdd')});
    addRow.appendChild(addInp); addRow.appendChild(addBtn); c.appendChild(addRow);
    async function runTest(id, row){
      const st=row.querySelector('.set-ai-keystat'); if(st){ st.className='set-ai-keystat'; st.textContent=t('ai.keyTesting'); }
      row.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{ await AI.test(id); }
      catch(err){ AI.update(id,{status:{ok:false,at:Date.now(),error:(err&&err.message)||String(err)}}); }
      renderKeys();
    }
    function renderKeys(){
      if(!AI){ keysBox.textContent='CM.AI?'; return; }
      keysBox.innerHTML='';
      const list=AI.keys();
      if(!list.length) keysBox.appendChild(el('p',{class:'set-desc',text:t('ai.keyNone')}));
      for(const e of list){
        const card=el('div',{class:'set-ai-keycard'});
        const top=el('div',{class:'set-ai-keyrow'});
        const badge=el('span',{class:'set-ai-prov'+(e.status?(e.status.ok?' ok':' err'):''),text:e.provider?AI.providerName(e.provider):'?',title:e.provider||''});
        const inp=el('input',{class:'set-ai-input set-ai-keyinp',type:'password',value:e.key,autocomplete:'off',spellcheck:'false'});
        const eye=el('button',{class:'set-ai-keyeye',type:'button',title:t('ai.keyShow'),html:ic.svg('eye',{size:14}),onclick:()=>{ inp.type=inp.type==='password'?'text':'password'; }});
        const testBtn=el('button',{class:'tb-btn primary set-ai-keybtn',type:'button',html:ic.svg('refresh',{size:14})+' '+t('ai.keyTest')});
        const saveBtn=el('button',{class:'tb-btn set-ai-keybtn',type:'button',text:t('ai.keySave')}); saveBtn.disabled=true;
        const delBtn=el('button',{class:'tb-btn set-ai-keybtn danger',type:'button',html:ic.svg('trash',{size:14}),title:t('ai.keyDelete')});
        const commit=()=>{ const k=inp.value.trim(); if(!k){ U.toast(t('ai.keyEmpty'),'error'); return false; }
          if(AI.keys().some(x=>x.id!==e.id&&x.key===k)){ U.toast(t('ai.keyExists'),'error'); return false; }
          if(k!==e.key) AI.update(e.id,{key:k, provider:AI.detect(k)[0]||null, status:null, models:null, model:null});
          return true; };
        inp.oninput=()=>{ const dirty=inp.value.trim()!==e.key; saveBtn.disabled=!dirty; card.classList.toggle('dirty',dirty); };
        inp.onkeydown=(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); if(commit()){ U.toast(t('ai.keySaved'),'success'); renderKeys(); } } };
        saveBtn.onclick=()=>{ if(commit()){ U.toast(t('ai.keySaved'),'success'); renderKeys(); } };
        testBtn.onclick=()=>{ if(!commit()) return; runTest(e.id, card); };
        delBtn.onclick=()=>{ if(!confirm(t('ai.keyDeleteConfirm'))) return; AI.remove(e.id); U.toast(t('ai.keyDeleted')); renderKeys(); };
        top.appendChild(badge); top.appendChild(inp); top.appendChild(eye); top.appendChild(testBtn); top.appendChild(saveBtn); top.appendChild(delBtn);
        card.appendChild(top);
        // model per klucz: lista z testu (datalist) albo wolny wpis
        const mrow=el('div',{class:'set-ai-keyrow set-ai-keymodel'});
        mrow.appendChild(el('span',{class:'set-ai-keyidx',text:t('ai.keyModel')}));
        const dlId='ai-models-'+e.id; const dl=el('datalist',{id:dlId});
        (e.models||[]).forEach(mn=>dl.appendChild(el('option',{value:mn})));
        const minp=el('input',{class:'set-ai-input set-ai-keyinp',list:dlId,value:AI.modelFor(e),placeholder:t('ai.keyModel'),spellcheck:'false',autocomplete:'off'});
        minp.onchange=()=>{ AI.update(e.id,{model:minp.value.trim()||null}); };
        mrow.appendChild(minp); mrow.appendChild(dl); card.appendChild(mrow);
        const st=el('div',{class:'set-ai-keystat'+(e.status?(e.status.ok?' ok':' err'):'')});
        st.textContent = !e.status ? (e.provider ? (AI.providerName(e.provider)+' '+t('ai.keyDetected')) : t('ai.keyUnknownProv'))
          : e.status.ok ? ('✓ '+AI.providerName(e.provider)+' — '+t('ai.keyOk')+' · '+t('ai.keyModels')+(e.status.count||0)+' · '+(e.status.ms||0)+' ms')
          : ('✗ '+(e.status.error||''));
        card.appendChild(st);
        keysBox.appendChild(card);
      }
      const ok=list.filter(e=>e.status&&e.status.ok).length;
      countEl.textContent=t('ai.keysCount')+ok+' / '+list.length;
      if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh();
    }
    addBtn.onclick=()=>{ if(!AI) return; const k=addInp.value.trim(); if(!k){ U.toast(t('ai.keyEmpty'),'error'); return; }
      if(AI.keys().some(x=>x.key===k)){ U.toast(t('ai.keyExists'),'error'); return; }
      const e=AI.add(k); addInp.value=''; renderKeys();
      const cards=keysBox.querySelectorAll('.set-ai-keycard'); const card=cards[cards.length-1]; if(card) runTest(e.id, card); };
    addInp.onkeydown=(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); addBtn.onclick(); } };
    renderKeys();
    c.appendChild(el('p',{class:'set-desc set-mt',text:t('ai.privacy')}));
  }

  function analyzeSection(c){
    // AI never runs automatically — only the manual, advisory "Analyze structure" below + the per-element
    // "Ask AI" box in the Details panel. AI does not touch the file layout or auto-adjust the view.
    const btn=el('button',{class:'tb-btn primary set-mt',html:ic.svg('sparkle',{size:15})+' '+t('ai.analyze')});
    const out=el('div',{class:'set-ai-out'});
    btn.onclick=async()=>{
      if(!K.handlers.aiHasProject || !K.handlers.aiHasProject()){ out.textContent=t('ai.noProject'); return; }
      btn.disabled=true; out.textContent=t('ai.working');
      try{ out.textContent=(await K.handlers.aiAnalyze())||t('ai.empty'); }
      catch(e){ out.textContent=(e&&e.message)||String(e); }
      btn.disabled=false;
    };
    c.appendChild(btn); c.appendChild(out);
  }

  function votesSection(c){
    // ---- ChatBot feedback tally (👍/👎 aggregated across all conversations, persistent, never reset) ----
    c.appendChild(el('div',{class:'set-label set-mt',text:t('ai.votes')}));
    c.appendChild(el('p',{class:'set-desc',text:t('ai.votesHint')}));
    const v=(CM.ChatBot&&CM.ChatBot.votes)?CM.ChatBot.votes():{up:0,down:0};
    const vb=el('div',{class:'set-votes'});
    vb.appendChild(el('span',{class:'set-vote set-vote-up',html:'👍 <b>'+(v.up||0)+'</b> <span class="set-vote-lbl">'+t('ai.votesUp')+'</span>'}));
    vb.appendChild(el('span',{class:'set-vote set-vote-down',html:'👎 <b>'+(v.down||0)+'</b> <span class="set-vote-lbl">'+t('ai.votesDown')+'</span>'}));
    c.appendChild(vb);
  }

  CM.Settings.addTab('ai','sparkle',tabAI);
})();
