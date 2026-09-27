// Zrzuty ekranu do README (docs/screenshot-*.png) w headless Chrome przez CDP — powtarzalnie, z tego
// samego kodu co aplikacja: wczytuje repozytorium SAMEGO CodeMap jako projekt (prawdziwe pliki z dysku),
// a potem ustawia widoki: mapa projektu, graf symboli (tree-sitter), ChatBot z menu narzędzi „/" oraz
// historia git czytana z lokalnego katalogu .git (git-local.js) — nakładka częstości zmian + oś czasu.
//   node tools/screenshots.mjs            (CHROME=ścieżka/do/chrome, gdy autodetekcja zawiedzie)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(ROOT, 'docs');
const W = 1600, H = 900;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const CHROME = [process.env.CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) { console.error('✖ Nie znaleziono Chrome'); process.exit(2); }

// ---- pliki repozytorium jako projekt (bez zależności, danych, obrazów i historii) ----
const SKIP_DIR = new Set(['node_modules', '.git', 'Sejf', 'data', '_site', '.claude']);
const TEXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.md', '.json', '.webmanifest', '.py', '.ps1', '.sh', '.sql', '.yml', '.yaml', '.service', '']);
async function collect(dir, out) {
  for (const name of await readdir(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name); const st = await stat(p);
    if (st.isDirectory()) { await collect(p, out); continue; }
    const rel = relative(ROOT, p).split(sep).join('/');
    const ext = extname(name).toLowerCase();
    const text = TEXT.has(ext) && st.size < 600 * 1024 && !/package-lock\.json$/.test(rel);
    out.push({ path: 'CodeMap/' + rel, size: st.size, mtime: st.mtimeMs, content: text ? await readFile(p, 'utf8') : null });
  }
  return out;
}
const files = await collect(ROOT, []);
// katalog .git jako „pliki boczne" (ścieżki względem .git) — przekazywany do strony jako base64
async function collectGit(dir, rel, out) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name), st = await stat(p), r = rel ? rel + '/' + name : name;
    if (st.isDirectory()) { if (name !== 'logs' && name !== 'hooks') await collectGit(p, r, out); }
    else if (!/\.lock$/.test(name)) out.push({ path: r, b64: (await readFile(p)).toString('base64') });
  }
  return out;
}
const gitFiles = existsSync(join(ROOT, '.git')) && (await stat(join(ROOT, '.git'))).isDirectory() ? await collectGit(join(ROOT, '.git'), '', []) : [];

