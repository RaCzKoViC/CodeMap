/* ===================== health-trend-ui.js — okno „Trend zdrowia" (faza 10) ===================== */
// Dla folderu wczytanego razem z .git: N commitów z historii (CM.HealthTrend — ta sama pętla co `codemap analyze
// --history N`), liczone w przeglądarce z paskiem postępu i anulowaniem; wykres wyniku w czasie (SVG), tabela punktów
// i reguły, które najbardziej urosły / spadły. Repozytorium z hostingu → podpowiedź CLI (drzewa przez API to setki
// zapytań). Pozycja w menu Projekt (po „Oś czasu") i akcja ChatBota `healthTrend`.
(function(){
  const A=CM.App, U=CM.util, el=U.el, I=CM.i18n, HT=CM.HealthTrend;
  const STR={
    pl:{'ht.menu':'Trend zdrowia (historia git)…','ht.title':'Trend zdrowia','ht.points':'Punkty','ht.run':'Policz trend','ht.again':'Policz ponownie',
      'ht.hint':'N commitów rozłożonych równo na historii (pierwszy rodzic HEAD); każde drzewo czytane z .git i analizowane jak folder — bez reguł historii git i pokrycia, więc punkty są porównywalne. Liczone w przeglądarce, nic nie wychodzi z komputera.',
      'ht.local':'Trend liczy się z lokalnego .git — wczytaj folder razem z katalogiem .git. Dla repozytorium z hostingu użyj CLI: codemap analyze . --history 10',
      'ht.progress':'Trend zdrowia: {i} / {n} — {sha} ({s})','ht.sum':'{n} z {c} commitów · zmiana: {a} → {b} ({d})','ht.rules':'Największe zmiany reguł: ','ht.none':'Brak commitów w historii.',
      'ht.date':'data','ht.commit':'commit','ht.score':'wynik','ht.files':'pliki','ht.high':'wys.','ht.med':'śr.','ht.low':'nis.','ht.msg':'opis','ht.cancelled':'Anulowano liczenie trendu.','ht.act':'Trend zdrowia: '},
    en:{'ht.menu':'Health trend (git history)…','ht.title':'Health trend','ht.points':'Points','ht.run':'Compute trend','ht.again':'Compute again',
      'ht.hint':'N commits spread evenly over the history (HEAD first parent); each tree is read from .git and analyzed like a folder — without git-history rules and coverage, so the points are comparable. Computed in the browser, nothing leaves your computer.',
      'ht.local':'The trend is computed from a local .git — load the folder together with its .git directory. For a hosted repository use the CLI: codemap analyze . --history 10',
      'ht.progress':'Health trend: {i} / {n} — {sha} ({s})','ht.sum':'{n} of {c} commits · change: {a} → {b} ({d})','ht.rules':'Largest changes per rule: ','ht.none':'No commits in the history.',
      'ht.date':'date','ht.commit':'commit','ht.score':'score','ht.files':'files','ht.high':'high','ht.med':'med','ht.low':'low','ht.msg':'message','ht.cancelled':'Health trend cancelled.','ht.act':'Health trend: '},
  };
  const t=(k,sub)=>{ const l=(I&&I.getLang&&I.getLang())==='en'?'en':'pl'; let s=(STR[l]&&STR[l][k])||STR.pl[k]||k; if(sub) for(const p in sub) s=s.split('{'+p+'}').join(sub[p]); return s; };
  const PILL=CM.UIKit.pill(I.t('ca.cancelLoad','Anuluj'), ()=>{ if(job) job.abort(); });
  let job=null, last=null, n=10;

  const local=()=>!!(A.state && A.state.side && ((A.state.side.git&&A.state.side.git.length) || A.state.side.gitEntry));
  const sign=(d)=>(d>0?'+':d<0?'−':'±')+Math.abs(d);

  // wykres: wynik 0–100 w kolejnych punktach (oś X = kolejność commitów), linia + punkty z opisem w <title>
  function chart(points){
    const W=640, H=180, P={l:34, r:12, t:12, b:26}, w=W-P.l-P.r, h=H-P.t-P.b, esc=U.escapeHtml;
    // oś Y dopasowana do danych (±5, wielokrotności 5, w granicach 0–100) — trend 44 → 55 nie jest płaską linią
    const sc=points.map(p=>p.score), lo=Math.max(0, Math.floor((Math.min(...sc)-5)/5)*5), hi=Math.min(100, Math.max(lo+10, Math.ceil((Math.max(...sc)+5)/5)*5));
    const x=(i)=>P.l+(points.length>1?i*w/(points.length-1):w/2), y=(s)=>P.t+h-((s-lo)/(hi-lo))*h;
    let g='';
    for(let k=0;k<=4;k++){ const v=Math.round(lo+(hi-lo)*k/4); g+=`<line x1="${P.l}" x2="${W-P.r}" y1="${y(v)}" y2="${y(v)}" class="ht-grid"/><text x="${P.l-6}" y="${y(v)+4}" class="ht-ax" text-anchor="end">${v}</text>`; }
    const path=points.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(p.score).toFixed(1)).join(' ');
    let dots='';
    points.forEach((p,i)=>{ dots+=`<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="4" class="ht-dot"><title>${esc((p.date||'')+' '+p.sha.slice(0,7)+' — '+p.score+'\n'+p.message)}</title></circle>`; });
    const lab=(i)=>`<text x="${x(i).toFixed(1)}" y="${H-8}" class="ht-ax" text-anchor="${i?'end':'start'}">${esc(points[i].date||'')}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="ht-svg" role="img" aria-label="${esc(t('ht.title'))}">${g}<path d="${path}" class="ht-line"/>${dots}${lab(0)}${points.length>1?lab(points.length-1):''}</svg>`;
  }

  function renderResult(dlg, h){
    const pts=h.points; if(!pts.length){ dlg.body.appendChild(el('div',{class:'muted',text:t('ht.none')})); return; }
    const a=pts[0], b=pts[pts.length-1];
    dlg.body.appendChild(el('div',{class:'ht-sum'}, el('b',{text:t('ht.sum',{n:pts.length, c:h.chain, a:a.score, b:b.score, d:sign(b.score-a.score)})})));
    dlg.body.appendChild(el('div',{class:'ht-chart', html:chart(pts)}));
    const rd=HT.ruleDeltas(pts, 8);
    if(rd.length) dlg.body.appendChild(el('div',{class:'muted small ht-rules', text:t('ht.rules')+rd.map(([r,x])=>r+' '+sign(x)).join(' · ')}));
    const tbl=el('table',{class:'ht-table'}, el('tr',{}, ...['ht.date','ht.commit','ht.score','ht.files','ht.high','ht.med','ht.low','ht.msg'].map(k=>el('th',{text:t(k)}))));
    for(const p of pts.slice().reverse()) tbl.appendChild(el('tr',{}, el('td',{text:p.date||''}), el('td',{}, el('code',{text:p.sha.slice(0,7)})), el('td',{}, el('b',{text:String(p.score)})),
      el('td',{text:String(p.files)}), el('td',{text:String(p.totals.high)}), el('td',{text:String(p.totals.med)}), el('td',{text:String(p.totals.low)}), el('td',{class:'ht-msg', title:p.message, text:p.message})));
    dlg.body.appendChild(el('div',{class:'ht-wrap'}, tbl));
  }

  async function compute(dlg){
    if(job) return null;
    const ctrl=new AbortController(); job=ctrl;
    try{
      await CM.Loaders.resolveSide(A.state.side);
      const repo=await CM.GitLocal.open(A.state.side.git);
      const h=await HT.compute(repo, {n, signal:ctrl.signal, tick:()=>new Promise(r=>setTimeout(r,0)),
        onPoint:(p,i,tot)=>PILL.show(t('ht.progress',{i, n:tot, sha:p.sha.slice(0,7), s:p.score}))});
      last={h, graph:A.graph};
      if(dlg) render(dlg);
      return h;
    }catch(e){
      if(e&&e.name==='AbortError'){ U.toast(t('ht.cancelled'),'',3000); return null; }
      U.toast((e&&e.message)||String(e),'error',7000); return null;
    }finally{ job=null; PILL.hide(); }
  }

  function render(dlg){
    dlg.clear();
    dlg.body.appendChild(el('div',{class:'muted small ht-hint', text:t('ht.hint')}));
    if(last && last.graph===A.graph) renderResult(dlg, last.h);          // wynik (policzony tu albo pokazany przez show)
    if(!local()){ dlg.body.appendChild(el('div',{class:'ht-local', text:t('ht.local')})); return; }
    const sel=el('select',{class:'share-select ht-n', onchange:()=>{ n=+sel.value; }});
    for(const v of [6,10,16,24]) sel.appendChild(el('option',{value:String(v), text:String(v)}));
    sel.value=String(n);
    dlg.foot.appendChild(el('label',{class:'muted small', text:t('ht.points')+': '})); dlg.foot.appendChild(sel);
    dlg.foot.appendChild(el('button',{class:'tb-btn primary', type:'button', text:last&&last.graph===A.graph?t('ht.again'):t('ht.run'), onclick:()=>compute(dlg)}));
  }

  function open(){
    if(!A.graph||!A.state||!A.state.counts||!A.state.counts.nodes) throw new Error(I.t('cb.noProject','Najpierw wczytaj projekt (CodeMap).'));
    const dlg=CM.UIKit.modal('modal-trend','share-modal ht-modal','ht').title(t('ht.title'));
    render(dlg); dlg.open(); return dlg;
  }

  function wire(){
    const after=document.getElementById('btn-timeline');
    if(after && !document.getElementById('btn-trend')){
      const b=el('button',{class:'menu-item', id:'btn-trend', type:'button', 'data-ic':'flow', text:t('ht.menu'),
        onclick:()=>{ document.querySelectorAll('.menu-panel').forEach(p=>p.classList.remove('open')); try{ open(); }catch(e){ U.toast(e.message,'error'); } }});
      after.parentNode.insertBefore(b, after.nextSibling); if(CM.icons&&CM.icons.hydrate) CM.icons.hydrate(b.parentNode);
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wire); else setTimeout(wire, 0);

  if(A.registerAction) A.registerAction({name:'healthTrend', sig:'{n?}',
    desc:'compute the health-score trend over git history (local .git only): N commits spread over the first-parent history, analyzed like the folder; opens a chart and returns the first → last change',
    descPl:'Trend zdrowia w historii git (lokalny .git) — wykres i zmiana wyniku', auto:false,
    run:async(a)=>{ if(a&&a.n) n=Math.max(2,Math.min(40,+a.n||10)); const dlg=open(); if(!local()) return t('ht.local');
      const h=await compute(dlg); if(!h||!h.points.length) return t('ht.none');
      const p=h.points, d=p[p.length-1].score-p[0].score; return t('ht.act')+t('ht.sum',{n:p.length, c:h.chain, a:p[0].score, b:p[p.length-1].score, d:sign(d)}); }});
  // gotowy wynik (np. z raportu CLI --history --json) — to samo okno z wykresem
  function show(h){ last={h, graph:A.graph}; return open(); }
  CM.HealthTrendUI={open, show, compute:()=>compute(null), last:()=>last};
})();
