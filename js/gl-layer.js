/* ===================== gl-layer.js — warstwa WebGL2 mapy (krawędzie i figury na GPU) ===================== */
// Duże mapy (tysiące węzłów, dziesiątki tysięcy krawędzi): tło, siatkę, krawędzie i figury rysuje GPU na osobnym
// <canvas id="map-gl"> POD mapą 2D. Canvas 2D (wtedy przezroczysty) rysuje resztę: etykiety, pierścienie zaznaczenia,
// strzałkę wybranej krawędzi i dekoratory modułów — więc wygląd i interakcje zostają te same.
// Pozycje trafiają do buforów w układzie świata, a kamera jest uniformem: przesuwanie i przybliżanie nie przebudowuje
// buforów; przebudowa tylko po zmianie danych, kolorów, podświetlenia albo pozycji (podpis liczony co klatkę).
// Krawędzie to pasy z trójkątów (grubość w px, wygładzanie w shaderze), łuki liczone w shaderze z tego samego
// punktu kontrolnego co w canvas 2D; przerywane i kropkowane linie z odległości wzdłuż krawędzi.
CM.GLLayer = (function(){
  let _sup=null;
  function supported(){
    if(_sup==null){ try{ const c=document.createElement('canvas'); const gl=c.getContext('webgl2'); _sup=!!gl; if(gl){ const x=gl.getExtension('WEBGL_lose_context'); if(x) x.loseContext(); } }catch(e){ _sup=false; } }
    return _sup;
  }

  // kolor CSS → [r,g,b,a] 0..1 (#rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), nazwy — przez fillStyle 2D); pamięć podręczna
  const _col=new Map(); let _cc=null;
  function rgba(c){
    let v=_col.get(c); if(v) return v;
    let s=String(c||'').trim(), r=0.5, g=0.5, b=0.5, a=1;
    let m=/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
    if(!m){
      if(!_cc) _cc=document.createElement('canvas').getContext('2d');
      _cc.fillStyle='#808080'; _cc.fillStyle=s; s=String(_cc.fillStyle);
      m=/^#([0-9a-f]{6})$/i.exec(s);
      if(!m){ const q=/rgba?\(([^)]+)\)/i.exec(s); if(q){ const p=q[1].split(',').map(parseFloat); r=p[0]/255; g=p[1]/255; b=p[2]/255; a=p.length>3?p[3]:1; } }
    }
    if(m){ let h=m[1]; if(h.length<5) h=h.split('').map(x=>x+x).join('');
      r=parseInt(h.slice(0,2),16)/255; g=parseInt(h.slice(2,4),16)/255; b=parseInt(h.slice(4,6),16)/255; if(h.length===8) a=parseInt(h.slice(6,8),16)/255; }
    v=[r,g,b,a]; if(_col.size>4096) _col.clear(); _col.set(c,v); return v;
  }

  // ---------------- shadery ----------------
  // węzły: instancje kwadratu; a_shape: 0 koło, 1 koło z obwódką, 2 romb z obwódką, 3 poświata (r·2,6+3 px), 4 kropka o promieniu w px
  const VS_NODE=`#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_pos;
layout(location=2) in float a_r;
layout(location=3) in vec4 a_col;
layout(location=4) in float a_shape;
uniform vec3 u_m0; uniform vec3 u_m1; uniform vec2 u_res; uniform float u_zoom; uniform float u_minR;
out vec2 v_p; out float v_r; out vec4 v_col; flat out int v_sh;
void main(){
  int sh=int(a_shape+0.5);
  float r = sh==4 ? a_r : a_r*u_zoom;
  if(sh!=4 && r<u_minR){ gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
  if(sh==3) r=r*2.6+3.0;
  float R=(sh==2 ? r*1.15 : r)+1.5;
  vec2 sp=vec2(dot(u_m0,vec3(a_pos,1.0)), dot(u_m1,vec3(a_pos,1.0)));
  vec2 p=a_corner*R; vec2 s=sp+p;
  v_p=p; v_r=r; v_col=a_col; v_sh=sh;
  gl_Position=vec4(s.x/u_res.x*2.0-1.0, 1.0-s.y/u_res.y*2.0, 0.0, 1.0);
}`;
  const FS_NODE=`#version 300 es
precision highp float;
in vec2 v_p; in float v_r; in vec4 v_col; flat in int v_sh;
out vec4 o;
void main(){
  float edge = v_sh==2 ? (v_r*1.15-(abs(v_p.x)+abs(v_p.y)))*0.70710678 : v_r-length(v_p);
  float cf=clamp(edge+0.5,0.0,1.0);
  float al=v_col.a;
  vec3 c=v_col.rgb*al*cf; float a=al*cf;
  if(v_sh==1 || v_sh==2){   // obwódka 1 px rgba(8,18,30,0.4) wycentrowana na krawędzi (jak stroke w canvas 2D)
    float sa=clamp(1.0-abs(edge),0.0,1.0)*0.4*al;
    c=vec3(0.031,0.071,0.118)*sa + c*(1.0-sa); a=sa + a*(1.0-sa);
  }
  if(a<=0.002) discard;
  o=vec4(c,a);
}`;
  // krawędzie: instancje pasa z trójkątów wzdłuż odcinka albo łuku (a_seg = t tego wierzchołka, t sąsiada, strona)
  // a_sty = (kreska px | -1 = kropki, przerwa px | okres kropek, łuk 0/1, grubość px)
  const VS_EDGE=`#version 300 es
layout(location=0) in vec3 a_seg;
layout(location=1) in vec2 a_s;
layout(location=2) in vec2 a_e;
layout(location=3) in vec4 a_col;
layout(location=4) in vec4 a_sty;
uniform vec3 u_m0; uniform vec3 u_m1; uniform vec2 u_res; uniform float u_fade;
out vec4 v_col; out float v_d; out float v_w; out vec3 v_dash;
vec2 scr(vec2 q){ return vec2(dot(u_m0,vec3(q,1.0)), dot(u_m1,vec3(q,1.0))); }
void main(){
  bool cur=a_sty.z>0.5; vec2 d=a_e-a_s; float L=max(length(d),1e-6);
  vec2 cp=(a_s+a_e)*0.5+vec2(-d.y,d.x)/L*min(L*0.13,46.0);
  float t=a_seg.x, u=a_seg.y;
  vec2 qa = cur ? (1.0-t)*(1.0-t)*a_s+2.0*(1.0-t)*t*cp+t*t*a_e : mix(a_s,a_e,t);
  vec2 qb = cur ? (1.0-u)*(1.0-u)*a_s+2.0*(1.0-u)*u*cp+u*u*a_e : mix(a_s,a_e,u);
  vec2 p=scr(qa), o=scr(qb);
  vec2 dir = u>t ? o-p : p-o; float dl=length(dir); dir = dl>1e-6 ? dir/dl : vec2(1.0,0.0);
  float w=a_sty.w, hw=max(w,1.0)*0.5+1.0;
  vec2 s=p+vec2(-dir.y,dir.x)*a_seg.z*hw;
  v_d=t*length(scr(a_e)-scr(a_s)); v_w=a_seg.z*hw; v_col=vec4(a_col.rgb, a_col.a*min(w,1.0)*u_fade); v_dash=vec3(a_sty.x,a_sty.y,w);
  gl_Position=vec4(s.x/u_res.x*2.0-1.0, 1.0-s.y/u_res.y*2.0, 0.0, 1.0);
}`;
  const FS_EDGE=`#version 300 es
precision highp float;
in vec4 v_col; in float v_d; in float v_w; in vec3 v_dash;
out vec4 o;
void main(){
  float hw=max(v_dash.z,1.0)*0.5;
  float a=clamp(hw+0.5-abs(v_w),0.0,1.0);
  if(v_dash.x>0.0){ if(mod(v_d, v_dash.x+v_dash.y)>v_dash.x) discard; }
  else if(v_dash.x<0.0){ float p=v_dash.y; float x=mod(v_d+p*0.5,p)-p*0.5; a=clamp(hw+0.5-length(vec2(x,v_w)),0.0,1.0); }
  float al=v_col.a*a; if(al<=0.002) discard;
  o=vec4(v_col.rgb*al, al);
}`;

  const NODE_F=8, EDGE_F=12;          // floaty na instancję
  const CURVE_SEG=8;                  // odcinki łuku

  function compile(gl, vs, fs){
    const sh=(type, src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: '+gl.getShaderInfoLog(s)); return s; };
    const p=gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: '+gl.getProgramInfoLog(p));
    const u={}; for(const n of ['u_m0','u_m1','u_res','u_zoom','u_minR','u_fade']) u[n]=gl.getUniformLocation(p,n);
    return {p, u};
  }
  function segGeometry(S){   // S odcinków × 2 trójkąty; (t, t sąsiada, strona)
    const a=[];
    for(let i=0;i<S;i++){ const t0=i/S, t1=(i+1)/S;
      a.push(t0,t1,-1, t0,t1,1, t1,t0,1,  t0,t1,-1, t1,t0,1, t1,t0,-1); }
    return new Float32Array(a);
  }

  // rosnące bufory instancji (bez alokacji co klatkę)
  class Buf { constructor(f){ this.f=f; this.a=new Float32Array(1024*f); this.n=0; }
    reset(){ this.n=0; }
    room(){ if((this.n+1)*this.f>this.a.length){ const b=new Float32Array(this.a.length*2); b.set(this.a); this.a=b; } return this.n++*this.f; } }

  class Layer {
    constructor(host){
      this.host=host;
      const c=document.createElement('canvas'); c.id='map-gl'; c.setAttribute('aria-hidden','true');
      host.parentNode.insertBefore(c, host); this.canvas=c;
      const gl=c.getContext('webgl2', {antialias:false, alpha:false, depth:false, stencil:false, premultipliedAlpha:true, powerPreference:'high-performance'});
      if(!gl){ c.remove(); throw new Error('WebGL2 niedostępny'); }
      this.gl=gl; this.lost=false; this.visible=false; this.onLost=null;
      c.addEventListener('webglcontextlost', (e)=>{ e.preventDefault(); this.lost=true; this.show(false); if(this.onLost) this.onLost(); });
      c.addEventListener('webglcontextrestored', ()=>{ try{ this._init(); this.lost=false; if(this.onLost) this.onLost(); }catch(e){ console.warn('[CodeMap] WebGL: kontekst nie wrócił — zostaje canvas 2D', e); } });
      this.nodes=new Buf(NODE_F); this.edges=new Buf(EDGE_F); this.xy=new Buf(4); this.gridN=new Buf(NODE_F); this.gridE=new Buf(EDGE_F);
      this._init();
    }
    get active(){ return this.visible && !this.lost; }
    show(on){ on=!!on; if(on===this.visible) return; this.visible=on; this.canvas.style.display=on?'block':'none'; if(!on) this._sig=null; }
    _init(){
      const gl=this.gl;
      this.pNode=compile(gl, VS_NODE, FS_NODE); this.pEdge=compile(gl, VS_EDGE, FS_EDGE);
      const quad=new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
      this.bQuad=this._static(quad); this.bSeg1=this._static(segGeometry(1)); this.bSegC=this._static(segGeometry(CURVE_SEG));
      this.bNodes=gl.createBuffer(); this.bEdges=gl.createBuffer(); this.bGridN=gl.createBuffer(); this.bGridE=gl.createBuffer();
      this.vao=gl.createVertexArray(); this._sig=null; this.nDraws=[]; this.eDraws=[];
    }
    _static(arr){ const gl=this.gl, b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return b; }
    _upload(buf, glBuf, usage){ const gl=this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, glBuf); gl.bufferData(gl.ARRAY_BUFFER, buf.a.subarray(0, buf.n*buf.f), usage); }

    // ---------------- dane z renderera ----------------
    _signature(R){
      let h=0, i=0;
      for(const n of R.nodes){ h+=(n.x*1.3+n.y*0.7+n.r*1.9)*((i++%7)+1); }
      const o=R.opts;
      return [R.nodes, R.edges, R.highlight, R.impact, R.colorFn, R.selectedEdge, R.cycleEdges, R.graph, R._cssVer, o.cosmic, o.dim, o.edgeOpacity,
        o.curvedImports, o.nodeScale, o.cosmicPalette, document.body.classList.contains('light'), h, R.nodes.length, R.edges.length];
    }
    _same(a,b){ if(!a||!b||a.length!==b.length) return false; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return false; return true; }
    _node(buf, x, y, r, c, alpha, shape){ const k=buf.room(), a=buf.a; a[k]=x; a[k+1]=y; a[k+2]=r; a[k+3]=c[0]; a[k+4]=c[1]; a[k+5]=c[2]; a[k+6]=c[3]*alpha; a[k+7]=shape; }
    _edge(buf, s, t, c, alpha, dash, gap, curved, w){ const k=buf.room(), a=buf.a;
      a[k]=s.x; a[k+1]=s.y; a[k+2]=t.x; a[k+3]=t.y; a[k+4]=c[0]; a[k+5]=c[1]; a[k+6]=c[2]; a[k+7]=c[3]*alpha; a[k+8]=dash; a[k+9]=gap; a[k+10]=curved?1:0; a[k+11]=w; }

    _build(R){
      const RM=CM.Renderer, badgeColor=RM.badgeColor, U=CM.util;
      const o=R.opts, imp=R.impact, dimMode=!!R.highlight||!!imp, cosmic=!!o.cosmic, eo=o.edgeOpacity, scale=o.nodeScale;
      if(cosmic && !R._cosmicLUT) R._buildCosmicLUT();
      const N=this.nodes, E=this.edges; N.reset(); E.reset();
      const nd=[], ed=[];
      const close=(list, buf)=>{ const l=list[list.length-1]; if(l) l.end=buf.n; };
      const byId=R.nodeById, pal=R.impactPalette();
      const vis=(e)=>R.edgeVisible(e);   // te same reguły widoczności i kolorów co canvas 2D (renderer.js)

      // ----- krawędzie (kolejność jak w canvas 2D) -----
      const curved=o.curvedImports!==false;
      ed.push({start:E.n, curved:false, add:false});
      const cC=rgba(cosmic?'#4a5aa8':'#67809f'), aC=cosmic?U.clamp(0.3*eo*2,0,0.6):U.clamp(0.34*eo*2,0,0.7);
      this.xy.reset();
      for(const e of R.edges){ if(e.type!=='contains') continue; const s=byId.get(e.source), t=byId.get(e.target); if(!s||!t||!vis(e)) continue;
        this._edge(E, s, t, cC, aC, 0, 0, false, 0.5); }
      close(ed, E);
      ed.push({start:E.n, curved, add:cosmic, bulk:true});
      const tests=[];
      const aImp=cosmic?0.5:(dimMode?0.62:0.48), aRef=cosmic?0.42:(dimMode?0.5:0.4), aCall=cosmic?0.45:(dimMode?0.6:0.5);
      for(const e of R.edges){ if(e.type==='contains') continue; const s=byId.get(e.source), t=byId.get(e.target); if(!s||!t||!vis(e)) continue;
        if(e.type==='test'){ tests.push(s,t); continue; }
        { const k=this.xy.room(); this.xy.a[k]=s.x; this.xy.a[k+1]=s.y; this.xy.a[k+2]=t.x; this.xy.a[k+3]=t.y; }
        const col=rgba(cosmic ? R.cosmicColor(s._cosmic) : (e._ec || (e._ec=badgeColor(s))));
        if(e.type==='reference') this._edge(E, s, t, col, aRef, 3.4, 3.4, curved, cosmic?0.9:0.8);
        else if(e.type==='call') this._edge(E, s, t, col, aCall, 1.4, 2.6, curved, 0.6);
        else this._edge(E, s, t, col, aImp, 0, 0, curved, cosmic?1.05:0.85);
      }
      close(ed, E);
      if(tests.length){ ed.push({start:E.n, curved, add:false});
        const cT=rgba(document.body.classList.contains('light')?'#15803d':'#4ade80'), aT=dimMode?0.95:0.8;
        for(let i=0;i<tests.length;i+=2) this._edge(E, tests[i], tests[i+1], cT, aT, -1, 3.6, curved, 2);
        close(ed, E); }
      if(imp){
        const set=(col, inSet)=>{ ed.push({start:E.n, curved, add:false}); const c=rgba(col);
          for(const e of R.edges){ if(e.type==='contains') continue; if(!(imp.all.has(e.source)&&imp.all.has(e.target))) continue;
            if(!(inSet.has(e.source)||inSet.has(e.target))) continue; const s=byId.get(e.source), t=byId.get(e.target); if(!s||!t) continue;
            this._edge(E, s, t, c, 0.85, 0, 0, curved, 1.6); }
          close(ed, E); };
        set(pal.down, imp.down); set(pal.up, imp.up);
      }
      if(R.cycleEdges && R.cycleEdges.size){ ed.push({start:E.n, curved, add:false}); const c=rgba('#ff3b6b');
        for(const e of R.edges){ if(e.type==='contains' || !R.cycleEdges.has(e.source+'|'+e.target)) continue; const s=byId.get(e.source), t=byId.get(e.target); if(!s||!t) continue;
          this._edge(E, s, t, c, 0.95, 0, 0, curved, 2); }
        close(ed, E); }
      if(R.selectedEdge){ const e=R.selectedEdge, s=byId.get(e.source), t=byId.get(e.target);
        if(s&&t){ ed.push({start:E.n, curved:curved&&e.type!=='contains', add:false}); this._edge(E, s, t, rgba('#ffffff'), 1, 0, 0, curved&&e.type!=='contains', 2); close(ed, E); } }

      // ----- figury: poświata (cosmic), koła przygaszone, koła jasne, romby przygaszone, romby jasne -----
      const groups=[[],[],[],[]];   // dimC, fullC, dimD, fullD: [node, kolor]
      for(const n of R.nodes) groups[(n.type==='symbol'?2:0)+(R.nodeBright(n)?1:0)].push(n, R.nodeColor(n, cosmic, pal));
      if(cosmic && groups[1].length){ nd.push({start:N.n, add:true});
        for(let i=0;i<groups[1].length;i+=2){ const n=groups[1][i]; this._node(N, n.x, n.y, n.r*scale, rgba(groups[1][i+1]), 0.14, 3); }
        close(nd, N); }
      nd.push({start:N.n, add:false});
      const shapeC=cosmic?0:1;
      const put=(g, alpha, shape)=>{ for(let i=0;i<g.length;i+=2){ const n=g[i]; this._node(N, n.x, n.y, n.r*scale, rgba(g[i+1]), alpha, shape); } };
      put(groups[0], o.dim, shapeC); put(groups[1], 1, shapeC); put(groups[2], o.dim, 2); put(groups[3], 1, 2);
      close(nd, N);
      let bx0=Infinity, by0=Infinity, bx1=-Infinity, by1=-Infinity;
      for(const n of R.nodes){ if(n.x<bx0) bx0=n.x; if(n.x>bx1) bx1=n.x; if(n.y<by0) by0=n.y; if(n.y>by1) by1=n.y; }
      this.bounds=[bx0,by0,bx1,by1];
      this.nDraws=nd.filter(d=>d.end>d.start); this.eDraws=ed.filter(d=>d.end>d.start);
      this._upload(N, this.bNodes, this.gl.STATIC_DRAW); this._upload(E, this.bEdges, this.gl.STATIC_DRAW);
    }

    _grid(R){
      const G=this.gridE, D=this.gridN; G.reset(); D.reset();
      const z=R.cam.zoom; if(!R.opts.showGrid || z<0.025) return;
      const getCss=CM.Renderer.getCss, vb=R.worldBounds(), g=CM.Renderer.gridSteps(vb, z); if(!g) return;
      const {step, xN, yN, x0, y0}=g;
      const cl=rgba(getCss('--grid-line')||'#5a6f88'), cd=rgba(getCss('--grid-dot')||'#7d93ad');
      for(let i=0;i<=xN;i++){ const x=x0+i*step; this._edge(G, {x, y:vb.minY}, {x, y:vb.maxY}, cl, 0.14, 0, 0, false, 1); }
      for(let i=0;i<=yN;i++){ const y=y0+i*step; this._edge(G, {x:vb.minX, y}, {x:vb.maxX, y}, cl, 0.14, 0, 0, false, 1); }
      let cnt=0;
      for(let ix=0;ix<=xN && cnt<=6000;ix++){ const x=x0+ix*step; for(let iy=0;iy<=yN;iy++){ this._node(D, x, y0+iy*step, 1.3, cd, 0.34, 4); if(++cnt>6000) break; } }
    }

    // ---------------- rysowanie ----------------
    _bindNodes(glBuf, first){ const gl=this.gl, F=NODE_F*4, off=first*F;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bQuad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); gl.vertexAttribDivisor(0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,F,off); gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,F,off+8); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,F,off+12); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,1,gl.FLOAT,false,F,off+28); gl.vertexAttribDivisor(4,1); }
    _bindEdges(glBuf, first, curved){ const gl=this.gl, F=EDGE_F*4, off=first*F;
      gl.bindBuffer(gl.ARRAY_BUFFER, curved?this.bSegC:this.bSeg1); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0); gl.vertexAttribDivisor(0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,F,off); gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,2,gl.FLOAT,false,F,off+8); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,F,off+16); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,F,off+32); gl.vertexAttribDivisor(4,1); }
    _uniforms(p, R, M){ const gl=this.gl;
      gl.uniform3f(p.u.u_m0, M.a, M.c, M.e); gl.uniform3f(p.u.u_m1, M.b, M.d, M.f); gl.uniform2f(p.u.u_res, R.w, R.h);
      if(p.u.u_zoom) gl.uniform1f(p.u.u_zoom, R.cam.zoom);
      if(p.u.u_minR){ const huge=R.nodes.length>(R.opts.lodHugeNodes||9000); gl.uniform1f(p.u.u_minR, (huge||R.cam.zoom<0.12)?1.1:0.5); } }
    _blend(add){ const gl=this.gl; gl.blendFunc(gl.ONE, add?gl.ONE:gl.ONE_MINUS_SRC_ALPHA); }

    render(R){
      const gl=this.gl; if(this.lost) return false;
      const c=this.canvas, W=Math.max(1,Math.round(R.w*R.dpr)), H=Math.max(1,Math.round(R.h*R.dpr));
      if(c.width!==W || c.height!==H){ c.width=W; c.height=H; }
      gl.viewport(0,0,W,H);
      const bg=rgba(CM.Renderer.getCss('--bg')||'#0a0e14'); gl.clearColor(bg[0],bg[1],bg[2],1); gl.clear(gl.COLOR_BUFFER_BIT);
      const sig=this._signature(R); if(!this._same(sig, this._sig)){ this._build(R); this._sig=sig; this.builds=(this.builds||0)+1; }
      this._grid(R); this._upload(this.gridE, this.bGridE, gl.DYNAMIC_DRAW); this._upload(this.gridN, this.bGridN, gl.DYNAMIC_DRAW);
      const M=R.cam.xf(R.w,R.h);
      gl.enable(gl.BLEND); gl.bindVertexArray(this.vao);
      // krawędzie (z siatką na początku)
      gl.useProgram(this.pEdge.p); this._uniforms(this.pEdge, R, M);
      const fade=this.fade(R); let uf=-1;
      const setFade=(f)=>{ if(f!==uf){ gl.uniform1f(this.pEdge.u.u_fade, f); uf=f; } };
      if(this.gridE.n){ setFade(1); this._blend(false); this._bindEdges(this.bGridE, 0, false); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.gridE.n); }
      for(const d of this.eDraws){ setFade(d.bulk?fade:1); this._blend(d.add); this._bindEdges(this.bEdges, d.start, d.curved); gl.drawArraysInstanced(gl.TRIANGLES, 0, d.curved?6*CURVE_SEG:6, d.end-d.start); }
      // figury (kropki siatki pod nimi)
      gl.useProgram(this.pNode.p); this._uniforms(this.pNode, R, M);
      if(this.gridN.n){ this._blend(false); this._bindNodes(this.bGridN, 0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.gridN.n); }
      for(const d of this.nDraws){ this._blend(d.add); this._bindNodes(this.bNodes, d.start); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, d.end-d.start); }
      gl.bindVertexArray(null);
      this.stats={nodes:this.nodes.n, edges:this.edges.n, grid:this.gridE.n+this.gridN.n, builds:this.builds, fade:Math.round(fade*1000)/1000};
      return true;
    }
    // wygaszanie gęstych zależności (importy, referencje, wywołania; struktura zostaje): średnie pokrycie piksela
    // W OKNIE = długość krawędzi przyciętych do okna (Liang–Barsky, ~1 ms na 40 tys.) / pole mapy w oknie; powyżej ~0,6
    // alfa maleje proporcjonalnie. Canvas 2D robił to przez LOD (tylko część krawędzi) — GPU rysuje wszystkie,
    // ale nie zalewa mapy kolorem; po przybliżeniu gęstość w oknie spada i krawędzie wracają do pełnej alfy.
    fade(R){
      const xy=this.xy, n=xy.n; if(!n) return 1;
      const M=R.cam.xf(R.w,R.h), W=R.w, H=R.h, A=xy.a; let len=0;
      for(let i=0,k=0;i<n;i++,k+=4){
        const x0=M.a*A[k]+M.c*A[k+1]+M.e, y0=M.b*A[k]+M.d*A[k+1]+M.f, x1=M.a*A[k+2]+M.c*A[k+3]+M.e, y1=M.b*A[k+2]+M.d*A[k+3]+M.f;
        const dx=x1-x0, dy=y1-y0; let t0=0, t1=1, ok=true;
        const P=[-dx, dx, -dy, dy], Q=[x0, W-x0, y0, H-y0];
        for(let j=0;j<4;j++){ const p=P[j], q=Q[j];
          if(p===0){ if(q<0){ ok=false; break; } continue; }
          const r=q/p; if(p<0){ if(r>t1){ ok=false; break; } if(r>t0) t0=r; } else { if(r<t0){ ok=false; break; } if(r<t1) t1=r; } }
        if(ok) len+=Math.hypot(dx,dy)*(t1-t0);
      }
      // pole = ramka mapy na ekranie ∩ okno (puste obszary okna nie rozrzedzają gęstości)
      const b=this.bounds; let area=W*H;
      if(b && b[0]<=b[2]){ let sx0=Infinity, sy0=Infinity, sx1=-Infinity, sy1=-Infinity;
        for(const [x,y] of [[b[0],b[1]],[b[2],b[1]],[b[0],b[3]],[b[2],b[3]]]){ const u=M.a*x+M.c*y+M.e, v=M.b*x+M.d*y+M.f; if(u<sx0) sx0=u; if(u>sx1) sx1=u; if(v<sy0) sy0=v; if(v>sy1) sy1=v; }
        area=Math.max(0, Math.min(W,sx1)-Math.max(0,sx0))*Math.max(0, Math.min(H,sy1)-Math.max(0,sy0)); }
      // średnio ≤ 0,6 krawędzi na piksel w pełnej alfie; środek mapy bywa kilka razy gęstszy niż średnia
      const density=len/Math.max(1,area);
      return density<=0.6 ? 1 : Math.max(0.02, 0.6/density);
    }
    destroy(){ try{ const x=this.gl.getExtension('WEBGL_lose_context'); if(x) x.loseContext(); }catch(e){ /* kontekst już utracony */ } this.canvas.remove(); }
  }

  return {supported, Layer, rgba};
})();
