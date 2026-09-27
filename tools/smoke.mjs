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

// graf symboli (tree-sitter z CDN jsdelivr): włącz na demo, czekaj ≤ 60 s, rozwiń plik, sprawdź widoczność
// i eksport. Brak sieci / CDN → „pominięto", nie błąd (analiza jest opcjonalna i opt-in).
const symbolsRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  CMApp.loadDemo();
  for(let i=0;i<60;i++){ if(CMApp.graph && CMApp.graph.meta && /demo/i.test(CMApp.graph.meta.name||'') && CMApp.graph.nodes.size>20) break; await sleep(100); }
  CMApp.exec('symbols',{on:true});
  for(let i=0;i<120;i++){ const st=CM.Symbols.state(); if(CMApp.graph.symbolsInfo || st.status==='error') break; await sleep(500); }
  const st=CM.Symbols.state(), info=CMApp.graph.symbolsInfo;
  if(!info) return {skip:true, why:st.error||st.status};
  const f=[...CMApp.graph.nodes.values()].find(n=>n.symbolCount);
  CM.App.toggleCollapse(f);
  const vis=CMApp.graph.getVisible(CM.App.filters);
  const shown=vis.nodes.filter(n=>n.type==='symbol').length;
  const sym=vis.nodes.find(n=>n.type==='symbol'); if(sym) CM.App.select(sym);
  const details=(document.querySelector('#details-body')||{}).textContent||'';
  const dot=CM.Export.build(CMApp.graph, CM.App.filters, 'dot');
  CMApp.exec('symbols',{on:false});
  const hidden=!CMApp.graph.getVisible(CM.App.filters).nodes.some(n=>n.type==='symbol');
  return {count:info.count, calls:info.calls, files:info.files, shown, details:details.length>0, exportOk:dot.nodes>0 && /digraph/.test(dot.text), hidden};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// ChatBot bez skonfigurowanego AI (profil smoke nie ma kluczy ani modeli): scenariusz ze zgłoszenia —
// „wymień wszystkie dostępne komędy" → lista narzędzi bez modelu i bez akcji; akcje modelu bez wymaganych
// argumentów / o pustej lub nieznanej nazwie są odrzucane zamiast kończyć się czerwonym chipem
const chatbotRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const C=CM.ChatBot._check;
  const bad=[{action:'setMode',args:{}},{action:'setLayout',args:{}},{action:'',args:{}},{action:'nope',args:{}}].filter(C.validAction).length;
  const good=[{action:'setMode',args:{mode:'codemap'}},{action:'setLayout',args:{layout:'pack'}}].filter(C.validAction).length;
  const q='wymie\u0144 wszystkie dost\u0119pne kom\u0119dy';
  const help=C.isHelpRequest(q) && !C.looksLikeCommand(q) && C.looksLikeCommand('czy mo\u017cesz ustawi\u0107 uk\u0142ad treemap?');
  CM.ChatBot.open(); await sleep(300); CM.ChatBot._newChat(); await sleep(200);
  const ta=document.querySelector('#cb-panel .cb-input'); ta.value=q; ta.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#cb-panel .cb-send').click(); await sleep(500);
  const conv=CM.ChatBot._convs()[0]; const last=[...conv.messages].reverse().find(m=>m.role==='assistant');
  const lines=((last&&last.content)||'').split('\\n').filter(l=>l.indexOf('- \\u0060/')===0).length;
  const err=document.querySelectorAll('#cb-panel .cb-chip-err').length, acts=((last&&last.actions)||[]).length;
  CM.ChatBot.close();
  return {bad, good, help, lines, err, acts};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// Historia git (faza 3) bez sieci: syntetyczna historia demo → GitCore.analyze → nakładki, panel,
