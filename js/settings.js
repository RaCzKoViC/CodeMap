/* ===================== settings.js — settings overlay, interactive tutorial, docs ===================== */
CM.Settings = (function(){
  const U=CM.util, $=U.$, el=U.el, I=CM.i18n, ic=CM.icons;
  let handlers={};
  let overlay=null, builtLang=null, curTab='lang';

  // ---------------- settings-specific strings (PL / EN) ----------------
  const STR={
  pl:{
    'title':'Ustawienia',
    'tab.account':'Konto','acct.head':'Konto i synchronizacja','acct.desc':'Rejestracja, logowanie i synchronizacja danych (mapy, migawki, ustawienia, Sejf) między urządzeniami.',
    'tab.lang':'Język','tab.appearance':'Wygląd','tab.ai':'AI','tab.install':'Instalacja',
    'tab.shortcuts':'Skróty',
    'tab.tutorial':'Samouczek','tab.spec':'Specyfikacja','tab.manual':'Instrukcja obsługi','tab.about':'O aplikacji',
    'sc.head':'Skróty klawiszowe i myszy','sc.desc':'Pełna lista skrótów. Klawisze pokazane są jako klawisze; działanie zależy od trybu (CodeMap / MindMap).',
    'sc.grp.nav':'Nawigacja CodeMap','sc.grp.general':'Ogólne','sc.grp.mind':'MindMap',
    'sc.move':'Ruch kamery','sc.zoomIn':'Przybliż','sc.zoomOut':'Oddal',
    'sc.fps':'Tryb nawigacji (rozglądanie się, FPS)','sc.fpsHint':'Włącz klawiszem G lub przyciskiem celownika; mysz = obrót i pochylenie; Esc lub G = wyjście.',
    'sc.arrows':'Przesuwanie widoku','sc.fit':'Dopasuj do ekranu','sc.rotate':'Obrót w lewo / prawo',
    'sc.resetRot':'Reset obrotu','sc.toggle3d':'Przełącz 3D / perspektywę','sc.isolate':'Skup na zaznaczonym',
    'sc.impact':'Widok wpływu zależności','sc.search':'Szukaj','sc.escape':'Odznacz / zamknij','sc.del':'Usuń węzeł','sc.undo':'Cofnij / ponów','sc.edit':'Edytuj węzeł',
    'sc.altS':'Otwórz / zamknij tę ściągawkę skrótów',
    'sc.mouse':'mysz','sc.dblclick':'dwuklik',
    'ai.head':'Asystent AI (Mistral)','ai.desc':'Opcjonalnie. Po podaniu własnego klucza Mistral API aplikacja może przeanalizować STRUKTURĘ projektu (foldery, liczby i rozmiary plików, języki) i zaproponować logiczny podział na moduły/warstwy oraz wskazać „zapachy" struktury.',
    'ai.key':'Klucz Mistral API (przechowywany lokalnie)','ai.model':'Model',
    'ai.keys':'Klucze API (chmura: Mistral, OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, DeepSeek, xAI, Together)',
    'ai.keysHint':'Wklej klucz — dostawca zostanie rozpoznany po formacie klucza i potwierdzony testem (pobranie listy modeli). Klucze zostają w tej przeglądarce i trafiają wyłącznie do API danego dostawcy. Aplikacja używa działających kluczy rotacyjnie, a przy limicie lub błędzie przełącza się na następny.',
    'ai.keyAdd':'Dodaj klucz','ai.keyTest':'Testuj','ai.keySave':'Zapisz','ai.keyDelete':'Usuń klucz','ai.keyDeleteConfirm':'Usunąć ten klucz?',
    'ai.keySaved':'Klucz zapisany.','ai.keyDeleted':'Klucz usunięty.','ai.keyEmpty':'Wklej klucz.','ai.keyExists':'Ten klucz już jest na liście.',
    'ai.keyTesting':'Sprawdzam klucz…','ai.keyOk':'działa','ai.keyModels':'modeli: ','ai.keyUnknownProv':'dostawca nierozpoznany po formacie — kliknij Testuj',
    'ai.keyDetected':'(wykryty po formacie klucza — kliknij Testuj, aby potwierdzić)','ai.keyModel':'Model','ai.keyNone':'Brak kluczy. Dodaj pierwszy poniżej — albo wybierz wyżej model lokalny lub Ollamę (bez klucza).',
    'ai.keyPh':'Klucz API…','ai.keyShow':'Pokaż / ukryj klucz','ai.keysCount':'Działające klucze: ',
    'ai.votes':'Oceny odpowiedzi ChatBota','ai.votesHint':'Suma łapek ze wszystkich rozmów — nie zeruje się.','ai.votesUp':'pomocne','ai.votesDown':'niepomocne',
    'ai.provider':'Dostawca AI','ai.providerHint':'„Model lokalny" = prawdziwy, darmowy LLM działający w 100% na Twoim urządzeniu (WebGPU). Bez klucza, bez wysyłania danych — wagi pobierane są raz i trzymane w pamięci przeglądarki.',
    'ai.provMistral':'Klucze API — chmura (Mistral, OpenAI, Claude, Gemini, Groq…)','ai.provLocal':'Model lokalny (w przeglądarce, za darmo)',
    'ai.provOllama':'Ollama (natywny lokalny serwer — błyskawiczny)',
    'ai.ollamaDesc':'Najszybsza lokalna opcja: modele uruchamia zainstalowana Ollama (ollama.com) — pełna moc komputera, zero obciążania przeglądarki i karty graficznej zakładki. Wymaga działającej aplikacji Ollama.',
    'ai.ollamaCheck':'Sprawdź / odśwież modele','ai.ollamaModel':'Model Ollamy','ai.ollamaOnline':'✓ Ollama online — modele: ',
    'ai.localModel':'Lokalny model','ai.localDl':'Pobierz i uruchom','ai.localDlHint':'Pierwsze uruchomienie pobiera wagi modelu (rozmiar przy nazwie). Kolejne starty są szybkie (cache przeglądarki). Na zintegrowanych GPU (Intel/AMD) polecamy 0.5B–1B; większe modele wymagają dedykowanej karty graficznej.',
    'ai.localReady':'✓ Model gotowy — cała aplikacja (ChatBot, analiza, pytania o elementy) działa lokalnie.',
    'ai.localLoading':'Pobieram / uruchamiam…','ai.localNoGPU':'Ta przeglądarka nie obsługuje WebGPU (wymagany Chrome/Edge 113+). Lokalne modele są niedostępne — użyj Mistral API.',
    'ai.localUnload':'Zwolnij z pamięci (RAM/VRAM)','ai.localDelete':'Usuń pobrane wagi z dysku','ai.localDeleted':'Usunięto pobrane modele: ','ai.localCached':'Pobrane dane modeli w przeglądarce: ',
    'ai.localCancel':'Anuluj pobieranie / ładowanie',
    'ai.localList':'Pobrane modele (zarządzanie)','ai.localNone':'Nie pobrano jeszcze żadnego modelu.','ai.localRun':'Uruchom (pobrany — bez ponownego pobierania)',
    'ai.localLoaded':'załadowany','ai.localDelOne':'Usuń','ai.localDelConfirm':'Usunąć pobrane wagi modelu „{n}” z dysku przeglądarki?',
    'ai.privacy':'Prywatność: wysyłana jest TYLKO struktura (ścieżki, liczby, rozmiary, języki) — nigdy treść plików. Klucz trzymany jest wyłącznie w Twojej przeglądarce.',
    'ai.analyze':'Przeanalizuj bieżącą strukturę','ai.working':'Analizuję strukturę…','ai.noProject':'Najpierw wczytaj projekt (CodeMap).','ai.empty':'Brak odpowiedzi.',
    'ai.autotune':'Automatycznie dostrajaj widok przez AI przy wczytywaniu','ai.autotuneHint':'Po wczytaniu projektu AI dobierze które Elementy i Połączenia pokazać oraz parametry Figur (rozmiar węzłów, odstępy, rozmiar napisów), aby mapa pasowała do skali projektu. Wymaga klucza powyżej; wysyła tylko strukturę.',
    'ai.askHead':'Zapytaj o projekt','ai.askPlaceholder':'Zapytaj o projekt… np. gdzie jest logika logowania?','ai.ask':'Zapytaj AI','ai.asking':'Pytam AI…','ai.askEmpty':'Najpierw wpisz pytanie.',
    'ai.layout':'✨ Ułóż mapę przez AI','ai.layoutHint':'AI samodzielnie rozmieszcza moduły — za każdym razem inaczej, bez gotowych układów.','ai.layoutWorking':'AI układa mapę…','ai.layoutDone':'AI ułożyła mapę.',
    'lang.head':'Język interfejsu','lang.desc':'Wybierz język aplikacji. Cały interfejs zostanie natychmiast przetłumaczony, a wybór zapamiętany.',
    'lang.pl':'Polski','lang.en':'English (angielski)',
    'app.head':'Strojenie wyglądu','app.desc':'Pełne suwaki przezroczystości, rozmycia, kolorów i rozmiarów znajdziesz w panelu „Warstwy i filtry" po lewej. Tutaj masz szybkie skróty.',
    'app.theme':'Motyw','app.theme.dark':'Ciemny','app.theme.light':'Jasny',
    'app.accent':'Kolor akcentu','app.open':'Otwórz panel wyglądu','app.reset':'Przywróć domyślny wygląd',
    'app.reset.done':'Przywrócono domyślny wygląd aplikacji.',
    'install.head':'Instalacja i dane','install.desc':'CodeMap to aplikacja PWA — możesz ją zainstalować na pulpicie i używać offline. Twoje mapy i ustawienia są zapisywane lokalnie w przeglądarce.',
    'install.install':'Zainstaluj aplikację','install.install.hint':'Dodaj CodeMap jako samodzielną aplikację (offline).',
    'install.unavailable':'Instalacja niedostępna — aplikacja jest już zainstalowana lub przeglądarka nie udostępniła monitu. Można też użyć opcji „Zainstaluj" w pasku adresu.',
    'install.update':'Sprawdź aktualizacje / przeładuj','install.update.hint':'Pobiera najnowszą wersję i odświeża aplikację.',
    'install.uninstall':'Wyczyść pamięć podręczną (offline)','install.uninstall.hint':'Usuwa service workera i pamięć podręczną. Mapy i ustawienia pozostają.',
    'install.uninstall.done':'Wyczyszczono pamięć podręczną offline. Odśwież stronę.',
    'install.wipe':'Usuń wszystkie dane','install.wipe.hint':'Trwale usuwa migawki, zapisane mapy, mapy myśli, ustawienia i język. Nieodwracalne.',
    'install.wipe.confirm':'Na pewno usunąć WSZYSTKIE dane (migawki, mapy, ustawienia)? Tej operacji nie można cofnąć.',
    'install.wipe.done':'Usunięto wszystkie dane aplikacji.',
    'tut.head':'Interaktywny samouczek','tut.desc':'Animowany przewodnik podświetli po kolei każde narzędzie i przycisk, wyjaśniając do czego służy. Możesz go przerwać w dowolnej chwili klawiszem Esc.',
    'tut.start':'Rozpocznij samouczek','tut.covers':'Samouczek pokazuje: logo, przełącznik trybów, menu Wczytaj, wybór układu, wyszukiwarkę, menu Projekt, ustawienia, panele boczne, filtry, wygląd, narzędzia widoku, tryb 3D kółkiem myszy, kompas (czerwona wskazówka), mapę okolicy/teleportację, przypinanie kompasu, minimapę, panel szczegółów i pasek statusu.',
    'tut.startCode':'Samouczek CodeMap','tut.startMind':'Samouczek MindMap',
    'tut.coversMind':'Samouczek MindMap pokazuje: przełącznik trybów, górny pasek (nazwa + zoom), planszę (dwuklik = nowy węzeł), pasek narzędzi (cofnij/ponów, łączenie, auto-układ, schematy i szablony, dopasowanie), zapis i wczytywanie, eksport, Markdown, panel właściwości oraz oś czasu migawek.',
    'tut.shortcutsTitle':'Skróty klawiszowe',
    'tut.shortcuts':'<b>Ctrl + K</b> (na Windows także <b>Ctrl + ⊞ Win + K</b>) — <b>paleta poleceń</b> (szybkie wyszukanie i uruchomienie dowolnej funkcji) · <b>Ctrl + V</b> — wklej kod · <b>F</b> — dopasuj widok · <b>Q / E</b> — obrót · <b>+ / −</b> — zoom · <b>I</b> — izoluj zaznaczony · <b>Ctrl + Z / Ctrl + Y</b> — cofnij / ponów (MindMap) · <b>Esc</b> — zamknij / wyczyść.',
    'tut.next':'Dalej','tut.prev':'Wstecz','tut.skip':'Pomiń','tut.done':'Zakończ','tut.step':'Krok',
    'about.head':'O aplikacji','about.version':'Wersja','about.author':'Autor','about.tech':'Technologia',
    'about.tech.val':'Czysty JavaScript (bez frameworków i bez kroku budowania), render na HTML5 Canvas, PWA z service workerem. Działa w pełni lokalnie i offline.',
    'about.privacy':'Prywatność','about.privacy.val':'Wszystkie dane pozostają w Twojej przeglądarce. Pliki nie są wysyłane na żaden serwer (poza pobieraniem z GitHub/GitLab/Bitbucket, gdy sam o to poprosisz).',
    'about.repo':'Profil autora na GitHub',
    // ---- tour steps ----
    'tour.brand.t':'Logo CodeMap','tour.brand.b':'Kliknij logo, aby je obrócić (zabawny akcent, dostępny co 10 sekund). To także znak rozpoznawczy aplikacji.',
    'tour.mode.t':'Przełącznik trybów','tour.mode.b':'Przełączaj między <b>CodeMap</b> (mapa kodu i zależności) a <b>MindMap</b> (mapy myśli i schematy). Tryb możesz zmienić w każdej chwili.',
    'tour.load.t':'Menu Wczytaj','tour.load.b':'Wczytaj projekt: <b>folder z urządzenia</b>, <b>pojedyncze pliki</b> lub <b>repozytorium GitHub/GitLab/Bitbucket</b>. Możesz też przeciągnąć pliki na planszę albo wkleić je Ctrl+V.',
    'tour.layout.t':'Wybór układu','tour.layout.b':'Zmień sposób rozmieszczenia węzłów — układy strukturalne (czytelne drzewa, upakowane koła), siłowe (graf zależności) oraz kosmiczne (mgławica, galaktyki).',
    'tour.search.t':'Wyszukiwarka','tour.search.b':'Szukaj plików i ścieżek. Trafienia są podświetlane na mapie; wybierz wynik, aby do niego doskoczyć.',
    'tour.project.t':'Menu Projekt','tour.project.b':'Operacje na całym projekcie: zapis <b>migawek</b> i ich historia, eksport mapy do <b>.json</b> lub <b>obrazu (PNG/SVG)</b>, wykrywanie <b>cykli zależności</b>, <b>hotspoty</b> i porównywanie schematów.',
    'tour.settings.t':'Ustawienia','tour.settings.b':'Ta zębatka otwiera ustawienia — język, instalację, ten samouczek oraz pełną specyfikację i instrukcję obsługi.',
    'tour.leftrail.t':'Panel boczny','tour.leftrail.b':'Tym uchwytem zwijasz i rozwijasz lewy panel z warstwami i filtrami. Analogiczny uchwyt po prawej steruje panelem szczegółów.',
    'tour.elements.t':'Elementy i filtry','tour.elements.b':'Włączaj i wyłączaj widoczność folderów, plików oraz zależności zewnętrznych — i rodzajów połączeń między nimi.',
    'tour.filetypes.t':'Typy plików','tour.filetypes.b':'Każdy język/typ pliku ma swój kolor. Możesz ukrywać wybrane typy, aby skupić mapę na tym, co istotne.',
    'tour.complexity.t':'Filtr złożoności','tour.complexity.b':'Pokazuj tylko pliki powyżej progu wybranej metryki (liczba wierszy, złożoność, liczba funkcji, znaczniki TODO, rozmiar). Świetne do znajdowania „ciężkich" plików.',
    'tour.appearance.t':'Wygląd','tour.appearance.b':'Dostrój przezroczystość okien, rozmycie szkła, kolor akcentu, motyw oraz tło. Aplikacja jest w pełni personalizowalna.',
    'tour.map.t':'Opcje mapy','tour.map.b':'Włączaj animacje, cząsteczki przepływu, siatkę tła, wygięte połączenia i podgląd kodu po najechaniu. Tu też zablokujesz figury.',
    'tour.figures.t':'Figury','tour.figures.b':'Reguluj rozmiar węzłów, odległość między nimi i wielkość napisów, aby mapa była czytelna dla małych i ogromnych projektów.',
    'tour.viewcontrols.t':'Narzędzia widoku','tour.viewcontrols.b':'Przybliżanie, oddalanie, dopasowanie do ekranu, obrót w lewo/prawo i przełącznik pseudo-3D. Pasek można zwinąć.',
    'tour.threed.t':'Tryb 3D kółkiem myszy','tour.threed.b':'Wciśnij <b>kółko myszy</b> i przesuwaj w <b>górę / dół</b>, aby płynnie i dynamicznie przechodzić w tryb <b>3D</b> (pochylenie perspektywy) i z powrotem. To samo robi przycisk sześcianu na pasku narzędzi — właśnie go podejrzewasz. (Obrót w 3D: środkowy lub prawy przycisk myszy.)',
    'tour.compass.t':'Kompas — czerwona wskazówka','tour.compass.b':'Przeciągnij <b>tarczę</b>, aby obrócić kamerę; na tarczy widzisz <b>licznik kątów</b> (np. 0°). <b>Czerwona wskazówka</b> zawsze pokazuje <b>centrum głównej struktury</b> na mapie — dzięki temu wiesz, w którą stronę „wrócić do projektu", nawet po oddaleniu.',
    'tour.compasshood.t':'Mapa okolicy (radar)','tour.compasshood.b':'<b>Dwukrotne kliknięcie</b> kompasu otwiera ten <b>radar całej okolicy</b> — miniaturę wszystkich widocznych węzłów. Kółkiem przybliżasz, a <b>dwuklik elementu = teleportacja</b> wprost do niego na mapie (jest też przycisk „Teleportuj do…"). Świetne do skoku w odległą część dużego projektu.',
    'tour.compasspin.t':'Odpinanie i przypinanie kompasu','tour.compasspin.b':'Małym przyciskiem <b>pinezki</b> (lewy-górny) <b>odepniesz</b> kompas, złapiesz go za <b>uchwyt</b> (górny) i przeniesiesz w <b>dowolne miejsce ekranu</b>, a tą samą pinezką <b>przypniesz</b> go tam ponownie. Drugi przycisk pozwala też zwinąć kompas.',
    'tour.minimap.t':'Minimapa','tour.minimap.b':'Podgląd całej mapy z zaznaczonym widokiem. Pomaga w nawigacji po dużych projektach; można ją zwinąć.',
    'tour.details.t':'Panel szczegółów','tour.details.b':'Po kliknięciu elementu zobaczysz tu metryki, skład wierszy, znaczniki, importy, symbole (funkcje/klasy) i podświetlony podgląd kodu.',
    'tour.status.t':'Pasek statusu','tour.status.b':'Nazwa projektu, liczba węzłów i połączeń, aktualny element pod kursorem, poziom przybliżenia oraz zegar.',
    // ---- MindMap tour steps ----
    'tourmm.mode.t':'Tryb MindMap','tourmm.mode.b':'Jesteś w trybie <b>MindMap</b> — edytorze map myśli i diagramów. Tym przełącznikiem wrócisz do <b>CodeMap</b> w każdej chwili.',
    'tourmm.topbar.t':'Górny pasek','tourmm.topbar.b':'Tu nadasz <b>nazwę</b> mapie myśli i wyregulujesz <b>powiększenie</b> (przyciskami +/− lub kółkiem myszy).',
    'tourmm.canvas.t':'Plansza','tourmm.canvas.b':'<b>Dwuklik</b> w puste miejsce tworzy nowy węzeł, <b>dwuklik węzła</b> go edytuje, a przeciąganie przesuwa widok. Wokół zaznaczonego węzła pojawia się <b>menu</b> z szybkimi akcjami (dziecko, kolor, kształt).',
    'tourmm.tools.t':'Pasek narzędzi','tourmm.tools.b':'Wszystkie narzędzia mapy myśli w jednym miejscu — w kolejnych krokach omówimy najważniejsze.',
    'tourmm.undo.t':'Cofnij / ponów','tourmm.undo.b':'Cofaj i ponawiaj zmiany (także skrótami <b>Ctrl+Z</b> / <b>Ctrl+Y</b>).',
    'tourmm.connect.t':'Łączenie węzłów','tourmm.connect.b':'Włącz <b>tryb łączenia</b> i kliknij dwa węzły, aby je połączyć krawędzią.',
    'tourmm.arrange.t':'Auto-układ','tourmm.arrange.b':'Automatycznie rozmieszcza węzły (radialnie) — szybkie uporządkowanie mapy.',
    'tourmm.layout.t':'Schematy i szablony','tourmm.layout.b':'Wybierz <b>schemat układu</b>, styl linii oraz jeden z <b>22 typów diagramów</b> i 34 szablonów (oś czasu, flowchart, SWOT, kanban, blok kodu i in.).',
    'tourmm.fit.t':'Dopasuj widok','tourmm.fit.b':'Dopasowuje powiększenie tak, aby cała mapa zmieściła się na ekranie.',
    'tourmm.save.t':'Zapis i wczytywanie','tourmm.save.b':'Zapisuj mapy w pamięci urządzenia i wczytuj je później. Obok znajdziesz <b>eksport</b> do pliku, obrazu (PNG/SVG) oraz import.',
    'tourmm.markdown.t':'Markdown','tourmm.markdown.b':'Importuj i eksportuj mapę jako <b>konspekt Markdown</b> — wygodna wymiana z notatkami.',
    'tourmm.inspector.t':'Panel właściwości','tourmm.inspector.b':'Po zaznaczeniu węzła dostroisz tu jego <b>tekst, kolor, kształt, czcionkę</b> i powiązania. Uchwytem obok zwiniesz panel.',
    'tourmm.timeline.t':'Oś czasu migawek','tourmm.timeline.b':'Zapisane migawki układają się w <b>oś czasu</b> z animowanym porównaniem zmian (dodane / zmienione / usunięte węzły).',
  },
  en:{
    'title':'Settings',
    'tab.account':'Account','acct.head':'Account & sync','acct.desc':'Registration, login and data sync (maps, snapshots, settings, Vault) across devices.',
    'tab.lang':'Language','tab.appearance':'Appearance','tab.ai':'AI','tab.install':'Installation',
    'tab.shortcuts':'Shortcuts',
    'sc.head':'Keyboard & mouse shortcuts','sc.desc':'The full list of shortcuts. Keys are shown as keys; the action depends on the mode (CodeMap / MindMap).',
    'sc.grp.nav':'CodeMap navigation','sc.grp.general':'General','sc.grp.mind':'MindMap',
    'sc.move':'Camera movement','sc.zoomIn':'Zoom in','sc.zoomOut':'Zoom out',
    'sc.fps':'Navigation mode (mouse-look, FPS)','sc.fpsHint':'Enable with G or the crosshair button; mouse = rotate and tilt; Esc or G = exit.',
    'sc.arrows':'Pan the view','sc.fit':'Fit to screen','sc.rotate':'Rotate left / right',
    'sc.resetRot':'Reset rotation','sc.toggle3d':'Toggle 3D / perspective','sc.isolate':'Focus on selected',
    'sc.impact':'Dependency impact view','sc.search':'Search','sc.escape':'Deselect / close','sc.del':'Delete node','sc.undo':'Undo / redo','sc.edit':'Edit node',
    'sc.altS':'Open / close this shortcuts cheatsheet',
    'sc.mouse':'mouse','sc.dblclick':'double-click',
    'ai.head':'AI assistant (Mistral)','ai.desc':'Optional. With your own Mistral API key, the app can analyze the project STRUCTURE (folders, file counts and sizes, languages) and propose a logical grouping into modules/layers plus flag structural smells.',
    'ai.key':'Mistral API key (stored locally)','ai.model':'Model',
    'ai.keys':'API keys (cloud: Mistral, OpenAI, Anthropic Claude, Google Gemini, Groq, OpenRouter, DeepSeek, xAI, Together)',
    'ai.keysHint':'Paste a key — the provider is recognised from the key format and confirmed by a test (fetching its model list). Keys stay in this browser and go only to that provider\'s API. The app rotates through working keys and falls over to the next one on rate limits or errors.',
    'ai.keyAdd':'Add key','ai.keyTest':'Test','ai.keySave':'Save','ai.keyDelete':'Delete key','ai.keyDeleteConfirm':'Delete this key?',
    'ai.keySaved':'Key saved.','ai.keyDeleted':'Key deleted.','ai.keyEmpty':'Paste a key.','ai.keyExists':'This key is already on the list.',
    'ai.keyTesting':'Checking the key…','ai.keyOk':'works','ai.keyModels':'models: ','ai.keyUnknownProv':'provider not recognised from the format — click Test',
    'ai.keyDetected':'(detected from the key format — click Test to confirm)','ai.keyModel':'Model','ai.keyNone':'No keys yet. Add one below — or pick the local model or Ollama above (no key needed).',
    'ai.keyPh':'API key…','ai.keyShow':'Show / hide key','ai.keysCount':'Working keys: ',
    'ai.votes':'ChatBot answer ratings','ai.votesHint':'Total thumbs across all conversations — never resets.','ai.votesUp':'helpful','ai.votesDown':'unhelpful',
    'ai.provider':'AI provider','ai.providerHint':'"Local model" = a real, free LLM running 100% on your device (WebGPU). No key, no data leaves your machine — weights are downloaded once and kept in the browser cache.',
    'ai.provMistral':'API keys — cloud (Mistral, OpenAI, Claude, Gemini, Groq…)','ai.provLocal':'Local model (in-browser, free)',
    'ai.provOllama':'Ollama (native local server — blazing fast)',
    'ai.ollamaDesc':'The fastest local option: models run in your installed Ollama (ollama.com) — full machine power, zero load on the browser tab or its GPU. Requires the Ollama app running.',
    'ai.ollamaCheck':'Check / refresh models','ai.ollamaModel':'Ollama model','ai.ollamaOnline':'✓ Ollama online — models: ',
    'ai.localModel':'Local model','ai.localDl':'Download & start','ai.localDlHint':'The first start downloads the model weights (size next to the name). Subsequent starts are fast (browser cache). On integrated GPUs (Intel/AMD) prefer 0.5B–1B; bigger models need a dedicated GPU.',
    'ai.localReady':'✓ Model ready — the whole app (ChatBot, analysis, element questions) runs locally.',
    'ai.localLoading':'Downloading / starting…','ai.localNoGPU':'This browser has no WebGPU (Chrome/Edge 113+ required). Local models are unavailable — use the Mistral API.',
    'ai.localUnload':'Release from memory (RAM/VRAM)','ai.localDelete':'Delete downloaded weights from disk','ai.localDeleted':'Deleted model downloads: ','ai.localCached':'Model data downloaded in this browser: ',
    'ai.localCancel':'Cancel download / load',
    'ai.localList':'Downloaded models (manage)','ai.localNone':'No models downloaded yet.','ai.localRun':'Start (downloaded — no re-download)',
    'ai.localLoaded':'loaded','ai.localDelOne':'Delete','ai.localDelConfirm':'Delete the downloaded weights of "{n}" from this browser?',
    'ai.privacy':'Privacy: only the STRUCTURE is sent (paths, counts, sizes, languages) — never file contents. The key stays only in your browser.',
    'ai.analyze':'Analyze current structure','ai.working':'Analyzing structure…','ai.noProject':'Load a project first (CodeMap).','ai.empty':'No response.',
    'ai.autotune':'Auto-tune the view with AI on load','ai.autotuneHint':'After a project loads, AI chooses which Elements & Connections to show and the Figure params (node size, spacing, label size) so the map fits the project scale. Needs the key above; sends only the structure.',
    'ai.askHead':'Ask about the project','ai.askPlaceholder':'Ask about the project… e.g. where is the login logic?','ai.ask':'Ask AI','ai.asking':'Asking AI…','ai.askEmpty':'Type a question first.',
    'ai.layout':'✨ Let AI arrange the map','ai.layoutHint':'AI arranges the modules on its own — different every time, no preset layouts.','ai.layoutWorking':'AI is arranging the map…','ai.layoutDone':'AI arranged the map.',
    'tab.tutorial':'Tutorial','tab.spec':'Specification','tab.manual':'User manual','tab.about':'About',
    'lang.head':'Interface language','lang.desc':'Choose the application language. The whole interface is translated instantly and your choice is remembered.',
    'lang.pl':'Polski (Polish)','lang.en':'English',
    'app.head':'Appearance tuning','app.desc':'Full sliders for transparency, blur, colors and sizes live in the “Layers & filters” panel on the left. Here are quick shortcuts.',
    'app.theme':'Theme','app.theme.dark':'Dark','app.theme.light':'Light',
    'app.accent':'Accent color','app.open':'Open appearance panel','app.reset':'Restore default look',
    'app.reset.done':'Default look restored.',
    'install.head':'Installation & data','install.desc':'CodeMap is a PWA — you can install it on your desktop and use it offline. Your maps and settings are stored locally in the browser.',
    'install.install':'Install app','install.install.hint':'Add CodeMap as a standalone (offline) application.',
    'install.unavailable':'Install unavailable — the app is already installed or the browser did not offer a prompt. You can also use “Install” in the address bar.',
    'install.update':'Check for updates / reload','install.update.hint':'Fetches the latest version and refreshes the app.',
    'install.uninstall':'Clear offline cache','install.uninstall.hint':'Removes the service worker and cache. Maps and settings remain.',
    'install.uninstall.done':'Offline cache cleared. Refresh the page.',
    'install.wipe':'Delete all data','install.wipe.hint':'Permanently deletes snapshots, saved maps, mind maps, settings and language. Irreversible.',
    'install.wipe.confirm':'Really delete ALL data (snapshots, maps, settings)? This cannot be undone.',
    'install.wipe.done':'All application data deleted.',
    'tut.head':'Interactive tutorial','tut.desc':'An animated guide highlights each tool and button in turn and explains what it does. You can stop anytime with the Esc key.',
    'tut.start':'Start tutorial','tut.covers':'The tutorial shows: the logo, mode switch, Load menu, layout selector, search, Project menu, settings, side panels, filters, appearance, view tools, 3D with the mouse wheel, the compass (red needle), the neighborhood map/teleport, pinning the compass, the minimap, the details panel and the status bar.',
    'tut.startCode':'CodeMap tutorial','tut.startMind':'MindMap tutorial',
    'tut.coversMind':'The MindMap tutorial shows: the mode switch, the top bar (name + zoom), the board (double-click = new node), the tools rail (undo/redo, connect, auto-arrange, schemes & templates, fit), save & load, export, Markdown, the properties panel and the snapshot timeline.',
    'tut.shortcutsTitle':'Keyboard shortcuts',
    'tut.shortcuts':'<b>Ctrl + K</b> (on Windows also <b>Ctrl + ⊞ Win + K</b>) — <b>command palette</b> (quickly search and run any feature) · <b>Ctrl + V</b> — paste code · <b>F</b> — fit view · <b>Q / E</b> — rotate · <b>+ / −</b> — zoom · <b>I</b> — isolate selected · <b>Ctrl + Z / Ctrl + Y</b> — undo / redo (MindMap) · <b>Esc</b> — close / clear.',
    'tut.next':'Next','tut.prev':'Back','tut.skip':'Skip','tut.done':'Finish','tut.step':'Step',
    'about.head':'About','about.version':'Version','about.author':'Author','about.tech':'Technology',
    'about.tech.val':'Pure JavaScript (no frameworks, no build step), rendered on HTML5 Canvas, a PWA with a service worker. Works fully locally and offline.',
    'about.privacy':'Privacy','about.privacy.val':'All data stays in your browser. Files are never uploaded to any server (except when you explicitly fetch from GitHub/GitLab/Bitbucket).',
    'about.repo':'Author’s GitHub profile',
    // ---- tour steps ----
    'tour.brand.t':'CodeMap logo','tour.brand.b':'Click the logo to spin it (a playful touch, available every 10 seconds). It is also the app’s signature mark.',
    'tour.mode.t':'Mode switch','tour.mode.b':'Switch between <b>CodeMap</b> (code & dependency map) and <b>MindMap</b> (mind maps & diagrams). You can change mode anytime.',
    'tour.load.t':'Load menu','tour.load.b':'Load a project: a <b>folder from your device</b>, <b>individual files</b>, or a <b>GitHub/GitLab/Bitbucket repository</b>. You can also drag files onto the canvas or paste with Ctrl+V.',
    'tour.layout.t':'Layout selector','tour.layout.b':'Change how nodes are arranged — structural layouts (readable trees, packed circles), force-directed (dependency graph) and cosmic ones (nebula, galaxies).',
    'tour.search.t':'Search','tour.search.b':'Search files and paths. Matches are highlighted on the map; pick a result to jump straight to it.',
    'tour.project.t':'Project menu','tour.project.b':'Whole-project operations: save <b>snapshots</b> and their history, export the map to <b>.json</b> or an <b>image (PNG/SVG)</b>, detect <b>dependency cycles</b>, find <b>hotspots</b> and compare schemas.',
    'tour.settings.t':'Settings','tour.settings.b':'This gear opens settings — language, installation, this tutorial, and the full specification and user manual.',
    'tour.leftrail.t':'Side panel','tour.leftrail.b':'This handle collapses and expands the left panel with layers and filters. A matching handle on the right controls the details panel.',
    'tour.elements.t':'Elements & filters','tour.elements.b':'Toggle the visibility of folders, files and external dependencies — and of the connection types between them.',
    'tour.filetypes.t':'File types','tour.filetypes.b':'Each language/file type has its own color. You can hide selected types to focus the map on what matters.',
    'tour.complexity.t':'Complexity filter','tour.complexity.b':'Show only files above a threshold of the chosen metric (line count, complexity, function count, TODO markers, size). Great for finding “heavy” files.',
    'tour.appearance.t':'Appearance','tour.appearance.b':'Tune window transparency, glass blur, accent color, theme and background. The app is fully customizable.',
    'tour.map.t':'Map options','tour.map.b':'Toggle animations, flow particles, the background grid, curved connections and code preview on hover. You can also lock shapes here.',
    'tour.figures.t':'Shapes','tour.figures.b':'Adjust node size, distance between nodes and label size so the map stays readable for tiny and huge projects alike.',
    'tour.viewcontrols.t':'View tools','tour.viewcontrols.b':'Zoom in/out, fit to screen, rotate left/right and toggle pseudo-3D. The bar can be collapsed.',
    'tour.threed.t':'3D with the mouse wheel','tour.threed.b':'Press the <b>middle mouse button</b> and move <b>up / down</b> to smoothly and dynamically enter <b>3D</b> mode (perspective tilt) and back. The cube button on the toolbar does the same — it’s highlighted right now. (Rotate in 3D: middle or right mouse button.)',
    'tour.compass.t':'Compass — red needle','tour.compass.b':'Drag the <b>dial</b> to rotate the camera; the dial shows an <b>angle counter</b> (e.g. 0°). The <b>red needle</b> always points to the <b>centre of the main structure</b> on the map — so you always know the way “back to the project”, even when zoomed far out.',
    'tour.compasshood.t':'Neighborhood map (radar)','tour.compasshood.b':'<b>Double-clicking</b> the compass opens this <b>full neighborhood radar</b> — a miniature of every visible node. Scroll to zoom, and <b>double-click an item to teleport</b> straight to it on the map (there’s also a “Teleport to…” button). Great for jumping to a distant part of a large project.',
    'tour.compasspin.t':'Unpin & pin the compass','tour.compasspin.b':'The little <b>pin</b> button (top-left) <b>unpins</b> the compass; grab it by its <b>handle</b> (top) and move it <b>anywhere on screen</b>, then <b>pin</b> it back there with the same button. The other button collapses the compass.',
    'tour.minimap.t':'Minimap','tour.minimap.b':'An overview of the whole map with the current viewport marked. Helps navigate big projects; it can be collapsed.',
    'tour.details.t':'Details panel','tour.details.b':'After clicking an element you’ll see metrics, line composition, markers, imports, symbols (functions/classes) and a highlighted code preview here.',
    'tour.status.t':'Status bar','tour.status.b':'Project name, node and connection counts, the element under the cursor, the zoom level and a clock.',
    // ---- MindMap tour steps ----
    'tourmm.mode.t':'MindMap mode','tourmm.mode.b':"You're in <b>MindMap</b> mode — the mind-map and diagram editor. Use this switch to return to <b>CodeMap</b> anytime.",
    'tourmm.topbar.t':'Top bar','tourmm.topbar.b':'Name your mind map here and adjust the <b>zoom</b> (with +/− or the mouse wheel).',
    'tourmm.canvas.t':'The board','tourmm.canvas.b':'<b>Double-click</b> empty space to create a node, <b>double-click a node</b> to edit it, drag to pan. A quick-action <b>menu</b> surrounds the selected node (child, color, shape).',
    'tourmm.tools.t':'Tools rail','tourmm.tools.b':'Every mind-map tool in one place — the next steps cover the most useful ones.',
    'tourmm.undo.t':'Undo / redo','tourmm.undo.b':'Undo and redo changes (also with <b>Ctrl+Z</b> / <b>Ctrl+Y</b>).',
    'tourmm.connect.t':'Connecting nodes','tourmm.connect.b':'Turn on <b>connect mode</b> and click two nodes to link them with an edge.',
    'tourmm.arrange.t':'Auto-arrange','tourmm.arrange.b':'Automatically lays out the nodes (radially) — a quick tidy-up.',
    'tourmm.layout.t':'Schemes & templates','tourmm.layout.b':'Pick a <b>layout scheme</b>, line style and one of <b>22 diagram types</b> and 34 templates (timeline, flowchart, SWOT, kanban, code block and more).',
    'tourmm.fit.t':'Fit view','tourmm.fit.b':'Adjusts the zoom so the whole map fits on screen.',
    'tourmm.save.t':'Save & load','tourmm.save.b':'Save maps to device memory and load them later. Next to it: <b>export</b> to file, image (PNG/SVG) and import.',
    'tourmm.markdown.t':'Markdown','tourmm.markdown.b':'Import and export the map as a <b>Markdown outline</b> — easy exchange with your notes.',
    'tourmm.inspector.t':'Properties panel','tourmm.inspector.b':'With a node selected, tune its <b>text, color, shape, font</b> and links here. The handle beside it collapses the panel.',
    'tourmm.timeline.t':'Snapshot timeline','tourmm.timeline.b':'Saved snapshots line up on a <b>timeline</b> with an animated diff (added / changed / removed nodes).',
  }
  };
  function t(k){ const l=I.getLang(); const d=STR[l]||STR.pl; return (d&&k in d)?d[k]:(k in STR.pl?STR.pl[k]:k); }

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

  // ---------------- public API ----------------
  function wire(h){ handlers=h||{}; }

  function open(tab){
    build();
    if(tab) curTab=tab;
    showTab(curTab);
    overlay.classList.remove('hidden');
    document.body.classList.add('settings-open');
  }
  function close(){ if(overlay) overlay.classList.add('hidden'); document.body.classList.remove('settings-open'); }

  function build(){
    const lang=I.getLang();
    if(overlay && builtLang===lang) return;
    if(!overlay){
      overlay=el('div',{id:'settings-overlay',class:'hidden'});
      document.body.appendChild(overlay);
      overlay.addEventListener('mousedown',(e)=>{ if(e.target===overlay) close(); });
      window.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && !overlay.classList.contains('hidden') && !tourActive) close(); });
    }
    builtLang=lang;
    overlay.innerHTML='';
    const panel=el('div',{class:'set-panel'});
    panel.appendChild(el('div',{class:'set-head'},
      el('span',{class:'set-ic',html:ic.svg('settings',{size:18})}),
      el('h2',{text:t('title')}),
      el('span',{class:'tb-spacer'}),
      el('button',{class:'set-x',title:I.t('common.close'),html:ic.svg('x',{size:18}),onclick:close})));
    const bodyWrap=el('div',{class:'set-wrap'});
    const nav=el('div',{class:'set-nav'});
    const content=el('div',{class:'set-content'});
    const TABS=[['lang','settings'],['account','user'],['appearance','palette'],['ai','sparkle'],['install','download'],['shortcuts','keyboard'],['tutorial','play'],['spec','info'],['manual','book'],['about','layers']];
    TABS.forEach(([key,icon])=>{
      const b=el('button',{class:'set-tab'+(key===curTab?' active':''),'data-tab':key,
        html:ic.svg(icon,{size:16})+'<span>'+t('tab.'+key)+'</span>',onclick:()=>showTab(key)});
      nav.appendChild(b);
    });
    bodyWrap.appendChild(nav); bodyWrap.appendChild(content);
    panel.appendChild(bodyWrap);
    overlay.appendChild(panel);
    overlay._content=content;
    showTab(curTab);
  }

  function showTab(key){
    curTab=key;
    if(!overlay) return;
    overlay.querySelectorAll('.set-tab').forEach(b=>b.classList.toggle('active', b.getAttribute('data-tab')===key));
    const c=overlay._content; if(!c) return; c.innerHTML='';
    ({lang:tabLang, account:tabAccount, appearance:tabAppearance, ai:tabAI, install:tabInstall, shortcuts:tabShortcuts, tutorial:tabTutorial, spec:tabSpec, manual:tabManual, about:tabAbout}[key]||tabLang)(c);
    c.scrollTop=0;
  }

  function section(c, head, descKey){
    c.appendChild(el('h3',{class:'set-h3',text:head}));
    if(descKey) c.appendChild(el('p',{class:'set-desc',text:t(descKey)}));
  }

  function tabLang(c){
    section(c, t('lang.head'), 'lang.desc');
    const row=el('div',{class:'set-lang-row'});
    [['pl','🇵🇱'],['en','🇬🇧']].forEach(([code,flag])=>{
      const cur=I.getLang()===code;
      const b=el('button',{class:'set-lang'+(cur?' active':''),onclick:()=>{ I.setLang(code); }},
        el('span',{class:'set-lang-flag',text:flag}),
        el('span',{class:'set-lang-name',text:t('lang.'+code)}),
        cur?el('span',{class:'set-lang-chk',html:ic.svg('eye',{size:15})}):null);
      row.appendChild(b);
    });
    c.appendChild(row);
  }

  function tabAccount(c){
    section(c, t('acct.head'), 'acct.desc');
    try{ CM.Auth.renderAccount(c); }catch(e){}
  }

  function tabAppearance(c){
    section(c, t('app.head'), 'app.desc');
    // theme
    c.appendChild(el('div',{class:'set-label',text:t('app.theme')}));
    const trow=el('div',{class:'set-btn-row'});
    [['dark','app.theme.dark'],['light','app.theme.light']].forEach(([th,lbl])=>{
      trow.appendChild(el('button',{class:'tb-btn'+(document.body.classList.contains('light')?(th==='light'?' primary':''):(th==='dark'?' primary':'')),
        onclick:()=>{ const tb=document.querySelector('#theme-row .theme-btn[data-theme="'+th+'"]'); if(tb){ tb.click(); build(); showTab('appearance'); } },text:t(lbl)}));
    });
    c.appendChild(trow);
    // accent quick pick (mirror left-panel accents)
    c.appendChild(el('div',{class:'set-label',text:t('app.accent')}));
    const arow=el('div',{class:'set-acc-row'});
    ['#22d3ee','#7c5cff','#34d399','#fb7185','#f59e0b'].forEach(col=>{
      arow.appendChild(el('button',{class:'set-acc',style:'background:'+col,
        onclick:()=>{ const a=document.querySelector('#accent-row .acc[data-acc="'+col+'"]'); if(a) a.click(); }}));
    });
    c.appendChild(arow);
    // actions
    const act=el('div',{class:'set-btn-row set-mt'});
    act.appendChild(el('button',{class:'tb-btn',html:ic.svg('layers',{size:14})+' '+t('app.open'),
      onclick:()=>{ close(); if(handlers.openAppearancePanel) handlers.openAppearancePanel(); }}));
    act.appendChild(el('button',{class:'tb-btn',html:ic.svg('refresh',{size:14})+' '+t('app.reset'),
      onclick:()=>{ if(handlers.resetAppearance) handlers.resetAppearance(); U.toast(t('app.reset.done'),'success'); build(); showTab('appearance'); }}));
    c.appendChild(act);
  }

  function bigBtn(c, icon, label, hint, fn, danger){
    const b=el('button',{class:'set-big'+(danger?' danger':''),onclick:fn},
      el('span',{class:'set-big-ic',html:ic.svg(icon,{size:20})}),
      el('span',{class:'set-big-txt'}, el('b',{text:label}), el('span',{class:'set-big-hint',text:hint})));
    c.appendChild(b);
  }
  function tabInstall(c){
    section(c, t('install.head'), 'install.desc');
    bigBtn(c,'download',t('install.install'),t('install.install.hint'),()=>{
      if(handlers.canInstall && handlers.canInstall()){ handlers.installPWA&&handlers.installPWA(); }
      else U.toast(t('install.unavailable'),'',5000);
    });
    bigBtn(c,'refresh',t('install.update'),t('install.update.hint'),()=>{
      try{
        if(navigator.serviceWorker){ navigator.serviceWorker.getRegistration().then(r=>{ r&&r.update(); }).finally(()=>location.reload()); }
        else location.reload();
      }catch(e){ location.reload(); }
    });
    bigBtn(c,'power',t('install.uninstall'),t('install.uninstall.hint'),async()=>{
      if(handlers.uninstall) await handlers.uninstall(); U.toast(t('install.uninstall.done'),'success',5000);
    });
    bigBtn(c,'trash',t('install.wipe'),t('install.wipe.hint'),async()=>{
      if(confirm(t('install.wipe.confirm'))){ if(handlers.clearAllData) await handlers.clearAllData(); U.toast(t('install.wipe.done'),'success'); }
    }, true);
  }

  // ---------------- keyboard shortcuts cheatsheet ----------------
  function kbd(label){ return el('span',{class:'set-kbd',text:label}); }
  function scRow(grp, actLabel, keys, hint){
    const row=el('div',{class:'set-sc-row'});
    row.appendChild(el('div',{class:'set-sc-act'}, el('b',{text:actLabel}), hint?el('span',{class:'set-sc-hint',text:hint}):null));
    const kc=el('div',{class:'set-sc-keys'});
    keys.forEach((k,i)=>{
      if(typeof k==='string' && (k==='/'||k==='or'||k==='lub')){ kc.appendChild(el('span',{class:'set-sc-sep',text:k})); }
      else kc.appendChild(kbd(k));
    });
    row.appendChild(kc);
    grp.appendChild(row);
  }
  function scGroup(c, headKey){
    const g=el('div',{class:'set-sc-grp'});
    g.appendChild(el('div',{class:'set-sc-grp-h',text:t(headKey)}));
    c.appendChild(g);
    return g;
  }
  function tabShortcuts(c){
    section(c, t('sc.head'), 'sc.desc');
    const wrap=el('div',{class:'set-sc'});
    c.appendChild(wrap);
    // --- CodeMap navigation ---
    const nav=scGroup(wrap,'sc.grp.nav');
    const orSep = I.getLang()==='pl' ? 'lub' : 'or';
    scRow(nav, t('sc.move'), ['W','A','S','D']);
    scRow(nav, t('sc.zoomIn'), ['Space', orSep, '+']);
    scRow(nav, t('sc.zoomOut'), ['Shift', orSep, '−']);
    scRow(nav, t('sc.arrows'), ['←','↑','↓','→']);
    scRow(nav, t('sc.fps'), ['G'], t('sc.fpsHint'));
    scRow(nav, t('sc.fit'), ['F']);
    scRow(nav, t('sc.rotate'), ['Q','/','E']);
    scRow(nav, t('sc.resetRot'), ['R']);
    scRow(nav, t('sc.toggle3d'), ['T']);
    scRow(nav, t('sc.isolate'), ['I']);
    scRow(nav, t('sc.impact'), ['X']);
    // --- General ---
    const gen=scGroup(wrap,'sc.grp.general');
    scRow(gen, t('sc.search'), ['/']);
    scRow(gen, t('sc.altS'), ['Alt','+','S']);
    scRow(gen, t('sc.escape'), ['Esc']);
    // --- MindMap ---
    const mind=scGroup(wrap,'sc.grp.mind');
    scRow(mind, t('sc.del'), ['Delete','/','Backspace']);
    scRow(mind, t('sc.undo'), ['Ctrl','+','Z','/','Ctrl','+','Y']);
    scRow(mind, t('sc.edit'), [t('sc.dblclick')]);
  }

  function tabTutorial(c){
    section(c, t('tut.head'), 'tut.desc');
    const row=el('div',{class:'set-btn-row'});
    row.appendChild(el('button',{class:'tb-btn primary set-start',html:ic.svg('map',{size:15})+' '+t('tut.startCode'),
      onclick:()=>startTutorial('codemap')}));
    row.appendChild(el('button',{class:'tb-btn set-start',html:ic.svg('layers',{size:15})+' '+t('tut.startMind'),
      onclick:()=>startTutorial('mindmap')}));
    c.appendChild(row);
    c.appendChild(el('p',{class:'set-desc set-mt',text:t('tut.covers')}));
    c.appendChild(el('p',{class:'set-desc',text:t('tut.coversMind')}));
    c.appendChild(el('div',{class:'set-label set-mt',html:ic.svg('keyboard',{size:14})+' '+t('tut.shortcutsTitle')}));
    c.appendChild(el('p',{class:'set-desc',html:t('tut.shortcuts')}));
  }

  function renderDoc(c, doc){
    doc.forEach(([h,body])=>{
      c.appendChild(el('h4',{class:'set-doc-h',text:h}));
      c.appendChild(el('p',{class:'set-doc-p',html:body}));
    });
  }
  function tabSpec(c){ section(c, '', null); c.appendChild(el('h3',{class:'set-h3',text:t('tab.spec')})); renderDoc(c, (DOCS[I.getLang()]||DOCS.pl).spec); }
  function tabManual(c){ c.appendChild(el('h3',{class:'set-h3',text:t('tab.manual')})); renderDoc(c, (DOCS[I.getLang()]||DOCS.pl).manual); }

  function tabAI(c){
    section(c, t('ai.head'), 'ai.desc');
    // ---- provider: Mistral API (cloud) vs LOCAL in-browser model (WebLLM/WebGPU, free, no key) ----
    if(CM.LocalAI){
      const LA=CM.LocalAI;
      c.appendChild(el('div',{class:'set-label',text:t('ai.provider')}));
      c.appendChild(el('p',{class:'set-desc',text:t('ai.providerHint')}));
      const provSel=el('select',{class:'set-ai-input'});
      [['mistral',t('ai.provMistral')],['local',t('ai.provLocal')],['ollama',t('ai.provOllama')]].forEach(([v,n])=>{
        const o=el('option',{value:v,text:n}); if(v===LA.provider()) o.selected=true; provSel.appendChild(o); });
      c.appendChild(provSel);
      const localBox=el('div',{class:'set-localai'});
      c.appendChild(localBox);
      const ollamaBox=el('div',{class:'set-localai'});
      c.appendChild(ollamaBox);
      const renderOllama=async()=>{
        ollamaBox.innerHTML='';
        if(LA.provider()!=='ollama' || !CM.Ollama) return;
        ollamaBox.appendChild(el('p',{class:'set-desc',text:t('ai.ollamaDesc')}));
        const row=el('div',{class:'set-localai-row'});
        const baseInp=el('input',{class:'set-ai-input',style:'flex:1;min-width:0',value:CM.Ollama.base(),placeholder:CM.Ollama.DEF_BASE});
        const btn=el('button',{class:'tb-btn primary',html:ic.svg('refresh',{size:14})+' '+t('ai.ollamaCheck')});
        row.appendChild(baseInp); row.appendChild(btn); ollamaBox.appendChild(row);
        ollamaBox.appendChild(el('div',{class:'set-label set-mt',text:t('ai.ollamaModel')}));
        const mSel=el('select',{class:'set-ai-input'});
        const stat=el('div',{class:'set-localai-stat'});
        ollamaBox.appendChild(mSel); ollamaBox.appendChild(stat);
        const fill=async()=>{
          stat.className='set-localai-stat'; stat.textContent='…';
          try{
            const list=await CM.Ollama.models(true);
            mSel.innerHTML='';
            list.forEach(m=>{ const o=el('option',{value:m.name,text:m.name+(m.sizeGB?(' ('+m.sizeGB+' GB)'):'')}); if(m.name===CM.Ollama.model()) o.selected=true; mSel.appendChild(o); });
            stat.textContent=t('ai.ollamaOnline')+list.length; stat.className='set-localai-stat ok';
          }catch(e){ mSel.innerHTML=''; stat.textContent=(e&&e.message)||String(e); stat.className='set-localai-stat err'; }
          if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh();
        };
        mSel.onchange=()=>{ CM.Ollama.setModel(mSel.value); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); };
        btn.onclick=()=>{ CM.Ollama.setBase(baseInp.value); fill(); };
        baseInp.onchange=()=>CM.Ollama.setBase(baseInp.value);
        fill();
      };
      const renderLocal=async()=>{
        const tok=(renderLocal._tok=(renderLocal._tok||0)+1);                // race guard: the LAST call wins
        if(renderLocal._off){ renderLocal._off(); renderLocal._off=null; }   // drop the previous live-progress hook
        if(LA.provider()!=='local'){ localBox.innerHTML=''; return; }
        if(!LA.hasWebGPU()){ localBox.innerHTML=''; localBox.appendChild(el('p',{class:'drv-warn',text:t('ai.localNoGPU')})); return; }
        const dlmap=await LA.listDownloaded();   // ONLY models this engine build actually supports
        if(tok!==renderLocal._tok || !localBox.isConnected) return;          // superseded mid-await / tab closed
        localBox.innerHTML='';
        localBox.appendChild(el('div',{class:'set-label',text:t('ai.localModel')}));
        const mSel=el('select',{class:'set-ai-input'});
        dlmap.forEach(m=>{ const o=el('option',{value:m.id,text:(m.downloaded?'✓ ':'')+m.label}); if(m.id===LA.modelId()) o.selected=true; mSel.appendChild(o); });
        mSel.onchange=()=>{ LA.setModel(mSel.value); renderLocal(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); };
        localBox.appendChild(mSel);
        localBox.appendChild(el('p',{class:'set-desc',text:t('ai.localDlHint')}));
        const stat=el('div',{class:'set-localai-stat'});
        const bar=el('div',{class:'set-localai-bar'}, el('div',{class:'set-localai-fill'}));
        const dl=el('button',{class:'tb-btn primary',html:ic.svg('download',{size:14})+' '+t('ai.localDl')});
        const row=el('div',{class:'set-localai-row'}, dl);
        const unl=el('button',{class:'tb-btn',text:t('ai.localUnload'),onclick:async()=>{ await LA.unload(); renderLocal(); }});
        row.appendChild(unl);
        localBox.appendChild(row); localBox.appendChild(bar); localBox.appendChild(stat);
        bar.style.display='none';
        const showProg=(p)=>{ stat.className='set-localai-stat'; stat.textContent=(p&&p.text)||t('ai.localLoading');
          bar.style.display='block'; bar.firstChild.style.width=((p&&p.pct)||0)+'%'; };
        // ---- downloaded-models inventory: mark ✓, block re-download, per-model delete ----
        const listBox=el('div',{class:'set-localai-list'});
        localBox.appendChild(el('div',{class:'set-label set-mt',text:t('ai.localList')}));
        localBox.appendChild(listBox);
        const curDl=(dlmap.find(m=>m.id===LA.modelId())||{}).downloaded;
        const isReady=LA.status()==='ready';
        // main button: downloaded → "Uruchom" (loads from cache, NO re-download); loaded → disabled ✓
        if(isReady){ dl.innerHTML='✓ '+t('ai.localLoaded'); dl.disabled=true; stat.textContent=t('ai.localReady'); stat.className='set-localai-stat ok'; }
        else if(curDl){ dl.innerHTML=ic.svg('flow',{size:14})+' '+t('ai.localRun'); }
        else { dl.innerHTML=ic.svg('download',{size:14})+' '+t('ai.localDl'); }
        dl.onclick=async()=>{
          dl.disabled=true; mSel.disabled=true; unl.textContent=t('ai.localCancel');
          const off=LA.onProgress(showProg); showProg(LA.progress());   // LIVE % also for click-started loads
          try{ await LA.ensureEngine(); }
          catch(e){ if(!e||e.name!=='AbortError'){ stat.textContent=(e&&e.message)||String(e); stat.className='set-localai-stat err'; } }
          finally{ off(); }
          renderLocal(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh();
        };
        // a download/load is ALREADY running (started here earlier or from the ChatBot) →
        // re-attach: current % immediately, live updates, auto-refresh when it SETTLES (success
        // AND failure — hooking the promise, not the 'ready' status, so a failed load can't leak
        // the subscription). This makes the progress survive closing/reopening the AI tab.
        if(LA.status()==='loading'){
          dl.disabled=true; mSel.disabled=true; unl.textContent=t('ai.localCancel'); showProg(LA.progress());
          renderLocal._off=LA.onProgress(p=>{
            if(!localBox.isConnected){ if(renderLocal._off){ renderLocal._off(); renderLocal._off=null; } return; }
            showProg(p); });
          LA.ensureEngine().catch(()=>{}).then(()=>{
            if(renderLocal._off){ renderLocal._off(); renderLocal._off=null; if(localBox.isConnected) renderLocal(); } });
        }
        const dled=dlmap.filter(m=>m.downloaded);
        if(!dled.length){ listBox.appendChild(el('p',{class:'set-desc',text:t('ai.localNone')})); }
        else for(const m of dled){
          const r=el('div',{class:'set-localai-mrow'});
          r.appendChild(el('span',{class:'set-localai-mname',text:'✓ '+m.label}));
          if(m.id===LA.loadedId()) r.appendChild(el('span',{class:'set-localai-mtag',text:t('ai.localLoaded')}));
          const db=el('button',{class:'drv-btn drv-btn-sm drv-btn-danger',text:t('ai.localDelOne'),onclick:async()=>{
            if(!confirm(t('ai.localDelConfirm').replace('{n}',m.label))) return;
            db.disabled=true; await LA.deleteModel(m.id); renderLocal(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); }});
          r.appendChild(db);
          listBox.appendChild(r);
        }
      };
      provSel.onchange=()=>{ LA.setProvider(provSel.value); renderLocal(); renderOllama(); if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh(); };
      renderLocal(); renderOllama();
      c.appendChild(el('div',{class:'set-sep'}));
    }
    // ---- klucze API: dowolna liczba; dostawca wykrywany po formacie i potwierdzany testem (CM.AI) ----
    c.appendChild(el('div',{class:'set-label',text:t('ai.keys')}));
    c.appendChild(el('p',{class:'set-desc',text:t('ai.keysHint')}));
    const AI=CM.AI;
    const keysBox=el('div',{class:'set-ai-keys'}); c.appendChild(keysBox);
    const countEl=el('div',{class:'set-ai-keycount'}); c.appendChild(countEl);
    const addRow=el('div',{class:'set-ai-keyrow set-ai-keyadd'});
    const addInp=el('input',{class:'set-ai-input set-ai-keyinp',type:'password',placeholder:t('ai.keyPh'),autocomplete:'off',spellcheck:'false'});
    const addBtn=el('button',{class:'tb-btn primary set-ai-keybtn',type:'button',html:ic.svg('plus',{size:14})+' '+t('ai.keyAdd')});
    addRow.appendChild(addInp); addRow.appendChild(addBtn); c.appendChild(addRow);
    async function runTest(id, row){
      const st=row.querySelector('.set-ai-keystat'); if(st){ st.className='set-ai-keystat'; st.textContent=t('ai.keyTesting'); }
      row.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{ await AI.test(id); }
      catch(err){ AI.update(id,{status:{ok:false,at:Date.now(),error:(err&&err.message)||String(err)}}); }
      renderKeys();
    }
    function renderKeys(){
      if(!AI){ keysBox.textContent='CM.AI?'; return; }
      keysBox.innerHTML='';
      const list=AI.keys();
      if(!list.length) keysBox.appendChild(el('p',{class:'set-desc',text:t('ai.keyNone')}));
      for(const e of list){
        const card=el('div',{class:'set-ai-keycard'});
        const top=el('div',{class:'set-ai-keyrow'});
        const badge=el('span',{class:'set-ai-prov'+(e.status?(e.status.ok?' ok':' err'):''),text:e.provider?AI.providerName(e.provider):'?',title:e.provider||''});
        const inp=el('input',{class:'set-ai-input set-ai-keyinp',type:'password',value:e.key,autocomplete:'off',spellcheck:'false'});
        const eye=el('button',{class:'set-ai-keyeye',type:'button',title:t('ai.keyShow'),html:ic.svg('eye',{size:14}),onclick:()=>{ inp.type=inp.type==='password'?'text':'password'; }});
        const testBtn=el('button',{class:'tb-btn primary set-ai-keybtn',type:'button',html:ic.svg('refresh',{size:14})+' '+t('ai.keyTest')});
        const saveBtn=el('button',{class:'tb-btn set-ai-keybtn',type:'button',text:t('ai.keySave')}); saveBtn.disabled=true;
        const delBtn=el('button',{class:'tb-btn set-ai-keybtn danger',type:'button',html:ic.svg('trash',{size:14}),title:t('ai.keyDelete')});
        const commit=()=>{ const k=inp.value.trim(); if(!k){ U.toast(t('ai.keyEmpty'),'error'); return false; }
          if(AI.keys().some(x=>x.id!==e.id&&x.key===k)){ U.toast(t('ai.keyExists'),'error'); return false; }
          if(k!==e.key) AI.update(e.id,{key:k, provider:AI.detect(k)[0]||null, status:null, models:null, model:null});
          return true; };
        inp.oninput=()=>{ const dirty=inp.value.trim()!==e.key; saveBtn.disabled=!dirty; card.classList.toggle('dirty',dirty); };
        inp.onkeydown=(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); if(commit()){ U.toast(t('ai.keySaved'),'success'); renderKeys(); } } };
        saveBtn.onclick=()=>{ if(commit()){ U.toast(t('ai.keySaved'),'success'); renderKeys(); } };
        testBtn.onclick=()=>{ if(!commit()) return; runTest(e.id, card); };
        delBtn.onclick=()=>{ if(!confirm(t('ai.keyDeleteConfirm'))) return; AI.remove(e.id); U.toast(t('ai.keyDeleted')); renderKeys(); };
        top.appendChild(badge); top.appendChild(inp); top.appendChild(eye); top.appendChild(testBtn); top.appendChild(saveBtn); top.appendChild(delBtn);
        card.appendChild(top);
        // model per klucz: lista z testu (datalist) albo wolny wpis
        const mrow=el('div',{class:'set-ai-keyrow set-ai-keymodel'});
        mrow.appendChild(el('span',{class:'set-ai-keyidx',text:t('ai.keyModel')}));
        const dlId='ai-models-'+e.id; const dl=el('datalist',{id:dlId});
        (e.models||[]).forEach(mn=>dl.appendChild(el('option',{value:mn})));
        const minp=el('input',{class:'set-ai-input set-ai-keyinp',list:dlId,value:AI.modelFor(e),placeholder:t('ai.keyModel'),spellcheck:'false',autocomplete:'off'});
        minp.onchange=()=>{ AI.update(e.id,{model:minp.value.trim()||null}); };
        mrow.appendChild(minp); mrow.appendChild(dl); card.appendChild(mrow);
        const st=el('div',{class:'set-ai-keystat'+(e.status?(e.status.ok?' ok':' err'):'')});
        st.textContent = !e.status ? (e.provider ? (AI.providerName(e.provider)+' '+t('ai.keyDetected')) : t('ai.keyUnknownProv'))
          : e.status.ok ? ('✓ '+AI.providerName(e.provider)+' — '+t('ai.keyOk')+' · '+t('ai.keyModels')+(e.status.count||0)+' · '+(e.status.ms||0)+' ms')
          : ('✗ '+(e.status.error||''));
        card.appendChild(st);
        keysBox.appendChild(card);
      }
      const ok=list.filter(e=>e.status&&e.status.ok).length;
      countEl.textContent=t('ai.keysCount')+ok+' / '+list.length;
      if(CM.ChatBot&&CM.ChatBot.refresh) CM.ChatBot.refresh();
    }
    addBtn.onclick=()=>{ if(!AI) return; const k=addInp.value.trim(); if(!k){ U.toast(t('ai.keyEmpty'),'error'); return; }
      if(AI.keys().some(x=>x.key===k)){ U.toast(t('ai.keyExists'),'error'); return; }
      const e=AI.add(k); addInp.value=''; renderKeys();
      const cards=keysBox.querySelectorAll('.set-ai-keycard'); const card=cards[cards.length-1]; if(card) runTest(e.id, card); };
    addInp.onkeydown=(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); addBtn.onclick(); } };
    renderKeys();
    c.appendChild(el('p',{class:'set-desc set-mt',text:t('ai.privacy')}));
    // AI never runs automatically — only the manual, advisory "Analyze structure" below + the per-element
    // "Ask AI" box in the Details panel. AI does not touch the file layout or auto-adjust the view.
    const btn=el('button',{class:'tb-btn primary set-mt',html:ic.svg('sparkle',{size:15})+' '+t('ai.analyze')});
    const out=el('div',{class:'set-ai-out'});
    btn.onclick=async()=>{
      if(!handlers.aiHasProject || !handlers.aiHasProject()){ out.textContent=t('ai.noProject'); return; }
      btn.disabled=true; out.textContent=t('ai.working');
      try{ out.textContent=(await handlers.aiAnalyze())||t('ai.empty'); }
      catch(e){ out.textContent=(e&&e.message)||String(e); }
      btn.disabled=false;
    };
    c.appendChild(btn); c.appendChild(out);
    // ---- ChatBot feedback tally (👍/👎 aggregated across all conversations, persistent, never reset) ----
    c.appendChild(el('div',{class:'set-label set-mt',text:t('ai.votes')}));
    c.appendChild(el('p',{class:'set-desc',text:t('ai.votesHint')}));
    const v=(CM.ChatBot&&CM.ChatBot.votes)?CM.ChatBot.votes():{up:0,down:0};
    const vb=el('div',{class:'set-votes'});
    vb.appendChild(el('span',{class:'set-vote set-vote-up',html:'👍 <b>'+(v.up||0)+'</b> <span class="set-vote-lbl">'+t('ai.votesUp')+'</span>'}));
    vb.appendChild(el('span',{class:'set-vote set-vote-down',html:'👎 <b>'+(v.down||0)+'</b> <span class="set-vote-lbl">'+t('ai.votesDown')+'</span>'}));
    c.appendChild(vb);
    // NOTE: "Ask about the project" moved to the selected element's Details panel; "Arrange map via AI"
    // now runs automatically on load (when AI auto-tune is on) — both removed from Settings by design.
  }

  function tabAbout(c){
    section(c, t('about.head'), null);
    const grid=el('div',{class:'set-about'});
    const row=(k,v,html)=>{ grid.appendChild(el('div',{class:'set-about-k',text:k})); grid.appendChild(el('div',{class:'set-about-v',[html?'html':'text']:v})); };
    row(t('about.version'), (window.CM_VERSION||'1.0'));
    row(t('about.author'),'RaCzKoViC');
    row(t('about.tech'), t('about.tech.val'));
    row(t('about.privacy'), t('about.privacy.val'));
    c.appendChild(grid);
    c.appendChild(el('a',{class:'tb-btn set-mt',href:'https://github.com/RaCzKoViC',target:'_blank',rel:'noopener',
      html:ic.svg('globe',{size:14})+' '+t('about.repo')}));
  }

  // ---------------- interactive tutorial (spotlight coachmarks) ----------------
  const TOUR=[
    {sel:()=>$('.brand'), k:'tour.brand'},
    {sel:()=>$('#mode-switch'), k:'tour.mode'},
    {sel:()=>$('.tb-menu[data-menu="load"]'), k:'tour.load', before:()=>menu('load',true), after:()=>menu('load',false)},
    {sel:()=>$('.tb-menu[data-menu="layout"]'), k:'tour.layout'},
    {sel:()=>$('.search-wrap'), k:'tour.search'},
    {sel:()=>$('.tb-menu[data-menu="project"]'), k:'tour.project', before:()=>menu('project',true), after:()=>menu('project',false)},
    {sel:()=>$('#btn-settings'), k:'tour.settings'},
    {sel:()=>$('#rail-left'), k:'tour.leftrail', before:()=>panel('left',true)},
    {sel:()=>fb('#show-folders'), k:'tour.elements', before:()=>panel('left',true)},
    {sel:()=>fb('#lang-filters'), k:'tour.filetypes', before:()=>panel('left',true)},
    {sel:()=>fb('#sel-metric'), k:'tour.complexity', before:()=>panel('left',true)},
    {sel:()=>fb('#rng-trans'), k:'tour.appearance', before:()=>panel('left',true)},
    {sel:()=>fb('#opt-grid'), k:'tour.map', before:()=>panel('left',true)},
    {sel:()=>fb('#rng-nscale'), k:'tour.figures', before:()=>panel('left',true)},
    {sel:()=>$('#view-controls'), k:'tour.viewcontrols'},
    {sel:()=>$('#vc-3d'), k:'tour.threed', before:()=>{ const b=$('#vc-3d'); if(b) b.click(); }, after:()=>{ const b=$('#vc-3d'); if(b) b.click(); }},
    {sel:()=>$('#rot-dial'), k:'tour.compass'},
    {sel:()=>{ const h=$('#hood'); return (h && !h.classList.contains('hidden')) ? $('#hood-disc') : $('#rot-dial'); }, k:'tour.compasshood',
      before:()=>{ const d=$('#rot-dial'); if(d){ d.click(); d.click(); } },   // dial counts 2 clicks -> openHood
      after:()=>{ const c=$('#hood-close'); if(c) c.click(); }},
    {sel:()=>$('#rot-dial'), k:'tour.compasspin'},
    {sel:()=>$('#minimap-wrap'), k:'tour.minimap'},
    {sel:()=>$('#right-panel'), k:'tour.details', before:()=>panel('right',true)},
    {sel:()=>$('#statusbar'), k:'tour.status'},
  ];
  // MindMap tour — same engine, MindMap-specific targets (engine auto-skips any element not currently present)
  const TOUR_MM=[
    {sel:()=>$('#mode-switch'), k:'tourmm.mode'},
    {sel:()=>$('#mm-topbar'), k:'tourmm.topbar'},
    {sel:()=>$('#mm-canvas'), k:'tourmm.canvas'},
    {sel:()=>$('#mm-tools'), k:'tourmm.tools'},
    {sel:()=>$('#mm-undo'), k:'tourmm.undo'},
    {sel:()=>$('.mm-connect-btn'), k:'tourmm.connect'},
    {sel:()=>$('#mm-arrange'), k:'tourmm.arrange'},
    {sel:()=>$('#mm-layout'), k:'tourmm.layout'},
    {sel:()=>$('#mm-fit'), k:'tourmm.fit'},
    {sel:()=>$('#mm-save'), k:'tourmm.save'},
    {sel:()=>$('#mm-markdown'), k:'tourmm.markdown'},
    {sel:()=>$('#mm-inspector'), k:'tourmm.inspector'},
    {sel:()=>$('#mm-timeline'), k:'tourmm.timeline'},
  ];
  let tourActive=false, tourIdx=0, tourEls=null, steps=TOUR;
  function fb(s){ const e=$(s); return e?e.closest('.filter-block'):null; }
  function menu(name,open){ const m=$('.tb-menu[data-menu="'+name+'"]'); if(m) m.classList.toggle('open',!!open); }
  function panel(side,open){ if(handlers.ensurePanel) handlers.ensurePanel(side, open); }

  function buildTourDom(){
    const block=el('div',{class:'tut-block'});
    const hole=el('div',{class:'tut-hole'});
    const pop=el('div',{class:'tut-pop'});
    tourEls={block,hole,pop};
    document.body.appendChild(block); document.body.appendChild(hole); document.body.appendChild(pop);
    window.addEventListener('keydown', tourKey);
    window.addEventListener('resize', positionTour);
  }
  function tourKey(e){ if(!tourActive) return;
    if(e.key==='Escape'){ endTour(); }
    else if(e.key==='ArrowRight'||e.key==='Enter'){ tourStep(1); }
    else if(e.key==='ArrowLeft'){ tourStep(-1); }
  }
  function startTutorial(mode){
    close();
    if(tourActive) return;
    mode = mode || (document.body.classList.contains('mode-mindmap')?'mindmap':'codemap');
    steps = (mode==='mindmap') ? TOUR_MM : TOUR;
    const wantMM=(mode==='mindmap'), isMM=document.body.classList.contains('mode-mindmap');
    const begin=()=>{ tourActive=true; tourIdx=0; buildTourDom(); showTourStep(); };
    if(wantMM!==isMM){
      const b=document.querySelector('#mode-switch .mode-btn[data-mode="'+mode+'"]'); if(b) b.click();
      setTimeout(begin, 240);   // let the target mode's UI render before spotlighting it
    } else begin();
  }
  function tourStep(d){
    const cur=steps[tourIdx]; if(cur&&cur.after) try{cur.after();}catch(e){}
    tourIdx+=d;
    if(tourIdx<0) tourIdx=0;
    if(tourIdx>=steps.length){ endTour(); return; }
    showTourStep();
  }
  function showTourStep(){
    const step=steps[tourIdx];
    if(step.before) try{ step.before(); }catch(e){}
    // resolve element; skip missing/hidden ones in current direction
    let tries=0;
    while(tries<steps.length){
      const e=step2el(steps[tourIdx]);
      // present if rendered (has a box) — tolerant of elements still animating in (e.g. the radar)
      if(e && (e.getClientRects().length>0 || e.getBoundingClientRect().width>1)){ break; }
      tourIdx++; if(tourIdx>=steps.length){ endTour(); return; }
      const ns=steps[tourIdx]; if(ns.before) try{ns.before();}catch(e){}
      tries++;
    }
    renderTourPop();
    positionTour();
    setTimeout(positionTour, 40);   // after immediate layout
    setTimeout(positionTour, 340);  // after a panel open/slide transition settles
  }
  function step2el(step){ try{ return typeof step.sel==='function'?step.sel():$(step.sel); }catch(e){ return null; } }
  function renderTourPop(){
    const step=steps[tourIdx]; const pop=tourEls.pop; pop.innerHTML='';
    pop.appendChild(el('div',{class:'tut-step',text:t('tut.step')+' '+(tourIdx+1)+' / '+steps.length}));
    pop.appendChild(el('h4',{class:'tut-title',text:t(step.k+'.t')}));
    pop.appendChild(el('p',{class:'tut-body',html:t(step.k+'.b')}));
    const bar=el('div',{class:'tut-bar'});
    bar.appendChild(el('button',{class:'tb-btn tut-skip',text:t('tut.skip'),onclick:endTour}));
    bar.appendChild(el('span',{class:'tb-spacer'}));
    if(tourIdx>0) bar.appendChild(el('button',{class:'tb-btn',text:t('tut.prev'),onclick:()=>tourStep(-1)}));
    bar.appendChild(el('button',{class:'tb-btn primary',text: tourIdx===steps.length-1?t('tut.done'):t('tut.next'),onclick:()=>tourStep(1)}));
    pop.appendChild(bar);
  }
  function positionTour(){
    if(!tourActive||!tourEls) return;
    const el2=step2el(steps[tourIdx]); if(!el2) return;
    try{ el2.scrollIntoView({block:'nearest',inline:'nearest'}); }catch(e){}
    let r=el2.getBoundingClientRect();
    // if an open dropdown panel hangs off this element, include it in the spotlight
    const mp=el2.querySelector&&el2.querySelector('.menu-panel');
    if(mp && el2.classList.contains('open')){
      const pr=mp.getBoundingClientRect();
      const x1=Math.min(r.left,pr.left), y1=Math.min(r.top,pr.top), x2=Math.max(r.right,pr.right), y2=Math.max(r.bottom,pr.bottom);
      r={left:x1,top:y1,right:x2,bottom:y2,width:x2-x1,height:y2-y1};
    }
    const pad=8;
    const hx=Math.max(2,r.left-pad), hy=Math.max(2,r.top-pad);
    const hw=Math.min(innerWidth-4,r.width+pad*2), hh=Math.min(innerHeight-4,r.height+pad*2);
    Object.assign(tourEls.hole.style,{left:hx+'px',top:hy+'px',width:hw+'px',height:hh+'px'});
    // place pop: prefer below, else above, else right
    const pop=tourEls.pop; const pw=Math.min(360, innerWidth-24); pop.style.width=pw+'px';
    const ph=pop.offsetHeight||180;
    let px=Math.min(Math.max(12, r.left), innerWidth-pw-12);
    let py;
    if(hy+hh+ph+14 < innerHeight) py=hy+hh+12;
    else if(hy-ph-12 > 0) py=hy-ph-12;
    else py=Math.max(12, innerHeight-ph-12);
    Object.assign(pop.style,{left:px+'px',top:py+'px'});
  }
  function endTour(){
    if(!tourActive) return;
    const cur=steps[tourIdx]; if(cur&&cur.after) try{cur.after();}catch(e){}
    tourActive=false;
    window.removeEventListener('keydown', tourKey);
    window.removeEventListener('resize', positionTour);
    if(tourEls){ Object.values(tourEls).forEach(n=>n.remove()); tourEls=null; }
  }

  // rebuild on language change so settings & tour pop are translated
  I.onChange(()=>{ if(overlay){ build(); } if(tourActive){ renderTourPop(); positionTour(); } });

  return { open, close, wire, startTutorial, isTourActive:()=>tourActive };
})();
