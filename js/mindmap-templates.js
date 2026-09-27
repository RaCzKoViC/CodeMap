/* ===================== mindmap-templates.js — szablony kart i typy diagramów MindMap =====================
   CM.MindMapTemplates — dane i generatory bez stanu edytora: 16 ramek kart (klasy mm-tpl-<k>), paleta
   kolorów i palety schematów, 34 startowe diagramy (build → węzły/krawędzie w podanym kontekście
   {nodes, edges, seq} — stan mapy albo obiekt testowy), miniatury SVG diagramów oraz widok karty
   „kod” (wykrywanie języka, podświetlanie, numeracja linii, kopiowanie). Etykiety: CM.MindMapStrings. */
CM.MindMapTemplates = (function(){
  const U = CM.util, I = CM.i18n, S = CM.MindMapStrings;

  // ramki kart w kolejności wyboru (etykiety rozwiązywane przy renderze → nadążają za zmianą języka)
  const FRAMES=['card','note','sticky','cloud','banner','pill','callout','code','frame','hexcard','circle','diamond','terminal','tag','quote','neon'];
  const frameName=(k)=>S.frame(k);
  // paleta kolorów węzłów (inspektor, szybki kolor, diagramy)
  const COLORS=['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b','#f472b6','#38bdf8','#a3e635','#e2e8f4','#f87171'];
  // palety schematu kolorów: [0] korzeń, kolejne — gałęzie korzenia
  const SCHEMA_PALETTES={
    ocean:['#22d3ee','#38bdf8','#7c5cff','#34d399','#2dd4bf','#60a5fa'],
    sunset:['#fb7185','#f59e0b','#f472b6','#fbbf24','#fca5a5','#c084fc'],
    forest:['#34d399','#a3e635','#22d3ee','#4ade80','#84cc16','#2dd4bf'],
    mono:['#94a3b8','#cbd5e1','#64748b','#e2e8f4','#7d8aa0','#aebacb'],
  };

  // mk / lk dopisują węzły i krawędzie do ctx.nodes / ctx.edges; id z licznika ctx.seq (jak w stanie mapy)
  function builder(ctx){
    return {
      nodes: ctx.nodes,
      mk(x,y,opts){ const n=Object.assign({id:'n'+(ctx.seq++),x,y,w:160,text:'',template:'card',color:'#22d3ee',font:14},opts); ctx.nodes.push(n); return n; },
      lk(a,b){ if(a&&b) ctx.edges.push({from:a.id,to:b.id}); },
    };
  }

  // ---- startowe typy diagramów (jak MindDump / Mapify), zbudowane z systemu kart ----
  const DIAGRAMS=[
    {k:'mindmap', icon:'layers', build({mk,lk}){
      const c=mk(-100,-34,{text:I.t('cm.diagMindmapTopic','Temat główny'),template:'banner',color:'#7c5cff',w:200,font:18});
      const branches=[[I.t('cm.diagMindmapIdea1','Pomysł 1'),'#22d3ee'],[I.t('cm.diagMindmapIdea2','Pomysł 2'),'#34d399'],[I.t('cm.diagMindmapIdea3','Pomysł 3'),'#fb7185'],[I.t('cm.diagMindmapIdea4','Pomysł 4'),'#f59e0b'],[I.t('cm.diagMindmapIdea5','Pomysł 5'),'#38bdf8'],[I.t('cm.diagMindmapIdea6','Pomysł 6'),'#f472b6']];
      const R=310; branches.forEach(([t,col],i)=>{ const a=(i/branches.length)*Math.PI*2-Math.PI*0.1; const n=mk(Math.cos(a)*R-80,Math.sin(a)*R-26,{text:t,template:'card',color:col,w:155,parent:c.id}); lk(c,n); const sub=mk(n.x+(i%2?60:-60),n.y+90,{text:'Podpomysł',template:'note',color:col,w:130,font:12,parent:n.id}); lk(n,sub); }); } },
    {k:'outline', icon:'file', build({mk,lk}){
      const t=mk(0,-260,{text:I.t('cm.diagOutlineTitle','Tytuł dokumentu'),template:'banner',color:'#22d3ee',w:240,font:18}); let prev=t;
      [[I.t('cm.diagOutline1','1. Wstęp'),0],[I.t('cm.diagOutline11','1.1 Kontekst'),40],[I.t('cm.diagOutline2','2. Rozwinięcie'),0],[I.t('cm.diagOutline21','2.1 Punkt A'),40],[I.t('cm.diagOutline22','2.2 Punkt B'),40],[I.t('cm.diagOutline3','3. Podsumowanie'),0]].forEach((r,i)=>{
        const n=mk(r[1],-180+i*70,{text:r[0],template:'note',color:'#34d399',w:230,font:13}); lk(t,n); }); } },
    {k:'timeline', icon:'clock', build({mk,lk}){
      const ev=[I.t('cm.diagTimelineStart','Start'),I.t('cm.diagTimelineStage1','Etap 1'),I.t('cm.diagTimelineStage2','Etap 2'),I.t('cm.diagTimelineStage3','Etap 3'),I.t('cm.diagTimelineGoal','Meta')]; let prev=null;
      ev.forEach((t,i)=>{ const n=mk(i*240-480,0,{text:t,template:'pill',color:COLORS[i%COLORS.length],w:150}); if(prev)lk(prev,n); prev=n; }); } },
    {k:'table', icon:'grid', build({mk,lk}){
      const cols=[I.t('cm.diagTableColA','Kolumna A'),I.t('cm.diagTableColB','Kolumna B'),I.t('cm.diagTableColC','Kolumna C')];
      cols.forEach((t,c)=>mk(c*180-260,-120,{text:t,template:'banner',color:'#38bdf8',w:160,font:13}));
      for(let r=0;r<3;r++) for(let c=0;c<3;c++) mk(c*180-260,-40+r*70,{text:'—',template:'frame',color:'#46597a',w:160,font:13}); } },
    {k:'flowchart', icon:'flow', build({mk,lk}){
      const s=mk(-80,-260,{text:I.t('cm.diagFlowchartStart','Start'),template:'pill',color:'#34d399',w:130});
      const p=mk(-90,-150,{text:I.t('cm.diagFlowchartProcess','Proces'),template:'card',color:'#22d3ee',w:150});
      const d=mk(-95,-30,{text:I.t('cm.diagFlowchartDecision','Decyzja?'),template:'hexcard',color:'#f59e0b',w:160});
      const y=mk(-260,110,{text:I.t('cm.diagFlowchartYes','Tak → akcja'),template:'card',color:'#34d399',w:150});
      const n=mk(110,110,{text:I.t('cm.diagFlowchartNo','Nie → akcja'),template:'card',color:'#fb7185',w:150});
      const e=mk(-80,230,{text:I.t('cm.diagFlowchartEnd','Koniec'),template:'pill',color:'#7c5cff',w:130});
      lk(s,p);lk(p,d);lk(d,y);lk(d,n);lk(y,e);lk(n,e); } },
    {k:'fishbone', icon:'flow', build({mk,lk}){
      const head=mk(360,-30,{text:I.t('cm.diagFishboneProblem','Problem'),template:'banner',color:'#fb7185',w:160,font:16});
      const bones=[I.t('cm.diagFishbonePeople','Ludzie'),I.t('cm.diagFishboneMethods','Metody'),I.t('cm.diagFishboneMachines','Maszyny'),I.t('cm.diagFishboneMaterials','Materiały'),I.t('cm.diagFishboneMeasurement','Pomiar'),I.t('cm.diagFishboneEnvironment','Środowisko')];
      bones.forEach((t,i)=>{ const side=i%2?1:-1, idx=Math.floor(i/2); const n=mk(idx*180-260, side*170,{text:t,template:'card',color:COLORS[i%COLORS.length],w:150}); lk(n,head); }); } },
    {k:'sixhats', icon:'target', build({mk,lk}){
      const hats=[[I.t('cm.diagSixhatsWhite','Biały — fakty'),'#e2e8f4'],[I.t('cm.diagSixhatsRed','Czerwony — emocje'),'#fb7185'],[I.t('cm.diagSixhatsBlack','Czarny — ryzyka'),'#334155'],[I.t('cm.diagSixhatsYellow','Żółty — korzyści'),'#f59e0b'],[I.t('cm.diagSixhatsGreen','Zielony — kreatywność'),'#34d399'],[I.t('cm.diagSixhatsBlue','Niebieski — proces'),'#38bdf8']];
      hats.forEach((h,i)=>mk((i%3)*230-330, Math.floor(i/3)*120-60,{text:h[0],template:'card',color:h[1],w:200,font:14})); } },
    {k:'swot', icon:'grid', build({mk,lk}){
      const title=mk(-115,-280,{text:'SWOT',template:'banner',color:'#7c5cff',w:230,font:20});
      const s=mk(-290,-160,{text:I.t('cm.diagSwotS','💪 Mocne strony'),template:'frame',color:'#34d399',w:250,font:14,parent:title.id});
      const w=mk(20,-160,{text:I.t('cm.diagSwotW','⚠️ Słabe strony'),template:'frame',color:'#fb7185',w:250,font:14,parent:title.id});
      const o=mk(-290,60,{text:I.t('cm.diagSwotO','🚀 Szanse'),template:'frame',color:'#38bdf8',w:250,font:14,parent:title.id});
      const t=mk(20,60,{text:I.t('cm.diagSwotT','🛡️ Zagrożenia'),template:'frame',color:'#f59e0b',w:250,font:14,parent:title.id});
      lk(title,s);lk(title,w);lk(title,o);lk(title,t);
      for(let i=0;i<3;i++){ mk(s.x+16,s.y+70+i*56,{text:'+ Punkt '+(i+1),template:'note',color:'#34d399',w:220,font:12,parent:s.id}); }
      for(let i=0;i<3;i++){ mk(w.x+16,w.y+70+i*56,{text:'- Punkt '+(i+1),template:'note',color:'#fb7185',w:220,font:12,parent:w.id}); }
    } },
    {k:'chat', icon:'copy', build({mk,lk}){
      [I.t('cm.diagChat1','Cześć! O czym dziś?'),I.t('cm.diagChat2','Chciałbym omówić plan…'),I.t('cm.diagChat3','Świetnie, zacznijmy od celu.'),I.t('cm.diagChat4','Cel: zwiększyć zasięg.')].forEach((t,i)=>{
        const side=i%2?1:-1; mk(side*140-90, i*100-150,{text:t,template:'callout',color:i%2?'#7c5cff':'#22d3ee',w:200,font:13}); }); } },
    {k:'radial', icon:'crosshair', build({mk,lk}){
      const c=mk(-70,-30,{text:I.t('cm.diagRadialCenter','Centrum'),template:'hexcard',color:'#f472b6',w:150,font:16});
      const R=300; for(let i=0;i<8;i++){ const a=(i/8)*Math.PI*2; const n=mk(Math.cos(a)*R-70,Math.sin(a)*R-26,{text:I.t('cm.diagRadialElement','Element ')+(i+1),template:'pill',color:COLORS[i%COLORS.length],w:140}); lk(c,n); } } },
    {k:'umlclass', icon:'box', build({mk,lk}){
      const a=mk(-340,-80,{text:I.t('cm.diagUmlclassA','Klasa A\n— pole: typ\n+ metoda()'),template:'frame',color:'#22d3ee',w:200,font:12});
      const b=mk(-40,-80,{text:I.t('cm.diagUmlclassB','Klasa B\n— pole: typ\n+ metoda()'),template:'frame',color:'#7c5cff',w:200,font:12});
      const c=mk(160,120,{text:I.t('cm.diagUmlclassC','Klasa C\n+ metoda()'),template:'frame',color:'#34d399',w:200,font:12});
      lk(a,b);lk(b,c); } },
    {k:'umlusecase', icon:'eye', build({mk,lk}){
      const act=mk(-360,-20,{text:I.t('cm.diagUmlusecaseActor','👤 Aktor'),template:'sticky',color:'#f59e0b',w:120,font:14});
      const u1=mk(-120,-120,{text:I.t('cm.diagUmlusecaseLogin','Logowanie'),template:'cloud',color:'#22d3ee',w:170});
      const u2=mk(-120,0,{text:I.t('cm.diagUmlusecaseBrowse','Przeglądanie'),template:'cloud',color:'#38bdf8',w:170});
      const u3=mk(-120,120,{text:I.t('cm.diagUmlusecasePurchase','Zakup'),template:'cloud',color:'#34d399',w:170});
      lk(act,u1);lk(act,u2);lk(act,u3); } },
    {k:'umlsequence', icon:'layers', build({mk,lk}){
      const a=mk(-300,-200,{text:I.t('cm.diagUmlsequenceUser',':Użytkownik'),template:'banner',color:'#22d3ee',w:160,font:13});
      const b=mk(0,-200,{text:I.t('cm.diagUmlsequenceSystem',':System'),template:'banner',color:'#7c5cff',w:160,font:13});
      const c=mk(300,-200,{text:I.t('cm.diagUmlsequenceDb',':Baza'),template:'banner',color:'#34d399',w:160,font:13});
      const m1=mk(-160,-90,{text:I.t('cm.diagUmlsequenceMsg1','1: żądanie →'),template:'note',color:'#46597a',w:200,font:12});
      const m2=mk(140,30,{text:I.t('cm.diagUmlsequenceMsg2','2: zapytanie →'),template:'note',color:'#46597a',w:200,font:12});
      lk(a,b);lk(b,c); } },
    {k:'bpmn', icon:'flow', build({mk,lk}){
      const s=mk(-440,-26,{text:I.t('cm.diagBpmnStart','● Start'),template:'pill',color:'#34d399',w:120});
      const t1=mk(-280,-30,{text:I.t('cm.diagBpmnTask1','Zadanie 1'),template:'card',color:'#22d3ee',w:150});
      const g=mk(-100,-34,{text:I.t('cm.diagBpmnGateway','◇ Bramka'),template:'hexcard',color:'#f59e0b',w:150});
      const t2=mk(90,-30,{text:I.t('cm.diagBpmnTask2','Zadanie 2'),template:'card',color:'#38bdf8',w:150});
      const e=mk(280,-26,{text:I.t('cm.diagBpmnEnd','◉ Koniec'),template:'pill',color:'#fb7185',w:120});
      lk(s,t1);lk(t1,g);lk(g,t2);lk(t2,e); } },
    {k:'gantt', icon:'layers', build({mk,lk}){
      const tasks=[[I.t('cm.diagGanttTaskA','Zadanie A'),0,200],[I.t('cm.diagGanttTaskB','Zadanie B'),120,260],[I.t('cm.diagGanttTaskC','Zadanie C'),300,180],[I.t('cm.diagGanttTaskD','Zadanie D'),420,220]];
      mk(-260,-150,{text:I.t('cm.diagGanttSchedule','Harmonogram'),template:'banner',color:'#7c5cff',w:240,font:16});
      tasks.forEach((t,i)=>mk(t[1]-260,-70+i*60,{text:t[0],template:'pill',color:COLORS[i%COLORS.length],w:t[2],font:13})); } },
    {k:'carddeck', icon:'copy', build({mk,lk}){
      [I.t('cm.diagCarddeck1','Pojęcie 1'),I.t('cm.diagCarddeck2','Pojęcie 2'),I.t('cm.diagCarddeck3','Pojęcie 3'),I.t('cm.diagCarddeck4','Pojęcie 4')].forEach((t,i)=>mk(i*40-80,i*16-40,{text:t+I.t('cm.diagCarddeckHint','\n(kliknij, aby edytować)'),template:'sticky',color:COLORS[i%COLORS.length],w:180,font:14})); } },
    {k:'kanban', icon:'grid', build({mk,lk}){
      const cols=[[I.t('cm.diagKanbanTodo','📋 Do zrobienia'),'#38bdf8'],[I.t('cm.diagKanbanDoing','⚙️ W toku'),'#f59e0b'],[I.t('cm.diagKanbanDone','✅ Zrobione'),'#34d399']];
      const tasks=[['Zadanie A','Zadanie B','Zadanie C'],['Zadanie D','Zadanie E'],['Zadanie F','Zadanie G']];
      cols.forEach((cl,ci)=>{ const h=mk(ci*270-380,-220,{text:cl[0],template:'banner',color:cl[1],w:230,font:15});
        tasks[ci].forEach((t,ri)=>{ const n=mk(ci*270-380,-140+ri*86,{text:t,template:'sticky',color:cl[1],w:230,font:13,parent:h.id}); lk(h,n); }); }); } },
    {k:'decision', icon:'flow', build({mk,lk}){
      const q=mk(-85,-240,{text:I.t('cm.diagDecisionQ','Decyzja?'),template:'hexcard',color:'#f59e0b',w:170,font:15});
      const y=mk(-330,-90,{text:I.t('cm.diagDecisionYes','Tak'),template:'pill',color:'#34d399',w:120}); const no=mk(170,-90,{text:I.t('cm.diagDecisionNo','Nie'),template:'pill',color:'#fb7185',w:120});
      const y1=mk(-400,90,{text:I.t('cm.diagDecisionResultA','Wynik A'),template:'card',color:'#22d3ee',w:160}); const y2=mk(-210,90,{text:I.t('cm.diagDecisionResultB','Wynik B'),template:'card',color:'#7c5cff',w:160});
      const n1=mk(120,90,{text:I.t('cm.diagDecisionResultC','Wynik C'),template:'card',color:'#38bdf8',w:160});
      lk(q,y);lk(q,no);lk(y,y1);lk(y,y2);lk(no,n1); } },
    {k:'okr', icon:'target', build({mk,lk}){
      const o=mk(-130,-180,{text:I.t('cm.diagOkrObjective','Cel: wpisz cel'),template:'banner',color:'#7c5cff',w:260,font:16});
      [I.t('cm.diagOkrKr1','KR1: metryka → wartość'),I.t('cm.diagOkrKr2','KR2: metryka → wartość'),I.t('cm.diagOkrKr3','KR3: metryka → wartość')].forEach((t,i)=>{ const n=mk(-150,-70+i*82,{text:t,template:'frame',color:'#34d399',w:300,font:13}); lk(o,n); }); } },
    {k:'roadmap', icon:'clock', build({mk,lk}){
      const qs=['Q1','Q2','Q3','Q4'], cols=['#22d3ee','#34d399','#f59e0b','#fb7185'];
      qs.forEach((q,i)=>{ mk(i*250-375,-160,{text:q,template:'pill',color:cols[i],w:160,font:15});
        for(let r=0;r<2;r++) mk(i*250-375,-72+r*84,{text:I.t('cm.diagRoadmapMilestone','Kamień ')+(r+1),template:'card',color:cols[i],w:190,font:13}); }); } },
    {k:'orgchart', icon:'layers', build({mk,lk}){
      const ceo=mk(-95,-230,{text:I.t('cm.diagOrgchartCeo','Dyrektor'),template:'banner',color:'#7c5cff',w:190,font:15});
      [I.t('cm.diagOrgchartDeptA','Dział A'),I.t('cm.diagOrgchartDeptB','Dział B'),I.t('cm.diagOrgchartDeptC','Dział C')].forEach((t,i)=>{ const m=mk(i*230-310,-90,{text:t,template:'card',color:'#22d3ee',w:180,font:14}); lk(ceo,m);
        for(let r=0;r<2;r++){ const e=mk(i*230-310,40+r*78,{text:I.t('cm.diagOrgchartTeam','Zespół ')+(r+1),template:'note',color:'#34d399',w:180,font:12}); lk(m,e); } }); } },
    {k:'proscons', icon:'copy', build({mk,lk}){
      const t=mk(-95,-220,{text:I.t('cm.diagProsconsTopic','Decyzja / temat'),template:'banner',color:'#7c5cff',w:210,font:15});
      const pro=mk(-330,-80,{text:I.t('cm.diagProsconsPro','ZA'),template:'pill',color:'#34d399',w:150,font:15}); const con=mk(170,-80,{text:I.t('cm.diagProsconsCon','PRZECIW'),template:'pill',color:'#fb7185',w:170,font:15});
      lk(t,pro);lk(t,con);
      for(let i=0;i<3;i++){ const a=mk(-350,40+i*78,{text:I.t('cm.diagProsconsArg','Argument ')+(i+1),template:'card',color:'#34d399',w:200,font:12}); lk(pro,a);
        const b=mk(160,40+i*78,{text:I.t('cm.diagProsconsArg','Argument ')+(i+1),template:'card',color:'#fb7185',w:200,font:12}); lk(con,b); } } },
    {k:'conceptmap', icon:'crosshair', build({mk,lk,nodes}){
      const c=mk(-80,-30,{text:I.t('cm.diagConceptmapCentral','Pojęcie główne'),template:'hexcard',color:'#7c5cff',w:180,font:16});
      const labels=[I.t('cm.diagConceptmapC1','Pojęcie A'),I.t('cm.diagConceptmapC2','Pojęcie B'),I.t('cm.diagConceptmapC3','Pojęcie C'),I.t('cm.diagConceptmapC4','Pojęcie D'),I.t('cm.diagConceptmapC5','Pojęcie E')];
      const R=300; labels.forEach((t,i)=>{ const a=(i/labels.length)*Math.PI*2-Math.PI/2; const n=mk(Math.cos(a)*R-80,Math.sin(a)*R-26,{text:t,template:'card',color:COLORS[i%COLORS.length],w:160}); lk(c,n); });
      const sub=mk(360,200,{text:I.t('cm.diagConceptmapSub','Pojęcie podrzędne'),template:'note',color:'#34d399',w:170,font:12}); lk(nodes[3],sub); } },
    {k:'empathy', icon:'target', build({mk,lk}){
      mk(-90,-30,{text:I.t('cm.diagEmpathyUser','Użytkownik'),template:'hexcard',color:'#7c5cff',w:180,font:16});
      const quad=[[I.t('cm.diagEmpathyThink','Myśli i czuje'),'#38bdf8',-300,-200],[I.t('cm.diagEmpathySee','Widzi'),'#34d399',120,-200],[I.t('cm.diagEmpathyHear','Słyszy'),'#f59e0b',-300,140],[I.t('cm.diagEmpathySay','Mówi i robi'),'#fb7185',120,140]];
      quad.forEach(q=>mk(q[2],q[3],{text:q[0],template:'frame',color:q[1],w:230,font:14}));
      mk(-330,300,{text:I.t('cm.diagEmpathyPain','Bóle / frustracje'),template:'card',color:'#f87171',w:220,font:13});
      mk(110,300,{text:I.t('cm.diagEmpathyGain','Korzyści / cele'),template:'card',color:'#a3e635',w:220,font:13}); } },
    {k:'bmc', icon:'grid', build({mk,lk}){
      const blocks=[[I.t('cm.diagBmcPartners','Kluczowi partnerzy'),0,0,1,2],[I.t('cm.diagBmcActivities','Kluczowe działania'),1,0,1,1],[I.t('cm.diagBmcResources','Kluczowe zasoby'),1,1,1,1],[I.t('cm.diagBmcValue','Propozycja wartości'),2,0,1,2],[I.t('cm.diagBmcRelations','Relacje z klientami'),3,0,1,1],[I.t('cm.diagBmcChannels','Kanały'),3,1,1,1],[I.t('cm.diagBmcSegments','Segmenty klientów'),4,0,1,2]];
      const cw=220,ch=120; blocks.forEach((b,i)=>mk(b[1]*cw-540,b[2]*ch-150,{text:b[0],template:'frame',color:COLORS[i%COLORS.length],w:cw-16,font:13}));
      mk(-540,-150+ch*2,{text:I.t('cm.diagBmcCosts','Struktura kosztów'),template:'frame',color:'#fb7185',w:cw*2.5,font:13});
      mk(-540+cw*2.6,-150+ch*2,{text:I.t('cm.diagBmcRevenue','Strumienie przychodów'),template:'frame',color:'#34d399',w:cw*2.5,font:13}); } },
    {k:'storymap', icon:'grid', build({mk,lk}){
      const acts=[I.t('cm.diagStorymapAct1','Aktywność 1'),I.t('cm.diagStorymapAct2','Aktywność 2'),I.t('cm.diagStorymapAct3','Aktywność 3')];
      acts.forEach((t,c)=>{ mk(c*240-330,-200,{text:t,template:'banner',color:'#7c5cff',w:210,font:14});
        mk(c*240-330,-110,{text:I.t('cm.diagStorymapStep','Krok'),template:'pill',color:'#38bdf8',w:210,font:13});
        for(let r=0;r<2;r++) mk(c*240-330,-30+r*82,{text:I.t('cm.diagStorymapStory','Historyjka ')+(r+1),template:'sticky',color:'#f59e0b',w:210,font:12}); }); } },
    {k:'affinity', icon:'grid', build({mk,lk}){
      const groups=[[I.t('cm.diagAffinityGroupA','Grupa A'),'#38bdf8'],[I.t('cm.diagAffinityGroupB','Grupa B'),'#34d399'],[I.t('cm.diagAffinityGroupC','Grupa C'),'#f59e0b']];
      groups.forEach((g,c)=>{ const h=mk(c*250-340,-200,{text:g[0],template:'banner',color:g[1],w:210,font:14});
        for(let r=0;r<3;r++){ const note=mk(c*250-340,-110+r*82,{text:I.t('cm.diagAffinityNote','Notatka ')+(r+1),template:'sticky',color:g[1],w:210,font:12}); lk(h,note); } }); } },
    {k:'venn', icon:'target', build({mk,lk}){
      mk(-260,-90,{text:I.t('cm.diagVennA','Zbiór A'),template:'cloud',color:'#38bdf8',w:240,font:15});
      mk(30,-90,{text:I.t('cm.diagVennB','Zbiór B'),template:'cloud',color:'#fb7185',w:240,font:15});
      mk(-260,140,{text:I.t('cm.diagVennC','Zbiór C'),template:'cloud',color:'#34d399',w:240,font:15});
      mk(-110,30,{text:I.t('cm.diagVennIntersect','Część wspólna'),template:'pill',color:'#f59e0b',w:200,font:13}); } },
    {k:'pyramid', icon:'layers', build({mk,lk}){
      const levels=[[I.t('cm.diagPyramidL5','Samorealizacja'),'#7c5cff',200],[I.t('cm.diagPyramidL4','Uznanie'),'#fb7185',300],[I.t('cm.diagPyramidL3','Przynależność'),'#f59e0b',400],[I.t('cm.diagPyramidL2','Bezpieczeństwo'),'#38bdf8',500],[I.t('cm.diagPyramidL1','Potrzeby fizjologiczne'),'#34d399',600]];
      levels.forEach((l,i)=>mk(-l[2]/2,-200+i*86,{text:l[0],template:'banner',color:l[1],w:l[2],font:14})); } },
    {k:'funnel', icon:'layers', build({mk,lk}){
      const stages=[[I.t('cm.diagFunnelAwareness','Świadomość'),'#38bdf8',560],[I.t('cm.diagFunnelInterest','Zainteresowanie'),'#7c5cff',440],[I.t('cm.diagFunnelDesire','Pożądanie'),'#f59e0b',320],[I.t('cm.diagFunnelAction','Działanie'),'#34d399',200]];
      stages.forEach((st,i)=>mk(-st[2]/2,-180+i*92,{text:st[0],template:'pill',color:st[1],w:st[2],font:14})); } },
    {k:'pert', icon:'flow', build({mk,lk}){
      const a=mk(-440,-30,{text:I.t('cm.diagPertStart','Start'),template:'pill',color:'#34d399',w:120});
      const t1=mk(-260,-140,{text:I.t('cm.diagPertTask1','Zadanie A'),template:'card',color:'#22d3ee',w:160});
      const t2=mk(-260,80,{text:I.t('cm.diagPertTask2','Zadanie B'),template:'card',color:'#38bdf8',w:160});
      const t3=mk(-40,-30,{text:I.t('cm.diagPertTask3','Zadanie C'),template:'card',color:'#f59e0b',w:160});
      const e=mk(180,-30,{text:I.t('cm.diagPertEnd','Koniec'),template:'pill',color:'#fb7185',w:120});
      lk(a,t1);lk(a,t2);lk(t1,t3);lk(t2,t3);lk(t3,e); } },
    {k:'fivewhys', icon:'flow', build({mk,lk}){
      let prev=mk(-95,-260,{text:I.t('cm.diagFivewhysProblem','Problem'),template:'banner',color:'#fb7185',w:230,font:15});
      for(let i=0;i<5;i++){ const n=mk(i*30-80,-160+i*86,{text:I.t('cm.diagFivewhysWhy','Dlaczego? ')+(i+1),template:'card',color:COLORS[i%COLORS.length],w:230,font:13}); lk(prev,n); prev=n; }
      const root=mk(60,290,{text:I.t('cm.diagFivewhysRoot','Przyczyna źródłowa'),template:'hexcard',color:'#34d399',w:230,font:14}); lk(prev,root); } },
    {k:'radar', icon:'crosshair', build({mk,lk}){
      const c=mk(-60,-26,{text:I.t('cm.diagRadarCenter','Profil'),template:'hexcard',color:'#7c5cff',w:140,font:15});
      const axes=[I.t('cm.diagRadarAxis1','Cecha 1'),I.t('cm.diagRadarAxis2','Cecha 2'),I.t('cm.diagRadarAxis3','Cecha 3'),I.t('cm.diagRadarAxis4','Cecha 4'),I.t('cm.diagRadarAxis5','Cecha 5'),I.t('cm.diagRadarAxis6','Cecha 6')];
      const R=300; axes.forEach((t,i)=>{ const a=(i/axes.length)*Math.PI*2-Math.PI/2; const n=mk(Math.cos(a)*R-70,Math.sin(a)*R-22,{text:t,template:'pill',color:COLORS[i%COLORS.length],w:140,font:12}); lk(c,n); }); } },
    {k:'valuechain', icon:'flow', build({mk,lk}){
      const support=[I.t('cm.diagValuechainInfra','Infrastruktura'),I.t('cm.diagValuechainHr','Zarządzanie kadrami'),I.t('cm.diagValuechainTech','Technologia')];
      support.forEach((t,i)=>mk(-440,-200+i*64,{text:t,template:'frame',color:'#7c5cff',w:560,font:12}));
      const primary=[[I.t('cm.diagValuechainInbound','Logistyka wej.'),'#38bdf8'],[I.t('cm.diagValuechainOps','Operacje'),'#22d3ee'],[I.t('cm.diagValuechainOutbound','Logistyka wyj.'),'#34d399'],[I.t('cm.diagValuechainMarketing','Marketing'),'#f59e0b'],[I.t('cm.diagValuechainService','Serwis'),'#fb7185']];
      let prev=null; primary.forEach((p,i)=>{ const n=mk(i*150-440,40,{text:p[0],template:'card',color:p[1],w:150,font:12}); if(prev)lk(prev,n); prev=n; });
      mk(330,40,{text:I.t('cm.diagValuechainMargin','Marża'),template:'pill',color:'#a3e635',w:120,font:14}); } },
  ];
  // nazwa i opis z CM.MindMapStrings (getter → zawsze w bieżącym języku)
  DIAGRAMS.forEach(d=>Object.defineProperties(d,{ name:{get(){ return S.diagName(d.k); }}, desc:{get(){ return S.diagDesc(d.k); }} }));
  const find=(k)=>DIAGRAMS.find(x=>x.k===k)||null;
  // buduje diagram k w ctx ({nodes, edges, seq}); zwraca jego definicję albo null dla nieznanego k
  function build(k, ctx){ const d=find(k); if(!d) return null; d.build(builder(ctx)); return d; }

  // miniatura SVG typu diagramu (zakładka „Szablony”)
  function thumb(d){
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

  // ---------- karta „kod”: wykryty język, podświetlanie, numeracja linii, kopiowanie ----------
  function escCode(s){ return U.escapeText(s); }
  // lekkie zgadywanie języka z samego kodu (tylko heurystyki strukturalne)
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
      try{ U.setHTML(pre, (CM.UI&&CM.UI.highlight)?CM.UI.highlight(codeText, lang):escCode(codeText)); }   // kolorowanie escapuje treść
      catch(e){ pre.textContent=codeText; }
    } else {
      gut.textContent='1';
      pre.replaceChildren(U.el('span',{class:'mm-code-ph', text:I.t('cm.codePlaceholder','// dwuklik, aby wpisać kod')}));
    }
    view.appendChild(gut); view.appendChild(pre); card.appendChild(view);
    card.appendChild(U.el('span',{class:'mm-code-lang',text: has?lang:''}));
    if(has){
      const cp=U.el('button',{class:'mm-code-copy',title:I.t('cm.copyCodeTitle','Kopiuj kod')});
      CM.icons.set(cp, 'copy', {size:11}); cp.appendChild(U.el('span',{text:'copy'}));
      const stop=(e)=>e.stopPropagation(); cp.addEventListener('pointerdown',stop); cp.addEventListener('mousedown',stop); cp.addEventListener('dblclick',stop);
      cp.onclick=(e)=>{ e.stopPropagation();
        if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(codeText).then(()=>{ cp.classList.add('done'); setTimeout(()=>cp.classList.remove('done'),1300); U.toast&&U.toast(I.t('cm.codeCopied','📋 Skopiowano kod.'),'success',1400); },()=>{}); } };
      card.appendChild(cp);
    }
    return view;
  }

  return { FRAMES, frameName, COLORS, SCHEMA_PALETTES, DIAGRAMS, find, build, builder, thumb, detectCodeLang, codeView:buildCodeView };
})();
