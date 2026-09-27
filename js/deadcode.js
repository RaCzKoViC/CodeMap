/* ===================== deadcode.js — nieużywane eksporty JS/TS (faza 14), bez DOM ===================== */
// Eksport, którego żaden plik projektu nie importuje — kandydat do usunięcia albo do zdjęcia `export`. Jak knip:
// nazwy z klauzul importu na krawędziach (CM.Analysis: e.names, '*' = wszystko przez namespace / require / import()),
// `export * from` (e.star) przekazuje dalej nazwy, o które pytają importujący barrel (do punktu stałego),
// `export {a} from` liczy się jako użycie `a`. Pomijane: pliki bez importujących (to reguła osieroconych plików),
// wejścia pakietów (exports / main / module / bin, z mapowaniem dist → src i domyślnymi index/main/cli jak knip),
// testy oraz pliki bez treści albo obcięte (> 64 KB podglądu) — o nich nic pewnego nie wiadomo. Pliki .d.ts tylko
// importowane (także z JSDoc `import('./x').T`); ambientowe nie mają importujących. Eksporty CommonJS — nie (tylko ESM).
CM.DeadCode = (function(){
  const CODE = /\.(m?[jt]sx?|c[jt]s)$/, EXTS =['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
  // numer linii (1…) pozycji: indeks początków linii raz na tekst + wyszukiwanie binarne (plik z setkami eksportów
  // nie liczy od początku dla każdego)
  const lineIndex = (s) => { const st = [0]; for(let k = s.indexOf('\n'); k >= 0; k = s.indexOf('\n', k + 1)) st.push(k + 1);
    return (i) => { let lo = 0, hi = st.length - 1; while(lo < hi){ const mid = (lo + hi + 1) >> 1; if(st[mid] <= i) lo = mid; else hi = mid - 1; } return lo + 1; }; };

  // treść napisów → spacje (nowe linie zostają): `"export const X"` w stringu to nie eksport; ' i " kończą się na
  // końcu linii (regex z cudzysłowem nie zje reszty pliku), szablon `…` może mieć wiele linii
  function blankStrings(c){
    let out = '', i = 0;
    while(i < c.length){
      const q = c[i];
      // literał regex: `/` po operatorze, nawiasie, przecinku albo na początku linii (nie dzielenie) — do `/` poza [...]
      if(q === '/' && /(^|[=(,:;!&|?{}[\n]|\breturn)\s*$/.test(out.slice(-12))){
        let j = i + 1, cls = false;
        while(j < c.length && c[j] !== '\n' && (cls || c[j] !== '/')){ if(c[j] === '\\') j++; else if(c[j] === '[') cls = true; else if(c[j] === ']') cls = false; j++; }
        if(j < c.length && c[j] === '/'){ out += '/' + ' '.repeat(j - i - 1) + '/'; i = j + 1; continue; }
      }
      if(q !== '"' && q !== "'" && q !== '`'){ out += q; i++; continue; }
      out += q; i++;
      while(i < c.length && c[i] !== q && (q === '`' || c[i] !== '\n')){
        if(c[i] === '\\' && i + 1 < c.length){ out += c[i + 1] === '\n' ? ' \n' : '  '; i += 2; continue; }
        out += c[i] === '\n' ? '\n' : ' '; i++;
      }
      if(i < c.length && c[i] === q){ out += q; i++; }
    }
    return out;
  }

  // eksporty ESM pliku: [{name, line, type}] (type = tylko typ TS: interface / type); bez eksportów CommonJS
  function exportsOf(src){
    if(!src) return [];
    const c = blankStrings(CM.Analysis.stripNonCode(src, 'ts')), out = [], seen = new Set(), lineAt = lineIndex(c);
    const push = (name, i, type) => { if(name && !seen.has(name)){ seen.add(name); out.push({name, line: lineAt(i), type: !!type, pos: i}); } };
    let m;
    const reDef = /\bexport\s+default\b/g;
    while((m = reDef.exec(c))) push('default', m.index);
    const reDecl = /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\s*\*?|class|const\s+enum|enum|const|let|var|interface|type|namespace|module)\s*([A-Za-z_$][\w$]*)/g;
    while((m = reDecl.exec(c))) push(m[2], m.index, /^(interface|type)$/.test(m[1]));
    const reList = /\bexport\s+(type\s+)?\{([^}]*)\}/g;
    while((m = reList.exec(c))) for(const item of m[2].split(',')){
      const x = /^\s*(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(item); if(x) push(x[3] || x[2], m.index, m[1] || x[1]);
    }
    const reNs = /\bexport\s+\*\s+as\s+([\w$]+)/g;
    while((m = reNs.exec(c))) push(m[1], m.index);
    Object.defineProperty(out, 'code', {value: c, enumerable: false});   // dla typesUsedInFile
    return out;
  }

  // typy, do których odwołuje się deklaracja eksportowanej wartości (sygnatura funkcji, typ stałej, klasa) — część
  // jej API; jak w knip nie są zgłaszane. Typ użyty tylko przez inny eksportowany typ, typ wewnętrzny albo funkcję
  // wewnętrzną zostaje nieużywany. Region deklaracji = od jej `export` do następnego `export` (przybliżenie).
  function typesUsedInFile(exps){
    const c = exps.code || '', starts = [], used = new Set();
    const reExp = /\bexport\b/g; let m;
    while((m = reExp.exec(c))) starts.push(m.index);
    const regions = exps.filter((x) => !x.type).map((x) => { const i = starts.indexOf(x.pos); return [x.pos, i >= 0 && i + 1 < starts.length ? starts[i + 1] : c.length]; });
    for(const x of exps){
      if(!x.type || !regions.length) continue;
      const re = new RegExp('(?<![\\w$])' + x.name.replace(/\$/g, '\\$') + '(?![\\w$])', 'g');
      while((m = re.exec(c))) if(regions.some(([a, b]) => m.index >= a && m.index < b)){ used.add(x.name); break; }
    }
    return used;
  }

  // pliki wejściowe pakietów: ścieżki z package.json (także dist/x.js → src/x.ts) + domyślne index/main/cli (knip)
  function entryFiles(graph){
    const A = CM.Analysis, has = (p) => graph.nodes.has(p), out = new Set();
    const tryAll = (base) => {
      if(has(base)){ out.add(base); return; }
      const stem = base.replace(/\.(m?[jt]sx?|c[jt]s)$/, '');
      for(const e of EXTS) if(has(stem + e)){ out.add(stem + e); return; }
      for(const e of EXTS) if(has(stem + '/index' + e)){ out.add(stem + '/index' + e); return; }
    };
    for(const p of (graph.packages || [])){
      if(p.eco !== 'npm') continue;
      const dir = p.dir ? p.dir + '/' : '';
      for(const raw of (p.entries || [])){
        const rel = A.normPath(A.joinPath(p.dir || '', raw));
        tryAll(rel);
        const sub = rel.slice(dir.length).replace(/^(dist|build|lib|out|distribution|esm|cjs)\//, '');   // zbudowane → źródło
        for(const src of ['src/', 'source/', '']) tryAll(dir + src + sub);
      }
      for(const base of ['index', 'main', 'cli']) for(const src of ['', 'src/']) tryAll(dir + src + base);
    }
    if(!(graph.packages || []).some((p) => p.eco === 'npm' && !p.dir)) for(const base of ['index', 'main', 'cli']) for(const src of ['', 'src/']) tryAll(src + base);
    return out;
  }

  // ---- Python (jak vulture): funkcja / klasa najwyższego poziomu, do której nazwy nic w projekcie się nie odwołuje ----
  // Użycie = wystąpienie nazwy poza definicjami (`def x` / `class x` na dowolnym poziomie) — w kodzie, importach,
  // atrybutach i w `__all__`; docstringi i napisy wygaszone (f-stringi zostają — wyrażenia w nich to użycia).
  // Nazwy dunder (`__getattr__` modułu itp.) pomijane: wywołuje je sam Python.
  function pyCode(src){
    // kawałki: niezmienione odcinki kopiowane w całości (django: 650 tys. linii — doklejanie znak po znaku było wąskim gardłem)
    const c = src, parts = []; let i = 0, from = 0;
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    while(i < c.length){
      const ch = c[i];
      if(ch === '#'){ const e = c.indexOf('\n', i), end = e < 0 ? c.length : e; parts.push(c.slice(from, i), ' '.repeat(end - i)); i = from = end; continue; }
      if(ch !== '"' && ch !== "'"){ i++; continue; }
      const pre = /[rRbBuU]*[fF][rRbB]*$/.test(c.slice(Math.max(0, i - 3), i).match(/[A-Za-z]*$/)[0]) ? 'f' : '';
      const tri = c.startsWith(ch + ch + ch, i), q = tri ? ch + ch + ch : ch;
      let j = i + q.length;
      while(j < c.length && !c.startsWith(q, j) && (tri || c[j] !== '\n')) j += c[j] === '\\' ? 2 : 1;
      const end = Math.min(c.length, j + q.length);
      parts.push(c.slice(from, i), pre ? c.slice(i, end) : blank(c.slice(i, end)));
      i = from = end;
    }
    parts.push(c.slice(from));
    return parts.join('');
  }
  function analyzePy(graph){
    const files = [];
    for(const n of graph.nodes.values()) if(n.type === 'file' && /\.pyi?$/.test(n.path || '') && n.preview && !n.isTest) files.push(n);
    // przejście 1: kod bez komentarzy / napisów / importów, definicje (każdy poziom), API z __init__.py i __all__;
    // przejście 2: wystąpienia tylko nazw-kandydatów (definicje najwyższego poziomu) — bez licznika dla każdego tokenu
    const api = new Set(), defsCount = new Map(), defs = [], codes = [];
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    for(const n of files){
      // import to nie użycie (jak vulture), ale nazwy importowane w __init__.py to API pakietu — nie są martwe
      const init = /(^|\/)__init__\.pyi?$/.test(n.path), src = n.preview;
      const code = pyCode(src)
        .replace(/^[ \t]*from[ \t]+[\w.]+[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm, (s, list) => {
          if(init) for(const x of list.replace(/[()\\]/g, ' ').split(',')){ const nm = x.trim().split(/\s+as\s+/)[0]; if(/^[A-Za-z_]\w*$/.test(nm)) api.add(nm); }
          return blank(s);
        })
        .replace(/^[ \t]*import[ \t]+[^\n]*/gm, blank);
      codes.push(code);
      let m; const reAll = /^__all__\s*\+?=\s*[[(]([^\])]*)[\])]/gm;
      while((m = reAll.exec(src))) for(const x of m[1].match(/['"]([A-Za-z_]\w*)['"]/g) || []) api.add(x.slice(1, -1));
      const reDef = /^([ \t]*)(?:async[ \t]+)?(def|class)[ \t]+([A-Za-z_]\w*)/gm;
      let line = 1, at = 0;
      while((m = reDef.exec(code))){
        defsCount.set(m[3], (defsCount.get(m[3]) || 0) + 1);   // definicja to nie użycie
        if(m[1] || /^__\w+__$/.test(m[3])) continue;
        // z dekoratorem (@app.route, @click.command, @pytest.fixture…) rejestruje ją framework — nie zgłaszamy
        if(/(^|\n)[ \t]*@[^\n]*\n\s*$/.test(code.slice(Math.max(0, m.index - 300), m.index))) continue;
        for(; at < m.index; at++) if(code.charCodeAt(at) === 10) line++;
        defs.push({n, name: m[3], line, kind: m[2]});
      }
    }
    const cand = new Set(defs.filter((d) => !api.has(d.name)).map((d) => d.name)), seen = new Map();
    for(const code of codes){ const re = /[A-Za-z_]\w*/g; let m; while((m = re.exec(code))) if(cand.has(m[0])) seen.set(m[0], (seen.get(m[0]) || 0) + 1); }
    const byFile = new Map();
    for(const d of defs) if(cand.has(d.name) && (seen.get(d.name) || 0) - (defsCount.get(d.name) || 0) <= 0){
      if(!byFile.has(d.n.id)) byFile.set(d.n.id, {id: d.n.id, path: d.n.path, exports: []});
      byFile.get(d.n.id).exports.push({name: d.name, line: d.line, type: false});
    }
    return [...byFile.values()];
  }

  // → [{id, path, exports:[{name, line, type}]}] — pliki z eksportami, o które nikt nie pyta
  function analyze(graph){
    return analyzeJs(graph).concat(analyzePy(graph));
  }
  function analyzeJs(graph){
    const files = [];
    for(const n of graph.nodes.values()) if(n.type === 'file' && CODE.test(n.path || '')) files.push(n);   // także .d.ts importowane przez kogoś (ambientowe nie mają importujących)
    const byId = new Map(files.map((n) => [n.id, n]));
    const incoming = new Map();                         // id → krawędzie importu wchodzące z plików JS/TS
    for(const e of graph.edges){
      if(e.type !== 'import' || !byId.has(e.target)) continue;
      const s = graph.nodes.get(e.source); if(!s || s.type !== 'file') continue;
      if(!incoming.has(e.target)) incoming.set(e.target, []);
      incoming.get(e.target).push(e);
    }
    // nazwy żądane od pliku: suma nazw krawędzi; przez `export *` — to, o co pytają importujący barrel (punkt stały)
    const ALL = '*', req = new Map(), entries = entryFiles(graph);
    const get = (id) => { if(!req.has(id)) req.set(id, new Set()); return req.get(id); };
    for(const id of entries) get(id).add(ALL);          // publiczne API: wszystko, co wejście reeksportuje, jest „używane"
    let changed = true, guard = 0;
    while(changed && guard++ < 50){
      changed = false;
      for(const [id, list] of incoming){
        const set = get(id); if(set.has(ALL)) continue;
        for(const e of list){
          const add = e.star ? [...get(e.source)] : (e.names || [ALL]);
          if(e.star && graph.nodes.get(e.source) && !byId.has(e.source)) add.push(ALL);   // barrel spoza JS/TS — nie wiemy
          for(const x of add) if(!set.has(x)){ set.add(x); changed = true; }
          if(set.has(ALL)) break;
        }
      }
    }
    const out = [];
    for(const n of files){
      const list = incoming.get(n.id);
      if(!list || !list.length || entries.has(n.id) || n.isTest) continue;
      const src = n.preview; if(!src || (n.size && src.length < n.size && src.length >= 65536)) continue;
      const set = get(n.id); if(set.has(ALL)) continue;
      // barrel pyta cel `export *` o nazwy, których sam nie eksportuje — żądania przekazane dalej nie są jego własne
      const exps = exportsOf(src), inFile = typesUsedInFile(exps);
      const unused = exps.filter((x) => !set.has(x.name) && !inFile.has(x.name)).map(({name, line, type}) => ({name, line, type}));
      if(unused.length) out.push({id: n.id, path: n.path, exports: unused});
    }
    return out;
  }

  return {exportsOf, typesUsedInFile, entryFiles, analyze, analyzeJs, analyzePy, pyCode};
})();
