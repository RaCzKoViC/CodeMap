/* ===================== mindmap.js — MindMap working mode (DOM-based mind map editor) ===================== */
CM.MindMap = (function(){
  const U = CM.util, $ = U.$, I = CM.i18n;
  let root=null, world=null, svg=null, canvas=null, inspector=null;
  let cam={x:0,y:0,zoom:1};
  let state={ nodes:[], edges:[], seq:1, name:I.t('cm.defaultMapName','Nowa mapa myśli'), layout:'free', line:'curved', colorSchema:true, spaceMain:240, spaceCross:70 };
  let selected=null, connectMode=false, connectFrom=null, reattachMode=false, built=false, active=false;
  let multi=new Set(), marqueeEl=null;   // multi-selection (Shift-click / Shift-drag box)
  let clipboard=null, surround=null, layoutDlg=null;
  let _snaps=[], _snapTimer=null, _timelineEl=null;
  let _slModal=null, _slMode='save';

  // ---- undo / redo (JSON snapshots of the working state) ----
  let _undo=[], _redo=[];
  function mmSnap(){ return JSON.stringify({nodes:state.nodes, edges:state.edges, seq:state.seq, name:state.name, layout:state.layout, line:state.line, spaceMain:state.spaceMain, spaceCross:state.spaceCross,
    draw:(CM.Draw&&CM.Draw.serialize)?CM.Draw.serialize():[]}); }
  function pushUndo(){ try{ _undo.push(mmSnap()); }catch(e){ return; } if(_undo.length>80) _undo.shift(); _redo.length=0; refreshUndoBtns(); }
  function pushUndoSnap(s){ if(!s) return; _undo.push(s); if(_undo.length>80) _undo.shift(); _redo.length=0; refreshUndoBtns(); }
  function mmRestore(s){ const o=JSON.parse(s);
    state.nodes=o.nodes; state.edges=o.edges; state.seq=o.seq; state.name=o.name; state.layout=o.layout; state.line=o.line;
    if(o.spaceMain) state.spaceMain=o.spaceMain; if(o.spaceCross) state.spaceCross=o.spaceCross;
    if(CM.Draw&&CM.Draw.load) CM.Draw.load(o.draw||[]);
    selected=null; multi.clear(); connectMode=false; connectFrom=null; reattachMode=false; syncTitle(); render(); renderInspector(); hideSurround(); }
  function mmUndo(){ if(!_undo.length) return; _redo.push(mmSnap()); mmRestore(_undo.pop()); refreshUndoBtns(); }
  function mmRedo(){ if(!_redo.length) return; _undo.push(mmSnap()); mmRestore(_redo.pop()); refreshUndoBtns(); }
  function refreshUndoBtns(){ const u=document.getElementById('mm-undo'), r=document.getElementById('mm-redo');
    if(u) u.classList.toggle('mm-disabled', !_undo.length); if(r) r.classList.toggle('mm-disabled', !_redo.length); }
  const SCHEMA_PALETTES={
    ocean:['#22d3ee','#38bdf8','#7c5cff','#34d399','#2dd4bf','#60a5fa'],
    sunset:['#fb7185','#f59e0b','#f472b6','#fbbf24','#fca5a5','#c084fc'],
    forest:['#34d399','#a3e635','#22d3ee','#4ade80','#84cc16','#2dd4bf'],
    mono:['#94a3b8','#cbd5e1','#64748b','#e2e8f4','#7d8aa0','#aebacb'],
  };
  let onExit=()=>{};

  // built-in frame templates (no external assets) — class -> label
  // {k:key, key:i18n key, pl:PL fallback} — label resolved at RENDER time so it follows runtime language switches
  const TEMPLATES=[
    {k:'card',     key:'cm.tplCard',     pl:'Karta'},
    {k:'note',     key:'cm.tplNote',     pl:'Notatka'},
    {k:'sticky',   key:'cm.tplSticky',   pl:'Karteczka'},
    {k:'cloud',    key:'cm.tplCloud',    pl:'Chmurka'},
    {k:'banner',   key:'cm.tplBanner',   pl:'Baner'},
    {k:'pill',     key:'cm.tplPill',     pl:'Pigułka'},
    {k:'callout',  key:'cm.tplCallout',  pl:'Dymek'},
    {k:'code',     key:'cm.tplCode',     pl:'Kod'},
    {k:'frame',    key:'cm.tplFrame',    pl:'Ramka'},
    {k:'hexcard',  key:'cm.tplHexcard',  pl:'Heksagon'},
    {k:'circle',   key:'cm.tplCircle',   pl:'Koło'},
    {k:'diamond',  key:'cm.tplDiamond',  pl:'Romb'},
    {k:'terminal', key:'cm.tplTerminal', pl:'Terminal'},
    {k:'tag',      key:'cm.tplTag',      pl:'Etykieta'},
    {k:'quote',    key:'cm.tplQuote',    pl:'Cytat'},
    {k:'neon',     key:'cm.tplNeon',     pl:'Neon'},
  ];
  const tplName=(t)=>I.t(t.key, t.pl);
  const COLORS=['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b','#f472b6','#38bdf8','#a3e635','#e2e8f4','#f87171'];

  // ---- starter diagram types (like MindDump / Mapify), all built from the card system ----
  let _mkSeqNodes=null;
  function mk(x,y,opts){ const n=Object.assign({id:'n'+(state.seq++),x,y,w:160,text:'',template:'card',color:'#22d3ee',font:14},opts); state.nodes.push(n); return n; }
  function lk(a,b){ if(a&&b) state.edges.push({from:a.id,to:b.id}); }
  const DIAGRAMS=[
    {k:'mindmap', name:I.t('cm.diagMindmap','Mapa myśli'), icon:'layers', desc:I.t('cm.diagMindmapDesc','Rozgałęziona struktura — burza mózgów i porządkowanie pomysłów.'), build(){
      const c=mk(-100,-34,{text:I.t('cm.diagMindmapTopic','Temat główny'),template:'banner',color:'#7c5cff',w:200,font:18});
      const branches=[[I.t('cm.diagMindmapIdea1','Pomysł 1'),'#22d3ee'],[I.t('cm.diagMindmapIdea2','Pomysł 2'),'#34d399'],[I.t('cm.diagMindmapIdea3','Pomysł 3'),'#fb7185'],[I.t('cm.diagMindmapIdea4','Pomysł 4'),'#f59e0b'],[I.t('cm.diagMindmapIdea5','Pomysł 5'),'#38bdf8'],[I.t('cm.diagMindmapIdea6','Pomysł 6'),'#f472b6']];
      const R=310; branches.forEach(([t,col],i)=>{ const a=(i/branches.length)*Math.PI*2-Math.PI*0.1; const n=mk(Math.cos(a)*R-80,Math.sin(a)*R-26,{text:t,template:'card',color:col,w:155,parent:c.id}); lk(c,n); const sub=mk(n.x+(i%2?60:-60),n.y+90,{text:'Podpomysł',template:'note',color:col,w:130,font:12,parent:n.id}); lk(n,sub); }); } },
    {k:'outline', name:I.t('cm.diagOutline','Konspekt'), icon:'file', desc:I.t('cm.diagOutlineDesc','Hierarchiczny układ punktów — planowanie i analiza.'), build(){
      const t=mk(0,-260,{text:I.t('cm.diagOutlineTitle','Tytuł dokumentu'),template:'banner',color:'#22d3ee',w:240,font:18}); let prev=t;
      [[I.t('cm.diagOutline1','1. Wstęp'),0],[I.t('cm.diagOutline11','1.1 Kontekst'),40],[I.t('cm.diagOutline2','2. Rozwinięcie'),0],[I.t('cm.diagOutline21','2.1 Punkt A'),40],[I.t('cm.diagOutline22','2.2 Punkt B'),40],[I.t('cm.diagOutline3','3. Podsumowanie'),0]].forEach((r,i)=>{
        const n=mk(r[1],-180+i*70,{text:r[0],template:'note',color:'#34d399',w:230,font:13}); lk(t,n); }); } },
    {k:'timeline', name:I.t('cm.diagTimeline','Oś czasu'), icon:'clock', desc:I.t('cm.diagTimelineDesc','Zdarzenia chronologicznie — postęp projektu lub historia.'), build(){
      const ev=[I.t('cm.diagTimelineStart','Start'),I.t('cm.diagTimelineStage1','Etap 1'),I.t('cm.diagTimelineStage2','Etap 2'),I.t('cm.diagTimelineStage3','Etap 3'),I.t('cm.diagTimelineGoal','Meta')]; let prev=null;
      ev.forEach((t,i)=>{ const n=mk(i*240-480,0,{text:t,template:'pill',color:COLORS[i%COLORS.length],w:150}); if(prev)lk(prev,n); prev=n; }); } },
    {k:'table', name:I.t('cm.diagTable','Tabela'), icon:'grid', desc:I.t('cm.diagTableDesc','Dane w wierszach i kolumnach — analiza porównawcza.'), build(){
      const cols=[I.t('cm.diagTableColA','Kolumna A'),I.t('cm.diagTableColB','Kolumna B'),I.t('cm.diagTableColC','Kolumna C')];
      cols.forEach((t,c)=>mk(c*180-260,-120,{text:t,template:'banner',color:'#38bdf8',w:160,font:13}));
      for(let r=0;r<3;r++) for(let c=0;c<3;c++) mk(c*180-260,-40+r*70,{text:'—',template:'frame',color:'#46597a',w:160,font:13}); } },
    {k:'flowchart', name:I.t('cm.diagFlowchart','Schemat blokowy'), icon:'flow', desc:I.t('cm.diagFlowchartDesc','Procesy i decyzje — kroki i przepływy.'), build(){
      const s=mk(-80,-260,{text:I.t('cm.diagFlowchartStart','Start'),template:'pill',color:'#34d399',w:130});
      const p=mk(-90,-150,{text:I.t('cm.diagFlowchartProcess','Proces'),template:'card',color:'#22d3ee',w:150});
      const d=mk(-95,-30,{text:I.t('cm.diagFlowchartDecision','Decyzja?'),template:'hexcard',color:'#f59e0b',w:160});
      const y=mk(-260,110,{text:I.t('cm.diagFlowchartYes','Tak → akcja'),template:'card',color:'#34d399',w:150});
      const n=mk(110,110,{text:I.t('cm.diagFlowchartNo','Nie → akcja'),template:'card',color:'#fb7185',w:150});
      const e=mk(-80,230,{text:I.t('cm.diagFlowchartEnd','Koniec'),template:'pill',color:'#7c5cff',w:130});
      lk(s,p);lk(p,d);lk(d,y);lk(d,n);lk(y,e);lk(n,e); } },
    {k:'fishbone', name:I.t('cm.diagFishbone','Diagram Ishikawy'), icon:'flow', desc:I.t('cm.diagFishboneDesc','Analiza przyczyn źródłowych (rybi szkielet).'), build(){
      const head=mk(360,-30,{text:I.t('cm.diagFishboneProblem','Problem'),template:'banner',color:'#fb7185',w:160,font:16});
      const bones=[I.t('cm.diagFishbonePeople','Ludzie'),I.t('cm.diagFishboneMethods','Metody'),I.t('cm.diagFishboneMachines','Maszyny'),I.t('cm.diagFishboneMaterials','Materiały'),I.t('cm.diagFishboneMeasurement','Pomiar'),I.t('cm.diagFishboneEnvironment','Środowisko')];
      bones.forEach((t,i)=>{ const side=i%2?1:-1, idx=Math.floor(i/2); const n=mk(idx*180-260, side*170,{text:t,template:'card',color:COLORS[i%COLORS.length],w:150}); lk(n,head); }); } },
    {k:'sixhats', name:I.t('cm.diagSixhats','Sześć kapeluszy'), icon:'target', desc:I.t('cm.diagSixhatsDesc','Myślenie z wielu perspektyw — decyzje zespołowe.'), build(){
      const hats=[[I.t('cm.diagSixhatsWhite','Biały — fakty'),'#e2e8f4'],[I.t('cm.diagSixhatsRed','Czerwony — emocje'),'#fb7185'],[I.t('cm.diagSixhatsBlack','Czarny — ryzyka'),'#334155'],[I.t('cm.diagSixhatsYellow','Żółty — korzyści'),'#f59e0b'],[I.t('cm.diagSixhatsGreen','Zielony — kreatywność'),'#34d399'],[I.t('cm.diagSixhatsBlue','Niebieski — proces'),'#38bdf8']];
      hats.forEach((h,i)=>mk((i%3)*230-330, Math.floor(i/3)*120-60,{text:h[0],template:'card',color:h[1],w:200,font:14})); } },
    {k:'swot', name:I.t('cm.diagSwot','Analiza SWOT'), icon:'grid', desc:I.t('cm.diagSwotDesc','Mocne/słabe strony, szanse i zagrożenia.'), build(){
      const title=mk(-115,-280,{text:'SWOT',template:'banner',color:'#7c5cff',w:230,font:20});
      const s=mk(-290,-160,{text:I.t('cm.diagSwotS','💪 Mocne strony'),template:'frame',color:'#34d399',w:250,font:14,parent:title.id});
      const w=mk(20,-160,{text:I.t('cm.diagSwotW','⚠️ Słabe strony'),template:'frame',color:'#fb7185',w:250,font:14,parent:title.id});
      const o=mk(-290,60,{text:I.t('cm.diagSwotO','🚀 Szanse'),template:'frame',color:'#38bdf8',w:250,font:14,parent:title.id});
      const t=mk(20,60,{text:I.t('cm.diagSwotT','🛡️ Zagrożenia'),template:'frame',color:'#f59e0b',w:250,font:14,parent:title.id});
      lk(title,s);lk(title,w);lk(title,o);lk(title,t);
      for(let i=0;i<3;i++){ mk(s.x+16,s.y+70+i*56,{text:'+ Punkt '+(i+1),template:'note',color:'#34d399',w:220,font:12,parent:s.id}); }
      for(let i=0;i<3;i++){ mk(w.x+16,w.y+70+i*56,{text:'- Punkt '+(i+1),template:'note',color:'#fb7185',w:220,font:12,parent:w.id}); }
    } },
    {k:'chat', name:I.t('cm.diagChat','Dymki rozmowy'), icon:'copy', desc:I.t('cm.diagChatDesc','Scenariusze rozmów — odgrywanie ról i dyskusje.'), build(){
      [I.t('cm.diagChat1','Cześć! O czym dziś?'),I.t('cm.diagChat2','Chciałbym omówić plan…'),I.t('cm.diagChat3','Świetnie, zacznijmy od celu.'),I.t('cm.diagChat4','Cel: zwiększyć zasięg.')].forEach((t,i)=>{
        const side=i%2?1:-1; mk(side*140-90, i*100-150,{text:t,template:'callout',color:i%2?'#7c5cff':'#22d3ee',w:200,font:13}); }); } },
    {k:'radial', name:I.t('cm.diagRadial','Diagram radialny'), icon:'crosshair', desc:I.t('cm.diagRadialDesc','Elementy promieniście od centralnego punktu.'), build(){
      const c=mk(-70,-30,{text:I.t('cm.diagRadialCenter','Centrum'),template:'hexcard',color:'#f472b6',w:150,font:16});
      const R=300; for(let i=0;i<8;i++){ const a=(i/8)*Math.PI*2; const n=mk(Math.cos(a)*R-70,Math.sin(a)*R-26,{text:I.t('cm.diagRadialElement','Element ')+(i+1),template:'pill',color:COLORS[i%COLORS.length],w:140}); lk(c,n); } } },
    {k:'umlclass', name:I.t('cm.diagUmlclass','UML — diagram klas'), icon:'box', desc:I.t('cm.diagUmlclassDesc','Struktura klas: atrybuty, metody, relacje.'), build(){
      const a=mk(-340,-80,{text:I.t('cm.diagUmlclassA','Klasa A\n— pole: typ\n+ metoda()'),template:'frame',color:'#22d3ee',w:200,font:12});
      const b=mk(-40,-80,{text:I.t('cm.diagUmlclassB','Klasa B\n— pole: typ\n+ metoda()'),template:'frame',color:'#7c5cff',w:200,font:12});
      const c=mk(160,120,{text:I.t('cm.diagUmlclassC','Klasa C\n+ metoda()'),template:'frame',color:'#34d399',w:200,font:12});
      lk(a,b);lk(b,c); } },
    {k:'umlusecase', name:I.t('cm.diagUmlusecase','UML — przypadki użycia'), icon:'eye', desc:I.t('cm.diagUmlusecaseDesc','Aktorzy i przypadki użycia systemu.'), build(){
      const act=mk(-360,-20,{text:I.t('cm.diagUmlusecaseActor','👤 Aktor'),template:'sticky',color:'#f59e0b',w:120,font:14});
      const u1=mk(-120,-120,{text:I.t('cm.diagUmlusecaseLogin','Logowanie'),template:'cloud',color:'#22d3ee',w:170});
      const u2=mk(-120,0,{text:I.t('cm.diagUmlusecaseBrowse','Przeglądanie'),template:'cloud',color:'#38bdf8',w:170});
      const u3=mk(-120,120,{text:I.t('cm.diagUmlusecasePurchase','Zakup'),template:'cloud',color:'#34d399',w:170});
      lk(act,u1);lk(act,u2);lk(act,u3); } },
    {k:'umlsequence', name:I.t('cm.diagUmlsequence','UML — sekwencja'), icon:'layers', desc:I.t('cm.diagUmlsequenceDesc','Sekwencja komunikatów między obiektami.'), build(){
      const a=mk(-300,-200,{text:I.t('cm.diagUmlsequenceUser',':Użytkownik'),template:'banner',color:'#22d3ee',w:160,font:13});
      const b=mk(0,-200,{text:I.t('cm.diagUmlsequenceSystem',':System'),template:'banner',color:'#7c5cff',w:160,font:13});
      const c=mk(300,-200,{text:I.t('cm.diagUmlsequenceDb',':Baza'),template:'banner',color:'#34d399',w:160,font:13});
      const m1=mk(-160,-90,{text:I.t('cm.diagUmlsequenceMsg1','1: żądanie →'),template:'note',color:'#46597a',w:200,font:12});
      const m2=mk(140,30,{text:I.t('cm.diagUmlsequenceMsg2','2: zapytanie →'),template:'note',color:'#46597a',w:200,font:12});
      lk(a,b);lk(b,c); } },
    {k:'bpmn', name:I.t('cm.diagBpmn','BPMN'), icon:'flow', desc:I.t('cm.diagBpmnDesc','Standaryzowany zapis procesów biznesowych.'), build(){
      const s=mk(-440,-26,{text:I.t('cm.diagBpmnStart','● Start'),template:'pill',color:'#34d399',w:120});
      const t1=mk(-280,-30,{text:I.t('cm.diagBpmnTask1','Zadanie 1'),template:'card',color:'#22d3ee',w:150});
      const g=mk(-100,-34,{text:I.t('cm.diagBpmnGateway','◇ Bramka'),template:'hexcard',color:'#f59e0b',w:150});
      const t2=mk(90,-30,{text:I.t('cm.diagBpmnTask2','Zadanie 2'),template:'card',color:'#38bdf8',w:150});
      const e=mk(280,-26,{text:I.t('cm.diagBpmnEnd','◉ Koniec'),template:'pill',color:'#fb7185',w:120});
      lk(s,t1);lk(t1,g);lk(g,t2);lk(t2,e); } },
    {k:'gantt', name:I.t('cm.diagGantt','Gantt'), icon:'layers', desc:I.t('cm.diagGanttDesc','Postęp zadań na osi czasu — zarządzanie projektem.'), build(){
      const tasks=[[I.t('cm.diagGanttTaskA','Zadanie A'),0,200],[I.t('cm.diagGanttTaskB','Zadanie B'),120,260],[I.t('cm.diagGanttTaskC','Zadanie C'),300,180],[I.t('cm.diagGanttTaskD','Zadanie D'),420,220]];
      mk(-260,-150,{text:I.t('cm.diagGanttSchedule','Harmonogram'),template:'banner',color:'#7c5cff',w:240,font:16});
      tasks.forEach((t,i)=>mk(t[1]-260,-70+i*60,{text:t[0],template:'pill',color:COLORS[i%COLORS.length],w:t[2],font:13})); } },
    {k:'carddeck', name:I.t('cm.diagCarddeck','Talia kart'), icon:'copy', desc:I.t('cm.diagCarddeckDesc','Fiszki do powtórek i porządkowania wiedzy.'), build(){
      [I.t('cm.diagCarddeck1','Pojęcie 1'),I.t('cm.diagCarddeck2','Pojęcie 2'),I.t('cm.diagCarddeck3','Pojęcie 3'),I.t('cm.diagCarddeck4','Pojęcie 4')].forEach((t,i)=>mk(i*40-80,i*16-40,{text:t+I.t('cm.diagCarddeckHint','\n(kliknij, aby edytować)'),template:'sticky',color:COLORS[i%COLORS.length],w:180,font:14})); } },
    {k:'kanban', name:I.t('cm.diagKanban','Kanban'), icon:'grid', desc:I.t('cm.diagKanbanDesc','Tablica zadań: Do zrobienia · W toku · Zrobione.'), build(){
      const cols=[[I.t('cm.diagKanbanTodo','📋 Do zrobienia'),'#38bdf8'],[I.t('cm.diagKanbanDoing','⚙️ W toku'),'#f59e0b'],[I.t('cm.diagKanbanDone','✅ Zrobione'),'#34d399']];
      const tasks=[['Zadanie A','Zadanie B','Zadanie C'],['Zadanie D','Zadanie E'],['Zadanie F','Zadanie G']];
      cols.forEach((cl,ci)=>{ const h=mk(ci*270-380,-220,{text:cl[0],template:'banner',color:cl[1],w:230,font:15});
        tasks[ci].forEach((t,ri)=>{ const n=mk(ci*270-380,-140+ri*86,{text:t,template:'sticky',color:cl[1],w:230,font:13,parent:h.id}); lk(h,n); }); }); } },
    {k:'decision', name:I.t('cm.diagDecision','Drzewo decyzyjne'), icon:'flow', desc:I.t('cm.diagDecisionDesc','Pytania tak/nie prowadzące do wyników.'), build(){
      const q=mk(-85,-240,{text:I.t('cm.diagDecisionQ','Decyzja?'),template:'hexcard',color:'#f59e0b',w:170,font:15});
      const y=mk(-330,-90,{text:I.t('cm.diagDecisionYes','Tak'),template:'pill',color:'#34d399',w:120}); const no=mk(170,-90,{text:I.t('cm.diagDecisionNo','Nie'),template:'pill',color:'#fb7185',w:120});
      const y1=mk(-400,90,{text:I.t('cm.diagDecisionResultA','Wynik A'),template:'card',color:'#22d3ee',w:160}); const y2=mk(-210,90,{text:I.t('cm.diagDecisionResultB','Wynik B'),template:'card',color:'#7c5cff',w:160});
      const n1=mk(120,90,{text:I.t('cm.diagDecisionResultC','Wynik C'),template:'card',color:'#38bdf8',w:160});
      lk(q,y);lk(q,no);lk(y,y1);lk(y,y2);lk(no,n1); } },
    {k:'okr', name:I.t('cm.diagOkr','OKR'), icon:'target', desc:I.t('cm.diagOkrDesc','Cel (Objective) i mierzalne rezultaty kluczowe.'), build(){
      const o=mk(-130,-180,{text:I.t('cm.diagOkrObjective','Cel: wpisz cel'),template:'banner',color:'#7c5cff',w:260,font:16});
      [I.t('cm.diagOkrKr1','KR1: metryka → wartość'),I.t('cm.diagOkrKr2','KR2: metryka → wartość'),I.t('cm.diagOkrKr3','KR3: metryka → wartość')].forEach((t,i)=>{ const n=mk(-150,-70+i*82,{text:t,template:'frame',color:'#34d399',w:300,font:13}); lk(o,n); }); } },
    {k:'roadmap', name:I.t('cm.diagRoadmap','Roadmapa'), icon:'clock', desc:I.t('cm.diagRoadmapDesc','Plan kwartalny Q1–Q4 z kamieniami milowymi.'), build(){
      const qs=['Q1','Q2','Q3','Q4'], cols=['#22d3ee','#34d399','#f59e0b','#fb7185'];
      qs.forEach((q,i)=>{ mk(i*250-375,-160,{text:q,template:'pill',color:cols[i],w:160,font:15});
        for(let r=0;r<2;r++) mk(i*250-375,-72+r*84,{text:I.t('cm.diagRoadmapMilestone','Kamień ')+(r+1),template:'card',color:cols[i],w:190,font:13}); }); } },
    {k:'orgchart', name:I.t('cm.diagOrgchart','Organigram'), icon:'layers', desc:I.t('cm.diagOrgchartDesc','Hierarchia organizacji — od góry w dół.'), build(){
      const ceo=mk(-95,-230,{text:I.t('cm.diagOrgchartCeo','Dyrektor'),template:'banner',color:'#7c5cff',w:190,font:15});
      [I.t('cm.diagOrgchartDeptA','Dział A'),I.t('cm.diagOrgchartDeptB','Dział B'),I.t('cm.diagOrgchartDeptC','Dział C')].forEach((t,i)=>{ const m=mk(i*230-310,-90,{text:t,template:'card',color:'#22d3ee',w:180,font:14}); lk(ceo,m);
        for(let r=0;r<2;r++){ const e=mk(i*230-310,40+r*78,{text:I.t('cm.diagOrgchartTeam','Zespół ')+(r+1),template:'note',color:'#34d399',w:180,font:12}); lk(m,e); } }); } },
    {k:'proscons', name:I.t('cm.diagProscons','Za i przeciw'), icon:'copy', desc:I.t('cm.diagProsconsDesc','Zestawienie argumentów za i przeciw.'), build(){
      const t=mk(-95,-220,{text:I.t('cm.diagProsconsTopic','Decyzja / temat'),template:'banner',color:'#7c5cff',w:210,font:15});
      const pro=mk(-330,-80,{text:I.t('cm.diagProsconsPro','ZA'),template:'pill',color:'#34d399',w:150,font:15}); const con=mk(170,-80,{text:I.t('cm.diagProsconsCon','PRZECIW'),template:'pill',color:'#fb7185',w:170,font:15});
      lk(t,pro);lk(t,con);
      for(let i=0;i<3;i++){ const a=mk(-350,40+i*78,{text:I.t('cm.diagProsconsArg','Argument ')+(i+1),template:'card',color:'#34d399',w:200,font:12}); lk(pro,a);
        const b=mk(160,40+i*78,{text:I.t('cm.diagProsconsArg','Argument ')+(i+1),template:'card',color:'#fb7185',w:200,font:12}); lk(con,b); } } },
    {k:'conceptmap', name:I.t('cm.diagConceptmap','Mapa pojęć'), icon:'crosshair', desc:I.t('cm.diagConceptmapDesc','Pojęcia połączone opisanymi relacjami.'), build(){
      const c=mk(-80,-30,{text:I.t('cm.diagConceptmapCentral','Pojęcie główne'),template:'hexcard',color:'#7c5cff',w:180,font:16});
      const labels=[I.t('cm.diagConceptmapC1','Pojęcie A'),I.t('cm.diagConceptmapC2','Pojęcie B'),I.t('cm.diagConceptmapC3','Pojęcie C'),I.t('cm.diagConceptmapC4','Pojęcie D'),I.t('cm.diagConceptmapC5','Pojęcie E')];
      const R=300; labels.forEach((t,i)=>{ const a=(i/labels.length)*Math.PI*2-Math.PI/2; const n=mk(Math.cos(a)*R-80,Math.sin(a)*R-26,{text:t,template:'card',color:COLORS[i%COLORS.length],w:160}); lk(c,n); });
      const sub=mk(360,200,{text:I.t('cm.diagConceptmapSub','Pojęcie podrzędne'),template:'note',color:'#34d399',w:170,font:12}); lk(state.nodes[3],sub); } },
    {k:'empathy', name:I.t('cm.diagEmpathy','Mapa empatii'), icon:'target', desc:I.t('cm.diagEmpathyDesc','Co użytkownik myśli, czuje, widzi, mówi i robi.'), build(){
      mk(-90,-30,{text:I.t('cm.diagEmpathyUser','Użytkownik'),template:'hexcard',color:'#7c5cff',w:180,font:16});
      const quad=[[I.t('cm.diagEmpathyThink','Myśli i czuje'),'#38bdf8',-300,-200],[I.t('cm.diagEmpathySee','Widzi'),'#34d399',120,-200],[I.t('cm.diagEmpathyHear','Słyszy'),'#f59e0b',-300,140],[I.t('cm.diagEmpathySay','Mówi i robi'),'#fb7185',120,140]];
      quad.forEach(q=>mk(q[2],q[3],{text:q[0],template:'frame',color:q[1],w:230,font:14}));
      mk(-330,300,{text:I.t('cm.diagEmpathyPain','Bóle / frustracje'),template:'card',color:'#f87171',w:220,font:13});
      mk(110,300,{text:I.t('cm.diagEmpathyGain','Korzyści / cele'),template:'card',color:'#a3e635',w:220,font:13}); } },
    {k:'bmc', name:I.t('cm.diagBmc','Business Model Canvas'), icon:'grid', desc:I.t('cm.diagBmcDesc','Dziewięć bloków modelu biznesowego.'), build(){
      const blocks=[[I.t('cm.diagBmcPartners','Kluczowi partnerzy'),0,0,1,2],[I.t('cm.diagBmcActivities','Kluczowe działania'),1,0,1,1],[I.t('cm.diagBmcResources','Kluczowe zasoby'),1,1,1,1],[I.t('cm.diagBmcValue','Propozycja wartości'),2,0,1,2],[I.t('cm.diagBmcRelations','Relacje z klientami'),3,0,1,1],[I.t('cm.diagBmcChannels','Kanały'),3,1,1,1],[I.t('cm.diagBmcSegments','Segmenty klientów'),4,0,1,2]];
      const cw=220,ch=120; blocks.forEach((b,i)=>mk(b[1]*cw-540,b[2]*ch-150,{text:b[0],template:'frame',color:COLORS[i%COLORS.length],w:cw-16,font:13}));
      mk(-540,-150+ch*2,{text:I.t('cm.diagBmcCosts','Struktura kosztów'),template:'frame',color:'#fb7185',w:cw*2.5,font:13});
      mk(-540+cw*2.6,-150+ch*2,{text:I.t('cm.diagBmcRevenue','Strumienie przychodów'),template:'frame',color:'#34d399',w:cw*2.5,font:13}); } },
    {k:'storymap', name:I.t('cm.diagStorymap','Mapa historyjek'), icon:'grid', desc:I.t('cm.diagStorymapDesc','Aktywności, kroki i historyjki użytkownika.'), build(){
      const acts=[I.t('cm.diagStorymapAct1','Aktywność 1'),I.t('cm.diagStorymapAct2','Aktywność 2'),I.t('cm.diagStorymapAct3','Aktywność 3')];
      acts.forEach((t,c)=>{ mk(c*240-330,-200,{text:t,template:'banner',color:'#7c5cff',w:210,font:14});
        mk(c*240-330,-110,{text:I.t('cm.diagStorymapStep','Krok'),template:'pill',color:'#38bdf8',w:210,font:13});
        for(let r=0;r<2;r++) mk(c*240-330,-30+r*82,{text:I.t('cm.diagStorymapStory','Historyjka ')+(r+1),template:'sticky',color:'#f59e0b',w:210,font:12}); }); } },
    {k:'affinity', name:I.t('cm.diagAffinity','Diagram pokrewieństwa'), icon:'grid', desc:I.t('cm.diagAffinityDesc','Grupowanie pomysłów w tematyczne klastry.'), build(){
      const groups=[[I.t('cm.diagAffinityGroupA','Grupa A'),'#38bdf8'],[I.t('cm.diagAffinityGroupB','Grupa B'),'#34d399'],[I.t('cm.diagAffinityGroupC','Grupa C'),'#f59e0b']];
      groups.forEach((g,c)=>{ const h=mk(c*250-340,-200,{text:g[0],template:'banner',color:g[1],w:210,font:14});
        for(let r=0;r<3;r++){ const note=mk(c*250-340,-110+r*82,{text:I.t('cm.diagAffinityNote','Notatka ')+(r+1),template:'sticky',color:g[1],w:210,font:12}); lk(h,note); } }); } },
    {k:'venn', name:I.t('cm.diagVenn','Diagram Venna'), icon:'target', desc:I.t('cm.diagVennDesc','Nakładające się zbiory i ich część wspólna.'), build(){
      mk(-260,-90,{text:I.t('cm.diagVennA','Zbiór A'),template:'cloud',color:'#38bdf8',w:240,font:15});
      mk(30,-90,{text:I.t('cm.diagVennB','Zbiór B'),template:'cloud',color:'#fb7185',w:240,font:15});
      mk(-260,140,{text:I.t('cm.diagVennC','Zbiór C'),template:'cloud',color:'#34d399',w:240,font:15});
      mk(-110,30,{text:I.t('cm.diagVennIntersect','Część wspólna'),template:'pill',color:'#f59e0b',w:200,font:13}); } },
    {k:'pyramid', name:I.t('cm.diagPyramid','Piramida'), icon:'layers', desc:I.t('cm.diagPyramidDesc','Hierarchia poziomów — np. piramida Maslowa.'), build(){
      const levels=[[I.t('cm.diagPyramidL5','Samorealizacja'),'#7c5cff',200],[I.t('cm.diagPyramidL4','Uznanie'),'#fb7185',300],[I.t('cm.diagPyramidL3','Przynależność'),'#f59e0b',400],[I.t('cm.diagPyramidL2','Bezpieczeństwo'),'#38bdf8',500],[I.t('cm.diagPyramidL1','Potrzeby fizjologiczne'),'#34d399',600]];
      levels.forEach((l,i)=>mk(-l[2]/2,-200+i*86,{text:l[0],template:'banner',color:l[1],w:l[2],font:14})); } },
    {k:'funnel', name:I.t('cm.diagFunnel','Lejek'), icon:'layers', desc:I.t('cm.diagFunnelDesc','Zwężające się etapy konwersji.'), build(){
      const stages=[[I.t('cm.diagFunnelAwareness','Świadomość'),'#38bdf8',560],[I.t('cm.diagFunnelInterest','Zainteresowanie'),'#7c5cff',440],[I.t('cm.diagFunnelDesire','Pożądanie'),'#f59e0b',320],[I.t('cm.diagFunnelAction','Działanie'),'#34d399',200]];
      stages.forEach((st,i)=>mk(-st[2]/2,-180+i*92,{text:st[0],template:'pill',color:st[1],w:st[2],font:14})); } },
    {k:'pert', name:I.t('cm.diagPert','Sieć PERT'), icon:'flow', desc:I.t('cm.diagPertDesc','Sieć zależności zadań w projekcie.'), build(){
      const a=mk(-440,-30,{text:I.t('cm.diagPertStart','Start'),template:'pill',color:'#34d399',w:120});
      const t1=mk(-260,-140,{text:I.t('cm.diagPertTask1','Zadanie A'),template:'card',color:'#22d3ee',w:160});
      const t2=mk(-260,80,{text:I.t('cm.diagPertTask2','Zadanie B'),template:'card',color:'#38bdf8',w:160});
      const t3=mk(-40,-30,{text:I.t('cm.diagPertTask3','Zadanie C'),template:'card',color:'#f59e0b',w:160});
      const e=mk(180,-30,{text:I.t('cm.diagPertEnd','Koniec'),template:'pill',color:'#fb7185',w:120});
      lk(a,t1);lk(a,t2);lk(t1,t3);lk(t2,t3);lk(t3,e); } },
    {k:'fivewhys', name:I.t('cm.diagFivewhys','5 × Dlaczego'), icon:'flow', desc:I.t('cm.diagFivewhysDesc','Drążenie przyczyny źródłowej pytaniami „dlaczego?".'), build(){
      let prev=mk(-95,-260,{text:I.t('cm.diagFivewhysProblem','Problem'),template:'banner',color:'#fb7185',w:230,font:15});
      for(let i=0;i<5;i++){ const n=mk(i*30-80,-160+i*86,{text:I.t('cm.diagFivewhysWhy','Dlaczego? ')+(i+1),template:'card',color:COLORS[i%COLORS.length],w:230,font:13}); lk(prev,n); prev=n; }
      const root=mk(60,290,{text:I.t('cm.diagFivewhysRoot','Przyczyna źródłowa'),template:'hexcard',color:'#34d399',w:230,font:14}); lk(prev,root); } },
    {k:'radar', name:I.t('cm.diagRadar','Radar / pajęczyna'), icon:'crosshair', desc:I.t('cm.diagRadarDesc','Porównanie cech na osiach promienistych.'), build(){
      const c=mk(-60,-26,{text:I.t('cm.diagRadarCenter','Profil'),template:'hexcard',color:'#7c5cff',w:140,font:15});
      const axes=[I.t('cm.diagRadarAxis1','Cecha 1'),I.t('cm.diagRadarAxis2','Cecha 2'),I.t('cm.diagRadarAxis3','Cecha 3'),I.t('cm.diagRadarAxis4','Cecha 4'),I.t('cm.diagRadarAxis5','Cecha 5'),I.t('cm.diagRadarAxis6','Cecha 6')];
      const R=300; axes.forEach((t,i)=>{ const a=(i/axes.length)*Math.PI*2-Math.PI/2; const n=mk(Math.cos(a)*R-70,Math.sin(a)*R-22,{text:t,template:'pill',color:COLORS[i%COLORS.length],w:140,font:12}); lk(c,n); }); } },
    {k:'valuechain', name:I.t('cm.diagValuechain','Łańcuch wartości'), icon:'flow', desc:I.t('cm.diagValuechainDesc','Działania podstawowe i wspierające (Porter).'), build(){
      const support=[I.t('cm.diagValuechainInfra','Infrastruktura'),I.t('cm.diagValuechainHr','Zarządzanie kadrami'),I.t('cm.diagValuechainTech','Technologia')];
      support.forEach((t,i)=>mk(-440,-200+i*64,{text:t,template:'frame',color:'#7c5cff',w:560,font:12}));
      const primary=[[I.t('cm.diagValuechainInbound','Logistyka wej.'),'#38bdf8'],[I.t('cm.diagValuechainOps','Operacje'),'#22d3ee'],[I.t('cm.diagValuechainOutbound','Logistyka wyj.'),'#34d399'],[I.t('cm.diagValuechainMarketing','Marketing'),'#f59e0b'],[I.t('cm.diagValuechainService','Serwis'),'#fb7185']];
      let prev=null; primary.forEach((p,i)=>{ const n=mk(i*150-440,40,{text:p[0],template:'card',color:p[1],w:150,font:12}); if(prev)lk(prev,n); prev=n; });
      mk(330,40,{text:I.t('cm.diagValuechainMargin','Marża'),template:'pill',color:'#a3e635',w:120,font:14}); } },
  ];
  function buildDiagram(k){ const d=DIAGRAMS.find(x=>x.k===k); if(!d) return; if(state.nodes.length) pushUndo();
    state.nodes=[]; state.edges=[]; selected=null; state.mapId=null; d.build(); state.name=d.name; syncTitle(); _snaps=[]; render(); renderInspector(); setTimeout(fitView,20); setTimeout(()=>takeSnap('template:'+k),500); }

  // populate (or repopulate, e.g. on language change) the left tool rail
  function fillTools(tools){
    tools.innerHTML='';
    const toolBtn=(ic,short,title,fn,cls,id)=>{ const b=U.el('button',{class:'mm-tool '+(cls||''),title:title,onclick:fn});
      b.innerHTML=CM.icons.svg(ic,{size:20}); b.appendChild(U.el('span',{class:'mm-tool-lbl',text:short})); if(id) b.id=id; return b; };
    tools.appendChild(U.el('div',{class:'mm-tools-title',text:I.t('cm.toolsTitle','NARZĘDZIA')}));
    const undoBtn=toolBtn('rotateL',I.t('cm.toolUndo','Cofnij'),I.t('cm.toolUndoTitle','Cofnij (Ctrl+Z)'),()=>mmUndo(),'mm-disabled'); undoBtn.id='mm-undo'; tools.appendChild(undoBtn);
    const redoBtn=toolBtn('rotateR',I.t('cm.toolRedo','Ponów'),I.t('cm.toolRedoTitle','Ponów (Ctrl+Y)'),()=>mmRedo(),'mm-disabled'); redoBtn.id='mm-redo'; tools.appendChild(redoBtn);
    tools.appendChild(U.el('div',{class:'mm-tools-sep'}));
    tools.appendChild(toolBtn('flow',I.t('cm.toolConnect','Połącz'),I.t('cm.toolConnectTitle','Tryb łączenia (kliknij dwa węzły)'),()=>toggleConnect(),'mm-connect-btn'));
    tools.appendChild(toolBtn('grid',I.t('cm.toolArrange','Ułóż'),I.t('cm.toolArrangeTitle','Auto-układ węzłów (radialnie)'),()=>autoArrange(),null,'mm-arrange'));
    tools.appendChild(toolBtn('layers',I.t('cm.toolLayout','Układ'),I.t('cm.toolLayoutTitle','Schemat układu, styl linii, szablony'),()=>showLayoutDialog(),null,'mm-layout'));
    tools.appendChild(toolBtn('fit',I.t('cm.toolFit','Dopasuj'),I.t('cm.toolFitTitle','Dopasuj widok do zawartości'),()=>fitView(),null,'mm-fit'));
    tools.appendChild(U.el('div',{class:'mm-tools-sep'}));
    tools.appendChild(toolBtn('save',I.t('cm.toolSave','Zapisz'),I.t('cm.toolSaveTitle','Zapisz w pamięci urządzenia'),()=>saveLocal(),null,'mm-save'));
    tools.appendChild(toolBtn('open',I.t('cm.toolLoad','Wczytaj'),I.t('cm.toolLoadTitle','Wczytaj z pamięci urządzenia'),()=>openLocalPicker()));
    tools.appendChild(toolBtn('download',I.t('cm.toolExport','Eksport'),I.t('cm.toolExportTitle','Eksport do pliku (.mindmap.json)'),()=>exportFile()));
    tools.appendChild(toolBtn('image',I.t('cm.toolImage','Obraz'),I.t('cm.toolImageTitle','Eksport mapy do PNG / SVG'),()=>exportImage()));
    tools.appendChild(toolBtn('upload',I.t('cm.toolImport','Import'),I.t('cm.toolImportTitle','Import z pliku'),()=>importFilePicker()));
    tools.appendChild(toolBtn('file',I.t('cm.toolMarkdown','Markdown'),I.t('cm.toolMarkdownTitle','Import / eksport konspektu Markdown'),()=>markdownMenu(),null,'mm-markdown'));
    tools.appendChild(U.el('div',{class:'mm-tools-sep'}));
    tools.appendChild(toolBtn('pencil',I.t('cm.toolDraw','Rysuj'),I.t('cm.toolDrawTitle','Rysowanie odręczne na mapie (pióro, kształty, strzałki, tekst)'),()=>{ if(CM.Draw) CM.Draw.toggle(); },null,'mm-draw-btn'));
    tools.appendChild(toolBtn('trash',I.t('cm.toolClear','Wyczyść'),I.t('cm.toolClearTitle','Wyczyść całą mapę'),()=>{ if(confirm(I.t('cm.confirmClear','Wyczyścić mapę myśli?'))){ state.nodes=[];state.edges=[];selected=null;render();renderInspector();} }));
    refreshUndoBtns();
  }

  function ensureDom(){
    if(built) return;
    built=true;
    root=U.el('div',{id:'mindmap-root',class:'hidden'});
    // ---- left tool rail (labelled, professional) ----
    const tools=U.el('div',{id:'mm-tools'});
    fillTools(tools);
    // ---- canvas + top bar ----
    canvas=U.el('div',{id:'mm-canvas'});
    const topbar=U.el('div',{id:'mm-topbar'});
    const titleIn=U.el('input',{id:'mm-title',value:state.name,title:I.t('cm.titleInput','Nazwa mapy myśli')});
    titleIn.oninput=()=>{ state.name=titleIn.value; };
    topbar.appendChild(U.el('span',{class:'mm-topbar-ic',html:CM.icons.svg('layers',{size:16})}));
    topbar.appendChild(titleIn);
    const zwrap=U.el('div',{class:'mm-zoom'});
    zwrap.appendChild(U.el('button',{class:'mm-zbtn',title:I.t('cm.zoomOut','Oddal'),html:CM.icons.svg('minus',{size:15}),onclick:()=>zoomBy(1/1.2)}));
    const zlbl=U.el('span',{id:'mm-zoom-lbl',class:'mm-zlbl',text:'100%'});
    zwrap.appendChild(zlbl);
    zwrap.appendChild(U.el('button',{class:'mm-zbtn',title:I.t('cm.zoomIn','Przybliż'),html:CM.icons.svg('plus',{size:15}),onclick:()=>zoomBy(1.2)}));
    topbar.appendChild(zwrap);
    canvas.appendChild(topbar);
    svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.id='mm-svg';
    world=U.el('div',{id:'mm-world'});
    canvas.appendChild(svg); canvas.appendChild(world);
    // drawing layer (CM.Draw): render svg lives INSIDE world (sketches pan/zoom with the map), but a
    // dedicated screen-space surface handles pointer input so it never fights the map's pan handlers.
    if(CM.Draw&&CM.Draw.attach) CM.Draw.attach({ world, canvas, screenToWorld, getZoom:()=>cam.zoom, onDirty:()=>autoSnap('draw'),
      panBy:(dx,dy)=>{ cam.x+=dx; cam.y+=dy; applyCam(); drawEdges(); positionSurround&&positionSurround(); },
      zoomAt:(cx,cy,dy)=>{ const r=canvas.getBoundingClientRect(); const before=screenToWorld(cx,cy);
        cam.zoom=U.clamp(cam.zoom*Math.exp(-dy*0.0015),0.2,3); cam.x=(cx-r.left)-before.x*cam.zoom; cam.y=(cy-r.top)-before.y*cam.zoom; applyCam(); drawEdges(); } });
    // ---- right inspector ----
    inspector=U.el('aside',{id:'mm-inspector'});
    // collapse/expand rail for the right inspector panel
    const inspRail=U.el('button',{id:'mm-insp-rail',title:I.t('cm.inspRailTitle','Zwiń / rozwiń panel właściwości')});
    inspRail.innerHTML=CM.icons.svg('expand',{size:16});
    inspRail.onclick=()=>{ const col=root.classList.toggle('mm-insp-collapsed'); inspRail.innerHTML=CM.icons.svg(col?'collapse':'expand',{size:16}); setTimeout(()=>{ drawEdges(); positionSurround(); },260); };
    root.appendChild(tools); root.appendChild(canvas); root.appendChild(inspector); root.appendChild(inspRail);
    buildSurround(); buildLayoutDialog();
    buildTimeline(); loadSnaps(); buildSlModal();
    document.querySelector('#main').appendChild(root);
    bindCanvas();
    renderInspector();
    // undo / redo shortcuts (only while MindMap is active and not editing text)
    window.addEventListener('keydown',(e)=>{
      if(!active) return; const t=e.target;
      if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
      if((e.ctrlKey||e.metaKey) && (e.key==='z'||e.key==='Z') && !e.shiftKey){ e.preventDefault(); mmUndo(); }
      else if((e.ctrlKey||e.metaKey) && ((e.key==='y'||e.key==='Y') || ((e.key==='z'||e.key==='Z')&&e.shiftKey))){ e.preventDefault(); mmRedo(); }
      else if((e.key==='Delete'||e.key==='Backspace') && multi.size){ e.preventDefault(); pushUndo();
        const ids=new Set(multi); state.nodes=state.nodes.filter(x=>!ids.has(x.id)); state.edges=state.edges.filter(ed=>!ids.has(ed.from)&&!ids.has(ed.to));
        multi.clear(); selected=null; render(); renderInspector(); hideSurround(); }
      else if((e.key==='Delete'||e.key==='Backspace') && selected){ e.preventDefault(); delNode(selected); multi.clear(); renderInspector(); hideSurround(); }
      else if(e.key==='Escape' && (multi.size||selected)){ multi.clear(); selected=null; render(); renderInspector(); hideSurround(); }
      // rapid keyboard mind-mapping (single selection only; Tab without a selection still does normal focus navigation)
      else if(e.key==='Tab' && selected && !multi.size){ e.preventDefault(); spawnAndEdit(addChild(selected)); }
      else if(e.key==='Enter' && selected && !multi.size){ e.preventDefault(); spawnAndEdit(addSibling(selected)); }
      else if(e.key==='F2' && selected && !multi.size){ e.preventDefault(); ensureVisible(selected); editText(selected,true); }
      else if((e.key==='ArrowUp'||e.key==='ArrowDown'||e.key==='ArrowLeft'||e.key==='ArrowRight') && selected && !multi.size){ e.preventDefault(); navigateSelection(e.key); }
    });
  }


  // ---------- coordinate helpers ----------
  function applyCam(){ world.style.transform=`translate(${cam.x}px,${cam.y}px) scale(${cam.zoom})`; const zl=document.querySelector('#mm-zoom-lbl'); if(zl) zl.textContent=Math.round(cam.zoom*100)+'%'; }
  function zoomBy(f){ const r=canvas.getBoundingClientRect(); const mx=r.width/2, my=r.height/2; const before=screenToWorld(r.left+mx,r.top+my);
    cam.zoom=U.clamp(cam.zoom*f,0.2,3); cam.x=mx-before.x*cam.zoom; cam.y=my-before.y*cam.zoom; applyCam(); drawEdges(); }
  function autoArrange(){
    if(state.nodes.length<2){ fitView(); return; }
    pushUndo();
    // node with most connections becomes the centre; the rest fan out radially
    const deg=new Map(); state.nodes.forEach(n=>deg.set(n.id,0));
    state.edges.forEach(e=>{ deg.set(e.from,(deg.get(e.from)||0)+1); deg.set(e.to,(deg.get(e.to)||0)+1); });
    const center=state.nodes.slice().sort((a,b)=>(deg.get(b.id)||0)-(deg.get(a.id)||0))[0];
    center.x=-center.w/2; center.y=-30;
    const rest=state.nodes.filter(n=>n!==center);
    const R=Math.max(300, rest.length*36);
    rest.forEach((n,i)=>{ const a=(i/rest.length)*Math.PI*2 - Math.PI/2; n.x=Math.cos(a)*R-n.w/2; n.y=Math.sin(a)*R-30; });
    render(); setTimeout(fitView,20);
  }
  function worldToScreen(wx,wy){ const r=canvas.getBoundingClientRect(); return {x:wx*cam.zoom+cam.x, y:wy*cam.zoom+cam.y}; }
  function screenToWorld(sx,sy){ const r=canvas.getBoundingClientRect(); return {x:(sx-r.left-cam.x)/cam.zoom, y:(sy-r.top-cam.y)/cam.zoom}; }

  // ---------- model ----------
  function addNode(wx,wy,opts){
    pushUndo();
    const n=Object.assign({ id:'n'+(state.seq++), x:wx, y:wy, w:170, text:I.t('cm.newTopic','Nowy temat'), template:'card', color:'#22d3ee', font:14 }, opts||{});
    if(n.template==='code' && !(opts&&opts.text)){ n.text=''; if(!(opts&&opts.w)) n.w=280; }   // empty code → placeholder, wider frame
    state.nodes.push(n); render(); selectNode(n); return n;
  }
  function addNodeCentered(opts){ const r=canvas.getBoundingClientRect(); const w=screenToWorld(r.left+r.width/2, r.top+r.height/2); return addNode(w.x-85, w.y-30, opts); }
  function nodeById(id){ return state.nodes.find(n=>n.id===id); }
  function delNode(n){ pushUndo(); state.nodes=state.nodes.filter(x=>x!==n); state.edges=state.edges.filter(e=>e.from!==n.id&&e.to!==n.id); if(selected===n)selected=null; render(); }

  function selectNode(n){ multi.clear(); selected=n; render(); renderInspector(); showSurround(n); }
  function toggleConnect(){
    connectMode=!connectMode; connectFrom=null;
    document.querySelector('.mm-connect-btn').classList.toggle('on', connectMode);
    document.querySelectorAll('.mm-connect-src').forEach(c=>c.classList.remove('mm-connect-src'));
    canvas.style.cursor=connectMode?'crosshair':'';
  }

  // ---------- render ----------
  function render(){
    if(!world) return;
    world.innerHTML='';
    // group boundary boxes (behind nodes)
    for(const n of state.nodes){ if(!n.grouped||hiddenByCollapse(n)) continue;
      const ids=[n.id,...descendants(n)]; let mnX=1e9,mnY=1e9,mxX=-1e9,mxY=-1e9, any=false;
      for(const id of ids){ const m=nodeById(id); if(!m||hiddenByCollapse(m))continue; any=true; mnX=Math.min(mnX,m.x);mnY=Math.min(mnY,m.y);mxX=Math.max(mxX,m.x+m.w);mxY=Math.max(mxY,m.y+62); }
      if(!any)continue; const pad=18; const gb=U.el('div',{class:'mm-group-box'});
      gb.style.left=(mnX-pad)+'px'; gb.style.top=(mnY-pad)+'px'; gb.style.width=(mxX-mnX+pad*2)+'px'; gb.style.height=(mxY-mnY+pad*2)+'px'; gb.style.setProperty('--mm-col',n.color);
      world.appendChild(gb);
    }
    for(const n of state.nodes){
      if(hiddenByCollapse(n)) continue;
      const isCode = n.template==='code';
      const card=U.el('div',{class:'mm-node mm-tpl-'+n.template+(selected===n?' sel':'')+(multi.has(n.id)?' multi':'')+(n.locked?' locked':''),'data-id':n.id});
      card.style.left=n.x+'px'; card.style.top=n.y+'px'; card.style.width=n.w+'px';
      card.style.setProperty('--mm-col', n.color); card.style.fontSize=n.font+'px';
      let body;
      if(isCode){
        if(n.h) card.style.height=n.h+'px';
        body=buildCodeView(card, n);
      } else {
        const row=U.el('div',{class:'mm-node-row'});
        if(n.image){ const imgWrap=U.el('span',{class:'mm-node-img'});
          if(/^https?:\/\//i.test(n.image)){ const im=U.el('img',{alt:''}); im.src=n.image; imgWrap.appendChild(im); }   // src via DOM property — no HTML injection
          else imgWrap.textContent=n.image;                                                                             // emoji / plain text
          row.appendChild(imgWrap); }
        body=U.el('div',{class:'mm-node-body',contenteditable:'false'}); body.textContent=n.text;
        row.appendChild(body); card.appendChild(row);
      }
      if(n.note){ const nb=U.el('span',{class:'mm-node-note',title:n.note,html:CM.icons.svg('note',{size:11})}); card.appendChild(nb); }
      if(n.locked){ card.appendChild(U.el('span',{class:'mm-node-lock',html:CM.icons.svg('lock',{size:10})})); }
      const cc=childCount(n);
      if(n.collapsed && cc){ const cb=U.el('span',{class:'mm-node-collapse',title:I.t('cm.expand','Rozwiń'),text:'+'+cc}); cb.onmousedown=(e)=>e.stopPropagation(); cb.onclick=(e)=>{ e.stopPropagation(); n.collapsed=false; render(); selectNode(n); }; card.appendChild(cb); }
      if(selected===n && !n.locked){
        const h=U.el('div',{class:'mm-rsz',title:I.t('cm.resizeWidthTitle','Przeciągnij, aby zmienić szerokość')});
        h.addEventListener('mousedown',(e)=>{ e.stopPropagation(); e.preventDefault(); const sx=e.clientX, ow=n.w;
          const mv=(ev)=>{ n.w=U.clamp(ow+(ev.clientX-sx)/cam.zoom, 90, 900); card.style.width=n.w+'px'; drawEdges(); positionSurround(); };
          const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
          window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up); });
        card.appendChild(h);
        if(isCode){   // code frames resize freely in BOTH dimensions via a bottom-right corner grip
          const ch=U.el('div',{class:'mm-rsz-corner',title:I.t('cm.resizeBoth','Przeciągnij, aby zmienić rozmiar ramki')});
          ch.addEventListener('mousedown',(e)=>{ e.stopPropagation(); e.preventDefault();
            const sx=e.clientX, sy=e.clientY, ow=n.w, oh=n.h||card.offsetHeight;
            const mv=(ev)=>{ n.w=U.clamp(ow+(ev.clientX-sx)/cam.zoom, 120, 900); n.h=U.clamp(oh+(ev.clientY-sy)/cam.zoom, 60, 900);
              card.style.width=n.w+'px'; card.style.height=n.h+'px'; drawEdges(); positionSurround(); };
            const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
            window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up); });
          card.appendChild(ch);
        }
      }
      world.appendChild(card);
      bindCard(card, n, body, isCode?(()=>editCode(n)):null);
    }
    applyCam();
    drawEdges();
    positionSurround();
  }

  // ---------- code template: auto-detected, syntax-highlighted, line-numbered, copyable code block ----------
  function escCode(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  // lightweight language guess from the code itself (only structure-based heuristics)
  function detectCodeLang(code){
    const c=code||''; if(!c.trim()) return '';
    if(/^\s*<\?php/.test(c)) return 'php';
    if(/<\/[a-z]+>|<(div|span|html|head|body|p|a|ul|li|h[1-6]|img|script)\b/i.test(c)) return 'html';
    if(/#include|std::|int\s+main\s*\(|printf\s*\(/.test(c)) return 'cpp';
    if(/\bpublic\s+(class|static)|System\.out|void\s+main/.test(c)) return 'java';
    if(/\bfunc\b|package\s+\w+|fmt\.[A-Z]/.test(c)) return 'go';
    if(/\bfn\s+\w+|let\s+mut|println!|::<|->\s*\w+\s*\{/.test(c)) return 'rust';
    if(/\bdef\s+\w+|elif\b|^\s*from\s+\w+\s+import|print\(/m.test(c)) return 'py';
    if(/\b(def|end)\b|\bputs\b|require\s+['"]|do\s*\|/.test(c)) return 'rb';
    if(/\bSELECT\b[\s\S]{0,300}\bFROM\b|\b(INSERT\s+INTO|UPDATE\s+[\w."`]+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|DATABASE|VIEW|INDEX))\b/i.test(c)) return 'sql';
    if(/^\s*\{[\s\S]*\}\s*$/.test(c.trim()) && /"[\w-]+"\s*:/.test(c)) return 'json';
    if(/[.#]?[\w-]+\s*\{[^{}]*(color|margin|padding|background|font|display|border)\s*:/.test(c)) return 'css';
    if(/\b(function|const|let|var|=>)\b|console\.|document\.|export\s|import\s.*from/.test(c)) return 'js';
    if(/^\s*#!.*\b(sh|bash)\b|^\s*(echo|grep|cd|ls|export|sudo|apt)\b/m.test(c)) return 'sh';
    return 'text';
  }
  function buildCodeView(card, n){
    const codeText=n.text||'', has=!!codeText.trim(), lang=detectCodeLang(codeText);
    const view=U.el('div',{class:'mm-code'});
    const gut=U.el('div',{class:'mm-code-gut'});
    const pre=U.el('pre',{class:'mm-code-pre hl'});
    if(has){
      const lines=codeText.split('\n');
      gut.textContent=lines.map((_,i)=>String(i+1)).join('\n');
      try{ pre.innerHTML=(CM.UI&&CM.UI.highlight)?CM.UI.highlight(codeText, lang):escCode(codeText); }
      catch(e){ pre.textContent=codeText; }
    } else {
      gut.textContent='1';
      pre.innerHTML='<span class="mm-code-ph">'+escCode(I.t('cm.codePlaceholder','// dwuklik, aby wpisać kod'))+'</span>';
    }
    view.appendChild(gut); view.appendChild(pre); card.appendChild(view);
    card.appendChild(U.el('span',{class:'mm-code-lang',text: has?lang:''}));
    if(has){
      const cp=U.el('button',{class:'mm-code-copy',title:I.t('cm.copyCodeTitle','Kopiuj kod')});
      cp.innerHTML=CM.icons.svg('copy',{size:11})+'<span>copy</span>';
      const stop=(e)=>e.stopPropagation(); cp.addEventListener('pointerdown',stop); cp.addEventListener('mousedown',stop); cp.addEventListener('dblclick',stop);
      cp.onclick=(e)=>{ e.stopPropagation();
        if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(codeText).then(()=>{ cp.classList.add('done'); setTimeout(()=>cp.classList.remove('done'),1300); U.toast&&U.toast(I.t('cm.codeCopied','📋 Skopiowano kod.'),'success',1400); },()=>{}); } };
      card.appendChild(cp);
    }
    return view;
  }
  function editCode(n){
    mmInput(I.t('cm.editCodeTitle','Kod (język i numeracja linii wykrywane automatycznie):'), n.text||'', {multiline:true, mono:true}).then(v=>{
      if(v===null) return; pushUndo(); n.text=v; render(); selected=n; renderInspector();
    });
  }

  // anchor point on a card's edge facing the connected node (for tidy connectors)
  function edgePt(a, dir){ // dir: 'r','l','t','b','c'
    const cx=a.x+a.w/2, cy=a.y+30, h=60;
    if(dir==='r') return {x:a.x+a.w, y:cy}; if(dir==='l') return {x:a.x, y:cy};
    if(dir==='t') return {x:cx, y:a.y}; if(dir==='b') return {x:cx, y:a.y+h};
    return {x:cx, y:cy};
  }
  function drawEdges(){
    const r=canvas.getBoundingClientRect();
    svg.setAttribute('width', r.width); svg.setAttribute('height', r.height);
    const curved=state.line==='curved';
    let s='';
    const link=(a,b,col,wide,from,to)=>{
      const pa=worldToScreen(from.x,from.y), pb=worldToScreen(to.x,to.y);
      let d;
      if(curved){ const dx=Math.abs(pb.x-pa.x)*0.5; const horiz=Math.abs(pb.x-pa.x)>Math.abs(pb.y-pa.y);
        d = horiz ? `M${pa.x} ${pa.y} C ${pa.x+dx} ${pa.y}, ${pb.x-dx} ${pb.y}, ${pb.x} ${pb.y}`
                  : `M${pa.x} ${pa.y} C ${pa.x} ${(pa.y+pb.y)/2}, ${pb.x} ${(pa.y+pb.y)/2}, ${pb.x} ${pb.y}`; }
      else { const mx=(pa.x+pb.x)/2; d=`M${pa.x} ${pa.y} H ${mx} V ${pb.y} H ${pb.x}`; }
      s+=`<path d="${d}" stroke="${col}" stroke-width="${wide?2.6:2}" fill="none" opacity="0.8" stroke-linejoin="round" stroke-linecap="round"/>`;
    };
    // parent -> child (tree) connectors, anchored by layout direction
    for(const n of state.nodes){ if(n.parent==null) continue; const p=nodeById(n.parent); if(!p) continue;
      if(hiddenByCollapse(n)||hiddenByCollapse(p)) continue;
      const dir=state.layout; let pd='r', cd='l';
      if(dir==='radial'){ pd='c'; cd='c'; }
      else if(dir==='left'){ pd='l'; cd='r'; } else if(dir==='down'){ pd='b'; cd='t'; } else if(dir==='up'){ pd='t'; cd='b'; }
      else if(dir==='leftright'){ const left=(n.x+n.w/2)<(p.x+p.w/2); pd=left?'l':'r'; cd=left?'r':'l'; }
      else if(dir==='free'){ const horiz=Math.abs((n.x+n.w/2)-(p.x+p.w/2))>=Math.abs(n.y-p.y); pd=horiz?((n.x>p.x)?'r':'l'):((n.y>p.y)?'b':'t'); cd=horiz?((n.x>p.x)?'l':'r'):((n.y>p.y)?'t':'b'); }
      link(p,n, n.color||p.color, true, edgePt(p,pd), edgePt(n,cd));
    }
    // free cross-connections
    for(const e of state.edges){ const a=nodeById(e.from), b=nodeById(e.to); if(!a||!b) continue;
      if(hiddenByCollapse(a)||hiddenByCollapse(b)) continue;
      link(a,b, '#94a3b8', false, edgePt(a,'c'), edgePt(b,'c')); }
    svg.innerHTML=s;
  }

  // ---------- card interactions ----------
  function bindCard(card, n, body, onDblClick){
    let down=false, moved=false, sx=0, sy=0, ox=0, oy=0;
    card.addEventListener('pointerdown',(e)=>{
      if(body.getAttribute && body.getAttribute('contenteditable')==='true') return;  // editing -> let text select
      // reattach mode: clicking a node makes it the new parent of the selected node
      if(reattachMode && selected && selected!==n && !isDescendant(n, selected)){
        pushUndo(); selected.parent=n.id; reattachMode=false; canvas.style.cursor=''; relayoutIfTree(); render(); U.toast&&U.toast(I.t('cm.toastReattached','Przepięto węzeł.'),'success',1500); e.stopPropagation(); return;
      }
      // connect mode (free cross-link)
      if(connectMode){
        if(!connectFrom){ connectFrom=n; card.classList.add('mm-connect-src'); }
        else if(connectFrom!==n){ addEdge(connectFrom, n); document.querySelectorAll('.mm-connect-src').forEach(c=>c.classList.remove('mm-connect-src')); connectFrom=null; }
        e.stopPropagation(); return;
      }
      // Shift-click toggles multi-selection membership
      if(e.shiftKey){ if(multi.has(n.id)) multi.delete(n.id); else multi.add(n.id);
        selected = multi.size ? n : null; render(); renderInspector();
        if(multi.size>1) hideSurround(); else if(selected) showSurround(selected); else hideSurround();
        e.stopPropagation(); e.preventDefault(); return; }
      const groupDrag = multi.has(n.id) && multi.size>1;
      if(!groupDrag) selectNode(n);   // plain click clears multi -> single select
      e.stopPropagation(); e.preventDefault();
      if(n.locked && !groupDrag) return;   // locked figure: selectable but not draggable
      down=true; moved=false; sx=e.clientX; sy=e.clientY; const preDrag=mmSnap();
      const orig = (groupDrag ? [...multi].map(id=>nodeById(id)) : [n]).filter(m=>m&&!m.locked).map(m=>({m, x:m.x, y:m.y}));
      const mv=(ev)=>{ if(!down)return; const dx=(ev.clientX-sx)/cam.zoom, dy=(ev.clientY-sy)/cam.zoom;
        if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>3) moved=true;
        for(const o of orig){ o.m.x=o.x+dx; o.m.y=o.y+dy; const c=world.querySelector(`[data-id="${o.m.id}"]`); if(c){ c.style.left=o.m.x+'px'; c.style.top=o.m.y+'px'; } }
        drawEdges(); positionSurround(); };
      const up=()=>{ down=false; if(moved) pushUndoSnap(preDrag); else if(groupDrag) selectNode(n); window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); };
      window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
    });
    card.addEventListener('dblclick',(e)=>{
      e.stopPropagation();
      if(onDblClick){ onDblClick(); return; }   // code node → open the dedicated code editor
      body._preEdit=mmSnap(); body._origText=n.text;
      body.setAttribute('contenteditable','true'); body.focus();
      const range=document.createRange(); range.selectNodeContents(body); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });
    if(!onDblClick){
      body.addEventListener('blur',()=>{ body.setAttribute('contenteditable','false');
        if(body._preEdit!=null && body.textContent!==body._origText){ pushUndoSnap(body._preEdit); }
        body._preEdit=null; n.text=body.textContent; drawEdges(); });
      body.addEventListener('keydown',(e)=>{
        if(e.isComposing){ e.stopPropagation(); return; }                 // don't hijack keys mid IME composition
        if(e.key==='Escape'){ e.stopPropagation(); body.blur(); return; }
        // commit on Enter and continue the rapid-entry flow; Shift+Enter still inserts a line break
        if(e.key==='Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey){ e.preventDefault(); e.stopPropagation(); body.blur(); spawnAndEdit(addSibling(n)); return; }
        if(e.key==='Tab'){ e.preventDefault(); e.stopPropagation(); body.blur(); spawnAndEdit(addChild(n)); return; }
        e.stopPropagation();
      });
    }
    // right-click → OS-style tools window for this node
    card.addEventListener('contextmenu',(e)=>{ e.preventDefault(); e.stopPropagation(); selectNode(n); mmContextMenu(e.clientX, e.clientY, nodeMenuItems(n)); });
  }
  // connect mode is a TOGGLE: linking two already-linked nodes REMOVES the link (edge deletion)
  function addEdge(a,b){
    const i=state.edges.findIndex(e=>(e.from===a.id&&e.to===b.id)||(e.from===b.id&&e.to===a.id));
    pushUndo();
    if(i>=0){ state.edges.splice(i,1); U.toast&&U.toast(I.t('cm.edgeRemoved','Usunięto połączenie.'),'',1600); }
    else state.edges.push({from:a.id,to:b.id});
    render();
  }

  // box (marquee) multi-selection — Shift-drag on empty canvas
  function startMarquee(e){
    const r=canvas.getBoundingClientRect(); const x0=e.clientX, y0=e.clientY;
    marqueeEl=U.el('div',{class:'mm-marquee'}); canvas.appendChild(marqueeEl);
    const upd=(ev)=>{ const x=Math.min(x0,ev.clientX), y=Math.min(y0,ev.clientY);
      marqueeEl.style.left=(x-r.left)+'px'; marqueeEl.style.top=(y-r.top)+'px';
      marqueeEl.style.width=Math.abs(ev.clientX-x0)+'px'; marqueeEl.style.height=Math.abs(ev.clientY-y0)+'px'; };
    const up=(ev)=>{ window.removeEventListener('pointermove',upd); window.removeEventListener('pointerup',up);
      const wa=screenToWorld(Math.min(x0,ev.clientX),Math.min(y0,ev.clientY)), wb=screenToWorld(Math.max(x0,ev.clientX),Math.max(y0,ev.clientY));
      multi.clear();
      for(const n of state.nodes){ if(hiddenByCollapse(n))continue; const c=world.querySelector(`[data-id="${n.id}"]`); const h=c?c.offsetHeight:60;
        if(n.x<wb.x && n.x+n.w>wa.x && n.y<wb.y && n.y+h>wa.y) multi.add(n.id); }
      if(marqueeEl){ marqueeEl.remove(); marqueeEl=null; }
      selected = multi.size ? nodeById([...multi][0]) : null;
      render(); renderInspector(); if(multi.size>1) hideSurround(); else if(selected) showSurround(selected);
      if(multi.size) U.toast&&U.toast(I.t('cm.toastSelectedPre','Zaznaczono ')+multi.size+I.t('cm.toastSelectedPost',' węzłów — przeciągnij, aby przesunąć; Delete usuwa.'),'',2400);
    };
    window.addEventListener('pointermove',upd); window.addEventListener('pointerup',up);
  }

  // ---------- canvas pan / zoom / add ----------
  function bindCanvas(){
    let ptrs=new Map(), panning=false, panSX=0,panSY=0,panCX=0,panCY=0, lastPinchD=0;
    function pinchDist(){ const v=[...ptrs.values()]; if(v.length<2)return 0; const dx=v[0].x-v[1].x,dy=v[0].y-v[1].y; return Math.sqrt(dx*dx+dy*dy); }
    function pinchMid(){ const v=[...ptrs.values()]; return {x:(v[0].x+v[1].x)/2,y:(v[0].y+v[1].y)/2}; }
    canvas.addEventListener('pointerdown',(e)=>{
      ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
      canvas.setPointerCapture(e.pointerId);
      if(ptrs.size===2){ lastPinchD=pinchDist(); panning=false; return; }
      if(ptrs.size>1) return;
      if(e.target!==canvas&&e.target!==svg&&e.target!==world){ return; }
      if(connectFrom){ document.querySelectorAll('.mm-connect-src').forEach(c=>c.classList.remove('mm-connect-src')); connectFrom=null; }
      if(e.shiftKey&&!e.pointerType.startsWith('touch')){ startMarquee(e); return; }
      selected=null; multi.clear(); renderInspector(); render(); hideSurround();
      panning=true; panSX=e.clientX; panSY=e.clientY; panCX=cam.x; panCY=cam.y; canvas.classList.add('panning');
    },{passive:false});
    canvas.addEventListener('pointermove',(e)=>{
      if(!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(ptrs.size===2){
        const d=pinchDist(); if(lastPinchD>0&&d>0){
          const mid=pinchMid(); const before=screenToWorld(mid.x,mid.y);
          cam.zoom=U.clamp(cam.zoom*(d/lastPinchD),0.2,3);
          const r=canvas.getBoundingClientRect(); cam.x=(mid.x-r.left)-before.x*cam.zoom; cam.y=(mid.y-r.top)-before.y*cam.zoom;
          applyCam(); drawEdges(); }
        lastPinchD=d; return;
      }
      if(!panning)return; cam.x=panCX+(e.clientX-panSX); cam.y=panCY+(e.clientY-panSY); applyCam(); drawEdges(); positionSurround();
    },{passive:false});
    const endPtr=(e)=>{ ptrs.delete(e.pointerId);
      if(ptrs.size===1){ // lifted one finger after a pinch → resume single-finger pan from the survivor (no jump)
        const p=[...ptrs.values()][0]; panSX=p.x; panSY=p.y; panCX=cam.x; panCY=cam.y; panning=true; lastPinchD=0; }
      else if(ptrs.size===0){ panning=false; lastPinchD=0; canvas.classList.remove('panning'); } };
    canvas.addEventListener('pointerup',endPtr);
    canvas.addEventListener('pointercancel',endPtr);
    let lastTap=0;
    canvas.addEventListener('pointerdown',(e)=>{
      if(e.pointerType!=='touch') return;
      const now=Date.now(); if(now-lastTap<340){ const w=screenToWorld(e.clientX,e.clientY); addNode(w.x-85,w.y-30); } lastTap=now;
    });
    canvas.addEventListener('dblclick',(e)=>{ if(e.target===canvas||e.target===svg||e.target===world){ const w=screenToWorld(e.clientX,e.clientY); addNode(w.x-85,w.y-30); } });
    canvas.addEventListener('contextmenu',(e)=>{ if(e.target===canvas||e.target===svg||e.target===world){ e.preventDefault(); selected=null; renderInspector(); render(); hideSurround(); mmContextMenu(e.clientX, e.clientY, canvasMenuItems(e.clientX, e.clientY)); } });
    canvas.addEventListener('wheel',(e)=>{ e.preventDefault();
      const r=canvas.getBoundingClientRect(); const before=screenToWorld(e.clientX,e.clientY);
      cam.zoom=U.clamp(cam.zoom*Math.exp(-e.deltaY*0.0015),0.2,3);
      cam.x=(e.clientX-r.left)-before.x*cam.zoom; cam.y=(e.clientY-r.top)-before.y*cam.zoom; applyCam(); drawEdges();
    },{passive:false});
  }
  function fitView(){
    if(!state.nodes.length){ cam={x:canvas.clientWidth/2,y:canvas.clientHeight/2,zoom:1}; applyCam(); drawEdges(); return; }
    let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
    for(const n of state.nodes){ minX=Math.min(minX,n.x); minY=Math.min(minY,n.y); maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+70); }
    const r=canvas.getBoundingClientRect(); const pad=80;
    const z=U.clamp(Math.min((r.width-pad*2)/(maxX-minX||1),(r.height-pad*2)/(maxY-minY||1)),0.2,1.6);
    cam.zoom=z; cam.x=r.width/2-((minX+maxX)/2)*z; cam.y=r.height/2-((minY+maxY)/2)*z; applyCam(); drawEdges();
  }

  // ---------- node structure helpers ----------
  function isDescendant(node, ancestor){ let c=node; let guard=0; while(c&&guard++<999){ if(c.parent==null) return false; if(c.parent===ancestor.id) return true; c=nodeById(c.parent); } return false; }
  function relayoutIfTree(){ if(state.layout&&state.layout!=='free') applyLayout(state.layout); else { render(); } }

  // ---------- node actions ----------
  function editText(n, capture){ const body=world.querySelector(`[data-id="${n.id}"] .mm-node-body`); if(!body)return;
    if(capture){ body._preEdit=mmSnap(); body._origText=n.text; }   // F2 / menu edit on an existing node → record undo
    body.setAttribute('contenteditable','true'); body.focus(); const range=document.createRange(); range.selectNodeContents(body); const s=getSelection(); s.removeAllRanges(); s.addRange(range); }
  // pan a node into view, but only if it sits near/over a canvas edge — keeps keyboard-created nodes visible without yanking the camera around
  function ensureVisible(n){ if(!n) return; const r=canvas.getBoundingClientRect(); const s=worldToScreen(n.x+n.w/2,n.y+28); const m=90;
    if(s.x<m||s.x>r.width-m||s.y<m||s.y>r.height-m) centerOn(n); }
  // a freshly spawned node is created+selected by addChild/addSibling — bring it into view and drop straight into text editing (placeholder pre-selected)
  function spawnAndEdit(c){ if(!c) return c; ensureVisible(c); editText(c,false); return c; }
  // keyboard selection: jump to the nearest visible node in the arrow direction — geometric, so it works in every layout (free / tree / radial / …)
  function navigateSelection(key){
    if(!selected) return; const cx=selected.x+selected.w/2, cy=selected.y+28;
    const dirs={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]}; const d=dirs[key]; if(!d) return;
    let best=null,bestScore=Infinity;
    for(const n of state.nodes){ if(n===selected||hiddenByCollapse(n)) continue;
      const vx=(n.x+n.w/2)-cx, vy=(n.y+28)-cy; const along=vx*d[0]+vy*d[1]; if(along<=1) continue;   // must lie in the chosen direction
      const perp=Math.abs(vx*d[1]-vy*d[0]); if(perp>along*1.3+44) continue;                            // stay inside a ~50° cone
      const score=along+perp*2; if(score<bestScore){ bestScore=score; best=n; } }                     // prefer aligned & close
    if(best){ selectNode(best); ensureVisible(best); }
  }
  // in-app text prompt (replaces native prompt(); consistent style + works in PWA contexts).
  // resolves with the entered string, or null if cancelled.
  function mmInput(title, value, opts){ opts=opts||{};
    return new Promise(resolve=>{
      let done=false; const finish=(v)=>{ if(done)return; done=true; ov.remove(); document.removeEventListener('keydown',onKey,true); resolve(v); };
      const ov=U.el('div',{id:'mm-input-modal',class:'mm-sl-modal'});   // reuse save/load modal styling
      ov.addEventListener('pointerdown',(e)=>{ if(e.target===ov) finish(null); });
      const box=U.el('div',{class:'mm-sl-box',style:'max-width:'+(opts.mono?'620px':'440px')});
      const head=U.el('div',{class:'mm-sl-head'});
      head.appendChild(U.el('h3',{text:title}));
      head.appendChild(U.el('button',{class:'mm-sl-head-x',html:CM.icons.svg('x',{size:15}),onclick:()=>finish(null)}));
      const body=U.el('div',{class:'mm-sl-body'});
      const field = opts.multiline ? U.el('textarea',{class:'mm-input-field'+(opts.mono?' mm-input-mono':''),rows:opts.mono?'12':'4',spellcheck:'false'}) : U.el('input',{class:'mm-input-field',type:'text'});
      if(opts.placeholder) field.setAttribute('placeholder',opts.placeholder);
      field.value=value||'';
      if(opts.mono){ field.addEventListener('keydown',(e)=>{
        if(e.key==='Tab'){ e.preventDefault(); const s=field.selectionStart, en=field.selectionEnd; field.value=field.value.slice(0,s)+'  '+field.value.slice(en); field.selectionStart=field.selectionEnd=s+2; }
        else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); finish(field.value); }
      }); }
      const foot=U.el('div',{class:'mm-input-foot'});
      foot.appendChild(U.el('button',{class:'mm-ld-btn',text:I.t('cm.btnCancel','Anuluj'),onclick:()=>finish(null)}));
      foot.appendChild(U.el('button',{class:'mm-ld-btn primary',text:I.t('cm.btnOk','OK'),onclick:()=>finish(field.value)}));
      body.appendChild(field); body.appendChild(foot);
      box.appendChild(head); box.appendChild(body); ov.appendChild(box);
      (canvas||document.body).appendChild(ov);
      const onKey=(e)=>{ if(e.key==='Escape'){ e.stopPropagation(); finish(null); } else if(e.key==='Enter'&&!opts.multiline){ e.stopPropagation(); finish(field.value); } };
      document.addEventListener('keydown',onKey,true);
      setTimeout(()=>{ field.focus(); field.select&&field.select(); },50);
    });
  }
  function addNote(n){ mmInput(I.t('cm.promptNote','Notatka do węzła:'), n.note||'', {multiline:true}).then(v=>{ if(v===null)return; pushUndo(); n.note=v.trim()||null; render(); selected=n; renderInspector(); }); }
  function addImage(n){ mmInput(I.t('cm.promptImage','Emoji lub adres URL obrazka (puste = usuń):'), n.image||'', {placeholder:'😀  /  https://…'}).then(v=>{ if(v===null)return; pushUndo(); n.image=v.trim()||null; render(); selected=n; renderInspector(); }); }
  function addChild(n){ const horiz=(state.layout==='right'||state.layout==='left'||state.layout==='leftright'||state.layout==='free');
    const c=addNode(n.x+(horiz?220:0), n.y+(horiz?0:130), {parent:n.id, text:I.t('cm.newTopic','Nowy temat'), color:n.color, template:n.template, font:n.font, w:n.w}); relayoutIfTree(); selectNode(c); return c; }
  function addSibling(n){ const horiz=(state.layout==='right'||state.layout==='left'||state.layout==='leftright'||state.layout==='free');
    const c=addNode(n.x+(horiz?0:160), n.y+(horiz?90:0), {parent:n.parent, text:I.t('cm.newTopic','Nowy temat'), color:n.color, template:n.template, font:n.font, w:n.w}); relayoutIfTree(); selectNode(c); return c; }
  function duplicateNode(n){ const c=addNode(n.x+30, n.y+30, {parent:n.parent, text:n.text, color:n.color, template:n.template, font:n.font, w:n.w, note:n.note, image:n.image}); relayoutIfTree(); selectNode(c); return c; }
  function startReattach(n){ selectNode(n); reattachMode=true; canvas.style.cursor='crosshair'; U.toast&&U.toast(I.t('cm.toastReattachHint','Kliknij węzeł, który ma stać się nowym rodzicem.'),'',2600); }
  function copyNode(n){ clipboard={text:n.text, color:n.color, template:n.template, font:n.font, w:n.w, note:n.note, image:n.image}; U.toast&&U.toast(I.t('cm.toastCopied','Skopiowano węzeł.'),'',1300); }
  function cutNode(n){ copyNode(n); delNode(n); }
  function pasteNode(n){ if(!clipboard){ U.toast&&U.toast(I.t('cm.toastClipboardEmpty','Schowek pusty.'),'error',1300); return; } const c=addNode((n?n.x+40:0),(n?n.y+40:0), Object.assign({parent:n?n.id:null}, clipboard)); relayoutIfTree(); selectNode(c); return c; }
  function quickWidth(n){ pushUndo(); mmPopover(I.t('cm.popWidth','Szerokość węzła'), (box)=>{ const r=U.el('input',{type:'range',min:'110',max:'460',value:n.w,style:'width:200px'}); r.oninput=()=>{ n.w=+r.value; render(); selected=n; }; box.appendChild(r); }); }
  function quickColor(n){ pushUndo(); mmPopover(I.t('cm.popColor','Kolor węzła'), (box)=>{ const row=U.el('div',{class:'mm-color-row'});
      for(const c of COLORS){ row.appendChild(U.el('button',{class:'mm-color'+(n.color===c?' on':''),style:`background:${c}`,onclick:()=>{ n.color=c; render(); selected=n; }})); }
      const cp=U.el('input',{type:'color',class:'mm-color-pick',value:n.color}); cp.oninput=()=>{ n.color=cp.value; render(); selected=n; }; row.appendChild(cp); box.appendChild(row); }); }
  function quickShape(n){ pushUndo(); mmPopover(I.t('cm.popShape','Kształt / rodzaj dymka'), (box)=>{ const grid=U.el('div',{class:'mm-tpl-grid'});
      for(const t of TEMPLATES){ const b=U.el('button',{class:'mm-tpl-chip mm-tpl-'+t.k+(n.template===t.k?' on':''),title:tplName(t),onclick:()=>{ n.template=t.k; render(); selected=n; quickShape(n); }});
        b.appendChild(U.el('span',{class:'mm-tpl-chip-lbl',text:tplName(t)})); grid.appendChild(b); } box.appendChild(grid); }); }

  // ---------- tree layout schemas ----------
  // when nodes are linked only by free edges (e.g. starter diagrams), derive a parent tree
  // so the directional layouts have a hierarchy to arrange; converted edges become parent links.
  function ensureHierarchyFromEdges(){
    if(state.nodes.some(n=>n.parent!=null)) return;
    if(!state.edges.length) return;
    const adj=new Map(); state.nodes.forEach(n=>adj.set(n.id,[]));
    state.edges.forEach(e=>{ if(adj.has(e.from)&&adj.has(e.to)){ adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); } });
    const remaining=new Set(state.nodes.map(n=>n.id));
    while(remaining.size){
      let root=null,best=-1; for(const id of remaining){ const d=adj.get(id).length; if(d>best){best=d;root=id;} }
      const seen=new Set([root]); const q=[root]; remaining.delete(root);
      while(q.length){ const id=q.shift(); for(const nb of adj.get(id)){ if(!seen.has(nb)){ seen.add(nb); nodeById(nb).parent=id; remaining.delete(nb); q.push(nb); } } }
    }
    state.edges=state.edges.filter(e=>{ const a=nodeById(e.from),b=nodeById(e.to); return !(a&&b&&(a.parent===b.id||b.parent===a.id)); });
  }
  // radial tree: root in the centre, descendants fanned out on concentric rings by angular leaf-weight
  function radialLayout(){
    ensureHierarchyFromEdges();
    const children=new Map(); state.nodes.forEach(n=>children.set(n.id,[]));
    const roots=[]; state.nodes.forEach(n=>{ if(n.parent!=null && children.has(n.parent)) children.get(n.parent).push(n.id); else roots.push(n.id); });
    const leaf=new Map();
    const cl=(id)=>{ const k=children.get(id); if(!k.length){leaf.set(id,1);return 1;} let s=0;for(const c of k)s+=cl(c); leaf.set(id,s);return s; };
    roots.forEach(cl);
    const ring=(state.spaceMain||240)*0.8;
    const place=(id,depth,a0,a1)=>{ const n=nodeById(id),k=children.get(id),a=(a0+a1)/2;
      if(depth===0){ n.x=-n.w/2; n.y=-30; } else { const rr=depth*ring; n.x=Math.cos(a)*rr-n.w/2; n.y=Math.sin(a)*rr-30; }
      let cur=a0; const tot=leaf.get(id)||1;
      for(const c of k){ const seg=(a1-a0)*(leaf.get(c)||1)/tot; place(c,depth+1,cur,cur+seg); cur+=seg; } };
    roots.forEach(r=>place(r,0,-Math.PI/2,-Math.PI/2+Math.PI*2));
    let cx=0,cy=0; for(const n of state.nodes){cx+=n.x+n.w/2;cy+=n.y+30;} cx/=state.nodes.length||1; cy/=state.nodes.length||1;
    for(const n of state.nodes){ n.x-=cx; n.y-=cy; }
    render(); positionSurround();
  }
  function applyLayout(mode){
    state.layout=mode;
    if(mode==='free'){ render(); positionSurround(); return; }
    if(mode==='radial'){ radialLayout(); return; }
    ensureHierarchyFromEdges();
    const children=new Map(); state.nodes.forEach(n=>children.set(n.id,[]));
    const roots=[];
    state.nodes.forEach(n=>{ if(n.parent!=null && children.has(n.parent)) children.get(n.parent).push(n.id); else roots.push(n.id); });
    const MAIN=state.spaceMain||240, CROSS=state.spaceCross||70, horiz=(mode==='left'||mode==='right'||mode==='leftright');
    function place(id, depth, dirSign, cur){
      const n=nodeById(id), kids=children.get(id); const main=depth*MAIN*dirSign; let c;
      if(!kids.length){ c=cur.v; cur.v+=CROSS; }
      else { const cs=kids.map(k=>place(k,depth+1,dirSign,cur)); c=(cs[0]+cs[cs.length-1])/2; }
      if(horiz){ n.x = main - (dirSign<0? n.w : 0); n.y=c-30; } else { n.y=main; n.x=c-n.w/2; }
      n._c=c; return c;
    }
    let base={v:0};
    for(const rid of roots){
      if(mode==='leftright'||mode==='updown'){
        const root=nodeById(rid), kids=children.get(rid), half=Math.ceil(kids.length/2);
        const cA={v:0}; kids.slice(0,half).forEach(k=>place(k,1,1,cA));
        const cB={v:0}; kids.slice(half).forEach(k=>place(k,1,-1,cB));
        const cs=kids.map(k=>nodeById(k)._c); const mid=cs.length?(Math.min(...cs)+Math.max(...cs))/2:0;
        if(mode==='updown'){ root.y=-30; root.x=mid-root.w/2; } else { root.x=-root.w/2; root.y=mid-30; } root._c=mid;
      } else { place(rid,0,(mode==='left'||mode==='up')?-1:1, base); base.v+=CROSS*1.6; }
    }
    let cx=0,cy=0; for(const n of state.nodes){ cx+=n.x+n.w/2; cy+=n.y+30; } cx/=state.nodes.length; cy/=state.nodes.length;
    for(const n of state.nodes){ n.x-=cx; n.y-=cy; }
    render(); positionSurround();
  }
  // re-centre the whole map around (0,0) — shared tail of the dedicated layouts
  function recenterNodes(){ if(!state.nodes.length) return; let cx=0,cy=0; for(const n of state.nodes){ cx+=n.x+n.w/2; cy+=n.y+30; } cx/=state.nodes.length; cy/=state.nodes.length; for(const n of state.nodes){ n.x-=cx; n.y-=cy; } }
  // depth-first order of the derived hierarchy (root first), used by the geometric layouts below
  function hierarchyOrder(){
    const children=new Map(); state.nodes.forEach(n=>children.set(n.id,[]));
    const roots=[]; state.nodes.forEach(n=>{ if(n.parent!=null && children.has(n.parent)) children.get(n.parent).push(n.id); else roots.push(n.id); });
    const out=[]; const walk=(id,d)=>{ const n=nodeById(id); if(!n)return; out.push({n,d}); for(const c of children.get(id)) walk(c,d+1); };
    roots.forEach(r=>walk(r,0)); return out;
  }
  // spiral: nodes spread along an Archimedean spiral expanding from the centre
  function spiralLayout(){ ensureHierarchyFromEdges(); const order=hierarchyOrder(); const step=(state.spaceMain||240)*0.34, ang=0.62;
    order.forEach((o,i)=>{ const a=i*ang, rr=step*Math.sqrt(i)*1.6+ (i?40:0); o.n.x=Math.cos(a)*rr-o.n.w/2; o.n.y=Math.sin(a)*rr-30; });
    recenterNodes(); render(); positionSurround(); }
  // grid: even rows/columns following the (derived) reading order
  function gridLayout(){ ensureHierarchyFromEdges(); const order=hierarchyOrder(); const N=order.length||1;
    const cols=Math.max(1,Math.ceil(Math.sqrt(N))); const cw=(state.spaceMain||240)+20, ch=(state.spaceCross||70)+78;
    order.forEach((o,i)=>{ const r=Math.floor(i/cols), c=i%cols; o.n.x=c*cw-o.n.w/2; o.n.y=r*ch; });
    recenterNodes(); render(); positionSurround(); }
  // layers: each hierarchy depth becomes a horizontal band, stepped top→bottom
  function layersLayout(){ ensureHierarchyFromEdges(); const order=hierarchyOrder();
    const byDepth=new Map(); let maxD=0; order.forEach(o=>{ if(!byDepth.has(o.d)) byDepth.set(o.d,[]); byDepth.get(o.d).push(o.n); if(o.d>maxD)maxD=o.d; });
    const bandH=(state.spaceCross||70)+96, gap=(state.spaceMain||240)*0.78;
    for(let d=0;d<=maxD;d++){ const row=byDepth.get(d)||[]; const total=row.reduce((s,n)=>s+n.w,0)+(row.length-1)*40; let x=-total/2 + d*36;
      row.forEach(n=>{ n.x=x; n.y=d*bandH; x+=n.w+40; }); }
    recenterNodes(); render(); positionSurround(); }
  // horizontal-axis timeline: derived order placed left→right on one line, alternating slightly to avoid overlap
  function timeAxisLayout(){ ensureHierarchyFromEdges(); const order=hierarchyOrder(); let x=0;
    order.forEach((o,i)=>{ o.n.x=x; o.n.y=(i%2?1:-1)*((state.spaceCross||70)*0.55); x+=o.n.w+ (state.spaceMain||240)*0.42; });
    recenterNodes(); render(); positionSurround(); }
  // fishbone: head on the right, cause branches alternate above/below a central spine
  function fishboneLayout(){ ensureHierarchyFromEdges();
    const children=new Map(); state.nodes.forEach(n=>children.set(n.id,[]));
    const roots=[]; state.nodes.forEach(n=>{ if(n.parent!=null && children.has(n.parent)) children.get(n.parent).push(n.id); else roots.push(n.id); });
    const rid=roots[0]; if(rid==null){ render(); return; }
    const head=nodeById(rid), bones=children.get(rid); const spacing=(state.spaceMain||240)*0.82, rise=(state.spaceCross||70)+110;
    head.x=bones.length*spacing/2+40; head.y=-30;
    bones.forEach((bid,i)=>{ const side=i%2?1:-1, col=Math.floor(i/2); const bn=nodeById(bid); bn.x=col*spacing-bones.length*spacing/2; bn.y=side*rise;
      const sub=children.get(bid); sub.forEach((sid,j)=>{ const sn=nodeById(sid); sn.x=bn.x+(j+1)*36; sn.y=bn.y+side*(60+j*60); }); });
    recenterNodes(); render(); positionSurround(); }
  function applyColorSchema(name){
    pushUndo();
    state.colorSchema=true;
    const pal=SCHEMA_PALETTES[name]||SCHEMA_PALETTES.ocean;
    const children=new Map(); state.nodes.forEach(n=>children.set(n.id,[]));
    const roots=[];
    state.nodes.forEach(n=>{ if(n.parent!=null&&children.has(n.parent)) children.get(n.parent).push(n.id); else roots.push(n.id); });
    let bi=0;
    const paint=(id,col)=>{ const n=nodeById(id); n.color=col; for(const k of children.get(id)) paint(k,col); };
    for(const rid of roots){ nodeById(rid).color=pal[0]; for(const k of children.get(rid)){ paint(k, pal[1+(bi++%(pal.length-1))]); } }
    render();
  }
  function disableColorSchema(){ pushUndo(); state.colorSchema=false; for(const n of state.nodes) n.color='#3b5bdb'; render(); }

  // ---------- node + screen geometry helpers ----------
  function descendants(n){ const out=[]; for(const k of state.nodes){ if(k.parent===n.id){ out.push(k.id); out.push(...descendants(k)); } } return out; }
  function delBranch(n){ pushUndo(); const ids=new Set([n.id,...descendants(n)]); state.nodes=state.nodes.filter(x=>!ids.has(x.id)); state.edges=state.edges.filter(e=>!ids.has(e.from)&&!ids.has(e.to)); if(selected && ids.has(selected.id)) selected=null; multi.clear(); render(); renderInspector(); hideSurround(); }
  function hiddenByCollapse(n){ let c=n,g=0; while(c.parent!=null&&g++<999){ const p=nodeById(c.parent); if(!p)break; if(p.collapsed) return true; c=p; } return false; }
  function childCount(n){ return state.nodes.filter(x=>x.parent===n.id).length; }
  function centerOn(n){ const r=canvas.getBoundingClientRect(); cam.x=r.width/2-(n.x+n.w/2)*cam.zoom; cam.y=r.height/2-(n.y+28)*cam.zoom; applyCam(); drawEdges(); positionSurround(); }
  function nodeScreenRect(n){
    const rr=root.getBoundingClientRect();
    const card=world&&world.querySelector(`[data-id="${n.id}"]`);
    if(card){ const b=card.getBoundingClientRect();
      return {left:b.left-rr.left, top:b.top-rr.top, w:b.width, h:b.height, cx:b.left-rr.left+b.width/2, cy:b.top-rr.top+b.height/2, rootW:rr.width, rootH:rr.height}; }
    const cr=canvas.getBoundingClientRect(), p=worldToScreen(n.x,n.y);
    const left=cr.left-rr.left+p.x, top=cr.top-rr.top+p.y, w=n.w*cam.zoom, h=60*cam.zoom;
    return {left,top,w,h,cx:left+w/2,cy:top+h/2,rootW:rr.width,rootH:rr.height};
  }

  // ---------- generic popover (color / shape / width / spacing) ----------
  let popEl=null;
  function closePop(){ if(popEl){ popEl.remove(); popEl=null; } }
  function anchorPop(el, above){
    const r=selected?nodeScreenRect(selected):{cx:root.clientWidth/2,top:root.clientHeight/2,h:0,rootW:root.clientWidth,rootH:root.clientHeight};
    let left=U.clamp(r.cx, el.offsetWidth/2+8, r.rootW-el.offsetWidth/2-8);
    let top=above? r.top-el.offsetHeight-58 : (r.top+r.h+58);
    if(top<10) top=r.top+r.h+58; if(top+el.offsetHeight>r.rootH-10) top=Math.max(10,r.top-el.offsetHeight-58);
    el.style.left=left+'px'; el.style.top=top+'px';
  }
  function mmPopover(title, build){
    closePop();
    popEl=U.el('div',{class:'mm-popover'});
    if(title) popEl.appendChild(U.el('div',{class:'mm-pop-title',text:title}));
    const box=U.el('div',{class:'mm-pop-body'}); popEl.appendChild(box); build(box);
    root.appendChild(popEl); anchorPop(popEl, true);
    const close=(e)=>{ if(popEl&&!popEl.contains(e.target)){ closePop(); document.removeEventListener('mousedown',close,true); } };
    setTimeout(()=>document.addEventListener('mousedown',close,true),0);
  }
  // build a vertical icon menu element from an item list (shared by mmMenu / mmContextMenu)
  function buildMenuEl(items){
    const el=U.el('div',{class:'mm-menu'});
    for(const it of items){
      if(it.sep){ el.appendChild(U.el('div',{class:'mm-menu-sep'})); continue; }
      if(it.head){ el.appendChild(U.el('div',{class:'mm-menu-head',text:it.head})); continue; }
      const b=U.el('button',{class:'mm-menu-item'+(it.danger?' danger':'')+(it.primary?' primary':'')});
      b.innerHTML=CM.icons.svg(it.ic||'box',{size:it.primary?20:19}); b.appendChild(U.el('span',{text:it.t}));
      b.onmousedown=(e)=>e.stopPropagation(); b.onclick=(e)=>{ e.stopPropagation(); closePop(); it.fn(); };
      el.appendChild(b);
    }
    return el;
  }
  function armClose(){ const close=(e)=>{ if(popEl&&!popEl.contains(e.target)){ closePop(); document.removeEventListener('mousedown',close,true); document.removeEventListener('contextmenu',close,true); } };
    setTimeout(()=>{ document.addEventListener('mousedown',close,true); document.addEventListener('contextmenu',close,true); },0); }
  // vertical icon menu anchored to the selected node ("Schema" / "More" submenus)
  function mmMenu(items){
    closePop(); popEl=buildMenuEl(items); root.appendChild(popEl);
    const r=selected?nodeScreenRect(selected):{cx:root.clientWidth/2,top:root.clientHeight/2,h:0,rootW:root.clientWidth,rootH:root.clientHeight};
    popEl.style.left=U.clamp(r.cx-popEl.offsetWidth/2, 10, r.rootW-popEl.offsetWidth-10)+'px';
    popEl.style.top=U.clamp(r.top, 10, r.rootH-popEl.offsetHeight-10)+'px';
    armClose();
  }
  // OS-style context menu opened at the cursor (right-click)
  function mmContextMenu(clientX, clientY, items){
    closePop(); popEl=buildMenuEl(items); root.appendChild(popEl);
    const rr=root.getBoundingClientRect(); let x=clientX-rr.left, y=clientY-rr.top;
    x=U.clamp(x, 8, rr.width-popEl.offsetWidth-8); y=U.clamp(y, 8, rr.height-popEl.offsetHeight-8);
    popEl.style.left=x+'px'; popEl.style.top=y+'px';
    armClose();
  }
  // full tool list for a node (used by the right-click context window)
  function nodeMenuItems(n){
    return [
      {head:I.t('cm.menuNode','Węzeł')},
      {ic:'plus', t:I.t('cm.menuNewChild','Węzeł +  (nowe dziecko)')+'   ·  Tab', primary:true, fn:()=>addChild(n)},
      {ic:'sibling', t:I.t('cm.menuSibling','Rodzeństwo')+'   ·  Enter', fn:()=>addSibling(n)},
      {ic:'copy', t:I.t('cm.menuDuplicate','Duplikuj'), fn:()=>duplicateNode(n)},
      {sep:true},
      {ic:'type', t:I.t('cm.menuEditText','Edytuj tekst')+'   ·  F2', fn:()=>editText(n,true)},
      {ic:'image', t:I.t('cm.menuImageEmoji','Obraz / emoji'), fn:()=>addImage(n)},
      {ic:'note', t:I.t('cm.menuNote','Notatka'), fn:()=>addNote(n)},
      {ic:'connect', t:I.t('cm.menuConnectOther','Połącz z innym'), fn:()=>{ selectNode(n); toggleConnect(); }},
      {ic:'reattach', t:I.t('cm.menuReattachParent','Przepnij do rodzica'), fn:()=>startReattach(n)},
      {sep:true},
      {ic:'palette', t:I.t('cm.menuColor','Kolor'), fn:()=>quickColor(n)},
      {ic:'shapes', t:I.t('cm.menuShapeFrame','Kształt / ramka'), fn:()=>quickShape(n)},
      {ic:'resize', t:I.t('cm.menuSize','Rozmiar'), fn:()=>quickWidth(n)},
      {ic:'group', t:n.grouped?I.t('cm.menuUngroup','Rozgrupuj'):I.t('cm.menuGroupBranch','Grupuj gałąź'), fn:()=>toggleGroup(n)},
      {ic:n.locked?'unlock':'lock', t:n.locked?I.t('cm.menuUnlock','Odblokuj'):I.t('cm.menuLock','Zablokuj'), fn:()=>{ n.locked=!n.locked; render(); selectNode(n); }},
      {ic:n.collapsed?'expand':'collapse', t:n.collapsed?I.t('cm.menuExpandBranch','Rozwiń gałąź'):I.t('cm.menuCollapseBranch','Zwiń gałąź'), fn:()=>{ n.collapsed=!n.collapsed; render(); selectNode(n); }},
      {sep:true},
      {ic:'clipboard', t:I.t('cm.menuCopy','Kopiuj'), fn:()=>copyNode(n)},
      {ic:'scissors', t:I.t('cm.menuCut','Wytnij'), fn:()=>cutNode(n)},
      {ic:'paste', t:I.t('cm.menuPasteInto','Wklej do węzła'), fn:()=>pasteNode(n)},
      {ic:'grid', t:I.t('cm.menuLayoutSchema','Schemat układu…'), fn:()=>openSchemaMenu(n)},
      {sep:true},
      {ic:'trash', t:I.t('cm.menuDeleteNode','Usuń węzeł'), danger:true, fn:()=>delNode(n)},
      {ic:'trash', t:I.t('cm.menuDeleteBranch','Usuń całą gałąź'), danger:true, fn:()=>delBranch(n)},
    ];
  }
  // tools when right-clicking empty canvas
  function canvasMenuItems(clientX, clientY){
    const w=screenToWorld(clientX, clientY);
    return [
      {head:I.t('cm.menuMap','Mapa')},
      {ic:'plus', t:I.t('cm.menuNewHere','Węzeł +  (tutaj)'), primary:true, fn:()=>addNode(w.x-85, w.y-30)},
      {ic:'paste', t:I.t('cm.menuPasteNode','Wklej węzeł'), fn:()=>{ const c=clipboard?addNode(w.x-85,w.y-30,Object.assign({},clipboard)):null; if(!c)U.toast&&U.toast(I.t('cm.toastClipboardEmpty','Schowek pusty.'),'error',1300); }},
      {sep:true},
      {ic:'grid', t:I.t('cm.menuLayoutTemplates','Schemat układu / szablony…'), fn:()=>showLayoutDialog()},
      {ic:'flow', t:I.t('cm.menuAutoArrange','Auto-ułóż'), fn:()=>autoArrange()},
      {ic:'fit', t:I.t('cm.menuFitView','Dopasuj widok'), fn:()=>fitView()},
      {sep:true},
      {ic:'trash', t:I.t('cm.menuClearMap','Wyczyść mapę'), danger:true, fn:()=>{ if(confirm(I.t('cm.confirmClear','Wyczyścić mapę myśli?'))){ state.nodes=[];state.edges=[];selected=null;render();renderInspector();hideSurround(); } }},
    ];
  }

  // ---------- node surround menu (grouped tool bars around the selected node) ----------
  function buildSurround(){ surround=U.el('div',{id:'mm-surround',class:'hidden'}); surround.onmousedown=(e)=>e.stopPropagation(); root.appendChild(surround); }
  // labelled button (top / bottom horizontal bars)
  function sBtn(ic,label,fn,cls){ const b=U.el('button',{class:'mm-sb '+(cls||''),title:label});
    b.onmousedown=(e)=>e.stopPropagation(); b.onclick=(e)=>{ e.stopPropagation(); fn(); };
    b.innerHTML=CM.icons.svg(ic,{size:18}); b.appendChild(U.el('span',{class:'mm-sb-lbl',text:label})); return b; }
  // icon-only button (slim left / right vertical columns — label via tooltip)
  function sIcon(ic,label,fn,cls){ const b=U.el('button',{class:'mm-si '+(cls||''),title:label});
    b.onmousedown=(e)=>e.stopPropagation(); b.onclick=(e)=>{ e.stopPropagation(); fn(); };
    b.innerHTML=CM.icons.svg(ic,{size:19}); return b; }
  function sBar(side, btns){ const bar=U.el('div',{class:'mm-sbar mm-sbar-'+side}); btns.forEach(b=>bar.appendChild(b)); return bar; }
  function showSurround(n){
    if(!surround) return; closePop(); surround.innerHTML=''; surround.classList.remove('hidden');
    // TOP — content (labelled)
    surround.appendChild(sBar('top',[
      sBtn('type',I.t('cm.sbText','Tekst'),()=>editText(n,true)),
      sBtn('image',I.t('cm.sbImage','Obraz'),()=>addImage(n)),
      sBtn('connect',I.t('cm.sbConnect','Połącz'),()=>{ selectNode(n); toggleConnect(); }),
      sBtn('note',I.t('cm.sbNote','Notatka'),()=>addNote(n)),
      sBtn('dots',I.t('cm.sbMore','Więcej'),()=>openMoreMenu(n)),
    ]));
    // LEFT — clipboard (slim, icon-only)
    surround.appendChild(sBar('left',[
      sIcon('clipboard',I.t('cm.sbCopy','Kopiuj'),()=>copyNode(n)),
      sIcon('scissors',I.t('cm.sbCut','Wytnij'),()=>cutNode(n)),
      sIcon('paste',I.t('cm.sbPaste','Wklej'),()=>pasteNode(n)),
      sIcon('trash',I.t('cm.sbDelete','Usuń'),()=>delNode(n),'danger'),
    ]));
    // RIGHT — structure (slim, icon-only)
    surround.appendChild(sBar('right',[
      sIcon('branch',I.t('cm.sbChild','Dziecko')+' · Tab',()=>addChild(n)),
      sIcon('sibling',I.t('cm.sbSibling','Rodzeństwo')+' · Enter',()=>addSibling(n)),
      sIcon('copy',I.t('cm.sbDuplicate','Duplikuj'),()=>duplicateNode(n)),
      sIcon('reattach',I.t('cm.sbReattach','Przepnij'),()=>startReattach(n)),
    ]));
    // BOTTOM — appearance + schema (labelled)
    surround.appendChild(sBar('bottom',[
      sBtn('resize',I.t('cm.sbSize','Rozmiar'),()=>quickWidth(n)),
      sBtn('group',I.t('cm.sbGroup','Grupuj'),()=>toggleGroup(n),n.grouped?'on':''),
      sBtn('palette',I.t('cm.sbColor','Kolor'),()=>quickColor(n)),
      sBtn('shapes',I.t('cm.sbShape','Kształt'),()=>quickShape(n)),
      sBtn('grid',I.t('cm.sbSchema','Schemat'),()=>openSchemaMenu(n)),
    ]));
    // quick circular edit / remove right under the node
    const quick=U.el('div',{class:'mm-quick'});
    const qe=U.el('button',{class:'mm-q',title:I.t('cm.menuEditText','Edytuj tekst')+' · F2',html:CM.icons.svg('pencil',{size:15})}); qe.onmousedown=(e)=>e.stopPropagation(); qe.onclick=(e)=>{ e.stopPropagation(); editText(n,true); };
    const qd=U.el('button',{class:'mm-q mm-q-del',title:I.t('cm.menuDeleteNode','Usuń węzeł'),html:CM.icons.svg('minus',{size:15})}); qd.onmousedown=(e)=>e.stopPropagation(); qd.onclick=(e)=>{ e.stopPropagation(); delNode(n); };
    quick.appendChild(qe); quick.appendChild(qd); surround.appendChild(quick);
    positionSurround();
  }
  function hideSurround(){ if(surround) surround.classList.add('hidden'); closePop(); }
  // arrange the four bars as a clean 3×3 grid around the node (top / [left · node · right] / bottom),
  // so the vertical columns sit in the middle band and never overlap the horizontal bars.
  function positionSurround(){
    if(!surround||surround.classList.contains('hidden')||!selected) return;
    const r=nodeScreenRect(selected), G=11, clamp=U.clamp;
    const top=surround.querySelector('.mm-sbar-top'), bot=surround.querySelector('.mm-sbar-bottom');
    const lft=surround.querySelector('.mm-sbar-left'), rgt=surround.querySelector('.mm-sbar-right'), q=surround.querySelector('.mm-quick');
    const place=(el,x,y)=>{ el.style.left=Math.round(x)+'px'; el.style.top=Math.round(y)+'px'; };
    const sideH=Math.max(lft?lft.offsetHeight:0, rgt?rgt.offsetHeight:0);
    const bandH=Math.max(r.h, sideH);                 // middle row height (node or side columns, whichever taller)
    const bandTop=r.cy-bandH/2, bandBot=r.cy+bandH/2;
    if(top){ const w=top.offsetWidth,h=top.offsetHeight; place(top, clamp(r.cx-w/2,6,r.rootW-w-6), Math.max(6, bandTop-G-h)); }
    if(bot){ const w=bot.offsetWidth,h=bot.offsetHeight; let y=bandBot+G; if(y+h>r.rootH-6)y=r.rootH-h-6; place(bot, clamp(r.cx-w/2,6,r.rootW-w-6), y); }
    if(lft){ const w=lft.offsetWidth,h=lft.offsetHeight; let x=r.left-w-G; if(x<6)x=6; place(lft, x, clamp(r.cy-h/2,6,r.rootH-h-6)); }
    if(rgt){ const w=rgt.offsetWidth,h=rgt.offsetHeight; let x=r.left+r.w+G; if(x+w>r.rootW-6)x=r.rootW-w-6; place(rgt, x, clamp(r.cy-h/2,6,r.rootH-h-6)); }
    if(q){ const w=q.offsetWidth; place(q, clamp(r.cx-w/2,6,r.rootW-w-6), r.top+r.h-4); }
  }

  // ---------- "More" + "Schema" submenus ----------
  function openMoreMenu(n){
    mmMenu([
      {ic:n.locked?'unlock':'lock', t:n.locked?I.t('cm.menuUnlockFigure','Odblokuj figurę'):I.t('cm.menuLockFigure','Zablokuj figurę'), fn:()=>{ n.locked=!n.locked; render(); selectNode(n); }},
      {ic:n.collapsed?'expand':'collapse', t:n.collapsed?I.t('cm.menuExpandBranch','Rozwiń gałąź'):I.t('cm.menuCollapseBranch','Zwiń gałąź'), fn:()=>{ n.collapsed=!n.collapsed; render(); selectNode(n); }},
      {ic:'note', t:I.t('cm.menuNoteDots','Notatka…'), fn:()=>addNote(n)},
      {ic:'crosshair', t:I.t('cm.menuCenterScreen','Wyśrodkuj na ekranie'), fn:()=>centerOn(n)},
      {sep:true},
      {ic:'trash', t:I.t('cm.menuDeleteBranch','Usuń całą gałąź'), danger:true, fn:()=>delBranch(n)},
    ]);
  }
  function openSchemaMenu(n){
    mmMenu([
      {ic:'palette', t:I.t('cm.menuColorSchema','Schemat kolorów'), fn:()=>openColorSchemaPopover()},
      {ic:'x', t:I.t('cm.menuDisableColorSchema','Wyłącz schemat kolorów'), fn:()=>disableColorSchema()},
      {ic:'grid', t:I.t('cm.menuLayoutSchemaShort','Schemat układu'), fn:()=>showLayoutDialog()},
      {ic:'resize', t:I.t('cm.menuSubnodeSpacing','Odstęp pod-węzłów'), fn:()=>openSpacingPopover()},
    ]);
  }
  function openColorSchemaPopover(){
    mmPopover(I.t('cm.menuColorSchema','Schemat kolorów'),(box)=>{ const wrap=U.el('div',{class:'mm-schema-pals'});
      for(const name in SCHEMA_PALETTES){ const b=U.el('button',{class:'mm-pal',title:name,onclick:()=>applyColorSchema(name)});
        SCHEMA_PALETTES[name].slice(0,5).forEach(c=>b.appendChild(U.el('span',{style:`background:${c}`}))); wrap.appendChild(b); }
      box.appendChild(wrap);
      box.appendChild(U.el('button',{class:'mm-pal mm-pal-off',style:'margin-top:8px',html:CM.icons.svg('x',{size:14})+' '+I.t('cm.disableSchema','Wyłącz schemat'),onclick:()=>{ disableColorSchema(); closePop(); }}));
    });
  }
  function openSpacingPopover(){
    mmPopover(I.t('cm.menuSubnodeSpacing','Odstęp pod-węzłów'),(box)=>{
      const mkR=(lbl,min,max,val,set)=>{ const w=U.el('label',{class:'mm-rng'}); const sp=U.el('span',{text:lbl+': '+val}); w.appendChild(sp);
        const r=U.el('input',{type:'range',min:String(min),max:String(max),value:String(val),style:'width:230px'});
        r.oninput=()=>{ sp.textContent=lbl+': '+r.value; set(+r.value); if(state.layout&&state.layout!=='free') applyLayout(state.layout); }; w.appendChild(r); box.appendChild(w); };
      mkR(I.t('cm.spacingMain','Główny (poziomy odstęp)'),120,540,state.spaceMain,v=>state.spaceMain=v);
      mkR(I.t('cm.spacingCross','Poprzeczny (rodzeństwo)'),40,220,state.spaceCross,v=>state.spaceCross=v);
      if(state.layout==='free') box.appendChild(U.el('p',{class:'muted',style:'font-size:11px;margin-top:4px',text:I.t('cm.spacingHint','Wybierz schemat układu inny niż „Dowolny", aby odstęp działał.')}));
    });
  }
  function toggleGroup(n){ pushUndo(); n.grouped=!n.grouped; render(); selectNode(n); }

  // ---------- Layout-Schema dialog (New: direction + line style + live preview · Templates) ----------
  const DIRS=[['up',I.t('cm.dirUp','W górę')],['down',I.t('cm.dirDown','W dół')],['updown',I.t('cm.dirUpdown','Góra-Dół')],['left',I.t('cm.dirLeft','W lewo')],['right',I.t('cm.dirRight','W prawo')],['leftright',I.t('cm.dirLeftright','Lewo-Prawo')]];
  // construction = how the tree is shaped (some ignore direction)
  const LINES=[
    ['free-form',I.t('cm.lineFree','Dowolny (ręczny)'),I.t('cm.lineFreeDesc','Pozycje ustawiasz ręcznie.'),true],
    ['curved',I.t('cm.lineCurved','Drzewo — linie krzywe'),I.t('cm.lineCurvedDesc','Płynne, zaokrąglone połączenia.'),false],
    ['straight',I.t('cm.lineStraight','Drzewo — linie proste'),I.t('cm.lineStraightDesc','Kątowe połączenia ortogonalne.'),false],
    ['radial',I.t('cm.lineRadial','Radialny (gwiazda)'),I.t('cm.lineRadialDesc','Gałęzie promieniście wokół centrum.'),true],
    ['org',I.t('cm.lineOrg','Organigram'),I.t('cm.lineOrgDesc','Hierarchia od góry, proste linie.'),true],
    ['horizontal',I.t('cm.lineHoriz','Drzewo poziome'),I.t('cm.lineHorizDesc','Schludne drzewo rosnące w prawo (left-right tidy).'),true],
    ['timeaxis',I.t('cm.lineTimeaxis','Oś czasu (pozioma)'),I.t('cm.lineTimeaxisDesc','Węzły ułożone wzdłuż poziomej osi.'),true],
    ['spiral',I.t('cm.lineSpiral','Spirala'),I.t('cm.lineSpiralDesc','Węzły rozwijające się spiralnie od centrum.'),true],
    ['grid',I.t('cm.lineGrid','Siatka'),I.t('cm.lineGridDesc','Równa siatka wierszy i kolumn.'),true],
    ['layers',I.t('cm.lineLayers','Warstwy (góra-dół)'),I.t('cm.lineLayersDesc','Poziomy hierarchii jako schodkowe pasy.'),true],
    ['fishboneL',I.t('cm.lineFishbone','Fishbone (rybi szkielet)'),I.t('cm.lineFishboneDesc','Ości przyczyn wzdłuż centralnego kręgosłupa.'),true],
  ];
  const dirIndep=(k)=>{ const r=LINES.find(l=>l[0]===k); return r?r[3]:false; };
  let _ldDir='right', _ldLine='curved', _ldTpl=null, _ldTab='new';
  function previewSVG(dir, struct){
    const W=520,H=300,cx=W/2,cy=H/2;
    const node=(x,y,w,fill,txt,big)=>`<rect x="${x-w/2}" y="${y-(big?15:11)}" rx="9" width="${w}" height="${big?30:22}" fill="${fill}" stroke="#9fb3d0" stroke-width="1"/>`+(txt?`<text x="${x}" y="${y+4}" fill="#0a1018" font-size="${big?13:10}" font-weight="700" text-anchor="middle" font-family="sans-serif">${txt}</text>`:'');
    const straight=(struct==='straight'||struct==='org');
    const ln=(x1,y1,x2,y2)=>{ if(straight){ const mx=(x1+x2)/2,my=(y1+y2)/2; return `<path d="M${x1} ${y1} ${Math.abs(x2-x1)>Math.abs(y2-y1)?`H${mx} V${y2}`:`V${my} H${x2}`} H${x2} V${y2}" stroke="#6f86a8" stroke-width="2" fill="none"/>`; }
      const dx=Math.abs(x2-x1)*0.5; return `<path d="M${x1} ${y1} C ${x1+(x2>x1?dx:-dx)} ${y1}, ${x2-(x2>x1?dx:-dx)} ${y2}, ${x2} ${y2}" stroke="#6f86a8" stroke-width="2" fill="none"/>`; };
    let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
    const pal=['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b','#38bdf8'];
    const branches=(pts)=>{ pts.forEach(p=>{ s+=ln(cx,cy,p.x,p.y); }); pts.forEach(p=>{ s+=node(p.x,p.y,84,p.c,'Node'); }); };
    if(struct==='free-form'){ const pts=[{x:120,y:80},{x:400,y:70},{x:110,y:230},{x:410,y:235}].map((p,i)=>({...p,c:pal[i]})); pts.forEach(p=>s+=ln(cx,cy,p.x,p.y)); pts.forEach(p=>s+=node(p.x,p.y,84,p.c,'Node')); }
    else if(struct==='radial'){ const R=110; const pts=[]; for(let i=0;i<6;i++){ const a=i/6*Math.PI*2; pts.push({x:cx+Math.cos(a)*R, y:cy+Math.sin(a)*(R*0.78), c:pal[i]}); } pts.forEach(p=>s+=ln(cx,cy,p.x,p.y)); pts.forEach(p=>s+=node(p.x,p.y,72,p.c,'Node')); }
    else if(struct==='org'){ branches([{x:150,y:235},{x:cx,y:235},{x:370,y:235}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(struct==='horizontal'){ const root={x:110,y:cy}; s+=ln(root.x,root.y,260,80); s+=ln(root.x,root.y,260,cy); s+=ln(root.x,root.y,260,220); s+=ln(260,80,410,55); s+=ln(260,80,410,108); [{x:410,y:55},{x:410,y:108},{x:260,y:cy},{x:410,y:200},{x:410,y:245}].forEach((p,i)=>{ if(i===0||i===1) s+=node(260,80,80,pal[1],''); }); [{x:260,y:80,c:pal[1]},{x:260,y:cy,c:pal[2]},{x:260,y:220,c:pal[3]},{x:410,y:55,c:pal[4]},{x:410,y:108,c:pal[5]},{x:410,y:200,c:pal[0]},{x:410,y:245,c:pal[1]}].forEach(p=>s+=node(p.x,p.y,80,p.c,'Node')); s+=node(root.x,root.y,96,'#3b5bdb','Root',true); }
    else if(struct==='timeaxis'){ s+=`<line x1="40" y1="${cy}" x2="480" y2="${cy}" stroke="#6f86a8" stroke-width="2.4"/>`; for(let i=0;i<5;i++){ const x=70+i*92, up=i%2===0; s+=`<line x1="${x}" y1="${cy}" x2="${x}" y2="${up?cy-44:cy+44}" stroke="#6f86a8" stroke-width="1.6"/>`+`<circle cx="${x}" cy="${cy}" r="5" fill="${pal[i]}"/>`+node(x,up?cy-58:cy+58,76,pal[i],'Node'); } }
    else if(struct==='spiral'){ for(let i=0;i<9;i++){ const a=i*0.78, rr=14+i*15; const x=cx+Math.cos(a)*rr*1.4, y=cy+Math.sin(a)*rr; if(i) s+=`<circle cx="${x}" cy="${y}" r="3" fill="#6f86a8"/>`; s+=node(x,y,52,pal[i%6],''); } s+=node(cx,cy,70,'#3b5bdb','',true); }
    else if(struct==='grid'){ for(let r=0;r<3;r++)for(let c=0;c<4;c++){ s+=node(95+c*110,70+r*78,82,pal[(r*4+c)%6],'Node'); } }
    else if(struct==='layers'){ const bands=[[cx,55,1],[cx-70,130,3],[cx+30,205,3]]; let yi=0; [1,3,3].forEach((cnt,row)=>{ const y=55+row*75; const total=cnt*92; let x=cx-total/2+row*26+46; for(let i=0;i<cnt;i++){ s+=node(x,y,80,pal[(row*3+i)%6],'Node'); x+=92; } }); }
    else if(struct==='fishboneL'){ s+=`<line x1="36" y1="${cy}" x2="446" y2="${cy}" stroke="#cbd5e1" stroke-width="2.6"/><path d="M446 ${cy} L430 ${cy-9} M446 ${cy} L430 ${cy+9}" stroke="#cbd5e1" stroke-width="2.6" fill="none"/>`; for(let i=0;i<3;i++){ const bx=110+i*110, up=i%2===0; s+=`<line x1="${bx}" y1="${cy}" x2="${bx-46}" y2="${up?cy-58:cy+58}" stroke="${pal[i]}" stroke-width="2"/>`+node(bx-58,up?cy-72:cy+72,80,pal[i],'Cause'); } s+=node(470-60,cy,84,'#fb7185','Problem',true); }
    else if(dir==='right'){ branches([{x:400,y:80},{x:400,y:150},{x:400,y:220}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(dir==='left'){ branches([{x:120,y:80},{x:120,y:150},{x:120,y:220}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(dir==='down'){ branches([{x:150,y:240},{x:cx,y:240},{x:370,y:240}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(dir==='up'){ branches([{x:150,y:60},{x:cx,y:60},{x:370,y:60}].map((p,i)=>({...p,c:pal[i]}))); }
    else if(dir==='updown'){ branches([{x:160,y:60},{x:360,y:60},{x:160,y:240},{x:360,y:240}].map((p,i)=>({...p,c:pal[i]}))); }
    else { branches([{x:110,y:90},{x:110,y:210},{x:410,y:90},{x:410,y:210}].map((p,i)=>({...p,c:pal[i]}))); }
    s+=node(cx,cy,120,'#3b5bdb',(I.getLang()==='en'?'Topic':'Temat'),true);
    s+='</svg>'; return s;
  }
  // distinct mini illustration per template type
  function tplThumb(d){
    const P=['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b','#38bdf8','#a3e635','#f472b6'];
    const r=(x,y,w,h,c,rd)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rd==null?4:rd}" fill="${c}"/>`;
    const ro=(x,y,w,h,c,rd)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rd==null?4:rd}" fill="none" stroke="${c}" stroke-width="2"/>`;
    const ci=(x,y,rad,c)=>`<circle cx="${x}" cy="${y}" r="${rad}" fill="${c}"/>`;
    const ln=(x1,y1,x2,y2,c,sw)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c||'#62768f'}" stroke-width="${sw||1.5}"/>`;
    const cv=(x1,y1,x2,y2,c)=>`<path d="M${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}" stroke="${c}" stroke-width="1.6" fill="none" opacity=".7"/>`;
    let s='<svg viewBox="0 0 200 130" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect width="200" height="130" fill="#0b1018"/>';
    const k=d.k;
    if(k==='mindmap'||k==='radial'||k==='conceptmap'){ for(let i=0;i<6;i++){ const a=i/6*Math.PI*2,x=100+Math.cos(a)*60,y=65+Math.sin(a)*38,c=P[i%P.length]; s+=cv(100,65,x,y,c)+ci(x,y,9,c); } s+=ci(100,65,15,'#3b5bdb'); }
    else if(k==='outline'){ s+=r(58,18,84,16,'#22d3ee',4); for(let i=0;i<4;i++){ s+=ln(70,40,70,40+i*22,'#62768f')+ln(70,40+i*22,86,40+i*22,'#62768f')+r(90,32+i*22,72,15,P[(i+1)%P.length],3); } }
    else if(k==='timeline'||k==='roadmap'){ s+=ln(20,65,180,65,'#62768f',2); for(let i=0;i<4;i++){ const x=34+i*44; s+=ci(x,65,6,P[i])+r(x-20,80,40,13,P[i],6); } }
    else if(k==='table'){ for(let c=0;c<3;c++)for(let row=0;row<3;row++){ s+=ro(40+c*42,28+row*28,38,24,row===0?P[c]:'#3a4d63',3); } }
    else if(k==='flowchart'||k==='bpmn'){ s+=r(78,14,44,16,'#34d399',8); s+=ln(100,30,100,44,'#62768f')+r(72,44,56,16,'#22d3ee',3); s+=ln(100,60,100,72,'#62768f'); s+=`<path d="M100 72 L120 88 L100 104 L80 88 Z" fill="#f59e0b"/>`; s+=ln(80,88,40,88,'#62768f')+r(20,80,40,16,'#34d399',3)+ln(120,88,160,88,'#62768f')+r(140,80,40,16,'#fb7185',3); }
    else if(k==='fishbone'){ s+=ln(20,65,165,65,'#cbd5e1',2.4)+`<path d="M165 65 L150 56 M165 65 L150 74" stroke="#cbd5e1" stroke-width="2.4" fill="none"/>`; for(let i=0;i<3;i++){ const x=50+i*40; s+=ln(x,65,x-16,32,P[i],1.8)+ln(x+12,65,x-4,98,P[i+3],1.8); } s+=r(168,57,28,16,'#fb7185',4); }
    else if(k==='sixhats'){ const cols=['#e2e8f4','#fb7185','#475569','#f59e0b','#34d399','#38bdf8']; for(let i=0;i<6;i++) s+=ci(40+(i%3)*60,45+Math.floor(i/3)*45,16,cols[i]); }
    else if(k==='swot'){ const q=[['#34d399',26,18],['#fb7185',104,18],['#38bdf8',26,72],['#f59e0b',104,72]]; q.forEach(p=>s+=r(p[1],p[2],70,40,p[0],5)); }
    else if(k==='chat'){ for(let i=0;i<4;i++){ const left=i%2===0; s+=r(left?22:96,16+i*26,82,18,left?'#22d3ee':'#7c5cff',9); } }
    else if(k==='umlclass'){ const box=(x)=>r(x,30,56,70,'#16202e',4)+r(x,30,56,16,'#22d3ee',4)+ln(x,58,x+56,58,'#3a4d63')+ln(x,78,x+56,78,'#3a4d63'); s+=box(30)+box(114)+ln(86,55,114,55,'#62768f'); }
    else if(k==='umlusecase'){ s+=`<circle cx="32" cy="60" r="10" fill="none" stroke="#f59e0b" stroke-width="2"/><line x1="32" y1="70" x2="32" y2="92" stroke="#f59e0b" stroke-width="2"/>`; for(let i=0;i<3;i++){ const cyu=36+i*32; s+=`<ellipse cx="124" cy="${cyu}" rx="42" ry="13" fill="none" stroke="${P[i]}" stroke-width="2"/>`+ln(42,62,82,cyu,'#62768f'); } }
    else if(k==='umlsequence'){ for(let i=0;i<3;i++){ const x=40+i*60; s+=r(x-22,16,44,16,P[i],3)+ln(x,32,x,114,'#3a4d63',1.4); } s+=ln(40,52,100,52,'#cbd5e1',1.8)+ln(100,78,160,78,'#cbd5e1',1.8); }
    else if(k==='gantt'){ const bars=[[20,60,'#22d3ee'],[44,70,'#34d399'],[80,60,'#f59e0b'],[60,80,'#fb7185']]; bars.forEach((b,i)=>s+=r(b[0],26+i*24,b[1],15,b[2],4)); }
    else if(k==='carddeck'){ for(let i=0;i<4;i++) s+=r(50+i*10,30+i*8,90,58,P[i],8); }
    else if(k==='kanban'){ const cols=['#38bdf8','#f59e0b','#34d399']; for(let c=0;c<3;c++){ s+=r(16+c*62,16,54,12,cols[c],3); for(let row=0;row<3;row++) s+=r(16+c*62,34+row*28,54,22,'#1c2a3a',4)+r(16+c*62,34+row*28,4,22,cols[c],2); } }
    else if(k==='decision'){ s+=`<path d="M100 14 L122 30 L100 46 L78 30 Z" fill="#f59e0b"/>`; s+=ln(82,38,46,60,'#62768f')+ln(118,38,154,60,'#62768f'); s+=r(20,60,52,14,'#34d399',7)+r(128,60,52,14,'#fb7185',7); s+=ln(46,74,30,96,'#62768f')+ln(46,74,62,96,'#62768f')+r(14,96,32,14,'#22d3ee',3)+r(50,96,32,14,'#7c5cff',3)+r(120,96,40,14,'#38bdf8',3); }
    else if(k==='okr'){ s+=r(50,16,100,18,'#7c5cff',6); for(let i=0;i<3;i++){ s+=ln(100,34,100,46+i*24,'#62768f')+ro(40,46+i*24,120,16,'#34d399',4); } }
    else if(k==='orgchart'){ s+=r(78,14,44,16,'#7c5cff',4); for(let i=0;i<3;i++){ const x=40+i*60; s+=ln(100,30,x,48,'#62768f')+r(x-22,48,44,15,'#22d3ee',3); for(let j=0;j<2;j++) s+=ln(x,63,x,72+j*20,'#62768f')+r(x-22,72+j*20,44,13,'#34d399',3); } }
    else if(k==='proscons'){ s+=r(74,12,52,15,'#7c5cff',7); s+=r(24,34,68,15,'#34d399',6)+r(108,34,68,15,'#fb7185',6); for(let i=0;i<3;i++){ s+=ro(24,54+i*22,68,16,'#34d399',3)+ro(108,54+i*22,68,16,'#fb7185',3); } }
    else if(k==='empathy'){ s+=ln(100,18,100,112,'#3a4d63',1.4)+ln(24,65,176,65,'#3a4d63',1.4); const q=[['#38bdf8',30,24],['#34d399',104,24],['#f59e0b',30,70],['#fb7185',104,70]]; q.forEach(p=>s+=ro(p[1],p[2],62,34,p[0],4)); s+=ci(100,65,12,'#7c5cff'); }
    else if(k==='bmc'){ const cells=[[14,20,1,2],[44,20,1,1],[44,49,1,1],[74,20,1,2],[104,20,1,1],[104,49,1,1],[134,20,1,2]]; cells.forEach((c,i)=>s+=ro(c[0],c[1],26,c[3]===2?56:27,P[i%P.length],3)); s+=ro(14,80,76,16,'#fb7185',3)+ro(94,80,76,16,'#34d399',3); }
    else if(k==='storymap'){ for(let c=0;c<3;c++){ s+=r(18+c*60,16,52,12,'#7c5cff',3)+r(18+c*60,32,52,10,'#38bdf8',5); for(let row=0;row<2;row++) s+=r(18+c*60,48+row*26,52,22,'#f59e0b',3); } }
    else if(k==='affinity'){ const cols=['#38bdf8','#34d399','#f59e0b']; for(let c=0;c<3;c++){ s+=r(18+c*60,14,52,12,cols[c],3); for(let row=0;row<3;row++) s+=r(18+c*60,30+row*26,52,22,'#1c2a3a',4)+r(18+c*60,30+row*26,52,4,cols[c],2); } }
    else if(k==='venn'){ s+=`<circle cx="78" cy="58" r="34" fill="${P[5]}" opacity="0.55"/><circle cx="122" cy="58" r="34" fill="${P[3]}" opacity="0.55"/><circle cx="100" cy="92" r="34" fill="${P[2]}" opacity="0.55"/>`; }
    else if(k==='pyramid'){ const wseq=[44,78,112,146,180]; for(let i=0;i<5;i++){ const w=wseq[i]; s+=r(100-w/2,22+i*20,w,16,P[i%P.length],2); } }
    else if(k==='funnel'){ const wseq=[170,128,86,44]; for(let i=0;i<4;i++){ const w=wseq[i]; s+=r(100-w/2,20+i*26,w,20,P[i%P.length],6); } }
    else if(k==='pert'){ s+=ci(24,65,7,'#34d399'); s+=r(64,28,40,16,'#22d3ee',3)+r(64,86,40,16,'#38bdf8',3)+r(118,57,40,16,'#f59e0b',3); s+=ci(186,65,7,'#fb7185'); s+=ln(31,65,64,40,'#62768f')+ln(31,65,64,94,'#62768f')+ln(104,36,118,62,'#62768f')+ln(104,94,118,70,'#62768f')+ln(158,65,179,65,'#62768f'); }
    else if(k==='fivewhys'){ s+=r(72,12,56,14,'#fb7185',6); let py=26; for(let i=0;i<4;i++){ const x=60+i*14; s+=ln(100,py,x+24,30+i*22,'#62768f')+r(x,30+i*22,52,15,P[i%P.length],4); py=45+i*22; } s+=`<path d="M104 110 L120 118 L104 126 L88 118 Z" fill="#34d399"/>`; }
    else if(k==='radar'){ const cxr=100,cyr=65; for(let ring=3;ring>=1;ring--){ let pts=''; for(let i=0;i<=6;i++){ const a=i/6*Math.PI*2-Math.PI/2; pts+=(cxr+Math.cos(a)*ring*15)+','+(cyr+Math.sin(a)*ring*13)+' '; } s+=`<polygon points="${pts}" fill="none" stroke="#3a4d63" stroke-width="1"/>`; } let shp=''; const vals=[3,2,3,1,2.4,1.6]; for(let i=0;i<6;i++){ const a=i/6*Math.PI*2-Math.PI/2; shp+=(cxr+Math.cos(a)*vals[i]*15)+','+(cyr+Math.sin(a)*vals[i]*13)+' '; } s+=`<polygon points="${shp}" fill="#7c5cff" opacity="0.5" stroke="#7c5cff" stroke-width="1.6"/>`; }
    else if(k==='valuechain'){ for(let i=0;i<3;i++) s+=r(20,14+i*15,160,12,'#7c5cff',2); const cols=['#38bdf8','#22d3ee','#34d399','#f59e0b','#fb7185']; for(let i=0;i<5;i++) s+=`<path d="M${20+i*30} 70 h22 l8 14 l-8 14 h-22 l8 -14 Z" fill="${cols[i]}"/>`; s+=`<path d="M170 70 l14 14 l-14 14 Z" fill="#a3e635"/>`; }
    else { for(let i=0;i<5;i++){ const a=i/5*Math.PI*2,x=100+Math.cos(a)*55,y=65+Math.sin(a)*35,c=P[i%P.length]; s+=cv(100,65,x,y,c)+ci(x,y,9,c); } s+=ci(100,65,14,'#3b5bdb'); }
    return s+'</svg>';
  }
  function buildLayoutDialog(){
    layoutDlg=U.el('div',{id:'mm-layout-dlg',class:'hidden'});
    const box=U.el('div',{class:'mm-ld-box'});
    // tabs
    const tabs=U.el('div',{class:'mm-ld-tabs'});
    const tNew=U.el('button',{class:'mm-ld-tab on',text:I.t('cm.tabNew','Nowy'),onclick:()=>{ _ldTab='new'; renderLD(); }});
    const tTpl=U.el('button',{class:'mm-ld-tab',text:I.t('cm.tabTemplates','Szablony'),onclick:()=>{ _ldTab='tpl'; renderLD(); }});
    tabs.appendChild(tNew); tabs.appendChild(tTpl); box.appendChild(tabs);
    const body=U.el('div',{class:'mm-ld-body'}); box.appendChild(body);
    const foot=U.el('div',{class:'mm-ld-foot'}); box.appendChild(foot);
    layoutDlg.appendChild(box);
    layoutDlg.addEventListener('mousedown',(e)=>{ if(e.target===layoutDlg) hideLayoutDialog(); });
    root.appendChild(layoutDlg);

    function renderLD(){
      tNew.textContent=I.t('cm.tabNew','Nowy'); tTpl.textContent=I.t('cm.tabTemplates','Szablony');  // keep tab labels localized
      tNew.classList.toggle('on',_ldTab==='new'); tTpl.classList.toggle('on',_ldTab==='tpl');
      body.innerHTML=''; foot.innerHTML='';
      if(_ldTab==='new') renderNew(); else renderTpl();
    }
    function renderNew(){
      body.appendChild(U.el('h2',{class:'mm-ld-title',text:I.t('cm.ldTitleNew','Wybierz schemat układu')}));
      // direction radios (disabled for direction-independent constructions)
      const dDis=dirIndep(_ldLine);
      const dwrap=U.el('div',{class:'mm-ld-dirs'+(dDis?' disabled':'')});
      for(const [k,n] of DIRS){ const r=U.el('button',{class:'mm-ld-radio'+(_ldDir===k?' on':''),onclick:()=>{ if(dDis) return; _ldDir=k; renderLD(); }});
        r.appendChild(U.el('span',{class:'mm-ld-dot'})); r.appendChild(U.el('span',{text:n})); dwrap.appendChild(r); }
      body.appendChild(dwrap);
      // construction-type cards + live preview
      const row=U.el('div',{class:'mm-ld-row'});
      const cards=U.el('div',{class:'mm-ld-lines'});
      for(const [k,n,desc] of LINES){ const c=U.el('button',{class:'mm-ld-line'+(_ldLine===k?' on':''),onclick:()=>{ _ldLine=k; renderLD(); }});
        c.appendChild(U.el('div',{class:'mm-ld-line-h',text:n}));
        c.appendChild(U.el('div',{class:'mm-ld-line-thumb',html:previewSVG(_ldDir, k)}));
        cards.appendChild(c); }
      row.appendChild(cards);
      const prev=U.el('div',{class:'mm-ld-preview',html:previewSVG(_ldDir, _ldLine)});
      row.appendChild(prev);
      body.appendChild(row);
      // footer
      foot.appendChild(U.el('button',{class:'mm-ld-btn ghost',html:CM.icons.svg('arrowLeft',{size:15})+' '+I.t('cm.btnCancel','Anuluj'),onclick:()=>hideLayoutDialog()}));
      foot.appendChild(U.el('div',{style:'flex:1'}));
      foot.appendChild(U.el('button',{class:'mm-ld-btn ghost',text:I.t('cm.btnSkip','Pomiń »'),onclick:()=>hideLayoutDialog()}));
      foot.appendChild(U.el('button',{class:'mm-ld-btn primary',html:I.t('cm.btnApply','Zastosuj ')+CM.icons.svg('arrowRight',{size:15}),onclick:()=>applyLayoutChoice()}));
    }
    function renderTpl(){
      body.appendChild(U.el('h2',{class:'mm-ld-title',text:I.t('cm.ldTitleTpl','Szablony — wybierz i utwórz')}));
      const grid=U.el('div',{class:'mm-ld-tpls'});
      if(_ldTpl==null) _ldTpl=DIAGRAMS[0].k;
      for(const d of DIAGRAMS){ const c=U.el('button',{class:'mm-ld-tpl'+(_ldTpl===d.k?' on':''),onclick:()=>{ _ldTpl=d.k; renderLD(); }});
        c.appendChild(U.el('div',{class:'mm-ld-tpl-thumb',html:tplThumb(d)}));
        const cap=U.el('div',{class:'mm-ld-tpl-cap'}); cap.appendChild(U.el('span',{class:'mm-ld-tpl-ic',html:CM.icons.svg(d.icon,{size:15})})); const capTxt=U.el('div'); capTxt.appendChild(U.el('b',{text:d.name})); if(d.desc) capTxt.appendChild(U.el('div',{class:'mm-ld-tpl-desc',text:d.desc})); cap.appendChild(capTxt);
        c.appendChild(cap); grid.appendChild(c); }
      body.appendChild(grid);
      foot.appendChild(U.el('button',{class:'mm-ld-btn ghost',html:CM.icons.svg('arrowLeft',{size:15})+' '+I.t('cm.btnCancel','Anuluj'),onclick:()=>hideLayoutDialog()}));
      foot.appendChild(U.el('div',{style:'flex:1'}));
      foot.appendChild(U.el('button',{class:'mm-ld-btn primary',html:I.t('cm.btnCreate','Utwórz ')+CM.icons.svg('arrowRight',{size:15}),onclick:()=>{ buildDiagram(_ldTpl); hideLayoutDialog(); }}));
    }
    function applyLayoutChoice(){
      if(state.nodes.length) pushUndo();
      if(_ldLine==='free-form'){ applyLayout('free'); }
      else if(_ldLine==='radial'){ state.line='curved'; applyLayout('radial'); }
      else if(_ldLine==='org'){ state.line='straight'; applyLayout('down'); }
      else if(_ldLine==='horizontal'){ state.line='curved'; applyLayout('right'); }
      else if(_ldLine==='timeaxis'){ state.line='straight'; state.layout='free'; timeAxisLayout(); }
      else if(_ldLine==='spiral'){ state.line='curved'; state.layout='free'; spiralLayout(); }
      else if(_ldLine==='grid'){ state.line='straight'; state.layout='free'; gridLayout(); }
      else if(_ldLine==='layers'){ state.line='straight'; state.layout='free'; layersLayout(); }
      else if(_ldLine==='fishboneL'){ state.line='straight'; state.layout='free'; fishboneLayout(); }
      else { state.line=(_ldLine==='straight'?'straight':'curved'); applyLayout(_ldDir); }
      drawEdges(); hideLayoutDialog();
      setTimeout(()=>autoSnap('layout'),2000);
    }
    layoutDlg._render=renderLD;
  }
  function showLayoutDialog(tab){ if(!layoutDlg) return; _ldDir=(state.layout&&state.layout!=='free')?state.layout:'right'; _ldLine=(state.layout==='free')?'free-form':(state.line||'curved'); _ldTab=tab||'new'; layoutDlg.classList.remove('hidden'); if(layoutDlg._render) layoutDlg._render(); }
  function hideLayoutDialog(){ if(layoutDlg) layoutDlg.classList.add('hidden'); }

  // ---------- inspector (right panel) ----------
  function renderInspector(){
    if(!inspector) return;
    inspector.innerHTML='';
    inspector.appendChild(U.el('div',{class:'mm-insp-head',text:I.t('cm.inspProperties','Właściwości')}));
    if(!selected){
      inspector.appendChild(U.el('p',{class:'muted',style:'padding:10px 4px',text:I.t('cm.inspEmptyHint','Kliknij węzeł, aby go edytować. Dwuklik na tle = nowy węzeł. Dwuklik na węźle = edycja tekstu.')}));
      // map-level controls
      const sec=U.el('div',{class:'mm-sec'});
      sec.appendChild(U.el('h5',{text:I.t('cm.inspTemplatesHint','Szablony — kliknij, aby dodać')}));
      const grid=U.el('div',{class:'mm-tpl-grid'});
      for(const t of TEMPLATES){ const b=U.el('button',{class:'mm-tpl-chip mm-tpl-'+t.k,title:tplName(t),onclick:()=>addNodeCentered({template:t.k})});
        b.appendChild(U.el('span',{class:'mm-tpl-chip-lbl',text:tplName(t)})); grid.appendChild(b); }
      sec.appendChild(grid); inspector.appendChild(sec);
      return;
    }
    const n=selected;
    // text
    const s1=U.el('div',{class:'mm-sec'}); s1.appendChild(U.el('h5',{text:I.t('cm.inspContent','Treść')}));
    const ta=U.el('textarea',{class:'mm-input',rows:'3'}); ta.value=n.text; ta.oninput=()=>{ n.text=ta.value; render(); selected=n; }; s1.appendChild(ta);
    inspector.appendChild(s1);
    // template
    const s2=U.el('div',{class:'mm-sec'}); s2.appendChild(U.el('h5',{text:I.t('cm.inspFrameTemplate','Szablon ramki')}));
    const tg=U.el('div',{class:'mm-tpl-grid'});
    for(const t of TEMPLATES){ const b=U.el('button',{class:'mm-tpl-chip mm-tpl-'+t.k+(n.template===t.k?' on':''),title:tplName(t),onclick:()=>{ n.template=t.k; render(); selected=n; renderInspector(); }});
      b.appendChild(U.el('span',{class:'mm-tpl-chip-lbl',text:tplName(t)})); tg.appendChild(b); }
    s2.appendChild(tg); inspector.appendChild(s2);
    // color
    const s3=U.el('div',{class:'mm-sec'}); s3.appendChild(U.el('h5',{text:I.t('cm.inspColor','Kolor')}));
    const cr=U.el('div',{class:'mm-color-row'});
    for(const c of COLORS){ const b=U.el('button',{class:'mm-color'+(n.color===c?' on':''),style:`background:${c}`,onclick:()=>{ n.color=c; render(); selected=n; renderInspector(); }}); cr.appendChild(b); }
    const cp=U.el('input',{type:'color',class:'mm-color-pick',value:n.color}); cp.oninput=()=>{ n.color=cp.value; render(); selected=n; }; cr.appendChild(cp);
    s3.appendChild(cr); inspector.appendChild(s3);
    // size
    const s4=U.el('div',{class:'mm-sec'}); s4.appendChild(U.el('h5',{text:I.t('cm.inspSize','Rozmiar')}));
    const fr=U.el('label',{class:'mm-rng'}); fr.appendChild(U.el('span',{text:I.t('cm.inspFont','Czcionka')}));
    const fi=U.el('input',{type:'range',min:'10',max:'34',value:n.font}); fi.oninput=()=>{ n.font=+fi.value; render(); selected=n; }; fr.appendChild(fi); s4.appendChild(fr);
    const wr=U.el('label',{class:'mm-rng'}); wr.appendChild(U.el('span',{text:I.t('cm.inspWidth','Szerokość')}));
    const wi=U.el('input',{type:'range',min:'110',max:'420',value:n.w}); wi.oninput=()=>{ n.w=+wi.value; render(); selected=n; }; wr.appendChild(wi); s4.appendChild(wr);
    inspector.appendChild(s4);
    // actions
    const acts=U.el('div',{class:'mm-sec mm-acts'});
    acts.appendChild(U.el('button',{class:'tb-btn',onclick:()=>delNode(n),html:CM.icons.svg('trash',{size:14})+' '+I.t('cm.menuDeleteNode','Usuń węzeł')}));
    inspector.appendChild(acts);
  }

  // ---------- persistence ----------
  const LS_KEY='codemap_mindmaps';
  function allLocal(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); }catch(e){ return {}; } }
  function saveLocal(){ showSlModal('save'); }
  function openLocalPicker(){ showSlModal('load'); }
  function buildSlModal(){
    _slModal=U.el('div',{id:'mm-sl-modal',class:'hidden'});
    _slModal.addEventListener('click',(e)=>{ if(e.target===_slModal) hideSlModal(); });
    canvas.appendChild(_slModal);
  }
  function hideSlModal(){ if(_slModal) _slModal.classList.add('hidden'); }
  function showSlModal(mode){
    if(!_slModal){ buildSlModal(); }
    _slMode=mode;
    _slModal.innerHTML='';
    const isSave=mode==='save';
    const box=U.el('div',{class:'mm-sl-box'});
    const head=U.el('div',{class:'mm-sl-head'});
    head.appendChild(U.el('h3',{text:isSave?I.t('cm.slTitleSave','Zapisz mapę'):I.t('cm.slTitleLoad','Wczytaj mapę')}));
    const xBtn=U.el('button',{class:'mm-sl-head-x',html:CM.icons.svg('x',{size:15}),onclick:hideSlModal});
    head.appendChild(xBtn);
    const body=U.el('div',{class:'mm-sl-body'});
    let nameInp=null;
    if(isSave){
      const row=U.el('div',{class:'mm-sl-name-row'});
      nameInp=U.el('input',{placeholder:I.t('cm.slNamePlaceholder','Nazwa mapy...'),value:state.name||I.t('cm.defaultMindMap','Mapa myśli')});
      const saveBtn=U.el('button',{text:I.t('cm.slSaveBtn','Zapisz')});
      saveBtn.onclick=()=>{
        const n=nameInp.value.trim(); if(!n) return;
        state.name=n; syncTitle();
        const s=allLocal(); s[n]={name:n,mapId:ensureMapId(),nodes:state.nodes,edges:state.edges,seq:state.seq,
          // WITHOUT these, load() ran CM.Draw.load(m.draw||[]) — wiping the drawing layer — and reset the
          // layout/line/spacing to the previous map's. Local save must carry the same fields as file export.
          draw:(CM.Draw&&CM.Draw.serialize)?CM.Draw.serialize():[],
          layout:state.layout, line:state.line, spaceMain:state.spaceMain, spaceCross:state.spaceCross, ts:Date.now()};
        try{ localStorage.setItem(LS_KEY,JSON.stringify(s)); }
        catch(err){ U.toast(I.t('cm.slSaveErr','Błąd zapisu — pamięć przeglądarki pełna.'),'error'); return; }
        U.toast('💾 '+I.t('cm.toastSavedPre','Zapisano „')+n+I.t('cm.toastSavedPost','".'),'success');
        hideSlModal();
      };
      nameInp.addEventListener('keydown',(e)=>{ if(e.key==='Enter') saveBtn.click(); });
      row.appendChild(nameInp); row.appendChild(saveBtn); body.appendChild(row);
    }
    const store=allLocal(); const names=Object.keys(store);
    const list=U.el('div',{class:'mm-sl-list'});
    if(!names.length){
      list.appendChild(U.el('div',{class:'mm-sl-empty',text:I.t('cm.slEmpty','Brak zapisanych map.')}));
    } else {
      names.slice().reverse().forEach(name=>{
        const m=store[name];
        const item=U.el('div',{class:'mm-sl-item'});
        item.appendChild(U.el('div',{class:'mm-sl-item-ic',html:CM.icons.svg('layers',{size:18})}));
        const info=U.el('div',{class:'mm-sl-item-info'});
        info.appendChild(U.el('div',{class:'mm-sl-item-name',text:name}));
        const ago=m.ts?(U.relTime?U.relTime(m.ts):new Date(m.ts).toLocaleString()):'-';
        info.appendChild(U.el('div',{class:'mm-sl-item-meta',text:(m.nodes||[]).length+I.t('cm.slNodes',' węzłów · ')+ago}));
        item.appendChild(info);
        const del=U.el('button',{class:'mm-sl-item-del',title:I.t('cm.slDelete','Usuń'),html:CM.icons.svg('trash',{size:13})});
        del.onclick=(e)=>{ e.stopPropagation();
          // also drop the map's snapshot history — otherwise up to 40 full state copies leaked per delete
          try{ if(m.mapId) localStorage.removeItem('codemap_mm_snaps_'+m.mapId); }catch(_){}
          delete store[name]; localStorage.setItem(LS_KEY,JSON.stringify(store)); showSlModal(_slMode); };
        item.appendChild(del);
        item.addEventListener('click',(e)=>{ if(del.contains(e.target)) return;
          if(isSave && nameInp){ nameInp.value=name; nameInp.focus(); }
          else { load(m); U.toast(I.t('cm.toastLoadedPre','Wczytano „')+name+I.t('cm.toastLoadedPost','".'),'success'); hideSlModal(); }
        });
        list.appendChild(item);
      });
    }
    body.appendChild(list);
    box.appendChild(head); box.appendChild(body); _slModal.appendChild(box);
    _slModal.classList.remove('hidden');
    if(isSave && nameInp) setTimeout(()=>{ nameInp.focus(); nameInp.select(); },50);
  }
  function syncTitle(){ const t=document.querySelector('#mm-title'); if(t) t.value=state.name||''; }
  function load(m){ state.nodes=m.nodes||[]; state.edges=m.edges||[];
    // seq MUST clear every existing id — length+1 collided with ids after deletions (duplicate IDs)
    const maxId=(m.nodes||[]).reduce((mx,n)=>Math.max(mx, parseInt(String(n.id).slice(1))||0), 0);
    state.seq=Math.max(m.seq||0, maxId+1, 1); state.name=m.name||I.t('cm.defaultMindMap','Mapa myśli');
    // honor saved layout/line/spacing (older saves lack them → keep sane defaults)
    if(m.layout) state.layout=m.layout; if(m.line) state.line=m.line;
    if(m.spaceMain) state.spaceMain=m.spaceMain; if(m.spaceCross) state.spaceCross=m.spaceCross;
    if(CM.Draw&&CM.Draw.load) CM.Draw.load(m.draw||[]);
    state.mapId=m.mapId||('name_'+String(m.name||'default').replace(/[^\w]/g,'_').slice(0,40));   // stable id for snapshot history (back-compat for maps saved without one)
    selected=null; multi.clear(); _undo.length=0; _redo.length=0; refreshUndoBtns(); syncTitle(); render(); renderInspector(); fitView(); loadSnaps(); }
  function exportFile(){ U.download((state.name||I.t('cm.defaultFilename','mapa'))+'.mindmap.json', JSON.stringify({format:'codemap-mindmap', name:state.name, mapId:state.mapId, nodes:state.nodes, edges:state.edges, seq:state.seq,
    layout:state.layout, line:state.line, spaceMain:state.spaceMain, spaceCross:state.spaceCross,
    draw:(CM.Draw&&CM.Draw.serialize)?CM.Draw.serialize():[]}), 'application/json'); }

  // ---------- image export (SVG vector / PNG raster) ----------
  function wrapText(text, maxW, font){
    const cpl=Math.max(4, Math.floor(maxW/(font*0.56))); const out=[];
    for(const para of String(text).split('\n')){
      if(para.length<=cpl){ out.push(para); continue; }
      let line=''; for(const w of para.split(/\s+/)){ if((line+' '+w).trim().length>cpl){ if(line) out.push(line); line=w; } else line=(line?line+' ':'')+w; }
      if(line) out.push(line);
    }
    return out.length?out:[''];
  }
  function buildMMSvg(pad){
    pad=pad||60;
    const heights=new Map();
    for(const n of state.nodes){ const card=world&&world.querySelector(`[data-id="${n.id}"]`); heights.set(n.id, card?card.offsetHeight:60); }
    const H=(n)=>heights.get(n.id)||60;
    let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
    for(const n of state.nodes){ if(hiddenByCollapse(n))continue; minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+n.w);maxY=Math.max(maxY,n.y+H(n)); }
    // drawings extend the exported area too
    const db=(CM.Draw&&CM.Draw.bounds)?CM.Draw.bounds():null;
    if(db){ minX=Math.min(minX,db.minX); minY=Math.min(minY,db.minY); maxX=Math.max(maxX,db.maxX); maxY=Math.max(maxY,db.maxY); }
    if(minX>maxX){ minX=0;minY=0;maxX=300;maxY=200; }
    const W=Math.ceil(maxX-minX+pad*2), Ht=Math.ceil(maxY-minY+pad*2), vx=minX-pad, vy=minY-pad;
    const esc=(s)=>String(s).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const curved=state.line==='curved';
    const ept=(a,dir)=>{ const h=H(a),cx=a.x+a.w/2,cy=a.y+h/2; if(dir==='r')return{x:a.x+a.w,y:cy}; if(dir==='l')return{x:a.x,y:cy}; if(dir==='t')return{x:cx,y:a.y}; if(dir==='b')return{x:cx,y:a.y+h}; return{x:cx,y:cy}; };
    let edges='';
    const link=(from,to,col,wide)=>{ let d; if(curved){ const dx=Math.abs(to.x-from.x)*0.5; const horiz=Math.abs(to.x-from.x)>Math.abs(to.y-from.y);
        d=horiz?`M${from.x} ${from.y} C ${from.x+dx} ${from.y}, ${to.x-dx} ${to.y}, ${to.x} ${to.y}`:`M${from.x} ${from.y} C ${from.x} ${(from.y+to.y)/2}, ${to.x} ${(from.y+to.y)/2}, ${to.x} ${to.y}`; }
      else { const mx=(from.x+to.x)/2; d=`M${from.x} ${from.y} H ${mx} V ${to.y} H ${to.x}`; }
      edges+=`<path d="${d}" stroke="${col}" stroke-width="${wide?2.6:2}" fill="none" opacity="0.8" stroke-linecap="round" stroke-linejoin="round"/>`; };
    for(const n of state.nodes){ if(n.parent==null||hiddenByCollapse(n))continue; const p=nodeById(n.parent); if(!p||hiddenByCollapse(p))continue;
      const dir=state.layout; let pd='r',cd='l';
      if(dir==='radial'){pd='c';cd='c';} else if(dir==='left'){pd='l';cd='r';} else if(dir==='down'){pd='b';cd='t';} else if(dir==='up'){pd='t';cd='b';}
      else if(dir==='leftright'){const left=(n.x+n.w/2)<(p.x+p.w/2);pd=left?'l':'r';cd=left?'r':'l';}
      else if(dir==='free'){const horiz=Math.abs((n.x+n.w/2)-(p.x+p.w/2))>=Math.abs(n.y-p.y);pd=horiz?((n.x>p.x)?'r':'l'):((n.y>p.y)?'b':'t');cd=horiz?((n.x>p.x)?'l':'r'):((n.y>p.y)?'t':'b');}
      link(ept(p,pd),ept(n,cd), n.color||p.color, true); }
    for(const e of state.edges){ const a=nodeById(e.from),b=nodeById(e.to); if(!a||!b||hiddenByCollapse(a)||hiddenByCollapse(b))continue; link(ept(a,'c'),ept(b,'c'),'#94a3b8',false); }
    let body='';
    for(const n of state.nodes){ if(hiddenByCollapse(n))continue; const h=H(n), col=n.color||'#22d3ee', tpl=n.template||'card';
      let fill='#f3f6fb', tcol='#0a1018', stroke=col, sw=2, rx=12, center=false;
      if(tpl==='banner'){ fill=col; tcol='#fff'; stroke='none'; }
      else if(tpl==='sticky'){ fill=col; tcol='#101418'; stroke='none'; rx=3; }
      else if(tpl==='hexcard'){ fill=col; tcol='#0a1018'; stroke='none'; }
      else if(tpl==='pill'||tpl==='cloud'||tpl==='circle'){ fill='#fff'; rx=h/2; center=true; }
      else if(tpl==='code'||tpl==='frame'){ fill='#0d1320'; tcol='#cdd6e4'; }
      else if(tpl==='terminal'){ fill='#0a0e16'; tcol='#74f59a'; stroke='#1d2735'; rx=8; }
      else if(tpl==='neon'){ fill='#0c1322'; tcol='#eaf6ff'; stroke=col; rx=12; }
      else if(tpl==='tag'){ fill=col; tcol='#0a1018'; stroke='none'; rx=7; }
      else if(tpl==='diamond'){ fill=col; tcol='#0a1018'; stroke='none'; center=true; }
      // (quote falls through to the default white card + left colour bar below)
      if(tpl==='diamond'){ const cx=n.x+n.w/2, cy=n.y+h/2;
        body+=`<polygon points="${cx},${n.y} ${n.x+n.w},${cy} ${cx},${n.y+h} ${n.x},${cy}" fill="${fill}"/>`; }
      else body+=`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${h}" rx="${rx}" fill="${fill}"${stroke!=='none'?` stroke="${stroke}" stroke-width="${sw}"`:''}/>`;
      if(tpl==='card'||tpl==='quote') body+=`<rect x="${n.x}" y="${n.y}" width="5" height="${h}" rx="2" fill="${col}"/>`;
      const font=n.font||14, lines=wrapText(n.text||'', n.w-22, font), lh=font*1.32, ty0=n.y+h/2-(lines.length*lh)/2+font*0.9;
      lines.forEach((ln,i)=>{ body+=`<text x="${n.x+(center?n.w/2:14)}" y="${ty0+i*lh}" font-size="${font}" font-weight="600" fill="${tcol}" font-family="Inter,system-ui,sans-serif" text-anchor="${center?'middle':'start'}">${esc(ln)}</text>`; });
    }
    const bg=(getComputedStyle(document.body).getPropertyValue('--bg')||'').trim()||'#0b1018';
    const drawLayer=(CM.Draw&&CM.Draw.toSVG)?CM.Draw.toSVG():'';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Ht}" viewBox="${vx} ${vy} ${W} ${Ht}"><rect x="${vx}" y="${vy}" width="${W}" height="${Ht}" fill="${bg}"/>${edges}${body}${drawLayer}</svg>`;
    return {svg, w:W, h:Ht};
  }
  function exportImage(){
    if(!state.nodes.length){ U.toast&&U.toast(I.t('cm.toastEmptyExport','Mapa jest pusta — nie ma czego eksportować.'),'error'); return; }
    mmMenu([
      {ic:'image', t:I.t('cm.exportPng','Eksport PNG (2×)'), fn:()=>exportMM('png')},
      {ic:'download', t:I.t('cm.exportSvg','Eksport SVG (wektor)'), fn:()=>exportMM('svg')},
    ]);
  }
  function exportMM(kind){
    const {svg,w,h}=buildMMSvg(60); const base=(state.name||I.t('cm.defaultFilename','mapa')).replace(/[^\w.-]+/g,'_');
    if(kind==='svg'){ U.download(base+'.svg', svg, 'image/svg+xml'); U.toast&&U.toast(I.t('cm.toastSvgExported','Wyeksportowano SVG.'),'success'); return; }
    const scale=2, img=new Image(), url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    img.onload=()=>{ const c=document.createElement('canvas'); c.width=w*scale; c.height=h*scale; const ctx=c.getContext('2d'); ctx.scale(scale,scale); ctx.drawImage(img,0,0); URL.revokeObjectURL(url);
      c.toBlob(b=>{ if(!b){ U.toast&&U.toast(I.t('cm.toastPngError','Błąd eksportu PNG.'),'error'); return; } const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=base+'.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1500); U.toast&&U.toast(I.t('cm.toastPngExported','Wyeksportowano PNG.'),'success'); },'image/png'); };
    img.onerror=()=>{ URL.revokeObjectURL(url); U.toast&&U.toast(I.t('cm.toastSvgPngError','Błąd renderu SVG→PNG.'),'error'); };
    img.src=url;
  }
  function importFilePicker(){
    const inp=U.el('input',{type:'file',accept:'.json,.mindmap.json'}); inp.style.display='none'; document.body.appendChild(inp);
    inp.onchange=async()=>{ const f=inp.files[0]; if(f){ try{ const obj=JSON.parse(await f.text()); load(obj); U.toast(I.t('cm.toastImported','Zaimportowano mapę myśli.'),'success'); }catch(e){ U.toast(I.t('cm.toastImportError','Błąd importu.'),'error'); } } inp.remove(); };
    inp.click();
  }

  // ---------- Markdown / outline import + export ----------
  // small unified menu opened from the "Markdown" tool-rail button
  function markdownMenu(){
    mmMenu([
      {head:I.t('cm.mdMenuTitle','Markdown / konspekt')},
      {ic:'download', t:I.t('cm.mdExport','Eksport do Markdown (.md)'), fn:()=>exportMarkdown()},
      {ic:'upload', t:I.t('cm.mdImportPaste','Import — wklej tekst'), fn:()=>importMarkdownPaste()},
      {ic:'open', t:I.t('cm.mdImportFile','Import — plik .md'), fn:()=>importMarkdownFile()},
    ]);
  }
  // build the parent/child outline string from the current map
  function buildMarkdown(){
    const children=new Map(); state.nodes.forEach(n=>children.set(n.id,[]));
    const roots=[];
    state.nodes.forEach(n=>{ if(n.parent!=null && children.has(n.parent)) children.get(n.parent).push(n); else roots.push(n); });
    const out=[];
    const emit=(n,depth)=>{
      const txt=String(n.text==null?'':n.text).replace(/\r?\n/g,' ').trim()||I.t('cm.mdUntitled','(bez nazwy)');
      if(depth===0) out.push('# '+txt);
      else out.push('  '.repeat(depth-1)+'- '+txt);
      for(const c of children.get(n.id)) emit(c, depth+1);
    };
    roots.forEach(r=>emit(r,0));
    return out.join('\n')+'\n';
  }
  function exportMarkdown(){
    if(!state.nodes.length){ U.toast&&U.toast(I.t('cm.toastEmptyExport','Mapa jest pusta — nie ma czego eksportować.'),'error'); return; }
    const base=(state.name||I.t('cm.defaultFilename','mapa')).replace(/[^\w.-]+/g,'_');
    U.download(base+'.md', buildMarkdown(), 'text/markdown');
    U.toast&&U.toast(I.t('cm.toastMdExported','Wyeksportowano Markdown.'),'success');
  }
  // parse a Markdown outline into a flat list of {depth,text}; supports headings (#/##/###)
  // and indentation-based bullets (-, *, +, and numbered "1." style).
  function parseOutline(text){
    const items=[];
    const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n');
    for(let raw of lines){
      const line=raw.replace(/\s+$/,'');
      if(!line.trim()) continue;
      const head=line.match(/^(#{1,6})\s+(.*)$/);
      if(head){ items.push({depth:head[1].length-1, text:head[2].trim()}); continue; }
      const m=line.match(/^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$/);
      if(m){
        const indent=m[1].replace(/\t/g,'  ');
        const lvl=Math.floor(indent.length/2);   // 2 spaces per indent level
        items.push({depth:lvl+1, text:m[2].trim(), bullet:true});
        continue;
      }
      // plain (non-marker) line: treat indentation as depth, fallback root
      const pm=raw.match(/^([ \t]*)(.*)$/);
      const indent=(pm?pm[1]:'').replace(/\t/g,'  ');
      items.push({depth:Math.floor(indent.length/2), text:line.trim()});
    }
    return items;
  }
  // turn parsed outline into nodes with parent links + a tidy layout
  function importOutline(text){
    const items=parseOutline(text);
    if(!items.length){ U.toast&&U.toast(I.t('cm.toastMdEmpty','Brak treści do importu.'),'error'); return; }
    // normalise depths so the shallowest item becomes depth 0 (roots)
    let minDepth=1e9; for(const it of items) minDepth=Math.min(minDepth,it.depth);
    for(const it of items) it.depth-=minDepth;
    pushUndo();
    state.nodes=[]; state.edges=[]; selected=null; multi.clear(); state.mapId=null;
    const stack=[];   // stack[d] = last node created at depth d
    const PAL=['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b','#f472b6','#38bdf8','#a3e635'];
    items.forEach((it,i)=>{
      let d=it.depth;
      // clamp depth so a child is at most one level deeper than its would-be parent
      if(d>stack.length) d=stack.length;
      const parent = d>0 ? stack[d-1] : null;
      const tpl = d===0 ? 'banner' : (d===1 ? 'card' : 'note');
      const col = d===0 ? '#7c5cff' : PAL[d%PAL.length];
      const n=mk(d*260-200, i*64-120, {text:it.text||I.t('cm.mdUntitled','(bez nazwy)'), template:tpl, color:col, w:d===0?220:180, font:d===0?16:14, parent:parent?parent.id:null});
      if(parent) lk(parent, n);
      stack[d]=n; stack.length=d+1;
    });
    state.name=I.t('cm.mdImportedName','Zaimportowany konspekt'); syncTitle();
    _snaps=[];
    if(state.layout && state.layout!=='free') applyLayout(state.layout); else render();
    renderInspector(); hideSurround();
    setTimeout(fitView,20);
    U.toast&&U.toast(I.t('cm.toastMdImported','Zaimportowano konspekt.'),'success');
  }
  function importMarkdownPaste(){
    mmInput(I.t('cm.mdPasteTitle','Wklej konspekt Markdown'), '', {multiline:true, placeholder:I.t('cm.mdPastePlaceholder','# Temat\n- Punkt\n  - Podpunkt')}).then(v=>{
      if(v===null) return; if(!v.trim()){ U.toast&&U.toast(I.t('cm.toastMdEmpty','Brak treści do importu.'),'error'); return; }
      importOutline(v);
    });
  }
  function importMarkdownFile(){
    const inp=U.el('input',{type:'file',accept:'.md,.markdown,.txt,text/markdown,text/plain'}); inp.style.display='none'; document.body.appendChild(inp);
    inp.onchange=async()=>{ const f=inp.files[0]; if(f){ try{ importOutline(await f.text()); }catch(e){ U.toast&&U.toast(I.t('cm.toastImportError','Błąd importu.'),'error'); } } inp.remove(); };
    inp.click();
  }

  // ---------- snapshot evolution ----------
  // snapshots are keyed by a STABLE per-map id (not the editable title) so renaming the map mid-edit
  // never orphans its history; older maps saved without an id fall back to a name-derived key.
  function ensureMapId(){ if(!state.mapId) state.mapId='m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); return state.mapId; }
  const SNAP_LS=()=>'codemap_mm_snaps_'+ensureMapId();
  function saveSnaps(){ try{ localStorage.setItem(SNAP_LS(),JSON.stringify(_snaps.slice(-40))); }catch(e){} }
  function loadSnaps(){ try{ const raw=localStorage.getItem(SNAP_LS()); _snaps=raw?JSON.parse(raw):[]; }catch(e){ _snaps=[]; } updateTimeline(); }
  function takeSnap(reason){
    if(!state.nodes.length) return;
    const s={ts:Date.now(),reason:reason||'auto',nodes:JSON.parse(JSON.stringify(state.nodes)),edges:JSON.parse(JSON.stringify(state.edges)),name:state.name,layout:state.layout,line:state.line,
      seq:state.seq, draw:(CM.Draw&&CM.Draw.serialize)?CM.Draw.serialize():[]};
    // Avoid duplicate consecutive snaps (same node count + same first node position)
    const last=_snaps[_snaps.length-1];
    if(last && Math.abs(last.ts-s.ts)<3000 && last.nodes.length===s.nodes.length) return;
    _snaps.push(s); if(_snaps.length>40) _snaps.shift(); saveSnaps(); updateTimeline();
  }
  function autoSnap(reason){ clearTimeout(_snapTimer); _snapTimer=setTimeout(()=>takeSnap(reason),8000); }
  function computeSnapDiff(a,b){
    const am=new Map(a.map(n=>[n.id,n])), bm=new Map(b.map(n=>[n.id,n]));
    return { added:b.filter(n=>!am.has(n.id)), removed:a.filter(n=>!bm.has(n.id)), changed:b.filter(n=>{ const o=am.get(n.id); return o&&(o.x!==n.x||o.y!==n.y||o.text!==n.text||o.color!==n.color||o.template!==n.template); }) };
  }
  function restoreSnap(idx){
    const snap=_snaps[idx]; if(!snap) return;
    const diff=computeSnapDiff(state.nodes, snap.nodes);
    pushUndo();
    state.nodes=JSON.parse(JSON.stringify(snap.nodes)); state.edges=JSON.parse(JSON.stringify(snap.edges));
    if(snap.layout) state.layout=snap.layout; if(snap.line) state.line=snap.line;
    // seq must never fall behind existing ids (duplicate-ID bug after restoring an old snapshot)
    const mx=state.nodes.reduce((m,n)=>Math.max(m, parseInt(String(n.id).slice(1))||0), 0);
    state.seq=Math.max(snap.seq||0, state.seq||0, mx+1);
    if(CM.Draw&&CM.Draw.load) CM.Draw.load(snap.draw||[]);
    selected=null; multi.clear(); render(); renderInspector(); hideSurround();
    // Animate diff
    setTimeout(()=>{
      diff.added.forEach(n=>{ const c=world&&world.querySelector('[data-id="'+n.id+'"]'); if(c) c.classList.add('mm-snap-added'); });
      diff.changed.forEach(n=>{ const c=world&&world.querySelector('[data-id="'+n.id+'"]'); if(c) c.classList.add('mm-snap-changed'); });
      setTimeout(()=>{ document.querySelectorAll('.mm-snap-added,.mm-snap-changed').forEach(c=>c.classList.remove('mm-snap-added','mm-snap-changed')); },900);
    },30);
    const ago=U.relTime?U.relTime(snap.ts):new Date(snap.ts).toLocaleTimeString();
    U.toast&&U.toast('Przywrócono migawkę z '+ago+' ('+diff.added.length+' nowych, '+diff.changed.length+' zmienionych, '+diff.removed.length+' usuniętych)','',2800);
    updateTimeline();
  }
  function buildTimeline(){
    _timelineEl=U.el('div',{id:'mm-timeline'});
    const btn=U.el('button',{id:'mm-tl-toggle',title:'Historia migawek (snapshots)'});
    btn.innerHTML=CM.icons.svg('clock',{size:15})+'<span>&nbsp;Historia</span>';
    btn.onclick=()=>{ btn.classList.toggle('open'); updateTimeline(); };
    const track=U.el('div',{id:'mm-tl-track'});
    _timelineEl.appendChild(btn); _timelineEl.appendChild(track); canvas.appendChild(_timelineEl);
  }
  function updateTimeline(){
    if(!_timelineEl) return;
    const btn=_timelineEl.querySelector('#mm-tl-toggle');
    const track=_timelineEl.querySelector('#mm-tl-track');
    if(!track||!btn) return;
    if(!btn.classList.contains('open')){ track.style.display='none'; return; }
    track.style.display='flex'; track.innerHTML='';
    if(!_snaps.length){ track.innerHTML='<span class="mm-tl-empty">Brak migawek — zapisz lub wczytaj mapę, aby zacząć śledzić historię.</span>'; return; }
    // Show newest first
    for(let i=_snaps.length-1;i>=0;i--){
      const s=_snaps[i];
      const b=U.el('button',{class:'mm-tl-snap'+(i===_snaps.length-1?' current':'')});
      const ago=U.relTime?U.relTime(s.ts):new Date(s.ts).toLocaleTimeString();
      b.innerHTML='<span class="mm-tl-dot"></span><span class="mm-tl-age">'+ago+'</span><span class="mm-tl-info">'+s.nodes.length+' węzłów</span>'+(s.reason&&s.reason!=='auto'?'<span class="mm-tl-reason">'+s.reason+'</span>':'');
      b.onclick=(()=>{ const idx=i; return ()=>restoreSnap(idx); })();
      track.appendChild(b);
    }
    // Add "Take snapshot now" button
    const nb=U.el('button',{class:'mm-tl-snap',style:'border-color:var(--accent);background:rgba(34,211,238,.1)'});
    nb.innerHTML='<span style="color:var(--accent)">'+CM.icons.svg('plus',{size:13})+'</span><span class="mm-tl-age">Teraz</span><span class="mm-tl-info">migawka</span>';
    nb.onclick=()=>{ takeSnap('ręczna'); U.toast&&U.toast('Migawka zapisana.','success',1500); };
    track.appendChild(nb);
  }

  // ---------- lifecycle ----------
  function activate(){ ensureDom(); active=true; root.classList.remove('hidden');
    const r=canvas.getBoundingClientRect(); if(!cam.x&&!cam.y){ cam={x:r.width/2,y:r.height/2,zoom:1}; }
    if(!state.nodes.length){ showLayoutDialog('tpl'); }   // first time -> pick a template
    loadSnaps();
    setTimeout(()=>{ render(); drawEdges(); },30);
  }
  function deactivate(){ if(root){ root.classList.add('hidden'); }
    // close the draw bar too — its capture-phase keydown (V/P/R/…/Ctrl+Z) stays live while `open`
    // is true, so leaving MindMap without this would hijack shortcuts in CodeMap mode.
    if(CM.Draw && CM.Draw.isOpen && CM.Draw.isOpen()) CM.Draw.toggle(false);
    active=false; }
  function isActive(){ return active; }

  // re-evaluate the label fields of the static data tables for the current language
  function relocalizeData(){
    // (template labels are resolved live via tplName(t) at render — no relocalization needed here)
    const DIA={
      mindmap:['cm.diagMindmap','Mapa myśli','cm.diagMindmapDesc','Rozgałęziona struktura — burza mózgów i porządkowanie pomysłów.'],
      outline:['cm.diagOutline','Konspekt','cm.diagOutlineDesc','Hierarchiczny układ punktów — planowanie i analiza.'],
      timeline:['cm.diagTimeline','Oś czasu','cm.diagTimelineDesc','Zdarzenia chronologicznie — postęp projektu lub historia.'],
      table:['cm.diagTable','Tabela','cm.diagTableDesc','Dane w wierszach i kolumnach — analiza porównawcza.'],
      flowchart:['cm.diagFlowchart','Schemat blokowy','cm.diagFlowchartDesc','Procesy i decyzje — kroki i przepływy.'],
      fishbone:['cm.diagFishbone','Diagram Ishikawy','cm.diagFishboneDesc','Analiza przyczyn źródłowych (rybi szkielet).'],
      sixhats:['cm.diagSixhats','Sześć kapeluszy','cm.diagSixhatsDesc','Myślenie z wielu perspektyw — decyzje zespołowe.'],
      swot:['cm.diagSwot','Analiza SWOT','cm.diagSwotDesc','Mocne/słabe strony, szanse i zagrożenia.'],
      chat:['cm.diagChat','Dymki rozmowy','cm.diagChatDesc','Scenariusze rozmów — odgrywanie ról i dyskusje.'],
      radial:['cm.diagRadial','Diagram radialny','cm.diagRadialDesc','Elementy promieniście od centralnego punktu.'],
      umlclass:['cm.diagUmlclass','UML — diagram klas','cm.diagUmlclassDesc','Struktura klas: atrybuty, metody, relacje.'],
      umlusecase:['cm.diagUmlusecase','UML — przypadki użycia','cm.diagUmlusecaseDesc','Aktorzy i przypadki użycia systemu.'],
      umlsequence:['cm.diagUmlsequence','UML — sekwencja','cm.diagUmlsequenceDesc','Sekwencja komunikatów między obiektami.'],
      bpmn:['cm.diagBpmn','BPMN','cm.diagBpmnDesc','Standaryzowany zapis procesów biznesowych.'],
      gantt:['cm.diagGantt','Gantt','cm.diagGanttDesc','Postęp zadań na osi czasu — zarządzanie projektem.'],
      carddeck:['cm.diagCarddeck','Talia kart','cm.diagCarddeckDesc','Fiszki do powtórek i porządkowania wiedzy.'],
      kanban:['cm.diagKanban','Kanban','cm.diagKanbanDesc','Tablica zadań: Do zrobienia · W toku · Zrobione.'],
      decision:['cm.diagDecision','Drzewo decyzyjne','cm.diagDecisionDesc','Pytania tak/nie prowadzące do wyników.'],
      okr:['cm.diagOkr','OKR','cm.diagOkrDesc','Cel (Objective) i mierzalne rezultaty kluczowe.'],
      roadmap:['cm.diagRoadmap','Roadmapa','cm.diagRoadmapDesc','Plan kwartalny Q1–Q4 z kamieniami milowymi.'],
      orgchart:['cm.diagOrgchart','Organigram','cm.diagOrgchartDesc','Hierarchia organizacji — od góry w dół.'],
      proscons:['cm.diagProscons','Za i przeciw','cm.diagProsconsDesc','Zestawienie argumentów za i przeciw.'],
      conceptmap:['cm.diagConceptmap','Mapa pojęć','cm.diagConceptmapDesc','Pojęcia połączone opisanymi relacjami.'],
      empathy:['cm.diagEmpathy','Mapa empatii','cm.diagEmpathyDesc','Co użytkownik myśli, czuje, widzi, mówi i robi.'],
      bmc:['cm.diagBmc','Business Model Canvas','cm.diagBmcDesc','Dziewięć bloków modelu biznesowego.'],
      storymap:['cm.diagStorymap','Mapa historyjek','cm.diagStorymapDesc','Aktywności, kroki i historyjki użytkownika.'],
      affinity:['cm.diagAffinity','Diagram pokrewieństwa','cm.diagAffinityDesc','Grupowanie pomysłów w tematyczne klastry.'],
      venn:['cm.diagVenn','Diagram Venna','cm.diagVennDesc','Nakładające się zbiory i ich część wspólna.'],
      pyramid:['cm.diagPyramid','Piramida','cm.diagPyramidDesc','Hierarchia poziomów — np. piramida Maslowa.'],
      funnel:['cm.diagFunnel','Lejek','cm.diagFunnelDesc','Zwężające się etapy konwersji.'],
      pert:['cm.diagPert','Sieć PERT','cm.diagPertDesc','Sieć zależności zadań w projekcie.'],
      fivewhys:['cm.diagFivewhys','5 × Dlaczego','cm.diagFivewhysDesc','Drążenie przyczyny źródłowej pytaniami „dlaczego?".'],
      radar:['cm.diagRadar','Radar / pajęczyna','cm.diagRadarDesc','Porównanie cech na osiach promienistych.'],
      valuechain:['cm.diagValuechain','Łańcuch wartości','cm.diagValuechainDesc','Działania podstawowe i wspierające (Porter).'],
    };
    DIAGRAMS.forEach(d=>{ const r=DIA[d.k]; if(r){ d.name=I.t(r[0],r[1]); d.desc=I.t(r[2],r[3]); } });
    DIRS[0][1]=I.t('cm.dirUp','W górę'); DIRS[1][1]=I.t('cm.dirDown','W dół'); DIRS[2][1]=I.t('cm.dirUpdown','Góra-Dół');
    DIRS[3][1]=I.t('cm.dirLeft','W lewo'); DIRS[4][1]=I.t('cm.dirRight','W prawo'); DIRS[5][1]=I.t('cm.dirLeftright','Lewo-Prawo');
    LINES[0][1]=I.t('cm.lineFree','Dowolny (ręczny)'); LINES[0][2]=I.t('cm.lineFreeDesc','Pozycje ustawiasz ręcznie.');
    LINES[1][1]=I.t('cm.lineCurved','Drzewo — linie krzywe'); LINES[1][2]=I.t('cm.lineCurvedDesc','Płynne, zaokrąglone połączenia.');
    LINES[2][1]=I.t('cm.lineStraight','Drzewo — linie proste'); LINES[2][2]=I.t('cm.lineStraightDesc','Kątowe połączenia ortogonalne.');
    LINES[3][1]=I.t('cm.lineRadial','Radialny (gwiazda)'); LINES[3][2]=I.t('cm.lineRadialDesc','Gałęzie promieniście wokół centrum.');
    LINES[4][1]=I.t('cm.lineOrg','Organigram'); LINES[4][2]=I.t('cm.lineOrgDesc','Hierarchia od góry, proste linie.');
    LINES[5][1]=I.t('cm.lineHoriz','Drzewo poziome'); LINES[5][2]=I.t('cm.lineHorizDesc','Schludne drzewo rosnące w prawo (left-right tidy).');
    LINES[6][1]=I.t('cm.lineTimeaxis','Oś czasu (pozioma)'); LINES[6][2]=I.t('cm.lineTimeaxisDesc','Węzły ułożone wzdłuż poziomej osi.');
    LINES[7][1]=I.t('cm.lineSpiral','Spirala'); LINES[7][2]=I.t('cm.lineSpiralDesc','Węzły rozwijające się spiralnie od centrum.');
    LINES[8][1]=I.t('cm.lineGrid','Siatka'); LINES[8][2]=I.t('cm.lineGridDesc','Równa siatka wierszy i kolumn.');
    LINES[9][1]=I.t('cm.lineLayers','Warstwy (góra-dół)'); LINES[9][2]=I.t('cm.lineLayersDesc','Poziomy hierarchii jako schodkowe pasy.');
    LINES[10][1]=I.t('cm.lineFishbone','Fishbone (rybi szkielet)'); LINES[10][2]=I.t('cm.lineFishboneDesc','Ości przyczyn wzdłuż centralnego kręgosłupa.');
  }

  // rebuild visible MindMap UI when the interface language changes
  try{ I.onChange(()=>{
    relocalizeData();
    if(!built) return;                               // nothing rendered yet
    // re-localize the MindMap chrome even when it's built but currently hidden (the user may switch
    // language while in CodeMap mode) — otherwise the tool rail / inspector keep the old language.
    const toolsEl=document.getElementById('mm-tools'); if(toolsEl) fillTools(toolsEl);
    const titleIn=document.getElementById('mm-title'); if(titleIn) titleIn.title=I.t('cm.titleInput','Nazwa mapy myśli');
    closePop();                                       // drop any open popover/menu (would be stale)
    renderInspector();                                // right panel rebuilds safely
    if(layoutDlg && !layoutDlg.classList.contains('hidden') && layoutDlg._render) layoutDlg._render();
    if(document.body.classList.contains('mode-mindmap') && selected) showSurround(selected);
  }); }catch(e){}

  // ---- public state I/O (used by CM.Drive — Sejf / Dysk) ----
  function exportState(){ return JSON.parse(mmSnap()); }
  function importState(o){ try{ pushUndo(); }catch(e){} mmRestore(typeof o==='string'?o:JSON.stringify(o)); setTimeout(fitView,30); }
  function mapName(){ return state.name||I.t('cm.defaultMapName','Mapa myśli'); }
  function nodeCount(){ return state.nodes.length; }

  return { activate, deactivate, isActive, exportState, importState, mapName, nodeCount,
    _build:buildDiagram, _diags:()=>DIAGRAMS.map(d=>({k:d.k,name:d.name})), _tpls:()=>TEMPLATES.map(t=>t.k), _state:()=>state };
})();
