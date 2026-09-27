/* ===================== tour.js — trasy po kodzie (onboarding, faza 7) ===================== */
// Uporządkowana ścieżka po plikach projektu z notatką przy każdym kroku: „zacznij tu, potem to, bo…". Ten moduł jest
// czysty (bez DOM): trasa automatyczna z samej struktury mapy (opis → punkty wejścia → rdzeń, od którego zależy
// najwięcej plików → hotspot → testy rdzenia), walidacja kroków na bieżącym grafie, prompt dla modelu (TYLKO struktura:
// ścieżki, metryki, zależności, nazwy symboli — zgodnie z zasadą, że do chmury nie trafia treść plików) i jego parser,
// format CodeTour z VS Code (.tours/*.tour) w obie strony oraz kodowanie trasy w linku (#tour=…, deflate + base64url).
// Odtwarzacz na mapie, menu i akcja ChatBota: tour-ui.js.
CM.Tour = (function(){
  const MAX_STEPS = 12, MAX_NOTE = 400;
  const STR = {
    pl:{title:'Trasa po projekcie', readme:'Zacznij od opisu projektu — cel, instalacja, najważniejsze pojęcia.',
      entry:(n, outs)=>'Punkt wejścia — stąd startuje aplikacja; importowane pliki: '+n+(outs?' ('+outs+')':'')+'.',
      core:(n, lines, cx)=>'Rdzeń — zależne pliki: '+n+'; wiersze: '+lines+', złożoność: '+cx+'. Zmiana tutaj rozchodzi się szeroko.',
      hot:(lines, cx, ch)=>'Hotspot — '+(ch?'zmiany w historii: '+ch+'; ':'')+'wiersze: '+lines+', złożoność: '+cx+'. Tu trzeba najbardziej uważać.',
      test:(of)=>'Testy rdzenia ('+of+') — najszybszy sposób, żeby zobaczyć, jak kod ma działać.',
      folder:(f, n)=>'Moduł „'+f+'" (pliki: '+n+') — największy i najbardziej złożony plik tej części.'},
    en:{title:'Project tour', readme:'Start with the project description — purpose, setup, key concepts.',
      entry:(n, outs)=>'Entry point — the application starts here; imported files: '+n+(outs?' ('+outs+')':'')+'.',
      core:(n, lines, cx)=>'Core — dependent files: '+n+'; lines: '+lines+', complexity: '+cx+'. A change here spreads widely.',
      hot:(lines, cx, ch)=>'Hotspot — '+(ch?'changes in history: '+ch+'; ':'')+'lines: '+lines+', complexity: '+cx+'. The place to be most careful.',
      test:(of)=>'Tests of the core ('+of+') — the quickest way to see how the code is meant to behave.',
      folder:(f, n)=>'Module "'+f+'" (files: '+n+') — the largest and most complex file of this part.'}};
  const S = (lang)=>STR[lang==='en'?'en':'pl'];
  const files = (g)=>[...g.nodes.values()].filter(n=>n.type==='file' && n.path);
  const base = (p)=>String(p).split('/').pop();
  const cx = (n)=>(n.metrics&&n.metrics.complexity)||0, ln = (n)=>(n.metrics&&n.metrics.lines)||0;
  const isDoc = (n)=>/^readme(\.|$)/i.test(base(n.path));
  const isTest = (n)=>!!n.isTest || /(^|\/)(tests?|__tests__|spec)\//i.test(n.path) || /\.(test|spec)\.[a-z]+$/i.test(n.path);

  // ---------------- trasa automatyczna (bez modelu) ----------------
  function auto(g, o){
    o=o||{}; const s=S(o.lang), all=files(g), used=new Set(), steps=[];
    const add=(n, note, kind)=>{ if(!n || used.has(n.path) || steps.length>=(o.max||8)) return; used.add(n.path); steps.push({path:n.path, line:1, note, kind}); };
    const code=all.filter(n=>n.metrics && !isTest(n) && !isDoc(n));
    const readme=all.filter(isDoc).sort((a,b)=>a.path.split('/').length-b.path.split('/').length)[0];
    if(readme) add(readme, s.readme, 'readme');
    // tylko pliki projektu (bez zależności zewnętrznych ext:…); przychodzące tylko z kodu — link w README do
    // index.html nie odbiera mu roli punktu wejścia
    const outs=(n)=>(n.importsOut||[]).filter(id=>{ const m=g.nodes.get(id); return m && m.type==='file'; });
    const ins=(n)=>(n.importsIn||[]).filter(id=>{ const m=g.nodes.get(id); return m && m.type==='file' && !isDoc(m) && !/\.(md|mdx|markdown|rst|txt|adoc)$/i.test(m.path||''); });
    const hasImports=code.some(n=>ins(n).length);
    if(hasImports){
      const entryRe=/^(index|main|app|server|cli|program|__main__)\.[a-z]+$/i;
      const entries=code.filter(n=>!ins(n).length && outs(n).length)
        .sort((a,b)=>(entryRe.test(base(b.path))-entryRe.test(base(a.path))) || (outs(b).length-outs(a).length) || (a.path.split('/').length-b.path.split('/').length));
      for(const e of entries.slice(0, 2)){ const o=outs(e); add(e, s.entry(o.length, o.slice(0,3).map(id=>base(g.nodes.get(id).path)).join(', ')), 'entry'); }
      const core=code.filter(n=>ins(n).length>=2).sort((a,b)=>(ins(b).length-ins(a).length) || (cx(b)-cx(a)));
      for(const c of core.slice(0, 3)) add(c, s.core(ins(c).length, ln(c), cx(c)), 'core');
    } else {
      // bez krawędzi importów (np. skrypty <script>): po jednym najcięższym pliku z największych folderów
      const byFolder=new Map(); for(const n of code){ const f=n.path.includes('/')?n.path.split('/')[0]:'.'; if(!byFolder.has(f)) byFolder.set(f, []); byFolder.get(f).push(n); }
      const folders=[...byFolder.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0, 3);
      for(const [f, list] of folders){ const best=list.slice().sort((a,b)=>cx(b)*ln(b)-cx(a)*ln(a))[0]; add(best, s.folder(f, list.length), 'module'); }
    }
    const score=(n)=>n.git&&n.git.c ? n.git.c*(cx(n)||ln(n)/40) : cx(n)*Math.sqrt(ln(n)||1);
    const hot=code.filter(n=>!used.has(n.path)).sort((a,b)=>score(b)-score(a))[0];
    if(hot) add(hot, s.hot(ln(hot), cx(hot), hot.git&&hot.git.c), 'hotspot');
    const coreStep=steps.find(x=>x.kind==='core'||x.kind==='module'||x.kind==='entry');
    const coreNode=coreStep && g.nodes.get(coreStep.path) || [...g.nodes.values()].find(n=>n.path===(coreStep&&coreStep.path));
    const t=coreNode && (coreNode.testedBy||[]).map(id=>g.nodes.get(id)).find(Boolean);
    if(t) add(t, s.test(base(coreNode.path)), 'test');
    return {title:(o.title||s.title)+(g.meta&&g.meta.name?' — '+g.meta.name:''), steps, source:'auto'};
  }

  // ---------------- walidacja na bieżącym grafie ----------------
  function byPath(g){ const m=new Map(); for(const n of files(g)) m.set(n.path, n); return m; }
  function resolve(g, p){
    const m=byPath(g); p=String(p||'').replace(/\\/g,'/').replace(/^\.?\//,'').trim(); if(!p) return null;
    if(m.has(p)) return m.get(p);
    const hits=[...m.keys()].filter(k=>k.endsWith('/'+p)); if(hits.length===1) return m.get(hits[0]);
    return null;
  }
  // → {title, steps:[{path, line, note, kind?}], dropped} (kroki z nieistniejącymi plikami odrzucone)
  function validate(g, tour){
    if(!tour || !Array.isArray(tour.steps)) return null;
    const steps=[], seen=new Set(); let dropped=0;
    for(const s of tour.steps.slice(0, MAX_STEPS*2)){
      const n=s && resolve(g, s.path||s.file); if(!n || seen.has(n.path)){ dropped++; continue; }
      seen.add(n.path);
      const line=Math.max(1, Math.min(ln(n)||1, parseInt(s.line, 10)||1));
      steps.push({path:n.path, line, note:String(s.note||s.description||'').replace(/\s+/g,' ').trim().slice(0, MAX_NOTE), kind:s.kind||''});
      if(steps.length>=MAX_STEPS) break;
    }
    return steps.length ? {title:String(tour.title||'').trim().slice(0, 120)||'Tour', steps, dropped, source:tour.source||''} : null;
  }

  // ---------------- model: prompt ze struktury i parser odpowiedzi ----------------
  function candidates(g, max){
    const code=files(g).filter(n=>n.metrics), picked=new Map();
    const add=(n)=>{ if(n && !picked.has(n.path) && picked.size<(max||60)) picked.set(n.path, n); };
    files(g).filter(isDoc).slice(0, 2).forEach(add);
    code.slice().sort((a,b)=>((b.importsIn||[]).length-(a.importsIn||[]).length)).slice(0, 18).forEach(add);
    code.filter(n=>!(n.importsIn||[]).length && (n.importsOut||[]).length).sort((a,b)=>(b.importsOut||[]).length-(a.importsOut||[]).length).slice(0, 8).forEach(add);
    code.slice().sort((a,b)=>cx(b)-cx(a)).slice(0, 18).forEach(add);
    code.filter(isTest).slice(0, 6).forEach(add);
    code.slice().sort((a,b)=>ln(b)-ln(a)).forEach(add);
    return [...picked.values()];
  }
  function prompt(g, lang){
    const L=lang==='en'?'English':'Polish', P=(id)=>(g.nodes.get(id)||{}).path||id;
    const rows=candidates(g, 60).map(n=>{
      const r={path:n.path, lines:ln(n), complexity:cx(n), usedBy:(n.importsIn||[]).length, imports:(n.importsOut||[]).slice(0,5).map(P)};
      if(n.symbols&&n.symbols.length) r.symbols=n.symbols.slice(0,6).map(x=>x.name);
      if(n.git&&n.git.c) r.changes=n.git.c;
      if(isTest(n)) r.test=true;
      return r; });
    const sys='You design an onboarding tour through a codebase for a developer who has never seen it. You receive ONLY the project structure (paths, metrics, dependencies, symbol names) — never source code. '+
      'Pick 5–8 files in the order a newcomer should read them (overview → entry points → core modules → important flows → tests) and write one or two sentences per step: what the file is for and what to notice. '+
      'Use ONLY paths from the list. Reply with JSON only: {"title": string, "steps": [{"path": string, "note": string}]}. Title and notes in '+L+'.';
    const user='Project: '+((g.meta&&g.meta.name)||'project')+'\nFiles (JSON):\n'+JSON.stringify(rows);
    return [{role:'system', content:sys}, {role:'user', content:user}];
  }
  function parse(text){
    const s=String(text||'').replace(/<think>[\s\S]*?<\/think>/gi, '');
    const cands=[]; const fence=/```(?:json)?\s*([\s\S]*?)```/g; let m; while((m=fence.exec(s))) cands.push(m[1]);
    const a=s.indexOf('{'), b=s.lastIndexOf('}'); if(a>=0 && b>a) cands.push(s.slice(a, b+1));
    for(const c of cands){ try{ const j=JSON.parse(c.trim()); if(j && Array.isArray(j.steps)) return j; if(Array.isArray(j)) return {steps:j}; }catch(e){} }
    return null;
  }

  // ---------------- CodeTour (VS Code, .tours/*.tour) ----------------
  function toCodeTour(t){ return {$schema:'https://aka.ms/codetour-schema', title:t.title, steps:t.steps.map(s=>({file:s.path, line:s.line||1, description:s.note||''}))}; }
  function fromCodeTour(j){ if(!j || !Array.isArray(j.steps)) return null;
    return {title:j.title||'', steps:j.steps.filter(s=>s && s.file).map(s=>({path:s.file, line:s.line||1, note:s.description||''})), source:'codetour'}; }

  // ---------------- link: #tour=z<deflate-raw base64url> (albo j<base64url JSON> bez CompressionStream) ----------------
  const b64u=(bytes)=>{ let s=''; for(let i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
  const unb64u=(str)=>{ const s=atob(String(str).replace(/-/g,'+').replace(/_/g,'/')); const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u; };
  const compact=(t)=>({t:t.title, s:t.steps.map(x=>x.line>1?[x.path, x.note, x.line]:[x.path, x.note])});
  const expand=(c)=>c && Array.isArray(c.s) ? {title:c.t||'', steps:c.s.map(a=>({path:a[0], note:a[1]||'', line:a[2]||1})), source:'link'} : null;
  async function encode(t){
    const raw=new TextEncoder().encode(JSON.stringify(compact(t)));
    if(typeof CompressionStream==='function'){ const buf=await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(); return 'z'+b64u(new Uint8Array(buf)); }
    return 'j'+b64u(raw);
  }
  async function decode(str){
    try{ str=String(str||''); if(str.length>12000) return null;
      let bytes=unb64u(str.slice(1));
      if(str[0]==='z'){ if(typeof DecompressionStream!=='function') return null; bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
      else if(str[0]!=='j') return null;
      if(bytes.length>60000) return null;
      return expand(JSON.parse(new TextDecoder().decode(bytes)));
    }catch(e){ return null; }
  }

  return {auto, validate, resolve, prompt, parse, candidates, toCodeTour, fromCodeTour, encode, decode, MAX_STEPS};
})();
