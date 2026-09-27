// Smoke test w prawdziwej przeglądarce (headless Chrome przez CDP, bez Playwrighta):
// serwuje repo lokalnie, otwiera index.html#demo, czeka aż mapa się zbuduje i sprawdza:
// liczbę węzłów, brak wyjątków JS, brak błędów konsoli (poza oczekiwanym 404 na /api/auth/me),
// a potem przechodzi przez ~50 akcji aplikacji (układy, filtry, motywy, panele, tryby) przez
// CMApp.exec — siatka bezpieczeństwa dla refaktoryzacji okablowania UI.
//   node tools/smoke.mjs            (CHROME=ścieżka/do/chrome, gdy autodetekcja zawiedzie)
import { startBrowser, sleep } from './cdp.mjs';

// serwer frontendu + headless Chrome przez CDP (tools/cdp.mjs); 404 na /api/* nie jest błędem (brak backendu)
let B;
try { B = await startBrowser({ prefix: 'codemap-smoke-' }); }
catch (e) { console.error('✖ ' + e.message); process.exit(2); }
const { port, send, evalJs, errors, exceptions } = B;
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
  try{ if(CM.Settings&&CM.Settings.close) CM.Settings.close(); }catch(e){ /* okno ustawień już zamknięte */ }
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

// RAG (tryb „📚 kod"): indeks fragmentów demo, /codeSearch bez modelu, przełącznik w nagłówku czatu,
// dostawca w chmurze (profil smoke: domyślny Mistral bez klucza) → komunikat o modelach lokalnych, bez wysyłania kodu
const ragRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await CM.RAG.ensure(CMApp.graph); const st=CM.RAG.stats();
  const cs=await CMApp.exec('codeSearch',{query:'format date', k:3});
  const lexHits=(await CM.RAG.search('reducer store state',{k:3})).hits.length;
  CM.ChatBot.open(); await sleep(300); CM.ChatBot._newChat(); await sleep(100);
  const btn=document.querySelector('#cb-panel .cb-rag'); const had=!!btn; if(btn && !btn.classList.contains('on')) btn.click();
  const ta=document.querySelector('#cb-panel .cb-input'); ta.value='jak działa reducer?'; ta.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#cb-panel .cb-send').click(); await sleep(400);
  const conv=CM.ChatBot._convs()[0]; const last=[...conv.messages].reverse().find(m=>m.role==='assistant');
  const localOnly=!!(last && /lokaln|local/i.test(last.content||'') && !last.sources);
  if(btn && btn.classList.contains('on')) btn.click(); CM.ChatBot.close();
  return {chunks:st.chunks, files:st.files, cs:String(cs).slice(0,120), csOk:String(cs).includes('\u0060'), lexHits, had, localOnly};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// agent z narzędziami (faza 7) bez modelu: skryptowany „model" na demo — natywne tool_calls (dependents,
