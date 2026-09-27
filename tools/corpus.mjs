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
// deadcode: nieużywane eksporty (CM.DeadCode) porównane z knip — tylko ESM (knip nie widzi użycia `require('x').y`)
export const CORPUS = [
  { id: 'express', repo: 'expressjs/express', ref: 'v5.2.1', oracle: 'esbuild', scope: ['lib', 'index.js'] },
  { id: 'preact', repo: 'preactjs/preact', ref: '10.29.8', oracle: 'esbuild', deadcode: true, scope: ['src', 'hooks/src', 'compat/src', 'debug/src', 'devtools/src', 'jsx-runtime/src', 'test-utils/src'] },
  { id: 'ky', repo: 'sindresorhus/ky', ref: 'v2.1.0', oracle: 'esbuild', deadcode: true, scope: ['source'] },
  { id: 'petite-vue', repo: 'vuejs/petite-vue', ref: 'v0.4.1', oracle: 'esbuild', deadcode: true, scope: ['src'] },
  { id: 'flask', repo: 'pallets/flask', ref: '3.1.3', oracle: 'grimp', scope: ['src/flask'], pkg: 'flask', pyroot: 'src' },
  { id: 'gin', repo: 'gin-gonic/gin', ref: 'v1.12.0', oracle: 'golist', scope: ['.'] },
  // monorepo pnpm (13 pakietów, zagnieżdżone utils/runtime, importy po nazwie przez `paths` z tsconfig): także poziom pakietów
  { id: 'signals', repo: 'preactjs/signals', ref: '@preact/signals@2.9.4', oracle: 'esbuild', tsconfig: 'tsconfig.json', workspaces: true, deadcode: true,
    scope: ['core', 'debug', 'devtools-adapter', 'devtools-ui', 'eslint-plugin-signals', 'preact', 'preact/utils', 'preact-transform',
      'react', 'react/runtime', 'react/utils', 'react-transform', 'vite-plugin'].map((p) => 'packages/' + p + '/src') },
];

