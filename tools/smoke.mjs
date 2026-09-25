// Smoke test w prawdziwej przeglądarce (headless Chrome przez CDP, bez Playwrighta):
// serwuje repo lokalnie, otwiera index.html#demo, czeka aż mapa się zbuduje i sprawdza:
// liczbę węzłów, brak wyjątków JS, brak błędów konsoli (poza oczekiwanym 404 na /api/auth/me),
// a potem przechodzi przez ~50 akcji aplikacji (układy, filtry, motywy, panele, tryby) przez
// CMApp.exec — siatka bezpieczeństwa dla refaktoryzacji okablowania UI.
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
// eksport grafu (czyste serializery na prawdziwym grafie demo; bez pobierania pliku)
const exportOk = await evalJs(`(function(){ try{ const F=(CM.App&&CM.App.filters)||undefined; const out={};
  for(const f of CM.Export.FORMATS){ const r=CM.Export.build(CMApp.graph, F, f); out[f]=r.nodes>1 && r.edges>0 && r.text.length>200; }
  return Object.values(out).every(Boolean) ? 'ok' : JSON.stringify(out); }catch(e){ return String(e); } })()`);

// --- przejście przez akcje aplikacji (wszystko, co nie otwiera systemowych okien ani nie pobiera plików) ---
const sweep = await evalJs(`(async()=>{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const A=[];
  for(const layout of ['pack','structtree','structradial','treemap','icicle','sunburst','force','layered','modules','arcdiagram','galaxy','nebula','cosmicrings','pack']) A.push(['setLayout',{layout}]);
  A.push(['search',{query:'app'}],['search',{query:''}],['focusNode',{query:'app.js'}],['fit',{}],['zoom',{dir:'in'}],['zoom',{dir:'out'}],
    ['rotate',{dir:'left'}],['rotate',{dir:'right'}],['rotate',{dir:'reset'}],['toggle3D',{}],['toggle3D',{}],
    ['collapseAll',{}],['collapseAll',{}],['toggleImpact',{}],['toggleImpact',{}],['toggleMinimap',{}],['toggleMinimap',{}],
    ['setFilter',{externals:true}],['setFilter',{externals:false,references:true}],['setFilter',{references:false}],
    ['setMetric',{metric:'complexity',min:1}],['setMetric',{metric:'lines',min:0}],['toggleLang',{lang:'js'}],['toggleLang',{lang:'js'}],
    ['setTheme',{theme:'light'}],['setTheme',{theme:'dark'}],['setPreset',{name:'graphite'}],['setPreset',{name:'depth'}],
    ['setAccent',{color:'#22d3ee'}],['setBackground',{color:'#070a10'}],['setGlass',{transparency:40,blur:12}],
    ['setSpacing',{percent:120}],['setSpacing',{percent:100}],['setNodeScale',{percent:110}],['setNodeScale',{percent:100}],['setFontScale',{percent:100}],
    ['renderOption',{grid:false,curved:false}],['renderOption',{grid:true,curved:true}],['togglePanel',{side:'left'}],['togglePanel',{side:'left'}],
    ['togglePanel',{side:'right'}],['togglePanel',{side:'right'}],['detectCycles',{}],['hotspots',{}],['help',{}],
    ['openSettings',{tab:'ai'}],['setMode',{mode:'mindmap'}],['setMode',{mode:'codemap'}],['resetAppearance',{}],['setLang',{lang:'en'}],['setLang',{lang:'pl'}]);
  const fails=[]; let ran=0;
  for(const [a,args] of A){ try{ CMApp.exec(a,args); ran++; }catch(e){ fails.push(a+' '+JSON.stringify(args)+': '+(e&&e.message||e)); } await sleep(40); }
  try{ if(CM.Settings&&CM.Settings.close) CM.Settings.close(); }catch(e){}
  await sleep(300);
  return {ran, total:A.length, fails, nodesAfter:CMApp.graph.nodes.size, visible:CMApp.renderer()? (CMApp.renderer().nodes||[]).length : -1};
})()`);

// Inspect na demo (chunkowany run bez UI) + syntetyczny projekt z .codemap.rules.json i zduplikowanym
// blokiem → reguły archviolation (CM.Rules) i dupcode (winnowing CM.Metrics) muszą się pojawić
const inspectOk = await evalJs(`(async()=>{ try{
  const rep=await CM.Inspect.run(CMApp.graph);
  if(!rep || !Array.isArray(rep.findings) || typeof rep.score!=='number') return 'demo: '+JSON.stringify(rep);
  const F=(p,c)=>({path:p,size:c.length,content:c,mtime:Date.now()});
  const block=Array.from({length:24},(_,i)=>'export function fn'+i+'(a, b){ if(a > b){ return a - b; } return b - a + '+i+'; }').join('\\n');
  const rules={layers:[{name:'core',match:'core/**'},{name:'ui',match:'ui/**'}],forbid:[{from:'core',to:'ui',why:'rdzen nie zna UI'}],noCycles:true};
  CMApp.loadFiles([F('.codemap.rules.json', JSON.stringify(rules)), F('core/a.js', "import { u } from '../ui/u.js';\\n"+block),
    F('ui/u.js', "export const u = 1;\\n"+block+"\\n"), F('ui/v.js', "import { u } from './u.js';\\nexport const v = u + 1;\\n")], {name:'rules-demo', source:'smoke'});
  for(let i=0;i<50;i++){ if(CMApp.graph && CMApp.graph.meta && CMApp.graph.meta.name==='rules-demo' && CMApp.graph.nodes.size>4) break; await new Promise(r=>setTimeout(r,100)); }
  const rep2=await CM.Inspect.run(CMApp.graph);
  const rules2=rep2.findings.map(f=>f.rule);
  const av=rep2.findings.find(f=>f.rule==='archviolation'), dc=rep2.findings.find(f=>f.rule==='dupcode');
  const okA=av && av.sev==='high' && av.items.some(it=>it.id==='core/a.js' && /u\\.js/.test(it.detail));
  const okD=dc && dc.sev==='med' && dc.items.some(it=>/a\\.js|u\\.js/.test(it.name) && /\\d+/.test(it.detail));
  return okA && okD ? 'ok' : 'rules-demo: '+JSON.stringify(rules2)+' '+JSON.stringify((av||dc||{}).items);
}catch(e){ return String(e&&e.stack||e); } })()`);

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? '✔' : '✖'} ${msg}`); if (!ok) failed++; };
check(nodes >= 28, `demo zbudowane: ${nodes} węzłów (oczekiwane ≥ 28)${status ? ` — pasek stanu: ${status}` : ''}`);
check(canvasOk, 'canvas mapy ma rozmiar');
check(/^\d+\.\d+\.\d+$/.test(version || ''), `CM_VERSION = ${version}`);
check(sw, 'API service workera dostępne');
check(exportOk === 'ok', `eksport grafu DOT / Mermaid / GraphML na demo${exportOk === 'ok' ? '' : ': ' + exportOk}`);
check(sweep && sweep.fails.length === 0 && sweep.ran === sweep.total, `akcje CMApp.exec: ${sweep?.ran}/${sweep?.total} OK${sweep?.fails?.length ? '\n   ' + sweep.fails.join('\n   ') : ''}`);
check(sweep && sweep.nodesAfter === nodes, `graf nietknięty po przejściu (${sweep?.nodesAfter} węzłów)`);
check(inspectOk === 'ok', `Inspect: reguły architektury (.codemap.rules.json) i duplikaty kodu${inspectOk === 'ok' ? '' : ': ' + inspectOk}`);
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