// hotspoty, oś czasu i akcje ChatBota (źródła lokalne/API mają własne testy i sondę)
const gitRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const g=CMApp.graph, A=CM.App;
  const files=[...g.nodes.values()].filter(n=>n.type==='file').map(n=>n.path);
  const who=[{name:'Ala Kowalska',email:'ala@x.pl'},{name:'Bob Nowak',email:'bob@x.pl'}];
  const cs=[]; const T0=Date.UTC(2026,0,1);
  files.forEach((p,i)=>cs.push({sha:'a'+i, parents:[], merge:false, author:who[i%2], authorTime:T0+i*864e5, time:T0+i*864e5, message:'add '+p, files:[{path:p,status:'A'}]}));
  for(let k=0;k<12;k++) cs.push({sha:'m'+k, parents:[], merge:false, author:who[0], authorTime:T0+(100+k)*864e5, time:T0+(100+k)*864e5, message:'fix '+k, files:[{path:files[k%3],status:'M'}]});
  cs.reverse();
  const res=CM.GitCore.analyze(cs, files); CM.GitCore.applyToGraph(g, res, {source:'test'}); A.apply({relayout:false});
  const ov=CM.Overlays.list().map(o=>o.id);
  for(const m of ['owner','churn','hotspot','age']) CMApp.exec('colorBy',{mode:m});
  const colored=CMApp.renderer().colorFn && CMApp.renderer().colorFn(g.nodes.get(files[0]));
  CMApp.exec('colorBy',{mode:'lang'});
  CMApp.focusNode(files[0]); await sleep(200);
  const panel=(document.getElementById('details-body').textContent||'').includes('${'Historia git'}');
  const owners=CMApp.exec('owners',{}), churn=CMApp.exec('churn',{n:3}), top=CMApp.exec('topFiles',{metric:'churn',n:3}), bus=CMApp.exec('busFactor',{});
  await CM.Git.openTimeline({play:false, step:0}); await sleep(100);
  const first=CMApp.renderer().nodes.length; CM.Git.setStep(res.timeline.commits.length-1); await sleep(100);
  const last=CMApp.renderer().nodes.length, tl=CM.Git.timeline(); CM.Git.closeTimeline(); await sleep(100);
  CM.UI.renderHotspots(g, A.handlers); const hot=document.querySelectorAll('#hotspots-body .hot-row').length;
  const round=CM.Graph.Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  CM.App.select(null);
  return {ov, colored:!!colored, panel, owners:owners.slice(0,40), churn:churn.includes('('), top:top.includes('('), bus, first, last, total:tl.total,
    hot, persisted:!!(round.gitInfo && round.nodes.get(files[0]).git), after:CMApp.renderer().nodes.length};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// testy ↔ kod i pokrycie (CM.TestMap + tests-ui.js) na demo: krawędzie test i isTest, filtr „Testy", pokrycie
// z syntetycznego lcov (API i ścieżka UI przez File), nakładki tests / coverage przez colorBy, sekcja w panelu,
// niepokryte linie w podglądzie pliku, akcje ChatBota tests / coverage, Inspect, zapis i odczyt mapy
const testsRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const old=CMApp.graph; CMApp.loadDemo();
  for(let i=0;i<80;i++){ const g=CMApp.graph; if(g!==old && g.testInfo && g.nodes.size>20) break; await sleep(100); }
  const g=CMApp.graph;
  const tEdges=g.edges.filter(e=>e.type==='test').map(e=>e.source+'>'+e.target+':'+e.via).sort();
  const isTest=[...g.nodes.values()].filter(n=>n.isTest).map(n=>n.id).sort();
  const ovIds=()=>CM.Overlays.list().map(o=>o.id);
  const ovBefore=ovIds();
  CMApp.exec('colorBy',{mode:'tests'}); const cur1=CM.Overlays.current();
  const legend1=((document.querySelector('#overlay-legend')||{}).textContent||'').length>0;
  const visT=()=>CMApp.graph.getVisible(CM.App.filters).edges.filter(e=>e.type==='test').length;
  const cb=document.getElementById('edge-test');
  const vis1=visT(); cb.checked=false; cb.dispatchEvent(new Event('change',{bubbles:true}));
  const vis0=visT(), rend0=CMApp.renderer().edges.filter(e=>e.type==='test').length;
  cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); const vis2=visT();
  const lcov=['TN:','SF:/home/ci/demo-app/src/utils/format.js','DA:1,4','DA:2,4','end_of_record',
    'SF:C:\\\\ci\\\\demo-app\\\\src\\\\store\\\\reducer.js','DA:1,2','DA:2,0','DA:3,0','BRDA:2,0,0,1','BRDA:2,0,1,0','end_of_record',
    'SF:./src/services/api.js','DA:1,1','DA:2,0','DA:3,0','DA:4,0','end_of_record','SF:/elsewhere/zzz/nope.js','DA:1,0','end_of_record'].join('\\n');
  const info=CM.TestMap.applyCoverage(g, CM.TestMap.parseCoverage(lcov,'lcov.info'), {source:'smoke'}); CM.TestsUI.refresh();
  const ovAfter=ovIds();
  CMApp.exec('colorBy',{mode:'coverage'}); const cur2=CM.Overlays.current();
  const colF=CMApp.renderer().colorFn ? CMApp.renderer().colorFn(g.nodes.get('src/utils/format.js')) : null;
  const info2=await CM.TestsUI.loadCoverage([new File([lcov],'lcov.info')], {show:true});
  const drop=CM.App.dropCoverage([new File([lcov],'lcov.info')],[])===true && CM.App.dropCoverage([new File(['x'],'a.js')],[])===false; await sleep(100);
  const loadAct=typeof CMApp.exec('loadCoverage',{})==='string' && !!document.getElementById('btn-coverage');
  CM.App.select(g.nodes.get('src/store/reducer.js')); await sleep(50);
  const det=(document.querySelector('#details-body')||{}).textContent||'';
  CM.App.handlers.openFile(g.nodes.get('src/store/reducer.js')); await sleep(50);
  const unc=document.querySelectorAll('#fileview-body .fv-unc').length;
  document.getElementById('modal-fileview').classList.add('hidden');
  const tSum=CMApp.exec('tests',{}), tFile=CMApp.exec('tests',{query:'format.js'}), cSum=CMApp.exec('coverage',{}), cFile=CMApp.exec('coverage',{query:'reducer.js'});
  const rep=await CM.Inspect.run(g);
  CMApp.loadFromJSON(JSON.parse(JSON.stringify(g.toJSON()))); await sleep(100);
  const g2=CMApp.graph, cov2=g2.nodes.get('src/utils/format.js').coverage;
  const tE2=g2.edges.filter(e=>e.type==='test').length, tb2=(g2.nodes.get('src/store/reducer.js').testedBy||[]).length;
  CMApp.exec('colorBy',{mode:'lang'}); CM.App.select(null);
  return {tEdges, isTest, ovBefore, cur1, legend1, vis1, vis0, rend0, vis2, info:{files:info.files, matched:info.matched, total:info.total, pct:info.pct},
    ovAfter, cur2, colF, info2:info2&&info2.files, drop, loadAct, det:/Testy i pokrycie|Tests and coverage/.test(det) && /reducer\\.test\\.js/.test(det), unc,
    tSum, tFile, cSum, cFile, score:typeof rep.score, tE2, tb2, cov2:!!(cov2 && cov2.pct===100)};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

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
if (symbolsRes && symbolsRes.skip) console.log(`– graf symboli (tree-sitter): pominięto — ${symbolsRes.why}`);
else check(symbolsRes && !symbolsRes.error && symbolsRes.count > 0 && symbolsRes.shown > 0 && symbolsRes.details && symbolsRes.exportOk && symbolsRes.hidden,
  `graf symboli (tree-sitter): ${symbolsRes && symbolsRes.error ? symbolsRes.error : JSON.stringify(symbolsRes)}`);
