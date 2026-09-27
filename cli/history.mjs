// Trend zdrowia w czasie (`codemap analyze --history N`): N commitów rozłożonych równo na historii pierwszego rodzica
// HEAD (od najstarszego do HEAD), dla każdego drzewo plików wprost z .git (CM.GitLocal.snapshot — bez checkoutu i bez
// binarki git) → ta sama analiza co dla katalogu: reguły wczytywania (fsload.mjs), graf, testy ↔ kod, reguły Inspect.
// Bez historii git i pokrycia: reguły git zależą od długości historii, a raport pokrycia jest tylko dla bieżącego
// stanu — punkty trendu mają być porównywalne między sobą (HEAD też liczony tak samo, więc jego wynik może się różnić
// od głównego raportu).
import { loadCodeMap } from './runtime.mjs';
import { readGitFiles } from './gitdir.mjs';
import { acceptPath } from './fsload.mjs';
import { CliError } from './strings.mjs';

/** Równomiernie rozłożone indeksy 0 … len−1 (n ≥ 2 → pierwszy i ostatni zawsze w środku), rosnąco, bez powtórzeń. */
export function sampleIndexes(len, n) {
  if (len <= 0 || n <= 0) return [];
  if (n >= len) return Array.from({ length: len }, (_, i) => i);
  if (n === 1) return [len - 1];
  const out = new Set();
  for (let k = 0; k < n; k++) out.add(Math.round(k * (len - 1) / (n - 1)));
  return [...out].sort((a, b) => a - b);
}

/**
 * @param {string} repoRoot  katalog repozytorium (z .git)
 * @param {string} sub       podkatalog analizy względem repozytorium ('' = całość)
 * @param {number} n         liczba punktów (≥ 1)
 * @param {{lang?, exclude?, maxContent?, maxCommits?, onPoint?}} opts
 * @returns {Promise<{points, chain, sampled}>}  points od najstarszego: {sha, date, message, score, files, lines, totals, rules}
 */
export async function healthHistory(repoRoot, sub, n, opts = {}) {
  const lang = opts.lang || 'pl';
  const CM = loadCodeMap({ lang });
  const L = CM.Loaders, dec = new TextDecoder('utf-8');
  const gitFiles = await readGitFiles(repoRoot, { lazy: true });
  if (!gitFiles) throw new CliError(lang === 'en' ? '--history needs a git repository' : '--history wymaga repozytorium git');
  const repo = await CM.GitLocal.open(gitFiles);
  // łańcuch pierwszego rodzica od HEAD wstecz (merge = jeden punkt, jak `git log --first-parent`)
  const chain = [], maxCommits = opts.maxCommits || 5000;
  let c = await repo.commit('HEAD');
  while (c && chain.length < maxCommits) { chain.push(c); c = c.parents.length ? await repo.commit(c.parents[0]).catch(() => null) : null; }
  chain.reverse();   // od najstarszego
  const idx = sampleIndexes(chain.length, Math.max(1, Math.floor(n)));
  const pre = sub ? sub.replace(/\/+$/, '') + '/' : '';
  const maxContent = opts.maxContent != null ? opts.maxContent : L.MAX_CONTENT_FILES;
  const points = [];
  for (const i of idx) {
    const cm = chain[i];
    const snap = await repo.snapshot(cm.sha);
    const files = [];
    let withContent = 0;
    for (const f of snap.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
      if (pre && !f.path.startsWith(pre)) continue;
      const rel = f.path.slice(pre.length);
      if (!acceptPath(CM, rel, opts.exclude)) continue;
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      let content = null, size = 0;
      if (L.isTextFile(name, 0) && withContent < maxContent) {
        const data = await repo.blob(f.sha);
        size = data ? data.length : 0;
        if (data && L.isTextFile(name, size)) { content = dec.decode(data); withContent++; }
      }
      files.push({ path: rel, size, content, mtime: cm.committer && cm.committer.time || null });
    }
    const graph = new CM.Graph.Graph();
    graph.build(files, { name: 'history', source: 'history', kind: 'local' });
    CM.TestMap.mapTests(graph);
    const rep = await CM.Inspect.run(graph);
    const totals = { findings: 0, high: 0, med: 0, low: 0, info: 0 }, rules = {};
    for (const f of rep.findings) {
      totals.findings += f.count; rules[f.rule] = f.count;
      for (const it of f.items) totals[it.sev]++;
      totals[f.sev] += f.count - f.items.length;
    }
    let lines = 0; for (const nd of graph.nodes.values()) if (nd.type === 'file' && nd.metrics) lines += nd.metrics.lines;
    const time = (cm.author && cm.author.time) || (cm.committer && cm.committer.time) || null;
    const p = { sha: cm.sha, date: time ? new Date(time).toISOString().slice(0, 10) : null, time, message: String(cm.message || '').split('\n')[0].slice(0, 120),
      score: rep.score, files: files.length, lines, totals, rules };
    points.push(p);
    if (opts.onPoint) opts.onPoint(p, points.length, idx.length);
  }
  return { points, chain: chain.length, sampled: idx.length };
}

