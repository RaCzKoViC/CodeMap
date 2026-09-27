/* ===================== testmap.js — testy ↔ kod i pokrycie z raportów =====================
   CM.TestMap — czysta logika (bez DOM, testowalna w harnessie `vm`):
   - testRole / isTestFile: konwencje nazw i katalogów testów (JS/TS, Python, Go, JVM, C#, Ruby, PHP, Rust,
     Dart, Swift, Elixir, C/C++); pliki pomocnicze (fixtures, conftest.py, setup.*, helpers) są testowe,
     ale bez podmiotu,
   - mapTests(graph): test → podmiot (a) po nazwie — rdzeń bez przyrostków/przedrostków testowych, ścieżka
     „lustrzana" (test/ ↔ src/, src/test/java ↔ src/main/java), najbliższy wspólny przodek; (b) po importach.
     Krawędzie {type:'test', via:'name'|'import'}, n.isTest / n.tests / n.testedBy, graph.testInfo. Idempotentne.
   - parsery pokrycia: lcov, Istanbul (coverage-final.json / coverage-summary.json), Cobertura, JaCoCo, Clover
     → Map ścieżka → {lf, lh, bf, bh, ff, fh, lines: Map linia→trafienia},
   - applyCoverage(graph, raporty): dopasowanie ścieżek raportu po najdłuższym wspólnym sufiksie segmentów,
     n.coverage = {pct, lh, lf, bh, bf, fh, ff, uncovered:[[od,do],…]}, foldery = suma dzieci. */
