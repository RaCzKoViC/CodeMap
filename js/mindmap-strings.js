/* ===================== mindmap-strings.js — słowniki tekstów trybu MindMap =====================
   CM.MindMapStrings — klucze i18n z polskimi tekstami zapasowymi dla tabel danych MindMap: ramki kart,
   typy diagramów, kierunki i konstrukcje układu (teksty angielskie są w i18n.js pod tymi samymi kluczami).
   Etykiety rozwiązywane są przy KAŻDYM odczycie (I.t), więc nadążają za zmianą języka w locie.
   SNAP — teksty osi czasu migawek (dotąd tylko po polsku, bez kluczy i18n). */
CM.MindMapStrings = (function(){
  const I = CM.i18n;

  // ramki kart: k → [klucz, PL]
  const FRAMES={
    card:['cm.tplCard','Karta'],
    note:['cm.tplNote','Notatka'],
    sticky:['cm.tplSticky','Karteczka'],
    cloud:['cm.tplCloud','Chmurka'],
    banner:['cm.tplBanner','Baner'],
    pill:['cm.tplPill','Pigułka'],
    callout:['cm.tplCallout','Dymek'],
    code:['cm.tplCode','Kod'],
    frame:['cm.tplFrame','Ramka'],
    hexcard:['cm.tplHexcard','Heksagon'],
    circle:['cm.tplCircle','Koło'],
    diamond:['cm.tplDiamond','Romb'],
    terminal:['cm.tplTerminal','Terminal'],
    tag:['cm.tplTag','Etykieta'],
    quote:['cm.tplQuote','Cytat'],
    neon:['cm.tplNeon','Neon'],
  };
  // typy diagramów: k → [klucz nazwy, PL, klucz opisu, PL]
  const DIAGRAMS={
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
  // kierunki drzewa: k → [klucz, PL]
  const DIRS={
    up:['cm.dirUp','W górę'],
    down:['cm.dirDown','W dół'],
    updown:['cm.dirUpdown','Góra-Dół'],
    left:['cm.dirLeft','W lewo'],
    right:['cm.dirRight','W prawo'],
    leftright:['cm.dirLeftright','Lewo-Prawo'],
  };
  // konstrukcje układu: k → [klucz nazwy, PL, klucz opisu, PL]
  const LINES={
    'free-form':['cm.lineFree','Dowolny (ręczny)','cm.lineFreeDesc','Pozycje ustawiasz ręcznie.'],
    curved:['cm.lineCurved','Drzewo — linie krzywe','cm.lineCurvedDesc','Płynne, zaokrąglone połączenia.'],
    straight:['cm.lineStraight','Drzewo — linie proste','cm.lineStraightDesc','Kątowe połączenia ortogonalne.'],
    radial:['cm.lineRadial','Radialny (gwiazda)','cm.lineRadialDesc','Gałęzie promieniście wokół centrum.'],
    org:['cm.lineOrg','Organigram','cm.lineOrgDesc','Hierarchia od góry, proste linie.'],
    horizontal:['cm.lineHoriz','Drzewo poziome','cm.lineHorizDesc','Schludne drzewo rosnące w prawo (left-right tidy).'],
    timeaxis:['cm.lineTimeaxis','Oś czasu (pozioma)','cm.lineTimeaxisDesc','Węzły ułożone wzdłuż poziomej osi.'],
    spiral:['cm.lineSpiral','Spirala','cm.lineSpiralDesc','Węzły rozwijające się spiralnie od centrum.'],
    grid:['cm.lineGrid','Siatka','cm.lineGridDesc','Równa siatka wierszy i kolumn.'],
    layers:['cm.lineLayers','Warstwy (góra-dół)','cm.lineLayersDesc','Poziomy hierarchii jako schodkowe pasy.'],
    fishboneL:['cm.lineFishbone','Fishbone (rybi szkielet)','cm.lineFishboneDesc','Ości przyczyn wzdłuż centralnego kręgosłupa.'],
  };
  // oś czasu migawek
  const SNAP={
    toggleTitle:'Historia migawek (snapshots)', toggle:'Historia',
    empty:'Brak migawek — zapisz lub wczytaj mapę, aby zacząć śledzić historię.',
    nodes:' węzłów', now:'Teraz', snapshot:'migawka', manual:'ręczna', saved:'Migawka zapisana.',
    restored:(ago,a,c,r)=>'Przywrócono migawkę z '+ago+' ('+a+' nowych, '+c+' zmienionych, '+r+' usuniętych)',
  };

  // wpis tabeli → tekst w bieżącym języku (i = indeks klucza; nieznany k → sam k)
  const pick=(tbl,k,i)=>{ const r=Object.prototype.hasOwnProperty.call(tbl,k)?tbl[k]:null; return r ? I.t(r[i], r[i+1]) : k; };
  return { FRAMES, DIAGRAMS, DIRS, LINES, SNAP,
    frame:(k)=>pick(FRAMES,k,0), diagName:(k)=>pick(DIAGRAMS,k,0), diagDesc:(k)=>pick(DIAGRAMS,k,2),
    dir:(k)=>pick(DIRS,k,0), lineName:(k)=>pick(LINES,k,0), lineDesc:(k)=>pick(LINES,k,2) };
})();
