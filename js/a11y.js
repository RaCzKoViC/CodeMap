/* ===================== a11y.js — dostępność mapy (faza 16): klawiatura po węzłach i komunikaty dla czytników ===================== */
// Mapa to canvas — czytnik ekranu nie widzi węzłów. Region aria-live ogłasza zaznaczony węzeł (rodzaj, ścieżka, język,
// linie, importy w obie strony, testy) i podsumowanie wczytanej mapy (pliki, foldery, zależności, języki), a ukryta
// sekcja opisu (aria-describedby płótna) trzyma to podsumowanie na stałe. Klawiatura: Alt+strzałki — najbliższy widoczny
// węzeł w tym kierunku na ekranie (od zaznaczonego; bez zaznaczenia — od środka widoku), Enter — jak dwuklik (folder:
// zwiń / rozwiń, plik: zaznacz i wyśrodkuj), Alt+PageUp — folder nadrzędny, Alt+PageDown — pierwsze dziecko,
// Alt+Home — korzeń. Opisy i wybór kierunku to czyste funkcje (testy w Node); podpięcie do strony — tylko w przeglądarce.
CM.A11y = (function(){
  const STR={
    pl:{file:'Plik', folder:'Folder', ext:'Zależność zewnętrzna', symbol:'Symbol', lines:['linia','linie','linii'], files:['plik','pliki','plików'], imports:'importuje',
      importedBy:'importowany przez', cx:'złożoność', tests:'testy', collapsed:'zwinięty', expanded:'rozwinięty', used:'używana', times:'×',
      calls:'wywołuje', calledBy:'wywoływany przez', map:'Mapa', folders:['folder','foldery','folderów'], deps:['zależność','zależności','zależności'], langs:'języki', none:'Brak węzła w tym kierunku.',
      summaryLabel:'Tekstowe podsumowanie mapy kodu', inFile:'w'},
    en:{file:'File', folder:'Folder', ext:'External dependency', symbol:'Symbol', lines:['line','lines','lines'], files:['file','files','files'], imports:'imports',
      importedBy:'imported by', cx:'complexity', tests:'tests', collapsed:'collapsed', expanded:'expanded', used:'used', times:'×',
      calls:'calls', calledBy:'called by', map:'Map', folders:['folder','folders','folders'], deps:['dependency','dependencies','dependencies'], langs:'languages', none:'No node in that direction.',
      summaryLabel:'Text summary of the code map', inFile:'in'},
  };
  const lg=(lang)=>lang || (CM.i18n && CM.i18n.getLang && CM.i18n.getLang()==='en' ? 'en' : 'pl');
  const T=(lang)=>STR[lg(lang)] || STR.pl;
  const fmt=(n)=>(CM.util && CM.util.fmtNum ? CM.util.fmtNum(n||0) : String(n||0));
  // liczba z odmianą: [1, 2–4 (poza 12–14), reszta] — po polsku; po angielsku [1, reszta, reszta]
  const num=(n, forms)=>{ n=n||0; const a=n%10, b=n%100; return fmt(n)+' '+(n===1 ? forms[0] : (a>=2&&a<=4&&!(b>=12&&b<=14)) ? forms[1] : forms[2]); };

  // opis węzła jednym zdaniem dla czytnika ekranu
  function describe(node, graph, lang){
    if(!node) return '';
    const s=T(lang), parts=[];
    if(node.type==='file'){
      const m=node.metrics||{}, li=node.langInfo;
      parts.push(s.file+' '+(node.path||node.name));
      if(li && li.name) parts.push(CM.languages && CM.languages.label ? CM.languages.label(li.name, lg(lang)) : li.name);
      if(m.lines) parts.push(num(m.lines, s.lines));
      parts.push(s.imports+' '+(node.importsOut||[]).length, s.importedBy+' '+(node.importsIn||[]).length);
      if(m.complexity) parts.push(s.cx+' '+m.complexity);
      if(node.testedBy && node.testedBy.length) parts.push(s.tests+' '+node.testedBy.length);
    } else if(node.type==='folder'){
      parts.push(s.folder+' '+(node.path||node.name||'/'));
      if(node.descFiles!=null) parts.push(num(node.descFiles, s.files));
      if(node.totalLines) parts.push(num(node.totalLines, s.lines));
      parts.push(node.collapsed ? s.collapsed : s.expanded);
    } else if(node.type==='symbol'){
      const file=graph && graph.nodes && graph.nodes.get(node.parent);
      parts.push(s.symbol+' '+(node.kind?node.kind+' ':'')+node.name+(file?' '+s.inFile+' '+file.path:''));
      if(node.line) parts.push(s.lines[2]+' '+node.line+(node.endLine&&node.endLine!==node.line?'–'+node.endLine:''));
      if(node.callsOut!=null) parts.push(s.calls+' '+node.callsOut, s.calledBy+' '+(node.callsIn||0));
    } else {
      parts.push(s.ext+' '+node.name);
      if(node.count) parts.push(s.used+' '+node.count+s.times);
    }
    return parts.join(' · ');
  }

  // podsumowanie mapy: pliki, foldery, zależności, najczęstsze języki
  function summary(graph, lang){
    if(!graph || !graph.nodes) return '';
    const s=T(lang); let files=0, folders=0; const byLang=new Map();
    for(const n of graph.nodes.values()){
      if(n.type==='file'){ files++; const nm=n.langInfo&&n.langInfo.name; if(nm) byLang.set(nm, (byLang.get(nm)||0)+1); }
      else if(n.type==='folder') folders++;
    }
    const deps=(graph.edges||[]).filter((e)=>e.type==='import').length;
    const langs=[...byLang].sort((a,b)=>b[1]-a[1]).slice(0,5)
      .map(([k,v])=>(CM.languages&&CM.languages.label?CM.languages.label(k, lg(lang)):k)+' '+fmt(v)).join(', ');
    const name=(graph.meta&&graph.meta.name)||'';
    return s.map+(name?' „'+name+'"':'')+': '+num(files, s.files)+', '+num(folders, s.folders)+', '+num(deps, s.deps)
      +(langs?'; '+s.langs+': '+langs:'')+'.';
  }

  // najbliższy węzeł w kierunku dir ('left'|'right'|'up'|'down') od punktu `from` ({x,y} na ekranie):
  // w stożku ±63° od kierunku, wynik = odległość wzdłuż + 2 × odchylenie w bok; project(n) → {x,y} na ekranie
  const DIRS={left:[-1,0], right:[1,0], up:[0,-1], down:[0,1]};
  function nextInDirection(nodes, from, dir, project, skip){
    const d=DIRS[dir]; if(!d || !from) return null;
    const P=project || ((n)=>({x:n.x, y:n.y}));
    let best=null, bs=Infinity;
    for(const n of nodes){
      if(n===skip) continue;
      const p=P(n), vx=p.x-from.x, vy=p.y-from.y, along=vx*d[0]+vy*d[1];
      if(along<=0.5) continue;
      const side=Math.abs(vx*d[1]-vy*d[0]);
      if(side>along*2) continue;
      const score=along+2*side;
      if(score<bs){ bs=score; best=n; }
    }
    return best;
  }

  // ---------------- podpięcie do strony ----------------
  function wire(){
    const A=CM.App, R=A && A.renderer;
    if(!R || typeof document==='undefined'){ setTimeout(wire, 200); return; }
    if(R.__a11y) return; R.__a11y=true;
    const el=CM.util.el;
    const live=el('div',{id:'a11y-live', class:'sr-only', 'aria-live':'polite', 'aria-atomic':'true'});
    const desc=el('section',{id:'a11y-summary', class:'sr-only', 'aria-label':T().summaryLabel});
    document.body.append(live, desc);
    const canvas=document.getElementById('map-canvas');
    if(canvas){ canvas.setAttribute('aria-describedby','a11y-summary'); if(!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex','0'); }
    let lastMsg='';
    const say=(msg)=>{ if(!msg) return; live.textContent = msg===lastMsg ? msg+' ' : msg; lastMsg=live.textContent; };   // ta sama treść — wymuszone ponowne ogłoszenie
    // zaznaczenie z dowolnego źródła (klik, wyszukiwarka, ChatBot, klawiatura) przechodzi przez setSelected
    const setSel=R.setSelected.bind(R);
    R.setSelected=(n)=>{ const r=setSel(n); if(n) say(describe(n, A.graph)); return r; };
    // nowa mapa (albo przebudowa widoku) → podsumowanie w sekcji opisu; ogłoszenie tylko przy zmianie projektu
    const setData=R.setData.bind(R); let lastKey='', timer=0;
    R.setData=(...args)=>{ const r=setData(...args); clearTimeout(timer); timer=setTimeout(()=>{
      const g=A.graph; if(!g) return; const text=summary(g); desc.textContent=text;
      const key=((g.meta&&g.meta.name)||'')+'|'+g.nodes.size; if(key!==lastKey){ lastKey=key; say(text); } }, 400); return r; };
    const screen=(n)=>R.cam && R.cam.toScreen ? R.cam.toScreen(n.x, n.y, R.w, R.h) : {x:n.x, y:n.y};
    const go=(n)=>{ if(!n) return; A.select(n); if(R.centerOn) R.centerOn(n); };
    window.addEventListener('keydown',(e)=>{
      const tg=e.target, tag=tg && tg.tagName;
      if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || (tg && tg.isContentEditable)) return;
      if(e.altKey && !e.ctrlKey && !e.metaKey){
        const dir={ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down'}[e.key];
        const sel=R.selected;
        if(dir){
          e.preventDefault();
          const from=sel ? screen(sel) : {x:(R.w||0)/2, y:(R.h||0)/2};
          const n=nextInDirection(R.nodes||[], from, dir, screen, sel);
          if(n) go(n); else say(T().none);
          return;
        }
        if(e.key==='PageUp' && sel && sel.parent!=null){ e.preventDefault(); go(A.graph.nodes.get(sel.parent)); return; }
        if(e.key==='PageDown' && sel && sel.children && sel.children.length){ e.preventDefault(); go(A.graph.nodes.get(sel.children[0])); return; }
        if(e.key==='Home' && A.graph && A.graph.root){ e.preventDefault(); go(A.graph.root); return; }
      }
      // Enter na mapie (fokus na płótnie albo nigdzie) = dwuklik na zaznaczonym węźle
      if(e.key==='Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && R.selected && (tg===canvas || tg===document.body)){
        e.preventDefault();
        if(R.selected.type==='folder' && A.toggleCollapse) A.toggleCollapse(R.selected); else R.onDblFile(R.selected);
      }
    });
  }
  if(typeof document!=='undefined' && typeof window!=='undefined' && window.CM && CM.App){
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wire); else setTimeout(wire, 0);
  }

  return {describe, summary, nextInDirection};
})();
