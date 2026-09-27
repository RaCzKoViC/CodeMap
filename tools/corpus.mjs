// Korpus referencyjny (faza 9): czy mapa mówi prawdę? Prawdziwe repozytoria przypięte do tagów, krawędzie importów
// z CodeMap (CLI na całym repozytorium, jak u użytkownika) porównane z wyrocznią ekosystemu:
//   • JS / TS — esbuild (bundle z packages: external → metafile: każdy import rozwiązany przez resolver esbuilda,
//     z tsconfig i package.json; verbatimModuleSyntax — importy użyte tylko jako typy zostają, `import type` znika),
//   • Python — grimp (graf importów modułów, jak import-linter), w osobnym venv w katalogu cache,
//   • Go — `go list -json ./...` (poziom pakietów; testy _test.go pominięte po obu stronach).
// Wynik: precyzja (ile krawędzi CodeMap jest prawdziwych) i kompletność (ile prawdziwych CodeMap znalazł) per
// repozytorium + rozbieżności do poprawiania analizatora. Brak narzędzia (np. Go lokalnie) → repozytorium pominięte.
//   node tools/corpus.mjs [--only ky,flask] [--show 20] [--json out.json] [--min-precision 0.9 --min-recall 0.9]
//                         [--require-all] (pominięte = błąd, w CI) [--summary] (tabela do $GITHUB_STEP_SUMMARY)
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const CACHE = process.env.CODEMAP_CORPUS_DIR || join(tmpdir(), 'codemap-corpus');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = (arg('only', '') || '').split(',').filter(Boolean), SHOW = +arg('show', 12), OUT = arg('json', null);
const MIN_P = parseFloat(arg('min-precision', '0')) || 0, MIN_R = parseFloat(arg('min-recall', '0')) || 0;
const REQUIRE_ALL = process.argv.includes('--require-all'), SUMMARY = process.argv.includes('--summary');

// repozytoria z galerii (js/gallery.js) przypięte do wydań; scope = katalogi kodu, którego dotyczy porównanie
export const CORPUS = [
  { id: 'express', repo: 'expressjs/express', ref: 'v5.2.1', oracle: 'esbuild', scope: ['lib', 'index.js'] },
  { id: 'preact', repo: 'preactjs/preact', ref: '10.29.8', oracle: 'esbuild', scope: ['src', 'hooks/src', 'compat/src', 'debug/src', 'devtools/src', 'jsx-runtime/src', 'test-utils/src'] },
  { id: 'ky', repo: 'sindresorhus/ky', ref: 'v2.1.0', oracle: 'esbuild', scope: ['source'] },
  { id: 'petite-vue', repo: 'vuejs/petite-vue', ref: 'v0.4.1', oracle: 'esbuild', scope: ['src'] },
  { id: 'flask', repo: 'pallets/flask', ref: '3.1.3', oracle: 'grimp', scope: ['src/flask'], pkg: 'flask', pyroot: 'src' },
  { id: 'gin', repo: 'gin-gonic/gin', ref: 'v1.12.0', oracle: 'golist', scope: ['.'] },
];

const sh = (cmd, args, cwd, opts = {}) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 << 20, ...opts });
const has = (cmd) => { try { execSync(cmd + ' --version', { stdio: 'ignore' }); return true; } catch { return false; } };
const posix = (p) => p.split(sep).join('/');
function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(posix(relative(base, p)));
  }
  return out;
}
const inScope = (c, p) => c.scope.some((s) => s === '.' || p === s || p.startsWith(s + '/'));

function checkout(c) {
  const dir = join(CACHE, c.id + '@' + c.ref);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(CACHE, { recursive: true }); rmSync(dir, { recursive: true, force: true });
    sh('git', ['clone', '-q', '--depth', '1', '--branch', c.ref, 'https://github.com/' + c.repo + '.git', dir], CACHE);
  }
  return dir;
}

