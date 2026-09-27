// Smoke panelu mapy w headless Chrome (CDP z tools/cdp.mjs, bez Playwrighta — jak tools/smoke.mjs), w warunkach webview VS Code:
//  - HTML z src/webview.js (CSP z nonce, <base>, adresy przez „asWebviewUri"), dokument i zasoby na RÓŻNYCH
//    originach (jak vscode-webview:// i https://file+.vscode-resource…) — Web Workery nie wystartują,
//  - atrapa acquireVsCodeApi wstrzyknięta przed CSP (jak robi to VS Code), zbiera postMessage,
//  - mapa z analyzeProject (kopia CLI z bundle) na małym projekcie z historią git.
// Sprawdza: ready → load → liczba węzłów, focus → zaznaczony węzeł, dwuklik (prawdziwe zdarzenia myszy) i
// „Otwórz w edytorze" z menu kontekstowego → codemap:open, symbol → linia, keepView, język, brak SW,
// ścieżki zapasowe bez Workerów (analiza, fizyka), CSP blokuje skrypt inline, 0 wyjątków i 0 błędów konsoli.
//   node test/webview-smoke.mjs            (CHROME=ścieżka/do/chrome, gdy autodetekcja zawiedzie)
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { require, tmpBundle, tmpDir, rmDir, writeFiles, FIXTURE, REPO } from './helpers.mjs';

const { buildWebviewHtml, makeNonce } = require('../src/webview.js');
const { git, gitAvailable } = await import(pathToFileURL(path.join(REPO, 'tools', 'git-probe.mjs')).href);
// serwer plików, Chrome i klient CDP wspólne z tools/smoke.mjs (test/** nie trafia do paczki .vsix — .vscodeignore)
const { findChrome, launchChrome, serveDir, sleep, MIME } = await import(pathToFileURL(path.join(REPO, 'tools', 'cdp.mjs')).href);

if (!findChrome()) { console.error('✖ Nie znaleziono Chrome/Chromium — ustaw CHROME=<ścieżka>'); process.exit(2); }

// --- paczka i mapa z analizy ---
const EXT = tmpBundle(), APP = path.join(EXT, 'app');
const BASE = tmpDir('cm-vsc-smoke-'), DIR = path.join(BASE, 'fixture');
writeFiles(DIR, FIXTURE);
if (gitAvailable()) {
  git(DIR, ['init', '-q', '-b', 'main']);
  for (const [k, v] of [['core.autocrlf', 'false'], ['commit.gpgsign', 'false'], ['gc.auto', '0']]) git(DIR, ['config', k, v]);
  let clock = 1700000000;
  const commit = (msg, name) => { const t = (clock += 3600); git(DIR, ['add', '-A']);
    git(DIR, ['-c', `user.name=${name}`, '-c', `user.email=${name.split(' ')[0].toLowerCase()}@example.com`, 'commit', '-q', '-m', msg],
      { env: { GIT_AUTHOR_DATE: `${t} +0200`, GIT_COMMITTER_DATE: `${t} +0200` } }); };
  commit('start', 'Jan Kowalski');
  writeFiles(DIR, { 'src/a.js': FIXTURE['src/a.js'] + '// zmiana\n' }); commit('a', 'Anna Nowak');
}
const { analyzeProject } = await import(pathToFileURL(path.join(EXT, 'cli', 'analyze.mjs')).href);
const res = await analyzeProject(DIR, { lang: 'pl', git: true });
const map = res.graph;
// symbol (jak z tree-sittera) pod src/a.js — dwuklik ma otworzyć plik na linii definicji
map.nodes.push({ id: 'src/a.js#a', type: 'symbol', name: 'a', path: 'src/a.js#a', parent: 'src/a.js', depth: 2, kind: 'function', line: 2, endLine: 2, x: 0, y: 0 });

