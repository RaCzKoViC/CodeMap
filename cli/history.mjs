// Trend zdrowia w czasie (`codemap analyze --history N`): pętla w js/health-trend.js (CM.HealthTrend — wspólna z oknem
// „Trend zdrowia" w aplikacji): N commitów rozłożonych równo na historii pierwszego rodzica HEAD, drzewa wprost z .git
// (bez checkoutu i binarki git), analiza jak dla katalogu, bez historii git i pokrycia — punkty porównywalne (HEAD też
// liczony tak samo, więc jego wynik może się różnić od głównego raportu). Tu: odczyt .git z dysku + tekstowe wyjścia.
import { loadCodeMap } from './runtime.mjs';
import { readGitFiles } from './gitdir.mjs';
import { CliError } from './strings.mjs';

/** Równomiernie rozłożone indeksy 0 … len−1 (pierwszy i ostatni zawsze), rosnąco, bez powtórzeń — CM.HealthTrend. */
export function sampleIndexes(len, n) { return Array.from(loadCodeMap({ lang: 'pl' }).HealthTrend.sampleIndexes(len, n)); }

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
  const gitFiles = await readGitFiles(repoRoot, { lazy: true });
  if (!gitFiles) throw new CliError(lang === 'en' ? '--history needs a git repository' : '--history wymaga repozytorium git');
  const repo = await CM.GitLocal.open(gitFiles);
  // wynik z kontekstu vm (inny realm) → zwykłe obiekty dla wywołujących (JSON, asercje, inne narzędzia)
  return structuredClone(await CM.HealthTrend.compute(repo, { n, sub, exclude: opts.exclude, maxContent: opts.maxContent, maxCommits: opts.maxCommits, onPoint: opts.onPoint }));
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
  const delta = loadCodeMap({ lang }).HealthTrend.ruleDeltas(pts, 8);
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