// ---------------- CodeMap: krawędzie importów z mapy CLI ----------------
function codemapEdges(c, dir) {
  const map = join(CACHE, c.id + '.codemap.json');
  sh(process.execPath, [join(ROOT, 'cli/codemap.mjs'), 'analyze', dir, '--quiet', '--no-git', '--no-coverage', '--map', map], ROOT);
  const j = JSON.parse(readFileSync(map, 'utf8'));
  const type = new Map(j.nodes.map((n) => [n.id, n.type]));
  const edges = new Set();
  for (const e of j.edges) {
    if (e.type !== 'import' || type.get(e.source) !== 'file') continue;
    if (c.oracle === 'golist') {   // Go: plik → folder pakietu; poziom pakietów, bez testów
      if (/_test\.go$/.test(e.source) || !/\.go$/.test(e.source)) continue;
      const t = e.target === '__root__' ? '.' : type.get(e.target) === 'folder' ? e.target : type.get(e.target) === 'file' ? dirname(e.target) : null;
      if (t == null) continue;
      const s = dirname(e.source) === '.' ? '' : dirname(e.source), tt = t === '.' ? '' : t;
      if (s !== tt) edges.add(s + ' > ' + tt);
      continue;
    }
    if (type.get(e.target) !== 'file' || !inScope(c, e.source) || !inScope(c, e.target)) continue;
    if (e.typeOnly && c.oracle === 'esbuild') continue;   // `import type` esbuild usuwa z definicji — porównujemy to samo
    if (/\.d\.ts$/.test(e.source) || /\.d\.ts$/.test(e.target)) continue;
    edges.add(e.source + ' > ' + e.target);
  }
  return edges;
}

