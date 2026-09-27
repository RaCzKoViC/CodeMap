#!/usr/bin/env node
// CodeMap CLI — ta sama analiza co w aplikacji, z wiersza poleceń i w CI (bez zależności npm).
//   codemap analyze [ścieżka=.] [--json f] [--md f] [--sarif f] [--map f] [--export dot|mermaid|graphml --out f]
//                   [--min-score N] [--fail-on high|med|low|info|<reguły>] [--max-findings N]
//                   [--no-git] [--git-max N] [--coverage f]… [--no-coverage] [--exclude glob]… [--max-content N]
//                   [--lang pl|en] [--quiet] [--no-color]
// Kody wyjścia: 0 = OK, 1 = próg niespełniony, 2 = błąd użycia lub wykonania.
// Kod wyjścia przez process.exitCode (nie process.exit): na Node 26 twarde exit() po strumieniach bywa asercją libuv.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnalysis, mapJSON, DEFAULTS } from './analyze.mjs';
import { toSummary, SEVS, SEV_RANK } from './report.mjs';
import { strings, countOf, CliError } from './strings.mjs';
import { loadCodeMap } from './runtime.mjs';

const SEV_ALIAS = { high: 'high', error: 'high', critical: 'high', med: 'med', medium: 'med', warning: 'med',
  low: 'low', note: 'low', info: 'info' };
const EXPORTS = ['dot', 'mermaid', 'graphml'];

/** Parsowanie argv (bez `node codemap.mjs`). Rzuca CliError (kod 2). */
export function parseArgs(argv, RULES) {
  // język potrzebny już do komunikatów o błędach składni
  let lang = 'pl';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang' && argv[i + 1]) lang = argv[i + 1];
    else if (a.startsWith('--lang=')) lang = a.slice(7);
  }
  if (lang !== 'pl' && lang !== 'en') { const bad = lang; lang = 'pl'; throw new CliError(strings('pl')('eLang', { v: bad })); }
  const tr = strings(lang);
  const o = { cmd: null, dir: null, lang, json: null, md: null, sarif: null, map: null, export: null, out: null,
    minScore: null, failOn: [], maxFindings: null, git: DEFAULTS.git, gitMax: DEFAULTS.gitMax, coverage: [], noCoverage: false,
    exclude: [], maxContent: null, quiet: false, color: null, help: false, version: false };
  const num = (flag, v) => { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n) || n < 0) throw new CliError(tr('eNum', { o: flag, v })); return n; };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i], val = null;
    if (a.startsWith('--') && a.includes('=')) { val = a.slice(a.indexOf('=') + 1); a = a.slice(0, a.indexOf('=')); }
    const need = () => { if (val != null) return val; const v = argv[++i]; if (v == null || (v.startsWith('-') && v !== '-')) throw new CliError(tr('eVal', { o: a })); return v; };
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      case '--lang': need(); break;
      case '--json': o.json = need(); break;
      case '--md': case '--markdown': o.md = need(); break;
      case '--sarif': o.sarif = need(); break;
      case '--map': o.map = need(); break;
      case '--export': { const v = need().toLowerCase(); if (!EXPORTS.includes(v)) throw new CliError(tr('eFmt', { v })); o.export = v; break; }
      case '--out': case '-o': o.out = need(); break;
      case '--min-score': o.minScore = num(a, need()); break;
      case '--max-findings': o.maxFindings = num(a, need()); break;
      case '--fail-on':
        for (const raw of need().split(',').map((s) => s.trim()).filter(Boolean)) {
          const sev = SEV_ALIAS[raw.toLowerCase()];
          const rule = RULES.find((r) => r.toLowerCase() === raw.toLowerCase());
          if (sev) o.failOn.push({ sev });
          else if (rule) o.failOn.push({ rule });
          else throw new CliError(tr('eFail', { v: raw, rules: RULES.join(', ') }));
        }
        break;
      case '--git': o.git = true; break;
      case '--no-git': o.git = false; break;
      case '--git-max': o.gitMax = Math.max(1, Math.floor(num(a, need()))); break;
      case '--coverage': o.coverage.push(need()); break;
      case '--no-coverage': o.noCoverage = true; break;
      case '--exclude': o.exclude.push(need()); break;
      case '--max-content': o.maxContent = Math.floor(num(a, need())); break;
      case '-q': case '--quiet': o.quiet = true; break;
      case '--color': o.color = true; break;
      case '--no-color': o.color = false; break;
      default:
        if (a.startsWith('-') && a !== '-') throw new CliError(tr('eOpt', { o: a }));
        if (!o.cmd) o.cmd = a;
        else if (!o.dir) o.dir = a;
        else throw new CliError(tr('eArgs', { a }));
    }
  }
  if (o.out && !o.export) throw new CliError(tr('eOutNoExport'));
  const toStdout = [o.json, o.md, o.sarif, o.map].filter((x) => x === '-').length + (o.export && (!o.out || o.out === '-') ? 1 : 0);
  if (toStdout > 1) throw new CliError(tr('eStdout'));
  o.stdoutUsed = toStdout > 0;
  return o;
}

