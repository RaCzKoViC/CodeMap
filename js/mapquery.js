/* ===================== mapquery.js — pytania o mapę językiem naturalnym (bez modelu, bez DOM) ===================== */
// „pliki bez testów o złożoności powyżej 50 w src", „top 5 najbardziej złożonych plików js", „files changed more than
// 10 times", „pliki autora Ala zmienione w ostatnich 30 dniach" → spec {conds, flags, lang, path, owner, within, sort,
// limit} → pliki z grafu. Po polsku i angielsku, bez polskich znaków w dopasowaniu (zlozonosc = złożoność).
// parse(tekst, graph) → {spec, confident, parts}; run(graph, spec) → {files:[węzły], total}; describe → tekst.
// confident = rozpoznany co najmniej jeden warunek, flaga, sortowanie, autor albo okres (samo „pliki" to za mało) —
// ChatBot odpowiada wtedy od razu, bez modelu; inaczej pytanie idzie do modelu.
CM.MapQuery = (function(){
  const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
  const DAY = 864e5;
  // metryka ← słowo (po złożeniu znaków); kolejność ma znaczenie (zmian przed „zmieniane" itd.)
  const METRIC = [
    ['complexity', /^(zlozon|complex|cyklomat|cc$)/],
    ['functions', /^(funkcj|function|metod|method)/],
    ['changes', /^(zmian|zmienian|zmienion|change|commit|churn|edycj)/],
    ['authors', /^(autorow|autorzy|authors|contributors|osob)/],
    ['fanin', /^(fan-?in|importowan|uzywan|dependents|importers|klient)/],
    ['fanout', /^(fan-?out|importow$|importuj|imports|zaleznosc|dependencies)/],
    ['size', /^(kb|mb|bajt|byte|rozmiar|size)/],
    ['lines', /^(lini|linijek|wiersz|lines?$|loc$|sloc$)/],
  ];
  const OPS = [   // słowo/fraza → operator (dopasowywane na tekście po złożeniu znaków)
    [/(>=|co najmniej|przynajmniej|at least|minimum|min\.?)\s*$/, '>='], [/(<=|co najwyzej|najwyzej|maksymalnie|at most|maximum|max\.?)\s*$/, '<='],
    [/(>|powyzej|ponad|wiecej niz|wiecej jak|more than|over|above|greater than|larger than|exceeding)\s*$/, '>'],
    [/(<|ponizej|mniej niz|mniej jak|less than|fewer than|under|below|smaller than)\s*$/, '<'], [/(=|dokladnie|rowno|exactly|equal to)\s*$/, '='],
  ];
  const LANG = {javascript:'js', js:'js', jsx:'jsx', typescript:'ts', ts:'ts', tsx:'tsx', python:'py', py:'py', pythona:'py', go:'go', golang:'go',
    rust:'rs', rs:'rs', java:'java', kotlin:'kt', csharp:'cs', 'c#':'cs', cpp:'cpp', 'c++':'cpp', css:'css', scss:'scss', html:'html',
    markdown:'md', md:'md', json:'json', yaml:'yaml', yml:'yaml', shell:'sh', bash:'sh', ruby:'rb', php:'php', swift:'swift', dart:'dart', lua:'lua', vue:'vue', svelte:'svelte'};
  const LANG_SET = {js:['js','mjs','cjs','jsx'], ts:['ts','tsx','mts','cts'], py:['py'], go:['go'], rs:['rs'], java:['java'], kt:['kt','kts'], cs:['cs'],
    cpp:['cpp','cc','cxx','hpp','h'], css:['css'], scss:['scss','sass'], html:['html','htm'], md:['md','mdx'], json:['json'], yaml:['yaml','yml'],
    sh:['sh','bash'], rb:['rb'], php:['php'], swift:['swift'], dart:['dart'], lua:['lua'], vue:['vue'], svelte:['svelte'], jsx:['jsx'], tsx:['tsx']};
  const FLAGS = [
    ['untested', /\b(bez testow|nieprzetestowan\w*|nietestowan\w*|untested|without tests?|no tests?|not tested)\b/],
    ['tested', /\b(z testami|przetestowan\w*|objete testami|tested|with tests?|covered by tests)\b/],
    ['tests', /\b(pliki testow\w*|testy jednostkowe|test files?|pliki testowe)\b/],
    ['hotspot', /\b(hotspot\w*|gorac\w*|ryzykown\w*|risky)\b/],
    ['vulnerable', /\b(podatn\w*|vulnerab\w*|cve|ghsa)\b/],
    ['unowned', /\b(bez wlasciciel\w*|unowned|without (an )?owners?|no owners?)\b/],
    ['cycle', /\b(w cykl\w*|cykl\w*|in (a |import )?cycles?|cycles?|circular)\b/],
    ['orphan', /\b(osierocon\w*|nieuzywan\w*|martw\w*|orphan\w*|unused|dead)\b/],
    ['duplicated', /\b(zduplikowan\w*|duplikat\w*|duplicat\w*|skopiowan\w*|copy-?paste)\b/],
    ['todo', /\b(todo|fixme)\b/],
  ];
  const SORTS = [
    [/\b(najwieksz\w*|najdluzsz\w*|largest|biggest|longest|duze|duzych)\b/, 'lines', -1],
    [/\b(najmniejsz\w*|najkrotsz\w*|smallest|shortest)\b/, 'lines', 1],
    [/\b(najbardziej zlozon\w*|najzlozensz\w*|najtrudniejsz\w*|most complex|complexest)\b/, 'complexity', -1],
    [/\b(najczesciej zmieniane|najczesciej zmienian\w*|najwiecej zmian|most changed|most frequently changed|highest churn)\b/, 'changes', -1],
    [/\b(najczesciej importowan\w*|najbardziej uzywan\w*|most imported|most used|most depended)\b/, 'fanin', -1],
    [/\b(najnowsz\w*|ostatnio zmienian\w*|most recent\w*|newest|recently changed)\b/, 'recent', -1],
    [/\b(najstarsz\w*|nieruszan\w*|oldest|stalest)\b/, 'recent', 1],
  ];
  const QUERY_START = /^(pokaz|znajdz|wyszukaj|wypisz|wylistuj|podswietl|zaznacz|ktore|jakie|ile|lista|daj|show|find|list|which|what|highlight|select|how many|top)\b/;

  function num(s){ const m = /^(\d+(?:[.,]\d+)?)(k|kb|mb)?$/.exec(s); if(!m) return null; let v = parseFloat(m[1].replace(',', '.')); if(m[2] === 'k') v *= 1000; if(m[2] === 'kb') v *= 1024; if(m[2] === 'mb') v *= 1048576; return v; }
  const metricOf = (w) => { for(const [m, re] of METRIC) if(re.test(w)) return m; return null; };

  function parse(text, graph){
    const raw = String(text || '').trim(), s = fold(raw);
    const spec = {conds: [], flags: [], lang: null, path: null, owner: null, within: null, stale: null, sort: null, limit: null, kind: 'file'};
    const parts = [];
    const toks = s.replace(/([<>]=?|=)/g, ' $1 ').split(/[\s,;:!?()]+/).filter(Boolean);
    // flagi
    for(const [f, re] of FLAGS){ if(re.test(s)){ if(f === 'tested' && spec.flags.includes('untested')) continue; spec.flags.push(f); parts.push(f); } }
    if(spec.flags.includes('tests') && spec.flags.includes('untested')) spec.flags.splice(spec.flags.indexOf('tests'), 1);
    if(/\b(zaleznosci zewnetrzn\w*|pakiety zewnetrzn\w*|external (dependencies|packages)|biblioteki zewnetrzn\w*)\b/.test(s)) spec.kind = 'external';
    // porównania: liczba + operator przed nią (słowo/znak) → metryka: najbliższe słowo po liczbie (≤ 3), inaczej przed (≤ 4)
    for(let i = 0; i < toks.length; i++){
      const v = num(toks[i]); if(v == null) continue;
      const before = toks.slice(Math.max(0, i - 4), i).join(' ');
      let op = null; for(const [re, o] of OPS) if(re.test(before)){ op = o; break; }
      if(!op) continue;
      let metric = null;
      for(let k = i + 1; k <= i + 3 && k < toks.length && !metric; k++) metric = metricOf(toks[k]);
      if(/\d(k|kb|mb)$/.test(toks[i])) metric = metric || 'size';   // „2kb" — jednostka przy liczbie
      for(let k = i - 1; k >= Math.max(0, i - 6) && !metric; k--) metric = metricOf(toks[k]);
      if(!metric) continue;
      spec.conds.push({metric, op, value: v}); parts.push(metric + ' ' + op + ' ' + v);
    }
    // „zmieniane ponad 10 razy" — liczba z „razy/times" bez słowa metryki po niej
    if(!spec.conds.some(c => c.metric === 'changes')){
      const m = /(zmienian\w*|zmienion\w*|changed|modified|edited)\s+(ponad|powyzej|wiecej niz|more than|over|at least|co najmniej)\s+(\d+)\s*(razy|times|x)\b/.exec(s);
      if(m){ spec.conds.push({metric: 'changes', op: /at least|co najmniej/.test(m[2]) ? '>=' : '>', value: +m[3]}); parts.push('changes > ' + m[3]); }
    }
    // okres: „w ostatnich 30 dniach", „ostatni tydzień/miesiąc/rok", „last week/month", „in the last 2 weeks"; nieruszane od
    const per = (n, u) => { u = u || ''; const k = /tydz|tygod|week/.test(u) ? 7 : /mies|month/.test(u) ? 30 : /rok|lat|year/.test(u) ? 365 : 1; return (n || 1) * k; };
    let m = /(ostatni\w*|last|past|in the last)\s+(\d+)?\s*(dni|dzien|dnia|day|days|tydz\w*|tygod\w*|week\w*|mies\w*|month\w*|rok|roku|lat|year\w*)/.exec(s);
    if(m && !/(nieruszan|nie zmienian|not changed|untouched|stale)/.test(s)){ spec.within = per(m[2] ? +m[2] : 1, m[3]); parts.push('within ' + spec.within + 'd'); }
    m = /(nieruszan\w*|nie zmienian\w*|not changed|untouched|stale)\D{0,20}?(?:od|for|in|since)?\s*(\d+)?\s*(dni|day\w*|tydz\w*|tygod\w*|week\w*|mies\w*|month\w*|rok\w*|lat|year\w*)/.exec(s);
    if(m){ spec.stale = per(m[2] ? +m[2] : 1, m[3]); parts.push('stale ' + spec.stale + 'd'); }
    // sortowanie i limit
    for(const [re, metric, dir] of SORTS) if(re.test(s)){ spec.sort = {metric, dir}; parts.push('sort ' + metric); break; }
    m = /\b(?:top|pierwsz\w*|first)\s+(\d{1,3})\b/.exec(s) || /\b(\d{1,3})\s+(?:najwieksz|najmniejsz|najbardziej|najczesciej|najnowsz|najstarsz|largest|biggest|smallest|most|newest|oldest|pierwsz)/.exec(s);
    if(m){ spec.limit = Math.max(1, Math.min(500, +m[1])); parts.push('limit ' + spec.limit); }
    // autor / właściciel (git): „autora Ala", „właściciel bob", „owned by Ala", „napisane przez Ala"
    m = /(?:autor\w*|wlasciciel\w*|owned by|written by|authored by|napisane przez|nalezace do)\s+([\p{L}][\p{L}.\-]{1,40})/u.exec(s);
    if(m && !/^(pliku|plikow|projektu|file|files|project|bez)$/.test(m[1])){ spec.owner = m[1]; parts.push('owner ' + m[1]); }
    // język
    for(const t of toks){ const k = LANG[t.replace(/^\./, '')]; if(k && !(t === 'go' && /\b(go to|let'?s go)\b/.test(s))){ spec.lang = k; parts.push('lang ' + k); break; } }
    // folder: po „w / in / pod / under / folder / katalog" albo token ze „/" — tylko gdy taki folder istnieje w grafie
    const folders = [];
    if(graph && graph.nodes) for(const n of graph.nodes.values()) if(n.type === 'folder' && n.path && !n.external) folders.push(n.path);
    const findFolder = (w) => { w = w.replace(/^\.?\/+|\/+$/g, ''); if(!w) return null; const lw = w.toLowerCase();
      return folders.find(p => p.toLowerCase() === lw) || folders.filter(p => p.toLowerCase().endsWith('/' + lw)).sort((a, b) => a.length - b.length)[0] || null; };
    const rawToks = raw.split(/[\s,;:!?()]+/).filter(Boolean);
    for(let i = 0; i < rawToks.length && !spec.path; i++){
      const w = fold(rawToks[i]), next = rawToks[i + 1];
      if(/^(w|we|in|pod|under|inside|within|folder\w*|katalog\w*|directory|dir)$/.test(w) && next){ const f = findFolder(next.replace(/[.,]$/, '')); if(f){ spec.path = f; parts.push('path ' + f); } }
      else if(rawToks[i].includes('/')){ const f = findFolder(rawToks[i].replace(/[.,]$/, '')); if(f){ spec.path = f; parts.push('path ' + f); } }
    }
    if(spec.sort && !spec.limit) spec.limit = 10;
    const confident = !!(spec.conds.length || spec.flags.length || spec.sort || spec.owner || spec.within || spec.stale || spec.kind === 'external');
    const looksLikeQuery = QUERY_START.test(s) || /\b(pliki|plikow|plik|files?|moduly|modules?)\b/.test(s) || spec.kind === 'external';
    return {spec, confident: confident && looksLikeQuery, parts};
  }

  // ---- wykonanie na grafie ----
  function inCycles(graph){ const out = new Set(); try{ const r = graph.importCycles(); for(const c of (r.components || [])) c.forEach(id => out.add(id)); }catch(e){ /* graf bez krawędzi importów */ } return out; }
  function duplicatedSet(graph){
    const M = CM.Metrics, out = new Set(); if(!M || !M.findDuplicates) return out;
    const files = [...graph.nodes.values()].filter(n => n.type === 'file');
    for(const p of M.findDuplicates(files)){ out.add(p.a); out.add(p.b); }
    return out;
  }
  function value(n, metric, deg){
    const m = n.metrics || {};
    switch(metric){
      case 'lines': return m.lines || 0;
      case 'complexity': return m.complexity || 0;
      case 'functions': return m.functions || 0;
      case 'changes': return n.git ? n.git.c : 0;
      case 'authors': return n.git ? n.git.n || 0 : 0;
      case 'size': return n.size || 0;
      case 'fanin': return (deg.in.get(n.id) || 0);
      case 'fanout': return (deg.out.get(n.id) || 0);
      case 'recent': return n.git && n.git.last ? n.git.last : (n.mtime || 0);
      default: return 0;
    }
  }
  const ENTRY = /^(index|main|app|server|cli|setup|conf(ig)?|__init__|__main__|mod|lib)$/i;
  const cmpOp = (a, op, b) => op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : a === b;

  function run(graph, spec, opts){
    opts = opts || {};
    const now = opts.now || Date.now();
    const deg = {in: new Map(), out: new Map()};
    for(const e of graph.edges){ if(e.type !== 'import' && e.type !== 'reference') continue; deg.out.set(e.source, (deg.out.get(e.source) || 0) + 1); deg.in.set(e.target, (deg.in.get(e.target) || 0) + 1); }
    const need = new Set(spec.flags);
    const cyc = need.has('cycle') ? inCycles(graph) : null;
    const dup = need.has('duplicated') ? duplicatedSet(graph) : null;
    const hot = need.has('hotspot') ? hotSet(graph) : null;
    const vulnFiles = new Set(), vulnNames = new Set();
    if(need.has('vulnerable') && graph.vulnInfo) for(const it of graph.vulnInfo.items || []){ if(it.file) vulnFiles.add(it.file); vulnNames.add(it.name); }
    const co = need.has('unowned') && CM.CodeOwners ? CM.CodeOwners.analyze(graph) : null;
    const unowned = co ? new Set(co.unowned) : null;
    const authors = graph.gitInfo && graph.gitInfo.authors;
    const ownerIdx = spec.owner && authors ? new Set(authors.map((a, i) => [a, i]).filter(([a]) => fold(a.name + ' ' + (a.email || '') + ' ' + (a.login || '')).includes(fold(spec.owner))).map(([, i]) => i)) : null;
    const exts = spec.lang ? new Set(LANG_SET[spec.lang] || [spec.lang]) : null;
    const out = [];
    for(const n of graph.nodes.values()){
      if(spec.kind === 'external'){ if(n.type !== 'external') continue; }
      else if(n.type !== 'file' || (n.gid && n.gid !== 'base')) continue;
      if(spec.kind === 'external'){
        if(need.has('vulnerable') && !vulnNames.has(n.name)) continue;
        out.push(n); continue;
      }
      if(spec.path && !(n.path === spec.path || n.path.startsWith(spec.path + '/'))) continue;
      if(exts){ const ext = (n.name.split('.').pop() || '').toLowerCase(); if(!exts.has(ext) && n.lang !== spec.lang) continue; }
      if(need.has('untested') && (n.isTest || (n.testedBy && n.testedBy.length) || !(CM.TestMap ? CM.TestMap.isCodeFile(n.path) : true))) continue;
      if(need.has('tested') && !(n.testedBy && n.testedBy.length)) continue;
      if(need.has('tests') && !n.isTest) continue;
      if(need.has('hotspot') && !hot.has(n.id)) continue;
      if(need.has('vulnerable') && !vulnFiles.has(n.path)) continue;
      if(need.has('unowned') && !(unowned && unowned.has(n.id))) continue;
      if(need.has('cycle') && !cyc.has(n.id)) continue;
      if(need.has('orphan') && ((deg.in.get(n.id) || 0) + (deg.out.get(n.id) || 0) > 0 || n.isTest || ENTRY.test(n.name.replace(/\.[^.]+$/, '')))) continue;   // jak reguła Inspect: pliki wejściowe to nie sieroty
      if(need.has('duplicated') && !dup.has(n.id)) continue;
      if(need.has('todo') && !(n.metrics && n.metrics.todos)) continue;
      if(ownerIdx && !(n.git && ownerIdx.has(n.git.own))) continue;
      if(spec.within && !(n.git && n.git.last && now - n.git.last <= spec.within * DAY)) continue;
      if(spec.stale && !(n.git && n.git.last && now - n.git.last > spec.stale * DAY)) continue;
      if(!spec.conds.every(c => cmpOp(value(n, c.metric, deg), c.op, c.value))) continue;
      out.push(n);
    }
    const sortMetric = spec.sort ? spec.sort.metric : (spec.conds[0] && spec.conds[0].metric) || (need.has('hotspot') ? 'hotspot' : 'lines');
    const dir = spec.sort ? spec.sort.dir : -1;
    const key = (n) => sortMetric === 'hotspot' ? (CM.GitCore && n.git ? CM.GitCore.hotspotScore(n) : value(n, 'complexity', deg)) : spec.kind === 'external' ? (n.count || 0) : value(n, sortMetric, deg);
    out.sort((a, b) => (key(b) - key(a)) * -dir || (a.path < b.path ? -1 : 1));
    const total = out.length, limit = spec.limit || 500;
    return {files: out.slice(0, limit), total, sortMetric, deg};
  }
  // hotspoty: górne 10 % (min. 5) wg częstości zmian × złożoność (z git) albo złożoności × rozmiaru
  function hotSet(graph){
    const files = [...graph.nodes.values()].filter(n => n.type === 'file' && n.metrics && (CM.TestMap ? CM.TestMap.isCodeFile(n.path) : true));
    const score = (n) => graph.gitInfo && CM.GitCore && n.git ? CM.GitCore.hotspotScore(n) : (n.metrics.complexity || 0) * Math.log2(2 + (n.metrics.lines || 0));
    const k = Math.max(5, Math.ceil(files.length * 0.1));
    return new Set(files.filter(n => score(n) > 0).sort((a, b) => score(b) - score(a)).slice(0, k).map(n => n.id));
  }

  // opis wyniku (PL/EN) z metryką sortowania przy każdej pozycji
  function describe(res, spec, lang){
    const en = lang === 'en';
    const lab = {lines: en ? 'lines' : 'linie', complexity: 'CC', functions: en ? 'functions' : 'funkcje', changes: en ? 'changes' : 'zmiany',
      authors: en ? 'authors' : 'autorzy', size: 'B', fanin: 'fan-in', fanout: 'fan-out', recent: '', hotspot: 'CC'};
    if(!res.total) return en ? 'No matching files.' : 'Brak pasujących plików.';
    const show = res.files.slice(0, 15).map(n => {
      if(spec.kind === 'external') return n.name + (n.count ? ' (' + n.count + ')' : '');
      const mt = res.sortMetric === 'hotspot' ? 'complexity' : res.sortMetric;
      if(mt === 'recent'){ const t = n.git && n.git.last || n.mtime; return n.path + (t ? ' (' + new Date(t).toISOString().slice(0, 10) + ')' : ''); }
      return n.path + ' (' + lab[mt] + ' ' + value(n, mt, res.deg) + ')';
    });
    const head = spec.kind === 'external' ? (en ? 'Dependencies' : 'Zależności') : (en ? 'Files' : 'Pliki');
    return head + ': ' + res.total + (res.total > res.files.length ? (en ? ' (showing ' : ' (pokazano ') + res.files.length + ')' : '') + ' — ' + show.join(', ') + (res.files.length > 15 ? ', …' : '');
  }

  return {parse, run, describe, fold};
})();

// akcja ChatBota / palety: `mapQuery {q}` — podświetla wynik na mapie i zwraca opis (także gdy pyta model)
(function(){
  const A = CM.App;
  if(!A || !A.registerAction) return;
  A.registerAction({name:'mapQuery', sig:'{q}',
    desc:'answer a question about the map without a model: e.g. "untested files with complexity over 50 in src", "top 5 most changed files", "files of author Ala changed in the last month", "vulnerable dependencies"; highlights the matching files and returns them',
    descPl:'pytanie o mapę językiem naturalnym → pliki podświetlone na mapie (bez modelu)', auto:true, info:true,
    required:(a)=>!!(a && a.q),
    run:(a)=>{
      const g = A.graph; if(!g || !A.state || !A.state.counts || !A.state.counts.nodes) throw new Error(CM.i18n.t('cb.noProject', 'Najpierw wczytaj projekt (CodeMap).'));
      const p = CM.MapQuery.parse(a.q, g), r = CM.MapQuery.run(g, p.spec);
      const ids = new Set(r.files.map(n => n.id));
      if(A.renderer && A.renderer.setHighlight) A.renderer.setHighlight(ids.size ? ids : null);
      if(r.files.length === 1 && A.focusNode) A.focusNode(r.files[0].id);
      return CM.MapQuery.describe(r, p.spec, CM.i18n.getLang && CM.i18n.getLang() === 'en' ? 'en' : 'pl');
    }});
})();
