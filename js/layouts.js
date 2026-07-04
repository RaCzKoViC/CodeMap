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

  // ---------- TREE (layered, tidy) ----------
  function tree(graph, nodes){
    const {children, roots} = hierarchy(graph, nodes);
    const map = byId(nodes);
    const xGap = Math.max(52, 60 - Math.min(nodes.length/60, 1)*20), yGap = 110;
    let cursor = 0;
    function walk(id, depth){
      const n = map.get(id); const kids = children.get(id);
      n.depthL = depth;
      if(!kids || kids.length===0){ n._lx = cursor++; }
      else {
        kids.forEach(k=>walk(k, depth+1));
        n._lx = (map.get(kids[0])._lx + map.get(kids[kids.length-1])._lx)/2;
      }
    }
    roots.forEach((r,i)=>{ walk(r, 0); cursor += 1.5; });
    for(const n of nodes){ n.x = n._lx*xGap; n.y = n.depthL*yGap; n.vx=0; n.vy=0; }
    centerNodes(nodes);
  }

  // ---------- RADIAL ----------
  function radial(graph, nodes){
    const {children, roots} = hierarchy(graph, nodes);
    const map = byId(nodes);
    let leaf = 0; let maxDepth = 0;
    function countLeaves(id, depth){
      maxDepth=Math.max(maxDepth,depth);
      const kids=children.get(id);
      if(!kids||!kids.length){ map.get(id)._leaf=leaf++; map.get(id)._d=depth; return; }
      kids.forEach(k=>countLeaves(k,depth+1));
      const f=map.get(kids[0]), l=map.get(kids[kids.length-1]);
      map.get(id)._leaf=(f._leaf+l._leaf)/2; map.get(id)._d=depth;
    }
    roots.forEach(r=>countLeaves(r,0));
    const total = Math.max(1, leaf);
    const ring = 150;
    for(const n of nodes){
      const ang = (n._leaf/total)*Math.PI*2;
      const rad = n._d*ring;
      n.x = Math.cos(ang)*rad; n.y = Math.sin(ang)*rad; n.vx=0;n.vy=0;
    }
    centerNodes(nodes);
  }

  // ---------- GRID ----------
  function grid(graph, nodes){
    const arr = nodes.slice().sort((a,b)=> (a.path<b.path?-1:1));
    // Adaptive gap: bigger when nodes have large radii
    const avgR = arr.reduce((s,n)=>s+(n.r||8),0)/Math.max(1,arr.length);
    const gap = Math.max(52, avgR*3.2);
    const cols = Math.max(1, Math.ceil(Math.sqrt(arr.length * (1 + arr.length/300))));
    arr.forEach((n,i)=>{ n.x=(i%cols)*gap; n.y=Math.floor(i/cols)*gap; n.vx=0;n.vy=0; });
    centerNodes(nodes);
  }

  // ---------- CLUSTER by language ----------
  function cluster(graph, nodes){
    const groups = new Map();
    for(const n of nodes){
      const k = n.type==='folder' ? '__folder__' : (n.type==='external'?'__external__':n.lang);
      if(!groups.has(k)) groups.set(k,[]);
      groups.get(k).push(n);
    }
    const keys = Array.from(groups.keys());
    const R = 130 + keys.length*45;
    keys.forEach((k,gi)=>{
      const ga = (gi/keys.length)*Math.PI*2;
      const cx = Math.cos(ga)*R, cy = Math.sin(ga)*R;
      const arr = groups.get(k);
      const maxR=arr.reduce((m,n)=>Math.max(m,n.r||8),8);
      const cols = Math.ceil(Math.sqrt(arr.length))||1, gap=Math.max(40, maxR*2.4);
      arr.forEach((n,i)=>{
        n.x = cx + ((i%cols)-cols/2)*gap;
        n.y = cy + (Math.floor(i/cols)-cols/2)*gap;
        n.vx=0;n.vy=0;
      });
    });
    centerNodes(nodes);
  }

  // ---------- HORIZONTAL TREE ----------
  function treeH(graph, nodes){
    const {children, roots} = hierarchy(graph, nodes);
    const map = byId(nodes);
    const yGap = 46, xGap = 165;
    let cursor = 0;
    function walk(id, depth){
      const n = map.get(id); const kids = children.get(id); n.depthL = depth;
      if(!kids || !kids.length){ n._lx = cursor++; }
      else { kids.forEach(k=>walk(k, depth+1)); n._lx = (map.get(kids[0])._lx + map.get(kids[kids.length-1])._lx)/2; }
    }
    roots.forEach(r=>{ walk(r,0); cursor += 1.5; });
    for(const n of nodes){ n.y = n._lx*yGap; n.x = n.depthL*xGap; n.vx=0; n.vy=0; }
    centerNodes(nodes);
  }

  // ---------- CONCENTRIC (rings by hierarchy depth) ----------
  function concentric(graph, nodes){
    const {children, roots} = hierarchy(graph, nodes);
    const depth = new Map(); const q = [];
    roots.forEach(r=>{ depth.set(r,0); q.push(r); });
    while(q.length){ const id=q.shift(); for(const c of children.get(id)){ depth.set(c,(depth.get(id)||0)+1); q.push(c); } }
    const groups = new Map();
    for(const n of nodes){ const d=depth.get(n.id)||0; if(!groups.has(d)) groups.set(d,[]); groups.get(d).push(n); }
    const ringGap = 135;
    for(const [d,arr] of groups){
      const R = d*ringGap + (d?30:0);
      const step = (Math.PI*2)/Math.max(1,arr.length);
      arr.forEach((n,i)=>{ if(d===0 && arr.length===1){ n.x=0; n.y=0; } else { n.x=Math.cos(i*step+ d*0.3)*R; n.y=Math.sin(i*step+ d*0.3)*R; } n.vx=0; n.vy=0; });
    }
    centerNodes(nodes);
  }

  // ---------- CIRCLE (single ring) ----------
  function circle(graph, nodes){
    const arr = nodes.slice().sort((a,b)=> a.path<b.path?-1:1);
    const R = Math.max(130, arr.length*8.5);
    const step = (Math.PI*2)/Math.max(1,arr.length);
    arr.forEach((n,i)=>{ n.x=Math.cos(i*step)*R; n.y=Math.sin(i*step)*R; n.vx=0; n.vy=0; });
    centerNodes(nodes);
  }

  // ---------- SPIRAL (phyllotaxis / sunflower) ----------
  function spiral(graph, nodes){
    const arr = nodes.slice().sort((a,b)=> (b.totalSize||b.size||0)-(a.totalSize||a.size||0));
    const GA = 2.39996323, sp = 23;
    arr.forEach((n,i)=>{ const r=sp*Math.sqrt(i+1); const a=i*GA; n.x=Math.cos(a)*r; n.y=Math.sin(a)*r; n.vx=0; n.vy=0; });
    centerNodes(nodes);
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

  // ---------- FLOW (left-to-right dependency) ----------
  function flow(graph, nodes, edges){
    const map=byId(nodes);
    const outE=new Map(); nodes.forEach(n=>outE.set(n.id,[]));
    for(const e of (edges||[])){
      if((e.type==='import'||e.type==='reference') && outE.has(e.source) && map.has(e.target))
        outE.get(e.source).push(e.target);
    }
    const rank=new Map(), st=new Map();
    function dfs(id){ if(rank.has(id)) return rank.get(id); if(st.get(id)==='v') return 0; st.set(id,'v'); let mx=-1; for(const t of outE.get(id)) mx=Math.max(mx,dfs(t)); const r=mx+1; rank.set(id,r); st.set(id,'d'); return r; }
    for(const n of nodes) dfs(n.id);
    const groups=new Map();
    for(const n of nodes){ const r=rank.get(n.id)||0; if(!groups.has(r))groups.set(r,[]); groups.get(r).push(n); }
    const xGap=200, yGap=60;
    for(const [r,arr] of groups){
      arr.sort((a,b)=>a.path<b.path?-1:1).forEach((n,i)=>{
        n.x=r*xGap; n.y=(i-(arr.length-1)/2)*yGap; n.vx=0; n.vy=0;
      });
    }
    centerNodes(nodes);
  }

  // ---------- COMPACT TREE (Reingold-Tilford inspired, adaptive gaps) ----------
  function compactTree(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    // Compute subtree extents
    const lExt=new Map(), rExt=new Map();
    function extent(id){
      const kids=children.get(id); if(!kids||!kids.length){ lExt.set(id,0); rExt.set(id,0); return; }
      kids.forEach(k=>extent(k));
      let l=Infinity, r=-Infinity, cur=0;
      kids.forEach((k,i)=>{ if(i>0) cur+=Math.max(1,(rExt.get(kids[i-1])+(lExt.get(k)||0))*0+1)*52; l=Math.min(l,-cur/2); r=Math.max(r,cur/2); });
      lExt.set(id, l); rExt.set(id, r);
    }
    roots.forEach(r=>extent(r));
    const placed=new Map();
    function place(id, depth, ox){
      const kids=children.get(id)||[];
      placed.set(id,{x:ox, y:depth*105});
      if(!kids.length) return;
      let totalW=(kids.length-1)*52; kids.forEach(()=>{});
      let x=ox-totalW/2;
      kids.forEach((k)=>{ place(k,depth+1,x); x+=52; });
    }
    let xOff=0;
    roots.forEach(r=>{ place(r,0,xOff); xOff+=200; });
    for(const n of nodes){ const p=placed.get(n.id)||{x:0,y:0}; n.x=p.x; n.y=p.y; n.vx=0; n.vy=0; }
    centerNodes(nodes);
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

  // ---------- BALLOON (radial tree; each subtree gets its own circle) ----------
  function balloon(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    function radiusOf(id){ const kids=children.get(id)||[]; let s=0; for(const k of kids) s+=radiusOf(k)+50; const n=map.get(id); n._sr=Math.max((n.r||8)+18, s/(Math.PI)); return n._sr; }
    roots.forEach(r=>radiusOf(r));
    function place(id, cx, cy, a0, a1){
      const n=map.get(id); n.x=cx; n.y=cy; n.vx=0; n.vy=0;
      const kids=children.get(id)||[]; if(!kids.length) return;
      let tot=0; kids.forEach(k=>tot+=map.get(k)._sr);
      let a=a0;
      for(const k of kids){ const span=(a1-a0)*(map.get(k)._sr/tot); const mid=a+span/2;
        const rr=n._sr + map.get(k)._sr*0.9;
        place(k, cx+Math.cos(mid)*rr, cy+Math.sin(mid)*rr, mid-span/2, mid+span/2); a+=span; }
    }
    let ox=0; roots.forEach(r=>{ const rad=map.get(r)._sr; place(r, ox, 0, -Math.PI, Math.PI); ox+=rad*3; });
    centerNodes(nodes);
  }

  // ---------- MINDMAP (root centre; branches fan left & right) ----------
  function mindmap(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    const yGap=30, xGap=190;
    let cursor=0;
    function leaves(id){ const k=children.get(id)||[]; if(!k.length) return 1; let s=0; k.forEach(c=>s+=leaves(c)); return s; }
    function walk(id, depth, side){
      const n=map.get(id); const kids=children.get(id)||[];
      if(!kids.length){ n._row=cursor++; } else { kids.forEach(k=>walk(k,depth+1,side)); n._row=(map.get(kids[0])._row+map.get(kids[kids.length-1])._row)/2; }
      n._depth=depth; n._side=side;
    }
    roots.forEach(r=>{
      const kids=children.get(r)||[];
      // split top-level children into left / right halves
      const half=Math.ceil(kids.length/2);
      map.get(r)._depth=0; map.get(r)._row=0; map.get(r)._side=0;
      kids.forEach((k,i)=>walk(k,1, i<half?1:-1));
    });
    for(const n of nodes){ const side=n._side||0; n.x=(n._depth||0)*xGap*(side||1)*(side?1:0); n.y=(n._row||0)*yGap; n.vx=0; n.vy=0; if((n._depth||0)===0){ n.x=0; n.y=0; } }
    centerNodes(nodes);
  }

  // ---------- GENEALOGY (tidy top-down family tree; generations as rows, parents centred) ----------
  function genealogy(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    const xGap=72, yGap=160;
    let cursor=0;
    function walk(id, depth){
      const n=map.get(id); const kids=children.get(id); n.depthL=depth;
      if(!kids || !kids.length){ n._lx=cursor++; }
      else { kids.forEach(k=>walk(k, depth+1)); n._lx=(map.get(kids[0])._lx + map.get(kids[kids.length-1])._lx)/2; }
    }
    roots.forEach(r=>{ walk(r,0); cursor += 2.4; });   // breathing room between separate family trees
    for(const n of nodes){ n.x=n._lx*xGap; n.y=n.depthL*yGap; n.vx=0; n.vy=0; }
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
  // SPIRAL GALAXY — multi-arm logarithmic spiral with a dense bright core
  function spiralGalaxy(graph, nodes){
    const arr=nodes.slice().sort((a,b)=>(b.totalSize||b.size||0)-(a.totalSize||a.size||0));
    const n=arr.length, arms=3; const avgR=arr.reduce((s,x)=>s+(x.r||6),0)/Math.max(1,n);
    const spread=avgR*1.0+6; let maxR=1;
    arr.forEach((nd,i)=>{ const arm=i%arms, k=Math.floor(i/arms);
      const r=26+Math.sqrt(k+1)*spread*2.0; const theta=(arm/arms)*Math.PI*2 + r*0.019;
      const jt=Math.sin(i*2.3)*spread*0.7;
      nd.x=Math.cos(theta)*r+Math.cos(theta+1.5708)*jt; nd.y=Math.sin(theta)*r+Math.sin(theta+1.5708)*jt;
      nd.vx=0; nd.vy=0; maxR=Math.max(maxR,r); });
    let mn=1e9,mx=0; for(const nd of arr){ const rr=Math.hypot(nd.x,nd.y); mn=Math.min(mn,rr); mx=Math.max(mx,rr); }
    const dr=(mx-mn)||1; for(const nd of arr){ nd._cosmic=Math.max(0,Math.min(1,(Math.hypot(nd.x,nd.y)-mn)/dr)); }
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

  // ============ NEW LAYOUTS (10) ============
  // small deterministic hash from a string id -> [0,1)
  function hash01(id){
    let h=2166136261>>>0; const s=String(id);
    for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
    return (h>>>8)/16777216;
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

  // ---------- 4) SOLAR SYSTEM (top-folders = suns; files orbit) ----------
  function solar(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    // top-level groups: each root (or root's children if single root)
    let suns = roots;
    if(roots.length===1){ const rc=children.get(roots[0])||[]; if(rc.length) suns=rc; }
    const S=Math.max(1, suns.length);
    // big ring radius for the suns
    const sunRing=Math.max(360, S*150);
    let globalMaxR=1;
    // place a node and its subtree as concentric orbits around (cx,cy); returns max radius used
    function orbit(id, cx, cy, baseAng){
      const n=map.get(id);
      const kids=children.get(id)||[];
      // place this node at center of its little system
      n.x=cx; n.y=cy; n.vx=0; n.vy=0; n._cosmicR=Math.hypot(cx,cy);
      globalMaxR=Math.max(globalMaxR, n._cosmicR);
      if(!kids.length) return 0;
      // separate folders (further orbits) from files (inner orbit)
      const files=kids.filter(k=>(map.get(k).type)!=='folder');
      const folders=kids.filter(k=>(map.get(k).type)==='folder');
      let used=0;
      // files on one orbit
      if(files.length){
        const fr=Math.max(70, files.length*9);
        files.forEach((k,i)=>{
          const a=baseAng + (i/files.length)*Math.PI*2;
          const fx=cx+Math.cos(a)*fr, fy=cy+Math.sin(a)*fr;
          const fn=map.get(k); fn.x=fx; fn.y=fy; fn.vx=0; fn.vy=0; fn._cosmicR=Math.hypot(fx,fy);
          globalMaxR=Math.max(globalMaxR, fn._cosmicR);
        });
        used=Math.max(used, fr);
      }
      // nested folders on further orbits, each a sub-system
      if(folders.length){
        const baseFr=Math.max(70, files.length*9)+150;
        folders.forEach((k,i)=>{
          const a=baseAng + (i/folders.length)*Math.PI*2 + 0.5;
          const fr=baseFr;
          const fx=cx+Math.cos(a)*fr, fy=cy+Math.sin(a)*fr;
          const sub=orbit(k, fx, fy, a);
          used=Math.max(used, fr+sub);
        });
      }
      return used;
    }
    suns.forEach((s,i)=>{
      const a=(i/S)*Math.PI*2;
      const cx=Math.cos(a)*sunRing*(S===1?0:1), cy=Math.sin(a)*sunRing*(S===1?0:1);
      orbit(s, cx, cy, a);
    });
    // if single root acts as a master sun, put it at very center
    if(roots.length===1 && suns!==roots){ const rn=map.get(roots[0]); rn.x=0; rn.y=0; rn.vx=0; rn.vy=0; rn._cosmicR=0; }
    // normalize _cosmic from radius
    for(const n of nodes){ n._cosmic=Math.max(0, Math.min(1, (n._cosmicR||0)/globalMaxR)); delete n._cosmicR; }
    centerNodes(nodes);
  }

  // ---------- 5) HONEYCOMB (hex grid clustered by top-folder) ----------
  function honeycomb(graph, nodes){
    // group by top-level folder
    const groups=new Map();
    for(const n of nodes){
      let top='__root__';
      if(n.type==='external'){ top='__ext__'; }
      else { let cur=n,p; while(cur.parent!=null){ p=graph.nodes.get(cur.parent); if(!p||p.parent==null) break; cur=p; } top=cur.parent!=null?cur.parent:cur.id; }
      if(!groups.has(top)) groups.set(top,[]); groups.get(top).push(n);
    }
    const keys=Array.from(groups.keys());
    const avgR=nodes.reduce((s,x)=>s+(x.r||8),0)/Math.max(1,nodes.length);
    const cell=Math.max(34, avgR*2.4);            // hex spacing
    const hexW=cell*Math.sqrt(3), hexH=cell*1.5;
    // lay each group as a compact hex block, then place blocks on a coarse grid
    const blocks=keys.map(k=>{
      const arr=groups.get(k).slice().sort((a,b)=> a.path<b.path?-1:1);
      const cols=Math.max(1, Math.ceil(Math.sqrt(arr.length)));
      let w=0,h=0;
      arr.forEach((n,i)=>{
        const col=i%cols, row=Math.floor(i/cols);
        const ox=col*hexW + (row%2)*(hexW/2);
        const oy=row*hexH;
        n._hx=ox; n._hy=oy;
        w=Math.max(w, ox); h=Math.max(h, oy);
      });
      return {arr, w:w+hexW, h:h+hexH};
    });
    // arrange blocks in a grid with padding
    const bCols=Math.max(1, Math.ceil(Math.sqrt(blocks.length)));
    const pad=cell*2;
    let colX=new Array(bCols).fill(0);
    // compute row heights / column widths greedily
    let cx=0, cy=0, rowMaxH=0, bcol=0;
    blocks.forEach((b)=>{
      b.ox=cx; b.oy=cy;
      cx += b.w+pad; rowMaxH=Math.max(rowMaxH, b.h);
      bcol++;
      if(bcol>=bCols){ bcol=0; cx=0; cy+=rowMaxH+pad; rowMaxH=0; }
    });
    blocks.forEach(b=>{
      b.arr.forEach(n=>{ n.x=(b.ox||0)+(n._hx||0); n.y=(b.oy||0)+(n._hy||0); n.vx=0; n.vy=0; delete n._hx; delete n._hy; });
    });
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

  // ---------- 7) DENDRITE (radial dendrogram / cluster) ----------
  function dendrite(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    let leaf=0, maxDepth=0;
    const ang=new Map(), dep=new Map();
    function walk(id, depth){
      maxDepth=Math.max(maxDepth, depth); dep.set(id, depth);
      const kids=children.get(id);
      if(!kids || !kids.length){ ang.set(id, leaf++); return; }
      kids.forEach(k=>walk(k, depth+1));
      ang.set(id, (ang.get(kids[0])+ang.get(kids[kids.length-1]))/2);
    }
    roots.forEach(r=>walk(r,0));
    const total=Math.max(1, leaf);
    const avgR=nodes.reduce((s,x)=>s+(x.r||8),0)/Math.max(1,nodes.length);
    const outerR=Math.max(200, total*(avgR*2+14)/(2*Math.PI));
    const step=outerR/Math.max(1, maxDepth);
    for(const n of nodes){
      const a=(ang.get(n.id)/total)*Math.PI*2;
      // leaves outermost; internal nodes pulled toward center by (maxDepth-depth)
      const d=dep.get(n.id)||0;
      const rad=d*step;
      if(maxDepth===0){ n.x=0; n.y=0; }
      else { n.x=Math.cos(a)*rad; n.y=Math.sin(a)*rad; }
      n.vx=0; n.vy=0;
    }
    centerNodes(nodes);
  }

  // ---------- 8) HELIX (columnar spiral, DFS order) ----------
  function helix(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    const order=[];
    const seen=new Set();
    function dfs(id){ if(seen.has(id)) return; seen.add(id); order.push(id); for(const k of (children.get(id)||[])) dfs(k); }
    roots.forEach(dfs);
    for(const n of nodes){ if(!seen.has(n.id)){ order.push(n.id); seen.add(n.id); } }
    const N=Math.max(1, order.length);
    const baseR=Math.max(160, N*1.4);
    const pitch=Math.max(26, (nodes.reduce((s,x)=>s+(x.r||8),0)/N)*2.0+8);
    const turn=0.45;     // radians per step
    order.forEach((id,i)=>{
      const t=i*turn;
      const R=baseR*(0.82+0.18*Math.sin(i*0.21));    // gentle oscillation
      const n=map.get(id);
      n.x=Math.cos(t)*R;
      n.y=i*pitch;
      n.vx=0; n.vy=0;
      n._cosmic=N>1 ? i/(N-1) : 0;
    });
    centerNodes(nodes);
  }

  // ---------- 9) CONSTELLATION (modules scattered; files orbit module centroid) ----------
  function constellation(graph, nodes){
    const groups=new Map();
    for(const n of nodes){
      let top='__root__';
      if(n.type==='external'){ top='__ext__'; }
      else { let cur=n,p; while(cur.parent!=null){ p=graph.nodes.get(cur.parent); if(!p||p.parent==null) break; cur=p; } top=cur.parent!=null?cur.parent:cur.id; }
      if(!groups.has(top)) groups.set(top,[]); groups.get(top).push(n);
    }
    const keys=Array.from(groups.keys());
    const G=Math.max(1, keys.length);
    const field=Math.max(700, G*260);     // big plane span
    let globalMaxR=1;
    keys.forEach((k,gi)=>{
      // deterministic scatter of module centroid using hash of key
      const h1=hash01(k+'#x'), h2=hash01(k+'#y');
      // mix golden-angle ring + hash jitter for even-but-organic spread
      const ringA=(gi/G)*Math.PI*2;
      const ringR=field*(0.35+0.55*hash01(k+'#r'));
      const cx=Math.cos(ringA)*ringR + (h1-0.5)*field*0.25;
      const cy=Math.sin(ringA)*ringR + (h2-0.5)*field*0.25;
      const arr=groups.get(k);
      const avgR=arr.reduce((s,x)=>s+(x.r||8),0)/Math.max(1,arr.length);
      const inner=Math.max(60, arr.length*(avgR*0.9+4)/Math.PI);
      arr.forEach((n,i)=>{
        // small constellation around centroid: golden-angle + per-node hash jitter
        const a=i*2.39996323 + hash01(n.id)*0.9;
        const rr=inner*Math.sqrt((i+0.5)/Math.max(1,arr.length));
        const jx=(hash01(n.id+'jx')-0.5)*avgR*1.4;
        const jy=(hash01(n.id+'jy')-0.5)*avgR*1.4;
        n.x=cx+Math.cos(a)*rr+jx;
        n.y=cy+Math.sin(a)*rr+jy;
        n.vx=0; n.vy=0;
        n._cosmicR=Math.hypot(n.x,n.y);
        globalMaxR=Math.max(globalMaxR, n._cosmicR);
      });
    });
    for(const n of nodes){ n._cosmic=Math.max(0, Math.min(1, (n._cosmicR||0)/globalMaxR)); delete n._cosmicR; }
    centerNodes(nodes);
  }

  // ---------- 10) VORTEX (logarithmic spiral, folders->files / DFS) ----------
  function vortex(graph, nodes){
    const {children, roots}=hierarchy(graph, nodes);
    const map=byId(nodes);
    // DFS order but folders before files at each level
    const order=[]; const seen=new Set();
    function dfs(id){
      if(seen.has(id)) return; seen.add(id); order.push(id);
      const kids=(children.get(id)||[]).slice().sort((a,b)=>{
        const ta=(map.get(a).type)==='folder'?0:1, tb=(map.get(b).type)==='folder'?0:1;
        if(ta!==tb) return ta-tb;
        return (map.get(a).path||a)<(map.get(b).path||b)?-1:1;
      });
      for(const k of kids) dfs(k);
    }
    roots.forEach(dfs);
    for(const n of nodes){ if(!seen.has(n.id)){ order.push(n.id); seen.add(n.id); } }
    const N=Math.max(1, order.length);
    const avgR=nodes.reduce((s,x)=>s+(x.r||8),0)/Math.max(1,N);
    const b=0.18;                 // spiral tightness
    const sp=avgR*2.2+7;
    let maxR=1;
    order.forEach((id,i)=>{
      const a=i*0.5;              // angle increment (twist)
      const r=sp*Math.exp(b*Math.sqrt(i))*0.6 + sp*Math.sqrt(i+0.5)*0.4; // log-ish growth, bounded
      const n=map.get(id);
      n.x=Math.cos(a)*r; n.y=Math.sin(a)*r; n.vx=0; n.vy=0;
      n._vr=r; maxR=Math.max(maxR, r);
    });
    for(const id of order){ const n=map.get(id); n._cosmic=Math.max(0, Math.min(1, (n._vr||0)/maxR)); delete n._vr; }
    centerNodes(nodes);
  }

  function centerNodes(nodes){
    if(!nodes.length) return;
    let cx=0, cy=0; for(const n of nodes){ cx+=n.x; cy+=n.y; }
    cx/=nodes.length; cy/=nodes.length;
    for(const n of nodes){ n.x-=cx; n.y-=cy; }
  }
  function scaleNodes(nodes, f){ if(!f||f===1) return; for(const n of nodes){ n.x*=f; n.y*=f; } }

  // ---------- Barnes-Hut quadtree repulsion (O(n log n)) ----------
  // far cells approximated by their centre of mass; near leaves get exact + anti-collision push.
  function bhRepulse(nodes, strength, theta){
    const N=nodes.length; if(N<2) return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const n of nodes){ if(n.x<minX)minX=n.x; if(n.x>maxX)maxX=n.x; if(n.y<minY)minY=n.y; if(n.y>maxY)maxY=n.y; }
    if(!isFinite(minX)) return;
    const size=Math.max(maxX-minX, maxY-minY, 1)+1;
    const cell=(x,y,s)=>({x,y,s,m:0,cx:0,cy:0,body:null,extra:null,kids:null});
    const root=cell(minX,minY,size);
    const sub=(c)=>{ const h=c.s/2; c.kids=[cell(c.x,c.y,h),cell(c.x+h,c.y,h),cell(c.x,c.y+h,h),cell(c.x+h,c.y+h,h)]; };
    const quad=(c,n)=>{ const h=c.s/2; return c.kids[(n.y>=c.y+h?2:0)+(n.x>=c.x+h?1:0)]; };
    const insert=(c,n,depth)=>{
      while(true){
        if(c.kids){ c=quad(c,n); depth++; if(depth>48){ (c.extra||(c.extra=[])).push(n); return; } continue; }
        if(c.body===null){ c.body=n; return; }
        if(depth>=48){ (c.extra||(c.extra=[])).push(n); return; }
        const old=c.body; c.body=null; sub(c); insert(quad(c,old),old,depth+1); c=quad(c,n); depth++;
      }
    };
    for(const n of nodes) insert(root,n,0);
    const mass=(c)=>{ if(c.kids){ let m=0,sx=0,sy=0; for(const k of c.kids){ mass(k); if(k.m){ m+=k.m; sx+=k.cx*k.m; sy+=k.cy*k.m; } } c.m=m; if(m){ c.cx=sx/m; c.cy=sy/m; } return; }
      let m=0,sx=0,sy=0; if(c.body){ m++; sx+=c.body.x; sy+=c.body.y; } if(c.extra){ for(const e of c.extra){ m++; sx+=e.x; sy+=e.y; } } c.m=m; if(m){ c.cx=sx/m; c.cy=sy/m; } };
    mass(root);
    const t2=theta*theta;
    const stack=[];
    for(const n of nodes){ if(n.fixed) continue;
      stack.length=0; stack.push(root);
      while(stack.length){ const c=stack.pop(); if(!c.m) continue;
        if(c.kids){ const dx=n.x-c.cx, dy=n.y-c.cy; let d2=dx*dx+dy*dy||0.01;
          if((c.s*c.s)/d2 < t2){ const mag=strength*c.m/d2, inv=1/Math.sqrt(d2); n.vx+=dx*inv*mag; n.vy+=dy*inv*mag; }
          else { stack.push(c.kids[0],c.kids[1],c.kids[2],c.kids[3]); }
          continue; }
        // leaf: exact repulsion (+anti-collision) for its body & any coincident overflow
        const bodies = c.extra ? (c.body?[c.body].concat(c.extra):c.extra) : (c.body?[c.body]:null);
        if(!bodies) continue;
        for(const b of bodies){ if(b===n) continue;
          let dx=n.x-b.x, dy=n.y-b.y, d2=dx*dx+dy*dy; if(d2<0.01){ dx=(Math.sin(n.x+b.y)*0.3)||0.1; dy=(Math.cos(n.y+b.x)*0.3)||0.1; d2=dx*dx+dy*dy||0.01; }
          const minD=n.r+b.r+12, overlap=d2<minD*minD?3.2:1;
          const mag=strength*overlap/d2, inv=1/Math.sqrt(d2); n.vx+=dx*inv*mag; n.vy+=dy*inv*mag;
        }
      }
    }
  }

  // ---------- FORCE-DIRECTED (animated) ----------
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
    const sim = {
      alpha:1, alphaMin:0.02, alphaDecay:0.019, velDecay:0.82, spacing:1,
      running:true, nodes, edges, map,
      reheat(v=0.7){ this.alpha = Math.max(this.alpha, v); this.running=true; },
      tick(){
        const a = this.alpha;
        const n = nodes.length;
        const sp = this.spacing||1;
        // gravity toward center (weaker when spread out more)
        const g = 0.0055*a/sp;
        for(const nd of nodes){ if(nd.fixed) continue; nd.vx -= nd.x*g; nd.vy -= nd.y*g; }
        // spring attraction along edges
        for(const e of edges){
          const s=map.get(e.source), t=map.get(e.target); if(!s||!t) continue;
          let dx=t.x-s.x, dy=t.y-s.y; let d=Math.hypot(dx,dy)||0.01;
          const desired = (e.type==='contains' ? (s.r+t.r+34) : (s.r+t.r+90)) * sp;
          const k = (e.type==='contains'?0.08:0.03) * a * Math.min(2,(e.weight||1));
          const f = ((d-desired)/d)*k; const fx=dx*f, fy=dy*f;
          if(!s.fixed){ s.vx+=fx; s.vy+=fy; }
          if(!t.fixed){ t.vx-=fx; t.vy-=fy; }
        }
        // repulsion via Barnes-Hut quadtree — O(n log n), scales to large graphs
        bhRepulse(nodes, 1900*a*sp*sp, 0.9);
        // collision relaxation (light)
        // integrate
        for(const nd of nodes){
          if(nd.fixed){ nd.vx=0; nd.vy=0; continue; }
          nd.vx*=this.velDecay; nd.vy*=this.velDecay;
          const sp = Math.hypot(nd.vx,nd.vy); const maxv=28;
          if(sp>maxv){ nd.vx=nd.vx/sp*maxv; nd.vy=nd.vy/sp*maxv; }
          nd.x+=nd.vx; nd.y+=nd.vy;
        }
        this.alpha = a*(1-this.alphaDecay);
        if(this.alpha < this.alphaMin) this.running=false;
        return this.running;
      }
    };
    return sim;
  }

  function apply(name, graph, vis, opts){
    const {nodes, edges} = vis;
    const spacing = (opts&&opts.spacing)||1;
    if(!nodes.length) return {animated:false};
    const stat=(fn)=>{ fn(); scaleNodes(nodes, spacing); return {animated:false}; };
    switch(name){
      case 'tree':       return stat(()=>tree(graph, nodes));
      case 'tree-h':     return stat(()=>treeH(graph, nodes));
      case 'radial':     return stat(()=>radial(graph, nodes));
      case 'concentric': return stat(()=>concentric(graph, nodes));
      case 'circle':     return stat(()=>circle(graph, nodes));
      case 'spiral':     return stat(()=>spiral(graph, nodes));
      case 'grid':       return stat(()=>grid(graph, nodes));
      case 'cluster':    return stat(()=>cluster(graph, nodes));
      case 'layered':    return stat(()=>layered(graph, nodes, edges));
      case 'flow':       return stat(()=>flow(graph, nodes, edges));
      case 'compact':    return stat(()=>compactTree(graph, nodes));
      case 'balloon':    return stat(()=>balloon(graph, nodes));
      case 'mindmap':    return stat(()=>mindmap(graph, nodes));
      case 'genealogy':  return stat(()=>genealogy(graph, nodes));
      case 'pack':       return stat(()=>circlePack(graph, nodes));
      case 'structtree': return stat(()=>structTree(graph, nodes));
      case 'structradial':return stat(()=>structRadial(graph, nodes));
      case 'nebula':     return stat(()=>nebula(graph, nodes));
      case 'spiralgalaxy':return stat(()=>spiralGalaxy(graph, nodes));
      case 'cosmicrings':return stat(()=>cosmicRings(graph, nodes));
      case 'sunburst':   return stat(()=>sunburst(graph, nodes));
      case 'treemap':    return stat(()=>treemap(graph, nodes));
      case 'icicle':     return stat(()=>icicle(graph, nodes));
      case 'solar':      return stat(()=>solar(graph, nodes));
      case 'honeycomb':  return stat(()=>honeycomb(graph, nodes));
      case 'arcdiagram': return stat(()=>arcdiagram(graph, nodes));
      case 'dendrite':   return stat(()=>dendrite(graph, nodes));
      case 'helix':      return stat(()=>helix(graph, nodes));
      case 'constellation':return stat(()=>constellation(graph, nodes));
      case 'vortex':     return stat(()=>vortex(graph, nodes));
      case 'galaxy':     { const sim=galaxy(graph, nodes, edges); sim.spacing=spacing; return {animated:true, sim}; }
      case 'modules':    { const sim=modules(graph, nodes, edges); sim.spacing=spacing; return {animated:true, sim}; }
      case 'force':
      default:           { const sim=forceSim(graph, nodes, edges); sim.spacing=spacing; return {animated:true, sim}; }
    }
  }

  return {apply, forceSim, bhRepulse, circlePack, nebula, spiralGalaxy, cosmicRings, structTree, structRadial, tree, treeH, radial, concentric, circle, spiral, grid, cluster, layered, modules, flow, compactTree, balloon, mindmap, genealogy, galaxy, hierarchy, sunburst, treemap, icicle, solar, honeycomb, arcdiagram, dendrite, helix, constellation, vortex};
})();
