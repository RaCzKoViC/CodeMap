/* ===================== analysis.js — metrics + dependency graph ===================== */
CM.Analysis = (function(){

  // ---------- path helpers ----------
  function normPath(p){
    const parts = String(p).replace(/\\/g,'/').split('/');
    const out = [];
    for(const part of parts){
      if(part === '' || part === '.') continue;
      if(part === '..'){ if(out.length && out[out.length-1] !== '..') out.pop(); else out.push('..'); }
      else out.push(part);
    }
    return out.join('/');
  }
  function dirname(p){ p = p.replace(/\\/g,'/'); const i = p.lastIndexOf('/'); return i<0 ? '' : p.slice(0,i); }
  function basename(p){ p = p.replace(/\\/g,'/'); const i = p.lastIndexOf('/'); return i<0 ? p : p.slice(i+1); }
  function joinPath(dir, rel){ return normPath((dir ? dir+'/' : '') + rel); }

  // ---------- language family ----------
  function family(key){
    if(['js','mjs','cjs','jsx','ts','mts','cts','tsx','vue','svelte','astro'].includes(key)) return 'js';
    if(['py','pyw','pyi'].includes(key)) return 'py';
    if(['c','h','cpp','cc','cxx','hpp','hh','hxx','ipp','m','mm'].includes(key)) return 'c';
    if(['go'].includes(key)) return 'go';
    if(['java','kt','kts','scala','sc','groovy'].includes(key)) return 'java';
    if(['cs'].includes(key)) return 'cs';
    if(['php','phtml'].includes(key)) return 'php';
    if(['rb','erb','rake'].includes(key)) return 'rb';
    if(['rs'].includes(key)) return 'rust';
    if(['css','scss','sass','less','styl'].includes(key)) return 'css';
    if(['html','htm','xhtml'].includes(key)) return 'html';
    if(['md','markdown','mdx'].includes(key)) return 'md';
    return 'other';
  }

  // ---------- comment syntax (for LOC breakdown) ----------
  function commentSyntax(key){
    const slash = {line:['//'], blockStart:'/*', blockEnd:'*/'};
    const hash  = {line:['#'], blockStart:null, blockEnd:null};
    const fam = family(key);
    if(['js','c','java','cs','go','rust','css'].includes(fam)) return slash;
    if(['py','rb'].includes(fam)) return {line:['#'], blockStart:'"""', blockEnd:'"""'};
    if(['sh','yaml','toml','ps1','psm1','psd1','dockerfile','makefile','mk','cmake','r','rmd','pl','pm','jl','ini','cfg','conf','properties','env','elixir','ex','exs'].includes(key)||fam==='other'&&['sh','yaml','yml','toml'].includes(key)) return hash;
    if(['html','md','xml'].includes(fam) || ['html','htm','xhtml','xml','svg','vue','svelte','md','markdown','mdx'].includes(key))
      return {line:[], blockStart:'<!--', blockEnd:'-->'};
    if(['lua'].includes(key)) return {line:['--'], blockStart:'--[[', blockEnd:']]'};
    if(['sql'].includes(key)) return {line:['--'], blockStart:'/*', blockEnd:'*/'};
    if(['php','phtml'].includes(key)) return {line:['//','#'], blockStart:'/*', blockEnd:'*/'};
    if(['hs','lhs'].includes(key)) return {line:['--'], blockStart:'{-', blockEnd:'-}'};
    if(['sh','bash','zsh','fish','yml','yaml','toml','py','rb','r','pl','jl'].includes(key)) return hash;
    return hash;
  }

  // ---------- content metrics ----------
  function analyzeContent(content, key){
    if(content == null) return null;
    const lines = content.split(/\r\n|\r|\n/);
    const total = lines.length;
    let blank=0, comment=0, todos=0, longest=0;
    const cs = commentSyntax(key);
    let inBlock=false;
    for(const raw of lines){
      if(raw.length > longest) longest = raw.length;
      const line = raw.trim();
      if(line.length === 0){ blank++; continue; }
      if(/\b(TODO|FIXME|HACK|XXX|BUG)\b/.test(raw)) todos++;
      if(inBlock){ comment++; if(cs.blockEnd && line.includes(cs.blockEnd)) inBlock=false; continue; }
      if(cs.blockStart && line.includes(cs.blockStart)){
        comment++;
        const after = line.slice(line.indexOf(cs.blockStart)+cs.blockStart.length);
        if(!(cs.blockEnd && after.includes(cs.blockEnd))) inBlock=true;
        continue;
      }
      if(cs.line && cs.line.length && cs.line.some(p=>line.startsWith(p))){ comment++; continue; }
    }
    const code = Math.max(0, total - blank - comment);
    const branch = (content.match(/\b(if|elif|for|while|case|catch|switch|when|foreach)\b/g)||[]).length
                 + (content.match(/&&|\|\||\?\.|\?\s/g)||[]).length;
    const funcs = (content.match(/\b(function|def|func|fn|sub|lambda)\b/g)||[]).length;
    return {lines:total, blank, comment, code, longest, todos, complexity:branch+1, funcs, chars:content.length};
  }

  // ---------- dependency extraction ----------
  function add(deps, spec, kind, etype){
    spec = (spec||'').trim();
    if(!spec) return;
    if(/^(https?:)?\/\//i.test(spec) || spec.startsWith('data:') || spec.startsWith('#') ||
       spec.startsWith('mailto:') || spec.startsWith('tel:') || spec.startsWith('javascript:')) return;
    deps.push({spec, kind, etype});
  }
  function matchAll(re, str, cb){ let m; re.lastIndex=0; while((m = re.exec(str)) !== null){ cb(m); if(m.index===re.lastIndex) re.lastIndex++; } }

  function jsDeps(c, d){
    matchAll(/(?:import|export)\s+(?:[\w*{}\s,]+\sfrom\s+)?['"]([^'"]+)['"]/g, c, m=>add(d,m[1], rel(m[1]), 'import'));
    matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, c, m=>add(d,m[1], rel(m[1]), 'import'));
    matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, c, m=>add(d,m[1], rel(m[1]), 'import'));
  }
  function pyDeps(c, d){
    matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm, c, m=>{
      m[1].split(',').forEach(s=>add(d, s.trim().split(/\s+as\s+/)[0], 'module', 'import'));
    });
    matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import\b/gm, c, m=>{
      const s = m[1];
      if(s.startsWith('.')) add(d, s, 'py-rel', 'import');
      else if(s) add(d, s, 'module', 'import');
    });
  }
  function cDeps(c, d){
    matchAll(/#[ \t]*include[ \t]+"([^"]+)"/g, c, m=>add(d,m[1], 'rel', 'import'));
    matchAll(/#[ \t]*include[ \t]+<([^>]+)>/g, c, m=>add(d,m[1], 'system', 'import'));
  }
  function goDeps(c, d){
    matchAll(/import[ \t]+"([^"]+)"/g, c, m=>add(d,m[1], 'module', 'import'));
    matchAll(/import[ \t]*\(([\s\S]*?)\)/g, c, m=>{
      matchAll(/"([^"]+)"/g, m[1], mm=>add(d,mm[1], 'module', 'import'));
    });
  }
  function javaDeps(c, d){
    matchAll(/^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+?)(\.\*)?[ \t]*;?[ \t]*$/gm, c, m=>{
      if(!m[2]) add(d, m[1], 'module', 'import');   // wildcard (java.util.*) pomijany; `;` opcjonalne (Kotlin/Scala)
    });
  }
  function csDeps(c, d){
    matchAll(/^[ \t]*using[ \t]+(?:static[ \t]+)?([\w.]+)[ \t]*;/gm, c, m=>add(d,m[1], 'cs-ns', 'import'));
  }
  function phpDeps(c, d){
    matchAll(/\b(?:require|require_once|include|include_once)\b[ \t]*\(?[ \t]*['"]([^'"]+)['"]/g, c, m=>add(d,m[1], rel(m[1]), 'import'));
    matchAll(/^[ \t]*use[ \t]+([\w\\]+)/gm, c, m=>add(d,m[1], 'php-ns', 'import'));
  }
  function rbDeps(c, d){
    matchAll(/\brequire_relative[ \t]+['"]([^'"]+)['"]/g, c, m=>add(d,m[1], 'rel', 'import'));
    matchAll(/\brequire[ \t]+['"]([^'"]+)['"]/g, c, m=>add(d,m[1], 'bare', 'import'));
  }
  function rustDeps(c, d){
    matchAll(/^[ \t]*(?:pub[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm, c, m=>add(d,m[1], 'rust-mod', 'import'));
    matchAll(/^[ \t]*use[ \t]+([\w:]+)/gm, c, m=>add(d,m[1], 'rust-use', 'import'));
  }
  function cssDeps(c, d){
    matchAll(/@import\s+(?:url\()?\s*['"]?([^'")]+)['"]?\s*\)?/g, c, m=>add(d,m[1], rel(m[1]), 'import'));
    // url() wewnątrz @import to już import — nie licz go drugi raz jako referencji do zasobu
    const rest = c.replace(/@import[^;\n]*;?/g, ' ');
    matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, rest, m=>add(d,m[1], rel(m[1]), 'reference'));
  }
  function htmlDeps(c, d){
    // W HTML każda ścieżka w src/href bez schematu jest względna (URL-e odrzuca add()) — wcześniej
    // `src="js/app.js"` bez `./` trafiało do 'bare', nie dawało krawędzi i udawało pakiet zewnętrzny "js".
    matchAll(/<(?:script|img|source|video|audio|iframe|embed)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi, c, m=>add(d,m[1], 'rel', 'reference'));
    matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi, c, m=>add(d,m[1], 'rel', 'reference'));
  }
  function mdDeps(c, d){
    matchAll(/\]\(\s*([^)\s]+)/g, c, m=>{ if(!/^[\w]+:/.test(m[1])) add(d,m[1], 'rel', 'reference'); });
  }
  function rel(spec){ return (spec.startsWith('.') || spec.startsWith('/')) ? 'rel' : 'bare'; }

  // languages where '#' starts a line comment (NOT C/JS/… where it's a preprocessor/anchor)
  const HASH_LANG = new Set(['py','pyw','pyi','rb','erb','rake','sh','bash','zsh','fish','yaml','yml','toml',
    'ini','cfg','conf','properties','env','r','rmd','pl','pm','jl','ex','exs','elixir','makefile','mk','cmake',
    'dockerfile','ps1','psm1','psd1','php','phtml','coffee','nim']);
  // blank out comments / docstrings so import regexes never match inside them (strings are KEPT —
  // import specifiers live in strings). Newlines preserved so line-anchored regexes still work.
  function stripNonCode(code, key){
    const fam = family(key);
    const hash = HASH_LANG.has(key);
    const html = ['html','xml','md'].includes(fam) || ['vue','svelte','astro','svg','htm','xhtml','mdx'].includes(key);
    const dashes = key==='sql'||key==='lua'||['hs','lhs','elm','ada','vhdl'].includes(key);
    let out='', i=0; const n=code.length;
    const blank=(a,b)=>{ for(let k=a;k<b;k++) out += code[k]==='\n'?'\n':' '; };
    while(i<n){
      const c=code[i], c2=code[i+1];
      if(c==='"'||c==="'"||c==='`'){
        if((c==='"'||c==="'") && code[i+1]===c && code[i+2]===c){          // triple-quoted (py docstring) -> blank
          const q=c+c+c, end=code.indexOf(q,i+3), stop=end<0?n:end+3; blank(i,stop); i=stop; continue;
        }
        out+=c; i++;                                                        // normal string -> keep
        while(i<n){ const d=code[i]; out+=d; i++; if(d==='\\'){ if(i<n){ out+=code[i]; i++; } continue; } if(d===c||d==='\n') break; }
        continue;
      }
      if(!html && c==='/'&&c2==='*'){ const end=code.indexOf('*/',i+2), stop=end<0?n:end+2; blank(i,stop); i=stop; continue; }
      if(html && c==='<' && code.substr(i,4)==='<!--'){ const end=code.indexOf('-->',i+4), stop=end<0?n:end+3; blank(i,stop); i=stop; continue; }
      if(!html && c==='/'&&c2==='/'){ let j=i; while(j<n&&code[j]!=='\n') j++; blank(i,j); i=j; continue; }   // w HTML/MD `//` to część URL-a
      if(hash && c==='#'){ let j=i; while(j<n&&code[j]!=='\n') j++; blank(i,j); i=j; continue; }
      if(dashes && c==='-'&&c2==='-'){ let j=i; while(j<n&&code[j]!=='\n') j++; blank(i,j); i=j; continue; }
      out+=c; i++;
    }
    return out;
  }

  // tolerant JSON (tsconfig/jsconfig may be JSONC: // and /* */ comments + trailing commas)
  function looseJSON(s){
    s = String(s).replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:"])\/\/[^\n]*/g,'$1').replace(/,\s*([}\]])/g,'$1');
    return JSON.parse(s);
  }
  // resolve a JS import via tsconfig/jsconfig paths + baseUrl
  function aliasResolve(spec, aliases, idx){
    for(const cfg of aliases){
      const baseDir = normPath(joinPath(cfg.dir, cfg.baseUrl||'.'));
      for(const key in (cfg.paths||{})){
        const star=key.indexOf('*'); let cap=null, ok=false;
        if(star>=0){ const pre=key.slice(0,star), suf=key.slice(star+1);
          if(spec.startsWith(pre)&&spec.endsWith(suf)&&spec.length>=pre.length+suf.length){ cap=spec.slice(pre.length, spec.length-suf.length); ok=true; } }
        else if(spec===key){ ok=true; cap=''; }
        if(!ok) continue;
        const targets=cfg.paths[key]; const arr=Array.isArray(targets)?targets:[targets];
        for(const t of arr){ const resolved=t.indexOf('*')>=0?t.replace('*',cap):t;
          const hit=tryExact(idx.byPath, expand(normPath(joinPath(baseDir, resolved)),'js')); if(hit) return hit; }
      }
      if(cfg.baseUrl!=null){ const hit=tryExact(idx.byPath, expand(normPath(joinPath(baseDir, spec)),'js')); if(hit) return hit; }
    }
    return null;
  }

  function extractDeps(content, key){
    if(content == null) return [];
    content = stripNonCode(content, key);
    const d = [];
    const fam = family(key);
    if(fam === 'js' || ['vue','svelte','astro'].includes(key)) jsDeps(content, d);
    if(fam === 'py') pyDeps(content, d);
    if(fam === 'c') cDeps(content, d);
    if(fam === 'go') goDeps(content, d);
    if(fam === 'java') javaDeps(content, d);
    if(fam === 'cs') csDeps(content, d);
    if(fam === 'php') phpDeps(content, d);
    if(fam === 'rb') rbDeps(content, d);
    if(fam === 'rust') rustDeps(content, d);
    if(fam === 'css') cssDeps(content, d);
    if(fam === 'html' || ['vue','svelte','astro'].includes(key)) htmlDeps(content, d);
    if(fam === 'md') mdDeps(content, d);
    return d;
  }

  // ---------- symbol extraction (functions / classes / types) + per-symbol complexity ----------
  function extractSymbols(content, key){
    if(content==null) return [];
    const src=stripNonCode(content, key);
    const fam=family(key);
    const lines=src.split(/\r\n|\r|\n/);
    const syms=[];
    const push=(name,kind,i)=>{ if(name) syms.push({name, kind, line:i+1}); };
    for(let i=0;i<lines.length;i++){
      const L=lines[i]; let m;
      if(fam==='js'){
        if(m=/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/.exec(L)) push(m[1],'function',i);
        else if(m=/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(L)) push(m[1],'class',i);
        else if(m=/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.exec(L)) push(m[1],'function',i);
        else if(m=/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(L)) push(m[1],'interface',i);
        else if(m=/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/.exec(L)) push(m[1],'type',i);
      } else if(fam==='py'){
        if(m=/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(L)) push(m[1],'function',i);
        else if(m=/^\s*class\s+([A-Za-z_]\w*)/.exec(L)) push(m[1],'class',i);
      } else if(fam==='go'){
        if(m=/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(L)) push(m[1],'function',i);
        else if(m=/^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/.exec(L)) push(m[1],'type',i);
      } else if(fam==='rust'){
        if(m=/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/.exec(L)) push(m[1],'function',i);
        else if(m=/^\s*(?:pub\s+)?(?:struct|enum|trait|impl)\s+(?:\w+\s+for\s+)?([A-Za-z_]\w*)/.exec(L)) push(m[1],'type',i);
      } else if(fam==='php'){
        if(m=/^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+([A-Za-z_]\w*)/.exec(L)) push(m[1],'function',i);
        else if(m=/^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+([A-Za-z_]\w*)/.exec(L)) push(m[1],'class',i);
      } else if(fam==='rb'){
        if(m=/^\s*def\s+([A-Za-z_][\w?!.]*)/.exec(L)) push(m[1],'function',i);
        else if(m=/^\s*(?:class|module)\s+([A-Z]\w*)/.exec(L)) push(m[1],'class',i);
      } else if(fam==='java'||fam==='cs'){
        if(m=/^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*(?:class|interface|enum|struct|record)\s+([A-Za-z_]\w*)/.exec(L)) push(m[1],'class',i);
        else if(m=/^\s*(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async|synchronized)\s+)+[A-Za-z_][\w<>\[\].,\s]*\s+([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{?\s*$/.exec(L)) push(m[1],'method',i);
      } else if(fam==='c'){
        if(m=/^\s*(?:typedef\s+)?(?:struct|enum|union|class)\s+([A-Za-z_]\w*)/.exec(L)) push(m[1],'type',i);
        else if(/\)\s*\{?\s*$/.test(L) && !/\b(if|for|while|switch|return|else|sizeof)\b/.test(L) && (m=/\b([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$/.exec(L))) push(m[1],'function',i);
      }
    }
    // per-symbol complexity: count branch points from this symbol up to the next
    for(let i=0;i<syms.length;i++){
      const s=syms[i].line-1, e=(i+1<syms.length?syms[i+1].line-1:Math.min(lines.length, s+80));
      let c=1; for(let j=s;j<e;j++){ const L=lines[j];
        const b=L.match(/\b(if|elif|for|while|case|catch|switch|when|foreach)\b/g); if(b) c+=b.length;
        const o=L.match(/&&|\|\||\?\./g); if(o) c+=o.length;
      }
      syms[i].complexity=c;
    }
    return syms.slice(0,250);
  }

  // ---------- resolution / edge building ----------
  const JS_EXT = ['', '.js','.jsx','.ts','.tsx','.mjs','.cjs','.mts','.cts','.vue','.svelte','.astro','.json','.css','.scss'];
  const JS_IDX = ['/index.js','/index.jsx','/index.ts','/index.tsx','/index.mjs','/index.vue'];

  function expand(base, fam){
    const c = [];
    // kolejność: plik z rozszerzeniem → index w katalogu → dopiero goły cel (może być folderem)
    if(fam === 'js'){ JS_EXT.filter(e=>e).forEach(e=>c.push(base+e)); JS_IDX.forEach(e=>c.push(base+e)); c.push(base); }
    else if(fam === 'css'){
      const dir = dirname(base), nm = basename(base);
      ['.css','.scss','.sass','.less','.styl',''].forEach(e=>{ c.push(base+e); c.push((dir?dir+'/':'')+'_'+nm+e); });
    }
    else if(fam === 'py'){ c.push(base+'.py', base+'/__init__.py', base); }
    else if(fam === 'rb'){ c.push(base+'.rb', base); }
    else { c.push(base); }
    return c.map(normPath);
  }

  function tryExact(byPath, cands){ for(const c of cands){ const n = byPath.get(c); if(n) return n; } return null; }

  function suffixFind(idx, cands){
    const exact = tryExact(idx.byPath, cands.map(normPath)); if(exact) return exact;
    let best=null, bestLen=Infinity;
    for(let c of cands){
      c = normPath(c);
      const base = basename(c).toLowerCase();
      const arr = idx.byBase.get(base); if(!arr) continue;
      for(const n of arr){
        if(n.type!=='file') continue;
        if(n.path === c || n.path.endsWith('/'+c)){ if(n.path.length < bestLen){ best=n; bestLen=n.path.length; } }
      }
    }
    return best;
  }

  function suffixFolder(idx, spec){
    const segs = spec.split('/').filter(Boolean);
    for(let take=Math.min(segs.length,4); take>=1; take--){
      const suf = segs.slice(segs.length-take).join('/');
      for(const [p,f] of idx.folderByPath){ if(p===suf || p.endsWith('/'+suf)) return f; }
    }
    return null;
  }

  function resolveDep(file, dep, idx, aliases){
    const fam = family(file.lang);
    const dir = dirname(file.path);
    const spec = dep.spec;
    switch(dep.kind){
      case 'system': case 'cs-ns': case 'rust-use': return null;
      case 'rel': {
        const base = joinPath(dir, spec);
        return tryExact(idx.byPath, expand(base, fam));
      }
      case 'rust-mod': return tryExact(idx.byPath, [joinPath(dir,spec)+'.rs', joinPath(dir,spec)+'/mod.rs'].map(normPath));
      case 'py-rel': {
        const dots = spec.match(/^\.+/)[0].length;
        let up = dir; for(let i=1;i<dots;i++) up = dirname(up);
        const rest = spec.slice(dots).replace(/\./g,'/');
        const base = joinPath(up, rest);
        return tryExact(idx.byPath, [base+'.py', base+'/__init__.py', base].map(normPath));
      }
      case 'module': {
        if(fam==='py'){ const p = spec.replace(/\./g,'/'); return suffixFind(idx, [p+'.py', p+'/__init__.py']); }
        if(fam==='java'){ const p = spec.replace(/\./g,'/'); return suffixFind(idx, [p+'.java', p+'.kt', p+'.scala', p+'.groovy']); }
        if(fam==='go'){ return suffixFolder(idx, spec); }
        return null;
      }
      case 'php-ns': { const cls = spec.split('\\').pop(); return suffixFind(idx, [cls+'.php']); }
      case 'bare': {
        if(fam==='css'){ const base = joinPath(dir, spec); return tryExact(idx.byPath, expand(base,'css')); }
        if(fam==='js' && aliases && aliases.length){ const a=aliasResolve(spec, aliases, idx); if(a) return a; }
        return null;
      }
      default: return null;
    }
  }

  function externalName(spec){
    if(spec.startsWith('@')){ const p = spec.split('/'); return p.slice(0,2).join('/'); }
    if(spec.includes('\\')) return spec.split('\\')[0];
    return spec.split('/')[0].split('.')[0] || spec;
  }

  // build import / reference edges + external module summary
  function buildEdges(nodes, aliases){
    const byPath = new Map(), byBase = new Map(), folderByPath = new Map();
    for(const n of nodes){
      byPath.set(n.path, n);
      const b = n.name.toLowerCase();
      if(!byBase.has(b)) byBase.set(b, []);
      byBase.get(b).push(n);
      if(n.type === 'folder') folderByPath.set(n.path, n);
    }
    const idx = {byPath, byBase, folderByPath};
    const edges = [];
    const seen = new Set();
    const externals = new Map();
    function addEdge(s,t,type){
      if(s===t) return;
      const k = type+'|'+s+'|'+t; if(seen.has(k)) return; seen.add(k);
      edges.push({id:'imp'+edges.length, source:s, target:t, type});
    }
    for(const f of nodes){
      if(f.type!=='file' || !f.deps || !f.deps.length) continue;
      for(const dep of f.deps){
        const tgt = resolveDep(f, dep, idx, aliases);
        if(tgt){ addEdge(f.id, tgt.id, dep.etype==='reference'?'reference':'import'); }
        else if(dep.kind==='bare' || dep.kind==='module' || dep.kind==='cs-ns' || dep.kind==='php-ns'){
          const name = externalName(dep.spec);
          if(!name) continue;
          if(!externals.has(name)) externals.set(name, {name, count:0, importers:[]});
          const ex = externals.get(name); ex.count++; if(!ex.importers.includes(f.id)) ex.importers.push(f.id);
        }
      }
    }
    return {edges, externals};
  }

  return {analyzeContent, extractDeps, extractSymbols, buildEdges, family, stripNonCode, looseJSON,
          normPath, dirname, basename, joinPath, externalName};
})();
