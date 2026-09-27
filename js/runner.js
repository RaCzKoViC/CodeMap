/* ===================== runner.js — wbudowane środowisko uruchomieniowe ChatBota =====================
   CM.Runner — jedno okno podglądu (pływające, przeciągalne, skalowalne) wykonujące kod wygenerowany
   przez ChatBota w sandboxowanym <iframe> (sandbox="allow-scripts" — bez dostępu do aplikacji):
   • HTML / SVG — render bezpośredni,        • CSS — arkusz + żywe elementy demo,
   • JS — wykonanie + przechwycona konsola,  • JSON — walidacja + kolorowany pretty-print,
   • Markdown — własny mini-renderer,        • PHP — PRAWDZIWY interpreter php-wasm (CDN, on-demand).
   Dodatkowo „otwórz w nowej karcie". Kod trafia do iframe jako JSON — zero wstrzyknięć.
   Aplikacja ma egzekwowane CSP (bez skryptów inline), które dziedziczyłby <iframe srcdoc> — dlatego ramka ładuje
   runner.html (własna, luźna polityka; kod modelu w jego zagnieżdżonej ramce w piaskownicy), a gotowy dokument dostaje przez postMessage po sygnale
   „ready"; karta otwiera tę samą stronę (zamiast dawnego blob:, który też dziedziczyłby CSP aplikacji). */
