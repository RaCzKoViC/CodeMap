/* ===================== agent.js — ChatBot z narzędziami w pętli (faza 7) ===================== */
// Model lokalny (Ollama) sam zbiera informacje przed odpowiedzią: szuka w kodzie, czyta fragmenty plików, sprawdza
// zależności, właścicieli, testy i hotspoty. Narzędzia DO ODCZYTU (nic nie zmienia plików ani danych mapy) + jedno
// widokowe — showOnMap podświetla pliki i ustawia na nich kamerę (ctx.view; bez niego tylko opis).
// Odporność na różne modele: natywne tool_calls (llama3.x, qwen3), JSON wywołania w treści (qwen2.5-coder)
// i modele ignorujące narzędzia — pierwsza wiadomość i tak zawiera wyniki wyszukiwania (jak tryb RAG),
// więc odpowiedź jest ugruntowana. Pętla (run) nie zna DOM ani Ollamy — chat() jest wstrzykiwany (testy w Node).
CM.Agent = (function(){
  const MAX_STEPS=5, MAX_READ=150;
  // odpowiedź-wymówka („trzeba by zajrzeć do pliku…") zamiast użycia narzędzia — jedno ponaglenie
  const HEDGE=/(would need to (inspect|look|check|see|examine)|need to (inspect|look at|check)|i (don't|do not) have (direct )?access|cannot (see|determine) (the|this)|without (access|seeing)|trzeba by (zajrzeć|sprawdzić|przejrzeć)|nie mam (bezpośredniego )?dostępu|należałoby (zajrzeć|sprawdzić|przejrzeć)|musiał(bym|abym) (zajrzeć|sprawdzić)|(you|one) (should|can|could|may) (inspect|check|look (at|for)|examine)|to get a (more )?precise answer|powinieneś (zajrzeć|sprawdzić)|warto (zajrzeć|sprawdzić) (do|w) pli)/i;

  const TOOLS=[
    {name:'codeSearch', description:'Search the project source code (keywords + semantic). Returns numbered snippets [n] with file:lines.',
      parameters:{type:'object', properties:{query:{type:'string', description:'what to look for (identifiers, concepts)'}, k:{type:'integer', description:'max snippets (1-8)'}}, required:['query']}},
    {name:'readFile', description:'Read lines of a project file (1-based, at most 150 lines). Use after codeSearch to see more context.',
      parameters:{type:'object', properties:{path:{type:'string'}, start:{type:'integer'}, end:{type:'integer'}}, required:['path']}},
    {name:'findFiles', description:'Find project files whose path or name contains a text fragment.',
      parameters:{type:'object', properties:{query:{type:'string'}}, required:['query']}},
    {name:'dependencies', description:'Files that the given file imports (direct dependencies).',
      parameters:{type:'object', properties:{path:{type:'string'}}, required:['path']}},
    {name:'dependents', description:'Files that import the given file (who depends on it, up to 2 levels).',
      parameters:{type:'object', properties:{path:{type:'string'}}, required:['path']}},
    {name:'fileInfo', description:'Facts about a file: lines, complexity, symbols, git owner and change count, tests and coverage.',
      parameters:{type:'object', properties:{path:{type:'string'}}, required:['path']}},
    {name:'hotspots', description:'Riskiest files of the project: change frequency × complexity (git) or size × dependencies.',
      parameters:{type:'object', properties:{n:{type:'integer'}}, required:[]}},
    {name:'owners', description:'Who owns the project, a folder or a file according to git history: authors with shares and the bus factor.',
      parameters:{type:'object', properties:{path:{type:'string', description:'file or folder; omit for the whole project'}}, required:[]}},
    {name:'tests', description:'Which tests cover a file or folder; without path a project summary with the most complex untested files.',
      parameters:{type:'object', properties:{path:{type:'string', description:'file or folder; omit for the whole project'}}, required:[]}},
    {name:'showOnMap', description:'Highlight files on the user\'s code map (and move the camera to the first one) — use it to point at the files your answer is about.',
      parameters:{type:'object', properties:{paths:{type:'array', items:{type:'string'}, description:'project file paths (max 30)'}}, required:['paths']}},
  ];
  const NAMES=new Set(TOOLS.map(t=>t.name));
  function ollamaTools(){ return TOOLS.map(t=>({type:'function', function:{name:t.name, description:t.description, parameters:t.parameters}})); }

  // ---------------- wywołania narzędzi z odpowiedzi modelu ----------------
  // natywne: [{function:{name, arguments}}]; zapasowo JSON w treści: {"name":…,"arguments":{…}} (także w ```json```),
  // nazwa dopasowana także po opisie narzędzia (qwen2.5-coder potrafi podać opis zamiast nazwy)
  function resolveName(n){
    if(NAMES.has(n)) return n;
    const s=String(n||'').toLowerCase();
    const byCase=TOOLS.find(t=>t.name.toLowerCase()===s); if(byCase) return byCase.name;
    const byDesc=TOOLS.find(t=>t.description.toLowerCase().startsWith(s.slice(0,24)) && s.length>=6); return byDesc?byDesc.name:null;
  }
  function parseArgs(a){ if(a && typeof a==='object') return a; try{ return JSON.parse(a||'{}'); }catch(e){ return {}; } }
  function toolCalls(msg){
    const out=[], unknown=[];
    for(const c of (msg&&msg.tool_calls)||[]){ const f=c.function||c; const name=resolveName(f.name); if(name) out.push({name, args:parseArgs(f.arguments)}); }
    if(out.length) return {calls:out, native:true};
    const text=String((msg&&msg.content)||'').trim();
    const cands=[]; const fence=/```(?:json)?\s*([\s\S]*?)```/g; let m; while((m=fence.exec(text))) cands.push(m[1]);
    if(/^\s*[[{]/.test(text)) cands.push(text);
    for(const c of cands){ let j; try{ j=JSON.parse(c.trim()); }catch(e){ continue; }
      for(const x of (Array.isArray(j)?j:[j])){ if(!x||typeof x!=='object') continue; const raw=x.name||x.tool||x.function; const name=resolveName(raw);
        if(name) out.push({name, args:parseArgs(x.arguments||x.args||x.parameters)}); else if(raw && typeof raw==='string' && (x.arguments||x.parameters||x.args)) unknown.push(raw); } }
    return {calls:out, native:false, unknown};
  }

  // ---------------- wykonanie narzędzi (graf bieżącego projektu, tylko odczyt) ----------------
  function pathMatch(g, q){ return CM.util.matchPath([...g.nodes.values()].filter(n=>n.type==='file'&&n.path), q); }
  // plik albo folder (dla owners / tests)
  function anyMatch(g, q){
    const s=String(q||'').replace(/\\/g,'/').replace(/^\.?\//,'').replace(/\/+$/,'').trim().toLowerCase(); if(!s) return null;
    for(const n of g.nodes.values()) if(n.type==='folder' && n.path && n.path.toLowerCase()===s) return n;
    return pathMatch(g, s) || [...g.nodes.values()].find(n=>n.type==='folder' && n.path && n.path.toLowerCase().endsWith('/'+s)) || null;
  }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // ctx: {graph, rag (CM.RAG), sources:[] (wspólna numeracja [n]), gitCore, signal}
  async function exec(name, args, ctx){
    const g=ctx.graph; args=args||{};
    const src=(o)=>{ const n=ctx.sources.length+1; ctx.sources.push(Object.assign({n}, o)); return n; };
    const node=()=>{ const n=pathMatch(g, args.path||args.file||args.query); if(!n) throw new Error('file not found: '+(args.path||args.file||'')); return n; };
    switch(name){
      case 'codeSearch': {
        if(!ctx.rag) return 'code search unavailable';
        const r=await ctx.rag.search(String(args.query||''), {k:clamp(+args.k||4,1,8), signal:ctx.signal});
        const ch=r.s?r.s.chunks:[]; if(!r.hits.length) return 'no matching code for: '+args.query;
        return r.hits.map(h=>{ const c=ch[h.i]; const k=src({id:c.id, path:c.path, start:c.start, end:c.end, sym:c.sym||''});
          return '['+k+'] '+c.path+':'+c.start+'-'+c.end+(c.sym?' ('+c.sym.slice(0,60)+')':'')+'\n```\n'+c.text.slice(0,1400)+'\n```'; }).join('\n\n');
      }
      case 'readFile': {
        const n=node(); if(!n.preview) return n.path+': content not available (binary, too large or loaded without content)';
        const lines=String(n.preview).split('\n'); const s=clamp(+args.start||1,1,lines.length); const e=clamp(+args.end||s+MAX_READ-1,s,Math.min(lines.length,s+MAX_READ-1));
        const k=src({id:n.id, path:n.path, start:s, end:e, sym:''});
        return '['+k+'] '+n.path+':'+s+'-'+e+' (of '+lines.length+')\n```\n'+lines.slice(s-1,e).join('\n')+'\n```';
      }
      case 'findFiles': {
        const q=String(args.query||'').toLowerCase(); const hits=[];
        for(const n of g.nodes.values()) if(n.type==='file'&&n.path&&n.path.toLowerCase().includes(q)){ hits.push(n.path); if(hits.length>=30) break; }
        return hits.length?hits.join('\n'):'no files match: '+args.query;
      }
      case 'dependencies': case 'dependents': {
        const n=node(); const pick=(ids)=>ids.map(id=>(g.nodes.get(id)||{}).path||id).filter(Boolean);
        if(name==='dependencies') return n.path+' imports: '+(pick(n.importsOut||[]).join(', ')||'(nothing)');
        const d1=pick(n.importsIn||[]), d2=new Set();
        for(const id of (n.importsIn||[])){ const m=g.nodes.get(id); for(const x of ((m&&m.importsIn)||[])) if(x!==n.id && !(n.importsIn||[]).includes(x)) d2.add(x); }
        return n.path+' is imported by: '+(d1.join(', ')||'(nobody)')+(d2.size?'\nindirectly: '+pick([...d2]).slice(0,30).join(', '):'');
      }
      case 'fileInfo': {
        const n=node(), m=n.metrics||{}, out=[n.path+': '+(m.lines||0)+' lines, complexity '+(m.complexity||0)+(n.langInfo?', '+n.langInfo.name:'')];
        if(n.symbols&&n.symbols.length) out.push('symbols: '+n.symbols.slice(0,25).map(s=>s.name+':'+s.line).join(', '));
        const gi=g.gitInfo; if(n.git&&gi){ const au=gi.authors||[]; out.push('git: '+n.git.c+' changes ('+(n.git.recent||0)+' in 90 days), owner '+((au[n.git.own]||{}).name||'?')+' '+Math.round((n.git.share||0)*100)+'%'); }
        if(n.isTest) out.push('this is a test file'); else if(n.testedBy) out.push('tested by: '+(n.testedBy.length?n.testedBy.map(id=>(g.nodes.get(id)||{}).path||id).join(', '):'no tests'));
        if(n.coverage&&n.coverage.pct!=null) out.push('coverage: '+n.coverage.pct+'% lines');
        out.push('imports '+(n.importsOut||[]).length+' files, imported by '+(n.importsIn||[]).length);
        return out.join('\n');
      }
      case 'hotspots': {
        const k=clamp(+args.n||8,1,20), GC=ctx.gitCore;
        const files=[...g.nodes.values()].filter(n=>n.type==='file'&&n.metrics);
        const useGit=!!(g.gitInfo&&GC);
        const score=(n)=>useGit?GC.hotspotScore(n):(n.metrics.lines||0)*(1+(n.importsIn||[]).length*0.5)*(1+(n.metrics.complexity||0)/50);
        return (useGit?'change frequency × complexity:\n':'size × dependents × complexity:\n')+files.sort((a,b)=>score(b)-score(a)).slice(0,k)
          .map((n,i)=>(i+1)+'. '+n.path+' — complexity '+(n.metrics.complexity||0)+(n.git?', '+n.git.c+' changes':'')).join('\n');
      }
      case 'owners': {
        const gi=g.gitInfo; if(!gi) return 'no git history loaded (the project was opened without .git, or git history was not analysed)';
        const au=gi.authors||[], nm=(i)=>(au[i]||{}).name||'?', q=args.path||args.file||args.query;
        if(!q){
          const top=au.map((x,i)=>i).filter(i=>!au[i].bot).sort((x,y)=>au[y].commits-au[x].commits).slice(0,10), bf=gi.busFactor||{value:0, authors:[]};
          return 'authors (commits · files owned): '+top.map(i=>au[i].name+' '+au[i].commits+' · '+(au[i].owned||0)).join(', ')
            +'\nbus factor: '+bf.value+(bf.authors&&bf.authors.length?' ('+bf.authors.map(nm).join(', ')+')':'');
        }
        const n=anyMatch(g, q); if(!n) throw new Error('not found: '+q);
        if(n.type==='file'){ if(!n.git) return n.path+': no changes in the analysed history';
          return n.path+' — '+n.git.c+' changes: '+n.git.a.map(x=>nm(x[0])+' '+Math.round(x[1]/(n.git.c||1)*100)+'%').join(', '); }
        const fs=ctx.gitCore&&ctx.gitCore.folderStats(g, n); if(!fs) return n.path+'/: no changes in the analysed history';
        const tot=fs.authors.reduce((s,x)=>s+x[1],0)||1;
        return n.path+'/ — '+fs.files+' files, '+fs.c+' changes: '+fs.authors.slice(0,8).map(x=>nm(x[0])+' '+Math.round(x[1]/tot*100)+'%').join(', ')+'\nbus factor: '+fs.busFactor.value;
      }
      case 'showOnMap': {
        let list=args.paths||args.path||args.files||[]; if(typeof list==='string') list=list.split(/[,\s]+/);
        const found=[], miss=[];
        for(const p of list.slice(0,30)){ const n=pathMatch(g, p); if(n){ if(!found.includes(n)) found.push(n); } else miss.push(String(p)); }
        if(!found.length) throw new Error('no such files on the map: '+list.slice(0,5).join(', '));
        if(ctx.view) ctx.view(found.map(n=>n.id));
        return 'highlighted on the map: '+found.map(n=>n.path).join(', ')+(miss.length?'\nnot found: '+miss.join(', '):'');
      }
      case 'tests': {
        const TM=ctx.testMap; if(!g.testInfo && TM) TM.mapTests(g);
        const ti=g.testInfo, P=(id)=>(g.nodes.get(id)||{}).path||id, cx=(n)=>(n.metrics||{}).complexity||0;
        if(!ti || !(ti.tests||ti.helpers)) return 'no test files found in the project';
        const q=args.path||args.file||args.query;
        if(!q){
          const unt=[...g.nodes.values()].filter(n=>n.type==='file' && !n.isTest && !(n.testedBy&&n.testedBy.length) && (!TM || TM.isCodeFile(n.path||n.id)))
            .sort((a,b)=>cx(b)-cx(a)).slice(0,10);
          return ti.tests+' test files; '+ti.tested+' of '+ti.code+' code files have tests ('+ti.pct+'%)'
            +(unt.length?'\nmost complex untested: '+unt.map(n=>n.path+' (complexity '+cx(n)+')').join(', '):'');
        }
        const n=anyMatch(g, q); if(!n) throw new Error('not found: '+q);
        if(n.type==='folder'){ if(!TM) return 'folder statistics unavailable'; const s=TM.folderStats(g, n);
          const unt=s.untestedIds.map(id=>g.nodes.get(id)).filter(Boolean).sort((a,b)=>cx(b)-cx(a));
          return n.path+'/: '+s.tests+' test files, '+s.tested+' of '+s.code+' code files tested'
            +(unt.length?'\nuntested, most complex first: '+unt.slice(0,15).map(x=>x.path+' (complexity '+cx(x)+')').join(', '):''); }
        if(n.isTest) return n.testHelper?n.path+' is a test helper':n.path+' tests: '+((n.tests||[]).map(P).join(', ')||'(no matching code file)');
        const cov=n.coverage&&n.coverage.pct!=null?'\ncoverage: '+n.coverage.pct+'% lines':'';
        return n.path+(n.testedBy&&n.testedBy.length?' is tested by: '+n.testedBy.map(P).join(', '):' has no tests')+cov;
      }
      default: throw new Error('unknown tool: '+name);
    }
  }

  // ---------------- pętla ----------------
  // chat(messages, tools|null) → {content, tool_calls?}; zwraca {answer, steps:[{name, args, ok, summary}], sources, native}
  async function run(o){
    const msgs=o.messages.slice(), steps=[], ctx=Object.assign({sources:o.sources||[]}, o.ctx);
    const maxSteps=o.maxSteps||MAX_STEPS; let native=null, nudged=false;
    for(let step=0; step<maxSteps; step++){
      if(o.signal&&o.signal.aborted) throw Object.assign(new Error('aborted'),{name:'AbortError'});
      const r=await o.chat(msgs, ollamaTools());
      const {calls, native:nat, unknown}=toolCalls(r);
      // wywołanie wymyślonego narzędzia (JSON w treści) to nie odpowiedź — model dostaje listę i prośbę o tekst
      if(!calls.length && unknown && unknown.length){
        steps.push({name:unknown[0], args:{}, ok:false, key:'?'+unknown[0], summary:'unknown tool'});
        msgs.push({role:'assistant', content:r.content||''});
        msgs.push({role:'user', content:'There is no tool named "'+unknown[0]+'". Available tools: '+TOOLS.map(t=>t.name).join(', ')+'. Call one of them, or if you already have enough information answer the question in plain text (no JSON), citing snippets as [n].'});
        continue;
      }
      if(!calls.length){
        const answer=String(r.content||'').trim();
        if(!nudged && step<maxSteps-1 && HEDGE.test(answer)){
          nudged=true; msgs.push({role:'assistant', content:answer});
          msgs.push({role:'user', content:'Do not guess or say you would need to inspect something — you have tools. Call readFile or codeSearch for the missing part now, then answer.'});
          continue;
        }
        return {answer, steps, sources:ctx.sources, native};
      }
      if(native==null) native=nat;
      msgs.push(nat?{role:'assistant', content:r.content||'', tool_calls:r.tool_calls}:{role:'assistant', content:r.content||''});
      for(const c of calls.slice(0,4)){
        const key=c.name+JSON.stringify(c.args);
        if(steps.some(s=>s.key===key)){ msgs.push({role:nat?'tool':'user', tool_name:c.name, content:(nat?'':'Tool result ('+c.name+'): ')+'(already done above — use the previous result)'}); continue; }
        let out, ok=true; try{ out=await exec(c.name, c.args, ctx); }catch(e){ ok=false; out='error: '+((e&&e.message)||e); }
        const st={name:c.name, args:c.args, ok, key, summary:String(out).split('\n')[0].slice(0,140)}; steps.push(st);
        if(o.onStep) o.onStep(st);
        msgs.push(nat?{role:'tool', tool_name:c.name, content:String(out).slice(0,6000)}:{role:'user', content:'Tool result ('+c.name+'):\n'+String(out).slice(0,6000)});
      }
    }
    // limit kroków — ostatnie pytanie bez narzędzi wymusza odpowiedź
    const fin=await o.chat(msgs.concat([{role:'user', content:'Answer the original question now using the information gathered above. Cite snippets as [n].'}]), null);
    return {answer:String(fin.content||'').trim(), steps, sources:ctx.sources, native};
  }

  return {TOOLS, ollamaTools, toolCalls, resolveName, exec, run, pathMatch, anyMatch, MAX_STEPS};
})();
