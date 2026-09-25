/* ===================== inspect.js — Analiza statyczna / wykrywanie antywzorców =====================
   CM.Inspect — czysto lokalna (bez sieci, bez AI) inspekcja załadowanego projektu:
   antywzorce architektury (cykle, god-files, huby, sieroty, przeładowane foldery, głębokie zagnieżdżenie),
   smelle treści (na bazie metrics + preview: złożoność, TODO, puste catch, ryzykowne API, debug-leftovers).
   Wyniki w overlayu (wzorzec drive.js: własny DOM + klasy .set-* / .ins-*), klik = fokus węzła na mapie.
   Zaprojektowane pod DUŻE projekty: liczenie w chunkach (nie blokuje UI), twarde limity list. */
CM.Inspect = (function(){
  const U=CM.util, el=U.el, ic=CM.icons, I=CM.i18n;

  /* ---------------- i18n (samodzielne STR, wzorzec settings.js/drive.js) ---------------- */
  const STR={
  pl:{
    'title':'Analiza statyczna',
    'desc':'Lokalne wykrywanie antywzorców — architektura i treść plików. Bez sieci, bez AI: czyste heurystyki na grafie zależności i metrykach.',
    'run':'Analizuj ponownie','running':'Analizuję…','export':'Eksportuj raport (.md)',
    'score':'Zdrowie projektu','findings':'znalezisk','files':'plików',
    'sev.high':'Krytyczne','sev.med':'Ostrzeżenia','sev.low':'Drobiazgi','sev.info':'Informacje',
    'none':'Nie wykryto problemów w tej kategorii. 🎉','empty':'Najpierw wczytaj projekt (CodeMap).',
    'clickHint':'Kliknij pozycję, aby pokazać element na mapie.',
    'and':'…i {n} więcej','loc':'linii','deps':'zależności','ln':'w ok. {n} miejscach',
    'r.cycles':'Cykle zależności','r.cycles.d':'Pliki importujące się nawzajem (bezpośrednio lub przez łańcuch) — utrudniają testowanie i refaktoryzację.',
    'r.god':'God-file (hub o zbyt wielu połączeniach)','r.god.d':'Plik powiązany z nienaturalnie dużą liczbą innych — zmiana w nim dotyka wszystkiego.',
    'r.fanout':'Zbyt wiele zależności wychodzących','r.fanout.d':'Plik importuje bardzo dużo modułów — prawdopodobnie robi zbyt wiele naraz.',
    'r.unstable':'Niestabilny hub (duży fan-in i fan-out)','r.unstable.d':'Wiele plików od niego zależy, a on sam zależy od wielu — najbardziej ryzykowne miejsce na zmiany.',
    'r.orphan':'Osierocone pliki (podejrzenie martwego kodu)','r.orphan.d':'Pliki kodu bez żadnych importów w obie strony — być może nieużywane.',
    'r.huge':'Bardzo długie pliki','r.huge.d':'Pliki o ekstremalnej liczbie linii — kandydaci do podziału.',
    'r.complex':'Wysoka złożoność cyklomatyczna','r.complex.d':'Bardzo dużo rozgałęzień (if/for/case/&&) w jednym pliku.',
    'r.todo':'Zagęszczenie TODO / FIXME','r.todo.d':'Duża liczba znaczników TODO/FIXME/HACK — dług techniczny zapisany wprost.',
    'r.deep':'Głębokie zagnieżdżenie folderów','r.deep.d':'Ścieżki o dużej głębokości utrudniają nawigację i świadczą o przerośniętej strukturze.',
    'r.crowded':'Przeładowane foldery','r.crowded.d':'Folder z bardzo dużą liczbą plików bezpośrednio w środku — brak pogrupowania.',
    'r.dupcode':'Zduplikowany kod (wspólne fragmenty)','r.dupcode.d':'Pary plików dzielące wiele identycznych fragmentów tokenów (winnowing na treści, białe znaki nieistotne) — kandydaci do wyciągnięcia wspólnego modułu.',
    'dupShare':'{a} i {b} dzielą {n} fragmentów',
    'r.emptycatch':'Puste bloki catch (połykanie wyjątków)','r.emptycatch.d':'`catch { }` bez obsługi ukrywa błędy. (Heurystyka na pierwszych 4000 znakach pliku.)',
    'r.risky':'Ryzykowne API (bezpieczeństwo)','r.risky.d':'Użycia eval / innerHTML= / document.write — potencjalne wektory XSS. (Heurystyka na pierwszych 4000 znakach.)',
    'r.debug':'Pozostałości debugowania','r.debug.d':'Liczne console.log / debugger w kodzie produkcyjnym. (Heurystyka na pierwszych 4000 znakach.)',
    'r.minified':'Pliki zminifikowane / vendored','r.minified.d':'Wyglądają na zbudowane/obce artefakty — zwykle warto je wykluczyć z analizy.',
    'r.archviolation':'Naruszenia reguł architektury','r.archviolation.d':'Importy zakazane przez `.codemap.rules.json` w repozytorium (warstwy, `forbid`, `noCycles`).',
    'r.archrules':'Plik reguł architektury nie dał się wczytać','r.archrules.d':'`.codemap.rules.json` istnieje, ale nie jest poprawnym JSON-em o oczekiwanym kształcie — reguły nie były sprawdzane.',
  },
  en:{
    'title':'Static analysis',
    'desc':'Local anti-pattern detection — architecture and file contents. No network, no AI: pure heuristics over the dependency graph and metrics.',
    'run':'Re-analyze','running':'Analyzing…','export':'Export report (.md)',
    'score':'Project health','findings':'findings','files':'files',
    'sev.high':'Critical','sev.med':'Warnings','sev.low':'Minor','sev.info':'Info',
    'none':'No issues found in this category. 🎉','empty':'Load a project first (CodeMap).',
    'clickHint':'Click an item to reveal it on the map.',
    'and':'…and {n} more','loc':'lines','deps':'deps','ln':'~{n} places',
    'r.cycles':'Dependency cycles','r.cycles.d':'Files importing each other (directly or via a chain) — hard to test and refactor.',
    'r.god':'God-file (over-connected hub)','r.god.d':'A file linked to an unnaturally high number of others — changing it touches everything.',
    'r.fanout':'Too many outgoing dependencies','r.fanout.d':'The file imports a lot of modules — it probably does too much at once.',
    'r.unstable':'Unstable hub (high fan-in AND fan-out)','r.unstable.d':'Many files depend on it while it depends on many — the riskiest place to change.',
    'r.orphan':'Orphan files (dead-code suspects)','r.orphan.d':'Code files with no imports either way — possibly unused.',
    'r.huge':'Very long files','r.huge.d':'Files with an extreme line count — candidates for splitting.',
    'r.complex':'High cyclomatic complexity','r.complex.d':'A very large number of branches (if/for/case/&&) in one file.',
    'r.todo':'TODO / FIXME density','r.todo.d':'Many TODO/FIXME/HACK markers — technical debt written down.',
    'r.deep':'Deep folder nesting','r.deep.d':'Very deep paths hamper navigation and hint at an overgrown structure.',
    'r.crowded':'Crowded folders','r.crowded.d':'A folder with very many files directly inside — no grouping.',
    'r.dupcode':'Duplicated code (shared fragments)','r.dupcode.d':'Pairs of files sharing many identical token fragments (content winnowing, whitespace-insensitive) — candidates for extracting a common module.',
    'dupShare':'{a} and {b} share {n} fragments',
    'r.emptycatch':'Empty catch blocks (exception swallowing)','r.emptycatch.d':'`catch { }` with no handling hides errors. (Heuristic over the first 4000 chars.)',
    'r.risky':'Risky APIs (security)','r.risky.d':'Uses of eval / innerHTML= / document.write — potential XSS vectors. (Heuristic over the first 4000 chars.)',
    'r.debug':'Debug leftovers','r.debug.d':'Multiple console.log / debugger in production code. (Heuristic over the first 4000 chars.)',
    'r.minified':'Minified / vendored files','r.minified.d':'Look like built/third-party artifacts — usually worth excluding from analysis.',
    'r.archviolation':'Architecture rule violations','r.archviolation.d':'Imports forbidden by `.codemap.rules.json` in the repository (layers, `forbid`, `noCycles`).',
    'r.archrules':'Architecture rules file could not be loaded','r.archrules.d':'`.codemap.rules.json` exists but is not valid JSON of the expected shape — rules were not checked.',
  }};
  function t(k,sub){ const l=I.getLang(); const d=STR[l]||STR.pl; let s=(d&&k in d)?d[k]:(STR.pl[k]||k); if(sub) for(const p in sub) s=s.replace('{'+p+'}',sub[p]); return s; }

  /* ---------------- rules engine ---------------- */
  const SEV_W={high:6, med:3, low:1, info:0};                    // weights for the health score
  const LIMIT=60;                                                 // max stored items per rule (UI shows fewer)
  // MessageChannel yield: gives the event loop room WITHOUT the background-tab setTimeout
  // throttling (~1s/tick hidden) — chunked analysis stays fast even in a non-focused tab
  const tick=()=>new Promise(r=>{ const ch=new MessageChannel(); ch.port1.onmessage=()=>r(); ch.port2.postMessage(0); });
  const ENTRY_RE=/^(index|main|app|server|cli|setup|conf(ig)?|__init__|__main__|mod|lib|test.*|.*\.(test|spec)|.*\.d)$/i;
  const CODE_JS=/^(js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/i;
  // real programming languages only — manifests/docs/styles being "orphans" is normal, not a smell
  const CODE_RE=/^(js|jsx|ts|tsx|mjs|cjs|vue|svelte|py|java|go|rb|php|cs|cpp|cxx|cc|c|h|hpp|rs|kt|kts|swift|scala|dart|lua|pl|r|jl|ex|exs|erl|hs|ml|fs|clj|groovy|zig|nim|v|sol)$/i;

  // returns {findings:[{rule,sev,items:[{id,name,path,detail}],count}], score, files, ms}
  async function run(graph){
    const t0=performance.now();
    const nodes=[...graph.nodes.values()];
    const files=nodes.filter(n=>n.type==='file');
    const folders=nodes.filter(n=>n.type==='folder');
    const N=files.length||1;
    const add=(map,rule,sev,n,detail)=>{ let f=map.get(rule); if(!f){ f={rule,sev,items:[],count:0}; map.set(rule,f); }
      f.count++; if(f.items.length<LIMIT) f.items.push({id:n.id,name:n.name,path:n.path||n.name,detail}); };
    const F=new Map();

    // ---- graph rules: fan-in / fan-out over import+reference edges (single O(E) pass) ----
    const fin=new Map(), fout=new Map();
    { let i=0; for(const e of graph.edges){ if(e.type==='contains') continue;
        fout.set(e.source,(fout.get(e.source)||0)+1); fin.set(e.target,(fin.get(e.target)||0)+1);
        if((++i&8191)===0) await tick(); } }
    const degs=files.map(f=>(fin.get(f.id)||0)+(fout.get(f.id)||0));
    const mean=degs.reduce((a,b)=>a+b,0)/N;
    const sd=Math.sqrt(degs.reduce((a,b)=>a+(b-mean)*(b-mean),0)/N)||1;
    const godThr=Math.max(20, mean+3*sd);
    // no dependency edges at all (tree-only load, no file contents) → orphan detection is meaningless
    const hasDeps=fin.size>0||fout.size>0;

    let idx=0;
    for(const f of files){
      if((++idx&2047)===0) await tick();                          // keep UI alive on 100k+ files
      const fi=fin.get(f.id)||0, fo=fout.get(f.id)||0, deg=fi+fo;
      const m=f.metrics;
      const base=(f.name||'').replace(/\.[^.]+$/,'');
      if(deg>=godThr) add(F,'god','high',f, deg+' '+t('deps')+' (fan-in '+fi+' / fan-out '+fo+')');
      else if(fo>=15) add(F,'fanout','med',f, 'fan-out '+fo);
      if(fi>=8&&fo>=8&&deg<godThr) add(F,'unstable','med',f, 'fan-in '+fi+' / fan-out '+fo);
      if(hasDeps && deg===0 && CODE_RE.test(f.lang||'') && !ENTRY_RE.test(base)) add(F,'orphan','low',f, (m?m.lines+' '+t('loc'):U.fmtBytes(f.size||0)));
      if(m){
        const minified = m.longest>2500 || (m.lines>1 && m.chars/m.lines>600);
        if(minified){ add(F,'minified','info',f, m.longest+' ch/line'); }
        else{
          if(m.lines>=800) add(F,'huge', m.lines>=2000?'high':'med', f, m.lines+' '+t('loc'));
          if(m.complexity>=150) add(F,'complex', m.complexity>=400?'high':'med', f, 'CC≈'+m.complexity);
          if(m.todos>=10) add(F,'todo','low',f, m.todos+' × TODO/FIXME');
        }
        const pv=f.preview;
        if(pv && !minified && CODE_JS.test(f.lang||'')){
          const ec=(pv.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)||[]).length;
          if(ec) add(F,'emptycatch','low',f, t('ln',{n:ec}));
          const risky=(pv.match(/\beval\s*\(|\.innerHTML\s*=|document\.write\s*\(|dangerouslySetInnerHTML/g)||[]).length;
          if(risky) add(F,'risky','med',f, t('ln',{n:risky}));
          const dbg=(pv.match(/console\.log\s*\(|(^|\n)\s*debugger\b/g)||[]).length;
          if(dbg>=5) add(F,'debug','low',f, t('ln',{n:dbg}));
        }
      }
    }

    // ---- folder rules ----
    for(const fd of folders){
      const depth=(fd.path||'').split('/').filter(Boolean).length;
      if(depth>=7) add(F,'deep','low',fd, t('loc')==='linii'?('głębokość '+depth):('depth '+depth));
      const kids=(fd.children||[]).reduce((a,cid)=>{ const c=graph.nodes.get(cid); return a+(c&&c.type==='file'?1:0); },0);
      if(kids>=40) add(F,'crowded','low',fd, kids+' '+t('files'));
    }

    // ---- duplikaty kodu: winnowing na treści (CM.Metrics) — tylko pliki z preview ≥ 20 linii,
    //      powyżej 1500 plików próbka największych; odciski liczone w chunkach (tick co 64 plików) ----
    if(CM.Metrics && CM.Metrics.findDuplicates){ try{
      const cand=CM.Metrics.duplicateCandidates(files);
      const fps=new Array(cand.length);
      for(let i=0;i<cand.length;i++){ fps[i]=CM.Metrics.fingerprints(cand[i]); if((i&63)===63) await tick(); }
      const pairs=CM.Metrics.pairDuplicates(cand, fps);
      for(const p of pairs.slice(0,LIMIT)){
        const a=graph.nodes.get(p.a), b=graph.nodes.get(p.b); if(!a||!b) continue;
        add(F,'dupcode','med',a, t('dupShare',{a:a.name,b:b.name,n:p.shared}));
      }
      if(pairs.length>LIMIT){ const f=F.get('dupcode'); if(f) f.count=pairs.length; }
    }catch(e){} }

    // ---- dependency cycles (reuse the graph's Tarjan) ----
    try{ const res=graph.importCycles();
      for(const comp of (res.components||[]).slice(0,LIMIT)){
        const first=graph.nodes.get(comp[0]); if(!first) continue;
        const names=comp.slice(0,4).map(id=>{ const n=graph.nodes.get(id); return n?n.name:id; }).join(' → ');
        add(F,'cycles', comp.length>=4?'high':'med', first, names+(comp.length>4?' → …':'')+'  ('+comp.length+')');
      }
      if(res.components&&res.components.length>LIMIT){ const f=F.get('cycles'); if(f) f.count=res.components.length; }
    }catch(e){}

    // ---- reguły architektury: .codemap.rules.json w projekcie (CM.Rules); brak pliku = reguła milczy ----
    if(CM.Rules){ try{
      const rn=CM.Rules.findRulesNode(graph);
      if(rn && rn.preview){
        let rules=null;
        try{ rules=CM.Rules.parse(rn.preview); }catch(err){ add(F,'archrules','info',rn, String(err&&err.message||err)); }
        if(rules){
          await tick();
          const v=CM.Rules.evaluate(graph, rules);
          for(const x of v.slice(0,LIMIT)){
            const n=graph.nodes.get(x.from); if(!n) continue;
            const tn=graph.nodes.get(x.to);
            add(F,'archviolation','high',n, '→ '+(tn?tn.name:x.to)+' · '+x.rule+(x.why?' — '+x.why:''));
          }
          if(v.length>LIMIT){ const f=F.get('archviolation'); if(f) f.count=v.length; }
        }
      }
    }catch(e){} }

    // ---- health score: 100 minus severity-weighted density ----
    let penalty=0; for(const f of F.values()) penalty+=SEV_W[f.sev]*f.count;
    const score=Math.max(0, Math.round(100 - 100*penalty/(penalty + 3*N)));
    const order=['archviolation','cycles','god','unstable','fanout','huge','complex','risky','dupcode','orphan','emptycatch','debug','todo','deep','crowded','minified','archrules'];
    const findings=[...F.values()].sort((a,b)=>order.indexOf(a.rule)-order.indexOf(b.rule));
    return {findings, score, files:files.length, ms:Math.round(performance.now()-t0)};
  }

  /* ---------------- overlay UI (own DOM, .set-* shell + .ins-* details) ---------------- */
  let overlay=null, lastReport=null;
  function graphRef(){ return (window.CMApp&&CMApp.graph)||null; }
  function buildOverlay(){
    if(overlay) return overlay;
    overlay=el('div',{id:'inspect-overlay',class:'hidden'});
    const panel=el('div',{class:'set-panel ins-panel'});
    const head=el('div',{class:'set-head'});
    head.appendChild(el('h2',{html:ic.svg('search',{size:18})+' <span class="ins-title"></span>'}));
    const x=el('button',{class:'set-x',html:ic.svg('x',{size:16}),onclick:close}); head.appendChild(x);
    panel.appendChild(head);
    panel.appendChild(el('div',{class:'set-wrap ins-wrap'}, el('div',{class:'set-content ins-content'})));
    overlay.appendChild(panel);
    overlay.addEventListener('click',(e)=>{ if(e.target===overlay) close(); });
    document.body.appendChild(overlay);
    return overlay;
  }
  function sevChip(sev){ return el('span',{class:'ins-sev ins-sev-'+sev,text:t('sev.'+sev)}); }
  async function render(){
    const c=buildOverlay().querySelector('.ins-content'); c.innerHTML='';
    buildOverlay().querySelector('.ins-title').textContent=t('title');
    const g=graphRef();
    if(!g || !g.nodes || g.nodes.size===0){ c.appendChild(el('p',{class:'set-desc',text:t('empty')})); return; }
    c.appendChild(el('p',{class:'set-desc',text:t('desc')}));
    const status=el('div',{class:'ins-score',text:t('running')}); c.appendChild(status);
    const list=el('div',{class:'ins-list'}); c.appendChild(list);
    const rep=await run(g); lastReport=rep;
    status.innerHTML='';
    const scoreCls=rep.score>=80?'ok':rep.score>=55?'mid':'bad';
    status.appendChild(el('div',{class:'ins-score-badge ins-score-'+scoreCls,html:'<b>'+rep.score+'</b><span>/100</span>'}));
    const total=rep.findings.reduce((a,f)=>a+f.count,0);
    status.appendChild(el('div',{class:'ins-score-meta',html:
      '<b>'+t('score')+'</b><br>'+U.fmtNum(rep.files)+' '+t('files')+' · '+U.fmtNum(total)+' '+t('findings')+' · '+rep.ms+' ms'}));
    const btns=el('div',{class:'ins-btns'});
    btns.appendChild(el('button',{class:'drv-btn',html:ic.svg('refresh',{size:13})+' '+t('run'),onclick:render}));
    btns.appendChild(el('button',{class:'drv-btn',html:ic.svg('download',{size:13})+' '+t('export'),onclick:exportMD}));
    status.appendChild(btns);
    if(!rep.findings.length){ list.appendChild(el('p',{class:'set-desc',text:t('none')})); return; }
    c.appendChild(el('p',{class:'set-desc ins-hint',text:t('clickHint')}));
    for(const f of rep.findings){
      const box=el('div',{class:'ins-rule ins-rule-'+f.sev});
      const hd=el('div',{class:'ins-rule-h'});
      hd.appendChild(sevChip(f.sev));
      hd.appendChild(el('b',{text:t('r.'+f.rule)}));
      hd.appendChild(el('span',{class:'ins-count',text:U.fmtNum(f.count)}));
      box.appendChild(hd);
      box.appendChild(el('p',{class:'ins-rule-d',text:t('r.'+f.rule+'.d')}));
      const ul=el('div',{class:'ins-items'});
      const show=f.items.slice(0,12);
      for(const it of show){
        const row=el('button',{class:'ins-item',title:it.path});
        row.appendChild(el('span',{class:'ins-item-n',text:it.name}));
        row.appendChild(el('span',{class:'ins-item-d',text:it.detail||''}));
        row.onclick=()=>{ close(); if(window.CMApp&&CMApp.focusNode) CMApp.focusNode(it.id); };
        ul.appendChild(row);
      }
      if(f.count>show.length) ul.appendChild(el('div',{class:'ins-more',text:t('and',{n:U.fmtNum(f.count-show.length)})}));
      box.appendChild(ul);
      const tgl=()=>box.classList.toggle('ins-open');
      hd.onclick=tgl; if(f.sev==='high'||f.sev==='med') box.classList.add('ins-open');
      list.appendChild(box);
    }
  }
  function exportMD(){
    if(!lastReport) return;
    const g=graphRef(); const name=(g&&g.meta&&(g.meta.name||g.meta.source))||'project';
    const L=['# CodeMap — '+t('title')+': '+name,'', t('score')+': **'+lastReport.score+'/100** — '+lastReport.files+' '+t('files'),''];
    for(const f of lastReport.findings){
      L.push('## '+t('r.'+f.rule)+' ('+f.count+') — '+t('sev.'+f.sev)); L.push(t('r.'+f.rule+'.d')); L.push('');
      for(const it of f.items) L.push('- `'+it.path+'` — '+(it.detail||''));
      if(f.count>f.items.length) L.push('- '+t('and',{n:f.count-f.items.length}));
      L.push('');
    }
    U.download('codemap-analysis.md', L.join('\n'), 'text/markdown');
  }
  function open(){ buildOverlay().classList.remove('hidden'); render(); }
  function close(){ if(overlay) overlay.classList.add('hidden'); }
  if(I.onChange) I.onChange(()=>{ if(overlay&&!overlay.classList.contains('hidden')) render(); });

  return { open, close, run:_g=>run(_g||graphRef()), _rules:{SEV_W,LIMIT} };
})();
