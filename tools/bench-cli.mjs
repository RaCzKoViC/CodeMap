// Benchmark analizy na prawdziwych dużych repozytoriach (faza 13): pełny przebieg CLI (wczytanie, graf + testy,
// historia git, analiza statyczna) na przypiętych wydaniach — czasy etapów, pliki, linie i pamięć. Dwa przebiegi,
// liczy się szybszy (pierwszy grzeje dysk i JIT). Próg regresji jak w tools/bench.mjs: wolniej niż poprzedni wynik ×
// tolerancja I o więcej niż 1 s — kod wyjścia 1; brak poprzedniego wyniku = bez porównania.
//   node tools/bench-cli.mjs [--only django] [--json out.json] [--baseline prev.json[,prev2.json…]] [--tolerance 1.5] [--summary]
//   (kilka plików bazowych → mediana: odporność na rozrzut runnerów CI)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAnalysis } from '../cli/analyze.mjs';

const CACHE = process.env.CODEMAP_CORPUS_DIR || join(tmpdir(), 'codemap-corpus');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = (arg('only', '') || '').split(',').filter(Boolean), OUT = arg('json', null), BASE = arg('baseline', null);
const TOL = parseFloat(arg('tolerance', '1.5')) || 1.5, SUMMARY = process.argv.includes('--summary');

export const REPOS = [
  { id: 'django', repo: 'django/django', ref: '5.1' },        // Python, ~7 tys. plików (kod, testy, dokumentacja)
  { id: 'vite', repo: 'vitejs/vite', ref: 'v6.0.0' },         // monorepo TS z workspaces
];

function checkout(r) {
  const dir = join(CACHE, r.id + '@' + r.ref);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(CACHE, { recursive: true }); rmSync(dir, { recursive: true, force: true });
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', r.ref, 'https://github.com/' + r.repo + '.git', dir], { stdio: 'ignore' });
  }
  return dir;
}

const results = [];
for (const r of REPOS.filter((x) => !ONLY.length || ONLY.includes(x.id))) {
  const dir = checkout(r);
  let best = null;
  for (let i = 0; i < 2; i++) {
    const res = await runAnalysis(dir, { coverage: false });
    const t = res.report.timing, mem = process.memoryUsage();
    const run = { ...t, heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) };
    if (!best || run.totalMs < best.totalMs) best = Object.assign(run, { files: res.report.stats.files, lines: res.report.stats.lines, score: res.report.score });
  }
  results.push({ id: r.id, repo: r.repo, ref: r.ref, ...best });
  console.log(`${r.id.padEnd(8)} ${String(best.files).padStart(6)} plików · ${String(best.lines).padStart(8)} linii · wczytanie ${best.readMs} ms · graf ${best.buildMs} ms · git ${best.gitMs} ms · analiza ${best.inspectMs} ms · razem ${best.totalMs} ms · heap ${best.heapMB} MB · wynik ${best.score}`);
}

const cmp = [];
if (BASE) {
  // baza = mediana z kilku poprzednich przebiegów (`--baseline a.json,b.json,c.json`): runnery CI różnią się nawet
  // o 1,5× dla tego samego kodu (django 2,3–3,4 s), jeden szczęśliwie szybki przebieg nie może być progiem dla kolejnych
  const bases = [];
  for (const f of BASE.split(',').filter(Boolean)) { try { bases.push(JSON.parse(readFileSync(f, 'utf8'))); } catch { /* brak pliku — pomijamy */ } }
  if (!bases.length) console.log(`– brak poprzedniego wyniku (${BASE}) — bez porównania`);
  const median = (xs) => { const s = xs.filter((x) => x > 0).sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : 0; };
  for (const r of results) {
    const bs = bases.map((b) => (b.results || []).find((x) => x.id === r.id && x.ref === r.ref)).filter(Boolean); if (!bs.length) continue;
    for (const k of ['totalMs', 'inspectMs', 'buildMs']) {
      const now = r[k], was = median(bs.map((b) => b[k])); if (!(was > 0)) continue;
      cmp.push({ id: r.id, k, now, was, ratio: now / was, bad: now > was * TOL && now - was > 1000 });
    }
  }
  for (const c of cmp) console.log(`${c.bad ? '✖' : '✔'} ${c.id} ${c.k}: ${c.now} ms (poprzednio ${c.was} ms, ${c.ratio.toFixed(2)}×)`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 2));
if (SUMMARY) {
  const rows = ['### Benchmark analizy (CLI) na dużych repozytoriach', '', '| repozytorium | wersja | pliki | linie | wczytanie | graf | git | analiza | razem | heap |', '|---|---|--:|--:|--:|--:|--:|--:|--:|--:|'];
  for (const r of results) rows.push(`| ${r.repo} | \`${r.ref}\` | ${r.files} | ${r.lines} | ${r.readMs} ms | ${r.buildMs} ms | ${r.gitMs} ms | ${r.inspectMs} ms | ${r.totalMs} ms | ${r.heapMB} MB |`);
  if (cmp.length) rows.push('', '| repozytorium | pomiar | teraz | poprzednio | zmiana |', '|---|---|--:|--:|--:|', ...cmp.map((c) => `| ${c.id} | ${c.k} | ${c.now} ms | ${c.was} ms | ${c.bad ? '✖ ' : ''}${c.ratio.toFixed(2)}× |`));
  const md = rows.join('\n') + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); else console.log('\n' + md);
}
if (cmp.some((c) => c.bad)) { console.error(`✖ regres wydajności analizy (próg ${TOL}× i 1 s)`); process.exitCode = 1; }
