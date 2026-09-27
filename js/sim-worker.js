/* ===================== sim-worker.js — force simulation off the main thread =====================
   Receives a graph, runs gravity + spring + Barnes-Hut repulsion (js/physics.js — the same code as
   CM.Layouts.forceSim on the main thread) and streams node positions back as transferable Float32Arrays. */

let nodes=[], edges=[], spacing=1;
let alpha=1, alphaMin=0.02, alphaDecay=0.019, velDecay=0.82;
let running=false, timer=null;

// fizyka wspólna z CM.Layouts.forceSim — js/physics.js z tym samym stemplem ?v= co strona (inaczej stara kopia z SW)
const V=(self.location&&/[?&]v=([\w.-]+)/.exec(self.location.search||''))?/[?&]v=([\w.-]+)/.exec(self.location.search)[1]:'';
importScripts('physics.js'+(V?'?v='+V:''));
let springs=[];
function tick(){
  const st={alpha, alphaMin, alphaDecay, velDecay, spacing};
  running=CM.Physics.step(nodes, springs, st) && running; alpha=st.alpha;
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
    springs=edges.map(e=>({s:nodes[e.s], t:nodes[e.t], c:!!e.c, w:e.w||1})).filter(x=>x.s&&x.t);
    const o=d.opts||{}; alphaMin=o.alphaMin||0.02; alphaDecay=o.alphaDecay||0.019; velDecay=o.velDecay||0.82;
    alpha=1; running=true; if(timer) clearTimeout(timer); loop();
  } else if(d.type==='reheat'){ alpha=Math.max(alpha, d.alpha||0.5); if(!running){ running=true; if(!timer) loop(); } }
  else if(d.type==='stop'){ running=false; if(timer){ clearTimeout(timer); timer=null; } }
};