// --- dwa serwery: zasoby aplikacji (tylko app/) i dokument webview na innym originie ---
const resSrv = await serveDir(APP);
const RES = `http://localhost:${resSrv.address().port}`;
const MOCK = `<script>(function(){ var posted=[], n=0; window.__vscodePosted=posted;
  window.acquireVsCodeApi=function(){ if(n++) throw new Error('acquireVsCodeApi: tylko raz'); return {
    postMessage:function(m){ posted.push(JSON.parse(JSON.stringify(m))); }, getState:function(){}, setState:function(){} }; };
})();</script>`;
const index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const html = buildWebviewHtml(index, { resource: (rel) => `${RES}/${rel}`, base: `${RES}/`, cspSource: RES, nonce: makeNonce() })
  .replace(/<head>/i, '<head>' + MOCK);   // VS Code wstrzykuje swój skrypt przed meta CSP (head.prepend)
const docSrv = createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname !== '/index.html') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }); res.end(html);
});
await new Promise((r) => docSrv.listen(0, '127.0.0.1', r));
const DOC = `http://127.0.0.1:${docSrv.address().port}/index.html`;

// --- headless Chrome + CDP (tools/cdp.mjs); /api/auth/me bez backendu → oczekiwane błędy sieci (jak tools/smoke.mjs) ---
let B;
try { B = await launchChrome({ prefix: 'codemap-vsc-smoke-', hideScrollbars: false, onClose: () => { resSrv.close(); docSrv.close(); } }); }
catch (e) { console.error('✖ ' + e.message); rmDir(EXT); rmDir(BASE); process.exit(2); }
const { send, js: evalJs, errors, exceptions, warnings, apiErrors: expected } = B;   // js rzuca przy wyjątku w stronie
const deliver = (msg) => evalJs(`window.dispatchEvent(new MessageEvent('message', {data: ${JSON.stringify(msg)}})), true`);
const posted = () => evalJs('window.__vscodePosted');
async function waitPost(pred, ms = 8000) {
  for (let t = 0; t < ms; t += 50) { const p = await posted(); const hit = (p || []).find(pred); if (hit) return hit; await sleep(50); }
  return null;
}
async function mouse(type, x, y, button = 'left', clickCount = 1) { await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount }); }

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? '✔' : '✖'} ${msg}`); if (!ok) failed++; };

await send('Page.navigate', { url: DOC });

// 1. start i wczytanie mapy
const ready = await waitPost((m) => m.type === 'codemap:ready', 15000);
check(!!ready, `codemap:ready (CM.VERSION ${ready && ready.version})`);
await deliver({ type: 'codemap:load', rev: 1, map, lang: 'pl' });
const loaded = await waitPost((m) => m.type === 'codemap:loaded' && m.rev === 1);
const nodes = await evalJs('CMApp.graph.nodes.size');
check(loaded && loaded.ok && loaded.nodes === map.nodes.length && nodes === map.nodes.length, `codemap:load → mapa: ${nodes} węzłów (w mapie ${map.nodes.length})`);
await sleep(600);
const ui = await evalJs(`({ status:(document.querySelector('#st-nodes')||{}).textContent||'', canvas:(()=>{ const c=document.getElementById('map-canvas'); return c.width>0&&c.height>0; })(),
  empty:document.getElementById('empty-state').classList.contains('hidden'), git:!!CMApp.graph.gitInfo, csp:!!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
  base:document.baseURI })`);
check(ui.canvas && ui.empty && ui.csp && ui.base === RES + '/', `UI: canvas, pusty ekran ukryty, CSP i <base> (${ui.status})`);
check(ui.git === gitAvailable(), `historia git z CLI na mapie: ${ui.git}`);
const sw = await evalJs('navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r=>r.length) : 0');
check(sw === 0, 'service worker nie rejestrowany w webview');

// 2. focus z edytora
await deliver({ type: 'codemap:focus', path: 'src/b.js' });
const focused = await waitPost((m) => m.type === 'codemap:focused' && m.path === 'src/b.js');
await sleep(700);
const sel = await evalJs('CM.App.renderer.selected && CM.App.renderer.selected.id');
check(focused && focused.ok && sel === 'src/b.js', `codemap:focus → zaznaczony węzeł ${sel}`);
await deliver({ type: 'codemap:focus', path: 'nie/ma.js' });
const miss = await waitPost((m) => m.type === 'codemap:focused' && m.path === 'nie/ma.js');
check(miss && miss.ok === false, 'codemap:focus nieistniejącej ścieżki → ok:false (toast w mapie)');

// 3. dwuklik na węźle (prawdziwe zdarzenia myszy CDP w punkcie węzła)
const pt = await evalJs(`(()=>{ const r=CM.App.renderer, n=CMApp.graph.nodes.get('src/b.js'), sp=r.cam.toScreen(n.x,n.y,r.w,r.h), b=r.canvas? r.canvas.getBoundingClientRect() : document.getElementById('map-canvas').getBoundingClientRect();
  return {x:b.left+sp.x, y:b.top+sp.y, hit:(r.hitTest(sp.x,sp.y)||{}).id}; })()`);
const before = (await posted()).length;
await mouse('mouseMoved', pt.x, pt.y);
await mouse('mousePressed', pt.x, pt.y, 'left', 1); await mouse('mouseReleased', pt.x, pt.y, 'left', 1);
await mouse('mousePressed', pt.x, pt.y, 'left', 2); await mouse('mouseReleased', pt.x, pt.y, 'left', 2);
const dbl = await waitPost((m, i) => m.type === 'codemap:open' && m.path === 'src/b.js');
check(pt.hit === 'src/b.js' && dbl && dbl.line === undefined && (await posted()).length > before, `dwuklik pliku na mapie → codemap:open ${JSON.stringify(dbl)}`);

// 4. menu kontekstowe (PPM) → „Otwórz w edytorze"
await deliver({ type: 'codemap:focus', path: 'src/c.js' });
await sleep(700);
const pc = await evalJs(`(()=>{ const r=CM.App.renderer, n=CMApp.graph.nodes.get('src/c.js'), sp=r.cam.toScreen(n.x,n.y,r.w,r.h), b=document.getElementById('map-canvas').getBoundingClientRect();
  return {x:b.left+sp.x, y:b.top+sp.y}; })()`);
await mouse('mouseMoved', pc.x, pc.y);
await mouse('mousePressed', pc.x, pc.y, 'right', 1); await mouse('mouseReleased', pc.x, pc.y, 'right', 1);
await sleep(200);
const ctx = await evalJs(`(()=>{ const m=document.getElementById('ctx-menu'); const items=[...m.querySelectorAll('.ctx-item')];
  const first=items[0]; const txt=first?first.textContent.trim():''; if(first) first.click();
  return {first:txt, n:items.length}; })()`);
const ctxOpen = await waitPost((m) => m.type === 'codemap:open' && m.path === 'src/c.js');
check(ctx.first === 'Otwórz w edytorze' && !!ctxOpen, `menu kontekstowe: pierwsza pozycja „${ctx.first}" → codemap:open src/c.js`);
const ctxFolder = await evalJs(`(()=>{ CM.App.contextMenu(CMApp.graph.nodes.get('src'), 50, 50); const t=[...document.querySelectorAll('#ctx-menu .ctx-item')].map(e=>e.textContent.trim());
  CM.UI.hideCtx(); return t.includes('Otwórz w edytorze'); })()`);
