/* ===================== app.js — bootstrap ===================== */
// Cienki rozruch: start aplikacji (CM.App.boot w DOMContentLoaded, jak dotąd) i window.CMApp — publiczne API
// używane przez chatbot.js, drive.js, inspect.js i tools/smoke.mjs (te same klucze co przed podziałem).
// Cała logika żyje w modułach CM.App: app-core.js, chrome.js, repo-hosts.js, compare.js, navigation.js, ai-bridge.js.
// (etap przejściowy: część segmentów jeszcze tutaj, do wydzielenia w kolejnych krokach)
(function(){
  const A=CM.App;
  const U=CM.util, $=U.$, el=U.el, I=CM.i18n;
  const Loaders=CM.Loaders, Storage=CM.Storage, UI=CM.UI;
  const state=A.state, filters=A.filters, handlers=A.handlers, THEME_PRESETS=A.THEME_PRESETS;   // pola stałe kontekstu (nigdy nie podmieniane)

  // ---------------- PWA: offline service worker + install prompt ----------------
  let _installPrompt=null;
  function wirePWA(){
    if('serviceWorker' in navigator){
      window.addEventListener('load', ()=>{
        const hadController=!!navigator.serviceWorker.controller;   // false on first ever load (so we don't toast then)
        navigator.serviceWorker.register('sw.js').catch(()=>{});
        navigator.serviceWorker.addEventListener('controllerchange',()=>{
          if(!hadController) return;   // first install / claim — not an update
          try{ U.toast(I.t('ca.swUpdated','✨ Dostępna nowa wersja — odśwież stronę (Ctrl+R).'),'',6000); }catch(e){}
        });
      });
    }
    const showInstall=(on)=>{ document.querySelectorAll('.pwa-install').forEach(b=>b.classList.toggle('hidden', !on)); };
    const doInstall=async()=>{ if(!_installPrompt) return; _installPrompt.prompt();
      try{ await _installPrompt.userChoice; }catch(e){} _installPrompt=null; showInstall(false); };
    window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); _installPrompt=e; showInstall(true); });
    window.addEventListener('appinstalled', ()=>{ _installPrompt=null; showInstall(false); U.toast(I.t('ca.pwaInstalled','✅ Zainstalowano CodeMap jako aplikację.'),'success',4000); });
    const btn=$('#btn-install'); if(btn){ btn.classList.add('pwa-install'); btn.onclick=doInstall; }
    // expose for the command palette
    state._installApp=doInstall; state._canInstall=()=>!!_installPrompt;
  }

  // ---------------- persistent settings (theme / appearance / filters) ----------------
  const SETTINGS_KEY='codemap_settings';

  const SETTINGS_INPUTS=['rng-trans','rng-menu','rng-blur','rng-tint','col-accent','col-bg',
    'rng-nscale','rng-spacing','rng-fscale','sel-layout','sel-metric',
    'show-folders','show-files','show-externals','edge-contains','edge-import','edge-reference',
    'opt-grid','opt-curved','opt-lockall','opt-hover-preview'];
  function collectSettings(){
    const s={};
    for(const id of SETTINGS_INPUTS){ const el=$('#'+id); if(!el) continue; s[id]= el.type==='checkbox'? el.checked : el.value; }
    s._theme = document.body.classList.contains('light')?'light':'dark';
    const pre=document.querySelector('#theme-presets .thpre.active'); if(pre) s._preset=pre.dataset.pre;
    const mr=document.documentElement.style.getPropertyValue('--menu-rgb'); if(mr) s._menuRgb=mr.trim();
    return s;
  }
  function saveSettings(){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(collectSettings())); }catch(e){} }
  // luminance (0..1) of a "#rrggbb" hex or an "r,g,b" string — used to keep bg/tint and theme consistent
  function _lum(v){ let r,g,b;
    if(/^#/.test(v)){ let h=v.replace('#',''); if(h.length===3)h=h.split('').map(c=>c+c).join(''); const n=parseInt(h,16); r=(n>>16)&255; g=(n>>8)&255; b=n&255; }
    else { const p=String(v).split(',').map(Number); r=p[0]||0; g=p[1]||0; b=p[2]||0; }
    return (0.299*r+0.587*g+0.114*b)/255;
  }
  function applySettings(s){
    if(!s) return;
    const themeLight = s._theme==='light';
    if(themeLight){ const b=document.querySelector('#theme-row .theme-btn[data-theme="light"]'); if(b) b.click(); }
    // restore the whole named preset when one was active; otherwise re-apply a raw persisted window
    // tint only if it matches the theme (a dark tint under light — or vice versa — looks broken)
    if(s._preset && A._applyThemePreset && THEME_PRESETS[s._preset]){ A._applyThemePreset(s._preset); }
    else{
      const tint=s._menuRgb||s._menuTint;   // _menuTint = legacy pre-preset storage
      if(tint && (_lum(tint)>0.5)===themeLight){
        document.documentElement.style.setProperty('--menu-rgb', tint);
        document.documentElement.style.setProperty('--glass-rgb', tint);
      }
    }
    for(const id of SETTINGS_INPUTS){ const el=$('#'+id); if(!el || !(id in s)) continue;
      if(id==='col-bg' && (_lum(String(s[id]))>0.5)!==themeLight) continue;   // skip a theme-incompatible canvas bg
      if(el.type==='checkbox'){ if(el.checked!==s[id]){ el.checked=s[id]; el.dispatchEvent(new Event('change',{bubbles:true})); } }
      else if(el.tagName==='SELECT'){
        if([...el.options].some(o=>o.value===String(s[id])) && el.value!==String(s[id])){ el.value=s[id]; el.dispatchEvent(new Event('change',{bubbles:true})); }
      }
      else if(el.value!==String(s[id])){ el.value=s[id]; el.dispatchEvent(new Event('input',{bubbles:true})); }
    }
  }
  function wireSettings(){
    let saved=null; try{ saved=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null'); }catch(e){}
    applySettings(saved);
    const persist=U.debounce(saveSettings, 250);
    const onEvt=(e)=>{ if(e.target && e.target.id && SETTINGS_INPUTS.includes(e.target.id)) persist(); };
    document.addEventListener('change', onEvt); document.addEventListener('input', onEvt);
    document.querySelectorAll('#theme-row .theme-btn, #accent-row .acc, #theme-presets .thpre').forEach(b=>b.addEventListener('click', persist));
  }

  // ---------------- digital clock (status bar) ----------------
  function startClock(){
    const elc=$('#st-clock'); if(!elc) return;
    const p=(n)=>String(n).padStart(2,'0');
    const tick=()=>{ const d=new Date(); elc.innerHTML=`${p(d.getHours())}:${p(d.getMinutes())}<span class="st-sec">:${p(d.getSeconds())}</span>`; };
    tick(); setInterval(tick, 1000);
  }

  // dropdown toolbar menus (VS Code-style)
  function wireMenus(){
    const menus=Array.from(document.querySelectorAll('.tb-menu'));
    const closeAll=(except)=>menus.forEach(m=>{ if(m!==except) m.classList.remove('open'); });
    menus.forEach(m=>{
      const btn=m.querySelector('.tb-menu-btn');
      btn.onclick=(e)=>{ e.stopPropagation(); const open=m.classList.contains('open'); closeAll(); m.classList.toggle('open', !open); };
      // clicking an item runs its handler then closes the menu
      m.querySelectorAll('.menu-item').forEach(it=>it.addEventListener('click',()=>m.classList.remove('open')));
    });
    document.addEventListener('click',(e)=>{ if(!e.target.closest('.tb-menu')) closeAll(); });
    window.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeAll(); });
  }

  // layout dropdown styled like the Wczytaj menu; the hidden <select id="sel-layout"> stays the
  // source of truth (value + change event), so all existing wiring/persistence keeps working.
  function wireLayoutMenu(){
    const I=CM.i18n;
    const sel=$('#sel-layout'), menu=$('.tb-menu[data-menu="layout"]'),
          panel=$('#layout-menu-panel'), label=$('#layout-menu-label');
    if(!sel||!panel) return;
    const lay=(o)=>I.t('layout.'+o.value, o.textContent);
    function mkItem(opt){
      const it=el('button',{class:'menu-item'+(opt.value===sel.value?' active':''),text:lay(opt)});
      it.onclick=()=>{ if(sel.value!==opt.value){ sel.value=opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); } menu.classList.remove('open'); render(); };
      return it;
    }
    function render(){
      panel.innerHTML='';
      Array.from(sel.children).forEach(ch=>{
        if(ch.tagName==='OPTGROUP'){
          const g=ch.getAttribute('data-group')||ch.label;
          panel.appendChild(el('div',{class:'menu-group-label',text:I.t('layout.group.'+g, ch.label)}));
          Array.from(ch.children).forEach(opt=>panel.appendChild(mkItem(opt)));
        } else if(ch.tagName==='OPTION'){ panel.appendChild(mkItem(ch)); }
      });
      updateLabel();
    }
    function updateLabel(){ const o=sel.selectedOptions[0]; if(label) label.textContent=o?lay(o):''; }
    sel.addEventListener('change', updateLabel);
    I.onChange(render);
    render();
  }

  // settings overlay: gear button + context-menu entry, plus the install/data handlers
  function resetAppearance(){
    const dk=document.querySelector('#theme-row .theme-btn[data-theme="dark"]'); if(dk) dk.click();
    SETTINGS_INPUTS.forEach(id=>{
      if(id==='sel-layout'||id==='sel-metric') return;          // appearance reset must not relayout/refilter
      const e=$('#'+id); if(!e) return;
      if(e.type==='checkbox'){ if(e.checked!==e.defaultChecked){ e.checked=e.defaultChecked; e.dispatchEvent(new Event('change',{bubbles:true})); } }
      else if(e.value!==e.defaultValue){ e.value=e.defaultValue; e.dispatchEvent(new Event('input',{bubbles:true})); }
    });
    const ac=document.querySelector('#accent-row .acc[data-acc="#22d3ee"]'); if(ac) ac.click();
    if(A._applyThemePreset) A._applyThemePreset('depth');
  }
  function wireSettingsUI(){
    CM.Settings.wire({
      canInstall:()=>!!_installPrompt,
      installPWA:()=>{ if(state._installApp) state._installApp(); },
      aiHasProject:()=>state.counts.nodes>0,
      aiAnalyze:()=>A.aiAnalyze(),
      ensurePanel:(side,open)=>{ const p=$('#'+side+'-panel'); if(!p) return;
        const collapsed=p.classList.contains('collapsed');
        if(open&&collapsed) togglePanel(side); else if(!open&&!collapsed) togglePanel(side); },
      openAppearancePanel:()=>{ const p=$('#left-panel'); if(p.classList.contains('collapsed')) togglePanel('left');
        const blk=$('#rng-trans'); if(blk&&blk.closest('.filter-block')) blk.closest('.filter-block').scrollIntoView({behavior:'smooth',block:'start'}); },
      resetAppearance:resetAppearance,
      uninstall:async()=>{
        try{ if(navigator.serviceWorker){ const regs=await navigator.serviceWorker.getRegistrations(); for(const r of regs) await r.unregister(); } }catch(e){}
        try{ const ks=await caches.keys(); for(const k of ks) await caches.delete(k); }catch(e){}
      },
      clearAllData:async()=>{
        try{ if(CM.Storage.clearSession) await CM.Storage.clearSession(); }catch(e){}
        try{ indexedDB.deleteDatabase('codemap-db'); }catch(e){}
        try{ indexedDB.deleteDatabase('codemap-drive'); }catch(e){}
        // wipe EVERY app key (settings, mindmaps, snapshots, AI keys, chatbot convs, recents…),
        // not a hardcoded subset that drifts as features are added
        try{
          const ks=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && k.toLowerCase().startsWith('codemap')) ks.push(k); }
          ks.forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
        }catch(e){}
        setTimeout(()=>location.reload(), 700);
      },
    });
    const g=$('#btn-settings'); if(g) g.onclick=()=>CM.Settings.open();
    if(CM.Drive && CM.Drive.wireButton) CM.Drive.wireButton();
    if(CM.ChatBot && CM.ChatBot.init) CM.ChatBot.init();
  }

  // ---------------- toolbar ----------------
  function wireToolbar(){
    $('#btn-load-folder').onclick=()=>$('#input-folder').click();
    $('#empty-folder').onclick=()=>$('#input-folder').click();
    $('#btn-load-files').onclick=()=>$('#input-files').click();
    $('#btn-load-github').onclick=()=>{ A.renderRecentRepos(); A.refreshGhRate(); openModal('modal-github'); };
    $('#empty-github').onclick=()=>{ A.renderRecentRepos(); A.refreshGhRate(); openModal('modal-github'); };
    $('#empty-demo').onclick=()=>A.loadDemo();
    $('#empty-close').onclick=()=>{ $('#empty-state').classList.add('hidden'); positionMinimap(); };
    // capture the FileList into an array BEFORE clearing the input — resetting value='' empties
    // e.target.files synchronously, and ingest() only reads them after an async tick.
    $('#input-folder').onchange=(e)=>{ const files=Array.from(e.target.files); e.target.value=''; if(files.length) A.ingest((p)=>Loaders.fromFileList(files,p),I.t('ca.readingFolder','Czytanie folderu…')); };
    $('#input-files').onchange=(e)=>{ const files=Array.from(e.target.files); e.target.value=''; if(files.length) A.ingest((p)=>Loaders.fromFileList(files,p),I.t('ca.readingFiles','Czytanie plików…')); };

    $('#sel-layout').onchange=(e)=>{ state.layout=e.target.value; state.displayLayout=e.target.value; A.apply({relayout:true, refit:true}); };

    $('#btn-snapshot').onclick=async()=>{
      if(!A.graph.nodes.size||state.counts.nodes===0){ U.toast(I.t('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; }
      const label=prompt(I.t('ca.snapshotName','Nazwa migawki:'), A.graph.meta.name+' — '+U.fmtDate(Date.now()));
      if(label===null) return;
      await Storage.addSnapshot(A.graph, label||undefined);
      U.toast(I.t('ca.snapshotSaved','📌 Migawka zapisana. Rozwój możesz śledzić w „Historia".'),'success');
    };
    $('#btn-history').onclick=A.openHistory;
    $('#btn-save').onclick=()=>{ if(state.counts.nodes===0){U.toast(I.t('ca.noMapToSave','Brak mapy do zapisania.'),'error');return;} Storage.saveMap(A.graph); U.toast(I.t('ca.mapExported','💾 Mapa wyeksportowana.'),'success'); };
    $('#btn-export-img').onclick=(e)=>{
      e.stopPropagation();
      if(state.counts.nodes===0){ U.toast(I.t('ca.noMapToExport','Brak mapy do eksportu.'),'error'); return; }
      const r=e.currentTarget.getBoundingClientRect();
      UI.ctxMenu([
        {ic:'image',label:I.t('ca.pngExport','PNG (2×)'),action:()=>A.exportImage('png',2)},
        {ic:'image',label:I.t('ca.pngExportHi','PNG (wysoka rozdz. 4×)'),action:()=>A.exportImage('png',4)},
        {ic:'download',label:I.t('ca.svgExport','SVG (wektor)'),action:()=>A.exportImage('svg')},
      ], r.left, r.bottom+4);
    };
    $('#btn-open').onclick=()=>$('#input-open').click();
    $('#input-open').onchange=async(e)=>{ const f=e.target.files[0]; if(!f)return;
      try{ const obj=await Storage.openMap(f); A.loadFromJSON(obj); }catch(err){ U.toast(err.message,'error'); } e.target.value=''; };
    $('#btn-clear').onclick=()=>{
      if(state.counts.nodes>0 && !confirm(I.t('ca.clearConfirm','Wyczyścić załadowaną mapę? (migawki i zapisane pliki pozostaną)'))) return;
      A.clearAll();
    };
    $('#btn-newwin').onclick=()=>{
      const w=window.open(location.origin+location.pathname, '_blank');
      if(!w) U.toast(I.t('ca.newWinBlocked','Przeglądarka zablokowała nowe okno — zezwól na wyskakujące okna.'),'error');
    };
  }

  // ---------------- panels (collapse / rails / map insets) ----------------
  const PW={left:250, right:280};
  function setRail(side){
    const collapsed=$('#'+side+'-panel').classList.contains('collapsed');
    const rail=$('#rail-'+side);
    if(side==='left'){ rail.style.left=(collapsed?0:PW.left-1)+'px'; rail.textContent=collapsed?'›':'‹'; }
    else { rail.style.right=(collapsed?0:PW.right-1)+'px'; rail.textContent=collapsed?'‹':'›'; }
  }
  function updateInsets(){
    A.renderer.inset.l = $('#left-panel').classList.contains('collapsed')?0:PW.left;
    A.renderer.inset.r = $('#right-panel').classList.contains('collapsed')?0:PW.right;
    A.renderer.kick();
    // Minimap: on the welcome screen it centres in the gap between the card and the right panel;
    // with a project loaded it docks bottom-right, clear of the open panel. (see positionMinimap)
    const rightOpen = !$('#right-panel').classList.contains('collapsed');
    positionMinimap();
    // Projekt dropdown sits at the right edge, just left of the details panel (open) or its rail (collapsed)
    document.body.classList.toggle('rp-open', rightOpen);
    document.documentElement.style.setProperty('--proj-right', (rightOpen ? PW.right + 14 : 34) + 'px');
  }
  // Minimap placement. Welcome screen (no project): centre it in the empty area to the right of the
  // welcome card — horizontally between the card and the right panel, vertically balanced against the
  // app's bottom frame. Project loaded: dock bottom-right, shifted clear of an open right panel.
  function positionMinimap(){
    const wrap=$('#minimap-wrap'); if(!wrap) return;
    const rightOpen = !$('#right-panel').classList.contains('collapsed');
    const es=$('#empty-state'), card=$('.empty-card');
    const emptyShown = es && !es.classList.contains('hidden') && card && card.offsetParent!==null;
    // Collapsed = the small "expand" button → dock to the bottom-right corner, flush against the
    // bottom frame and the open details panel. Use left+bottom (not right) because the `right`
    // transition misbehaves when coming from `auto`; left/top position cleanly.
    if(wrap.classList.contains('mm-collapsed')){
      wrap.style.transform=''; wrap.style.top='auto'; wrap.style.right='auto'; wrap.style.bottom='0px';
      const host=wrap.offsetParent||document.documentElement, hr=host.getBoundingClientRect();
      const cw=wrap.offsetWidth||34;
      const rightEdge = rightOpen ? (window.innerWidth - PW.right) : window.innerWidth;   // panel left edge, or screen right
      wrap.style.left = Math.round(rightEdge - cw - hr.left) + 'px';
      return;
    }
    if(!emptyShown){
      wrap.style.transform=''; wrap.style.left='auto'; wrap.style.top='auto';   // revert welcome-screen scaling
      wrap.style.right=(rightOpen?PW.right+14:14)+'px'; wrap.style.bottom='14px';
      return;
    }
    const vw=window.innerWidth, vh=window.innerHeight, PAD=14;
    const cr=card.getBoundingClientRect();
    const gapL=cr.right, gapR=rightOpen?(vw-PW.right):(vw-PAD);   // welcome-card right edge … right-panel left edge
    const natW=wrap.offsetWidth||200, natH=wrap.offsetHeight||140;
    // If the minimap is wider than the gap, scale it down (keeping aspect, via transform so the width
    // cascade can't fight it) so it always sits cleanly BETWEEN the card and the panel — true centring
    // at ANY window width.
    const avail=(gapR-gapL)-PAD*2;
    const k = (natW>avail && avail>=60) ? avail/natW : 1;
    const fw=natW*k, fh=natH*k;                                   // rendered footprint after scaling
    // viewport-coord targets, then convert to the offsetParent's frame (minimap lives in a container
    // offset below the top toolbar, so its top:0 ≠ viewport top; left:0 ≈ viewport left).
    const host=wrap.offsetParent||document.documentElement, hr=host.getBoundingClientRect();
    const leftVp=U.clamp((gapL+gapR)/2 - fw/2, gapL+PAD, Math.max(gapL+PAD, gapR-fw-PAD));   // centre in the gap
    const topVp =U.clamp(vh/2 - fh/2, PAD, vh-PAD-fh);                                         // centre vertically (equal top/bottom)
    wrap.style.right='auto'; wrap.style.bottom='auto';
    wrap.style.transformOrigin='0 0';
    wrap.style.transform = k<0.999 ? ('scale('+k.toFixed(4)+')') : '';
    wrap.style.left=Math.round(leftVp-hr.left)+'px'; wrap.style.top=Math.round(topVp-hr.top)+'px';
  }
  // The minimap stays minimized until a file structure is on the map; it expands on load, re-minimizes on clear.
  function expandMinimap(){ const w=$('#minimap-wrap'); if(!w) return; w.classList.remove('mm-collapsed'); positionMinimap(); A.renderer.drawMinimap($('#minimap')); }
  function minimizeMinimap(){ const w=$('#minimap-wrap'); if(!w) return; w.classList.add('mm-collapsed'); positionMinimap(); }
  function togglePanel(side){
    $('#'+side+'-panel').classList.toggle('collapsed');
    setRail(side); updateInsets();
  }
  function wirePanels(){
    document.querySelectorAll('.collapse-btn').forEach(b=>b.onclick=()=>togglePanel(b.dataset.side));
    $('#rail-left').onclick=()=>togglePanel('left');
    $('#rail-right').onclick=()=>togglePanel('right');
    setRail('left'); setRail('right'); updateInsets();
  }
  // small collapse/expand chevrons on each left-panel section (Wygląd, Mapa, Figury, …); state persisted
  function wireCollapsibleSections(){
    let collapsed={}; try{ collapsed=JSON.parse(localStorage.getItem('codemap_fb')||'{}'); }catch(e){}
    const save=U.debounce(()=>{ try{ localStorage.setItem('codemap_fb', JSON.stringify(collapsed)); }catch(e){} }, 200);
    document.querySelectorAll('#left-panel .filter-block').forEach(block=>{
      const h4=block.querySelector('h4'); if(!h4 || h4.querySelector('.fb-toggle')) return;
      const key=(h4.querySelector('[data-i18n]')&&h4.querySelector('[data-i18n]').dataset.i18n) || h4.getAttribute('data-i18n') || h4.textContent.trim();
      const tgl=el('button',{class:'fb-toggle',title:CM.i18n.t('fb.toggle','Zwiń / rozwiń'),html:CM.icons.svg('chevronDown',{size:14})});
      h4.appendChild(tgl);
      if(collapsed[key]) block.classList.add('fb-collapsed');
      const toggle=()=>{ const c=block.classList.toggle('fb-collapsed'); collapsed[key]=c; save(); };
      tgl.onclick=(e)=>{ e.stopPropagation(); toggle(); };
      h4.onclick=(e)=>{ if(e.target.closest('button:not(.fb-toggle), input, .mini-btn')) return; toggle(); };
    });
  }

  // ---------------- appearance (liquid glass) ----------------
  function wireAppearance(){
    const root=document.documentElement.style;
    const trans=$('#rng-trans'), menu=$('#rng-menu'), blur=$('#rng-blur'), tint=$('#rng-tint');
    const applyTrans=()=>{ const v=+trans.value; $('#val-trans').textContent=v+'%'; root.setProperty('--glass-alpha', (1 - v/100*0.95).toFixed(3)); };
    const applyMenu=()=>{ const v=+menu.value; $('#val-menu').textContent=v+'%'; root.setProperty('--menu-alpha', (1 - v/100*0.95).toFixed(3)); };
    const applyBlur=()=>{ const v=+blur.value; $('#val-blur').textContent=v+'px'; root.setProperty('--glass-blur', v+'px'); };
    const applyTint=()=>{ const v=+tint.value; $('#val-tint').textContent=v+'%'; root.setProperty('--glass-sat', (0.5 + v/100*1.5).toFixed(2)); };
    trans.oninput=applyTrans; menu.oninput=applyMenu; blur.oninput=applyBlur; tint.oninput=applyTint;
    applyTrans(); applyMenu(); applyBlur(); applyTint();
    const setAccent=(c)=>{ root.setProperty('--accent', c); A.renderer.clearCssCache(); A.renderer.kick(); };
    document.querySelectorAll('#accent-row .acc').forEach(b=>b.onclick=()=>{
      setAccent(b.dataset.acc); $('#col-accent').value=b.dataset.acc;
      document.querySelectorAll('#accent-row .acc').forEach(x=>x.classList.toggle('active', x===b));
    });
    $('#col-accent').oninput=(e)=>{ setAccent(e.target.value); document.querySelectorAll('#accent-row .acc').forEach(x=>x.classList.remove('active')); };
    // ---- background ----
    const colBg=$('#col-bg');
    const applyBg=(hex)=>{ root.setProperty('--bg', hex); A.renderer.clearCssCache(); A.renderer.kick(); };
    colBg.oninput=()=>{ applyBg(colBg.value); document.querySelectorAll('#theme-presets .thpre').forEach(x=>x.classList.remove('active')); };
    // ---- curated theme presets: one click applies a coherent professional set ----
    A._applyThemePreset=(key)=>{
      const p=THEME_PRESETS[key]; if(!p) return false;
      const tb=document.querySelector('#theme-row .theme-btn[data-theme="'+p.theme+'"]'); if(tb) tb.click();  // base surfaces + body.light
      root.setProperty('--bg', p.bg); root.setProperty('--menu-rgb', p.menu); root.setProperty('--glass-rgb', p.menu);
      colBg.value=p.bg;
      const ca=$('#col-accent'); if(ca) ca.value=p.accent;
      setAccent(p.accent);
      document.querySelectorAll('#accent-row .acc').forEach(x=>x.classList.toggle('active', x.dataset.acc===p.accent));
      document.querySelectorAll('#theme-presets .thpre').forEach(x=>x.classList.toggle('active', x.dataset.pre===key));
      A.renderer.clearCssCache(); A.renderer.kick();
      return true;
    };
    document.querySelectorAll('#theme-presets .thpre').forEach(b=>b.onclick=()=>A._applyThemePreset(b.dataset.pre));
    // ---- light / dark theme ----
    document.querySelectorAll('#theme-row .theme-btn').forEach(b=>b.onclick=()=>{
      const light=b.dataset.theme==='light';
      document.body.classList.toggle('light', light);
      document.querySelectorAll('#theme-row .theme-btn').forEach(x=>x.classList.toggle('active', x===b));
      // The theme owns the base surfaces. Set them INLINE on <html> (documentElement), because the
      // renderer and panels read custom props from documentElement — `body.light` only sets them on
      // <body>, which never reaches <html> (custom props inherit downward, not up). This also clears
      // any custom bg/tint pick, so a dark bg/tint never lingers in light mode (and vice versa).
      const TV = light
        ? {'--bg':'#eef1f6','--menu-rgb':'236,239,246','--glass-rgb':'236,239,246','--grid-line':'#8aa0bd','--grid-dot':'#74879f'}
        : {'--bg':'#070a10','--menu-rgb':'14,19,28','--glass-rgb':'14,19,28','--grid-line':'#5a6f88','--grid-dot':'#7d93ad'};
      for(const k in TV) root.setProperty(k, TV[k]);
      colBg.value = light ? '#eef1f6' : '#070a10';
      document.querySelectorAll('#theme-presets .thpre').forEach(x=>x.classList.remove('active'));
      A.renderer.clearCssCache(); A.renderer.kick();
    });
    // map render options
    const optBind=(id,key)=>{ const el=$('#'+id); el.onchange=()=>{ A.renderer.opts[key]=el.checked; A.renderer.kick(); }; A.renderer.opts[key]=el.checked; };
    optBind('opt-grid','showGrid'); optBind('opt-curved','curvedImports');
    optBind('opt-lockall','lockAll');
  }

  // ---------------- node appearance (size + spacing + label font) ----------------
  function wireNodeAppearance(){
    const rng=$('#rng-nscale');
    if(!rng) return;
    A.renderer.opts.nodeScale=(+rng.value)/100;   // honour the default (2.5×) figure size at startup
    rng.oninput=()=>{
      const v=+rng.value;
      $('#val-nscale').textContent=v+'%';
      A.renderer.opts.nodeScale=v/100;
      A.renderer.kick();
    };
    const sp=$('#rng-spacing');
    if(sp) sp.oninput=()=>{ const v=+sp.value; $('#val-spacing').textContent=v+'%'; state.spacing=v/100;
      if(state.layout!=='saved'){ A.apply({relayout:true}); } };
    const fs=$('#rng-fscale');
    if(fs) fs.oninput=()=>{ const v=+fs.value; $('#val-fscale').textContent=v+'%'; A.renderer.opts.labelScale=v/100; A.renderer.kick(); };
  }

  // ---------------- clipboard paste (grab/paste files & images) ----------------
  function wirePaste(){
    window.addEventListener('paste',(e)=>{
      const tag=document.activeElement && document.activeElement.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA') return;
      const cd=e.clipboardData; if(!cd) return;
      const files=[];
      if(cd.files && cd.files.length){ for(const f of cd.files) files.push(f); }
      else if(cd.items){ for(const it of cd.items){ if(it.kind==='file'){ const f=it.getAsFile(); if(f) files.push(f); } } }
      if(files.length){
        e.preventDefault();
        A.ingest((p)=>Loaders.fromFileList(files,p),I.t('ca.pastingPre','Wklejanie ')+files.length+I.t('ca.pastingPost',' plików…'));
      } else {
        const txt=cd.getData('text');
        if(txt && /github\.com|^[\w.-]+\/[\w.-]+$/.test(txt.trim())){
          $('#gh-url').value=txt.trim(); openModal('modal-github');
        }
      }
    });
  }

  // ---------------- filters ----------------
  function wireFilters(){
    // toggling a filter keeps existing node positions (relayout:false) so the map never re-scrambles
    const bind=(id,key)=>{ $('#'+id).onchange=(e)=>{ filters[key]=e.target.checked; A.apply({relayout:false}); }; };
    bind('show-folders','folders'); bind('show-files','files'); bind('show-externals','externals');
    bind('edge-contains','contains'); bind('edge-import','import'); bind('edge-reference','reference');
    $('#lang-toggle-all').onclick=()=>{
      const stats=Array.from(A.graph.langStats.keys());
      if(filters.langsOff.size){ filters.langsOff.clear(); } else { stats.forEach(k=>filters.langsOff.add(k)); }
      A.apply({relayout:false});
    };
    // complexity / size filter
    $('#sel-metric').onchange=(e)=>{ filters.metric=e.target.value; filters.minMetric=0; refreshMetricRange(); A.apply({relayout:false}); };
    $('#rng-minmetric').oninput=(e)=>{ filters.minMetric=+e.target.value; updateMetricLabel(); A.apply({relayout:false}); };
  }

  // recompute the slider's max from the current data + metric, reset threshold to 0
  function refreshMetricRange(){
    const m=filters.metric, rng=$('#rng-minmetric'); if(!rng) return;
    let max=0;
    if(A.graph&&A.graph.nodes) for(const n of A.graph.nodes.values()){
      if(n.type!=='file') continue;
      const v = m==='size' ? (n.size||0) : (n.metrics ? (n.metrics[m]||0) : 0);
      if(v>max) max=v;
    }
    rng.max=Math.max(1,max); rng.value=0; filters.minMetric=0;
    rng.step = max>2000 ? Math.round(max/200) : 1;
    updateMetricLabel();
  }
  function updateMetricLabel(){
    const v=filters.minMetric, lbl=$('#val-minmetric'); if(!lbl) return;
    lbl.textContent = filters.metric==='size' ? (v?U.fmtBytes(v):'0') : U.fmtNum(v);
  }

  // ---------------- view controls ----------------
  function wireViewControls(){
    $('#vc-zoom-in').onclick=()=>A.renderer.zoomBy(1.3);
    $('#vc-zoom-out').onclick=()=>A.renderer.zoomBy(1/1.3);
    $('#vc-fit').onclick=()=>A.renderer.fit();
    $('#vc-rot-left').onclick=()=>A.renderer.rotateBy(-Math.PI/12);
    $('#vc-rot-right').onclick=()=>A.renderer.rotateBy(Math.PI/12);
    $('#vc-rot-reset').onclick=()=>A.renderer.resetRotation();
    $('#vc-3d').onclick=()=>A.renderer.setTilt(A.renderer.cam.tilt>0.05?0:0.62);
    { const vi=$('#vc-impact'); if(vi) vi.onclick=()=>A.toggleImpact(); }
    // Collapse toggle — when collapsed, the button parks just to the RIGHT of the search box;
    // when expanded, the bar opens back in its current (top-centre) spot.
    const vc=$('#view-controls'), btn=$('#vc-collapse');
    const dockBesideSearch=()=>{
      const sw=document.querySelector('.search-wrap'), tb=$('#toolbar');
      if(!sw||!tb) return; const sr=sw.getBoundingClientRect(), tr=tb.getBoundingClientRect();
      vc.style.left=(sr.right+10)+'px'; vc.style.top=(tr.top+(tr.height-40)/2)+'px'; vc.style.transform='none';
    };
    btn.onclick=()=>{
      const collapsed=vc.classList.toggle('vc-collapsed');
      btn.title = collapsed ? I.t('ca.expandToolbar','Rozwiń pasek narzędzi') : I.t('ca.collapseToolbar','Zwiń pasek narzędzi');
      if(collapsed) dockBesideSearch();
      else { vc.style.left=''; vc.style.top=''; vc.style.transform=''; }   // back to CSS top-centre
    };
    window.addEventListener('resize', ()=>{ if(vc.classList.contains('vc-collapsed')) dockBesideSearch(); });
  }

  // ---------------- search ----------------
  function wireSearch(){
    const inp=$('#search-input');
    // subsequence fuzzy match: every char of q appears in order in s; rewards adjacency + start-of-word.
    const fuzzy=(q,s)=>{ let i=0,j=0,score=0,prev=-2; const L=s.length;
      for(; i<q.length && j<L; j++){ if(q[i]===s[j]){ score += (j===prev+1?3:1) + (j===0||s[j-1]==='/'||s[j-1]==='.'||s[j-1]==='-'||s[j-1]==='_'?4:0); prev=j; i++; } }
      return i===q.length ? score - (L-q.length)*0.04 : -1; };
    const run=U.debounce(()=>{
      const q=inp.value.trim().toLowerCase(); if(!q){ UI.renderSearch([], handlers); A.renderer.setHighlight(null); return; }
      const scored=[]; const all=[];
      for(const n of A.graph.nodes.values()){
        if(n.id==='__root__'||n.id==='__ext__') continue;
        const name=n.name.toLowerCase(), path=(n.path||'').toLowerCase();
        let sc=-1;
        if(name===q) sc=1000;
        else if(name.startsWith(q)) sc=620-name.length;
        else if(name.includes(q)) sc=440-name.indexOf(q);
        else if(path.includes(q)) sc=240-Math.min(path.indexOf(q),120)*0.5;
        else { const f=fuzzy(q,name); if(f>=0) sc=90+f; else { const fp=fuzzy(q,path); if(fp>=0) sc=45+fp; } }
        if(sc>=0){ all.push(n.id); scored.push({n,sc}); }
      }
      scored.sort((a,b)=> b.sc-a.sc || a.n.name.length-b.n.name.length);
      UI.renderSearch(scored.slice(0,60).map(o=>o.n), handlers);
      A.renderer.setHighlight(all.length?new Set(all):null);   // light up matches on the map
    },140);
    inp.oninput=run;
    inp.onkeydown=(e)=>{ if(e.key==='Enter'){ const first=$('#search-results .sr-item'); if(first) first.click(); } if(e.key==='Escape'){ inp.value=''; UI.renderSearch([],handlers); A.renderer.setHighlight(null); inp.blur(); } };
    document.addEventListener('click',(e)=>{ if(!e.target.closest('.search-wrap')) $('#search-results').classList.add('hidden'); });
  }

  // ---------------- drag & drop ----------------
  function wireDnD(){
    const stage=$('#stage');
    const clearDrag=()=>stage.classList.remove('drag-over');
    ;['dragenter','dragover'].forEach(ev=>stage.addEventListener(ev,(e)=>{ e.preventDefault(); stage.classList.add('drag-over'); }));
    ;['dragleave','drop'].forEach(ev=>stage.addEventListener(ev,(e)=>{ e.preventDefault(); if(ev==='drop'||e.target===stage||!e.relatedTarget) clearDrag(); }));
    // safety: the drag-over hint must never get stuck (flaky native DnD) — clear it on any interaction
    window.addEventListener('dragend', clearDrag);
    window.addEventListener('drop', clearDrag, true);
    stage.addEventListener('mousedown', clearDrag);
    stage.addEventListener('wheel', clearDrag, {passive:true});
    stage.addEventListener('drop',(e)=>{ e.preventDefault(); stage.classList.remove('drag-over');
      const dt=e.dataTransfer; if(!dt) return;
      // IMPORTANT: capture entries/files SYNCHRONOUSLY here — the DataTransfer is emptied by the
      // browser once this handler returns, and ingest() awaits a tick before reading it.
      const items=Array.from(dt.items||[]).filter(i=>i.kind==='file');
      const entries=items.map(i=> i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      const files=Array.from(dt.files||[]);
      A.ingest((p)=>Loaders.fromDrop(entries, files, p),I.t('ca.readingDropped','Czytanie upuszczonych plików…'));
    });
  }

  // ---------------- modals ----------------
  function openModal(id){ $('#'+id).classList.remove('hidden'); }
  function closeModal(m){ m.classList.add('hidden'); }

  function wireModals(){
    document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.closest('.modal-backdrop')));
    document.querySelectorAll('.input-clear-x').forEach(b=>{ b.onmousedown=(e)=>e.preventDefault(); b.onclick=(e)=>{ e.stopPropagation(); const inp=$('#'+b.dataset.clear); if(inp){ inp.value=''; inp.focus(); } }; });
    // close only when the press STARTS on the backdrop itself — prevents drag-selecting text in an
    // input and releasing over the backdrop from closing the dialog, and stray clicks throwing you out.
    document.querySelectorAll('.modal-backdrop').forEach(bd=>bd.onmousedown=(e)=>{ if(e.target===bd) closeModal(bd); });
    $('#gh-go').onclick=()=>{
      const url=$('#gh-url').value.trim(); if(!url){ U.toast(I.t('ca.enterAddress','Podaj adres.'),'error'); return; }
      const token=$('#gh-token').value.trim()||undefined; if(token) state._ghToken=token;   // remember for Gist
      closeModal($('#modal-github'));
      const opts={branch:$('#gh-branch').value.trim()||undefined, token, fetchContent:$('#gh-fetch-content').checked};
      const host=Loaders.repoHost(url), nice={github:'GitHub',gitlab:'GitLab',bitbucket:'Bitbucket'}[host];
      A.ingest((p,s)=>Loaders.fromRepoURL(url, opts, p, s),I.t('ca.connectingToPre','Łączenie z ')+nice+I.t('ca.connectingToPost','…'));
    };
    $('#gh-url').onkeydown=(e)=>{ if(e.key==='Enter') $('#gh-go').click(); };
    // branch/tag picker: fetch refs into the shared datalist + show API rate limit
    $('#gh-load-refs').onclick=async()=>{
      const url=$('#gh-url').value.trim(); if(!url){ U.toast(I.t('ca.enterAddress','Podaj adres.'),'error'); return; }
      const btn=$('#gh-load-refs'); btn.disabled=true;
      const refs=await Loaders.fetchRefs(url, $('#gh-token').value.trim()||undefined);
      btn.disabled=false;
      A.fillRefList(refs); A.refreshGhRate();
      const n=(refs.branches||[]).length+(refs.tags||[]).length;
      U.toast(n? (I.t('ca.refsLoadedPre','Wczytano ')+n+I.t('ca.refsLoadedPost',' gałęzi/tagów.')) : I.t('ca.refsNone','Nie pobrano gałęzi (sprawdź adres / token).'), n?'success':'error');
    };
    $('#gh-cmp-go').onclick=()=>{
      const url=$('#gh-url').value.trim(); const a=$('#gh-cmp-a').value.trim(), b=$('#gh-cmp-b').value.trim();
      A.compareBranches(url, a, b, $('#gh-token').value.trim()||undefined);
    };
    $('#btn-gist').onclick=()=>A.exportGist();
    { const cl=$('#btn-copylink'); if(cl) cl.onclick=()=>A.copyViewLink(); }
    $('#hist-export').onclick=async()=>{ const all=await Storage.allSnapshots(); U.download('codemap-historia.json', JSON.stringify(all)); U.toast(I.t('ca.historyExported','Historia wyeksportowana.'),'success'); };
    $('#hist-import').onclick=()=>$('#input-import-hist').click();
    $('#input-import-hist').onchange=async(e)=>{ const f=e.target.files[0]; if(!f)return; try{ const arr=JSON.parse(await f.text()); await Storage.importSnapshots(arr); U.toast(I.t('ca.importedSnapshotsPre','Zaimportowano ')+arr.length+I.t('ca.importedSnapshotsPost',' migawek.'),'success'); A.openHistory(); }catch(err){ U.toast(I.t('ca.importError','Błąd importu.'),'error'); } e.target.value=''; };
    $('#diff-apply').onclick=()=>{ if(state.lastDiff){ Storage.applyDiffToGraph(A.graph, state.lastDiff); A.renderer.diffMode=true; A.countsInit(); A.apply({}); closeModal($('#modal-diff')); U.toast(I.t('ca.diffApplied','Różnice naniesione na mapę (zielony=nowy, żółty=zmiana, czerwony=usunięty).'),'success',5000); } };
  }

  // ---------------- brand logo (spin + balls -> GitHub) ----------------
  function wireBrand(){
    const brand=document.querySelector('.brand'); if(!brand) return;
    brand.style.cursor='pointer';
    const logo=brand.querySelector('.brand-logo');
    let lastSpin=-1e9;
    const SPIN_COOLDOWN=10000;   // the logo can be spun by clicking once every 10 seconds
    brand.onclick=()=>{
      const now=performance.now();
      if(now-lastSpin < SPIN_COOLDOWN){ logo.classList.add('logo-cooldown'); setTimeout(()=>logo.classList.remove('logo-cooldown'),360); return; }
      lastSpin=now;
      // playful spin + particle burst (no navigation)
      logo.classList.remove('logo-spin'); void logo.offsetWidth; logo.classList.add('logo-spin');
      const r=logo.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
      const cols=['#22d3ee','#7c5cff','#ec4899','#34d399','#f59e0b'];
      for(let i=0;i<16;i++){
        const b=el('div',{class:'logo-ball'}); document.body.appendChild(b);
        b.style.left=cx+'px'; b.style.top=cy+'px'; b.style.background=cols[i%cols.length];
        const ang=(i/16)*Math.PI*2 + (i%2?0.3:0), dist=46+(i%5)*16;
        requestAnimationFrame(()=>{ b.style.transform=`translate(${Math.cos(ang)*dist}px,${Math.sin(ang)*dist}px) scale(0)`; b.style.opacity='0'; });
        setTimeout(()=>b.remove(), 760);
      }
    };
  }

  // ---------------- keyboard ----------------
  // ALT+S: toggle the shortcuts cheatsheet (Settings → Skróty) from anywhere
  function toggleShortcutsOverlay(){
    if(!CM.Settings) return;
    const so=document.getElementById('settings-overlay');
    const open=so && !so.classList.contains('hidden');
    const tab=open && so.querySelector('.set-tab.active');
    if(open && tab && tab.getAttribute('data-tab')==='shortcuts') CM.Settings.close();
    else CM.Settings.open('shortcuts');
  }
  function wireKeyboard(){
    window.addEventListener('keydown',(e)=>{
      // works even with focus in an input — it only opens/closes the cheatsheet overlay
      if(e.altKey && !e.ctrlKey && !e.metaKey && (e.code==='KeyS'||e.key==='s'||e.key==='S')){
        e.preventDefault(); toggleShortcutsOverlay(); return; }
      if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;
      switch(e.key){
        case 'f': case 'F': A.renderer.fit(); break;
        case '+': case '=': A.renderer.zoomBy(1.3); break;
        case '-': case '_': A.renderer.zoomBy(1/1.3); break;
        case 'q': case 'Q': A.renderer.rotateBy(-Math.PI/12); break;
        case 'e': case 'E': A.renderer.rotateBy(Math.PI/12); break;
        case 'r': case 'R': A.renderer.resetRotation(); break;
        case 't': case 'T': A.renderer.setTilt(A.renderer.cam.tilt>0.05?0:0.62); break;
        case 'i': case 'I': if(A.renderer.selected) A.isolateNode(A.renderer.selected); break;   // skupienie na zaznaczonym
        case 'x': case 'X': A.toggleImpact(); break;   // widok wpływu zależności (upstream/downstream)
        case '/': e.preventDefault(); $('#search-input').focus(); break;
        case 'Escape': UI.hideCtx(); A.select(null); A.renderer.setHighlight(null); break;
        case 'ArrowUp': A.renderer.cam.y-=40/A.renderer.cam.zoom; A.renderer.onChange(); A.renderer.kick(); break;
        case 'ArrowDown': A.renderer.cam.y+=40/A.renderer.cam.zoom; A.renderer.onChange(); A.renderer.kick(); break;
        case 'ArrowLeft': A.renderer.cam.x-=40/A.renderer.cam.zoom; A.renderer.onChange(); A.renderer.kick(); break;
        case 'ArrowRight': A.renderer.cam.x+=40/A.renderer.cam.zoom; A.renderer.onChange(); A.renderer.kick(); break;
      }
    });
  }

  Object.assign(A, {
    wirePWA, collectSettings, saveSettings, _lum, applySettings, wireSettings, startClock, wireMenus,
    wireLayoutMenu, resetAppearance, wireSettingsUI, wireToolbar, setRail, updateInsets, positionMinimap, expandMinimap,
    minimizeMinimap, togglePanel, wirePanels, wireCollapsibleSections, wireAppearance, wireNodeAppearance, wirePaste, wireFilters,
    refreshMetricRange, updateMetricLabel, wireViewControls, wireSearch, wireDnD, openModal, closeModal, wireModals,
    wireBrand, toggleShortcutsOverlay, wireKeyboard,
  });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', A.boot);
  else A.boot();
  window.CMApp={get graph(){return A.graph;}, apply:A.apply, focusNode:A.focusNode, loadDemo:A.loadDemo, toggleImpact:A.toggleImpact,
    copyViewLink:A.copyViewLink, serializeView:A.serializeView,
    impactState:()=>A.impactOn,
    loadFiles:(files,meta)=>A.ingest(()=>Promise.resolve({files,meta}),'test'),
    loadFromJSON:A.loadFromJSON,
    hasMap:()=>A.state.counts.nodes>0,
    mapName:()=>(A.graph&&A.graph.meta&&(A.graph.meta.name||A.graph.meta.source))||'mapa',
    mapJSON:()=>(A.graph&&A.state.counts.nodes>0)?A.graph.toJSON():null,
    appState:A.appState, exec:A.exec,     // ← ChatBot uses these
    renderer:()=>A.renderer};
})();
