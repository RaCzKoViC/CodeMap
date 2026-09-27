// Wspólne dla smoke.mjs i screenshots.mjs: statyczny serwer frontendu + headless Chrome sterowany przez CDP
// (bez Playwrighta i bez zależności npm). Serwer nie wydaje backendu, Sejfu, .git ani node_modules.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const CANDIDATES = [process.env.CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);

export function findChrome() { return CANDIDATES.find((p) => existsSync(p)) || null; }

/**
 * Serwer + Chrome + WebSocket CDP. Zwraca {port, url(path), send, evalJs (wynik albo undefined przy wyjątku),
 * js (rzuca przy wyjątku), errors, exceptions (zbierane z konsoli / Runtime / Log), close()}.
 * opts: {width, height, prefix (katalog profilu), apiErrorsIgnored (404 na /api/* nie liczy się jako błąd)}
 */
export async function startBrowser(opts = {}) {
  const CHROME = findChrome();
  if (!CHROME) throw new Error('Nie znaleziono Chrome/Chromium — ustaw CHROME=<ścieżka>');
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT) || /[\\/](server|Sejf|\.git|node_modules|\.claude)[\\/]/.test(file)) { res.writeHead(404); return res.end(); }
    try { const data = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const prof = await mkdtemp(join(tmpdir(), opts.prefix || 'codemap-cdp-'));
  const dbg = 9222 + Math.floor(Math.random() * 700);
  const W = opts.width || 1400, H = opts.height || 900;
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
  const close = async () => { try { ws && ws.close(); } catch { /* ignore */ } chrome.kill(); server.close(); await sleep(300); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
  let targets = null, ws = null;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(250); } }
  if (!targets) { await close(); throw new Error('Chrome nie odpowiada na CDP'); }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), errors = [], exceptions = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !(opts.apiErrorsIgnored !== false && /\/api\//.test(m.params.entry.url || ''))) errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  if (opts.width) await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return { port, url: (p) => `http://127.0.0.1:${port}/${String(p || '').replace(/^\//, '')}`, send, evalJs, js, errors, exceptions, close };
}
