// Przegląd zmian (faza 5) w CLI: zmienione pliki z `git diff <base>...HEAD`, ocena ryzyka tym samym CM.PRCore co
// w aplikacji (js/pr-core.js), opcjonalnie wynik bazowy (health score gałęzi bazowej z tymczasowego `git worktree`)
// i nowe znaleziska względem niej. Z tego powstaje komentarz Markdown do PR (action.yml, pr-comment).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from './strings.mjs';

const TXT = {
  pl: { noGit: 'przegląd zmian (--base, check) wymaga repozytorium git i polecenia git', badRef: 'nie znaleziono refa bazowego „{r}" (w CI: actions/checkout z fetch-depth: 0)',
    head: 'Stan zdrowia', vs: 'względem', newF: 'Nowe znaleziska', fixedF: 'Usunięte znaleziska', none: 'brak', more: '…i {n} więcej' },
  en: { noGit: 'change review (--base, check) needs a git repository and the git command', badRef: 'base ref "{r}" not found (in CI: actions/checkout with fetch-depth: 0)',
    head: 'Health', vs: 'vs', newF: 'New findings', fixedF: 'Resolved findings', none: 'none', more: '…and {n} more' },
};
const tx = (lang, k, v) => { let s = (TXT[lang] || TXT.pl)[k]; for (const p in (v || {})) s = s.replace('{' + p + '}', v[p]); return s; };

