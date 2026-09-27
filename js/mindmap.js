/* ===================== mindmap.js — tryb MindMap (edytor map myśli na DOM) =====================
   CM.MindMap — edytor, renderowanie i interakcja: karty na płótnie (pan / zoom / pinch), zaznaczanie,
   łączenie, edycja w miejscu, menu kontekstowe i pierścień narzędzi, inspektor, cofanie / ponawianie.
   Moduły pomocnicze (ładowane wcześniej): CM.MindMapStrings (słowniki tekstów), CM.MindMapTemplates
   (ramki kart, 34 diagramy, karta kodu), CM.MindMapLayout (algorytmy i okno układu), CM.MindMapIO
   (Markdown, plik .mindmap.json, SVG / PNG, zapis lokalny, migawki), CM.MindMapUI (okno tekstu, popover,
   menu). Stan i akcje edytora dostają przez jawny obiekt ctx (niżej) — bez odwołań zwrotnych do CM.MindMap. */
CM.MindMap = (function(){
  const U = CM.util, $ = U.$, I = CM.i18n, T = CM.MindMapTemplates, L = CM.MindMapLayout, IO = CM.MindMapIO;
  let root=null, world=null, svg=null, canvas=null, inspector=null;
  let cam={x:0,y:0,zoom:1};
  const state={ nodes:[], edges:[], seq:1, name:I.t('cm.defaultMapName','Nowa mapa myśli'), layout:'free', line:'curved', colorSchema:true, spaceMain:240, spaceCross:70 };
  let selected=null, connectMode=false, connectFrom=null, reattachMode=false, built=false, active=false;
  let multi=new Set(), marqueeEl=null;   // multi-selection (Shift-click / Shift-drag box)
  let clipboard=null, surround=null, layoutDlg=null;

  // ---- undo / redo (JSON snapshots of the working state) ----
  let _undo=[], _redo=[];
  function mmSnap(){ return JSON.stringify({nodes:state.nodes, edges:state.edges, seq:state.seq, name:state.name, layout:state.layout, line:state.line, spaceMain:state.spaceMain, spaceCross:state.spaceCross,
    draw:(CM.Draw&&CM.Draw.serialize)?CM.Draw.serialize():[]}); }
  function pushUndo(){ try{ _undo.push(mmSnap()); }catch(e){ return; } if(_undo.length>80) _undo.shift(); _redo.length=0; refreshUndoBtns(); }
  function pushUndoSnap(s){ if(!s) return; _undo.push(s); if(_undo.length>80) _undo.shift(); _redo.length=0; refreshUndoBtns(); }
  function mmRestore(s){ const o=JSON.parse(s);
    state.nodes=o.nodes; state.edges=o.edges; state.seq=o.seq; state.name=o.name; state.layout=o.layout; state.line=o.line;
    if(o.spaceMain) state.spaceMain=o.spaceMain; if(o.spaceCross) state.spaceCross=o.spaceCross;
    if(CM.Draw&&CM.Draw.load) CM.Draw.load(o.draw||[]);
    selected=null; multi.clear(); connectMode=false; connectFrom=null; reattachMode=false; syncTitle(); render(); renderInspector(); hideSurround(); }
  function mmUndo(){ if(!_undo.length) return; _redo.push(mmSnap()); mmRestore(_undo.pop()); refreshUndoBtns(); }
  function mmRedo(){ if(!_redo.length) return; _undo.push(mmSnap()); mmRestore(_redo.pop()); refreshUndoBtns(); }
  function refreshUndoBtns(){ const u=document.getElementById('mm-undo'), r=document.getElementById('mm-redo');
    if(u) u.classList.toggle('mm-disabled', !_undo.length); if(r) r.classList.toggle('mm-disabled', !_redo.length); }
  let onExit=()=>{};

  // ---- kontekst dla modułów pomocniczych: jawny dostęp do stanu, elementów DOM i akcji edytora ----
  // (gettery — elementy powstają dopiero w ensureDom; funkcje to deklaracje z tego modułu)
  const ctx={ state,
    get root(){ return root; }, get canvas(){ return canvas; }, get world(){ return world; },
    pushUndo, load, render, renderInspector, hideSurround, positionSurround, drawEdges, fitView, syncTitle, applyLayout,
    buildDiagram, hiddenByCollapse, anchorRect,
    deselect(){ selected=null; multi.clear(); },
    cardHeight(id){ const c=world&&world.querySelector(`[data-id="${id}"]`); return c?c.offsetHeight:60; },
    mmMenu:(items)=>ui.menu(items), mmInput:(t,v,o)=>ui.input(t,v,o), autoSnap:(r)=>io.autoSnap(r) };
  const ui=CM.MindMapUI.create(ctx), io=IO.create(ctx);
  const { input:mmInput, popover:mmPopover, menu:mmMenu, contextMenu:mmContextMenu, closePop }=ui;
  const { sBtn, sIcon, sBar }=CM.MindMapUI;

  // ---- startowe typy diagramów (CM.MindMapTemplates) ----
  function buildDiagram(k){ const d=T.find(k); if(!d) return; if(state.nodes.length) pushUndo();
    state.nodes=[]; state.edges=[]; selected=null; state.mapId=null; T.build(k, state); state.name=d.name; syncTitle(); io.clearSnaps(); render(); renderInspector(); setTimeout(fitView,20); setTimeout(()=>io.takeSnap('template:'+k),500); }

  // populate (or repopulate, e.g. on language change) the left tool rail
  function fillTools(tools){
    tools.innerHTML='';
    const toolBtn=(ic,short,title,fn,cls,id)=>{ const b=U.el('button',{class:'mm-tool '+(cls||''),title:title,onclick:fn});
      b.innerHTML=CM.icons.svg(ic,{size:20}); b.appendChild(U.el('span',{class:'mm-tool-lbl',text:short})); if(id) b.id=id; return b; };
    tools.appendChild(U.el('div',{class:'mm-tools-title',text:I.t('cm.toolsTitle','NARZĘDZIA')}));
    const undoBtn=toolBtn('rotateL',I.t('cm.toolUndo','Cofnij'),I.t('cm.toolUndoTitle','Cofnij (Ctrl+Z)'),()=>mmUndo(),'mm-disabled'); undoBtn.id='mm-undo'; tools.appendChild(undoBtn);
    const redoBtn=toolBtn('rotateR',I.t('cm.toolRedo','Ponów'),I.t('cm.toolRedoTitle','Ponów (Ctrl+Y)'),()=>mmRedo(),'mm-disabled'); redoBtn.id='mm-redo'; tools.appendChild(redoBtn);
    tools.appendChild(U.el('div',{class:'mm-tools-sep'}));
    tools.appendChild(toolBtn('flow',I.t('cm.toolConnect','Połącz'),I.t('cm.toolConnectTitle','Tryb łączenia (kliknij dwa węzły)'),()=>toggleConnect(),'mm-connect-btn'));
    tools.appendChild(toolBtn('grid',I.t('cm.toolArrange','Ułóż'),I.t('cm.toolArrangeTitle','Auto-układ węzłów (radialnie)'),()=>autoArrange(),null,'mm-arrange'));
    tools.appendChild(toolBtn('layers',I.t('cm.toolLayout','Układ'),I.t('cm.toolLayoutTitle','Schemat układu, styl linii, szablony'),()=>showLayoutDialog(),null,'mm-layout'));
    tools.appendChild(toolBtn('fit',I.t('cm.toolFit','Dopasuj'),I.t('cm.toolFitTitle','Dopasuj widok do zawartości'),()=>fitView(),null,'mm-fit'));
    tools.appendChild(U.el('div',{class:'mm-tools-sep'}));
    tools.appendChild(toolBtn('save',I.t('cm.toolSave','Zapisz'),I.t('cm.toolSaveTitle','Zapisz w pamięci urządzenia'),()=>io.saveLocal(),null,'mm-save'));
    tools.appendChild(toolBtn('open',I.t('cm.toolLoad','Wczytaj'),I.t('cm.toolLoadTitle','Wczytaj z pamięci urządzenia'),()=>io.openLocalPicker()));
    tools.appendChild(toolBtn('download',I.t('cm.toolExport','Eksport'),I.t('cm.toolExportTitle','Eksport do pliku (.mindmap.json)'),()=>io.exportFile()));
    tools.appendChild(toolBtn('image',I.t('cm.toolImage','Obraz'),I.t('cm.toolImageTitle','Eksport mapy do PNG / SVG'),()=>io.exportImage()));
    tools.appendChild(toolBtn('upload',I.t('cm.toolImport','Import'),I.t('cm.toolImportTitle','Import z pliku'),()=>io.importFilePicker()));
    tools.appendChild(toolBtn('file',I.t('cm.toolMarkdown','Markdown'),I.t('cm.toolMarkdownTitle','Import / eksport konspektu Markdown'),()=>io.markdownMenu(),null,'mm-markdown'));
    tools.appendChild(U.el('div',{class:'mm-tools-sep'}));
    tools.appendChild(toolBtn('pencil',I.t('cm.toolDraw','Rysuj'),I.t('cm.toolDrawTitle','Rysowanie odręczne na mapie (pióro, kształty, strzałki, tekst)'),()=>{ if(CM.Draw) CM.Draw.toggle(); },null,'mm-draw-btn'));
    tools.appendChild(toolBtn('trash',I.t('cm.toolClear','Wyczyść'),I.t('cm.toolClearTitle','Wyczyść całą mapę'),()=>{ if(confirm(I.t('cm.confirmClear','Wyczyścić mapę myśli?'))){ state.nodes=[];state.edges=[];selected=null;render();renderInspector();} }));
    refreshUndoBtns();
  }

  function ensureDom(){
    if(built) return;
    built=true;
    root=U.el('div',{id:'mindmap-root',class:'hidden'});
    // ---- left tool rail (labelled, professional) ----
    const tools=U.el('div',{id:'mm-tools'});
    fillTools(tools);
    // ---- canvas + top bar ----
    canvas=U.el('div',{id:'mm-canvas'});
    const topbar=U.el('div',{id:'mm-topbar'});
    const titleIn=U.el('input',{id:'mm-title',value:state.name,title:I.t('cm.titleInput','Nazwa mapy myśli')});
    titleIn.oninput=()=>{ state.name=titleIn.value; };
    topbar.appendChild(U.el('span',{class:'mm-topbar-ic',html:CM.icons.svg('layers',{size:16})}));
    topbar.appendChild(titleIn);
    const zwrap=U.el('div',{class:'mm-zoom'});
    zwrap.appendChild(U.el('button',{class:'mm-zbtn',title:I.t('cm.zoomOut','Oddal'),html:CM.icons.svg('minus',{size:15}),onclick:()=>zoomBy(1/1.2)}));
    const zlbl=U.el('span',{id:'mm-zoom-lbl',class:'mm-zlbl',text:'100%'});
    zwrap.appendChild(zlbl);
    zwrap.appendChild(U.el('button',{class:'mm-zbtn',title:I.t('cm.zoomIn','Przybliż'),html:CM.icons.svg('plus',{size:15}),onclick:()=>zoomBy(1.2)}));
    topbar.appendChild(zwrap);
    canvas.appendChild(topbar);
    svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.id='mm-svg';
    world=U.el('div',{id:'mm-world'});
    canvas.appendChild(svg); canvas.appendChild(world);
    // drawing layer (CM.Draw): render svg lives INSIDE world (sketches pan/zoom with the map), but a
    // dedicated screen-space surface handles pointer input so it never fights the map's pan handlers.
    if(CM.Draw&&CM.Draw.attach) CM.Draw.attach({ world, canvas, screenToWorld, getZoom:()=>cam.zoom, onDirty:()=>io.autoSnap('draw'),
      panBy:(dx,dy)=>{ cam.x+=dx; cam.y+=dy; applyCam(); drawEdges(); positionSurround&&positionSurround(); },
      zoomAt:(cx,cy,dy)=>{ const r=canvas.getBoundingClientRect(); const before=screenToWorld(cx,cy);
        cam.zoom=U.clamp(cam.zoom*Math.exp(-dy*0.0015),0.2,3); cam.x=(cx-r.left)-before.x*cam.zoom; cam.y=(cy-r.top)-before.y*cam.zoom; applyCam(); drawEdges(); } });
    // ---- right inspector ----
    inspector=U.el('aside',{id:'mm-inspector'});
    // collapse/expand rail for the right inspector panel
    const inspRail=U.el('button',{id:'mm-insp-rail',title:I.t('cm.inspRailTitle','Zwiń / rozwiń panel właściwości')});
    inspRail.innerHTML=CM.icons.svg('expand',{size:16});
    inspRail.onclick=()=>{ const col=root.classList.toggle('mm-insp-collapsed'); inspRail.innerHTML=CM.icons.svg(col?'collapse':'expand',{size:16}); setTimeout(()=>{ drawEdges(); positionSurround(); },260); };
    root.appendChild(tools); root.appendChild(canvas); root.appendChild(inspector); root.appendChild(inspRail);
    buildSurround(); layoutDlg=L.createDialog(ctx);
    io.buildTimeline(); io.loadSnaps(); io.buildSlModal();
    document.querySelector('#main').appendChild(root);
    bindCanvas();
    renderInspector();
    // undo / redo shortcuts (only while MindMap is active and not editing text)
    window.addEventListener('keydown',(e)=>{
      if(!active) return; const t=e.target;
      if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
      if((e.ctrlKey||e.metaKey) && (e.key==='z'||e.key==='Z') && !e.shiftKey){ e.preventDefault(); mmUndo(); }
      else if((e.ctrlKey||e.metaKey) && ((e.key==='y'||e.key==='Y') || ((e.key==='z'||e.key==='Z')&&e.shiftKey))){ e.preventDefault(); mmRedo(); }
      else if((e.key==='Delete'||e.key==='Backspace') && multi.size){ e.preventDefault(); pushUndo();
        const ids=new Set(multi); state.nodes=state.nodes.filter(x=>!ids.has(x.id)); state.edges=state.edges.filter(ed=>!ids.has(ed.from)&&!ids.has(ed.to));
        multi.clear(); selected=null; render(); renderInspector(); hideSurround(); }
      else if((e.key==='Delete'||e.key==='Backspace') && selected){ e.preventDefault(); delNode(selected); multi.clear(); renderInspector(); hideSurround(); }
      else if(e.key==='Escape' && (multi.size||selected)){ multi.clear(); selected=null; render(); renderInspector(); hideSurround(); }
      // rapid keyboard mind-mapping (single selection only; Tab without a selection still does normal focus navigation)
      else if(e.key==='Tab' && selected && !multi.size){ e.preventDefault(); spawnAndEdit(addChild(selected)); }
      else if(e.key==='Enter' && selected && !multi.size){ e.preventDefault(); spawnAndEdit(addSibling(selected)); }
      else if(e.key==='F2' && selected && !multi.size){ e.preventDefault(); ensureVisible(selected); editText(selected,true); }
      else if((e.key==='ArrowUp'||e.key==='ArrowDown'||e.key==='ArrowLeft'||e.key==='ArrowRight') && selected && !multi.size){ e.preventDefault(); navigateSelection(e.key); }
    });
  }


  // ---------- coordinate helpers ----------
  function applyCam(){ world.style.transform=`translate(${cam.x}px,${cam.y}px) scale(${cam.zoom})`; const zl=document.querySelector('#mm-zoom-lbl'); if(zl) zl.textContent=Math.round(cam.zoom*100)+'%'; }
  function zoomBy(f){ const r=canvas.getBoundingClientRect(); const mx=r.width/2, my=r.height/2; const before=screenToWorld(r.left+mx,r.top+my);
    cam.zoom=U.clamp(cam.zoom*f,0.2,3); cam.x=mx-before.x*cam.zoom; cam.y=my-before.y*cam.zoom; applyCam(); drawEdges(); }
  function autoArrange(){
    if(state.nodes.length<2){ fitView(); return; }
    pushUndo(); L.arrange(state);   // węzeł z największą liczbą połączeń w centrum, reszta promieniście
    render(); setTimeout(fitView,20);
  }
  function worldToScreen(wx,wy){ const r=canvas.getBoundingClientRect(); return {x:wx*cam.zoom+cam.x, y:wy*cam.zoom+cam.y}; }
  function screenToWorld(sx,sy){ const r=canvas.getBoundingClientRect(); return {x:(sx-r.left-cam.x)/cam.zoom, y:(sy-r.top-cam.y)/cam.zoom}; }

  // ---------- model ----------
  function addNode(wx,wy,opts){
    pushUndo();
    const n=Object.assign({ id:'n'+(state.seq++), x:wx, y:wy, w:170, text:I.t('cm.newTopic','Nowy temat'), template:'card', color:'#22d3ee', font:14 }, opts||{});
    if(n.template==='code' && !(opts&&opts.text)){ n.text=''; if(!(opts&&opts.w)) n.w=280; }   // empty code → placeholder, wider frame
    state.nodes.push(n); render(); selectNode(n); return n;
  }
  function addNodeCentered(opts){ const r=canvas.getBoundingClientRect(); const w=screenToWorld(r.left+r.width/2, r.top+r.height/2); return addNode(w.x-85, w.y-30, opts); }
  function nodeById(id){ return state.nodes.find(n=>n.id===id); }
  function delNode(n){ pushUndo(); state.nodes=state.nodes.filter(x=>x!==n); state.edges=state.edges.filter(e=>e.from!==n.id&&e.to!==n.id); if(selected===n)selected=null; render(); }

  function selectNode(n){ multi.clear(); selected=n; render(); renderInspector(); showSurround(n); }
  function toggleConnect(){
    connectMode=!connectMode; connectFrom=null;
    document.querySelector('.mm-connect-btn').classList.toggle('on', connectMode);
    document.querySelectorAll('.mm-connect-src').forEach(c=>c.classList.remove('mm-connect-src'));
    canvas.style.cursor=connectMode?'crosshair':'';
  }

  // ---------- render ----------
  function render(){
    if(!world) return;
    world.innerHTML='';
    // group boundary boxes (behind nodes)
    for(const n of state.nodes){ if(!n.grouped||hiddenByCollapse(n)) continue;
      const ids=[n.id,...descendants(n)]; let mnX=1e9,mnY=1e9,mxX=-1e9,mxY=-1e9, any=false;
      for(const id of ids){ const m=nodeById(id); if(!m||hiddenByCollapse(m))continue; any=true; mnX=Math.min(mnX,m.x);mnY=Math.min(mnY,m.y);mxX=Math.max(mxX,m.x+m.w);mxY=Math.max(mxY,m.y+62); }
      if(!any)continue; const pad=18; const gb=U.el('div',{class:'mm-group-box'});
      gb.style.left=(mnX-pad)+'px'; gb.style.top=(mnY-pad)+'px'; gb.style.width=(mxX-mnX+pad*2)+'px'; gb.style.height=(mxY-mnY+pad*2)+'px'; gb.style.setProperty('--mm-col',n.color);
      world.appendChild(gb);
    }
    for(const n of state.nodes){
      if(hiddenByCollapse(n)) continue;
      const isCode = n.template==='code';
      const card=U.el('div',{class:'mm-node mm-tpl-'+n.template+(selected===n?' sel':'')+(multi.has(n.id)?' multi':'')+(n.locked?' locked':''),'data-id':n.id});
      card.style.left=n.x+'px'; card.style.top=n.y+'px'; card.style.width=n.w+'px';
      card.style.setProperty('--mm-col', n.color); card.style.fontSize=n.font+'px';
      let body;
      if(isCode){
        if(n.h) card.style.height=n.h+'px';
        body=T.codeView(card, n);
      } else {
        const row=U.el('div',{class:'mm-node-row'});
        if(n.image){ const imgWrap=U.el('span',{class:'mm-node-img'});
          if(/^https?:\/\//i.test(n.image)){ const im=U.el('img',{alt:''}); im.src=n.image; imgWrap.appendChild(im); }   // src via DOM property — no HTML injection
          else imgWrap.textContent=n.image;                                                                             // emoji / plain text
          row.appendChild(imgWrap); }
        body=U.el('div',{class:'mm-node-body',contenteditable:'false'}); body.textContent=n.text;
        row.appendChild(body); card.appendChild(row);
      }
      if(n.note){ const nb=U.el('span',{class:'mm-node-note',title:n.note,html:CM.icons.svg('note',{size:11})}); card.appendChild(nb); }
      if(n.locked){ card.appendChild(U.el('span',{class:'mm-node-lock',html:CM.icons.svg('lock',{size:10})})); }
      const cc=childCount(n);
      if(n.collapsed && cc){ const cb=U.el('span',{class:'mm-node-collapse',title:I.t('cm.expand','Rozwiń'),text:'+'+cc}); cb.onmousedown=(e)=>e.stopPropagation(); cb.onclick=(e)=>{ e.stopPropagation(); n.collapsed=false; render(); selectNode(n); }; card.appendChild(cb); }
      if(selected===n && !n.locked){
        const h=U.el('div',{class:'mm-rsz',title:I.t('cm.resizeWidthTitle','Przeciągnij, aby zmienić szerokość')});
        h.addEventListener('mousedown',(e)=>{ e.stopPropagation(); e.preventDefault(); const sx=e.clientX, ow=n.w;
          const mv=(ev)=>{ n.w=U.clamp(ow+(ev.clientX-sx)/cam.zoom, 90, 900); card.style.width=n.w+'px'; drawEdges(); positionSurround(); };
          const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
          window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up); });
        card.appendChild(h);
        if(isCode){   // code frames resize freely in BOTH dimensions via a bottom-right corner grip
          const ch=U.el('div',{class:'mm-rsz-corner',title:I.t('cm.resizeBoth','Przeciągnij, aby zmienić rozmiar ramki')});
          ch.addEventListener('mousedown',(e)=>{ e.stopPropagation(); e.preventDefault();
            const sx=e.clientX, sy=e.clientY, ow=n.w, oh=n.h||card.offsetHeight;
            const mv=(ev)=>{ n.w=U.clamp(ow+(ev.clientX-sx)/cam.zoom, 120, 900); n.h=U.clamp(oh+(ev.clientY-sy)/cam.zoom, 60, 900);
              card.style.width=n.w+'px'; card.style.height=n.h+'px'; drawEdges(); positionSurround(); };
            const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
            window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up); });
          card.appendChild(ch);
        }
      }
      world.appendChild(card);
      bindCard(card, n, body, isCode?(()=>editCode(n)):null);
    }
    applyCam();
    drawEdges();
    positionSurround();
  }

  // ---------- karta „kod” (widok: CM.MindMapTemplates.codeView) ----------
  function editCode(n){
    mmInput(I.t('cm.editCodeTitle','Kod (język i numeracja linii wykrywane automatycznie):'), n.text||'', {multiline:true, mono:true}).then(v=>{
      if(v===null) return; pushUndo(); n.text=v; render(); selected=n; renderInspector();
    });
  }

  // łączniki: drzewo rodzic → dziecko (zakotwiczone wg układu) + wolne krawędzie — geometria z CM.MindMapLayout
  // (ta sama co w eksporcie SVG); na ekranie karta liczy się jako 60 px wysokości, punkty świat → ekran
  function drawEdges(){
    const r=canvas.getBoundingClientRect();
    svg.setAttribute('width', r.width); svg.setAttribute('height', r.height);
    const curved=state.line==='curved';
    let s='';
    L.eachConnector(state, ()=>60, hiddenByCollapse, (from,to,col,wide)=>{
      s+=L.connectorSvg(worldToScreen(from.x,from.y), worldToScreen(to.x,to.y), curved, col, wide); });
    svg.innerHTML=s;
  }

  // ---------- card interactions ----------
  function bindCard(card, n, body, onDblClick){
    let down=false, moved=false, sx=0, sy=0, ox=0, oy=0;
    card.addEventListener('pointerdown',(e)=>{
      if(body.getAttribute && body.getAttribute('contenteditable')==='true') return;  // editing -> let text select
      // reattach mode: clicking a node makes it the new parent of the selected node
      if(reattachMode && selected && selected!==n && !isDescendant(n, selected)){
        pushUndo(); selected.parent=n.id; reattachMode=false; canvas.style.cursor=''; relayoutIfTree(); render(); U.toast&&U.toast(I.t('cm.toastReattached','Przepięto węzeł.'),'success',1500); e.stopPropagation(); return;
      }
      // connect mode (free cross-link)
      if(connectMode){
        if(!connectFrom){ connectFrom=n; card.classList.add('mm-connect-src'); }
        else if(connectFrom!==n){ addEdge(connectFrom, n); document.querySelectorAll('.mm-connect-src').forEach(c=>c.classList.remove('mm-connect-src')); connectFrom=null; }
        e.stopPropagation(); return;
      }
      // Shift-click toggles multi-selection membership
      if(e.shiftKey){ if(multi.has(n.id)) multi.delete(n.id); else multi.add(n.id);
        selected = multi.size ? n : null; render(); renderInspector();
        if(multi.size>1) hideSurround(); else if(selected) showSurround(selected); else hideSurround();
        e.stopPropagation(); e.preventDefault(); return; }
      const groupDrag = multi.has(n.id) && multi.size>1;
      if(!groupDrag) selectNode(n);   // plain click clears multi -> single select
      e.stopPropagation(); e.preventDefault();
      if(n.locked && !groupDrag) return;   // locked figure: selectable but not draggable
      down=true; moved=false; sx=e.clientX; sy=e.clientY; const preDrag=mmSnap();
      const orig = (groupDrag ? [...multi].map(id=>nodeById(id)) : [n]).filter(m=>m&&!m.locked).map(m=>({m, x:m.x, y:m.y}));
      const mv=(ev)=>{ if(!down)return; const dx=(ev.clientX-sx)/cam.zoom, dy=(ev.clientY-sy)/cam.zoom;
        if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>3) moved=true;
        for(const o of orig){ o.m.x=o.x+dx; o.m.y=o.y+dy; const c=world.querySelector(`[data-id="${o.m.id}"]`); if(c){ c.style.left=o.m.x+'px'; c.style.top=o.m.y+'px'; } }
        drawEdges(); positionSurround(); };
      const up=()=>{ down=false; if(moved) pushUndoSnap(preDrag); else if(groupDrag) selectNode(n); window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); };
      window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
    });
    card.addEventListener('dblclick',(e)=>{
      e.stopPropagation();
      if(onDblClick){ onDblClick(); return; }   // code node → open the dedicated code editor
      body._preEdit=mmSnap(); body._origText=n.text;
      body.setAttribute('contenteditable','true'); body.focus();
      const range=document.createRange(); range.selectNodeContents(body); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });
    if(!onDblClick){
      body.addEventListener('blur',()=>{ body.setAttribute('contenteditable','false');
        if(body._preEdit!=null && body.textContent!==body._origText){ pushUndoSnap(body._preEdit); }
        body._preEdit=null; n.text=body.textContent; drawEdges(); });
      body.addEventListener('keydown',(e)=>{
        if(e.isComposing){ e.stopPropagation(); return; }                 // don't hijack keys mid IME composition
        if(e.key==='Escape'){ e.stopPropagation(); body.blur(); return; }
        // commit on Enter and continue the rapid-entry flow; Shift+Enter still inserts a line break
        if(e.key==='Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey){ e.preventDefault(); e.stopPropagation(); body.blur(); spawnAndEdit(addSibling(n)); return; }
        if(e.key==='Tab'){ e.preventDefault(); e.stopPropagation(); body.blur(); spawnAndEdit(addChild(n)); return; }
        e.stopPropagation();
      });
    }
    // right-click → OS-style tools window for this node
    card.addEventListener('contextmenu',(e)=>{ e.preventDefault(); e.stopPropagation(); selectNode(n); mmContextMenu(e.clientX, e.clientY, nodeMenuItems(n)); });
  }
  // connect mode is a TOGGLE: linking two already-linked nodes REMOVES the link (edge deletion)
  function addEdge(a,b){
    const i=state.edges.findIndex(e=>(e.from===a.id&&e.to===b.id)||(e.from===b.id&&e.to===a.id));
    pushUndo();
    if(i>=0){ state.edges.splice(i,1); U.toast&&U.toast(I.t('cm.edgeRemoved','Usunięto połączenie.'),'',1600); }
    else state.edges.push({from:a.id,to:b.id});
    render();
  }

  // box (marquee) multi-selection — Shift-drag on empty canvas
  function startMarquee(e){
    const r=canvas.getBoundingClientRect(); const x0=e.clientX, y0=e.clientY;
    marqueeEl=U.el('div',{class:'mm-marquee'}); canvas.appendChild(marqueeEl);
    const upd=(ev)=>{ const x=Math.min(x0,ev.clientX), y=Math.min(y0,ev.clientY);
      marqueeEl.style.left=(x-r.left)+'px'; marqueeEl.style.top=(y-r.top)+'px';
      marqueeEl.style.width=Math.abs(ev.clientX-x0)+'px'; marqueeEl.style.height=Math.abs(ev.clientY-y0)+'px'; };
    const up=(ev)=>{ window.removeEventListener('pointermove',upd); window.removeEventListener('pointerup',up);
      const wa=screenToWorld(Math.min(x0,ev.clientX),Math.min(y0,ev.clientY)), wb=screenToWorld(Math.max(x0,ev.clientX),Math.max(y0,ev.clientY));
      multi.clear();
      for(const n of state.nodes){ if(hiddenByCollapse(n))continue; const c=world.querySelector(`[data-id="${n.id}"]`); const h=c?c.offsetHeight:60;
        if(n.x<wb.x && n.x+n.w>wa.x && n.y<wb.y && n.y+h>wa.y) multi.add(n.id); }
      if(marqueeEl){ marqueeEl.remove(); marqueeEl=null; }
      selected = multi.size ? nodeById([...multi][0]) : null;
      render(); renderInspector(); if(multi.size>1) hideSurround(); else if(selected) showSurround(selected);
      if(multi.size) U.toast&&U.toast(I.t('cm.toastSelectedPre','Zaznaczono ')+multi.size+I.t('cm.toastSelectedPost',' węzłów — przeciągnij, aby przesunąć; Delete usuwa.'),'',2400);
    };
    window.addEventListener('pointermove',upd); window.addEventListener('pointerup',up);
  }

  // ---------- canvas pan / zoom / add ----------
  function bindCanvas(){
    let ptrs=new Map(), panning=false, panSX=0,panSY=0,panCX=0,panCY=0, lastPinchD=0;
    function pinchDist(){ const v=[...ptrs.values()]; if(v.length<2)return 0; const dx=v[0].x-v[1].x,dy=v[0].y-v[1].y; return Math.sqrt(dx*dx+dy*dy); }
    function pinchMid(){ const v=[...ptrs.values()]; return {x:(v[0].x+v[1].x)/2,y:(v[0].y+v[1].y)/2}; }
    canvas.addEventListener('pointerdown',(e)=>{
      ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
      canvas.setPointerCapture(e.pointerId);
      if(ptrs.size===2){ lastPinchD=pinchDist(); panning=false; return; }
      if(ptrs.size>1) return;
      if(e.target!==canvas&&e.target!==svg&&e.target!==world){ return; }
      if(connectFrom){ document.querySelectorAll('.mm-connect-src').forEach(c=>c.classList.remove('mm-connect-src')); connectFrom=null; }
      if(e.shiftKey&&!e.pointerType.startsWith('touch')){ startMarquee(e); return; }
      selected=null; multi.clear(); renderInspector(); render(); hideSurround();
      panning=true; panSX=e.clientX; panSY=e.clientY; panCX=cam.x; panCY=cam.y; canvas.classList.add('panning');
    },{passive:false});
    canvas.addEventListener('pointermove',(e)=>{
      if(!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(ptrs.size===2){
        const d=pinchDist(); if(lastPinchD>0&&d>0){
          const mid=pinchMid(); const before=screenToWorld(mid.x,mid.y);
          cam.zoom=U.clamp(cam.zoom*(d/lastPinchD),0.2,3);
          const r=canvas.getBoundingClientRect(); cam.x=(mid.x-r.left)-before.x*cam.zoom; cam.y=(mid.y-r.top)-before.y*cam.zoom;
          applyCam(); drawEdges(); }
        lastPinchD=d; return;
      }
      if(!panning)return; cam.x=panCX+(e.clientX-panSX); cam.y=panCY+(e.clientY-panSY); applyCam(); drawEdges(); positionSurround();
    },{passive:false});
    const endPtr=(e)=>{ ptrs.delete(e.pointerId);
      if(ptrs.size===1){ // lifted one finger after a pinch → resume single-finger pan from the survivor (no jump)
        const p=[...ptrs.values()][0]; panSX=p.x; panSY=p.y; panCX=cam.x; panCY=cam.y; panning=true; lastPinchD=0; }
      else if(ptrs.size===0){ panning=false; lastPinchD=0; canvas.classList.remove('panning'); } };
    canvas.addEventListener('pointerup',endPtr);
    canvas.addEventListener('pointercancel',endPtr);
    let lastTap=0;
    canvas.addEventListener('pointerdown',(e)=>{
      if(e.pointerType!=='touch') return;
      const now=Date.now(); if(now-lastTap<340){ const w=screenToWorld(e.clientX,e.clientY); addNode(w.x-85,w.y-30); } lastTap=now;
    });
    canvas.addEventListener('dblclick',(e)=>{ if(e.target===canvas||e.target===svg||e.target===world){ const w=screenToWorld(e.clientX,e.clientY); addNode(w.x-85,w.y-30); } });
    canvas.addEventListener('contextmenu',(e)=>{ if(e.target===canvas||e.target===svg||e.target===world){ e.preventDefault(); selected=null; renderInspector(); render(); hideSurround(); mmContextMenu(e.clientX, e.clientY, canvasMenuItems(e.clientX, e.clientY)); } });
    canvas.addEventListener('wheel',(e)=>{ e.preventDefault();
      const r=canvas.getBoundingClientRect(); const before=screenToWorld(e.clientX,e.clientY);
      cam.zoom=U.clamp(cam.zoom*Math.exp(-e.deltaY*0.0015),0.2,3);
      cam.x=(e.clientX-r.left)-before.x*cam.zoom; cam.y=(e.clientY-r.top)-before.y*cam.zoom; applyCam(); drawEdges();
    },{passive:false});
  }
  function fitView(){
    if(!state.nodes.length){ cam={x:canvas.clientWidth/2,y:canvas.clientHeight/2,zoom:1}; applyCam(); drawEdges(); return; }
    const {minX, minY, maxX, maxY}=L.cardBounds(state.nodes, ()=>70);
    const r=canvas.getBoundingClientRect(); const pad=80;
    const z=U.clamp(Math.min((r.width-pad*2)/(maxX-minX||1),(r.height-pad*2)/(maxY-minY||1)),0.2,1.6);
    cam.zoom=z; cam.x=r.width/2-((minX+maxX)/2)*z; cam.y=r.height/2-((minY+maxY)/2)*z; applyCam(); drawEdges();
  }

  // ---------- node structure helpers ----------
  function isDescendant(node, ancestor){ let c=node; let guard=0; while(c&&guard++<999){ if(c.parent==null) return false; if(c.parent===ancestor.id) return true; c=nodeById(c.parent); } return false; }
  function relayoutIfTree(){ if(state.layout&&state.layout!=='free') applyLayout(state.layout); else { render(); } }

  // ---------- node actions ----------
  function editText(n, capture){ const body=world.querySelector(`[data-id="${n.id}"] .mm-node-body`); if(!body)return;
    if(capture){ body._preEdit=mmSnap(); body._origText=n.text; }   // F2 / menu edit on an existing node → record undo
    body.setAttribute('contenteditable','true'); body.focus(); const range=document.createRange(); range.selectNodeContents(body); const s=getSelection(); s.removeAllRanges(); s.addRange(range); }
  // pan a node into view, but only if it sits near/over a canvas edge — keeps keyboard-created nodes visible without yanking the camera around
  function ensureVisible(n){ if(!n) return; const r=canvas.getBoundingClientRect(); const s=worldToScreen(n.x+n.w/2,n.y+28); const m=90;
    if(s.x<m||s.x>r.width-m||s.y<m||s.y>r.height-m) centerOn(n); }
  // a freshly spawned node is created+selected by addChild/addSibling — bring it into view and drop straight into text editing (placeholder pre-selected)
  function spawnAndEdit(c){ if(!c) return c; ensureVisible(c); editText(c,false); return c; }
  // keyboard selection: jump to the nearest visible node in the arrow direction — geometric, so it works in every layout (free / tree / radial / …)
  function navigateSelection(key){
    if(!selected) return; const cx=selected.x+selected.w/2, cy=selected.y+28;
    const dirs={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]}; const d=dirs[key]; if(!d) return;
    let best=null,bestScore=Infinity;
    for(const n of state.nodes){ if(n===selected||hiddenByCollapse(n)) continue;
      const vx=(n.x+n.w/2)-cx, vy=(n.y+28)-cy; const along=vx*d[0]+vy*d[1]; if(along<=1) continue;   // must lie in the chosen direction
      const perp=Math.abs(vx*d[1]-vy*d[0]); if(perp>along*1.3+44) continue;                            // stay inside a ~50° cone
      const score=along+perp*2; if(score<bestScore){ bestScore=score; best=n; } }                     // prefer aligned & close
    if(best){ selectNode(best); ensureVisible(best); }
  }
  function addNote(n){ mmInput(I.t('cm.promptNote','Notatka do węzła:'), n.note||'', {multiline:true}).then(v=>{ if(v===null)return; pushUndo(); n.note=v.trim()||null; render(); selected=n; renderInspector(); }); }
  function addImage(n){ mmInput(I.t('cm.promptImage','Emoji lub adres URL obrazka (puste = usuń):'), n.image||'', {placeholder:'😀  /  https://…'}).then(v=>{ if(v===null)return; pushUndo(); n.image=v.trim()||null; render(); selected=n; renderInspector(); }); }
  function addChild(n){ const horiz=(state.layout==='right'||state.layout==='left'||state.layout==='leftright'||state.layout==='free');
    const c=addNode(n.x+(horiz?220:0), n.y+(horiz?0:130), {parent:n.id, text:I.t('cm.newTopic','Nowy temat'), color:n.color, template:n.template, font:n.font, w:n.w}); relayoutIfTree(); selectNode(c); return c; }
  function addSibling(n){ const horiz=(state.layout==='right'||state.layout==='left'||state.layout==='leftright'||state.layout==='free');
    const c=addNode(n.x+(horiz?0:160), n.y+(horiz?90:0), {parent:n.parent, text:I.t('cm.newTopic','Nowy temat'), color:n.color, template:n.template, font:n.font, w:n.w}); relayoutIfTree(); selectNode(c); return c; }
  function duplicateNode(n){ const c=addNode(n.x+30, n.y+30, {parent:n.parent, text:n.text, color:n.color, template:n.template, font:n.font, w:n.w, note:n.note, image:n.image}); relayoutIfTree(); selectNode(c); return c; }
  function startReattach(n){ selectNode(n); reattachMode=true; canvas.style.cursor='crosshair'; U.toast&&U.toast(I.t('cm.toastReattachHint','Kliknij węzeł, który ma stać się nowym rodzicem.'),'',2600); }
  function copyNode(n){ clipboard={text:n.text, color:n.color, template:n.template, font:n.font, w:n.w, note:n.note, image:n.image}; U.toast&&U.toast(I.t('cm.toastCopied','Skopiowano węzeł.'),'',1300); }
  function cutNode(n){ copyNode(n); delNode(n); }
  function pasteNode(n){ if(!clipboard){ U.toast&&U.toast(I.t('cm.toastClipboardEmpty','Schowek pusty.'),'error',1300); return; } const c=addNode((n?n.x+40:0),(n?n.y+40:0), Object.assign({parent:n?n.id:null}, clipboard)); relayoutIfTree(); selectNode(c); return c; }
  function quickWidth(n){ pushUndo(); mmPopover(I.t('cm.popWidth','Szerokość węzła'), (box)=>{ const r=U.el('input',{type:'range',min:'110',max:'460',value:n.w,style:'width:200px'}); r.oninput=()=>{ n.w=+r.value; render(); selected=n; }; box.appendChild(r); }); }
  function quickColor(n){ pushUndo(); mmPopover(I.t('cm.popColor','Kolor węzła'), (box)=>{ const row=U.el('div',{class:'mm-color-row'});
      for(const c of T.COLORS){ row.appendChild(U.el('button',{class:'mm-color'+(n.color===c?' on':''),style:`background:${c}`,onclick:()=>{ n.color=c; render(); selected=n; }})); }
      const cp=U.el('input',{type:'color',class:'mm-color-pick',value:n.color}); cp.oninput=()=>{ n.color=cp.value; render(); selected=n; }; row.appendChild(cp); box.appendChild(row); }); }
  function quickShape(n){ pushUndo(); mmPopover(I.t('cm.popShape','Kształt / rodzaj dymka'), (box)=>{ const grid=U.el('div',{class:'mm-tpl-grid'});
      for(const k of T.FRAMES){ const b=U.el('button',{class:'mm-tpl-chip mm-tpl-'+k+(n.template===k?' on':''),title:T.frameName(k),onclick:()=>{ n.template=k; render(); selected=n; quickShape(n); }});
        b.appendChild(U.el('span',{class:'mm-tpl-chip-lbl',text:T.frameName(k)})); grid.appendChild(b); } box.appendChild(grid); }); }

  // ---------- schematy układu (algorytmy: CM.MindMapLayout) ----------
  function applyLayout(mode){ L.apply(state, mode); render(); positionSurround(); }
  function applyColorSchema(name){ pushUndo(); state.colorSchema=true; L.paintSchema(state, T.SCHEMA_PALETTES[name]||T.SCHEMA_PALETTES.ocean); render(); }
  function disableColorSchema(){ pushUndo(); state.colorSchema=false; for(const n of state.nodes) n.color='#3b5bdb'; render(); }

  // ---------- node + screen geometry helpers ----------
  function descendants(n){ const out=[]; for(const k of state.nodes){ if(k.parent===n.id){ out.push(k.id); out.push(...descendants(k)); } } return out; }
  function delBranch(n){ pushUndo(); const ids=new Set([n.id,...descendants(n)]); state.nodes=state.nodes.filter(x=>!ids.has(x.id)); state.edges=state.edges.filter(e=>!ids.has(e.from)&&!ids.has(e.to)); if(selected && ids.has(selected.id)) selected=null; multi.clear(); render(); renderInspector(); hideSurround(); }
  function hiddenByCollapse(n){ let c=n,g=0; while(c.parent!=null&&g++<999){ const p=nodeById(c.parent); if(!p)break; if(p.collapsed) return true; c=p; } return false; }
  function childCount(n){ return state.nodes.filter(x=>x.parent===n.id).length; }
  function centerOn(n){ const r=canvas.getBoundingClientRect(); cam.x=r.width/2-(n.x+n.w/2)*cam.zoom; cam.y=r.height/2-(n.y+28)*cam.zoom; applyCam(); drawEdges(); positionSurround(); }
  function nodeScreenRect(n){
    const rr=root.getBoundingClientRect();
    const card=world&&world.querySelector(`[data-id="${n.id}"]`);
    if(card){ const b=card.getBoundingClientRect();
      return {left:b.left-rr.left, top:b.top-rr.top, w:b.width, h:b.height, cx:b.left-rr.left+b.width/2, cy:b.top-rr.top+b.height/2, rootW:rr.width, rootH:rr.height}; }
    const cr=canvas.getBoundingClientRect(), p=worldToScreen(n.x,n.y);
    const left=cr.left-rr.left+p.x, top=cr.top-rr.top+p.y, w=n.w*cam.zoom, h=60*cam.zoom;
    return {left,top,w,h,cx:left+w/2,cy:top+h/2,rootW:rr.width,rootH:rr.height};
  }

  // prostokąt zaczepienia popoverów / menu (CM.MindMapUI): zaznaczony węzeł albo środek widoku
  function anchorRect(){ return selected?nodeScreenRect(selected):{cx:root.clientWidth/2,top:root.clientHeight/2,h:0,rootW:root.clientWidth,rootH:root.clientHeight}; }
  // full tool list for a node (used by the right-click context window)
  function nodeMenuItems(n){
    return [
      {head:I.t('cm.menuNode','Węzeł')},
      {ic:'plus', t:I.t('cm.menuNewChild','Węzeł +  (nowe dziecko)')+'   ·  Tab', primary:true, fn:()=>addChild(n)},
      {ic:'sibling', t:I.t('cm.menuSibling','Rodzeństwo')+'   ·  Enter', fn:()=>addSibling(n)},
      {ic:'copy', t:I.t('cm.menuDuplicate','Duplikuj'), fn:()=>duplicateNode(n)},
      {sep:true},
      {ic:'type', t:I.t('cm.menuEditText','Edytuj tekst')+'   ·  F2', fn:()=>editText(n,true)},
      {ic:'image', t:I.t('cm.menuImageEmoji','Obraz / emoji'), fn:()=>addImage(n)},
      {ic:'note', t:I.t('cm.menuNote','Notatka'), fn:()=>addNote(n)},
      {ic:'connect', t:I.t('cm.menuConnectOther','Połącz z innym'), fn:()=>{ selectNode(n); toggleConnect(); }},
      {ic:'reattach', t:I.t('cm.menuReattachParent','Przepnij do rodzica'), fn:()=>startReattach(n)},
      {sep:true},
      {ic:'palette', t:I.t('cm.menuColor','Kolor'), fn:()=>quickColor(n)},
      {ic:'shapes', t:I.t('cm.menuShapeFrame','Kształt / ramka'), fn:()=>quickShape(n)},
      {ic:'resize', t:I.t('cm.menuSize','Rozmiar'), fn:()=>quickWidth(n)},
      {ic:'group', t:n.grouped?I.t('cm.menuUngroup','Rozgrupuj'):I.t('cm.menuGroupBranch','Grupuj gałąź'), fn:()=>toggleGroup(n)},
      {ic:n.locked?'unlock':'lock', t:n.locked?I.t('cm.menuUnlock','Odblokuj'):I.t('cm.menuLock','Zablokuj'), fn:()=>{ n.locked=!n.locked; render(); selectNode(n); }},
      {ic:n.collapsed?'expand':'collapse', t:n.collapsed?I.t('cm.menuExpandBranch','Rozwiń gałąź'):I.t('cm.menuCollapseBranch','Zwiń gałąź'), fn:()=>{ n.collapsed=!n.collapsed; render(); selectNode(n); }},
      {sep:true},
      {ic:'clipboard', t:I.t('cm.menuCopy','Kopiuj'), fn:()=>copyNode(n)},
      {ic:'scissors', t:I.t('cm.menuCut','Wytnij'), fn:()=>cutNode(n)},
      {ic:'paste', t:I.t('cm.menuPasteInto','Wklej do węzła'), fn:()=>pasteNode(n)},
      {ic:'grid', t:I.t('cm.menuLayoutSchema','Schemat układu…'), fn:()=>openSchemaMenu(n)},
      {sep:true},
      {ic:'trash', t:I.t('cm.menuDeleteNode','Usuń węzeł'), danger:true, fn:()=>delNode(n)},
      {ic:'trash', t:I.t('cm.menuDeleteBranch','Usuń całą gałąź'), danger:true, fn:()=>delBranch(n)},
    ];
  }
  // tools when right-clicking empty canvas
  function canvasMenuItems(clientX, clientY){
    const w=screenToWorld(clientX, clientY);
    return [
      {head:I.t('cm.menuMap','Mapa')},
      {ic:'plus', t:I.t('cm.menuNewHere','Węzeł +  (tutaj)'), primary:true, fn:()=>addNode(w.x-85, w.y-30)},
      {ic:'paste', t:I.t('cm.menuPasteNode','Wklej węzeł'), fn:()=>{ const c=clipboard?addNode(w.x-85,w.y-30,Object.assign({},clipboard)):null; if(!c)U.toast&&U.toast(I.t('cm.toastClipboardEmpty','Schowek pusty.'),'error',1300); }},
      {sep:true},
      {ic:'grid', t:I.t('cm.menuLayoutTemplates','Schemat układu / szablony…'), fn:()=>showLayoutDialog()},
      {ic:'flow', t:I.t('cm.menuAutoArrange','Auto-ułóż'), fn:()=>autoArrange()},
      {ic:'fit', t:I.t('cm.menuFitView','Dopasuj widok'), fn:()=>fitView()},
      {sep:true},
      {ic:'trash', t:I.t('cm.menuClearMap','Wyczyść mapę'), danger:true, fn:()=>{ if(confirm(I.t('cm.confirmClear','Wyczyścić mapę myśli?'))){ state.nodes=[];state.edges=[];selected=null;render();renderInspector();hideSurround(); } }},
    ];
  }

  // ---------- node surround menu (grouped tool bars around the selected node) ----------
  function buildSurround(){ surround=U.el('div',{id:'mm-surround',class:'hidden'}); surround.onmousedown=(e)=>e.stopPropagation(); root.appendChild(surround); }
  function showSurround(n){
    if(!surround) return; closePop(); surround.innerHTML=''; surround.classList.remove('hidden');
    // TOP — content (labelled)
    surround.appendChild(sBar('top',[
      sBtn('type',I.t('cm.sbText','Tekst'),()=>editText(n,true)),
      sBtn('image',I.t('cm.sbImage','Obraz'),()=>addImage(n)),
      sBtn('connect',I.t('cm.sbConnect','Połącz'),()=>{ selectNode(n); toggleConnect(); }),
      sBtn('note',I.t('cm.sbNote','Notatka'),()=>addNote(n)),
      sBtn('dots',I.t('cm.sbMore','Więcej'),()=>openMoreMenu(n)),
    ]));
    // LEFT — clipboard (slim, icon-only)
    surround.appendChild(sBar('left',[
      sIcon('clipboard',I.t('cm.sbCopy','Kopiuj'),()=>copyNode(n)),
      sIcon('scissors',I.t('cm.sbCut','Wytnij'),()=>cutNode(n)),
      sIcon('paste',I.t('cm.sbPaste','Wklej'),()=>pasteNode(n)),
      sIcon('trash',I.t('cm.sbDelete','Usuń'),()=>delNode(n),'danger'),
    ]));
    // RIGHT — structure (slim, icon-only)
    surround.appendChild(sBar('right',[
      sIcon('branch',I.t('cm.sbChild','Dziecko')+' · Tab',()=>addChild(n)),
      sIcon('sibling',I.t('cm.sbSibling','Rodzeństwo')+' · Enter',()=>addSibling(n)),
      sIcon('copy',I.t('cm.sbDuplicate','Duplikuj'),()=>duplicateNode(n)),
      sIcon('reattach',I.t('cm.sbReattach','Przepnij'),()=>startReattach(n)),
    ]));
    // BOTTOM — appearance + schema (labelled)
    surround.appendChild(sBar('bottom',[
      sBtn('resize',I.t('cm.sbSize','Rozmiar'),()=>quickWidth(n)),
      sBtn('group',I.t('cm.sbGroup','Grupuj'),()=>toggleGroup(n),n.grouped?'on':''),
      sBtn('palette',I.t('cm.sbColor','Kolor'),()=>quickColor(n)),
      sBtn('shapes',I.t('cm.sbShape','Kształt'),()=>quickShape(n)),
      sBtn('grid',I.t('cm.sbSchema','Schemat'),()=>openSchemaMenu(n)),
    ]));
    // quick circular edit / remove right under the node
    const quick=U.el('div',{class:'mm-quick'});
    const qe=U.el('button',{class:'mm-q',title:I.t('cm.menuEditText','Edytuj tekst')+' · F2',html:CM.icons.svg('pencil',{size:15})}); qe.onmousedown=(e)=>e.stopPropagation(); qe.onclick=(e)=>{ e.stopPropagation(); editText(n,true); };
    const qd=U.el('button',{class:'mm-q mm-q-del',title:I.t('cm.menuDeleteNode','Usuń węzeł'),html:CM.icons.svg('minus',{size:15})}); qd.onmousedown=(e)=>e.stopPropagation(); qd.onclick=(e)=>{ e.stopPropagation(); delNode(n); };
    quick.appendChild(qe); quick.appendChild(qd); surround.appendChild(quick);
    positionSurround();
  }
  function hideSurround(){ if(surround) surround.classList.add('hidden'); closePop(); }
  // arrange the four bars as a clean 3×3 grid around the node (top / [left · node · right] / bottom),
  // so the vertical columns sit in the middle band and never overlap the horizontal bars.
  function positionSurround(){
    if(!surround||surround.classList.contains('hidden')||!selected) return;
    const r=nodeScreenRect(selected), G=11, clamp=U.clamp;
    const top=surround.querySelector('.mm-sbar-top'), bot=surround.querySelector('.mm-sbar-bottom');
    const lft=surround.querySelector('.mm-sbar-left'), rgt=surround.querySelector('.mm-sbar-right'), q=surround.querySelector('.mm-quick');
    const place=(el,x,y)=>{ el.style.left=Math.round(x)+'px'; el.style.top=Math.round(y)+'px'; };
    const sideH=Math.max(lft?lft.offsetHeight:0, rgt?rgt.offsetHeight:0);
    const bandH=Math.max(r.h, sideH);                 // middle row height (node or side columns, whichever taller)
    const bandTop=r.cy-bandH/2, bandBot=r.cy+bandH/2;
    if(top){ const w=top.offsetWidth,h=top.offsetHeight; place(top, clamp(r.cx-w/2,6,r.rootW-w-6), Math.max(6, bandTop-G-h)); }
    if(bot){ const w=bot.offsetWidth,h=bot.offsetHeight; let y=bandBot+G; if(y+h>r.rootH-6)y=r.rootH-h-6; place(bot, clamp(r.cx-w/2,6,r.rootW-w-6), y); }
    if(lft){ const w=lft.offsetWidth,h=lft.offsetHeight; let x=r.left-w-G; if(x<6)x=6; place(lft, x, clamp(r.cy-h/2,6,r.rootH-h-6)); }
    if(rgt){ const w=rgt.offsetWidth,h=rgt.offsetHeight; let x=r.left+r.w+G; if(x+w>r.rootW-6)x=r.rootW-w-6; place(rgt, x, clamp(r.cy-h/2,6,r.rootH-h-6)); }
    if(q){ const w=q.offsetWidth; place(q, clamp(r.cx-w/2,6,r.rootW-w-6), r.top+r.h-4); }
  }

  // ---------- "More" + "Schema" submenus ----------
  function openMoreMenu(n){
    mmMenu([
      {ic:n.locked?'unlock':'lock', t:n.locked?I.t('cm.menuUnlockFigure','Odblokuj figurę'):I.t('cm.menuLockFigure','Zablokuj figurę'), fn:()=>{ n.locked=!n.locked; render(); selectNode(n); }},
      {ic:n.collapsed?'expand':'collapse', t:n.collapsed?I.t('cm.menuExpandBranch','Rozwiń gałąź'):I.t('cm.menuCollapseBranch','Zwiń gałąź'), fn:()=>{ n.collapsed=!n.collapsed; render(); selectNode(n); }},
      {ic:'note', t:I.t('cm.menuNoteDots','Notatka…'), fn:()=>addNote(n)},
      {ic:'crosshair', t:I.t('cm.menuCenterScreen','Wyśrodkuj na ekranie'), fn:()=>centerOn(n)},
      {sep:true},
      {ic:'trash', t:I.t('cm.menuDeleteBranch','Usuń całą gałąź'), danger:true, fn:()=>delBranch(n)},
    ]);
  }
  function openSchemaMenu(n){
    mmMenu([
      {ic:'palette', t:I.t('cm.menuColorSchema','Schemat kolorów'), fn:()=>openColorSchemaPopover()},
      {ic:'x', t:I.t('cm.menuDisableColorSchema','Wyłącz schemat kolorów'), fn:()=>disableColorSchema()},
      {ic:'grid', t:I.t('cm.menuLayoutSchemaShort','Schemat układu'), fn:()=>showLayoutDialog()},
      {ic:'resize', t:I.t('cm.menuSubnodeSpacing','Odstęp pod-węzłów'), fn:()=>openSpacingPopover()},
    ]);
  }
  function openColorSchemaPopover(){
    mmPopover(I.t('cm.menuColorSchema','Schemat kolorów'),(box)=>{ const wrap=U.el('div',{class:'mm-schema-pals'});
      for(const name in T.SCHEMA_PALETTES){ const b=U.el('button',{class:'mm-pal',title:name,onclick:()=>applyColorSchema(name)});
        T.SCHEMA_PALETTES[name].slice(0,5).forEach(c=>b.appendChild(U.el('span',{style:`background:${c}`}))); wrap.appendChild(b); }
      box.appendChild(wrap);
      box.appendChild(U.el('button',{class:'mm-pal mm-pal-off',style:'margin-top:8px',html:CM.icons.svg('x',{size:14})+' '+I.t('cm.disableSchema','Wyłącz schemat'),onclick:()=>{ disableColorSchema(); closePop(); }}));
    });
  }
  function openSpacingPopover(){
    mmPopover(I.t('cm.menuSubnodeSpacing','Odstęp pod-węzłów'),(box)=>{
      const mkR=(lbl,min,max,val,set)=>{ const w=U.el('label',{class:'mm-rng'}); const sp=U.el('span',{text:lbl+': '+val}); w.appendChild(sp);
        const r=U.el('input',{type:'range',min:String(min),max:String(max),value:String(val),style:'width:230px'});
        r.oninput=()=>{ sp.textContent=lbl+': '+r.value; set(+r.value); if(state.layout&&state.layout!=='free') applyLayout(state.layout); }; w.appendChild(r); box.appendChild(w); };
      mkR(I.t('cm.spacingMain','Główny (poziomy odstęp)'),120,540,state.spaceMain,v=>state.spaceMain=v);
      mkR(I.t('cm.spacingCross','Poprzeczny (rodzeństwo)'),40,220,state.spaceCross,v=>state.spaceCross=v);
      if(state.layout==='free') box.appendChild(U.el('p',{class:'muted',style:'font-size:11px;margin-top:4px',text:I.t('cm.spacingHint','Wybierz schemat układu inny niż „Dowolny", aby odstęp działał.')}));
    });
  }
  function toggleGroup(n){ pushUndo(); n.grouped=!n.grouped; render(); selectNode(n); }

  // ---------- okno „Schemat układu” (CM.MindMapLayout.createDialog) ----------
  function showLayoutDialog(tab){ if(layoutDlg) layoutDlg.show(tab); }

  // ---------- inspector (right panel) ----------
  function renderInspector(){
    if(!inspector) return;
    inspector.innerHTML='';
    inspector.appendChild(U.el('div',{class:'mm-insp-head',text:I.t('cm.inspProperties','Właściwości')}));
    if(!selected){
      inspector.appendChild(U.el('p',{class:'muted',style:'padding:10px 4px',text:I.t('cm.inspEmptyHint','Kliknij węzeł, aby go edytować. Dwuklik na tle = nowy węzeł. Dwuklik na węźle = edycja tekstu.')}));
      // map-level controls
      const sec=U.el('div',{class:'mm-sec'});
      sec.appendChild(U.el('h5',{text:I.t('cm.inspTemplatesHint','Szablony — kliknij, aby dodać')}));
      const grid=U.el('div',{class:'mm-tpl-grid'});
      for(const k of T.FRAMES){ const b=U.el('button',{class:'mm-tpl-chip mm-tpl-'+k,title:T.frameName(k),onclick:()=>addNodeCentered({template:k})});
        b.appendChild(U.el('span',{class:'mm-tpl-chip-lbl',text:T.frameName(k)})); grid.appendChild(b); }
      sec.appendChild(grid); inspector.appendChild(sec);
      return;
    }
    const n=selected;
    // text
    const s1=U.el('div',{class:'mm-sec'}); s1.appendChild(U.el('h5',{text:I.t('cm.inspContent','Treść')}));
    const ta=U.el('textarea',{class:'mm-input',rows:'3'}); ta.value=n.text; ta.oninput=()=>{ n.text=ta.value; render(); selected=n; }; s1.appendChild(ta);
    inspector.appendChild(s1);
    // template
    const s2=U.el('div',{class:'mm-sec'}); s2.appendChild(U.el('h5',{text:I.t('cm.inspFrameTemplate','Szablon ramki')}));
    const tg=U.el('div',{class:'mm-tpl-grid'});
    for(const k of T.FRAMES){ const b=U.el('button',{class:'mm-tpl-chip mm-tpl-'+k+(n.template===k?' on':''),title:T.frameName(k),onclick:()=>{ n.template=k; render(); selected=n; renderInspector(); }});
      b.appendChild(U.el('span',{class:'mm-tpl-chip-lbl',text:T.frameName(k)})); tg.appendChild(b); }
    s2.appendChild(tg); inspector.appendChild(s2);
    // color
    const s3=U.el('div',{class:'mm-sec'}); s3.appendChild(U.el('h5',{text:I.t('cm.inspColor','Kolor')}));
    const cr=U.el('div',{class:'mm-color-row'});
    for(const c of T.COLORS){ const b=U.el('button',{class:'mm-color'+(n.color===c?' on':''),style:`background:${c}`,onclick:()=>{ n.color=c; render(); selected=n; renderInspector(); }}); cr.appendChild(b); }
    const cp=U.el('input',{type:'color',class:'mm-color-pick',value:n.color}); cp.oninput=()=>{ n.color=cp.value; render(); selected=n; }; cr.appendChild(cp);
    s3.appendChild(cr); inspector.appendChild(s3);
    // size
    const s4=U.el('div',{class:'mm-sec'}); s4.appendChild(U.el('h5',{text:I.t('cm.inspSize','Rozmiar')}));
    const fr=U.el('label',{class:'mm-rng'}); fr.appendChild(U.el('span',{text:I.t('cm.inspFont','Czcionka')}));
    const fi=U.el('input',{type:'range',min:'10',max:'34',value:n.font}); fi.oninput=()=>{ n.font=+fi.value; render(); selected=n; }; fr.appendChild(fi); s4.appendChild(fr);
    const wr=U.el('label',{class:'mm-rng'}); wr.appendChild(U.el('span',{text:I.t('cm.inspWidth','Szerokość')}));
    const wi=U.el('input',{type:'range',min:'110',max:'420',value:n.w}); wi.oninput=()=>{ n.w=+wi.value; render(); selected=n; }; wr.appendChild(wi); s4.appendChild(wr);
    inspector.appendChild(s4);
    // actions
    const acts=U.el('div',{class:'mm-sec mm-acts'});
    acts.appendChild(U.el('button',{class:'tb-btn',onclick:()=>delNode(n),html:CM.icons.svg('trash',{size:14})+' '+I.t('cm.menuDeleteNode','Usuń węzeł')}));
    inspector.appendChild(acts);
  }

  // ---------- zapis / odczyt (CM.MindMapIO) ----------
  function syncTitle(){ const t=document.querySelector('#mm-title'); if(t) t.value=state.name||''; }
  // wczytana mapa (plik / pamięć urządzenia) → stan edytora; historia cofania startuje od zera
  function load(m){ IO.readInto(state, m); if(CM.Draw&&CM.Draw.load) CM.Draw.load(m.draw||[]);
    selected=null; multi.clear(); _undo.length=0; _redo.length=0; refreshUndoBtns(); syncTitle(); render(); renderInspector(); fitView(); io.loadSnaps(); }

  // ---------- lifecycle ----------
  function activate(){ ensureDom(); active=true; root.classList.remove('hidden');
    const r=canvas.getBoundingClientRect(); if(!cam.x&&!cam.y){ cam={x:r.width/2,y:r.height/2,zoom:1}; }
    if(!state.nodes.length){ showLayoutDialog('tpl'); }   // first time -> pick a template
    io.loadSnaps();
    setTimeout(()=>{ render(); drawEdges(); },30);
  }
  function deactivate(){ if(root){ root.classList.add('hidden'); }
    // close the draw bar too — its capture-phase keydown (V/P/R/…/Ctrl+Z) stays live while `open`
    // is true, so leaving MindMap without this would hijack shortcuts in CodeMap mode.
    if(CM.Draw && CM.Draw.isOpen && CM.Draw.isOpen()) CM.Draw.toggle(false);
    active=false; }
  function isActive(){ return active; }

  // rebuild visible MindMap UI when the interface language changes
  try{ I.onChange(()=>{
    if(!built) return;                               // nothing rendered yet
    // re-localize the MindMap chrome even when it's built but currently hidden (the user may switch
    // language while in CodeMap mode) — otherwise the tool rail / inspector keep the old language.
    const toolsEl=document.getElementById('mm-tools'); if(toolsEl) fillTools(toolsEl);
    const titleIn=document.getElementById('mm-title'); if(titleIn) titleIn.title=I.t('cm.titleInput','Nazwa mapy myśli');
    closePop();                                       // drop any open popover/menu (would be stale)
    renderInspector();                                // right panel rebuilds safely
    if(layoutDlg && layoutDlg.isOpen()) layoutDlg.rerender();
    if(document.body.classList.contains('mode-mindmap') && selected) showSurround(selected);
  }); }catch(e){ /* bez modułu i18n (testy) — bez przełączania języka */ }

  // ---- public state I/O (used by CM.Drive — Sejf / Dysk) ----
  function exportState(){ return JSON.parse(mmSnap()); }
  function importState(o){ try{ pushUndo(); }catch(e){ /* przyciski cofania niezbudowane — import idzie dalej */ } mmRestore(typeof o==='string'?o:JSON.stringify(o)); setTimeout(fitView,30); }
  function mapName(){ return state.name||I.t('cm.defaultMapName','Mapa myśli'); }
  function nodeCount(){ return state.nodes.length; }

  return { activate, deactivate, isActive, exportState, importState, mapName, nodeCount,
    _build:buildDiagram, _diags:()=>T.DIAGRAMS.map(d=>({k:d.k,name:d.name})), _tpls:()=>T.FRAMES.slice(), _state:()=>state };
})();
