// Kopiuje z korzenia repozytorium to, czego rozszerzenie potrzebuje w paczce (katalogi generowane, w .gitignore):
//   app/  ← index.html, css/, js/, images/ (jeśli jest), icon-192.png — aplikacja w panelu webview
//   cli/  ← cli/*.mjs — analiza headless (analyzeProject) w wątku roboczym
//   LICENSE
// cli/runtime.mjs ładuje moduły z <ROOT>/js, gdzie ROOT = katalog nad cli/. W paczce moduły leżą w app/js,
// więc w KOPII runtime.mjs ROOT wskazuje na ../app (jedna podmiana, sprawdzana — zmiana definicji ROOT w CLI
// przerywa bundle zamiast dać paczkę, która nie działa). Po kopii: każdy względny src/href z app/index.html
// musi istnieć w app/, a index.html musi ładować js/vscode-bridge.js.
//   node scripts/bundle.mjs [--out KATALOG] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webview from '../src/webview.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(HERE, '..');
export const REPO = path.resolve(EXT_DIR, '..', '..');

const ROOT_RE = /^export const ROOT = path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\);(?=\r?$)/m;
const ROOT_NEW = "export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');   // bundle.mjs: moduły js/ w app/";

function copyDir(src, dst, filter = () => true) {
  let n = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyDir(s, d, filter);
    else if (e.isFile() && filter(e.name)) { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

/** Względne adresy src/href z index.html (bez zapytania i kotwicy), poza linkami PWA usuwanymi w webview. */
export function localRefs(html) {
  const out = [];
  for (const m of html.replace(webview.DROP_LINKS, '').matchAll(/\s(?:src|href)="([^"]*)"/gi)) {
    const v = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|$)/i.test(v)) continue;
    out.push(v.replace(/[?#].*$/, ''));
  }
  return out;
}

/** @returns {{out:string, files:number}} */
export function bundle({ out = EXT_DIR, repo = REPO } = {}) {
  const app = path.join(out, 'app'), cli = path.join(out, 'cli');
  for (const d of [app, cli]) fs.rmSync(d, { recursive: true, force: true });
  let files = 0;
  fs.mkdirSync(app, { recursive: true });
  fs.copyFileSync(path.join(repo, 'index.html'), path.join(app, 'index.html')); files++;
  files += copyDir(path.join(repo, 'css'), path.join(app, 'css'));
  files += copyDir(path.join(repo, 'js'), path.join(app, 'js'), (n) => n.endsWith('.js'));
  if (fs.existsSync(path.join(repo, 'images'))) files += copyDir(path.join(repo, 'images'), path.join(app, 'images'));
  fs.copyFileSync(path.join(repo, 'icon-192.png'), path.join(app, 'icon-192.png')); files++;
  files += copyDir(path.join(repo, 'cli'), cli, (n) => n.endsWith('.mjs'));
  fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(out, 'LICENSE')); files++;

  const rt = path.join(cli, 'runtime.mjs');
  const src = fs.readFileSync(rt, 'utf8');
  if (!ROOT_RE.test(src)) throw new Error('bundle: cli/runtime.mjs — nie znaleziono definicji ROOT do podmiany; zaktualizuj scripts/bundle.mjs');
  fs.writeFileSync(rt, src.replace(ROOT_RE, ROOT_NEW));

  const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  const missing = localRefs(html).filter((r) => !fs.existsSync(path.join(app, ...r.split('/'))));
  if (missing.length) throw new Error('bundle: brak plików z index.html w app/: ' + missing.join(', '));
  if (!localRefs(html).includes('js/vscode-bridge.js')) throw new Error('bundle: index.html nie ładuje js/vscode-bridge.js');
  return { out, files };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : EXT_DIR;
  try {
    const r = bundle({ out });
    if (!args.includes('--quiet')) console.log(`✔ bundle: ${r.files} plików → ${path.relative(process.cwd(), path.join(r.out, 'app')) || '.'} + cli/`);
  } catch (e) {
    console.error('✖ ' + e.message);
    process.exitCode = 1;
  }
}
