/* ===================== navigation.js — nawigacja po mapie ===================== */
// Radar okolicy (drawHood i pomocnicze), minimapa, tarcza obrotu (wireRotDial/updateRotDial), nawigacja
// WASD / tryb lotu (wireGameNav), menu kontekstowe, isolateNode/expandBelow/collapseBelow, eksport obrazu.
// Dopisuje się do CM.App (A).
(function(){
  const A=CM.App;
  const U=CM.util, $=U.$, I=CM.i18n;
  const UI=CM.UI;
  const state=A.state, handlers=A.handlers;   // pola stałe kontekstu (nigdy nie podmieniane)

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
    updateRotDial, contextMenu, expandBelow, collapseBelow, isolateNode, exportImage, wireNeighborhood, offsetXY,
    hoodPick, updateTeleport, teleportTo, openHood, closeHood, drawHood, wireMinimap, wireRotDial,
    wireGameNav,
  });
})();
