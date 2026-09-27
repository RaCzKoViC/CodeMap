// `codemap check` (faza 15): wpływ zmian i reguły architektury przed commitem. Stan „po" = indeks gita (dokładnie to,
// co wejdzie do commita — także przy `git add -p` i `git commit -a`, bo hook dziedziczy GIT_INDEX_FILE), stan „przed" =
// HEAD; oba czytane poleceniami tylko do odczytu (ls-files / ls-tree / cat-file) — bez checkoutu i bez dotykania indeksu.
// Ta sama analiza co `analyze` dla obu stanów, bez historii git i pokrycia (porównywalne jak punkty trendu zdrowia);
// ryzyko, zasięg i osoby znające kod z CM.PRCore na stanie „po" z nałożoną historią git.
// Porażka (kod 1) = NOWE znaleziska z --fail-on (domyślnie reguły architektury: naruszenia warstw, cykle importów i pakietów).
import fs from 'node:fs';
import path from 'node:path';
import { runAnalysis, applyGitHistory } from './analyze.mjs';
import { loadCodeMap } from './runtime.mjs';
import { git, stagedFiles, prReport, findingKeys, diffFindings } from './pr.mjs';
import { strings, riskLine, CliError } from './strings.mjs';

export const DEFAULT_FAIL = ['archviolation', 'cycles', 'pkgcycle'];
const HOOK_MARK = '# codemap-check';
const RANK = { high: 3, med: 2, low: 1, info: 0 };

const TXT = {
  pl: { noRepo: 'codemap check wymaga repozytorium git i polecenia git', title: 'CodeMap check · indeks vs HEAD',
    nothing: 'Brak zmian w indeksie (git add) — nic do sprawdzenia.', staged: 'Zmiany', health: 'Zdrowie vs HEAD',
    newF: 'Nowe znaleziska', more: '…i {n} więcej', know: 'Znają ten kod', ok: 'Bez nowych naruszeń reguł architektury.',
    failRule: 'nowe znaleziska reguły {rule} ({title}): {n}', failSev: 'nowe znaleziska o ważności {sev} lub wyższej: {n}',
    fail: 'commit zatrzymany', skip: 'Jednorazowe pominięcie: git commit --no-verify',
    hookOk: 'Zainstalowano hook pre-commit: {f}', hookGone: 'Usunięto hook pre-commit CodeMap: {f}', hookNone: 'Brak hooka pre-commit CodeMap ({f}).',
    hookOther: 'hook pre-commit już istnieje i nie pochodzi z CodeMap ({f}) — dopisz do niego linię:\n  {cmd}',
    hookHead: 'wpływ zmian i reguły architektury przed commitem (CodeMap); jednorazowe pominięcie: git commit --no-verify' },
  en: { noRepo: 'codemap check needs a git repository and the git command', title: 'CodeMap check · index vs HEAD',
    nothing: 'Nothing staged (git add) — nothing to check.', staged: 'Changes', health: 'Health vs HEAD',
    newF: 'New findings', more: '…and {n} more', know: 'Know this code', ok: 'No new architecture rule violations.',
    failRule: 'new {rule} findings ({title}): {n}', failSev: 'new findings of severity {sev} or higher: {n}',
    fail: 'commit stopped', skip: 'Skip once: git commit --no-verify',
    hookOk: 'Installed the pre-commit hook: {f}', hookGone: 'Removed the CodeMap pre-commit hook: {f}', hookNone: 'No CodeMap pre-commit hook ({f}).',
    hookOther: 'a pre-commit hook already exists and is not from CodeMap ({f}) — add this line to it:\n  {cmd}',
    hookHead: 'change impact and architecture rules before a commit (CodeMap); skip once: git commit --no-verify' },
};
const tx = (lang, k, v) => { let s = (TXT[lang] || TXT.pl)[k]; for (const p in (v || {})) s = s.split('{' + p + '}').join(v[p]); return s; };

/** Katalog główny repozytorium (git rev-parse — działa też w worktree i w hooku). */
export function repoTop(dir, lang) {
  let out;
  try { out = git(dir, ['rev-parse', '--show-toplevel'], lang); }
  catch { throw new CliError(tx(lang, 'noRepo')); }   // brak polecenia git albo katalog poza repozytorium
  return path.resolve(out.trim());
}

