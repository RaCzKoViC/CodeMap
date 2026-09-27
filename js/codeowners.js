/* ===================== codeowners.js — CODEOWNERS a rzeczywista własność z git (bez DOM) ===================== */
// Plik CODEOWNERS (.github/, korzeń, docs/, .gitlab/ — pierwszy znaleziony w tej kolejności, jak na GitHubie):
// wzorce jak w dokumentacji GitHuba — `/x` od korzenia, wzorzec z `/` w środku też od korzenia, bez `/` na dowolnej
// głębokości; `x/` = katalog i jego zawartość; `docs/*` = tylko pliki bezpośrednio w docs; `**` przez katalogi;
// OSTATNIE pasujące wystąpienie wygrywa; wzorzec bez właścicieli = celowo bez właściciela. Sekcje GitLaba `[Nazwa]`
// pomijane. Właściciele: @login, @org/zespół (nie do rozwiązania na autorów), e-mail.
// analyze(graph) → pliki kodu bez właściciela i „rozjazd": deklarowany właściciel (osoba z historii) nie ma ≥ 10 %
// zmian pliku, a ktoś inny ma ≥ 50 % z co najmniej 5. Czyste funkcje — testy w Node.
CM.CodeOwners = (function(){
  const LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'];
  const CODE_RE = /\.(m?[jt]sx?|cjs|cts|mts|vue|svelte|py|java|kt|kts|scala|go|rs|rb|php|cs|c|cc|cpp|cxx|h|hpp|swift|dart|ex|exs|lua|zig|hs)$/i;

  function find(graph){
    for(const p of LOCATIONS){ const n = graph.nodes.get(p); if(n && n.type === 'file' && typeof n.preview === 'string') return n; }
    return null;
  }

  // wzorzec → RegExp dla ścieżki pliku (bez `/` na początku)
  function compile(pattern){
    let p = pattern;
    const dirOnly = p.endsWith('/'); if(dirOnly) p = p.replace(/\/+$/, '');
    const anchored = p.startsWith('/') || p.includes('/');
    p = p.replace(/^\/+/, '');
    const last = p.slice(p.lastIndexOf('/') + 1);
    const desc = dirOnly || !/[*?]/.test(last);                       // katalog → także jego zawartość
    let re = '';
    for(let i = 0; i < p.length; i++){
      const c = p[i];
      if(c === '*'){
        if(p[i + 1] === '*'){
          const before = i === 0 || p[i - 1] === '/', after = p[i + 2] === '/' || i + 2 === p.length;
          if(before && after){ i++; if(p[i + 1] === '/'){ i++; re += '(?:.*/)?'; } else re += '.*'; continue; }
          i++; re += '[^/]*'; continue;
        }
        re += '[^/]*';
      }
      else if(c === '?') re += '[^/]';
      else if(c === '\\' && i + 1 < p.length){ re += p[++i].replace(/[.+^${}()|[\]\\*?]/g, '\\$&'); }
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp((anchored ? '^' : '^(?:.*/)?') + re + (desc ? '(?:/.*)?$' : '$'));
  }

  // tekst → [{pattern, owners, line, re}] (niepoprawne wzorce pomijane)
  function parse(text){
    const rules = [];
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      let s = raw.replace(/(^|[^\\])#.*$/, '$1').trim();
      if(!s || /^\^?\[[^\]]*\](\[\d+\])?( .*)?$/.test(s)) return;   // komentarz / sekcja GitLaba
      const toks = []; let cur = '';
      for(let k = 0; k < s.length; k++){ const c = s[k];
        if(c === '\\' && k + 1 < s.length && (s[k + 1] === ' ' || s[k + 1] === '#')){ cur += c + s[++k]; continue; }
        if(c === ' ' || c === '\t'){ if(cur){ toks.push(cur); cur = ''; } continue; }
        cur += c; }
      if(cur) toks.push(cur);
      const pattern = toks[0]; if(!pattern) return;
      try{ rules.push({pattern, owners: toks.slice(1), line: i + 1, re: compile(pattern.replace(/\\([ #])/g, '$1'))}); }catch(e){ /* niepoprawny wzorzec — pomijany jak na GitHubie */ }
    });
    return rules;
  }

  // ostatnia pasująca reguła → {owners, line, pattern} | null
  function ownersOf(rules, path){
    for(let i = rules.length - 1; i >= 0; i--) if(rules[i].re.test(path)) return {owners: rules[i].owners, line: rules[i].line, pattern: rules[i].pattern};
    return null;
  }

  // właściciel → indeks autora z gitInfo.authors | null (zespół @org/x i nieznani → null)
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]/g, '');
  function resolve(owner, authors){
    if(!owner || !authors) return null;
    const o = String(owner).trim();
    if(o.startsWith('@')){
      if(o.includes('/')) return null;
      const login = o.slice(1).toLowerCase();
      for(let i = 0; i < authors.length; i++){ const a = authors[i]; if(!a || a.bot) continue;
        const email = String(a.email || '').toLowerCase(), local = email.split('@')[0].replace(/^\d+\+/, '');
        if(String(a.login || '').toLowerCase() === login || local === login || norm(a.name) === norm(login)) return i; }
      return null;
    }
    if(o.includes('@')){ const e = o.toLowerCase(); for(let i = 0; i < authors.length; i++) if(authors[i] && String(authors[i].email || '').toLowerCase() === e) return i; }
    return null;
  }

  function isCode(n){ const TM = CM.TestMap; return TM && TM.isCodeFile ? TM.isCodeFile(n.path) : CODE_RE.test(n.path || ''); }

  // → null (brak CODEOWNERS) | {file, rules, byFile:Map id→{owners,line,pattern}|null, unowned:[id], drift:[{id, owners, own, share, c}]}
  function analyze(graph){
    const f = find(graph); if(!f) return null;
    const rules = parse(f.preview);
    const authors = graph.gitInfo && graph.gitInfo.authors;
    const byFile = new Map(), unowned = [], drift = [];
    const cache = new Map();
    for(const n of graph.nodes.values()){
      if(n.type !== 'file' || !n.path || (n.gid && n.gid !== 'base')) continue;
      const hit = ownersOf(rules, n.path); byFile.set(n.id, hit);
      if((!hit || !hit.owners.length) && isCode(n) && !n.isTest) unowned.push(n.id);
      if(!hit || !hit.owners.length || !authors || !n.git || n.git.c < 5 || n.git.own == null || n.git.share < 0.5) continue;
      const declared = hit.owners.map(o => { if(!cache.has(o)) cache.set(o, resolve(o, authors)); return cache.get(o); }).filter(x => x != null);
      if(!declared.length) continue;                                  // same zespoły / nieznani — nie oceniamy
      const shareOf = (ai) => { const x = (n.git.a || []).find(e => e[0] === ai); return x ? x[1] / n.git.c : 0; };
      if(declared.some(ai => ai === n.git.own || shareOf(ai) >= 0.1)) continue;
      drift.push({id: n.id, owners: hit.owners, own: n.git.own, share: n.git.share, c: n.git.c});
    }
    return {file: f.path, rules, byFile, unowned, drift};
  }

  return {LOCATIONS, find, compile, parse, ownersOf, resolve, analyze};
})();
