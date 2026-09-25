// Bump wersji assetów (jedno polecenie zamiast trzech ręcznych edycji):
//   node tools/bump.mjs            → nowy stempel ?v=YYYYMMDD<litera> w index.html + CACHE vN+1 w sw.js
//   node tools/bump.mjs 1.2.0      → jak wyżej + CM.VERSION w js/util.js i "version" w package.json
// Stempel: dzisiejsza data; jeśli dzisiejszy stempel już istnieje, rośnie litera (a → b → c …).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');
const wr = (f, s) => writeFileSync(join(ROOT, f), s);
const version = process.argv[2];
if (version && !/^\d+\.\d+\.\d+$/.test(version)) { console.error('Wersja musi być semver, np. 1.2.0'); process.exit(1); }

// --- index.html: ?v=<stamp> ---
let html = rd('index.html');
const stamps = [...new Set([...html.matchAll(/\?v=([0-9]{8}[a-z]?)"/g)].map((m) => m[1]))];
if (stamps.length !== 1) { console.error(`Oczekiwano jednego stempla ?v= w index.html, znaleziono: ${stamps.join(', ') || 'brak'}`); process.exit(1); }
const old = stamps[0];
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
let next;
if (old.startsWith(today)) {
  const letter = old.slice(8) || '`';   // '`' + 1 = 'a'
  next = today + String.fromCharCode(letter.charCodeAt(0) + 1);
} else next = today + 'a';
const count = (html.match(new RegExp(`\\?v=${old}"`, 'g')) || []).length;
html = html.replaceAll(`?v=${old}"`, `?v=${next}"`);
wr('index.html', html);
console.log(`index.html: ?v=${old} → ?v=${next} (${count} odwołań)`);

// --- sw.js: CACHE = 'codemap-shell-vN' ---
let sw = rd('sw.js');
const m = sw.match(/const CACHE = 'codemap-shell-v(\d+)';/);
if (!m) { console.error('Nie znaleziono CACHE w sw.js'); process.exit(1); }
const n = Number(m[1]) + 1;
sw = sw.replace(m[0], `const CACHE = 'codemap-shell-v${n}';`);
wr('sw.js', sw);
console.log(`sw.js: codemap-shell-v${m[1]} → v${n}`);

// --- wersja aplikacji ---
if (version) {
  let util = rd('js/util.js');
  const vm = util.match(/CM\.VERSION = '([^']+)';/);
  if (!vm) { console.error('Nie znaleziono CM.VERSION w js/util.js'); process.exit(1); }
  util = util.replace(vm[0], `CM.VERSION = '${version}';`);
  wr('js/util.js', util);
  const pkgPath = 'package.json';
  const pkg = JSON.parse(rd(pkgPath));
  pkg.version = version;
  wr(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`CM.VERSION / package.json: ${vm[1]} → ${version}`);
  console.log('Pamiętaj o wpisie w CHANGELOG.md i tagu: git tag -a v' + version);
}
