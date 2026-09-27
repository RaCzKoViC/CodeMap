// Analiza projektu z dysku bez przeglądarki — te same moduły js/*.js co aplikacja (cli/runtime.mjs):
// pliki (reguły loaders.js) → CM.Graph.build → CM.TestMap.mapTests → pokrycie (CM.TestMap.applyCoverage)
// → historia git (CM.GitLocal + CM.GitCore.analyze/applyToGraph) → CM.Inspect.run → raport, SARIF, Markdown.
// API dla innych narzędzi (np. rozszerzenia edytora):
//   import { analyzeProject } from 'codemap/cli/analyze.mjs'
//   const { graph, report, sarif, markdown } = await analyzeProject('.', { lang: 'en', git: true })
import fs from 'node:fs';
import path from 'node:path';
import { loadCodeMap } from './runtime.mjs';
import { loadProjectFiles } from './fsload.mjs';
import { findRepoRoot, readGitFiles } from './gitdir.mjs';
import { toSarif } from './sarif.mjs';
import { buildReport, toMarkdown } from './report.mjs';
import { strings, CliError } from './strings.mjs';

export const DEFAULTS = Object.freeze({
  lang: 'pl',        // 'pl' | 'en' — teksty reguł i szczegółów znalezisk
  git: true,         // historia z .git (analizowany katalog albo najbliższy przodek z .git)
  gitMax: 3000,      // jak w aplikacji (js/git.js MAX_LOCAL)
  coverage: null,    // null = autodetekcja, false = bez pokrycia, [ścieżki] = te raporty
  maxContent: null,  // null = CM.Loaders.MAX_CONTENT_FILES (jak w przeglądarce)
  exclude: [],       // globy (względem analizowanego katalogu) pomijane przy wczytywaniu
});
const MAX_COV = 256 * 1024 * 1024;   // jak tests-ui.js

/**
 * Pełny przebieg analizy. Zwraca żywe obiekty (CM, graf z kontekstu vm) — dla CLI (eksport grafu);
 * zewnętrzne narzędzia powinny używać analyzeProject().
 */
