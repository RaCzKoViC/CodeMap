/* ===================== settings-docs.js — wbudowana dokumentacja: Specyfikacja i Instrukcja obsługi ===================== */
// Długie teksty (PL / EN) jako lista [nagłówek, akapit HTML]; zakładki „spec” i „manual” rejestrowane w CM.Settings.
CM.SettingsDocs = (function(){
  const K=CM.Settings.kit, el=K.el, I=K.I, t=K.t, section=K.section;

  // ---------------- long-form documents (rendered as HTML) ----------------
  const DOCS={
  pl:{ spec:[
    ['Czym jest CodeMap','CodeMap to lokalne narzędzie do <b>kartografii kodu</b> w stylu map Maltego. Wczytuje projekt (folder, pliki, archiwum lub repozytorium) i rysuje interaktywną mapę plików, folderów i zależności między nimi, wzbogaconą o metryki i analizę.'],
    ['Źródła danych','Folder lub pojedyncze pliki z urządzenia · archiwa <b>ZIP / TAR / TAR.GZ / GZ</b> · pliki <b>PDF</b> (struktura z zakładek i stron) · repozytoria <b>GitHub</b>, <b>GitLab</b> i <b>Bitbucket</b> (z opcjonalnym tokenem) · wklejanie zawartości (Ctrl+V) · ponowne otwarcie zapisanej mapy <code>.json</code>.'],
    ['Analiza','Rozpoznawanie ponad 150 formatów · metryki: liczba wierszy, wiersze kodu, komentarze, puste, złożoność (rozgałęzienia), liczba funkcji, znaczniki TODO/FIXME · ekstrakcja importów i referencji (z pomijaniem komentarzy/stringów, aliasami ścieżek z tsconfig/jsconfig) · wersje zależności z manifestów (package.json, requirements, Cargo.toml, go.mod) · mapa symboli (funkcje, klasy, typy) ze złożonością na symbol.'],
    ['Wizualizacja','Render na HTML5 Canvas: pan/zoom/obrót, pseudo-3D, minimapa, mapa okolicy (radar). Układy: strukturalne (upakowane koła, drzewo struktury, drzewo radialne, warstwy, moduły), siłowe (graf zależności, galaktyka) i kosmiczne (mgławica, spiralna galaktyka, pierścienie). Symulacja siłowa z algorytmem Barnes-Hut, opcjonalnie w Web Workerze.'],
    ['Narzędzia','Wykrywanie cykli zależności · hotspoty (rozmiar × wpływ) · filtr złożoności · migawki i porównania w czasie (diff) · porównywanie wielu schematów obok siebie · eksport do PNG/SVG i .json · paleta poleceń (Ctrl/Cmd+K).'],
    ['Tryb MindMap','Wbudowany edytor map myśli i diagramów (DOM, nie canvas): 22 typy schematów (mindmap, oś czasu, flowchart, fishbone, SWOT, UML, gantt, kanban i in.), szablony ramek, łączenie węzłów, multi-select, undo/redo, eksport do obrazu, zapis lokalny.'],
    ['Personalizacja','Przezroczystość okien i menu, rozmycie i nasycenie szkła, kolor akcentu, motyw ciemny/jasny, tło i odcień okien. Rozmiar węzłów, odstępy i wielkość napisów. Wszystkie ustawienia są zapamiętywane.'],
    ['Technologia','Czysty JavaScript bez frameworków i bez kroku budowania, moduły w globalnej przestrzeni <code>CM</code>. PWA instalowalna i działająca offline (service worker). Pełna dwujęzyczność (polski / angielski). Dane przechowywane lokalnie (localStorage + IndexedDB).'],
  ], manual:[
    ['1. Wczytanie projektu','Użyj menu <b>Wczytaj</b> na górnym pasku (folder / pliki / repozytorium), przeciągnij folder lub pliki na planszę, albo wklej zawartość przez <b>Ctrl+V</b>. Aby zobaczyć przykład bez wczytywania własnych danych, kliknij <b>Zobacz demo</b> w ekranie powitalnym.'],
    ['2. Nawigacja po mapie','Przeciąganie myszą = przesuwanie. Kółko = zoom. Środkowy / prawy przycisk lub Shift+lewy = obrót. Klawisze: <b>F</b> dopasuj, <b>Q/E</b> obrót, <b>+/−</b> zoom. Kliknij węzeł, aby zobaczyć szczegóły; dwuklik folderu zwija/rozwija; dwuklik kompasu otwiera mapę okolicy.'],
    ['3. Filtrowanie','W lewym panelu włączasz/wyłączasz foldery, pliki, zależności i typy połączeń. Sekcja „Typy plików" ukrywa wybrane języki. „Filtr złożoności" pokazuje tylko pliki powyżej progu wybranej metryki.'],
    ['4. Układy','Wybierz układ z rozwijanego paska na górze: strukturalne dla czytelnej hierarchii, siłowe dla relacji zależności, kosmiczne dla efektownej prezentacji.'],
    ['5. Analiza zależności','Menu <b>Projekt → Wykryj cykle zależności</b> podświetla cykliczne importy na czerwono. <b>Hotspoty</b> wskazują pliki o największym wpływie. Klik w linię połączenia pokazuje kierunek zależności.'],
    ['6. Migawki i historia','Zapisuj <b>migawki</b> stanu projektu (Projekt → Zapisz migawkę). W <b>Historii</b> porównasz dwie migawki — różnice (dodane/usunięte/zmienione pliki) zobaczysz na mapie.'],
    ['7. Eksport','Projekt → <b>Zapisz mapę (.json)</b> zapisuje pełen stan do pliku. <b>Eksport obrazu</b> tworzy PNG (2×/4×) lub wektorowy SVG całej mapy.'],
    ['8. Tryb MindMap','Przełącz tryb na górnym pasku. Dwuklik tła = nowy węzeł, dwuklik węzła = edycja, menu otaczające węzeł daje narzędzia (dziecko, kolor, kształt, układ). PPM otwiera menu kontekstowe. Ctrl+Z / Ctrl+Y = cofnij/ponów.'],
    ['9. Skróty klawiszowe','<b>Ctrl/Cmd+K</b> — paleta poleceń · <b>Ctrl+V</b> — wklej kod · <b>F</b> — dopasuj · <b>Q/E</b> — obrót · <b>I</b> — izoluj zaznaczony · <b>Esc</b> — zamknij / wyczyść.'],
    ['10. Instalacja i offline','W Ustawieniach → Instalacja dodasz CodeMap jako aplikację i będziesz jej używać offline. Tam też wyczyścisz pamięć podręczną lub wszystkie dane.'],
  ]},
  en:{ spec:[
    ['What CodeMap is','CodeMap is a local <b>code cartography</b> tool in the style of Maltego maps. It loads a project (folder, files, archive or repository) and draws an interactive map of files, folders and the dependencies between them, enriched with metrics and analysis.'],
    ['Data sources','A folder or individual files from your device · <b>ZIP / TAR / TAR.GZ / GZ</b> archives · <b>PDF</b> files (structure from bookmarks and pages) · <b>GitHub</b>, <b>GitLab</b> and <b>Bitbucket</b> repositories (with an optional token) · pasting content (Ctrl+V) · reopening a saved <code>.json</code> map.'],
    ['Analysis','Recognition of 150+ formats · metrics: line count, code lines, comments, blanks, complexity (branches), function count, TODO/FIXME markers · import and reference extraction (skipping comments/strings, path aliases from tsconfig/jsconfig) · dependency versions from manifests (package.json, requirements, Cargo.toml, go.mod) · a symbol map (functions, classes, types) with per-symbol complexity.'],
    ['Visualization','Rendered on HTML5 Canvas: pan/zoom/rotate, pseudo-3D, minimap, neighborhood map (radar). Layouts: structural (packed circles, structure tree, radial tree, layers, modules), force-directed (dependency graph, galaxy) and cosmic (nebula, spiral galaxy, rings). Force simulation with the Barnes-Hut algorithm, optionally in a Web Worker.'],
    ['Tools','Dependency cycle detection · hotspots (size × impact) · complexity filter · snapshots and comparisons over time (diff) · comparing multiple schemas side by side · export to PNG/SVG and .json · command palette (Ctrl/Cmd+K).'],
    ['MindMap mode','A built-in mind-map and diagram editor (DOM, not canvas): 22 diagram types (mindmap, timeline, flowchart, fishbone, SWOT, UML, gantt, kanban and more), frame templates, node linking, multi-select, undo/redo, image export, local saving.'],
    ['Personalization','Window and menu transparency, glass blur and saturation, accent color, dark/light theme, background and window tint. Node size, spacing and label size. All settings are remembered.'],
    ['Technology','Pure JavaScript with no frameworks and no build step, modules in the global <code>CM</code> namespace. An installable, offline-capable PWA (service worker). Fully bilingual (Polish / English). Data is stored locally (localStorage + IndexedDB).'],
  ], manual:[
    ['1. Loading a project','Use the <b>Load</b> menu in the top bar (folder / files / repository), drag a folder or files onto the canvas, or paste content with <b>Ctrl+V</b>. To see an example without loading your own data, click <b>See demo</b> on the welcome screen.'],
    ['2. Navigating the map','Drag with the mouse = pan. Wheel = zoom. Middle / right button or Shift+left = rotate. Keys: <b>F</b> fit, <b>Q/E</b> rotate, <b>+/−</b> zoom. Click a node to see details; double-click a folder to collapse/expand; double-click the compass to open the neighborhood map.'],
    ['3. Filtering','In the left panel you toggle folders, files, dependencies and connection types. The “File types” section hides selected languages. The “Complexity filter” shows only files above a threshold of the chosen metric.'],
    ['4. Layouts','Pick a layout from the dropdown at the top: structural for a readable hierarchy, force-directed for dependency relationships, cosmic for a striking presentation.'],
    ['5. Dependency analysis','<b>Project → Detect dependency cycles</b> highlights circular imports in red. <b>Hotspots</b> point out the highest-impact files. Clicking a connection line shows the dependency direction.'],
    ['6. Snapshots & history','Save <b>snapshots</b> of the project state (Project → Save snapshot). In <b>History</b> you can compare two snapshots — the differences (added/removed/changed files) are shown on the map.'],
    ['7. Export','Project → <b>Save map (.json)</b> writes the full state to a file. <b>Export image</b> creates a PNG (2×/4×) or a vector SVG of the whole map.'],
    ['8. MindMap mode','Switch mode in the top bar. Double-click the canvas = new node, double-click a node = edit; the surrounding node menu offers tools (child, color, shape, layout). Right-click opens the context menu. Ctrl+Z / Ctrl+Y = undo/redo.'],
    ['9. Keyboard shortcuts','<b>Ctrl/Cmd+K</b> — command palette · <b>Ctrl+V</b> — paste code · <b>F</b> — fit · <b>Q/E</b> — rotate · <b>I</b> — isolate selected · <b>Esc</b> — close / clear.'],
    ['10. Installation & offline','In Settings → Installation you can add CodeMap as an app and use it offline. There you can also clear the cache or all data.'],
  ]}
  };

  function renderDoc(c, doc){
    doc.forEach(([h,body])=>{
      c.appendChild(el('h4',{class:'set-doc-h',text:h}));
      c.appendChild(el('p',{class:'set-doc-p',html:body}));
    });
  }
  function tabSpec(c){ section(c, '', null); c.appendChild(el('h3',{class:'set-h3',text:t('tab.spec')})); renderDoc(c, (DOCS[I.getLang()]||DOCS.pl).spec); }
  function tabManual(c){ c.appendChild(el('h3',{class:'set-h3',text:t('tab.manual')})); renderDoc(c, (DOCS[I.getLang()]||DOCS.pl).manual); }

  CM.Settings.addTab('spec','info',tabSpec);
  CM.Settings.addTab('manual','book',tabManual);

  return { DOCS, renderDoc };
})();