check(ctxFolder === false, 'folder bez pozycji „Otwórz w edytorze"');

// 5. symbol → plik rodzica z linią definicji
await evalJs(`CM.App.renderer.onDblFile(CMApp.graph.nodes.get('src/a.js#a')), true`);
const sym = await waitPost((m) => m.type === 'codemap:open' && m.path === 'src/a.js' && m.line === 2);
check(!!sym, `dwuklik symbolu → codemap:open ${JSON.stringify(sym)}`);

// 6. odświeżenie mapy z zachowaniem widoku (bez animowanego dopasowania) + zmiana języka
await sleep(600);   // koniec animacji centrowania po dwukliku (420 ms)
const selBefore = await evalJs(`(()=>{ const r=CM.App.renderer, c=r.cam; c.x=123.5; c.y=-42; c.zoom=2.25; r.kick(); return r.selected&&r.selected.id; })()`);
await deliver({ type: 'codemap:load', rev: 2, map, lang: 'en', keepView: true });
await waitPost((m) => m.type === 'codemap:loaded' && m.rev === 2);
await sleep(700);   // dłużej niż animacja fit()
const view = await evalJs(`({cam:[CM.App.renderer.cam.x, CM.App.renderer.cam.y, CM.App.renderer.cam.zoom], sel:CM.App.renderer.selected&&CM.App.renderer.selected.id, lang:CM.i18n.getLang(),
  fitRestored:!Object.prototype.hasOwnProperty.call(CM.App.renderer,'fit'),
  label:(CM.App.contextMenu(CMApp.graph.nodes.get('src/a.js'),50,50), document.querySelector('#ctx-menu .ctx-item').textContent.trim())})`);