// ---------------- wyrocznie ----------------
async function esbuildEdges(c, dir) {
  const esbuild = await import('esbuild');
  const files = walk(dir).filter((p) => inScope(c, p) && /\.(m?[jt]sx?|cjs|cts|mts)$/.test(p) && !/\.d\.[cm]?ts$/.test(p));
  const r = await esbuild.build({
    entryPoints: files.map((f) => join(dir, f)), absWorkingDir: dir, bundle: true, write: false, metafile: true,
    packages: 'external', platform: 'node', format: 'esm', outdir: join(CACHE, '_out'), logLevel: 'silent',
    loader: { '.js': 'jsx' }, jsx: 'preserve', tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  }).catch((e) => ({ errors: e.errors || [e], metafile: null }));
  if (!r.metafile) throw new Error('esbuild: ' + ((r.errors[0] && (r.errors[0].text || r.errors[0].message)) || 'błąd'));
  const edges = new Set();
  for (const [p, info] of Object.entries(r.metafile.inputs)) {
    const s = posix(p); if (!inScope(c, s)) continue;
    for (const im of info.imports || []) {
      if (im.external || !im.path) continue;
      const t = posix(im.path); if (s !== t && inScope(c, t) && !/\.d\.ts$/.test(t)) edges.add(s + ' > ' + t);
    }
  }
  return edges;
}
function grimpEdges(c, dir) {
  const venv = join(CACHE, '.venv'), py = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(py)) { sh(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', venv], CACHE); sh(py, ['-m', 'pip', 'install', '-q', 'grimp'], CACHE); }
  const script = 'import grimp,sys,json\ng=grimp.build_graph(sys.argv[1], include_external_packages=False, cache_dir=None)\n' +
    'print(json.dumps([[m,i] for m in sorted(g.modules) for i in sorted(g.find_modules_directly_imported_by(m))]))';
  // podpakiety przestrzeni nazw (flask/sansio bez __init__.py) grimp pomija — na czas budowy grafu pusty __init__.py
  const pkgDir = join(dir, c.pyroot, ...c.pkg.split('.')), stubs = [];
  for (const p of walk(pkgDir)) if (p.endsWith('.py')) {
    const init = join(pkgDir, dirname(p), '__init__.py');
    if (!existsSync(init) && !stubs.includes(init)) { writeFileSync(init, ''); stubs.push(init); }
  }
  let pairs;
  try { pairs = JSON.parse(sh(py, ['-c', script, c.pkg], dir, { env: { ...process.env, PYTHONPATH: join(dir, c.pyroot) } })); }
  finally { for (const s of stubs) rmSync(s, { force: true }); }
  // moduł → plik: flask.app → src/flask/app.py albo src/flask/app/__init__.py
  const byMod = new Map();
  for (const p of walk(join(dir, c.pyroot))) if (p.endsWith('.py')) {
    const m = p.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/').join('.');
    byMod.set(m, posix(join(c.pyroot, p)));
  }
  const edges = new Set();
  for (const [a, b] of pairs) { const s = byMod.get(a), t = byMod.get(b); if (s && t && s !== t && inScope(c, s) && inScope(c, t)) edges.add(s + ' > ' + t); }
  return edges;
}
function golistEdges(c, dir) {
  const out = sh('go', ['list', '-e', '-json', './...'], dir);   // -e: brak pobranej zależności nie przerywa listy
  const pkgs = JSON.parse('[' + out.replace(/\}\s*\{/g, '},{') + ']');
  const byImport = new Map(pkgs.map((p) => [p.ImportPath, posix(relative(dir, p.Dir))]));
  const edges = new Set();
  for (const p of pkgs) { const s = byImport.get(p.ImportPath);
    for (const im of p.Imports || []) { const t = byImport.get(im); if (t != null && t !== s) edges.add(s + ' > ' + t); } }
  return edges;
}
const ORACLES = {
  esbuild: { available: () => true, edges: esbuildEdges },
  grimp: { available: () => has(process.platform === 'win32' ? 'python' : 'python3'), edges: grimpEdges },
  golist: { available: () => has('go'), edges: golistEdges },
};

// ---------------- porównanie ----------------
const results = [];
for (const c of CORPUS.filter((x) => !ONLY.length || ONLY.includes(x.id))) {
  const o = ORACLES[c.oracle];
  if (!o.available()) { console.log(`– ${c.id.padEnd(11)} pominięte — brak narzędzia wyroczni (${c.oracle})`); results.push({ id: c.id, skipped: c.oracle }); continue; }
  try {
    const dir = checkout(c);
    const cm = codemapEdges(c, dir), or = await o.edges(c, dir);
    const common = [...cm].filter((e) => or.has(e));
    const extra = [...cm].filter((e) => !or.has(e)).sort(), missing = [...or].filter((e) => !cm.has(e)).sort();
    const precision = cm.size ? common.length / cm.size : 1, recall = or.size ? common.length / or.size : 1;
    const r = { id: c.id, repo: c.repo, ref: c.ref, oracle: c.oracle, codemap: cm.size, oracleEdges: or.size, common: common.length,
      precision: +precision.toFixed(4), recall: +recall.toFixed(4), extra, missing };
    results.push(r);
    const pct = (x) => (x * 100).toFixed(1).padStart(5) + ' %';
    console.log(`${precision >= MIN_P && recall >= MIN_R ? '✔' : '✖'} ${c.id.padEnd(11)} ${c.oracle.padEnd(7)} CodeMap ${String(cm.size).padStart(4)} · wyrocznia ${String(or.size).padStart(4)} · wspólne ${String(common.length).padStart(4)} · precyzja ${pct(precision)} · kompletność ${pct(recall)}`);
    for (const e of extra.slice(0, SHOW)) console.log('     + nadmiarowa  ' + e);
    for (const e of missing.slice(0, SHOW)) console.log('     − brakująca   ' + e);
  } catch (e) { console.log(`✖ ${c.id.padEnd(11)} błąd: ${String(e && e.message || e).split('\n')[0].slice(0, 200)}`); results.push({ id: c.id, error: String(e && e.message || e) }); }
}
const done = results.filter((r) => r.codemap != null);
if (done.length) {
  const sum = (k) => done.reduce((a, r) => a + r[k], 0);
  console.log(`\nRazem: precyzja ${(sum('common') / Math.max(1, sum('codemap')) * 100).toFixed(1)} %, kompletność ${(sum('common') / Math.max(1, sum('oracleEdges')) * 100).toFixed(1)} % (${done.length} repozytoriów, ${sum('oracleEdges')} krawędzi wyroczni)`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
if (SUMMARY && process.env.GITHUB_STEP_SUMMARY) {
  const pc = (x) => (x * 100).toFixed(1) + ' %';
  const rows = results.map((r) => r.codemap != null
    ? `| ${r.id} | \`${r.ref}\` | ${r.oracle} | ${r.codemap} | ${r.oracleEdges} | ${pc(r.precision)} | ${pc(r.recall)} |`
    : `| ${r.id} | | ${r.skipped || ''} | — | — | ${r.error ? 'błąd' : 'pominięte'} | |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['### Korpus referencyjny — krawędzie importów CodeMap vs wyrocznia', '',
    '| repozytorium | wersja | wyrocznia | krawędzie CodeMap | krawędzie wyroczni | precyzja | kompletność |', '|---|---|---|--:|--:|--:|--:|', ...rows, ''].join('\n'));
}
const bad = results.filter((r) => r.error || (REQUIRE_ALL && r.skipped) || (r.codemap != null && (r.precision < MIN_P || r.recall < MIN_R)));
if (bad.length && (MIN_P || MIN_R || REQUIRE_ALL || bad.some((r) => r.error))) process.exit(1);