// ---- serwer statyczny + Chrome ----
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || /[\\/](server|Sejf|\.git|node_modules)[\\/]/.test(file)) { res.writeHead(404); return res.end(); }
  try { const d = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(d); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = await mkdtemp(join(tmpdir(), 'codemap-shots-'));
const dbg = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(250); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { await js("document.querySelectorAll('#toast-wrap .toast').forEach(t=>t.remove())"); await sleep(150);
  const r = await send('Page.captureScreenshot', { format: 'png' }); const buf = Buffer.from(r.result.data, 'base64'); await writeFile(join(OUT, name), buf); console.log(`✔ docs/${name} (${Math.round(buf.length / 1024)} KB)`); };

try {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html` });
  for (let i = 0; i < 60; i++) { if (await js('!!(window.CMApp && CM.App && CM.App.filters)')) break; await sleep(200); }
  await sleep(800);

  // ---- 1. mapa repozytorium CodeMap (upakowane koła), panel szczegółów folderu js ----
  await js(`(async()=>{ const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    await CMApp.loadFiles(${JSON.stringify(files)}, {name:'CodeMap', source:'github.com/RaCzKoViC/CodeMap'});
    for(let i=0;i<80;i++){ if(CMApp.graph.nodes.size>50) break; await sleep(100); }
    CMApp.exec('setFilter',{externals:true}); CMApp.exec('setLayout',{layout:'force'}); await sleep(5000);   // fizyka osiada
    CMApp.exec('togglePanel',{side:'right',open:false}); await sleep(500);
    CMApp.renderer().fit(); await sleep(600); return CMApp.graph.nodes.size; })()`);
  await sleep(600);
  await shot('screenshot-map.png');

  // ---- 2. graf symboli (tree-sitter): kilka plików rozwiniętych, zaznaczony symbol z wywołaniami ----
  const sym = await js(`(async()=>{ const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const A=CM.App;
    CMApp.exec('togglePanel',{side:'right',open:true}); CMApp.exec('setFilter',{externals:false}); CMApp.exec('symbols',{on:true});
    for(let i=0;i<120;i++){ if(CMApp.graph.symbolsInfo || CM.Symbols.state().status==='error') break; await sleep(500); }
    if(!CMApp.graph.symbolsInfo) return 'symbols: '+JSON.stringify(CM.Symbols.state());
    CMApp.exec('setLayout',{layout:'force'}); await sleep(300);
    for(const f of ['CodeMap/js/symbols-core.js']){ const n=CMApp.graph.nodes.get(f); if(n&&n.symbolCount&&n.collapsed) A.toggleCollapse(n); }
    await sleep(5000);   // fizyka osiada
    const inCore=[...CMApp.graph.nodes.values()].filter(n=>n.type==='symbol'&&n.parent==='CodeMap/js/symbols-core.js');
    const pick=['extract','analyzeBatch','defOf','resolveCalls'].map(nm=>inCore.find(n=>n.name===nm)).find(Boolean)||inCore[0];
    if(pick){ CMApp.focusNode(pick.id); await sleep(700); const R=CMApp.renderer(); const f=CMApp.graph.nodes.get(pick.parent);
      R.cam.zoom=2.3; R.centerOn(f||pick); R.kick(); await sleep(700); }
    return JSON.stringify(CMApp.graph.symbolsInfo)+' '+(pick&&pick.name); })()`);
  console.log('  symbole:', sym);
  await shot('screenshot-symbols.png');

  // ---- 3. ChatBot: statystyki projektu z /stats + otwarte menu narzędzi „/" ----
  await js(`(async()=>{ const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    CMApp.exec('symbols',{on:false}); CMApp.exec('setLayout',{layout:'pack'}); await sleep(900); CMApp.renderer().fit(); await sleep(300);
    CM.App.select(null);
    CM.ChatBot.open(); await sleep(600);
    const panel=document.getElementById('cb-panel');
    Object.assign(panel.style,{left:'700px', top:'128px', right:'auto', bottom:'auto', width:'580px', height:'730px'});
    const ta=panel.querySelector('.cb-input'); const typeSend=async(v)=>{ ta.value=v; ta.dispatchEvent(new Event('input',{bubbles:true})); panel.querySelector('.cb-send').click(); await sleep(500); };
    await typeSend('/stats'); await typeSend('/topFiles {"metric":"lines","n":6}');
    const msgs=panel.querySelector('.cb-msgs'); msgs.scrollTop=msgs.scrollHeight; await sleep(200);
    ta.value='/'; ta.dispatchEvent(new Event('input',{bubbles:true})); ta.focus(); await sleep(400); })()`);
  await shot('screenshot-chatbot.png');

  // ---- 4. historia git z lokalnego .git: częstość zmian + oś czasu (Gource-lite) ----
  if (gitFiles.length) {
    const g = await js(`(async()=>{ const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
      if(!CM.GitLocal) return 'brak CM.GitLocal';
      const b64=(s)=>{ const bin=atob(s), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; };
      const git=${JSON.stringify(gitFiles)}.map(f=>({path:f.path, file:new File([b64(f.b64)], f.path.split('/').pop())}));
      const panel=document.getElementById('cb-panel'); if(panel&&CM.ChatBot.isOpen()) CM.ChatBot.close();
      await CMApp.loadFiles(${JSON.stringify(files)}, {name:'CodeMap', source:'local: CodeMap', kind:'local'}, {git, gitFile:null, coverage:[], gitEntry:null, coverageEntries:[]});
      for(let i=0;i<200;i++){ if(CMApp.graph.gitInfo) break; await sleep(150); }
      if(!CMApp.graph.gitInfo) return 'brak gitInfo';
      CMApp.exec('setLayout',{layout:'force'}); await sleep(5000); CMApp.renderer().fit(); await sleep(400);
      CMApp.exec('togglePanel',{side:'right',open:true}); CMApp.exec('colorBy',{mode:'churn'}); CM.App.select(null); await sleep(300);
      const n=CMApp.graph.gitInfo.timeline.commits.length;
      await CM.Git.openTimeline({play:false, step:Math.round(n*0.72)}); await sleep(700);
      return JSON.stringify({commits:CMApp.graph.gitInfo.commits, authors:CMApp.graph.gitInfo.authors.length, bus:CMApp.graph.gitInfo.busFactor.value, steps:n}); })()`);
    console.log('  git:', g);
    await shot('screenshot-git.png');
  } else console.log('  (brak katalogu .git — pomijam zrzut historii)');
} catch (e) {
  console.error('✖', e.message); process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  chrome.kill(); server.close(); await sleep(300); await rm(prof, { recursive: true, force: true }).catch(() => {});
}
