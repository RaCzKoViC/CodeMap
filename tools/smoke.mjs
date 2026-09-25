// Smoke test w prawdziwej przeglądarce (headless Chrome przez CDP, bez Playwrighta):
// serwuje repo lokalnie, otwiera index.html#demo, czeka aż mapa się zbuduje i sprawdza:
// liczbę węzłów, brak wyjątków JS, brak błędów konsoli (poza oczekiwanym 404 na /api/auth/me).
//   node tools/smoke.mjs            (CHROME=ścieżka/do/chrome, gdy autodetekcja zawiedzie)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const CANDIDATES = [process.env.CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const CHROME = CANDIDATES.find((p) => existsSync(p));
if (!CHROME) { console.error('✖ Nie znaleziono Chrome/Chromium — ustaw CHROME=<ścieżka>'); process.exit(2); }

// --- statyczny serwer tylko dla frontendu ---
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || /[\\/](server|Sejf|\.git|node_modules)[\\/]/.test(file)) { res.writeHead(404); return res.end(); }
  try { const data = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// --- headless Chrome + CDP ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = await mkdtemp(join(tmpdir(), 'codemap-smoke-'));
const dbg = 9222 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, '--window-size=1400,900',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(250); } }
if (!targets) { console.error('✖ Chrome nie odpowiada na CDP'); cleanup(2); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map(); const errors = []; const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/\/api\//.test(m.params.entry.url || '')) errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html#demo` });
let nodes = 0;
for (let i = 0; i < 60; i++) { nodes = await evalJs('window.CMApp && CMApp.graph ? CMApp.graph.nodes.size : 0'); if (nodes > 1) break; await sleep(250); }
await sleep(1500);
const status = await evalJs("(document.querySelector('#st-nodes')||{}).textContent || ''");
const version = await evalJs('window.CM_VERSION');
const sw = await evalJs("'serviceWorker' in navigator");
const canvasOk = await evalJs("(function(){ const c=document.getElementById('map-canvas'); return !!c && c.width>0 && c.height>0; })()");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? '✔' : '✖'} ${msg}`); if (!ok) failed++; };
check(nodes >= 28, `demo zbudowane: ${nodes} węzłów (oczekiwane ≥ 28)${status ? ` — pasek stanu: ${status}` : ''}`);
check(canvasOk, 'canvas mapy ma rozmiar');
check(/^\d+\.\d+\.\d+$/.test(version || ''), `CM_VERSION = ${version}`);
check(sw, 'API service workera dostępne');
check(exceptions.length === 0, `wyjątki JS: ${exceptions.length}${exceptions.length ? '\n   ' + exceptions.join('\n   ') : ''}`);
check(errors.length === 0, `błędy konsoli: ${errors.length}${errors.length ? '\n   ' + errors.join('\n   ') : ''}`);
cleanup(failed ? 1 : 0);

async function cleanup(code) {
  try { ws.close(); } catch {}
  chrome.kill(); server.close();
  await sleep(300);
  await rm(prof, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}
