/* ===================== overlays.js — kolorowanie węzłów wg danych (nakładki) ===================== */
// Domyślnie węzły mają kolor języka. Nakładka podmienia go funkcją colorOf(n) policzoną raz na zestaw
// węzłów (refresh() po każdym apply), więc render nie liczy nic per klatkę poza odczytem z Mapy.
// Moduły dopisują własne nakładki: git.js (właściciel, częstość zmian, wiek), testmap.js (pokrycie, testy).
//   CM.Overlays.register({id, label:()=>tekst, order, available(graph)->bool, unavailable()->tekst,
//                         compute(graph)->{colorOf(n)->hex|null, legend:{items|gradient, note}}})
//   legend.items = [{color, label, count?, ids?:Set}] (klik = podświetl ids), legend.gradient = {stops, min, max}
CM.Overlays = (function(){
  const I=CM.i18n;
  const T=(k,f)=>(I&&I.t)?I.t(k,f):f;
  const reg=new Map();
  let mode='lang', res=null, legendHi=null;

  // ---- kolory (zawsze #hex — renderer i minimapa robią z nich rgba) ----
  const NONE='#334155', FOLDER='#3b4d63';
  const hex2=(v)=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0');
  function rgb(h){ h=String(h).replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); const n=parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; }
  function mixHex(a,b,t){ const A=rgb(a), B=rgb(b); return '#'+hex2(A[0]+(B[0]-A[0])*t)+hex2(A[1]+(B[1]-A[1])*t)+hex2(A[2]+(B[2]-A[2])*t); }
  // ramp(['#zimny','#ciepły',…])(t∈[0,1]) → #hex; t spoza zakresu przycinane, NaN → pierwszy kolor
  function ramp(stops){
    const n=stops.length-1;
    return (t)=>{ t=Number.isFinite(t)?Math.max(0,Math.min(1,t)):0; const s=t*n, k=Math.min(n-1,Math.floor(s)); return n<1?stops[0]:mixHex(stops[k],stops[k+1],s-k); };
  }
  const HEAT=['#1d4ed8','#22d3ee','#34d399','#facc15','#f97316','#ef4444'];   // mało → dużo
  // paleta kategorii (np. właściciele plików): rozróżnialne kolory w kolejności rangi
  const PALETTE=['#22d3ee','#f472b6','#facc15','#34d399','#a78bfa','#fb923c','#60a5fa','#f87171','#4ade80','#e879f9','#2dd4bf','#fbbf24'];

  function register(o){ if(!o||!o.id) return; reg.set(o.id, o); fillSelect(); }
  function graph(){ return CM.App && CM.App.graph; }
  function isAvailable(o, g){ try{ return !o.available || !!o.available(g||graph()); }catch(e){ return false; } }
  function list(g){ return [...reg.values()].filter(o=>isAvailable(o,g)).sort((a,b)=>(a.order||50)-(b.order||50)); }
  function current(){ return mode; }
  function label(o){ try{ return typeof o.label==='function'?o.label():String(o.label||o.id); }catch(e){ return o.id; } }

  // przełącz nakładkę; błąd z czytelnym opisem, gdy brak danych (np. „najpierw historia git")
  function set(id){
    const o=reg.get(id);
    if(!o) throw new Error(T('ov.unknown','Nieznane kolorowanie: ')+id+' ('+[...reg.keys()].join(', ')+')');
    if(!isAvailable(o)) throw new Error((o.unavailable&&o.unavailable())||T('ov.noData','Brak danych dla tego kolorowania.'));
    mode=id; legendHi=null; refresh(); fillSelect();
    return label(o);
  }
  function reset(){ mode='lang'; res=null; legendHi=null; const R=CM.App&&CM.App.renderer; if(R){ R.colorFn=null; } renderLegend(); fillSelect(); }

  // przelicz kolory dla bieżącego grafu (po apply / po nowych danych git lub pokrycia)
  function refresh(){
    const A=CM.App, R=A&&A.renderer; if(!R) return;
    let o=reg.get(mode);
    if(!o || mode==='lang' || !isAvailable(o)){ mode='lang'; fillSelect(); res=null; R.colorFn=null; renderLegend(); R.kick&&R.kick(); return; }
    try{ res=o.compute(A.graph)||null; }catch(e){ console.warn('overlay '+mode, e); res=null; }
    R.colorFn=res&&res.colorOf ? res.colorOf : null;
    fillSelect(); renderLegend(); R.kick&&R.kick();
    if(R.drawMinimap){ try{ R.drawMinimap(document.getElementById('minimap')); }catch(e){} }
  }

  // ---- UI: <select id="sel-overlay"> + legenda pod nim ----
  function fillSelect(){
    const sel=typeof document!=='undefined'&&document.getElementById('sel-overlay'); if(!sel) return;
    const items=list();
    sel.innerHTML='';
    for(const o of items){ const op=document.createElement('option'); op.value=o.id; op.textContent=label(o); sel.appendChild(op); }
    sel.value=items.some(o=>o.id===mode)?mode:'lang';
  }
  function renderLegend(){
    const box=typeof document!=='undefined'&&document.getElementById('overlay-legend'); if(!box) return;
    box.innerHTML='';
    const lg=res&&res.legend; if(!lg || mode==='lang'){ box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const U=CM.util, el=U.el;
    if(lg.title) box.appendChild(el('div',{class:'ovl-title',text:lg.title}));
    if(lg.gradient){
      const g=lg.gradient;
      box.appendChild(el('div',{class:'ovl-grad',style:'background:linear-gradient(90deg,'+g.stops.join(',')+')'}));
      box.appendChild(el('div',{class:'ovl-grad-lbl'}, el('span',{text:g.min==null?'':String(g.min)}), el('span',{text:g.max==null?'':String(g.max)})));
    }
    for(const it of (lg.items||[])){
      const row=el('div',{class:'ovl-item'+(it.ids?' clickable':''),title:it.title||it.label},
        el('span',{class:'ovl-sw',style:'background:'+it.color}),
        el('span',{class:'ovl-lbl',text:it.label}),
        el('span',{class:'ovl-cnt',text:it.count!=null?String(it.count):''}));
      if(it.ids){ row.onclick=()=>{
        const R=CM.App.renderer; const on=legendHi!==it;
        legendHi=on?it:null; R.setHighlight(on?new Set(it.ids):null);
        box.querySelectorAll('.ovl-item').forEach(x=>x.classList.remove('active')); if(on) row.classList.add('active');
      }; }
      box.appendChild(row);
    }
    if(lg.note) box.appendChild(el('p',{class:'muted small ovl-note',text:lg.note}));
  }
  function wire(){
    const sel=document.getElementById('sel-overlay'); if(!sel) return;
    fillSelect();
    sel.onchange=()=>{ try{ set(sel.value); }catch(e){ CM.util.toast(e.message,'error',5000); sel.value=mode; } };
    if(I&&I.onChange) I.onChange(()=>{ fillSelect(); if(mode!=='lang') refresh(); });   // etykiety i legenda w nowym języku
  }

  // ---- wbudowane nakładki ----
  const fileNodes=(g)=>{ const out=[]; if(g&&g.nodes) for(const n of g.nodes.values()) if(n.type==='file') out.push(n); return out; };
  const byType=(n, fileColor)=>n.type==='folder'?FOLDER:(n.type==='file'?fileColor:NONE);
  register({id:'lang', order:0, label:()=>T('ov.lang','Język / typ pliku'), compute:()=>null});
  register({id:'complexity', order:10, label:()=>T('ov.complexity','Złożoność (mapa ciepła)'),
    available:(g)=>fileNodes(g).some(n=>n.metrics&&n.metrics.complexity>0),
    compute(g){
      const files=fileNodes(g).filter(n=>n.metrics); let max=1;
      for(const n of files) max=Math.max(max, n.metrics.complexity||0);
      const heat=ramp(HEAT), L=Math.log1p(max), col=new Map();
      for(const n of files) col.set(n.id, heat(Math.log1p(n.metrics.complexity||0)/L));
      return { colorOf:(n)=>byType(n, col.get(n.id)||NONE),
        legend:{gradient:{stops:HEAT, min:0, max}, note:T('ov.complexityNote','Skala logarytmiczna: rozgałęzienia (if/for/case/&&…) w pliku.')} };
    }});
  register({id:'mtime', order:40, label:()=>T('ov.mtime','Data modyfikacji pliku'),
    available:(g)=>{ const f=fileNodes(g); return f.length>0 && f.filter(n=>n.mtime).length>=f.length*0.5; },
    compute(g){
      const files=fileNodes(g).filter(n=>n.mtime); let lo=Infinity, hi=-Infinity;
      for(const n of files){ lo=Math.min(lo,n.mtime); hi=Math.max(hi,n.mtime); }
      const stops=['#1e293b','#1d4ed8','#22d3ee','#facc15'], r=ramp(stops), span=Math.max(1,hi-lo), col=new Map();
      for(const n of files) col.set(n.id, r((n.mtime-lo)/span));
      const d=(t)=>CM.util&&CM.util.fmtDate?CM.util.fmtDate(t).split(',')[0]:new Date(t).toISOString().slice(0,10);
      return { colorOf:(n)=>byType(n, col.get(n.id)||NONE), legend:{gradient:{stops, min:d(lo), max:d(hi)}, note:T('ov.mtimeNote','Czas ostatniej zmiany pliku na dysku (nie historia git).')} };
    }});

  return {register, set, reset, refresh, list, current, label, wire, fillSelect, ramp, mixHex, HEAT, PALETTE, NONE, FOLDER};
})();