/** Zwykłe pliki stanu: 'index' (git ls-files -s) albo 'HEAD' (ls-tree; brak commitów = pusta lista) → [{path, sha}]. */
export function listState(top, which, lang) {
  let raw;
  if (which === 'index') raw = git(top, ['-c', 'core.quotepath=false', 'ls-files', '-s', '-z'], lang);
  else {
    try { git(top, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], lang); } catch (e) { if (e instanceof CliError) throw e; return []; }
    raw = git(top, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', '--full-tree', 'HEAD'], lang);
  }
  const out = [];
  for (const rec of raw.split('\0')) {
    const tab = rec.indexOf('\t'); if (tab < 0) continue;
    const meta = rec.slice(0, tab).split(' '), p = rec.slice(tab + 1);
    // indeks: „tryb sha etap", drzewo: „tryb typ sha"; tylko zwykłe pliki (bez dowiązań 120000 i submodułów 160000)
    const mode = meta[0], sha = which === 'index' ? meta[1] : meta[2];
    if ((mode === '100644' || mode === '100755') && (which !== 'index' || meta[2] === '0')) out.push({ path: p, sha });
  }
  return out;
}

/** Rozmiary obiektów jednym `git cat-file --batch-check`. */
function sizesOf(top, shas, lang) {
  const m = new Map(); if (!shas.length) return m;
  const out = git(top, ['cat-file', '--batch-check'], lang, { input: shas.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'] });
  for (const line of out.split('\n')) { const [sha, type, size] = line.split(' '); if (type && type !== 'missing') m.set(sha, +size); }
  return m;
}
/** Treść obiektów jednym `git cat-file --batch` → Map sha → Buffer. */
function blobsOf(top, shas, lang) {
  const m = new Map(); if (!shas.length) return m;
  const out = git(top, ['cat-file', '--batch'], lang, { input: Buffer.from(shas.join('\n') + '\n'), stdio: ['pipe', 'pipe', 'pipe'], encoding: 'buffer', maxBuffer: 1 << 30 });
  let i = 0;
  while (i < out.length) {
    const nl = out.indexOf(10, i); if (nl < 0) break;
    const hdr = out.toString('latin1', i, nl).split(' '); i = nl + 1;
    if (hdr[1] === 'missing' || hdr.length < 3) continue;
    const size = +hdr[2]; m.set(hdr[0], out.subarray(i, i + size)); i += size + 1;
  }
  return m;
}

/** Stan z gita → {files, coverage, stats} jak z cli/fsload.mjs (reguły wczytywania, wykluczenia, limit plików z treścią). */
function loadStates(CM, top, sub, states, o, lang) {
  const L = CM.Loaders, pre = sub ? sub.replace(/\/+$/, '') + '/' : '';
  const maxContent = o.maxContent != null ? o.maxContent : L.MAX_CONTENT_FILES;
  const picked = states.map((list) => list.filter((e) => !pre || e.path.startsWith(pre))
    .map((e) => ({ ...e, rel: e.path.slice(pre.length) }))
    .filter((e) => CM.HealthTrend.accept(e.rel, o.exclude))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)));
  const sizes = sizesOf(top, [...new Set(picked.flat().map((e) => e.sha))], lang);
  const want = new Set();
  for (const list of picked) {
    let k = 0;
    for (const e of list) {
      e.size = sizes.get(e.sha) || 0;
      e.text = L.isTextFile(e.rel.slice(e.rel.lastIndexOf('/') + 1), e.size);
      if (e.text && k < maxContent) { want.add(e.sha); k++; } else if (e.text) e.capped = true;
    }
  }
  const blobs = blobsOf(top, [...want], lang), dec = new TextDecoder('utf-8');
  return picked.map((list) => {
    const stats = { files: list.length, content: 0, capped: 0, symlinks: 0, excluded: 0, maxContent };
    const files = list.map((e) => {
      let content = null;
      if (e.text && !e.capped && blobs.has(e.sha)) { content = dec.decode(blobs.get(e.sha)); stats.content++; }
      else if (e.capped) stats.capped++;
      return { path: e.rel, size: e.size, content, mtime: null };
    });
    return { files, coverage: [], stats };
  });
}