check(gitRes && !gitRes.error && ["owner","churn","hotspot","age"].every(m=>gitRes.ov.includes(m)) && gitRes.colored && gitRes.panel && gitRes.churn && gitRes.top
  && gitRes.first < gitRes.last && gitRes.total > 1 && gitRes.hot > 0 && gitRes.persisted,
  `historia git: nakładki, panel, hotspoty, oś czasu, akcje ChatBota: ${JSON.stringify(gitRes)}`);
check(chatbotRes && !chatbotRes.error && chatbotRes.bad === 0 && chatbotRes.good === 2 && chatbotRes.help && chatbotRes.lines >= 40 && chatbotRes.err === 0 && chatbotRes.acts === 0,
  `ChatBot: pomoc bez modelu, walidacja akcji: ${JSON.stringify(chatbotRes)}`);
{
  const r = testsRes || {};
  const EDGES = ['src/components/Button.test.jsx>src/components/Button.jsx:name', 'src/store/reducer.test.js>src/store/actions.js:import',
    'src/store/reducer.test.js>src/store/reducer.js:name', 'tests/format.test.js>src/utils/format.js:name'];
  const ok = !r.error && JSON.stringify(r.tEdges) === JSON.stringify(EDGES) && r.isTest.length === 3
    && r.ovBefore.includes('tests') && !r.ovBefore.includes('coverage') && r.cur1 === 'tests' && r.legend1
    && r.vis1 === 4 && r.vis0 === 0 && r.rend0 === 0 && r.vis2 === 4
    && r.info.files === 3 && r.info.matched === 3 && r.info.total === 4 && r.info.pct === 44.4
    && r.ovAfter.includes('coverage') && r.cur2 === 'coverage' && r.colF === '#22c55e' && r.info2 === 3 && r.drop && r.loadAct && r.det && r.unc === 2
    && /: 3 /.test(r.tSum) && /format\.test\.js/.test(r.tFile) && /44[,.]4/.test(r.cSum) && /2–3/.test(r.cFile)
    && r.score === 'number' && r.tE2 === 4 && r.tb2 === 1 && r.cov2;
  check(ok, `testy ↔ kod i pokrycie (lcov, nakładki tests/coverage, panel, ChatBot, zapis mapy)${ok ? '' : ': ' + JSON.stringify(r)}`);
}
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