/** Sekcja Markdown raportu: tabela punktów + reguły, które najbardziej urosły / spadły między pierwszym a ostatnim. */
export function historyMarkdown(h, lang = 'pl') {
  const en = lang === 'en', pts = h.points;
  if (!pts.length) return '';
  const a = pts[0], b = pts[pts.length - 1], d = b.score - a.score;
  const L = [`## ${en ? 'Health trend' : 'Trend zdrowia'}`, '',
    en ? `${pts.length} of ${h.chain} commits (HEAD first parent), without git-history rules and coverage — comparable points. Change: **${a.score} → ${b.score}** (${d >= 0 ? '+' : '−'}${Math.abs(d)}).`
      : `${pts.length} z ${h.chain} commitów (pierwszy rodzic HEAD), bez reguł historii git i pokrycia — punkty porównywalne. Zmiana: **${a.score} → ${b.score}** (${d >= 0 ? '+' : '−'}${Math.abs(d)}).`,
    '', en ? '| date | commit | score | files | high | med | low | message |' : '| data | commit | wynik | pliki | wysokie | średnie | niskie | opis |',
    '|---|---|--:|--:|--:|--:|--:|---|'];
  for (const p of pts) L.push(`| ${p.date || ''} | \`${p.sha.slice(0, 7)}\` | ${p.score} | ${p.files} | ${p.totals.high} | ${p.totals.med} | ${p.totals.low} | ${p.message.replace(/\|/g, '\\|')} |`);
  const rules = new Set([...Object.keys(a.rules), ...Object.keys(b.rules)]);
  const delta = [...rules].map((r) => [r, (b.rules[r] || 0) - (a.rules[r] || 0)]).filter(([, x]) => x).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 8);
  if (delta.length) L.push('', (en ? 'Largest changes per rule: ' : 'Największe zmiany reguł: ') + delta.map(([r, x]) => `\`${r}\` ${x > 0 ? '+' : '−'}${Math.abs(x)}`).join(' · '));
  return L.join('\n') + '\n';
}

/** Tabela trendu (tekst) + różnica pierwszy → ostatni. */
export function historyTable(h, lang = 'pl') {
  const en = lang === 'en', pts = h.points;
  if (!pts.length) return en ? 'No commits.' : 'Brak commitów.';
  const bar = (s) => '█'.repeat(Math.round(s / 10)).padEnd(10, '·');
  const rows = pts.map((p) => `  ${p.date || '?         '}  ${p.sha.slice(0, 7)}  ${String(p.score).padStart(3)} ${bar(p.score)}  ${String(p.files).padStart(5)} ${en ? 'files' : 'pl.'}  `
    + `${en ? 'high' : 'wys.'} ${p.totals.high} · ${en ? 'med' : 'śr.'} ${p.totals.med} · ${en ? 'low' : 'nis.'} ${p.totals.low}  ${p.message.slice(0, 50)}`);
  const a = pts[0], b = pts[pts.length - 1], d = b.score - a.score;
  const head = en ? `Health trend — ${pts.length} of ${h.chain} commits (first parent, without git-history rules and coverage):`
    : `Trend zdrowia — ${pts.length} z ${h.chain} commitów (pierwszy rodzic, bez reguł historii git i pokrycia):`;
  const tail = (en ? '  change: ' : '  zmiana: ') + `${a.score} → ${b.score} (${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)})`;
  return [head, ...rows, tail].join('\n');
}
