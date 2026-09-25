/* ===================== ui.js — panels & widgets ===================== */
CM.UI = (function(){
  const U=CM.util, $=U.$, el=U.el, L=CM.languages, I=CM.i18n;

  // ---- lightweight, dependency-free syntax highlighter (works across most languages) ----
  const HL_KW=new Set(('if else for while do return function func fn def class struct enum interface namespace '+
    'const let var val mut static public private protected internal abstract final override virtual '+
    'import from export default package use using include require module new this self super delete '+
    'typeof instanceof in of as is await async yield try catch finally throw throws switch case break continue '+
    'void int long short float double char bool boolean string byte unsigned signed auto var let '+
    'null nil none None undefined true false True False and or not lambda pass with elif except raise '+
    'extends implements impl trait where match when then begin end echo print').split(' '));
  function hlEsc(s){ return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function highlight(code, lang){
    lang=((lang||'')+'').toLowerCase();
    const hash=/(py|python|rb|ruby|sh|bash|zsh|fish|yaml|yml|toml|ini|conf|cfg|r|pl|perl|makefile|dockerfile|coffee|nim|elixir|ex)/.test(lang);
    const parts=['(\\/\\*[\\s\\S]*?\\*\\/)','(\\/\\/[^\\n]*)'];
    if(hash) parts.push('(#[^\\n]*)');
    parts.push('("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)');
    parts.push('(\\b\\d[\\w.]*)','([A-Za-z_$@][\\w$]*)','([\\s\\S])');
    const re=new RegExp(parts.join('|'),'g');
    let m, out='';
    while((m=re.exec(code))){
      const t=m[0]; if(t===''){ re.lastIndex++; continue; }
      const c0=t[0];
      if(t.startsWith('/*')||t.startsWith('//')||(hash&&c0==='#')) out+='<span class="hl-com">'+hlEsc(t)+'</span>';
      else if(c0==='"'||c0==="'"||c0==='`') out+='<span class="hl-str">'+hlEsc(t)+'</span>';
      else if(c0>='0'&&c0<='9') out+='<span class="hl-num">'+hlEsc(t)+'</span>';
      else if(/[A-Za-z_$@]/.test(c0)){ out+= HL_KW.has(t)?'<span class="hl-kw">'+hlEsc(t)+'</span>' : (/^[A-Z]/.test(t)?'<span class="hl-type">'+hlEsc(t)+'</span>':hlEsc(t)); }
      else out+=hlEsc(t);
    }
    return out;
  }

  function nodeIcon(node){
    if(node.type==='folder'){ const c=node.external?'#a78bfa':'#22d3ee'; return el('div',{class:'det-icon',style:`background:${U.rgba(c,0.16)};color:${c}`, html:CM.icons.svg(node.collapsed?'package':'folder',{size:18})}); }
    if(node.type==='external'){ return el('div',{class:'det-icon',style:'background:rgba(167,139,250,.16);color:#a78bfa', html:CM.icons.svg('package',{size:18})}); }
    const c=(node.langInfo&&node.langInfo.color)||'#7d8aa0';
    return el('div',{class:'det-icon',style:`background:${U.rgba(c,0.18)};color:${c}`}, L.glyph(node.langInfo||{name:'?'}));
  }
  function metric(val,lbl){ return el('div',{class:'metric'}, el('div',{class:'m-val',text:val}), el('div',{class:'m-lbl',text:lbl})); }

  // repository card (shown in the empty details panel when a GitHub/GitLab/Bitbucket repo is loaded)
  function repoCard(graph, H){
    const m=graph&&graph.meta, r=m&&m.repoInfo;
    if(!r || !m.html) return null;
    const HOST={github:'GitHub',gitlab:'GitLab',bitbucket:'Bitbucket'};
    const card=el('div',{class:'det-repo'});
    card.appendChild(el('div',{class:'det-repo-head'},
      el('span',{class:'det-repo-ic',html:CM.icons.svg('globe',{size:16})}),
      el('div',{class:'det-repo-title'},
        el('div',{class:'det-repo-name',text:m.repo||m.name}),
        el('div',{class:'det-repo-host',text:(HOST[m.host]||'')+(m.branch?(' · '+m.branch):'')}))));
    if(r.desc) card.appendChild(el('p',{class:'det-repo-desc',text:r.desc}));
    const stats=el('div',{class:'det-repo-stats'});
    const stat=(ic,val,title)=>{ if(val==null||val==='') return; stats.appendChild(el('span',{class:'det-repo-stat',title:title||'',html:CM.icons.svg(ic,{size:12})+' <b>'+esc(typeof val==='number'?U.fmtNum(val):String(val))+'</b>'})); };
    stat('sparkle', r.stars, I.t('cu.stars','gwiazdki'));
    stat('branch', r.forks, I.t('cu.forks','forki'));
    stat('info', r.issues, I.t('cu.issues','zgłoszenia'));
    if(r.lang) stats.appendChild(el('span',{class:'det-repo-stat',html:'<b>'+esc(r.lang)+'</b>'}));
    if(r.license) stats.appendChild(el('span',{class:'det-repo-stat',html:CM.icons.svg('file',{size:12})+' '+esc(r.license)}));
    if(stats.children.length) card.appendChild(stats);
    const act=el('button',{class:'tb-btn det-repo-open',onclick:()=>H.openRepo&&H.openRepo(),
      html:CM.icons.svg('globe',{size:14})+' '+I.t('cu.openRepo','Otwórz repozytorium')});
    card.appendChild(act);
    return card;
  }

  function renderDetails(node, graph, H){
    const body=$('#details-body'); body.innerHTML='';
    if(!node){
      body.appendChild(el('div',{class:'details-empty'}, el('p',{class:'muted',text:I.t('cu.clickElement','Kliknij element na mapie, aby zobaczyć zaawansowane parametry.')})));
      const card=repoCard(graph, H); if(card) body.appendChild(card);
      return;
    }

    const dicon=nodeIcon(node);
    if(node.type!=='external' && H.openFile){ dicon.classList.add('det-icon-open'); dicon.title=I.t('cu.openFullPreview','Otwórz pełny podgląd'); dicon.onclick=()=>H.openFile(node); }
    body.appendChild(el('div',{class:'det-header'}, dicon,
      el('div',{class:'det-title'},
        el('div',{class:'det-name',text:node.name}),
        el('div',{class:'det-kind',text: node.type==='folder'?(node.external?I.t('cu.externalDir','katalog zewnętrzny'):I.t('cu.folder','folder')):node.type==='external'?I.t('cu.externalDep','zależność zewnętrzna'):(node.langInfo?node.langInfo.name:I.t('cu.file','plik'))}))));

    if(node.path && node.type!=='external') body.appendChild(el('div',{class:'det-path',text:node.path}));

    const grid=el('div',{class:'metric-grid'});
    if(node.type==='file'){
      const m=node.metrics||{};
      grid.appendChild(metric(U.fmtNum(m.lines||0),I.t('cu.lines','Linie')));
      grid.appendChild(metric(U.fmtBytes(node.size),I.t('cu.size','Rozmiar')));
      grid.appendChild(metric(U.fmtNum(m.code||0),I.t('cu.codeLines','Linie kodu')));
      grid.appendChild(metric(U.fmtNum(m.complexity||0),I.t('cu.complexity','Złożoność')));
      if(m.funcs!=null) grid.appendChild(metric(U.fmtNum(m.funcs),I.t('cu.definitions','Definicje')));
      const cpct=m.lines? Math.round((m.comment||0)/m.lines*100):0;
      grid.appendChild(metric(cpct+'%',I.t('cu.comments','Komentarze')));
    } else if(node.type==='folder'){
      grid.appendChild(metric(U.fmtNum(node.descFiles||0),I.t('cu.files','Pliki')));
      grid.appendChild(metric(U.fmtBytes(node.totalSize),I.t('cu.size','Rozmiar')));
      grid.appendChild(metric(U.fmtNum(node.totalLines||0),I.t('cu.lines','Linie')));
      grid.appendChild(metric(U.fmtNum(node.childCount||0),I.t('cu.elements','Elementy')));
    } else {
      grid.appendChild(metric(U.fmtNum(node.count||0),I.t('cu.imports','Importów')));
      grid.appendChild(metric(U.fmtNum((node.importers||[]).length),I.t('cu.filesCount','Plików')));
      grid.appendChild(metric(node.version?('v'+node.version.replace(/^v/,'')):'—',I.t('cu.version','Wersja')));
    }
    body.appendChild(grid);
    // sprzężenia (Ca / Ce / I) — CM.Metrics, dla plików i folderów projektu (nie dla pakietów zewnętrznych)
    if((node.type==='file' || (node.type==='folder' && !node.external)) && CM.Metrics && graph && graph.nodes){
      const cp=CM.Metrics.couplingFor(graph).get(node.id);
      if(cp){
        const sec=el('div',{class:'det-section det-coupling'});
        sec.appendChild(el('h5',{}, I.t('cu.coupling','Sprzężenia')));
        const row=el('div',{title:I.t('cu.couplingHint','Ca = ile plików spoza jednostki od niej zależy · Ce = od ilu plików spoza jednostki zależy · I = Ce/(Ca+Ce): 0 = stabilny fundament, 1 = liść bez klientów')});
        row.appendChild(el('span',{class:'tag',text:'Ca '+U.fmtNum(cp.ca)}));
        row.appendChild(el('span',{class:'tag',text:'Ce '+U.fmtNum(cp.ce)}));
        const iv=cp.instability;
        row.appendChild(el('span',{class:'tag'+(iv!=null&&iv>=0.7&&cp.ca>0?' hot':''),text:'I '+(iv==null?'—':iv.toFixed(2))}));
        sec.appendChild(row); body.appendChild(sec);
      }
    }
    if(node.type==='external' && node.version){
      const src={npm:'npm',pip:'PyPI',cargo:'crates.io',go:'Go modules'}[node.depSource]||node.depSource||'';
      body.appendChild(el('div',{class:'det-ver',html:CM.icons.svg('package',{size:13})+` <b>${esc(node.name)}</b> <span>v${esc(node.version.replace(/^v/,''))}</span>${src?` <span class="muted">· ${src}</span>`:''}`}));
    }

    // extra file metrics
    if(node.type==='file' && node.metrics){
      const m=node.metrics; const extra=el('div',{class:'det-section'});
      extra.appendChild(el('h5',{},I.t('cu.characteristics','Charakterystyka')));
      const tags=el('div',{});
      if(m.todos) tags.appendChild(el('span',{class:'tag',text:`${m.todos} TODO/FIXME`}));
      tags.appendChild(el('span',{class:'tag',text:I.t('cu.maxLine','max wiersz:')+' '+m.longest}));
      tags.appendChild(el('span',{class:'tag',text:`${U.fmtNum(m.blank||0)} `+I.t('cu.blankLines','pustych')}));
      if(node.mtime) tags.appendChild(el('span',{class:'tag',text:U.fmtDate(node.mtime)}));
      extra.appendChild(tags); body.appendChild(extra);
    }

    // symbol map (functions / classes / types) + per-symbol complexity
    if(node.type==='file' && node.symbols && node.symbols.length){
      const KIND={function:{ic:'flow',c:'#22d3ee',t:'fn'},method:{ic:'flow',c:'#38bdf8',t:'m'},class:{ic:'box',c:'#7c5cff',t:'class'},interface:{ic:'layers',c:'#34d399',t:'iface'},type:{ic:'shapes',c:'#f59e0b',t:'type'}};
      const sec=el('div',{class:'det-section'});
      sec.appendChild(el('h5',{}, I.t('cu.symbols','Symbole'), el('span',{class:'muted',text:node.symbols.length})));
      const list=el('div',{class:'sym-list'});
      const maxCx=Math.max(...node.symbols.map(s=>s.complexity||1),1);
      for(const s of node.symbols.slice(0,120)){ const k=KIND[s.kind]||KIND.function;
        const hot=s.complexity>=10;
        list.appendChild(el('div',{class:'sym-item',title:s.kind+' · '+I.t('cu.line','linia')+' '+s.line+' · '+I.t('cu.complexityLc','złożoność')+' '+s.complexity},
          el('span',{class:'sym-ic',style:`color:${k.c}`,html:CM.icons.svg(k.ic,{size:13})}),
          el('span',{class:'sym-name',text:s.name}),
          el('span',{class:'sym-ln',text:':'+s.line}),
          el('span',{class:'sym-cx'+(hot?' hot':''),title:I.t('cu.cyclomaticComplexity','złożoność cyklomatyczna'),text:String(s.complexity)})));
      }
      sec.appendChild(list); body.appendChild(sec);
    }

    // language breakdown (folder)
    if(node.type==='folder' && node.langBreak && node.langBreak.size){
      const sec=el('div',{class:'det-section'}); sec.appendChild(el('h5',{},I.t('cu.compositionByType','Skład wg typu')));
      const arr=Array.from(node.langBreak.entries()).sort((a,b)=>b[1]-a[1]).slice(0,9);
      const max=arr[0][1];
      for(const [k,v] of arr){
        const info=L.lookup('x.'+k); const col=(graph.langStats.get(k)?.info?.color)||info.color||'#7d8aa0';
        sec.appendChild(el('div',{class:'bar-row'},
          el('span',{class:'bl',text:(graph.langStats.get(k)?.info?.name)||k}),
          el('div',{class:'bar-track'}, el('div',{class:'bar-fill',style:`width:${v/max*100}%;background:${col}`})),
          el('span',{class:'bv',text:v})));
      }
      body.appendChild(sec);
    }

    // imports out / in
    const linkSec=(title, ids, dir)=>{
      ids=ids.filter(id=>graph.nodes.has(id));
      if(!ids.length) return;
      const sec=el('div',{class:'det-section'});
      sec.appendChild(el('h5',{}, title, el('span',{class:'muted',text:ids.length})));
      const list=el('div',{class:'link-list'});
      for(const id of ids.slice(0,40)){
        const t=graph.nodes.get(id);
        const col=t.type==='external'?'#a78bfa':(t.langInfo&&t.langInfo.color)||'#7d8aa0';
        list.appendChild(el('div',{class:'link-item',onclick:()=>H.focus(id)},
          el('span',{class:'li-dot',style:`background:${col}`}),
          el('span',{class:'li-name',text:t.name}),
          el('span',{class:'li-path',text:t.type==='external'?'pkg':U.fmtNum(t.metrics?t.metrics.lines:'')||''})));
      }
      sec.appendChild(list); body.appendChild(sec);
    };
    if(node.type==='file'){
      linkSec(I.t('cu.importsUses','Importuje / używa'), node.importsOut||[], 'out');
      linkSec(I.t('cu.importedBy','Importowany przez'), node.importsIn||[], 'in');
    } else if(node.type==='external'){
      linkSec(I.t('cu.usedIn','Używany w'), node.importers||[], 'in');
    }

    // biggest files in folder
    if(node.type==='folder' && H.biggest){
      const big=H.biggest(node).slice(0,8);
      if(big.length){
        const sec=el('div',{class:'det-section'}); sec.appendChild(el('h5',{},I.t('cu.biggestFiles','Największe pliki')));
        const list=el('div',{class:'link-list'});
        for(const t of big){ const col=(t.langInfo&&t.langInfo.color)||'#7d8aa0';
          list.appendChild(el('div',{class:'link-item',onclick:()=>H.focus(t.id)},
            el('span',{class:'li-dot',style:`background:${col}`}),
            el('span',{class:'li-name',text:t.name}),
            el('span',{class:'li-path',text:U.fmtNum(t.metrics?t.metrics.lines:0)+' '+I.t('cu.linesAbbr','w.')}))); }
        sec.appendChild(list); body.appendChild(sec);
      }
    }

    // ===== advanced file-processing tools =====
    if(node.type==='file'){
      const m=node.metrics, pv=node.preview;
      // line composition bar (code / comments / blank)
      if(m && m.lines){
        const code=m.code||0, comm=m.comment||0, blank=m.blank||0, tot=Math.max(1,code+comm+blank);
        const sec=el('div',{class:'det-section'}); sec.appendChild(el('h5',{},I.t('cu.lineComposition','Skład wierszy')));
        const bar=el('div',{class:'comp-bar2'});
        const seg=(w,col)=> w>0?el('div',{class:'comp-seg',style:`width:${(w/tot*100).toFixed(1)}%;background:${col}`}):null;
        [seg(code,'#22d3ee'),seg(comm,'#34d399'),seg(blank,'#46597a')].forEach(s=>s&&bar.appendChild(s));
        sec.appendChild(bar);
        sec.appendChild(el('div',{class:'comp-legend',html:
          `<span style="color:#22d3ee">●</span> ${I.t('cu.codeLeg','kod')} ${U.fmtNum(code)} · <span style="color:#34d399">●</span> ${I.t('cu.commentLeg','kom.')} ${U.fmtNum(comm)} · <span style="color:#7d8aa0">●</span> ${I.t('cu.blankLeg','puste')} ${U.fmtNum(blank)}`}));
        body.appendChild(sec);
      }
      // TODO / FIXME / HACK markers extracted from the source
      if(pv){
        const todos=[]; const re=/\b(TODO|FIXME|HACK|XXX|BUG|NOTE)\b[:\s-]*(.*)/i;
        pv.split('\n').forEach((ln,i)=>{ if(todos.length>=25) return; const mm=ln.match(re);
          if(mm) todos.push({line:i+1, kind:mm[1].toUpperCase(), text:(mm[2]||'').trim().slice(0,90)}); });
        if(todos.length){
          const sec=el('div',{class:'det-section'}); sec.appendChild(el('h5',{}, I.t('cu.markers','Znaczniki'), el('span',{class:'muted',text:todos.length})));
          const list=el('div',{class:'todo-list'});
          for(const td of todos) list.appendChild(el('div',{class:'todo-item'},
            el('span',{class:'todo-kind k-'+td.kind.toLowerCase(),text:td.kind}),
            el('span',{class:'todo-line',text:td.line}),
            el('span',{class:'todo-text',text:td.text})));
          sec.appendChild(list); body.appendChild(sec);
        }
      }
      // syntax-highlighted code preview (always visible, compact) + open-full button
      if(pv){
        const sec=el('div',{class:'det-section'});
        const openBtn=el('button',{class:'mini-btn',onclick:()=>H.openFile&&H.openFile(node)},I.t('cu.fullscreen','pełny ekran ⤢'));
        sec.appendChild(el('h5',{}, I.t('cu.codePreview','Podgląd kodu'), openBtn));
        const all=pv.split('\n');
        const slice=all.slice(0,140).join('\n');
        const pre=el('pre',{class:'code-preview hl'});
        pre.innerHTML=highlight(slice, node.lang||node.ext)+(all.length>140?`\n<span class="hl-more">… +${all.length-140} ${I.t('cu.moreLinesFs','wierszy — „pełny ekran"')}</span>`:'');
        sec.appendChild(pre); body.appendChild(sec);
      }
    }

    // ===== Ask AI about THIS element (only when a Mistral key is configured) =====
    if(H.aiConfigured && H.aiConfigured() && H.aiAskNode){
      const sec=el('div',{class:'det-section det-ai'});
      sec.appendChild(el('h5',{}, el('span',{class:'det-ai-spark',html:CM.icons.svg('sparkle',{size:13})}), I.t('cu.aiAskHead','Zapytaj AI o ten element')));
      const ta=el('textarea',{class:'det-ai-input',rows:'2',placeholder: node.type==='folder'?I.t('cu.aiAskPhFolder','np. za co odpowiada ten folder?'):I.t('cu.aiAskPhFile','np. co robi ten plik i od czego zależy?')});
      const askBtn=el('button',{class:'tb-btn det-ai-btn',html:CM.icons.svg('sparkle',{size:13})+' '+I.t('cu.aiAsk','Zapytaj AI')});
      const out=el('div',{class:'det-ai-out'});
      askBtn.onclick=async()=>{
        const q=ta.value.trim(); if(!q){ out.textContent=I.t('cu.aiAskEmpty','Wpisz pytanie.'); return; }
        askBtn.disabled=true; out.textContent=I.t('cu.aiAsking','Pytam AI…');
        try{ out.textContent=(await H.aiAskNode(node,q))||I.t('cu.aiEmpty','Brak odpowiedzi.'); }
        catch(e){ out.textContent=(e&&e.message)||String(e); }
        askBtn.disabled=false;
      };
      ta.addEventListener('keydown',(e)=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); askBtn.click(); } });
      sec.appendChild(ta); sec.appendChild(askBtn); sec.appendChild(out); body.appendChild(sec);
    }

    // actions
    const acts=el('div',{class:'det-actions'});
    acts.appendChild(el('button',{class:'tb-btn',onclick:()=>H.focus(node.id),html:CM.icons.svg('crosshair',{size:14})+' '+I.t('cu.center','Wyśrodkuj')}));
    if(node.type==='file' && node.preview)
      acts.appendChild(el('button',{class:'tb-btn',onclick:()=>{ navigator.clipboard?.writeText(node.preview); U.toast(I.t('cu.copiedFileContent','Skopiowano zawartość pliku.')); },html:CM.icons.svg('copy',{size:14})+' '+I.t('cu.copyContent','Kopiuj treść')}));
    if(node.type==='folder' && node.children && node.children.length)
      acts.appendChild(el('button',{class:'tb-btn',onclick:()=>H.toggleCollapse(node),html:CM.icons.svg(node.collapsed?'expand':'collapse',{size:14})+' '+(node.collapsed?I.t('cu.expand','Rozwiń'):I.t('cu.collapse','Zwiń'))}));
    if(node.diff) acts.appendChild(el('span',{class:'tag',text: node.diff==='added'?I.t('cu.tagNew','+ nowy'):node.diff==='modified'?I.t('cu.tagModified','~ zmieniony'):I.t('cu.tagRemoved','− usunięty')}));
    if(node.type!=='external' && H.repoUrl && H.repoUrl(node))
      acts.appendChild(el('button',{class:'tb-btn',onclick:()=>H.openRepoUrl(node),html:CM.icons.svg('globe',{size:14})+' '+I.t('cu.openOn','Otwórz na ')+(H.repoHostName?H.repoHostName():'')}));
    body.appendChild(acts);
  }

  // full content viewer (large modal) — opened by clicking the file/folder icon
  function renderFileView(node, graph, H){
    const title=$('#fileview-title'), body=$('#fileview-body'); body.innerHTML='';
    title.textContent=node.name;
    // meta line
    const meta=el('div',{class:'fv-meta'});
    if(node.path) meta.appendChild(el('span',{class:'fv-path',text:node.path}));
    if(node.type==='file'){ const m=node.metrics||{};
      meta.appendChild(el('span',{class:'fv-badge',text:(node.langInfo?node.langInfo.name:node.ext||I.t('cu.file','plik'))}));
      meta.appendChild(el('span',{class:'fv-badge',text:U.fmtNum(m.lines||0)+' '+I.t('cu.linesGen','linii')}));
      meta.appendChild(el('span',{class:'fv-badge',text:U.fmtBytes(node.size)}));
      if(m.complexity!=null) meta.appendChild(el('span',{class:'fv-badge',text:I.t('cu.complexityLc','złożoność')+' '+U.fmtNum(m.complexity)}));
    } else if(node.type==='folder'){
      meta.appendChild(el('span',{class:'fv-badge',text:U.fmtNum(node.descFiles||0)+' '+I.t('cu.filesGen','plików')}));
      meta.appendChild(el('span',{class:'fv-badge',text:U.fmtNum(node.totalLines||0)+' '+I.t('cu.linesGen','linii')}));
      meta.appendChild(el('span',{class:'fv-badge',text:U.fmtBytes(node.totalSize)}));
    }
    body.appendChild(meta);

    if(node.type==='folder'){
      // folder -> list contents
      const list=el('div',{class:'fv-folder'});
      const kids=(node.children||[]).map(id=>graph.nodes.get(id)).filter(Boolean)
        .sort((a,b)=> (a.type===b.type? (a.name<b.name?-1:1) : (a.type==='folder'?-1:1)));
      if(!kids.length) list.appendChild(el('p',{class:'muted',text:I.t('cu.folderEmpty','Folder jest pusty lub zwinięty.')}));
      for(const c of kids){
        const col=c.type==='folder'?'#22d3ee':(c.langInfo&&c.langInfo.color)||'#7d8aa0';
        list.appendChild(el('div',{class:'fv-file',onclick:()=>{ if(H.openFile&&(c.type!=='external')){ renderFileView(c, graph, H); } else if(H.focus){ H.focus(c.id); } }},
          el('span',{class:'fv-file-ic',html:CM.icons.svg(c.type==='folder'?'folder':'file',{size:15})}),
          el('span',{class:'fv-file-name',text:c.name}),
          el('span',{class:'fv-file-meta',text: c.type==='folder'? U.fmtNum(c.descFiles||0)+' '+I.t('cu.filesAbbr','pl.') : U.fmtNum(c.metrics?c.metrics.lines:0)+' '+I.t('cu.linesAbbr','w.')})));
      }
      body.appendChild(list);
      return;
    }
    // file -> full highlighted source
    const pv=node.preview;
    const bar=el('div',{class:'fv-bar'});
    if(pv) bar.appendChild(el('button',{class:'tb-btn',onclick:()=>{ navigator.clipboard?.writeText(pv); U.toast(I.t('cu.copiedContent','Skopiowano zawartość.')); },html:CM.icons.svg('copy',{size:14})+' '+I.t('cu.copy','Kopiuj')}));
    bar.appendChild(el('button',{class:'tb-btn',onclick:()=>H.focus&&H.focus(node.id),html:CM.icons.svg('crosshair',{size:14})+' '+I.t('cu.showOnMap','Pokaż na mapie')}));
    body.appendChild(bar);
    if(pv){
      const wrap=el('div',{class:'fv-codewrap'});
      const gutter=el('div',{class:'fv-gutter'}); const n=pv.split('\n').length;
      gutter.textContent=Array.from({length:n},(_,i)=>i+1).join('\n');
      const pre=el('pre',{class:'fv-code hl'}); pre.innerHTML=highlight(pv, node.lang||node.ext);
      wrap.appendChild(gutter); wrap.appendChild(pre); body.appendChild(wrap);
    } else {
      body.appendChild(el('p',{class:'muted',style:'padding:14px',text:I.t('cu.contentUnavailable','Zawartość niedostępna (plik binarny, zbyt duży, albo wczytany bez treści).')}));
    }
  }

  // edge / dependency details (shown when a connection line is clicked)
  function renderEdgeDetails(edge, s, t, graph, H){
    const body=$('#details-body'); body.innerHTML='';
    if(!s||!t){ body.appendChild(el('div',{class:'details-empty'}, el('p',{class:'muted',text:I.t('cu.edgeNodesNotFound','Nie znaleziono węzłów tej zależności.')}))); return; }
    const meta = edge.type==='import' ? {col:'#22d3ee', name:I.t('cu.importDep','Import / zależność'), verb:I.t('cu.verbImports','importuje / używa')}
               : edge.type==='reference' ? {col:'#a78bfa', name:I.t('cu.refResource','Referencja (zasób)'), verb:I.t('cu.verbRefs','odwołuje się do')}
               : {col:'#3b4d63', name:I.t('cu.structContains','Struktura (zawiera)'), verb:I.t('cu.verbContains','zawiera')};
    body.appendChild(el('div',{class:'det-header'},
      el('div',{class:'det-icon',style:`background:${U.rgba(meta.col,0.16)};color:${meta.col}`, html:CM.icons.svg('flow',{size:18})}),
      el('div',{class:'det-title'},
        el('div',{class:'det-name',text:I.t('cu.dependency','Zależność')}),
        el('div',{class:'det-kind',text:meta.name}))));

    // directional flow: source -> target
    const flow=el('div',{class:'edge-flow'});
    const nodeChip=(n,role)=>{
      const col=n.type==='folder'?'#22d3ee':n.type==='external'?'#a78bfa':(n.langInfo&&n.langInfo.color)||'#7d8aa0';
      return el('div',{class:'edge-node',title:n.path||n.name,onclick:()=>H.focus(n.id)},
        el('span',{class:'li-dot',style:`background:${col}`}),
        el('div',{class:'edge-node-txt'},
          el('div',{class:'edge-node-name',text:n.name}),
          el('div',{class:'edge-node-role',text:role})));
    };
    flow.appendChild(nodeChip(s,I.t('cu.source','źródło')));
    flow.appendChild(el('div',{class:'edge-arrow',html:CM.icons.svg('arrowRight',{size:20})}));
    flow.appendChild(nodeChip(t,I.t('cu.target','cel')));
    body.appendChild(flow);

    body.appendChild(el('p',{class:'edge-desc',html:`<b style="color:var(--text)">${esc(s.name)}</b> ${meta.verb} <b style="color:var(--text)">${esc(t.name)}</b>.`}));

    // direction summary + counts
    const sec=el('div',{class:'det-section'}); sec.appendChild(el('h5',{},I.t('cu.flowDirection','Kierunek przepływu')));
    sec.appendChild(el('div',{class:'bar-row'}, el('span',{class:'bl',text:I.t('cu.direction','kierunek')}),
      el('span',{html:`<span class="mono">${esc(s.name)}</span> &rarr; <span class="mono">${esc(t.name)}</span>`})));
    if(s.type==='file'){ const o=(s.importsOut||[]).length, i=(s.importsIn||[]).length;
      sec.appendChild(el('div',{class:'bar-row'}, el('span',{class:'bl',text:I.t('cu.sourceArrows','źródło →←')}), el('span',{class:'mono',text:`→ ${o} · ← ${i}`}))); }
    if(t.type==='file'){ const o=(t.importsOut||[]).length, i=(t.importsIn||[]).length;
      sec.appendChild(el('div',{class:'bar-row'}, el('span',{class:'bl',text:I.t('cu.targetArrows','cel →←')}), el('span',{class:'mono',text:`→ ${o} · ← ${i}`}))); }
    body.appendChild(sec);

    const acts=el('div',{class:'det-actions'});
    acts.appendChild(el('button',{class:'tb-btn',onclick:()=>H.focus(s.id)}, I.t('cu.showSource','Pokaż źródło')));
    acts.appendChild(el('button',{class:'tb-btn',onclick:()=>H.focus(t.id)}, I.t('cu.showTarget','Pokaż cel')));
    body.appendChild(acts);
  }

  function renderLangFilters(graph, state, H){
    const box=$('#lang-filters'); box.innerHTML='';
    const stats=Array.from(graph.langStats.values()).sort((a,b)=>b.count-a.count);
    if(!stats.length){ box.appendChild(el('p',{class:'muted small',text:I.t('cu.noData','Brak danych.')})); return; }
    for(const s of stats){
      const off=state.langsOff.has(s.key);
      const row=el('div',{class:'lang-row'+(off?' off':''),onclick:()=>H.toggleLang(s.key)},
        el('span',{class:'swatch',style:`background:${s.info.color}`}),
        el('span',{class:'lname',text:s.info.name}),
        el('span',{class:'lcount',text:s.count}));
      box.appendChild(row);
    }
  }

  function renderSearch(results, H){
    const box=$('#search-results');
    if(!results.length){ box.classList.add('hidden'); box.innerHTML=''; return; }
    box.innerHTML=''; box.classList.remove('hidden');
    results.slice(0,40).forEach((n,i)=>{
      const col=n.type==='folder'?'#22d3ee':(n.langInfo&&n.langInfo.color)||'#7d8aa0';
      box.appendChild(el('div',{class:'sr-item'+(i===0?' active':''),onclick:()=>{H.pick(n.id); box.classList.add('hidden');}},
        el('span',{class:'li-dot',style:`background:${col};width:9px;height:9px;border-radius:2px`}),
        el('span',{class:'sr-name',text:n.name}),
        el('span',{class:'sr-path',text:n.path})));
    });
  }

  // tooltip
  let tEl;
  function tooltip(node, x, y){
    if(!tEl) tEl=$('#tooltip');
    if(!node){ tEl.classList.add('hidden'); return; }
    let rows='';
    if(node.type==='file'){ const m=node.metrics||{};
      rows=`<div class="tt-row">${node.langInfo?node.langInfo.name:''} · <b>${U.fmtNum(m.lines||0)}</b> ${I.t('cu.linesGen','linii')} · <b>${U.fmtBytes(node.size)}</b></div>`;
      if((node.importsOut||[]).length||(node.importsIn||[]).length) rows+=`<div class="tt-row">→ ${ (node.importsOut||[]).length } · ← ${ (node.importsIn||[]).length }</div>`;
    } else if(node.type==='folder'){ rows=`<div class="tt-row"><b>${U.fmtNum(node.descFiles||0)}</b> ${I.t('cu.filesGen','plików')} · <b>${U.fmtNum(node.totalLines||0)}</b> ${I.t('cu.linesGen','linii')} · ${U.fmtBytes(node.totalSize)}</div>`; }
    else { rows=`<div class="tt-row">${I.t('cu.usedTimes','zależność · używana')} ${node.count}×</div>`; }
    tEl.innerHTML=`<div class="tt-name">${esc(node.name)}</div>${rows}<div class="tt-row muted">${esc(node.path||'')}</div>`;
    tEl.classList.remove('hidden');
    const r=tEl.getBoundingClientRect();
    let px=x+14, py=y+14;
    if(px+r.width>innerWidth) px=x-r.width-14;
    if(py+r.height>innerHeight) py=y-r.height-14;
    tEl.style.left=px+'px'; tEl.style.top=py+'px';
  }

  // floating file-content preview (shown after a short hover delay; see app.js).
  // Shows the WHOLE retained content (up to 64 KB) and is scrollable: the popup takes pointer
  // events, so moving the cursor onto it keeps it open (grace-delayed hide) and the wheel scrolls
  // the code instead of zooming the map underneath.
  let fpEl, fpHideT=null, fpNodeId=null;
  function fpBind(){
    fpEl.addEventListener('mouseenter',()=>{ if(fpHideT){ clearTimeout(fpHideT); fpHideT=null; } });
    fpEl.addEventListener('mouseleave',()=>{ fpNodeId=null; fpEl.classList.add('hidden'); });
    fpEl.addEventListener('wheel',(e)=>{ e.stopPropagation(); },{passive:true});   // never reach the canvas zoom
  }
  function filePreview(node, x, y){
    if(!fpEl){ fpEl=$('#file-preview'); if(fpEl) fpBind(); }
    if(!fpEl) return;
    if(!node || node.type!=='file' || !node.preview){
      // grace period: hovering off the node toward the popup must not close it
      if(fpHideT) clearTimeout(fpHideT);
      fpHideT=setTimeout(()=>{ fpHideT=null; fpNodeId=null; fpEl.classList.add('hidden'); }, 180);
      return;
    }
    if(fpHideT){ clearTimeout(fpHideT); fpHideT=null; }
    if(fpNodeId===node.id && !fpEl.classList.contains('hidden')) return;   // same file → keep scroll position
    fpNodeId=node.id;
    const m=node.metrics||{};
    const langName=(node.langInfo&&node.langInfo.name)||node.lang||node.ext||I.t('cu.text','tekst');
    const col=(node.langInfo&&node.langInfo.color)||'#7d8aa0';
    const truncated = node.preview.length>=65536;
    const more = truncated ? `\n<span class="hl-more">… ${I.t('cu.truncated','podgląd ucięty do 64 KB')}</span>` : '';
    const todos = (m.todos||0) ? `<span class="fp-tag">${m.todos} ${I.t('cu.markersTag','znaczników')}</span>` : '';
    fpEl.innerHTML =
      `<div class="fp-head"><span class="fp-dot" style="background:${col}"></span>`+
      `<span class="fp-name">${esc(node.name)}</span>`+
      `<span class="fp-meta">${esc(langName)} · ${U.fmtNum(m.lines||0)} ${I.t('cu.lnAbbr','ln')} · ${U.fmtBytes(node.size)}</span>${todos}`+
      `<span class="fp-scroll" title="${esc(I.t('cu.scrollHint','Przewijaj kółkiem, aby przeglądać cały plik'))}">⇅</span></div>`+
      `<pre class="fp-code hl">${highlight(node.preview, node.lang||node.ext)}${more}</pre>`;
    fpEl.classList.remove('hidden');
    const r=fpEl.getBoundingClientRect();
    let px=x+18, py=y+18;
    if(px+r.width>innerWidth-8) px=x-r.width-18;
    if(px<8) px=8;
    if(py+r.height>innerHeight-8) py=Math.max(8, innerHeight-r.height-8);
    if(py<8) py=8;
    fpEl.style.left=px+'px'; fpEl.style.top=py+'px';
  }

  // context menu
  function ctxMenu(items, x, y){
    const m=$('#ctx-menu'); m.innerHTML='';
    for(const it of items){
      if(it.sep){ m.appendChild(el('div',{class:'ctx-sep'})); continue; }
      const ic = (it.ic && CM.icons.has(it.ic)) ? el('span',{class:'ctx-ic',html:CM.icons.svg(it.ic,{size:15})}) : el('span',{class:'ctx-ic',text:it.icon||'•'});
      m.appendChild(el('div',{class:'ctx-item',onclick:()=>{hideCtx(); it.action();}}, ic, el('span',{text:it.label})));
    }
    m.classList.remove('hidden');
    const r=m.getBoundingClientRect();
    m.style.left=Math.min(x,innerWidth-r.width-6)+'px';
    m.style.top=Math.min(y,innerHeight-r.height-6)+'px';
  }
  function hideCtx(){ $('#ctx-menu').classList.add('hidden'); }

  // history modal
  function renderHistory(snaps, current, H){
    const body=$('#history-body'); body.innerHTML='';
    if(!snaps.length){ body.appendChild(el('p',{class:'muted',text:I.t('cu.noSnapshots','Brak migawek. Kliknij „Migawka", aby zapisać bieżący stan projektu i śledzić jego rozwój.')})); return; }
    let cmpA=null, cmpB=null;
    const bar=el('div',{class:'cmp-bar'},
      el('span',{class:'muted',text:I.t('cu.compare','Porównaj:')}),
      el('span',{id:'cmp-info',class:'muted small',text:I.t('cu.chooseAB','wybierz A i B')}),
      el('span',{class:'tb-spacer'}),
      el('button',{class:'tb-btn primary',id:'cmp-go'},I.t('cu.compareGo','Porównaj →')));
    body.appendChild(bar);
    const update=()=>{ $('#cmp-info').textContent = (cmpA?'A='+shortLabel(cmpA):'A=?')+'  '+(cmpB?'B='+shortLabel(cmpB):'B=?'); };
    snaps.forEach(s=>{
      const sig=s.signature;
      const row=el('div',{class:'snap-row'},
        el('input',{type:'radio',name:'cmpA',title:I.t('cu.asAOlder','jako A (starsza)'),onchange:()=>{cmpA=s;update();}}),
        el('input',{type:'radio',name:'cmpB',title:I.t('cu.asBNewer','jako B (nowsza)'),onchange:()=>{cmpB=s;update();}}),
        el('div',{class:'snap-main'},
          el('div',{class:'snap-name',text:s.label}),
          el('div',{class:'snap-meta',text:`${U.fmtDate(s.ts)} · ${U.relTime(s.ts)} · ${s.source||s.name}`})),
        el('div',{class:'snap-stat',html:`${U.fmtNum(sig.fileCount)} ${I.t('cu.filesGen','plików')}<br>${U.fmtNum(sig.totalLines)} ${I.t('cu.linesGen','linii')}`}),
        el('div',{class:'snap-actions'},
          el('button',{class:'icon-btn',title:I.t('cu.loadAsDiffContext','Wczytaj jako bieżący kontekst diff (B vs ten)'),onclick:()=>H.compareToCurrent(s),html:CM.icons.svg('flow',{size:15})}),
          el('button',{class:'icon-btn danger',title:I.t('cu.delete','Usuń'),onclick:()=>H.del(s.id),html:CM.icons.svg('trash',{size:15})})));
      body.appendChild(row);
    });
    $('#cmp-go').onclick=()=>{ if(cmpA&&cmpB) H.compare(cmpA,cmpB); else U.toast(I.t('cu.chooseSnapAB','Wybierz migawkę A i B.'),'error'); };
    update();
  }
  function shortLabel(s){ return U.relTime(s.ts); }

  function renderDiff(diff, a, b){
    const body=$('#diff-body'); body.innerHTML='';
    $('#diff-title').textContent=`${I.t('cu.comparison','Porównanie:')} ${a.label||U.fmtDate(a.ts)}  →  ${b.label||U.fmtDate(b.ts)}`;
    const sum=el('div',{class:'diff-summary'},
      stat('ds-add','+'+diff.added.length,I.t('cu.added','dodane')),
      stat('ds-del','−'+diff.removed.length,I.t('cu.removed','usunięte')),
      stat('ds-mod','~'+diff.modified.length,I.t('cu.modified','zmienione')),
      stat('ds-same',''+diff.unchanged.length,I.t('cu.unchanged','bez zmian')));
    body.appendChild(sum);
    const totals=el('div',{class:'cmp-bar'},
      el('span',{html:`<b style="color:var(--text)">${I.t('cu.deltaFiles','Δ plików:')}</b> ${signed(diff.dFiles)}`}),
      el('span',{html:`<b style="color:var(--text)">${I.t('cu.deltaLines','Δ linii:')}</b> ${signed(diff.dLines)}`}),
      el('span',{html:`<b style="color:var(--text)">${I.t('cu.deltaSize','Δ rozmiar:')}</b> ${signed(diff.dSize,true)}`}));
    body.appendChild(totals);
    const list=el('div',{class:'diff-list'});
    const addItem=(f,kind,badge)=>{
      let delta='';
      if(kind==='mod') delta=`${signed(f.dLines)} `+I.t('cu.linesAbbr','w.');
      list.appendChild(el('div',{class:'diff-item diff-'+kind},
        el('span',{class:'diff-badge',text:badge}),
        el('span',{class:'di-path',text:f.path}),
        el('span',{class:'diff-delta',text:delta})));
    };
    diff.added.forEach(f=>addItem(f,'add','+'));
    diff.modified.forEach(f=>addItem(f,'mod','~'));
    diff.removed.forEach(f=>addItem(f,'del','−'));
    if(!diff.added.length&&!diff.modified.length&&!diff.removed.length)
      list.appendChild(el('p',{class:'muted',text:I.t('cu.noDiff','Brak różnic między migawkami.')}));
    body.appendChild(list);
  }
  function stat(cls,val,lbl){ return el('div',{class:'diff-stat '+cls}, el('div',{class:'ds-val',text:val}), el('div',{class:'ds-lbl',text:lbl})); }
  function signed(n,bytes){ const s=n>0?'+':''; return s+(bytes?U.fmtBytes(Math.abs(n)).replace(/^/,n<0?'-':''):U.fmtNum(n)); }
  function esc(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

  // hotspots: files ranked by impact = lines × (1 + fan-in) × (1 + complexity)
  function hotspotScore(n){
    const lines=n.metrics?n.metrics.lines:0;
    const cx=n.metrics?n.metrics.complexity:0;
    const inDeg=(n.importsIn||[]).length;
    return lines * (1 + inDeg*0.5) * (1 + cx/50);
  }
  function renderHotspots(graph, H){
    const body=$('#hotspots-body'); if(!body) return; body.innerHTML='';
    const files=[];
    for(const n of graph.nodes.values()){ if(n.type==='file' && n.metrics) files.push(n); }
    files.forEach(n=>n._hot=hotspotScore(n));
    files.sort((a,b)=>b._hot-a._hot);
    const top=files.slice(0,30); const max=top.length?top[0]._hot||1:1;
    if(!top.length){ body.appendChild(el('p',{class:'muted',text:I.t('cu.noFilesWithMetrics','Brak plików z metrykami (wczytaj projekt z zawartością plików, np. folder lub GitHub z opcją pobierania treści).')})); return; }
    body.appendChild(el('p',{class:'muted small',style:'margin:0 0 12px',text:I.t('cu.hotspotsDesc','Pliki o największym wpływie na projekt — duże, złożone i najczęściej importowane. Kliknij, aby przejść do pliku.')}));
    top.forEach((n,i)=>{
      const row=el('div',{class:'hot-row',onclick:()=>{ if(H&&H.focus) H.focus(n.id); const m=$('#modal-hotspots'); if(m) m.classList.add('hidden'); }});
      row.appendChild(el('div',{class:'hot-rank',text:String(i+1)}));
      const main=el('div',{class:'hot-main'});
      main.appendChild(el('div',{class:'hot-name',text:n.name}));
      main.appendChild(el('div',{class:'hot-path',text:n.path}));
      row.appendChild(main);
      const stats=el('div',{class:'hot-stats'});
      stats.appendChild(el('span',{html:`<b>${U.fmtNum(n.metrics.lines)}</b> ${I.t('cu.lnAbbr','ln')}`}));
      stats.appendChild(el('span',{html:`${I.t('cu.complexityAbbr','złoż')} <b>${U.fmtNum(n.metrics.complexity)}</b>`}));
      stats.appendChild(el('span',{html:`<b>${U.fmtNum((n.importsIn||[]).length)}</b>←`}));
      row.appendChild(stats);
      const bar=el('div',{class:'hot-bar'}); bar.appendChild(el('i',{style:`width:${Math.max(6,Math.round(n._hot/max*100))}%`}));
      row.appendChild(bar);
      body.appendChild(row);
    });
  }

  return {renderDetails, renderEdgeDetails, renderFileView, highlight, renderLangFilters, renderSearch, tooltip, filePreview, ctxMenu, hideCtx, renderHistory, renderDiff, nodeIcon, renderHotspots};
})();
