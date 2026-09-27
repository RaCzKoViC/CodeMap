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
  const lineAt = (s, i) => { let n = 1; for(let k = 0; k < i; k++) if(s.charCodeAt(k) === 10) n++; return n; };

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
    const c = blankStrings(CM.Analysis.stripNonCode(src, 'ts')), out = [], seen = new Set();
    const push = (name, i, type) => { if(name && !seen.has(name)){ seen.add(name); out.push({name, line: lineAt(c, i), type: !!type, pos: i}); } };
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

  // → [{id, path, exports:[{name, line, type}]}] — pliki z eksportami, o które nikt nie pyta
  function analyze(graph){
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

  return {exportsOf, typesUsedInFile, entryFiles, analyze};
})();
