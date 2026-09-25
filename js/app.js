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

  function updateRotDial(){
    // needle always points toward the centre of the schema on screen
    const c=A.renderer.centroidScreen();
    let head;
    if(c){ const dx=c.x-A.renderer.w/2, dy=c.y-A.renderer.h/2;
      head = (Math.abs(dx)<0.5&&Math.abs(dy)<0.5) ? -A.renderer.cam.rot*180/Math.PI : Math.atan2(dx,-dy)*180/Math.PI; }
    else head=0;
    $('#rot-needle').style.transform=`rotate(${head}deg)`;
    let deg=Math.round(A.renderer.cam.rot*180/Math.PI)%360; if(deg<0)deg+=360;
    $('#rot-label').textContent=deg+'°';
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

  // ---------------- context menu ----------------
  function contextMenu(node, x, y){
    const items=[];
    if(node){
      items.push({ic:'crosshair',label:I.t('ca.ctxCenter','Wyśrodkuj widok'),action:()=>A.focusNode(node.id)});
      items.push({ic:'eye',label:I.t('ca.ctxHighlightNeighbors','Podświetl sąsiadów'),action:()=>{ A.select(node); }});
      items.push({ic:'search',label:I.t('ca.ctxIsolate','Izoluj: pokaż tylko powiązane'),action:()=>isolateNode(node)});
      if(node.type==='folder'&&node.children&&node.children.length){
        items.push({sep:true});
        items.push({ic:node.collapsed?'expand':'collapse',label:node.collapsed?I.t('ca.ctxExpandFolder','Rozwiń folder'):I.t('ca.ctxCollapseFolder','Zwiń folder'),action:()=>A.toggleCollapse(node)});
        items.push({ic:'expand',label:I.t('ca.ctxExpandBelow','Rozwiń wszystko poniżej'),action:()=>{ expandBelow(node); A.apply({}); }});
        items.push({ic:'collapse',label:I.t('ca.ctxCollapseBelow','Zwiń wszystko poniżej'),action:()=>{ collapseBelow(node); A.apply({}); }});
      }
      items.push({sep:true});
      if(A.nodeRepoUrl(node)) items.push({ic:'globe',label:I.t('ca.openOnHost','Otwórz na ')+A.repoHostName(),action:()=>handlers.openRepoUrl(node)});
      if(node.path) items.push({ic:'copy',label:I.t('ca.ctxCopyPath','Kopiuj ścieżkę'),action:()=>{ navigator.clipboard?.writeText(node.path); U.toast(I.t('ca.copiedPath','Skopiowano ścieżkę.')); }});
      if(node.name) items.push({ic:'file',label:I.t('ca.ctxCopyName','Kopiuj nazwę pliku'),action:()=>{ navigator.clipboard?.writeText(node.name); U.toast(I.t('ca.copiedName','Skopiowano nazwę.')); }});
      items.push({ic:'pin',label:node.pinned?I.t('ca.ctxUnpin','Odepnij pozycję'):I.t('ca.ctxPin','Przypnij pozycję'),action:()=>{ node.pinned=!node.pinned; node.fixed=node.pinned||node.locked; }});
      items.push({ic:'box',label:node.locked?I.t('ca.ctxUnlock','Odblokuj figurę'):I.t('ca.ctxLock','Zablokuj figurę (bez ruchu)'),action:()=>{ node.locked=!node.locked; node.fixed=node.locked||node.pinned; A.renderer.kick(); }});
      if(node.type==='file'){
        const out=(node.importsOut||[]).length, inc=(node.importsIn||[]).length;
        if(out+inc>0){
          items.push({sep:true});
          items.push({ic:'arrowRight',label:I.t('ca.ctxDepsOut','Pokaż zależności wychodzące (')+out+')',action:()=>{ A.select(node); A.renderer.setHighlight(new Set([node.id,...(node.importsOut||[])])); }});
          items.push({ic:'arrowLeft',label:I.t('ca.ctxDepsIn','Pokaż zależności przychodzące (')+inc+')',action:()=>{ A.select(node); A.renderer.setHighlight(new Set([node.id,...(node.importsIn||[])])); }});
        }
      }
      items.push({sep:true});
      items.push({ic:'eye',label:I.t('ca.ctxShowAll','Pokaż wszystko'),action:()=>{ A.renderer.setHighlight(null); A.select(null); }});
    } else {
      items.push({ic:'fit',label:I.t('ca.ctxFit','Dopasuj widok (F)'),action:()=>A.renderer.fit()});
      items.push({ic:'target',label:I.t('ca.ctxResetRot','Resetuj obrót (R)'),action:()=>A.renderer.resetRotation()});
      items.push({ic:'crosshair',label:I.t('ca.ctxGraphCenter','Centrum grafu'),action:()=>{ A.renderer.cam.x=0; A.renderer.cam.y=0; A.renderer.onChange(); A.renderer.kick(); }});
      items.push({sep:true});
      items.push({ic:'expand',label:I.t('ca.ctxExpandAll','Rozwiń wszystko'),action:()=>{ A.graph.expandAll(); A.apply({}); }});
      items.push({ic:'collapse',label:I.t('ca.ctxCollapseL2','Zwiń do poziomu 2'),action:()=>{ A.graph.collapseAll(2); A.apply({}); }});
      items.push({ic:'collapse',label:I.t('ca.ctxCollapseL1','Zwiń do poziomu 1'),action:()=>{ A.graph.collapseAll(1); A.apply({}); }});
      items.push({sep:true});
      items.push({ic:'grid',label:I.t('ca.ctxToggleGrid','Przełącz siatkę tła'),action:()=>{ A.renderer.opts.showGrid=!A.renderer.opts.showGrid; $('#opt-grid').checked=A.renderer.opts.showGrid; A.renderer.kick(); }});
      items.push({ic:'cube',label:I.t('ca.ctxToggle3d','Przełącz perspektywę 3D'),action:()=>A.renderer.setTilt(A.renderer.cam.tilt>0.05?0:0.62)});
      items.push({sep:true});
      items.push({ic:'bookmark',label:I.t('ca.ctxSnapshot','Zapisz migawkę'),action:()=>$('#btn-snapshot').click()});
      items.push({ic:'save',label:I.t('ca.ctxSaveMap','Zapisz mapę do pliku'),action:()=>$('#btn-save').click()});
      if(A.renderer.diffMode) items.push({ic:'x',label:I.t('ca.ctxDisableDiff','Wyłącz tryb różnic'),action:()=>{ A.renderer.diffMode=false; for(const n of A.graph.nodes.values())delete n.diff; A.apply({}); }});
      items.push({sep:true});
      items.push({ic:'settings',label:CM.i18n.t('ctx.settings'),action:()=>CM.Settings.open()});
    }
    UI.ctxMenu(items, x, y);
  }
  function expandBelow(folder){ const walk=(f)=>{ if(f.type==='folder'){f.collapsed=false; for(const c of (f.children||[]))walk(A.graph.nodes.get(c)); } }; walk(folder); }
  function collapseBelow(folder){ const walk=(f)=>{ if(f.type==='folder'){ for(const c of (f.children||[])){ const ch=A.graph.nodes.get(c); if(ch&&ch.type==='folder'){ch.collapsed=true; walk(ch);} } } }; walk(folder); }
  function isolateNode(node){ if(!node)return; const {out,inc}=A.graph.neighbors(node.id); A.renderer.setHighlight(new Set([node.id,...out,...inc])); }
  async function exportImage(kind, scale){
    const base=((A.graph.meta&&A.graph.meta.name)||'codemap').replace(/[^\w.\-]+/g,'_')||'codemap';
    try{
      if(kind==='svg'){
        const svg=A.renderer.exportSVG();
        if(!svg){ U.toast(I.t('ca.noMapToExport','Brak mapy do eksportu.'),'error'); return; }
        U.download(base+'.svg', svg, 'image/svg+xml');
        U.toast(I.t('ca.exportedSvg','⬡ Mapa wyeksportowana jako SVG.'),'success');
      } else {
        U.toast(I.t('ca.renderingImage','Renderowanie obrazu…'),'',1500);
        const blob=await A.renderer.exportPNG({scale});
        if(!blob){ U.toast(I.t('ca.exportFailed','Eksport nie powiódł się.'),'error'); return; }
        const url=URL.createObjectURL(blob);
        const a=U.el('a',{href:url,download:base+'.png'});
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),4000);
        U.toast(I.t('ca.exportedPng','🖼️ Mapa wyeksportowana jako PNG.'),'success');
      }
    }catch(err){ U.toast(I.t('ca.exportFailedMsg','Eksport nie powiódł się: ')+err.message,'error'); }
  }
  document.addEventListener('click',()=>UI.hideCtx());
  document.addEventListener('scroll',()=>UI.hideCtx(),true);

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

  // ---------------- neighborhood (radar) overlay ----------------
  let hoodState={open:false, rot:0, tilt:0, zoom:1, ox:0, oy:0, sel:null};
  let hoodHits=[];   // {id,x,y,rad} screen-space for picking
  function wireNeighborhood(){
    const hood=$('#hood'), cv=$('#hood-canvas');
    $('#hood-close').onclick=closeHood;
    hood.addEventListener('click',(e)=>{ if(e.target===hood) closeHood(); });
    $('#hood-3d-chk').onchange=(e)=>{ hoodState.tilt=e.target.checked?0.5:0; drawHood(); };
    // zoom (reach distant / huge schemas)
    cv.addEventListener('wheel',(e)=>{ e.preventDefault(); const f=Math.exp(-e.deltaY*0.0016);
      const S=$('#hood-disc').clientWidth, mx=offsetXY(e,cv).x-S/2, my=offsetXY(e,cv).y-S/2;
      const z0=hoodState.zoom; hoodState.zoom=U.clamp(hoodState.zoom*f, 0.15, 60);
      const k=hoodState.zoom/z0; hoodState.ox=(hoodState.ox-mx)*k+mx; hoodState.oy=(hoodState.oy-my)*k+my; drawHood();
    },{passive:false});
    // drag: rotate; click: select; dblclick: teleport
    let down=false, lx=0, ly=0, movedH=false;
    cv.addEventListener('mousedown',(e)=>{down=true;lx=e.clientX;ly=e.clientY;movedH=false;});
    window.addEventListener('mousemove',(e)=>{ if(!down||!hoodState.open)return; if(Math.abs(e.clientX-lx)+Math.abs(e.clientY-ly)>3)movedH=true;
      hoodState.rot+=(e.clientX-lx)*0.008; lx=e.clientX; ly=e.clientY; drawHood(); });
    window.addEventListener('mouseup',()=>down=false);
    cv.addEventListener('click',(e)=>{ if(movedH)return; const p=offsetXY(e,cv); const id=hoodPick(p.x,p.y);
      hoodState.sel=id; updateTeleport(); drawHood(); });
    cv.addEventListener('dblclick',(e)=>{ const p=offsetXY(e,cv); const id=hoodPick(p.x,p.y); if(id) teleportTo(id); });
    // hover -> info tooltip about the module
    cv.addEventListener('mousemove',(e)=>{ if(down) return; const p=offsetXY(e,cv); const id=hoodPick(p.x,p.y);
      const n=id?A.graph.nodes.get(id):null; UI.tooltip(n||null, e.clientX, e.clientY); cv.style.cursor=n?'pointer':'grab'; });
    cv.addEventListener('mouseleave',()=>UI.tooltip(null));
    window.addEventListener('resize',()=>{ if(hoodState.open) drawHood(); });
    $('#hood-teleport').onclick=()=>{ if(hoodState.sel) teleportTo(hoodState.sel); };
  }
  function offsetXY(e,cv){ const r=cv.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }
  function hoodPick(mx,my){ let best=null,bd=Infinity; for(const h of hoodHits){ const d=Math.hypot(mx-h.x,my-h.y); if(d<=h.rad+4 && d<bd){bd=d;best=h.id;} } return best; }
  function updateTeleport(){
    const t=$('#hood-teleport'); const n=hoodState.sel?A.graph.nodes.get(hoodState.sel):null;
    if(!n){ t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    t.querySelector('#hood-teleport-name').textContent = n.name + (n.type==='folder'?I.t('ca.folderSuffix','  (folder)'):'');
  }
  function teleportTo(id){ closeHood(); setTimeout(()=>A.focusNode(id), 180); }
  function openHood(){ const hood=$('#hood'); hood.classList.remove('hidden'); hoodState.open=true;
    hoodState.zoom=1; hoodState.ox=0; hoodState.oy=0; hoodState.sel=null; updateTeleport();
    requestAnimationFrame(()=>{ $('#hood-disc').classList.add('show'); setTimeout(drawHood,30); }); }
  function closeHood(){ $('#hood-disc').classList.remove('show'); hoodState.open=false; setTimeout(()=>$('#hood').classList.add('hidden'),240); }
  function drawHood(){
    const cv=$('#hood-canvas'); const disc=$('#hood-disc');
    const S=Math.min(disc.clientWidth, disc.clientHeight); if(!S) return;   // clientWidth ignores the open-transform
    const dpr=window.devicePixelRatio||1;
    cv.width=S*dpr; cv.height=S*dpr; cv.style.width=S+'px'; cv.style.height=S+'px';
    const ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,S,S);
    const nodes=state.vis.nodes, edges=state.vis.edges; hoodHits=[]; if(!nodes.length) return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const n of nodes){ minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x);maxY=Math.max(maxY,n.y); }
    const bw=Math.max(1,maxX-minX), bh=Math.max(1,maxY-minY);
    const pad=46, cx=S/2+hoodState.ox, cy=S/2+hoodState.oy;
    const baseSc=Math.min((S-pad*2)/bw,(S-pad*2)/bh)*hoodState.zoom;
    const wx=(minX+maxX)/2, wy=(minY+maxY)/2;
    const cos=Math.cos(hoodState.rot), sin=Math.sin(hoodState.rot), sy=1-hoodState.tilt;
    const proj=(x,y)=>{ let dx=(x-wx)*baseSc, dy=(y-wy)*baseSc; const rx=dx*cos-dy*sin, ry=(dx*sin+dy*cos)*sy; return {x:cx+rx, y:cy+ry}; };
    const byId=new Map(nodes.map(n=>[n.id,n]));
    ctx.lineWidth=0.6;
    for(const e of edges){ if(e.type==='contains')continue; const s=byId.get(e.source),t=byId.get(e.target); if(!s||!t)continue;
      const a=proj(s.x,s.y), b=proj(t.x,t.y);
      const col=s.type==='folder'?'#22d3ee':s.type==='external'?'#a78bfa':((s.langInfo&&s.langInfo.color)||'#7d8aa0');
      ctx.strokeStyle=U.rgba(col,0.22); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
    const labels=[];
    for(const n of nodes){ const p=proj(n.x,n.y);
      const col=n.type==='folder'?'#22d3ee':n.type==='external'?'#a78bfa':((n.langInfo&&n.langInfo.color)||'#7d8aa0');
      const rad=Math.max(1.6,(n.r||6)*baseSc*0.7);
      // same 3D crystal figure as the main map
      A.renderer.drawNodeSprite(ctx, p.x, p.y, rad, col, hoodState.tilt);
      if(hoodState.sel===n.id){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(p.x,p.y,rad+4,0,7); ctx.stroke(); ctx.lineWidth=0.6; }
      hoodHits.push({id:n.id, x:p.x, y:p.y, rad});
      // collect minimal module markings (folders + sizeable nodes)
      if((n.type==='folder' && rad>=4) || rad>=9) labels.push({x:p.x, y:p.y-rad-2, t:n.name, col});
    }
    // minimal module labels (cap to keep it clean) — readable backdrop + bright text
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    labels.slice(0,60).forEach(l=>{
      ctx.font='600 11px Inter, sans-serif'; let t=l.t.length>18?l.t.slice(0,17)+'…':l.t;
      const w=ctx.measureText(t).width;
      ctx.fillStyle='rgba(4,7,12,0.82)'; ctx.fillRect(l.x-w/2-4, l.y-13, w+8, 15);
      ctx.fillStyle=U.rgba(l.col,0.9); ctx.fillRect(l.x-w/2-4, l.y-13, 2.5, 15);
      ctx.fillStyle='#eef3fa'; ctx.fillText(t, l.x, l.y);
    });
    ctx.textBaseline='alphabetic';
    if(state.groups.length){
      ctx.textAlign='center'; ctx.font='700 12px Inter, sans-serif';
      for(const grp of state.groups){ let gx=0,gmy=Infinity,c=0;
        for(const n of nodes){ if(n.gid!==grp.gid)continue; const p=proj(n.x,n.y); gx+=p.x; gmy=Math.min(gmy,p.y); c++; }
        if(!c)continue; ctx.fillStyle=U.rgba(grp.color,0.98); ctx.fillText(grp.name, gx/c, gmy-16); }
    }
  }

  // ---------------- minimap ----------------
  function wireMinimap(){
    const mm=$('#minimap');
    const go=(e)=>{ const m=A.renderer._mm; if(!m)return; const r=mm.getBoundingClientRect();
      const wx=((e.clientX-r.left)-m.ox)/m.sc, wy=((e.clientY-r.top)-m.oy)/m.sc;
      A.renderer.cam.x=wx; A.renderer.cam.y=wy; A.renderer.onChange(); A.renderer.kick(); };
    let down=false;
    mm.addEventListener('mousedown',(e)=>{down=true;go(e);});
    window.addEventListener('mousemove',(e)=>{if(down)go(e);});
    window.addEventListener('mouseup',()=>down=false);
    // collapse / expand minimap
    const wrap=$('#minimap-wrap'), tgl=$('#minimap-toggle');
    if(tgl) tgl.onclick=(e)=>{ e.stopPropagation(); wrap.classList.toggle('mm-collapsed');
      if(!wrap.classList.contains('mm-collapsed')) A.renderer.drawMinimap($('#minimap'));
      A.positionMinimap(); setTimeout(A.positionMinimap, 240); };   // re-centre for the new size (now + after transition)
    window.addEventListener('resize', A.positionMinimap);
    // the welcome card's height settles after async content (fonts, "restore last map" button) — observe
    // it so the minimap re-centres whenever the card's box changes, not just on the first frame.
    const card=$('.empty-card');
    if(card && window.ResizeObserver){ try{ new ResizeObserver(()=>A.positionMinimap()).observe(card); }catch(e){} }
    // start minimized (no project yet) and wait for a file structure; expand only once one loads
    if(state.counts.nodes===0) wrap.classList.add('mm-collapsed');
    A.positionMinimap(); setTimeout(A.positionMinimap,150); setTimeout(A.positionMinimap,650);
    if(document.fonts&&document.fonts.ready) document.fonts.ready.then(A.positionMinimap).catch(()=>{});
  }

  // ---------------- rotation dial ----------------
  function wireRotDial(){
    const dial=$('#rot-dial'), reopen=$('#rot-reopen'), grip=$('#rot-grip'), pin=$('#rot-pin');
    const place=(left,top)=>{ dial.style.left=left+'px'; dial.style.top=top+'px'; dial.style.right='auto'; dial.style.bottom='auto'; dial.style.transform='none'; };
    const center=()=>{ const r=dial.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; };

    // ---- DIAL FACE: rotate the camera (works pinned OR loose) ----
    let rot=false, startA=0, startRot=0;
    const ptrAngle=(e)=>{ const c=center(); return Math.atan2(e.clientY-c.y, e.clientX-c.x); };
    dial.addEventListener('mousedown',(e)=>{
      if(e.target.closest('#rot-grip')||e.target.closest('#rot-pin')||e.target.closest('#rot-min')) return;
      rot=true; startA=ptrAngle(e); startRot=A.renderer.cam.rot; dial.classList.add('rotating'); e.preventDefault();
    });

    // ---- GRIP: move the compass anywhere (disabled while pinned) ----
    let mov=false, offX=0, offY=0;
    grip.addEventListener('mousedown',(e)=>{
      if(dial.classList.contains('pinned')) return;
      const r=dial.getBoundingClientRect(); offX=e.clientX-r.left; offY=e.clientY-r.top;
      mov=true; dial.classList.add('dragging'); e.preventDefault(); e.stopPropagation();
    });

    window.addEventListener('mousemove',(e)=>{
      if(rot){ let d=ptrAngle(e)-startA; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI; A.renderer.setRotation(startRot + d*0.5); }
      else if(mov){ const w=dial.offsetWidth, h=dial.offsetHeight;
        place(U.clamp(e.clientX-offX,2,innerWidth-w-2), U.clamp(e.clientY-offY,2,innerHeight-h-2)); }
    });
    window.addEventListener('mouseup',()=>{ rot=false; mov=false; dial.classList.remove('rotating','dragging'); });

    // double click face -> neighborhood map
    let clicks=0, ctmr=null;
    dial.addEventListener('click',(e)=>{
      if(e.target.closest('#rot-grip')||e.target.closest('#rot-pin')||e.target.closest('#rot-min')) return;
      clicks++; clearTimeout(ctmr);
      if(clicks>=2){ clicks=0; openHood(); return; }
      ctmr=setTimeout(()=>{ clicks=0; }, 320);
    });

    // ---- PIN: lock / unlock position anywhere on the board ----
    pin.onclick=(e)=>{ e.stopPropagation(); const p=dial.classList.toggle('pinned');
      U.toast(p?I.t('ca.compassPinned','📌 Kompas przypięty.'):I.t('ca.compassUnpinned','Kompas odpięty — chwyć uchwyt, aby przesunąć.'),'',1600); };

    // ---- MINIMIZE: hide; reopen puck sits at the ORIGINAL spot ----
    $('#rot-min').onclick=(e)=>{ e.stopPropagation(); dial.classList.add('hidden'); reopen.classList.remove('hidden'); };
    reopen.onclick=()=>{ reopen.classList.add('hidden');
      // restore to the original default position (bottom-centre)
      dial.style.left=''; dial.style.top=''; dial.style.right=''; dial.style.bottom=''; dial.style.transform='';
      dial.classList.add('pinned'); dial.classList.remove('hidden'); };
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

  // ---------------- game-style navigation: WASD fly + mouse-look (FPS turning) ----------------
  function wireGameNav(){
    const cv = A.renderer.canvas;
    const held = new Set();          // currently-pressed movement keys
    let flyMode=false, raf=0, lastT=0, btnDown=false;
    const MOVE_SPEED=860;            // pan speed, screen px / second
    const ZOOM_RATE=2.7;             // zoom multiplier / second (Space in, Shift out)
    const LOOK_X=0.0026, LOOK_Y=0.0021;   // mouse-look sensitivity (turn / tilt)
    const MOVE_KEYS={ w:1, a:1, s:1, d:1, ' ':1, shift:1 };
    const keyName=(e)=> e.key===' ' ? ' ' : (e.key==='Shift'?'shift':e.key.toLowerCase());

    // navigation is for CodeMap only, and never while typing / in a dialog / on the empty screen
    function navAllowed(){
      const ae=document.activeElement;
      if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT'||ae.isContentEditable)) return false;
      if(CM.MindMap && CM.MindMap.isActive && CM.MindMap.isActive()) return false;
      const so=document.getElementById('settings-overlay'); if(so && !so.classList.contains('hidden')) return false;
      const es=document.getElementById('empty-state'); if(es && es.offsetParent!==null) return false;
      return true;
    }

    function step(){
      raf=0;
      if(!navAllowed()){ held.clear(); return; }   // context changed (input focus / mode switch) → stop
      const now=performance.now(); let dt=(now-lastT)/1000; lastT=now;
      if(dt>0.05) dt=0.05;                       // clamp big gaps (tab switch / GC)
      const cam=A.renderer.cam, W=A.renderer.w, H=A.renderer.h; let moved=false;
      // planar movement — computed in SCREEN space then mapped to world, so it follows the current rotation
      let mx=(held.has('d')?1:0)-(held.has('a')?1:0);
      let my=(held.has('s')?1:0)-(held.has('w')?1:0);
      if((mx||my) && W>0){
        const len=Math.hypot(mx,my)||1; mx/=len; my/=len; const sp=MOVE_SPEED*dt, cx=W/2, cy=H/2;
        const a=cam.toWorld(cx,cy,W,H), b=cam.toWorld(cx+mx*sp, cy+my*sp, W,H);
        cam.x+=(b.x-a.x); cam.y+=(b.y-a.y); moved=true;
      }
      // vertical axis = zoom (Space = in/closer, Shift = out). Shift-zoom is suppressed while a mouse
      // button is down so it never fights Shift+drag-rotate / Shift+click.
      const zdir=(held.has(' ')?1:0)-((held.has('shift')&&!btnDown)?1:0);
      if(zdir){ cam.zoom=U.clamp(cam.zoom*Math.pow(ZOOM_RATE, zdir*dt), 0.0008, 40); moved=true; }
      if(moved){ A.renderer.onChange(); A.renderer.kick(); }
      if(held.size) raf=requestAnimationFrame(step);
    }
    function ensureLoop(){ if(!raf){ lastT=performance.now(); raf=requestAnimationFrame(step); } }

    window.addEventListener('keydown',(e)=>{
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      const k=keyName(e); if(!(k in MOVE_KEYS)) return;
      if(!navAllowed()){ held.clear(); return; }
      if(k===' ') e.preventDefault();            // stop Space from scrolling the page
      held.add(k); ensureLoop();
    });
    window.addEventListener('keyup',(e)=>{ held.delete(keyName(e)); });
    window.addEventListener('blur',()=>{ held.clear(); });
    cv.addEventListener('mousedown',()=>{ btnDown=true; });
    window.addEventListener('mouseup',()=>{ btnDown=false; });

    // ---- fly mode: FPS-style mouse-look via Pointer Lock (continuous turning, no scroll wheel) ----
    function onLookMove(e){ if(!flyMode) return;
      if(e.movementX) A.renderer.cam.rot += e.movementX*LOOK_X;
      if(e.movementY) A.renderer.cam.tilt = U.clamp(A.renderer.cam.tilt + e.movementY*LOOK_Y, 0, 0.85);
      A.renderer.onChange(); A.renderer.kick();
    }
    function setFly(on){
      if(on && !navAllowed()) return;
      flyMode=on;
      const btn=$('#vc-fly'); if(btn) btn.classList.toggle('active', on);
      const hud=$('#fly-hud'); if(hud) hud.classList.toggle('hidden', !on);
      cv.classList.toggle('fly-active', on);
      if(on){ document.addEventListener('mousemove', onLookMove);
        if(cv.requestPointerLock){ try{ cv.requestPointerLock(); }catch(e){} }
        U.toast && U.toast(I.t('ca.flyOn','Tryb nawigacji: WASD ruch · mysz obrót · Spacja/Shift zoom · Esc/G wyjście'),'',2600);
      } else { document.removeEventListener('mousemove', onLookMove); held.clear();
        if(document.pointerLockElement===cv && document.exitPointerLock){ try{ document.exitPointerLock(); }catch(e){} } }
    }
    function toggleFly(){ setFly(!flyMode); }
    document.addEventListener('pointerlockchange',()=>{ if(document.pointerLockElement!==cv && flyMode) setFly(false); });
    const fb=$('#vc-fly'); if(fb) fb.onclick=toggleFly;
    window.addEventListener('keydown',(e)=>{
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      if((e.key==='g'||e.key==='G') && (flyMode||navAllowed())){ e.preventDefault(); toggleFly(); }
      else if(e.key==='Escape' && flyMode){ setFly(false); }
    });

    // localized HUD hint (rebuilt on language change)
    function refreshHud(){ const h=$('#fly-hint'); if(h) h.innerHTML=
      '<b>WASD</b> '+I.t('ca.flyMove','ruch')+' · <b>'+I.t('ca.flyMouse','mysz')+'</b> '+I.t('ca.flyTurn','obrót/pochylenie')+
      ' · <b>'+I.t('ca.flySpace','Spacja')+'/Shift</b> '+I.t('ca.flyZoom','zoom')+' · <b>Esc/G</b> '+I.t('ca.flyExit','wyjście'); }
    I.onChange(refreshHud); refreshHud();
  }

  Object.assign(A, {
    wirePWA, collectSettings, saveSettings, _lum, applySettings, wireSettings, startClock, wireMenus,
    wireLayoutMenu, resetAppearance, wireSettingsUI, wireToolbar, setRail, updateInsets, positionMinimap, expandMinimap,
    minimizeMinimap, togglePanel, wirePanels, wireCollapsibleSections, wireAppearance, wireNodeAppearance, wirePaste, wireFilters,
    refreshMetricRange, updateMetricLabel, wireViewControls, wireSearch, wireDnD, openModal, closeModal, wireModals,
    wireBrand, toggleShortcutsOverlay, wireKeyboard, updateRotDial, contextMenu, expandBelow, collapseBelow, isolateNode,
    exportImage, wireNeighborhood, offsetXY, hoodPick, updateTeleport, teleportTo, openHood, closeHood,
    drawHood, wireMinimap, wireRotDial, wireGameNav,
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
