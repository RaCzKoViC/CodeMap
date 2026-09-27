/* ===================== mindmap-layout.js — schematy układu MindMap =====================
   CM.MindMapLayout — geometria bez DOM: algorytmy układu na stanie mapy st = {nodes, edges, layout,
   line, spaceMain, spaceCross} (drzewa w 6 kierunkach, radialny, spirala, siatka, warstwy, oś czasu,
   fishbone, auto-układ gwiazdy), malowanie schematu kolorów, miniatury podglądu układów oraz okno
   „Schemat układu” (zakładki Nowy · Szablony), które dostaje kontekst edytora od mindmap.js.
   Funkcje układu tylko przestawiają węzły — render i odświeżenie menu robi wywołujący. */
CM.MindMapLayout = (function(){
  const U = CM.util, I = CM.i18n, S = CM.MindMapStrings, T = CM.MindMapTemplates;

  const nodeOf=(st,id)=>st.nodes.find(n=>n.id===id);
  // las rodzic → dzieci (id) i korzenie; węzeł z nieistniejącym rodzicem jest korzeniem
  function forest(st){
    const children=new Map(); st.nodes.forEach(n=>children.set(n.id,[]));
    const roots=[]; st.nodes.forEach(n=>{ if(n.parent!=null && children.has(n.parent)) children.get(n.parent).push(n.id); else roots.push(n.id); });
    return {children, roots};
  }

  // gdy węzły łączą tylko wolne krawędzie (np. diagramy startowe), wyprowadź z nich drzewo rodziców,
  // żeby układy kierunkowe miały hierarchię; przekształcone krawędzie stają się linkami rodzica.
  function ensureHierarchy(st){
    if(st.nodes.some(n=>n.parent!=null)) return;
    if(!st.edges.length) return;
    const adj=new Map(); st.nodes.forEach(n=>adj.set(n.id,[]));
    st.edges.forEach(e=>{ if(adj.has(e.from)&&adj.has(e.to)){ adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); } });
    const remaining=new Set(st.nodes.map(n=>n.id));
    while(remaining.size){
      let root=null,best=-1; for(const id of remaining){ const d=adj.get(id).length; if(d>best){best=d;root=id;} }
      const seen=new Set([root]); const q=[root]; remaining.delete(root);
      while(q.length){ const id=q.shift(); for(const nb of adj.get(id)){ if(!seen.has(nb)){ seen.add(nb); nodeOf(st,nb).parent=id; remaining.delete(nb); q.push(nb); } } }
    }
    st.edges=st.edges.filter(e=>{ const a=nodeOf(st,e.from),b=nodeOf(st,e.to); return !(a&&b&&(a.parent===b.id||b.parent===a.id)); });
  }
  // drzewo radialne: korzeń w centrum, potomkowie na koncentrycznych pierścieniach wg wagi liści
  function radial(st){
    ensureHierarchy(st);
    const {children, roots}=forest(st);
    const leaf=new Map();
    const cl=(id)=>{ const k=children.get(id); if(!k.length){leaf.set(id,1);return 1;} let s=0;for(const c of k)s+=cl(c); leaf.set(id,s);return s; };
    roots.forEach(cl);
    const ring=(st.spaceMain||240)*0.8;
    const place=(id,depth,a0,a1)=>{ const n=nodeOf(st,id),k=children.get(id),a=(a0+a1)/2;
      if(depth===0){ n.x=-n.w/2; n.y=-30; } else { const rr=depth*ring; n.x=Math.cos(a)*rr-n.w/2; n.y=Math.sin(a)*rr-30; }
      let cur=a0; const tot=leaf.get(id)||1;
      for(const c of k){ const seg=(a1-a0)*(leaf.get(c)||1)/tot; place(c,depth+1,cur,cur+seg); cur+=seg; } };
    roots.forEach(r=>place(r,0,-Math.PI/2,-Math.PI/2+Math.PI*2));
    let cx=0,cy=0; for(const n of st.nodes){cx+=n.x+n.w/2;cy+=n.y+30;} cx/=st.nodes.length||1; cy/=st.nodes.length||1;
    for(const n of st.nodes){ n.x-=cx; n.y-=cy; }
  }
  // układ wg trybu: 'free' (bez zmian pozycji), 'radial' albo drzewo right/left/down/up/leftright/updown
  function apply(st, mode){
    st.layout=mode;
    if(mode==='free') return;
    if(mode==='radial'){ radial(st); return; }
    ensureHierarchy(st);
    const {children, roots}=forest(st);
    const MAIN=st.spaceMain||240, CROSS=st.spaceCross||70, horiz=(mode==='left'||mode==='right'||mode==='leftright');
    function place(id, depth, dirSign, cur){
      const n=nodeOf(st,id), kids=children.get(id); const main=depth*MAIN*dirSign; let c;
      if(!kids.length){ c=cur.v; cur.v+=CROSS; }
      else { const cs=kids.map(k=>place(k,depth+1,dirSign,cur)); c=(cs[0]+cs[cs.length-1])/2; }
      if(horiz){ n.x = main - (dirSign<0? n.w : 0); n.y=c-30; } else { n.y=main; n.x=c-n.w/2; }
      n._c=c; return c;
    }
    let base={v:0};
    for(const rid of roots){
      if(mode==='leftright'||mode==='updown'){
        const root=nodeOf(st,rid), kids=children.get(rid), half=Math.ceil(kids.length/2);
        const cA={v:0}; kids.slice(0,half).forEach(k=>place(k,1,1,cA));
        const cB={v:0}; kids.slice(half).forEach(k=>place(k,1,-1,cB));
        const cs=kids.map(k=>nodeOf(st,k)._c); const mid=cs.length?(Math.min(...cs)+Math.max(...cs))/2:0;
        if(mode==='updown'){ root.y=-30; root.x=mid-root.w/2; } else { root.x=-root.w/2; root.y=mid-30; } root._c=mid;
      } else { place(rid,0,(mode==='left'||mode==='up')?-1:1, base); base.v+=CROSS*1.6; }
    }
    let cx=0,cy=0; for(const n of st.nodes){ cx+=n.x+n.w/2; cy+=n.y+30; } cx/=st.nodes.length; cy/=st.nodes.length;
    for(const n of st.nodes){ n.x-=cx; n.y-=cy; }
  }
  // wyśrodkowanie całej mapy wokół (0,0) — wspólny koniec układów specjalnych
  function recenter(st){ if(!st.nodes.length) return; let cx=0,cy=0; for(const n of st.nodes){ cx+=n.x+n.w/2; cy+=n.y+30; } cx/=st.nodes.length; cy/=st.nodes.length; for(const n of st.nodes){ n.x-=cx; n.y-=cy; } }
  // kolejność w głąb wyprowadzonej hierarchii (najpierw korzeń) dla układów geometrycznych poniżej
  function hierarchyOrder(st){
    const {children, roots}=forest(st);
    const out=[]; const walk=(id,d)=>{ const n=nodeOf(st,id); if(!n)return; out.push({n,d}); for(const c of children.get(id)) walk(c,d+1); };
    roots.forEach(r=>walk(r,0)); return out;
  }
  // spirala: węzły wzdłuż spirali Archimedesa rozwijającej się od centrum
  function spiral(st){ ensureHierarchy(st); const order=hierarchyOrder(st); const step=(st.spaceMain||240)*0.34, ang=0.62;
    order.forEach((o,i)=>{ const a=i*ang, rr=step*Math.sqrt(i)*1.6+ (i?40:0); o.n.x=Math.cos(a)*rr-o.n.w/2; o.n.y=Math.sin(a)*rr-30; });
    recenter(st); }
  // siatka: równe wiersze/kolumny w (wyprowadzonej) kolejności czytania
  function grid(st){ ensureHierarchy(st); const order=hierarchyOrder(st); const N=order.length||1;
    const cols=Math.max(1,Math.ceil(Math.sqrt(N))); const cw=(st.spaceMain||240)+20, ch=(st.spaceCross||70)+78;
    order.forEach((o,i)=>{ const r=Math.floor(i/cols), c=i%cols; o.n.x=c*cw-o.n.w/2; o.n.y=r*ch; });
    recenter(st); }
  // warstwy: każdy poziom hierarchii to poziomy pas, schodkowo z góry na dół
  function layers(st){ ensureHierarchy(st); const order=hierarchyOrder(st);
    const byDepth=new Map(); let maxD=0; order.forEach(o=>{ if(!byDepth.has(o.d)) byDepth.set(o.d,[]); byDepth.get(o.d).push(o.n); if(o.d>maxD)maxD=o.d; });
    const bandH=(st.spaceCross||70)+96, gap=(st.spaceMain||240)*0.78;
    for(let d=0;d<=maxD;d++){ const row=byDepth.get(d)||[]; const total=row.reduce((s,n)=>s+n.w,0)+(row.length-1)*40; let x=-total/2 + d*36;
      row.forEach(n=>{ n.x=x; n.y=d*bandH; x+=n.w+40; }); }
    recenter(st); }
  // oś czasu: kolejność od lewej do prawej na jednej linii, na przemian lekko w górę/dół (bez nakładania)
  function timeAxis(st){ ensureHierarchy(st); const order=hierarchyOrder(st); let x=0;
    order.forEach((o,i)=>{ o.n.x=x; o.n.y=(i%2?1:-1)*((st.spaceCross||70)*0.55); x+=o.n.w+ (st.spaceMain||240)*0.42; });
    recenter(st); }
  // fishbone: głowa po prawej, ości przyczyn na przemian nad i pod centralnym kręgosłupem; false = brak korzenia
  function fishbone(st){ ensureHierarchy(st);
    const {children, roots}=forest(st);
    const rid=roots[0]; if(rid==null) return false;
    const head=nodeOf(st,rid), bones=children.get(rid); const spacing=(st.spaceMain||240)*0.82, rise=(st.spaceCross||70)+110;
    head.x=bones.length*spacing/2+40; head.y=-30;
    bones.forEach((bid,i)=>{ const side=i%2?1:-1, col=Math.floor(i/2); const bn=nodeOf(st,bid); bn.x=col*spacing-bones.length*spacing/2; bn.y=side*rise;
      const sub=children.get(bid); sub.forEach((sid,j)=>{ const sn=nodeOf(st,sid); sn.x=bn.x+(j+1)*36; sn.y=bn.y+side*(60+j*60); }); });
    recenter(st); return true; }
  // auto-układ „gwiazda”: węzeł o największej liczbie połączeń w centrum, reszta promieniście (≥ 2 węzły)
  function arrange(st){
    const deg=new Map(); st.nodes.forEach(n=>deg.set(n.id,0));
    st.edges.forEach(e=>{ deg.set(e.from,(deg.get(e.from)||0)+1); deg.set(e.to,(deg.get(e.to)||0)+1); });
    const center=st.nodes.slice().sort((a,b)=>(deg.get(b.id)||0)-(deg.get(a.id)||0))[0];
    center.x=-center.w/2; center.y=-30;
    const rest=st.nodes.filter(n=>n!==center);
    const R=Math.max(300, rest.length*36);
    rest.forEach((n,i)=>{ const a=(i/rest.length)*Math.PI*2 - Math.PI/2; n.x=Math.cos(a)*R-n.w/2; n.y=Math.sin(a)*R-30; });
  }
  // schemat kolorów: korzeń = pal[0], każda gałąź korzenia (z potomkami) dostaje kolejny kolor palety
  function paintSchema(st, pal){
    const {children, roots}=forest(st);
    let bi=0;
    const paint=(id,col)=>{ const n=nodeOf(st,id); n.color=col; for(const k of children.get(id)) paint(k,col); };
    for(const rid of roots){ nodeOf(st,rid).color=pal[0]; for(const k of children.get(rid)){ paint(k, pal[1+(bi++%(pal.length-1))]); } }
  }

  // ---------- łączniki: jedna geometria dla ekranu (mindmap.js) i eksportu SVG (mindmap-io.js) ----------
  // kierunki zakotwiczenia [rodzic, dziecko] wg układu: r/l/t/b = krawędź karty, c = środek
  function anchorDirs(layout, n, p){
    if(layout==='radial') return ['c','c'];
    if(layout==='left') return ['l','r'];
    if(layout==='down') return ['b','t'];
    if(layout==='up') return ['t','b'];
    if(layout==='leftright'){ const left=(n.x+n.w/2)<(p.x+p.w/2); return left?['l','r']:['r','l']; }
    if(layout==='free'){ const horiz=Math.abs((n.x+n.w/2)-(p.x+p.w/2))>=Math.abs(n.y-p.y);
      return horiz ? ((n.x>p.x)?['r','l']:['l','r']) : ((n.y>p.y)?['b','t']:['t','b']); }
    return ['r','l'];
  }
  // punkt na krawędzi karty a (wysokość h) zwrócony w kierunku dir
  function anchorPoint(a, dir, h){
    const cx=a.x+a.w/2, cy=a.y+h/2;
    if(dir==='r') return {x:a.x+a.w, y:cy}; if(dir==='l') return {x:a.x, y:cy};
    if(dir==='t') return {x:cx, y:a.y}; if(dir==='b') return {x:cx, y:a.y+h};
    return {x:cx, y:cy};
  }
  // widoczne łączniki w kolejności rysowania: drzewo rodzic → dziecko, potem wolne krawędzie;
  // fn(from, to, kolor, gruba) dostaje punkty świata; heightOf(n) = wysokość karty, hidden(n) = zwinięty
  function eachConnector(st, heightOf, hidden, fn){
    const pt=(a, dir)=>anchorPoint(a, dir, heightOf(a));
    for(const n of st.nodes){ if(n.parent==null||hidden(n)) continue; const p=nodeOf(st,n.parent); if(!p||hidden(p)) continue;
      const [pd,cd]=anchorDirs(st.layout, n, p); fn(pt(p,pd), pt(n,cd), n.color||p.color, true); }
    for(const e of st.edges){ const a=nodeOf(st,e.from), b=nodeOf(st,e.to); if(!a||!b||hidden(a)||hidden(b)) continue;
      fn(pt(a,'c'), pt(b,'c'), '#94a3b8', false); }
  }
  // <path> łącznika: krzywa Béziera (poziomo albo pionowo — wg przewagi) lub łamana prostokątna H-V-H
  function connectorSvg(from, to, curved, col, wide){
    let d;
    if(curved){ const dx=Math.abs(to.x-from.x)*0.5; const horiz=Math.abs(to.x-from.x)>Math.abs(to.y-from.y);
      d = horiz ? `M${from.x} ${from.y} C ${from.x+dx} ${from.y}, ${to.x-dx} ${to.y}, ${to.x} ${to.y}`
                : `M${from.x} ${from.y} C ${from.x} ${(from.y+to.y)/2}, ${to.x} ${(from.y+to.y)/2}, ${to.x} ${to.y}`; }
    else { const mx=(from.x+to.x)/2; d=`M${from.x} ${from.y} H ${mx} V ${to.y} H ${to.x}`; }
    return `<path d="${d}" stroke="${col}" stroke-width="${wide?2.6:2}" fill="none" opacity="0.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  // prostokąt obejmujący karty: heightOf(n) = wysokość karty, skip(n) = pomiń (np. zwinięte)
  function cardBounds(nodes, heightOf, skip){
    let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
    for(const n of nodes){ if(skip && skip(n)) continue; minX=Math.min(minX,n.x); minY=Math.min(minY,n.y); maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+heightOf(n)); }
    return {minX, minY, maxX, maxY};
  }

  // ---------- okno „Schemat układu” ----------
  const DIRS=['up','down','updown','left','right','leftright'];
  // konstrukcje: [k, niezależna od kierunku] — kształt drzewa (część ignoruje kierunek)
  const LINES=[['free-form',true],['curved',false],['straight',false],['radial',true],['org',true],['horizontal',true],
    ['timeaxis',true],['spiral',true],['grid',true],['layers',true],['fishboneL',true]];
  const dirIndep=(k)=>{ const r=LINES.find(l=>l[0]===k); return r?r[1]:false; };
  // wybór z okna → styl linii + układ; false = fishbone bez korzenia (pusta mapa)
  function choose(st, line, dir){
    if(line==='free-form'){ apply(st,'free'); }
    else if(line==='radial'){ st.line='curved'; apply(st,'radial'); }
    else if(line==='org'){ st.line='straight'; apply(st,'down'); }
    else if(line==='horizontal'){ st.line='curved'; apply(st,'right'); }
    else if(line==='timeaxis'){ st.line='straight'; st.layout='free'; timeAxis(st); }
    else if(line==='spiral'){ st.line='curved'; st.layout='free'; spiral(st); }
    else if(line==='grid'){ st.line='straight'; st.layout='free'; grid(st); }
    else if(line==='layers'){ st.line='straight'; st.layout='free'; layers(st); }
    else if(line==='fishboneL'){ st.line='straight'; st.layout='free'; return fishbone(st); }
    else { st.line=(line==='straight'?'straight':'curved'); apply(st, dir); }
    return true;
  }
  // miniatura podglądu układu: kierunek dir + konstrukcja struct (SVG jako tekst)
  function previewSVG(dir, struct){
    const W=520,H=300,cx=W/2,cy=H/2;
    const node=(x,y,w,fill,txt,big)=>`<rect x="${x-w/2}" y="${y-(big?15:11)}" rx="9" width="${w}" height="${big?30:22}" fill="${fill}" stroke="#9fb3d0" stroke-width="1"/>`+(txt?`<text x="${x}" y="${y+4}" fill="#0a1018" font-size="${big?13:10}" font-weight="700" text-anchor="middle" font-family="sans-serif">${txt}</text>`:'');
    const straight=(struct==='straight'||struct==='org');
    const ln=(x1,y1,x2,y2)=>{ if(straight){ const mx=(x1+x2)/2,my=(y1+y2)/2; return `<path d="M${x1} ${y1} ${Math.abs(x2-x1)>Math.abs(y2-y1)?`H${mx} V${y2}`:`V${my} H${x2}`} H${x2} V${y2}" stroke="#6f86a8" stroke-width="2" fill="none"/>`; }
      const dx=Math.abs(x2-x1)*0.5; return `<path d="M${x1} ${y1} C ${x1+(x2>x1?dx:-dx)} ${y1}, ${x2-(x2>x1?dx:-dx)} ${y2}, ${x2} ${y2}" stroke="#6f86a8" stroke-width="2" fill="none"/>`; };
    let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
    const pal=['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b','#38bdf8'];
    const branches=(pts)=>{ pts.forEach(p=>{ s+=ln(cx,cy,p.x,p.y); }); pts.forEach(p=>{ s+=node(p.x,p.y,84,p.c,'Node'); }); };
    if(struct==='free-form'){ const pts=[{x:120,y:80},{x:400,y:70},{x:110,y:230},{x:410,y:235}].map((p,i)=>({...p,c:pal[i]})); pts.forEach(p=>s+=ln(cx,cy,p.x,p.y)); pts.forEach(p=>s+=node(p.x,p.y,84,p.c,'Node')); }
    else if(struct==='radial'){ const R=110; const pts=[]; for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; pts.push({x:cx+Math.cos(a)*R, y:cy+Math.sin(a)*(R*0.78), c:pal[i]}); } pts.forEach(p=>s+=ln(cx,cy,p.x,p.y)); pts.forEach(p=>s+=node(p.x,p.y,72,p.c,'Node')); }
    else if(struct==='org'){ branches([{x:150,y:235},{x:cx,y:235},{x:370,y:235}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(struct==='horizontal'){ const root={x:110,y:cy}; s+=ln(root.x,root.y,260,80); s+=ln(root.x,root.y,260,cy); s+=ln(root.x,root.y,260,220); s+=ln(260,80,410,55); s+=ln(260,80,410,108); [{x:410,y:55},{x:410,y:108},{x:260,y:cy},{x:410,y:200},{x:410,y:245}].forEach((p,i)=>{ if(i===0||i===1) s+=node(260,80,80,pal[1],''); }); [{x:260,y:80,c:pal[1]},{x:260,y:cy,c:pal[2]},{x:260,y:220,c:pal[3]},{x:410,y:55,c:pal[4]},{x:410,y:108,c:pal[5]},{x:410,y:200,c:pal[0]},{x:410,y:245,c:pal[1]}].forEach(p=>s+=node(p.x,p.y,80,p.c,'Node')); s+=node(root.x,root.y,96,'#3b5bdb','Root',true); }
    else if(struct==='timeaxis'){ s+=`<line x1="40" y1="${cy}" x2="480" y2="${cy}" stroke="#6f86a8" stroke-width="2.4"/>`; for(let i=0;i<5;i++){ const x=70+i*92, up=i%2===0; s+=`<line x1="${x}" y1="${cy}" x2="${x}" y2="${up?cy-44:cy+44}" stroke="#6f86a8" stroke-width="1.6"/>`+`<circle cx="${x}" cy="${cy}" r="5" fill="${pal[i]}"/>`+node(x,up?cy-58:cy+58,76,pal[i],'Node'); } }
    else if(struct==='spiral'){ for(let i=0;i<9;i++){ const a=i*0.78, rr=14+i*15; const x=cx+Math.cos(a)*rr*1.4, y=cy+Math.sin(a)*rr; if(i) s+=`<circle cx="${x}" cy="${y}" r="3" fill="#6f86a8"/>`; s+=node(x,y,52,pal[i%6],''); } s+=node(cx,cy,70,'#3b5bdb','',true); }
    else if(struct==='grid'){ for(let r=0;r<3;r++)for(let c=0;c<4;c++){ s+=node(95+c*110,70+r*78,82,pal[(r*4+c)%6],'Node'); } }
    else if(struct==='layers'){ const bands=[[cx,55,1],[cx-70,130,3],[cx+30,205,3]]; let yi=0; [1,3,3].forEach((cnt,row)=>{ const y=55+row*75; const total=cnt*92; let x=cx-total/2+row*26+46; for(let i=0;i<cnt;i++){ s+=node(x,y,80,pal[(row*3+i)%6],'Node'); x+=92; } }); }
    else if(struct==='fishboneL'){ s+=`<line x1="36" y1="${cy}" x2="446" y2="${cy}" stroke="#cbd5e1" stroke-width="2.6"/><path d="M446 ${cy} L430 ${cy-9} M446 ${cy} L430 ${cy+9}" stroke="#cbd5e1" stroke-width="2.6" fill="none"/>`; for(let i=0;i<3;i++){ const bx=110+i*110, up=i%2===0; s+=`<line x1="${bx}" y1="${cy}" x2="${bx-46}" y2="${up?cy-58:cy+58}" stroke="${pal[i]}" stroke-width="2"/>`+node(bx-58,up?cy-72:cy+72,80,pal[i],'Cause'); } s+=node(470-60,cy,84,'#fb7185','Problem',true); }
    else if(dir==='right'){ branches([{x:400,y:80},{x:400,y:150},{x:400,y:220}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(dir==='left'){ branches([{x:120,y:80},{x:120,y:150},{x:120,y:220}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(dir==='down'){ branches([{x:150,y:240},{x:cx,y:240},{x:370,y:240}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(dir==='up'){ branches([{x:150,y:60},{x:cx,y:60},{x:370,y:60}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(dir==='updown'){ branches([{x:160,y:60},{x:360,y:60},{x:160,y:240},{x:360,y:240}].map((p,i)=>({...p,c:pal[i]}))); }
    else { branches([{x:110,y:90},{x:110,y:210},{x:410,y:90},{x:410,y:210}].map((p,i)=>({...p,c:pal[i]}))); }
    s+=node(cx,cy,120,'#3b5bdb',(I.getLang()==='en'?'Topic':'Temat'),true);
    s+='</svg>'; return s;
  }

  // ctx z mindmap.js: {root, state, pushUndo, render, positionSurround, drawEdges, autoSnap, buildDiagram}
  function createDialog(ctx){
    let _ldDir='right', _ldLine='curved', _ldTpl=null, _ldTab='new';
    const dlg=U.el('div',{id:'mm-layout-dlg',class:'hidden'});
    const box=U.el('div',{class:'mm-ld-box'});
    // zakładki
    const tabs=U.el('div',{class:'mm-ld-tabs'});
    const tNew=U.el('button',{class:'mm-ld-tab on',text:I.t('cm.tabNew','Nowy'),onclick:()=>{ _ldTab='new'; renderLD(); }});
    const tTpl=U.el('button',{class:'mm-ld-tab',text:I.t('cm.tabTemplates','Szablony'),onclick:()=>{ _ldTab='tpl'; renderLD(); }});
    tabs.appendChild(tNew); tabs.appendChild(tTpl); box.appendChild(tabs);
    const body=U.el('div',{class:'mm-ld-body'}); box.appendChild(body);
    const foot=U.el('div',{class:'mm-ld-foot'}); box.appendChild(foot);
    dlg.appendChild(box);
    dlg.addEventListener('mousedown',(e)=>{ if(e.target===dlg) hide(); });
    ctx.root.appendChild(dlg);

    function renderLD(){
      tNew.textContent=I.t('cm.tabNew','Nowy'); tTpl.textContent=I.t('cm.tabTemplates','Szablony');  // etykiety zakładek w bieżącym języku
      tNew.classList.toggle('on',_ldTab==='new'); tTpl.classList.toggle('on',_ldTab==='tpl');
      body.innerHTML=''; foot.innerHTML='';
      if(_ldTab==='new') renderNew(); else renderTpl();
    }
    function renderNew(){
      body.appendChild(U.el('h2',{class:'mm-ld-title',text:I.t('cm.ldTitleNew','Wybierz schemat układu')}));
      // kierunki (wyłączone dla konstrukcji niezależnych od kierunku)
      const dDis=dirIndep(_ldLine);
      const dwrap=U.el('div',{class:'mm-ld-dirs'+(dDis?' disabled':'')});
      for(const k of DIRS){ const n=S.dir(k), r=U.el('button',{class:'mm-ld-radio'+(_ldDir===k?' on':''),onclick:()=>{ if(dDis) return; _ldDir=k; renderLD(); }});
        r.appendChild(U.el('span',{class:'mm-ld-dot'})); r.appendChild(U.el('span',{text:n})); dwrap.appendChild(r); }
      body.appendChild(dwrap);
      // karty konstrukcji + podgląd na żywo
      const row=U.el('div',{class:'mm-ld-row'});
      const cards=U.el('div',{class:'mm-ld-lines'});
      for(const [k] of LINES){ const n=S.lineName(k), c=U.el('button',{class:'mm-ld-line'+(_ldLine===k?' on':''),onclick:()=>{ _ldLine=k; renderLD(); }});
        c.appendChild(U.el('div',{class:'mm-ld-line-h',text:n}));
        c.appendChild(U.el('div',{class:'mm-ld-line-thumb',html:previewSVG(_ldDir, k)}));
        cards.appendChild(c); }
      row.appendChild(cards);
      const prev=U.el('div',{class:'mm-ld-preview',html:previewSVG(_ldDir, _ldLine)});
      row.appendChild(prev);
      body.appendChild(row);
      // stopka
      foot.appendChild(U.el('button',{class:'mm-ld-btn ghost',html:CM.icons.svg('arrowLeft',{size:15})+' '+I.t('cm.btnCancel','Anuluj'),onclick:()=>hide()}));
      foot.appendChild(U.el('div',{style:'flex:1'}));
      foot.appendChild(U.el('button',{class:'mm-ld-btn ghost',text:I.t('cm.btnSkip','Pomiń »'),onclick:()=>hide()}));
      foot.appendChild(U.el('button',{class:'mm-ld-btn primary',html:I.t('cm.btnApply','Zastosuj ')+CM.icons.svg('arrowRight',{size:15}),onclick:()=>applyLayoutChoice()}));
    }
    function renderTpl(){
      body.appendChild(U.el('h2',{class:'mm-ld-title',text:I.t('cm.ldTitleTpl','Szablony — wybierz i utwórz')}));
      const grid=U.el('div',{class:'mm-ld-tpls'});
      if(_ldTpl==null) _ldTpl=T.DIAGRAMS[0].k;
      for(const d of T.DIAGRAMS){ const c=U.el('button',{class:'mm-ld-tpl'+(_ldTpl===d.k?' on':''),onclick:()=>{ _ldTpl=d.k; renderLD(); }});
        c.appendChild(U.el('div',{class:'mm-ld-tpl-thumb',html:T.thumb(d)}));
        const cap=U.el('div',{class:'mm-ld-tpl-cap'}); cap.appendChild(U.el('span',{class:'mm-ld-tpl-ic',html:CM.icons.svg(d.icon,{size:15})})); const capTxt=U.el('div'); capTxt.appendChild(U.el('b',{text:d.name})); if(d.desc) capTxt.appendChild(U.el('div',{class:'mm-ld-tpl-desc',text:d.desc})); cap.appendChild(capTxt);
        c.appendChild(cap); grid.appendChild(c); }
      body.appendChild(grid);
      foot.appendChild(U.el('button',{class:'mm-ld-btn ghost',html:CM.icons.svg('arrowLeft',{size:15})+' '+I.t('cm.btnCancel','Anuluj'),onclick:()=>hide()}));
      foot.appendChild(U.el('div',{style:'flex:1'}));
      foot.appendChild(U.el('button',{class:'mm-ld-btn primary',html:I.t('cm.btnCreate','Utwórz ')+CM.icons.svg('arrowRight',{size:15}),onclick:()=>{ ctx.buildDiagram(_ldTpl); hide(); }}));
    }
    function applyLayoutChoice(){
      const st=ctx.state;
      if(st.nodes.length) ctx.pushUndo();
      const ok=choose(st, _ldLine, _ldDir);
      ctx.render(); if(ok) ctx.positionSurround();
      ctx.drawEdges(); hide();
      setTimeout(()=>ctx.autoSnap('layout'),2000);
    }
    function show(tab){ const st=ctx.state; _ldDir=(st.layout&&st.layout!=='free')?st.layout:'right'; _ldLine=(st.layout==='free')?'free-form':(st.line||'curved'); _ldTab=tab||'new'; dlg.classList.remove('hidden'); renderLD(); }
    function hide(){ dlg.classList.add('hidden'); }
    return { show, hide, isOpen:()=>!dlg.classList.contains('hidden'), rerender:renderLD };
  }

  return { forest, ensureHierarchy, apply, radial, spiral, grid, layers, timeAxis, fishbone, recenter, hierarchyOrder,
    arrange, paintSchema, anchorDirs, anchorPoint, eachConnector, connectorSvg, cardBounds,
    DIRS, LINES, dirIndep, choose, previewSVG, createDialog };
})();