const sh = (cmd, args, cwd, opts = {}) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 << 20, ...opts });
const has = (cmd, ver = '--version') => { try { execSync(cmd + ' ' + ver, { stdio: 'ignore' }); return true; } catch { return false; } };
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
  const dir = join(CACHE, c.id + '@' + c.ref.replace(/[/@]/g, '_'));   // tagi monorepo: „@scope/pkg@1.2.3"
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
  c._map = j;   // poziom pakietów (codemapPkgEdges) czyta tę samą mapę
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
  // tsconfigRaw zastępuje tsconfig.json repozytorium — aliasy `paths` (monorepo: nazwa pakietu → jego src) trzeba przenieść
  const co = { verbatimModuleSyntax: true };
  if (c.tsconfig) { const t = JSON.parse(readFileSync(join(dir, c.tsconfig), 'utf8')).compilerOptions || {}; if (t.paths) co.paths = t.paths; if (t.baseUrl) co.baseUrl = t.baseUrl; }
  const r = await esbuild.build({
    entryPoints: files.map((f) => join(dir, f)), absWorkingDir: dir, bundle: true, write: false, metafile: true,
    packages: 'external', platform: 'node', format: 'esm', outdir: join(CACHE, '_out'), logLevel: 'silent',
    loader: { '.js': 'jsx' }, jsx: 'preserve', tsconfigRaw: { compilerOptions: co },
  }).catch((e) => ({ errors: e.errors || [e], metafile: null }));
  if (!r.metafile) throw new Error('esbuild: ' + ((r.errors[0] && (r.errors[0].text || r.errors[0].message)) || 'błąd'));
  c._meta = r.metafile;   // poziom pakietów (esbuildPkgEdges): także importy zewnętrzne po nazwie
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
// ---------------- poziom pakietów (monorepo): pakiet A zależy od B, gdy plik z A importuje plik albo nazwę B ----------------
const pkgOf = (pkgs, p) => { let best = null; for (const k of pkgs) if ((k.dir === '' || p === k.dir || p.startsWith(k.dir + '/')) && (!best || k.dir.length > best.dir.length)) best = k; return best && best.name; };
function codemapPkgEdges(c) {   // pakiety wykryte przez CodeMap (graph.packages w mapie), krawędzie plik → plik / folder pakietu
  const j = c._map, type = new Map(j.nodes.map((n) => [n.id, n.type])), pkgs = (j.packages || []).filter((p) => p.eco === 'npm');
  const edges = new Set();
  for (const e of j.edges) {
    const tt = type.get(e.target);
    if (e.type !== 'import' || type.get(e.source) !== 'file' || !inScope(c, e.source) || e.typeOnly || (tt !== 'file' && tt !== 'folder') || /\.d\.ts$/.test(e.target)) continue;
    const a = pkgOf(pkgs, e.source), b = pkgOf(pkgs, e.target === '__root__' ? '' : e.target);
    if (a && b && a !== b) edges.add(a + ' > ' + b);
  }
  return { edges, packages: pkgs.map((p) => p.name) };
}
function esbuildPkgEdges(c, dir) {   // pakiety z plików package.json (niezależnie od CodeMap), importy z metafile esbuilda
  const pkgs = [];
  for (const p of walk(dir)) if ((p === 'package.json' || p.endsWith('/package.json')) && !/(^|\/)(test|tests|__tests__|fixtures|dist)\//.test(p)) {
    try { const j = JSON.parse(readFileSync(join(dir, p), 'utf8')); if (j.name) pkgs.push({ name: j.name, dir: p === 'package.json' ? '' : p.slice(0, -13) }); } catch { /* uszkodzony manifest — pominięty */ }
  }
  const names = new Set(pkgs.map((p) => p.name)), edges = new Set();
  const nameOf = (s) => s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/');
  for (const [p, info] of Object.entries(c._meta.inputs)) {
    const s = posix(p); if (!inScope(c, s)) continue;
    const a = pkgOf(pkgs, s);
    for (const im of info.imports || []) {
      if (!im.path) continue;
      const b = im.external ? (names.has(nameOf(im.path)) ? nameOf(im.path) : null) : /\.d\.ts$/.test(im.path) ? null : pkgOf(pkgs, posix(im.path));
      if (a && b && a !== b) edges.add(a + ' > ' + b);
    }
  }
  return { edges, packages: pkgs.map((p) => p.name) };
}
// ---------------- martwy kod: nieużywane eksporty CodeMap (CM.DeadCode) vs knip ----------------
// Obie strony z tymi samymi wejściami: wejścia pakietów wg CodeMap + pliki kodu, których nikt nie importuje (skrypty,
// konfiguracje) + testy — knip przechodzi graf od wejść, CodeMap liczy użycie z każdego importującego. Pluginy knipa
// wykonujące pliki konfiguracyjne (vite, vitest…) wyłączone — bez node_modules nie wstaną; monorepo = config per workspace.
const KNIP = { knip: '6.38.0', typescript: '7.0.2' };
const KNIP_OFF = ['vite', 'vitest', 'rollup', 'webpack', 'jest', 'babel', 'eslint', 'prettier', 'playwright', 'storybook', 'mocha', 'ava',
  'karma', 'tsup', 'nx', 'typescript', 'github-actions', 'husky', 'lint-staged', 'size-limit', 'xo'];
