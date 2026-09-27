/* ===================== physics.js — fizyka układu siłowego (wspólna dla okna i workera) ===================== */
// Grawitacja do środka, sprężyny wzdłuż krawędzi, odpychanie Barnes-Hut O(n log n) i całkowanie z tłumieniem.
// Jedna implementacja dla CM.Layouts.forceSim (wątek główny) i js/sim-worker.js (importScripts) — wcześniej
// worker miał kopię 1:1, a Inspect zgłaszał ją jako największy duplikat w repozytorium.
// Węzły: {x, y, vx, vy, r, fixed}; sprężyny: {s, t (obiekty węzłów), c (krawędź „contains"), w (waga)};
// stan: {alpha, alphaMin, alphaDecay, velDecay, spacing} — step() zmniejsza alpha i zwraca, czy symulacja trwa.
(function(root){
  function bhRepulse(nodes, strength, theta){
    const N=nodes.length; if(N<2) return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const n of nodes){ if(n.x<minX)minX=n.x; if(n.x>maxX)maxX=n.x; if(n.y<minY)minY=n.y; if(n.y>maxY)maxY=n.y; }
    if(!isFinite(minX)) return;
    const size=Math.max(maxX-minX, maxY-minY, 1)+1;
    const cell=(x,y,s)=>({x,y,s,m:0,cx:0,cy:0,body:null,extra:null,kids:null});
    const rootCell=cell(minX,minY,size);
    const sub=(c)=>{ const h=c.s/2; c.kids=[cell(c.x,c.y,h),cell(c.x+h,c.y,h),cell(c.x,c.y+h,h),cell(c.x+h,c.y+h,h)]; };
    const quad=(c,n)=>{ const h=c.s/2; return c.kids[(n.y>=c.y+h?2:0)+(n.x>=c.x+h?1:0)]; };
    // wstawianie iteracyjne; po 48 poziomach (węzły w jednym punkcie) ciała trafiają do listy „extra"
    const insert=(c,n,depth)=>{
      while(true){
        if(c.kids){ c=quad(c,n); depth++; if(depth>48){ (c.extra||(c.extra=[])).push(n); return; } continue; }
        if(c.body===null){ c.body=n; return; }
        if(depth>=48){ (c.extra||(c.extra=[])).push(n); return; }
        const old=c.body; c.body=null; sub(c); insert(quad(c,old),old,depth+1); c=quad(c,n); depth++;
      }
    };
    for(const n of nodes) insert(rootCell,n,0);
    const mass=(c)=>{ if(c.kids){ let m=0,sx=0,sy=0; for(const k of c.kids){ mass(k); if(k.m){ m+=k.m; sx+=k.cx*k.m; sy+=k.cy*k.m; } } c.m=m; if(m){ c.cx=sx/m; c.cy=sy/m; } return; }
      let m=0,sx=0,sy=0; if(c.body){ m++; sx+=c.body.x; sy+=c.body.y; } if(c.extra){ for(const e of c.extra){ m++; sx+=e.x; sy+=e.y; } } c.m=m; if(m){ c.cx=sx/m; c.cy=sy/m; } };
    mass(rootCell);
    const t2=theta*theta; const stack=[];
    // węzły w (prawie) tym samym punkcie: kierunek z pary (lo, hi) i znak z kolejności — n i b rozchodzą się
    // w PRZECIWNE strony (wcześniej kierunek zależał od tej samej sumy współrzędnych, więc oba szły razem)
    let ix=null;
    const order=(m)=>{ if(!ix){ ix=new Map(); nodes.forEach((x,k)=>ix.set(x,k)); } return ix.get(m); };
    const apart=(n,b)=>{ const i=order(n), j=order(b), lo=Math.min(i,j), hi=Math.max(i,j), s=i<j?1:-1;
      const ang=((lo*0.6180339887+hi*0.3819660113)%1)*Math.PI*2; return [Math.cos(ang)*0.3*s, Math.sin(ang)*0.3*s]; };
    for(const n of nodes){ if(n.fixed) continue;
      stack.length=0; stack.push(rootCell);
      while(stack.length){ const c=stack.pop(); if(!c.m) continue;
        if(c.kids){ const dx=n.x-c.cx, dy=n.y-c.cy; const d2=dx*dx+dy*dy;
          // środek masy w samym węźle (komórka z nim i jego „bliźniakiem") — przybliżenie dałoby siłę bez kierunku
          if(d2>=0.01 && (c.s*c.s)/d2 < t2){ const mag=strength*c.m/d2, inv=1/Math.sqrt(d2); n.vx+=dx*inv*mag; n.vy+=dy*inv*mag; }
          else stack.push(c.kids[0],c.kids[1],c.kids[2],c.kids[3]);
          continue; }
        const bodies = c.extra ? (c.body?[c.body].concat(c.extra):c.extra) : (c.body?[c.body]:null);
        if(!bodies) continue;
        for(const b of bodies){ if(b===n) continue;
          let dx=n.x-b.x, dy=n.y-b.y, d2=dx*dx+dy*dy; if(d2<0.01){ [dx,dy]=apart(n,b); d2=dx*dx+dy*dy; }
          const minD=n.r+b.r+12, overlap=d2<minD*minD?3.2:1;   // nachodzące na siebie figury odpychają się mocniej
          const mag=strength*overlap/d2, inv=1/Math.sqrt(d2); n.vx+=dx*inv*mag; n.vy+=dy*inv*mag;
        }
      }
    }
  }

  // jeden krok symulacji; true = trwa dalej (alpha ≥ alphaMin)
  function step(nodes, springs, st){
    const a=st.alpha, sp=st.spacing||1;
    const g=0.0055*a/sp;                       // grawitacja słabsza przy większym rozrzucie
    for(const n of nodes){ if(n.fixed) continue; n.vx-=n.x*g; n.vy-=n.y*g; }
    for(const e of springs){ const s=e.s, t=e.t;
      const dx=t.x-s.x, dy=t.y-s.y, d=Math.hypot(dx,dy)||0.01;
      const desired=(e.c ? (s.r+t.r+34) : (s.r+t.r+90))*sp;
      const k=(e.c?0.08:0.03)*a*Math.min(2,e.w||1);
      const f=((d-desired)/d)*k, fx=dx*f, fy=dy*f;
      if(!s.fixed){ s.vx+=fx; s.vy+=fy; } if(!t.fixed){ t.vx-=fx; t.vy-=fy; }
    }
    bhRepulse(nodes, 1900*a*sp*sp, 0.9);
    for(const n of nodes){ if(n.fixed){ n.vx=0; n.vy=0; continue; }
      n.vx*=st.velDecay; n.vy*=st.velDecay;
      const v=Math.hypot(n.vx,n.vy), mv=28; if(v>mv){ n.vx=n.vx/v*mv; n.vy=n.vy/v*mv; }
      n.x+=n.vx; n.y+=n.vy; }
    st.alpha=a*(1-st.alphaDecay);
    return st.alpha>=st.alphaMin;
  }

  root.CM=root.CM||{};
  root.CM.Physics={bhRepulse, step};
})(typeof self!=='undefined'?self:this);