/** Progi CI → lista powodów porażki (pusta = OK). */
export function checkThresholds(report, o, tr) {
  const why = [], cnt = (n) => countOf(o.lang, n, 'findings');
  if (o.minScore != null && report.score < o.minScore) why.push(tr('failScore', { s: report.score, min: o.minScore }));
  for (const f of o.failOn) {
    if (f.sev) {
      const min = SEV_RANK[f.sev];
      const n = SEVS.filter((s) => SEV_RANK[s] >= min).reduce((a, s) => a + (report.totals[s] || 0), 0);
      if (n > 0) why.push(tr('failSev', { n: cnt(n), sev: f.sev }));
    } else {
      const fd = report.findings.find((x) => x.rule === f.rule);
      if (fd && fd.count > 0) why.push(tr('failRule', { rule: f.rule, title: fd.title, n: cnt(fd.count) }));
    }
  }
  if (o.maxFindings != null && report.totals.findings > o.maxFindings) why.push(tr('failMax', { n: cnt(report.totals.findings), max: o.maxFindings }));
  return why;
}

function writeOut(file, text) {
  if (file === '-') { process.stdout.write(text.endsWith('\n') ? text : text + '\n'); return; }
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

export async function main(argv = process.argv.slice(2)) {
  let lang = 'pl';
  const errTr = () => strings(lang);
  try {
    // CM tylko po wersję i listę reguł do walidacji --fail-on (tani odczyt modułów, bez analizy)
    const CM0 = loadCodeMap({ lang: 'pl' });
    const o = parseArgs(argv, CM0.Inspect.RULES);
    lang = o.lang;
    const tr = strings(lang);
    if (o.version) { process.stdout.write(CM0.VERSION + '\n'); return 0; }
    if (o.help) { process.stdout.write(tr('help', { v: CM0.VERSION, max: CM0.Loaders.MAX_CONTENT_FILES, rules: CM0.Inspect.RULES.join(', ') }) + '\n'); return 0; }
    if (!o.cmd) { process.stderr.write(tr('help', { v: CM0.VERSION, max: CM0.Loaders.MAX_CONTENT_FILES, rules: CM0.Inspect.RULES.join(', ') }) + '\n\n' + tr('err') + ': ' + tr('eNoCmd') + '\n'); return 2; }
    if (o.cmd !== 'analyze') throw new CliError(tr('eCmd', { c: o.cmd }));

    const res = await runAnalysis(o.dir || '.', {
      lang, git: o.git, gitMax: o.gitMax, coverage: o.noCoverage ? false : (o.coverage.length ? o.coverage : null),
      maxContent: o.maxContent, exclude: o.exclude,
    });
    const { CM, graph, report } = res;
    const log = (s) => { if (!o.quiet) process.stderr.write(s + '\n'); };
    const written = [];
    if (o.json) { writeOut(o.json, JSON.stringify(report, null, 2) + '\n'); written.push(['JSON', o.json]); }
    if (o.md) { writeOut(o.md, res.markdown); written.push(['Markdown', o.md]); }
    if (o.sarif) { writeOut(o.sarif, JSON.stringify(res.sarif, null, 2) + '\n'); written.push(['SARIF', o.sarif]); }
    if (o.export) {   // pełny graf (przed mapą: mapJSON zwija duże grafy)
      const ex = CM.Export.build(graph, null, o.export);
      writeOut(o.out || '-', ex.text);
      written.push([o.export.toUpperCase(), o.out || '-']);
    }
    if (o.map) { writeOut(o.map, JSON.stringify(mapJSON(CM, graph)) + '\n'); written.push(['.codemap.json', o.map]); }
    // podsumowanie: na stdout, chyba że stdout zajmuje któreś wyjście (wtedy na stderr)
    if (!o.quiet) {
      const stream = o.stdoutUsed ? process.stderr : process.stdout;
      const color = o.color != null ? o.color : (!!stream.isTTY && !process.env.NO_COLOR) || !!process.env.FORCE_COLOR;
      stream.write(toSummary(CM, report, { color }) + '\n');
      for (const [what, file] of written) if (file !== '-') stream.write('  ' + tr('written', { what, file }) + '\n');
    }
    for (const w of report.warnings) log(`codemap: ${tr('warn')}: ${w}`);
    const why = checkThresholds(report, o, tr);
    if (why.length) {
      process.stderr.write(`codemap: ${tr('fail')}:\n` + why.map((w) => '  - ' + w).join('\n') + '\n');
      return 1;
    }
    return 0;
  } catch (e) {
    const msg = e instanceof CliError ? e.message : ((e && e.stack) || String(e));
    process.stderr.write(`codemap: ${errTr()('err')}: ${msg}\n`);
    return 2;
  }
}

// uruchomione wprost (node cli/codemap.mjs, npm bin — także przez dowiązanie symboliczne), nie importowane
const isMain = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().then((code) => { process.exitCode = code; });