function knipBin() {
  const tools = join(CACHE, '_tools'), pkg = join(tools, 'node_modules/knip/package.json');
  const ver = () => { try { return JSON.parse(readFileSync(pkg, 'utf8')).version; } catch { return null; } };
  if (ver() !== KNIP.knip) {
    mkdirSync(tools, { recursive: true });
    if (!existsSync(join(tools, 'package.json'))) writeFileSync(join(tools, 'package.json'), '{ "private": true }');
    execSync('npm i --no-audit --no-fund --silent ' + Object.entries(KNIP).map(([k, v]) => k + '@' + v).join(' '), { cwd: tools, stdio: 'ignore' });
  }
  return join(tools, 'node_modules/knip/bin/knip.js');
}
async function deadcodeSets(c, dir) {
  const { runAnalysis } = await import('file:///' + join(ROOT, 'cli/analyze.mjs').replace(/\\/g, '/'));
  const r = await runAnalysis(dir, { git: false, coverage: false, lang: 'en' });
  const CM = r.CM, g = r.graph, entries = [...CM.DeadCode.entryFiles(g)];
  const hasIn = new Set(g.edges.filter((e) => e.type === 'import').map((e) => e.target));
  for (const n of g.nodes.values()) if (n.type === 'file' && /\.(m?[jt]sx?|c[jt]s)$/.test(n.path) && !/\.d\.[cm]?ts$/.test(n.path)
    && (!hasIn.has(n.id) || n.isTest) && !entries.includes(n.path)) entries.push(n.path);
  const cm = new Set();
  for (const d of CM.DeadCode.analyze(g)) if (inScope(c, d.path)) for (const x of d.exports) cm.add(d.path + ' # ' + x.name);
  const ws = (entry) => ({ entry, project: ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'], ...Object.fromEntries(KNIP_OFF.map((p) => [p, false])) });
  let cfg = ws(entries);
  if (c.workspaces) {   // knip: każdy pakiet workspace'u to osobny workspace — wejścia muszą trafić do właściwego
    const dirs = (g.packages || []).filter((p) => p.eco === 'npm' && p.dir).map((p) => p.dir).sort((a, b) => b.length - a.length);
    const w = { '.': ws([]) }; for (const d of dirs) w[d] = ws([]);
    for (const e of entries) { const d = dirs.find((x) => e.startsWith(x + '/')); w[d || '.'].entry.push(d ? e.slice(d.length + 1) : e); }
    cfg = { workspaces: w };
  }
  const file = join(CACHE, c.id + '.knip.json'); writeFileSync(file, JSON.stringify(cfg, null, 1));
  const out = sh(process.execPath, [knipBin(), '--config', file, '--include', 'exports,types,nsExports,nsTypes', '--reporter', 'json', '--no-progress', '--no-exit-code'], dir);
  const kn = new Set();
  for (const is of JSON.parse(out).issues) if (inScope(c, is.file) && !entries.includes(is.file))
    for (const k of ['exports', 'types', 'nsExports', 'nsTypes']) for (const x of is[k] || []) kn.add(is.file + ' # ' + x.name);
  return { cm, kn, entries: entries.filter((e) => inScope(c, e)).length };
}

const compare = (cm, or) => {
  const common = [...cm].filter((e) => or.has(e));
  return { common: common.length, precision: cm.size ? common.length / cm.size : 1, recall: or.size ? common.length / or.size : 1,
    extra: [...cm].filter((e) => !or.has(e)).sort(), missing: [...or].filter((e) => !cm.has(e)).sort() };
};

const ORACLES = {
  esbuild: { available: () => true, edges: esbuildEdges },
  grimp: { available: () => has(process.platform === 'win32' ? 'python' : 'python3'), edges: grimpEdges },
  golist: { available: () => has('go', 'version'), edges: golistEdges },
};

// ---------------- porównanie ----------------
const results = [];
for (const c of CORPUS.filter((x) => !ONLY.length || ONLY.includes(x.id))) {
  const o = ORACLES[c.oracle];
  if (!o.available()) { console.log(`– ${c.id.padEnd(11)} pominięte — brak narzędzia wyroczni (${c.oracle})`); results.push({ id: c.id, skipped: c.oracle }); continue; }
  try {
    const dir = checkout(c);
    const cm = codemapEdges(c, dir), or = await o.edges(c, dir);
    const { common, precision, recall, extra, missing } = compare(cm, or);
    const r = { id: c.id, repo: c.repo, ref: c.ref, oracle: c.oracle, codemap: cm.size, oracleEdges: or.size, common,
      precision: +precision.toFixed(4), recall: +recall.toFixed(4), extra, missing };
    results.push(r);
    const pct = (x) => (x * 100).toFixed(1).padStart(5) + ' %';
    const line = (ok, label, a, b, n, p, rc) => console.log(`${ok ? '✔' : '✖'} ${label.padEnd(11)} ${c.oracle.padEnd(7)} CodeMap ${String(a).padStart(4)} · wyrocznia ${String(b).padStart(4)} · wspólne ${String(n).padStart(4)} · precyzja ${pct(p)} · kompletność ${pct(rc)}`);
    const diffs = (x, m) => { for (const e of x.slice(0, SHOW)) console.log('     + nadmiarowa  ' + e); for (const e of m.slice(0, SHOW)) console.log('     − brakująca   ' + e); };
    line(precision >= MIN_P && recall >= MIN_R, c.id, cm.size, or.size, common, precision, recall);
    diffs(extra, missing);
    if (c.workspaces) {   // monorepo: krawędzie między pakietami (macierz zależności) i sama lista pakietów
      const pc = codemapPkgEdges(c), po = esbuildPkgEdges(c, dir), k = compare(pc.edges, po.edges);
      const lost = po.packages.filter((n) => !pc.packages.includes(n)).sort(), extraPk = pc.packages.filter((n) => !po.packages.includes(n)).sort();
      r.packages = { codemap: pc.edges.size, oracleEdges: po.edges.size, common: k.common, precision: +k.precision.toFixed(4), recall: +k.recall.toFixed(4),
        extra: k.extra, missing: k.missing, found: pc.packages.length, expected: po.packages.length, lostPackages: lost, extraPackages: extraPk };
      line(k.precision >= MIN_P && k.recall >= MIN_R && !lost.length && !extraPk.length, '  pakiety', pc.edges.size, po.edges.size, k.common, k.precision, k.recall);
      console.log(`     pakiety: CodeMap ${pc.packages.length}, package.json ${po.packages.length}` + (lost.length ? ' · brak: ' + lost.join(', ') : '') + (extraPk.length ? ' · nadmiarowe: ' + extraPk.join(', ') : ''));
      diffs(k.extra, k.missing);
    }
    if (c.deadcode) {   // nieużywane eksporty: CM.DeadCode vs knip (te same wejścia)
      try {
        const d = await deadcodeSets(c, dir), k = compare(d.cm, d.kn);
        r.deadcode = { codemap: d.cm.size, oracleEdges: d.kn.size, common: k.common, precision: +k.precision.toFixed(4), recall: +k.recall.toFixed(4), extra: k.extra, missing: k.missing, entries: d.entries };
        const label = '  martwy kod';
        console.log(`${k.precision >= MIN_P && k.recall >= MIN_R ? '✔' : '✖'} ${label.padEnd(11)} knip    CodeMap ${String(d.cm.size).padStart(4)} · wyrocznia ${String(d.kn.size).padStart(4)} · wspólne ${String(k.common).padStart(4)} · precyzja ${pct(k.precision)} · kompletność ${pct(k.recall)}`);
        diffs(k.extra, k.missing);
      } catch (e) { r.deadcode = { error: String((e && e.message) || e).split('\n')[0].slice(0, 300) }; console.log(`✖   martwy kod  błąd: ${r.deadcode.error}`); }
    }
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
  const rows = results.flatMap((r) => r.codemap != null
    ? [`| ${r.id} | \`${r.ref}\` | ${r.oracle} | ${r.codemap} | ${r.oracleEdges} | ${pc(r.precision)} | ${pc(r.recall)} |`,
      ...(r.packages ? [`| ${r.id} — pakiety (${r.packages.found}/${r.packages.expected}) | | package.json + esbuild | ${r.packages.codemap} | ${r.packages.oracleEdges} | ${pc(r.packages.precision)} | ${pc(r.packages.recall)} |`] : []),
      ...(r.deadcode ? [r.deadcode.error ? `| ${r.id} — nieużywane eksporty | | knip ${KNIP.knip} | — | — | błąd | |`
        : `| ${r.id} — nieużywane eksporty | | knip ${KNIP.knip} | ${r.deadcode.codemap} | ${r.deadcode.oracleEdges} | ${pc(r.deadcode.precision)} | ${pc(r.deadcode.recall)} |`] : [])]
    : [`| ${r.id} | | ${r.skipped || ''} | — | — | ${r.error ? 'błąd' : 'pominięte'} | |`]);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['### Korpus referencyjny — krawędzie importów CodeMap vs wyrocznia', '',
    '| repozytorium | wersja | wyrocznia | krawędzie CodeMap | krawędzie wyroczni | precyzja | kompletność |', '|---|---|---|--:|--:|--:|--:|', ...rows, ''].join('\n'));
}
const pkBad = (k) => !!k && (k.precision < MIN_P || k.recall < MIN_R || (MIN_P > 0 && (k.lostPackages.length || k.extraPackages.length)));
const dcBad = (d) => !!d && (!!d.error || d.precision < MIN_P || d.recall < MIN_R);
const bad = results.filter((r) => r.error || (REQUIRE_ALL && r.skipped) || (r.codemap != null && (r.precision < MIN_P || r.recall < MIN_R || pkBad(r.packages) || dcBad(r.deadcode))));
if (bad.length && (MIN_P || MIN_R || REQUIRE_ALL || bad.some((r) => r.error))) process.exit(1);