CM.Runner = (function(){
  const U=CM.util, el=U.el, ic=CM.icons, I=CM.i18n;
  const pl=()=>I.getLang()!=='en';
  const T=(p,e)=>pl()?p:e;

  let win=null, frame=null, titleEl=null, lastCode='', lastLang='';
  const RUNNER_URL='runner.html';
  let frameReady=false, pending=null, posted=0;
  const tabs=new Map();   // okno karty → {html, title} (wysyłane po jego „ready")
  const post=(w, html, title)=>{ try{ w.postMessage({type:'codemap-runner', html, title}, '*'); posted++; }catch(e){ /* karta podglądu zamknięta */ } };
  window.addEventListener('message', (e)=>{
    const d=e.data; if(!d || d.type!=='codemap-runner-ready') return;
    if(frame && e.source===frame.contentWindow){ frameReady=true; if(pending){ post(frame.contentWindow, pending.html, pending.title); pending=null; } return; }
    for(const [w, v] of tabs) if(e.source===w){ post(w, v.html, v.title); tabs.delete(w); return; }
  });
  const titleOf=(lang)=>(lang?lang.toUpperCase():'JS')+' · '+T('podgląd','preview');

  const BASE_CSS='body{margin:0;padding:14px;font:14px/1.55 system-ui,Segoe UI,sans-serif;background:#fff;color:#111}'+
    'pre{background:#f4f5f7;padding:10px;border-radius:8px;overflow:auto}'+
    '.__err{color:#b91c1c;font-family:monospace;white-space:pre-wrap;background:#fef2f2;padding:8px 10px;border-radius:8px}';
  // embed user code into the shell WITHOUT any injection surface: JSON in a JS string
  const J=(code)=>JSON.stringify(String(code)).replace(/<\//g,'<\\/');

  function compose(code, lang){
    const l=(lang||'').toLowerCase();
    if(l==='html'||l==='htm'){
      if(/^\s*(<!doctype|<html)/i.test(code)) return code;                   // full document — as-is
      return '<!doctype html><meta charset="utf-8"><style>'+BASE_CSS+'</style><body>'+code;
    }
    if(l==='svg') return '<!doctype html><meta charset="utf-8"><style>'+BASE_CSS+
      'body{display:grid;place-items:center;min-height:96vh;background:#0f1522}svg{max-width:96%;max-height:92vh}</style><body>'+code;
    if(l==='css') return '<!doctype html><meta charset="utf-8"><style>'+BASE_CSS+'</style><style>'+code+'</style><body>'+
      '<h1>'+T('Nagłówek H1','Heading H1')+'</h1><h2>H2</h2><p>'+T('Akapit z <a href="#">linkiem</a> i <code>kodem</code>.','A paragraph with a <a href="#">link</a> and <code>code</code>.')+'</p>'+
      '<button>'+T('Przycisk','Button')+'</button> <input placeholder="input"> '+
      '<div class="box" style="margin-top:10px">div.box</div><ul><li>li 1</li><li>li 2</li></ul>';
    if(l==='json') return '<!doctype html><meta charset="utf-8"><style>'+BASE_CSS+
      '.k{color:#7c3aed}.s{color:#047857}.n{color:#b45309}.b{color:#2563eb}</style><body><pre id="o"></pre>'+
      '<script>const src='+J(code)+';const o=document.getElementById("o");try{const v=JSON.parse(src);'+
      'o.innerHTML=JSON.stringify(v,null,2).replace(/&/g,"&amp;").replace(/</g,"&lt;")'+
      '.replace(/"([^"\\n]*)"(\\s*:)?/g,(m,g,c)=>c?\'<span class="k">"\'+g+\'"</span>\'+c:\'<span class="s">"\'+g+\'"</span>\')'+
      '.replace(/\\b(true|false|null)\\b/g,\'<span class="b">$1</span>\')'+
      '.replace(/(:\\s*)(-?\\d+\\.?\\d*)/g,\'$1<span class="n">$2</span>\');}'+
      'catch(e){o.outerHTML=\'<div class="__err">JSON: \'+String(e.message).replace(/</g,"&lt;")+"</div><pre>"+src.replace(/</g,"&lt;")+"</pre>";}<\/script>';
    if(l==='md'||l==='markdown') return '<!doctype html><meta charset="utf-8"><style>'+BASE_CSS+
      'blockquote{border-left:3px solid #cbd5e1;margin:8px 0;padding:4px 12px;color:#475569}img{max-width:100%}h1,h2,h3{margin:14px 0 6px}</style>'+
      '<body><div id="o"></div><script>const src='+J(code)+';const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");'+
      'const safeUrl=u=>/^(https?:|\\/|\\.|#|&quot;|data:image\\/)/i.test(String(u).trim())?u:"#";'+
      'let h=esc(src);h=h.replace(/```([\\s\\S]*?)```/g,(m,c)=>"<pre>"+c.replace(/^\\w*\\n/,"")+"</pre>");'+
      'h=h.replace(/^###### (.*)$/gm,"<h6>$1</h6>").replace(/^##### (.*)$/gm,"<h5>$1</h5>").replace(/^#### (.*)$/gm,"<h4>$1</h4>")'+
      '.replace(/^### (.*)$/gm,"<h3>$1</h3>").replace(/^## (.*)$/gm,"<h2>$1</h2>").replace(/^# (.*)$/gm,"<h1>$1</h1>")'+
      '.replace(/^> (.*)$/gm,"<blockquote>$1</blockquote>").replace(/^[-*] (.*)$/gm,"<li>$1</li>")'+
      '.replace(/(<li>[\\s\\S]*?<\\/li>)(?!\\s*<li>)/g,"<ul>$1</ul>")'+
      '.replace(/\\*\\*([^*]+)\\*\\*/g,"<b>$1</b>").replace(/\\*([^*\\n]+)\\*/g,"<i>$1</i>")'+
      '.replace(/`([^`\\n]+)`/g,"<code>$1</code>")'+
      '.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g,(m,a,u)=>\'<img alt="\'+a+\'" src="\'+safeUrl(u)+\'">\')'+
      '.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,(m,t,u)=>\'<a href="\'+safeUrl(u)+\'" target="_blank" rel="noopener">\'+t+\'</a>\')'+
      '.replace(/\\n{2,}/g,"<br><br>").replace(/\\n/g,"<br>");'+
      'document.getElementById("o").innerHTML=h;<\/script>';
    if(l==='php') return '<!doctype html><meta charset="utf-8"><style>'+BASE_CSS+
      '#st{color:#64748b;font-size:12px;font-family:monospace}</style><body>'+
      '<div id="st">'+T('⏳ Ładowanie interpretera PHP (php-wasm, pierwszy raz może potrwać)…','⏳ Loading the PHP interpreter (php-wasm, first run may take a while)…')+'</div>'+
      '<div id="out"></div>'+
      '<script type="module">const st=document.getElementById("st"),out=document.getElementById("out");'+
      'try{const {PhpWeb}=await import("https://cdn.jsdelivr.net/npm/php-wasm/PhpWeb.mjs");'+
      'const php=new PhpWeb;let code='+J(code)+';if(!/^\\s*<\\?php/i.test(code)&&!/<\\?php/i.test(code))code="<?php\\n"+code;'+
      'php.addEventListener("output",e=>{out.insertAdjacentHTML("beforeend",e.detail.join(""))});'+
      'php.addEventListener("error",e=>{out.insertAdjacentHTML("beforeend","<div class=__err>"+String(e.detail.join("")).replace(/</g,"&lt;")+"</div>")});'+
      'php.addEventListener("ready",()=>{st.textContent="PHP ✓";php.run(code).catch(e=>{out.insertAdjacentHTML("beforeend","<div class=__err>"+String(e).replace(/</g,"&lt;")+"</div>")});});}'+
      'catch(e){st.innerHTML=\'<div class="__err">php-wasm: \'+String(e&&e.message||e).replace(/</g,"&lt;")+"</div>";}<\/script>';
    // default: JavaScript with a captured console
    return '<!doctype html><meta charset="utf-8"><style>'+BASE_CSS+
      '#__c{font-family:monospace;font-size:12.5px;white-space:pre-wrap;border-top:2px solid #e2e8f0;margin-top:12px;padding-top:8px}'+
      '.__l{padding:1px 0;border-bottom:1px dashed #f1f5f9}.__e{color:#b91c1c}.__w{color:#b45309}</style><body>'+
      '<div id="__app"></div><div id="__c" aria-label="console"></div>'+
      '<script>const __c=document.getElementById("__c");'+
      'const show=(cls,args)=>{const d=document.createElement("div");d.className="__l "+cls;'+
      'd.textContent=args.map(a=>{try{return typeof a==="object"?JSON.stringify(a,null,1):String(a)}catch(e){return String(a)}}).join(" ");__c.appendChild(d);};'+
      'for(const k of ["log","info","debug"]){const o=console[k].bind(console);console[k]=(...a)=>{show("",a);o(...a)};}'+
      'const ow=console.warn.bind(console);console.warn=(...a)=>{show("__w",a);ow(...a)};'+
      'const oe=console.error.bind(console);console.error=(...a)=>{show("__e",a);oe(...a)};'+
      'window.onerror=(m,s,l,c)=>{show("__e",[m+" (linia "+l+")"])};'+
      'try{const r=(0,eval)('+J(code)+');if(r!==undefined)show("",["⇒",r]);}catch(e){show("__e",[String(e)])}<\/script>';
  }

  function buildWin(){
    if(win) return win;
    win=el('div',{id:'cm-runner',class:'hidden'});
    const head=el('div',{class:'rn-head'});
    head.appendChild(el('span',{class:'rn-dot'}));
    titleEl=el('span',{class:'rn-title',text:'Runner'}); head.appendChild(titleEl);
    head.appendChild(el('span',{class:'rn-grow'}));
    head.appendChild(el('button',{class:'rn-btn',title:T('Uruchom ponownie','Re-run'),html:ic.svg('refresh',{size:14}),onclick:()=>run(lastCode,lastLang)}));
    head.appendChild(el('button',{class:'rn-btn',title:T('Otwórz w nowej karcie','Open in a new tab'),html:ic.svg('open',{size:14}),onclick:openTab}));
    head.appendChild(el('button',{class:'rn-btn',title:T('Zamknij','Close'),html:ic.svg('x',{size:14}),onclick:close}));
    win.appendChild(head);
    const body=el('div',{class:'rn-body'});
    // runner.html to nasz kod z tego samego pochodzenia (bez piaskownicy); kod z ChatBota działa w JEGO zagnieżdżonym
    // <iframe sandbox srcdoc> — nieprzezroczyste pochodzenie, bez dostępu do aplikacji (localStorage, OPFS, klucze)
    frame=el('iframe',{class:'rn-frame',title:'runner'});
    body.appendChild(frame); win.appendChild(body);
    win.appendChild(el('div',{class:'rn-hint',text:T('Sandbox — kod nie ma dostępu do aplikacji. Zmieniaj rozmiar za prawy dolny róg.','Sandboxed — the code cannot touch the app. Resize from the bottom-right corner.')}));
    document.body.appendChild(win);
    // drag by header
    head.addEventListener('pointerdown',(e)=>{
      if(e.target.closest('button')) return;
      const r=win.getBoundingClientRect(); const ox=e.clientX-r.left, oy=e.clientY-r.top;
      try{ head.setPointerCapture(e.pointerId); }catch(err){ /* wskaźnik już zwolniony */ }
      const move=(ev)=>{ win.style.left=Math.max(4,Math.min(ev.clientX-ox,Math.max(4,innerWidth-120)))+'px';
        win.style.top=Math.max(4,Math.min(ev.clientY-oy,Math.max(4,innerHeight-60)))+'px'; win.style.right='auto'; win.style.bottom='auto'; };
      const up=()=>{ head.removeEventListener('pointermove',move); head.removeEventListener('pointerup',up); };
      head.addEventListener('pointermove',move); head.addEventListener('pointerup',up);
    });
    return win;
  }

  function run(code, lang){
    lastCode=code; lastLang=lang;
    const html=compose(code, lang), title=titleOf(lang);
    titleEl.textContent=title;
    if(frameReady) post(frame.contentWindow, html, title);
    else { pending={html, title}; if(!frame.getAttribute('src')) frame.src=RUNNER_URL; }
  }
  function openTab(){
    // Karta NIE może wykonywać kodu modelu w pochodzeniu aplikacji (localStorage z kluczami API, OPFS/Sejf):
    // runner.html (nasz kod) trzyma go w zagnieżdżonym <iframe sandbox> bez allow-same-origin.
    const w=window.open(RUNNER_URL, '_blank');
    if(!w){ U.toast(T('Przeglądarka zablokowała nowe okno.','The browser blocked the new window.'),'error'); return; }
    tabs.set(w, {html:compose(lastCode,lastLang), title:titleOf(lastLang)});
    setTimeout(()=>tabs.delete(w), 60000);
  }
  function open(code, lang){
    buildWin(); win.classList.remove('hidden');
    run(code, (lang||'').toLowerCase()==='javascript'?'js':lang);
  }
  function close(){ if(win){ win.classList.add('hidden'); pending=null; if(frameReady) post(frame.contentWindow, '', ''); } }

  return { open, close, _compose:compose, state:()=>({ready:frameReady, posted, open:!!(win && !win.classList.contains('hidden'))}) };
})();
