/* ===================== pr.js — mapa wpływu PR (faza 5) ===================== */
// Pull / merge request z repozytorium wczytanego z GitHub / GitLab / Bitbucket: zmienione pliki (API hostingu,
// CM.GitRemote.fetchPR), pliki od nich zależne (odwrotny BFS po importach) i ocena ryzyka każdego pliku
// (CM.PRCore: częstość zmian, złożoność, zależni, testy/pokrycie, rozmiar zmiany, znajomość pliku przez autora).
// UI: okno „Przegląd PR…", nakładka „Wpływ PR" z legendą, znaczniki A/M/D/R na węzłach, sekcje panelu szczegółów,
// raport Markdown (jak komentarz CLI/Action), link #repo=…&pr=N, akcje ChatBota prReview / prRisk.
(function(){
  const A=CM.App, U=CM.util, $=U.$, el=U.el, I=CM.i18n, P=CM.PRCore, OV=CM.Overlays;
  const state=A.state, T=(k,f)=>I.t(k,f);

  I.extend('pl', {'project.pr':'Przegląd PR — mapa wpływu…'});
  I.extend('en', {'project.pr':'PR review — impact map…',
    'pr.title':'PR review — impact map','pr.input':'Pull / merge request number or URL','pr.hint':'The map shows the files changed in the PR, the files that depend on them and the risk of each change (change frequency, complexity, dependents, tests, change size, author familiarity). Git history and test coverage make the risk more accurate.',
    'pr.go':'Analyse','pr.cancel':'Cancel','pr.loading':'Fetching PR #','pr.needRepo':'The PR impact map needs a repository loaded from GitHub / GitLab / Bitbucket (Load → repository, or a #repo= link).',
    'pr.bad':'Enter a PR number (e.g. 42) or its URL.','pr.otherRepo':'This PR belongs to another repository — load it and analyse the PR?','pr.fail':'PR: ',
    'pr.done':'PR #','pr.doneRisk':' — risk ','pr.doneFiles':', files: ','pr.doneDeps':', dependents: ','pr.section':'Pull request','pr.risk':'risk',
    'pr.lvl.high':'high','pr.lvl.med':'medium','pr.lvl.low':'low','pr.files':'files','pr.deps':'dependents','pr.direct':'direct','pr.outside':'not on the map (new or skipped)',
    'pr.author':'Author','pr.reviewers':'Suggested reviewers','pr.top':'Riskiest changes','pr.copyMd':'Copy report (Markdown)','pr.copyLink':'Copy map link',
    'pr.addGit':'Add git history (more accurate risk)','pr.clear':'Clear','pr.open':'Open on host','pr.copied':'Copied.','pr.changedFile':'Changed in PR #',
    'pr.dependsOn':'Depends on files changed in PR #','pr.distance':'distance','pr.p.churn':'changes often','pr.p.complexity':'complexity','pr.p.dependents':'dependents',
    'pr.p.tests':'weak tests','pr.p.size':'change size','pr.p.familiarity':'new area for the author','ov.pr':'PR impact','ov.prChanged':'changed',
    'ov.prDirect':'direct dependents','ov.prIndirect':'indirect dependents','ov.prNote':'Changed files coloured by risk (0–100); orange — files that import them.',
    'pr.needRun':'Run a PR review first (Project → PR review).','cb.prRun':'Analysing PR #','cb.prNone':'No PR analysed — use prReview {pr}.'});

  // ---------------- postęp i anulowanie ----------------
  let job=null;
  const PILL=CM.UIKit.pill(T('pr.cancel','Anuluj'), ()=>cancel());
  const pill=(t)=>PILL.show(t), hidePill=()=>PILL.hide();
  function cancel(){ if(job){ try{ job.ctrl.abort(); }catch(e){} job=null; } hidePill(); }
  const tokenFor=CM.UIKit.repoToken;
  function stripSub(files, sub){
    const P0=String(sub||'').replace(/^\/+|\/+$/g,''); if(!P0) return files; const pre=P0+'/';
    const cut=(p)=>p&&p.startsWith(pre)?p.slice(pre.length):null;
    return files.map(f=>{ const p=cut(f.path); if(p==null) return null; const g=Object.assign({}, f, {path:p}); if(f.from!=null){ const fr=cut(f.from); if(fr==null){ delete g.from; if(g.status==='R') g.status='A'; } else g.from=fr; } return g; }).filter(Boolean);
  }

  // ---------------- analiza ----------------
  async function run(ref){
    const g=A.graph; if(!g || !state.counts.nodes){ U.toast(T('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return null; }
    const pr=P.parsePR(ref); if(!pr){ U.toast(T('pr.bad','Podaj numer PR (np. 42) albo jego adres.'),'error'); return null; }
    const meta=g.meta||{};
    if(pr.host && (pr.host!==meta.host || pr.repo.toLowerCase()!==String(meta.repo||'').toLowerCase())){
      if(!confirm(T('pr.otherRepo','Ten PR należy do innego repozytorium — wczytać je i przeanalizować PR?'))) return null;
      const url={github:'https://github.com/', gitlab:'https://gitlab.com/', bitbucket:'https://bitbucket.org/'}[pr.host]+pr.repo;
      const ok=await A.ingest((p,s)=>CM.Loaders.fromRepoURL(url, {fetchContent:true}, p, s), T('ca.connectingToRepo','Łączenie z repozytorium…'));
      return ok ? run(pr.number) : null;
    }
    if(!CM.GitRemote || !CM.GitRemote.supported(meta)){ U.toast(T('pr.needRepo','Mapa wpływu PR wymaga repozytorium wczytanego z GitHub / GitLab / Bitbucket (Wczytaj → repozytorium albo link #repo=).'),'error',8000); return null; }
    cancel(); const ctrl=new AbortController(), my=job={ctrl};
    pill(T('pr.loading','Pobieranie PR #')+pr.number+'…');
    try{
      const r=await CM.GitRemote.fetchPR(meta, pr.number, {token:tokenFor(), signal:ctrl.signal});
      if(job!==my || g!==A.graph) return null;
      const info=apply(g, r.pr, stripSub(r.files, meta.sub), {truncated:!!r.truncated});
      U.toast(T('pr.done','PR #')+info.number+T('pr.doneRisk',' — ryzyko ')+levelText(info.level)+' ('+info.risk+'/100)'
        +T('pr.doneFiles',', plików: ')+(info.changed.length+info.outside.length)+T('pr.doneDeps',', zależnych: ')+info.impacted.length, info.level==='high'?'error':'success', 7000);
      return info;
    }catch(e){ if(e&&(e.code==='cancelled'||e.name==='AbortError')) return null; U.toast(T('pr.fail','PR: ')+((e&&e.message)||e),'error',8000); return null; }
    finally{ if(job===my){ job=null; hidePill(); } }
  }
  // wynik → graph.prInfo (zapisywany w mapie), widok z nakładką „Wpływ PR"
  function apply(g, pr, files, extra){
    const res=P.analyze(g, files, pr);
    g.prInfo={number:pr.number, title:pr.title||'', url:pr.url||'', state:pr.state||'', draft:!!pr.draft, author:pr.author||{}, base:pr.base||'', head:pr.head||'',
      risk:res.risk, level:res.level, changed:res.changed, outside:res.outside, impacted:[...res.impacted.entries()], direct:res.direct,
      reviewers:res.reviewers, add:res.add, del:res.del, files, truncated:!!(extra&&extra.truncated), at:Date.now()};
    A.refreshView();
    try{ OV.set('pr'); }catch(e){}
    return g.prInfo;
  }
  // historia git doszła (albo zmieniła się) → przelicz ryzyko tego samego PR
  document.addEventListener('codemap:git', ()=>{ const g=A.graph, pi=g&&g.prInfo; if(pi&&pi.files) apply(g, pi, pi.files, pi); });
  function clear(){ const g=A.graph; if(g&&g.prInfo){ delete g.prInfo; A.refreshView(); if(OV.current()==='pr') OV.set('lang'); } }
  const levelText=(l)=>T('pr.lvl.'+l, {high:'wysokie', med:'średnie', low:'niskie'}[l]||l);
  const LEVEL_COL={high:'#ef4444', med:'#f97316', low:'#34d399'};
  function markdown(g, lang){ const pi=g.prInfo; if(!pi) return '';
    const res=Object.assign({}, pi, {impacted:new Map(pi.impacted)});
    return P.summaryMarkdown(res, {number:pi.number, title:pi.title}, {lang:lang||I.getLang(), link:mapLink(g)}); }
  // link #repo=…&branch=…&path=…&pr=N (GitHub: skrót owner/nazwa, pozostałe: host/ścieżka)
  function mapLink(g){ const m=g.meta||{}, pi=g.prInfo; if(!m.repo||!pi) return '';
    const src=m.host==='github'?m.repo:({gitlab:'gitlab.com/', bitbucket:'bitbucket.org/'}[m.host]||'')+m.repo;
    let h='#repo='+src; if(m.branch) h+='&branch='+encodeURIComponent(m.branch); if(m.sub) h+='&path='+encodeURIComponent(m.sub);
    return location.origin+location.pathname+h+'&pr='+pi.number; }
  async function copy(text){ try{ await navigator.clipboard.writeText(text); U.toast(T('pr.copied','Skopiowano.'),'success',2000); }catch(e){ U.toast(text.slice(0,300),'',8000); } }

  // ---------------- okno „Przegląd PR…" ----------------
  const dlg=()=>CM.UIKit.modal('modal-pr','share-modal','pr');
  function closeModal(){ dlg().close(); }
  function openDialog(){
    if(!state.counts.nodes){ U.toast(T('ca.loadFirst','Najpierw wczytaj projekt.'),'error'); return; }
    const m=dlg().clear();
    m.title(T('pr.title','Przegląd PR — mapa wpływu'));
    const body=m.body, foot=m.foot;
    const inp=el('input',{type:'text',id:'pr-input',autocomplete:'off',spellcheck:'false',placeholder:'42 · https://github.com/owner/repo/pull/42'});
    if(A.graph.prInfo) inp.value=String(A.graph.prInfo.number);
    body.appendChild(el('label',{class:'field-label','for':'pr-input',text:T('pr.input','Numer albo adres pull / merge requesta')}));
    body.appendChild(inp);
    body.appendChild(el('p',{class:'share-warn',text:T('pr.hint','Mapa pokaże pliki zmienione w PR, pliki od nich zależne i ryzyko każdej zmiany (częstość zmian, złożoność, zależni, testy, rozmiar zmiany, znajomość pliku przez autora). Historia git i pokrycie testami zwiększają dokładność.')}));
    const go=el('button',{class:'tb-btn primary',type:'button',text:T('pr.go','Analizuj')});
    foot.appendChild(el('button',{class:'tb-btn',type:'button',text:T('pr.cancel','Anuluj'),onclick:closeModal})); foot.appendChild(go);
    const submit=()=>{ const v=inp.value.trim(); if(!v) return; closeModal(); run(v); };
    go.onclick=submit; inp.onkeydown=(e)=>{ if(e.key==='Enter') submit(); };
    m.open(); setTimeout(()=>inp.focus(),30);
  }

  // ---------------- nakładka i znaczniki ----------------
  const RISK=['#34d399','#facc15','#f97316','#ef4444'];
  OV.register({id:'pr', order:30, label:()=>T('ov.pr','Wpływ PR'), available:(g)=>!!(g&&g.prInfo),
    unavailable:()=>T('pr.needRun','Najpierw uruchom przegląd PR (Projekt → Przegląd PR).'),
    compute(g){
      const pi=g.prInfo, risk=new Map(pi.changed.map(c=>[c.id,c.risk])), imp=new Map(pi.impacted), r=OV.ramp(RISK);
      const direct=new Set(), indirect=new Set(); for(const [id,d] of imp){ if(risk.has(id)) continue; (d===1?direct:indirect).add(id); }
      return {colorOf:(n)=>risk.has(n.id)?r(risk.get(n.id)/100):direct.has(n.id)?'#fdba74':indirect.has(n.id)?'#8a6a4a':(n.type==='folder'?OV.FOLDER:OV.NONE),
        legend:{title:'PR #'+pi.number+(pi.title?(' — '+pi.title):''), gradient:{stops:RISK, min:0, max:100},
          items:[{color:r(pi.risk/100), label:T('ov.prChanged','zmienione'), count:risk.size, ids:new Set(risk.keys())},
            {color:'#fdba74', label:T('ov.prDirect','zależne bezpośrednio'), count:direct.size, ids:direct},
            {color:'#8a6a4a', label:T('ov.prIndirect','zależne pośrednio'), count:indirect.size, ids:indirect}],
          note:T('ov.prNote','Zmienione pliki w kolorze ryzyka (0–100); pomarańczowe — pliki, które je importują.')}};
    }});
  const ST_COL={A:'#34d399', M:'#facc15', D:'#f87171', R:'#a78bfa'};
  function prDecorator(ctx, R){
    const g=A.graph, pi=g&&g.prInfo; if(!pi || OV.current()!=='pr') return;
    const st=new Map(pi.changed.map(c=>[c.id,c.status])), z=R.cam.zoom, sc=R.opts.nodeScale, W=R.w, H=R.h;
    for(const n of R.nodes){ const s=st.get(n.id); if(!s) continue;
      const rPx=n.r*sc*z; if(rPx<6) continue; const sp=R.cam.toScreen(n.x,n.y,W,H); if(sp.x<-20||sp.x>W+20||sp.y<-20||sp.y>H+20) continue;
      const x=sp.x-rPx*0.72, y=sp.y-rPx*0.72, rr=Math.max(6,Math.min(11,rPx*0.36));
      ctx.beginPath(); ctx.arc(x,y,rr,0,6.2832); ctx.fillStyle=ST_COL[s]||'#94a3b8'; ctx.fill(); ctx.strokeStyle='rgba(8,18,30,.85)'; ctx.lineWidth=1.4; ctx.stroke();
      ctx.fillStyle='#05080e'; ctx.font='800 '+Math.round(rr*1.15)+'px system-ui,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(s, x, y+0.5); }
  }

  // ---------------- panel szczegółów ----------------
  const PART_ORDER=['churn','complexity','dependents','tests','size','familiarity'];
  function partBars(parts){ const box=el('div',{class:'git-authors'});
    for(const k of PART_ORDER){ if(parts[k]==null) continue; const v=parts[k];
      box.appendChild(el('div',{class:'bar-row'}, el('span',{class:'bl',text:T('pr.p.'+k,{churn:'częste zmiany', complexity:'złożoność', dependents:'zależni', tests:'słabe testy', size:'rozmiar zmiany', familiarity:'nowy obszar autora'}[k])}),
        el('div',{class:'bar-track'}, el('div',{class:'bar-fill',style:'width:'+Math.max(3,Math.round(v*100))+'%;background:'+OV.ramp(RISK)(v)})),
        el('span',{class:'bv',text:Math.round(v*100)+'%'}))); }
    return box; }
  function riskTag(level, risk){ return el('span',{class:'tag pr-risk',style:'border-color:'+LEVEL_COL[level]+';color:'+LEVEL_COL[level],text:T('pr.risk','ryzyko')+' '+levelText(level)+' · '+risk}); }
  function projectCard(g){
    const pi=g.prInfo; if(!pi) return null;
    const sec=el('div',{class:'det-section git-card pr-card'});
    const h=el('h5',{}, T('pr.section','Pull request'), el('span',{class:'muted git-src',text:'#'+pi.number})); sec.appendChild(h);
    if(pi.title) sec.appendChild(el('div',{class:'pr-title',text:pi.title+(pi.draft?' (draft)':'')}));
    const tags=el('div',{});
    tags.appendChild(riskTag(pi.level, pi.risk));
    tags.appendChild(el('span',{class:'tag',text:(pi.changed.length+pi.outside.length)+' '+T('pr.files','plików')+' · +'+pi.add+' / −'+pi.del}));
    tags.appendChild(el('span',{class:'tag',text:pi.impacted.filter(([id])=>!pi.changed.some(c=>c.id===id)).length+' '+T('pr.deps','zależnych')+' ('+pi.direct+' '+T('pr.direct','bezpośr.')+')'}));
    if(pi.outside.length) tags.appendChild(el('span',{class:'tag',title:pi.outside.map(o=>o.path).join('\n'),text:pi.outside.length+' '+T('pr.outside','spoza mapy (nowe albo pominięte)')}));
    sec.appendChild(tags);
    if(pi.author&&(pi.author.login||pi.author.name)) sec.appendChild(el('div',{class:'git-owner'}, el('span',{class:'muted small',text:T('pr.author','Autor')+': '}), el('b',{text:pi.author.login?('@'+pi.author.login):pi.author.name}), pi.base?el('span',{class:'muted small',text:'  '+pi.head+' → '+pi.base}):null));
    if(pi.reviewers.length) sec.appendChild(el('div',{class:'git-owner'}, el('span',{class:'muted small',text:T('pr.reviewers','Sugerowani recenzenci')+': '}), el('b',{text:pi.reviewers.slice(0,3).map(r=>r.login?('@'+r.login):r.name).join(', ')})));
    if(pi.changed.length){ sec.appendChild(el('div',{class:'muted small pr-sub',text:T('pr.top','Najbardziej ryzykowne zmiany')}));
      const list=el('div',{class:'git-authors'});
      for(const c of pi.changed.slice(0,6)) list.appendChild(el('div',{class:'bar-row pr-file',title:c.path,onclick:()=>A.focusNode(c.id)},
        el('span',{class:'bl'}, el('span',{class:'pr-st',style:'background:'+ST_COL[c.status],text:c.status}), el('span',{text:c.path.split('/').pop()})),
        el('div',{class:'bar-track'}, el('div',{class:'bar-fill',style:'width:'+Math.max(3,c.risk)+'%;background:'+OV.ramp(RISK)(c.risk/100)})),
        el('span',{class:'bv',text:String(c.risk)})));
      sec.appendChild(list); }
    const acts=el('div',{class:'git-acts'});
    acts.appendChild(el('button',{class:'tb-btn',text:T('pr.copyMd','Kopiuj raport (Markdown)'),onclick:()=>copy(markdown(g))}));
    acts.appendChild(el('button',{class:'tb-btn',text:'🔗 '+T('pr.copyLink','Kopiuj link do mapy'),onclick:()=>copy(mapLink(g))}));
    if(!g.gitInfo && CM.Git && CM.Git.sourceOf && CM.Git.sourceOf()) acts.appendChild(el('button',{class:'tb-btn',text:T('pr.addGit','Dodaj historię git (dokładniejsze ryzyko)'),onclick:()=>CM.Git.run()}));
    if(pi.url && /^https:\/\//.test(pi.url)) acts.appendChild(el('a',{class:'tb-btn',href:pi.url,target:'_blank',rel:'noopener',text:'↗ '+T('pr.open','Otwórz w serwisie')}));
    acts.appendChild(el('button',{class:'tb-btn',text:T('pr.clear','Wyczyść'),onclick:clear}));
    sec.appendChild(acts);
    return sec;
  }
  function fileSection(n, g){
    const pi=g.prInfo; if(!pi) return null;
    const c=pi.changed.find(x=>x.id===n.id);
    if(c){ const sec=el('div',{class:'det-section git-card pr-card'}, el('h5',{}, T('pr.changedFile','Zmieniony w PR #')+pi.number));
      const tags=el('div',{}); tags.appendChild(el('span',{class:'tag',text:({A:'dodany',M:'zmieniony',D:'usunięty',R:'przeniesiony'}[c.status]||c.status)+(c.from?(' ← '+c.from):'')}));
      tags.appendChild(el('span',{class:'tag',text:'+'+c.add+' / −'+c.del})); tags.appendChild(riskTag(c.risk>=60?'high':c.risk>=35?'med':'low', c.risk));
      sec.appendChild(tags); sec.appendChild(partBars(c.parts)); return sec; }
    const d=new Map(pi.impacted).get(n.id);
    if(d){ const via=(n.importsOut||[]).filter(id=>pi.changed.some(x=>x.id===id)).map(id=>(g.nodes.get(id)||{}).name||id);
      return el('div',{class:'det-section git-card pr-card'}, el('h5',{}, T('pr.dependsOn','Zależy od zmian w PR #')+pi.number),
        el('div',{}, el('span',{class:'tag',text:T('pr.distance','odległość')+' '+d}), via.length?el('span',{class:'muted small',text:' '+via.join(', ')}):null)); }
    return null;
  }
  CM.UI.addDetailSection((node, g)=>{ if(!g||!g.prInfo) return null; if(node===null) return projectCard(g); if(node.type==='file') return fileSection(node, g); return null; });

  // ---------------- menu, ChatBot ----------------
  function wire(){
    if(!A.renderer){ setTimeout(wire, 40); return; }
    const b=$('#btn-pr'); if(b) b.onclick=openDialog;
    if(!A.renderer.decorators.includes(prDecorator)) A.renderer.decorators.push(prDecorator);
  }
  A.onProjectLoaded(()=>{ cancel(); });
  if(A.registerAction){
    A.registerAction({name:'prReview', sig:'{pr}', desc:'analyse a pull / merge request (number or URL) of the loaded repository: changed files, dependents, risk per file, suggested reviewers', descPl:'przegląd PR — mapa wpływu i ryzyko zmian', auto:false,
      required:(a)=>!!P.parsePR(a&&(a.pr!=null?a.pr:(a.number!=null?a.number:a.url))),
      run:(a)=>{ const ref=a&&(a.pr!=null?a.pr:(a.number!=null?a.number:a.url)); run(ref); return T('cb.prRun','Analizuję PR ')+ref; }});
    A.registerAction({name:'prRisk', sig:'', desc:'summary of the analysed PR: risk, riskiest files, dependents, reviewers (Markdown)', descPl:'podsumowanie ryzyka przeanalizowanego PR', auto:true, info:true,
      run:()=>{ const g=A.graph; if(!g||!g.prInfo) throw new Error(T('cb.prNone','Brak przeanalizowanego PR — użyj prReview {pr}.')); return markdown(g); }});
  }
  CM.PR={run, apply, clear, openDialog, markdown, mapLink, cancel};
  setTimeout(wire, 0);
})();
