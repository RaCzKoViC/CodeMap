// Raport CLI: obiekt JSON (--json), Markdown (--md, na bazie CM.Inspect.toMarkdown z aplikacji)
// i czytelne podsumowanie w terminalu. Liczby i nazwy reguł z modułów aplikacji (CM.util, CM.Inspect).
import { strings, countOf } from './strings.mjs';
import { INFO_URI } from './sarif.mjs';

export const SEVS = ['high', 'med', 'low', 'info'];
export const SEV_RANK = { high: 3, med: 2, low: 1, info: 0 };

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** Obiekt raportu (dane z kontekstu vm przepisane na zwykłe obiekty). */
export function buildReport({ CM, graph, rep, loaded, timing, lang, name, sub, warnings }) {
  const t = CM.Inspect.text, GC = CM.GitCore;
  const pathOf = (id) => { const n = graph.nodes.get(id); return n ? (n.path || n.name) : id; };
  const findings = rep.findings.map((f) => ({
    rule: f.rule, sev: f.sev, title: t('r.' + f.rule), description: t('r.' + f.rule + '.d'), count: f.count,
    items: f.items.map((it) => {
      const n = graph.nodes.get(it.id);
      const o = { path: it.path, name: it.name, kind: n ? n.type : 'file', sev: it.sev || f.sev, detail: it.detail || '' };
      if (it.related && it.related.length) o.related = it.related.map(pathOf);
      return o;
    }),
  }));
  const totals = { findings: 0, high: 0, med: 0, low: 0, info: 0 };
  for (const f of findings) {
    totals.findings += f.count;
    for (const it of f.items) totals[it.sev]++;
    totals[f.sev] += f.count - f.items.length;          // pozycje ponad limit listy — ważność reguły
  }

  let lines = 0, bytes = 0, folders = 0;
  const files = [];
  for (const n of graph.nodes.values()) {
    if (n.type === 'file') { files.push(n); lines += n.metrics ? n.metrics.lines : 0; bytes += n.size || 0; }
    else if (n.type === 'folder' && n.id !== '__root__' && !n.external) folders++;
  }
  const languages = [...graph.langStats.values()]
    .map((s) => ({ key: s.key, name: (s.info && s.info.name) || s.key, files: s.count, lines: s.lines, bytes: s.bytes }))
    .sort((a, b) => b.files - a.files || b.lines - a.lines || (a.key < b.key ? -1 : 1));

  let git = null, hotspots = [];
  const gi = graph.gitInfo;
  if (gi) {
    const humans = (gi.authors || []).filter((a) => !a.bot);
    git = {
      commits: gi.commits, merges: gi.merges, authors: humans.length, bots: (gi.authors || []).length - humans.length,
      topAuthors: humans.slice().sort((a, b) => b.commits - a.commits).slice(0, 10)
        .map((a) => ({ name: a.name, commits: a.commits, files: a.files, owned: a.owned })),
      busFactor: { value: gi.busFactor ? gi.busFactor.value : 0, authors: ((gi.busFactor && gi.busFactor.authors) || []).map((i) => (gi.authors[i] || {}).name || '?') },
      tracked: gi.tracked, untracked: gi.untracked, range: { from: iso(gi.range && gi.range.from), to: iso(gi.range && gi.range.to) },
      head: gi.head ? { ref: gi.head.ref || null, sha: gi.head.sha || null } : null, truncated: !!gi.truncated,
    };
    // top hotspoty wśród plików kodu (manifesty i dokumentacja też mają historię, ale nie złożoność)
    hotspots = files.filter((n) => n.git && n.git.c && CM.TestMap.isCodeFile(n.path || n.id))
      .map((n) => ({ path: n.path, changes: n.git.c, recent: n.git.recent || 0, complexity: (n.metrics && n.metrics.complexity) || 0, score: GC.hotspotScore(n) }))
      .filter((h) => h.score > 0).sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1)).slice(0, 10);
  }

  let tests = null;
  const ti = graph.testInfo, ci = ti && ti.coverage && ti.coverage.files > 0 ? ti.coverage : null;
  if (ti && ((ti.tests || 0) + (ti.helpers || 0) > 0 || ci)) {
    tests = {
      tests: ti.tests || 0, helpers: ti.helpers || 0, code: ti.code || 0, tested: ti.tested || 0, untested: ti.untested || 0,
      pct: ti.pct || 0, byName: ti.byName || 0, byImport: ti.byImport || 0,
      coverage: ci ? { pct: ci.pct, lh: ci.lh, lf: ci.lf, bh: ci.bh, bf: ci.bf, fh: ci.fh, ff: ci.ff, files: ci.files,
        matched: ci.matched, total: ci.total, source: ci.source, format: ci.format } : null,
    };
  }

  return {
    tool: { name: 'CodeMap', version: CM.VERSION, informationUri: INFO_URI },
    project: { name, path: sub || '.', generatedAt: new Date().toISOString() },
    lang,
    score: rep.score,
    files: rep.files,
    stats: { files: rep.files, folders, lines, bytes, contentFiles: loaded.stats.content, contentCap: loaded.stats.maxContent,
      withoutContent: loaded.stats.capped, excluded: loaded.stats.excluded, languages },
    totals,
    findings,
    hotspots,
    git,
    tests,
    timing,
    warnings: warnings.slice(),
  };
}

