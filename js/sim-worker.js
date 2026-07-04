/* ===================== sim-worker.js — force simulation off the main thread =====================
   Self-contained (no CM modules). Receives a graph, runs gravity + spring + Barnes-Hut repulsion,
   and streams node positions back as transferable Float32Arrays. Mirrors layouts.js forceSim physics. */

let nodes=[], edges=[], spacing=1;
let alpha=1, alphaMin=0.02, alphaDecay=0.019, velDecay=0.82;
let running=false, timer=null;

// ---- Barnes-Hut quadtree repulsion (copy of CM.Layouts.bhRepulse) ----
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
  const t2=theta*theta; const stack=[];
  for(const n of nodes){ if(n.fixed) continue;
    stack.length=0; stack.push(root);
    while(stack.length){ const c=stack.pop(); if(!c.m) continue;
      if(c.kids){ const dx=n.x-c.cx, dy=n.y-c.cy; let d2=dx*dx+dy*dy||0.01;
        if((c.s*c.s)/d2 < t2){ const mag=strength*c.m/d2, inv=1/Math.sqrt(d2); n.vx+=dx*inv*mag; n.vy+=dy*inv*mag; }
        else stack.push(c.kids[0],c.kids[1],c.kids[2],c.kids[3]);
        continue; }
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

function tick(){
  const a=alpha, sp=spacing;
  const g=0.0055*a/sp;
  for(const n of nodes){ if(n.fixed) continue; n.vx-=n.x*g; n.vy-=n.y*g; }
  for(const e of edges){ const s=nodes[e.s], t=nodes[e.t]; if(!s||!t) continue;
    let dx=t.x-s.x, dy=t.y-s.y, d=Math.hypot(dx,dy)||0.01;
    const desired=(e.c ? (s.r+t.r+34) : (s.r+t.r+90))*sp;
    const k=(e.c?0.08:0.03)*a*Math.min(2,e.w||1);
    const f=((d-desired)/d)*k, fx=dx*f, fy=dy*f;
    if(!s.fixed){ s.vx+=fx; s.vy+=fy; } if(!t.fixed){ t.vx-=fx; t.vy-=fy; }
  }
  bhRepulse(nodes, 1900*a*sp*sp, 0.9);
  for(const n of nodes){ if(n.fixed){ n.vx=0; n.vy=0; continue; } n.vx*=velDecay; n.vy*=velDecay;
    const s=Math.hypot(n.vx,n.vy), mv=28; if(s>mv){ n.vx=n.vx/s*mv; n.vy=n.vy/s*mv; } n.x+=n.vx; n.y+=n.vy; }
  alpha=a*(1-alphaDecay);
  if(alpha<alphaMin) running=false;
  return running;
}
function postPositions(settled){
  const p=new Float32Array(nodes.length*2);
  for(let i=0;i<nodes.length;i++){ p[i*2]=nodes[i].x; p[i*2+1]=nodes[i].y; }
  postMessage({type:settled?'settled':'pos', pos:p}, [p.buffer]);
}
function loop(){
  let cont=true; for(let i=0;i<2 && cont;i++) cont=tick();   // a couple ticks/frame for faster convergence
  if(running){ postPositions(false); timer=setTimeout(loop, 16); }
  else { postPositions(true); timer=null; }
}
onmessage=(e)=>{
  const d=e.data;
  if(d.type==='init'){
    nodes=d.nodes.map(n=>({x:n.x, y:n.y, r:n.r||6, fixed:!!n.fixed, vx:0, vy:0}));
    edges=d.edges||[]; spacing=d.spacing||1;
    const o=d.opts||{}; alphaMin=o.alphaMin||0.02; alphaDecay=o.alphaDecay||0.019; velDecay=o.velDecay||0.82;
    alpha=1; running=true; if(timer) clearTimeout(timer); loop();
  } else if(d.type==='reheat'){ alpha=Math.max(alpha, d.alpha||0.5); if(!running){ running=true; if(!timer) loop(); } }
  else if(d.type==='stop'){ running=false; if(timer){ clearTimeout(timer); timer=null; } }
};
