import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM([...CORE, 'metrics']);
const { Graph } = CM.Graph;
const M = CM.Metrics;
const build = () => new Graph().build(FILES.map((f) => ({ ...f })), META);

describe('computeCoupling', () => {
  test('plik: Ca/Ce/I — src/lib/util.js ma Ca=2 (index, app), Ce=1 (app) → I=0.33', () => {
    const c = M.computeCoupling(build());
    assert.deepEqual(host(c.get('src/lib/util.js')), { ca: 2, ce: 1, instability: 0.33 });
    // index.js: Ce = app, lib/util, config, lazy, cjs (react = zewnętrzny, pomijany); Ca = index.html (reference)
    assert.deepEqual(host(c.get('src/index.js')), { ca: 1, ce: 5, instability: 0.83 });
    // liść bez klientów i bez zależności → brak sprzężeń → I=null
    assert.deepEqual(host(c.get('docs/arch.md')), { ca: 1, ce: 0, instability: 0 });
    assert.deepEqual(host(c.get('assets/logo.png')), { ca: 0, ce: 0, instability: null });
  });
  test('folder: agregacja po plikach potomnych, krawędzie wewnętrzne nie liczą się', () => {
    const c = M.computeCoupling(build());
    assert.deepEqual(host(c.get('src/lib')), { ca: 2, ce: 1, instability: 0.33 });
    // src: jedyne sprzężenie z zewnątrz to index.html → src/index.js (react pominięty)
    assert.deepEqual(host(c.get('src')), { ca: 1, ce: 0, instability: 0 });
    assert.deepEqual(host(c.get('src/store')), { ca: 1, ce: 0, instability: 0 });
    // pakiet Go = folder jako cel krawędzi: go/cmd zależy od go/pkg/util, folder go jest samowystarczalny
    assert.deepEqual(host(c.get('go/cmd')), { ca: 0, ce: 1, instability: 1 });
    assert.deepEqual(host(c.get('go/pkg/util')), { ca: 1, ce: 0, instability: 0 });
    assert.deepEqual(host(c.get('go/pkg')), { ca: 1, ce: 0, instability: 0 });
    assert.deepEqual(host(c.get('go')), { ca: 0, ce: 0, instability: null });
    // py/pkg: wszystkie importy wewnątrz pakietu
    assert.deepEqual(host(c.get('py/pkg')), { ca: 0, ce: 0, instability: null });
  });
  test('węzły syntetyczne i zewnętrzne pominięte; opts.externals dolicza pakiety do Ce', () => {
    const g = build();
    const c = M.computeCoupling(g);
    assert.ok(!c.has('__root__') && !c.has('__ext__') && !c.has('ext:react'));
    for (const n of g.nodes.values()) if (n.type === 'file' || (n.type === 'folder' && !n.external && n.id !== '__root__')) assert.ok(c.has(n.id), n.id);
    const cx = M.computeCoupling(g, { externals: true });
    assert.deepEqual(host(cx.get('src/index.js')), { ca: 1, ce: 6, instability: 0.86 });
    assert.deepEqual(host(cx.get('src')), { ca: 1, ce: 1, instability: 0.5 });
    assert.deepEqual(host(cx.get('src/lib/util.js')), host(c.get('src/lib/util.js')), 'files without external imports unchanged');
  });
  test('zduplikowane krawędzie liczone raz; couplingFor cache per graf', () => {
    const g = build();
    g.edges.push({ id: 'dupe', source: 'src/index.js', target: 'src/app.js', type: 'import' });
    assert.equal(M.computeCoupling(g).get('src/app.js').ca, 2);
    const a = M.couplingFor(g), b = M.couplingFor(g);
    assert.equal(a, b, 'same Map instance for the same graph object');
    assert.notEqual(M.couplingFor(build()), a);
    assert.equal(M.couplingFor(null).size, 0);
  });
});

