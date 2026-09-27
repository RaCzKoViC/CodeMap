/* ===================== chatbot-render.js — ChatBot: renderowanie wiadomości =====================
   Ikona bota, bezpieczny lekki markdown (fmt) z blokami kodu (kopiuj / uruchom), tok rozumowania (<think>),
   wiersze wiadomości (kroki agenta, źródła „📚 kod”, chipy akcji, pasek 👍/👎), lista rozmów, cytaty [n] → źródła.
   Do tego menu narzędzi „/", pasek załączników i okno panelu (przeciąganie za nagłówek, rozciąganie, zapamiętana
   pozycja i rozmiar). Stan rozmów i jego zmiany (zapis, edycja, regeneracja, oceny) zostają w chatbot.js — przychodzą
   jako wywołania zwrotne. */
CM.ChatBotRender = (function(){
  const U=CM.util, el=U.el, ic=CM.icons, I=CM.i18n, t=CM.ChatBotStrings.t, C=CM.ChatBotCore;

  /* ---------------- animated bot icon (hex + sparkle + network) ---------------- */
  function botIcon(anim){
    return '<svg class="cb-icon'+(anim?' cb-anim':'')+'" viewBox="0 0 48 48" aria-hidden="true">'
      +'<g class="bi-net">'
        +'<line x1="24" y1="24" x2="33.5" y2="15.5"/><line x1="24" y1="24" x2="17" y2="16.5"/>'
        +'<line x1="24" y1="24" x2="15.5" y2="32.5"/><line x1="24" y1="24" x2="31.5" y2="33"/>'
        +'<circle class="bi-node" cx="33.5" cy="15.5" r="2.7"/><circle class="bi-node" cx="17" cy="16.5" r="1.9"/>'
        +'<circle class="bi-node" cx="15.5" cy="32.5" r="2.7"/><circle class="bi-node" cx="31.5" cy="33" r="1.9"/>'
      +'</g>'
      +'<polygon class="bi-hex" points="24,5 40.5,14.5 40.5,33.5 24,43 7.5,33.5 7.5,14.5"/>'
      +'<path class="bi-star" d="M24 11 Q25.6 22.4 37 24 Q25.6 25.6 24 37 Q22.4 25.6 11 24 Q22.4 22.4 24 11 Z"/>'
      +'<circle class="bi-core" cx="24" cy="24" r="2"/>'
      +'</svg>';
  }

  /* ---------------- safe light markdown ---------------- */
  function esc(s){ return U.escapeHtml(s); }
  // languages the built-in runtime (CM.Runner) can execute in its sandboxed preview window
  const RUNNABLE=/^(html|htm|css|js|javascript|svg|json|md|markdown|php)$/i;
  function sniffLang(code){
    const s=code.trim();
    if(/^<svg[\s>]/i.test(s)) return 'svg';
    if(/^<!doctype|^<html|^<(div|body|head|section|main|p|h[1-6]|table|form|button|span)[\s>]/i.test(s)) return 'html';
    if(/^[{\[][\s\S]*[}\]]$/.test(s)){ try{ JSON.parse(s); return 'json'; }catch(e){} }
    if(/^<\?php/i.test(s)) return 'php';
    return '';
  }
  function fmt(text){
    const parts=String(text).split(/```/); let html='';
    for(let i=0;i<parts.length;i++){
      if(i%2===1){ const lang=((parts[i].match(/^([a-zA-Z0-9+\-]+)\n/)||[])[1]||'').toLowerCase(); const code=parts[i].replace(/^[a-zA-Z0-9+\-]*\n/,'');
        let body; try{ body=(CM.UI&&CM.UI.highlight)?CM.UI.highlight(code,lang):esc(code); }catch(e){ body=esc(code); }
        const runLang=RUNNABLE.test(lang)?lang:sniffLang(code);
        const runBtn=runLang?('<button class="cb-cbtn cb-run" data-runlang="'+esc(runLang)+'" title="'+esc(t('runCode'))+'">'+
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button>'):'';
        html+='<div class="cb-codewrap">'+
          '<div class="cb-ctools">'+(lang?('<span class="cb-clang">'+esc(lang)+'</span>'):'')+runBtn+
          '<button class="cb-cbtn cb-copy" title="'+esc(t('copyCode'))+'">'+
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>'+
          '<pre class="cb-code hl">'+body+'</pre></div>';
      } else { let s=esc(parts[i]); s=s.replace(/`([^`\n]+)`/g,'<code class="cb-ic">$1</code>'); s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
        s=s.replace(/\*([^*\n]+)\*/g,'<i>$1</i>'); s=s.replace(/\n/g,'<br>'); html+=s; } }
    return html;
  }
  // tok rozumowania jako zwijany <details>: na żywo (open=true) z kropką „Myślę…”, po zakończeniu „🧠 Przebieg rozumowania”
  function thinkHTML(th, collapsed){
    if(!th.think) return '';
    return '<details class="cb-think'+(th.open?' cb-think-live':'')+'"'+((collapsed&&!th.open)?'':' open')+'>'+
      '<summary>'+(th.open?'<span class="cb-think-dot"></span>':'🧠 ')+esc(t(th.open?'thinking':'thoughts'))+'</summary>'+
      '<div class="cb-think-b">'+esc(th.think)+'</div></details>';
  }

  /* ---------------- wiersze: wskaźnik pisania, bąbel na żywo, załączniki ---------------- */
  function attIcon(type){ return ic.svg(type==='folder'?'folder':(type==='external'?'package':'file'),{size:12}); }
  // tymczasowy wskaźnik „pisze…” z etykietą ETAPU (.cb-stage: ładowanie modelu / wyszukiwanie / narzędzie)
  function typingRow(){
    const typing=el('div',{class:'cb-row cb-row-assistant'});
    typing.appendChild(el('span',{class:'cb-bavatar',html:botIcon(true)}));
    typing.appendChild(el('div',{class:'cb-bubble cb-bubble-assistant cb-typing',
      html:'<span></span><span></span><span></span><em class="cb-stage"></em>'}));
    return typing;
  }
  // wiersz odpowiedzi strumieniowanej: {row, wrap, inner} — inner dostaje treść, wrap ewentualne chipy akcji
  function liveRow(){
    const row=el('div',{class:'cb-row cb-row-assistant'});
    row.appendChild(el('span',{class:'cb-bavatar',html:botIcon(true)}));
    const wrap=el('div',{class:'cb-bwrap'});
    const inner=el('div',{class:'cb-bubble cb-bubble-assistant'}); wrap.appendChild(inner);
    row.appendChild(wrap);
    return {row, wrap, inner};
  }

  /* ---------------- wiadomości i lista rozmów ---------------- */
  function welcomeRow(){ const r=el('div',{class:'cb-row cb-row-assistant'});
    r.appendChild(el('span',{class:'cb-bavatar',html:botIcon(true)}));
    const b=el('div',{class:'cb-bubble cb-bubble-assistant'}); b.innerHTML=fmt(t('welcome')); r.appendChild(b); return r; }
  // wiersz wiadomości; o = {quick, onEdit(row, m), onThumb(m, ±1), onRegen(id), onChange()} — onChange: zapis + ponowne renderowanie
  function messageRow(m, o){
    const row=el('div',{class:'cb-row cb-row-'+m.role,'data-mid':m.id});
    if(m.role==='assistant') row.appendChild(el('span',{class:'cb-bavatar',html:botIcon(false)}));
    const wrap=el('div',{class:'cb-bwrap'});
    const b=el('div',{class:'cb-bubble cb-bubble-'+m.role});
    let thHtml='';
    let bodyTxt=m.content;
    if(m.role==='assistant'){
      const th=C.splitThink(m.content);
      thHtml=o.quick?'':thinkHTML({think:th.think, rest:'', open:false}, false);   // pełny tok rozumowania, zwijany kliknięciem; tryb szybki = bez myśli
      bodyTxt=C.stripActions(th.rest);
      if(!String(bodyTxt).trim() && m.actions && m.actions.some(a=>!a.pending&&a.ok)) bodyTxt=t('didActions');
    }
    b.innerHTML=thHtml+fmt(bodyTxt);
    if(m.sources&&m.sources.length) linkCites(b, m.sources);
    if(m.role==='user' && m.attachments && m.attachments.length){
      const ab=el('div',{class:'cb-att-msg'});
      m.attachments.forEach(a=>{ const c=el('span',{class:'cb-att cb-att-ro',title:a.path||a.name}); c.appendChild(el('span',{class:'cb-att-ic',html:attIcon(a.type)})); c.appendChild(el('span',{class:'cb-att-n',text:a.name}));
        c.onclick=()=>{ if(window.CMApp&&CMApp.focusNode) CMApp.focusNode(a.id); }; ab.appendChild(c); });
      b.appendChild(ab);
    }
    wrap.appendChild(b);
    if(m.role==='assistant' && m.genMs){
      const s=m.genMs/1000;
      const txt=s<10?(s.toFixed(1).replace('.',I.getLang()==='en'?'.':',')+' s'):(s<90?Math.round(s)+' s':(Math.floor(s/60)+' min '+Math.round(s%60)+' s'));
      wrap.appendChild(el('span',{class:'cb-time',title:t('genTime'),text:'⏱ '+txt}));
    }
    if(m.steps&&m.steps.length){   // agent: jakie narzędzia wywołał model, zanim odpowiedział
      const d=el('details',{class:'cb-steps'}); d.appendChild(el('summary',{text:'🔧 '+t('agentSteps')+' ('+m.steps.length+')'}));
      for(const s of m.steps) d.appendChild(el('div',{class:'cb-step'+(s.ok?'':' err'),text:s.name+' '+C.argText(s.args)+' → '+(s.summary||'')}));
      wrap.appendChild(d);
    }
    if(m.sources&&m.sources.length){   // tryb „📚 kod": fragmenty, na których oparto odpowiedź
      const box=el('div',{class:'cb-sources'});
      box.appendChild(el('span',{class:'cb-src-h',text:(m.ragMode==='doctor'?'🩺 ':m.ragMode==='agent'?'🧭 ':m.ragMode==='hybrid'?'📚 ':'🔎 ')+t('ragSources')}));
      for(const s of m.sources){ box.appendChild(el('button',{class:'cb-src',type:'button',title:s.path+':'+s.start+'–'+s.end+(s.sym?' · '+s.sym:''),
        text:'['+s.n+'] '+String(s.path).split('/').pop()+':'+s.start+'–'+s.end,onclick:()=>openSource(s)})); }
      wrap.appendChild(box);
    }
    // executed-action chips (assistant)
    if(m.actions&&m.actions.length){ const chips=el('div',{class:'cb-chips'});
      m.actions.forEach(a=>{
        if(a.pending){   // side-effect action awaiting the user's click (survives re-render)
          const c=el('div',{class:'cb-chip cb-chip-confirm',html:'▶ '+esc(a.action),title:t('clickToRun')});
          c.onclick=()=>{
            try{ const r=(window.CMApp&&CMApp.exec)?CMApp.exec(a.action, a.args):''; a.result=r||t('done'); a.ok=true; }
            catch(e){ a.result=(e&&e.message)||t('failed'); a.ok=false; }
            delete a.pending; o.onChange();
          };
          chips.appendChild(c);
        } else chips.appendChild(el('div',{class:'cb-chip'+(a.ok?'':' cb-chip-err'),html:(a.ok?'⚡ ':'⚠ ')+esc(a.ok&&C.INFO_TOOLS.has(a.action)?('/'+a.action):(a.result||a.action))}));
      }); wrap.appendChild(chips); }
    // hover toolbar
    const tb=el('div',{class:'cb-mtools'});
    if(m.role==='user'){ tb.appendChild(el('button',{class:'cb-mt',title:t('edit'),html:ic.svg('pencil',{size:13}),onclick:()=>o.onEdit(row,m)})); }
    else {
      // 👍 / 👎 feedback — collected into a persistent global tally shown in Settings → AI
      const up=el('button',{class:'cb-mt cb-thumb'+(m.rating===1?' cb-up-on':''),title:t('thumbUp'),text:'👍'});
      const dn=el('button',{class:'cb-mt cb-thumb'+(m.rating===-1?' cb-down-on':''),title:t('thumbDown'),text:'👎'});
      const refl=()=>{ up.classList.toggle('cb-up-on',m.rating===1); dn.classList.toggle('cb-down-on',m.rating===-1); };
      up.onclick=()=>{ o.onThumb(m,1); refl(); }; dn.onclick=()=>{ o.onThumb(m,-1); refl(); };
      tb.appendChild(up); tb.appendChild(dn);
      tb.appendChild(el('button',{class:'cb-mt',title:t('regen'),html:ic.svg('refresh',{size:13}),onclick:()=>o.onRegen(m.id)}));
    }
    tb.appendChild(el('button',{class:'cb-mt',title:t('copy'),html:ic.svg('copy',{size:13}),onclick:()=>{ try{ navigator.clipboard.writeText(m.content); U.toast(t('copied'),'success'); }catch(e){} }}));
    wrap.appendChild(tb);
    row.appendChild(wrap);
    return row;
  }
  // lista rozmów w bocznym pasku; h = {onNew(), onSwitch(id), onDelete(id)}
  function sidebar(sidebarEl, convs, activeId, h){
    sidebarEl.innerHTML='';
    sidebarEl.appendChild(el('button',{class:'cb-newbtn',html:ic.svg('plus',{size:14})+' '+t('newchat'),onclick:()=>h.onNew()}));
    sidebarEl.appendChild(el('div',{class:'cb-sb-head',text:t('history')}));
    const list=el('div',{class:'cb-convs'});
    if(!convs.length){ list.appendChild(el('div',{class:'cb-sb-empty',text:t('empty')})); }
    convs.forEach(c=>{
      const item=el('div',{class:'cb-conv'+(c.id===activeId?' active':''),onclick:()=>h.onSwitch(c.id)});
      const tt=el('div',{class:'cb-conv-t',text:c.title||t('untitled')});
      const meta=el('div',{class:'cb-conv-m',text:(c.messages.filter(m=>m.role==='user').length)+' · '+(U.relTime?U.relTime(c.updatedAt||c.createdAt):'')});
      const txt=el('div',{class:'cb-conv-txt'}); txt.appendChild(tt); txt.appendChild(meta);
      const del=el('button',{class:'cb-conv-del',title:t('del'),html:ic.svg('trash',{size:13}),onclick:(e)=>{ e.stopPropagation(); if(confirm(t('delConfirm'))) h.onDelete(c.id); }});
      item.appendChild(txt); item.appendChild(del);
      list.appendChild(item);
    });
    sidebarEl.appendChild(list);
  }

  /* ---------------- menu narzędzi „/" i pasek załączników ---------------- */
  // lista narzędzi pasujących do q (nazwa, sygnatura, opis; ▶ = akcja zmieniająca stan); onPick(name) po kliknięciu
  function toolsMenu(toolsEl, q, onPick){
    const ql=q.toLowerCase();
    const list=C.TOOLS.filter(x=>!ql||x.name.toLowerCase().includes(ql)||x.desc.toLowerCase().includes(ql)||C.toolDesc(x).toLowerCase().includes(ql)).slice(0,40);
    toolsEl.innerHTML=''; toolsEl.classList.remove('hidden');
    toolsEl.appendChild(el('div',{class:'cb-tools-h',text:t('tools')+' · '+t('toolRun')}));
    if(!list.length){ toolsEl.appendChild(el('div',{class:'cb-tools-empty',text:t('toolNoMatch')})); return; }
    list.forEach((x,i)=>{
      const row=el('div',{class:'cb-tool'+(i===0?' sel':''),'data-name':x.name});
      row.appendChild(el('span',{class:'cb-tool-n',text:'/'+x.name}));
      if(x.sig) row.appendChild(el('span',{class:'cb-tool-s',text:x.sig}));
      row.appendChild(el('span',{class:'cb-tool-d',text:C.toolDesc(x)}));
      if(!C.AUTO_OK.has(x.name)) row.appendChild(el('span',{class:'cb-tool-w',text:'▶'}));
      row.onmousedown=(e)=>{ e.preventDefault(); onPick(x.name); };
      toolsEl.appendChild(row);
    });
  }
  // chipy elementów mapy dołączonych do wiadomości + licznik „n / max”; onRemove(a) po kliknięciu ×
  function attachChips(attachEl, list, max, onRemove){
    attachEl.innerHTML='';
    if(!list.length){ attachEl.classList.add('hidden'); return; }
    attachEl.classList.remove('hidden');
    for(const a of list){
      const chip=el('span',{class:'cb-att',title:a.path||a.name});
      chip.appendChild(el('span',{class:'cb-att-ic',html:attIcon(a.type)}));
      chip.appendChild(el('span',{class:'cb-att-n',text:a.name}));
      chip.appendChild(el('button',{class:'cb-att-x',type:'button',title:t('attachRemove'),text:'×',onclick:()=>onRemove(a)}));
      attachEl.appendChild(chip);
    }
    attachEl.appendChild(el('span',{class:'cb-att-cnt',text:list.length+' / '+max}));
  }

  /* ---------------- okno panelu: przeciąganie za nagłówek, rozciąganie krawędziami (zapamiętane) ---------------- */
  // drag the whole panel by its header (persisted; double-click header = reset)
  function dragByHead(panel, head){
    head.title=t('dragHint'); head.classList.add('cb-draggable');
    head.addEventListener('pointerdown',(e)=>{
      if(e.button!==0 || e.target.closest('button,select,input')) return;
      const r=panel.getBoundingClientRect(); const ox=e.clientX-r.left, oy=e.clientY-r.top;
      try{ head.setPointerCapture(e.pointerId); }catch(err){}
      panel.classList.add('cb-dragging');
      const move=(ev)=>{
        const L=Math.max(4, Math.min(ev.clientX-ox, Math.max(4, innerWidth-r.width-4)));
        const T=Math.max(4, Math.min(ev.clientY-oy, Math.max(4, innerHeight-72)));
        panel.style.left=L+'px'; panel.style.top=T+'px'; panel.style.right='auto'; panel.style.bottom='auto';
      };
      const up=()=>{ head.removeEventListener('pointermove',move); head.removeEventListener('pointerup',up);
        head.removeEventListener('pointercancel',up); head.removeEventListener('lostpointercapture',up);
        panel.classList.remove('cb-dragging');
        if(panel.style.left) try{ localStorage.setItem('codemap_chatbot_pos',
          JSON.stringify({l:parseInt(panel.style.left)||0, t:parseInt(panel.style.top)||0})); }catch(err){} };
      head.addEventListener('pointermove',move); head.addEventListener('pointerup',up);
      head.addEventListener('pointercancel',up); head.addEventListener('lostpointercapture',up);   // gesture aborted → clean up (no stuck drag / listener leak)
    });
    head.addEventListener('dblclick',(e)=>{ if(e.target.closest('button,select,input')) return;
      panel.style.left=panel.style.top=panel.style.right=panel.style.bottom='';
      try{ localStorage.removeItem('codemap_chatbot_pos'); }catch(err){} });
    applySavedPos(panel);
  }
  function applySavedPos(panel){
    if(!panel) return;
    let p=null; try{ p=JSON.parse(localStorage.getItem('codemap_chatbot_pos')||'null'); }catch(e){}
    if(!p) return;
    const L=Math.min(Math.max(p.l,4), Math.max(4,innerWidth-320)), T=Math.min(Math.max(p.t,4), Math.max(4,innerHeight-120));
    panel.style.left=L+'px'; panel.style.top=T+'px'; panel.style.right='auto'; panel.style.bottom='auto';
  }
  // uchwyty rozciągania okna: 4 krawędzie + 4 rogi (rozmiar i pozycja zapamiętane)
  function resizeHandles(panel){
    for(const dir of ['n','s','e','w','ne','nw','se','sw']){
      const h=el('div',{class:'cb-rz cb-rz-'+dir,title:t('resize')});
      h.addEventListener('pointerdown',(e)=>{
        if(e.button!==0) return; e.preventDefault(); e.stopPropagation();
        try{ h.setPointerCapture(e.pointerId); }catch(err){}
        const r=panel.getBoundingClientRect(); const x0=e.clientX, y0=e.clientY;
        const L0=r.left, T0=r.top, W0=r.width, H0=r.height; const MINW=320, MINH=300;
        panel.classList.add('cb-resizing');
        const move=(ev)=>{ const dx=ev.clientX-x0, dy=ev.clientY-y0; let L=L0, T=T0, W=W0, H=H0;
          if(dir.includes('e')) W=Math.max(MINW, Math.min(innerWidth-L0-4, W0+dx));
          if(dir.includes('s')) H=Math.max(MINH, Math.min(innerHeight-T0-4, H0+dy));
          if(dir.includes('w')){ W=Math.max(MINW, Math.min(L0+W0-4, W0-dx)); L=L0+W0-W; }
          if(dir.includes('n')){ H=Math.max(MINH, Math.min(T0+H0-4, H0-dy)); T=T0+H0-H; }
          panel.style.left=L+'px'; panel.style.top=T+'px'; panel.style.right='auto'; panel.style.bottom='auto';
          panel.style.width=W+'px'; panel.style.height=H+'px'; };
        const up=()=>{ h.removeEventListener('pointermove',move); h.removeEventListener('pointerup',up); h.removeEventListener('pointercancel',up);
          panel.classList.remove('cb-resizing');
          try{ localStorage.setItem('codemap_chatbot_size', JSON.stringify({w:panel.offsetWidth, h:panel.offsetHeight}));
            localStorage.setItem('codemap_chatbot_pos', JSON.stringify({l:parseInt(panel.style.left)||0, t:parseInt(panel.style.top)||0})); }catch(err){} };
        h.addEventListener('pointermove',move); h.addEventListener('pointerup',up); h.addEventListener('pointercancel',up);
      });
      panel.appendChild(h);
    }
    try{ const sz=JSON.parse(localStorage.getItem('codemap_chatbot_size')||'null'); if(sz&&sz.w&&sz.h){ panel.style.width=Math.min(sz.w, innerWidth-8)+'px'; panel.style.height=Math.min(sz.h, innerHeight-8)+'px'; } }catch(e){}
  }

  /* ---------------- cytaty [n] → źródła (tryb „📚 kod”, Doktor hotspotów, agent) ---------------- */
  // [n] w tekście odpowiedzi → link do źródła (poza blokami kodu)
  function linkCites(root, sources){
    const byN=new Map(sources.map(s=>[String(s.n),s]));
    const walker=document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode:(n)=>n.parentNode&&n.parentNode.closest&&n.parentNode.closest('pre,code,.cb-think')?NodeFilter.FILTER_REJECT:(/\[\d{1,2}\]/.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP)});
    const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    for(const tn of nodes){
      const frag=document.createDocumentFragment(); let lastI=0; const s=tn.nodeValue; const re=/\[(\d{1,2})\]/g; let m;
      while((m=re.exec(s))){ const src=byN.get(m[1]); if(!src) continue;
        frag.appendChild(document.createTextNode(s.slice(lastI, m.index)));
        const a=el('a',{class:'cb-cite',href:'#',title:src.path+':'+src.start+'–'+src.end,text:m[0]}); a.onclick=(ev)=>{ ev.preventDefault(); openSource(src); };
        frag.appendChild(a); lastI=m.index+m[0].length; }
      if(!lastI) continue;
      frag.appendChild(document.createTextNode(s.slice(lastI))); tn.parentNode.replaceChild(frag, tn);
    }
  }
  function openSource(s){
    const A=CM.App, g=A&&A.graph; const n=g&&(g.nodes.get(s.id)||[...g.nodes.values()].find(x=>x.type==='file'&&x.path===s.path));
    if(!n){ U.toast(t('ragGone'),'error'); return; }
    if(window.CMApp&&CMApp.focusNode) CMApp.focusNode(n.id);
    if(A.handlers&&A.handlers.openFile){ A.handlers.openFile(n); if(CM.UI&&CM.UI.revealLines) setTimeout(()=>CM.UI.revealLines(s.start, s.end), 60); }
  }

  return { botIcon, esc, fmt, thinkHTML, attIcon, typingRow, liveRow, welcomeRow, messageRow, sidebar,
    toolsMenu, attachChips, dragByHead, applySavedPos, resizeHandles, linkCites, openSource };
})();
