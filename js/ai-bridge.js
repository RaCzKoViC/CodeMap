/* ===================== ai-bridge.js — AI, most ChatBota, paleta poleceń, demo ===================== */
// Podsumowanie struktury dla modelu (aiStructureSummary), klucze Mistral z round-robin (aiChat), aiAnalyze/aiAsk/
// aiAskNode, most ChatBota (appState/exec/CB_ACTIONS), paleta poleceń Ctrl+K (buildPalette) i dane demo (loadDemo).
// Dopisuje się do CM.App (A).
(function(){
  const A=CM.App;
  const U=CM.util, $=U.$, el=U.el, I=CM.i18n;
  const Loaders=CM.Loaders;
  const state=A.state, filters=A.filters, handlers=A.handlers, THEME_PRESETS=A.THEME_PRESETS;   // pola stałe kontekstu (nigdy nie podmieniane)

  // ---------------- command palette (Ctrl/Cmd+K) ----------------
  function paletteCommands(){
    const R=A.renderer; const c=(label,ic,run,hint)=>({label,ic,run,hint:hint||''});
    const btn=(id)=>{ const b=$('#'+id); if(b) b.click(); };
    const list=[
      c(I.t('ca.cmdLoadFolder','Wczytaj: folder z urządzenia'),'folder',()=>btn('btn-load-folder')),
      c(I.t('ca.cmdLoadFiles','Wczytaj: pojedyncze pliki'),'file',()=>btn('btn-load-files')),
      c(I.t('ca.cmdLoadGithub','Wczytaj: repozytorium GitHub / URL'),'globe',()=>btn('btn-load-github')),
      c(I.t('ca.cmdDemo','Zobacz demo'),'sparkle',()=>loadDemo()),
      c(I.t('ca.cmdFit','Dopasuj widok do zawartości'),'fit',()=>R.fit(),'F'),
      c(I.t('ca.cmdZoomIn','Przybliż'),'plus',()=>R.zoomBy(1.3),'+'),
      c(I.t('ca.cmdZoomOut','Oddal'),'minus',()=>R.zoomBy(1/1.3),'−'),
      c(I.t('ca.cmd3d','Przełącz perspektywę 3D'),'cube',()=>R.setTilt(R.cam.tilt>0.05?0:0.62),'T'),
      c(I.t('ca.cmdResetRot','Wyzeruj obrót'),'target',()=>R.resetRotation(),'R'),
      c(I.t('ca.cmdCycles','Wykryj cykle zależności'),'flow',()=>btn('btn-cycles')),
      c(I.t('ca.cmdHotspots','Hotspoty — pliki o największym wpływie'),'target',()=>btn('btn-hotspots')),
      c(I.t('ca.cmdSnapshot','Zapisz migawkę'),'bookmark',()=>btn('btn-snapshot')),
      c(I.t('ca.cmdHistory','Historia i porównania'),'clock',()=>btn('btn-history')),
      c(I.t('ca.cmdSave','Zapisz mapę (.json)'),'save',()=>btn('btn-save')),
      c(I.t('ca.cmdExportImg','Eksport obrazu (PNG / SVG)'),'image',()=>btn('btn-export-img')),
      c(I.t('ca.cmdExportDot','Eksport grafu: DOT (Graphviz)'),'download',()=>btn('btn-export-dot')),
      c(I.t('ca.cmdExportMermaid','Eksport grafu: Mermaid'),'download',()=>btn('btn-export-mermaid')),
      c(I.t('ca.cmdExportGraphML','Eksport grafu: GraphML (yEd)'),'download',()=>btn('btn-export-graphml')),
      c(I.t('ca.cmdOpen','Otwórz zapisaną mapę'),'open',()=>btn('btn-open')),
      c(I.t('ca.cmdCompareAdd','Porównaj: dodaj schemat na mapę'),'layers',()=>btn('btn-compare-add')),
      c(I.t('ca.cmdClear','Wyczyść dane'),'trash',()=>btn('btn-clear')),
      c(I.t('ca.cmdModeCodemap','Tryb: CodeMap (mapa kodu)'),'map',()=>A.setMode('codemap')),
      c(I.t('ca.cmdModeMindmap','Tryb: MindMap (mapy myśli)'),'layers',()=>A.setMode('mindmap')),
      c(I.t('ca.cmdThemeLight','Motyw: jasny'),'eye',()=>{ const b=document.querySelector('#theme-row .theme-btn[data-theme="light"]'); b&&b.click(); }),
      c(I.t('ca.cmdThemeDark','Motyw: ciemny'),'cube',()=>{ const b=document.querySelector('#theme-row .theme-btn[data-theme="dark"]'); b&&b.click(); }),
    ];
    const sel=$('#sel-layout'); if(sel) for(const o of sel.options) list.push(c(CM.i18n.t('layout.field')+': '+CM.i18n.t('layout.'+o.value, o.textContent),'grid',()=>{ sel.value=o.value; sel.dispatchEvent(new Event('change',{bubbles:true})); }));
    if(state._canInstall && state._canInstall()) list.unshift(c(I.t('ca.cmdInstall','Zainstaluj aplikację (PWA)'),'download',()=>state._installApp&&state._installApp()));
    return list;
  }
  function buildPalette(){
    const ov=el('div',{id:'cmd-palette',class:'hidden'});
    const box=el('div',{class:'cmd-box'});
    const inp=el('input',{id:'cmd-input',type:'text',placeholder:I.t('ca.cmdPlaceholder','Wpisz polecenie… (Ctrl+K)'),autocomplete:'off'});
    const listEl=el('div',{class:'cmd-list'});
    box.appendChild(inp); box.appendChild(listEl); ov.appendChild(box); $('#main').appendChild(ov);
    let cmds=[], filtered=[], sel=0;
    const render=()=>{ listEl.innerHTML=''; filtered.forEach((cm,i)=>{ const r=el('div',{class:'cmd-item'+(i===sel?' on':'')});
      r.onmousedown=(e)=>e.preventDefault(); r.onclick=()=>runCmd(cm); r.onmousemove=()=>{ if(sel!==i){ sel=i; render(); } };
      r.appendChild(el('span',{class:'cmd-ic',html:CM.icons.svg(cm.ic||'box',{size:15})}));
      r.appendChild(el('span',{class:'cmd-label',text:cm.label}));
      if(cm.hint) r.appendChild(el('span',{class:'cmd-hint',text:cm.hint}));
      listEl.appendChild(r); });
      const on=listEl.querySelector('.cmd-item.on'); if(on) on.scrollIntoView({block:'nearest'});
    };
    const filt=()=>{ const q=inp.value.trim().toLowerCase(); filtered=q?cmds.filter(cm=>cm.label.toLowerCase().includes(q)):cmds.slice(0,50); sel=0; render(); };
    const runCmd=(cm)=>{ close(); try{ cm.run(); }catch(e){ console.error(e); } };
    const open=()=>{ cmds=paletteCommands(); inp.value=''; filtered=cmds.slice(0,50); sel=0; render(); ov.classList.remove('hidden'); setTimeout(()=>inp.focus(),0); };
    const close=()=>ov.classList.add('hidden');
    inp.oninput=filt;
    inp.onkeydown=(e)=>{
      if(e.key==='ArrowDown'){ sel=Math.min(sel+1,filtered.length-1); render(); e.preventDefault(); }
      else if(e.key==='ArrowUp'){ sel=Math.max(sel-1,0); render(); e.preventDefault(); }
      else if(e.key==='Enter'){ if(filtered[sel]) runCmd(filtered[sel]); }
      else if(e.key==='Escape'){ close(); }
    };
    ov.addEventListener('mousedown',(e)=>{ if(e.target===ov) close(); });
    window.addEventListener('keydown',(e)=>{ if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){ e.preventDefault(); ov.classList.contains('hidden')?open():close(); } });
  }

  // ---------------- optional AI (Mistral): structure-only summary, never source code ----------------
  // Nazwy projektu/folderów/plików pochodzą z wczytanego repozytorium i trafiają do promptu modelu.
  // Przycinamy je i usuwamy znaki sterujące, nowe linie i backticki, żeby nazwa folderu nie mogła
  // udawać instrukcji ani domykać bloku w prompcie (prompt injection przez treść repo).
  const _pn=(s)=>String(s||'').replace(/[\u0000-\u001f\u007f`]/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
  function aiStructureSummary(){
    const g=A.graph, langCount={}, folderMap=new Map();
    let totalSize=0, fileCount=0, folderCount=0, externals=0, maxDepth=0, maxFileKB=0, hasTests=false;
    for(const n of g.nodes.values()){
      if(n.type==='folder'){ folderCount++; continue; }
      if(n.type==='external'){ externals++; continue; }
      if(n.type!=='file') continue;
      fileCount++; totalSize+=n.size||0;
      const kb=(n.size||0)/1024; if(kb>maxFileKB) maxFileKB=kb;
      const depth=(n.path||'').split('/').length; if(depth>maxDepth) maxDepth=depth;
      if(/(^|\/)(tests?|spec|specs|__tests__|e2e)(\/|$)/i.test(n.path||'')) hasTests=true;
      const l=(n.langInfo&&n.langInfo.name)||n.lang||'other'; langCount[l]=(langCount[l]||0)+1;
      const top=(n.path||'').split('/')[0]||'(root)';
      if(!folderMap.has(top)) folderMap.set(top,{name:top,files:0,size:0,langs:{}});
      const f=folderMap.get(top); f.files++; f.size+=n.size||0; f.langs[l]=(f.langs[l]||0)+1;
    }
    let importEdges=0; for(const e of g.edges){ if(e.type==='import'||e.type==='reference') importEdges++; }
    // local models run with a 2048-token window — feed them a MUCH smaller structure than the API
    const localAI=CM.LocalAI&&CM.LocalAI.provider()==='local';
    const languages=Object.entries(langCount).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+' ×'+v);
    const folders=[...folderMap.values()].sort((a,b)=>b.files-a.files).slice(0,localAI?12:40).map(f=>({
      name:_pn(f.name), files:f.files, sizeKB:Math.round(f.size/1024),
      langs:Object.entries(f.langs).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]) }));
    return { project:_pn(g.meta.name)||'project', source:_pn(g.meta.source),
      totalFiles:fileCount, totalFolders:folderCount, externals, importEdges,
      totalSizeKB:Math.round(totalSize/1024), avgFileKB:fileCount?Math.round(totalSize/1024/fileCount):0, maxFileKB:Math.round(maxFileKB), maxDepth, hasTests,
      languages, topFolders:folders };
  }
  // ---- Mistral API keys: up to 4, used app-wide with round-robin + automatic fallback ----
  // ---- dostawca chmurowy: CM.AI (klucze z wykrytym dostawcą, test, round-robin) ----
  // aiKeyList/aiModel zostają jako cienkie wrappery dla zgodności (paleta, ChatBot, testy).
  function aiKeyList(){ return CM.AI?CM.AI.usable().map(e=>e.key):[]; }
  function aiModel(){ const e=CM.AI&&CM.AI.primary(); return e?CM.AI.modelFor(e):''; }
  function aiConfigured(){
    const prov=CM.LocalAI?CM.LocalAI.provider():'mistral';
    if(prov==='local') return CM.LocalAI.hasWebGPU();
    if(prov==='ollama') return true;   // reachability errors surface with a clear message on use
    return !!(CM.AI&&CM.AI.hasKey());
  }
  function aiGuard(){
    if(!aiConfigured()) throw new Error(I.t('ca.aiNeedKey','Dodaj i przetestuj klucz API w Ustawieniach → AI (albo wybierz tam model lokalny / Ollamę).'));
    if(state.counts.nodes===0) throw new Error(I.t('ca.aiNoProject','Najpierw wczytaj projekt.'));
  }
  async function aiChat(messages, opts){
    // local providers — the whole app's AI runs on-device, no key needed:
    //  'local'  = WebLLM in-browser;  'ollama' = native Ollama server (fastest local option)
    const prov=CM.LocalAI?CM.LocalAI.provider():'mistral';
    if(prov==='local') return CM.LocalAI.chat(messages, opts||{});
    if(prov==='ollama' && CM.Ollama) return CM.Ollama.chat(messages, Object.assign({think:false}, opts||{}));   // analiza = zwięzły tekst, bez rozumowania
    if(!CM.AI) throw new Error('CM.AI');
    // wszystkie działające klucze rotacyjnie; 401/429/5xx/sieć → następny klucz (jak dawny round-robin Mistral)
    return CM.AI.chatAny(messages, opts||{});
  }
  async function aiAnalyze(){
    aiGuard();
    const lang=CM.i18n.getLang()==='en'?'English':'Polish';
    const sys='You are a senior software architect. You receive ONLY a project\'s folder/file structure (paths, counts, sizes, languages) — never source code. Be concise and practical.';
    const user='Analyze this project structure and: (1) describe the likely architecture in 3–5 sentences; (2) propose a clear logical grouping into modules/layers as a bullet list mapping top-level folders to their role; (3) flag structural smells (oversized files/folders, missing tests, mixed concerns). Answer in '+lang+'.\n\nStructure JSON:\n'+JSON.stringify(aiStructureSummary());
    return await aiChat([{role:'system',content:sys},{role:'user',content:user}]);
  }

  // ---- #8: free-form question about the project (structure only, never source code) ----
  async function aiAsk(question){
    question=(question||'').trim(); if(!question) throw new Error(I.t('ca.aiAskEmpty','Wpisz pytanie.'));
    aiGuard();
    const lang=CM.i18n.getLang()==='en'?'English':'Polish';
    const sys='You help a developer understand a codebase. You receive ONLY the project structure (folders, file paths, counts, sizes, languages) — never source code. Answer practically and concisely; when the structure cannot fully answer, say what you can infer and name the folders/files most likely worth opening. Answer in '+lang+'.';
    const user='Question: '+question+'\n\nProject structure JSON:\n'+JSON.stringify(aiStructureSummary());
    return await aiChat([{role:'system',content:sys},{role:'user',content:user}], {temperature:0.4});
  }
  // ask AI about a SPECIFIC selected element (folder/file) — scoped context, structure only
  async function aiAskNode(node, question){
    question=(question||'').trim(); if(!question) throw new Error(I.t('ca.aiAskEmpty','Wpisz pytanie.'));
    if(!node) return aiAsk(question);
    aiGuard();
    const lang=CM.i18n.getLang()==='en'?'English':'Polish';
    const ctx={ name:node.name, path:node.path||node.name, type:node.type };
    const localAI=CM.LocalAI&&CM.LocalAI.provider()==='local';   // 2048-token window → tighter context
    const kidsCap=localAI?30:80, depsCap=localAI?15:40;
    if(node.type==='folder'){
      const kids=[]; for(const n of A.graph.nodes.values()){ if(n.parent===node.id){ kids.push((n.type==='folder'?'📁 ':'')+n.name); if(kids.length>=kidsCap) break; } }
      ctx.contains=kids;
    } else {
      ctx.lang=(node.langInfo&&node.langInfo.name)||node.lang||null; ctx.sizeKB=Math.round((node.size||0)/1024);
      const deps=[]; for(const e of A.graph.edges){ if(e.source===node.id&&(e.type==='import'||e.type==='reference')){ const t=A.graph.nodes.get(e.target); if(t){ deps.push(t.name); if(deps.length>=depsCap) break; } } }
      if(deps.length) ctx.dependsOn=deps;
    }
    const sys='You help a developer understand a SPECIFIC part of a codebase. You receive ONLY structural metadata (the selected element plus brief project context) — never source code. Answer concisely and practically about THIS element; if the structure is insufficient, say what you can infer. Answer in '+lang+'.';
    const user='Selected element:\n'+JSON.stringify(ctx)+'\n\nProject overview:\n'+JSON.stringify(aiStructureSummary())+'\n\nQuestion: '+question;
    return await aiChat([{role:'system',content:sys},{role:'user',content:user}], {temperature:0.4});
  }

  // (AI-driven file-LAYOUT was removed by design — node arrangement is purely geometric/deterministic.
  //  The optional, separate "AI view-tuning" below only picks which elements/sizes to show, never positions.)

  // ---------------- demo dataset ----------------
  function demoFiles(){
    const F=(path,content)=>({path, size:content.length, content, mtime:Date.now()});
    return [
      F('package.json', '{\n "name":"demo-app",\n "dependencies":{"react":"^18","lodash":"^4"}\n}'),
      F('README.md', '# Demo App\nMapa przykładowa.\nZobacz [architekturę](./docs/arch.md) oraz [src/app.js](./src/app.js).'),
      F('src/app.js', "import { createStore } from './store/index.js';\nimport { Header } from './components/Header.jsx';\nimport { api } from './services/api.js';\nimport { format } from './utils/format.js';\nimport React from 'react';\n// główny punkt wejścia\nexport function main(){ const s=createStore(); return Header(s); }\n"),
      F('src/store/index.js', "import { reducer } from './reducer.js';\nimport { logger } from '../utils/logger.js';\nexport function createStore(){ logger('init'); return { state:reducer({},{}) }; }\n"),
      F('src/store/reducer.js', "import { ACTIONS } from './actions.js';\nexport function reducer(state, action){ switch(action.type){ case ACTIONS.INC: return state; default: return state; } }\n"),
      F('src/store/actions.js', "export const ACTIONS = { INC:'INC', DEC:'DEC' };\n"),
      F('src/components/Header.jsx', "import React from 'react';\nimport { Button } from './Button.jsx';\nimport { api } from '../services/api.js';\nimport './header.css';\nexport function Header(store){ return Button({label:'Menu'}); }\n"),
      F('src/components/Button.jsx', "import React from 'react';\nimport { format } from '../utils/format.js';\nexport function Button(p){ return format(p.label); }\n"),
      F('src/components/header.css', "@import '../styles/theme.css';\n.header{ display:flex; background:var(--bg); }\n.header .logo{ width:32px; }\n"),
      F('src/styles/theme.css', ":root{ --bg:#0a0e14; --fg:#cdd6e4; }\nbody{ background:var(--bg); color:var(--fg); }\n"),
      F('src/services/api.js', "import { logger } from '../utils/logger.js';\nimport axios from 'axios';\nexport const api = { get(u){ logger('GET '+u); } };\n"),
      F('src/utils/format.js', "// formatowanie\nexport function format(s){ return String(s).trim(); }\n"),
      F('src/utils/logger.js', "export function logger(msg){ if(typeof console!=='undefined') console.log('[log]', msg); }\n"),
      F('src/index.html', '<!doctype html>\n<html><head><link rel="stylesheet" href="styles/theme.css"></head>\n<body><script src="app.js"></script></body></html>'),
      F('docs/arch.md', '# Architektura\nModuł `store` zarządza stanem, `components` to UI, `services` to integracje.\nPatrz [api](../src/services/api.js).'),
      F('tests/format.test.js', "import { format } from '../src/utils/format.js';\ndescribe('format', ()=>{ it('trims', ()=>{ expect(format(' a ')).toBe('a'); }); });\n"),
      F('scripts/build.py', "import os, sys\nfrom pathlib import Path\n# prosty skrypt build\ndef build():\n    print('building...')\nif __name__=='__main__':\n    build()\n"),
    ];
  }
  function loadDemo(){ A.ingest(()=>Promise.resolve({files:demoFiles(), meta:{name:'demo-app', source:'demo: demo-app', kind:'demo', createdAt:Date.now()}}),I.t('ca.loadingDemo','Ładowanie projektu demo…')); }

  // ====================== ChatBot integration: app knowledge + action dispatcher ======================
  const CB_LAYOUTS=['pack','structtree','structradial','treemap','icicle','sunburst','force','layered','modules','arcdiagram','galaxy','nebula','cosmicrings'];
  // full, live snapshot of what the app currently is/shows — fed to ChatBot so it "knows everything"
  function appState(){
    const mind=document.body.classList.contains('mode-mindmap');
    const sel=A.renderer&&A.renderer.selected;
    const out={
      mode: mind?'mindmap':'codemap',
      hasProject: state.counts.nodes>0,
      project: _pn(A.graph&&A.graph.meta&&(A.graph.meta.name||A.graph.meta.source))||null,
      counts:{ nodes:state.counts.nodes, edges:state.counts.edges, visible:state.vis.nodes.length },
      layout: state.layout,
      filters:{ folders:filters.folders, files:filters.files, externals:filters.externals,
                contains:filters.contains, imports:filters.import, references:filters.reference,
                metric:filters.metric, minMetric:filters.minMetric },
      theme: document.body.classList.contains('light')?'light':'dark',
      lang: I.getLang(),
      impactView: !!A.impactOn,
      selected: sel?{name:_pn(sel.name), path:_pn(sel.path)||null, type:sel.type}:null,
      availableLayouts: CB_LAYOUTS,
      mindmap: (CM.MindMap&&CM.MindMap.isActive&&CM.MindMap.isActive())?{nodes:(CM.MindMap.nodeCount?CM.MindMap.nodeCount():0), name:_pn(CM.MindMap.mapName?CM.MindMap.mapName():'')}:null,
    };
    if(state.counts.nodes>0){ try{ out.structure=aiStructureSummary(); }catch(e){} }
    return out;
  }
  function _cb(id,val){ const e=$('#'+id); if(!e) return false; if(typeof val==='boolean') e.checked=val;
    e.dispatchEvent(new Event('change',{bubbles:true})); e.dispatchEvent(new Event('input',{bubbles:true})); return true; }
  function _needProject(){ if(state.counts.nodes===0) throw new Error(I.t('cb.noProject','Najpierw wczytaj projekt (CodeMap).')); }
  // execute a named action against the app; returns a short human result string (throws on error)
  function exec(action, args){
    args=args||{};
    switch(action){
      case 'loadDemo': loadDemo(); return I.t('cb.execDemo','Załadowano projekt demonstracyjny.');
      case 'setMode': { const m=(args.mode||'').toLowerCase(); if(m!=='codemap'&&m!=='mindmap') throw new Error('mode: codemap|mindmap'); A.setMode(m); return I.t('cb.execMode','Tryb: ')+m; }
      case 'setLayout': { _needProject(); const ly=(args.layout||'').toLowerCase(); if(CB_LAYOUTS.indexOf(ly)<0) throw new Error(I.t('cb.badLayout','Nieznany układ: ')+ly+' ('+CB_LAYOUTS.join(', ')+')');
        const s=$('#sel-layout'); s.value=ly; state.layout=ly; state.displayLayout=ly; A.apply({relayout:true,refit:true});
        const lbl=$('#layout-menu-label'), opt=s.querySelector('option[value="'+ly+'"]'); if(lbl&&opt) lbl.textContent=opt.textContent;
        return I.t('cb.execLayout','Układ: ')+ly; }
      case 'search': { const q=(args.query||'').trim(); const inp=$('#search-input'); inp.value=q; inp.dispatchEvent(new Event('input',{bubbles:true})); return I.t('cb.execSearch','Szukam: ')+q; }
      case 'focusNode': { _needProject(); const q=(args.query||args.name||'').toLowerCase().trim(); if(!q) throw new Error(I.t('cb.needName','Podaj nazwę elementu.'));
        let best=null,bs=-1; for(const n of A.graph.nodes.values()){ if(n.id==='__root__'||n.id==='__ext__')continue; const nm=(n.name||'').toLowerCase(),pt=(n.path||'').toLowerCase();
          let s=nm===q?100:(nm.indexOf(q)===0?70:(nm.indexOf(q)>=0?50:(pt.indexOf(q)>=0?30:-1))); if(s>bs){bs=s;best=n;} }
        if(!best) throw new Error(I.t('cb.notFound','Nie znaleziono: ')+q); A.focusNode(best.id); return I.t('cb.execFocus','Skupiono na: ')+best.name; }
      case 'fit': if(A.renderer&&A.renderer.fit) A.renderer.fit(); return I.t('cb.execFit','Dopasowano widok.');
      case 'toggleImpact': _needProject(); A.toggleImpact(); return I.t('cb.execImpact','Przełączono widok wpływu zależności.');
      case 'setFilter': { const map={folders:'show-folders',files:'show-files',externals:'show-externals',contains:'edge-contains',imports:'edge-import',import:'edge-import',references:'edge-reference',reference:'edge-reference'};
        const ch=[]; for(const k in args){ const id=map[k]; if(id&&typeof args[k]==='boolean'){ if(_cb(id,args[k])) ch.push(k+'='+args[k]); } }
        if(!ch.length) throw new Error(I.t('cb.noFilter','Brak rozpoznanych filtrów (folders/files/externals/imports/references/contains).')); return I.t('cb.execFilter','Filtry: ')+ch.join(', '); }
      case 'openSettings': if(CM.Settings) CM.Settings.open(args.tab||undefined); return I.t('cb.execSettings','Otwarto Ustawienia.');
      case 'openDrive': if(CM.Drive) CM.Drive.open(args.tab||undefined); return I.t('cb.execDrive','Otwarto Dysk i Sejf.');
      case 'saveMap': _needProject(); $('#btn-save').click(); return I.t('cb.execSave','Zapisano mapę do pliku .json.');
      case 'snapshot': _needProject(); $('#btn-snapshot').click(); return I.t('cb.execSnap','Zapisano migawkę.');
      case 'detectCycles': _needProject(); $('#btn-cycles').click(); return I.t('cb.execCycles','Wykrywanie cykli zależności.');
      case 'hotspots': _needProject(); $('#btn-hotspots').click(); return I.t('cb.execHot','Pokazano hotspoty.');
      case 'setTheme': { const th=(args.theme||'').toLowerCase()==='light'?'light':'dark'; const b=document.querySelector('.theme-btn[data-theme="'+th+'"]'); if(b) b.click(); return I.t('cb.execTheme','Motyw: ')+th; }
      case 'setPreset': { const k=(args.name||args.preset||'').toLowerCase();
        if(!THEME_PRESETS[k]||!A._applyThemePreset) throw new Error(I.t('cb.badPreset','Nieznany preset: ')+k+' ('+Object.keys(THEME_PRESETS).join(', ')+')');
        A._applyThemePreset(k); A.saveSettings(); return I.t('cb.execPreset','Preset motywu: ')+k; }
      case 'setAccent': { const c=args.color; if(!c||!/^#?[0-9a-f]{3,8}$/i.test(c)) throw new Error(I.t('cb.badColor','Podaj kolor HEX, np. #22d3ee.')); const e=$('#col-accent'); e.value=c[0]==='#'?c:('#'+c); e.dispatchEvent(new Event('input',{bubbles:true})); return I.t('cb.execAccent','Kolor akcentu: ')+e.value; }
      case 'setLang': { const l=(args.lang||'').toLowerCase(); if(l!=='pl'&&l!=='en') throw new Error('lang: pl|en'); I.setLang(l); return I.t('cb.execLang','Język: ')+l; }
      case 'startTutorial': { const m=(args.mode||'codemap').toLowerCase(); if(m!=='codemap'&&m!=='mindmap') throw new Error('mode: codemap|mindmap');
        if(CM.Settings&&CM.Settings.close) CM.Settings.close(); CM.Settings.startTutorial(m); return I.t('cb.execTut','Uruchomiono samouczek: ')+m; }
      case 'loadRepo': { const u=(args.url||'').trim(); if(!u) throw new Error(I.t('cb.needUrl','Podaj adres repozytorium (GitHub/GitLab/Bitbucket).'));
        A.ingest((p,s)=>Loaders.fromRepoURL(u,{branch:args.branch,fetchContent:true},p,s), I.t('ca.connectingToRepo','Łączenie z repozytorium…'));
        return I.t('cb.execRepo','Wczytuję repozytorium: ')+u; }
      case 'clearProject': _needProject(); A.clearAll(); return I.t('cb.execClear','Wyczyszczono projekt.');
      case 'togglePanel': { const side=(args.side||'').toLowerCase(); if(side!=='left'&&side!=='right') throw new Error('side: left|right');
        const p=$('#'+side+'-panel'); const collapsed=p.classList.contains('collapsed');
        const want=(typeof args.open==='boolean')?args.open:collapsed;
        if(want===collapsed) A.togglePanel(side); return I.t('cb.execPanel','Panel ')+side+': '+(want?I.t('cb.on','wł'):I.t('cb.off','wył')); }
      case 'zoom': { const d=(args.dir||'').toLowerCase(); const id=d==='out'?'vc-zoom-out':'vc-zoom-in'; const b=$('#'+id); if(b) b.click(); return I.t('cb.execZoom','Zoom: ')+(d==='out'?'−':'+'); }
      case 'rotate': { const d=(args.dir||'').toLowerCase(); const id=d==='left'?'vc-rot-left':d==='right'?'vc-rot-right':'vc-rot-reset'; const b=$('#'+id); if(b) b.click(); return I.t('cb.execRotate','Obrót: ')+d; }
      case 'toggle3D': { const b=$('#vc-3d'); if(b) b.click(); return I.t('cb.exec3D','Przełączono widok 3D.'); }
      case 'flyMode': { const b=$('#vc-fly'); if(b) b.click(); return I.t('cb.execFly','Przełączono tryb lotu (WASD).'); }
      case 'collapseAll': { _needProject(); const b=$('#vc-collapse'); if(b) b.click(); return I.t('cb.execCollapse','Zwinięto/rozwinięto foldery.'); }
      case 'toggleMinimap': { const b=$('#minimap-toggle'); if(b) b.click(); return I.t('cb.execMinimap','Przełączono minimapę.'); }
      case 'openHistory': { _needProject(); $('#btn-history').click(); return I.t('cb.execHist','Otwarto historię migawek.'); }
      case 'openCompare': { $('#btn-compare-add').click(); return I.t('cb.execCompare','Otwarto porównywanie schematów.'); }
      case 'exportImage': { _needProject(); $('#btn-export-img').click(); return I.t('cb.execImg','Eksportuję obraz mapy.'); }
      case 'exportGraph': { _needProject(); const f=(args.format||'dot').toLowerCase();
        if(!CM.Export||CM.Export.FORMATS.indexOf(f)<0) throw new Error(I.t('cb.badFormat','Nieznany format: ')+f+' ('+(CM.Export?CM.Export.FORMATS.join(', '):'')+')');
        const r=CM.Export.download(A.graph, filters, f); return I.t('cb.execExportGraph','Eksportuję widoczny graf: ')+r.filename+' ('+r.nodes+' / '+r.edges+')'; }
      case 'copyLink': A.copyViewLink(); return I.t('cb.execLink','Kopiuję link do bieżącego widoku.');
      case 'setSpacing': case 'setNodeScale': case 'setFontScale': {
        const id=action==='setSpacing'?'rng-spacing':action==='setNodeScale'?'rng-nscale':'rng-fscale';
        const v=+args.percent; if(!isFinite(v)) throw new Error(I.t('cb.needPercent','Podaj wartość procentową, np. 120.'));
        const e=$('#'+id); e.value=Math.round(v); e.dispatchEvent(new Event('input',{bubbles:true}));
        return I.t('cb.execSlider','Ustawiono ')+id.replace('rng-','')+': '+e.value+'%'; }
      case 'setGlass': { const map={transparency:'rng-trans',menu:'rng-menu',blur:'rng-blur',tint:'rng-tint'}; const ch=[];
        for(const k in map){ if(typeof args[k]==='number'){ const e=$('#'+map[k]); if(e){ e.value=Math.round(args[k]); e.dispatchEvent(new Event('input',{bubbles:true})); ch.push(k+'='+e.value); } } }
        if(!ch.length) throw new Error(I.t('cb.noGlass','Podaj transparency/menu/blur/tint (liczby).')); return I.t('cb.execGlass','Wygląd: ')+ch.join(', '); }
      case 'setBackground': { const c=args.color; if(!c||!/^#?[0-9a-f]{3,8}$/i.test(c)) throw new Error(I.t('cb.badColor','Podaj kolor HEX, np. #22d3ee.')); const e=$('#col-bg'); e.value=c[0]==='#'?c:('#'+c); e.dispatchEvent(new Event('input',{bubbles:true})); return I.t('cb.execBg','Kolor tła: ')+e.value; }
      case 'resetAppearance': A.resetAppearance(); return I.t('cb.execResetApp','Przywrócono domyślny wygląd.');
      case 'renderOption': { const map={grid:'opt-grid',curved:'opt-curved',lockall:'opt-lockall',hoverPreview:'opt-hover-preview'}; const ch=[];   // glow/particles/animate removed — edge animation was dropped, those opts no longer affect rendering
        for(const k in args){ const id=map[k]; if(id&&typeof args[k]==='boolean'){ if(_cb(id,args[k])) ch.push(k+'='+args[k]); } }
        if(!ch.length) throw new Error(I.t('cb.noOpt','Brak rozpoznanych opcji (grid/curved/lockall/hoverPreview).')); return I.t('cb.execOpt','Opcje: ')+ch.join(', '); }
      case 'setMetric': { _needProject(); if(args.metric){ const s=$('#sel-metric'); s.value=args.metric; s.dispatchEvent(new Event('change',{bubbles:true})); }
        if(typeof args.min==='number'){ const r=$('#rng-minmetric'); r.value=args.min; r.dispatchEvent(new Event('input',{bubbles:true})); }
        return I.t('cb.execMetric','Metryka: ')+(args.metric||filters.metric)+(typeof args.min==='number'?(' ≥ '+args.min):''); }
      case 'toggleLang': { _needProject(); const k=(args.lang||'').toLowerCase(); if(!k) throw new Error(I.t('cb.needLangKey','Podaj język/technologię, np. js.'));
        if(!A.graph.langStats.has(k)) throw new Error(I.t('cb.notFound','Nie znaleziono: ')+k+' ('+Array.from(A.graph.langStats.keys()).join(', ')+')');
        A.toggleLang(k); A.apply({relayout:false}); return I.t('cb.execToggleLang','Przełączono widoczność: ')+k; }
      case 'openNode': { _needProject(); const r=exec('focusNode',args); const n=A.renderer.selected; if(n&&n.type==='file'){ handlers.openFile(n); return I.t('cb.execOpenFile','Otwarto podgląd pliku: ')+n.name; } return r; }
      case 'aiAnalyze': _needProject(); aiAnalyze(); return I.t('cb.execAnalyze','Uruchomiono analizę struktury AI.');
      case 'inspect': case 'runInspection': { _needProject(); if(CM.Inspect&&CM.Inspect.open){ CM.Inspect.open(); return I.t('cb.execInspect','Uruchomiono analizę statyczną (antywzorce).'); } throw new Error(I.t('cb.noInspect','Moduł analizy niedostępny.')); }
      case 'mindmap': { const a=(args.action||'').toLowerCase(); const ids={arrange:'mm-arrange',layout:'mm-layout',fit:'mm-fit',save:'mm-save',markdown:'mm-markdown',undo:'mm-undo'};
        if(!(a in ids)) throw new Error('action: arrange|layout|fit|save|markdown|undo');
        if(!document.body.classList.contains('mode-mindmap')) A.setMode('mindmap');
        const go=()=>{ const b=document.getElementById(ids[a]); if(b) b.click(); }; setTimeout(go,260);
        return I.t('cb.execMind','MindMap: ')+a; }
      case 'installPWA': if(state._installApp){ state._installApp(); return I.t('cb.execPWA','Uruchomiono instalację aplikacji.'); } throw new Error(I.t('cb.noPWA','Instalacja PWA niedostępna w tej chwili.'));
      // ---- narzędzia „/" ChatBota: statystyki, listy, wyszukiwanie w treści, zależności ----
      case 'stats': { _needProject(); const g=A.graph; let files=0, folders=0, ext=0, lines=0; const langs=new Map(); const big=[];
        for(const n of g.nodes.values()){ if(n.type==='file'){ files++; lines+=n.metrics?n.metrics.lines:0; const l=(n.langInfo&&n.langInfo.name)||n.lang; langs.set(l,(langs.get(l)||0)+1); big.push(n); }
          else if(n.type==='external') ext++; else if(n.id!=='__root__'&&n.id!=='__ext__') folders++; }
        big.sort((a,b)=>((b.metrics&&b.metrics.lines)||0)-((a.metrics&&a.metrics.lines)||0));
        const cyc=g.importCycles?g.importCycles().components.length:0;
        const top=[...langs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>k+' ×'+v).join(', ');
        return I.t('cb.stats','Pliki: ')+files+' · '+I.t('cb.statsFolders','foldery: ')+folders+' · '+I.t('cb.statsExt','zewnętrzne: ')+ext+' · '+I.t('cb.statsLines','linie: ')+lines
          +' · '+I.t('cb.statsCycles','cykle: ')+cyc+'\n'+I.t('cb.statsLangs','Języki: ')+top+'\n'+I.t('cb.statsBig','Największe: ')+big.slice(0,5).map(n=>n.name+' ('+((n.metrics&&n.metrics.lines)||0)+')').join(', '); }
      case 'topFiles': { _needProject(); const g=A.graph; const metric=(args.metric||'lines').toLowerCase(); const n=Math.max(1,Math.min(50,+args.n||10));
        const val=(x)=>metric==='size'?(x.size||0):metric==='deps'?((x.importsIn||[]).length+(x.importsOut||[]).length):((x.metrics&&x.metrics[metric])||0);
        const list=[...g.nodes.values()].filter(x=>x.type==='file').sort((a,b)=>val(b)-val(a)).slice(0,n);
        if(A.renderer){ A.renderer.highlight=new Set(list.map(x=>x.id)); A.renderer.kick(); }
        return I.t('cb.topFiles','Top wg ')+metric+': '+list.map(x=>x.name+' ('+val(x)+')').join(', '); }
      case 'findText': { _needProject(); const q=String(args.query||'').trim(); if(!q) throw new Error(I.t('cb.needQuery','Podaj szukaną frazę.'));
        const ql=q.toLowerCase(); const hits=[]; for(const x of A.graph.nodes.values()){ if(x.type==='file'&&x.preview&&String(x.preview).toLowerCase().includes(ql)) hits.push(x); if(hits.length>=200) break; }
        if(A.renderer){ A.renderer.highlight=hits.length?new Set(hits.map(x=>x.id)):null; A.renderer.kick(); }
        if(!hits.length) return I.t('cb.findNone','Brak plików zawierających: ')+q;
        return I.t('cb.findHits','Znaleziono w ')+hits.length+': '+hits.slice(0,25).map(x=>x.path||x.name).join(', ')+(hits.length>25?' …':''); }
      case 'listLang': { _needProject(); const k=String(args.lang||'').toLowerCase().trim(); if(!k) throw new Error(I.t('cb.needLangKey','Podaj język/technologię, np. js.'));
        const list=[...A.graph.nodes.values()].filter(x=>x.type==='file'&&(String(x.lang).toLowerCase()===k||String((x.langInfo&&x.langInfo.name)||'').toLowerCase()===k));
        if(!list.length) throw new Error(I.t('cb.notFound','Nie znaleziono: ')+k+' ('+Array.from(A.graph.langStats.keys()).join(', ')+')');
        if(A.renderer){ A.renderer.highlight=new Set(list.map(x=>x.id)); A.renderer.kick(); }
        return k+': '+list.length+' — '+list.slice(0,30).map(x=>x.name).join(', ')+(list.length>30?' …':''); }
      case 'dependsOn': case 'dependencies': { _needProject(); const q=String(args.query||args.name||'').toLowerCase().trim(); if(!q) throw new Error(I.t('cb.needName','Podaj nazwę elementu.'));
        let best=null,bs=-1; for(const x of A.graph.nodes.values()){ if(x.id==='__root__'||x.id==='__ext__') continue; const nm=(x.name||'').toLowerCase(), pt=(x.path||'').toLowerCase();
          const sc=nm===q?100:(nm.indexOf(q)===0?70:(nm.indexOf(q)>=0?50:(pt.indexOf(q)>=0?30:-1))); if(sc>bs){bs=sc;best=x;} }
        if(!best) throw new Error(I.t('cb.notFound','Nie znaleziono: ')+q);
        const imp=A.graph.impactSet(best.id); const set=action==='dependsOn'?imp.up:imp.down;
        const names=[...set].map(id=>(A.graph.nodes.get(id)||{}).name||id);
        if(A.renderer){ A.renderer.highlight=new Set([best.id, ...set]); A.renderer.kick(); }
        return best.name+(action==='dependsOn'?I.t('cb.depOn',' — zależą od niego: '):I.t('cb.depOf',' — zależy od: '))+(names.length?names.slice(0,40).join(', ')+(names.length>40?' …':''):I.t('cb.depNone','(nic)')); }
      case 'explain': { _needProject(); const q=String(args.query||args.name||'').trim(); if(q) exec('focusNode',{query:q});
        const node=A.renderer&&A.renderer.selected; if(!node) throw new Error(I.t('cb.needName','Podaj nazwę elementu.'));
        A.aiAskNode(node, I.t('cb.explainQ','Wyjaśnij rolę tego elementu w projekcie i co warto o nim wiedzieć.')).then(txt=>{ if(CM.UI&&CM.UI.renderDetails) U.toast(String(txt||'').slice(0,400), 'info', 12000); }).catch(e=>U.toast((e&&e.message)||String(e),'error'));
        return I.t('cb.explainRun','Pytam AI o: ')+node.name; }
      case 'clearChat': { if(CM.ChatBot&&CM.ChatBot._newChat) CM.ChatBot._newChat(); return I.t('cb.execClearChat','Nowa rozmowa.'); }
      case 'help': case 'listActions': return I.t('cb.execHelp','Dostępne akcje: ')+CB_ACTIONS.join(', ');
      default: throw new Error(I.t('cb.unknownAction','Nieznana akcja: ')+action+'. '+I.t('cb.execHelp','Dostępne akcje: ')+CB_ACTIONS.join(', '));
    }
  }
  // canonical action list — also injected into the ChatBot system prompt so the model knows the full API
  const CB_ACTIONS=['loadDemo','loadRepo','clearProject','setMode','setLayout','search','focusNode','openNode','fit',
    'zoom','rotate','toggle3D','flyMode','collapseAll','toggleImpact','toggleMinimap','setFilter','setMetric','toggleLang',
    'openSettings','openDrive','openHistory','openCompare','saveMap','snapshot','exportImage','exportGraph','copyLink','detectCycles',
    'hotspots','inspect','aiAnalyze','setTheme','setPreset','setAccent','setBackground','setGlass','setSpacing','setNodeScale','setFontScale',
    'renderOption','resetAppearance','togglePanel','setLang','startTutorial','mindmap','installPWA','help',
    'stats','topFiles','findText','listLang','dependsOn','dependencies','explain','clearChat'];

  Object.assign(A, {
    paletteCommands, buildPalette, aiStructureSummary, aiKeyList, aiModel, aiConfigured, aiGuard, aiChat,
    aiAnalyze, aiAsk, aiAskNode, demoFiles, loadDemo, appState, _cb, _needProject,
    exec,
  });
})();
