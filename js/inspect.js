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
    'r.pkgcycle':'Cykle między pakietami','r.pkgcycle.d':'Pakiety monorepo (package.json, Cargo.toml, go.mod, pubspec, pyproject) zależne od siebie nawzajem — nie da się ich wydać, zbudować ani przetestować osobno. Widać je nad przekątną macierzy zależności (Projekt → Macierz zależności).',
    'r.god':'God-file (hub o zbyt wielu połączeniach)','r.god.d':'Plik powiązany z nienaturalnie dużą liczbą innych — zmiana w nim dotyka wszystkiego.',
    'r.fanout':'Zbyt wiele zależności wychodzących','r.fanout.d':'Plik importuje bardzo dużo modułów — prawdopodobnie robi zbyt wiele naraz.',
    'r.unstable':'Niestabilny hub (duży fan-in i fan-out)','r.unstable.d':'Wiele plików od niego zależy, a on sam zależy od wielu — najbardziej ryzykowne miejsce na zmiany.',
    'r.unusedexport':'Nieużywane eksporty','r.unusedexport.d':'Eksporty JS/TS, których żaden plik projektu nie importuje (także przez barrel `export *`) — do usunięcia albo do zdjęcia `export`; pomijane wejścia pakietów (exports, main, bin, index/main/cli), testy i pliki, których nikt nie importuje (to osierocone pliki). Python: funkcje i klasy najwyższego poziomu, do których nazwy nic się nie odwołuje (jak vulture), bez dekorowanych, dunderów i API z __init__.py.','unexp':'{n} nieużywanych: {names}',
    'r.orphan':'Osierocone pliki (podejrzenie martwego kodu)','r.orphan.d':'Pliki kodu bez żadnych importów w obie strony — być może nieużywane.',
    'r.huge':'Bardzo długie pliki','r.huge.d':'Pliki o ekstremalnej liczbie linii — kandydaci do podziału.',
    'r.complex':'Wysoka złożoność cyklomatyczna','r.complex.d':'Bardzo dużo rozgałęzień (if/for/case/&&) w jednym pliku.',
    'r.todo':'Zagęszczenie TODO / FIXME','r.todo.d':'Duża liczba znaczników TODO/FIXME/HACK — dług techniczny zapisany wprost.',
    'r.deep':'Głębokie zagnieżdżenie folderów','r.deep.d':'Ścieżki o dużej głębokości utrudniają nawigację i świadczą o przerośniętej strukturze.',
    'r.crowded':'Przeładowane foldery','r.crowded.d':'Folder z bardzo dużą liczbą plików bezpośrednio w środku — brak pogrupowania.',
    'r.dupcode':'Zduplikowany kod (wspólne bloki)','r.dupcode.d':'Pary plików z ciągłym identycznym blokiem kodu ≥ 50 tokenów (winnowing z wyrównaniem pozycji, jak jscpd; białe znaki nieistotne; bez dokumentów, konfiguracji i plików generowanych) — kandydaci do wyciągnięcia wspólnej funkcji.',
    'dupShare':'{a} i {b} — wspólny kod, tokeny: {n}, bloki: {k}',
    'r.emptycatch':'Puste bloki catch (połykanie wyjątków)','r.emptycatch.d':'`catch { }` bez obsługi ukrywa błędy. (Heurystyka na pierwszych 4000 znakach pliku.)',
    'r.risky':'Ryzykowne API (bezpieczeństwo)','r.risky.d':'Użycia eval / innerHTML= / document.write — potencjalne wektory XSS. (Heurystyka na pierwszych 4000 znakach; pliki testów pominięte.)',
    'r.debug':'Pozostałości debugowania','r.debug.d':'Liczne console.log / debugger w kodzie produkcyjnym. (Heurystyka na pierwszych 4000 znakach.)',
    'r.minified':'Pliki zminifikowane / vendored','r.minified.d':'Wyglądają na zbudowane/obce artefakty — zwykle warto je wykluczyć z analizy.',
    'r.archviolation':'Naruszenia reguł architektury','r.archviolation.d':'Importy zakazane przez `.codemap.rules.json` w repozytorium (warstwy, `forbid`, `noCycles`).',
    'r.archrules':'Plik reguł architektury nie dał się wczytać','r.archrules.d':'`.codemap.rules.json` istnieje, ale nie jest poprawnym JSON-em o oczekiwanym kształcie — reguły nie były sprawdzane.',
    'r.untested':'Złożone pliki bez testów','r.untested.d':'Pliki kodu o złożoności ≥ 15 albo ≥ 200 liniach, do których nie prowadzi żaden test (ani po nazwie, ani po importach). Reguła działa tylko w projektach z plikami testowymi.',
    'r.lowcov':'Niskie pokrycie testami','r.lowcov.d':'Pliki o złożoności ≥ 10 z pokryciem linii poniżej 50 % według wczytanego raportu (lcov / Istanbul / Cobertura / JaCoCo / Clover).',
    'covPct':'pokrycie {p} % ({lh}/{lf} linii)',
    'r.gitHotspot':'Hotspoty zmian (historia git)','r.gitHotspot.d':'Pliki jednocześnie często zmieniane i złożone (zmiany × złożoność, górne 10 %) — tu kumulują się błędy i koszt każdej zmiany; najlepsi kandydaci do refaktoryzacji.',
    'r.silo':'Wiedza w jednej głowie (historia git)','r.silo.d':'Złożone, często zmieniane pliki, w których ≥ 90 % zmian pochodzi od jednej osoby — jej nieobecność zatrzymuje pracę nad nimi. Reguła działa w projektach z co najmniej dwoma autorami.',
    'gitHot':'{c} zmian × złożoność {cx}','silo':'{who}: {s} % z {c} zmian',
    'r.hiddencoupling':'Ukryte sprzężenie zmian (historia git)','r.hiddencoupling.d':'Pliki kodu zmieniane razem w co najmniej połowie swoich commitów (min. 5 wspólnych), choć żaden nie importuje drugiego — zależność przez globalne nazwy, konfigurację, klucze tekstów albo protokół. Rozważ jawny import lub wspólny moduł. (Bez testów, masowych commitów > 30 plików i plików z < 5 zmianami.)',
    'coupled':'razem z {b} — wspólne commity: {n}, stopień: {d} %',
    'r.unowned':'Kod bez właściciela (CODEOWNERS)','r.unowned.d':'Pliki kodu, których nie obejmuje żadna reguła CODEOWNERS (albo reguła bez właścicieli) — przegląd ich zmian nie trafi do nikogo. Jedna pozycja na folder.',
    'unowned':'plików bez właściciela: {n}',
    'r.ownerdrift':'Rozjazd CODEOWNERS z historią git','r.ownerdrift.d':'Deklarowany właściciel (osoba rozpoznana w historii) ma < 10 % zmian pliku, a ktoś inny ≥ 50 % z co najmniej 5 — CODEOWNERS nie wskazuje osoby, która naprawdę zna ten kod.',
    'drift':'CODEOWNERS: {o} · git: {who} {s} % z {c} zmian',
    'r.vulndep':'Podatne zależności (OSV.dev)','r.vulndep.d':'Zależności ze znanymi podatnościami wg OSV.dev — sprawdzane tylko na żądanie (wysyłane są wyłącznie nazwy i wersje pakietów). Wersje z plików blokad (także przechodnie) albo z manifestów; ważność wg bazy (GHSA) albo CVSS 3.',
    'vuln':'{p} {v}: podatności {n} — {ids}{fix}{tr}','vulnFix':' · poprawka: {f}','vulnTr':' · przechodnia',
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
    'r.pkgcycle':'Cycles between packages','r.pkgcycle.d':'Monorepo packages (package.json, Cargo.toml, go.mod, pubspec, pyproject) depending on each other — they cannot be released, built or tested separately. They show above the diagonal of the dependency matrix (Project → Dependency matrix).',
    'r.god':'God-file (over-connected hub)','r.god.d':'A file linked to an unnaturally high number of others — changing it touches everything.',
    'r.fanout':'Too many outgoing dependencies','r.fanout.d':'The file imports a lot of modules — it probably does too much at once.',
    'r.unstable':'Unstable hub (high fan-in AND fan-out)','r.unstable.d':'Many files depend on it while it depends on many — the riskiest place to change.',
    'r.unusedexport':'Unused exports','r.unusedexport.d':'JS/TS exports no project file imports (also through an `export *` barrel) — remove them or drop `export`; package entry points (exports, main, bin, index/main/cli), tests and files nobody imports (orphan files) are skipped. Python: top-level functions and classes whose name nothing references (like vulture), except decorated ones, dunders and the __init__.py API.','unexp':'{n} unused: {names}',
    'r.orphan':'Orphan files (dead-code suspects)','r.orphan.d':'Code files with no imports either way — possibly unused.',
    'r.huge':'Very long files','r.huge.d':'Files with an extreme line count — candidates for splitting.',
    'r.complex':'High cyclomatic complexity','r.complex.d':'A very large number of branches (if/for/case/&&) in one file.',
    'r.todo':'TODO / FIXME density','r.todo.d':'Many TODO/FIXME/HACK markers — technical debt written down.',
    'r.deep':'Deep folder nesting','r.deep.d':'Very deep paths hamper navigation and hint at an overgrown structure.',
    'r.crowded':'Crowded folders','r.crowded.d':'A folder with very many files directly inside — no grouping.',
    'r.dupcode':'Duplicated code (shared blocks)','r.dupcode.d':'Pairs of files with a contiguous identical code block of ≥ 50 tokens (winnowing with position alignment, like jscpd; whitespace-insensitive; docs, config and generated files excluded) — candidates for extracting a shared function.',
    'dupShare':'{a} and {b} — shared code, tokens: {n}, blocks: {k}',
    'r.emptycatch':'Empty catch blocks (exception swallowing)','r.emptycatch.d':'`catch { }` with no handling hides errors. (Heuristic over the first 4000 chars.)',
    'r.risky':'Risky APIs (security)','r.risky.d':'Uses of eval / innerHTML= / document.write — potential XSS vectors. (Heuristic over the first 4000 chars; test files skipped.)',
    'r.debug':'Debug leftovers','r.debug.d':'Multiple console.log / debugger in production code. (Heuristic over the first 4000 chars.)',
    'r.minified':'Minified / vendored files','r.minified.d':'Look like built/third-party artifacts — usually worth excluding from analysis.',
    'r.archviolation':'Architecture rule violations','r.archviolation.d':'Imports forbidden by `.codemap.rules.json` in the repository (layers, `forbid`, `noCycles`).',
    'r.archrules':'Architecture rules file could not be loaded','r.archrules.d':'`.codemap.rules.json` exists but is not valid JSON of the expected shape — rules were not checked.',
    'r.untested':'Complex files without tests','r.untested.d':'Code files with complexity ≥ 15 or ≥ 200 lines that no test reaches (neither by name nor by imports). Only checked in projects that have test files.',
    'r.lowcov':'Low test coverage','r.lowcov.d':'Files with complexity ≥ 10 and line coverage below 50 % according to the loaded report (lcov / Istanbul / Cobertura / JaCoCo / Clover).',
    'covPct':'coverage {p} % ({lh}/{lf} lines)',
    'r.gitHotspot':'Change hotspots (git history)','r.gitHotspot.d':'Files that are both changed often and complex (changes × complexity, top 10 %) — bugs and the cost of every change pile up here; the best refactoring candidates.',
    'r.silo':'Knowledge in one head (git history)','r.silo.d':'Complex, frequently changed files where ≥ 90 % of changes come from one person — their absence stalls work on them. Checked in projects with at least two authors.',
    'gitHot':'{c} changes × complexity {cx}','silo':'{who}: {s} % of {c} changes',
    'r.hiddencoupling':'Hidden change coupling (git history)','r.hiddencoupling.d':'Code files changed together in at least half of their commits (min. 5 shared) although neither imports the other — a dependency through globals, configuration, string keys or a protocol. Consider an explicit import or a shared module. (Tests, bulk commits > 30 files and files with < 5 changes excluded.)',
    'coupled':'with {b} — shared commits: {n}, degree: {d} %',
    'r.unowned':'Code without an owner (CODEOWNERS)','r.unowned.d':'Code files not covered by any CODEOWNERS rule (or by a rule without owners) — reviews of their changes reach nobody. One entry per folder.',
    'unowned':'files without an owner: {n}',
    'r.ownerdrift':'CODEOWNERS drift from git history','r.ownerdrift.d':'The declared owner (a person found in the history) has < 10 % of the file\'s changes while someone else has ≥ 50 % of at least 5 — CODEOWNERS does not point to the person who actually knows this code.',
    'drift':'CODEOWNERS: {o} · git: {who} {s} % of {c} changes',
    'r.vulndep':'Vulnerable dependencies (OSV.dev)','r.vulndep.d':'Dependencies with known vulnerabilities according to OSV.dev — checked on request only (just package names and versions are sent). Versions from lockfiles (transitive too) or manifests; severity from the database (GHSA) or CVSS 3.',
    'vuln':'{p} {v}: vulnerabilities {n} — {ids}{fix}{tr}','vulnFix':' · fixed in: {f}','vulnTr':' · transitive',
  }};
  function t(k,sub){ const l=I.getLang(); const d=STR[l]||STR.pl; let s=(d&&k in d)?d[k]:(STR.pl[k]||k); if(sub) for(const p in sub) s=s.replace('{'+p+'}',sub[p]); return s; }

  /* ---------------- rules engine ---------------- */
  const SEV_W={high:6, med:3, low:1, info:0};                    // weights for the health score
  // błąd w jednej regule nie przerywa raportu, ale nie znika po cichu (konsola; w CLI — stderr)
  // JS bez treści napisów i komentarzy (cudzysłowy zostają, komentarz → znacznik „C") — `catch {}` w napisie albo
  // komentarzu to nie kod, a `catch(e){ /* powód */ }` to świadome zignorowanie z uzasadnieniem, nie puste catch
  function codeOnly(src){
    let out='', i=0; const n=src.length;
    while(i<n){
      const c=src[i], d=src[i+1];
      if(c==='/'&&d==='/'){ while(i<n&&src[i]!=='\n') i++; out+='C'; continue; }   // komentarz → znacznik: catch z uzasadnieniem nie jest pusty
      if(c==='/'&&d==='*'){ const e=src.indexOf('*/',i+2); i=e<0?n:e+2; out+='C'; continue; }
      // literał regex (`/` po operatorze, nawiasie albo na początku linii — nie dzielenie) → pusty `/ /`: wzorzec z
      // `innerHTML` czy `eval` to tekst, nie wywołanie
      if(c==='/' && /(^|[=(,:;!&|?{}[\n]|\breturn)\s*$/.test(out.slice(-12))){
        let j=i+1, cls=false;
        while(j<n && src[j]!=='\n' && (cls || src[j]!=='/')){ if(src[j]==='\\') j++; else if(src[j]==='[') cls=true; else if(src[j]===']') cls=false; j++; }
        if(j<n && src[j]==='/'){ out+='/ /'; i=j+1; continue; }
      }
      // napis → pusty literał; szablon z ${…} → `$` (dane wstawiane do HTML-a — reguła ryzyka ma go widzieć)
      if(c==='"'||c==="'"||c==='`'){ const s0=i; out+=c; i++; while(i<n&&src[i]!==c&&!(c!=='`'&&src[i]==='\n')){ if(src[i]==='\\') i++; i++; } if(c==='`'&&src.slice(s0,i).includes('${')) out+='$'; out+=c; i++; continue; }
      out+=c; i++;
    }
    return out;
  }
  const ruleFail=(rule,e)=>{ if(typeof console!=='undefined') console.warn('[CodeMap] reguła '+rule+':', e&&e.message||e); };
  const LIMIT=60;                                                 // max stored items per rule (UI shows fewer)
  // MessageChannel yield: gives the event loop room WITHOUT the background-tab setTimeout
  // throttling (~1s/tick hidden) — chunked analysis stays fast even in a non-focused tab
  // (bez MessageChannel — Node/CLI — zwykły setTimeout; port z onmessage trzymałby tam proces przy życiu)
  const tick=typeof MessageChannel==='undefined' ? ()=>new Promise(r=>setTimeout(r,0))
    : ()=>new Promise(r=>{ const ch=new MessageChannel(); ch.port1.onmessage=()=>r(); ch.port2.postMessage(0); });
  const ENTRY_RE=/^(index|main|app|server|cli|setup|conf(ig)?|__init__|__main__|mod|lib|test.*|.*\.(test|spec)|.*\.d)$/i;
  const CODE_JS=/^(js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/i;
  // real programming languages only — manifests/docs/styles being "orphans" is normal, not a smell
  const CODE_RE=/^(js|jsx|ts|tsx|mjs|cjs|vue|svelte|py|java|go|rb|php|cs|cpp|cxx|cc|c|h|hpp|rs|kt|kts|swift|scala|dart|lua|pl|r|jl|ex|exs|erl|hs|ml|fs|clj|groovy|zig|nim|v|sol)$/i;
  // kolejność reguł w raporcie (= wszystkie identyfikatory reguł; CLI waliduje nimi --fail-on)
  const ORDER=['archviolation','vulndep','pkgcycle','cycles','god','unstable','fanout','gitHotspot','huge','complex','lowcov','untested','silo','hiddencoupling','ownerdrift','unowned','risky','dupcode','orphan','unusedexport','emptycatch','debug','todo','deep','crowded','minified','archrules'];

  // returns {findings:[{rule,sev,items:[{id,name,path,detail,sev,related?}],count}], score, files, ms}
  // item.sev = ważność tej pozycji (f.sev = pierwszej; liczy się do wyniku), related = id powiązanych węzłów (SARIF)
  async function run(graph){
    const t0=performance.now();
    const nodes=[...graph.nodes.values()];
    const files=nodes.filter(n=>n.type==='file');
    const folders=nodes.filter(n=>n.type==='folder');
    const N=files.length||1;
    const add=(map,rule,sev,n,detail,related)=>{ let f=map.get(rule); if(!f){ f={rule,sev,items:[],count:0}; map.set(rule,f); }
      f.count++; if(f.items.length<LIMIT){ const it={id:n.id,name:n.name,path:n.path||n.name,detail,sev}; if(related&&related.length) it.related=related; f.items.push(it); } };
    const F=new Map();

    // ---- graph rules: fan-in / fan-out over import+reference edges (single O(E) pass) ----
    const fin=new Map(), fout=new Map();
    { let i=0; for(const e of graph.edges){ if(e.type==='contains'||e.type==='test') continue;   // test → kod to nie zależność
        fout.set(e.source,(fout.get(e.source)||0)+1); fin.set(e.target,(fin.get(e.target)||0)+1);
        if((++i&8191)===0) await tick(); } }
    const degs=files.map(f=>(fin.get(f.id)||0)+(fout.get(f.id)||0));
    const mean=degs.reduce((a,b)=>a+b,0)/N;
    const sd=Math.sqrt(degs.reduce((a,b)=>a+(b-mean)*(b-mean),0)/N)||1;
    const godThr=Math.max(20, mean+3*sd);
    // no dependency edges at all (tree-only load, no file contents) → orphan detection is meaningless
    const hasDeps=fin.size>0||fout.size>0;
    // testy (CM.TestMap): „złożony plik bez testów" tylko, gdy projekt ma pliki testowe; „niskie pokrycie" po wczytaniu raportu
    const TM=CM.TestMap, ti=graph.testInfo&&graph.testInfo.tests!=null ? graph.testInfo : (TM ? TM.mapTests(graph) : null);
    const hasTests=!!(ti && ti.tests>0), hasCov=!!(ti && ti.coverage && ti.coverage.files>0);
    const isCode=(f)=>TM ? TM.isCodeFile(f.path||f.id) : CODE_RE.test(f.lang||'');
    const untested=[], lowcov=[];

    let idx=0;
    for(const f of files){
      if((++idx&2047)===0) await tick();                          // keep UI alive on 100k+ files
      const fi=fin.get(f.id)||0, fo=fout.get(f.id)||0, deg=fi+fo;
      const m=f.metrics;
      const base=(f.name||'').replace(/\.[^.]+$/,'');
      // „god" = węzeł-hub (hub-like modularization): dużo zależności w OBIE strony; plik wejściowy (fan-in 0, np.
      // index.html) to co najwyżej fan-out, a pomocnik testów czy util z samym fan-in nie jest hubem
      const hub=deg>=godThr && fi>=3 && fo>=3 && !f.isTest && !f.testHelper;
      if(hub) add(F,'god','high',f, deg+' '+t('deps')+' (fan-in '+fi+' / fan-out '+fo+')');
      else if(fo>=15) add(F,'fanout','med',f, 'fan-out '+fo);
      if(fi>=8&&fo>=8&&!hub) add(F,'unstable','med',f, 'fan-in '+fi+' / fan-out '+fo);
      if(hasDeps && deg===0 && !f.isTest && CODE_RE.test(f.lang||'') && !ENTRY_RE.test(base)) add(F,'orphan','low',f, (m?m.lines+' '+t('loc'):U.fmtBytes(f.size||0)));
      if(m){
        const minified = m.longest>2500 || (m.lines>1 && m.chars/m.lines>600);
        if(minified){ add(F,'minified','info',f, m.longest+' ch/line'); }
        else{
          const gen=CM.Metrics&&CM.Metrics.isGenerated ? CM.Metrics.isGenerated(f) : false;   // lockfile, „DO NOT EDIT"
          if(m.lines>=800 && !gen) add(F,'huge', m.lines>=2000?'high':'med', f, m.lines+' '+t('loc'));
          if(m.complexity>=150) add(F,'complex', m.complexity>=400?'high':'med', f, 'CC≈'+m.complexity);
          if(m.todos>=10) add(F,'todo','low',f, m.todos+' × TODO/FIXME');
          if(!f.isTest && isCode(f)){
            const cx=m.complexity||0;
            if(hasTests && !(f.testedBy&&f.testedBy.length) && (cx>=15 || m.lines>=200)) untested.push(f);
            const cv=f.coverage;
            if(hasCov && cv && cv.pct!=null && cv.pct<50 && cx>=10) lowcov.push(f);
          }
        }
        const pv=f.preview;
        if(pv && !minified && CODE_JS.test(f.lang||'')){
          const ec=(codeOnly(pv).match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)||[]).length;   // bez napisów i komentarzy
          if(ec) add(F,'emptycatch','low',f, t('ln',{n:ec}));
          // tylko kod (napisy puste, komentarze pominięte): innerHTML = '' / stały HTML bez danych nie jest ryzykiem, a
          // `innerHTML=` wewnątrz napisu (kod ramki, skrypt strony w teście) nie jest przypisaniem w tym pliku
          const risky=(codeOnly(pv).match(/\beval\s*\(|\.innerHTML\s*=(?!=|\s*(''|""|``)\s*[;,)}\n])|document\.write\s*\(|dangerouslySetInnerHTML/g)||[]).length;
          if(risky && !f.isTest) add(F,'risky','med',f, t('ln',{n:risky}));   // testy celowo wstawiają HTML (sanityzacja) — to nie wektor XSS
          const dbg=(pv.match(/console\.log\s*\(|(^|\n)\s*debugger\b/g)||[]).length;
          if(dbg>=5) add(F,'debug','low',f, t('ln',{n:dbg}));
        }
      }
    }

    // ---- testy: najpierw najbardziej złożone / najsłabiej pokryte (listy mają limit LIMIT) ----
    untested.sort((a,b)=>(b.metrics.complexity||0)-(a.metrics.complexity||0) || b.metrics.lines-a.metrics.lines);
    for(const f of untested){ const m=f.metrics;
      add(F,'untested', (m.complexity>=50||m.lines>=600)?'med':'low', f, 'CC≈'+(m.complexity||0)+' · '+m.lines+' '+t('loc')); }
    lowcov.sort((a,b)=>a.coverage.pct-b.coverage.pct || (b.metrics.complexity||0)-(a.metrics.complexity||0));
    for(const f of lowcov){ const c=f.coverage;
      add(F,'lowcov', c.pct<20?'med':'low', f, t('covPct',{p:String(c.pct).replace('.', I.getLang()==='en'?'.':','), lh:c.lh, lf:c.lf})+' · CC≈'+(f.metrics.complexity||0)); }

    // ---- historia git (CM.GitCore): hotspoty zmian i „wiedza w jednej głowie" ----
    const gi=graph.gitInfo;
    if(gi && CM.GitCore){ try{
      const withGit=files.filter(f=>f.git&&f.git.c&&f.metrics);
      const scored=withGit.map(f=>[f, CM.GitCore.hotspotScore(f)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
      const cut=scored.length?scored[Math.min(scored.length-1, Math.floor(scored.length*0.1))][1]:Infinity;
      for(const [f,s] of scored){ if(s<cut || f.git.c<5 || (f.metrics.complexity||0)<15) continue;
        add(F,'gitHotspot', s>=cut*3?'med':'low', f, t('gitHot',{c:f.git.c, cx:f.metrics.complexity||0})); }
      const humans=(gi.authors||[]).filter(a=>!a.bot).length;
      if(humans>=2) for(const f of withGit){ const g=f.git, cx=f.metrics.complexity||0;
        if(g.own==null || g.share<0.9 || g.c<5 || (cx<20 && (f.metrics.lines||0)<300)) continue;
        const who=(gi.authors[g.own]||{}).name||'?';
        add(F,'silo','low',f, t('silo',{who, s:Math.round(g.share*100), c:g.c})); }
    }catch(e){ ruleFail('silo', e); } }

    // ---- ukryte sprzężenie zmian: pary kodu zmieniane razem (CM.GitCore.coupling, jak code-maat), bez importu ----
    if(graph.gitInfo && CM.GitCore && CM.GitCore.coupling){ try{
      const byPath=new Map(); for(const f of files) if(f.path) byPath.set(f.path,f);
      const linked=(a,b)=>(a.importsOut||[]).includes(b.id)||(b.importsOut||[]).includes(a.id);
      const hidden=[];
      for(const p of CM.GitCore.coupling(graph.gitInfo)){
        if(p.degree<0.5 || p.shared<5) continue;
        const a=byPath.get(p.a), b=byPath.get(p.b);
        if(!a||!b||a.isTest||b.isTest||!isCode(a)||!isCode(b)||linked(a,b)) continue;   // test ↔ kod zmieniają się razem z natury
        hidden.push([a,b,p]);
      }
      for(const [a,b,p] of hidden.slice(0,LIMIT)) add(F,'hiddencoupling','low',a, t('coupled',{b:b.name, n:p.shared, d:Math.round(p.degree*100)}), [b.id]);
      if(hidden.length>LIMIT){ const f=F.get('hiddencoupling'); if(f) f.count=hidden.length; }
    }catch(e){ /* brak osi czasu w starszej mapie — reguła pominięta */ } }

    // ---- nieużywane eksporty JS/TS (CM.DeadCode): nazwy z klauzul importu, barrel `export *`, wejścia pakietów ----
    if(CM.DeadCode && hasDeps){ try{
      const dead=CM.DeadCode.analyze(graph);
      for(const d of dead.slice(0,LIMIT)){
        const names=d.exports.slice(0,6).map(x=>x.name+':'+x.line).join(', ')+(d.exports.length>6?', …':'');
        add(F,'unusedexport','low',graph.nodes.get(d.id), t('unexp',{n:d.exports.length, names}));
      }
      if(dead.length>LIMIT){ const f=F.get('unusedexport'); if(f) f.count=dead.length; }
    }catch(e){ ruleFail('unusedexport', e); } }

    // ---- podatne zależności: wynik sprawdzenia OSV.dev zapisany na grafie (CM.Vulns.applyToGraph) ----
    if(graph.vulnInfo && Array.isArray(graph.vulnInfo.items)){ try{
      const SEV={CRITICAL:'high', HIGH:'high', MODERATE:'med', MEDIUM:'med', LOW:'low'};
      const items=graph.vulnInfo.items.slice().sort((a,b)=>((CM.Vulns&&CM.Vulns.RANK[b.level])||0)-((CM.Vulns&&CM.Vulns.RANK[a.level])||0));
      for(const it of items){
        const n=graph.nodes.get(it.file)||graph.nodes.get('ext:'+it.name)||graph.root;
        const ids=it.vulns.slice(0,3).map(v=>v.id+(v.level?' ('+v.level+')':'')).join(', ')+(it.vulns.length>3?', …':'');
        add(F,'vulndep',SEV[it.level]||'med',n, t('vuln',{p:it.name, v:it.version, n:it.vulns.length, ids, fix:it.fixed?t('vulnFix',{f:it.fixed}):'', tr:it.direct===false?t('vulnTr'):''}));
      }
    }catch(e){ /* uszkodzony wynik w zapisanej mapie — reguła pominięta */ } }

    // ---- CODEOWNERS a własność z historii git (CM.CodeOwners) ----
    if(CM.CodeOwners){ try{
      const co=CM.CodeOwners.analyze(graph);
      if(co){
        const byDir=new Map();                                     // bez właściciela: jedna pozycja na folder
        for(const id of co.unowned){ const n=graph.nodes.get(id); const d=n.parent!=null?n.parent:'__root__'; if(!byDir.has(d)) byDir.set(d,[]); byDir.get(d).push(n); }
        for(const [d,list] of byDir) add(F,'unowned','low',graph.nodes.get(d)||graph.root, t('unowned',{n:list.length}), list.slice(0,100).map(n=>n.id));
        const au=(graph.gitInfo&&graph.gitInfo.authors)||[];
        for(const x of co.drift.slice(0,LIMIT)) add(F,'ownerdrift','low',graph.nodes.get(x.id), t('drift',{o:x.owners.join(' '), who:(au[x.own]||{}).name||'?', s:Math.round(x.share*100), c:x.c}));
        if(co.drift.length>LIMIT){ const f=F.get('ownerdrift'); if(f) f.count=co.drift.length; }
      }
    }catch(e){ /* niepoprawny CODEOWNERS nie psuje analizy */ } }

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
      let pairs;
      if(CM.Metrics.findDuplicatesAsync && typeof Worker!=='undefined' && typeof document!=='undefined') pairs=await CM.Metrics.findDuplicatesAsync(files);   // przeglądarka: worker
      else {                                                        // CLI / testy: w tym wątku, z oddechem co 64 pliki
        const cand=CM.Metrics.duplicateCandidates(files), fps=new Array(cand.length);
        for(let i=0;i<cand.length;i++){ fps[i]=CM.Metrics.fingerprints(cand[i]); if((i&63)===63) await tick(); }
        pairs=CM.Metrics.pairDuplicates(cand, fps);
      }
      for(const p of pairs.slice(0,LIMIT)){
        const a=graph.nodes.get(p.a), b=graph.nodes.get(p.b); if(!a||!b) continue;
        add(F,'dupcode','med',a, t('dupShare',{a:a.name,b:b.name,n:p.tokens!=null?p.tokens:p.shared,k:p.blocks||1}), [b.id]);
      }
      if(pairs.length>LIMIT){ const f=F.get('dupcode'); if(f) f.count=pairs.length; }
    }catch(e){ ruleFail('dupcode', e); } }

    // ---- cykle między pakietami monorepo (CM.DSM: składowe grafu pakietów) ----
    if(CM.DSM && CM.DSM.packageCycles){ try{
      for(const c of CM.DSM.packageCycles(graph).slice(0,LIMIT)){
        const nodeOf=(u)=>graph.nodes.get(u.dir||'__root__')||graph.root;
        const names=c.slice(0,5).map(u=>u.name).join(' → ')+' → '+c[0].name;
        add(F,'pkgcycle','high',nodeOf(c[0]), names+(c.length>5?' …':'')+'  ('+c.length+')', c.slice(1).map(u=>nodeOf(u).id));
      }
    }catch(e){ /* brak pakietów w starszej mapie — reguła pominięta */ } }

    // ---- dependency cycles (reuse the graph's Tarjan) ----
    try{ const res=graph.importCycles();
      for(const comp of (res.components||[]).slice(0,LIMIT)){
        const first=graph.nodes.get(comp[0]); if(!first) continue;
        const names=comp.slice(0,4).map(id=>{ const n=graph.nodes.get(id); return n?n.name:id; }).join(' → ');
        add(F,'cycles', comp.length>=4?'high':'med', first, names+(comp.length>4?' → …':'')+'  ('+comp.length+')', comp.slice(1,101));
      }
      if(res.components&&res.components.length>LIMIT){ const f=F.get('cycles'); if(f) f.count=res.components.length; }
    }catch(e){ ruleFail('cycles', e); }

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
            add(F,'archviolation','high',n, '→ '+(tn?tn.name:x.to)+' · '+x.rule+(x.why?' — '+x.why:''), [x.to]);
          }
          if(v.length>LIMIT){ const f=F.get('archviolation'); if(f) f.count=v.length; }
        }
      }
    }catch(e){ ruleFail('archviolation', e); } }

    // ---- health score: 100 minus severity-weighted density ----
    let penalty=0; for(const f of F.values()) penalty+=SEV_W[f.sev]*f.count;
    const score=Math.max(0, Math.round(100 - 100*penalty/(penalty + 3*N)));
    const findings=[...F.values()].sort((a,b)=>ORDER.indexOf(a.rule)-ORDER.indexOf(b.rule));
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
  // raport Markdown bez DOM (eksport w aplikacji i CLI); extra = linie wstawiane po wierszu z wynikiem (CLI: podsumowanie)
  function toMarkdown(rep, name, extra){
    const L=['# CodeMap — '+t('title')+': '+(name||'project'),'', t('score')+': **'+rep.score+'/100** — '+rep.files+' '+t('files'),''];
    if(extra&&extra.length) L.push(...extra);
    for(const f of rep.findings){
      L.push('## '+t('r.'+f.rule)+' ('+f.count+') — '+t('sev.'+f.sev)); L.push(t('r.'+f.rule+'.d')); L.push('');
      for(const it of f.items) L.push('- `'+it.path+'` — '+(it.detail||''));
      if(f.count>f.items.length) L.push('- '+t('and',{n:f.count-f.items.length}));
      L.push('');
    }
    return L.join('\n');
  }
  function exportMD(){
    if(!lastReport) return;
    const g=graphRef(); const name=(g&&g.meta&&(g.meta.name||g.meta.source))||'project';
    U.download('codemap-analysis.md', toMarkdown(lastReport, name), 'text/markdown');
  }
  function open(){ buildOverlay().classList.remove('hidden'); render(); }
  function close(){ if(overlay) overlay.classList.add('hidden'); }
  if(I.onChange) I.onChange(()=>{ if(overlay&&!overlay.classList.contains('hidden')) render(); });

  return { open, close, run:_g=>run(_g||graphRef()), toMarkdown, text:t, RULES:ORDER, _rules:{SEV_W,LIMIT} };
})();