// ---------------- formatowanie wspólne ----------------
function fmt(CM, lang) {
  const U = CM.util, tr = strings(lang), t = CM.Inspect.text;
  const num = (n) => U.fmtNum(n || 0).replace(/ /g, ' ');
  const pct = (p) => (p == null ? '—' : String(Math.round(p * 10) / 10).replace('.', lang === 'en' ? '.' : ','));
  const dur = (ms) => (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1).replace('.', lang === 'en' ? '.' : ',') + ' s');
  const langs = (r, k = 6) => {   // po nazwie (js + mjs = „JavaScript")
    const m = new Map(); for (const l of r.stats.languages) m.set(l.name, (m.get(l.name) || 0) + l.files);
    const a = [...m].sort((x, y) => y[1] - x[1]);
    return a.slice(0, k).map(([n, c]) => `${CM.languages.label(n, lang)} ${num(c)}`).join(' · ') + (a.length > k ? ' · …' : '');
  };
  const sevs = (r) => SEVS.filter((s) => r.totals[s]).map((s) => `${t('sev.' + s)} ${num(r.totals[s])}`).join(' · ');
  const filesVal = (r) => tr('filesVal', { n: num(r.stats.files), c: num(r.stats.contentFiles),
    cap: r.stats.withoutContent ? tr('capNote', { max: num(r.stats.contentCap), k: num(r.stats.withoutContent) }) : '' });
  const gitVal = (r) => {
    const g = r.git; if (!g) return tr('gitNone');
    const who = g.busFactor.authors.length ? ' (' + g.busFactor.authors.slice(0, 3).join(', ') + ')' : '';
    return tr('gitVal', { c: countOf(lang, g.commits, 'commits', num(g.commits)), a: countOf(lang, g.authors, 'authors', num(g.authors)), bf: g.busFactor.value, who })
      + (g.truncated ? tr('gitTrunc', { n: num(g.commits + g.merges) }) : '');
  };
  const testsVal = (r) => (r.tests && r.tests.tests
    ? tr('testsVal', { t: countOf(lang, r.tests.tests, 'tests', num(r.tests.tests)), tested: num(r.tests.tested), code: num(r.tests.code), pct: r.tests.pct })
    : tr('testsNone'));
  const covVal = (r) => { const c = r.tests && r.tests.coverage; if (!c) return null;
    return tr('covVal', { pct: pct(c.pct), lh: num(c.lh), lf: num(c.lf), m: num(c.matched), n: num(c.total), src: c.source || c.format }); };
  const timeVal = (r) => tr('timeVal', { total: dur(r.timing.totalMs), read: dur(r.timing.readMs), build: dur(r.timing.buildMs), git: dur(r.timing.gitMs), inspect: dur(r.timing.inspectMs) });
  return { tr, t, num, pct, dur, langs, sevs, filesVal, gitVal, testsVal, covVal, timeVal };
}

// ---------------- Markdown ----------------
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Markdown: nagłówek i sekcje reguł z CM.Inspect.toMarkdown (jak eksport w aplikacji) + podsumowanie CLI. */
export function toMarkdown(CM, rep, report) {
  const F = fmt(CM, report.lang), { tr, t, num } = F;
  const L = [];
  L.push(`- **${tr('files')}:** ${F.filesVal(report)}`);
  L.push(`- **${tr('lines')}:** ${num(report.stats.lines)} · **${tr('size')}:** ${CM.util.fmtBytes(report.stats.bytes)}`);
  L.push(`- **${tr('langs')}:** ${F.langs(report, 8) || '—'}`);
  L.push(`- **${tr('findings')}:** ${num(report.totals.findings)}${report.totals.findings ? ' — ' + F.sevs(report) : ''}`);
  L.push(`- **${tr('git')}:** ${F.gitVal(report)}`);
  L.push(`- **${tr('tests')}:** ${F.testsVal(report)}`);
  const cv = F.covVal(report); if (cv) L.push(`- **${tr('cov')}:** ${cv}`);
  L.push(`- **${tr('time')}:** ${F.timeVal(report)}`);
  L.push('');
  if (report.findings.length) {
    L.push(`## ${tr('byRule')}`, '', `| ${tr('rule')} | ${tr('sev')} | ${tr('count')} |`, '|---|---|---:|');
    for (const f of report.findings) L.push(`| ${cell(f.title)} (\`${f.rule}\`) | ${t('sev.' + f.sev)} | ${num(f.count)} |`);
    L.push('');
  }
  if (report.hotspots.length) {
    L.push(`## ${tr('hotspots')}`, '', `| ${tr('file')} | ${tr('changes')} | ${tr('complexity')} |`, '|---|---:|---:|');
    for (const h of report.hotspots) L.push(`| \`${cell(h.path)}\` | ${num(h.changes)} | ${num(h.complexity)} |`);
    L.push('');
  }
  return CM.Inspect.toMarkdown(rep, report.project.name, L) + '\n';
}