await evalJs('CM.UI.hideCtx(), true');
check(JSON.stringify(view.cam) === JSON.stringify([123.5, -42, 2.25]) && selBefore && view.sel === selBefore && view.fitRestored,
  `keepView: kamera ${JSON.stringify(view.cam)} i zaznaczenie ${view.sel} zachowane, fit() przywrócone`);
await deliver({ type: 'codemap:load', rev: 21, map, lang: 'en' });
await waitPost((m) => m.type === 'codemap:loaded' && m.rev === 21);
await sleep(700);
const refit = await evalJs('CM.App.renderer.cam.zoom');
check(refit !== 2.25, `load bez keepView dopasowuje widok (zoom ${refit.toFixed(3)})`);
check(view.lang === 'en' && view.label === 'Open in editor', `język z rozszerzenia: ${view.lang}, „${view.label}"`);
await deliver({ type: 'codemap:load', rev: 3, map: { format: 'nie-mapa' }, lang: 'pl' });
const bad = await waitPost((m) => m.type === 'codemap:loaded' && m.rev === 3);
check(bad && bad.ok === false && (await evalJs('CMApp.graph.nodes.size')) === map.nodes.length, 'uszkodzona mapa odrzucona, poprzednia zostaje');

// 7. ścieżki zapasowe bez Web Workerów: analiza plików i fizyka układu siłowego na wątku głównym
const fb = await evalJs(`(async()=>{ const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const F=(p,c)=>({path:p,size:c.length,content:c,mtime:Date.now()});
  CMApp.loadFiles([F('x/a.js',"import './b.js';\\n"), F('x/b.js',"import './c.js';\\n"), F('x/c.js','export const c=1;\\n')], {name:'fallback', source:'smoke'});
  for(let i=0;i<60;i++){ if(CMApp.graph.meta&&CMApp.graph.meta.name==='fallback') break; await sleep(100); }
  const edges=CMApp.graph.edges.filter(e=>e.type==='import').length;
  window.__simWorkerMin=1; CMApp.exec('setLayout',{layout:'force'});
  await sleep(1500);
  const ok=[...CMApp.graph.nodes.values()].every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y));
  return {name:CMApp.graph.meta.name, edges, finite:ok, workerOff:!CM.App.useWorker(10000)}; })()`);
check(fb.name === 'fallback' && fb.edges === 2 && fb.finite && fb.workerOff, `bez Workerów: analiza inline (${fb.edges} importy), fizyka na wątku głównym ${JSON.stringify(fb)}`);

// 8. CSP egzekwowana: skrypt inline bez nonce nie wykonuje się (spodziewany jeden błąd CSP w konsoli)
const errBefore = errors.length;
const inline = await evalJs(`(async()=>{ const s=document.createElement('script'); s.textContent='window.__inlineRan=1'; document.head.appendChild(s);
  await new Promise(r=>setTimeout(r,200)); return window.__inlineRan===undefined; })()`);
await sleep(200);
const cspErrs = errors.splice(errBefore);
check(inline && cspErrs.length >= 1 && cspErrs.every((e) => /Content Security Policy/i.test(e)), `CSP blokuje skrypt inline (${cspErrs.length} błąd CSP — oczekiwany)`);

check(exceptions.length === 0, `wyjątki JS: ${exceptions.length}${exceptions.length ? '\n   ' + exceptions.join('\n   ') : ''}`);
check(errors.length === 0, `błędy konsoli: ${errors.length}${errors.length ? '\n   ' + errors.join('\n   ') : ''}`);
console.log(`– ostrzeżenia konsoli: ${warnings.length}${warnings.length ? '\n   ' + [...new Set(warnings)].join('\n   ') : ''}`);
console.log(`– oczekiwane błędy sieci (/api/ — brak backendu): ${expected.length}`);
await cleanup(failed ? 1 : 0);

async function cleanup(code) {
  await B.close();   // CDP, Chrome, oba serwery, profil
  rmDir(EXT); rmDir(BASE);
  process.exit(code);
}
