/* ===================== renderer.js — canvas map renderer + interaction ===================== */
CM.Renderer = (function(){
  const U = CM.util;

  class Renderer {
    constructor(canvas){
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = U.makeCamera();
      this.graph = null;
      this.nodes = [];      // visible nodes
      this.edges = [];      // visible aggregated edges
      this.nodeById = new Map();
      this.sim = null;
      this.dirty = true;
      this._running = false;
      this._idle = 0;
      this.w=0; this.h=0; this.dpr=1;
      this.inset={l:0, r:0, t:0, b:0};   // visible-area insets (glass panels overlay the map)
      this.hovered = null;
      this.selected = null;
      this.groups = [];               // [{gid,name,color}] for multi-schema compare
      this._groupChips = [];          // screen-space chip rects (computed each draw)
      this.selectedEdge = null;       // currently clicked edge (for detail view)
      this.cycleEdges = null;         // Set of "source|target" import edges that form a dependency cycle
      this.highlight = null;          // Set of ids to keep bright, or null
      this.impact = null;             // {focus, up:Set, down:Set, all:Set} dependency-impact view, or null
      this.diffMode = false;
      this.opts = {
        showGrid:true, showLabels:true, labelZoom:0.5, dim:0.10,
        edgeOpacity:0.45, curvedImports:true, nodeScale:1, showArrows:true,
        labelMax:260,
        labelScale:1,                 // user font-size multiplier for on-figure text
        cosmic:false,                 // nebula/galaxy colour mode (set by cosmic layouts)
        cosmicPalette:['#fffdf0','#ffd27a','#ff7ac0','#7c5cff','#1b1740'],
        // ----- automatic LOD (self-activates from node/edge count + zoom; no app wiring) -----
        lodLabelCap:400,              // hard ceiling on labels drawn per frame at any scale
        lodLabelMinPx:9,              // on-screen node RADIUS (px) below which names are skipped
        lodEdgeBudget:6000,          // above this many visible edges, edges get thinned/skipped
        lodHugeNodes:9000,           // node count past which "huge graph" rules kick in
        lodSpecialCap:600,           // ceiling on per-node decorated (special) figures per frame
      };
      // callbacks
      this.onSelect=()=>{}; this.onHover=()=>{}; this.onToggleCollapse=()=>{};
      this.onContext=()=>{}; this.onChange=()=>{}; this.onDblFile=()=>{};
      this.onEdgeSelect=()=>{}; this.onSettle=()=>{};
      this._wasRunning=false;
      this._bind();
      this.resize();
      if(window.ResizeObserver){ this._ro=new ResizeObserver(()=>{ this.resize(); this.kick(); }); this._ro.observe(this.canvas); }
      window.addEventListener('resize', ()=>{ this.resize(); this.kick(); });
    }

    setData(graph, vis, sim){
      this.graph = graph;
      this.nodes = vis.nodes;
      this.edges = vis.edges;
      this.nodeById = new Map(this.nodes.map(n=>[n.id,n]));
      this.sim = sim || null;
      this.kick();
    }
    setSelected(node){
      this.selected = node;
      if(node && this.graph){
        const {out, inc} = this.graph.neighbors(node.id);
        this.highlight = new Set([node.id, ...out, ...inc]);
      } else this.highlight = null;
      this.kick();
    }
    setHighlight(set){ this.highlight = set; if(set) this.impact = null; this.kick(); }
    // dependency-impact view: obj = {focus, up:Set, down:Set} or null to clear.
    setImpact(obj){
      if(obj){
        const up = obj.up instanceof Set ? obj.up : new Set(obj.up||[]);
        const down = obj.down instanceof Set ? obj.down : new Set(obj.down||[]);
        const all = new Set([obj.focus, ...up, ...down]);
        this.impact = {focus:obj.focus, up, down, all};
        this.highlight = null;   // impact and highlight don't co-exist
      } else this.impact = null;
      this.kick();
    }
    clearCssCache(){ _cssCache = {}; this.kick(); }

    resize(){
      const r = this.canvas.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.canvas.width = Math.max(1, Math.round(r.width*this.dpr));
      this.canvas.height = Math.max(1, Math.round(r.height*this.dpr));
      this.dirty = true;
    }

    // ---------- view ops ----------
    zoomBy(f, sx, sy){
      sx = sx==null? this.w/2 : sx; sy = sy==null? this.h/2 : sy;
      const before = this.cam.toWorld(sx,sy,this.w,this.h);
      this.cam.zoom = U.clamp(this.cam.zoom*f, 0.0008, 40);   // very far zoom-out, but numerically safe
      const after = this.cam.toWorld(sx,sy,this.w,this.h);
      this.cam.x += before.x-after.x; this.cam.y += before.y-after.y;
      this.onChange(); this.kick();
    }
    rotateBy(rad){ this.cam.rot += rad; this.onChange(); this.kick(); }
    setRotation(rad){ this.cam.rot = rad; this.onChange(); this.kick(); }
    setTilt(t){ this.cam.tilt = U.clamp(t,0,0.85); this.onChange(); this.kick(); }
    resetRotation(){ this.cam.rot = 0; this.cam.tilt = 0; this.onChange(); this.kick(); }

    // camera that places world point (px,py) at the centre of the VISIBLE area (excluding glass panels)
    _camFor(px,py,zoom){
      const i=this.inset, cx=this.w/2, cy=this.h/2;
      const Vx=i.l+(this.w-i.l-i.r)/2, Vy=i.t+(this.h-i.t-i.b)/2;
      const ddx=Vx-cx, ddy=Vy-cy;
      const ux=ddx/zoom, uy=ddy/(zoom*(1-this.cam.tilt));
      const cos=Math.cos(-this.cam.rot), sin=Math.sin(-this.cam.rot);
      return {x:px-(ux*cos-uy*sin), y:py-(ux*sin+uy*cos), zoom};
    }
    fit(pad=70, animate=true){
      this.resize();
      if(!this.nodes.length || this.w===0 || this.h===0) return;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const n of this.nodes){ minX=Math.min(minX,n.x-n.r); minY=Math.min(minY,n.y-n.r); maxX=Math.max(maxX,n.x+n.r); maxY=Math.max(maxY,n.y+n.r); }
      const bw=Math.max(1,maxX-minX), bh=Math.max(1,maxY-minY);
      const i=this.inset;
      const availW=Math.max(60,this.w-i.l-i.r-pad*2), availH=Math.max(60,this.h-i.t-i.b-pad*2);
      const z = U.clamp(Math.min(availW/bw, availH/bh), 0.0008, 3);   // allow fitting huge, widely-spaced maps
      const target = this._camFor((minX+maxX)/2,(minY+maxY)/2, z);
      if(animate) this._animateCam(target); else { this.cam.x=target.x; this.cam.y=target.y; this.cam.zoom=target.zoom; this.onChange(); this.kick(); }
    }
    centerOn(node, zoom){
      this._animateCam(this._camFor(node.x, node.y, zoom||Math.max(this.cam.zoom,1)));
    }
    _animateCam(target){
      const start={x:this.cam.x,y:this.cam.y,zoom:this.cam.zoom}; const t0=performance.now(); const dur=420;
      const step=(t)=>{
        let k=(t-t0)/dur; if(k>1)k=1; const e=1-Math.pow(1-k,3);
        this.cam.x=U.lerp(start.x,target.x,e); this.cam.y=U.lerp(start.y,target.y,e); this.cam.zoom=U.lerp(start.zoom,target.zoom,e);
        this.onChange(); this.kick();
        if(k<1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    // ---------- hit testing ----------
    worldBounds(){
      const c=[this.cam.toWorld(0,0,this.w,this.h),this.cam.toWorld(this.w,0,this.w,this.h),
               this.cam.toWorld(0,this.h,this.w,this.h),this.cam.toWorld(this.w,this.h,this.w,this.h)];
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const p of c){ minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y); }
      return {minX,minY,maxX,maxY};
    }
    hitTest(sx, sy){
      // Nodes are drawn as SCREEN-space billboards (toScreen + rPx = n.r*nodeScale*zoom); hit-test in the
      // SAME space. Testing in world space made the tilted 3D view's clickable area a squashed ellipse
      // (down to ~15% of the drawn disc), so clicks near the top/bottom of a node missed.
      const z=this.cam.zoom, scale=this.opts.nodeScale;
      let best=null, bestD=Infinity;
      for(let i=this.nodes.length-1;i>=0;i--){
        const n=this.nodes[i];
        const sp=this.cam.toScreen(n.x,n.y,this.w,this.h);
        const rPx=n.r*scale*z+6;
        const dx=sx-sp.x, dy=sy-sp.y, d=dx*dx+dy*dy;
        if(d<=rPx*rPx && d<bestD){ best=n; bestD=d; }
      }
      return best;
    }
    // distance (world units) from world point to an edge; handles quadratic curve when curved
    _edgeDist(e, wx, wy){
      const s=this.nodeById.get(e.source), t=this.nodeById.get(e.target); if(!s||!t) return Infinity;
      let cpx=null, cpy=null;
      if(e.type!=='contains' && this.opts.curvedImports){
        const mx=(s.x+t.x)/2, my=(s.y+t.y)/2, dx=t.x-s.x, dy=t.y-s.y, L=Math.hypot(dx,dy)||1;
        const off=Math.min(40, L*0.12); cpx=mx+(-dy)/L*off; cpy=my+dx/L*off;
      }
      let best=Infinity, px=s.x, py=s.y;
      const N=cpx!=null?14:1;
      for(let i=1;i<=N;i++){ const f=i/N; let qx,qy;
        if(cpx!=null){ const u=1-f; qx=u*u*s.x+2*u*f*cpx+f*f*t.x; qy=u*u*s.y+2*u*f*cpy+f*f*t.y; }
        else { qx=t.x; qy=t.y; }
        best=Math.min(best, segDist(wx,wy,px,py,qx,qy)); px=qx; py=qy;
      }
      return best;
    }
    hitTestEdge(sx, sy){
      const w=this.cam.toWorld(sx,sy,this.w,this.h);
      const tol=8/this.cam.zoom;       // ~8px click tolerance
      let best=null, bestD=tol;
      for(const e of this.edges){ const d=this._edgeDist(e,w.x,w.y); if(d<bestD){ bestD=d; best=e; } }
      return best;
    }
    setSelectedEdge(e){ this.selectedEdge=e; this.kick(); }
    setCycles(set){ this.cycleEdges=(set&&set.size)?set:null; this.kick(); }
    setGroups(groups){ this.groups=groups||[]; this.kick(); }
    // screen position of the centroid of all visible nodes (for the compass needle)
    centroidScreen(){
      if(!this.nodes.length) return null;
      let cx=0, cy=0; for(const n of this.nodes){ cx+=n.x; cy+=n.y; } cx/=this.nodes.length; cy/=this.nodes.length;
      return this.cam.toScreen(cx,cy,this.w,this.h);
    }
    _hitGroupChip(sx,sy){
      for(const c of this._groupChips){ if(sx>=c.x&&sx<=c.x+c.w&&sy>=c.y&&sy<=c.y+c.h) return c.gid; }
      return null;
    }
    moveGroup(gid, wdx, wdy){
      for(const n of this.nodes){ if(n.gid===gid){ n.x+=wdx; n.y+=wdy; n.vx=0; n.vy=0; } }
      this.kick();
    }

    // ---------- draw ----------
    kick(){ this.dirty=true; if(!this._running){ this._running=true; this._loop(); } }
    _loop(){
      let last=performance.now();
      const tick=()=>{
        this._raf=requestAnimationFrame(tick);
        const now=performance.now(); const dt=Math.min(64, now-last); last=now;
        if(this.sim && this.sim.running){ this.sim.tick(); this.dirty=true; this._wasRunning=true; }
        else if(this._wasRunning){ this._wasRunning=false; this.onSettle(); }   // simulation just settled
        if(this.dirty){ this._draw(); this.dirty=false; this._idle=0; }
        else this._idle++;
        if(this._idle>3 && !(this.sim&&this.sim.running)){ cancelAnimationFrame(this._raf); this._running=false; }
      };
      this._raf=requestAnimationFrame(tick);
    }

    _draw(){
      if(this.w===0||this.h===0){ this.resize(); if(this.w===0||this.h===0) return; }
      const ctx=this.ctx, w=this.w, h=this.h;
      ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
      ctx.clearRect(0,0,w,h);
      // background
      ctx.fillStyle = getCss('--bg') || '#0a0e14';
      ctx.fillRect(0,0,w,h);

      const m = new DOMMatrix().scale(this.dpr).multiply(this.cam.matrix(w,h));
      ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);

      const vb = this.worldBounds();
      if(this.opts.showGrid) this._drawGrid(ctx, vb);
      this._drawEdges(ctx, vb);

      // nodes + labels in SCREEN space (upright billboarded 3D solids, never squashed by the camera)
      ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
      this._drawNodes(ctx, vb);
      if(this.opts.showLabels) this._drawLabels(ctx);

      // fps
      const now=performance.now(); if(this._lt){ this._fps=Math.round(1000/(now-this._lt)); } this._lt=now;
    }

    _drawGrid(ctx, vb){
      const z=this.cam.zoom;
      if(z<0.025) return;            // far zoom-out: grid is meaningless and risks runaway loops
      let step=40, guard=0;
      while(step*z<26 && guard++<40) step*=2;      // keep grid spacing readable at any zoom
      guard=0; while(step*z>120 && guard++<40) step/=2;
      if(!(step>0) || !isFinite(step)) return;
      // hard caps on iteration counts (defensive against degenerate viewports)
      const xN=Math.min(2000, Math.ceil((vb.maxX-vb.minX)/step)+2);
      const yN=Math.min(2000, Math.ceil((vb.maxY-vb.minY)/step)+2);
      const x0=Math.floor(vb.minX/step)*step, y0=Math.floor(vb.minY/step)*step;
      ctx.strokeStyle = U.rgba(getCss('--grid-line')||'#5a6f88', 0.14); ctx.lineWidth = 1/z;
      ctx.beginPath();
      for(let i=0;i<=xN;i++){ const x=x0+i*step; ctx.moveTo(x,vb.minY); ctx.lineTo(x,vb.maxY); }
      for(let i=0;i<=yN;i++){ const y=y0+i*step; ctx.moveTo(vb.minX,y); ctx.lineTo(vb.maxX,y); }
      ctx.stroke();
      ctx.fillStyle = U.rgba(getCss('--grid-dot')||'#7d93ad', 0.34); let cnt=0;
      for(let ix=0;ix<=xN;ix++){ const x=x0+ix*step;
        for(let iy=0;iy<=yN;iy++){ const y=y0+iy*step;
          ctx.beginPath(); ctx.arc(x,y,1.3/z,0,7); ctx.fill();
          if(++cnt>6000) return;
        }
      }
    }

    _drawEdges(ctx, vb){
      const impv=this.impact, dimMode=!!this.highlight||!!impv;
      const margin=120, z=this.cam.zoom, byId=this.nodeById, eo=this.opts.edgeOpacity;
      const cull=(s,t)=> Math.max(s.x,t.x)<vb.minX-margin||Math.min(s.x,t.x)>vb.maxX+margin||
                         Math.max(s.y,t.y)<vb.minY-margin||Math.min(s.y,t.y)>vb.maxY+margin;
      ctx.lineCap='round'; ctx.lineJoin='round'; ctx.setLineDash([]); ctx.lineDashOffset=0;
      const cosmic=!!this.opts.cosmic;
      const vis=(e)=> impv ? (impv.all.has(e.source)&&impv.all.has(e.target))
                          : (!this.highlight || (this.highlight.has(e.source)&&this.highlight.has(e.target)));
      // gentle, consistent arc -> reads as soft organic strands instead of a straight-line hairball.
      // Falls back to straight lines on very dense graphs so cost never grows (one stroke per colour).
      const curved = this.opts.curvedImports!==false && this.edges.length<3500;
      const seg=(s,t)=>{ ctx.moveTo(s.x,s.y);
        if(curved){ const mx=(s.x+t.x)/2,my=(s.y+t.y)/2,dx=t.x-s.x,dy=t.y-s.y,L=Math.hypot(dx,dy)||1,off=Math.min(L*0.13,46);
          ctx.quadraticCurveTo(mx-dy/L*off, my+dx/L*off, t.x, t.y); }
        else ctx.lineTo(t.x,t.y); };

      // ----- structure (contains): straight, ultra-thin, delicate steel — one batched stroke -----
      ctx.beginPath(); let anyC=false;
      for(const e of this.edges){ if(e.type!=='contains') continue;
        const s=byId.get(e.source), t=byId.get(e.target); if(!s||!t||cull(s,t)||!vis(e)) continue;
        ctx.moveTo(s.x,s.y); ctx.lineTo(t.x,t.y); anyC=true; }
      if(anyC){ ctx.lineWidth=0.5/z; ctx.strokeStyle=cosmic?U.rgba('#4a5aa8',U.clamp(0.3*eo*2,0,0.6)):U.rgba('#67809f', U.clamp(0.34*eo*2,0,0.7)); ctx.stroke(); }

      // ----- imports + references: soft arcs, coloured by SOURCE (cosmic tone when nebula), batched -----
      // LOD: when the dep graph is dense OR zoomed far out, cap how many strands we build and
      // drop 'reference' edges first (they're secondary) so the frame cost can never blow up.
      const lodBudget=this.opts.lodEdgeBudget||6000;
      const edgeLOD = this.edges.length>lodBudget || z<0.18;
      const skipRef = edgeLOD && (z<0.5 || this.edges.length>lodBudget*1.5);
      const lodCap = edgeLOD ? Math.max(2000, lodBudget) : Infinity;   // max strands actually batched
      const imp=new Map(), ref=new Map(); let lodCount=0;
      for(const e of this.edges){ if(e.type==='contains') continue;
        if(skipRef && e.type==='reference') continue;
        if(lodCount>=lodCap) break;
        const s=byId.get(e.source), t=byId.get(e.target); if(!s||!t||cull(s,t)||!vis(e)) continue;
        const col=cosmic ? this.cosmicColor(s._cosmic) : (e._ec || (e._ec=badgeColor(s)));
        const m=(e.type==='reference')?ref:imp; let a=m.get(col); if(!a){ a=[]; m.set(col,a); } a.push(s,t);
        lodCount++;
      }
      const batch=(map, alpha, w, dash)=>{ if(dash) ctx.setLineDash(dash); else ctx.setLineDash([]); ctx.lineWidth=w/z;
        for(const [col,arr] of map){ ctx.strokeStyle=U.rgba(col, alpha); ctx.beginPath();
          for(let i=0;i<arr.length;i+=2) seg(arr[i], arr[i+1]); ctx.stroke(); } };
      if(cosmic) ctx.globalCompositeOperation='lighter';   // glowing strands
      batch(imp, cosmic?0.5:(dimMode?0.62:0.48), cosmic?1.05:0.85);
      batch(ref, cosmic?0.42:(dimMode?0.5:0.4), cosmic?0.9:0.8, [3.4/z, 3.4/z]);
      if(cosmic) ctx.globalCompositeOperation='source-over';
      ctx.setLineDash([]);

      // dependency-IMPACT overlay — recolour the strands by direction (upstream warm, downstream cool)
      if(impv){
        const upCol=getCss('--cm-impact-up')||'#ff9d4d', downCol=getCss('--cm-impact-down')||'#36d0e0';
        const drawSet=(col, inSet)=>{ ctx.strokeStyle=U.rgba(col,0.85); ctx.lineWidth=1.6/z; ctx.beginPath(); let any=false;
          for(const e of this.edges){ if(e.type==='contains') continue;
            const s=byId.get(e.source), t=byId.get(e.target); if(!s||!t||cull(s,t)) continue;
            if(!(impv.all.has(e.source)&&impv.all.has(e.target))) continue;
            if(!(inSet.has(e.source)||inSet.has(e.target))) continue;
            seg(s,t); any=true; }
          if(any) ctx.stroke(); };
        drawSet(downCol, impv.down);
        drawSet(upCol, impv.up);
      }

      // dependency CYCLES — overlay offending edges in hot red (same gentle arc)
      if(this.cycleEdges && this.cycleEdges.size){
        ctx.strokeStyle=U.rgba('#ff3b6b',0.95); ctx.lineWidth=2/z; ctx.beginPath(); let any=false;
        for(const e of this.edges){ if(e.type==='contains') continue; if(!this.cycleEdges.has(e.source+'|'+e.target)) continue;
          const s=byId.get(e.source), t=byId.get(e.target); if(!s||!t||cull(s,t)) continue; seg(s,t); any=true; }
        if(any) ctx.stroke();
      }
      // brighten only the explicitly selected edge
      if(this.selectedEdge){ const e=this.selectedEdge, s=byId.get(e.source), t=byId.get(e.target);
        if(s&&t){ ctx.strokeStyle='#ffffff'; ctx.lineWidth=2/z; ctx.beginPath(); seg(s,t); ctx.stroke();
          if(this.opts.showArrows && z>0.4) this._arrow(ctx,s,t,'#ffffff',0.95); } }
    }
    // small chevrons along an edge pointing source -> target (direction made visible on zoom)
    _arrow(ctx, s, t, col, alpha){
      const dx=t.x-s.x, dy=t.y-s.y; const L=Math.hypot(dx,dy)||1; const ux=dx/L, uy=dy/L;
      const tipX=t.x-ux*(t.r+2), tipY=t.y-uy*(t.r+2); const a=7/this.cam.zoom;
      ctx.fillStyle=U.rgba(col, alpha);
      ctx.beginPath();
      ctx.moveTo(tipX,tipY);
      ctx.lineTo(tipX-ux*a-uy*a*0.6, tipY-uy*a+ux*a*0.6);
      ctx.lineTo(tipX-ux*a+uy*a*0.6, tipY-uy*a-ux*a*0.6);
      ctx.closePath(); ctx.fill();
    }

    // cosmic palette — colour a node by its layout-assigned tone (0=core .. 1=outskirts)
    cosmicColor(t){ const lut=this._cosmicLUT; if(lut) return lut[U.clamp(Math.round((t||0)*(lut.length-1)),0,lut.length-1)];
      return '#7c5cff'; }
    _buildCosmicLUT(){ const pal=this.opts.cosmicPalette||['#ffffff','#7c5cff','#22d3ee','#1e1b4b'];
      const n=pal.length-1, L=[]; for(let i=0;i<32;i++){ const s=i/31*n, k=Math.min(n-1,Math.floor(s)); L.push(U.mix(pal[k],pal[k+1],s-k)); } this._cosmicLUT=L; }

    // NODES: flat colour discs, BATCHED by colour (one fill per colour). No gradients/shaders/shadows
    // -> the cheapest path, keeps FPS high even with thousands of figures.
    _drawNodes(ctx, vb){
      const imp=this.impact, dimMode=!!this.highlight||!!imp, scale=this.opts.nodeScale, z=this.cam.zoom, W=this.w, H=this.h;
      const cosmic=!!this.opts.cosmic; if(cosmic) this._buildCosmicLUT();
      const upCol=imp?(getCss('--cm-impact-up')||'#ff9d4d'):null, downCol=imp?(getCss('--cm-impact-down')||'#36d0e0'):null,
            focusCol=imp?(getCss('--cm-impact-focus')||'#ffffff'):null;
      // LOD: at huge counts / far zoom, raise the sub-pixel skip floor (tiny dots cost more than
      // they reveal) and cap the per-node decoration list so it can never grow unbounded.
      const huge=this.nodes.length>(this.opts.lodHugeNodes||9000);
      const minRPx=(huge||z<0.12)?1.1:0.5;
      const specialCap=this.opts.lodSpecialCap||600;
      // bucket visible nodes by colour; collect the few that need per-node decoration
      const full=new Map(), dim=new Map(), special=[];
      for(const n of this.nodes){
        const sp=this.cam.toScreen(n.x,n.y,W,H);
        const rPx=n.r*scale*z;
        if(sp.x<-rPx-20||sp.x>W+rPx+20||sp.y<-rPx-20||sp.y>H+rPx+20) continue;
        if(rPx<minRPx) continue;
        let col=cosmic?this.cosmicColor(n._cosmic):badgeColor(n);
        let bright;
        if(imp){
          bright=imp.all.has(n.id);
          if(n.id===imp.focus) col=focusCol;
          else if(imp.down.has(n.id)) col=downCol;
          else if(imp.up.has(n.id)) col=upCol;
        } else bright=!this.highlight||this.highlight.has(n.id);
        const m=bright?full:dim; let arr=m.get(col); if(!arr){ arr=[]; m.set(col,arr); } arr.push(sp.x,sp.y,rPx);
        const isSel=this.selected&&this.selected.id===n.id, isHov=this.hovered&&this.hovered.id===n.id;
        const isFocus=imp&&n.id===imp.focus;
        if((isSel||isHov||isFocus||n.locked||(n.type==='folder'&&n.collapsed)||(this.diffMode&&n.diff))
           && special.length<specialCap)
          special.push({n,x:sp.x,y:sp.y,rPx,isSel,isHov,isFocus});
      }
      const fillBatch=(map, alpha, rim)=>{
        ctx.globalAlpha=alpha;
        for(const [col,arr] of map){
          ctx.fillStyle=col; ctx.beginPath();
          for(let i=0;i<arr.length;i+=3){ const x=arr[i],y=arr[i+1],r=arr[i+2]; ctx.moveTo(x+r,y); ctx.arc(x,y,r,0,6.2832); }
          ctx.fill();
          if(rim){ ctx.strokeStyle=U.rgba('#08121e',0.4); ctx.lineWidth=1; ctx.stroke(); }
        }
      };
      // COSMIC: additive halo pass behind the bright cores -> overlapping glows read as a nebula cloud
      if(cosmic && full.size){
        ctx.globalCompositeOperation='lighter';
        for(const [col,arr] of full){ ctx.fillStyle=U.rgba(col,0.14); ctx.beginPath();
          for(let i=0;i<arr.length;i+=3){ const x=arr[i],y=arr[i+1],r=arr[i+2]*2.6+3; ctx.moveTo(x+r,y); ctx.arc(x,y,r,0,6.2832); } ctx.fill(); }
        ctx.globalCompositeOperation='source-over';
      }
      if(dim.size) fillBatch(dim, this.opts.dim, !cosmic);
      if(full.size) fillBatch(full, 1, !cosmic);
      ctx.globalAlpha=1;
      // per-node decorations — only the handful of special nodes
      for(const sp of special){
        const {n,x,y,rPx,isSel,isHov,isFocus}=sp;
        if(isFocus){ ctx.strokeStyle=focusCol||'#ffffff'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(x,y,rPx+4,0,7); ctx.stroke(); }
        if(this.diffMode && n.diff){ const dc=n.diff==='added'?'#34d399':n.diff==='removed'?'#f87171':'#fbbf24';
          ctx.strokeStyle=U.rgba(dc,0.95); ctx.lineWidth=2.5; ctx.beginPath(); ctx.arc(x,y,rPx+5,0,7); ctx.stroke(); }
        if(n.type==='folder'&&n.collapsed){ ctx.strokeStyle=U.rgba('#ffffff',0.9); ctx.lineWidth=1.6;
          const s=rPx*0.4; ctx.beginPath(); ctx.moveTo(x-s,y); ctx.lineTo(x+s,y); ctx.moveTo(x,y-s); ctx.lineTo(x,y+s); ctx.stroke(); }
        if(isHov&&!isSel){ ctx.strokeStyle=U.rgba('#ffffff',0.8); ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,rPx+2,0,7); ctx.stroke(); }
        if(isSel){ ctx.strokeStyle=getCss('--accent')||'#22d3ee'; ctx.lineWidth=2.6; ctx.beginPath(); ctx.arc(x,y,rPx+2,0,7); ctx.stroke(); }
        if(n.locked){ ctx.strokeStyle=U.rgba('#fbbf24',0.95); ctx.lineWidth=1.6; ctx.setLineDash([3,2.4]);
          ctx.beginPath(); ctx.arc(x,y,rPx+4,0,7); ctx.stroke(); ctx.setLineDash([]); }
      }
    }
    // public flat-disc draw for the neighborhood/minimap so figures match the main map
    drawNodeSprite(ctx, x, y, r, col){
      ctx.fillStyle=col; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
      if(r>2){ ctx.strokeStyle=U.rgba('#08121e',0.4); ctx.lineWidth=1; ctx.stroke(); }
    }

    // soft flattened ground shadow under a billboarded crystal (screen space)
    // draw an extruded "wall + base" so a node reads as a solid body; extrusion follows
    // screen-down (wd) and screen-right (wd) vectors -> stays 3D under any rotation
    _drawLabels(ctx){
      const imp=this.impact, z=this.cam.zoom, dimMode=!!this.highlight||!!imp, scale=this.opts.nodeScale;
      const isBright=(id)=> imp ? imp.all.has(id) : (!this.highlight||this.highlight.has(id));
      ctx.textAlign='center'; ctx.textBaseline='top';
      let drawn=0;
      // ----- automatic LOD for labels -----
      // Never iterate toward drawing 20k labels: cap the total drawn, and require a real
      // on-screen radius. As node count rises or zoom drops, the radius floor rises too, so
      // dense maps simply show fewer (the largest) labels instead of an unreadable wall of text.
      const labelCap = Math.min(this.opts.labelMax, this.opts.lodLabelCap||400);
      const nCount = this.nodes.length;
      const floorPx = (this.opts.lodLabelMinPx||9) * (nCount>(this.opts.lodHugeNodes||9000)?1.6:1) * (z<0.4?1.5:1);
      // selected & hovered always; others by threshold
      const minR = Math.max(z<0.4? 16 : z<0.8? 8 : 0, floorPx);
      const badgeMinPx = 15;   // node screen-diameter needed before its format badge shows
      for(const n of this.nodes){
        const isSel=this.selected&&this.selected.id===n.id, isHov=this.hovered&&this.hovered.id===n.id;
        const force0 = isSel||isHov;
        // once the per-frame label budget is spent, only keep scanning for the (rare) sel/hover
        if(drawn>=labelCap && !force0) continue;
        const sp=this.cam.toScreen(n.x,n.y,this.w,this.h);
        if(sp.x< -40||sp.x>this.w+40||sp.y<-30||sp.y>this.h+30) continue;
        const rPx=n.r*scale*z;

        // ---- format badge ON TOP of the figure ----
        if(isSel||isHov||rPx*2>=badgeMinPx){
          const code=formatCode(n);
          if(code){
            const bright=isBright(n.id);
            ctx.globalAlpha=bright?1:0.4;
            let fs=(isSel?10:9)*this.opts.labelScale;
            ctx.font='700 '+fs+'px Inter, sans-serif';
            let bw=ctx.measureText(code).width;
            const maxW=rPx*2*0.96;            // badge must never be wider than the figure
            if(bw>maxW){ fs*=maxW/bw; ctx.font='700 '+fs+'px Inter, sans-serif'; bw=ctx.measureText(code).width; }
            if(fs>=5){
              const bh=fs+4, by=sp.y - rPx - bh - 2;
              const col=badgeColor(n);
              roundRectScreen(ctx, sp.x-bw/2-4, by-1, bw+8, bh+1, 4);
              ctx.fillStyle=U.rgba(col,0.95); ctx.fill();
              ctx.strokeStyle=U.rgba('#05080e',0.55); ctx.lineWidth=1; ctx.stroke();
              ctx.fillStyle='#05080e';
              ctx.fillText(code, sp.x, by+1);
            }
          }
        }

        // ---- name BELOW the figure (thresholded to avoid clutter) ----
        const force = force0||(n.type==='folder'&&n.r*z>14);
        if(!force){
          if(rPx < minR) continue;
          if(z<this.opts.labelZoom && n.type==='file') continue;
          if(drawn>=labelCap) continue;
        }
        const bright=isBright(n.id);
        ctx.globalAlpha = bright?1:0.25;
        const y=sp.y + rPx + 3;
        let name=n.name; if(name.length>26) name=name.slice(0,24)+'…';
        ctx.font=(isSel?'600 ':'')+((n.type==='folder'?12:11)*this.opts.labelScale)+'px Inter, sans-serif';
        const tw=ctx.measureText(name).width;
        ctx.fillStyle=U.rgba('#0a0e14',0.66);
        ctx.fillRect(sp.x-tw/2-3, y-1, tw+6, 15);
        ctx.fillStyle = isSel? (getCss('--accent')||'#22d3ee') : (n.type==='folder'? '#cdd6e4':'#aebacb');
        ctx.fillText(name, sp.x, y);
        drawn++;
      }
      ctx.globalAlpha=1;
      // ---- draggable group chips (multi-schema compare) ----
      this._groupChips=[];
      if(this.groups && this.groups.length){
        for(const grp of this.groups){
          let minX=Infinity,minY=Infinity,cx=0,cy=0,cnt=0;
          for(const n of this.nodes){ if(n.gid!==grp.gid) continue; const sp=this.cam.toScreen(n.x,n.y,this.w,this.h);
            minX=Math.min(minX,sp.x); minY=Math.min(minY,sp.y); cx+=sp.x; cy+=sp.y; cnt++; }
          if(!cnt) continue;
          const label=grp.name, padX=10;
          ctx.font='700 12px Inter, sans-serif';
          const w=ctx.measureText(label).width+padX*2+14, h=24;
          const bx=(cx/cnt)-w/2, by=minY-34;
          ctx.fillStyle=U.rgba(grp.color||'#22d3ee',0.9);
          roundRectScreen(ctx, bx, by, w, h, 8); ctx.fill();
          ctx.fillStyle='#05080e'; ctx.beginPath(); // move-handle dots
          for(let i=0;i<2;i++)for(let j=0;j<3;j++){ ctx.rect(bx+8+i*4, by+7+j*4, 2,2); } ctx.fill();
          ctx.fillStyle='#05080e'; ctx.textBaseline='middle'; ctx.fillText(label, bx+14+padX+ (w-14-padX*2)/2, by+h/2);
          ctx.textBaseline='top';
          this._groupChips.push({gid:grp.gid, x:bx, y:by, w, h});
        }
      }
    }

    // ---------- minimap ----------
    drawMinimap(canvas){
      const ctx=canvas.getContext('2d');
      const r=canvas.getBoundingClientRect(); const dpr=window.devicePixelRatio||1;
      canvas.width=r.width*dpr; canvas.height=r.height*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,r.width,r.height);
      if(!this.nodes.length) return;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const n of this.nodes){ minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x);maxY=Math.max(maxY,n.y); }
      const bw=Math.max(1,maxX-minX), bh=Math.max(1,maxY-minY);
      const pad=8; const sc=Math.min((r.width-pad*2)/bw,(r.height-pad*2)/bh);
      const ox=(r.width-bw*sc)/2-minX*sc, oy=(r.height-bh*sc)/2-minY*sc;
      this._mm={sc,ox,oy};
      // one batched path + one stroke (style is uniform); sample edges on huge maps
      const eN=this.edges.length, eStep=Math.max(1, Math.ceil(eN/4000));
      ctx.strokeStyle=U.rgba('#22d3ee',0.18); ctx.lineWidth=0.4; ctx.beginPath();
      for(let i=0;i<eN;i+=eStep){ const e=this.edges[i]; if(e.type!=='import') continue;
        const s=this.nodeById.get(e.source),t=this.nodeById.get(e.target); if(!s||!t)continue;
        ctx.moveTo(s.x*sc+ox,s.y*sc+oy); ctx.lineTo(t.x*sc+ox,t.y*sc+oy);
      }
      ctx.stroke();
      // sample nodes on huge maps + skip redundant fillStyle switches (canvas state churn)
      const nN=this.nodes.length, nStep=Math.max(1, Math.ceil(nN/8000));
      let lastFill=null;
      for(let i=0;i<nN;i+=nStep){ const n=this.nodes[i];
        const c=n.type==='folder'?'#3b4d63':((n.langInfo&&n.langInfo.color)||'#7d8aa0');
        if(c!==lastFill){ ctx.fillStyle=c; lastFill=c; }
        ctx.fillRect(n.x*sc+ox-0.8,n.y*sc+oy-0.8,1.8,1.8);
      }
      // viewport rect
      const vb=this.worldBounds();
      ctx.strokeStyle=U.rgba('#ffffff',0.6); ctx.lineWidth=1;
      ctx.strokeRect(vb.minX*sc+ox, vb.minY*sc+oy, (vb.maxX-vb.minX)*sc, (vb.maxY-vb.minY)*sc);
    }

    // ---------- export ----------
    // bounding box over all visible nodes (world coords), including node radius
    _contentBounds(){
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      const s=this.opts.nodeScale;
      for(const n of this.nodes){ const r=n.r*s;
        minX=Math.min(minX,n.x-r); minY=Math.min(minY,n.y-r);
        maxX=Math.max(maxX,n.x+r); maxY=Math.max(maxY,n.y+r); }
      return {minX,minY,maxX,maxY,bw:Math.max(1,maxX-minX),bh:Math.max(1,maxY-minY)};
    }

    // Render the whole map to an offscreen canvas and resolve a PNG blob.
    // Reuses the live draw pipeline by temporarily re-pointing ctx/camera, then restores.
    exportPNG({scale=2, pad=80, cap=8000}={}){
      if(!this.nodes.length) return Promise.resolve(null);
      const b=this._contentBounds();
      let z=scale;
      let outW=Math.ceil(b.bw*z)+pad*2, outH=Math.ceil(b.bh*z)+pad*2;
      const big=Math.max(outW,outH);
      if(big>cap){ z*=cap/big; outW=Math.ceil(b.bw*z)+pad*2; outH=Math.ceil(b.bh*z)+pad*2; }
      const off=document.createElement('canvas'); off.width=outW; off.height=outH;
      // save live state
      const save={canvas:this.canvas,ctx:this.ctx,w:this.w,h:this.h,dpr:this.dpr,
        cam:{x:this.cam.x,y:this.cam.y,zoom:this.cam.zoom,rot:this.cam.rot,tilt:this.cam.tilt}};
      this.canvas=off; this.ctx=off.getContext('2d'); this.w=outW; this.h=outH; this.dpr=1;
      this.cam.rot=0; this.cam.tilt=0; this.cam.zoom=z;
      this.cam.x=(b.minX+b.maxX)/2; this.cam.y=(b.minY+b.maxY)/2; this.cam._k='';
      try { this._draw(); } finally {
        // restore live state
        this.canvas=save.canvas; this.ctx=save.ctx; this.w=save.w; this.h=save.h; this.dpr=save.dpr;
        Object.assign(this.cam,save.cam); this.cam._k='';
      }
      this.kick();
      return new Promise(res=>off.toBlob(b2=>res(b2),'image/png'));
    }

    // Vector export — structural SVG in world coordinates (no animation/particles).
    exportSVG({pad=80}={}){
      if(!this.nodes.length) return null;
      const b=this._contentBounds();
      const W=Math.ceil(b.bw+pad*2), H=Math.ceil(b.bh+pad*2);
      const vx=b.minX-pad, vy=b.minY-pad;
      const bg=getCss('--bg')||'#0a0e14';
      const esc=(s)=>String(s).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
      const out=[];
      out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${vx} ${vy} ${W} ${H}" font-family="Inter, sans-serif">`);
      out.push(`<rect x="${vx}" y="${vy}" width="${W}" height="${H}" fill="${bg}"/>`);
      // edges
      out.push('<g stroke-linecap="round" fill="none">');
      for(const e of this.edges){
        const s=this.nodeById.get(e.source), t=this.nodeById.get(e.target); if(!s||!t) continue;
        let col,wdt,op,dash='';
        if(e.type==='contains'){ col='#3b4d63'; wdt=0.9; op=0.5; }
        else if(e.type==='import'){ col='#22d3ee'; wdt=1.3; op=0.7; }
        else { col='#a78bfa'; wdt=1.1; op=0.6; dash=' stroke-dasharray="4 4"'; }
        if(e.type!=='contains' && this.opts.curvedImports){
          const mx=(s.x+t.x)/2,my=(s.y+t.y)/2,dx=t.x-s.x,dy=t.y-s.y,L=Math.hypot(dx,dy)||1;
          const off=Math.min(40,L*0.12), cpx=mx+(-dy)/L*off, cpy=my+dx/L*off;
          out.push(`<path d="M${s.x.toFixed(1)} ${s.y.toFixed(1)} Q${cpx.toFixed(1)} ${cpy.toFixed(1)} ${t.x.toFixed(1)} ${t.y.toFixed(1)}" stroke="${col}" stroke-width="${wdt}" stroke-opacity="${op}"${dash}/>`);
        } else {
          out.push(`<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}" stroke="${col}" stroke-width="${wdt}" stroke-opacity="${op}"${dash}/>`);
        }
      }
      out.push('</g>');
      // nodes + labels
      const sc=this.opts.nodeScale;
      const labels=[];
      let i=0;
      for(const n of this.nodes){
        i++;
        const r=n.r*sc;
        // every module is a sphere -> a shaded circle in the vector export
        const col=badgeColor(n);
        const gid='sph'+i;
        out.push(`<radialGradient id="${gid}" cx="32%" cy="32%" r="75%"><stop offset="0" stop-color="${U.mix(col,'#ffffff',0.6)}"/><stop offset="0.45" stop-color="${col}"/><stop offset="1" stop-color="${U.mix(col,'#000000',0.5)}"/></radialGradient>`);
        out.push(`<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#${gid})" stroke="rgba(0,0,0,0.3)" stroke-width="0.8"/>`);
        if(r>5){ let nm=n.name; if(nm.length>26) nm=nm.slice(0,24)+'…';
          labels.push(`<text x="${n.x.toFixed(1)}" y="${(n.y+r+11).toFixed(1)}" text-anchor="middle" font-size="11" fill="${n.type==='folder'?'#cdd6e4':'#aebacb'}">${esc(nm)}</text>`); }
      }
      out.push(labels.join(''));
      out.push('</svg>');
      return out.join('\n');
    }

    // ---------- interaction ----------
    _bind(){
      const cv=this.canvas;
      let mode=null, lastX=0, lastY=0, downX=0, downY=0, dragNode=null, moved=false, midBtn=false;

      const getXY=(e)=>{ const r=cv.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; };

      let dragGid=null;
      let dragStart=null;   // pozycja węzła sprzed przeciągania — przywracana, gdy węzeł został upuszczony poza mapą (np. do ChatBota)
      cv.addEventListener('mousedown',(e)=>{
        const p=getXY(e); lastX=p.x; lastY=p.y; downX=p.x; downY=p.y; moved=false;
        // middle button OR right button OR shift+left -> rotate camera (like the compass)
        if(e.button===1 || e.button===2 || (e.button===0 && e.shiftKey)){ mode='rotate'; midBtn=(e.button===1); cv.classList.add('rotating'); e.preventDefault(); return; }
        // grab a group chip -> drag the whole schema in one motion
        const gid=this._hitGroupChip(p.x,p.y);
        if(gid){ mode='dragGroup'; dragGid=gid; cv.classList.add('grabbing'); e.preventDefault(); return; }
        const hit=this.hitTest(p.x,p.y);
        if(hit){ this.onSelect(hit);
          if(hit.locked || this.opts.lockAll){ mode=null; }   // locked figures don't move when touched
          else { mode='dragNode'; dragNode=hit; dragNode.fixed=true; dragStart={x:hit.x, y:hit.y}; }
        }
        else { mode='pan'; cv.classList.add('grabbing'); }
      });
      window.addEventListener('mousemove',(e)=>{
        if(!mode) { return; }
        const p=getXY(e); const dx=p.x-lastX, dy=p.y-lastY;
        if(Math.abs(p.x-downX)+Math.abs(p.y-downY)>3) moved=true;
        if(mode==='pan'){
          const a=this.cam.toWorld(lastX,lastY,this.w,this.h), b=this.cam.toWorld(p.x,p.y,this.w,this.h);
          this.cam.x-=(b.x-a.x); this.cam.y-=(b.y-a.y); this.onChange(); this.kick();
        } else if(mode==='dragNode' && dragNode){
          const a=this.cam.toWorld(lastX,lastY,this.w,this.h), b=this.cam.toWorld(p.x,p.y,this.w,this.h);
          dragNode.x+=(b.x-a.x); dragNode.y+=(b.y-a.y); dragNode.vx=0; dragNode.vy=0;
          if(this.sim){ this.sim.reheat(0.35); }
          if(this.onNodeDragOver) this.onNodeDragOver(dragNode, e.clientX, e.clientY);   // podświetlenie strefy upuszczenia (ChatBot)
          this.kick();
        } else if(mode==='dragGroup' && dragGid){
          const a=this.cam.toWorld(lastX,lastY,this.w,this.h), b=this.cam.toWorld(p.x,p.y,this.w,this.h);
          this.moveGroup(dragGid, b.x-a.x, b.y-a.y);
        } else if(mode==='rotate'){
          const cx=this.w/2, cy=this.h/2;
          const a0=Math.atan2(lastY-cy,lastX-cx), a1=Math.atan2(p.y-cy,p.x-cx);
          this.rotateBy(a1-a0);
          // middle-button: vertical drag eases the camera in/out of 3D
          if(midBtn && Math.abs(dy)>0.01){ this.setTilt(this.cam.tilt - dy*0.0052); }
        }
        lastX=p.x; lastY=p.y;
      });
      window.addEventListener('mouseup',(e)=>{
        // upuszczenie węzła poza mapą (np. w oknie ChatBota): odbiorca dostaje węzeł, a pozycja na mapie wraca
        if(mode==='dragNode' && dragNode && moved && this.onNodeDrop && dragStart){
          let taken=false; try{ taken=!!this.onNodeDrop(dragNode, e.clientX, e.clientY); }catch(err){}
          if(taken){ dragNode.x=dragStart.x; dragNode.y=dragStart.y; dragNode.vx=0; dragNode.vy=0; this.kick(); }
        }
        dragStart=null;
        if(mode==='dragNode' && dragNode && !dragNode.pinned) dragNode.fixed=false;
        mode=null; dragNode=null; dragGid=null; midBtn=false; cv.classList.remove('grabbing','rotating');
      });

      let lastHover=0;
      cv.addEventListener('mousemove',(e)=>{
        if(mode) return;
        const now=performance.now(); if(now-lastHover<16) return; lastHover=now;  // ~60fps cap on hit-testing
        const p=getXY(e); const hit=this.hitTest(p.x,p.y);
        if(hit!==this.hovered){ this.hovered=hit; this.onHover(hit, e); this.kick(); }
      });
      cv.addEventListener('mouseleave',()=>{ if(this.hovered){ this.hovered=null; this.onHover(null); this.kick(); } });

      cv.addEventListener('wheel',(e)=>{
        e.preventDefault(); const p=getXY(e);
        const f=Math.exp(-e.deltaY*0.0014); this.zoomBy(f,p.x,p.y);
      },{passive:false});

      cv.addEventListener('dblclick',(e)=>{
        const p=getXY(e); const hit=this.hitTest(p.x,p.y);
        if(!hit) return;
        if(hit.type==='folder'){ this.onToggleCollapse(hit); }
        else { this.onDblFile(hit); }
      });
      cv.addEventListener('contextmenu',(e)=>{
        e.preventDefault(); const p=getXY(e); const hit=this.hitTest(p.x,p.y);
        this.onContext(hit, e.clientX, e.clientY);
      });
      cv.addEventListener('click',(e)=>{
        if(moved) return;
        const p=getXY(e); const hit=this.hitTest(p.x,p.y);
        if(hit){ if(this.selectedEdge){ this.selectedEdge=null; this.kick(); } return; }
        const edge=this.hitTestEdge(p.x,p.y);
        if(edge){ this.selectedEdge=edge; this.onEdgeSelect(edge); this.kick(); }
        else { this.selectedEdge=null; this.onSelect(null); }
      });

      // ---------- touch: 1-finger pan / node-drag / tap-select · 2-finger pinch-zoom + pan ----------
      let tMode=null, tNode=null, tMoved=false, pinchD=0, tLX=0, tLY=0, tDownT=0;
      const tXY=(t)=>{ const r=cv.getBoundingClientRect(); return {x:t.clientX-r.left, y:t.clientY-r.top}; };
      cv.addEventListener('touchstart',(e)=>{
        if(e.touches.length===1){
          const p=tXY(e.touches[0]); tLX=p.x; tLY=p.y; tMoved=false; tDownT=performance.now();
          const hit=this.hitTest(p.x,p.y);
          if(hit && !hit.locked && !this.opts.lockAll){ tMode='dragNode'; tNode=hit; tNode.fixed=true; this.onSelect(hit); }
          else if(hit){ tMode='tap'; this.onSelect(hit); }
          else { tMode='pan'; }
        } else if(e.touches.length===2){
          if(tNode && !tNode.pinned) tNode.fixed=false; tNode=null; tMode='pinch';
          const a=tXY(e.touches[0]), b=tXY(e.touches[1]); pinchD=Math.hypot(b.x-a.x,b.y-a.y);
          tLX=(a.x+b.x)/2; tLY=(a.y+b.y)/2;
        }
        e.preventDefault();
      },{passive:false});
      cv.addEventListener('touchmove',(e)=>{
        if(tMode==='pinch' && e.touches.length>=2){
          const a=tXY(e.touches[0]), b=tXY(e.touches[1]); const d=Math.hypot(b.x-a.x,b.y-a.y), cx=(a.x+b.x)/2, cy=(a.y+b.y)/2;
          if(pinchD>0) this.zoomBy(d/pinchD, cx, cy);
          const wa=this.cam.toWorld(tLX,tLY,this.w,this.h), wb=this.cam.toWorld(cx,cy,this.w,this.h);
          this.cam.x-=(wb.x-wa.x); this.cam.y-=(wb.y-wa.y); this.onChange(); this.kick();
          pinchD=d; tLX=cx; tLY=cy;
        } else if(e.touches.length===1 && tMode){
          const p=tXY(e.touches[0]); if(Math.abs(p.x-tLX)+Math.abs(p.y-tLY)>2) tMoved=true;
          const a=this.cam.toWorld(tLX,tLY,this.w,this.h), b=this.cam.toWorld(p.x,p.y,this.w,this.h);
          if(tMode==='dragNode' && tNode){ tNode.x+=(b.x-a.x); tNode.y+=(b.y-a.y); tNode.vx=0; tNode.vy=0; if(this.sim) this.sim.reheat(0.35); this.kick(); }
          else { if(tMode==='tap') tMode='pan'; this.cam.x-=(b.x-a.x); this.cam.y-=(b.y-a.y); this.onChange(); this.kick(); }
          tLX=p.x; tLY=p.y;
        }
        e.preventDefault();
      },{passive:false});
      cv.addEventListener('touchend',(e)=>{
        if(tMode==='dragNode' && tNode && !tNode.pinned) tNode.fixed=false;
        if(tMode==='pan' && !tMoved && e.changedTouches.length){ const p=tXY(e.changedTouches[0]); if(!this.hitTest(p.x,p.y)) this.onSelect(null); }
        // double-tap a folder = collapse / file = open
        if(tMode==='tap' && !tMoved){ const dt=performance.now()-(this._lastTap||0); this._lastTap=performance.now();
          if(dt<320 && e.changedTouches.length){ const p=tXY(e.changedTouches[0]); const hit=this.hitTest(p.x,p.y);
            if(hit){ if(hit.type==='folder') this.onToggleCollapse(hit); else this.onDblFile(hit); } } }
        if(e.touches.length===0){ tMode=null; tNode=null; }
      },{passive:false});
    }
  }

  // helpers
  function segDist(px,py,ax,ay,bx,by){
    const dx=bx-ax, dy=by-ay; const l2=dx*dx+dy*dy;
    let t=l2? ((px-ax)*dx+(py-ay)*dy)/l2 : 0; t=t<0?0:t>1?1:t;
    const cx=ax+t*dx, cy=ay+t*dy; return Math.hypot(px-cx,py-cy);
  }
  function roundRect(ctx,x,y,w,h,r){ r=Math.min(r,w/2,h/2); ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  // build an SVG element string for a node shape (world coords)
  // --- sphere sprite cache: render each colour's shaded ball ONCE, then blit (drawImage) every frame.
  // This is far cheaper than building gradients/clips per node per frame -> smooth with 1000s of nodes.
  const _SPR_S=128, _SPR_PAD=7, _SPR_R=_SPR_S/2-_SPR_PAD;
  const _SPR_SCALE=_SPR_S/(2*_SPR_R);
  const _sphereCache=new Map();
  let _shadowSprite=null;
  // blit a cached sphere for a node (screen px). Cheap: one drawImage.
  // 0..1 weight of a module from its connectivity / size
  // shapes are SYSTEM-IMPOSED by node type/kind (no user picker) so categories stay distinguishable
  // short format/extension code shown on top of a node
  function formatCode(n){
    if(n.type==='folder') return n.collapsed?'DIR+':'DIR';
    if(n.type==='external') return 'PKG';
    let c = n.ext || (n.lang && n.lang!=='__file__' ? n.lang : '') || '';
    if(!c && n.name && n.name.indexOf('.')>=0) c=n.name.split('.').pop();
    return (c||'?').toUpperCase().slice(0,4);
  }
  // per-node animation signature (stable phase + speed) so every figure's outgoing paths flow distinctly
  function badgeColor(n){
    if(n.type==='folder') return '#22d3ee';
    if(n.type==='external') return '#a78bfa';
    return (n.langInfo&&n.langInfo.color)||'#7d8aa0';
  }
  function roundRectScreen(ctx,x,y,w,h,r){ r=Math.min(r,w/2,h/2); ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  let _cssCache={};
  function getCss(v){ if(v in _cssCache) return _cssCache[v]; const c=getComputedStyle(document.documentElement).getPropertyValue(v).trim(); _cssCache[v]=c; return c; }

  return {Renderer};
})();
