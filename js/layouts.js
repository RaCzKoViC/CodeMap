/* ===================== layouts.js — graph layout algorithms ===================== */
CM.Layouts = (function(){

  function byId(nodes){ const m=new Map(); for(const n of nodes) m.set(n.id,n); return m; }

  // build a visible-only hierarchy (parents may be collapsed/hidden -> climb to nearest visible)
  function hierarchy(graph, nodes){
    const vis = new Set(nodes.map(n=>n.id));
    const children = new Map(); nodes.forEach(n=>children.set(n.id,[]));
    const roots = [];
    for(const n of nodes){
      let p = n.parent!=null ? graph.nodes.get(n.parent) : null;
      while(p && !vis.has(p.id)) p = p.parent!=null ? graph.nodes.get(p.parent) : null;
      if(p && vis.has(p.id)) children.get(p.id).push(n.id);
      else roots.push(n.id);
    }
    return {children, roots, vis};
  }









  // ---------- MODULES (force-in-clusters by top-level folder) ----------
  function modules(graph, nodes, edges){
    // Group by top-level parent folder
    const groups = new Map();
    for(const n of nodes){
      let topKey = '__root__';
      if(n.type==='external'){ topKey='__external__'; }
      else {
        let cur=n, p;
        while(cur.parent!=null){ p=graph.nodes.get(cur.parent); if(!p||p.parent==null) break; cur=p; }
        topKey=cur.parent!=null?cur.parent:cur.id;
      }
      if(!groups.has(topKey)) groups.set(topKey,[]);
      groups.get(topKey).push(n);
    }
    const keys=Array.from(groups.keys());
    const GR=Math.max(180, keys.length*70);
    keys.forEach((k,gi)=>{
      const ga=(gi/keys.length)*Math.PI*2;
      const cx=Math.cos(ga)*GR, cy=Math.sin(ga)*GR;
      const arr=groups.get(k);
      const maxR=arr.reduce((m,n)=>Math.max(m,n.r||8),8);
      const cols=Math.ceil(Math.sqrt(arr.length))||1, gap=Math.max(48, maxR*2.5);
      arr.forEach((n,i)=>{
        n.x=cx+((i%cols)-cols/2)*gap;
        n.y=cy+(Math.floor(i/cols)-arr.length/cols/2)*gap;
        n.vx=0; n.vy=0;
      });
    });
    centerNodes(nodes);
    // Light force sim to settle
    const sim=forceSim(graph, nodes, edges);
    sim.alphaMin=0.04; sim.alphaDecay=0.028;
    return sim;
  }



  // ---------- LAYERED (dependency rank — leaves on top, dependents below) ----------
  function layered(graph, nodes, edges){
    const map = byId(nodes);
    const out = new Map(); nodes.forEach(n=>out.set(n.id,[]));
    for(const e of (edges||[])){
      if((e.type==='import'||e.type==='reference') && out.has(e.source) && map.has(e.target)) out.get(e.source).push(e.target);
    }
    const layer = new Map(), st = new Map();
    function dfs(id){
      if(layer.has(id)) return layer.get(id);
      if(st.get(id)==='vis') return 0; // cycle guard
      st.set(id,'vis'); let mx=-1;
      for(const t of out.get(id)) mx=Math.max(mx, dfs(t));
      const L=mx+1; layer.set(id,L); st.set(id,'done'); return L;
    }
    for(const n of nodes) dfs(n.id);
    const groups = new Map();
    for(const n of nodes){ const L=layer.get(n.id)||0; if(!groups.has(L)) groups.set(L,[]); groups.get(L).push(n); }
    const yGap=135, xGap=66;
    for(const [L,arr] of groups){ arr.sort((a,b)=>a.path<b.path?-1:1).forEach((n,i)=>{ n.x=(i-(arr.length-1)/2)*xGap; n.y=L*yGap; n.vx=0; n.vy=0; }); }
    centerNodes(nodes);
  }




  // ---------- GALAXY (Siła — spiral arms per top-level folder, then a force settle) ----------
  function galaxy(graph, nodes, edges){
    const groups=new Map();
    for(const n of nodes){
      let top='__root__';
      if(n.type==='external'){ top='__ext__'; }
      else { let cur=n,p; while(cur.parent!=null){ p=graph.nodes.get(cur.parent); if(!p||p.parent==null) break; cur=p; } top=cur.parent!=null?cur.parent:cur.id; }
      if(!groups.has(top)) groups.set(top,[]); groups.get(top).push(n);
    }
    const keys=Array.from(groups.keys()); const arms=Math.max(1,keys.length);
    keys.forEach((k,gi)=>{
      const baseAng=(gi/arms)*Math.PI*2; const arr=groups.get(k);
      arr.forEach((n,i)=>{ const r=46+Math.sqrt(i+1)*58; const a=baseAng + r*0.011 + i*0.16;
        n.x=Math.cos(a)*r; n.y=Math.sin(a)*r; n.vx=0; n.vy=0; });
    });
    centerNodes(nodes);
    const sim=forceSim(graph, nodes, edges); sim.alphaMin=0.05; sim.alphaDecay=0.03;
    return sim;
  }

  // ---------- CIRCLE PACKING (nested enclosure — best mirror of folder structure) ----------
  // each folder's children are packed into a disc (sunflower/phyllotaxis placement, sorted big-first),
  // folders nest inside their parent recursively. Static & O(n) -> cheap even on large repos.
  function packFolder(circles, pad){
    const n=circles.length; if(!n) return 0;
    if(n===1){ circles[0].x=0; circles[0].y=0; return circles[0].pr+pad; }
    circles.sort((a,b)=>b.pr-a.pr);
    let avg=0; for(const c of circles) avg+=c.pr; avg/=n;
    const sp=(avg*2+pad)*0.58;                       // spiral spacing tuned so neighbours ~touch
    for(let i=0;i<n;i++){ const a=i*2.399963, r=sp*Math.sqrt(i+0.5); circles[i].x=Math.cos(a)*r; circles[i].y=Math.sin(a)*r; }
    let cx=0,cy=0; for(const c of circles){ cx+=c.x; cy+=c.y; } cx/=n; cy/=n;
    let R=0; for(const c of circles){ c.x-=cx; c.y-=cy; R=Math.max(R, Math.hypot(c.x,c.y)+c.pr); }
    return R+pad;
  }
  function circlePack(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    const pad=7;
    const offsets=new Map();   // folder id -> [{id,dx,dy}]
    const size=(id)=>{
      const n=map.get(id), kids=children.get(id);
      if(!kids || !kids.length){ n._pr=(n.r||6)+1; return n._pr; }
      const circles=kids.map(k=>({id:k, pr:size(k)}));
      const R=packFolder(circles, pad);
      offsets.set(id, circles.map(c=>({id:c.id, dx:c.x, dy:c.y})));
      n._pr=Math.max(R, (n.r||12));
      return n._pr;
    };
    roots.forEach(size);
    const place=(id,X,Y)=>{ const n=map.get(id); n.x=X; n.y=Y; n.vx=0; n.vy=0;
      const offs=offsets.get(id); if(!offs) return; for(const o of offs) place(o.id, X+o.dx, Y+o.dy); };
    if(roots.length===1){ place(roots[0],0,0); }
    else { const rc=roots.map(r=>({id:r, pr:map.get(r)._pr})); packFolder(rc, pad*5); for(const c of rc) place(c.id, c.x, c.y); }
    centerNodes(nodes);
  }

  // ============ COSMIC LAYOUTS (set n._cosmic in [0..1]: 0=core, 1=outskirts) ============
  // NEBULA — importance-sorted sunflower cloud (big files glow in the core, small dust outside)
  function nebula(graph, nodes){
    const arr=nodes.slice().sort((a,b)=>(b.totalSize||b.size||0)-(a.totalSize||a.size||0));
    const n=arr.length; const avgR=arr.reduce((s,x)=>s+(x.r||6),0)/Math.max(1,n);
    const sp=avgR*2.5+9, GA=2.39996323;
    arr.forEach((nd,i)=>{ const r=sp*Math.sqrt(i+0.5), a=i*GA;
      const j=(Math.sin(i*1.7)+Math.cos(i*0.9))*sp*0.22;
      nd.x=Math.cos(a)*r+Math.cos(a+1.5708)*j; nd.y=Math.sin(a)*r+Math.sin(a+1.5708)*j; nd.vx=0; nd.vy=0;
      nd._cosmic=Math.min(1, Math.sqrt(i/Math.max(1,n-1))); });
    centerNodes(nodes);
  }
  // GALACTIC RINGS — concentric orbits by hierarchy depth, each ring its own cosmic hue
  function cosmicRings(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const depth=new Map(); const q=[]; roots.forEach(r=>{ depth.set(r,0); q.push(r); });
    while(q.length){ const id=q.shift(); for(const c of children.get(id)){ depth.set(c,(depth.get(id)||0)+1); q.push(c); } }
    let maxD=1; for(const d of depth.values()) maxD=Math.max(maxD,d);
    const groups=new Map(); for(const nd of nodes){ const d=depth.get(nd.id)||0; (groups.get(d)||groups.set(d,[]).get(d)).push(nd); }
    const avgR=nodes.reduce((s,x)=>s+(x.r||6),0)/Math.max(1,nodes.length);
    for(const [d,grp] of groups){
      const need=grp.length*(avgR*2+16); const R = d===0?0:Math.max(d*150, need/(2*Math.PI));
      const step=(Math.PI*2)/Math.max(1,grp.length);
      grp.forEach((nd,i)=>{ if(d===0&&grp.length===1){ nd.x=0; nd.y=0; } else { const a=i*step+d*0.4; nd.x=Math.cos(a)*R; nd.y=Math.sin(a)*R; } nd.vx=0; nd.vy=0; nd._cosmic=d/maxD; });
    }
    centerNodes(nodes);
  }

  // ============ PROFESSIONAL STRUCTURE LAYOUTS (radii-aware spacing) ============
  // STRUCTURE TREE — tidy top-down; leaves spaced by their radii so discs never overlap
  function structTree(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes); const gap=16; let cursor=0;
    function walk(id, depth){ const n=map.get(id), kids=children.get(id); n.depthL=depth;
      if(!kids || !kids.length){ cursor+=(n.r||6); n._lx=cursor; cursor+=(n.r||6)+gap; }
      else { kids.forEach(k=>walk(k,depth+1)); n._lx=(map.get(kids[0])._lx+map.get(kids[kids.length-1])._lx)/2; } }
    roots.forEach(r=>{ walk(r,0); cursor+=60; });
    const dMaxR=new Map(); let maxDepth=0;
    for(const n of nodes){ const d=n.depthL||0; maxDepth=Math.max(maxDepth,d); dMaxR.set(d, Math.max(dMaxR.get(d)||8, n.r||6)); }
    const rowY=new Map(); let y=0; for(let d=0; d<=maxDepth; d++){ rowY.set(d,y); y+=(dMaxR.get(d)||10)*2 + 96; }
    for(const n of nodes){ n.x=n._lx; n.y=rowY.get(n.depthL||0); n.vx=0; n.vy=0; }
    centerNodes(nodes);
  }
  // RADIAL STRUCTURE TREE — hierarchy as rings; ring radius scaled to leaf count (no crowding)
  function structRadial(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes); let leaf=0, maxDepth=0;
    function count(id,d){ maxDepth=Math.max(maxDepth,d); const k=children.get(id);
      if(!k||!k.length){ map.get(id)._leaf=leaf++; map.get(id)._d=d; return; }
      k.forEach(c=>count(c,d+1)); const f=map.get(k[0]), l=map.get(k[k.length-1]); map.get(id)._leaf=(f._leaf+l._leaf)/2; map.get(id)._d=d; }
    roots.forEach(r=>count(r,0));
    const total=Math.max(1,leaf); const avgR=nodes.reduce((s,x)=>s+(x.r||6),0)/Math.max(1,nodes.length);
    const outerR=Math.max(170, total*(avgR*2+18)/(2*Math.PI)); const step=outerR/Math.max(1,maxDepth);
    for(const n of nodes){ const ang=(n._leaf/total)*Math.PI*2, rad=(n._d||0)*step;
      n.x=Math.cos(ang)*rad; n.y=Math.sin(ang)*rad; n.vx=0; n.vy=0; }
    centerNodes(nodes);
  }


  // ---------- 1) SUNBURST (rings by depth; angle = leaf position) ----------
  function sunburst(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    let leaf=0, maxDepth=0;
    // assign leaf index + angular span [a0,a1] per node
    const a0=new Map(), a1=new Map(), dep=new Map();
    function span(id, depth){
      maxDepth=Math.max(maxDepth, depth); dep.set(id, depth);
      const kids=children.get(id);
      if(!kids || !kids.length){ const s=leaf++; a0.set(id,s); a1.set(id,s+1); return; }
      kids.forEach(k=>span(k, depth+1));
      a0.set(id, a0.get(kids[0])); a1.set(id, a1.get(kids[kids.length-1]));
    }
    roots.forEach(r=>span(r,0));
    const total=Math.max(1, leaf);
    const ring=140;
    for(const n of nodes){
      const lo=a0.get(n.id)||0, hi=a1.get(n.id)||0;
      const ang=((lo+hi)/2/total)*Math.PI*2;
      const d=dep.get(n.id)||0;
      const rad=d*ring;
      if(d===0 && roots.length===1 && rad===0){ n.x=0; n.y=0; }
      else { n.x=Math.cos(ang)*rad; n.y=Math.sin(ang)*rad; }
      n.vx=0; n.vy=0;
    }
    centerNodes(nodes);
  }

  // ---------- 2) TREEMAP (nested squarified rectangles) ----------
  function treemap(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    // weight = own size + descendant count (so empty folders still get room)
    const W=new Map();
    function weight(id){
      const n=map.get(id), kids=children.get(id);
      let w=Math.max(1, (n.size||0)/500 + 1);
      if(kids && kids.length){ for(const k of kids) w+=weight(k); }
      W.set(id, w); return w;
    }
    roots.forEach(weight);
    // squarified slice into a rect [x,y,w,h]
    function layoutRow(items, x, y, w, h, sumW){
      // place items along the shorter side, proportional to weight
      const horizontal = w >= h;
      let off = horizontal ? x : y;
      const span = horizontal ? w : h;
      for(const it of items){
        const frac = sumW>0 ? it.w/sumW : 1/items.length;
        const len = span*frac;
        if(horizontal){ it.rect=[off, y, len, h]; }
        else { it.rect=[x, off, w, len]; }
        off += len;
      }
    }
    function squarify(ids, x, y, w, h){
      if(!ids.length) return;
      const items=ids.map(id=>({id, w:W.get(id)||1}));
      items.sort((a,b)=>b.w-a.w);
      // simple recursive split: cut off a balanced prefix to keep aspect ~square
      let totalW=0; for(const it of items) totalW+=it.w;
      // greedily group into a row whose split improves squareness; here use slice-and-dice with alternating axis fallback
      layoutRow(items, x, y, w, h, totalW);
      for(const it of items){
        const [rx,ry,rw,rh]=it.rect;
        const n=map.get(it.id);
        n.x = rx+rw/2; n.y = ry+rh/2; n.vx=0; n.vy=0;
        const kids=children.get(it.id);
        if(kids && kids.length){
          // inset for nesting
          const pad=Math.min(rw,rh)*0.12 + 6;
          const ix=rx+pad, iy=ry+pad*1.6, iw=Math.max(1,rw-pad*2), ih=Math.max(1,rh-pad*2-pad*0.6);
          squarify(kids, ix, iy, iw, ih);
        }
      }
    }
    const baseW=1400, baseH=900;
    if(roots.length===1){ squarify(children.get(roots[0])||[roots[0]], 0,0,baseW,baseH);
      // place the single root at its own center
      const rn=map.get(roots[0]); rn.x=baseW/2; rn.y=baseH/2; rn.vx=0; rn.vy=0;
    } else {
      squarify(roots, 0, 0, baseW, baseH);
    }
    // safety: any unplaced node
    for(const n of nodes){ if(!isFinite(n.x)||!isFinite(n.y)){ n.x=0; n.y=0; n.vx=0; n.vy=0; } }
    centerNodes(nodes);
  }

  // ---------- 3) ICICLE / partition ----------
  function icicle(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    let leaf=0, maxDepth=0;
    const x0=new Map(), x1=new Map(), dep=new Map();
    function span(id, depth){
      maxDepth=Math.max(maxDepth, depth); dep.set(id, depth);
      const kids=children.get(id);
      if(!kids || !kids.length){ const s=leaf++; x0.set(id,s); x1.set(id,s+1); return; }
      kids.forEach(k=>span(k, depth+1));
      x0.set(id, x0.get(kids[0])); x1.set(id, x1.get(kids[kids.length-1]));
    }
    roots.forEach(r=>span(r,0));
    const total=Math.max(1, leaf);
    const colW=Math.max(40, 1500/total);
    const rowH=120;
    for(const n of nodes){
      const lo=x0.get(n.id)||0, hi=x1.get(n.id)||0;
      n.x=((lo+hi)/2)*colW;
      n.y=(dep.get(n.id)||0)*rowH;
      n.vx=0; n.vy=0;
    }
    centerNodes(nodes);
  }



  // ---------- 6) ARC DIAGRAM (nodes on a baseline, grouped by folder) ----------
  function arcdiagram(graph, nodes){
    // order by full path so files of a module are contiguous; group separators between top-folders
    const arr=nodes.slice().sort((a,b)=> (a.path||a.id)<(b.path||b.id)?-1:((a.path||a.id)>(b.path||b.id)?1:0));
    const avgR=nodes.reduce((s,x)=>s+(x.r||8),0)/Math.max(1,nodes.length);
    const gap=Math.max(34, avgR*2.4);
    const topKey=(n)=>{
      if(n.type==='external') return '__ext__';
      let cur=n,p; while(cur.parent!=null){ p=graph.nodes.get(cur.parent); if(!p||p.parent==null) break; cur=p; } return cur.parent!=null?cur.parent:cur.id;
    };
    let x=0, prev=null;
    arr.forEach((n)=>{
      const k=topKey(n);
      if(prev!==null && k!==prev) x+=gap*1.6;   // visual separation between modules
      n.x=x; n.y=0; n.vx=0; n.vy=0;
      x+=gap; prev=k;
    });
    centerNodes(nodes);
  }





  function centerNodes(nodes){
    if(!nodes.length) return;
    let cx=0, cy=0; for(const n of nodes){ cx+=n.x; cy+=n.y; }
    cx/=nodes.length; cy/=nodes.length;
    for(const n of nodes){ n.x-=cx; n.y-=cy; }
  }
  function scaleNodes(nodes, f){ if(!f||f===1) return; for(const n of nodes){ n.x*=f; n.y*=f; } }

  // ---------- fizyka: Barnes-Hut + sprężyny + grawitacja — wspólna z sim-worker.js (js/physics.js) ----------
  const bhRepulse=(nodes, strength, theta)=>CM.Physics.bhRepulse(nodes, strength, theta);

  function forceSim(graph, nodes, edges){
    const map = byId(nodes);
    // seed unplaced nodes
    let i=0;
    for(const n of nodes){
      if(!isFinite(n.x) || (n.x===0 && n.y===0)){
        const a = i*2.399963; const r = 22*Math.sqrt(i+1);
        n.x = Math.cos(a)*r; n.y = Math.sin(a)*r;
      }
      n.vx=0; n.vy=0; i++;
    }
    const springs=[]; for(const e of edges){ const s=map.get(e.source), t=map.get(e.target); if(s&&t) springs.push({s, t, c:e.type==='contains', w:e.weight||1}); }
    const sim = {
      alpha:1, alphaMin:0.02, alphaDecay:0.019, velDecay:0.82, spacing:1,
      running:true, nodes, edges, map,
      reheat(v=0.7){ this.alpha = Math.max(this.alpha, v); this.running=true; },
      tick(){ this.running=CM.Physics.step(nodes, springs, this); return this.running; },
    };
    return sim;
  }

  function apply(name, graph, vis, opts){
    const {nodes, edges} = vis;
    const spacing = (opts&&opts.spacing)||1;
    if(!nodes.length) return {animated:false};
    const stat=(fn)=>{ fn(); scaleNodes(nodes, spacing); return {animated:false}; };
    switch(name){
      case 'layered':    return stat(()=>layered(graph, nodes, edges));
      case 'pack':       return stat(()=>circlePack(graph, nodes));
      case 'structtree': return stat(()=>structTree(graph, nodes));
      case 'structradial':return stat(()=>structRadial(graph, nodes));
      case 'nebula':     return stat(()=>nebula(graph, nodes));
      case 'cosmicrings':return stat(()=>cosmicRings(graph, nodes));
      case 'sunburst':   return stat(()=>sunburst(graph, nodes));
      case 'treemap':    return stat(()=>treemap(graph, nodes));
      case 'icicle':     return stat(()=>icicle(graph, nodes));
      case 'arcdiagram': return stat(()=>arcdiagram(graph, nodes));
      case 'galaxy':     { const sim=galaxy(graph, nodes, edges); sim.spacing=spacing; return {animated:true, sim}; }
      case 'modules':    { const sim=modules(graph, nodes, edges); sim.spacing=spacing; return {animated:true, sim}; }
      case 'force':
      default:           { const sim=forceSim(graph, nodes, edges); sim.spacing=spacing; return {animated:true, sim}; }
    }
  }

  return {apply,forceSim, bhRepulse, circlePack, nebula, cosmicRings, structTree, structRadial, layered, modules, galaxy, hierarchy, sunburst, treemap, icicle, arcdiagram};
})();