// ---------------- terminal ----------------
/** Czytelne podsumowanie (color = kody ANSI). */
export function toSummary(CM, report, { color = false } = {}) {
  const F = fmt(CM, report.lang), { tr, t, num } = F;
  const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  const bold = c('1'), dim = c('2'), red = c('31'), yellow = c('33'), green = c('32'), cyan = c('36');
  const SEVC = { high: red, med: yellow, low: cyan, info: dim };
  const MARK = { high: '✖', med: '▲', low: '•', info: '·' };
  const scoreC = report.score >= 80 ? green : report.score >= 55 ? yellow : red;
  const rows = [
    [tr('files'), F.filesVal(report)],
    [tr('lines'), `${num(report.stats.lines)} · ${CM.util.fmtBytes(report.stats.bytes)}`],
    [tr('langs'), F.langs(report) || '—'],
    [tr('score'), scoreC(bold(`${report.score}/100`))],
    [tr('findings'), report.totals.findings ? `${num(report.totals.findings)} — ${F.sevs(report)}` : tr('none')],
  ];
  const tail = [[tr('git'), F.gitVal(report)], [tr('tests'), F.testsVal(report)]];
  const cv = F.covVal(report); if (cv) tail.push([tr('cov'), cv]);
  tail.push([tr('time'), F.timeVal(report)]);
  const w = Math.max(...[...rows, ...tail].map((r) => r[0].length)) + 2;
  const row = ([k, v]) => `  ${dim(k.padEnd(w))}${v}`;
  const out = [bold(tr('title', { v: CM.VERSION, name: report.project.name + (report.project.path !== '.' ? ` (${report.project.path})` : '') })), ...rows.map(row)];
  if (report.findings.length) {
    out.push('', '  ' + bold(tr('byRule')));
    const sw = Math.max(...report.findings.map((f) => t('sev.' + f.sev).length));
    const tw = Math.min(56, Math.max(...report.findings.map((f) => f.title.length + f.rule.length + 3)));
    for (const f of report.findings) {
      const label = `${f.title} (${f.rule})`;
      out.push(`    ${SEVC[f.sev](MARK[f.sev] + ' ' + t('sev.' + f.sev).padEnd(sw))}  ${(label.length > tw ? label.slice(0, tw - 1) + '…' : label).padEnd(tw)}  ${num(f.count).padStart(6)}`);
    }
  }
  if (report.hotspots.length) {
    out.push('', '  ' + bold(tr('hotspots')));
    const top = report.hotspots.slice(0, 5), pw = Math.min(60, Math.max(...top.map((h) => h.path.length)));
    for (const h of top) out.push(`    ${h.path.padEnd(pw)}  ${dim(`${num(h.changes)} × CC ${num(h.complexity)}`)}`);
  }
  out.push('', ...tail.map(row));
  return out.join('\n');
}

/** Podatne zależności (graph.vulnInfo z OSV.dev) tekstem — narzędzie MCP vulnerable_dependencies (po angielsku). */
export function vulnSummary(vi) {
  if (!vi) return 'OSV.dev check did not run (network error?)';
  if (!vi.items.length) return `none of ${vi.checked} packages has known vulnerabilities`;
  const line = (it) => `- ${it.name} ${it.version} (${it.ecosystem}${it.direct === false ? ', transitive' : ''}): ${it.level || '?'} — `
    + it.vulns.slice(0, 4).map((v) => v.id).join(', ') + (it.fixed ? ' · fixed in ' + it.fixed : '');
  return `${vi.items.length} of ${vi.checked} packages vulnerable:\n` + vi.items.map(line).join('\n');
}
