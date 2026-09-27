/* ===================== settings.js — okno Ustawień, rejestr zakładek, interaktywny samouczek ===================== */
// Zakładki ogólne (język, konto, wygląd, instalacja, skróty, samouczek, o aplikacji) są tutaj; pozostałe
// rejestrują własne moduły ładowane po tym pliku: settings-ai.js („ai”), settings-docs.js („spec”, „manual”).
// Teksty: settings-strings.js (CM.SettingsStrings), ładowany przed tym plikiem.
CM.Settings = (function(){
  const U=CM.util, $=U.$, el=U.el, I=CM.i18n, ic=CM.icons;
  let handlers={};
  let overlay=null, builtLang=null, curTab='lang';

  // ---------------- settings-specific strings (PL / EN): js/settings-strings.js ----------------
  function t(k){ const S=CM.SettingsStrings||{}, pl=S.pl||{}; const d=S[I.getLang()]||pl; return (k in d)?d[k]:((k in pl)?pl[k]:k); }

  // ---------------- rejestr zakładek ----------------
  // Kolejność w nawigacji jest stała (niezależna od kolejności ładowania modułów); ikonę i treść
  // zakładki rejestruje jej moduł przez addTab(key, icon, render). Zakładki spoza ORDER trafiają na koniec.
  const ORDER=['lang','account','appearance','ai','install','shortcuts','tutorial','spec','manual','about'];
  const TABS=new Map();   // klucz → {icon, render(c)}
  function addTab(key, icon, render){ TABS.set(key,{icon,render}); builtLang=null; }
  function tabKeys(){ return ORDER.filter(k=>TABS.has(k)).concat([...TABS.keys()].filter(k=>!ORDER.includes(k))); }

  // ---------------- public API ----------------
  function wire(h){ handlers=h||{}; }

  function open(tab){
    build();
    if(tab) curTab=tab;
    showTab(curTab);
    overlay.classList.remove('hidden');
    document.body.classList.add('settings-open');
  }
  function close(){ if(overlay) overlay.classList.add('hidden'); document.body.classList.remove('settings-open'); }

  // ---------------- powłoka okna z zakładkami (.set-*): Ustawienia i Dysk (drive.js przez kit) ----------------
  // nakładka: klik w tło i Esc zamykają (escOk() może Esc wstrzymać, np. w trakcie samouczka)
  function overlayShell(id, onClose, escOk){
    const ov=el('div',{id, class:'hidden'});
    document.body.appendChild(ov);
    ov.addEventListener('mousedown',(e)=>{ if(e.target===ov) onClose(); });
    window.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && !ov.classList.contains('hidden') && (!escOk || escOk())) onClose(); });
    return ov;
  }
  // panel: nagłówek (ikona, tytuł, ×), nawigacja zakładek [{key, html, cls}] i treść (ov._content);
  // o.variant = dodatkowy prefiks klas (np. 'drv' → set-panel drv-panel / set-nav drv-nav / set-content drv-content)
  function tabbedPanel(ov, o){
    const v=(s)=>'set-'+s+(o.variant?' '+o.variant+'-'+s:'');
    ov.innerHTML='';
    const panel=el('div',{class:v('panel')});
    panel.appendChild(el('div',{class:'set-head'},
      el('span',{class:'set-ic',html:ic.svg(o.icon,{size:18})}),
      el('h2',{text:o.title}),
      el('span',{class:'tb-spacer'}),
      el('button',{class:'set-x',title:o.closeTitle,html:ic.svg('x',{size:18}),onclick:o.onClose})));
    const bodyWrap=el('div',{class:'set-wrap'});
    const nav=el('div',{class:v('nav')});
    const content=el('div',{class:v('content')});
    for(const tb of o.tabs) nav.appendChild(el('button',{class:'set-tab'+(tb.key===o.active?' active':'')+(tb.cls?' '+tb.cls:''),'data-tab':tb.key,
      html:tb.html,onclick:()=>o.onTab(tb.key)}));
    bodyWrap.appendChild(nav); bodyWrap.appendChild(content);
    panel.appendChild(bodyWrap);
    ov.appendChild(panel);
    ov._content=content;
    return content;
  }
  // przełączenie zakładki: podświetlenie w nawigacji i świeża treść z render(c)
  function selectTab(ov, key, render){
    ov.querySelectorAll('.set-tab').forEach(b=>b.classList.toggle('active', b.getAttribute('data-tab')===key));
    const c=ov._content; if(!c) return; c.innerHTML='';
    render(c);
    c.scrollTop=0;
  }

  function build(){
    const lang=I.getLang();
    if(overlay && builtLang===lang) return;
    if(!overlay) overlay=overlayShell('settings-overlay', close, ()=>!tourActive);
    builtLang=lang;
    tabbedPanel(overlay, {icon:'settings', title:t('title'), closeTitle:I.t('common.close'), onClose:close, active:curTab, onTab:showTab,
      tabs:tabKeys().map(key=>({key, html:ic.svg(TABS.get(key).icon,{size:16})+'<span>'+t('tab.'+key)+'</span>'}))});
    showTab(curTab);
  }

  function showTab(key){
    curTab=key;
    if(!overlay) return;
    selectTab(overlay, key, (c)=>{ const tab=TABS.get(key)||TABS.get('lang'); if(tab) tab.render(c); });   // nieznany klucz → „Język” (jak dotąd)
  }

  function section(c, head, descKey){
    c.appendChild(el('h3',{class:'set-h3',text:head}));
    if(descKey) c.appendChild(el('p',{class:'set-desc',text:t(descKey)}));
  }

  function tabLang(c){
    section(c, t('lang.head'), 'lang.desc');
    const row=el('div',{class:'set-lang-row'});
    [['pl','🇵🇱'],['en','🇬🇧']].forEach(([code,flag])=>{
      const cur=I.getLang()===code;
      const b=el('button',{class:'set-lang'+(cur?' active':''),onclick:()=>{ I.setLang(code); }},
        el('span',{class:'set-lang-flag',text:flag}),
        el('span',{class:'set-lang-name',text:t('lang.'+code)}),
        cur?el('span',{class:'set-lang-chk',html:ic.svg('eye',{size:15})}):null);
      row.appendChild(b);
    });
    c.appendChild(row);
  }

  function tabAccount(c){
    section(c, t('acct.head'), 'acct.desc');
    if(CM.Auth){ try{ CM.Auth.renderAccount(c); }catch(e){ console.warn('[CodeMap] Ustawienia: konto', e); } }
  }

  function tabAppearance(c){
    section(c, t('app.head'), 'app.desc');
    // theme
    c.appendChild(el('div',{class:'set-label',text:t('app.theme')}));
    const trow=el('div',{class:'set-btn-row'});
    [['dark','app.theme.dark'],['light','app.theme.light']].forEach(([th,lbl])=>{
      trow.appendChild(el('button',{class:'tb-btn'+(document.body.classList.contains('light')?(th==='light'?' primary':''):(th==='dark'?' primary':'')),
        onclick:()=>{ const tb=document.querySelector('#theme-row .theme-btn[data-theme="'+th+'"]'); if(tb){ tb.click(); build(); showTab('appearance'); } },text:t(lbl)}));
    });
    c.appendChild(trow);
    // accent quick pick (mirror left-panel accents)
    c.appendChild(el('div',{class:'set-label',text:t('app.accent')}));
    const arow=el('div',{class:'set-acc-row'});
    ['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b'].forEach(col=>{
      arow.appendChild(el('button',{class:'set-acc',style:'background:'+col,
        onclick:()=>{ const a=document.querySelector('#accent-row .acc[data-acc="'+col+'"]'); if(a) a.click(); }}));
    });
    c.appendChild(arow);
    // actions
    const act=el('div',{class:'set-btn-row set-mt'});
    act.appendChild(el('button',{class:'tb-btn',html:ic.svg('layers',{size:14})+' '+t('app.open'),
      onclick:()=>{ close(); if(handlers.openAppearancePanel) handlers.openAppearancePanel(); }}));
    act.appendChild(el('button',{class:'tb-btn',html:ic.svg('refresh',{size:14})+' '+t('app.reset'),
      onclick:()=>{ if(handlers.resetAppearance) handlers.resetAppearance(); U.toast(t('app.reset.done'),'success'); build(); showTab('appearance'); }}));
    c.appendChild(act);
  }

  function bigBtn(c, icon, label, hint, fn, danger){
    const b=el('button',{class:'set-big'+(danger?' danger':''),onclick:fn},
      el('span',{class:'set-big-ic',html:ic.svg(icon,{size:20})}),
      el('span',{class:'set-big-txt'}, el('b',{text:label}), el('span',{class:'set-big-hint',text:hint})));
    c.appendChild(b); return b;
  }
  function tabInstall(c){
    section(c, t('install.head'), 'install.desc');
    bigBtn(c,'download',t('install.install'),t('install.install.hint'),()=>{
      if(handlers.canInstall && handlers.canInstall()){ handlers.installPWA&&handlers.installPWA(); }
      else U.toast(t('install.unavailable'),'',5000);
    });
    bigBtn(c,'refresh',t('install.update'),t('install.update.hint'),()=>{
      try{
        if(navigator.serviceWorker){ navigator.serviceWorker.getRegistration().then(r=>{ r&&r.update(); }).finally(()=>location.reload()); }
        else location.reload();
      }catch(e){ location.reload(); }
    });
    bigBtn(c,'power',t('install.uninstall'),t('install.uninstall.hint'),async()=>{
      if(handlers.uninstall) await handlers.uninstall(); U.toast(t('install.uninstall.done'),'success',5000);
    });
    // pamięć analizy plików (OPFS): liczba projektów i rozmiar dopisywane po odczycie indeksu
    if(CM.AnalysisCache){
      const b=bigBtn(c,'refresh',t('install.acache'),t('install.acache.hint'),async()=>{
        await CM.AnalysisCache.clear(); U.toast(t('install.acache.done'),'success'); fill(); });
      const hint=b.querySelector('.set-big-hint');
      const fill=()=>CM.AnalysisCache.stats().then(s=>{ if(hint) hint.textContent=t('install.acache.hint')+(s.available?' '+t('install.acache.stat').replace('{n}',s.projects).replace('{mb}',(s.bytes/1048576).toFixed(1)):''); }).catch(()=>{});
      fill();
    }
    bigBtn(c,'trash',t('install.wipe'),t('install.wipe.hint'),async()=>{
      if(confirm(t('install.wipe.confirm'))){ if(handlers.clearAllData) await handlers.clearAllData(); U.toast(t('install.wipe.done'),'success'); }
    }, true);
  }

  // ---------------- keyboard shortcuts cheatsheet ----------------
  function kbd(label){ return el('span',{class:'set-kbd',text:label}); }
  function scRow(grp, actLabel, keys, hint){
    const row=el('div',{class:'set-sc-row'});
    row.appendChild(el('div',{class:'set-sc-act'}, el('b',{text:actLabel}), hint?el('span',{class:'set-sc-hint',text:hint}):null));
    const kc=el('div',{class:'set-sc-keys'});
    keys.forEach((k,i)=>{
      if(typeof k==='string' && (k==='/'||k==='or'||k==='lub')){ kc.appendChild(el('span',{class:'set-sc-sep',text:k})); }
      else kc.appendChild(kbd(k));
    });
    row.appendChild(kc);
    grp.appendChild(row);
  }
  function scGroup(c, headKey){
    const g=el('div',{class:'set-sc-grp'});
    g.appendChild(el('div',{class:'set-sc-grp-h',text:t(headKey)}));
    c.appendChild(g);
    return g;
  }
  function tabShortcuts(c){
    section(c, t('sc.head'), 'sc.desc');
    const wrap=el('div',{class:'set-sc'});
    c.appendChild(wrap);
    // --- CodeMap navigation ---
    const nav=scGroup(wrap,'sc.grp.nav');
    const orSep = I.getLang()==='pl' ? 'lub' : 'or';
    scRow(nav, t('sc.move'), ['W','A','S','D']);
    scRow(nav, t('sc.zoomIn'), ['Space', orSep, '+']);
    scRow(nav, t('sc.zoomOut'), ['Shift', orSep, '−']);
    scRow(nav, t('sc.arrows'), ['←','↑','↓','→']);
    scRow(nav, t('sc.fps'), ['G'], t('sc.fpsHint'));
    scRow(nav, t('sc.fit'), ['F']);
    scRow(nav, t('sc.rotate'), ['Q','/','E']);
    scRow(nav, t('sc.resetRot'), ['R']);
    scRow(nav, t('sc.toggle3d'), ['T']);
    scRow(nav, t('sc.isolate'), ['I']);
    scRow(nav, t('sc.impact'), ['X']);
    // --- General ---
    const gen=scGroup(wrap,'sc.grp.general');
    scRow(gen, t('sc.search'), ['/']);
    scRow(gen, t('sc.altS'), ['Alt','+','S']);
    scRow(gen, t('sc.escape'), ['Esc']);
    // --- MindMap ---
    const mind=scGroup(wrap,'sc.grp.mind');
    scRow(mind, t('sc.del'), ['Delete','/','Backspace']);
    scRow(mind, t('sc.undo'), ['Ctrl','+','Z','/','Ctrl','+','Y']);
    scRow(mind, t('sc.edit'), [t('sc.dblclick')]);
  }

  function tabTutorial(c){
    section(c, t('tut.head'), 'tut.desc');
    const row=el('div',{class:'set-btn-row'});
    row.appendChild(el('button',{class:'tb-btn primary set-start',html:ic.svg('map',{size:15})+' '+t('tut.startCode'),
      onclick:()=>startTutorial('codemap')}));
    row.appendChild(el('button',{class:'tb-btn set-start',html:ic.svg('layers',{size:15})+' '+t('tut.startMind'),
      onclick:()=>startTutorial('mindmap')}));
    c.appendChild(row);
    c.appendChild(el('p',{class:'set-desc set-mt',text:t('tut.covers')}));
    c.appendChild(el('p',{class:'set-desc',text:t('tut.coversMind')}));
    c.appendChild(el('div',{class:'set-label set-mt',html:ic.svg('keyboard',{size:14})+' '+t('tut.shortcutsTitle')}));
    c.appendChild(el('p',{class:'set-desc',html:t('tut.shortcuts')}));
  }

  function tabAbout(c){
    section(c, t('about.head'), null);
    const grid=el('div',{class:'set-about'});
    const row=(k,v,html)=>{ grid.appendChild(el('div',{class:'set-about-k',text:k})); grid.appendChild(el('div',{class:'set-about-v',[html?'html':'text']:v})); };
    row(t('about.version'), (window.CM_VERSION||'1.0'));
    row(t('about.author'),'RaCzKoViC');
    row(t('about.tech'), t('about.tech.val'));
    row(t('about.privacy'), t('about.privacy.val'));
    c.appendChild(grid);
    c.appendChild(el('a',{class:'tb-btn set-mt',href:'https://github.com/RaCzKoViC',target:'_blank',rel:'noopener',
      html:ic.svg('globe',{size:14})+' '+t('about.repo')}));
  }

  // ---------------- interactive tutorial (spotlight coachmarks) ----------------
  const TOUR=[
    {sel:()=>$('.brand'), k:'tour.brand'},
    {sel:()=>$('#mode-switch'), k:'tour.mode'},
    {sel:()=>$('.tb-menu[data-menu="load"]'), k:'tour.load', before:()=>menu('load',true), after:()=>menu('load',false)},
    {sel:()=>$('.tb-menu[data-menu="layout"]'), k:'tour.layout'},
    {sel:()=>$('.search-wrap'), k:'tour.search'},
    {sel:()=>$('.tb-menu[data-menu="project"]'), k:'tour.project', before:()=>menu('project',true), after:()=>menu('project',false)},
    {sel:()=>$('#btn-settings'), k:'tour.settings'},
    {sel:()=>$('#rail-left'), k:'tour.leftrail', before:()=>panel('left',true)},
    {sel:()=>fb('#show-folders'), k:'tour.elements', before:()=>panel('left',true)},
    {sel:()=>fb('#lang-filters'), k:'tour.filetypes', before:()=>panel('left',true)},
    {sel:()=>fb('#sel-metric'), k:'tour.complexity', before:()=>panel('left',true)},
    {sel:()=>fb('#rng-trans'), k:'tour.appearance', before:()=>panel('left',true)},
    {sel:()=>fb('#opt-grid'), k:'tour.map', before:()=>panel('left',true)},
    {sel:()=>fb('#rng-nscale'), k:'tour.figures', before:()=>panel('left',true)},
    {sel:()=>$('#view-controls'), k:'tour.viewcontrols'},
    {sel:()=>$('#vc-3d'), k:'tour.threed', before:()=>{ const b=$('#vc-3d'); if(b) b.click(); }, after:()=>{ const b=$('#vc-3d'); if(b) b.click(); }},
    {sel:()=>$('#rot-dial'), k:'tour.compass'},
    {sel:()=>{ const h=$('#hood'); return (h && !h.classList.contains('hidden')) ? $('#hood-disc') : $('#rot-dial'); }, k:'tour.compasshood',
      before:()=>{ const d=$('#rot-dial'); if(d){ d.click(); d.click(); } },   // dial counts 2 clicks -> openHood
      after:()=>{ const c=$('#hood-close'); if(c) c.click(); }},
    {sel:()=>$('#rot-dial'), k:'tour.compasspin'},
    {sel:()=>$('#minimap-wrap'), k:'tour.minimap'},
    {sel:()=>$('#right-panel'), k:'tour.details', before:()=>panel('right',true)},
    {sel:()=>$('#statusbar'), k:'tour.status'},
  ];
  // MindMap tour — same engine, MindMap-specific targets (engine auto-skips any element not currently present)
  const TOUR_MM=[
    {sel:()=>$('#mode-switch'), k:'tourmm.mode'},
    {sel:()=>$('#mm-topbar'), k:'tourmm.topbar'},
    {sel:()=>$('#mm-canvas'), k:'tourmm.canvas'},
    {sel:()=>$('#mm-tools'), k:'tourmm.tools'},
    {sel:()=>$('#mm-undo'), k:'tourmm.undo'},
    {sel:()=>$('.mm-connect-btn'), k:'tourmm.connect'},
    {sel:()=>$('#mm-arrange'), k:'tourmm.arrange'},
    {sel:()=>$('#mm-layout'), k:'tourmm.layout'},
    {sel:()=>$('#mm-fit'), k:'tourmm.fit'},
    {sel:()=>$('#mm-save'), k:'tourmm.save'},
    {sel:()=>$('#mm-markdown'), k:'tourmm.markdown'},
    {sel:()=>$('#mm-inspector'), k:'tourmm.inspector'},
    {sel:()=>$('#mm-timeline'), k:'tourmm.timeline'},
  ];
  let tourActive=false, tourIdx=0, tourEls=null, steps=TOUR;
  function fb(s){ const e=$(s); return e?e.closest('.filter-block'):null; }
  function menu(name,open){ const m=$('.tb-menu[data-menu="'+name+'"]'); if(m) m.classList.toggle('open',!!open); }
  function panel(side,open){ if(handlers.ensurePanel) handlers.ensurePanel(side, open); }

  function buildTourDom(){
    const block=el('div',{class:'tut-block'});
    const hole=el('div',{class:'tut-hole'});
    const pop=el('div',{class:'tut-pop'});
    tourEls={block,hole,pop};
    document.body.appendChild(block); document.body.appendChild(hole); document.body.appendChild(pop);
    window.addEventListener('keydown', tourKey);
    window.addEventListener('resize', positionTour);
  }
  function tourKey(e){ if(!tourActive) return;
    if(e.key==='Escape'){ endTour(); }
    else if(e.key==='ArrowRight'||e.key==='Enter'){ tourStep(1); }
    else if(e.key==='ArrowLeft'){ tourStep(-1); }
  }
  function startTutorial(mode){
    close();
    if(tourActive) return;
    mode = mode || (document.body.classList.contains('mode-mindmap')?'mindmap':'codemap');
    steps = (mode==='mindmap') ? TOUR_MM : TOUR;
    const wantMM=(mode==='mindmap'), isMM=document.body.classList.contains('mode-mindmap');
    const begin=()=>{ tourActive=true; tourIdx=0; buildTourDom(); showTourStep(); };
    if(wantMM!==isMM){
      const b=document.querySelector('#mode-switch .mode-btn[data-mode="'+mode+'"]'); if(b) b.click();
      setTimeout(begin, 240);   // let the target mode's UI render before spotlighting it
    } else begin();
  }
  // before/after kroku (otwarcie panelu itp.): błąd nie przerywa samouczka, ale trafia do konsoli
  const stepHook=(f)=>{ if(f) try{ f(); }catch(e){ console.warn('[CodeMap] samouczek: krok', e); } };
  function tourStep(d){
    const cur=steps[tourIdx]; if(cur) stepHook(cur.after);
    tourIdx+=d;
    if(tourIdx<0) tourIdx=0;
    if(tourIdx>=steps.length){ endTour(); return; }
    showTourStep();
  }
  function showTourStep(){
    const step=steps[tourIdx];
    stepHook(step.before);
    // resolve element; skip missing/hidden ones in current direction
    let tries=0;
    while(tries<steps.length){
      const e=step2el(steps[tourIdx]);
      // present if rendered (has a box) — tolerant of elements still animating in (e.g. the radar)
      if(e && (e.getClientRects().length>0 || e.getBoundingClientRect().width>1)){ break; }
      tourIdx++; if(tourIdx>=steps.length){ endTour(); return; }
      stepHook(steps[tourIdx].before);
      tries++;
    }
    renderTourPop();
    positionTour();
    setTimeout(positionTour, 40);   // after immediate layout
    setTimeout(positionTour, 340);  // after a panel open/slide transition settles
  }
  function step2el(step){ try{ return typeof step.sel==='function'?step.sel():$(step.sel); }catch(e){ return null; } }
  function renderTourPop(){
    const step=steps[tourIdx]; const pop=tourEls.pop; pop.innerHTML='';
    pop.appendChild(el('div',{class:'tut-step',text:t('tut.step')+' '+(tourIdx+1)+' / '+steps.length}));
    pop.appendChild(el('h4',{class:'tut-title',text:t(step.k+'.t')}));
    pop.appendChild(el('p',{class:'tut-body',html:t(step.k+'.b')}));
    const bar=el('div',{class:'tut-bar'});
    bar.appendChild(el('button',{class:'tb-btn tut-skip',text:t('tut.skip'),onclick:endTour}));
    bar.appendChild(el('span',{class:'tb-spacer'}));
    if(tourIdx>0) bar.appendChild(el('button',{class:'tb-btn',text:t('tut.prev'),onclick:()=>tourStep(-1)}));
    bar.appendChild(el('button',{class:'tb-btn primary',text: tourIdx===steps.length-1?t('tut.done'):t('tut.next'),onclick:()=>tourStep(1)}));
    pop.appendChild(bar);
  }
  function positionTour(){
    if(!tourActive||!tourEls) return;
    const el2=step2el(steps[tourIdx]); if(!el2) return;
    try{ el2.scrollIntoView({block:'nearest',inline:'nearest'}); }catch(e){ /* element odpięty w trakcie animacji */ }
    let r=el2.getBoundingClientRect();
    // if an open dropdown panel hangs off this element, include it in the spotlight
    const mp=el2.querySelector&&el2.querySelector('.menu-panel');
    if(mp && el2.classList.contains('open')){
      const pr=mp.getBoundingClientRect();
      const x1=Math.min(r.left,pr.left), y1=Math.min(r.top,pr.top), x2=Math.max(r.right,pr.right), y2=Math.max(r.bottom,pr.bottom);
      r={left:x1,top:y1,right:x2,bottom:y2,width:x2-x1,height:y2-y1};
    }
    const pad=8;
    const hx=Math.max(2,r.left-pad), hy=Math.max(2,r.top-pad);
    const hw=Math.min(innerWidth-4,r.width+pad*2), hh=Math.min(innerHeight-4,r.height+pad*2);
    Object.assign(tourEls.hole.style,{left:hx+'px',top:hy+'px',width:hw+'px',height:hh+'px'});
    // place pop: prefer below, else above, else right
    const pop=tourEls.pop; const pw=Math.min(360, innerWidth-24); pop.style.width=pw+'px';
    const ph=pop.offsetHeight||180;
    let px=Math.min(Math.max(12, r.left), innerWidth-pw-12);
    let py;
    if(hy+hh+ph+14 < innerHeight) py=hy+hh+12;
    else if(hy-ph-12 > 0) py=hy-ph-12;
    else py=Math.max(12, innerHeight-ph-12);
    Object.assign(pop.style,{left:px+'px',top:py+'px'});
  }
  function endTour(){
    if(!tourActive) return;
    const cur=steps[tourIdx]; if(cur) stepHook(cur.after);
    tourActive=false;
    window.removeEventListener('keydown', tourKey);
    window.removeEventListener('resize', positionTour);
    if(tourEls){ Object.values(tourEls).forEach(n=>n.remove()); tourEls=null; }
  }

  // ---------------- wbudowane zakładki + wspólne narzędzia UI dla modułów zakładek ----------------
  addTab('lang','settings',tabLang); addTab('account','user',tabAccount); addTab('appearance','palette',tabAppearance);
  addTab('install','download',tabInstall); addTab('shortcuts','keyboard',tabShortcuts); addTab('tutorial','play',tabTutorial);
  addTab('about','layers',tabAbout);
  const kit={ U, I, ic, el, t, section, bigBtn, close, overlayShell, tabbedPanel, selectTab, get handlers(){ return handlers; } };

  // rebuild on language change so settings & tour pop are translated
  I.onChange(()=>{ if(overlay){ build(); } if(tourActive){ renderTourPop(); positionTour(); } });

  return { open, close, wire, startTutorial, isTourActive:()=>tourActive, addTab, tabs:tabKeys, kit };
})();
