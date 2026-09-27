/* ===================== tour-ui.js — odtwarzacz tras po kodzie (tour.js) ===================== */
// Projekt → „Trasa po kodzie…": trasa automatyczna ze struktury albo ułożona przez model (tylko struktura — działa
// też z modelem w chmurze), import / eksport CodeTour (.tour z VS Code), link #tour=… (sam albo doklejony do #repo= /
// #gist= / #share=). Odtwarzacz: karta „krok i z n" z notatką na dole mapy, ← / → / Esc, kamera na pliku, ponumerowane
// kroki i strzałki między nimi na mapie (dekorator — działa też przy rysowaniu na GPU). Trasa zapisuje się w mapie.
(function(){
  const A=CM.App, U=CM.util, $=U.$, el=U.el, I=CM.i18n, TR=CM.Tour;
  const STR={
    pl:{'tour.menu':'Trasa po kodzie…','tour.title':'Trasa po kodzie','tour.desc':'Uporządkowana ścieżka po plikach z notatkami — dla nowej osoby w projekcie albo do przeglądu. Zapisuje się razem z mapą; linkiem można się nią podzielić.',
      'tour.auto':'Utwórz automatycznie','tour.ai':'Ułóż z AI','tour.import':'Importuj .tour','tour.start':'▶ Start','tour.export':'Eksport .tour (VS Code CodeTour)','tour.link':'🔗 Kopiuj link do trasy',
      'tour.none':'Brak trasy — utwórz automatycznie albo z AI.','tour.step':'Krok {i} z {n}','tour.prev':'Poprzedni (←)','tour.next':'Następny (→)','tour.close':'Zakończ trasę (Esc)',
      'tour.aiWait':'Model układa trasę…','tour.aiFail':'Model nie zwrócił poprawnej trasy — użyto trasy automatycznej.','tour.dropped':'Pominięto kroki bez pliku na mapie: ','tour.noProject':'Najpierw wczytaj projekt.',
      'tour.linkOther':'Trasa z linku nie pasuje do wczytanej mapy (brak jej plików).','tour.copied':'Skopiowano link do trasy.','tour.badFile':'To nie jest plik trasy (.tour / JSON).','tour.done':'Koniec trasy.','tour.edit':'Notatka kroku'},
    en:{'tour.menu':'Code tour…','tour.title':'Code tour','tour.desc':'An ordered path through the files with notes — for someone new to the project or for a review. Saved with the map; share it with a link.',
      'tour.auto':'Create automatically','tour.ai':'Plan with AI','tour.import':'Import .tour','tour.start':'▶ Start','tour.export':'Export .tour (VS Code CodeTour)','tour.link':'🔗 Copy tour link',
      'tour.none':'No tour yet — create one automatically or with AI.','tour.step':'Step {i} of {n}','tour.prev':'Previous (←)','tour.next':'Next (→)','tour.close':'End tour (Esc)',
      'tour.aiWait':'The model is planning the tour…','tour.aiFail':'The model did not return a valid tour — using the automatic one.','tour.dropped':'Skipped steps without a file on the map: ','tour.noProject':'Load a project first.',
      'tour.linkOther':'The tour from the link does not match the loaded map (its files are missing).','tour.copied':'Tour link copied.','tour.badFile':'This is not a tour file (.tour / JSON).','tour.done':'End of the tour.','tour.edit':'Step note'}};
  I.extend('pl', STR.pl); I.extend('en', STR.en);
  const t=(k)=>I.t(k, STR.pl[k]);
  const P={on:false, i:0};
  const tour=()=>A.graph&&A.graph.tour||null;
  const nodeOf=(s)=>A.graph && (A.graph.nodes.get(s.path) || [...A.graph.nodes.values()].find(n=>n.type==='file'&&n.path===s.path));

  // ---------------- trasa na mapie ----------------
  function setTour(raw, o){
    o=o||{}; if(!A.graph || !A.state.counts.nodes){ U.toast(t('tour.noProject'),'error'); return null; }
    const v=TR.validate(A.graph, raw); if(!v){ if(o.quietFail!==true) U.toast(o.failMsg||t('tour.linkOther'),'error',6000); return null; }
    if(v.dropped) U.toast(t('tour.dropped')+v.dropped,'',4500);
    A.graph.tour={title:v.title, steps:v.steps, source:v.source||raw.source||''};
    if(A.saveSessionDebounced) A.saveSessionDebounced();
    renderModal();
    if(o.start) play(0);
    return A.graph.tour;
  }
  function play(i){
    const tr=tour(); if(!tr || !tr.steps.length) return;
    P.on=true; P.i=Math.max(0, Math.min(tr.steps.length-1, i));
    const s=tr.steps[P.i], n=nodeOf(s);
    if(n && window.CMApp && CMApp.focusNode) CMApp.focusNode(n.id);
    const ids=new Set(tr.steps.map(x=>{ const m=nodeOf(x); return m&&m.id; }).filter(Boolean));
    if(A.renderer) A.renderer.setHighlight(ids);
    renderCard(); if(A.renderer) A.renderer.kick();
  }
  function stop(){ P.on=false; const c=$('#tour-card'); if(c) c.remove(); document.body.classList.remove('tour-on'); if(A.renderer){ A.renderer.setHighlight(null); A.renderer.kick(); } }
  const next=()=>{ const tr=tour(); if(!tr) return; if(P.i>=tr.steps.length-1){ U.toast(t('tour.done'),'',2000); stop(); } else play(P.i+1); };
  const prev=()=>play(P.i-1);

  function renderCard(){
    const tr=tour(); if(!tr) return; let c=$('#tour-card');
    if(!c){ c=el('div',{id:'tour-card', class:'tour-card', role:'dialog', 'aria-live':'polite'}); document.body.appendChild(c); }
    document.body.classList.add('tour-on');   // komunikaty (toast) wyżej — nie zasłaniają karty
    const s=tr.steps[P.i], n=nodeOf(s);
    c.innerHTML='';
    const head=el('div',{class:'tour-head'});
    head.appendChild(el('span',{class:'tour-title', text:'🧭 '+tr.title}));
    head.appendChild(el('span',{class:'tour-count', text:t('tour.step').replace('{i}', P.i+1).replace('{n}', tr.steps.length)}));
    head.appendChild(el('button',{class:'tour-x', type:'button', title:t('tour.close'), text:'✕', onclick:stop}));
    c.appendChild(head);
    const file=el('button',{class:'tour-file', type:'button', title:s.path+(s.line>1?':'+s.line:''), text:s.path+(s.line>1?':'+s.line:''),
      onclick:()=>{ if(n && A.handlers && A.handlers.openFile){ A.handlers.openFile(n); if(s.line>1 && CM.UI && CM.UI.revealLines) setTimeout(()=>CM.UI.revealLines(s.line, s.line+12), 60); } }});
    c.appendChild(file);
    c.appendChild(el('div',{class:'tour-note', text:s.note||'—'}));
    const dots=el('div',{class:'tour-dots'});
    tr.steps.forEach((x, k)=>dots.appendChild(el('button',{class:'tour-dot'+(k===P.i?' on':''), type:'button', title:(k+1)+'. '+x.path, onclick:()=>play(k)})));
    const nav=el('div',{class:'tour-nav'});
    nav.appendChild(el('button',{class:'tb-btn', type:'button', text:'◀', title:t('tour.prev'), disabled:P.i===0?'':null, onclick:prev}));
    nav.appendChild(dots);
    nav.appendChild(el('button',{class:'tb-btn primary', type:'button', text:P.i===tr.steps.length-1?'✓':'▶', title:t('tour.next'), onclick:next}));
    c.appendChild(nav);
  }
  // ponumerowane kroki i strzałki między nimi (ekran, nad figurami)
  function decorator(ctx, R){
    const tr=tour(); if(!P.on || !tr) return;
    const pts=tr.steps.map(s=>{ const n=nodeOf(s); if(!n || !R.nodeById.has(n.id)) return null; const sp=R.cam.toScreen(n.x, n.y, R.w, R.h); return {x:sp.x, y:sp.y, r:n.r*R.opts.nodeScale*R.cam.zoom}; });
    ctx.save(); ctx.lineWidth=2; ctx.setLineDash([6,5]); ctx.strokeStyle='rgba(250,204,21,.8)'; ctx.fillStyle='rgba(250,204,21,.85)';
    for(let k=1;k<pts.length;k++){ const a=pts[k-1], b=pts[k]; if(!a||!b) continue;
      const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy); if(L<1) continue; const ux=dx/L, uy=dy/L;
      const x0=a.x+ux*(a.r+10), y0=a.y+uy*(a.r+10), x1=b.x-ux*(b.r+12), y1=b.y-uy*(b.r+12);
      ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x1-ux*9-uy*5, y1-uy*9+ux*5); ctx.lineTo(x1-ux*9+uy*5, y1-uy*9-ux*5); ctx.closePath(); ctx.fill(); }
    ctx.setLineDash([]); ctx.font='700 11px Inter, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    pts.forEach((p, k)=>{ if(!p) return; const x=p.x+p.r*0.75+8, y=p.y-p.r*0.75-8, cur=k===P.i;
      ctx.beginPath(); ctx.arc(x, y, cur?11:9, 0, 6.2832); ctx.fillStyle=cur?'#facc15':'rgba(15,23,42,.92)'; ctx.fill();
      ctx.lineWidth=1.5; ctx.strokeStyle='#facc15'; ctx.stroke(); ctx.fillStyle=cur?'#0f172a':'#facc15'; ctx.fillText(String(k+1), x, y+0.5); });
    ctx.restore();
  }

  // ---------------- tworzenie: automatycznie / AI / import ----------------
  function makeAuto(start){ if(!A.graph||!A.state.counts.nodes){ U.toast(t('tour.noProject'),'error'); return null; } return setTour(TR.auto(A.graph, {lang:I.getLang()}), {start}); }
  async function makeAI(start){
    if(!A.graph||!A.state.counts.nodes){ U.toast(t('tour.noProject'),'error'); return null; }
    A.aiGuard();
    const busy=$('#tour-body .tour-busy'); if(busy) busy.textContent=t('tour.aiWait');
    let j=null; try{ j=TR.parse(await A.aiChat(TR.prompt(A.graph, I.getLang()), {temperature:0.3, maxTokens:1400})); }catch(e){ if(busy) busy.textContent=''; throw e; }
    if(busy) busy.textContent='';
    const v=j && TR.validate(A.graph, j);
    if(!v || v.steps.length<3){ U.toast(t('tour.aiFail'),'',5000); return makeAuto(start); }
    return setTour(Object.assign(j, {source:'ai'}), {start});
  }
  function importFile(file){
    const r=new FileReader();
    r.onload=()=>{ let j=null; try{ j=JSON.parse(String(r.result||'')); }catch(e){ /* nie JSON → komunikat niżej */ }
      const tr=j && (Array.isArray(j.steps) && j.steps.length && j.steps[0].file ? TR.fromCodeTour(j) : j);
      if(!tr || !Array.isArray(tr.steps)){ U.toast(t('tour.badFile'),'error'); return; }
      setTour(tr, {start:true}); };
    r.readAsText(file);
  }
  function exportTour(){ const tr=tour(); if(!tr) return;
    const name=String((A.graph.meta&&A.graph.meta.name)||'codemap').replace(/[^\w.-]+/g,'-').slice(0,60)||'codemap';
    U.download(name+'.tour', JSON.stringify(TR.toCodeTour(tr), null, 2)); }
  // link: źródło mapy z repozytorium (jak w pr.js) albo sam #tour= (dla mapy wczytanej u odbiorcy)
  async function link(){ const tr=tour(); if(!tr) return '';
    const m=A.graph.meta||{}; let h='';
    if(m.repo && /^(github|gitlab|bitbucket)$/.test(m.host||m.kind||'')){ const src=(m.host||m.kind)==='github'?m.repo:({gitlab:'gitlab.com/', bitbucket:'bitbucket.org/'}[m.host||m.kind]||'')+m.repo;
      h='#repo='+src+(m.branch?'&branch='+encodeURIComponent(m.branch):'')+(m.sub?'&path='+encodeURIComponent(m.sub):'')+'&tour='; }
    else h='#tour=';
    return location.origin+location.pathname+h+(await TR.encode(tr)); }
  async function copyLink(){ const url=await link(); if(!url) return; try{ await navigator.clipboard.writeText(url); U.toast(t('tour.copied'),'success',2200); }catch(e){ U.toast(url.slice(0,300),'',8000); } return url; }
  // z deep-linku (links.js / start aplikacji): zakodowana trasa → na bieżącą mapę i start
  async function openEncoded(str){ const tr=await TR.decode(str); if(!tr){ U.toast(t('tour.linkOther'),'error'); return false; } return !!setTour(tr, {start:true}); }

  // ---------------- okno ----------------
  const dlg=()=>CM.UIKit.modal('modal-tour','share-modal','tour');
  function renderModal(){
    const body=$('#tour-body'), foot=$('#tour-foot'); if(!body || $('#modal-tour').classList.contains('hidden')) return;
    body.innerHTML=''; foot.innerHTML='';
    body.appendChild(el('p',{class:'muted small', text:t('tour.desc')}));
    const row=el('div',{class:'tour-actions'});
    row.appendChild(el('button',{class:'tb-btn', type:'button', text:t('tour.auto'), onclick:()=>makeAuto(false)}));
    row.appendChild(el('button',{class:'tb-btn', type:'button', text:'✨ '+t('tour.ai'), onclick:()=>makeAI(false).catch(e=>U.toast(e.message,'error',6000))}));
    const inp=el('input',{type:'file', accept:'.tour,.json,application/json', class:'hidden', onchange:(e)=>{ const f=e.target.files[0]; e.target.value=''; if(f) importFile(f); }});
    row.appendChild(el('button',{class:'tb-btn', type:'button', text:t('tour.import'), onclick:()=>inp.click()})); row.appendChild(inp);
    body.appendChild(row); body.appendChild(el('div',{class:'muted small tour-busy'}));
    const tr=tour();
    if(!tr){ body.appendChild(el('p',{class:'muted', text:t('tour.none')})); return; }
    body.appendChild(el('h4',{class:'tour-h', text:'🧭 '+tr.title}));
    const ol=el('ol',{class:'tour-list'});
    tr.steps.forEach((s, k)=>{ const li=el('li',{});
      li.appendChild(el('button',{class:'tour-file', type:'button', text:s.path, onclick:()=>{ dlg().close(); play(k); }}));
      const note=el('div',{class:'tour-note', contenteditable:'true', spellcheck:'false', title:t('tour.edit'), text:s.note||''});
      note.addEventListener('blur', ()=>{ const v=note.textContent.replace(/\s+/g,' ').trim().slice(0, 400); if(v!==s.note){ s.note=v; if(A.saveSessionDebounced) A.saveSessionDebounced(); } });
      li.appendChild(note); ol.appendChild(li); });
    body.appendChild(ol);
    foot.appendChild(el('button',{class:'tb-btn', type:'button', text:t('tour.export'), onclick:exportTour}));
    foot.appendChild(el('button',{class:'tb-btn', type:'button', text:t('tour.link'), onclick:copyLink}));
    foot.appendChild(el('button',{class:'tb-btn primary', type:'button', text:t('tour.start'), onclick:()=>{ dlg().close(); play(0); }}));
  }
  function openDialog(){ const d=dlg(); $('#tour-title').textContent='🧭 '+t('tour.title'); d.open(); renderModal(); }

  // ---------------- okablowanie ----------------
  function wire(){
    if(!A.renderer){ setTimeout(wire, 40); return; }
    if(!A.renderer.decorators.includes(decorator)) A.renderer.decorators.push(decorator);
    const b=$('#btn-tour'); if(b) b.onclick=()=>{ document.querySelectorAll('.menu-panel').forEach(p=>p.classList.remove('open')); openDialog(); };
    document.addEventListener('keydown', (e)=>{
      if(!P.on || e.altKey || e.ctrlKey || e.metaKey) return;
      const tg=e.target, typing=tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName));
      if(typing) return;
      if(e.key==='ArrowRight'){ e.preventDefault(); next(); } else if(e.key==='ArrowLeft'){ e.preventDefault(); prev(); } else if(e.key==='Escape') stop();
    });
    // #tour=… samo (bez źródła mapy): po przywróceniu sesji — trasa na bieżącą mapę
    if(/^#tour=/.test(location.hash)) setTimeout(()=>{ if(A.openDeepLink) A.openDeepLink(location.hash).catch(()=>{}); }, 1500);
  }
  A.onProjectLoaded(()=>{ if(P.on) stop(); });
  if(A.registerAction) A.registerAction({name:'codeTour', sig:'{action?:"start"|"auto"|"ai"|"next"|"prev"|"stop"|"open"}',
    desc:'code tour (onboarding): an ordered path through the files with notes — create automatically or with AI, play it on the map, next/prev/stop',
    descPl:'trasa po kodzie — utwórz (automatycznie / AI), odtwórz na mapie, dalej / wstecz / zakończ', auto:true,
    run:async(a)=>{ const act=String((a&&a.action)||'start').toLowerCase();
      if(act==='open'){ openDialog(); return t('tour.title'); }
      if(act==='stop'){ stop(); return '✓'; }
      if(act==='next'||act==='prev'){ if(!P.on) play(0); else if(act==='next') next(); else prev(); return P.on?t('tour.step').replace('{i}', P.i+1).replace('{n}', tour().steps.length):'✓'; }
      let tr=act==='ai'?await makeAI(true):act==='auto'?makeAuto(true):(tour()?(play(0), tour()):makeAuto(true));
      if(!tr) throw new Error(t('tour.noProject'));
      return '🧭 '+tr.title+' — '+tr.steps.length+' '+(I.getLang()==='en'?'steps':'kroków')+': '+tr.steps.map(s=>s.path).join(' → '); }});
  CM.TourUI={setTour, play, stop, next, prev, makeAuto, makeAI, exportTour, link, copyLink, openEncoded, openDialog, state:()=>({on:P.on, i:P.i, tour:tour()})};
  setTimeout(wire, 0);
})();