/**
 * Sprawdzenie zmian w indeksie. o: {lang, git, gitMax, exclude, maxContent}
 * → {top, sub, staged, empty} albo dodatkowo {pr, score:{before, after, delta}, added, removed, warnings, CM}
 */
export async function runCheck(dir, o = {}) {
  const lang = o.lang || 'pl';
  const root = path.resolve(dir || '.');
  const top = repoTop(root, lang);
  const sub = path.relative(top, root).split(path.sep).join('/');
  const staged = stagedFiles(top, sub, lang);
  if (!staged.length) return { top, sub, staged, empty: true };
  const CM = loadCodeMap({ lang });
  const headList = listState(top, 'HEAD', lang), hasHead = headList.length > 0;
  const [after, before] = loadStates(CM, top, sub, [listState(top, 'index', lang), headList], o, lang);
  const aOpts = { lang, git: false, coverage: false, exclude: o.exclude, maxContent: o.maxContent };
  const A = await runAnalysis(root, { ...aOpts, loaded: after });
  const B = await runAnalysis(root, { ...aOpts, loaded: before });
  const diff = diffFindings(findingKeys(B.report), A.report);
  const warnings = [];
  // historia git tylko do oceny ryzyka i osób znających kod — reguły wyżej liczone bez niej (porównywalność)
  if (o.git !== false && hasHead) {   // pierwszy commit: historii jeszcze nie ma
    try { await applyGitHistory(A.CM, A.graph, top, sub, { gitMax: o.gitMax }); }
    catch (e) { warnings.push(strings(lang)('wGit', { m: (e && e.message) || String(e) })); }
  }
  let me = ''; try { me = git(top, ['config', 'user.name'], lang).trim(); } catch { /* bez tożsamości */ }
  const pr = prReport(A.CM, A.graph, staged, me ? { author: { name: me } } : {});
  return { top, sub, staged, empty: false, pr, added: diff.added, removed: diff.removed.length, warnings, CM: A.CM,
    score: { before: B.report.score, after: A.report.score, delta: A.report.score - B.report.score } };
}

/** Powody porażki: nowe znaleziska wybranych reguł / ważności. failOn: [{rule}|{sev}] (puste = DEFAULT_FAIL). */
export function checkFailures(res, failOn, lang) {
  if (res.empty) return [];
  const list = failOn && failOn.length ? failOn : DEFAULT_FAIL.map((rule) => ({ rule }));
  const why = [];
  for (const f of list) {
    if (f.sev) { const n = res.added.filter((x) => RANK[x.sev] >= RANK[f.sev]).length; if (n) why.push(tx(lang, 'failSev', { sev: f.sev, n })); }
    else { const hit = res.added.filter((x) => x.rule === f.rule); if (hit.length) why.push(tx(lang, 'failRule', { rule: f.rule, title: hit[0].title, n: hit.length })); }
  }
  return why;
}

/** Podsumowanie tekstowe. */
export function formatCheck(res, lang) {
  if (res.empty) return tx(lang, 'nothing');
  const tr = strings(lang), p = res.pr, s = res.score, d = s.delta;
  const sevName = (v) => res.CM.Inspect.text('sev.' + v);
  const L = [tx(lang, 'title'),
    '  ' + tx(lang, 'staged').padEnd(18) + riskLine(lang, p),
    '  ' + tx(lang, 'health').padEnd(18) + tr('blVal', { b: s.before, s: s.after, sign: d > 0 ? '+' : d < 0 ? '−' : '±', d: Math.abs(d), nf: res.added.length, rf: res.removed })];
  if (res.added.length) {
    L.push('', '  ' + tx(lang, 'newF') + ':');
    for (const x of res.added.slice(0, 15)) L.push(`    ${sevName(x.sev).padEnd(8)} ${x.title} — ${x.path}${x.detail ? ' (' + x.detail + ')' : ''}`);
    if (res.added.length > 15) L.push('    ' + tx(lang, 'more', { n: res.added.length - 15 }));
  }
  if (p.reviewers && p.reviewers.length) L.push('', '  ' + tx(lang, 'know').padEnd(18) + p.reviewers.slice(0, 3).map((r) => r.name).join(', '));
  return L.join('\n');
}