export function git(repoRoot, args, lang, extra) {
  try { return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...extra }); }
  catch (e) {
    if (e && e.code === 'ENOENT') throw new CliError(tx(lang, 'noGit'));
    throw e;
  }
}
/** Ref bazowy musi istnieć (płytki checkout w CI go nie ma) — czytelny błąd zamiast śladu gita. */
export function assertRef(repoRoot, ref, lang) {
  if (!/^[\w./@^~{}-]{1,200}$/.test(ref) || ref.startsWith('-')) throw new CliError(tx(lang, 'badRef', { r: ref }));
  try { git(repoRoot, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'], lang); }
  catch (e) { if (e instanceof CliError) throw e; throw new CliError(tx(lang, 'badRef', { r: ref })); }
}

/** Pliki zmienione między merge-base(base, HEAD) a HEAD: [{path, status, from?, add, del}], ścieżki względem `sub`. */
export function changedFiles(repoRoot, base, sub, lang) {
  assertRef(repoRoot, base, lang);
  return diffFiles(repoRoot, [base + '...HEAD'], sub, lang);
}
/** Zmiany w indeksie względem HEAD (`git diff --cached`; w hooku pre-commit także przy `commit -a` — GIT_INDEX_FILE). */
export function stagedFiles(repoRoot, sub, lang) { return diffFiles(repoRoot, ['--cached'], sub, lang); }

function diffFiles(repoRoot, spec, sub, lang) {
  const st = git(repoRoot, ['-c', 'core.quotepath=false', 'diff', '--name-status', '-M', '-z', ...spec], lang).split('\0');
  const num = git(repoRoot, ['-c', 'core.quotepath=false', 'diff', '--numstat', '-M', '-z', ...spec], lang).split('\0');
  // --numstat -z: „add\tdel\tpath" albo przy zmianie nazwy „add\tdel\t" + stara + nowa
  const lines = new Map();
  for (let i = 0; i < num.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(num[i]); if (!m) continue;
    const add = m[1] === '-' ? 0 : +m[1], del = m[2] === '-' ? 0 : +m[2];
    if (m[3] === '') { const to = num[i + 2]; i += 2; lines.set(to, { add, del }); } else lines.set(m[3], { add, del });
  }
  const out = [];
  for (let i = 0; i < st.length; i++) {
    const code = st[i]; if (!code) continue;
    const s = code[0];
    if (s === 'R' || s === 'C') { const from = st[++i], to = st[++i]; out.push({ path: to, from: s === 'R' ? from : undefined, status: s === 'R' ? 'R' : 'A', ...(lines.get(to) || { add: 0, del: 0 }) }); }
    else { const p = st[++i]; out.push({ path: p, status: s === 'A' ? 'A' : s === 'D' ? 'D' : 'M', ...(lines.get(p) || { add: 0, del: 0 }) }); }
  }
  if (!sub) return out;
  const pre = sub.replace(/\/+$/, '') + '/', cut = (p) => (p && p.startsWith(pre) ? p.slice(pre.length) : null);
  return out.map((f) => { const p = cut(f.path); if (p == null) return null; const g = { ...f, path: p }; if (f.from) { const fr = cut(f.from); if (fr == null) { delete g.from; g.status = 'A'; } else g.from = fr; } return g; }).filter(Boolean);
}

/** Analiza PR na grafie HEAD → zwykły obiekt do raportu JSON. */
export function prReport(CM, graph, files, pr) {
  const res = CM.PRCore.analyze(graph, files, pr || {});
  return structuredClone({ risk: res.risk, level: res.level, add: res.add, del: res.del, direct: res.direct, impacted: res.impacted.size,
    changed: res.changed.map((c) => ({ path: c.path, status: c.status, from: c.from || undefined, add: c.add, del: c.del, risk: c.risk, parts: c.parts })),
    outside: res.outside, reviewers: res.reviewers });
}

/** Health score gałęzi bazowej: tymczasowy `git worktree` → ta sama analiza → klucze znalezisk do porównania. */
export async function baseline(repoRoot, base, sub, runAnalysis, opts, lang) {
  assertRef(repoRoot, base, lang);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-base-'));
  const wt = path.join(tmp, 'wt');
  git(repoRoot, ['worktree', 'add', '--detach', '--quiet', wt, base], lang);
  try {
    const r = await runAnalysis(sub ? path.join(wt, ...sub.split('/')) : wt, opts);
    return { ref: base, score: r.report.score, totals: r.report.totals, keys: findingKeys(r.report) };
  } finally {
    try { git(repoRoot, ['worktree', 'remove', '--force', wt], lang); } catch { /* sprzątanie niżej */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
/** Klucz znaleziska niezależny od liczb w szczegółach: reguła + ścieżka (+ powiązane). */
export function findingKeys(report) {
  const m = new Map();
  for (const f of report.findings) for (const it of f.items) {
    const k = f.rule + '|' + it.path + (it.related ? '|' + [...it.related].sort().join(',') : '');
    m.set(k, { rule: f.rule, title: f.title, sev: it.sev, path: it.path, detail: it.detail });
  }
  return m;
}
export function diffFindings(baseKeys, headReport) {
  const head = findingKeys(headReport), added = [], removed = [];
  for (const [k, v] of head) if (!baseKeys.has(k)) added.push(v);
  for (const [k, v] of baseKeys) if (!head.has(k)) removed.push(v);
  const rank = { high: 3, med: 2, low: 1, info: 0 };
  added.sort((a, b) => rank[b.sev] - rank[a.sev] || (a.rule < b.rule ? -1 : 1));
  return { added, removed };
}

/** Komentarz do PR: ryzyko i pliki (CM.PRCore.summaryMarkdown) + stan zdrowia i nowe znaleziska względem bazy. */
export function prMarkdown(CM, graph, files, pr, extra) {
  const lang = (extra && extra.lang) || 'pl';
  const res = CM.PRCore.analyze(graph, files, pr || {});
  let md = CM.PRCore.summaryMarkdown(res, pr || {}, { lang, link: extra && extra.link, max: 12 });
  const b = extra && extra.baseline;
  if (b) {
    const d = extra.score - b.score, sign = d > 0 ? '+' : d < 0 ? '−' : '±';
    md += '\n\n**' + tx(lang, 'head') + ':** ' + extra.score + '/100 (' + sign + Math.abs(d) + ' ' + tx(lang, 'vs') + ' `' + b.ref.slice(0, 40) + '`: ' + b.score + ')';
    const diff = extra.diff;
    if (diff) {
      const list = (arr) => arr.slice(0, 10).map((x) => '- ' + ({ high: '🔴', med: '🟠', low: '🟡', info: '⚪' }[x.sev] || '•') + ' ' + x.title + ' — `' + x.path + '`' + (x.detail ? ' (' + x.detail + ')' : '')).join('\n')
        + (arr.length > 10 ? '\n' + tx(lang, 'more', { n: arr.length - 10 }) : '');
      md += '\n\n**' + tx(lang, 'newF') + ' (' + diff.added.length + '):** ' + (diff.added.length ? '\n' + list(diff.added) : tx(lang, 'none'));
      if (diff.removed.length) md += '\n\n**' + tx(lang, 'fixedF') + ':** ' + diff.removed.length;
    }
  }
  return md + '\n';
}
