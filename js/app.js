/* ===================== app.js — application bootstrap & wiring ===================== */
(function(){
  const U=CM.util, $=U.$, el=U.el, I=CM.i18n;
  const Graph=CM.Graph.Graph, Layouts=CM.Layouts, Loaders=CM.Loaders, Storage=CM.Storage, UI=CM.UI;

  let graph=new Graph();
  let renderer;
  const state={
    layout:'pack',
    vis:{nodes:[],edges:[]},
    sim:null,
    counts:{nodes:0,edges:0},
    lastDiff:null,
    spacing:3,
    displayLayout:'pack',
    groups:[],           // loaded comparison schemas {gid,name,color}
    gidSeq:0,
    cyclesOn:false,
  };
  const filters={folders:true, files:true, externals:false, contains:true, import:true, reference:false, langsOff:new Set(), metric:'lines', minMetric:0};

  // ---------------- init ----------------
  function init(){
    CM.icons.hydrate();
    CM.i18n.apply();        // translate static UI to the persisted language (PL / EN)
    renderer=new CM.Renderer.Renderer($('#map-canvas'));
    renderer.onSelect = (n)=>select(n);
    renderer.onHover  = (n,e)=>{ onHover(n,e); };
    renderer.onToggleCollapse = (n)=>toggleCollapse(n);
    renderer.onDblFile = (n)=>{ select(n); renderer.centerOn(n); };
    renderer.onContext = (n,x,y)=>contextMenu(n,x,y);
    renderer.onEdgeSelect = (edge)=>selectEdge(edge);
    renderer.onChange = U.throttle(()=>{ updateStatus(); updateRotDial(); renderer.drawMinimap($('#minimap')); positionAuthors(); updateHash(); }, 55);
    renderer.onSettle = ()=>{
      // a pending view-restore (shared link) wins over fit-on-settle — otherwise the layout's own
      // settle would refit and discard the camera the link asked to restore
      if(state._pendingViewRestore){ const fn=state._pendingViewRestore; state._pendingViewRestore=null; state._fitOnSettle=false; fn(); saveSessionDebounced(); return; }
      if(state._fitOnSettle){ state._fitOnSettle=false; renderer.fit(); saveSessionDebounced(); } };

    wireToolbar(); wireMenus(); wireFilters(); wireViewControls(); wireSearch(); wireDnD();
    wireModals(); wireKeyboard(); wireGameNav(); wireMinimap(); wireRotDial();
    wirePanels(); wireAppearance(); wirePaste(); wireNodeAppearance();
    wireBrand(); wireCompare(); wireNeighborhood();
    wireModes(); startClock();
    wireLayoutMenu();      // custom layout dropdown (styled like the Wczytaj menu)
    wireCollapsibleSections(); // collapsible sections in the left panel
    wireSettingsUI();      // gear button + settings overlay handlers
    wireSettings();        // restore persisted appearance/filters; persist on change
    restoreSessionPrompt();// offer to reopen the last auto-saved map
    buildPalette();        // Ctrl/Cmd+K command palette
    wirePWA();             // service worker + installability
    // re-translate dynamic chrome whenever the language changes
    CM.i18n.onChange(()=>{ updateStatus(); refreshProjectLabel();
      if(graph && graph.nodes && graph.nodes.size){
        UI.renderDetails(renderer.selected||null, graph, handlers);
        UI.renderLangFilters(graph, {langsOff:filters.langsOff}, handlers);
      }
    });
    updateStatus(); refreshProjectLabel();
  }

  // ---------------- hover: quick tooltip + delayed code preview ----------------
  let _hoverTimer=null;
  function onHover(n, e){
    if(_hoverTimer){ clearTimeout(_hoverTimer); _hoverTimer=null; }
    UI.filePreview(null);                       // drop any open code card
    const px=e?e.clientX:0, py=e?e.clientY:0;
    UI.tooltip(n, px, py);
    $('#st-hover').textContent = n ? (n.path||n.name) : '';
    const cb=$('#opt-hover-preview');
    if(n && n.type==='file' && n.preview && (!cb || cb.checked)){
      _hoverTimer=setTimeout(()=>{
        _hoverTimer=null;
        if(renderer.hovered && renderer.hovered.id===n.id){ UI.tooltip(null); UI.filePreview(n, px, py); }
      }, 430);
    }
  }

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

  // ---------------- command palette (Ctrl/Cmd+K) ----------------
  function paletteCommands(){
    const R=renderer; const c=(label,ic,run,hint)=>({label,ic,run,hint:hint||''});
    const btn=(id)=>{ const b=$('#'+id); if(b) b.click(); };
    const list=[
      c(I.t('ca.cmdLoadFolder','Wczytaj: folder z urządzenia'),'folder',()=>btn('btn-load-folder')),
      c(I.t('ca.cmdLoadFiles','Wczytaj: pojedyncze pliki'),'file',()=>btn('btn-load-files')),
      c(I.t('ca.cmdLoadGithub','Wczytaj: repozytorium GitHub / URL'),'globe',()=>btn('btn-load-github')),
      c(I.t('ca.cmdDemo','Zobacz demo'),'sparkle',()=>loadDemo()),
      c(I.t('ca.cmdFit','Dopasuj widok do zawartości'),'fit',()=>R.fit(),'F'),
      c(I.t('ca.cmdZoomIn','Przybliż'),'plus',()=>R.zoomBy(1.3),'+'),
      c(I.t('ca.cmdZoomOut','Oddal'),'minus',()=>R.zoomBy(1/1.3),'−'),
      c(I.t('ca.cmd3d','Przełącz perspektywę 3D'),'cube',()=>R.setTilt(R.cam.tilt>0.05?0:0.62),'T'),
      c(I.t('ca.cmdResetRot','Wyzeruj obrót'),'target',()=>R.resetRotation(),'R'),
      c(I.t('ca.cmdCycles','Wykryj cykle zależności'),'flow',()=>btn('btn-cycles')),
      c(I.t('ca.cmdHotspots','Hotspoty — pliki o największym wpływie'),'target',()=>btn('btn-hotspots')),
      c(I.t('ca.cmdSnapshot','Zapisz migawkę'),'bookmark',()=>btn('btn-snapshot')),
      c(I.t('ca.cmdHistory','Historia i porównania'),'clock',()=>btn('btn-history')),
      c(I.t('ca.cmdSave','Zapisz mapę (.json)'),'save',()=>btn('btn-save')),
      c(I.t('ca.cmdExportImg','Eksport obrazu (PNG / SVG)'),'image',()=>btn('btn-export-img')),
      c(I.t('ca.cmdOpen','Otwórz zapisaną mapę'),'open',()=>btn('btn-open')),
      c(I.t('ca.cmdCompareAdd','Porównaj: dodaj schemat na mapę'),'layers',()=>btn('btn-compare-add')),
      c(I.t('ca.cmdClear','Wyczyść dane'),'trash',()=>btn('btn-clear')),
      c(I.t('ca.cmdModeCodemap','Tryb: CodeMap (mapa kodu)'),'map',()=>setMode('codemap')),
      c(I.t('ca.cmdModeMindmap','Tryb: MindMap (mapy myśli)'),'layers',()=>setMode('mindmap')),
      c(I.t('ca.cmdThemeLight','Motyw: jasny'),'eye',()=>{ const b=document.querySelector('#theme-row .theme-btn[data-theme="light"]'); b&&b.click(); }),
      c(I.t('ca.cmdThemeDark','Motyw: ciemny'),'cube',()=>{ const b=document.querySelector('#theme-row .theme-btn[data-theme="dark"]'); b&&b.click(); }),
    ];
    const sel=$('#sel-layout'); if(sel) for(const o of sel.options) list.push(c(CM.i18n.t('layout.field')+': '+CM.i18n.t('layout.'+o.value, o.textContent),'grid',()=>{ sel.value=o.value; sel.dispatchEvent(new Event('change',{bubbles:true})); }));
    if(state._canInstall && state._canInstall()) list.unshift(c(I.t('ca.cmdInstall','Zainstaluj aplikację (PWA)'),'download',()=>state._installApp&&state._installApp()));
    return list;
  }
  function buildPalette(){
    const ov=el('div',{id:'cmd-palette',class:'hidden'});
    const box=el('div',{class:'cmd-box'});
    const inp=el('input',{id:'cmd-input',type:'text',placeholder:I.t('ca.cmdPlaceholder','Wpisz polecenie… (Ctrl+K)'),autocomplete:'off'});
    const listEl=el('div',{class:'cmd-list'});
    box.appendChild(inp); box.appendChild(listEl); ov.appendChild(box); $('#main').appendChild(ov);
    let cmds=[], filtered=[], sel=0;
    const render=()=>{ listEl.innerHTML=''; filtered.forEach((cm,i)=>{ const r=el('div',{class:'cmd-item'+(i===sel?' on':'')});
      r.onmousedown=(e)=>e.preventDefault(); r.onclick=()=>runCmd(cm); r.onmousemove=()=>{ if(sel!==i){ sel=i; render(); } };
      r.appendChild(el('span',{class:'cmd-ic',html:CM.icons.svg(cm.ic||'box',{size:15})}));
      r.appendChild(el('span',{class:'cmd-label',text:cm.label}));
      if(cm.hint) r.appendChild(el('span',{class:'cmd-hint',text:cm.hint}));
      listEl.appendChild(r); });
      const on=listEl.querySelector('.cmd-item.on'); if(on) on.scrollIntoView({block:'nearest'});
    };
    const filt=()=>{ const q=inp.value.trim().toLowerCase(); filtered=q?cmds.filter(cm=>cm.label.toLowerCase().includes(q)):cmds.slice(0,50); sel=0; render(); };
    const runCmd=(cm)=>{ close(); try{ cm.run(); }catch(e){ console.error(e); } };
    const open=()=>{ cmds=paletteCommands(); inp.value=''; filtered=cmds.slice(0,50); sel=0; render(); ov.classList.remove('hidden'); setTimeout(()=>inp.focus(),0); };
    const close=()=>ov.classList.add('hidden');
    inp.oninput=filt;
    inp.onkeydown=(e)=>{
      if(e.key==='ArrowDown'){ sel=Math.min(sel+1,filtered.length-1); render(); e.preventDefault(); }
      else if(e.key==='ArrowUp'){ sel=Math.max(sel-1,0); render(); e.preventDefault(); }
      else if(e.key==='Enter'){ if(filtered[sel]) runCmd(filtered[sel]); }
      else if(e.key==='Escape'){ close(); }
    };
    ov.addEventListener('mousedown',(e)=>{ if(e.target===ov) close(); });
    window.addEventListener('keydown',(e)=>{ if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){ e.preventDefault(); ov.classList.contains('hidden')?open():close(); } });
  }

  // ---------------- persistent settings (theme / appearance / filters) ----------------
  const SETTINGS_KEY='codemap_settings';
  // named, professionally-curated theme presets: theme + canvas bg + window tint + accent
  const THEME_PRESETS={
    depth:    {theme:'dark',  bg:'#070a10', menu:'10,18,34',    accent:'#22d3ee'},
    graphite: {theme:'dark',  bg:'#10131c', menu:'14,19,28',    accent:'#60a5fa'},
    ghdark:   {theme:'dark',  bg:'#0d1117', menu:'16,21,30',    accent:'#58a6ff'},
    forest:   {theme:'dark',  bg:'#05140f', menu:'12,22,20',    accent:'#34d399'},
    plum:     {theme:'dark',  bg:'#14101f', menu:'20,18,34',    accent:'#a78bfa'},
    paper:    {theme:'light', bg:'#f4f6fb', menu:'236,239,246', accent:'#2563eb'},
    parchment:{theme:'light', bg:'#fbf6e9', menu:'245,240,230', accent:'#b45309'},
    mist:     {theme:'light', bg:'#e7ecf3', menu:'224,231,242', accent:'#0f766e'},
  };
  let _applyThemePreset=null;   // bound in wireAppearance (needs renderer + root)
  const SETTINGS_INPUTS=['rng-trans','rng-menu','rng-blur','rng-tint','col-accent','col-bg',
    'rng-nscale','rng-spacing','rng-fscale','sel-layout','sel-metric',
    'show-folders','show-files','show-externals','edge-contains','edge-import','edge-reference',
    'opt-animate','opt-particles','opt-glow','opt-grid','opt-curved','opt-lockall','opt-hover-preview'];
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
    if(s._preset && _applyThemePreset && THEME_PRESETS[s._preset]){ _applyThemePreset(s._preset); }
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

  // ---------------- auto-saved session (reopen last map) ----------------
  const saveSessionDebounced=U.debounce(()=>{ if(graph && state.counts.nodes>0){ try{ Storage.saveSession(graph.toJSON()); }catch(e){} } }, 1500);
  function restoreSessionPrompt(){
    if(!Storage.loadSession) return;
    Storage.loadSession().then(s=>{
      if(!s || !s.map || !(s.map.nodes&&s.map.nodes.length)) return;
      const btn=$('#empty-restore'); if(!btn) return;
      btn.classList.remove('hidden');
      btn.title=I.t('ca.lastMap','Ostatnia mapa')+(s.ts?(' — '+U.relTime(s.ts)):'');
      btn.onclick=()=>{ try{ loadFromJSON(s.map); }catch(e){ U.toast(I.t('ca.restoreFail','Nie udało się przywrócić mapy.'),'error'); } };
    }).catch(()=>{});
  }

  // ---------------- work modes: CodeMap <-> MindMap ----------------
  let mode='codemap';
  function setMode(m){
    mode=m;
    document.querySelectorAll('#mode-switch .mode-btn').forEach(b=>b.classList.toggle('on', b.dataset.mode===m));
    document.body.classList.toggle('mode-mindmap', m==='mindmap');
    if(m==='mindmap'){
      CM.MindMap.activate();
      $('#empty-state').classList.add('hidden');
    } else {
      CM.MindMap.deactivate();
      if(state.counts.nodes===0) $('#empty-state').classList.remove('hidden');
      renderer.kick(); if(state.counts.nodes===0) minimizeMinimap(); else expandMinimap();
    }
  }
  function wireModes(){
    document.querySelectorAll('#mode-switch .mode-btn').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
    const pc=$('#pick-codemap'), pm=$('#pick-mindmap');
    if(pc) pc.onclick=()=>{ setMode('codemap'); };
    if(pm) pm.onclick=()=>setMode('mindmap');
  }
  // ---------------- GitHub repo author (floating avatar + top-bar badge) ----------------
  state._authors=[];
  function ghAvatarUrl(o){ return o.avatar || ('https://github.com/'+o.login+'.png?size=120'); }
  function refreshAuthors(){
    const cont=$('#gh-avatars'); if(!cont) return; cont.innerHTML=''; state._authors=[];
    const hasGroups=state.groups.length>0;
    // floating avatar (GitHub author) at each schema centre — picture + nick below
    const addAvatar=(gid,owner)=>{ if(!owner||!owner.login) return;
      const a=el('a',{class:'gh-avatar',href:owner.url||('https://github.com/'+owner.login),target:'_blank',rel:'noopener',title:I.t('ca.authorPrefix','Autor: ')+owner.login+I.t('ca.authorShowProfile',' — pokaż profil')});
      const img=el('img',{src:ghAvatarUrl(owner),alt:owner.login});
      img.onerror=()=>{ img.onerror=null; img.src='https://github.com/'+owner.login+'.png?size=120'; };
      a.appendChild(img); a.appendChild(el('span',{class:'gh-avatar-nick',text:owner.login}));
      a.onclick=(e)=>{ e.preventDefault(); openAuthorCard(owner); };
      cont.appendChild(a); state._authors.push({gid,el:a}); };
    if(hasGroups){ for(const g of state.groups) addAvatar(g.gid, g.owner); }
    else addAvatar('base', graph.meta && graph.meta.owner);
    // small NAME sticker above the centre (single schema; for compared schemas the draggable chip shows the name)
    if(!hasGroups && state.counts.nodes>0){
      const st=el('div',{class:'schema-sticker',text:graph.meta.name||I.t('ca.project','projekt')});
      cont.appendChild(st); state._authors.push({gid:'base', el:st, sticker:true});
    }
    // top-bar: ICON-ONLY mini avatars (one per loaded repo, fits 6+), full nick on hover
    const bar=$('#gh-authors'); bar.innerHTML='';
    const owners = hasGroups ? state.groups.map(g=>g.owner).filter(o=>o&&o.login)
                             : (graph.meta&&graph.meta.owner&&graph.meta.owner.login ? [graph.meta.owner] : []);
    for(const owner of owners){
      const a=el('a',{class:'gh-author-mini',href:owner.url||('https://github.com/'+owner.login),target:'_blank',rel:'noopener','data-nick':owner.login,title:owner.login});
      const img=el('img',{src:ghAvatarUrl(owner),alt:owner.login}); img.onerror=()=>{ img.onerror=null; img.src='https://github.com/'+owner.login+'.png?size=120'; };
      a.onclick=(e)=>{ e.preventDefault(); openAuthorCard(owner); };
      a.appendChild(img); bar.appendChild(a);
    }
    bar.classList.toggle('hidden', owners.length===0);
    positionAuthors();
  }
  function centroidOf(gid){
    let cx=0,cy=0,n=0;
    for(const nd of state.vis.nodes){ const isBase=!nd.gid||nd.gid==='base'; if(gid==='base'?!isBase:nd.gid!==gid) continue; cx+=nd.x; cy+=nd.y; n++; }
    if(!n) return null; return {x:cx/n,y:cy/n};
  }
  function positionAuthors(){
    if(!state._authors||!state._authors.length) return;
    const W=renderer.w, H=renderer.h;
    // avatars are tiny by default and scale with the camera: barely-there dots when zoomed far out,
    // a little bigger as you approach the centre. Never huge.
    const s=U.clamp(renderer.cam.zoom*0.85, 0.12, 1.2);
    for(const a of state._authors){
      const c=centroidOf(a.gid);
      if(!c){ a.el.style.display='none'; continue; }
      const sp=renderer.cam.toScreen(c.x,c.y,W,H);
      if(sp.x<-120||sp.x>W+120||sp.y<-120||sp.y>H+120){ a.el.style.display='none'; continue; }
      a.el.style.display=''; a.el.style.left=sp.x+'px'; a.el.style.top=(sp.y + (a.sticker?-58*s:0))+'px';
      a.el.style.setProperty('--av-scale', s.toFixed(3));
    }
  }

  // ---------------- author profile card (live GitHub mini-profile) ----------------
  state._ghUserCache={};
  function ensureAuthorCard(){
    let card=$('#author-card');
    if(card) return card;
    card=el('div',{id:'author-card',class:'hidden'});
    document.querySelector('#main').appendChild(card);
    return card;
  }
  function closeAuthorCard(){ const c=$('#author-card'); if(c) c.classList.add('hidden'); }
  function fmtJoined(iso){ try{ const d=new Date(iso); return d.toLocaleDateString('pl-PL',{year:'numeric',month:'long'}); }catch(e){ return ''; } }
  function renderAuthorCard(card, u, login, prof, hostLabel){
    prof = safeUrl(prof) || ('https://github.com/'+encodeURIComponent(login));
    const stat=(v,l)=>`<div class="ac-stat"><b>${U.fmtNum(v||0)}</b><span>${l}</span></div>`;
    const row=(ic,txt,href)=> txt? `<div class="ac-row">${CM.icons.svg(ic,{size:14})}<span>${href?`<a href="${escapeHtml(safeUrl(href))}" target="_blank" rel="noopener">${escapeHtml(txt)}</a>`:escapeHtml(txt)}</span></div>`:'';
    const avatar=safeUrl((u&&u.avatar_url)||(u&&u.avatar))||('https://github.com/'+encodeURIComponent(login)+'.png?size=200');
    const name=(u&&u.name)||login, bio=u&&u.bio;
    const blog=u&&u.blog?(/^https?:/.test(u.blog)?u.blog:'https://'+u.blog):'';
    const hasStats = u && (u.public_repos!=null||u.followers!=null||u.following!=null);
    card.innerHTML=`
      <button class="ac-close" title="${I.t('ca.acClose','Zamknij')}">${CM.icons.svg('x',{size:18})}</button>
      <div class="ac-hero">
        <img class="ac-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(login)}">
        <div class="ac-id">
          <div class="ac-name">${escapeHtml(name)}</div>
          <a class="ac-login" href="${escapeHtml(prof)}" target="_blank" rel="noopener">@${escapeHtml(login)}</a>
        </div>
      </div>
      ${bio?`<p class="ac-bio">${escapeHtml(bio)}</p>`:''}
      ${hasStats?`<div class="ac-stats">${stat(u.public_repos,I.t('ca.acRepos','repozytoria'))}${stat(u.followers,I.t('ca.acFollowers','obserwujący'))}${stat(u.following,I.t('ca.acFollowing','obserwuje'))}</div>`:''}
      <div class="ac-meta">
        ${row('package', u&&u.company, '')}
        ${row('map', u&&u.location, '')}
        ${row('globe', blog?blog.replace(/^https?:\/\//,''):'', blog)}
        ${u&&u.twitter_username?row('globe','@'+u.twitter_username,'https://twitter.com/'+u.twitter_username):''}
        ${u&&u.created_at?row('clock',I.t('ca.acJoined','Dołączył: ')+fmtJoined(u.created_at),''):''}
        ${u&&u.public_gists!=null?row('file', u.public_gists+I.t('ca.acGists',' gistów'),''):''}
      </div>
      ${u&&u.__err?`<p class="ac-err">${escapeHtml(u.__err)}</p>`:''}
      <a class="ac-open tb-btn primary" href="${escapeHtml(prof)}" target="_blank" rel="noopener">${CM.icons.svg('globe',{size:14})} ${I.t('ca.acOpenProfile','Otwórz pełny profil')}${hostLabel?(I.t('ca.acOnHost',' na ')+hostLabel):''}</a>`;
    card.querySelector('.ac-close').onclick=closeAuthorCard;
  }
  function escapeHtml(s){ return String(s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
  // only allow http(s) URLs into href/src (blocks javascript:/data: and any attribute-breakout)
  function safeUrl(u){ u=String(u||'').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  async function openAuthorCard(owner){
    if(!owner||!owner.login) return;
    const login=owner.login, host=owner.host||'github', card=ensureAuthorCard();
    const prof=owner.url||('https://github.com/'+encodeURIComponent(login));
    const hostLabel={github:'GitHub',gitlab:'GitLab',bitbucket:'Bitbucket'}[host]||'';
    card.classList.remove('hidden');
    // GitLab / Bitbucket: no public CORS user API here — show the basic card straight from repo meta
    if(host!=='github'){ renderAuthorCard(card, {avatar:owner.avatar, login}, login, prof, hostLabel); return; }
    renderAuthorCard(card, state._ghUserCache[login]||{avatar_url:owner.avatar, login, __loading:true}, login, prof, hostLabel);
    if(state._ghUserCache[login]){ return; }
    card.classList.add('ac-loading');
    try{
      const tok=($('#gh-token')&&$('#gh-token').value.trim())||'';
      const headers=tok?{Authorization:'token '+tok}:{};
      const res=await fetch('https://api.github.com/users/'+encodeURIComponent(login),{headers});
      if(!res.ok) throw new Error(res.status===403?I.t('ca.ghRateLimit','Limit zapytań GitHub API (dodaj token w oknie „Wczytaj…").'):'GitHub API: '+res.status);
      const u=await res.json(); state._ghUserCache[login]=u;
      card.classList.remove('ac-loading'); renderAuthorCard(card, u, login, prof, hostLabel);
    }catch(e){
      card.classList.remove('ac-loading');
      renderAuthorCard(card, {avatar_url:owner.avatar, login, __err:e.message}, login, prof, hostLabel);
    }
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
    if(_applyThemePreset) _applyThemePreset('depth');
  }
  function wireSettingsUI(){
    CM.Settings.wire({
      canInstall:()=>!!_installPrompt,
      installPWA:()=>{ if(state._installApp) state._installApp(); },
      aiHasProject:()=>state.counts.nodes>0,
      aiAnalyze:()=>aiAnalyze(),
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

  // edge clicked on the map -> show dependency details + direction
  function selectEdge(edge){
    select(null);
    const s=graph.nodes.get(edge.source), t=graph.nodes.get(edge.target);
    UI.renderEdgeDetails(edge, s, t, graph, handlers);
    if($('#right-panel').classList.contains('collapsed')) togglePanel('right');
  }

  const handlers={
    focus:(id)=>focusNode(id),
    toggleCollapse:(n)=>toggleCollapse(n),
    toggleLang:(k)=>toggleLang(k),
    biggest:(folder)=>biggestInFolder(folder),
    pick:(id)=>{ $('#search-input').value=''; focusNode(id); },
    compare:(a,b)=>doCompare(a,b),
    compareToCurrent:(s)=>doCompare(s, {label:I.t('ca.currentState','stan bieżący'), ts:Date.now(), signature:graph.signature()}),
    del:(id)=>Storage.deleteSnapshot(id).then(openHistory),
    openFile:(node)=>{ UI.renderFileView(node, graph, handlers); openModal('modal-fileview'); },
    repoUrl:(node)=>nodeRepoUrl(node),
    openRepoUrl:(node)=>{ const u=nodeRepoUrl(node); if(u) window.open(u,'_blank','noopener'); },
    repoHostName:()=>repoHostName(),
    openRepo:()=>{ const m=graph.meta; if(m&&m.html) window.open(m.html,'_blank','noopener'); },
    aiConfigured:()=>aiConfigured(),   // Ask-AI box appears only when at least one key is set
    aiAskNode:(node,q)=>aiAskNode(node,q),
  };

  // ---------------- GitHub / GitLab / Bitbucket deep links ----------------
  const HOST_NAMES={github:'GitHub', gitlab:'GitLab', bitbucket:'Bitbucket'};
  function repoHostName(){ const m=graph.meta; return (m&&HOST_NAMES[m.host])||''; }
  // exact web URL of a file/folder node in its source repository, at the loaded branch
  function nodeRepoUrl(node){
    const m=graph.meta;
    if(!node || !m || !m.html || !m.host) return null;
    if(node.type==='external') return null;
    if(node.gid && node.gid!=='base') return null;          // only the primary loaded repo (not compare schemas)
    const sub=m.sub ? m.sub.replace(/\/$/,'')+'/' : '';
    const full=(sub+(node.path||'')).replace(/^\/+/,'');
    const enc=full.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const br=encodeURIComponent(m.branch||m.repoInfo&&m.repoInfo.defaultBranch||'main');
    const isFile=node.type==='file';
    if(!enc) return m.html;                                  // root -> repo home
    if(m.host==='gitlab')    return `${m.html}/-/${isFile?'blob':'tree'}/${br}/${enc}`;
    if(m.host==='bitbucket') return `${m.html}/src/${br}/${enc}`;
    return `${m.html}/${isFile?'blob':'tree'}/${br}/${enc}`; // github
  }

  // ---------------- Web Worker force-sim (off main thread for large graphs) ----------------
  // Single source of truth for the version: the worker is fetched at the SAME ?v= as app.js itself
  // (read off our own <script> tag), so bumping index.html bumps the worker too — no drift.
  const SIM_WORKER_URL=(()=>{
    const s=document.currentScript || document.querySelector('script[src*="js/app.js"]');
    const v=s && s.src && (s.src.match(/[?&]v=([\w.-]+)/)||[])[1];
    return 'js/sim-worker.js'+(v?('?v='+v):'');
  })();
  let _workerOK = (typeof window.Worker==='function');
  // Offload physics to the Web Worker for anything beyond a trivially small map, so the main thread
  // is never blocked by the force simulation. Tiny graphs (< threshold) settle main-thread in a blink.
  function useWorker(n){ return _workerOK && n >= (window.__simWorkerMin||120); }
  // returns a sim-like proxy (running:false so the renderer never ticks it); the worker streams
  // positions which we write back into the live nodes, then refit on settle. reheat() = user took
  // over (drag) -> stop the worker and freeze current positions.
  function startWorkerSim(nodes, edges, simOpts){
    let worker;
    try{ worker=new Worker(SIM_WORKER_URL); }catch(e){ _workerOK=false; return null; }
    const N=nodes.length, idx=new Map(nodes.map((n,i)=>[n.id,i]));
    const initNodes=nodes.map(n=>({x:n.x||0, y:n.y||0, r:n.r||6, fixed:!!n.fixed}));
    const initEdges=[];
    for(const e of edges){ const s=idx.get(e.source), t=idx.get(e.target); if(s==null||t==null) continue;
      initEdges.push({s, t, c:e.type==='contains'?1:0, w:e.weight||1}); }
    let dead=false;
    const cleanup=()=>{ if(dead) return; dead=true; try{ worker.terminate(); }catch(e){} };
    const writeBack=(p)=>{ for(let i=0;i<N;i++){ nodes[i].x=p[i*2]; nodes[i].y=p[i*2+1]; } };
    worker.onmessage=(ev)=>{ const d=ev.data;
      if(d.type==='pos'){ if(!dead){ writeBack(d.pos); renderer.kick(); } }
      else if(d.type==='settled'){ if(!dead){ writeBack(d.pos); cleanup(); renderer.kick(); renderer.onSettle(); } }
    };
    worker.onerror=()=>{ _workerOK=false; cleanup(); };
    worker.postMessage({type:'init', nodes:initNodes, edges:initEdges, spacing:state.spacing,
      opts:{alphaMin:simOpts&&simOpts.alphaMin, alphaDecay:simOpts&&simOpts.alphaDecay, velDecay:simOpts&&simOpts.velDecay}});
    return { running:false, _worker:true, tick(){}, reheat(){ cleanup(); }, stop(){ cleanup(); } };
  }

  // cosmic palettes per layout (core -> outskirts)
  const COSMIC_LAYOUTS={
    nebula:       ['#fffdf0','#ffd27a','#ff7ac0','#7c5cff','#1b1740'],
    spiralgalaxy: ['#fff7d6','#ffd27a','#5ad1ff','#3b5bdb','#10173a'],
    cosmicrings:  ['#eafff7','#34d399','#22d3ee','#7c5cff','#2a1840'],
    solar:        ['#fff7d6','#ffd27a','#ff9b6b','#7c5cff','#10173a'],
    helix:        ['#e8fff6','#7afcd0','#34d1ff','#5b6bff','#0a1130'],
    constellation:['#ffffff','#cfe3ff','#8fb6ff','#3a57c8','#070b22'],
    vortex:       ['#fff0fb','#ffadf0','#c46bff','#5a2bd6','#0c0726'],
  };

  // ---------------- core view pipeline ----------------
  function apply({relayout=true, refit=false}={}){
    // Halt ANY running simulation (worker OR main-thread) before re-filtering / relaying out.
    // Critical for performance: a filter/layer toggle must never leave the force physics churning on
    // the main thread — that is what tanked FPS to a crawl on medium+ graphs and made the panel unusable.
    if(state.sim){ if(state.sim._worker) state.sim.stop(); else state.sim.running=false; }
    state.vis=graph.getVisible(filters);
    if(relayout){
      if(state.groups.length){ relayoutGroups(); }   // keep multiple schemas separated side-by-side
      else {
        const res=Layouts.apply(state.layout, graph, state.vis, {spacing:state.spacing});
        state.sim=res.sim||null;
        // animated layouts (force/galaxy/modules): settle live (non-blocking) and refit on settle.
        state._fitOnSettle = !!(res.sim && refit);
        if(res.sim){
          const n=state.vis.nodes.length;
          if(useWorker(n)){
            // physics runs in a Web Worker (off the main thread) — the renderer never ticks this sim,
            // it only paints positions the worker streams back. Scales to the largest repositories.
            const proxy=startWorkerSim(state.vis.nodes, state.vis.edges, res.sim);
            if(proxy) state.sim=proxy;
          } else if(n>400){
            // Worker unavailable on a big graph: settle SYNCHRONOUSLY in one bounded pass, then freeze —
            // so the render loop never runs physics frame-by-frame on the main thread (no sustained FPS hit).
            // Tick budget scales inversely with size so even huge graphs can't lock the thread for long.
            let i=0; const cap=Math.max(60, Math.min(240, Math.round(180000/n)));
            while(state.sim.running && i++<cap) state.sim.tick();
            state.sim.running=false; state._fitOnSettle=false;
            if(refit) requestAnimationFrame(()=>renderer.fit());
          }
          // else: tiny graph — the main-thread sim animates live per frame (negligible cost).
        }
        for(const n of state.vis.nodes) n._placed=true;
      }
    } else {
      seedUnplaced(state.vis.nodes);    // only newly-revealed nodes get a position; rest stay put
    }
    // cosmic colour mode for nebula / galaxy layouts (palette per layout)
    const pal=COSMIC_LAYOUTS[state.layout];
    renderer.opts.cosmic=!!pal; if(pal){ renderer.opts.cosmicPalette=pal; renderer._cosmicLUT=null; }
    renderer.setData(graph, state.vis, state.sim);
    UI.renderLangFilters(graph, {langsOff:filters.langsOff}, handlers);
    updateStatus();
    renderer.drawMinimap($('#minimap'));
    refreshAuthors();
    // static layouts fit immediately; animated ones fit once the live simulation settles (onSettle)
    if(refit && !state._fitOnSettle) requestAnimationFrame(()=>renderer.fit());
    saveSessionDebounced();
  }

  // seed only nodes that have never been placed (e.g. just-revealed by a filter) near their parent,
  // so toggling filters never re-scrambles the whole map
  function seedUnplaced(nodes){
    const byId=new Map(nodes.map(n=>[n.id,n]));
    for(const n of nodes){
      if(n._placed) continue;
      let px=0, py=0;
      let p=n.parent!=null?graph.nodes.get(n.parent):null;
      while(p){ if(byId.has(p.id)&&p._placed){ px=p.x; py=p.y; break; } p=p.parent!=null?graph.nodes.get(p.parent):null; }
      const ang=(n.id.length*0.7)% (Math.PI*2), rad=46+(n.r||8);
      n.x=px+Math.cos(ang)*rad; n.y=py+Math.sin(ang)*rad; n.vx=0; n.vy=0; n._placed=true;
    }
  }
  // lay each loaded schema out independently with the chosen layout, then line them up side-by-side
  function relayoutGroups(){
    let cursorX=0;
    for(const grp of state.groups){
      const sub=state.vis.nodes.filter(n=>(n.gid||'base')===grp.gid);
      if(!sub.length) continue;
      const ids=new Set(sub.map(n=>n.id));
      const subEdges=state.vis.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
      const res=Layouts.apply(state.layout, graph, {nodes:sub, edges:subEdges}, {spacing:state.spacing});
      if(res.sim){ let i=0; while(res.sim.running && i++<220) res.sim.tick(); }   // settle animated layouts synchronously
      const b=graphBounds(sub); const dx=cursorX-b.minX, dy=-((b.minY+b.maxY)/2);
      for(const n of sub){ n.x+=dx; n.y+=dy; n._placed=true; }
      cursorX += (b.maxX-b.minX) + Math.max(360,(b.maxX-b.minX)*0.1);
    }
    state.sim=null;
  }
  function select(node){
    renderer.setSelected(node);
    UI.renderDetails(node, graph, handlers);
    applyImpact();
    updateHash();
  }

  // ---- dependency impact view (upstream / downstream) ----
  let impactOn=false;
  function applyImpact(){
    if(impactOn && renderer.selected){ try{ renderer.setImpact(graph.impactSet(renderer.selected.id)); }catch(e){ renderer.setImpact(null); } }
    else renderer.setImpact(null);
  }
  function toggleImpact(){
    impactOn=!impactOn;
    const b=$('#vc-impact'); if(b){ b.classList.toggle('active', impactOn); b.setAttribute('aria-pressed', impactOn?'true':'false'); }
    if(impactOn && !renderer.selected) U.toast(I.t('ca.impactHint','Widok wpływu: zaznacz plik, aby zobaczyć od czego zależy (w dół) i co od niego zależy (w górę).'),'',3200);
    applyImpact();
  }
  function toggleCollapse(node){ node.collapsed=!node.collapsed; apply({relayout:false}); if(renderer.selected) UI.renderDetails(renderer.selected, graph, handlers); }
  function toggleLang(key){ if(filters.langsOff.has(key)) filters.langsOff.delete(key); else filters.langsOff.add(key); apply({relayout:false}); }

  function revealNode(id){
    const n=graph.nodes.get(id); if(!n) return null;
    let changed=false, cur=n.parent!=null?graph.nodes.get(n.parent):null;
    while(cur){ if(cur.collapsed){cur.collapsed=false;changed=true;} cur=cur.parent!=null?graph.nodes.get(cur.parent):null; }
    if(n.type==='file' && filters.langsOff.has(n.lang)){ filters.langsOff.delete(n.lang); changed=true; }
    if((n.type==='external'||n.id==='__ext__') && !filters.externals){ filters.externals=true; $('#show-externals').checked=true; changed=true; }
    if(changed) apply({relayout:false});
    return n;
  }
  function focusNode(id){ const n=revealNode(id); if(!n) return; select(n); renderer.centerOn(n, Math.max(renderer.cam.zoom,1.1)); }

  // ---- shareable view: encode src + layout + camera + selection into the URL hash ----
  let _hashT=0, _restoring=false;
  function serializeView(){
    if(_restoring || !graph || !graph.nodes || graph.nodes.size===0) return '';
    const c=renderer.cam, m=graph.meta||{};
    const o={ v:1, ly:state.layout, cam:[+c.x.toFixed(1),+c.y.toFixed(1),+c.zoom.toFixed(4),+c.rot.toFixed(4),+c.tilt.toFixed(3)] };
    if(m.html && /^(github|gitlab|bitbucket)$/.test(m.kind||'')){ o.src=m.html; if(m.branch) o.b=m.branch; }
    if(renderer.selected) o.sel=renderer.selected.id;
    return '#v='+encodeURIComponent(JSON.stringify(o));
  }
  function updateHash(){ clearTimeout(_hashT); _hashT=setTimeout(()=>{
    const h=serializeView(); if(h && h!==location.hash){ try{ history.replaceState(null,'',h); }catch(e){} }
  },450); }
  function copyViewLink(){
    const h=serializeView(); if(!h){ U.toast(I.t('ca.noViewYet','Najpierw wczytaj projekt, aby udostępnić widok.'),'error'); return; }
    const url=location.origin+location.pathname+h;
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(
      ()=>U.toast(I.t('ca.linkCopied','🔗 Skopiowano link do tego widoku.'),'success'),
      ()=>U.toast(url,'',6000)); }
    else U.toast(url,'',6000);
  }
  async function restoreView(){
    const raw=location.hash; if(!raw || !raw.startsWith('#v=')) return false;
    let o; try{ o=JSON.parse(decodeURIComponent(raw.slice(3))); }catch(e){ return false; }
    if(!o || o.v!==1) return false;
    // camera + selection only — the layout is applied BEFORE ingest (below) so no relayout is dispatched
    // here (dispatching 'change' would trigger a second fit-on-settle that clobbers the restored camera)
    const applyCam=()=>{
      try{
        if(o.sel){ revealNode(o.sel); }
        if(o.cam && renderer.cam){ const c=renderer.cam, a=o.cam; c.x=a[0]; c.y=a[1]; c.zoom=a[2]; c.rot=a[3]||0; c.tilt=a[4]||0; c._k=''; }
        if(o.sel){ const n=graph.nodes.get(o.sel); if(n){ renderer.setSelected(n); UI.renderDetails(n, graph, handlers); applyImpact(); } }
        renderer.onChange(); renderer.kick();
      }catch(e){}
    };
    if(o.src){
      _restoring=true;
      // set the target layout first — ingest reads #sel-layout for its own (single) layout + refit pass
      if(o.ly){ const s=$('#sel-layout'); if(s && Array.from(s.options).some(op=>op.value===o.ly)){ s.value=o.ly;
        const lbl=$('#layout-menu-label'), opt=s.querySelector('option[value="'+o.ly+'"]'); if(lbl&&opt) lbl.textContent=opt.textContent; } }
      // restore the camera when the layout SETTLES (onSettle) instead of on a fixed timer that lost the race
      state._pendingViewRestore=applyCam;
      try{ await ingest((p,s)=>Loaders.fromRepoURL(o.src, {branch:o.b, fetchContent:true}, p, s), I.t('ca.connectingToRepo','Łączenie z repozytorium…')); }
      catch(e){}
      _restoring=false;
      // fallback for static layouts (no physics settle → onSettle may not fire): apply if still pending
      setTimeout(()=>{ if(state._pendingViewRestore===applyCam){ state._pendingViewRestore=null; state._fitOnSettle=false; applyCam(); } }, 600);
      return true;
    }
    return false;   // local project: cannot reload from a link, only the view params are carried
  }

  function biggestInFolder(folder){
    const out=[];
    const walk=(f)=>{ for(const cid of (f.children||[])){ const c=graph.nodes.get(cid); if(!c)continue; if(c.type==='file')out.push(c); else walk(c); } };
    walk(folder); out.sort((a,b)=>(b.metrics?b.metrics.lines:b.size)-(a.metrics?a.metrics.lines:a.size)); return out;
  }

  // ---------------- ingest ----------------
  const tick=()=>new Promise(r=>setTimeout(r,16));
  function showLoading(t){ $('#loading-text').textContent=t||I.t('loading.text','Wczytywanie…'); $('#progress-bar').style.width='0';
    const p=$('#loading-pct'); if(p) p.textContent='0%'; const c=$('#loading-count'); if(c) c.textContent='';
    if(!$('#loading-cancel')){
      const b=el('button',{id:'loading-cancel',type:'button',text:I.t('ca.cancelLoad','Anuluj')});
      b.onclick=()=>{ _ingestGen++; hideLoading(); U.toast(I.t('ca.loadCancelled','Anulowano wczytywanie.')); };
      $('#loading').appendChild(b);
    } else $('#loading-cancel').textContent=I.t('ca.cancelLoad','Anuluj');
    $('#loading').classList.remove('hidden'); }
  function setLoadingText(t){ $('#loading-text').textContent=t; }
  function setProgress(d,t){ const pct=t?Math.round(d/t*100):0; $('#progress-bar').style.width=pct+'%';
    const p=$('#loading-pct'); if(p) p.textContent=pct+'%';
    const c=$('#loading-count'); if(c) c.textContent=t?(U.fmtNum(d)+' / '+U.fmtNum(t)+I.t('ca.filesSuffix',' plików')):''; }
  function hideLoading(){ $('#loading').classList.add('hidden'); }
  function hideEmpty(){ $('#empty-state').classList.add('hidden'); positionMinimap(); }

  // Every project-scoped bit of state that must NOT leak from one loaded project into the next.
  // Shared by ingest / loadFromJSON / clearAll.
  function resetProjectState(){
    if(state.sim){ if(state.sim._worker) state.sim.stop(); else state.sim.running=false; }
    state.sim=null;
    state.groups=[]; state.gidSeq=0; renderer.setGroups([]);
    state.cyclesOn=false; renderer.setCycles(null);
    renderer.diffMode=false; state.lastDiff=null;
    renderer.selected=null; renderer.hovered=null; renderer.highlight=null;
    UI.tooltip(null); UI.filePreview(null);
    filters.langsOff.clear(); filters.minMetric=0; const mr=$('#rng-minmetric'); if(mr){ mr.value=0; } updateMetricLabel();
    // a shared-view hash describes the PREVIOUS project — drop it (but not while restoring from it)
    if(!_restoring && location.hash.startsWith('#v=')){ try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){} }
  }

  // generation token: a newer load (or Cancel) invalidates every still-running older ingest,
  // so a slow fetch can never clobber the project the user loaded afterwards
  let _ingestGen=0;
  async function ingest(factory, statusText){
    const gen=++_ingestGen;
    showLoading(statusText);
    try{
      await tick();
      const {files, meta}=await factory(setProgress, setLoadingText);
      if(gen!==_ingestGen) return;   // superseded / cancelled — discard silently
      if(!files || !files.length){ U.toast(I.t('ca.noMatchingFiles','Nie znaleziono pasujących plików.'),'error'); hideLoading(); return; }
      setLoadingText(I.t('ca.buildingMapPre','Analiza i budowanie mapy (')+files.length+I.t('ca.buildingMapPost',' plików)…')); await tick();
      if(gen!==_ingestGen) return;
      resetProjectState();
      graph=new Graph(); graph.build(files, meta);
      state.layout=$('#sel-layout').value; state.displayLayout=state.layout;
      if(graph.nodes.size>1400) graph.collapseToBudget(2600);   // adaptive: works for deep AND wide-flat repos
      // BIG repos: declutter automatically — no edges, tiny nodes, huge spacing
      autoTuneView();
      countsInit();
      refreshMetricRange();
      hideEmpty();
      expandMinimap();   // file structure now on the map → reveal the minimap
      select(null);
      apply({refit:true});
      if(meta.html && /^(github|gitlab|bitbucket)$/.test(meta.kind||'')) pushRecentRepo(meta);
      U.toast(I.t('ca.loadedPre','Wczytano <b>')+U.fmtNum(files.length)+I.t('ca.loadedMid','</b> plików — „')+meta.name+I.t('ca.loadedPost','".'),'success');
      // (AI no longer runs automatically on load — view tuning is purely the local heuristic autoTuneView())
      if(meta.warnings && meta.warnings.length) U.toast(I.t('ca.skippedArchivesPre','Pominięto nieobsługiwane archiwa (RAR/7z itp.): ')+meta.warnings.join(', ')+I.t('ca.skippedArchivesPost','. Rozpakuj je lub użyj ZIP / TAR.'),'',6500);
    }catch(e){ if(gen!==_ingestGen) return; console.error(e); U.toast(I.t('ca.loadError','Błąd wczytywania: ')+e.message,'error',6500); }
    if(gen===_ingestGen) hideLoading();
  }

  // big repo -> auto-declutter: turn off all edge types + externals, tiny nodes, huge spacing
  // professional auto-tuning: every loaded project gets node sizes + spacing scaled smoothly to its
  // scale (file count) so it reads well whether it's 12 files or 12 000. File sizes are already encoded
  // in each node's radius (graph.computeAggregates), so this only sets the global scale + spread.
  function autoTuneView(){
    const N = graph.nodes.size || 1;
    // smooth curves (no hard threshold): small projects → bold & tight, huge → small & spread out
    const scale   = U.clamp(11 / Math.pow(N + 6, 0.42), 0.42, 2.6);   // node-size multiplier (slider 42–260%)
    const spacing = U.clamp(0.5 * Math.pow(N, 0.45), 2, 25);          // spread multiplier (slider 200–2500%)
    renderer.opts.nodeScale = scale; state.spacing = spacing;
    const ns=$('#rng-nscale'); if(ns){ ns.value=Math.round(scale*100); $('#val-nscale').textContent=Math.round(scale*100)+'%'; }
    const sp=$('#rng-spacing'); if(sp){ sp.value=Math.round(spacing*100); $('#val-spacing').textContent=Math.round(spacing*100)+'%'; }
    // very large graphs: declutter (drop edges + externals) so the structure stays legible
    if(N > 1200){
      filters.contains=false; filters.import=false; filters.reference=false; filters.externals=false;
      const set=(id,v)=>{ const e=$('#'+id); if(e) e.checked=v; };
      set('edge-contains',false); set('edge-import',false); set('edge-reference',false); set('show-externals',false);
      U.toast(I.t('ca.bigRepo','Duże repozytorium — automatycznie odchudzono widok (bez połączeń, małe figury, duży rozrzut).'),'',4200);
    }
  }

  function countsInit(){
    let nodes=0, imp=0;
    for(const n of graph.nodes.values()){ if(n.type==='file'||n.type==='folder') nodes++; }
    for(const e of graph.edges){ if(e.type==='import'||e.type==='reference') imp++; }
    state.counts={nodes, edges:imp};
    refreshProjectLabel();
  }
  function updateStatus(){
    const I=CM.i18n;
    $('#st-nodes').textContent=U.fmtNum(state.counts.nodes)+' '+I.t('st.u.nodes');
    $('#st-edges').textContent=U.fmtNum(state.counts.edges)+' '+I.t('st.u.edges');
    $('#st-visible').textContent=U.fmtNum(state.vis.nodes.length)+' '+I.t('st.u.visible');
    $('#st-zoom').textContent=Math.round(renderer.cam.zoom*100)+'%';
  }
  // project label: name when loaded, translated "no project" otherwise (kept out of data-i18n
  // so a language switch never clobbers the loaded project's name)
  function refreshProjectLabel(){
    const has = graph && graph.meta && graph.meta.name && state.counts.nodes>0;
    const name = has ? graph.meta.name : '';
    $('#st-project').textContent = has ? name : CM.i18n.t('st.noproject');
    const tb=$('#tb-project-name');                       // toolbar badge next to the Projekt menu
    if(tb){ tb.textContent=name; tb.title=has?((graph.meta.source||name)):''; tb.classList.toggle('hidden', !has); }
  }
  function updateRotDial(){
    // needle always points toward the centre of the schema on screen
    const c=renderer.centroidScreen();
    let head;
    if(c){ const dx=c.x-renderer.w/2, dy=c.y-renderer.h/2;
      head = (Math.abs(dx)<0.5&&Math.abs(dy)<0.5) ? -renderer.cam.rot*180/Math.PI : Math.atan2(dx,-dy)*180/Math.PI; }
    else head=0;
    $('#rot-needle').style.transform=`rotate(${head}deg)`;
    let deg=Math.round(renderer.cam.rot*180/Math.PI)%360; if(deg<0)deg+=360;
    $('#rot-label').textContent=deg+'°';
  }

  // ---------------- toolbar ----------------
  function wireToolbar(){
    $('#btn-load-folder').onclick=()=>$('#input-folder').click();
    $('#empty-folder').onclick=()=>$('#input-folder').click();
    $('#btn-load-files').onclick=()=>$('#input-files').click();
    $('#btn-load-github').onclick=()=>{ renderRecentRepos(); refreshGhRate(); openModal('modal-github'); };
    $('#empty-github').onclick=()=>{ renderRecentRepos(); refreshGhRate(); openModal('modal-github'); };
    $('#empty-demo').onclick=()=>loadDemo();
    $('#empty-close').onclick=()=>{ $('#empty-state').classList.add('hidden'); positionMinimap(); };
    // capture the FileList into an array BEFORE clearing the input — resetting value='' empties
    // e.target.files synchronously, and ingest() only reads them after an async tick.
    $('#input-folder').onchange=(e)=>{ const files=Array.from(e.target.files); e.target.value=''; if(files.length) ingest((p)=>Loaders.fromFileList(files,p),I.t('ca.readingFolder','Czytanie folderu…')); };
    $('#input-files').onchange=(e)=>{ const files=Array.from(e.target.files); e.target.value=''; if(files.length) ingest((p)=>Loaders.fromFileList(files,p),I.t('ca.readingFiles','Czytanie plików…')); };

    $('#sel-layout').onchange=(e)=>{ state.layout=e.target.value; state.displayLayout=e.target.value; apply({relayout:true, refit:true}); };

    $('#btn-snapshot').onclick=async()=>{
      if(!graph.nodes.size||state.counts.nodes===0){ U.toast(I.t('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; }
      const label=prompt(I.t('ca.snapshotName','Nazwa migawki:'), graph.meta.name+' — '+U.fmtDate(Date.now()));
      if(label===null) return;
      await Storage.addSnapshot(graph, label||undefined);
      U.toast(I.t('ca.snapshotSaved','📌 Migawka zapisana. Rozwój możesz śledzić w „Historia".'),'success');
    };
    $('#btn-history').onclick=openHistory;
    $('#btn-save').onclick=()=>{ if(state.counts.nodes===0){U.toast(I.t('ca.noMapToSave','Brak mapy do zapisania.'),'error');return;} Storage.saveMap(graph); U.toast(I.t('ca.mapExported','💾 Mapa wyeksportowana.'),'success'); };
    $('#btn-export-img').onclick=(e)=>{
      e.stopPropagation();
      if(state.counts.nodes===0){ U.toast(I.t('ca.noMapToExport','Brak mapy do eksportu.'),'error'); return; }
      const r=e.currentTarget.getBoundingClientRect();
      UI.ctxMenu([
        {ic:'image',label:I.t('ca.pngExport','PNG (2×)'),action:()=>exportImage('png',2)},
        {ic:'image',label:I.t('ca.pngExportHi','PNG (wysoka rozdz. 4×)'),action:()=>exportImage('png',4)},
        {ic:'download',label:I.t('ca.svgExport','SVG (wektor)'),action:()=>exportImage('svg')},
      ], r.left, r.bottom+4);
    };
    $('#btn-open').onclick=()=>$('#input-open').click();
    $('#input-open').onchange=async(e)=>{ const f=e.target.files[0]; if(!f)return;
      try{ const obj=await Storage.openMap(f); loadFromJSON(obj); }catch(err){ U.toast(err.message,'error'); } e.target.value=''; };
    $('#btn-clear').onclick=()=>{
      if(state.counts.nodes>0 && !confirm(I.t('ca.clearConfirm','Wyczyścić załadowaną mapę? (migawki i zapisane pliki pozostaną)'))) return;
      clearAll();
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
    renderer.inset.l = $('#left-panel').classList.contains('collapsed')?0:PW.left;
    renderer.inset.r = $('#right-panel').classList.contains('collapsed')?0:PW.right;
    renderer.kick();
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
  function expandMinimap(){ const w=$('#minimap-wrap'); if(!w) return; w.classList.remove('mm-collapsed'); positionMinimap(); renderer.drawMinimap($('#minimap')); }
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

  function clearAll(){
    graph=new Graph();
    resetProjectState();
    state.vis={nodes:[],edges:[]}; state.counts={nodes:0,edges:0};
    renderer.setData(graph, state.vis, null);
    refreshAuthors();
    UI.renderDetails(null, graph, handlers);
    UI.renderLangFilters(graph, {langsOff:filters.langsOff}, handlers);
    $('#empty-state').classList.remove('hidden'); minimizeMinimap();   // no structure → minimize again
    refreshProjectLabel();
    $('#search-input').value=''; UI.renderSearch([], handlers);
    updateStatus(); renderer.drawMinimap($('#minimap'));
    U.toast(I.t('ca.cleared','🧹 Wyczyszczono dane.'),'success');
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
    const setAccent=(c)=>{ root.setProperty('--accent', c); renderer.clearCssCache(); renderer.kick(); };
    document.querySelectorAll('#accent-row .acc').forEach(b=>b.onclick=()=>{
      setAccent(b.dataset.acc); $('#col-accent').value=b.dataset.acc;
      document.querySelectorAll('#accent-row .acc').forEach(x=>x.classList.toggle('active', x===b));
    });
    $('#col-accent').oninput=(e)=>{ setAccent(e.target.value); document.querySelectorAll('#accent-row .acc').forEach(x=>x.classList.remove('active')); };
    // ---- background ----
    const colBg=$('#col-bg');
    const applyBg=(hex)=>{ root.setProperty('--bg', hex); renderer.clearCssCache(); renderer.kick(); };
    colBg.oninput=()=>{ applyBg(colBg.value); document.querySelectorAll('#theme-presets .thpre').forEach(x=>x.classList.remove('active')); };
    // ---- curated theme presets: one click applies a coherent professional set ----
    _applyThemePreset=(key)=>{
      const p=THEME_PRESETS[key]; if(!p) return false;
      const tb=document.querySelector('#theme-row .theme-btn[data-theme="'+p.theme+'"]'); if(tb) tb.click();  // base surfaces + body.light
      root.setProperty('--bg', p.bg); root.setProperty('--menu-rgb', p.menu); root.setProperty('--glass-rgb', p.menu);
      colBg.value=p.bg;
      const ca=$('#col-accent'); if(ca) ca.value=p.accent;
      setAccent(p.accent);
      document.querySelectorAll('#accent-row .acc').forEach(x=>x.classList.toggle('active', x.dataset.acc===p.accent));
      document.querySelectorAll('#theme-presets .thpre').forEach(x=>x.classList.toggle('active', x.dataset.pre===key));
      renderer.clearCssCache(); renderer.kick();
      return true;
    };
    document.querySelectorAll('#theme-presets .thpre').forEach(b=>b.onclick=()=>_applyThemePreset(b.dataset.pre));
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
      renderer.clearCssCache(); renderer.kick();
    });
    // map render options
    const optBind=(id,key)=>{ const el=$('#'+id); el.onchange=()=>{ renderer.opts[key]=el.checked; renderer.kick(); }; renderer.opts[key]=el.checked; };
    optBind('opt-animate','animateEdges'); optBind('opt-particles','particles');
    optBind('opt-glow','glow'); optBind('opt-grid','showGrid'); optBind('opt-curved','curvedImports');
    optBind('opt-lockall','lockAll');
  }

  // ---------------- node appearance (size + spacing + label font) ----------------
  function wireNodeAppearance(){
    const rng=$('#rng-nscale');
    if(!rng) return;
    renderer.opts.nodeScale=(+rng.value)/100;   // honour the default (2.5×) figure size at startup
    rng.oninput=()=>{
      const v=+rng.value;
      $('#val-nscale').textContent=v+'%';
      renderer.opts.nodeScale=v/100;
      renderer.kick();
    };
    const sp=$('#rng-spacing');
    if(sp) sp.oninput=()=>{ const v=+sp.value; $('#val-spacing').textContent=v+'%'; state.spacing=v/100;
      if(state.layout!=='saved'){ apply({relayout:true}); } };
    const fs=$('#rng-fscale');
    if(fs) fs.oninput=()=>{ const v=+fs.value; $('#val-fscale').textContent=v+'%'; renderer.opts.labelScale=v/100; renderer.kick(); };
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
        ingest((p)=>Loaders.fromFileList(files,p),I.t('ca.pastingPre','Wklejanie ')+files.length+I.t('ca.pastingPost',' plików…'));
      } else {
        const txt=cd.getData('text');
        if(txt && /github\.com|^[\w.-]+\/[\w.-]+$/.test(txt.trim())){
          $('#gh-url').value=txt.trim(); openModal('modal-github');
        }
      }
    });
  }

  function loadFromJSON(obj){
    if(!obj || obj.format!=='codemap'){ U.toast(I.t('ca.notCodemapFile','To nie jest plik mapy CodeMap.'),'error'); return; }
    resetProjectState();
    graph=Graph.fromJSON(obj);
    countsInit(); refreshMetricRange(); hideEmpty(); expandMinimap();
    select(null);
    state.layout='saved';
    // use stored positions, no relayout
    state.vis=graph.getVisible(filters);
    renderer.setData(graph, state.vis, null);
    UI.renderLangFilters(graph, {langsOff:filters.langsOff}, handlers);
    updateStatus(); renderer.drawMinimap($('#minimap'));
    requestAnimationFrame(()=>renderer.fit());
    U.toast(I.t('ca.mapLoaded','📂 Mapa wczytana z pliku.'),'success');
  }

  // ---------------- filters ----------------
  function wireFilters(){
    // toggling a filter keeps existing node positions (relayout:false) so the map never re-scrambles
    const bind=(id,key)=>{ $('#'+id).onchange=(e)=>{ filters[key]=e.target.checked; apply({relayout:false}); }; };
    bind('show-folders','folders'); bind('show-files','files'); bind('show-externals','externals');
    bind('edge-contains','contains'); bind('edge-import','import'); bind('edge-reference','reference');
    $('#lang-toggle-all').onclick=()=>{
      const stats=Array.from(graph.langStats.keys());
      if(filters.langsOff.size){ filters.langsOff.clear(); } else { stats.forEach(k=>filters.langsOff.add(k)); }
      apply({relayout:false});
    };
    // complexity / size filter
    $('#sel-metric').onchange=(e)=>{ filters.metric=e.target.value; filters.minMetric=0; refreshMetricRange(); apply({relayout:false}); };
    $('#rng-minmetric').oninput=(e)=>{ filters.minMetric=+e.target.value; updateMetricLabel(); apply({relayout:false}); };
  }

  // recompute the slider's max from the current data + metric, reset threshold to 0
  function refreshMetricRange(){
    const m=filters.metric, rng=$('#rng-minmetric'); if(!rng) return;
    let max=0;
    if(graph&&graph.nodes) for(const n of graph.nodes.values()){
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
    $('#vc-zoom-in').onclick=()=>renderer.zoomBy(1.3);
    $('#vc-zoom-out').onclick=()=>renderer.zoomBy(1/1.3);
    $('#vc-fit').onclick=()=>renderer.fit();
    $('#vc-rot-left').onclick=()=>renderer.rotateBy(-Math.PI/12);
    $('#vc-rot-right').onclick=()=>renderer.rotateBy(Math.PI/12);
    $('#vc-rot-reset').onclick=()=>renderer.resetRotation();
    $('#vc-3d').onclick=()=>renderer.setTilt(renderer.cam.tilt>0.05?0:0.62);
    { const vi=$('#vc-impact'); if(vi) vi.onclick=()=>toggleImpact(); }
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
      const q=inp.value.trim().toLowerCase(); if(!q){ UI.renderSearch([], handlers); renderer.setHighlight(null); return; }
      const scored=[]; const all=[];
      for(const n of graph.nodes.values()){
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
      renderer.setHighlight(all.length?new Set(all):null);   // light up matches on the map
    },140);
    inp.oninput=run;
    inp.onkeydown=(e)=>{ if(e.key==='Enter'){ const first=$('#search-results .sr-item'); if(first) first.click(); } if(e.key==='Escape'){ inp.value=''; UI.renderSearch([],handlers); renderer.setHighlight(null); inp.blur(); } };
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
      ingest((p)=>Loaders.fromDrop(entries, files, p),I.t('ca.readingDropped','Czytanie upuszczonych plików…'));
    });
  }

  // ---------------- modals ----------------
  function openModal(id){ $('#'+id).classList.remove('hidden'); }
  function closeModal(m){ m.classList.add('hidden'); }
  // ---------------- recently loaded repositories (quick re-load chips in the GitHub modal) ----------------
  const RECENT_KEY='codemap_recent_repos';
  function recentRepos(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); }catch(e){ return []; } }
  function pushRecentRepo(meta){
    if(!meta || !meta.html) return;
    let list=recentRepos().filter(r=>r.url!==meta.html);
    list.unshift({url:meta.html, name:meta.name||meta.repo||meta.html, host:meta.host||meta.kind||'github'});
    try{ localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0,6))); }catch(e){}
  }
  function renderRecentRepos(){
    const wrap=$('#gh-recent'); if(!wrap) return;
    const list=recentRepos(); wrap.innerHTML='';
    if(!list.length){ wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    wrap.appendChild(el('div',{class:'gh-recent-lbl',text:CM.i18n.t('gh.recent','Ostatnie repozytoria')}));
    const row=el('div',{class:'gh-recent-row'});
    list.forEach(r=>{
      const chip=el('button',{class:'gh-recent-chip',title:r.url},
        el('span',{class:'gh-recent-ic',html:CM.icons.svg('globe',{size:13})}),
        el('span',{class:'gh-recent-name',text:r.name}));
      chip.onclick=()=>{ $('#gh-url').value=r.url; $('#gh-go').click(); };
      row.appendChild(chip);
    });
    wrap.appendChild(row);
  }

  // ---------------- branch/tag picker + API rate limit ----------------
  function fillRefList(refs){
    const dl=$('#gh-branch-list'); if(!dl) return; dl.innerHTML='';
    (refs.branches||[]).forEach(b=>dl.appendChild(el('option',{value:b})));
    (refs.tags||[]).forEach(t=>dl.appendChild(el('option',{value:t})));
  }
  async function refreshGhRate(){
    const box=$('#gh-rate'); if(!box) return;
    const url=$('#gh-url').value.trim();
    if(url && Loaders.repoHost(url)!=='github'){ box.textContent=''; box.classList.remove('low'); return; }  // rate endpoint is GitHub-only
    box.textContent=CM.i18n.t('gh.rateChecking','Sprawdzanie limitu API…'); box.classList.remove('low');
    const rl=await Loaders.ghRateLimit($('#gh-token').value.trim()||undefined);
    if(!rl){ box.textContent=''; return; }
    const low=rl.remaining<=5;
    box.classList.toggle('low', low);
    box.innerHTML=CM.i18n.t('gh.rateLabel','Limit API GitHub: ')+'<b>'+rl.remaining+' / '+rl.limit+'</b>'+
      (rl.limit<=60 ? (' · '+CM.i18n.t('gh.rateHint','dodaj token, by zwiększyć do 5000')) : '');
  }

  // ---------------- compare two branches/tags as a diff (green=added, red=removed, yellow=changed) ----------------
  async function compareBranches(url, refA, refB, token){
    if(!url){ U.toast(I.t('ca.enterAddress','Podaj adres.'),'error'); return; }
    if(!refA || !refB){ U.toast(I.t('ca.cmpPick','Podaj obie gałęzie/tagi do porównania.'),'error'); return; }
    if(token) state._ghToken=token;
    closeModal($('#modal-github'));
    const gen=++_ingestGen;   // share the ingest generation token: Cancel or a newer load supersedes this
    showLoading(I.t('ca.cmpLoading','Porównywanie ')+refA+' → '+refB+'…');
    try{
      await tick();
      const sigA=await Loaders.fetchTreeSig(url, refA, token); if(gen!==_ingestGen) return;
      const sigB=await Loaders.fetchTreeSig(url, refB, token); if(gen!==_ingestGen) return;
      setLoadingText(I.t('ca.buildingMapPre','Analiza i budowanie mapy (')+sigB.fileCount+I.t('ca.buildingMapPost',' plików)…')); await tick();
      const {files, meta}=await Loaders.fromRepoURL(url, {branch:refB, token, fetchContent:true}, setProgress, setLoadingText);
      if(gen!==_ingestGen) return;
      resetProjectState();   // clear stale groups/cycles/selection/diff from a previous project before rebuilding
      graph=new Graph(); graph.build(files, meta);
      filters.langsOff.clear();
      state.layout=$('#sel-layout').value; state.displayLayout=state.layout;
      autoTuneView();
      refreshMetricRange(); hideEmpty(); expandMinimap();
      const diff=CM.Graph.diffSignatures(sigA, sigB); state.lastDiff=diff;
      Storage.applyDiffToGraph(graph, diff); renderer.diffMode=true;
      select(null); countsInit(); apply({refit:true});
      if(meta.html && /^(github|gitlab|bitbucket)$/.test(meta.kind||'')) pushRecentRepo(meta);
      UI.renderDiff(diff, {label:refA, signature:sigA}, {label:refB, signature:sigB}); openModal('modal-diff');
      U.toast(I.t('ca.cmpDone','Porównano ')+refA+' ↔ '+refB+'  (+'+diff.added.length+' / −'+diff.removed.length+' / ~'+diff.modified.length+')','success',6000);
    }catch(e){ if(gen!==_ingestGen) return; console.error(e); U.toast(I.t('ca.loadError','Błąd wczytywania: ')+e.message,'error',6500); }
    if(gen===_ingestGen) hideLoading();
  }

  // ---------------- export the current map as a GitHub Gist ----------------
  async function exportGist(){
    if(state.counts.nodes===0){ U.toast(I.t('ca.noMapToExport','Brak mapy do eksportu.'),'error'); return; }
    let token=($('#gh-token')&&$('#gh-token').value.trim())||state._ghToken;
    if(!token){ token=prompt(I.t('ca.gistTokenPrompt','Wklej token GitHub z uprawnieniem „gist":')); if(token) token=token.trim(); }
    if(!token) return;
    state._ghToken=token;
    U.toast(I.t('ca.gistUploading','Wysyłanie Gist…'),'',2000);
    try{
      const content=JSON.stringify(graph.toJSON());
      const res=await Loaders.createGist(content, 'CodeMap — '+(graph.meta.name||'mapa'), token, false);
      try{ navigator.clipboard&&navigator.clipboard.writeText(res.url); }catch(e){}
      U.toast(I.t('ca.gistDone','✅ Gist utworzony (URL skopiowany).'),'success',6000);
      window.open(res.url,'_blank','noopener');
    }catch(e){ U.toast(I.t('ca.gistFail','Gist nie powiódł się: ')+e.message,'error',6500); }
  }

  // ---------------- optional AI (Mistral): structure-only summary, never source code ----------------
  function aiStructureSummary(){
    const g=graph, langCount={}, folderMap=new Map();
    let totalSize=0, fileCount=0, folderCount=0, externals=0, maxDepth=0, maxFileKB=0, hasTests=false;
    for(const n of g.nodes.values()){
      if(n.type==='folder'){ folderCount++; continue; }
      if(n.type==='external'){ externals++; continue; }
      if(n.type!=='file') continue;
      fileCount++; totalSize+=n.size||0;
      const kb=(n.size||0)/1024; if(kb>maxFileKB) maxFileKB=kb;
      const depth=(n.path||'').split('/').length; if(depth>maxDepth) maxDepth=depth;
      if(/(^|\/)(tests?|spec|specs|__tests__|e2e)(\/|$)/i.test(n.path||'')) hasTests=true;
      const l=(n.langInfo&&n.langInfo.name)||n.lang||'other'; langCount[l]=(langCount[l]||0)+1;
      const top=(n.path||'').split('/')[0]||'(root)';
      if(!folderMap.has(top)) folderMap.set(top,{name:top,files:0,size:0,langs:{}});
      const f=folderMap.get(top); f.files++; f.size+=n.size||0; f.langs[l]=(f.langs[l]||0)+1;
    }
    let importEdges=0; for(const e of g.edges){ if(e.type==='import'||e.type==='reference') importEdges++; }
    // local models run with a 2048-token window — feed them a MUCH smaller structure than the API
    const localAI=CM.LocalAI&&CM.LocalAI.provider()==='local';
    const languages=Object.entries(langCount).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+' ×'+v);
    const folders=[...folderMap.values()].sort((a,b)=>b.files-a.files).slice(0,localAI?12:40).map(f=>({
      name:f.name, files:f.files, sizeKB:Math.round(f.size/1024),
      langs:Object.entries(f.langs).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]) }));
    return { project:g.meta.name||'project', source:g.meta.source||'',
      totalFiles:fileCount, totalFolders:folderCount, externals, importEdges,
      totalSizeKB:Math.round(totalSize/1024), avgFileKB:fileCount?Math.round(totalSize/1024/fileCount):0, maxFileKB:Math.round(maxFileKB), maxDepth, hasTests,
      languages, topFolders:folders };
  }
  // ---- Mistral API keys: up to 4, used app-wide with round-robin + automatic fallback ----
  function aiKeyList(){
    let arr=[]; try{ arr=JSON.parse(localStorage.getItem('codemap_mistral_keys')||'[]'); }catch(e){}
    if(!Array.isArray(arr)) arr=[];
    arr=arr.map(k=>(k||'').trim()).filter(Boolean);
    const legacy=(localStorage.getItem('codemap_mistral_key')||'').trim();   // back-compat: single-key storage
    if(legacy && arr.indexOf(legacy)<0) arr.unshift(legacy);
    return arr.filter((k,i)=>arr.indexOf(k)===i);   // de-dupe, keep order
  }
  function aiModel(){ return localStorage.getItem('codemap_mistral_model')||'mistral-small-latest'; }
  function aiConfigured(){
    const prov=CM.LocalAI?CM.LocalAI.provider():'mistral';
    if(prov==='local') return CM.LocalAI.hasWebGPU();
    if(prov==='ollama') return true;   // reachability errors surface with a clear message on use
    return aiKeyList().length>0;
  }
  function aiGuard(){
    if(!aiConfigured()) throw new Error(I.t('ca.aiNeedKey','Podaj klucz Mistral API w Ustawieniach → AI.'));
    if(state.counts.nodes===0) throw new Error(I.t('ca.aiNoProject','Najpierw wczytaj projekt.'));
  }
  let _aiRot=0;   // round-robin cursor — spreads requests across the configured keys
  async function aiChat(messages, opts){
    // local providers — the whole app's AI runs on-device, no key needed:
    //  'local'  = WebLLM in-browser;  'ollama' = native Ollama server (fastest local option)
    const prov=CM.LocalAI?CM.LocalAI.provider():'mistral';
    if(prov==='local') return CM.LocalAI.chat(messages, opts||{});
    if(prov==='ollama' && CM.Ollama) return CM.Ollama.chat(messages, opts||{});
    const keys=aiKeyList();
    if(!keys.length) throw new Error(I.t('ca.aiNeedKey','Podaj klucz Mistral API w Ustawieniach → AI.'));
    const model=aiModel(); let lastErr=null;
    for(let i=0;i<keys.length;i++){
      const key=keys[(_aiRot+i)%keys.length];
      try{ const r=await Loaders.mistralChat(messages, Object.assign({}, opts, {key, model}));
        _aiRot=(_aiRot+i+1)%keys.length; return r; }   // advance cursor only on success
      catch(e){ lastErr=e;
        const recoverable=(e&&(e.status===401||e.status===429||e.status>=500));   // bad key / rate / server → try next
        if(!recoverable) throw e;
      }
    }
    throw lastErr || new Error('Mistral API');
  }
  async function aiAnalyze(){
    aiGuard();
    const lang=CM.i18n.getLang()==='en'?'English':'Polish';
    const sys='You are a senior software architect. You receive ONLY a project\'s folder/file structure (paths, counts, sizes, languages) — never source code. Be concise and practical.';
    const user='Analyze this project structure and: (1) describe the likely architecture in 3–5 sentences; (2) propose a clear logical grouping into modules/layers as a bullet list mapping top-level folders to their role; (3) flag structural smells (oversized files/folders, missing tests, mixed concerns). Answer in '+lang+'.\n\nStructure JSON:\n'+JSON.stringify(aiStructureSummary());
    return await aiChat([{role:'system',content:sys},{role:'user',content:user}]);
  }

  // ---- #8: free-form question about the project (structure only, never source code) ----
  async function aiAsk(question){
    question=(question||'').trim(); if(!question) throw new Error(I.t('ca.aiAskEmpty','Wpisz pytanie.'));
    aiGuard();
    const lang=CM.i18n.getLang()==='en'?'English':'Polish';
    const sys='You help a developer understand a codebase. You receive ONLY the project structure (folders, file paths, counts, sizes, languages) — never source code. Answer practically and concisely; when the structure cannot fully answer, say what you can infer and name the folders/files most likely worth opening. Answer in '+lang+'.';
    const user='Question: '+question+'\n\nProject structure JSON:\n'+JSON.stringify(aiStructureSummary());
    return await aiChat([{role:'system',content:sys},{role:'user',content:user}], {temperature:0.4});
  }
  // ask AI about a SPECIFIC selected element (folder/file) — scoped context, structure only
  async function aiAskNode(node, question){
    question=(question||'').trim(); if(!question) throw new Error(I.t('ca.aiAskEmpty','Wpisz pytanie.'));
    if(!node) return aiAsk(question);
    aiGuard();
    const lang=CM.i18n.getLang()==='en'?'English':'Polish';
    const ctx={ name:node.name, path:node.path||node.name, type:node.type };
    const localAI=CM.LocalAI&&CM.LocalAI.provider()==='local';   // 2048-token window → tighter context
    const kidsCap=localAI?30:80, depsCap=localAI?15:40;
    if(node.type==='folder'){
      const kids=[]; for(const n of graph.nodes.values()){ if(n.parent===node.id){ kids.push((n.type==='folder'?'📁 ':'')+n.name); if(kids.length>=kidsCap) break; } }
      ctx.contains=kids;
    } else {
      ctx.lang=(node.langInfo&&node.langInfo.name)||node.lang||null; ctx.sizeKB=Math.round((node.size||0)/1024);
      const deps=[]; for(const e of graph.edges){ if(e.source===node.id&&(e.type==='import'||e.type==='reference')){ const t=graph.nodes.get(e.target); if(t){ deps.push(t.name); if(deps.length>=depsCap) break; } } }
      if(deps.length) ctx.dependsOn=deps;
    }
    const sys='You help a developer understand a SPECIFIC part of a codebase. You receive ONLY structural metadata (the selected element plus brief project context) — never source code. Answer concisely and practically about THIS element; if the structure is insufficient, say what you can infer. Answer in '+lang+'.';
    const user='Selected element:\n'+JSON.stringify(ctx)+'\n\nProject overview:\n'+JSON.stringify(aiStructureSummary())+'\n\nQuestion: '+question;
    return await aiChat([{role:'system',content:sys},{role:'user',content:user}], {temperature:0.4});
  }

  // (AI-driven file-LAYOUT was removed by design — node arrangement is purely geometric/deterministic.
  //  The optional, separate "AI view-tuning" below only picks which elements/sizes to show, never positions.)


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
      ingest((p,s)=>Loaders.fromRepoURL(url, opts, p, s),I.t('ca.connectingToPre','Łączenie z ')+nice+I.t('ca.connectingToPost','…'));
    };
    $('#gh-url').onkeydown=(e)=>{ if(e.key==='Enter') $('#gh-go').click(); };
    // branch/tag picker: fetch refs into the shared datalist + show API rate limit
    $('#gh-load-refs').onclick=async()=>{
      const url=$('#gh-url').value.trim(); if(!url){ U.toast(I.t('ca.enterAddress','Podaj adres.'),'error'); return; }
      const btn=$('#gh-load-refs'); btn.disabled=true;
      const refs=await Loaders.fetchRefs(url, $('#gh-token').value.trim()||undefined);
      btn.disabled=false;
      fillRefList(refs); refreshGhRate();
      const n=(refs.branches||[]).length+(refs.tags||[]).length;
      U.toast(n? (I.t('ca.refsLoadedPre','Wczytano ')+n+I.t('ca.refsLoadedPost',' gałęzi/tagów.')) : I.t('ca.refsNone','Nie pobrano gałęzi (sprawdź adres / token).'), n?'success':'error');
    };
    $('#gh-cmp-go').onclick=()=>{
      const url=$('#gh-url').value.trim(); const a=$('#gh-cmp-a').value.trim(), b=$('#gh-cmp-b').value.trim();
      compareBranches(url, a, b, $('#gh-token').value.trim()||undefined);
    };
    $('#btn-gist').onclick=()=>exportGist();
    { const cl=$('#btn-copylink'); if(cl) cl.onclick=()=>copyViewLink(); }
    $('#hist-export').onclick=async()=>{ const all=await Storage.allSnapshots(); U.download('codemap-historia.json', JSON.stringify(all)); U.toast(I.t('ca.historyExported','Historia wyeksportowana.'),'success'); };
    $('#hist-import').onclick=()=>$('#input-import-hist').click();
    $('#input-import-hist').onchange=async(e)=>{ const f=e.target.files[0]; if(!f)return; try{ const arr=JSON.parse(await f.text()); await Storage.importSnapshots(arr); U.toast(I.t('ca.importedSnapshotsPre','Zaimportowano ')+arr.length+I.t('ca.importedSnapshotsPost',' migawek.'),'success'); openHistory(); }catch(err){ U.toast(I.t('ca.importError','Błąd importu.'),'error'); } e.target.value=''; };
    $('#diff-apply').onclick=()=>{ if(state.lastDiff){ Storage.applyDiffToGraph(graph, state.lastDiff); renderer.diffMode=true; countsInit(); apply({}); closeModal($('#modal-diff')); U.toast(I.t('ca.diffApplied','Różnice naniesione na mapę (zielony=nowy, żółty=zmiana, czerwony=usunięty).'),'success',5000); } };
  }

  async function openHistory(){
    openModal('modal-history');
    const key=graph.meta.source||graph.meta.name;
    const snaps=await Storage.listSnapshots(state.counts.nodes? key : undefined);
    UI.renderHistory(snaps.length?snaps:await Storage.allSnapshots(), graph, handlers);
  }
  function doCompare(a,b){
    const diff=CM.Graph.diffSignatures(a.signature, b.signature);
    state.lastDiff=diff;
    closeModal($('#modal-history'));
    UI.renderDiff(diff, a, b);
    openModal('modal-diff');
  }

  // ---------------- context menu ----------------
  function contextMenu(node, x, y){
    const items=[];
    if(node){
      items.push({ic:'crosshair',label:I.t('ca.ctxCenter','Wyśrodkuj widok'),action:()=>focusNode(node.id)});
      items.push({ic:'eye',label:I.t('ca.ctxHighlightNeighbors','Podświetl sąsiadów'),action:()=>{ select(node); }});
      items.push({ic:'search',label:I.t('ca.ctxIsolate','Izoluj: pokaż tylko powiązane'),action:()=>isolateNode(node)});
      if(node.type==='folder'&&node.children&&node.children.length){
        items.push({sep:true});
        items.push({ic:node.collapsed?'expand':'collapse',label:node.collapsed?I.t('ca.ctxExpandFolder','Rozwiń folder'):I.t('ca.ctxCollapseFolder','Zwiń folder'),action:()=>toggleCollapse(node)});
        items.push({ic:'expand',label:I.t('ca.ctxExpandBelow','Rozwiń wszystko poniżej'),action:()=>{ expandBelow(node); apply({}); }});
        items.push({ic:'collapse',label:I.t('ca.ctxCollapseBelow','Zwiń wszystko poniżej'),action:()=>{ collapseBelow(node); apply({}); }});
      }
      items.push({sep:true});
      if(nodeRepoUrl(node)) items.push({ic:'globe',label:I.t('ca.openOnHost','Otwórz na ')+repoHostName(),action:()=>handlers.openRepoUrl(node)});
      if(node.path) items.push({ic:'copy',label:I.t('ca.ctxCopyPath','Kopiuj ścieżkę'),action:()=>{ navigator.clipboard?.writeText(node.path); U.toast(I.t('ca.copiedPath','Skopiowano ścieżkę.')); }});
      if(node.name) items.push({ic:'file',label:I.t('ca.ctxCopyName','Kopiuj nazwę pliku'),action:()=>{ navigator.clipboard?.writeText(node.name); U.toast(I.t('ca.copiedName','Skopiowano nazwę.')); }});
      items.push({ic:'pin',label:node.pinned?I.t('ca.ctxUnpin','Odepnij pozycję'):I.t('ca.ctxPin','Przypnij pozycję'),action:()=>{ node.pinned=!node.pinned; node.fixed=node.pinned||node.locked; }});
      items.push({ic:'box',label:node.locked?I.t('ca.ctxUnlock','Odblokuj figurę'):I.t('ca.ctxLock','Zablokuj figurę (bez ruchu)'),action:()=>{ node.locked=!node.locked; node.fixed=node.locked||node.pinned; renderer.kick(); }});
      if(node.type==='file'){
        const out=(node.importsOut||[]).length, inc=(node.importsIn||[]).length;
        if(out+inc>0){
          items.push({sep:true});
          items.push({ic:'arrowRight',label:I.t('ca.ctxDepsOut','Pokaż zależności wychodzące (')+out+')',action:()=>{ select(node); renderer.setHighlight(new Set([node.id,...(node.importsOut||[])])); }});
          items.push({ic:'arrowLeft',label:I.t('ca.ctxDepsIn','Pokaż zależności przychodzące (')+inc+')',action:()=>{ select(node); renderer.setHighlight(new Set([node.id,...(node.importsIn||[])])); }});
        }
      }
      items.push({sep:true});
      items.push({ic:'eye',label:I.t('ca.ctxShowAll','Pokaż wszystko'),action:()=>{ renderer.setHighlight(null); select(null); }});
    } else {
      items.push({ic:'fit',label:I.t('ca.ctxFit','Dopasuj widok (F)'),action:()=>renderer.fit()});
      items.push({ic:'target',label:I.t('ca.ctxResetRot','Resetuj obrót (R)'),action:()=>renderer.resetRotation()});
      items.push({ic:'crosshair',label:I.t('ca.ctxGraphCenter','Centrum grafu'),action:()=>{ renderer.cam.x=0; renderer.cam.y=0; renderer.onChange(); renderer.kick(); }});
      items.push({sep:true});
      items.push({ic:'expand',label:I.t('ca.ctxExpandAll','Rozwiń wszystko'),action:()=>{ graph.expandAll(); apply({}); }});
      items.push({ic:'collapse',label:I.t('ca.ctxCollapseL2','Zwiń do poziomu 2'),action:()=>{ graph.collapseAll(2); apply({}); }});
      items.push({ic:'collapse',label:I.t('ca.ctxCollapseL1','Zwiń do poziomu 1'),action:()=>{ graph.collapseAll(1); apply({}); }});
      items.push({sep:true});
      items.push({ic:'grid',label:I.t('ca.ctxToggleGrid','Przełącz siatkę tła'),action:()=>{ renderer.opts.showGrid=!renderer.opts.showGrid; $('#opt-grid').checked=renderer.opts.showGrid; renderer.kick(); }});
      items.push({ic:'sparkle',label:I.t('ca.ctxToggleEdgeAnim','Przełącz animacje krawędzi'),action:()=>{ renderer.opts.animateEdges=!renderer.opts.animateEdges; $('#opt-animate').checked=renderer.opts.animateEdges; renderer.kick(); }});
      items.push({ic:'flow',label:I.t('ca.ctxToggleParticles','Przełącz cząsteczki'),action:()=>{ renderer.opts.particles=!renderer.opts.particles; $('#opt-particles').checked=renderer.opts.particles; renderer.kick(); }});
      items.push({ic:'cube',label:I.t('ca.ctxToggle3d','Przełącz perspektywę 3D'),action:()=>renderer.setTilt(renderer.cam.tilt>0.05?0:0.62)});
      items.push({sep:true});
      items.push({ic:'bookmark',label:I.t('ca.ctxSnapshot','Zapisz migawkę'),action:()=>$('#btn-snapshot').click()});
      items.push({ic:'save',label:I.t('ca.ctxSaveMap','Zapisz mapę do pliku'),action:()=>$('#btn-save').click()});
      if(renderer.diffMode) items.push({ic:'x',label:I.t('ca.ctxDisableDiff','Wyłącz tryb różnic'),action:()=>{ renderer.diffMode=false; for(const n of graph.nodes.values())delete n.diff; apply({}); }});
      items.push({sep:true});
      items.push({ic:'settings',label:CM.i18n.t('ctx.settings'),action:()=>CM.Settings.open()});
    }
    UI.ctxMenu(items, x, y);
  }
  function expandBelow(folder){ const walk=(f)=>{ if(f.type==='folder'){f.collapsed=false; for(const c of (f.children||[]))walk(graph.nodes.get(c)); } }; walk(folder); }
  function collapseBelow(folder){ const walk=(f)=>{ if(f.type==='folder'){ for(const c of (f.children||[])){ const ch=graph.nodes.get(c); if(ch&&ch.type==='folder'){ch.collapsed=true; walk(ch);} } } }; walk(folder); }
  function isolateNode(node){ if(!node)return; const {out,inc}=graph.neighbors(node.id); renderer.setHighlight(new Set([node.id,...out,...inc])); }
  async function exportImage(kind, scale){
    const base=((graph.meta&&graph.meta.name)||'codemap').replace(/[^\w.\-]+/g,'_')||'codemap';
    try{
      if(kind==='svg'){
        const svg=renderer.exportSVG();
        if(!svg){ U.toast(I.t('ca.noMapToExport','Brak mapy do eksportu.'),'error'); return; }
        U.download(base+'.svg', svg, 'image/svg+xml');
        U.toast(I.t('ca.exportedSvg','⬡ Mapa wyeksportowana jako SVG.'),'success');
      } else {
        U.toast(I.t('ca.renderingImage','Renderowanie obrazu…'),'',1500);
        const blob=await renderer.exportPNG({scale});
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

  // ---------------- multi-schema comparison ----------------
  const GROUP_COLORS=['#22d3ee','#fb7185','#34d399','#f59e0b','#a78bfa','#38bdf8'];
  function graphBounds(iter){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const n of iter){ if(n.id==='__root__'||!isFinite(n.x)) continue; const r=n.r||8;
      minX=Math.min(minX,n.x-r); maxX=Math.max(maxX,n.x+r); minY=Math.min(minY,n.y-r); maxY=Math.max(maxY,n.y+r); }
    if(!isFinite(minX)) return {minX:0,maxX:0,minY:0,maxY:0};
    return {minX,maxX,minY,maxY};
  }
  function tagBaseGroup(){
    if(state.groups.length) return;
    for(const n of graph.nodes.values()) if(n.gid==null) n.gid='base';
    state.groups.push({gid:'base', name:graph.meta.name||I.t('ca.schema1','schemat 1'), color:GROUP_COLORS[0], owner:graph.meta&&graph.meta.owner});
  }
  function mergeGraph(obj){
    if(!obj || obj.format!=='codemap'){ U.toast(I.t('ca.notCodemapFile','To nie jest plik mapy CodeMap.'),'error'); return; }
    if(state.counts.nodes===0){ loadFromJSON(obj); return; }
    mergeGraphInstance(Graph.fromJSON(obj), obj.meta&&obj.meta.name);
  }
  function mergeGraphInstance(g2, name){
    if(state.counts.nodes===0){ loadFromJSON(g2.toJSON()); return; }
    tagBaseGroup();
    const gid='g'+(++state.gidSeq);
    const color=GROUP_COLORS[state.groups.length%GROUP_COLORS.length];
    const pref=(id)=>gid+':'+id;
    for(const n of g2.nodes.values()){
      const c=Object.assign({}, n);
      c.id=pref(n.id); c.parent=n.parent!=null?pref(n.parent):null;
      c.children=(n.children||[]).map(pref);
      c.x=(n.x||0); c.y=(n.y||0); c.vx=0; c.vy=0; c.gid=gid; c._placed=false;
      c.importsIn=[]; c.importsOut=[];
      graph.nodes.set(c.id, c);
    }
    // merge language stats so left-panel tools cover ALL loaded schemas
    for(const [k,s] of g2.langStats){
      if(!graph.langStats.has(k)) graph.langStats.set(k, {key:k, info:s.info, count:0, bytes:0, lines:0, on:true});
      const d=graph.langStats.get(k); d.count+=s.count; d.bytes+=s.bytes||0; d.lines+=s.lines||0;
    }
    for(const e of g2.edges){
      const sid=pref(e.source), tid=pref(e.target);
      if(!graph.nodes.has(sid)||!graph.nodes.has(tid)) continue;
      graph.edges.push({id:gid+'e'+graph.edges.length, source:sid, target:tid, type:e.type});
      // recompute import degrees for the merged schema (was left at 0 → context menu / hotspots / details
      // showed "zależności wychodzące (0)" for every merged node). Only its OWN new edges, no double count.
      if(e.type==='import'||e.type==='reference'){ const s=graph.nodes.get(sid), t=graph.nodes.get(tid); s.importsOut.push(tid); t.importsIn.push(sid); }
    }
    const gname=name||g2.meta.name||(I.t('ca.schemaN','schemat ')+(state.groups.length+1));
    state.groups.push({gid, name:gname, color, owner:g2.meta&&g2.meta.owner});
    renderer.setGroups(state.groups);
    countsInit();
    // the new schema adopts the SAME layout as the one already on the map, lined up beside it
    state.layout=state.displayLayout||'force';
    apply({relayout:true, refit:true});
    U.toast(I.t('ca.schemaAddedPre','Dodano schemat „')+gname+I.t('ca.schemaAddedMid','" w układzie „')+state.layout+I.t('ca.schemaAddedPost','". Przeciągnij jego etykietę, aby go przesunąć.'),'success',5200);
  }
  // build a standalone graph from a source (files/GitHub) and merge it for comparison
  async function addCompareSource(factory, status){
    if(state.counts.nodes===0){ U.toast(I.t('ca.loadMainFirst','Najpierw wczytaj główny projekt.'),'error'); return; }
    const gen=++_ingestGen;   // additive merge, but Cancel / a newer load must still abort it (no resetProjectState — that would wipe the base)
    showLoading(status);
    try{
      const {files, meta}=await factory(setProgress, setLoadingText);
      if(gen!==_ingestGen) return;
      if(!files||!files.length){ U.toast(I.t('ca.noMatchingFiles','Nie znaleziono pasujących plików.'),'error'); hideLoading(); return; }
      setLoadingText(I.t('ca.buildingCompareSchema','Budowanie schematu porównawczego…')); await tick();
      if(gen!==_ingestGen) return;
      const g2=new Graph(); g2.build(files, meta);
      const f2={folders:true,files:true,externals:false,contains:true,import:true,reference:true,langsOff:new Set()};
      const vis2=g2.getVisible(f2);
      Layouts.apply('force', g2, vis2, {spacing:state.spacing});
      mergeGraphInstance(g2, meta.name);
    }catch(e){ if(gen!==_ingestGen) return; console.error(e); U.toast(I.t('ca.loadError','Błąd wczytywania: ')+e.message,'error',6000); }
    if(gen===_ingestGen) hideLoading();
  }
  function clearCompare(){
    if(state.groups.length<=0){ U.toast(I.t('ca.noCompareSchemas','Brak schematów porównawczych.'),'error'); return; }
    for(const [id,n] of Array.from(graph.nodes.entries())){ if(n.gid && n.gid!=='base'){ graph.nodes.delete(id); } }
    graph.edges=graph.edges.filter(e=>{ return graph.nodes.has(e.source)&&graph.nodes.has(e.target); });
    for(const n of graph.nodes.values()) delete n.gid;
    state.groups=[]; renderer.setGroups([]);
    state.vis=graph.getVisible(filters); renderer.setData(graph, state.vis, null);
    countsInit(); updateStatus(); requestAnimationFrame(()=>renderer.fit());
    U.toast(I.t('ca.compareSchemasRemoved','Usunięto schematy porównawcze.'),'success');
  }
  function wireCompare(){
    $('#btn-compare-add').onclick=()=>{ if(state.counts.nodes===0){ U.toast(I.t('ca.loadMainFirst','Najpierw wczytaj główny projekt.'),'error'); return; } openModal('modal-compare'); };
    $('#cmp-gh-go').onclick=()=>{
      const url=$('#cmp-gh-url').value.trim(); if(!url){ U.toast(I.t('ca.enterRepoAddress','Podaj adres repozytorium.'),'error'); return; }
      closeModal($('#modal-compare'));
      addCompareSource((p,s)=>Loaders.fromRepoURL(url, {fetchContent:true}, p, s), I.t('ca.connectingToRepo','Łączenie z repozytorium…'));
    };
    $('#cmp-gh-url').onkeydown=(e)=>{ if(e.key==='Enter') $('#cmp-gh-go').click(); };
    $('#cmp-files').onclick=()=>$('#input-compare-files').click();
    $('#cmp-map').onclick=()=>$('#input-compare').click();
    $('#input-compare-files').onchange=(e)=>{ if(e.target.files.length){ closeModal($('#modal-compare'));
      const files=e.target.files; addCompareSource((p)=>Loaders.fromFileList(files,p),I.t('ca.readingFiles','Czytanie plików…')); } e.target.value=''; };
    $('#input-compare').onchange=async(e)=>{ const f=e.target.files[0]; if(!f)return; closeModal($('#modal-compare'));
      try{ const obj=await Storage.openMap(f); mergeGraph(obj); }catch(err){ U.toast(err.message,'error'); } e.target.value=''; };
    $('#btn-compare-clear').onclick=clearCompare;
    $('#btn-cycles').onclick=toggleCycles;
    $('#btn-hotspots').onclick=()=>{ if(state.counts.nodes===0){ U.toast(I.t('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; } UI.renderHotspots(graph, handlers); openModal('modal-hotspots'); };
    const bi=$('#btn-inspect'); if(bi) bi.onclick=()=>{ if(state.counts.nodes===0){ U.toast(I.t('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; } if(CM.Inspect) CM.Inspect.open(); };
  }
  // detect & highlight import dependency cycles (toggle)
  function toggleCycles(){
    if(state.cyclesOn){ state.cyclesOn=false; renderer.setCycles(null); U.toast(I.t('ca.cyclesOff','Wyłączono podświetlenie cykli.'),'',1600); return; }
    if(state.counts.nodes===0){ U.toast(I.t('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; }
    const res=graph.importCycles();
    if(!res.components.length){ U.toast(I.t('ca.noCycles','Nie wykryto cykli zależności. 🎉'),'success',3000); renderer.setCycles(null); return; }
    state.cyclesOn=true; renderer.setCycles(res.edges);
    const biggest=res.components.slice().sort((a,b)=>b.length-a.length)[0]||[];
    const sample=biggest.slice(0,4).map(id=>{ const n=graph.nodes.get(id); return n?n.name:id; }).join(' → ');
    U.toast(I.t('ca.cyclesFoundPre','Wykryto <b>')+res.components.length+I.t('ca.cyclesFoundMid','</b> cykli zależności (')+res.nodes.size+I.t('ca.cyclesFoundMid2',' plików). Największy: ')+sample+(biggest.length>4?' → …':'')+I.t('ca.cyclesFoundPost','. Kliknij ponownie, aby wyłączyć.'),'',7000);
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
      const n=id?graph.nodes.get(id):null; UI.tooltip(n||null, e.clientX, e.clientY); cv.style.cursor=n?'pointer':'grab'; });
    cv.addEventListener('mouseleave',()=>UI.tooltip(null));
    window.addEventListener('resize',()=>{ if(hoodState.open) drawHood(); });
    $('#hood-teleport').onclick=()=>{ if(hoodState.sel) teleportTo(hoodState.sel); };
  }
  function offsetXY(e,cv){ const r=cv.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }
  function hoodPick(mx,my){ let best=null,bd=Infinity; for(const h of hoodHits){ const d=Math.hypot(mx-h.x,my-h.y); if(d<=h.rad+4 && d<bd){bd=d;best=h.id;} } return best; }
  function updateTeleport(){
    const t=$('#hood-teleport'); const n=hoodState.sel?graph.nodes.get(hoodState.sel):null;
    if(!n){ t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    t.querySelector('#hood-teleport-name').textContent = n.name + (n.type==='folder'?I.t('ca.folderSuffix','  (folder)'):'');
  }
  function teleportTo(id){ closeHood(); setTimeout(()=>focusNode(id), 180); }
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
      renderer.drawNodeSprite(ctx, p.x, p.y, rad, col, hoodState.tilt);
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
    const go=(e)=>{ const m=renderer._mm; if(!m)return; const r=mm.getBoundingClientRect();
      const wx=((e.clientX-r.left)-m.ox)/m.sc, wy=((e.clientY-r.top)-m.oy)/m.sc;
      renderer.cam.x=wx; renderer.cam.y=wy; renderer.onChange(); renderer.kick(); };
    let down=false;
    mm.addEventListener('mousedown',(e)=>{down=true;go(e);});
    window.addEventListener('mousemove',(e)=>{if(down)go(e);});
    window.addEventListener('mouseup',()=>down=false);
    // collapse / expand minimap
    const wrap=$('#minimap-wrap'), tgl=$('#minimap-toggle');
    if(tgl) tgl.onclick=(e)=>{ e.stopPropagation(); wrap.classList.toggle('mm-collapsed');
      if(!wrap.classList.contains('mm-collapsed')) renderer.drawMinimap($('#minimap'));
      positionMinimap(); setTimeout(positionMinimap, 240); };   // re-centre for the new size (now + after transition)
    window.addEventListener('resize', positionMinimap);
    // the welcome card's height settles after async content (fonts, "restore last map" button) — observe
    // it so the minimap re-centres whenever the card's box changes, not just on the first frame.
    const card=$('.empty-card');
    if(card && window.ResizeObserver){ try{ new ResizeObserver(()=>positionMinimap()).observe(card); }catch(e){} }
    // start minimized (no project yet) and wait for a file structure; expand only once one loads
    if(state.counts.nodes===0) wrap.classList.add('mm-collapsed');
    positionMinimap(); setTimeout(positionMinimap,150); setTimeout(positionMinimap,650);
    if(document.fonts&&document.fonts.ready) document.fonts.ready.then(positionMinimap).catch(()=>{});
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
      rot=true; startA=ptrAngle(e); startRot=renderer.cam.rot; dial.classList.add('rotating'); e.preventDefault();
    });

    // ---- GRIP: move the compass anywhere (disabled while pinned) ----
    let mov=false, offX=0, offY=0;
    grip.addEventListener('mousedown',(e)=>{
      if(dial.classList.contains('pinned')) return;
      const r=dial.getBoundingClientRect(); offX=e.clientX-r.left; offY=e.clientY-r.top;
      mov=true; dial.classList.add('dragging'); e.preventDefault(); e.stopPropagation();
    });

    window.addEventListener('mousemove',(e)=>{
      if(rot){ let d=ptrAngle(e)-startA; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI; renderer.setRotation(startRot + d*0.5); }
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
        case 'f': case 'F': renderer.fit(); break;
        case '+': case '=': renderer.zoomBy(1.3); break;
        case '-': case '_': renderer.zoomBy(1/1.3); break;
        case 'q': case 'Q': renderer.rotateBy(-Math.PI/12); break;
        case 'e': case 'E': renderer.rotateBy(Math.PI/12); break;
        case 'r': case 'R': renderer.resetRotation(); break;
        case 't': case 'T': renderer.setTilt(renderer.cam.tilt>0.05?0:0.62); break;
        case 'i': case 'I': if(renderer.selected) isolateNode(renderer.selected); break;   // skupienie na zaznaczonym
        case 'x': case 'X': toggleImpact(); break;   // widok wpływu zależności (upstream/downstream)
        case '/': e.preventDefault(); $('#search-input').focus(); break;
        case 'Escape': UI.hideCtx(); select(null); renderer.setHighlight(null); break;
        case 'ArrowUp': renderer.cam.y-=40/renderer.cam.zoom; renderer.onChange(); renderer.kick(); break;
        case 'ArrowDown': renderer.cam.y+=40/renderer.cam.zoom; renderer.onChange(); renderer.kick(); break;
        case 'ArrowLeft': renderer.cam.x-=40/renderer.cam.zoom; renderer.onChange(); renderer.kick(); break;
        case 'ArrowRight': renderer.cam.x+=40/renderer.cam.zoom; renderer.onChange(); renderer.kick(); break;
      }
    });
  }

  // ---------------- game-style navigation: WASD fly + mouse-look (FPS turning) ----------------
  function wireGameNav(){
    const cv = renderer.canvas;
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
      const cam=renderer.cam, W=renderer.w, H=renderer.h; let moved=false;
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
      if(moved){ renderer.onChange(); renderer.kick(); }
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
      if(e.movementX) renderer.cam.rot += e.movementX*LOOK_X;
      if(e.movementY) renderer.cam.tilt = U.clamp(renderer.cam.tilt + e.movementY*LOOK_Y, 0, 0.85);
      renderer.onChange(); renderer.kick();
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

  // ---------------- demo dataset ----------------
  function demoFiles(){
    const F=(path,content)=>({path, size:content.length, content, mtime:Date.now()});
    return [
      F('package.json', '{\n "name":"demo-app",\n "dependencies":{"react":"^18","lodash":"^4"}\n}'),
      F('README.md', '# Demo App\nMapa przykładowa.\nZobacz [architekturę](./docs/arch.md) oraz [src/app.js](./src/app.js).'),
      F('src/app.js', "import { createStore } from './store/index.js';\nimport { Header } from './components/Header.jsx';\nimport { api } from './services/api.js';\nimport { format } from './utils/format.js';\nimport React from 'react';\n// główny punkt wejścia\nexport function main(){ const s=createStore(); return Header(s); }\n"),
      F('src/store/index.js', "import { reducer } from './reducer.js';\nimport { logger } from '../utils/logger.js';\nexport function createStore(){ logger('init'); return { state:reducer({},{}) }; }\n"),
      F('src/store/reducer.js', "import { ACTIONS } from './actions.js';\nexport function reducer(state, action){ switch(action.type){ case ACTIONS.INC: return state; default: return state; } }\n"),
      F('src/store/actions.js', "export const ACTIONS = { INC:'INC', DEC:'DEC' };\n"),
      F('src/components/Header.jsx', "import React from 'react';\nimport { Button } from './Button.jsx';\nimport { api } from '../services/api.js';\nimport './header.css';\nexport function Header(store){ return Button({label:'Menu'}); }\n"),
      F('src/components/Button.jsx', "import React from 'react';\nimport { format } from '../utils/format.js';\nexport function Button(p){ return format(p.label); }\n"),
      F('src/components/header.css', "@import '../styles/theme.css';\n.header{ display:flex; background:var(--bg); }\n.header .logo{ width:32px; }\n"),
      F('src/styles/theme.css', ":root{ --bg:#0a0e14; --fg:#cdd6e4; }\nbody{ background:var(--bg); color:var(--fg); }\n"),
      F('src/services/api.js', "import { logger } from '../utils/logger.js';\nimport axios from 'axios';\nexport const api = { get(u){ logger('GET '+u); } };\n"),
      F('src/utils/format.js', "// formatowanie\nexport function format(s){ return String(s).trim(); }\n"),
      F('src/utils/logger.js', "export function logger(msg){ if(typeof console!=='undefined') console.log('[log]', msg); }\n"),
      F('src/index.html', '<!doctype html>\n<html><head><link rel="stylesheet" href="styles/theme.css"></head>\n<body><script src="app.js"></script></body></html>'),
      F('docs/arch.md', '# Architektura\nModuł `store` zarządza stanem, `components` to UI, `services` to integracje.\nPatrz [api](../src/services/api.js).'),
      F('tests/format.test.js', "import { format } from '../src/utils/format.js';\ndescribe('format', ()=>{ it('trims', ()=>{ expect(format(' a ')).toBe('a'); }); });\n"),
      F('scripts/build.py', "import os, sys\nfrom pathlib import Path\n# prosty skrypt build\ndef build():\n    print('building...')\nif __name__=='__main__':\n    build()\n"),
    ];
  }
  function loadDemo(){ ingest(()=>Promise.resolve({files:demoFiles(), meta:{name:'demo-app', source:'demo: demo-app', kind:'demo', createdAt:Date.now()}}),I.t('ca.loadingDemo','Ładowanie projektu demo…')); }

  // ---------------- go ----------------
  function boot(){ init();
    if(location.hash==='#demo') setTimeout(loadDemo,150);
    else if(location.hash.startsWith('#v=')) setTimeout(()=>{ restoreView().catch(()=>{}); },150);
    autoTutorial();
  }
  // First launch of the INSTALLED app (also after a re-install) → start the tutorial automatically.
  // 'appinstalled' sets a flag consumed on the next standalone launch; the legacy no-flag case
  // (installed before this feature) runs once via codemap_tut_auto.
  window.addEventListener('appinstalled',()=>{ try{ localStorage.setItem('codemap_fresh_install','1'); }catch(e){} });
  function autoTutorial(){
    let standalone=false;
    try{ standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone===true; }catch(e){}
    if(!standalone) return;
    let go=false;
    try{
      if(localStorage.getItem('codemap_fresh_install')==='1'){ localStorage.removeItem('codemap_fresh_install'); go=true; }
      else if(!localStorage.getItem('codemap_tut_auto')) go=true;
      if(go) localStorage.setItem('codemap_tut_auto','1');
    }catch(e){}
    if(go) setTimeout(()=>{ try{ if(CM.Settings&&CM.Settings.startTutorial) CM.Settings.startTutorial('codemap'); }catch(e){} }, 1100);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // ====================== ChatBot integration: app knowledge + action dispatcher ======================
  const CB_LAYOUTS=['pack','structtree','structradial','treemap','icicle','sunburst','force','layered','modules','arcdiagram','galaxy','nebula','cosmicrings'];
  // full, live snapshot of what the app currently is/shows — fed to ChatBot so it "knows everything"
  function appState(){
    const mind=document.body.classList.contains('mode-mindmap');
    const sel=renderer&&renderer.selected;
    const out={
      mode: mind?'mindmap':'codemap',
      hasProject: state.counts.nodes>0,
      project: (graph&&graph.meta&&(graph.meta.name||graph.meta.source))||null,
      counts:{ nodes:state.counts.nodes, edges:state.counts.edges, visible:state.vis.nodes.length },
      layout: state.layout,
      filters:{ folders:filters.folders, files:filters.files, externals:filters.externals,
                contains:filters.contains, imports:filters.import, references:filters.reference,
                metric:filters.metric, minMetric:filters.minMetric },
      theme: document.body.classList.contains('light')?'light':'dark',
      lang: I.getLang(),
      impactView: !!impactOn,
      selected: sel?{name:sel.name, path:sel.path||null, type:sel.type}:null,
      availableLayouts: CB_LAYOUTS,
      mindmap: (CM.MindMap&&CM.MindMap.isActive&&CM.MindMap.isActive())?{nodes:(CM.MindMap.nodeCount?CM.MindMap.nodeCount():0), name:(CM.MindMap.mapName?CM.MindMap.mapName():'')}:null,
    };
    if(state.counts.nodes>0){ try{ out.structure=aiStructureSummary(); }catch(e){} }
    return out;
  }
  function _cb(id,val){ const e=$('#'+id); if(!e) return false; if(typeof val==='boolean') e.checked=val;
    e.dispatchEvent(new Event('change',{bubbles:true})); e.dispatchEvent(new Event('input',{bubbles:true})); return true; }
  function _needProject(){ if(state.counts.nodes===0) throw new Error(I.t('cb.noProject','Najpierw wczytaj projekt (CodeMap).')); }
  // execute a named action against the app; returns a short human result string (throws on error)
  function exec(action, args){
    args=args||{};
    switch(action){
      case 'loadDemo': loadDemo(); return I.t('cb.execDemo','Załadowano projekt demonstracyjny.');
      case 'setMode': { const m=(args.mode||'').toLowerCase(); if(m!=='codemap'&&m!=='mindmap') throw new Error('mode: codemap|mindmap'); setMode(m); return I.t('cb.execMode','Tryb: ')+m; }
      case 'setLayout': { _needProject(); const ly=(args.layout||'').toLowerCase(); if(CB_LAYOUTS.indexOf(ly)<0) throw new Error(I.t('cb.badLayout','Nieznany układ: ')+ly+' ('+CB_LAYOUTS.join(', ')+')');
        const s=$('#sel-layout'); s.value=ly; state.layout=ly; state.displayLayout=ly; apply({relayout:true,refit:true});
        const lbl=$('#layout-menu-label'), opt=s.querySelector('option[value="'+ly+'"]'); if(lbl&&opt) lbl.textContent=opt.textContent;
        return I.t('cb.execLayout','Układ: ')+ly; }
      case 'search': { const q=(args.query||'').trim(); const inp=$('#search-input'); inp.value=q; inp.dispatchEvent(new Event('input',{bubbles:true})); return I.t('cb.execSearch','Szukam: ')+q; }
      case 'focusNode': { _needProject(); const q=(args.query||args.name||'').toLowerCase().trim(); if(!q) throw new Error(I.t('cb.needName','Podaj nazwę elementu.'));
        let best=null,bs=-1; for(const n of graph.nodes.values()){ if(n.id==='__root__'||n.id==='__ext__')continue; const nm=(n.name||'').toLowerCase(),pt=(n.path||'').toLowerCase();
          let s=nm===q?100:(nm.indexOf(q)===0?70:(nm.indexOf(q)>=0?50:(pt.indexOf(q)>=0?30:-1))); if(s>bs){bs=s;best=n;} }
        if(!best) throw new Error(I.t('cb.notFound','Nie znaleziono: ')+q); focusNode(best.id); return I.t('cb.execFocus','Skupiono na: ')+best.name; }
      case 'fit': if(renderer&&renderer.fit) renderer.fit(); return I.t('cb.execFit','Dopasowano widok.');
      case 'toggleImpact': _needProject(); toggleImpact(); return I.t('cb.execImpact','Przełączono widok wpływu zależności.');
      case 'setFilter': { const map={folders:'show-folders',files:'show-files',externals:'show-externals',contains:'edge-contains',imports:'edge-import',import:'edge-import',references:'edge-reference',reference:'edge-reference'};
        const ch=[]; for(const k in args){ const id=map[k]; if(id&&typeof args[k]==='boolean'){ if(_cb(id,args[k])) ch.push(k+'='+args[k]); } }
        if(!ch.length) throw new Error(I.t('cb.noFilter','Brak rozpoznanych filtrów (folders/files/externals/imports/references/contains).')); return I.t('cb.execFilter','Filtry: ')+ch.join(', '); }
      case 'openSettings': if(CM.Settings) CM.Settings.open(args.tab||undefined); return I.t('cb.execSettings','Otwarto Ustawienia.');
      case 'openDrive': if(CM.Drive) CM.Drive.open(args.tab||undefined); return I.t('cb.execDrive','Otwarto Dysk i Sejf.');
      case 'saveMap': _needProject(); $('#btn-save').click(); return I.t('cb.execSave','Zapisano mapę do pliku .json.');
      case 'snapshot': _needProject(); $('#btn-snapshot').click(); return I.t('cb.execSnap','Zapisano migawkę.');
      case 'detectCycles': _needProject(); $('#btn-cycles').click(); return I.t('cb.execCycles','Wykrywanie cykli zależności.');
      case 'hotspots': _needProject(); $('#btn-hotspots').click(); return I.t('cb.execHot','Pokazano hotspoty.');
      case 'setTheme': { const th=(args.theme||'').toLowerCase()==='light'?'light':'dark'; const b=document.querySelector('.theme-btn[data-theme="'+th+'"]'); if(b) b.click(); return I.t('cb.execTheme','Motyw: ')+th; }
      case 'setPreset': { const k=(args.name||args.preset||'').toLowerCase();
        if(!THEME_PRESETS[k]||!_applyThemePreset) throw new Error(I.t('cb.badPreset','Nieznany preset: ')+k+' ('+Object.keys(THEME_PRESETS).join(', ')+')');
        _applyThemePreset(k); saveSettings(); return I.t('cb.execPreset','Preset motywu: ')+k; }
      case 'setAccent': { const c=args.color; if(!c||!/^#?[0-9a-f]{3,8}$/i.test(c)) throw new Error(I.t('cb.badColor','Podaj kolor HEX, np. #22d3ee.')); const e=$('#col-accent'); e.value=c[0]==='#'?c:('#'+c); e.dispatchEvent(new Event('input',{bubbles:true})); return I.t('cb.execAccent','Kolor akcentu: ')+e.value; }
      case 'setLang': { const l=(args.lang||'').toLowerCase(); if(l!=='pl'&&l!=='en') throw new Error('lang: pl|en'); I.setLang(l); return I.t('cb.execLang','Język: ')+l; }
      case 'startTutorial': { const m=(args.mode||'codemap').toLowerCase(); if(m!=='codemap'&&m!=='mindmap') throw new Error('mode: codemap|mindmap');
        if(CM.Settings&&CM.Settings.close) CM.Settings.close(); CM.Settings.startTutorial(m); return I.t('cb.execTut','Uruchomiono samouczek: ')+m; }
      case 'loadRepo': { const u=(args.url||'').trim(); if(!u) throw new Error(I.t('cb.needUrl','Podaj adres repozytorium (GitHub/GitLab/Bitbucket).'));
        ingest((p,s)=>Loaders.fromRepoURL(u,{branch:args.branch,fetchContent:true},p,s), I.t('ca.connectingToRepo','Łączenie z repozytorium…'));
        return I.t('cb.execRepo','Wczytuję repozytorium: ')+u; }
      case 'clearProject': _needProject(); clearAll(); return I.t('cb.execClear','Wyczyszczono projekt.');
      case 'togglePanel': { const side=(args.side||'').toLowerCase(); if(side!=='left'&&side!=='right') throw new Error('side: left|right');
        const p=$('#'+side+'-panel'); const collapsed=p.classList.contains('collapsed');
        const want=(typeof args.open==='boolean')?args.open:collapsed;
        if(want===collapsed) togglePanel(side); return I.t('cb.execPanel','Panel ')+side+': '+(want?I.t('cb.on','wł'):I.t('cb.off','wył')); }
      case 'zoom': { const d=(args.dir||'').toLowerCase(); const id=d==='out'?'vc-zoom-out':'vc-zoom-in'; const b=$('#'+id); if(b) b.click(); return I.t('cb.execZoom','Zoom: ')+(d==='out'?'−':'+'); }
      case 'rotate': { const d=(args.dir||'').toLowerCase(); const id=d==='left'?'vc-rot-left':d==='right'?'vc-rot-right':'vc-rot-reset'; const b=$('#'+id); if(b) b.click(); return I.t('cb.execRotate','Obrót: ')+d; }
      case 'toggle3D': { const b=$('#vc-3d'); if(b) b.click(); return I.t('cb.exec3D','Przełączono widok 3D.'); }
      case 'flyMode': { const b=$('#vc-fly'); if(b) b.click(); return I.t('cb.execFly','Przełączono tryb lotu (WASD).'); }
      case 'collapseAll': { _needProject(); const b=$('#vc-collapse'); if(b) b.click(); return I.t('cb.execCollapse','Zwinięto/rozwinięto foldery.'); }
      case 'toggleMinimap': { const b=$('#minimap-toggle'); if(b) b.click(); return I.t('cb.execMinimap','Przełączono minimapę.'); }
      case 'openHistory': { _needProject(); $('#btn-history').click(); return I.t('cb.execHist','Otwarto historię migawek.'); }
      case 'openCompare': { $('#btn-compare-add').click(); return I.t('cb.execCompare','Otwarto porównywanie schematów.'); }
      case 'exportImage': { _needProject(); $('#btn-export-img').click(); return I.t('cb.execImg','Eksportuję obraz mapy.'); }
      case 'copyLink': copyViewLink(); return I.t('cb.execLink','Kopiuję link do bieżącego widoku.');
      case 'setSpacing': case 'setNodeScale': case 'setFontScale': {
        const id=action==='setSpacing'?'rng-spacing':action==='setNodeScale'?'rng-nscale':'rng-fscale';
        const v=+args.percent; if(!isFinite(v)) throw new Error(I.t('cb.needPercent','Podaj wartość procentową, np. 120.'));
        const e=$('#'+id); e.value=Math.round(v); e.dispatchEvent(new Event('input',{bubbles:true}));
        return I.t('cb.execSlider','Ustawiono ')+id.replace('rng-','')+': '+e.value+'%'; }
      case 'setGlass': { const map={transparency:'rng-trans',menu:'rng-menu',blur:'rng-blur',tint:'rng-tint'}; const ch=[];
        for(const k in map){ if(typeof args[k]==='number'){ const e=$('#'+map[k]); if(e){ e.value=Math.round(args[k]); e.dispatchEvent(new Event('input',{bubbles:true})); ch.push(k+'='+e.value); } } }
        if(!ch.length) throw new Error(I.t('cb.noGlass','Podaj transparency/menu/blur/tint (liczby).')); return I.t('cb.execGlass','Wygląd: ')+ch.join(', '); }
      case 'setBackground': { const c=args.color; if(!c||!/^#?[0-9a-f]{3,8}$/i.test(c)) throw new Error(I.t('cb.badColor','Podaj kolor HEX, np. #22d3ee.')); const e=$('#col-bg'); e.value=c[0]==='#'?c:('#'+c); e.dispatchEvent(new Event('input',{bubbles:true})); return I.t('cb.execBg','Kolor tła: ')+e.value; }
      case 'resetAppearance': resetAppearance(); return I.t('cb.execResetApp','Przywrócono domyślny wygląd.');
      case 'renderOption': { const map={grid:'opt-grid',curved:'opt-curved',lockall:'opt-lockall',hoverPreview:'opt-hover-preview'}; const ch=[];   // glow/particles/animate removed — edge animation was dropped, those opts no longer affect rendering
        for(const k in args){ const id=map[k]; if(id&&typeof args[k]==='boolean'){ if(_cb(id,args[k])) ch.push(k+'='+args[k]); } }
        if(!ch.length) throw new Error(I.t('cb.noOpt','Brak rozpoznanych opcji (grid/curved/lockall/hoverPreview).')); return I.t('cb.execOpt','Opcje: ')+ch.join(', '); }
      case 'setMetric': { _needProject(); if(args.metric){ const s=$('#sel-metric'); s.value=args.metric; s.dispatchEvent(new Event('change',{bubbles:true})); }
        if(typeof args.min==='number'){ const r=$('#rng-minmetric'); r.value=args.min; r.dispatchEvent(new Event('input',{bubbles:true})); }
        return I.t('cb.execMetric','Metryka: ')+(args.metric||filters.metric)+(typeof args.min==='number'?(' ≥ '+args.min):''); }
      case 'toggleLang': { _needProject(); const k=(args.lang||'').toLowerCase(); if(!k) throw new Error(I.t('cb.needLangKey','Podaj język/technologię, np. js.'));
        if(!graph.langStats.has(k)) throw new Error(I.t('cb.notFound','Nie znaleziono: ')+k+' ('+Array.from(graph.langStats.keys()).join(', ')+')');
        toggleLang(k); apply({relayout:false}); return I.t('cb.execToggleLang','Przełączono widoczność: ')+k; }
      case 'openNode': { _needProject(); const r=exec('focusNode',args); const n=renderer.selected; if(n&&n.type==='file'){ handlers.openFile(n); return I.t('cb.execOpenFile','Otwarto podgląd pliku: ')+n.name; } return r; }
      case 'aiAnalyze': _needProject(); aiAnalyze(); return I.t('cb.execAnalyze','Uruchomiono analizę struktury AI.');
      case 'inspect': case 'runInspection': { _needProject(); if(CM.Inspect&&CM.Inspect.open){ CM.Inspect.open(); return I.t('cb.execInspect','Uruchomiono analizę statyczną (antywzorce).'); } throw new Error(I.t('cb.noInspect','Moduł analizy niedostępny.')); }
      case 'mindmap': { const a=(args.action||'').toLowerCase(); const ids={arrange:'mm-arrange',layout:'mm-layout',fit:'mm-fit',save:'mm-save',markdown:'mm-markdown',undo:'mm-undo'};
        if(!(a in ids)) throw new Error('action: arrange|layout|fit|save|markdown|undo');
        if(!document.body.classList.contains('mode-mindmap')) setMode('mindmap');
        const go=()=>{ const b=document.getElementById(ids[a]); if(b) b.click(); }; setTimeout(go,260);
        return I.t('cb.execMind','MindMap: ')+a; }
      case 'installPWA': if(state._installApp){ state._installApp(); return I.t('cb.execPWA','Uruchomiono instalację aplikacji.'); } throw new Error(I.t('cb.noPWA','Instalacja PWA niedostępna w tej chwili.'));
      case 'help': case 'listActions': return I.t('cb.execHelp','Dostępne akcje: ')+CB_ACTIONS.join(', ');
      default: throw new Error(I.t('cb.unknownAction','Nieznana akcja: ')+action+'. '+I.t('cb.execHelp','Dostępne akcje: ')+CB_ACTIONS.join(', '));
    }
  }
  // canonical action list — also injected into the ChatBot system prompt so the model knows the full API
  const CB_ACTIONS=['loadDemo','loadRepo','clearProject','setMode','setLayout','search','focusNode','openNode','fit',
    'zoom','rotate','toggle3D','flyMode','collapseAll','toggleImpact','toggleMinimap','setFilter','setMetric','toggleLang',
    'openSettings','openDrive','openHistory','openCompare','saveMap','snapshot','exportImage','copyLink','detectCycles',
    'hotspots','inspect','aiAnalyze','setTheme','setPreset','setAccent','setBackground','setGlass','setSpacing','setNodeScale','setFontScale',
    'renderOption','resetAppearance','togglePanel','setLang','startTutorial','mindmap','installPWA','help'];

  window.CMApp={get graph(){return graph;}, apply, focusNode, loadDemo, toggleImpact, copyViewLink, serializeView,
    impactState:()=>impactOn,
    loadFiles:(files,meta)=>ingest(()=>Promise.resolve({files,meta}),'test'),
    loadFromJSON,
    hasMap:()=>state.counts.nodes>0,
    mapName:()=>(graph&&graph.meta&&(graph.meta.name||graph.meta.source))||'mapa',
    mapJSON:()=>(graph&&state.counts.nodes>0)?graph.toJSON():null,
    appState, exec,                       // ← ChatBot uses these
    renderer:()=>renderer};
})();