/** Narzędzie MCP `staged_check`: podsumowanie + BLOCKING z powodami porażki (domyślne reguły architektury). */
export async function stagedCheckText(dir, o = {}) {
  const lang = o.lang === 'pl' ? 'pl' : 'en', r = await runCheck(dir, { ...o, lang }), why = checkFailures(r, [], lang);
  if (r.empty) return formatCheck(r, lang);
  return formatCheck(r, lang) + (why.length ? '\nBLOCKING:\n' + why.map((w) => '- ' + w).join('\n') : '\nno blocking problems');
}

/** Plik hooka pre-commit (z core.hooksPath, gdy ustawione). */
function hookFile(top, lang) { return path.resolve(top, git(top, ['rev-parse', '--git-path', 'hooks'], lang).trim(), 'pre-commit'); }

/** Instalacja hooka pre-commit wołającego `codemap check`; cudzego hooka nie nadpisuje. → komunikat */
export function installHook(dir, { cliPath, lang = 'pl', args = [] }) {
  const top = repoTop(path.resolve(dir || '.'), lang);
  const sub = path.relative(top, path.resolve(dir || '.')).split(path.sep).join('/') || '.';
  const q = (s) => '"' + String(s).replace(/\\/g, '/').replace(/(["$`])/g, '\\$1') + '"';
  const cmd = `node ${q(cliPath)} check ${q(sub)} --lang ${lang}${args.length ? ' ' + args.map(q).join(' ') : ''}`;
  const f = hookFile(top, lang);
  if (fs.existsSync(f) && !fs.readFileSync(f, 'utf8').includes(HOOK_MARK)) throw new CliError(tx(lang, 'hookOther', { f, cmd }));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `#!/bin/sh\n${HOOK_MARK}: ${tx(lang, 'hookHead')}\nexec ${cmd}\n`, { mode: 0o755 });
  try { fs.chmodSync(f, 0o755); } catch { /* Windows: git for Windows i tak uruchamia hook przez sh */ }
  return tx(lang, 'hookOk', { f });
}
/** Usunięcie hooka — tylko własnego. → komunikat */
export function uninstallHook(dir, { lang = 'pl' } = {}) {
  const top = repoTop(path.resolve(dir || '.'), lang), f = hookFile(top, lang);
  if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(HOOK_MARK)) return tx(lang, 'hookNone', { f });
  fs.rmSync(f);
  return tx(lang, 'hookGone', { f });
}

/** Polecenie `codemap check` z CLI (o z parseArgs) → kod wyjścia. */
export async function checkCommand(o, { cliPath, writeOut, write = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  const lang = o.lang;
  if (o.installHook) {
    const extra = [...(o.failNone ? ['--fail-on', 'none'] : o.failOn.length ? ['--fail-on', o.failOn.map((f) => f.rule || f.sev).join(',')] : []),
      ...o.exclude.flatMap((g) => ['--exclude', g]), ...(o.git ? [] : ['--no-git'])];
    write(installHook(o.dir, { cliPath, lang, args: extra }) + '\n'); return 0;
  }
  if (o.uninstallHook) { write(uninstallHook(o.dir, { lang }) + '\n'); return 0; }
  const res = await runCheck(o.dir || '.', { lang, git: o.git, gitMax: o.gitMax, exclude: o.exclude, maxContent: o.maxContent });
  const why = o.failNone ? [] : checkFailures(res, o.failOn, lang);
  if (o.json) {
    const j = res.empty ? { staged: [], empty: true } : { staged: res.staged, empty: false, risk: res.pr.risk, level: res.pr.level, impacted: res.pr.impacted,
      changed: res.pr.changed, reviewers: res.pr.reviewers, score: res.score, newFindings: res.added, resolvedFindings: res.removed, failed: why };
    writeOut(o.json, JSON.stringify(j, null, 2) + '\n');   // ten sam zapis co `analyze` („-" = stdout)
  }
  if (!o.quiet) (o.json === '-' ? err : write)(formatCheck(res, lang) + '\n' + (!res.empty && !why.length ? '  ' + tx(lang, 'ok') + '\n' : ''));
  for (const w of res.warnings || []) err(`codemap: ${strings(lang)('warn')}: ${w}\n`);
  if (why.length) { err(`codemap: ${tx(lang, 'fail')}:\n` + why.map((w) => '  - ' + w).join('\n') + '\n  ' + tx(lang, 'skip') + '\n'); return 1; }
  return 0;
}