export async function runAnalysis(dir, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const tr = strings(o.lang);
  const T0 = performance.now();
  const root = path.resolve(dir || '.');
  let st = null; try { st = fs.statSync(root); } catch { /* niżej */ }
  if (!st || !st.isDirectory()) throw new CliError(tr('eDir', { p: root }));
  const warnings = [];
  const CM = loadCodeMap({ lang: o.lang });
  const name = path.basename(root) || root;
  const repoRoot = findRepoRoot(root);
  const sub = repoRoot ? path.relative(repoRoot, root).split(path.sep).join('/') : '';

  // 1. pliki
  const loaded = loadProjectFiles(root, CM, { maxContent: o.maxContent, exclude: o.exclude });
  if (loaded.stats.symlinks) warnings.push(tr('wSymlinks', { n: loaded.stats.symlinks }));
  const T1 = performance.now();

  // 2. graf + testy ↔ kod
  const graph = new CM.Graph.Graph();
  graph.build(loaded.files, { name, source: 'cli: ' + name, kind: 'local', createdAt: Date.now() });
  loaded.files.length = 0;   // treść jest już w node.preview — nie trzymamy drugiej kopii
  CM.TestMap.mapTests(graph);

  // 3. pokrycie
  if (o.coverage !== false) {
    const list = Array.isArray(o.coverage) && o.coverage.length
      ? o.coverage.map((p) => ({ abs: path.resolve(p), label: p, explicit: true }))
      : loaded.coverage.map((r) => ({ abs: path.join(root, ...r.split('/')), label: r, explicit: false }));
    const reports = [], names = [];
    for (const c of list) {
      let text = null;
      try { const s = fs.statSync(c.abs); if (s.isFile() && s.size <= MAX_COV) text = fs.readFileSync(c.abs, 'utf8'); }
      catch { if (c.explicit) throw new CliError(tr('eCovFile', { p: c.label })); }
      if (text == null) { if (c.explicit) throw new CliError(tr('eCovFile', { p: c.label })); continue; }
      let r = null; try { r = CM.TestMap.parseCoverage(text, path.basename(c.abs)); } catch { r = null; }
      if (r && r.files.size) { reports.push(r); names.push(c.label); } else if (c.explicit) warnings.push(tr('wCovBad', { p: c.label }));
    }
    if (reports.length) {
      const info = CM.TestMap.applyCoverage(graph, reports, { source: names.join(', ') });
      if (!info.files) warnings.push(tr('wCovNone', { n: info.total, p: names.join(', ') }));
    }
  }
  const T2 = performance.now();

  // 4. historia git
  let head = null;
  if (o.git && repoRoot) {
    try {
      const gitFiles = await readGitFiles(repoRoot, { lazy: true });
      if (gitFiles) {
        const r = await CM.GitLocal.runInThread(gitFiles, { max: o.gitMax });
        const GC = CM.GitCore;
        let commits = r.commits || [];
        if (sub) commits = GC.rebase(commits, sub);
        const paths = [];
        for (const n of graph.nodes.values()) if (n.type === 'file' && n.path) paths.push(n.path);
        const res = GC.analyze(commits, paths);
        head = r.head || null;
        GC.applyToGraph(graph, res, { source: 'local', head, truncated: !!(r.stats && r.stats.truncated), listed: commits.length });
      }
    } catch (e) {
      warnings.push(tr('wGit', { m: (e && (e.code ? e.code + ': ' : '') + e.message) || String(e) }));
    }
  }
  const T3 = performance.now();

  // 5. analiza statyczna (reguły Inspect, health score)
  const rep = await CM.Inspect.run(graph);
  const T4 = performance.now();

  const timing = { readMs: Math.round(T1 - T0), buildMs: Math.round(T2 - T1), gitMs: Math.round(T3 - T2),
    inspectMs: Math.round(T4 - T3), totalMs: Math.round(T4 - T0) };
  const report = buildReport({ CM, graph, rep, loaded, timing, lang: o.lang, name, sub, warnings });
  const sarif = toSarif({ CM, graph, rep, lang: o.lang, uriPrefix: sub });
  const markdown = toMarkdown(CM, rep, report);
  return { CM, graph, rep, report, sarif, markdown, root, repoRoot, sub };
}

/**
 * Mapa .codemap.json jak po wczytaniu w aplikacji: duże grafy zwinięte do budżetu widocznych węzłów
 * (app-core.js ingest), pozycje z domyślnego układu „pack" z rozrzutem wg autoTuneView — aplikacja
 * otwiera mapę z zapisanymi pozycjami, bez nich wszystkie węzły leżałyby w (0, 0).
 * Zmienia graf (zwinięcie, x/y) — wołać po eksportach, które zależą od widoczności.
 */
export function mapJSON(CM, graph) {
  if (graph.nodes.size > 1400) graph.collapseToBudget(2600);
  const spacing = Math.min(25, Math.max(2, 0.5 * Math.pow(graph.nodes.size || 1, 0.45)));
  const F = { folders: true, files: true, externals: false, contains: true, import: true, reference: false, symbols: false,
    call: true, test: true, langsOff: new Set(), metric: 'lines', minMetric: 0 };   // domyślne filtry aplikacji
  CM.Layouts.apply('pack', graph, graph.getVisible(F), { spacing });
  return graph.toJSON();
}

/**
 * API: analiza katalogu → {graph (jak plik .codemap.json, z pozycjami), report:{score, files, findings, git?, tests?, …},
 * sarif (SARIF 2.1.0), markdown}. opts jak DEFAULTS. Obiekty są zwykłymi obiektami bieżącego realmu (sklonowane z vm).
 */
export async function analyzeProject(dir, opts = {}) {
  const r = await runAnalysis(dir, opts);
  return structuredClone({ graph: mapJSON(r.CM, r.graph), report: r.report, sarif: r.sarif, markdown: r.markdown });
}
