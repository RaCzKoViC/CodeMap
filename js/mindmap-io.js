/* ===================== mindmap-io.js — import / eksport i historia migawek MindMap =====================
   CM.MindMapIO — czysta serializacja (bez DOM, testowalna w Node):
     • plik .mindmap.json: toFile / readInto (seq bez kolizji id, stabilny mapId dla starych zapisów)
     • konspekt Markdown w obie strony: toMarkdown / parseOutline / outlineToNodes
     • obraz: wrapText / buildSvg (wektorowy SVG mapy; PNG = raster tego SVG)
     • migawki: snapKey / makeSnap / isDupSnap / snapDiff
   oraz create(ctx) — akcje edytora na tej serializacji: zapis / odczyt w pamięci urządzenia (okno),
   eksport / import pliku, PNG / SVG, menu Markdown, oś czasu migawek. Kontekst ctx dostarcza mindmap.js. */
CM.MindMapIO = (function(){
  const U = CM.util, I = CM.i18n, S = CM.MindMapStrings, T = CM.MindMapTemplates, L = CM.MindMapLayout;
  const FORMAT='codemap-mindmap', LS_KEY='codemap_mindmaps', SNAP_PREFIX='codemap_mm_snaps_';
  // największy numer z id 'n<liczba>' — seq musi go wyprzedzać (inaczej duplikaty id po usunięciach)
  const maxSeq=(nodes)=>(nodes||[]).reduce((mx,n)=>Math.max(mx, parseInt(String(n.id).slice(1))||0), 0);

  // ---------- plik .mindmap.json ----------
  function toFile(st, draw){ return {format:FORMAT, name:st.name, mapId:st.mapId, nodes:st.nodes, edges:st.edges, seq:st.seq,
    layout:st.layout, line:st.line, spaceMain:st.spaceMain, spaceCross:st.spaceCross, draw:draw||[]}; }
  // obiekt mapy (plik / zapis lokalny) → stan st; warstwę rysunku (m.draw) wczytuje wywołujący
  function readInto(st, m){
    st.nodes=m.nodes||[]; st.edges=m.edges||[];
    st.seq=Math.max(m.seq||0, maxSeq(m.nodes)+1, 1); st.name=m.name||I.t('cm.defaultMindMap','Mapa myśli');
    // zapisany układ / linie / odstępy (starsze zapisy ich nie mają → zostają bieżące)
    if(m.layout) st.layout=m.layout; if(m.line) st.line=m.line;
    if(m.spaceMain) st.spaceMain=m.spaceMain; if(m.spaceCross) st.spaceCross=m.spaceCross;
    // stabilne id historii migawek (zgodność wstecz: mapy zapisane bez id dostają id z nazwy)
    st.mapId=m.mapId||('name_'+String(m.name||'default').replace(/[^\w]/g,'_').slice(0,40));
    return st;
  }

  // ---------- konspekt Markdown ----------
  // drzewo z linków rodzic → dziecko: korzeń „# tekst”, potomkowie „- tekst” wcięci o 2 spacje na poziom
  function toMarkdown(nodes){
    const children=new Map(); nodes.forEach(n=>children.set(n.id,[]));
    const roots=[];
    nodes.forEach(n=>{ if(n.parent!=null && children.has(n.parent)) children.get(n.parent).push(n); else roots.push(n); });
    const out=[];
    const emit=(n,depth)=>{
      const txt=String(n.text==null?'':n.text).replace(/\r?\n/g,' ').trim()||I.t('cm.mdUntitled','(bez nazwy)');
      if(depth===0) out.push('# '+txt);
      else out.push('  '.repeat(depth-1)+'- '+txt);
      for(const c of children.get(n.id)) emit(c, depth+1);
    };
    roots.forEach(r=>emit(r,0));
    return out.join('\n')+'\n';
  }
  // konspekt → płaska lista {depth,text}: nagłówki (#/##/###) i punkty z wcięciem (-, *, +, „1.”)
  function parseOutline(text){
    const items=[];
    const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n');
    for(let raw of lines){
      const line=raw.replace(/\s+$/,'');
      if(!line.trim()) continue;
      const head=line.match(/^(#{1,6})\s+(.*)$/);
      if(head){ items.push({depth:head[1].length-1, text:head[2].trim()}); continue; }
      const m=line.match(/^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$/);
      if(m){
        const indent=m[1].replace(/\t/g,'  ');
        const lvl=Math.floor(indent.length/2);   // 2 spacje = 1 poziom wcięcia
        items.push({depth:lvl+1, text:m[2].trim(), bullet:true});
        continue;
      }
      // zwykła linia (bez znacznika): wcięcie = głębokość, domyślnie korzeń
      const pm=raw.match(/^([ \t]*)(.*)$/);
      const indent=(pm?pm[1]:'').replace(/\t/g,'  ');
      items.push({depth:Math.floor(indent.length/2), text:line.trim()});
    }
    return items;
  }
  // lista z parseOutline → węzły z linkami rodzica (+ krawędzie) w st {nodes, edges, seq}; najpłytszy poziom = korzenie
  function outlineToNodes(items, st){
    let minDepth=1e9; for(const it of items) minDepth=Math.min(minDepth,it.depth);
    for(const it of items) it.depth-=minDepth;
    const {mk, lk}=T.builder(st);
    const stack=[];   // stack[d] = ostatni węzeł utworzony na głębokości d
    const PAL=['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b','#f472b6','#38bdf8','#a3e635'];
    items.forEach((it,i)=>{
      let d=it.depth;
      // dziecko najwyżej o jeden poziom głębiej niż jego przyszły rodzic
      if(d>stack.length) d=stack.length;
      const parent = d>0 ? stack[d-1] : null;
      const tpl = d===0 ? 'banner' : (d===1 ? 'card' : 'note');
      const col = d===0 ? '#7c5cff' : PAL[d%PAL.length];
      const n=mk(d*260-200, i*64-120, {text:it.text||I.t('cm.mdUntitled','(bez nazwy)'), template:tpl, color:col, w:d===0?220:180, font:d===0?16:14, parent:parent?parent.id:null});
      if(parent) lk(parent, n);
      stack[d]=n; stack.length=d+1;
    });
    return st;
  }

  // ---------- obraz (SVG wektor / PNG raster) ----------
  function wrapText(text, maxW, font){
    const cpl=Math.max(4, Math.floor(maxW/(font*0.56))); const out=[];
    for(const para of String(text).split('\n')){
      if(para.length<=cpl){ out.push(para); continue; }
      let line=''; for(const w of para.split(/\s+/)){ if((line+' '+w).trim().length>cpl){ if(line) out.push(line); line=w; } else line=(line?line+' ':'')+w; }
      if(line) out.push(line);
    }
    return out.length?out:[''];
  }
  // mapa → samodzielny SVG; opts: {pad, heightOf(n) (wysokość karty w px), hidden(n) (zwinięty), bg, drawBounds, drawSvg}
  function buildSvg(st, opts){
    opts=opts||{}; const pad=opts.pad||60, hidden=opts.hidden||(()=>false);
    const heights=new Map();
    for(const n of st.nodes) heights.set(n.id, opts.heightOf?opts.heightOf(n):60);
    const H=(n)=>heights.get(n.id)||60;
    let {minX, minY, maxX, maxY}=L.cardBounds(st.nodes, H, hidden);
    // rysunki też poszerzają eksportowany obszar
    const db=opts.drawBounds||null;
    if(db){ minX=Math.min(minX,db.minX); minY=Math.min(minY,db.minY); maxX=Math.max(maxX,db.maxX); maxY=Math.max(maxY,db.maxY); }
    if(minX>maxX){ minX=0;minY=0;maxX=300;maxY=200; }
    const W=Math.ceil(maxX-minX+pad*2), Ht=Math.ceil(maxY-minY+pad*2), vx=minX-pad, vy=minY-pad;
    const esc=U.escapeHtml;
    const curved=st.line==='curved';
    let edges='';
    L.eachConnector(st, H, hidden, (from,to,col,wide)=>{ edges+=L.connectorSvg(from, to, curved, col, wide); });
    let body='';
    for(const n of st.nodes){ if(hidden(n))continue; const h=H(n), col=n.color||'#22d3ee', tpl=n.template||'card';
      let fill='#f3f6fb', tcol='#0a1018', stroke=col, sw=2, rx=12, center=false;
      if(tpl==='banner'){ fill=col; tcol='#fff'; stroke='none'; }
      else if(tpl==='sticky'){ fill=col; tcol='#101418'; stroke='none'; rx=3; }
      else if(tpl==='hexcard'){ fill=col; tcol='#0a1018'; stroke='none'; }
      else if(tpl==='pill'||tpl==='cloud'||tpl==='circle'){ fill='#fff'; rx=h/2; center=true; }
      else if(tpl==='code'||tpl==='frame'){ fill='#0d1320'; tcol='#cdd6e4'; }
      else if(tpl==='terminal'){ fill='#0a0e16'; tcol='#74f59a'; stroke='#1d2735'; rx=8; }
      else if(tpl==='neon'){ fill='#0c1322'; tcol='#eaf6ff'; stroke=col; rx=12; }
      else if(tpl==='tag'){ fill=col; tcol='#0a1018'; stroke='none'; rx=7; }
      else if(tpl==='diamond'){ fill=col; tcol='#0a1018'; stroke='none'; center=true; }
      // (quote: domyślna biała karta + lewy pasek koloru poniżej)
      if(tpl==='diamond'){ const cx=n.x+n.w/2, cy=n.y+h/2;
        body+=`<polygon points="${cx},${n.y} ${n.x+n.w},${cy} ${cx},${n.y+h} ${n.x},${cy}" fill="${fill}"/>`; }
      else body+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${h}" rx="${rx}" fill="${fill}"${stroke!=='none'?` stroke="${stroke}" stroke-width="${sw}"`:''}/>`;
      if(tpl==='card'||tpl==='quote') body+=`<rect x="${n.x}" y="${n.y}" width="5" height="${h}" rx="2" fill="${col}"/>`;
      const font=n.font||14, lines=wrapText(n.text||'', n.w-22, font), lh=font*1.32, ty0=n.y+h/2-(lines.length*lh)/2+font*0.9;
      lines.forEach((ln,i)=>{ body+=`<text x="${n.x+(center?n.w/2:14)}" y="${ty0+i*lh}" font-size="${font}" font-weight="600" fill="${tcol}" font-family="Inter,system-ui,sans-serif" text-anchor="${center?'middle':'start'}">${esc(ln)}</text>`; });
    }
    const bg=opts.bg||'#0b1018';
    const drawLayer=opts.drawSvg||'';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Ht}" viewBox="${vx} ${vy} ${W} ${Ht}"><rect x="${vx}" y="${vy}" width="${W}" height="${Ht}" fill="${bg}"/>${edges}${body}${drawLayer}</svg>`;
    return {svg, w:W, h:Ht};
  }

  // ---------- migawki (historia mapy) ----------
  // klucz historii to STABILNE id mapy (nie edytowalny tytuł) — zmiana nazwy nie osieroca historii
  const snapKey=(mapId)=>SNAP_PREFIX+mapId;
  function makeSnap(st, reason, draw){
    return {ts:Date.now(),reason:reason||'auto',nodes:JSON.parse(JSON.stringify(st.nodes)),edges:JSON.parse(JSON.stringify(st.edges)),name:st.name,layout:st.layout,line:st.line,
      seq:st.seq, draw:draw||[]};
  }
  // bez duplikatów kolejnych migawek: < 3 s od poprzedniej i ta sama liczba węzłów
  const isDupSnap=(last, s)=>!!(last && Math.abs(last.ts-s.ts)<3000 && last.nodes.length===s.nodes.length);
  function snapDiff(a,b){
    const am=new Map(a.map(n=>[n.id,n])), bm=new Map(b.map(n=>[n.id,n]));
    return { added:b.filter(n=>!am.has(n.id)), removed:a.filter(n=>!bm.has(n.id)), changed:b.filter(n=>{ const o=am.get(n.id); return o&&(o.x!==n.x||o.y!==n.y||o.text!==n.text||o.color!==n.color||o.template!==n.template); }) };
  }

  // ---------- akcje edytora ----------
  // ctx z mindmap.js: {state, canvas, world, pushUndo, load, render, renderInspector, hideSurround, syncTitle,
  //   fitView, applyLayout, deselect, mmMenu, mmInput, cardHeight, hiddenByCollapse}
  function create(ctx){
    const st=ctx.state;
    const drawSer=()=>(CM.Draw&&CM.Draw.serialize)?CM.Draw.serialize():[];
    const fileBase=()=>(st.name||I.t('cm.defaultFilename','mapa')).replace(/[^\w.-]+/g,'_');
    let snaps=[], snapTimer=null, timelineEl=null, slModal=null, slMode='save';

    // ---- zapis / odczyt w pamięci urządzenia ----
    function allLocal(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); }catch(e){ return {}; } }
    function saveLocal(){ showSlModal('save'); }
    function openLocalPicker(){ showSlModal('load'); }
    function buildSlModal(){
      slModal=U.el('div',{id:'mm-sl-modal',class:'hidden'});
      slModal.addEventListener('click',(e)=>{ if(e.target===slModal) hideSlModal(); });
      ctx.canvas.appendChild(slModal);
    }
    function hideSlModal(){ if(slModal) slModal.classList.add('hidden'); }
    function showSlModal(mode){
      if(!slModal){ buildSlModal(); }
      slMode=mode;
      slModal.innerHTML='';
      const isSave=mode==='save';
      const box=U.el('div',{class:'mm-sl-box'});
      const head=U.el('div',{class:'mm-sl-head'});
      head.appendChild(U.el('h3',{text:isSave?I.t('cm.slTitleSave','Zapisz mapę'):I.t('cm.slTitleLoad','Wczytaj mapę')}));
      const xBtn=U.el('button',{class:'mm-sl-head-x',html:CM.icons.svg('x',{size:15}),onclick:hideSlModal});
      head.appendChild(xBtn);
      const body=U.el('div',{class:'mm-sl-body'});
      let nameInp=null;
      if(isSave){
        const row=U.el('div',{class:'mm-sl-name-row'});
        nameInp=U.el('input',{placeholder:I.t('cm.slNamePlaceholder','Nazwa mapy...'),value:st.name||I.t('cm.defaultMindMap','Mapa myśli')});
        const saveBtn=U.el('button',{text:I.t('cm.slSaveBtn','Zapisz')});
        saveBtn.onclick=()=>{
          const n=nameInp.value.trim(); if(!n) return;
          st.name=n; ctx.syncTitle();
          const s=allLocal(); s[n]={name:n,mapId:ensureMapId(),nodes:st.nodes,edges:st.edges,seq:st.seq,
            // zapis lokalny niesie te same pola co eksport pliku — bez nich wczytanie czyściło warstwę
            // rysunku (CM.Draw.load(m.draw||[])) i zostawiało układ / linie / odstępy poprzedniej mapy
            draw:drawSer(),
            layout:st.layout, line:st.line, spaceMain:st.spaceMain, spaceCross:st.spaceCross, ts:Date.now()};
          try{ localStorage.setItem(LS_KEY,JSON.stringify(s)); }
          catch(err){ U.toast(I.t('cm.slSaveErr','Błąd zapisu — pamięć przeglądarki pełna.'),'error'); return; }
          U.toast('💾 '+I.t('cm.toastSavedPre','Zapisano „')+n+I.t('cm.toastSavedPost','".'),'success');
          hideSlModal();
        };
        nameInp.addEventListener('keydown',(e)=>{ if(e.key==='Enter') saveBtn.click(); });
        row.appendChild(nameInp); row.appendChild(saveBtn); body.appendChild(row);
      }
      const store=allLocal(); const names=Object.keys(store);
      const list=U.el('div',{class:'mm-sl-list'});
      if(!names.length){
        list.appendChild(U.el('div',{class:'mm-sl-empty',text:I.t('cm.slEmpty','Brak zapisanych map.')}));
      } else {
        names.slice().reverse().forEach(name=>{
          const m=store[name];
          const item=U.el('div',{class:'mm-sl-item'});
          item.appendChild(U.el('div',{class:'mm-sl-item-ic',html:CM.icons.svg('layers',{size:18})}));
          const info=U.el('div',{class:'mm-sl-item-info'});
          info.appendChild(U.el('div',{class:'mm-sl-item-name',text:name}));
          const ago=m.ts?(U.relTime?U.relTime(m.ts):new Date(m.ts).toLocaleString()):'-';
          info.appendChild(U.el('div',{class:'mm-sl-item-meta',text:(m.nodes||[]).length+I.t('cm.slNodes',' węzłów · ')+ago}));
          item.appendChild(info);
          const del=U.el('button',{class:'mm-sl-item-del',title:I.t('cm.slDelete','Usuń'),html:CM.icons.svg('trash',{size:13})});
          del.onclick=(e)=>{ e.stopPropagation();
            // razem z mapą znika jej historia migawek — inaczej każde usunięcie zostawiało do 40 kopii stanu
            if(m.mapId) U.lsDel(snapKey(m.mapId));
            delete store[name]; localStorage.setItem(LS_KEY,JSON.stringify(store)); showSlModal(slMode); };
          item.appendChild(del);
          item.addEventListener('click',(e)=>{ if(del.contains(e.target)) return;
            if(isSave && nameInp){ nameInp.value=name; nameInp.focus(); }
            else { ctx.load(m); U.toast(I.t('cm.toastLoadedPre','Wczytano „')+name+I.t('cm.toastLoadedPost','".'),'success'); hideSlModal(); }
          });
          list.appendChild(item);
        });
      }
      body.appendChild(list);
      box.appendChild(head); box.appendChild(body); slModal.appendChild(box);
      slModal.classList.remove('hidden');
      if(isSave && nameInp) setTimeout(()=>{ nameInp.focus(); nameInp.select(); },50);
    }

    // ---- plik .mindmap.json ----
    function exportFile(){ U.download((st.name||I.t('cm.defaultFilename','mapa'))+'.mindmap.json', JSON.stringify(toFile(st, drawSer())), 'application/json'); }
    function importFilePicker(){
      const inp=U.el('input',{type:'file',accept:'.json,.mindmap.json'}); inp.style.display='none'; document.body.appendChild(inp);
      inp.onchange=async()=>{ const f=inp.files[0]; if(f){ try{ const obj=JSON.parse(await f.text()); ctx.load(obj); U.toast(I.t('cm.toastImported','Zaimportowano mapę myśli.'),'success'); }catch(e){ U.toast(I.t('cm.toastImportError','Błąd importu.'),'error'); } } inp.remove(); };
      inp.click();
    }

    // ---- obraz ----
    function svgOfMap(pad){
      return buildSvg(st, { pad, heightOf:(n)=>ctx.cardHeight(n.id), hidden:ctx.hiddenByCollapse,
        bg:(getComputedStyle(document.body).getPropertyValue('--bg')||'').trim()||'#0b1018',
        drawBounds:(CM.Draw&&CM.Draw.bounds)?CM.Draw.bounds():null, drawSvg:(CM.Draw&&CM.Draw.toSVG)?CM.Draw.toSVG():'' });
    }
    function exportImage(){
      if(!st.nodes.length){ U.toast&&U.toast(I.t('cm.toastEmptyExport','Mapa jest pusta — nie ma czego eksportować.'),'error'); return; }
      ctx.mmMenu([
        {ic:'image', t:I.t('cm.exportPng','Eksport PNG (2×)'), fn:()=>exportMM('png')},
        {ic:'download', t:I.t('cm.exportSvg','Eksport SVG (wektor)'), fn:()=>exportMM('svg')},
      ]);
    }
    function exportMM(kind){
      const {svg,w,h}=svgOfMap(60); const base=fileBase();
      if(kind==='svg'){ U.download(base+'.svg', svg, 'image/svg+xml'); U.toast&&U.toast(I.t('cm.toastSvgExported','Wyeksportowano SVG.'),'success'); return; }
      const scale=2, img=new Image(), url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
      img.onload=()=>{ const c=document.createElement('canvas'); c.width=w*scale; c.height=h*scale; const ctx2=c.getContext('2d'); ctx2.scale(scale,scale); ctx2.drawImage(img,0,0); URL.revokeObjectURL(url);
        c.toBlob(b=>{ if(!b){ U.toast&&U.toast(I.t('cm.toastPngError','Błąd eksportu PNG.'),'error'); return; } const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=base+'.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1500); U.toast&&U.toast(I.t('cm.toastPngExported','Wyeksportowano PNG.'),'success'); },'image/png'); };
      img.onerror=()=>{ URL.revokeObjectURL(url); U.toast&&U.toast(I.t('cm.toastSvgPngError','Błąd renderu SVG→PNG.'),'error'); };
      img.src=url;
    }

    // ---- Markdown (menu z przycisku „Markdown” w pasku narzędzi) ----
    function markdownMenu(){
      ctx.mmMenu([
        {head:I.t('cm.mdMenuTitle','Markdown / konspekt')},
        {ic:'download', t:I.t('cm.mdExport','Eksport do Markdown (.md)'), fn:()=>exportMarkdown()},
        {ic:'upload', t:I.t('cm.mdImportPaste','Import — wklej tekst'), fn:()=>importMarkdownPaste()},
        {ic:'open', t:I.t('cm.mdImportFile','Import — plik .md'), fn:()=>importMarkdownFile()},
      ]);
    }
    function exportMarkdown(){
      if(!st.nodes.length){ U.toast&&U.toast(I.t('cm.toastEmptyExport','Mapa jest pusta — nie ma czego eksportować.'),'error'); return; }
      U.download(fileBase()+'.md', toMarkdown(st.nodes), 'text/markdown');
      U.toast&&U.toast(I.t('cm.toastMdExported','Wyeksportowano Markdown.'),'success');
    }
    // konspekt → nowa mapa (poprzednia trafia do cofania) + schludny układ
    function importOutline(text){
      const items=parseOutline(text);
      if(!items.length){ U.toast&&U.toast(I.t('cm.toastMdEmpty','Brak treści do importu.'),'error'); return; }
      ctx.pushUndo();
      st.nodes=[]; st.edges=[]; ctx.deselect(); st.mapId=null;
      outlineToNodes(items, st);
      st.name=I.t('cm.mdImportedName','Zaimportowany konspekt'); ctx.syncTitle();
      snaps=[];
      if(st.layout && st.layout!=='free') ctx.applyLayout(st.layout); else ctx.render();
      ctx.renderInspector(); ctx.hideSurround();
      setTimeout(ctx.fitView,20);
      U.toast&&U.toast(I.t('cm.toastMdImported','Zaimportowano konspekt.'),'success');
    }
    function importMarkdownPaste(){
      ctx.mmInput(I.t('cm.mdPasteTitle','Wklej konspekt Markdown'), '', {multiline:true, placeholder:I.t('cm.mdPastePlaceholder','# Temat\n- Punkt\n  - Podpunkt')}).then(v=>{
        if(v===null) return; if(!v.trim()){ U.toast&&U.toast(I.t('cm.toastMdEmpty','Brak treści do importu.'),'error'); return; }
        importOutline(v);
      });
    }
    function importMarkdownFile(){
      const inp=U.el('input',{type:'file',accept:'.md,.markdown,.txt,text/markdown,text/plain'}); inp.style.display='none'; document.body.appendChild(inp);
      inp.onchange=async()=>{ const f=inp.files[0]; if(f){ try{ importOutline(await f.text()); }catch(e){ U.toast&&U.toast(I.t('cm.toastImportError','Błąd importu.'),'error'); } } inp.remove(); };
      inp.click();
    }

    // ---- migawki + oś czasu ----
    function ensureMapId(){ if(!st.mapId) st.mapId='m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); return st.mapId; }
    const snapLS=()=>snapKey(ensureMapId());
    function saveSnaps(){ U.lsSet(snapLS(),JSON.stringify(snaps.slice(-40))); }
    function loadSnaps(){ try{ const raw=localStorage.getItem(snapLS()); snaps=raw?JSON.parse(raw):[]; }catch(e){ snaps=[]; } updateTimeline(); }
    function clearSnaps(){ snaps=[]; }
    function takeSnap(reason){
      if(!st.nodes.length) return;
      const s=makeSnap(st, reason, drawSer());
      if(isDupSnap(snaps[snaps.length-1], s)) return;
      snaps.push(s); if(snaps.length>40) snaps.shift(); saveSnaps(); updateTimeline();
    }
    function autoSnap(reason){ clearTimeout(snapTimer); snapTimer=setTimeout(()=>takeSnap(reason),8000); }
    function restoreSnap(idx){
      const snap=snaps[idx]; if(!snap) return;
      const diff=snapDiff(st.nodes, snap.nodes);
      ctx.pushUndo();
      st.nodes=JSON.parse(JSON.stringify(snap.nodes)); st.edges=JSON.parse(JSON.stringify(snap.edges));
      if(snap.layout) st.layout=snap.layout; if(snap.line) st.line=snap.line;
      // seq nie może zostać za istniejącymi id (duplikaty po przywróceniu starej migawki)
      st.seq=Math.max(snap.seq||0, st.seq||0, maxSeq(st.nodes)+1);
      if(CM.Draw&&CM.Draw.load) CM.Draw.load(snap.draw||[]);
      ctx.deselect(); ctx.render(); ctx.renderInspector(); ctx.hideSurround();
      // animacja różnic
      setTimeout(()=>{ const world=ctx.world;
        diff.added.forEach(n=>{ const c=world&&world.querySelector('[data-id="'+n.id+'"]'); if(c) c.classList.add('mm-snap-added'); });
        diff.changed.forEach(n=>{ const c=world&&world.querySelector('[data-id="'+n.id+'"]'); if(c) c.classList.add('mm-snap-changed'); });
        setTimeout(()=>{ document.querySelectorAll('.mm-snap-added,.mm-snap-changed').forEach(c=>c.classList.remove('mm-snap-added','mm-snap-changed')); },900);
      },30);
      const ago=U.relTime?U.relTime(snap.ts):new Date(snap.ts).toLocaleTimeString();
      U.toast&&U.toast(S.SNAP.restored(ago, diff.added.length, diff.changed.length, diff.removed.length),'',2800);
      updateTimeline();
    }
    function buildTimeline(){
      timelineEl=U.el('div',{id:'mm-timeline'});
      const btn=U.el('button',{id:'mm-tl-toggle',title:S.SNAP.toggleTitle});
      btn.innerHTML=CM.icons.svg('clock',{size:15})+'<span>&nbsp;'+S.SNAP.toggle+'</span>';
      btn.onclick=()=>{ btn.classList.toggle('open'); updateTimeline(); };
      const track=U.el('div',{id:'mm-tl-track'});
      timelineEl.appendChild(btn); timelineEl.appendChild(track); ctx.canvas.appendChild(timelineEl);
    }
    function updateTimeline(){
      if(!timelineEl) return;
      const btn=timelineEl.querySelector('#mm-tl-toggle');
      const track=timelineEl.querySelector('#mm-tl-track');
      if(!track||!btn) return;
      if(!btn.classList.contains('open')){ track.style.display='none'; return; }
      track.style.display='flex'; track.innerHTML='';
      if(!snaps.length){ track.innerHTML='<span class="mm-tl-empty">'+S.SNAP.empty+'</span>'; return; }
      // najnowsze pierwsze
      for(let i=snaps.length-1;i>=0;i--){
        const s=snaps[i];
        const b=U.el('button',{class:'mm-tl-snap'+(i===snaps.length-1?' current':'')});
        const ago=U.relTime?U.relTime(s.ts):new Date(s.ts).toLocaleTimeString();
        b.innerHTML='<span class="mm-tl-dot"></span><span class="mm-tl-age">'+ago+'</span><span class="mm-tl-info">'+s.nodes.length+S.SNAP.nodes+'</span>'+(s.reason&&s.reason!=='auto'?'<span class="mm-tl-reason">'+s.reason+'</span>':'');
        b.onclick=(()=>{ const idx=i; return ()=>restoreSnap(idx); })();
        track.appendChild(b);
      }
      // przycisk „migawka teraz”
      const nb=U.el('button',{class:'mm-tl-snap',style:'border-color:var(--accent);background:rgba(34,211,238,.1)'});
      nb.innerHTML='<span style="color:var(--accent)">'+CM.icons.svg('plus',{size:13})+'</span><span class="mm-tl-age">'+S.SNAP.now+'</span><span class="mm-tl-info">'+S.SNAP.snapshot+'</span>';
      nb.onclick=()=>{ takeSnap(S.SNAP.manual); U.toast&&U.toast(S.SNAP.saved,'success',1500); };
      track.appendChild(nb);
    }

    return { saveLocal, openLocalPicker, buildSlModal, exportFile, importFilePicker, exportImage, markdownMenu, importOutline,
      loadSnaps, clearSnaps, takeSnap, autoSnap, buildTimeline };
  }

  return { FORMAT, maxSeq, toFile, readInto, toMarkdown, parseOutline, outlineToNodes, wrapText, buildSvg,
    snapKey, makeSnap, isDupSnap, snapDiff, create };
})();