// ---- duplikaty kodu (winnowing) ----
const BLOCK = [
  'export function parseConfig(raw, defaults) {',
  '  const out = Object.assign({}, defaults);',
  '  for (const line of raw.split("\\n")) {',
  '    const t = line.trim();',
  '    if (!t || t.startsWith("#")) continue;',
  '    const eq = t.indexOf("=");',
  '    if (eq < 0) throw new Error("bad line: " + t);',
  '    const key = t.slice(0, eq).trim();',
  '    const val = t.slice(eq + 1).trim();',
  '    out[key] = val === "true" ? true : val === "false" ? false : val;',
  '  }',
  '  return out;',
  '}',
];
// wypełniacze: realistyczny, RÓŻNY kod w każdym pliku (szablonowe linie dzieliłyby końcówki `) ; const`)
const FILL_A = [
  'import { readFile } from "node:fs/promises";', 'import path from "node:path";', '',
  'export async function loadManifest(dir) {', '  const file = path.join(dir, "manifest.json");',
  '  const text = await readFile(file, "utf8");', '  const json = JSON.parse(text);',
  '  if (!json.name) throw new Error("manifest without name");', '  return { name: json.name, version: json.version ?? "0.0.0" };', '}', '',
];
const FILL_B = [
  'export class Cache {', '  constructor(limit = 100) { this.limit = limit; this.map = new Map(); }',
  '  get(key) { const v = this.map.get(key); if (v !== undefined) { this.map.delete(key); this.map.set(key, v); } return v; }',
  '  set(key, value) { this.map.set(key, value); if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value); }',
  '  has(key) { return this.map.has(key); }', '  clear() { this.map.clear(); }', '  get size() { return this.map.size; }', '}', '', '',
];
const FILL_C = [
  'export function parseArgs(argv) {', '  const flags = { verbose: false, dry: false, files: [] };',
  '  for (let i = 2; i < argv.length; i++) {', '    switch (argv[i]) {', '      case "-v": flags.verbose = true; break;',
  '      case "--dry-run": flags.dry = true; break;', '      case "-o": flags.output = argv[++i]; break;',
  '      default: flags.files.push(argv[i]);', '    }', '  }', '  return flags;', '}', '',
  'export function usage() {', '  return ["usage: tool [-v] [--dry-run] [-o out] files...", "  -v  verbose", "  -o  output file"].join("\\n");', '}',
  'export const VERSION = "2.4.1";', 'export const AUTHORS = ["ann", "bob"];', 'let counter = 0;', 'export function next() { return ++counter; }',
];
const FILL_D = [
  'function unrelated(xs) {', '  let acc = 0;', '  for (let i = 0; i < xs.length; i++) acc += xs[i] * 2;', '  return acc;', '}',
  'const palette = ["#22d3ee", "#a78bfa", "#34d399", "#f59e0b"];', 'function pick(i) { return palette[i % palette.length]; }',
  'class Timer {', '  start() { this.t0 = performance.now(); }', '  stop() { return performance.now() - this.t0; }', '}',
  'export function debounce(fn, ms) {', '  let handle;', '  return (...args) => { clearTimeout(handle); handle = setTimeout(() => fn(...args), ms); };', '}',
  'export function chunk(arr, n) {', '  const out = [];', '  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));', '  return out;', '}',
  'export default { unrelated, pick, Timer, debounce, chunk };',
];
// szablonowe linie — TYLKO do testów doboru kandydatów (rozmiar/liczba linii), nie do parowania
const pad = (prefix, n) => Array.from({ length: n }, (_, i) => `const ${prefix}${i} = ${prefix}Value(${i}, "${prefix}-${i}");`);
const fileNode = (id, lines, lang = 'js') => ({ id, type: 'file', name: id.split('/').pop(), path: id, lang, langInfo: { text: true }, preview: lines.join('\n'), metrics: { lines: lines.length, longest: 80, chars: lines.join('\n').length } });

