/* ===================== mmdraw.js — warstwa rysowania MindMap (klasa Excalidraw) =====================
   CM.Draw — odręczne rysowanie NA mapie myśli: warstwa SVG żyje WEWNĄTRZ #mm-world, więc szkice
   panują/zoomują się razem z węzłami i są ostre w każdej skali (wektor).
   • narzędzia: wskaźnik (V), pióro (P), prostokąt (R), elipsa (O), romb (D), strzałka (A),
     linia (L), tekst (T), gumka (E); Esc wraca do wskaźnika
   • styl: kolor kreski, wypełnienie (brak/kolor), grubość S/M/L, kreska ciągła/przerywana/kropki,
     krycie; edycja stylu działa też na zaznaczeniu
   • ręczny charakter kresek przez rough.js (CDN, on-demand) z czystym fallbackiem SVG
   • selekcja: przesuwanie, 4 uchwyty skalowania, Delete, Ctrl+D duplikat
   • własne undo/redo (Ctrl+Z/Y działa na rysunkach, gdy pasek Rysuj jest otwarty)
   • persystencja: elementy wchodzą w stan MindMap (undo mapy, zapisy, timeline, eksport SVG/PNG). */
CM.Draw = (function(){
  const U=CM.util, I=CM.i18n, ic=CM.icons;
  const pl=()=>I.getLang()!=='en';
  const T=(p,e)=>pl()?p:e;
  const NS='http://www.w3.org/2000/svg';

  let env=null;              // {world, canvas, screenToWorld, getZoom, onDirty, panBy, zoomAt} — z mindmap.js
  let svg=null, bar=null;    // warstwa SVG (render, wewnątrz world) + pasek narzędzi
  let surface=null;          // pełnowymiarowa warstwa wejścia (przestrzeń ekranu) — łapie pointer gdy pasek otwarty
  let els=[];                // elementy rysunku (model)
  let tool='select', open=false;
  let sel=null;              // zaznaczony element
  let style={stroke:'#f59e0b', fill:'', sw:2, dash:'solid', op:1};
  let seq=1;
  let _undo=[], _redo=[];
  let rough=null, roughTried=false;   // rough.js (opcjonalny)

  /* ---------------- model / (de)serializacja ---------------- */
  const ser=()=>els.map(e=>Object.assign({},e));
  function load(arr){ els=Array.isArray(arr)?arr.map(e=>Object.assign({},e)):[];
    seq=1+els.reduce((m,e)=>Math.max(m, parseInt(String(e.id).slice(1))||0),0);
    _undo.length=0; _redo.length=0;   // loading a new drawing set (map undo/restore/import) resets its own timeline
    sel=null; renderAll(); }
  const serialize=()=>ser();
  function snap(){ _undo.push(JSON.stringify(els)); if(_undo.length>60)_undo.shift(); _redo.length=0; }
  function undo(){ if(!_undo.length) return; _redo.push(JSON.stringify(els)); els=JSON.parse(_undo.pop()); sel=null; renderAll(); dirty(); }
  function redo(){ if(!_redo.length) return; _undo.push(JSON.stringify(els)); els=JSON.parse(_redo.pop()); sel=null; renderAll(); dirty(); }
  const dirty=()=>{ if(env&&env.onDirty) try{ env.onDirty(); }catch(e){} };

  /* ---------------- rough.js (hand-drawn) — on demand, z fallbackiem ---------------- */
  async function ensureRough(){
    if(rough||roughTried) return rough;
    roughTried=true;
    try{ const m=await import('https://esm.run/roughjs@4.6.6'); rough=(m.default||m).svg(svg); renderAll(); }
    catch(e){ rough=null; }
    return rough;
  }

  /* ---------------- render ---------------- */
  const dashArr=(e)=>e.dash==='dashed'?(4*e.sw)+' '+(3*e.sw):(e.dash==='dotted'?(1.2*e.sw)+' '+(2.4*e.sw):'');
  function penPath(e){
    const p=e.points; if(!p||p.length<2) return '';
    let d='M'+(e.x+p[0][0])+' '+(e.y+p[0][1]);
    for(let i=1;i<p.length-1;i++){
      const mx=(p[i][0]+p[i+1][0])/2, my=(p[i][1]+p[i+1][1])/2;
      d+=' Q'+(e.x+p[i][0])+' '+(e.y+p[i][1])+' '+(e.x+mx)+' '+(e.y+my);
    }
    const l=p[p.length-1]; d+=' L'+(e.x+l[0])+' '+(e.y+l[1]);
    return d;
  }
  function arrowHead(x1,y1,x2,y2,sw){
    const a=Math.atan2(y2-y1,x2-x1), L=9+sw*2.4;
    const p1=[x2-L*Math.cos(a-0.42), y2-L*Math.sin(a-0.42)];
    const p2=[x2-L*Math.cos(a+0.42), y2-L*Math.sin(a+0.42)];
    return 'M'+p1[0]+' '+p1[1]+' L'+x2+' '+y2+' L'+p2[0]+' '+p2[1];
  }
  function mkNode(e){
    const g=document.createElementNS(NS,'g');
    g.setAttribute('data-id',e.id); g.setAttribute('opacity',e.op==null?1:e.op);
    const common=(n)=>{ n.setAttribute('stroke',e.stroke); n.setAttribute('stroke-width',e.sw);
      n.setAttribute('fill',e.fill||'none'); n.setAttribute('stroke-linecap','round'); n.setAttribute('stroke-linejoin','round');
      const da=dashArr(e); if(da) n.setAttribute('stroke-dasharray',da); return n; };
    const ro=rough&&e.type!=='pen'&&e.type!=='text';
    const opt=ro?{stroke:e.stroke, strokeWidth:e.sw, fill:e.fill||undefined, fillStyle:'hachure',
      roughness:1.2, seed:e.seed||1, strokeLineDash:e.dash==='dashed'?[8,6]:(e.dash==='dotted'?[2,5]:undefined)}:null;
    try{
      if(e.type==='rect'){ if(ro) g.appendChild(rough.rectangle(e.x,e.y,e.w,e.h,opt));
        else{ const n=document.createElementNS(NS,'rect'); n.setAttribute('x',e.x);n.setAttribute('y',e.y);
          n.setAttribute('width',Math.abs(e.w));n.setAttribute('height',Math.abs(e.h));n.setAttribute('rx',3); g.appendChild(common(n)); } }
      else if(e.type==='ellipse'){ if(ro) g.appendChild(rough.ellipse(e.x+e.w/2,e.y+e.h/2,Math.abs(e.w),Math.abs(e.h),opt));
        else{ const n=document.createElementNS(NS,'ellipse'); n.setAttribute('cx',e.x+e.w/2);n.setAttribute('cy',e.y+e.h/2);
          n.setAttribute('rx',Math.abs(e.w)/2);n.setAttribute('ry',Math.abs(e.h)/2); g.appendChild(common(n)); } }
      else if(e.type==='diamond'){ const pts=[[e.x+e.w/2,e.y],[e.x+e.w,e.y+e.h/2],[e.x+e.w/2,e.y+e.h],[e.x,e.y+e.h/2]];
        if(ro) g.appendChild(rough.polygon(pts,opt));
        else{ const n=document.createElementNS(NS,'polygon'); n.setAttribute('points',pts.map(p=>p.join(',')).join(' ')); g.appendChild(common(n)); } }
      else if(e.type==='line'||e.type==='arrow'){
        const x2=e.x+e.w, y2=e.y+e.h;
        if(ro) g.appendChild(rough.line(e.x,e.y,x2,y2,opt));
        else{ const n=document.createElementNS(NS,'line'); n.setAttribute('x1',e.x);n.setAttribute('y1',e.y);
          n.setAttribute('x2',x2);n.setAttribute('y2',y2); g.appendChild(common(n)); }
        if(e.type==='arrow'){ const h=document.createElementNS(NS,'path'); h.setAttribute('d',arrowHead(e.x,e.y,x2,y2,e.sw));
          h.setAttribute('fill','none'); h.setAttribute('stroke',e.stroke); h.setAttribute('stroke-width',e.sw);
          h.setAttribute('stroke-linecap','round'); g.appendChild(h); } }
      else if(e.type==='pen'){ const n=document.createElementNS(NS,'path'); n.setAttribute('d',penPath(e));
        n.setAttribute('fill','none'); g.appendChild(common(n)); }
      else if(e.type==='text'){ const n=document.createElementNS(NS,'text');
        n.setAttribute('x',e.x); n.setAttribute('y',e.y+(e.font||18));
        n.setAttribute('fill',e.stroke); n.setAttribute('font-size',e.font||18);
        n.setAttribute('font-family','Segoe Print, Comic Sans MS, cursive');
        String(e.text||'').split('\n').forEach((ln,i)=>{ const ts=document.createElementNS(NS,'tspan');
          ts.setAttribute('x',e.x); ts.setAttribute('dy',i?1.25*(e.font||18):0); ts.textContent=ln; n.appendChild(ts); });
        g.appendChild(n); }
    }catch(err){}
    return g;
  }
  function renderAll(){
    if(!svg) return;
    if(!svg.isConnected && env) env.world.appendChild(svg);   // mm render() wipes the world — self-heal
    svg.innerHTML='';
    for(const e of els) svg.appendChild(mkNode(e));
    renderSel();
  }
  function renderSel(){
    svg.querySelectorAll('.mmd-selbox').forEach(x=>x.remove());
    if(!sel) { refreshBar(); return; }
    const b=bbox(sel);
    const g=document.createElementNS(NS,'g'); g.setAttribute('class','mmd-selbox');
    const r=document.createElementNS(NS,'rect');
    r.setAttribute('x',b.x-6);r.setAttribute('y',b.y-6);r.setAttribute('width',b.w+12);r.setAttribute('height',b.h+12);
    r.setAttribute('fill','none');r.setAttribute('stroke','var(--accent)');r.setAttribute('stroke-width',1.4);
    r.setAttribute('stroke-dasharray','5 4'); g.appendChild(r);
    for(const [hx,hy,pos] of [[b.x-6,b.y-6,'nw'],[b.x+b.w+6,b.y-6,'ne'],[b.x-6,b.y+b.h+6,'sw'],[b.x+b.w+6,b.y+b.h+6,'se']]){
      const h=document.createElementNS(NS,'rect');
      h.setAttribute('x',hx-5);h.setAttribute('y',hy-5);h.setAttribute('width',10);h.setAttribute('height',10);
      h.setAttribute('fill','var(--accent)');h.setAttribute('class','mmd-handle');h.setAttribute('data-h',pos);
      g.appendChild(h);
    }
    svg.appendChild(g);
    refreshBar();
  }
  function bbox(e){
    if(e.type==='pen'){ let x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
      for(const p of e.points){ x1=Math.min(x1,p[0]);y1=Math.min(y1,p[1]);x2=Math.max(x2,p[0]);y2=Math.max(y2,p[1]); }
      return {x:e.x+x1,y:e.y+y1,w:x2-x1,h:y2-y1}; }
    if(e.type==='text'){ const lines=String(e.text||'').split('\n'); const f=e.font||18;
      const w=Math.max(...lines.map(l=>l.length))*f*0.58, h=lines.length*f*1.25;
      return {x:e.x,y:e.y,w:Math.max(w,10),h:Math.max(h,f)}; }
    const x=Math.min(e.x,e.x+e.w), y=Math.min(e.y,e.y+e.h);
    return {x, y, w:Math.abs(e.w), h:Math.abs(e.h)};
  }
  function hit(wx,wy){
    for(let i=els.length-1;i>=0;i--){
      const e=els[i], b=bbox(e), m=6+e.sw;
      if(wx<b.x-m||wx>b.x+b.w+m||wy<b.y-m||wy>b.y+b.h+m) continue;
      if(e.type==='pen'){ for(const p of e.points){ const dx=wx-(e.x+p[0]), dy=wy-(e.y+p[1]);
          if(dx*dx+dy*dy<(m+4)*(m+4)) return e; } continue; }
      if(e.type==='line'||e.type==='arrow'){ // odległość od odcinka
        const x2=e.x+e.w,y2=e.y+e.h; const L2=(e.w*e.w+e.h*e.h)||1;
        let t=((wx-e.x)*e.w+(wy-e.y)*e.h)/L2; t=Math.max(0,Math.min(1,t));
        const dx=wx-(e.x+t*e.w), dy=wy-(e.y+t*e.h);
        if(dx*dx+dy*dy<(m+3)*(m+3)) return e; continue; }
      if(e.fill||e.type==='text') return e;                       // wypełnione/tekst: cały bbox
      const inn=m+2;                                              // kontur: tylko obwódka
      if(wx>b.x+inn&&wx<b.x+b.w-inn&&wy>b.y+inn&&wy<b.y+b.h-inn) continue;
      return e;
    }
    return null;
  }

  /* ---------------- interakcje ---------------- */
  let drag=null;   // {mode:'draw'|'move'|'resize'|'erase', el, sx,sy, ox,oy, handle, base}
  function ptr(ev){ const p=env.screenToWorld(ev.clientX, ev.clientY); return {x:p.x, y:p.y}; }
  // handles are rendered inside the world svg, but the pointer target is now the screen-space surface,
  // so hit-test handle corners by coordinates (tolerance scaled to ~stały rozmiar ekranowy)
  function hitHandle(wx,wy){
    if(!sel) return null;
    const b=bbox(sel), z=env.getZoom()||1, m=9/z;
    const corners=[[b.x-6,b.y-6,'nw'],[b.x+b.w+6,b.y-6,'ne'],[b.x-6,b.y+b.h+6,'sw'],[b.x+b.w+6,b.y+b.h+6,'se']];
    for(const [hx,hy,pos] of corners){ if(Math.abs(wx-hx)<=m+3&&Math.abs(wy-hy)<=m+3) return pos; }
    return null;
  }
  function onDown(ev){
    if(!open) return;
    if(ev.button!=null&&ev.button!==0) return;
    const p=ptr(ev);
    if(sel){ const h=hitHandle(p.x,p.y);
      if(h){ drag={mode:'resize', el:sel, handle:h, base:JSON.stringify(sel), sx:p.x, sy:p.y}; return; } }
    if(tool==='select'){
      const e=hit(p.x,p.y);
      if(e){ sel=e; renderSel(); drag={mode:'move', el:e, sx:p.x, sy:p.y, base:JSON.stringify(e)}; }
      else { if(sel){ sel=null; renderSel(); }
        drag={mode:'pan', px:ev.clientX, py:ev.clientY}; }   // klik w pustkę: odznacz + przesuwaj mapę
      return;
    }
    if(tool==='erase'){ drag={mode:'erase'}; eraseAt(p); return; }
    if(tool==='text'){ startText(p); return; }
    snap();
    const e={ id:'d'+(seq++), type:tool==='pen'?'pen':tool, x:p.x, y:p.y, w:0, h:0,
      stroke:style.stroke, fill:(tool==='rect'||tool==='ellipse'||tool==='diamond')?style.fill:'',
      sw:style.sw, dash:style.dash, op:style.op, seed:1+Math.floor((seq*9301)%997) };
    if(tool==='pen'){ e.points=[[0,0]]; }
    els.push(e); sel=null;
    drag={mode:'draw', el:e, sx:p.x, sy:p.y};
    renderAll();
  }
  function onMove(ev){
    if(!open||!drag) return;
    if(drag.mode==='pan'){ const dx=ev.clientX-drag.px, dy=ev.clientY-drag.py; drag.px=ev.clientX; drag.py=ev.clientY;
      if(env.panBy) env.panBy(dx,dy); return; }
    const p=ptr(ev);
    if(drag.mode==='erase'){ eraseAt(p); return; }
    const e=drag.el;
    if(drag.mode==='draw'){
      if(e.type==='pen'){ const lx=p.x-e.x, ly=p.y-e.y; const lp=e.points[e.points.length-1];
        if(Math.abs(lp[0]-lx)+Math.abs(lp[1]-ly)>1.2/env.getZoom()) e.points.push([lx,ly]); }
      else { e.w=p.x-e.x; e.h=p.y-e.y;
        if(ev.shiftKey&&(e.type==='rect'||e.type==='ellipse'||e.type==='diamond')){ const s=Math.max(Math.abs(e.w),Math.abs(e.h));
          e.w=Math.sign(e.w||1)*s; e.h=Math.sign(e.h||1)*s; } }
      requestRender(e);
    } else if(drag.mode==='move'){
      e.x+= p.x-drag.sx; e.y+= p.y-drag.sy; drag.sx=p.x; drag.sy=p.y; requestRender(e,true);
    } else if(drag.mode==='resize'){
      const b0=bbox(JSON.parse(drag.base)); const dx=p.x-drag.sx, dy=p.y-drag.sy;
      let nx=b0.x, ny=b0.y, nw=b0.w, nh=b0.h;
      if(drag.handle.includes('e')) nw=Math.max(8,b0.w+dx);
      if(drag.handle.includes('s')) nh=Math.max(8,b0.h+dy);
      if(drag.handle.includes('w')){ nx=b0.x+dx; nw=Math.max(8,b0.w-dx); }
      if(drag.handle.includes('n')){ ny=b0.y+dy; nh=Math.max(8,b0.h-dy); }
      applyBBox(e, JSON.parse(drag.base), {x:nx,y:ny,w:nw,h:nh});
      requestRender(e,true);
    }
  }
  function onUp(){
    if(!drag) return;
    const d=drag; drag=null;
    if(d.mode==='draw'){
      const e=d.el, b=bbox(e);
      if((e.type!=='pen'&&b.w<4&&b.h<4)||(e.type==='pen'&&e.points.length<3)){ els.pop(); _undo.pop(); renderAll(); return; }
      renderAll(); dirty();
    } else if(d.mode==='move'||d.mode==='resize'){
      if(JSON.stringify(d.el)!==d.base) preSnap(d.el, d.base);   // undo = stan sprzed przeciągnięcia
      renderAll(); dirty();
    } else if(d.mode==='erase'){ dirty(); }
  }
  // snapshot dla move/resize: lista z elementem w wersji SPRZED zmiany
  function preSnap(el, baseJson){
    const before=els.map(x=>x===el?JSON.parse(baseJson):Object.assign({},x));
    _undo.push(JSON.stringify(before)); if(_undo.length>60)_undo.shift(); _redo.length=0;
  }
  function applyBBox(e, base, nb){
    const b0=bbox(base);
    const kx=b0.w?nb.w/b0.w:1, ky=b0.h?nb.h/b0.h:1;
    if(e.type==='pen'){ const p0=JSON.parse(JSON.stringify(base.points));
      e.points=p0.map(pt=>[pt[0]*kx, pt[1]*ky]);
      e.x=nb.x+(base.x+Math.min(...p0.map(p=>p[0]))-b0.x)*kx-Math.min(...e.points.map(p=>p[0]));
      e.x=nb.x - Math.min(...e.points.map(p=>p[0]));
      e.y=nb.y - Math.min(...e.points.map(p=>p[1]));
    } else if(e.type==='text'){ e.x=nb.x; e.y=nb.y; e.font=Math.max(9,(base.font||18)*ky); }
    else { e.x=base.w<0?nb.x+nb.w:nb.x; e.y=base.h<0?nb.y+nb.h:nb.y;
      e.w=(base.w<0?-1:1)*nb.w; e.h=(base.h<0?-1:1)*nb.h; }
  }
  let _raf=0;
  function requestRender(){ if(_raf) return; _raf=requestAnimationFrame(()=>{ _raf=0; renderAll(); }); }
  function eraseAt(p){ const e=hit(p.x,p.y); if(!e) return; if(!eraseAt._s){ snap(); eraseAt._s=true; setTimeout(()=>eraseAt._s=false,600); }
    els=els.filter(x=>x!==e); if(sel===e) sel=null; renderAll(); }
  function startText(p){
    const z=env.getZoom();
    const inp=U.el('textarea',{class:'mmd-textinp'});
    inp.style.left=(p.x*z+envCam().x)+'px'; inp.style.top=(p.y*z+envCam().y)+'px';
    inp.style.fontSize=(18*z)+'px'; inp.style.color=style.stroke;
    (surface||env.canvas).appendChild(inp); setTimeout(()=>inp.focus(),20);
    const commit=()=>{ const v=inp.value.trim(); inp.remove();
      if(!v) return;
      snap();
      els.push({id:'d'+(seq++), type:'text', x:p.x, y:p.y, w:0,h:0, text:v, font:18,
        stroke:style.stroke, fill:'', sw:style.sw, dash:'solid', op:style.op});
      renderAll(); dirty(); };
    inp.addEventListener('blur',commit);
    inp.addEventListener('keydown',(e2)=>{ if(e2.key==='Enter'&&!e2.shiftKey){ e2.preventDefault(); inp.blur(); }
      if(e2.key==='Escape'){ inp.value=''; inp.blur(); } e2.stopPropagation(); });
  }
  function envCam(){ // odczyt cam z transformu world (nie mamy bezpośrednio cam)
    const t=env.world.style.transform||''; const m=t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    return {x:m?+m[1]:0, y:m?+m[2]:0};
  }

  /* ---------------- klawiatura (aktywna gdy pasek otwarty) ---------------- */
  function onKey(e){
    if(!open) return;
    if(env&&env.canvas&&env.canvas.offsetParent===null) return;   // MindMap hidden → don't hijack keys

    const t=e.target; if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
    const K=e.key.toLowerCase();
    if((e.ctrlKey||e.metaKey)&&K==='z'&&!e.shiftKey){ e.preventDefault(); e.stopPropagation(); undo(); return; }
    if((e.ctrlKey||e.metaKey)&&(K==='y'||(K==='z'&&e.shiftKey))){ e.preventDefault(); e.stopPropagation(); redo(); return; }
    if((e.ctrlKey||e.metaKey)&&K==='d'&&sel){ e.preventDefault(); e.stopPropagation(); snap();
      const c=JSON.parse(JSON.stringify(sel)); c.id='d'+(seq++); c.x+=14; c.y+=14; els.push(c); sel=c; renderAll(); dirty(); return; }
    if((e.key==='Delete'||e.key==='Backspace')&&sel){ e.preventDefault(); e.stopPropagation(); snap();
      els=els.filter(x=>x!==sel); sel=null; renderAll(); dirty(); return; }
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    const map={v:'select',p:'pen',r:'rect',o:'ellipse',d:'diamond',a:'arrow',l:'line',t:'text',e:'erase'};
    if(map[K]){ e.preventDefault(); e.stopPropagation(); setTool(map[K]); return; }
    if(e.key==='Escape'){ if(tool!=='select'){ e.preventDefault(); e.stopPropagation(); setTool('select'); }
      else if(sel){ e.preventDefault(); e.stopPropagation(); sel=null; renderSel(); } }
  }

  /* ---------------- pasek narzędzi ---------------- */
  const TOOLS=[
    ['select','V',T('Wskaźnik','Select'),'M4 3l7 17 2.4-7 7-2.4z'],
    ['pen','P',T('Pióro','Pen'),'M3 21l3.6-.9L19 7.7a2.1 2.1 0 0 0-3-3L3.6 17.1z'],
    ['rect','R',T('Prostokąt','Rectangle'),'M4 5h16v14H4z'],
    ['ellipse','O',T('Elipsa','Ellipse'),'M12 5a8 6 0 1 0 0 12 8 6 0 0 0 0-12z'],
    ['diamond','D',T('Romb','Diamond'),'M12 3l8 9-8 9-8-9z'],
    ['arrow','A',T('Strzałka','Arrow'),'M4 19L18 6M12 5h7v7'],
    ['line','L',T('Linia','Line'),'M5 19L19 5'],
    ['text','T',T('Tekst','Text'),'M5 6h14M12 6v13'],
    ['erase','E',T('Gumka','Eraser'),'M8 20l-5-5L14 4l6 6-9 10zM6 12l6 6'],
  ];
  const SWATCHES=['#f59e0b','#22d3ee','#f472b6','#4ade80','#a78bfa','#f87171','#eef2f8','#0f172a'];
  function svgIcon(d){ return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="'+d+'"/></svg>'; }
  function buildBar(){
    if(bar) return bar;
    bar=U.el('div',{id:'mm-drawbar',class:'hidden'});
    const tl=U.el('div',{class:'mmd-tools'});
    for(const [id,k,title,d] of TOOLS){
      const b=U.el('button',{class:'mmd-t','data-tool':id,title:title+' ('+k+')',html:svgIcon(d)});
      b.onclick=()=>setTool(id);
      tl.appendChild(b);
    }
    bar.appendChild(tl);
    bar.appendChild(U.el('div',{class:'mmd-sep'}));
    // kolory kreski
    const sw=U.el('div',{class:'mmd-swatches'});
    for(const c of SWATCHES){ const b=U.el('button',{class:'mmd-sw','data-c':c,style:'background:'+c,title:c});
      b.onclick=()=>{ style.stroke=c; applyStyleToSel({stroke:c}); refreshBar(); }; sw.appendChild(b); }
    const custom=U.el('input',{type:'color',class:'mmd-swc',value:style.stroke,title:T('Dowolny kolor','Custom color')});
    custom.oninput=()=>{ style.stroke=custom.value; applyStyleToSel({stroke:custom.value}); refreshBar(); };
    sw.appendChild(custom);
    bar.appendChild(sw);
    // wypełnienie
    const fillRow=U.el('div',{class:'mmd-row'});
    fillRow.appendChild(U.el('span',{class:'mmd-lbl',text:T('Wypełnienie','Fill')}));
    const noFill=U.el('button',{class:'mmd-mini mmd-nofill',title:T('Brak','None'),text:'∅'});
    noFill.onclick=()=>{ style.fill=''; applyStyleToSel({fill:''}); refreshBar(); };
    const fillC=U.el('input',{type:'color',class:'mmd-swc',value:'#22d3ee',title:T('Kolor wypełnienia','Fill color')});
    fillC.oninput=()=>{ style.fill=fillC.value; applyStyleToSel({fill:fillC.value}); refreshBar(); };
    fillRow.appendChild(noFill); fillRow.appendChild(fillC);
    bar.appendChild(fillRow);
    // grubość + kreska
    const wRow=U.el('div',{class:'mmd-row'});
    for(const [w,lb] of [[1.4,'S'],[2.5,'M'],[4.5,'L']]){
      const b=U.el('button',{class:'mmd-mini','data-w':w,text:lb,title:T('Grubość ','Width ')+lb});
      b.onclick=()=>{ style.sw=w; applyStyleToSel({sw:w}); refreshBar(); }; wRow.appendChild(b);
    }
    for(const [ds,ch] of [['solid','—'],['dashed','╌'],['dotted','┈']]){
      const b=U.el('button',{class:'mmd-mini','data-d':ds,text:ch,title:ds});
      b.onclick=()=>{ style.dash=ds; applyStyleToSel({dash:ds}); refreshBar(); }; wRow.appendChild(b);
    }
    bar.appendChild(wRow);
    // krycie
    const oRow=U.el('div',{class:'mmd-row'});
    oRow.appendChild(U.el('span',{class:'mmd-lbl',text:T('Krycie','Opacity')}));
    const op=U.el('input',{type:'range',min:'10',max:'100',value:'100',class:'mmd-op'});
    op.oninput=()=>{ style.op=+op.value/100; applyStyleToSel({op:style.op}); };
    oRow.appendChild(op); bar.appendChild(oRow);
    bar.appendChild(U.el('div',{class:'mmd-sep'}));
    // akcje
    const act=U.el('div',{class:'mmd-row'});
    act.appendChild(U.el('button',{class:'mmd-mini',title:T('Duplikuj (Ctrl+D)','Duplicate (Ctrl+D)'),html:svgIcon('M8 8h12v12H8zM4 16V4h12'),onclick:()=>{ if(!sel)return; snap(); const c=JSON.parse(JSON.stringify(sel)); c.id='d'+(seq++); c.x+=14;c.y+=14; els.push(c); sel=c; renderAll(); dirty(); }}));
    act.appendChild(U.el('button',{class:'mmd-mini',title:T('Usuń zaznaczone (Del)','Delete selected (Del)'),html:svgIcon('M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13'),onclick:()=>{ if(!sel)return; snap(); els=els.filter(x=>x!==sel); sel=null; renderAll(); dirty(); }}));
    act.appendChild(U.el('button',{class:'mmd-mini mmd-danger',title:T('Wyczyść wszystkie rysunki','Clear all drawings'),html:svgIcon('M3 6h18M8 6l1-2h6l1 2m-2 4l-.5 9m-5 0L8 10'),onclick:()=>{ if(!els.length)return; if(!confirm(T('Usunąć wszystkie rysunki z tej mapy?','Delete all drawings on this map?')))return; snap(); els=[]; sel=null; renderAll(); dirty(); }}));
    bar.appendChild(act);
    env.canvas.appendChild(bar);
    return bar;
  }
  function refreshBar(){
    if(!bar) return;
    bar.querySelectorAll('.mmd-t').forEach(b=>b.classList.toggle('on', b.getAttribute('data-tool')===tool));
    bar.querySelectorAll('.mmd-sw').forEach(b=>b.classList.toggle('on', b.getAttribute('data-c')===style.stroke));
    bar.querySelectorAll('[data-w]').forEach(b=>b.classList.toggle('on', +b.getAttribute('data-w')===style.sw));
    bar.querySelectorAll('[data-d]').forEach(b=>b.classList.toggle('on', b.getAttribute('data-d')===style.dash));
    bar.querySelector('.mmd-nofill').classList.toggle('on', !style.fill);
  }
  function applyStyleToSel(patch){ if(!sel) return; snap(); Object.assign(sel, patch); renderAll(); dirty(); }
  function setTool(t2){ tool=t2; refreshBar();
    // the surface owns all pointer input while the bar is open; cursor signals the mode
    if(surface) surface.style.cursor=(tool==='select')?'default':(tool==='text'?'text':'crosshair');
    env.canvas.classList.toggle('mmd-drawing', tool!=='select');
    if(tool!=='select'&&tool!=='erase') ensureRough();
  }

  /* ---------------- integracja / API ---------------- */
  function attach(e){
    env=e;
    // RENDER layer: svg inside world so sketches pan/zoom with the map; NEVER takes pointer input.
    svg=document.createElementNS(NS,'svg');
    svg.setAttribute('id','mm-draw');
    svg.setAttribute('width','10'); svg.setAttribute('height','10');
    svg.style.cssText='position:absolute;left:0;top:0;overflow:visible;z-index:4;pointer-events:none';
    env.world.appendChild(svg);
    // MindMap render() przebudowuje world.innerHTML — warstwa rysunków musi wracać sama
    try{ new MutationObserver(()=>{ if(svg&&!svg.isConnected){ env.world.appendChild(svg); } })
      .observe(env.world,{childList:true}); }catch(e){}
    // INPUT layer: a screen-space surface that covers the canvas ONLY while the draw bar is open.
    // It is the topmost element (below the toolbar at z7), so it is the natural pointer target — no
    // capture-phase races with the map's own pan handlers. Closed → display:none, map works normally.
    // Select tool: hit-tests drawings; empty drag pans the map (via env.panBy). Wheel forwards to zoom.
    surface=U.el('div',{id:'mm-draw-surface'});
    surface.style.cssText='position:absolute;inset:0;z-index:6;touch-action:none;display:none';
    env.canvas.appendChild(surface);
    // Gesture handling WITHOUT setPointerCapture (its behaviour differs between real and synthetic
    // pointers and was the historical culprit). On pointerdown we bind move/up to WINDOW in the capture
    // phase for the duration of the gesture — this guarantees every move reaches us even if the cursor
    // leaves the surface or another element grabs capture. stopPropagation on the down keeps the map's
    // pan (a bubble listener on #mm-canvas, our parent) from firing on the same press.
    let _win=null;
    const endGesture=()=>{ if(_win){ window.removeEventListener('pointermove',_win.mv,true);
      window.removeEventListener('pointerup',_win.up,true); window.removeEventListener('pointercancel',_win.up,true); _win=null; } };
    surface.addEventListener('pointerdown',(ev)=>{ if(!open) return;
      if(ev.button!=null&&ev.button!==0) return;
      ev.stopPropagation(); ev.preventDefault();
      onDown(ev);
      if(!drag) return;   // e.g. text tool opens a textarea and sets no drag → no window listeners
      endGesture();
      const mv=(e)=>{ if(drag){ e.preventDefault(); onMove(e); } };
      const up=()=>{ onUp(); endGesture(); };
      _win={mv,up};
      window.addEventListener('pointermove',mv,true);
      window.addEventListener('pointerup',up,true);
      window.addEventListener('pointercancel',up,true);
    });
    surface.addEventListener('wheel',(ev)=>{ if(env.zoomAt){ ev.preventDefault(); env.zoomAt(ev.clientX,ev.clientY,ev.deltaY); } },{passive:false});
    window.addEventListener('keydown',onKey,true);
    renderAll();
  }
  function toggle(force){
    open=force!=null?!!force:!open;
    buildBar().classList.toggle('hidden', !open);
    if(surface){ surface.style.display=open?'block':'none'; surface.style.pointerEvents=open?'auto':'none'; }   // input surface only while drawing
    if(!open){ setTool('select'); if(sel){ sel=null; renderSel(); } }
    else { setTool(tool&&tool!=='select'?tool:'pen'); ensureRough(); }   // opening "Rysuj" → ready to draw immediately (was: select, which draws nothing)
    const b=document.getElementById('mm-draw-btn'); if(b) b.classList.toggle('on', open);
    return open;
  }
  // eksport rysunków jako czysty SVG-string (do buildMMSvg) + bounds do viewBoxa
  function toSVG(){
    if(!els.length) return '';
    const tmp=document.createElementNS(NS,'g'); const keep=rough; // rough renderuje do żywego svg — użyj mkNode
    let out='';
    for(const e of els){ const n=mkNode(e); out+=n.outerHTML; }
    return '<g class="mm-drawings">'+out+'</g>';
  }
  function bounds(){
    if(!els.length) return null;
    let x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
    for(const e of els){ const b=bbox(e); x1=Math.min(x1,b.x);y1=Math.min(y1,b.y);x2=Math.max(x2,b.x+b.w);y2=Math.max(y2,b.y+b.h); }
    return {minX:x1,minY:y1,maxX:x2,maxY:y2};
  }
  const isOpen=()=>open;
  const count=()=>els.length;

  return { attach, toggle, isOpen, serialize, load, toSVG, bounds, count, undo, redo, _els:()=>els, _setTool:setTool, _hit:hit };
})();
