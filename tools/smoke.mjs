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
  const root=await navigator.storage.getDirectory(); try{ await root.removeEntry('smoke-live',{recursive:true}); }catch(e){}
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
  try{ await root.removeEntry('smoke-live',{recursive:true}); }catch(e){}
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
check(cacheRes && !cacheRes.error && cacheRes.a1 === 0 && cacheRes.a2[0] === 80 && cacheRes.a2[1] === 0 && cacheRes.same2
  && cacheRes.a3 === 79 && cacheRes.changed && cacheRes.a4 === 79 && cacheRes.same4 && cacheRes.cleared,
  `pamięć analizy (OPFS): ponowne wczytanie bez analizy, zmieniony plik od nowa, trafienia po skrócie: ${JSON.stringify(cacheRes)}`);
if (glRes && glRes.skip) console.log('– renderer WebGL: pominięto — przeglądarka bez WebGL2');
else check(glRes && !glRes.error && glRes.err === 0 && glRes.stats && glRes.stats.nodes > 20 && glRes.close && glRes.hit && glRes.png
  && glRes.disp === 'block' && glRes.back === 'canvas' && glRes.hidden && /backend=webgl/.test(glRes.act),
  `renderer WebGL: GPU rysuje demo, kolor piksela, hit-test, eksport PNG, powrót do auto: ${JSON.stringify(glRes)}`);
check(agentRes && !agentRes.error && agentRes.steps === 'dependents:true,codeSearch:true,readFile:true' && agentRes.sources >= 2 && agentRes.nums
  && agentRes.roles === 'user,tool,user' && agentRes.tools === 9 && agentRes.same && /reducer/.test(agentRes.answer),
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
check(exceptions.length === 0, `wyjątki JS:${exceptions.length}${exceptions.length ? '\n   ' + exceptions.join('\n   ') : ''}`);
check(errors.length === 0, `błędy konsoli: ${errors.length}${errors.length ? '\n   ' + errors.join('\n   ') : ''}`);
cleanup(failed ? 1 : 0);

async function cleanup(code) {
  await B.close();
  process.exit(code);
}