CM.TestMap = (function(){

  // ---------- rodziny języków (test i podmiot muszą należeć do tej samej) ----------
  const FAMILY={js:'js',jsx:'js',ts:'js',tsx:'js',mjs:'js',cjs:'js',mts:'js',cts:'js',vue:'js',svelte:'js',
    py:'py', go:'go', java:'jvm',kt:'jvm',kts:'jvm',scala:'jvm',groovy:'jvm', cs:'cs',fs:'fs',vb:'vb', rb:'rb', php:'php', rs:'rs',
    dart:'dart', swift:'swift', m:'objc', mm:'objc', ex:'ex', exs:'ex', erl:'erl', c:'c',cc:'c',cpp:'c',cxx:'c',h:'c',hh:'c',hpp:'c',hxx:'c',
    lua:'lua', clj:'clj', hs:'hs', ml:'ml', zig:'zig', nim:'nim', jl:'jl', r:'r', pl:'pl', pm:'pl', cr:'cr', sol:'sol'};
  const HEADER=/\.(h|hh|hpp|hxx)$/i;
  const baseOf=(p)=>{ const s=String(p||''); const i=s.lastIndexOf('/'); return i<0?s:s.slice(i+1); };
  const dirOf=(p)=>{ const s=String(p||''); const i=s.lastIndexOf('/'); return i<0?'':s.slice(0,i); };
  const extOf=(p)=>{ const b=baseOf(p); const i=b.lastIndexOf('.'); return i<=0?'':b.slice(i+1).toLowerCase(); };
  const normPath=(p)=>String(p||'').replace(/\\/g,'/').replace(/^\.\//,'').replace(/\/{2,}/g,'/');
  // plik kodu (kandydat na podmiot / „bez testów"): nie deklaracje typów, konfiguracja ani zminifikowane artefakty
  function isCodeFile(path){
    const b=baseOf(normPath(path));
    if(!FAMILY[extOf(b)]) return false;
    return !/\.d\.[cm]?ts$|\.min\.js$|[.-]config\.[cm]?[jt]s$|\.conf\.js$|^\.[\w-]+rc\.[cm]?js$|^__init__\.py$/i.test(b);
  }

  // ---------- konwencje testów ----------
  const TEST_DIRS=new Set(['__tests__','__test__','test','tests','spec','specs','e2e','cypress']);
  // katalogi pomocnicze w drzewie testów (dane, atrapy, wspólny kod) i takie, które są pomocnicze wszędzie
  const HELPER_DIRS=new Set(['fixtures','fixture','__fixtures__','testdata','test-data','test_data','__mocks__','mocks','__snapshots__','snapshots',
    'helpers','helper','support','utils','util','common','factories','stubs','resources','data','testutils','test-utils','test_utils']);
  const HELPER_ANY=new Set(['__mocks__','__fixtures__','__snapshots__','testdata']);
  function isTestDirSeg(s){
    return TEST_DIRS.has(s.toLowerCase())
      || /^(unit|integration|functional|acceptance|e2e|it)[-_]?tests?$/i.test(s)          // integration-tests, unit_tests
      || /.\.(unit|integration|functional|acceptance|e2e)?tests?$/i.test(s)              // C#: MyApp.Tests, MyApp.UnitTests
      || /^[A-Z][A-Za-z0-9]*Tests$/.test(s);                                              // Xcode: MyAppTests, MyAppUITests
  }
  // pomocnicze po samej nazwie (także poza katalogami testów)
  const HELPER_NAME_ANY=/^(conftest\.py|spec_helper\.rb|rails_helper\.rb|test_helper\.(rb|exs|py)|setupTests\.[cm]?[jt]sx?|(jest|vitest|karma|mocha|ava|playwright|cypress|wdio|protractor)\.(setup|config|conf)(\.[\w-]+)?\.[cm]?[jt]s|test[-_.]?setup\.[a-z]+|test[-_]?utils?\.[a-z]+|test[-_]?helpers?\.[a-z]+|[^/]+\.(fixtures?|mocks?|stubs?)\.[a-z0-9]+)$/i;
  // pomocnicze wewnątrz katalogów testów
  const HELPER_NAME_IN_TEST=/^(setup|teardown|global[-_]?setup|global[-_]?teardown|helpers?|harness|utils?|common|support|fixtures?|mocks?|factories|factory|stubs?|index|__init__|mod|conftest|globals?|config|conf|constants?|types?)\.[a-z0-9]+$/i;
  function isTestName(b){
    return /\.(test|spec|tests|specs|e2e|e2e-spec|cy)\.[a-z0-9]+$/i.test(b)                 // JS/TS: foo.test.ts, foo.spec.js, foo.cy.js
      || /^test_[^/]+\.(py|rb|c|cc|cpp|cxx)$/i.test(b)                                     // Python / Ruby / C: test_foo.py
      || /.+_(test|tests|unittest)\.(py|go|rb|dart|exs|c|cc|cpp|cxx|rs|lua|js|ts|php|cr|nim|zig)$/i.test(b)   // foo_test.go, foo_unittest.cc
      || /.+_spec\.(rb|lua|js|ts|cr|exs)$/i.test(b)                                       // Ruby: foo_spec.rb
      || /[A-Za-z0-9_](Test|Tests|TestCase)\.(java|kt|kts|scala|groovy|cs|fs|vb|php|swift|m|mm|dart)$/.test(b)   // FooTest.java, FooTests.cs
      || /[a-z0-9]IT\.(java|kt|kts|scala|groovy)$/.test(b)                                // FooIT.java (testy integracyjne)
      || /[A-Za-z0-9_]Specs?\.(scala|groovy|swift)$/.test(b)                              // FooSpec.scala
      || /^Test[A-Z0-9_][^/]*\.(java|kt|scala|groovy|cs|php|swift)$/.test(b)              // TestFoo.java (JUnit 3)
      || /^tests?\.py$/i.test(b);                                                          // Django: tests.py
  }
  // 'test' | 'helper' | null
  function testRole(path){
    const p=normPath(path), segs=p.split('/'), b=segs.pop()||'';
    let inTest=false, inHelper=false;
    for(const s of segs){
      const l=s.toLowerCase();
      if(isTestDirSeg(s)) inTest=true; else if(inTest && HELPER_DIRS.has(l)) inHelper=true;
      if(HELPER_ANY.has(l)) inHelper=true;
    }
    if(HELPER_NAME_ANY.test(b)) return 'helper';
    if(isTestName(b)) return inHelper?'helper':'test';
    if(inHelper) return 'helper';                  // dane testowe dowolnego typu (tests/fixtures/*.json, __snapshots__/*.snap)
    if(inTest){
      if(!FAMILY[extOf(b)]) return null;          // README, dane itp. w tests/ — nie test
      return HELPER_NAME_IN_TEST.test(b)?'helper':'test';
    }
    return null;
  }
  const isTestFile=(path)=>testRole(path)!==null;
  const isTestHelper=(path)=>testRole(path)==='helper';

  // rdzeń nazwy testu: format.test.js → format, test_parser.py → parser, FooTest.java → Foo, TestFoo.java → Foo
  function testStem(path){
    let b=baseOf(normPath(path)).replace(/\.[^.]+$/,'');
    b=b.replace(/\.(test|spec|tests|specs|e2e|e2e-spec|cy)$/i,'');
    if(/^tests?$/i.test(b)) return '';
    let s=b.replace(/^test_/i,'').replace(/_(test|tests|spec|unittest)$/i,'');
    if(s===b){ s=b.replace(/([A-Za-z0-9_])(Tests?|TestCase|Specs?)$/,'$1'); if(s===b) s=b.replace(/([a-z0-9])IT$/,'$1'); if(s===b) s=b.replace(/^Test(?=[A-Z0-9_])/,''); }
    return s;
  }
  const keyOf=(s)=>String(s||'').toLowerCase().replace(/[-_.\s]/g,'');
  const INDEX_NAME=/^(index|__init__|mod)\.[a-z0-9]+$/i;   // podmiot „folder/index.js" dla testu „folder.test.js"

  // katalog testu bez segmentów testowych i katalog kodu bez segmentów „źródłowych" → porównanie lustrzane
  function normTestDir(segs){
    const out=[];
    for(const s of segs){
      if(TEST_DIRS.has(s.toLowerCase()) || /^(unit|integration|functional|acceptance|e2e|it)([-_]?tests?)?$/i.test(s)) continue;
      if(/.\.(unit|integration|functional|acceptance|e2e)?tests?$/i.test(s)){ out.push(s.replace(/\.(unit|integration|functional|acceptance|e2e)?tests?$/i,'')); continue; }
      if(/^[A-Z][A-Za-z0-9]*Tests$/.test(s)){ out.push(s.replace(/(UI)?Tests$/,'')); continue; }
      out.push(s);
    }
    return normSrcDir(out);
  }
  const normSrcDir=(segs)=>segs.filter(s=>!/^(main|src|lib|app|source|sources)$/i.test(s));
  const commonPrefix=(a,b)=>{ let i=0; while(i<a.length&&i<b.length&&a[i]===b[i]) i++; return i; };
  const commonSuffix=(a,b)=>{ let i=0; while(i<a.length&&i<b.length&&a[a.length-1-i]===b[b.length-1-i]) i++; return i; };
  const splitDir=(d)=>d?d.split('/'):[];

  // wybór podmiotu po nazwie: [ten sam katalog, lustro, wspólny sufiks, wspólny przodek, −odległość, nie-nagłówek]
  function scoreCandidate(tDir, tNorm, c){
    const cDir=splitDir(dirOf(c.id)), cNorm=normSrcDir(cDir);
    const pre=commonPrefix(tDir, cDir);
    return [tDir.join('/')===cDir.join('/')?1:0, tNorm.join('/')===cNorm.join('/')?1:0, commonSuffix(tNorm, cNorm), pre,
      -(tDir.length+cDir.length-2*pre), HEADER.test(c.id)?0:1];
  }
  const cmpScore=(a,b)=>{ for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return a[i]-b[i]; return 0; };

  // ---------- mapowanie testów do kodu ----------
  function mapTests(graph){
    const prevCov=graph.testInfo&&graph.testInfo.coverage;
    graph.edges=graph.edges.filter(e=>e.type!=='test');
    const files=[];
    for(const n of graph.nodes.values()){
      if(n.isTest!==undefined || n.tests || n.testedBy || n.testHelper){ delete n.isTest; delete n.tests; delete n.testedBy; delete n.testHelper; }
      if(n.type==='file') files.push(n);
    }
    // role + indeks kandydatów (klucz rdzenia nazwy → pliki kodu)
    const role=new Map(), byKey=new Map(), tests=[];
    const addKey=(k,n)=>{ if(!k) return; let a=byKey.get(k); if(!a) byKey.set(k,a=[]); a.push(n); };
    let helpers=0, code=0;
    for(const n of files){
      const r=testRole(n.path||n.id); role.set(n.id, r);
      if(r==='test'){ n.isTest=true; tests.push(n); }
      else if(r==='helper'){ n.isTest=true; n.testHelper=true; n.tests=[]; helpers++; }
      else if(isCodeFile(n.path||n.id)){
        code++;
        const b=baseOf(n.id); addKey(keyOf(b.replace(/\.[^.]+$/,'')), n);
        if(INDEX_NAME.test(b)) addKey(keyOf(baseOf(dirOf(n.id))), n);
      }
    }
    const subjects=new Map();   // test id → Map(podmiot → via)
    // (a) nazwa
    let byName=0, byImport=0;
    for(const tn of tests){
      const m=new Map(); subjects.set(tn.id, m);
      const k=keyOf(testStem(tn.id)); if(!k) continue;
      const fam=FAMILY[extOf(tn.id)];
      const cands=(byKey.get(k)||[]).filter(c=>c.id!==tn.id && FAMILY[extOf(c.id)]===fam);
      if(!cands.length) continue;
      const tDir=splitDir(dirOf(tn.id)), tNorm=normTestDir(tDir);
      let best=null, bs=null, tie=false;
      for(const c of cands){
        const s=scoreCandidate(tDir, tNorm, c);
        if(!bs || cmpScore(s,bs)>0){ best=c; bs=s; tie=false; } else if(best!==c && cmpScore(s,bs)===0) tie=true;
      }
      if(best && !tie){ m.set(best.id,'name'); byName++; }   // remis = niejednoznaczne → rozstrzygną importy
    }
    // (b) importy: pliki kodu importowane przez test (bez innych testów i plików pomocniczych)
    for(const e of graph.edges){
      if(e.type!=='import') continue;
      const m=subjects.get(e.source); if(!m || m.has(e.target) || e.target===e.source) continue;
      const t=graph.nodes.get(e.target);
      if(!t || t.type!=='file' || role.get(t.id) || !isCodeFile(t.path||t.id)) continue;
      m.set(t.id,'import'); byImport++;
    }
    // zapis: krawędzie, n.tests, n.testedBy
    let k=0; const tested=new Set();
    for(const tn of tests){
      const m=subjects.get(tn.id); tn.tests=[...m.keys()];
      for(const [sid, via] of m){
        graph.edges.push({id:'t'+(k++), source:tn.id, target:sid, type:'test', via});
        const s=graph.nodes.get(sid); (s.testedBy||(s.testedBy=[])).push(tn.id); tested.add(sid);
      }
    }
    let testedCode=0; for(const id of tested){ const n=graph.nodes.get(id); if(n && !role.get(id) && isCodeFile(n.path||n.id)) testedCode++; }
    graph.testInfo={tests:tests.length, helpers, subjects:tested.size, tested:testedCode, untested:Math.max(0, code-testedCode), code,
      pct:code?Math.round(testedCode/code*100):0, edges:k, byName, byImport, coverage:prevCov||null};
    return graph.testInfo;
  }

  // statystyki testów w poddrzewie folderu (panel szczegółów, ChatBot)
  function folderStats(graph, folder){
    const out={tests:0, helpers:0, tested:0, untested:0, code:0, untestedIds:[]};
    const stack=[folder];
    while(stack.length){
      const n=stack.pop(); if(!n) continue;
      if(n.type==='file'){
        if(n.isTest){ if(n.testHelper) out.helpers++; else out.tests++; }
        else if(isCodeFile(n.path||n.id)){ out.code++; if(n.testedBy&&n.testedBy.length) out.tested++; else { out.untested++; out.untestedIds.push(n.id); } }
        continue;
      }
      for(const c of (n.children||[])) stack.push(graph.nodes.get(c));
    }
    return out;
  }

  // ================= pokrycie: parsery =================
  // akumulator na plik: linie (numer → trafienia), gałęzie i funkcje (klucz → trafienia), podsumowania z raportu
  function accum(){ const acc=new Map(); acc.get2=(p)=>{ let a=acc.get(p); if(!a){ a={lines:new Map(), br:new Map(), fn:new Map(), sum:{}}; acc.set(p,a); } return a; }; return acc; }
  const hitCount=(m)=>{ let h=0; for(const v of m.values()) if(v>0) h++; return h; };
  const addHits=(m,k,h)=>{ m.set(k,(m.get(k)||0)+(h>0?h:0)); };
  const maxHits=(m,k,h)=>{ const p=m.get(k); if(p===undefined||p<h) m.set(k,h>0?h:0); };
  function finalize(acc){
    const out=new Map();
    for(const [p,a] of acc){
      const s=a.sum, e={lf:0, lh:0, bf:0, bh:0, ff:0, fh:0, lines:a.lines};
      if(a.lines.size){ e.lf=a.lines.size; e.lh=hitCount(a.lines); } else { e.lf=s.LF||0; e.lh=Math.min(s.LH||0, e.lf); }
      if(a.br.size){ e.bf=a.br.size; e.bh=hitCount(a.br); } else { e.bf=s.BRF||0; e.bh=Math.min(s.BRH||0, e.bf); }
      if(a.fn.size){ e.ff=a.fn.size; e.fh=hitCount(a.fn); } else { e.ff=s.FNF||0; e.fh=Math.min(s.FNH||0, e.ff); }
      out.set(p, e);
    }
    return out;
  }

  // lcov (tracefile): SF / DA / BRDA / FN / FNDA / FNA / LF / LH / BRF / BRH / FNF / FNH / end_of_record
  function parseLcov(text){
    const acc=accum(); let cur=null;
    for(const raw of String(text||'').split(/\r?\n/)){
      const line=raw.trim(); if(!line) continue;
      if(line==='end_of_record'){ cur=null; continue; }
      const i=line.indexOf(':'); if(i<0) continue;
      const k=line.slice(0,i), v=line.slice(i+1);
      if(k==='SF'){ cur=acc.get2(v.trim()); continue; }
      if(!cur) continue;
      switch(k){
        case 'DA': { const p=v.split(','); const n=+p[0]; if(n>0) addHits(cur.lines, n, +p[1]||0); break; }
        case 'BRDA': { const p=v.split(','); if(p.length>=4) addHits(cur.br, p[0]+','+p[1]+','+p[2], p[3]==='-'?0:(+p[3]||0)); break; }
        case 'FN': { const m=/^\d+,(?:\d+,)?(.*)$/.exec(v); const name=m?m[1]:v; if(!cur.fn.has(name)) cur.fn.set(name,0); break; }   // FN:linia,[koniec,]nazwa
        case 'FNDA': { const j=v.indexOf(','); if(j>0) addHits(cur.fn, v.slice(j+1), +v.slice(0,j)||0); break; }
        case 'FNA': { const p=/^\d+,(\d+),(.*)$/.exec(v); if(p) addHits(cur.fn, p[2], +p[1]||0); break; }   // lcov 2.x: FNA:indeks,trafienia,nazwa
        case 'LF': case 'LH': case 'BRF': case 'BRH': case 'FNF': case 'FNH': cur.sum[k]=Math.max(cur.sum[k]||0, +v||0); break;
      }
    }
    return finalize(acc);
  }

  // Istanbul / nyc / c8 / Vitest: coverage-final.json (statementMap+s, fnMap+f, branchMap+b) albo coverage-summary.json
  function parseIstanbul(json){
    let obj=json;
    if(typeof obj==='string') obj=JSON.parse(obj);
    if(!obj || typeof obj!=='object' || Array.isArray(obj)) throw new Error('coverage JSON: object expected');
    const acc=accum();
    for(const key of Object.keys(obj)){
      let v=obj[key]; if(!v || typeof v!=='object' || key==='total') continue;
      if(v.data && v.data.statementMap) v=v.data;   // starszy zapis {path:{data:{…}}}
      if(v.statementMap || v.s){
        const a=acc.get2(v.path||key), sm=v.statementMap||{}, s=v.s||{};
        for(const id in s){ const loc=sm[id]; const ln=loc&&loc.start&&loc.start.line; if(ln>0) maxHits(a.lines, ln, +s[id]||0); }   // linia = max z instrukcji (jak istanbul-lib-coverage)
        const fm=v.fnMap||{}, f=v.f||{};
        for(const id in f) maxHits(a.fn, id+':'+((fm[id]&&fm[id].name)||''), +f[id]||0);
        const b=v.b||{};
        for(const id in b){ const arr=Array.isArray(b[id])?b[id]:[]; arr.forEach((h,i)=>maxHits(a.br, id+','+i, +h||0)); }
      } else if(v.lines && typeof v.lines==='object' && 'total' in v.lines){
        const s=acc.get2(key).sum;
        s.LF=+v.lines.total||0; s.LH=+v.lines.covered||0;
        if(v.branches){ s.BRF=+v.branches.total||0; s.BRH=+v.branches.covered||0; }
        if(v.functions){ s.FNF=+v.functions.total||0; s.FNH=+v.functions.covered||0; }
      }
    }
    return finalize(acc);
  }

  // ---- XML bez DOMParsera (działa w harnessie i w workerze): atrybuty z tagu, encje ----
  function unXml(s){ return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi,(m,e)=>{ const l=e.toLowerCase();
    return l==='lt'?'<':l==='gt'?'>':l==='amp'?'&':l==='quot'?'"':l==='apos'?"'":String.fromCodePoint(l[1]==='x'?parseInt(l.slice(2),16):parseInt(l.slice(1),10)); }); }
  function attrs(s){ const o={}; const re=/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let m; while((m=re.exec(s))) o[m[1]]=unXml(m[2]!=null?m[2]:m[3]); return o; }

  // Cobertura (coverage.py, Jest cobertura, .NET coverlet, gcovr): <class filename> + <line number hits branch condition-coverage>
  function parseCobertura(xml){
    xml=String(xml||''); const acc=accum();
    const reC=/<class\b([^>]*?)(\/?)>/g; let m;
    while((m=reC.exec(xml))){
      const a=attrs(m[1]); if(!a.filename) continue;
      const cur=acc.get2(a.filename); if(m[2]==='/') continue;
      const end=xml.indexOf('</class>', reC.lastIndex);
      let body=xml.slice(reC.lastIndex, end<0?xml.length:end);
      reC.lastIndex=end<0?xml.length:end+8;
      // <methods> dubluje linie klasy — liczymy z niego tylko funkcje
      const ms=body.indexOf('<methods'), me=body.indexOf('</methods>');
      if(ms>=0 && me>ms){
        const meth=body.slice(ms, me); body=body.slice(0,ms)+body.slice(me+10);
        const reM=/<method\b([^>]*?)(\/?)>/g; let mm, i=0;
        while((mm=reM.exec(meth))){
          const ma=attrs(mm[1]); let hit=(+ma['line-rate']||0)>0;
          if(mm[2]!=='/'){ const e2=meth.indexOf('</method>', reM.lastIndex); const mb=meth.slice(reM.lastIndex, e2<0?meth.length:e2);
            if(/\bhits\s*=\s*["']0*[1-9]/.test(mb)) hit=true; reM.lastIndex=e2<0?meth.length:e2+9; }
          maxHits(cur.fn, (a.name||'')+'.'+(ma.name||'')+(ma.signature||'')+'#'+(i++), hit?1:0);
        }
      }
      const reL=/<line\b([^>]*?)\/?>/g; let lm;
      while((lm=reL.exec(body))){
        const la=attrs(lm[1]); const n=+la.number; if(!(n>0)) continue;
        addHits(cur.lines, n, +la.hits||0);
        const cc=la.branch==='true' && /\((\d+)\s*\/\s*(\d+)\)/.exec(la['condition-coverage']||'');
        if(cc){ const cov=+cc[1], tot=+cc[2]; for(let i=0;i<tot && i<64;i++) maxHits(cur.br, n+':'+i, i<cov?1:0); }
      }
    }
    return finalize(acc);
  }

  // JaCoCo XML: <package name> / <sourcefile name> / <line nr mi ci mb cb> / <counter type=METHOD> (poza <class>)
  function parseJacoco(xml){
    xml=String(xml||''); const acc=accum();
    const re=/<(\/?)(package|sourcefile|class|line|counter)\b([^>]*?)(\/?)>/g; let m, pkg='', cur=null, inClass=false;
    while((m=re.exec(xml))){
      const close=m[1]==='/', tag=m[2], self=m[4]==='/';
      if(tag==='package'){ if(close) pkg=''; else pkg=attrs(m[3]).name||''; continue; }
      if(tag==='class'){ if(!self) inClass=!close; continue; }
      if(tag==='sourcefile'){ if(close) cur=null; else { const nm=attrs(m[3]).name||''; cur=acc.get2((pkg?pkg+'/':'')+nm); if(self) cur=null; } continue; }
      if(!cur || close) continue;
      const a=attrs(m[3]);
      if(tag==='line'){
        const n=+a.nr, mi=+a.mi||0, ci=+a.ci||0, mb=+a.mb||0, cb=+a.cb||0; if(!(n>0)) continue;
        if(mi+ci>0) addHits(cur.lines, n, ci);
        for(let i=0;i<mb+cb && i<64;i++) maxHits(cur.br, n+':'+i, i<cb?1:0);
      } else if(tag==='counter' && !inClass){
        const miss=+a.missed||0, cov=+a.covered||0, s=cur.sum;
        if(a.type==='METHOD'){ s.FNF=miss+cov; s.FNH=cov; } else if(a.type==='LINE'){ s.LF=miss+cov; s.LH=cov; } else if(a.type==='BRANCH'){ s.BRF=miss+cov; s.BRH=cov; }
      }
    }
    return finalize(acc);
  }

  // Clover XML (PHPUnit, Jest/Istanbul „clover"): <file path|name> / <line num type count truecount falsecount> / <metrics>
  function parseClover(xml){
    xml=String(xml||''); const acc=accum();
    const re=/<(\/?)(file|class|line|metrics)\b([^>]*?)(\/?)>/g; let m, cur=null, inClass=false;
    while((m=re.exec(xml))){
      const close=m[1]==='/', tag=m[2], self=m[4]==='/';
      if(tag==='file'){ if(close) cur=null; else { const a=attrs(m[3]); cur=acc.get2(a.path||a.name||''); if(self) cur=null; } continue; }
      if(tag==='class'){ if(!self) inClass=!close; continue; }
      if(!cur || close) continue;
      const a=attrs(m[3]);
      if(tag==='line'){
        const n=+a.num; if(!(n>0)) continue;
        const tc=+a.truecount||0, fc=+a.falsecount||0, cnt=a.count!=null?(+a.count||0):(tc+fc);
        if(a.type==='method'){ maxHits(cur.fn, (a.name||'')+'@'+n, cnt); continue; }
        addHits(cur.lines, n, cnt);
        if(a.type==='cond'){ maxHits(cur.br, n+':t', tc); maxHits(cur.br, n+':f', fc); }
      } else if(tag==='metrics' && !inClass){
        const s=cur.sum;
        if(a.statements!=null){ s.LF=+a.statements||0; s.LH=+a.coveredstatements||0; }
        if(a.methods!=null){ s.FNF=+a.methods||0; s.FNH=+a.coveredmethods||0; }
        if(a.conditionals!=null){ s.BRF=+a.conditionals||0; s.BRH=+a.coveredconditionals||0; }
      }
    }
    return finalize(acc);
  }

  // format po nazwie pliku i treści
  function detectFormat(text, name){
    const n=String(name||'').toLowerCase(), s=String(text||''), head=s.slice(0,4096).replace(/^﻿/,'').trimStart();
    if(/\.(info|lcov)$/.test(n) || /^(TN|SF):/m.test(head) && head[0]!=='<' && head[0]!=='{') return 'lcov';
    if(head[0]==='{') return /coverage-summary/.test(n) || !/"statementMap"/.test(s.slice(0,200000)) && /"total"\s*:/.test(s) ? 'istanbul-summary' : 'istanbul';
    if(head[0]==='<'){
      if(/<report\b/.test(head) || (/<sourcefile\b/.test(s) && /<report\b/.test(s))) return 'jacoco';
      if(/<class\b[^>]*\bfilename\s*=/.test(s)) return 'cobertura';
      if(/<project\b/.test(s) && /<file\b/.test(s)) return 'clover';
      if(/<coverage\b/.test(head)) return 'cobertura';
    }
    return null;
  }
  // {format, files: Map} albo null (nieznany format)
  function parseCoverage(text, name){
    const format=detectFormat(text, name); if(!format) return null;
    const files=format==='lcov'?parseLcov(text):format==='jacoco'?parseJacoco(text):format==='cobertura'?parseCobertura(text)
      :format==='clover'?parseClover(text):parseIstanbul(text);
    return {format, files};
  }

  // ================= pokrycie: nałożenie na graf =================
  const isMapLike=(x)=>x && !Array.isArray(x) && typeof x.get==='function' && typeof x.entries==='function';
  function asReports(x){
    if(!x) return [];
    if(Array.isArray(x)) return x.flatMap(asReports);
    if(isMapLike(x)) return [{format:'', files:x}];
    if(isMapLike(x.files)) return [{format:x.format||'', files:x.files}];
    return [];
  }
  // kolejność zaufania: przy kilku raportach (np. Jest: lcov.info + coverage-final.json + clover.xml) jeden plik = jeden format
  const RANK={lcov:0, istanbul:1, cobertura:2, jacoco:3, clover:4, 'istanbul-summary':5, '':6};
  function mergeEntries(a,b){
    const lines=new Map(a.lines); for(const [k,v] of b.lines) lines.set(k,(lines.get(k)||0)+v);
    const e={lines, bf:Math.max(a.bf,b.bf), bh:Math.max(a.bh,b.bh), ff:Math.max(a.ff,b.ff), fh:Math.max(a.fh,b.fh)};
    if(lines.size){ e.lf=lines.size; e.lh=hitCount(lines); } else { e.lf=Math.max(a.lf,b.lf); e.lh=Math.max(a.lh,b.lh); }
    return e;
  }
  // ścieżka raportu → segmenty (absolutne Windows/Linux, file://, ./, backslashe)
  function reportSegs(p){
    return String(p||'').trim().replace(/^file:\/\/\/?/i,'').replace(/\\/g,'/').replace(/^[A-Za-z]:(?=\/)/,'')
      .split('/').filter(s=>s && s!=='.' && s!=='..');
  }
  function buildIndex(graph){
    const idx=new Map();
    for(const n of graph.nodes.values()){
      if(n.type!=='file') continue;
      const segs=String(n.path||n.id).split('/'); const b=segs[segs.length-1];
      let a=idx.get(b); if(!a) idx.set(b,a=[]); a.push({n, segs});
      const lb=b.toLowerCase(); if(lb!==b){ let a2=idx.get(lb); if(!a2) idx.set(lb,a2=[]); a2.push({n, segs, ci:true}); }
    }
    return idx;
  }
  // najdłuższy wspólny sufiks segmentów; remis = niejednoznaczne. Dopasowanie tylko po nazwie pliku (sufiks 1)
  // wymaga, by raport albo graf nie miał nic więcej w ścieżce (np. Cobertura względem <source>)
  function matchPath(idx, p){
    const rs=reportSegs(p); if(!rs.length) return null;
    const b=rs[rs.length-1];
    let cands=idx.get(b), ci=false;
    if(!cands){ cands=idx.get(b.toLowerCase()); ci=true; }
    if(!cands) return null;
    const R=ci?rs.map(s=>s.toLowerCase()):rs;
    let best=null, bestL=0, tie=false;
    for(const c of cands){
      const G=ci?c.segs.map(s=>s.toLowerCase()):c.segs;
      const L=commonSuffix(R, G);
      if(L>bestL){ best=c; bestL=L; tie=false; } else if(L===bestL && best && best.n!==c.n) tie=true;
    }
    if(!best || tie) return null;
    if(bestL<2 && bestL<rs.length && bestL<best.segs.length) return null;
    return {n:best.n, L:bestL};
  }
  // [[od,do],…] — kolejne niepokryte linie scalone (linie bez instrukcji między nimi nie przerywają zakresu)
  function uncoveredRanges(lines, max){
    max=max||200;
    const ks=[...lines.keys()].sort((a,b)=>a-b), out=[]; let s=null, last=null;
    for(const k of ks){
      if(lines.get(k)>0){ if(s!=null){ out.push([s,last]); s=null; if(out.length>=max) return out; } }
      else { if(s==null) s=k; last=k; }
    }
    if(s!=null && out.length<max) out.push([s,last]);
    return out;
  }
  const pctOf=(h,t)=>t?Math.round(h/t*1000)/10:null;
  function fmtRanges(ranges, limit){
    limit=limit||12; const r=ranges||[];
    const s=r.slice(0,limit).map(x=>x[0]===x[1]?String(x[0]):(x[0]+'–'+x[1])).join(', ');
    return r.length>limit?s+', …':s;
  }

  // applyCoverage(graph, raporty, {source}) → graph.testInfo.coverage; raporty = Map | {format, files} | tablica
  function applyCoverage(graph, reports, opts){
    opts=opts||{};
    const list=asReports(reports).sort((a,b)=>(RANK[a.format]??6)-(RANK[b.format]??6));
    const merged=new Map();   // klucz ścieżki raportu → {e, format}
    for(const r of list){
      for(const [p, e] of r.files){
        const key=reportSegs(p).join('/'); if(!key) continue;
        const prev=merged.get(key);
        if(!prev) merged.set(key, {e, format:r.format});
        else if(prev.format===r.format) prev.e=mergeEntries(prev.e, e);   // inny format tego samego pliku — pierwszy wygrywa
      }
    }
    for(const n of graph.nodes.values()) if(n.coverage) delete n.coverage;
    const idx=buildIndex(graph), assigned=new Map(), unmatchedSample=[];
    let unmatched=0;
    for(const [p, {e}] of merged){
      const m=matchPath(idx, p);
      if(!m){ unmatched++; if(unmatchedSample.length<10) unmatchedSample.push(p); continue; }
      const prev=assigned.get(m.n.id);
      if(!prev) assigned.set(m.n.id, {n:m.n, e, L:m.L});
      else if(m.L>prev.L){ prev.e=e; prev.L=m.L; }
      else if(m.L===prev.L) prev.e=mergeEntries(prev.e, e);
    }
    const T={lh:0, lf:0, bh:0, bf:0, fh:0, ff:0};
    const K=['lh','lf','bh','bf','fh','ff'];
    for(const {n, e} of assigned.values()){
      n.coverage={pct:pctOf(e.lh,e.lf), lh:e.lh, lf:e.lf, bh:e.bh, bf:e.bf, fh:e.fh, ff:e.ff, uncovered:uncoveredRanges(e.lines, 200)};
      for(const k of K) T[k]+=e[k];
      // foldery = suma dzieci (w górę po rodzicach)
      let p=n.parent!=null?graph.nodes.get(n.parent):null;
      while(p){
        const c=p.coverage||(p.coverage={pct:null, lh:0, lf:0, bh:0, bf:0, fh:0, ff:0, files:0});
        for(const k of K) c[k]+=e[k]; c.files++;
        p=p.parent!=null?graph.nodes.get(p.parent):null;
      }
    }
    for(const n of graph.nodes.values()) if(n.type!=='file' && n.coverage) n.coverage.pct=pctOf(n.coverage.lh, n.coverage.lf);
    const formats=[...new Set(list.map(r=>r.format).filter(Boolean))];
    const info={files:assigned.size, matched:merged.size-unmatched, unmatched, total:merged.size, pct:pctOf(T.lh,T.lf),
      lh:T.lh, lf:T.lf, bh:T.bh, bf:T.bf, fh:T.fh, ff:T.ff, source:opts.source||'', format:formats.join('+'), at:opts.at||Date.now(), unmatchedSample};
    if(!graph.testInfo) graph.testInfo={tests:0, helpers:0, subjects:0, tested:0, untested:0, code:0, pct:0, edges:0, byName:0, byImport:0};
    graph.testInfo.coverage=info;
    return info;
  }
  function clearCoverage(graph){
    for(const n of graph.nodes.values()) if(n.coverage) delete n.coverage;
    if(graph.testInfo) graph.testInfo.coverage=null;
  }

  return { testRole, isTestFile, isTestHelper, isCodeFile, testStem, mapTests, folderStats,
    parseLcov, parseIstanbul, parseCobertura, parseJacoco, parseClover, detectFormat, parseCoverage,
    applyCoverage, clearCoverage, uncoveredRanges, fmtRanges, reportSegs };
})();
