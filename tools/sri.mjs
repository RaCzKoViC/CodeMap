// SRI dla plików z CDN, które da się przypiąć skrótem: web-tree-sitter (tree-sitter.js + tree-sitter.wasm) i gramatyki
// tree-sitter-wasms — statyczne, niezmienne pliki z npm (jsDelivr). Pobiera je, liczy SHA-384 i zapisuje manifest
// js/sri.js (CM.SRI: skróty + fetchVerified), którego używa graf symboli (symbols.js / symbols-worker.js).
// Pakiety „+esm" z esm.run (WebLLM, rough.js, php-wasm) NIE są tu przypinane: jsDelivr generuje je po swojej stronie
// i może przebudować — przypięty skrót wyłączyłby te funkcje bez zmiany w kodzie (są przypięte dokładną wersją).
//   node tools/sri.mjs            → zapisuje js/sri.js
//   node tools/sri.mjs --check    → porównuje z CDN, kod 1 przy różnicy (CI)
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const src = await readFile(join(ROOT, 'js/symbols.js'), 'utf8');
const LIB = /const LIB = '([^']+)'/.exec(src)[1], GRAM = /const GRAMMARS = '([^']+)'/.exec(src)[1];
const core = await readFile(join(ROOT, 'js/symbols-core.js'), 'utf8');
const block = /const GRAMMAR_OF = \{([\s\S]*?)\};/.exec(core)[1];
const grammars = [...new Set([...block.matchAll(/:'([\w]+)'/g)].map((m) => m[1]))].sort();
const urls = [LIB + 'tree-sitter.js', LIB + 'tree-sitter.wasm', ...grammars.map((g) => GRAM + 'tree-sitter-' + g + '.wasm')];

const hashes = {};
for (const u of urls) {
  const r = await fetch(u); if (!r.ok) { console.error('✖ ' + r.status + ' ' + u); process.exit(2); }
  const buf = Buffer.from(await r.arrayBuffer());
  hashes[u] = 'sha384-' + createHash('sha384').update(buf).digest('base64');
  console.log(hashes[u].slice(0, 20) + '…  ' + (buf.length / 1024).toFixed(0).padStart(5) + ' KB  ' + u.replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, ''));
}
const file = join(ROOT, 'js/sri.js');
if (process.argv.includes('--check')) {
  const cur = await readFile(file, 'utf8');
  const bad = Object.entries(hashes).filter(([u, h]) => !cur.includes(JSON.stringify(u) + ':' + JSON.stringify(h)));
  if (bad.length) { console.error('✖ skróty różnią się od js/sri.js: ' + bad.map(([u]) => u).join(', ')); process.exit(1); }
  console.log('✔ js/sri.js zgodny z CDN (' + urls.length + ' plików)'); process.exit(0);
}
const body = Object.entries(hashes).map(([u, h]) => '    ' + JSON.stringify(u) + ':' + JSON.stringify(h)).join(',\n');
await writeFile(file, `/* ===================== sri.js — przypięte skróty plików z CDN (GENEROWANE: node tools/sri.mjs) =====================
   Statyczne pliki npm z jsDelivr używane przez graf symboli (web-tree-sitter + gramatyki WASM). Kod i WASM są
   pobierane jako bajty, sprawdzane SHA-384 i dopiero wtedy wykonywane — podmieniony plik na CDN nie zostanie użyty.
   Działa w oknie i w workerze (self). CI: node tools/sri.mjs --check. */
(function(g){
  g.CM = g.CM || {};
  const HASHES = {
${body}
  };
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  // bajty pliku zgodne z przypiętym skrótem albo wyjątek (plik spoza listy też jest odrzucany)
  async function fetchVerified(url){
    const want = HASHES[url]; if (!want) throw new Error('SRI: brak przypiętego skrótu dla ' + url);
    const r = await fetch(url, {credentials:'omit'}); if (!r.ok) throw new Error('CDN ' + r.status + ': ' + url);
    const buf = await r.arrayBuffer();
    const got = 'sha384-' + b64(await crypto.subtle.digest('SHA-384', buf));
    if (got !== want) throw new Error('SRI: plik z CDN nie zgadza się z przypiętym skrótem — ' + url.split('/').slice(-2).join('/'));
    return buf;
  }
  g.CM.SRI = { HASHES, integrity:(url)=>HASHES[url]||'', fetchVerified };
})(typeof self !== 'undefined' ? self : window);
`);
console.log('✔ js/sri.js — ' + urls.length + ' plików');
