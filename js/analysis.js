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
    if(['swift'].includes(key)) return 'swift';
    if(['dart'].includes(key)) return 'dart';
    if(['ex','exs'].includes(key)) return 'elixir';
    if(['lua'].includes(key)) return 'lua';
    if(['zig'].includes(key)) return 'zig';
    if(['hs','lhs'].includes(key)) return 'hs';
    if(['sh','bash','zsh','fish'].includes(key)) return 'sh';
    return 'other';
  }

  // ---------- comment syntax (for LOC breakdown) ----------
  function commentSyntax(key){
    const slash = {line:['//'], blockStart:'/*', blockEnd:'*/'};
    const hash  = {line:['#'], blockStart:null, blockEnd:null};
    const fam = family(key);
    if(['js','c','java','cs','go','rust','css','swift','dart','zig'].includes(fam)) return slash;
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
  // extra: dodatkowe pola wpisu (np. {reexport:true}, {exclude:[…]} dla globów)
  function add(deps, spec, kind, etype, extra){
    spec = (spec||'').trim();
    if(!spec) return;
    if(/^(https?:)?\/\//i.test(spec) || spec.startsWith('data:') || spec.startsWith('#') ||
       spec.startsWith('mailto:') || spec.startsWith('tel:') || spec.startsWith('javascript:')) return;
    deps.push(extra ? Object.assign({spec, kind, etype}, extra) : {spec, kind, etype});
  }
  function matchAll(re, str, cb){ let m; re.lastIndex=0; while((m = re.exec(str)) !== null){ cb(m); if(m.index===re.lastIndex) re.lastIndex++; } }

  function jsDeps(c, d){
    // `export … from './x'` = reexport (barrel) — ta sama krawędź, flaga dla przyszłego grafu symboli
    matchAll(/(import|export)\s+(?:[\w*{}\s,]+\sfrom\s+)?['"]([^'"]+)['"]/g, c, m=>add(d,m[2], rel(m[2]), 'import', m[1]==='export' ? {reexport:true} : null));
    matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, c, m=>add(d,m[1], rel(m[1]), 'import'));
    matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, c, m=>add(d,m[1], rel(m[1]), 'import'));
    // odwołania dynamiczne: worker / URL względem modułu / importScripts / require.resolve / glob Vite
    // (`fetch('./x.json')` celowo NIE — za dużo fałszywych trafień). Ścieżki workerów i URL-i są względne
    // wobec skryptu, więc także bez `./` traktujemy je jak 'rel'.
    matchAll(/\bnew\s+(?:Shared)?Worker\(\s*['"]([^'"]+)['"]/g, c, m=>add(d,m[1], 'rel', 'import'));
    matchAll(/\bnew\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g, c, m=>add(d,m[1], 'rel', 'import'));
    matchAll(/\bimportScripts\(([^)]*)\)/g, c, m=>matchAll(/['"]([^'"]+)['"]/g, m[1], mm=>add(d,mm[1], 'rel', 'import')));
    matchAll(/\brequire\.resolve\(\s*['"]([^'"]+)['"]/g, c, m=>add(d,m[1], rel(m[1]), 'import'));
    matchAll(/\bimport\.meta\.glob(?:Eager)?\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g, c, m=>{
      const pats = []; matchAll(/['"]([^'"]+)['"]/g, m[1], mm=>pats.push(mm[1]));
      const exclude = pats.filter(p=>p.startsWith('!')).map(p=>p.slice(1));
      pats.filter(p=>!p.startsWith('!')).forEach(p=>add(d, p, 'glob', 'import', exclude.length ? {exclude} : null));
    });
  }
  // glob → RegExp na znormalizowanej ścieżce: `*` w obrębie segmentu, `**/` zero lub więcej katalogów, `?`, `{a,b}`
  function globRegex(g){
    let re = '';
    for(let i=0;i<g.length;i++){
      const c = g[i];
      if(c === '*'){
        if(g[i+1] === '*'){ i++; if(g[i+1] === '/'){ i++; re += '(?:.*/)?'; } else re += '.*'; }
        else re += '[^/]*';
      }
      else if(c === '?') re += '[^/]';
      else if(c === '{'){ const j = g.indexOf('}', i); if(j > i){ re += '(?:' + g.slice(i+1, j).split(',').map(s=>s.replace(/[.+^$()|[\]\\]/g,'\\$&')).join('|') + ')'; i = j; } else re += '\\{'; }
      else re += c.replace(/[.+^$()|[\]\\]/g,'\\$&');
    }
    return new RegExp('^' + re + '$');
  }
  function pyDeps(c, d){
    matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm, c, m=>{
      m[1].split(',').forEach(s=>add(d, s.trim().split(/\s+as\s+/)[0], 'module', 'import'));
    });
    // `from X import a, b as c, (d,\n e)` — nazwy mogą być podmodułami pakietu X (X/a.py), więc trafiają do `names`
    matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]*(\([^)]*\)|[^\n]*)/gm, c, m=>{
      const s = m[1];
      const names = m[2].replace(/[()]/g,' ').split(',').map(x=>x.trim().split(/\s+/)[0]).filter(x=>/^\w+$/.test(x));
      const extra = names.length ? {names} : null;
      if(s.startsWith('.')) add(d, s, 'py-rel', 'import', extra);
      else if(s) add(d, s, 'module', 'import', extra);
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
    // `using X.Y;` | `using static X.Y.Type;` | `using Alias = X.Y.Type;` — static/alias wskazują TYP, więc przy
    // rozwiązywaniu wolno spaść do namespace nadrzędnego (up). `using (var x…)` / `using var x = …` nie pasują.
    matchAll(/^[ \t]*using[ \t]+(?:(static)[ \t]+)?(?:(\w+)[ \t]*=[ \t]*)?([\w.]+)[ \t]*;/gm, c, m=>add(d,m[3], 'cs-ns', 'import', (m[1]||m[2]) ? {up:true} : null));
    // deklaracje `namespace A.B;` (file-scoped) i `namespace A.B {` — indeks namespace→pliki dla `using` z innych plików
    matchAll(/^[ \t]*namespace[ \t]+([\w.]+)[ \t]*(?:;|\{|$)/gm, c, m=>add(d,m[1], 'decl', 'decl'));
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
    matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm, c, m=>add(d,m[1], 'rust-mod', 'import'));
    // `use a::b::c;` | `pub use …` (reexport) | `use a::{b, c::d, self, *}` (jeden poziom nawiasów) | `use ::core::x`
    matchAll(/^[ \t]*(pub(?:\([^)]*\))?[ \t]+)?use[ \t]+(?:::)?([\w:]+)(?:\{([^}]*)\})?/gm, c, m=>{
      const extra = m[1] ? {reexport:true} : null, base = m[2];
      if(m[3] == null){ add(d, base.replace(/::$/,''), 'rust-use', 'import', extra); return; }
      for(let item of m[3].split(',')){
        item = item.trim().split(/\s+as\s+/)[0];
        const nested = item.indexOf('{'); if(nested >= 0) item = item.slice(0, nested).replace(/::$/,'');   // `b::{c,d}` → b
        if(!item) continue;
        add(d, (item === 'self' || item === '*') ? base.replace(/::$/,'') : base + item, 'rust-use', 'import', extra);
      }
    });
  }
  function cssDeps(c, d){
    // `@import 'x'` / `@import url(x)`; Sass: `@use 'x' [as y] [with (...)]`, `@forward 'x' [as y-*] [show/hide …]`
    // — jak @import (partiale, index); `sass:math` itp. to moduły wbudowane (bez krawędzi i externala); @forward = reexport
    matchAll(/@(import|use|forward)\s+(?:url\()?\s*['"]?([^'")]+)['"]?\s*\)?/g, c, m=>{
      const s = m[2];
      add(d, s, s.startsWith('sass:') ? 'system' : rel(s), 'import', m[1]==='forward' ? {reexport:true} : null);
    });
    // url() wewnątrz @import to już import — nie licz go drugi raz jako referencji do zasobu
    const rest = c.replace(/@(?:import|use|forward)[^;\n]*;?/g, ' ');
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
  // ---- nowe rodziny (Faza 2) ----
  function swiftDeps(c, d){   // `import Foo`, `@testable import Foo`, `import struct Foo.Bar` → moduł Foo
    matchAll(/^[ \t]*(?:@testable[ \t]+)?import[ \t]+(?:(?:struct|class|enum|protocol|typealias|func|var|let)[ \t]+)?([A-Za-z_]\w*)/gm, c, m=>add(d,m[1], 'module', 'import'));
  }
  function dartDeps(c, d){    // `dart:io` systemowe; `package:app/x.dart` → pakiet; reszta względna; `part of 'x'` też; export = reexport
    matchAll(/^[ \t]*(import|export|part(?:[ \t]+of)?)[ \t]+['"]([^'"]+)['"]/gm, c, m=>{
      const s = m[2], extra = m[1]==='export' ? {reexport:true} : null;
      if(s.startsWith('dart:')) add(d, s, 'system', 'import');
      else if(s.startsWith('package:')) add(d, s.slice(8), 'dart-pkg', 'import', extra);
      else add(d, s, 'rel', 'import', extra);
    });
  }
  // moduły biblioteki standardowej Elixira: bez krawędzi (chyba że projekt je definiuje) i bez externala
  const ELIXIR_STD = new Set(['Kernel','Enum','Map','List','String','Integer','Float','IO','File','Path','Agent','Task','GenServer','Supervisor',
    'DynamicSupervisor','PartitionSupervisor','Application','Logger','Process','Keyword','Access','Stream','Tuple','Atom','Base','Bitwise','Code',
    'Date','DateTime','NaiveDateTime','Time','Calendar','Regex','Registry','System','URI','Version','Exception','Macro','Module','Node','Port',
    'Protocol','Record','Range','MapSet','Function','Inspect','ExUnit','Mix','Behaviour','Config','Enumerable','Collectable','StringIO','OptionParser']);
  function elixirDeps(c, d){
    matchAll(/^[ \t]*defmodule[ \t]+([A-Z][\w.]*)/gm, c, m=>add(d,m[1], 'decl', 'decl'));
    // `alias A.B`, `alias A.{B, C.D}`, `alias A.B, as: X`, `import A.B, only: […]`, `use A.B, opts`, `require A`
    matchAll(/^[ \t]*(?:alias|import|use|require)[ \t]+([A-Z][\w.]*?)(?:\.\{([^}]*)\})?(?=[\s,]|$)/gm, c, m=>{
      const mods = m[2] != null ? m[2].split(',').map(s=>s.trim()).filter(Boolean).map(s=>m[1]+'.'+s) : [m[1]];
      for(const mod of mods) add(d, mod, ELIXIR_STD.has(mod.split('.')[0]) ? 'ex-std' : 'module', 'import');
    });
  }
  function luaDeps(c, d){     // `require('a.b')` / `require "a/b"` → moduł
    matchAll(/\brequire[ \t]*\(?[ \t]*['"]([^'"]+)['"]/g, c, m=>add(d,m[1], 'module', 'import'));
  }
  function zigDeps(c, d){     // `@import("x.zig")` względne; std/builtin/root systemowe; inne = pakiet z build.zig
    matchAll(/@import\(\s*"([^"]+)"\s*\)/g, c, m=>{
      const s = m[1];
      add(d, s, /\.zig$/.test(s) || s.includes('/') ? 'rel' : (['std','builtin','root'].includes(s) ? 'system' : 'bare'), 'import');
    });
  }
  function hsDeps(c, d){      // `import [safe] [qualified] ["pkg"] Data.Map [qualified] [as M] [(…)]`
    matchAll(/^[ \t]*import[ \t]+(?:safe[ \t]+)?(?:qualified[ \t]+)?(?:"[^"]*"[ \t]+)?([A-Z][\w.']*)/gm, c, m=>add(d,m[1], 'module', 'import'));
  }
  function shDeps(c, d){      // `source x.sh` / `. x.sh` — ścieżki ze zmiennymi ($HOME, `cmd`) pomijane
    matchAll(/^[ \t]*(?:source|\.)[ \t]+(?:"([^"]*)"|'([^']*)'|([^\s;|&<>()"']+))/gm, c, m=>{
      const s = m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3]);
      if(s && !/[$`]/.test(s)) add(d, s, 'rel', 'import');
    });
  }
  function rel(spec){ return (spec.startsWith('.') || spec.startsWith('/')) ? 'rel' : 'bare'; }
  // CamelCase → snake_case jak Macro.underscore w Elixirze (HTTPClient → http_client)
  function snakeCase(s){ return s.replace(/([A-Z]+)([A-Z][a-z])/g,'$1_$2').replace(/([a-z\d])([A-Z])/g,'$1_$2').toLowerCase(); }

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
      if(key==='lua' && code.substr(i,4)==='--[['){ const end=code.indexOf(']]',i+4), stop=end<0?n:end+2; blank(i,stop); i=stop; continue; }   // Lua --[[ ]]
      if((key==='hs'||key==='lhs') && c==='{'&&c2==='-'){ const end=code.indexOf('-}',i+2), stop=end<0?n:end+2; blank(i,stop); i=stop; continue; } // Haskell {- -} i pragmy {-# #-}
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
  // ---------- manifesty: wpis dla buildEdges (tsconfig/jsconfig → aliasy; package.json → nazwa pakietu) ----------
  // Zwraca null, gdy plik nie jest manifestem albo nie wnosi nic do rozwiązywania importów.
  function manifestEntry(name, content, dir){
    if(content == null) return null;
    const n = String(name).toLowerCase(); dir = normPath(dir||'');
    try{
      if(n === 'package.json'){
        const j = looseJSON(content);
        if(typeof j.name === 'string' && j.name.trim()) return {kind:'package', eco:'npm', dir, name:j.name.trim(), main:j.main, module:j.module, exports:j.exports};
        return null;
      }
      if(/^(tsconfig|jsconfig)(\..+)?\.json$/.test(n)){   // też tsconfig.base.json / tsconfig.app.json — cele `extends`
        const j = looseJSON(content); const co = j.compilerOptions || {};
        if(!(co.paths || co.baseUrl != null || j.extends)) return null;
        return {kind:'alias', dir, file: joinPath(dir, name), primary: n === 'tsconfig.json' || n === 'jsconfig.json',
                baseUrl: co.baseUrl != null ? String(co.baseUrl) : null, paths: co.paths || null, extends: j.extends || null};
      }
      if(n === 'pubspec.yaml' || n === 'pubspec.yml'){   // name: app → `package:app/x.dart` → lib/x.dart
        const m = /^name:[ \t]*["']?([\w-]+)/m.exec(content); return m ? {kind:'package', eco:'dart', dir, name:m[1]} : null;
      }
      if(n === 'cargo.toml'){   // [package] name = "x" → `use x::…` i korzeń src/ dla `crate::`
        let sec = '';
        for(const line of content.split(/\r?\n/)){ const t = line.trim();
          if(t.startsWith('[')){ sec = t; continue; }
          if(sec === '[package]'){ const m = /^name[ \t]*=[ \t]*["']([^"']+)["']/.exec(t); if(m) return {kind:'package', eco:'cargo', dir, name:m[1]}; }
        }
        return null;
      }
    }catch(e){ /* uszkodzony manifest = brak wpisu */ }
    return null;
  }

  // Konfiguracje tsconfig/jsconfig: `extends` scalane (bliższy config nadpisuje klucze `paths`; `baseUrl`
  // z najbliższego configu w łańcuchu, który go deklaruje, względem JEGO katalogu; `paths` bez baseUrl
  // względem katalogu configu, który je deklaruje — jak w TS ≥ 4.1). Każda konfiguracja obowiązuje TYLKO
  // dla plików w swoim katalogu i podkatalogach; najbliższa wygrywa i nie ma spadania do dalszych.
  function aliasConfigs(manifests){
    const cfgs = (manifests||[])
      .filter(m => m && (m.kind === 'alias' || (!m.kind && (m.paths || m.baseUrl != null))))   // bez kind = stary format {dir,baseUrl,paths}
      .map(m => ({dir: normPath(m.dir||''), file: normPath(m.file || joinPath(m.dir||'', 'tsconfig.json')), primary: m.primary !== false,
                  baseUrl: m.baseUrl != null ? String(m.baseUrl) : null, paths: m.paths || null, extends: m.extends || null}));
    const byFile = new Map(cfgs.map(c => [c.file, c]));
    const chainOf = (cfg, seen) => {
      const out = [cfg]; seen.add(cfg.file);
      const exts = Array.isArray(cfg.extends) ? cfg.extends : (cfg.extends ? [cfg.extends] : []);
      for(const e of exts){
        if(typeof e !== 'string' || !/^\.{0,2}\//.test(e)) continue;   // `@tsconfig/node18` itp. nie są w projekcie
        const base = normPath(joinPath(cfg.dir, e));
        const parent = byFile.get(base) || byFile.get(base + '.json') || byFile.get(base + '/tsconfig.json');
        if(parent && !seen.has(parent.file)) out.push(...chainOf(parent, seen));
      }
      return out;
    };
    const resolved = cfgs.map(cfg => {
      const chain = chainOf(cfg, new Set());
      let baseDir = null;
      for(let i = chain.length-1; i >= 0; i--) if(chain[i].baseUrl != null) baseDir = normPath(joinPath(chain[i].dir, chain[i].baseUrl));
      const paths = new Map();
      for(let i = chain.length-1; i >= 0; i--){
        const c = chain[i]; if(!c.paths || typeof c.paths !== 'object') continue;
        // ściśle: względem baseUrl (jeśli jest w łańcuchu); awaryjnie katalog configu deklarującego `paths` —
        // częsty błąd w monorepo (baza z baseUrl ".", pakiet z "@/*": ["src/*"]) i tak wskazuje istniejący plik
        const bases = baseDir != null && baseDir !== c.dir ? [baseDir, c.dir] : [c.dir];
        for(const k in c.paths){ const t = c.paths[k]; paths.set(k, {targets: (Array.isArray(t) ? t : [t]).filter(x => typeof x === 'string'), bases}); }
      }
      return {dir: cfg.dir, file: cfg.file, primary: cfg.primary, baseDir: baseDir != null ? baseDir : cfg.dir, paths};
    });
    // najgłębszy katalog pierwszy; w tym samym katalogu tsconfig.json/jsconfig.json przed wariantami (tsconfig.base.json)
    resolved.sort((a, b) => (b.dir.length - a.dir.length) || ((b.primary ? 1 : 0) - (a.primary ? 1 : 0)));
    return resolved;
  }
  function aliasFor(cfgs, filePath){
    const dir = dirname(filePath);
    for(const c of cfgs){ if(c.dir === '' || dir === c.dir || dir.startsWith(c.dir + '/')) return c; }
    return null;
  }
  // ---------- workspaces: `import x from '@scope/pkg[/sub]'` → pakiet z package.json w projekcie ----------
  function packageIndex(manifests){
    const m = new Map();
    for(const p of (manifests||[])){
      if(!p || p.kind !== 'package' || (p.eco && p.eco !== 'npm') || !p.name) continue;
      const cur = m.get(p.name);                       // duplikat nazwy: płytszy katalog wygrywa
      if(!cur || normPath(p.dir||'').length < cur.dir.length) m.set(p.name, {...p, dir: normPath(p.dir||'')});
    }
    return m;
  }
  // cel z pola `exports`: string | tablica | obiekt warunków {import, require, default, …}
  function exportTarget(ex){
    if(typeof ex === 'string') return ex;
    if(Array.isArray(ex)){ for(const e of ex){ const t = exportTarget(e); if(t) return t; } return null; }
    if(ex && typeof ex === 'object'){
      for(const k of ['import','module','default','require','node','browser']) if(k in ex){ const t = exportTarget(ex[k]); if(t) return t; }
      for(const k in ex){ if(k.startsWith('.')) continue; const t = exportTarget(ex[k]); if(t) return t; }
    }
    return null;
  }
  // wpis exports dla podścieżki `.` / `./x` (dokładny klucz, potem wzorce `./feat/*`)
  function exportFor(exports, sub){
    if(!exports || typeof exports !== 'object' || Array.isArray(exports)) return sub === '.' ? exportTarget(exports) : null;
    const keys = Object.keys(exports);
    if(!keys.some(k => k.startsWith('.'))) return sub === '.' ? exportTarget(exports) : null;   // sam obiekt warunków = "."
    if(sub in exports) return exportTarget(exports[sub]);
    for(const k of keys){
      const star = k.indexOf('*'); if(star < 0) continue;
      const pre = k.slice(0,star), suf = k.slice(star+1);
      if(sub.startsWith(pre) && sub.endsWith(suf) && sub.length >= pre.length+suf.length){
        const t = exportTarget(exports[k]); if(t) return t.replace('*', sub.slice(pre.length, sub.length-suf.length));
      }
    }
    return null;
  }
  function packageResolve(spec, idx){
    if(!idx.pkgs.size) return null;
    const name = externalName(spec); const pkg = idx.pkgs.get(name);
    if(!pkg || spec.length < name.length) return null;
    const sub = spec.slice(name.length);                 // '' albo '/x/y'
    const dir = pkg.dir;
    const hit = (p) => tryExact(idx.byPath, expand(normPath(joinPath(dir, p)), 'js'));
    if(sub){
      const t = exportFor(pkg.exports, '.' + sub);
      return (t && hit(t)) || hit(sub);
    }
    const cands = [exportFor(pkg.exports, '.'), pkg.module, pkg.main].filter(x => typeof x === 'string' && x);
    for(const c of cands){ const h = hit(c); if(h) return h; }
    const index = tryExact(idx.byPath, JS_IDX.map(e => normPath(dir + e))); if(index) return index;
    return dir ? (idx.folderByPath.get(dir) || null) : null;   // pakiet bez main/index → folder pakietu (root projektu nie)
  }

  // rozwiązanie importu JS przez paths + baseUrl JEDNEJ (najbliższej) konfiguracji
  function aliasResolve(spec, cfg, idx){
    if(!cfg) return null;
    for(const [key, {targets, bases}] of cfg.paths){
      const star = key.indexOf('*'); let cap = null, ok = false;
      if(star >= 0){ const pre = key.slice(0,star), suf = key.slice(star+1);
        if(spec.startsWith(pre) && spec.endsWith(suf) && spec.length >= pre.length+suf.length){ cap = spec.slice(pre.length, spec.length-suf.length); ok = true; } }
      else if(spec === key){ ok = true; cap = ''; }
      if(!ok) continue;
      for(const t of targets){ const resolved = t.indexOf('*') >= 0 ? t.replace('*', cap) : t;
        for(const base of bases){ const hit = tryExact(idx.byPath, expand(normPath(joinPath(base, resolved)), 'js')); if(hit) return hit; } }
    }
    // baseUrl (jawny lub domyślnie katalog configu): `import 'src/x'`
    return tryExact(idx.byPath, expand(normPath(joinPath(cfg.baseDir, spec)), 'js'));
  }

  function extractDeps(content, key){ if(content == null) return []; return depsFromStripped(stripNonCode(content, key), key); }
  // wariant na tekście już oczyszczonym z komentarzy (analyzeFile robi stripNonCode RAZ dla deps i symbols)
  function depsFromStripped(content, key){
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
    if(fam === 'swift') swiftDeps(content, d);
    if(fam === 'dart') dartDeps(content, d);
    if(fam === 'elixir') elixirDeps(content, d);
    if(fam === 'lua') luaDeps(content, d);
    if(fam === 'zig') zigDeps(content, d);
    if(fam === 'hs') hsDeps(content, d);
    if(fam === 'sh') shDeps(content, d);
    return d;
  }

  // ---------- symbol extraction (functions / classes / types) + per-symbol complexity ----------
  function extractSymbols(content, key){ if(content==null) return []; return symbolsFromStripped(stripNonCode(content, key), key); }
  function symbolsFromStripped(src, key){
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
      // plik → partial `_x` → index katalogu (`x/index`, `x/_index`) → goły cel
      ['.css','.scss','.sass','.less','.styl'].forEach(e=>{ c.push(base+e); c.push((dir?dir+'/':'')+'_'+nm+e); });
      ['.css','.scss','.sass','.less','.styl'].forEach(e=>{ c.push(base+'/index'+e); c.push(base+'/_index'+e); });
      c.push(base, (dir?dir+'/':'')+'_'+nm);
    }
    else if(fam === 'py'){ c.push(base+'.py', base+'/__init__.py', base); }
    else if(fam === 'rb'){ c.push(base+'.rb', base); }
    else { c.push(base); }
    return c.map(normPath);
  }

  function tryExact(byPath, cands){ for(const c of cands){ const n = byPath.get(c); if(n) return n; } return null; }

  // plik, którego ścieżka KOŃCZY się na kandydata (a/b/c.py dla a.b.c): dokładny od korzenia, potem — przy kilku
  // trafieniach — ten o najdłuższym wspólnym prefiksie katalogów z `fromDir` (bliższy pakiet), na końcu najkrótszy
  function suffixFind(idx, cands, fromDir){
    const exact = tryExact(idx.byPath, cands.map(normPath)); if(exact) return exact;
    const from = fromDir != null ? fromDir.split('/') : null;
    const common = (p) => { if(!from) return 0; const a = dirname(p).split('/'); let i=0; while(i<a.length && i<from.length && a[i]===from[i]) i++; return i; };
    let best=null, bestScore=-1, bestLen=Infinity;
    for(let c of cands){
      c = normPath(c);
      const base = basename(c).toLowerCase();
      const arr = idx.byBase.get(base); if(!arr) continue;
      for(const n of arr){
        if(n.type!=='file') continue;
        if(n.path === c || n.path.endsWith('/'+c)){
          const s = common(n.path);
          if(s > bestScore || (s === bestScore && n.path.length < bestLen)){ best=n; bestScore=s; bestLen=n.path.length; }
        }
      }
    }
    return best;
  }
  // Python: moduł + podmoduły z `names` (`from pkg import a` → pkg/a.py), gdy celem jest pakiet (__init__.py)
  function pyWithNames(base, dep, idx){
    if(!base || !dep.names || basename(base.path) !== '__init__.py') return base;
    const out = [base], pkgDir = dirname(base.path);
    for(const nm of dep.names){
      const h = tryExact(idx.byPath, [pkgDir+'/'+nm+'.py', pkgDir+'/'+nm+'/__init__.py'].map(normPath));
      if(h && !out.includes(h)) out.push(h);
    }
    return out;
  }

  function suffixFolder(idx, spec){
    const segs = spec.split('/').filter(Boolean);
    for(let take=Math.min(segs.length,4); take>=1; take--){
      const suf = segs.slice(segs.length-take).join('/');
      for(const [p,f] of idx.folderByPath){ if(p===suf || p.endsWith('/'+suf)) return f; }
    }
    return null;
  }

  // ---------- Rust: moduły plikowe ----------
  // katalog src/ crate'a, do którego należy plik (segment `src` najbliżej pliku; awaryjnie katalog pliku — tests/, examples/)
  function rustRoot(file){
    const segs = dirname(file.path).split('/'); const k = segs.lastIndexOf('src');
    return k >= 0 ? segs.slice(0, k+1).join('/') : dirname(file.path);
  }
  // katalog modułu pliku: `a/b.rs` → moduł a::b, dzieci w `a/b/`; `mod.rs`/`lib.rs`/`main.rs` → własny katalog
  function rustModDir(file){
    const b = basename(file.path), d = dirname(file.path);
    return /^(mod|lib|main)\.rs$/.test(b) ? d : joinPath(d, b.replace(/\.rs$/, ''));
  }
  // `base` + segmenty ścieżki `use`: od najdłuższej (`a/b/c.rs` | `a/b/c/mod.rs`, potem `a/b.rs` …); bez segmentów = sam moduł
  function rustFind(base, segs, idx){
    if(!segs.length) return tryExact(idx.byPath, [base+'.rs', base+'/mod.rs', base+'/lib.rs', base+'/main.rs'].map(normPath));
    for(let take = segs.length; take >= 1; take--){
      const p = joinPath(base, segs.slice(0, take).join('/'));
      const hit = tryExact(idx.byPath, [p+'.rs', p+'/mod.rs'].map(normPath)); if(hit) return hit;
    }
    return null;
  }
  function rustUse(file, spec, idx){
    const segs = spec.split('::').filter(Boolean); if(!segs.length) return null;
    const head = segs[0];
    if(head === 'crate') return rustFind(rustRoot(file), segs.slice(1), idx);
    if(head === 'self' || head === 'super'){
      let base = rustModDir(file), i = 0;
      while(segs[i] === 'super'){ base = dirname(base); i++; }
      if(segs[i] === 'self') i++;
      return rustFind(base, segs.slice(i), idx);
    }
    const pkg = idx.cargo.find(p => p.name === head || p.name.replace(/-/g,'_') === head);   // `use my_crate::x` (lib z bin/tests)
    if(pkg) return rustFind(joinPath(pkg.dir, 'src'), segs.slice(1), idx);
    return rustFind(rustRoot(file), segs, idx);   // edycja 2018: `use util::x` = moduł lokalny, jeśli taki plik istnieje
  }

  function resolveDep(file, dep, idx){
    const fam = family(file.lang);
    const dir = dirname(file.path);
    const spec = dep.spec;
    switch(dep.kind){
      case 'system': case 'decl': return null;
      case 'cs-ns': {   // pliki deklarujące dokładnie ten namespace; static/alias (typ) → także namespace nadrzędny
        const hit = idx.decl.get('cs:'+spec); if(hit) return hit;
        if(dep.up && spec.includes('.')) return idx.decl.get('cs:'+spec.slice(0, spec.lastIndexOf('.'))) || null;
        return null;
      }
      case 'rust-use': return rustUse(file, spec, idx);
      case 'rel': {
        const base = joinPath(dir, spec);
        const hit = tryExact(idx.byPath, expand(base, fam));
        if(!hit && fam === 'sh') return tryExact(idx.byPath, [normPath(spec)]);   // skrypty często `source`'ują od korzenia repo
        return hit;
      }
      case 'dart-pkg': {   // `app/x/y.dart` → <dir pubspec z name: app>/lib/x/y.dart
        const i = spec.indexOf('/'); if(i < 0) return null;
        const pkg = idx.dart.get(spec.slice(0, i)); if(!pkg) return null;
        return tryExact(idx.byPath, [normPath(joinPath(pkg.dir, 'lib/' + spec.slice(i+1)))]);
      }
      case 'ex-std': return idx.decl.get('elixir:'+spec) || null;   // stdlib: krawędź tylko, gdy projekt sam definiuje taki moduł
      case 'glob': {   // wszystkie pasujące pliki; `/x` = od korzenia projektu (Vite), inaczej względem pliku
        const pat = (p) => globRegex(p.startsWith('/') ? normPath(p) : joinPath(dir, p));
        const re = pat(spec), ex = (dep.exclude||[]).map(pat);
        return idx.files.filter(n => re.test(n.path) && !ex.some(r => r.test(n.path)));
      }
      case 'rust-mod': { const md = rustModDir(file); return tryExact(idx.byPath, [joinPath(md,spec)+'.rs', joinPath(md,spec)+'/mod.rs'].map(normPath)); }   // `mod c;` w a/b.rs → a/b/c.rs
      case 'py-rel': {
        const dots = spec.match(/^\.+/)[0].length;
        let up = dir; for(let i=1;i<dots;i++) up = dirname(up);
        const rest = spec.slice(dots).replace(/\./g,'/');
        const base = joinPath(up, rest);
        return pyWithNames(tryExact(idx.byPath, [base+'.py', base+'/__init__.py', base].map(normPath)), dep, idx);
      }
      case 'module': {
        if(fam==='py'){   // katalog importera (uruchomienie jako skrypt) → korzeń → bliższy pakiet → najkrótsza ścieżka
          const p = spec.replace(/\./g,'/'); const c = [p+'.py', p+'/__init__.py'];
          return pyWithNames(tryExact(idx.byPath, c.map(x=>joinPath(dir, x))) || suffixFind(idx, c, dir), dep, idx);
        }
        if(fam==='java'){ const p = spec.replace(/\./g,'/'); return suffixFind(idx, [p+'.java', p+'.kt', p+'.scala', p+'.groovy'], dir); }
        if(fam==='go'){ return suffixFolder(idx, spec); }
        if(fam==='hs'){ const p = spec.replace(/\./g,'/'); return suffixFind(idx, [p+'.hs', p+'.lhs'], dir); }
        if(fam==='lua'){   // a/b.lua | a/b/init.lua: od korzenia projektu (package.path), względem pliku, potem gdziekolwiek
          const p = spec.replace(/\./g,'/'); const c = [p+'.lua', p+'/init.lua'];
          return tryExact(idx.byPath, c.map(normPath)) || tryExact(idx.byPath, c.map(x=>joinPath(dir, x))) || suffixFind(idx, c);
        }
        if(fam==='swift'){   // moduł = target: Sources/<Moduł> lub Tests/<Moduł> (SwiftPM) albo folder najwyższego poziomu (Xcode)
          for(const [p,f] of idx.folderByPath){
            if(p === 'Sources/'+spec || p.endsWith('/Sources/'+spec) || p === 'Tests/'+spec || p.endsWith('/Tests/'+spec) || p === spec) return f;
          }
          return null;
        }
        if(fam==='elixir'){   // defmodule w projekcie → ścieżka snake_case (lib/my_app/repo.ex) → jedyny plik o tej nazwie
          const decl = idx.decl.get('elixir:'+spec); if(decl) return decl;
          const p = spec.split('.').map(snakeCase).join('/');
          const hit = suffixFind(idx, [p+'.ex', p+'.exs'], dir); if(hit) return hit;
          const same = (idx.byBase.get(basename(p)+'.ex')||[]).filter(n=>n.type==='file');
          return same.length === 1 ? same[0] : null;
        }
        return null;
      }
      case 'php-ns': { const cls = spec.split('\\').pop(); return suffixFind(idx, [cls+'.php'], dir); }
      case 'bare': {
        if(fam==='css'){ const base = joinPath(dir, spec); return tryExact(idx.byPath, expand(base,'css')); }
        if(fam==='js'){
          if(idx.alias.length){ const a = aliasResolve(spec, idx.aliasFor(file.path), idx); if(a) return a; }
          const p = packageResolve(spec, idx); if(p) return p;
        }
        return null;
      }
      default: return null;
    }
  }

  function externalName(spec){
    if(spec.startsWith('@')){ const p = spec.split('/'); return p.slice(0,2).join('/'); }
    if(spec.includes('\\')) return spec.split('\\')[0];
    if(spec.includes('::')) return spec.split('::')[0];
    return spec.split('/')[0].split('.')[0] || spec;
  }
  // nierozwiązany wpis, który reprezentuje pakiet/moduł spoza projektu (→ węzeł zależności zewnętrznej)
  const EXTERNAL_KINDS = new Set(['bare','module','cs-ns','php-ns','dart-pkg']);
  function isExternal(dep){
    if(EXTERNAL_KINDS.has(dep.kind)) return true;
    if(dep.kind === 'rust-use') return !/^(crate|self|super)(::|$)/.test(dep.spec);   // std, serde, … ale nie ścieżki lokalne
    return false;
  }

  // build import / reference edges + external module summary
  // manifests: wpisy z manifestEntry() (aliasy tsconfig/jsconfig, pakiety) — stary format {dir,baseUrl,paths} też działa
  function buildEdges(nodes, manifests){
    const byPath = new Map(), byBase = new Map(), folderByPath = new Map();
    for(const n of nodes){
      byPath.set(n.path, n);
      const b = n.name.toLowerCase();
      if(!byBase.has(b)) byBase.set(b, []);
      byBase.get(b).push(n);
      if(n.type === 'folder') folderByPath.set(n.path, n);
    }
    const alias = aliasConfigs(manifests), aliasCache = new Map();
    const files = nodes.filter(n => n.type === 'file');
    // indeks deklaracji (C# `namespace A.B` …) z wpisów kind 'decl': "<rodzina>:<nazwa>" → pliki, które ją deklarują
    const decl = new Map();
    for(const f of files){ if(!f.deps) continue; for(const d of f.deps){ if(d.kind !== 'decl') continue;
      const k = family(f.lang)+':'+d.spec; if(!decl.has(k)) decl.set(k, []); if(!decl.get(k).includes(f)) decl.get(k).push(f); } }
    const pkgsOf = (eco) => (manifests||[]).filter(m => m && m.kind === 'package' && m.eco === eco && m.name).map(m => ({...m, dir: normPath(m.dir||'')}));
    const idx = {byPath, byBase, folderByPath, files, alias, decl, pkgs: packageIndex(manifests),
      cargo: pkgsOf('cargo'), dart: new Map(pkgsOf('dart').map(p => [p.name, p])),
      aliasFor(filePath){ const d = dirname(filePath); if(!aliasCache.has(d)) aliasCache.set(d, aliasFor(alias, filePath)); return aliasCache.get(d); }};
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
        if(dep.kind === 'decl') continue;                          // deklaracja (namespace) — tylko cel dla innych
        const tgt = resolveDep(f, dep, idx);                       // węzeł, tablica węzłów (glob, namespace) albo null
        const tgts = Array.isArray(tgt) ? tgt : (tgt ? [tgt] : []);
        if(tgts.length){ for(const t of tgts) addEdge(f.id, t.id, dep.etype==='reference'?'reference':'import'); }
        else if(isExternal(dep)){
          const name = externalName(dep.spec);
          if(!name) continue;
          if(!externals.has(name)) externals.set(name, {name, count:0, importers:[]});
          const ex = externals.get(name); ex.count++; if(!ex.importers.includes(f.id)) ex.importers.push(f.id);
        }
      }
    }
    return {edges, externals};
  }

  // Pełna analiza jednego pliku: metryki + importy + symbole z JEDNYM przebiegiem stripNonCode
  // (dotąd extractDeps i extractSymbols czyściły tę samą treść dwa razy). Używane przez graph.build
  // i przez analysis-worker.js — jedno źródło prawdy dla parserów.
  function analyzeFile(content, key){
    if(content==null) return {metrics:null, deps:[], symbols:[]};
    const stripped=stripNonCode(content, key);
    return {metrics:analyzeContent(content, key), deps:depsFromStripped(stripped, key), symbols:symbolsFromStripped(stripped, key)};
  }

  return {analyzeContent, analyzeFile, extractDeps, extractSymbols, buildEdges, manifestEntry, family, stripNonCode, looseJSON,
          normPath, dirname, basename, joinPath, externalName};
})();