// codeSearch), potem JSON w treści (readFile), odpowiedź; kroki, wspólna numeracja źródeł, graf nietknięty
const agentRes = await evalJs(`(async()=>{ try{
  const g=CMApp.graph, n0=g.nodes.size; let i=0; const seen=[];
  const replies=[
    {content:'', tool_calls:[{function:{name:'dependents', arguments:{path:'src/utils/format.js'}}}, {function:{name:'codeSearch', arguments:{query:'reducer state', k:2}}}]},
    {content:'{"name":"readFile","arguments":{"path":"src/store/reducer.js","start":1,"end":5}}'},
    {content:'Reducer jest w src/store/reducer.js [1].'}];
  const r=await CM.Agent.run({messages:[{role:'user', content:'kto używa format.js i gdzie jest reducer?'}], sources:[],
    ctx:{graph:g, rag:CM.RAG, gitCore:CM.GitCore}, chat:async(msgs, tools)=>{ seen.push(msgs[msgs.length-1].role); return replies[Math.min(i++, replies.length-1)]; }});
  return {answer:r.answer, steps:r.steps.map(s=>s.name+':'+s.ok).join(','), sources:r.sources.length, nums:r.sources.every((s,k)=>s.n===k+1),
    roles:seen.join(','), tools:CM.Agent.ollamaTools().length, same:CMApp.graph===g && g.nodes.size===n0};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// renderer WebGL (faza 6): demo wymuszone na GPU akcją renderOption — brak błędów GL, piksel w środku węzła ma
// kolor węzła (odczyt z bufora GPU), hit-test i eksport PNG działają, powrót do trybu automatycznego (canvas dla demo)
const glRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const R=CM.App.renderer;
  if(!R.backends().includes('webgl')) return {skip:true};
  R.setSelected(null); R.setHighlight(null); R.setImpact(null);   // poprzednie kroki mogły zostawić podświetlenie (przygaszone figury)
  const act=CMApp.exec('renderOption',{backend:'webgl'}); R.fit(70,false); await sleep(100); R._draw();
  const L=R._glLayer, gl=L.gl, err=gl.getError();
  const n=[...R.nodes].filter(x=>x.type==='file').sort((a,b)=>b.r-a.r)[0], sp=R.cam.toScreen(n.x,n.y,R.w,R.h);
  const px=new Uint8Array(4); gl.readPixels(Math.round(sp.x*R.dpr), Math.round(L.canvas.height-sp.y*R.dpr), 1,1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const want=CM.GLLayer.rgba(R.colorFn&&R.colorFn(n)||CM.Renderer.badgeColor(n)).slice(0,3).map(v=>Math.round(v*255));
  const close=want.every((v,i)=>Math.abs(v-px[i])<=40);
  const hit=R.hitTest(sp.x, sp.y), png=await R.exportPNG({scale:1});
  const stats=L.stats, disp=L.canvas.style.display;
  CMApp.exec('renderOption',{backend:'auto'}); R._draw();
  return {act:String(act), active:'webgl', err, stats, px:[...px].slice(0,3), want, close, hit:!!hit&&hit.id===n.id, png:!!png&&png.size>1000,
    disp, back:R.activeBackend, hidden:L.canvas.style.display==='none'};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// Doktor hotspotów (faza 7) bez modelu: kartoteka pliku demo, sekcja w panelu szczegółów, akcja hotspotDoctor,
// rozmowa „🩺 plik" — a przy dostawcy w chmurze (profil smoke) komunikat o modelach lokalnych, bez wysyłania kodu
const docRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); CMApp.loadDemo(); await sleep(900);
  const g=CMApp.graph, n=CM.Doctor.find(g,'reducer.js'), d=CM.Doctor.dossier(g, n, {local:true});
  CM.App.select(n); await sleep(200); const sec=document.querySelector('#details-body .det-doctor .doc-btn');
  const act=await CMApp.exec('hotspotDoctor',{query:'reducer.js'}); await sleep(400);
  const c=CM.ChatBot._convs()[0], last=c&&c.messages[c.messages.length-1];
  const localOnly=!!(last && last.role==='assistant' && /lokaln|local/i.test(last.content||'') && !last.sources);
  CM.ChatBot.close(); CM.App.select(null);
  return {path:d&&d.path, facts:d&&d.facts.length, sources:d&&d.sources.length, btn:!!sec, act:String(act), title:c&&c.title, localOnly};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// trasa po kodzie (faza 7) bez modelu: automatyczna na demo, odtwarzacz (karta, ←/→, Esc), zapis w mapie, link
// #tour= w obie strony (zmiana hasha nakłada trasę na bieżącą mapę), eksport CodeTour, akcja codeTour
const tourRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); CMApp.loadDemo(); await sleep(900);
  const tr=CM.TourUI.makeAuto(true); await sleep(200);
  const card=!!document.getElementById('tour-card'), first=CM.App.renderer.selected&&CM.App.renderer.selected.id;
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); await sleep(150);
  const i1=CM.TourUI.state().i;
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await sleep(100);
  const closed=!CM.TourUI.state().on && !document.getElementById('tour-card');
  const saved=!!(CM.Graph.Graph.fromJSON(JSON.parse(JSON.stringify(CMApp.graph.toJSON()))).tour||{}).steps;
  const url=await CM.TourUI.link(); const hash=url.split('#')[1];
  CMApp.graph.tour=null; location.hash=hash; await sleep(900);
  const st=CM.TourUI.state(), back=!!st.tour && st.tour.steps.length===tr.steps.length && st.on;
  CM.TourUI.stop(); history.replaceState(null,'',location.pathname+location.search);
  const ct=CM.Tour.toCodeTour(st.tour), act=await CMApp.exec('codeTour',{action:'stop'});
  return {steps:tr.steps.length, kinds:tr.steps.map(s=>s.kind).join(','), card, first, i1, closed, saved, hashHead:hash.slice(0,6), back, ct:ct.steps.length, act};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// bezpieczeństwo (faza 8): egzekwowane CSP z <meta> — wstrzyknięty skrypt inline i atrybut on* zablokowane;
// Runner działa pod CSP (runner.html + zagnieżdżona ramka w piaskownicy, kod przez postMessage), bez naruszeń
const errBeforeCsp = errors.length;
const cspRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const v=[]; const h=(e)=>v.push(e.violatedDirective);
  document.addEventListener('securitypolicyviolation', h);
  const meta=(document.querySelector('meta[http-equiv="Content-Security-Policy"]')||{}).content||'';
  window.__inj=0; const s=document.createElement('script'); s.textContent='window.__inj=1'; document.body.appendChild(s);
  const d=document.createElement('div'); d.innerHTML='<img src="data:," onerror="window.__inj=2">'; document.body.appendChild(d);
  await sleep(300); const blocked=window.__inj===0 && v.includes('script-src-elem'); const vBefore=v.length;
  CM.Runner.open('console.log(6*7)', 'js'); await sleep(1500); const st=CM.Runner.state();
  const outer=document.querySelector('#cm-runner iframe'); let inner='?';
  try{ const f=outer.contentDocument.getElementById('f'); inner=(f.getAttribute('sandbox')||'')+'|'+((f.getAttribute('srcdoc')||'').length>100); try{ f.contentDocument.body; inner+='|dostęp'; }catch(e){ inner+='|izolacja'; } }catch(e){ inner='ERR '+e.message; }
  CM.Runner.close(); s.remove(); d.remove(); document.removeEventListener('securitypolicyviolation', h);
  return {strict:/script-src 'self'/.test(meta) && !/script-src[^;]*unsafe-inline/.test(meta), blocked, runner:st, inner, runnerViolations:v.length-vBefore};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
// celowe naruszenia z tego kroku (zablokowany skrypt inline i atrybut on*) nie są błędami aplikacji
for (let k = errors.length - 1; k >= errBeforeCsp; k--) if (/Content Security Policy|Refused to/i.test(errors[k])) errors.splice(k, 1);

// galeria przykładów (faza 8): okno z kartami, przycisk na ekranie startowym i w menu, akcja gallery (bez sieci —
// otwarcie przykładu sprawdza link #repo= w teście jednostkowym i krok deep-linków z podstawionym fetch)
const galRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const btn=!!document.getElementById('empty-gallery'), menu=!!document.getElementById('btn-gallery');
  const act=await CMApp.exec('gallery',{}); await sleep(200);
  const cards=document.querySelectorAll('#modal-gallery .gal-card').length, open=!document.getElementById('modal-gallery').classList.contains('hidden');
  CM.UIKit.modal('modal-gallery','share-modal gallery-modal','gal').close();
  return {btn, menu, cards, open, act:String(act), items:CM.Gallery.ITEMS.length, hash:CM.Gallery.hashFor(CM.Gallery.find('flask'))};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// pamięć analizy w OPFS (faza 6): 80 plików wczytanych dwa razy z tymi samymi datami → drugi raz bez analizy
// i bez workerów; zmieniony plik analizowany na nowo; te same daty inne, treść ta sama → trafienia po skrócie;
// graf identyczny jak po pełnej analizie; „wyczyść" usuwa pamięć
const cacheRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const AC=CM.AnalysisCache; await AC.clear();
  const mk=(mt, extra)=>Array.from({length:80}, (_,i)=>{ let c="import { h } from './m"+((i+1)%80)+".js';\\nexport function f"+i+"(a){ if(a) return h(a); return "+i+"; }\\n"; if(extra&&i===7) c+=extra;
    return {path:'src/m'+i+'.js', size:c.length, content:c, mtime:mt}; });
  const meta={name:'smoke-cache', source:'smoke', kind:'local'};
  const sig=()=>[...CMApp.graph.nodes.values()].filter(x=>x.type==='file').map(x=>x.path+JSON.stringify(x.metrics)+(x.symbols||[]).map(s=>s.name).join()).sort().join('|')+'#'+CMApp.graph.edges.length;
  const load=async(files)=>{ await CMApp.loadFiles(files, meta); for(let i=0;i<100&&CMApp.graph.nodes.size<80;i++) await sleep(50); await sleep(100); return Object.assign({}, CM.App._lastAnalysis); };
  const a1=await load(mk(5)); const s1=sig();
  for(let i=0;i<40 && !(await AC.stats()).projects;i++) await sleep(100);
  const a2=await load(mk(5)); const same2=sig()===s1;
  const a3=await load(mk(9, 'export function nowy(){ return 1; }\\n')); const changed=!!(CMApp.graph.nodes.get('src/m7.js').symbols||[]).find(s=>s.name==='nowy');
  for(let i=0;i<40;i++){ await sleep(100); }
  const a4=await load(mk(11)); const same4=sig()===s1;
  await AC.clear(); const after=await AC.stats();
  return {a1:a1.hits, a2:[a2.hits, a2.workers], same2, a3:a3.hits, changed, a4:a4.hits, same4, cleared:after.projects===0};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// deep-linki i publiczne linki (faza 4) BEZ sieci: fetch podstawiony w stronie. #gist= → mapa (adresy z mapy
// oczyszczone), #v= niesie gist; #share= bez backendu → czytelny błąd, mapa bez zmian; #repo= z podkatalogiem
// i układem przez podstawione API GitHub; obcy host odrzucony bez żadnego zapytania; „Udostępnij publiczny
// link…" ukryte bez backendu (serwer smoke nie ma /api)
const linksRes = await evalJs(`(async()=>{ try{
  const DL=CM.DeepLink, A=CM.App;
  const btn=document.getElementById('btn-share');
  const hidden=!!btn && btn.classList.contains('hidden') && document.body.classList.contains('no-backend');
  const parsed=[DL.parseHash('#repo=o/r@main/src&layout=treemap').kind, DL.parseHash('#gist=javascript:alert(1)').kind, DL.parseHash('#repo=https://evil.example/o/r').kind].join(',');
  const map=JSON.parse(JSON.stringify(CMApp.graph.toJSON()));
  map.meta={name:'gist-map', kind:'github', html:'javascript:alert(1)', owner:{login:'x', url:'javascript:alert(2)', avatar:'https://evil.example/p.png'}};
  const GID='0123456789abcdef0123456789abcdef', SID='AAAAAAAAAAAAAAAAAAAAAAAA';
  const J=(o,s)=>new Response(typeof o==='string'?o:JSON.stringify(o),{status:s||200,headers:{'content-type':'application/json'}});
  const routes={
    ['https://api.github.com/gists/'+GID]:()=>J({id:GID, owner:{login:'ala'}, files:{'codemap.json':{filename:'codemap.json', size:10, truncated:false, content:JSON.stringify(map)}}}),
    'https://api.github.com/repos/o/r':()=>J({default_branch:'main', html_url:'https://github.com/o/r', owner:{login:'o', avatar_url:'https://avatars.githubusercontent.com/u/1', html_url:'https://github.com/o'}}),
    'https://api.github.com/repos/o/r/git/trees/main?recursive=1':()=>J({tree:[{type:'blob',path:'src/a.js',sha:'1',size:40},{type:'blob',path:'src/lib/b.js',sha:'2',size:20},{type:'blob',path:'README.md',sha:'3',size:9}]}),
    'https://raw.githubusercontent.com/o/r/main/src/a.js':()=>new Response("import b from './lib/b.js';\\nexport default b;\\n"),
    'https://raw.githubusercontent.com/o/r/main/src/lib/b.js':()=>new Response('export default 1;\\n'),
  };
  const calls=[], real=window.fetch;
  window.fetch=async(u)=>{ const k=String(u); calls.push(k); const r=routes[k]; return r ? r() : J({error:'notfound'},404); };
  try{
    const okGist=await A.openDeepLink('#gist='+GID);
    const g=CMApp.graph, m=g.meta||{};
    const sanitized=m.name==='gist-map' && !m.html && !(m.owner&&m.owner.url) && !(m.owner&&m.owner.avatar);
    const view=JSON.parse(decodeURIComponent(CMApp.serializeView().slice(3)));
    const okShare=await A.openDeepLink('#share='+SID);
    const keptGist=CMApp.graph===g;
    const okRepo=await A.openDeepLink('#repo=o/r@main/src&layout=treemap');
    const g2=CMApp.graph, files=[...g2.nodes.values()].filter(n=>n.type==='file').map(n=>n.path).sort();
    const layout=document.getElementById('sel-layout').value;
    const view2=JSON.parse(decodeURIComponent(CMApp.serializeView().slice(3)));
    const n=calls.length, bad=await A.openDeepLink('#repo=https://evil.example/o/r'), badCalls=calls.length-n;
    const foreign=calls.filter(u=>!/^https:\\/\\/(api\\.github\\.com|raw\\.githubusercontent\\.com)\\/|^\\/api\\/share\\//.test(u));
    return {hidden, parsed, okGist, sanitized, viewGist:view.gist||null, viewSrc:view.src||null, okShare, keptGist, okRepo, files, sub:g2.meta.sub,
      layout, view2:{src:view2.src||null, b:view2.b||null, sub:view2.sub||null, gist:view2.gist||null}, bad, badCalls, foreign};
  } finally { window.fetch=real; }
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// mapa wpływu PR (faza 5) bez sieci: syntetyczny PR na demo → ryzyko, zależne, nakładka „pr", karta w panelu,
// raport Markdown, link #repo=…&pr=N, akcja ChatBota prRisk
const prRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); CMApp.loadDemo(); await sleep(900);
  const g=CMApp.graph; g.meta=Object.assign({}, g.meta, {host:'github', repo:'o/demo', branch:'main'});
  const files=[{path:'src/utils/format.js', status:'M', add:12, del:3}, {path:'src/store/reducer.js', status:'M', add:4, del:1}, {path:'src/new.js', status:'A', add:30, del:0}];
  const info=CM.PR.apply(g, {number:12, title:'Demo PR', author:{login:'ala'}}, files);
  const cur=CM.Overlays.current(); CM.App.select(null); await sleep(150);
  const card=(document.getElementById('details-body').textContent||'').includes('Demo PR');
  const md=CM.PR.markdown(g), link=CM.PR.mapLink(g), risk=CMApp.exec('prRisk',{});
  const round=CM.Graph.Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  CM.PR.clear(); const cleared=!CMApp.graph.prInfo && CM.Overlays.current()!=='pr';
  return {changed:info.changed.length, outside:info.outside.length, impacted:info.impacted.length, risk:info.risk, cur, card,
    md:md.includes('#12') && md.includes('format.js'), link:link.endsWith('#repo=o/demo&branch=main&pr=12'), chat:String(risk).includes('#12'),
    persisted:!!(round.prInfo && round.prInfo.number===12), cleared};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);

// tryb na żywo (faza 6) na prawdziwych uchwytach katalogu: OPFS (bez okna wyboru) → start, zmiana pliku +
// nowy plik → poll: nowe węzły i krawędzie, pozycje zachowane, node_modules pominięte, znacznik NA ŻYWO; stop
const liveRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const root=await navigator.storage.getDirectory(); try{ await root.removeEntry('smoke-live',{recursive:true}); }catch(e){ /* resztki poprzedniego przebiegu — zwykle brak */ }
  const d=await root.getDirectoryHandle('smoke-live',{create:true});
  const write=async(path,text)=>{ let h=d; const parts=path.split('/'); for(const p of parts.slice(0,-1)) h=await h.getDirectoryHandle(p,{create:true});
    const fh=await h.getFileHandle(parts[parts.length-1],{create:true}); const w=await fh.createWritable(); await w.write(text); await w.close(); };
  await write('src/a.js',"import { b } from './b.js';\\nexport const a = () => b();\\n");
  await write('src/b.js',"export const b = () => 1;\\n");
  await write('node_modules/x/index.js',"module.exports=1;\\n");
  const ok=await CM.Live.start(d,{interval:600000}); await sleep(300);
  const g0=CMApp.graph, a0=g0.nodes.get('src/a.js'), x0=a0&&a0.x;
  const skipped=![...g0.nodes.keys()].some(k=>k.includes('node_modules'));
  await write('src/b.js',"import { c } from './c.js';\\nexport const b = () => c();\\n");
  await write('src/c.js',"export const c = () => 2;\\n");
  const res=await CM.Live.poll(); await sleep(200);
  const g1=CMApp.graph, kept=!!g1.nodes.get('src/a.js') && g1.nodes.get('src/a.js').x===x0;
  const edge=g1.edges.some(e=>e.type==='import'&&e.source==='src/b.js'&&e.target==='src/c.js');
  const badge=!!document.getElementById('st-live');
  // wznowienie po przeładowaniu: uchwyt w IndexedDB → zatrzymanie jak przy zamknięciu strony (bez zapominania)
  // → przycisk „Wznów na żywo” → kliknięcie wczytuje folder i znów obserwuje; zakończenie przez użytkownika zapomina
  const mem=((await CM.Live.remembered())||{}).name;
  CM.Live.stop(true, true); const offered=await CM.Live.offerResume(); const pill=document.querySelector('#st-live-resume .st-live-go');
  if(pill) pill.click(); for(let i=0;i<40 && !CM.Live.state().on;i++) await sleep(100);
  const resumed=CM.Live.state().on && !document.getElementById('st-live-resume') && !!CMApp.graph.nodes.get('src/c.js');
  CM.Live.stop(); await sleep(100); const forgot=!(await CM.Live.remembered());
  const off=!CM.Live.state().on && !document.getElementById('st-live');
  try{ await root.removeEntry('smoke-live',{recursive:true}); }catch(e){ /* sprzątanie best-effort — wynik testu już znany */ }
  return {ok, skipped, added:res&&res.added, changed:res&&res.changed, kept, edge, badge, off, mem, offered, pill:!!pill, resumed, forgot};
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
check(ragRes && !ragRes.error && ragRes.chunks > 0 && ragRes.csOk && ragRes.lexHits > 0 && ragRes.had && ragRes.localOnly,
  `RAG: indeks fragmentów, /codeSearch, tryb 📚 tylko z modelem lokalnym: ${JSON.stringify(ragRes)}`);
check(docRes && !docRes.error && docRes.path === 'src/store/reducer.js' && docRes.facts >= 2 && docRes.sources >= 1 && docRes.btn
  && /reducer\.js/.test(docRes.act) && /🩺/.test(docRes.title || '') && docRes.localOnly,
  `Doktor hotspotów: kartoteka, przycisk w panelu, akcja, tylko modele lokalne: ${JSON.stringify(docRes)}`);
check(tourRes && !tourRes.error && tourRes.steps >= 4 && /^readme,entry/.test(tourRes.kinds) && tourRes.card && tourRes.first === 'README.md'
  && tourRes.i1 === 1 && tourRes.closed && tourRes.saved && /^tour=[zj]/.test(tourRes.hashHead) && tourRes.back && tourRes.ct === tourRes.steps,
  `trasa po kodzie: automatyczna, odtwarzacz, zapis w mapie, link #tour=, CodeTour: ${JSON.stringify(tourRes)}`);
check(cspRes && !cspRes.error && cspRes.strict && cspRes.blocked && cspRes.runner.ready && cspRes.runner.posted >= 1
  && cspRes.inner === 'allow-scripts allow-modals|true|izolacja' && cspRes.runnerViolations === 0,
  `CSP egzekwowane, Runner pod CSP (runner.html + ramka w piaskownicy): ${JSON.stringify(cspRes)}`);
check(galRes && !galRes.error && galRes.btn && galRes.menu && galRes.cards === galRes.items && galRes.items >= 8 && galRes.open
  && galRes.hash === '#repo=pallets/flask&path=src%2Fflask',
  `galeria przykładów: okno z kartami, przyciski, akcja, link #repo=: ${JSON.stringify(galRes)}`);
check(cacheRes && !cacheRes.error && cacheRes.a1 === 0 && cacheRes.a2[0] === 80 && cacheRes.a2[1] === 0 && cacheRes.same2
  && cacheRes.a3 === 79 && cacheRes.changed && cacheRes.a4 === 79 && cacheRes.same4 && cacheRes.cleared,
  `pamięć analizy (OPFS): ponowne wczytanie bez analizy, zmieniony plik od nowa, trafienia po skrócie: ${JSON.stringify(cacheRes)}`);
if (glRes && glRes.skip) console.log('– renderer WebGL: pominięto — przeglądarka bez WebGL2');
else check(glRes && !glRes.error && glRes.err === 0 && glRes.stats && glRes.stats.nodes > 20 && glRes.close && glRes.hit && glRes.png
  && glRes.disp === 'block' && glRes.back === 'canvas' && glRes.hidden && /backend=webgl/.test(glRes.act),
  `renderer WebGL: GPU rysuje demo, kolor piksela, hit-test, eksport PNG, powrót do auto: ${JSON.stringify(glRes)}`);
check(agentRes && !agentRes.error && agentRes.steps === 'dependents:true,codeSearch:true,readFile:true' && agentRes.sources >= 2 && agentRes.nums
  && agentRes.roles === 'user,tool,user' && agentRes.tools === 10 && agentRes.same && /reducer/.test(agentRes.answer),
  `agent z narzędziami: tool_calls + JSON w treści, źródła [n], graf nietknięty: ${JSON.stringify(agentRes)}`);
check(prRes && !prRes.error && prRes.changed === 2 && prRes.outside === 1 && prRes.impacted > 0 && prRes.cur === "pr" && prRes.card && prRes.md && prRes.link && prRes.chat && prRes.persisted && prRes.cleared,
  `mapa wpływu PR: ryzyko, zależne, nakładka, panel, raport, link, ChatBot: ${JSON.stringify(prRes)}`);
check(liveRes && !liveRes.error && liveRes.ok && liveRes.skipped && String(liveRes.added)==="src/c.js" && String(liveRes.changed)==="src/b.js" && liveRes.kept && liveRes.edge && liveRes.badge && liveRes.off
  && liveRes.mem === 'smoke-live' && liveRes.offered && liveRes.pill && liveRes.resumed && liveRes.forgot,
  `tryb na żywo (OPFS): zmiany → przebudowa z zachowaniem pozycji, wznowienie po przeładowaniu: ${JSON.stringify(liveRes)}`);
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
{
  const r = linksRes || {};
  const ok = !r.error && r.hidden && r.parsed === 'repo,error,error' && r.okGist === true && r.sanitized
    && r.viewGist === '0123456789abcdef0123456789abcdef' && r.viewSrc === null && r.okShare === false && r.keptGist
    && r.okRepo === true && JSON.stringify(r.files) === '["a.js","lib/b.js"]' && r.sub === 'src' && r.layout === 'treemap'
    && r.view2.src === 'https://github.com/o/r' && r.view2.b === 'main' && r.view2.sub === 'src' && r.view2.gist === null
    && r.bad === false && r.badCalls === 0 && r.foreign.length === 0;
  check(ok, `deep-linki #gist= / #share= / #repo= (podstawiony fetch, sanityzacja mapy, #v= z gistem i podkatalogiem, udostępnianie ukryte bez backendu)${ok ? '' : ': ' + JSON.stringify(r)}`);
}
// sprzężenie zmian (faza 10): syntetyczna historia (GitCore.analyze + applyToGraph) → sekcja „Zmieniany razem z"
// w panelu szczegółów z oznaczeniem „bez importu", reguła Inspect i akcja ChatBota changeCoupling
const cochangeRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const F=(p,c)=>({path:p,size:c.length,content:c,mtime:Date.now()});
  await CMApp.loadFiles([F('src/a.js','export const a = 1;\\n'), F('src/b.js','export const b = window.A;\\n'),
    F('src/c.js',"import { a } from './a.js';\\nexport const c = a;\\n")], {name:'cochange-demo', source:'smoke'});
  for(let i=0;i<50;i++){ if(CMApp.graph&&CMApp.graph.meta&&CMApp.graph.meta.name==='cochange-demo'&&CMApp.graph.nodes.size>3) break; await sleep(100); }
  const g=CMApp.graph, T0=Date.UTC(2026,0,1), cs=[];
  for(let i=0;i<6;i++) cs.push({sha:'c'+i, parents:[], merge:false, author:{name:'Ala Kowalska',email:'a@x.pl'}, authorTime:T0+i*864e5, time:T0+i*864e5,
    message:'m', files:[{path:'src/a.js',status:'M'},{path:'src/b.js',status:'M'},{path:'src/c.js',status:'M'}]});
  CM.GitCore.applyToGraph(g, CM.GitCore.analyze(cs.reverse(), ['src/a.js','src/b.js','src/c.js']), {source:'smoke'});
  CMApp.focusNode('src/a.js'); await sleep(250);
  const sec=document.querySelector('#details-body .det-cochange'), txt=sec?sec.textContent:'';
  const rows=sec?sec.querySelectorAll('.cc-row').length:0, hidden=sec?sec.querySelectorAll('.cc-row .tag').length:0;
  const chat=CMApp.exec('changeCoupling',{query:'a.js'});
  const rep=await CM.Inspect.run(g), h=rep.findings.find(f=>f.rule==='hiddencoupling');
  return {sec:!!sec, rows, hidden, b:/b\\.js/.test(txt), chat:String(chat), rule:h?h.count:0, hi:CM.App.renderer&&CM.App.renderer.highlight?CM.App.renderer.highlight.size:null};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
check(cochangeRes && !cochangeRes.error && cochangeRes.sec && cochangeRes.rows === 2 && cochangeRes.hidden === 1 && cochangeRes.b
  && /b\.js \(100 %, 6, bez importu\)/.test(cochangeRes.chat) && /c\.js \(100 %, 6\)/.test(cochangeRes.chat) && cochangeRes.rule === 2,
  `sprzężenie zmian: panel „Zmieniany razem z", „bez importu", reguła Inspect, akcja ChatBota: ${JSON.stringify(cochangeRes)}`);
// macierz zależności (faza 10): monorepo z cyklem @m/core ↔ @m/ui → pozycja w menu, okno z macierzą, czerwona komórka
// nad przekątną, klik → pary importów i podświetlenie; reguła Inspect pkgcycle; akcja ChatBota dependencyMatrix
const dsmRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const F=(p,c)=>({path:p,size:c.length,content:c,mtime:Date.now()});
  await CMApp.loadFiles([F('package.json','{"name":"m"}'), F('core/package.json','{"name":"@m/core"}'), F('ui/package.json','{"name":"@m/ui"}'), F('web/package.json','{"name":"@m/web"}'),
    F('core/a.js',"import { f } from '../ui/f.js';\\nexport const a = 1;\\n"), F('ui/f.js',"import { a } from '../core/a.js';\\nexport const f = a;\\n"),
    F('web/app.js',"import { a } from '../core/a.js';\\nimport { f } from '../ui/f.js';\\n")], {name:'dsm-demo', source:'smoke'});
  for(let i=0;i<50;i++){ if(CMApp.graph&&CMApp.graph.meta&&CMApp.graph.meta.name==='dsm-demo'&&CMApp.graph.nodes.size>6) break; await sleep(100); }
  const menu=!!document.getElementById('btn-dsm');
  document.getElementById('btn-dsm').click(); await sleep(250);
  const body=document.getElementById('dsm-body'), rows=body.querySelectorAll('th.dsm-row').length, up=body.querySelectorAll('td.up');
  if(up[0]) up[0].click(); await sleep(150);
  const pairs=body.querySelectorAll('.dsm-pair').length, hi=CM.App.renderer.highlight?CM.App.renderer.highlight.size:null;
  const cyc=body.querySelectorAll('th.dsm-row.cyc').length;
  document.querySelector('#modal-dsm .modal-x').click();
  const chat=CMApp.exec('dependencyMatrix',{});
  const rep=await CM.Inspect.run(CMApp.graph), pc=rep.findings.find(f=>f.rule==='pkgcycle');
  document.querySelector('#modal-dsm .modal-x').click();
  return {menu, rows, up:up.length, pairs, hi, cyc, chat:String(chat), rule:pc?pc.count:0};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
check(dsmRes && !dsmRes.error && dsmRes.menu && dsmRes.rows === 4 && dsmRes.up === 1 && dsmRes.pairs === 1 && dsmRes.hi === 2 && dsmRes.cyc === 2
  && /@m\/core ↔ @m\/ui/.test(dsmRes.chat) && dsmRes.rule === 1,
  `macierz zależności: menu, okno, cykl nad przekątną, pary importów, reguła pkgcycle, akcja ChatBota: ${JSON.stringify(dsmRes)}`);
// CODEOWNERS (faza 10): deklarowany @ala, a plik zmieniał tylko Bob → sekcja panelu z „rozjazd", nakładka
// „Właściciel (CODEOWNERS)" z legendą (bez właściciela), akcja ChatBota codeOwners
const coRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const F=(p,c)=>({path:p,size:c.length,content:c,mtime:Date.now()});
  await CMApp.loadFiles([F('.github/CODEOWNERS','/src/ @ala\\n'), F('src/core.js','export const c = 1;\\n'), F('lib/free.js','export const f = 1;\\n')], {name:'co-demo', source:'smoke'});
  for(let i=0;i<50;i++){ if(CMApp.graph&&CMApp.graph.meta&&CMApp.graph.meta.name==='co-demo'&&CMApp.graph.nodes.size>3) break; await sleep(100); }
  const g=CMApp.graph, T0=Date.UTC(2026,0,1), cs=[];
  for(let i=0;i<6;i++) cs.push({sha:'c'+i, parents:[], merge:false, author:{name:'Bob Nowak',email:'bob@x.pl'}, authorTime:T0+i*864e5, time:T0+i*864e5, message:'m', files:[{path:'src/core.js',status:'M'}]});
  cs.push({sha:'c9', parents:[], merge:false, author:{name:'Ala Kowalska',email:'ala@x.pl'}, authorTime:T0+20*864e5, time:T0+20*864e5, message:'m', files:[{path:'lib/free.js',status:'M'}]});
  CM.GitCore.applyToGraph(g, CM.GitCore.analyze(cs.reverse(), ['.github/CODEOWNERS','src/core.js','lib/free.js']), {source:'smoke'});
  CMApp.focusNode('src/core.js'); await sleep(250);
  const sec=document.querySelector('#details-body .det-codeowners'), txt=sec?sec.textContent:'';
  CMApp.exec('colorBy',{mode:'codeowners'}); await sleep(150);
  const cur=CM.Overlays.current(), leg=(document.getElementById('overlay-legend')||document.body).textContent||'';
  const chat=CMApp.exec('codeOwners',{});
  CMApp.exec('colorBy',{mode:'lang'});
  return {sec:!!sec, ala:/@ala/.test(txt), drift:/rozjazd/.test(txt), cur, legend:/bez właściciela/.test(leg), chat:String(chat)};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
check(coRes && !coRes.error && coRes.sec && coRes.ala && coRes.drift && coRes.cur === 'codeowners' && coRes.legend
  && /reguły 1, pliki kodu bez właściciela 1, rozjazdy z git 1/.test(coRes.chat),
  `CODEOWNERS: panel z rozjazdem, nakładka, akcja ChatBota: ${JSON.stringify(coRes)}`);
// podatne zależności (faza 10): okno pokazuje, co wyjdzie do OSV.dev, zanim cokolwiek wyśle; podstawiony fetch (bez
// sieci) → tabela, nakładka „Podatności", sekcja przy węźle lodash, reguła Inspect vulndep; linki tylko z identyfikatora
const vuRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const F=(p,c)=>({path:p,size:c.length,content:c,mtime:Date.now()});
  const lock=JSON.stringify({lockfileVersion:3, packages:{'node_modules/lodash':{version:'4.17.15'}}});
  await CMApp.loadFiles([F('package.json','{"dependencies":{"lodash":"^4.17.15"}}'), F('package-lock.json',lock), F('src/a.js',"import _ from 'lodash';\\n")], {name:'vu-demo', source:'smoke'});
  for(let i=0;i<50;i++){ if(CMApp.graph&&CMApp.graph.meta&&CMApp.graph.meta.name==='vu-demo'&&CMApp.graph.nodes.size>3) break; await sleep(100); }
  const calls=[], orig=window.fetch;
  window.fetch=async(url,init)=>{ calls.push(String(url)); if(String(url).endsWith('/querybatch')) return new Response(JSON.stringify({results:[{vulns:[{id:'GHSA-35jh-r3h4-6jhm'}]}]}));
    return new Response(JSON.stringify({id:'GHSA-35jh-r3h4-6jhm', summary:'Command injection', database_specific:{severity:'HIGH'}, affected:[{package:{name:'lodash',ecosystem:'npm'}, ranges:[{events:[{introduced:'0'},{fixed:'4.17.21'}]}]}]})); };
  try{
    document.getElementById('btn-vulns').click(); await sleep(200);
    const body=document.getElementById('vu-body'), before=calls.length, send=/liczba: 1; npm 1/.test(body.textContent);
    document.querySelector('#vu-foot .tb-btn.primary').click();
    for(let i=0;i<40 && !document.querySelector('#vu-body .vu-row');i++) await sleep(50);
    const rows=document.querySelectorAll('#vu-body .vu-row').length, link=(document.querySelector('#vu-body .vu-ids a')||{}).href||'';
    const ov=CM.Overlays.current(), rep=await CM.Inspect.run(CMApp.graph), vd=rep.findings.find(f=>f.rule==='vulndep');
    document.querySelector('#modal-vulns .modal-x').click();
    CMApp.focusNode('ext:lodash'); await sleep(200);
    const det=!!document.querySelector('#details-body .det-vulns');
    CMApp.exec('colorBy',{mode:'lang'});
    return {before, send, calls:calls.length, rows, link, ov, rule:vd?vd.count:0, sev:vd?vd.sev:null, det};
  } finally { window.fetch=orig; }
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
check(vuRes && !vuRes.error && vuRes.before === 0 && vuRes.send && vuRes.calls === 2 && vuRes.rows === 1 && vuRes.link === 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm'
  && vuRes.ov === 'vulns' && vuRes.rule === 1 && vuRes.sev === 'high' && vuRes.det,
  `podatne zależności: zgoda przed wysyłką, tabela, nakładka, panel, reguła vulndep (podstawiony fetch): ${JSON.stringify(vuRes)}`);
// pytania o mapę (faza 11): w ChatBocie bez modelu „pokaż 3 największe pliki js" → odpowiedź z grafu (CM.MapQuery),
// chip akcji mapQuery, 3 pliki podświetlone; pytanie spoza zakresu („które pliki są najważniejsze?") nie jest przechwytywane
const mqRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  CMApp.loadDemo(); for(let i=0;i<60 && !(CMApp.graph&&CMApp.graph.nodes.size>20);i++) await sleep(100); await sleep(300);
  const direct=CMApp.exec('mapQuery',{q:'top 3 najwi\u0119ksze pliki js'});
  const hi1=CM.App.renderer.highlight?CM.App.renderer.highlight.size:null;
  CM.ChatBot.open(); await sleep(300); CM.ChatBot._newChat(); await sleep(200);
  const ta=document.querySelector('#cb-panel .cb-input'); ta.value='poka\u017c 3 najwi\u0119ksze pliki js'; ta.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#cb-panel .cb-send').click(); await sleep(400);
  const conv=CM.ChatBot._convs()[0], last=[...conv.messages].reverse().find(m=>m.role==='assistant');
  const act=last&&last.actions&&last.actions[0];
  const P=CM.MapQuery.parse('kt\u00f3re pliki s\u0105 najwa\u017cniejsze?', CMApp.graph);
  CM.ChatBot.close(); CM.App.renderer.setHighlight(null);
  return {direct:String(direct), hi1, act:act?act.action:null, ok:act?act.ok:null, res:act?String(act.result).slice(0,120):'', notConfident:!P.confident};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
check(mqRes && !mqRes.error && /^Pliki: \d+ \(pokazano 3\)/.test(mqRes.direct) && mqRes.hi1 === 3 && mqRes.act === 'mapQuery' && mqRes.ok && /^Pliki:/.test(mqRes.res) && mqRes.notConfident,
  `pytania o mapę: akcja mapQuery, ChatBot bez modelu, podświetlenie, pytanie spoza zakresu idzie dalej: ${JSON.stringify(mqRes)}`);
// szkielet testów (faza 11): akcja testSkeleton na demo → najbardziej ryzykowny plik bez testów, okno z kodem
// (describe/it, import), ścieżka i framework; przycisk „🧪 Szkielet testów" w sekcji Doktora
const tgRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  CMApp.loadDemo(); for(let i=0;i<60 && !(CMApp.graph&&CMApp.graph.nodes.size>20);i++) await sleep(100); await sleep(300);
  const out=String(CMApp.exec('testSkeleton',{})); await sleep(250);
  const body=document.getElementById('tg-body'), code=(body&&body.querySelector('.tg-code')||{}).textContent||'';
  const path=(body&&body.querySelector('.tg-meta code')||{}).textContent||'';
  document.querySelector('#modal-testgen .modal-x').click();
  const n=[...CMApp.graph.nodes.values()].find(x=>x.path===path.replace(/^.*?([^/]+)$/,'$1')) || null;
  const btn=!!document.querySelector('#details-body .doc-tg');
  return {out:out.slice(0,140), path, describe:/describe\\('/.test(code), imp:/^import /m.test(code), btn};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
check(tgRes && !tgRes.error && /^Szkielet testów: /.test(tgRes.out) && tgRes.path && tgRes.describe && tgRes.imp && tgRes.btn,
  `szkielet testów: akcja, okno z kodem (describe, import), przycisk w sekcji Doktora: ${JSON.stringify(tgRes)}`);
// asystent przeglądu PR i przed/po (faza 11): łatka w pamięci (nie w zapisie mapy) → przycisk „Przed / po" przy
// zmienionym pliku, okno z wierszami usuniętymi / dodanymi; prompt z fragmentem diff [1]; ChatBot bez modelu lokalnego → uwaga
const prrRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); CMApp.loadDemo(); await sleep(900);
  const g=CMApp.graph; g.meta=Object.assign({}, g.meta, {host:'github', repo:'o/demo', branch:'main'});
  const patch='@@ -1,3 +1,4 @@ export function fmt(x)\\n export function fmt(x){\\n-  return x;\\n+  if (x == null) return \"\";\\n+  return String(x);\\n }';
  CM.PR._patchStore.set(g, new Map([['src/utils/format.js', patch]]));
  CM.PR.apply(g, {number:12, title:'Demo PR', author:{login:'ala'}}, [{path:'src/utils/format.js', status:'M', add:2, del:1}]);
  CMApp.focusNode('src/utils/format.js'); await sleep(250);
  const btn=document.querySelector('#details-body .prd-btn'); if(btn) btn.click(); await sleep(200);
  const del=document.querySelectorAll('#prd-body td.prd-t.del').length, add=document.querySelectorAll('#prd-body td.prd-t.add').length;
  const mx=document.querySelector('#modal-prdiff .modal-x'); if(mx) mx.click();
  const pr=CM.PRReview.prompt(g, g.prInfo, CM.PR.patches(g), {local:true});
  const saved=JSON.stringify(g.toJSON()).includes('String(x)');
  CMApp.exec('prAssist',{}); await sleep(400);
  const conv=CM.ChatBot._convs()[0], u=conv.messages.find(m=>m.role==='user'), a=conv.messages.find(m=>m.role==='assistant');
  CM.ChatBot.close(); CM.PR.clear();
  return {btn:!!btn, del, add, sources:pr.sources.length, diff:pr.user.includes('\\x60\\x60\\x60diff'), saved, ask:u?u.content:'', note:!!(a&&a.noKey)};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
check(prrRes && !prrRes.error && prrRes.btn && prrRes.del === 1 && prrRes.add === 2 && prrRes.sources === 1 && prrRes.diff && !prrRes.saved
  && /^🔍 Przegląd PR #12/.test(prrRes.ask) && prrRes.note,
  `asystent przeglądu PR: przed/po z łatki, prompt z diffem, łatka poza zapisem mapy, ChatBot tylko lokalnie: ${JSON.stringify(prrRes)}`);
// trend zdrowia w aplikacji (faza 10): CM.HealthTrend na atrapie repozytorium w przeglądarce (graf + Inspect per
// punkt), okno z menu na demo bez .git → podpowiedź CLI zamiast przycisku
const htRes = await evalJs(`(async()=>{ try{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const enc=new TextEncoder();
  const blobs={a:enc.encode('export const a = 1;\\n'), b:enc.encode("import { a } from './a.js';\\ntry { a(); } catch (e) {}\\n")};
  const trees={c0:[{path:'src/a.js',sha:'a'}], c1:[{path:'src/a.js',sha:'a'},{path:'src/b.js',sha:'b'}]};
  const cm={c0:{sha:'c0',parents:[],author:{time:Date.UTC(2026,0,1)},message:'start'}, c1:{sha:'c1',parents:['c0'],author:{time:Date.UTC(2026,0,2)},message:'b'}};
  const repo={commit:async(r)=>cm[r==='HEAD'?'c1':r]||null, snapshot:async(s)=>({commit:cm[s], files:trees[s].map(f=>({...f}))}), blob:async(s)=>blobs[s]};
  const h=await CM.HealthTrend.compute(repo,{n:5, tick:()=>new Promise(r=>setTimeout(r,0))});
  CMApp.loadDemo(); await sleep(900);
  const menu=!!document.getElementById('btn-trend'); document.getElementById('btn-trend').click(); await sleep(200);
  const local=!!document.querySelector('#ht-body .ht-local'), btn=!!document.querySelector('#ht-foot .tb-btn.primary');
  document.querySelector('#modal-trend .modal-x').click();
  return {pts:h.points.map(p=>p.sha+':'+(p.rules.emptycatch||0)).join(','), chain:h.chain, menu, local, btn};
}catch(e){ return {error:String(e&&e.stack||e)}; } })()`);
check(htRes && !htRes.error && htRes.pts === 'c0:0,c1:1' && htRes.chain === 2 && htRes.menu && htRes.local && !htRes.btn,
  `trend zdrowia: liczenie w przeglądarce (atrapa repo), okno z menu, bez .git — podpowiedź CLI: ${JSON.stringify(htRes)}`);
check(exceptions.length === 0, `wyjątki JS:${exceptions.length}${exceptions.length ? '\n   ' + exceptions.join('\n   ') : ''}`);
check(errors.length === 0, `błędy konsoli: ${errors.length}${errors.length ? '\n   ' + errors.join('\n   ') : ''}`);
cleanup(failed ? 1 : 0);

async function cleanup(code) {
  await B.close();
  process.exit(code);
}