describe('findDuplicates', () => {
  test('dwa pliki z tym samym 12-liniowym blokiem → para; pliki różne → brak', () => {
    const a = fileNode('src/a.js', [...FILL_A, ...BLOCK]);
    const b = fileNode('src/b.js', [...FILL_B, ...BLOCK]);
    const c = fileNode('src/c.js', FILL_C);
    const d = fileNode('src/d.js', FILL_D);
    const pairs = M.findDuplicates([a, b, c, d]);
    assert.deepEqual(host(pairs.map((p) => [p.a, p.b])), [['src/a.js', 'src/b.js']]);
    assert.ok(pairs[0].shared >= 8, 'shared ' + pairs[0].shared);
    assert.equal(M.findDuplicates([a, c, d]).length, 0, 'no shared block → no pair');
    // ten sam blok z inną indentacją / białymi znakami — nadal ta sama para
    const b2 = fileNode('src/b2.js', [...FILL_B, ...BLOCK.map((l) => '\t' + l.replace(/ +/g, '  '))]);
    assert.deepEqual(host(M.findDuplicates([a, b2]).map((p) => [p.a, p.b])), [['src/a.js', 'src/b2.js']]);
  });
  test('kandydaci: tylko pliki tekstowe z preview ≥ minLines, bez minifikatów; próbka największych', () => {
    const short = fileNode('s.js', BLOCK);                                   // 13 linii < 20
    const long = fileNode('l.js', [...FILL_A, ...BLOCK]);
    const bin = { id: 'img.png', type: 'file', name: 'img.png', preview: null };
    const nontext = fileNode('t.bin', [...FILL_A, ...BLOCK]); nontext.langInfo = { text: false };
    const minified = fileNode('m.min.js', [...FILL_A, ...BLOCK]); minified.metrics.longest = 5000;
    const folder = { id: 'src', type: 'folder', name: 'src' };
    assert.deepEqual(host(M.duplicateCandidates([short, long, bin, nontext, minified, folder]).map((n) => n.id)), ['l.js']);
    const many = Array.from({ length: 6 }, (_, i) => fileNode('f' + i + '.js', pad('p' + i, 20 + i)));
    assert.deepEqual(host(M.duplicateCandidates(many, { maxFiles: 2 }).map((n) => n.id)), ['f5.js', 'f4.js'], 'largest previews are kept');
  });
  test('fingerprints: deterministyczne, gęstość ≈ 2/(w+1), szum interpunkcji i boilerplate pomijane', () => {
    const text = [...FILL_C, ...FILL_D, ...BLOCK].join('\n');
    const f1 = M.fingerprints(text), f2 = M.fingerprints(text);
    assert.deepEqual(host([...f1]), host([...f2]));
    // winnowing wybiera średnio 2/(w+1) k-gramów; unikalne odciski ≤ liczba k-gramów
    const grams = text.match(/[A-Za-z_$][\w$]*|\d[\w.]*|[^\s\w]/g).length - 4;
    assert.ok(f1.length > grams * 0.25 && f1.length < grams * 0.6, 'fingerprint count ' + f1.length + ' of ' + grams + ' k-grams');
    assert.equal(M.fingerprints('} ) ; } } ) ; } }').length, 0, 'punctuation-only k-grams are noise');
    assert.equal(M.fingerprints('a b').length, 0, 'shorter than k tokens');
    assert.equal(M.fingerprints('a b c d e').length, 1, 'exactly one k-gram');
    // hasz obecny w > maxBucket plikach nie tworzy par
    const clones = Array.from({ length: 4 }, (_, i) => fileNode('c' + i + '.js', [...FILL_D.slice(0, 8), ...BLOCK]));
    assert.equal(M.findDuplicates(clones, { maxBucket: 3 }).length, 0);
    assert.equal(M.findDuplicates(clones).length, 6, 'all 4 clones pair up (4 choose 2)');
    // pary posortowane po shared malejąco — pełne klony przed częściowym
    const BLOCK2 = BLOCK.map((l) => l.replace(/Config/g, 'Setup').replace(/defaults/g, 'base'));
    const full1 = fileNode('full1.js', [...FILL_A, ...BLOCK, ...BLOCK2]);
    const full2 = fileNode('full2.js', [...FILL_B, ...BLOCK, ...BLOCK2]);
    const part = fileNode('part.js', [...FILL_C.slice(0, 12), ...BLOCK]);
    const ps = M.findDuplicates([part, full2, full1]);
    assert.equal(ps[0].a, 'full1.js'); assert.equal(ps[0].b, 'full2.js');
    assert.ok(ps[0].shared > ps[1].shared);
  });
});
