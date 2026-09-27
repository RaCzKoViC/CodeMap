// .gitignore w CLI: pliki i katalogi ignorowane przez gita nie trafiają do analizy (jak w ripgrep czy knip) — lokalne
// build/, .env.local, prywatne foldery. Składnia gita: komentarze `#`, `!` (ponowne włączenie), `/` na końcu (tylko
// katalogi), wzorzec ze `/` na początku albo w środku zakotwiczony w katalogu swojego .gitignore, bez `/` — na każdym
// poziomie, `**/`, `/**`, `*`, `?`, `[...]`, `\` (znak dosłowny). Pliki .gitignore zagnieżdżone i .git/info/exclude;
// ostatni pasujący wzorzec wygrywa, a plik w zignorowanym katalogu nie wraca (walk go nie odwiedza — jak git).
// Świadomie bez indeksu gita: plik dodany siłą (`git add -f`) mimo wzorca też jest pomijany.

const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wzorzec .gitignore (bez `!` i końcowego `/`) → RegExp na ścieżce względem katalogu pliku .gitignore. */
export function patternRegExp(p) {
  const anchored = p.startsWith('/') || p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*' && (i === 0 || p[i - 1] === '/')) {
      if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; continue; }    // `**/` — zero lub więcej katalogów
      if (i + 2 === p.length) { re += '.*'; i++; continue; }            // `/**` na końcu — wszystko w środku
    }
    if (c === '*') { while (p[i + 1] === '*') i++; re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const j = p.indexOf(']', i + 2);
      if (j < 0) { re += '\\['; continue; }
      let cls = p.slice(i + 1, j); if (cls[0] === '!') cls = '^' + cls.slice(1);
      re += '[' + cls.replace(/\\/g, '\\\\') + ']'; i = j;
    }
    else if (c === '\\' && i + 1 < p.length) { re += esc(p[++i]); }
    else re += esc(c);
  }
  return new RegExp((anchored ? '^' : '^(?:.*/)?') + re + '$');
}

/** Treść pliku .gitignore → [{re, neg, dir}]. */
export function parseGitignore(text) {
  const out = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    line = line.replace(/(?<!\\)[ \t]+$/, '');
    let neg = false;
    if (line[0] === '!') { neg = true; line = line.slice(1); }
    else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1);
    let dir = false;
    if (line.endsWith('/')) { dir = true; line = line.replace(/\/+$/, ''); }
    if (!line) continue;
    out.push({ re: patternRegExp(line), neg, dir });
  }
  return out;
}

/** Zbiór reguł z wielu plików: add(base, text) — base = katalog pliku względem korzenia repozytorium ('' = korzeń). */
export function createIgnore() {
  const sets = [];
  return {
    add(base, text) { const rules = parseGitignore(text); if (rules.length) sets.push({ base: base || '', rules }); },
    get size() { return sets.length; },
    /** czy ścieżka (względem korzenia repozytorium) jest ignorowana; isDir — dla wzorców `x/` */
    ignored(rel, isDir) {
      let res = false;
      for (const s of sets) {
        if (s.base && rel !== s.base && !rel.startsWith(s.base + '/')) continue;
        const sub = s.base ? rel.slice(s.base.length + 1) : rel;
        if (!sub) continue;
        for (const r of s.rules) if ((!r.dir || isDir) && r.re.test(sub)) res = !r.neg;
      }
      return res;
    },
  };
}
