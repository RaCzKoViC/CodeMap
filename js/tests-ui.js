/* ===================== tests-ui.js — testy i pokrycie w aplikacji ===================== */
// Wpina czystą logikę CM.TestMap w CM.App (A): mapowanie test → kod po wczytaniu projektu i mapy z pliku,
// pokrycie z raportów (pliki boczne coverage/ przy wczytaniu folderu, menu „Projekt", plik upuszczony na mapę),
// nakładki „tests" i „coverage" (CM.Overlays), sekcja „Testy i pokrycie" w panelu szczegółów (CM.UI.addDetailSection)
// oraz akcje ChatBota tests / coverage / loadCoverage (A.registerAction). Teksty w słowniku modułu (wzorzec inspect.js).
(function(){
  const A=CM.App, TM=CM.TestMap, OV=CM.Overlays, U=CM.util, $=U.$, el=U.el, I=CM.i18n;
  if(!A || !TM) return;

  const STR={
  pl:{
    'ov.tests':'Testy (kod z testami / bez)','ov.testsNone':'Nie znaleziono plików testowych w projekcie.',
    'ov.coverage':'Pokrycie testami (raport)',
    'ov.covNone':'Brak danych pokrycia — wczytaj raport: Projekt → „Wczytaj pokrycie testów" albo przeciągnij lcov.info / coverage-final.json / cobertura.xml na mapę.',
    'lg.tested':'Kod z testami','lg.untested':'Kod bez testów','lg.test':'Pliki testowe','lg.helper':'Pomocnicze testów',
    'lg.low':'Pokrycie < 50 %','lg.mid':'Pokrycie 50–80 %','lg.high':'Pokrycie ≥ 80 %','lg.noData':'Kod bez danych pokrycia',
    'lg.testsNote':'Test → kod po nazwie (format.test.js → format.js, ścieżki lustrzane test/ ↔ src/) i po importach. Testy ma {pct} % plików kodu.',
    'lg.covNote':'Linie: {pct} % ({lh}/{lf}) · {files} plików · {src}',
    'toast.cov':'Pokrycie: {pct} % linii, {m}/{n} plików dopasowanych.',
    'toast.covNone':'Raport pokrycia nie pasuje do plików projektu ({n} wpisów).',
    'toast.covBad':'Nie rozpoznano raportu pokrycia: {name} (obsługiwane: lcov.info, coverage-final.json, coverage-summary.json, Cobertura, JaCoCo, Clover XML).',
    'toast.needProject':'Najpierw wczytaj projekt — pokrycie nakłada się na mapę.',
    'det.title':'Testy i pokrycie','det.testedBy':'Testowany przez','det.noTests':'Brak testów — żaden test nie prowadzi do tego pliku (po nazwie ani po importach).',
    'det.tests':'Testuje','det.testsNone':'Nie wskazano testowanego pliku (ani po nazwie, ani po importach).',
    'det.helper':'Plik pomocniczy testów (fixtures / setup / helpers) — bez podmiotu.',
    'det.via.name':'nazwa','det.via.import':'import','det.lines':'linie','det.branches':'gałęzie','det.funcs':'funkcje',
    'det.uncovered':'Niepokryte linie: ','det.allCovered':'Wszystkie linie z instrukcjami są pokryte.','det.covNone':'Brak danych pokrycia dla tego pliku w raporcie.',
    'det.fTests':'Pliki testowe','det.fTested':'Kod z testami','det.fUntested':'Kod bez testów','det.fUntestedHint':'Kliknij, aby podświetlić pliki bez testów na mapie.',
    'cb.testsNone':'Nie znaleziono plików testowych (konwencje: *.test.*, *.spec.*, test_*.py, *_test.go, *Test.java, *Tests.cs, *_spec.rb, katalogi test/, tests/, __tests__/).',
    'cb.testsSum':'Pliki testowe: {tests} (+{helpers} pomocniczych) · pliki kodu z testami: {tested}/{code} ({pct} %) · bez testów: {untested} (podświetlone na mapie).',
    'cb.topUntested':'Najbardziej złożone bez testów: ',
    'cb.testsOf':'{name} testuje: ','cb.testsOfNone':'{name} — nie wskazano testowanego pliku.','cb.helperOf':'{name} to plik pomocniczy testów (bez podmiotu).',
    'cb.testedBy':'{name} — testowany przez: ','cb.noTestsFor':'{name} — brak testów.',
    'cb.folderTests':'{name}: pliki testowe {tests}, kod z testami {tested}/{code}, bez testów {untested} (podświetlone).',
    'cb.notFound':'Nie znaleziono: ',
    'cb.covHint':'Brak danych pokrycia. Wygeneruj raport (np. `vitest run --coverage`, `jest --coverage`, `pytest --cov --cov-report=xml`, JaCoCo, `phpunit --coverage-clover`) i wczytaj go: Projekt → „Wczytaj pokrycie testów", przeciągnij plik na mapę albo wczytaj folder projektu razem z katalogiem coverage/.',
    'cb.covSum':'Pokrycie linii: {pct} % ({lh}/{lf}) · gałęzie: {b} · funkcje: {f} · dopasowane pliki raportu: {m}/{n} · źródło: {src}.',
    'cb.covLowest':'Najniższe pokrycie (poniżej 50 % podświetlone): ',
    'cb.covFile':'{name}: linie {pct} % ({lh}/{lf}) · gałęzie {b} · funkcje {f}',
    'cb.covFileNone':'{name}: brak danych pokrycia w raporcie.',
    'cb.loadCov':'Wybierz plik raportu pokrycia (lcov.info, coverage-final.json, cobertura.xml, jacoco.xml, clover.xml).',
    'act.tests':'testy: podsumowanie i pliki bez testów albo testy wskazanego pliku',
    'act.coverage':'pokrycie testami: podsumowanie albo szczegóły pliku / folderu',
    'act.loadCoverage':'wczytaj raport pokrycia (lcov / JSON / XML)',
  },
  en:{
    'ov.tests':'Tests (code with / without tests)','ov.testsNone':'No test files found in the project.',
    'ov.coverage':'Test coverage (report)',
    'ov.covNone':'No coverage data — load a report: Project → “Load test coverage” or drop lcov.info / coverage-final.json / cobertura.xml onto the map.',
    'lg.tested':'Code with tests','lg.untested':'Code without tests','lg.test':'Test files','lg.helper':'Test helpers',
    'lg.low':'Coverage < 50 %','lg.mid':'Coverage 50–80 %','lg.high':'Coverage ≥ 80 %','lg.noData':'Code without coverage data',
    'lg.testsNote':'Test → code by name (format.test.js → format.js, mirrored test/ ↔ src/ paths) and by imports. {pct} % of code files have tests.',
    'lg.covNote':'Lines: {pct} % ({lh}/{lf}) · {files} files · {src}',
    'toast.cov':'Coverage: {pct} % of lines, {m}/{n} files matched.',
    'toast.covNone':'The coverage report does not match the project files ({n} entries).',
    'toast.covBad':'Coverage report not recognized: {name} (supported: lcov.info, coverage-final.json, coverage-summary.json, Cobertura, JaCoCo, Clover XML).',
    'toast.needProject':'Load a project first — coverage is laid over the map.',
    'det.title':'Tests and coverage','det.testedBy':'Tested by','det.noTests':'No tests — no test leads to this file (neither by name nor by imports).',
    'det.tests':'Tests','det.testsNone':'No file under test found (neither by name nor by imports).',
    'det.helper':'Test helper file (fixtures / setup / helpers) — no subject.',
    'det.via.name':'name','det.via.import':'import','det.lines':'lines','det.branches':'branches','det.funcs':'functions',
    'det.uncovered':'Uncovered lines: ','det.allCovered':'All lines with statements are covered.','det.covNone':'No coverage data for this file in the report.',
    'det.fTests':'Test files','det.fTested':'Code with tests','det.fUntested':'Code without tests','det.fUntestedHint':'Click to highlight the files without tests on the map.',
    'cb.testsNone':'No test files found (conventions: *.test.*, *.spec.*, test_*.py, *_test.go, *Test.java, *Tests.cs, *_spec.rb, test/, tests/, __tests__/ folders).',
    'cb.testsSum':'Test files: {tests} (+{helpers} helpers) · code files with tests: {tested}/{code} ({pct} %) · without tests: {untested} (highlighted on the map).',
    'cb.topUntested':'Most complex without tests: ',
    'cb.testsOf':'{name} tests: ','cb.testsOfNone':'{name} — no file under test found.','cb.helperOf':'{name} is a test helper file (no subject).',
    'cb.testedBy':'{name} — tested by: ','cb.noTestsFor':'{name} — no tests.',
    'cb.folderTests':'{name}: test files {tests}, code with tests {tested}/{code}, without tests {untested} (highlighted).',
    'cb.notFound':'Not found: ',
    'cb.covHint':'No coverage data. Generate a report (e.g. `vitest run --coverage`, `jest --coverage`, `pytest --cov --cov-report=xml`, JaCoCo, `phpunit --coverage-clover`) and load it: Project → “Load test coverage”, drop the file onto the map, or load the project folder together with its coverage/ directory.',
    'cb.covSum':'Line coverage: {pct} % ({lh}/{lf}) · branches: {b} · functions: {f} · report files matched: {m}/{n} · source: {src}.',
    'cb.covLowest':'Lowest coverage (below 50 % highlighted): ',
    'cb.covFile':'{name}: lines {pct} % ({lh}/{lf}) · branches {b} · functions {f}',
    'cb.covFileNone':'{name}: no coverage data in the report.',
    'cb.loadCov':'Pick a coverage report file (lcov.info, coverage-final.json, cobertura.xml, jacoco.xml, clover.xml).',
    'act.tests':'tests: summary and files without tests, or the tests of a file',
    'act.coverage':'test coverage: summary or file / folder details',
    'act.loadCoverage':'load a coverage report (lcov / JSON / XML)',
  }};
  function t(k,sub){ const d=STR[I.getLang()]||STR.pl; let s=(d&&k in d)?d[k]:(k in STR.pl?STR.pl[k]:k);
    if(sub) for(const p in sub) s=s.split('{'+p+'}').join(String(sub[p])); return s; }
  const fmtPct=(p)=>p==null?'—':String(p).replace('.', I.getLang()==='en'?'.':',');
  const baseName=(p)=>String(p||'').split(/[\\/]/).pop();

  // ---------------- odświeżenie widoku po zmianie krawędzi / pokrycia ----------------
  // apply() zatrzymuje trwającą symulację siłową (świeżo wczytany projekt w układzie force) — wtedy podmieniamy
  // tylko widoczne krawędzie i kolory; węzłów nie przybywa, więc nic poza tym się nie zmienia.
  function refreshView(){
    const st=A.state, R=A.renderer; if(!R) return;
    if(st.sim && (st.sim._worker || st.sim.running)){
      st.vis=A.graph.getVisible(A.filters); R.setData(A.graph, st.vis, st.sim);
      if(OV) OV.refresh(); else R.kick();
    } else A.apply({relayout:false});   // apply woła też CM.Overlays.refresh()
    if(R.selected && CM.UI) CM.UI.renderDetails(R.selected, A.graph, A.handlers);
  }

  // ---------------- pokrycie: wczytanie raportów ----------------
  const MAX_COV=256*1024*1024;
  let _covGen=0;
  // items = File[] albo [{name, file}]; opts.show = przełącz kolorowanie na pokrycie, opts.quiet = bez toastów błędów
  async function loadCoverage(items, opts){
    opts=opts||{};
    items=Array.from(items||[]).map(x=>x&&x.file?x:{name:(x&&x.name)||'coverage', file:x}).filter(x=>x.file);
    if(!items.length) return null;
    if(!A.state.counts.nodes){ if(!opts.quiet) U.toast(t('toast.needProject'),'error'); return null; }
    const g=A.graph, my=++_covGen, reports=[], names=[], bad=[];
    for(const it of items){
      if(it.file.size>MAX_COV){ bad.push(baseName(it.name)); continue; }
      let text=null;
      try{ text=await it.file.text(); }catch(e){ bad.push(baseName(it.name)); continue; }
      if(g!==A.graph || my!==_covGen) return null;   // w międzyczasie wczytano inny projekt
      try{ const r=TM.parseCoverage(text, it.name); if(r && r.files.size){ reports.push(r); names.push(baseName(it.name)); } else bad.push(baseName(it.name)); }
      catch(e){ bad.push(baseName(it.name)+' ('+((e&&e.message)||e)+')'); }
    }
    if(!reports.length){ if(!opts.quiet) U.toast(t('toast.covBad',{name:bad.join(', ')||'—'}),'error',8000); return null; }
    const info=TM.applyCoverage(g, reports, {source:names.join(', ')});
    refreshView();
    if(!info.files){ if(!opts.quiet) U.toast(t('toast.covNone',{n:info.total}),'error',7000); return info; }
    U.toast(t('toast.cov',{pct:fmtPct(info.pct), m:info.matched, n:info.total}),'success',5500);
    if(opts.show && OV){ try{ OV.set('coverage'); }catch(e){ /* nakładka niedostępna — zostaje bieżąca */ } }
    return info;
  }
  // raporty znalezione przy wczytywaniu folderu (loaders.js → side.coverage; upuszczone katalogi coverage/ leniwie)
  async function sideCoverage(side, g){
    try{ await CM.Loaders.resolveSide(side); }catch(e){ return; }
    if(g!==A.graph) return;
    const items=(side.coverage||[]).map(c=>({name:c.path, file:c.file}));
    if(items.length) await loadCoverage(items, {quiet:true});
  }
  function openPicker(){ const inp=$('#input-coverage'); if(inp) inp.click(); }
  { const b=$('#btn-coverage'); if(b) b.onclick=()=>{ if(!A.state.counts.nodes){ U.toast(t('toast.needProject'),'error'); return; } openPicker(); }; }
  { const inp=$('#input-coverage'); if(inp) inp.onchange=(e)=>{ const files=Array.from(e.target.files||[]); e.target.value=''; if(files.length) loadCoverage(files, {show:true}); }; }
  // upuszczenie samych raportów pokrycia na wczytaną mapę (chrome.js wireDnD) → pokrycie zamiast nowego projektu
  A.dropCoverage=(files, entries)=>{
    if(!A.state.counts.nodes || !files || !files.length) return false;
    if(entries && entries.some(e=>e && e.isDirectory)) return false;
    if(!files.every(f=>CM.Loaders.RE_COVERAGE.test(f.name||''))) return false;
    loadCoverage(files, {show:true});
    return true;
  };

  // ---------------- po wczytaniu projektu / mapy ----------------
  A.onProjectLoaded(({reason, graph, side})=>{
    if((reason!=='ingest' && reason!=='json') || !graph || !graph.nodes || !graph.nodes.size) return;
    TM.mapTests(graph);   // idempotentne; po mapie z pliku odtwarza tests/testedBy, zachowuje pokrycie
    refreshView();
    if(reason==='ingest' && side && ((side.coverage&&side.coverage.length) || (side.coverageEntries&&side.coverageEntries.length))) sideCoverage(side, graph);
  });

  // ---------------- nakładki kolorów ----------------
  const C={tested:'#22c55e', untested:'#f97316', test:'#a78bfa', helper:'#7c6fb0'};
  const COV_STOPS=['#ef4444','#f97316','#facc15','#a3e635','#22c55e'];   // 0 % → 100 %
  if(OV){
    OV.register({id:'tests', order:60, label:()=>t('ov.tests'),
      available:(g)=>!!(g && g.testInfo && (g.testInfo.tests>0 || g.testInfo.helpers>0)),
      unavailable:()=>t('ov.testsNone'),
      compute(g){
        const col=new Map(), ids={tested:new Set(), untested:new Set(), test:new Set(), helper:new Set()};
        for(const n of g.nodes.values()){
          if(n.type!=='file') continue;
          const k=n.isTest?(n.testHelper?'helper':'test'):((n.testedBy&&n.testedBy.length)?'tested':(TM.isCodeFile(n.path||n.id)?'untested':null));
          if(k){ ids[k].add(n.id); col.set(n.id, C[k]); }
        }
        const it=(k)=>({color:C[k], label:t('lg.'+k), count:ids[k].size, ids:ids[k]});
        return { colorOf:(n)=>n.type==='folder'?OV.FOLDER:(col.get(n.id)||OV.NONE),
          legend:{items:['tested','untested','test','helper'].map(it).filter(x=>x.count), note:t('lg.testsNote',{pct:g.testInfo.pct})} };
      }});
    OV.register({id:'coverage', order:61, label:()=>t('ov.coverage'),
      available:(g)=>!!(g && g.testInfo && g.testInfo.coverage && g.testInfo.coverage.files>0),
      unavailable:()=>t('ov.covNone'),
      compute(g){
        const r=OV.ramp(COV_STOPS), col=new Map(), low=new Set(), mid=new Set(), high=new Set(), none=new Set();
        for(const n of g.nodes.values()){
          if(n.type!=='file' && n.type!=='folder') continue;
          const c=n.coverage;
          if(c && c.pct!=null){ col.set(n.id, r(c.pct/100)); if(n.type==='file') (c.pct<50?low:c.pct<80?mid:high).add(n.id); }
          else if(n.type==='file' && !n.isTest && TM.isCodeFile(n.path||n.id)) none.add(n.id);
        }
        const ci=g.testInfo.coverage;
        const items=[{color:r(0.2), label:t('lg.low'), count:low.size, ids:low}, {color:r(0.65), label:t('lg.mid'), count:mid.size, ids:mid},
          {color:r(0.95), label:t('lg.high'), count:high.size, ids:high}, {color:OV.NONE, label:t('lg.noData'), count:none.size, ids:none}].filter(x=>x.count);
        return { colorOf:(n)=>col.get(n.id)||(n.type==='folder'?OV.FOLDER:OV.NONE),
          legend:{gradient:{stops:COV_STOPS, min:'0 %', max:'100 %'}, items,
            note:t('lg.covNote',{pct:fmtPct(ci.pct), lh:ci.lh, lf:ci.lf, files:ci.files, src:ci.source||ci.format||'—'})} };
      }});
  }

  // ---------------- panel szczegółów: „Testy i pokrycie" ----------------
  const covColor=(p)=>OV?OV.ramp(COV_STOPS)(p/100):'#22c55e';
  function chip(n, via, H){
    const col=(n.langInfo&&n.langInfo.color)||'#7d8aa0';
    return el('span',{class:'tag tm-chip',title:n.path||n.name,onclick:()=>H.focus(n.id)},
      el('span',{class:'tm-dot',style:'background:'+col}), n.name, via?el('span',{class:'tm-via',text:t('det.via.'+via)}):null);
  }
  function covBlock(c){
    const wrap=el('div',{});
    const row=(lbl,h,tot)=>{ if(!tot) return; const p=Math.round(h/tot*1000)/10;
      wrap.appendChild(CM.UIKit.barRow(lbl, p, covColor(p), fmtPct(p)+'%', {title:h+' / '+tot})); };
    row(t('det.lines'), c.lh, c.lf); row(t('det.branches'), c.bh, c.bf); row(t('det.funcs'), c.fh, c.ff);
    const parts=[t('det.lines')+' '+U.fmtNum(c.lh)+'/'+U.fmtNum(c.lf)];
    if(c.bf) parts.push(t('det.branches')+' '+U.fmtNum(c.bh)+'/'+U.fmtNum(c.bf));
    if(c.ff) parts.push(t('det.funcs')+' '+U.fmtNum(c.fh)+'/'+U.fmtNum(c.ff));
    wrap.appendChild(el('div',{class:'muted small tm-note',text:parts.join(' · ')}));
    if(c.uncovered){
      if(c.uncovered.length) wrap.appendChild(el('div',{class:'tm-unc'}, el('b',{text:t('det.uncovered')}), TM.fmtRanges(c.uncovered, 16)));
      else if(c.lf) wrap.appendChild(el('div',{class:'muted small tm-note',text:t('det.allCovered')}));
    }
    return wrap;
  }
  function detailsSection(node, graph, H){
    const ti=graph && graph.testInfo; if(!ti) return null;
    const hasTests=((ti.tests||0)+(ti.helpers||0))>0, ci=(ti.coverage && ti.coverage.files>0)?ti.coverage:null;
    if(!hasTests && !ci) return null;
    const sec=el('div',{class:'det-section det-tests'});
    sec.appendChild(el('h5',{}, t('det.title')));
    const note=(txt)=>sec.appendChild(el('div',{class:'muted small tm-note',text:txt}));
    if(!node){   // widok projektu (nic nie zaznaczono): podsumowanie testów i pokrycia
      const tags=el('div',{class:'tm-chips'});
      if(hasTests){
        tags.appendChild(el('span',{class:'tag',text:t('det.fTests')+': '+U.fmtNum(ti.tests||0)}));
        tags.appendChild(el('span',{class:'tag',text:t('det.fTested')+': '+U.fmtNum(ti.tested||0)+'/'+U.fmtNum(ti.code||0)}));
        if(ti.untested) tags.appendChild(el('span',{class:'tag',text:t('det.fUntested')+': '+U.fmtNum(ti.untested)}));
      }
      if(ci && ci.pct!=null) tags.appendChild(el('span',{class:'tag',text:t('ov.coverage')+': '+Math.round(ci.pct)+'%'}));
      sec.appendChild(tags);
      return sec;
    }
    if(node.type==='file'){
      const code=TM.isCodeFile(node.path||node.id);
      if(!node.isTest && !code && !node.coverage) return null;   // README, obrazy, konfiguracja…
      const vias=new Map();
      for(const e of graph.edges) if(e.type==='test' && (e.source===node.id || e.target===node.id)) vias.set(e.source===node.id?e.target:e.source, e.via);
      const chips=(ids)=>{ const box=el('div',{class:'tm-chips'}); for(const id of ids.slice(0,40)){ const n=graph.nodes.get(id); if(n) box.appendChild(chip(n, vias.get(id), H)); } return box; };
      if(node.isTest){
        if(node.testHelper) note(t('det.helper'));
        else if(node.tests && node.tests.length){ note(t('det.tests')+' ('+node.tests.length+')'); sec.appendChild(chips(node.tests)); }
        else note(t('det.testsNone'));
      } else if(node.testedBy && node.testedBy.length){ note(t('det.testedBy')+' ('+node.testedBy.length+')'); sec.appendChild(chips(node.testedBy)); }
      else if(hasTests && code) sec.appendChild(el('div',{class:'tm-warn',text:'⚠ '+t('det.noTests')}));
      if(ci){
        if(node.coverage) sec.appendChild(covBlock(node.coverage));
        else if(!node.isTest && code) note(t('det.covNone'));
      }
      return sec.children.length>1?sec:null;
    }
    if(node.type==='folder' && !node.external){
      if(hasTests){
        const s=TM.folderStats(graph, node);
        if(s.tests || s.code){
          const tags=el('div',{class:'tm-chips'});
          tags.appendChild(el('span',{class:'tag',text:t('det.fTests')+': '+U.fmtNum(s.tests)}));
          tags.appendChild(el('span',{class:'tag',text:t('det.fTested')+': '+U.fmtNum(s.tested)+'/'+U.fmtNum(s.code)}));
          const u=el('span',{class:'tag'+(s.untested?' tm-chip':''),text:t('det.fUntested')+': '+U.fmtNum(s.untested)});
          if(s.untested){ u.title=t('det.fUntestedHint'); u.onclick=()=>{ if(A.renderer) A.renderer.setHighlight(new Set(s.untestedIds)); }; }
          tags.appendChild(u); sec.appendChild(tags);
        }
      }
      if(ci && node.coverage) sec.appendChild(covBlock(node.coverage));
      return sec.children.length>1?sec:null;
    }
    return null;
  }
  if(CM.UI && CM.UI.addDetailSection) CM.UI.addDetailSection(detailsSection);

  // ---------------- ChatBot: tests / coverage / loadCoverage ----------------
  function findNode(q){
    return U.matchNode(A.graph.nodes.values(), q, {only:n=>n.type!=='external' && n.type!=='symbol', exactPath:110, preferFile:true});
  }
  const hi=(ids)=>{ if(A.renderer) A.renderer.setHighlight(ids && ids.size?ids:null); };
  const listOf=(ids, max)=>{ max=max||25; const a=ids.map(id=>{ const n=A.graph.nodes.get(id); return n?(n.path||n.name):id; }); return a.slice(0,max).join(', ')+(a.length>max?' …':''); };
  const cx=(n)=>(n.metrics && n.metrics.complexity)||0;
  const lines=(n)=>(n.metrics && n.metrics.lines)||0;
  function actTests(args){
    A._needProject();
    const g=A.graph, ti=(g.testInfo && g.testInfo.tests!=null)?g.testInfo:TM.mapTests(g);
    if(!ti.tests && !ti.helpers) return t('cb.testsNone');
    const q=String(args.query||args.name||args.file||'').trim();
    if(!q){
      const unt=[];
      for(const n of g.nodes.values()) if(n.type==='file' && !n.isTest && !(n.testedBy && n.testedBy.length) && TM.isCodeFile(n.path||n.id)) unt.push(n);
      unt.sort((a,b)=>cx(b)-cx(a) || lines(b)-lines(a));
      hi(new Set(unt.map(n=>n.id)));
      let s=t('cb.testsSum',{tests:ti.tests, helpers:ti.helpers, tested:ti.tested, code:ti.code, pct:ti.pct, untested:ti.untested});
      if(unt.length) s+='\n'+t('cb.topUntested')+unt.slice(0,10).map(n=>(n.path||n.name)+' (CC '+cx(n)+', '+lines(n)+')').join(', ');
      return s;
    }
    const n=findNode(q); if(!n) throw new Error(t('cb.notFound')+q);
    if(n.type==='folder'){ const s=TM.folderStats(g, n); hi(new Set(s.untestedIds)); return t('cb.folderTests',{name:n.path||n.name, tests:s.tests, tested:s.tested, code:s.code, untested:s.untested}); }
    if(n.isTest){
      if(n.testHelper){ hi(new Set([n.id])); return t('cb.helperOf',{name:n.path||n.name}); }
      const ids=n.tests||[]; hi(new Set([n.id, ...ids]));
      return ids.length?t('cb.testsOf',{name:n.path||n.name})+listOf(ids):t('cb.testsOfNone',{name:n.path||n.name});
    }
    const ids=n.testedBy||[]; hi(new Set([n.id, ...ids]));
    return ids.length?t('cb.testedBy',{name:n.path||n.name})+listOf(ids):t('cb.noTestsFor',{name:n.path||n.name});
  }
  function actCoverage(args){
    A._needProject();
    const g=A.graph, ci=g.testInfo && g.testInfo.coverage;
    if(!ci || !ci.files) return t('cb.covHint');
    const q=String(args.query||args.name||args.file||'').trim();
    if(!q){
      const files=[];
      for(const n of g.nodes.values()) if(n.type==='file' && n.coverage && n.coverage.pct!=null) files.push(n);
      files.sort((a,b)=>a.coverage.pct-b.coverage.pct || cx(b)-cx(a));
      hi(new Set(files.filter(n=>n.coverage.pct<50).map(n=>n.id)));
      let s=t('cb.covSum',{pct:fmtPct(ci.pct), lh:ci.lh, lf:ci.lf, b:ci.bf?(ci.bh+'/'+ci.bf):'—', f:ci.ff?(ci.fh+'/'+ci.ff):'—', m:ci.matched, n:ci.total, src:ci.source||ci.format||'—'});
      if(files.length) s+='\n'+t('cb.covLowest')+files.slice(0,10).map(n=>(n.path||n.name)+' '+fmtPct(n.coverage.pct)+' %').join(', ');
      return s;
    }
    const n=findNode(q); if(!n) throw new Error(t('cb.notFound')+q);
    hi(new Set([n.id]));
    const c=n.coverage, name=n.path||n.name;
    if(!c) return t('cb.covFileNone',{name});
    let s=t('cb.covFile',{name, pct:fmtPct(c.pct), lh:c.lh, lf:c.lf, b:c.bf?(c.bh+'/'+c.bf):'—', f:c.ff?(c.fh+'/'+c.ff):'—'});
    if(c.uncovered && c.uncovered.length) s+='\n'+t('det.uncovered')+TM.fmtRanges(c.uncovered, 30);
    return s;
  }
  if(A.registerAction){
    A.registerAction({name:'tests', sig:'{query?}', auto:true, info:true, run:actTests, descPl:STR.pl['act.tests'],
      desc:'test ↔ code mapping (by name and imports): without query — summary, highlights code files without tests and lists the 10 most complex untested ones; with query — the tests of that file, the files a test covers, or test stats of a folder'});
    A.registerAction({name:'coverage', sig:'{query?}', auto:true, info:true, run:actCoverage, descPl:STR.pl['act.coverage'],
      desc:'test coverage from the loaded report (lcov / Istanbul / Cobertura / JaCoCo / Clover): without query — totals and the lowest-covered files; with query — line/branch/function coverage and uncovered lines of that file or folder'});
    A.registerAction({name:'loadCoverage', sig:'', auto:false, info:false, descPl:STR.pl['act.loadCoverage'],
      run:()=>{ A._needProject(); openPicker(); return t('cb.loadCov'); },
      desc:'open a file picker to load a test coverage report (lcov.info, coverage-final.json, cobertura.xml, jacoco.xml, clover.xml) onto the map'});
  }

  CM.TestsUI={loadCoverage, refresh:refreshView, openPicker, detailsSection};
})();
