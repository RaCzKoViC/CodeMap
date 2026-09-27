# Historia zmian

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie [SemVer](https://semver.org/lang/pl/).
Numer wersji aplikacji: `CM.VERSION` w `js/util.js` (Ustawienia → O aplikacji).

## [Unreleased]

### Dodane — Faza 9 (dowód, że mapa mówi prawdę)
- **Korpus referencyjny** (`tools/corpus.mjs`, `npm run corpus`): sześć repozytoriów z galerii przypiętych do wydań
  (Express 5.2.1, Preact 10.29.8, ky 2.1.0, petite-vue 0.4.1, Flask 3.1.3, Gin 1.12.0) — krawędzie importów z CLI
  CodeMap porównane z wyrocznią ekosystemu: esbuild (metafile, resolver z tsconfig i package.json), grimp (graf
  modułów Pythona, jak import-linter) i `go list -json` (Go, poziom pakietów). Precyzja i kompletność per
  repozytorium, lista rozbieżności, `--json`, tabela w podsumowaniu CI; nowe zadanie CI `corpus` z progiem 97 % i
  `--require-all` (pominięta wyrocznia = błąd). Wynik lokalnie: 5/5 repozytoriów 100 % / 100 % (273 krawędzie).
- **Krawędzie `typeOnly`**: `import type` / `export type … from` (TypeScript) oznaczone na krawędzi (zapis mapy i
  wczytanie zachowują flagę); zwykły import tej samej pary plików ją zdejmuje. Korpus porównuje je z esbuildem
  uczciwie (esbuild usuwa `import type` z definicji).
- **Próg regresji benchmarku**: `tools/bench.mjs --baseline poprzedni.json --tolerance 1.5` — regres, gdy wczytanie
  albo najlepsza klatka jest wolniejsza niż 1,5× poprzedniego wyniku i o więcej niż 500 ms / 10 ms (szum runnera: ±8 %
  wczytania, 1–5 ms klatki); w CI punktem odniesienia jest artefakt `bench` ostatniego zielonego przebiegu main,
  porównanie trafia do podsumowania.

### Zmienione — precyzja reguł Inspect (fałszywe alarmy z analizy samego CodeMap)
- **Duplikaty = ciągłe bloki**: para plików tylko z ciągłym wspólnym blokiem ≥ 50 tokenów (odciski winnowing z
  pozycjami, wyrównanie po przekątnej — jak jscpd), a nie suma rozsianych wspólnych idiomów; opis „tokeny: N,
  bloki: K". Tylko kod: dokumenty (README i jego tłumaczenie), konfiguracje, dane i pliki generowane odpadają.
  Na repozytorium CodeMap: 78 par → 28, każda z prawdziwym blokiem.
- **Pliki generowane** (`Metrics.isGenerated`): lockfile albo znacznik w nagłówku (`@generated`, `DO NOT EDIT`,
  `auto-generated`, `GENEROWANE`) — poza regułą „ogromny plik" i duplikatami.
- **„God" = hub**: duży stopień i jednocześnie fan-in ≥ 3 oraz fan-out ≥ 3 (hub-like modularization); plik
  wejściowy z samym fan-out (index.html) to „fan-out", a pomocnik testów z samym fan-in nie jest zgłaszany.
- **Ryzyko**: `innerHTML = ''` (czyszczenie elementu) i porównania nie liczą się jako wstawianie HTML.
- **Cykle bez dokumentacji**: linki README.md ↔ README.pl.md to nawigacja, nie cykl zależności (także `noCycles`).
- Wynik zdrowia CodeMap: 45 → 53 bez zmian w kodzie aplikacji (same poprawki reguł; `test/inspect.test.mjs`).

### Poprawione — rozbieżności znalezione korpusem
- **TypeScript ESM (NodeNext)**: `import './x.js'` w źródle .ts wskazuje `x.ts` / `x.tsx` (`.mjs` → `.mts`,
  `.cjs` → `.cts`) — w ky CodeMap nie widział żadnej z 50 krawędzi.
- **Python — biblioteka standardowa**: `import typing` / `import json` wewnątrz pakietu to stdlib, a nie
  `flask/typing.py` czy `flask/json/` (Python 3 nie ma importów względnych bez kropki); lokalny moduł o nazwie z
  stdlib wchodzi w grę tylko w korzeniu źródeł (katalogu bez `__init__.py`). Flask: precyzja 57 % → 100 %.
- **Python — `from . import x`**: krawędź do podmodułu `x.py`; do `__init__.py` pakietu tylko wtedy, gdy któraś
  nazwa jest symbolem, a nie podmodułem (jak grimp / import-linter).
- **Go z `go.mod`**: import z prefiksem ścieżki modułu → dokładny katalog pakietu (korzeń modułu też); każda inna
  ścieżka to stdlib albo zależność — dawniej `encoding/json` trafiał do dowolnego katalogu `…/json` w projekcie.
- **Go — nazwy zależności zewnętrznych** = ścieżka modułu jak w `go.mod` (`github.com/gin-gonic/gin`,
  `golang.org/x/net`, `…/validator/v10`) zamiast jednego zbiorczego „github"; wersje z `go.mod` wreszcie się łączą.

## [1.4.0] — 2026-09-27

Jakość własna i bezpieczeństwo (faza 8): egzekwowane CSP, SRI, podział trzech największych plików, testy renderera
i ChatBota, dług z faz 1–3; galeria przykładów, paczka npm CLI; wybór PR z listy (faza 5) — [docs/ROADMAP.md](docs/ROADMAP.md).

### Dodane — Faza 5 (dokończenie)
- **Wybór PR z listy**: okno „Przegląd PR…" pokazuje otwarte pull / merge requesty repozytorium (`GitRemote.listPRs` — GitHub,
  GitLab, Bitbucket, jedno zapytanie, najświeższe pierwsze) z autorem, czasem i oznaczeniem szkicu; kliknięcie uruchamia
  analizę. Sprawdzone na preactjs/preact (24 otwarte PR); test na podstawionym fetch dla trzech hostingów.

### Dodane — Faza 8 (społeczność)
- **Galeria przykładowych repozytoriów** (`js/gallery.js`): 9 małych projektów open source w 7 językach (Express,
  Preact, ky, petite-vue, Flask, Gin, serde json, Gson, Rake — 53–313 plików), karty z opisem, liczbą plików
  i językiem; „Otwórz" (deep-link `#repo=`, z podkatalogiem dla Flask / Gson / Rake), „🧭 Z trasą" (po wczytaniu
  trasa automatyczna), kopiowanie linku. Wejścia: „Przykłady" na ekranie startowym, Wczytaj → „Przykładowe
  repozytoria…", akcja ChatBota `gallery {repo?, tour?}`. Sprawdzone na petite-vue z GitHuba: 53 pliki, trasa 7 kroków.
  Tarcza obrotu chowa się, gdy trasa jest aktywna (nachodziła na kartę kroku).

- **Paczka npm CLI gotowa do publikacji** (`tools/npm-pack.mjs`, `npm run npm-pack -- --name @zakres/codemap`): CLI + tylko
  17 modułów analizy (29 plików, 167 KB), `npm pack`, instalacja tarballa w pustym projekcie i uruchomienie
  zainstalowanego `codemap analyze` (wykrywa cykl na próbce). Nazwa `codemap` w npm jest zajęta — publikacja pod
  zakresem właściciela (`npm publish dist/npm/<plik>.tgz --access public`).

### Zmienione — Faza 8 (jakość własna)
- Historia git: **zmiana nazwy z edycją** (jak `git log -M`, próg 50 %) — pary usunięty × dodany w commicie porównywane
  po liniach (wielozbiór skrótów, bez białych znaków; tylko tekst ≤ 1 MB), zachłannie od najlepszej pary; pole
  `similarity` przy R. Autorzy, zmiany i hotspoty idą za plikiem także po przeniesieniu z edycją. Limity: 400 par
  na commit, 4000 odczytów blobów na historię. Test: zbiór zmian nazw zgodny z `git log -M` na repozytorium testowym.
- **Wersjonowanie ustawień** (`js/prefs.js`, `codemap_settings._v = 2`): migracja przy odczycie — `_menuTint` → `_menuRgb`,
  układ spoza listy (także 20 usuniętych) → `pack`, pola po usuniętych kontrolkach wypadają; dotyczy też bloba z synchronizacji
  z innego urządzenia. Sprawdzone na starym blobie w przeglądarce; 3 testy.
- **Podział `chatbot.js`** (1373 → 694 linie): `chatbot-strings.js` (teksty PL/EN), `chatbot-core.js` (`CM.ChatBotCore` — logika
  bez DOM: katalog narzędzi, prompty, parsowanie i walidacja akcji, `/` komendy, `intentFallback`), `chatbot-render.js`
  (markdown, wiadomości, źródła, kroki agenta, menu `/`, uchwyty okna); API `CM.ChatBot` bez zmian; 28 testów logiki.
- **Podział `mindmap.js`** (1707 → 719 linii): `mindmap-strings.js`, `mindmap-templates.js` (16 ramek, 34 diagramy, miniatury),
  `mindmap-layout.js` (algorytmy układu, okno „Schemat układu"), `mindmap-io.js` (Markdown w obie strony, .mindmap.json,
  SVG/PNG, migawki), `mindmap-ui.js` (widżety); stan przekazywany jawnie przez `ctx`; API `CM.MindMap` bez zmian;
  Markdown, SVG i pozycje węzłów identyczne jak przed podziałem; 16 testów (każdy diagram i ramka, round-trip Markdown).
- **Podział `settings.js`** (946 → 392 linie): `settings-strings.js`, `settings-ai.js` (zakładka AI z RAG), `settings-docs.js`
  (Specyfikacja, Instrukcja); rejestr zakładek `CM.Settings.addTab(key, icon, render)` ze stałą kolejnością, wspólne
  helpery w `CM.Settings.kit`; HTML wszystkich 23 widoków zakładek identyczny jak przed podziałem; 10 testów.
- Poprawka: „pokaż hotspoty" / „zmień motyw…" wykonują się od razu (bez modelu) — `\b` w wyrażeniu JS nie widział granicy
  słowa po „ż" / „ń"; teraz granice z klasami Unicode (`\p{L}`).
- Analiza: **`package.json#imports`** (subpath imports Node, `import x from '#utils/log'`) — najbliższy `package.json`
  nad plikiem z polem `imports`, dokładny klucz albo wzorzec `#x/*`, warunki jak w `exports`; cel spoza projektu
  (nazwa pakietu) bez krawędzi. `#x` w JS nie jest już odrzucany jako kotwica (w HTML / CSS nadal jest).
- Usunięte 20 układów nieosiągalnych z interfejsu, ChatBota i linków (tree, radial, grid, honeycomb, vortex…):
  `layouts.js` 899 → ~400 linii; test pilnuje, że lista w UI = układy obsługiwane przez `apply` (bez martwych
  i brakujących). Zapisany widok z usuniętym układem przywraca się z bieżącym (nieznana nazwa jest pomijana).
- Testy renderera (`test/renderer.test.mjs`, 9): kamera świat ↔ ekran przy obrocie i pochyleniu, pamięć macierzy,
  przybliżanie z punktem pod kursorem, trafianie węzłów (billboard przy pochyleniu) i krawędzi (prosta / łuk), `fit`
  z panelami, wybór backendu bez WebGL, rysowanie na atrapie kontekstu, eksport SVG z escapowaniem.
- Escapowanie HTML z jednego miejsca: `U.escapeHtml` (tekst i atrybuty) i `U.escapeText` (sam tekst, dla kolorowania
  składni) zamiast 8 lokalnych kopii w `ui.js`, `chatbot.js`, `drive.js`, `repo-hosts.js`, `mindmap.js`, `renderer.js`.

### Bezpieczeństwo — Faza 8
- **CSP egzekwowane** z `<meta>` w `index.html` (GitHub Pages nie ustawia nagłówków): skrypty tylko z tej strony
  i z esm.run / jsDelivr, bez inline / `on…=` / `eval`, `wasm-unsafe-eval` dla WASM, `object-src 'none'`,
  `base-uri 'self'`, ramki tylko własne; `connect-src` celowo szeroki (dostawcy AI, własna Ollama, API repozytoriów).
  Sprawdzone pod polityką: Runner, graf symboli (tree-sitter), rough.js, embeddingi WebLLM (worker z `blob:`),
  Ollama, renderer WebGL — zero naruszeń. Rozszerzenie VS Code usuwa tę metę (ma własną z nonce).
- **Runner przez `runner.html`**: `<iframe srcdoc>` dziedziczyłby CSP aplikacji, więc kod z ChatBota trafia przez
  `postMessage` (po sygnale „ready") do strony pośredniej z własną polityką, a tam do zagnieżdżonej ramki
  w piaskownicy bez `allow-same-origin`; „otwórz w nowej karcie" — ta sama strona zamiast dokumentu `blob:`.
  `runner.html` w precache service workera, na liście plików serwera dev i w `tools/deploy.ps1`.
- **SRI dla tree-sitter**: `tools/sri.mjs` przypina SHA-384 dla `tree-sitter.js`, `tree-sitter.wasm` i 12 gramatyk
  (`js/sri.js`); worker sprawdza bajty przed wykonaniem (skrypt z `blob:`, WASM przez `wasmBinary` /
  `Language.load(bytes)`), tryb bez workera — natywny `integrity`. CI: `node tools/sri.mjs --check`.
- `deploy/Caddyfile`: CSP w nagłówku egzekwowane (+ `frame-ancestors 'self'`, bez `runner.html`),
  `X-Frame-Options: SAMEORIGIN` (DENY blokowałby Runnera), report-only z wąską listą hostów zostaje do obserwacji.
- Testy: SRI (manifest, podmiana, adres spoza listy), webview VS Code (jedna polityka), krok smoke „CSP + Runner".

## [1.3.0] — 2026-09-27

Skala i lokalne AI: rysowanie na GPU, pamięć analizy, folder na żywo po przeładowaniu (faza 6) oraz agent kodu —
narzędzia w pętli, Doktor hotspotów, trasy po kodzie, embeddingi w przeglądarce (faza 7) — [docs/ROADMAP.md](docs/ROADMAP.md).

### Dodane — Faza 7 (agent z narzędziami)
- Agent: narzędzie widokowe **`showOnMap {paths}`** — podświetla pliki, o których jest odpowiedź, i ustawia na nich
  kamerę (tylko widok, bez zmian w danych); prompt zachęca, by pokazywać pliki. qwen3:8b na „Które pliki importują
  format.js? Pokaż je na mapie.": `dependents` → `showOnMap` → poprawna odpowiedź z podświetleniem, 16 s.
- **Embeddingi w przeglądarce (WebLLM)** — semantyczny RAG bez Ollamy: `CM.LocalAI.embed()` na osobnym silniku
  w workerze (niezależnym od modelu czatu), modele typu embedding z konfiguracji WebLLM (`snowflake-arctic-embed-s/-m`,
  partie `-b4` / `-b32`, tekst ucięty do okna 512 tokenów). RAG: lista modeli z obu źródeł (🌐 = w przeglądarce, z VRAM),
  jedno miejsce liczenia wektorów dla indeksu i zapytań; Ollama nadal domyślna (bge-m3 lepszy po polsku). Sekcja
  „Indeks kodu (RAG)" w Ustawieniach → AI jest teraz też przy WebLLM (wspólna `ragSection`), z postępem ładowania
  modelu. Sprawdzone na RTX 4060: indeks demo 18,8 s z pobraniem modelu, zapytanie hybrydowe ~28 ms.
- **🧭 Trasy po kodzie** (`js/tour.js`, `js/tour-ui.js`; Projekt → „Trasa po kodzie…"): trasa automatyczna ze struktury
  (opis → punkty wejścia — importy przychodzące liczone tylko z kodu → rdzeń wg liczby zależnych → hotspot → testy
  rdzenia; bez importów po jednym pliku z największych folderów) albo ułożona przez model z samej struktury (ścieżki,
  metryki, zależności, nazwy symboli — także model w chmurze; odpowiedź JSON walidowana, zła → trasa automatyczna).
  Odtwarzacz: karta kroku z notatką i kropkami, kamera na pliku, podświetlenie trasy, ponumerowane kroki ze strzałkami
  (dekorator — działa też na GPU), ← / → / Esc, klik w ścieżkę otwiera plik. Notatki edytowalne w oknie trasy; trasa
  zapisuje się w mapie (`graph.tour`), eksport / import **VS Code CodeTour** (`.tour`), link `#tour=…` (deflate +
  base64url; sam — na bieżącą mapę, albo z `#repo=` / `#gist=` / `#share=` — po wczytaniu mapy; limit hasha 8192).
  Akcja ChatBota `codeTour {action}`. Na qwen3:8b trasa z AI dla CodeMap: 9 kroków w 22 s. 6 testów + 1 deep-linków,
  krok smoke.
- **🩺 Doktor hotspotów** (`js/doctor.js`, `js/doctor-ui.js`): plan refaktoryzacji jednego pliku liczony modelem
  lokalnym. Kartoteka pliku (linie, złożoność, liczba funkcji, miejsce w rankingu ryzyka — z git częstość zmian ×
  złożoność, bez git rozmiar × zależne × złożoność — zmiany i autorzy, testy i pokrycie, pliki zależne bezpośrednio
  i pośrednio) + ponumerowane fragmenty najdłuższych funkcji (budżet dzielony równo, całe linie); prompt z czterema
  stałymi sekcjami: diagnoza, 3–5 małych kroków z cytatami `[n]`, testy przed zmianą, ryzyko (bez zgadywania zależnych
  i autorów spoza kartoteki). Wejścia: sekcja „Doktor hotspotów" w panelu pliku (miejsce w rankingu + przycisk
  „🩺 Plan refaktoryzacji"), akcja `hotspotDoctor {query?}` (domyślnie czoło rankingu). Nowa rozmowa „🩺 plik" w ChatBocie,
  cytaty i źródła jak w trybie 📚 (`runRag` przyjmuje własne przygotowanie kontekstu); model w chmurze → komunikat
  o modelach lokalnych. Sprawdzone na qwen3:8b: 30–40 s, każdy krok cytuje właściwy fragment. 6 testów, krok smoke.
- **Agent kodu w trybie 📚 z Ollamą** (`js/agent.js`): gdy fragmenty z RAG nie wystarczą, model sam woła narzędzia
  tylko do odczytu — `codeSearch`, `readFile` (do 150 linii), `findFiles`, `dependencies`, `dependents`,
  `fileInfo`, `hotspots`, `owners` (autorzy i bus factor z git), `tests` (testy pliku, folderu, najbardziej złożone
  pliki bez testów) — na grafie i kodzie wczytanego projektu, najwyżej 5 kroków, potem odpowiedź bez narzędzi.
  Natywne `tool_calls` (Llama 3.x, Qwen 3) albo JSON wywołania w treści (Qwen 2.5 Coder, także z opisem narzędzia
  zamiast nazwy); wymyślone narzędzie → model dostaje listę prawdziwych, powtórzone wywołanie nie jest wykonywane
  drugi raz, błąd narzędzia wraca do modelu jako `error: …`; odpowiedź-wymówka („trzeba by zajrzeć do pliku…")
  → jedno ponaglenie do użycia narzędzia. Wyniki `codeSearch` / `readFile` numerowane `[n]` wspólnie
  z fragmentami, więc cytaty i klik w źródło działają jak w RAG; kroki w zwijanej liście „🔧 Kroki agenta".
  Model bez obsługi narzędzi → zwykły tryb 📚. Przełącznik w Ustawieniach → AI → Ollama.
- `CM.Ollama.chatTools()` (wywołanie `/api/chat` z `tools`, bez strumienia, `think:false`), 12 testów pętli i narzędzi
  ze skryptowanym modelem, krok smoke w przeglądarce.

### Dodane — Faza 6 (skala: rysowanie na GPU)
- **Renderer WebGL2** (`js/gl-layer.js`): osobny `<canvas>` pod mapą 2D; tło, siatka, wszystkie krawędzie (łuki
  liczone w shaderze z tym samym punktem kontrolnym co w canvas, grubość w px z wygładzaniem, linie przerywane
  i kropkowane, nakładki wpływu, cykli i wybranej krawędzi) oraz figury (koła z obwódką, romby symboli, poświata
  „cosmic") jako instancje; kamera to uniform, więc przesuwanie i przybliżanie nie przebudowuje buforów
  (przebudowa po zmianie danych, kolorów, podświetlenia albo pozycji — podpis liczony co klatkę). Etykiety,
  pierścienie zaznaczenia, strzałka krawędzi i dekoratory modułów zostają na przezroczystym canvas 2D, eksport PNG
  też. Tryb automatyczny od 3000 widocznych węzłów + krawędzi, wybór w lewym panelu → Mapa („Rysowanie mapy")
  i przez `renderOption {backend}`; utrata kontekstu albo błąd GL → canvas 2D. Gęste zależności są wygaszane według
  pokrycia pikseli w oknie (długość krawędzi przyciętych do okna / pole mapy) zamiast pomijane jak w LOD canvas.
  20 tys. plików / 60 tys. krawędzi: ~1–2 ms na klatkę (canvas 2D 30–150 ms).
- **Pamięć analizy w OPFS** (`js/analysis-cache.js`): wyniki analizy plików (metryki, importy, symbole — bez treści)
  zapamiętane per projekt (gzip, indeks, najwyżej 12 projektów / 200 MB, najstarsze wypadają), unieważniane stemplem
  wersji zasobów. Niezmieniony plik — ten sam rozmiar i data modyfikacji z dysku albo sha bloba git — nie jest
  analizowany ani nawet haszowany; zgodny sam rozmiar → worker porównuje skrót treści. Ponowne wczytanie 2800 plików:
  analiza 2,4 s → 0,05 s (całość 2,6 → 0,2 s); zmiana jednego pliku analizuje tylko ten plik. Ustawienia → Instalacja
  → „Wyczyść pamięć analizy" (z liczbą projektów i rozmiarem); „Usuń wszystkie dane" też ją czyści. Zapis
  zaplanowany przed czyszczeniem jest porzucany (epoka), więc pamięć nie odradza się po „Wyczyść".
- **Wznowienie folderu na żywo po przeładowaniu** (`js/live.js`): uchwyt folderu zapamiętany w IndexedDB
  (`codemap-live`); po przeładowaniu strony pasek stanu pokazuje „↻ Wznów na żywo: nazwa” (kliknięcie = gest,
  którego przeglądarka wymaga do ponownej zgody na odczyt) i „×” (nie wznawiaj); zakończenie obserwacji, wczytanie
  innego projektu albo „Wyczyść” zapominają folder; akcja ChatBota `liveResume`.
- **Analiza w kilku workerach naraz** (do 4, pliki rozdzielone po rozmiarze od największych): pierwsze wczytanie
  ok. 2,3× szybsze niż w jednym workerze (pomiar: 1 → 5,9 s, 4 → 2,6 s; 8 workerów nie przyspiesza).
- `tools/bench.mjs` (`npm run bench`): syntetyczne projekty 5k / 20k plików, wczytanie + klatka z wymuszoną
  rasteryzacją dla obu backendów, `--json`, `--summary`, `--max-frame`; krok informacyjny w CI z artefaktem.
- Kroki smoke: demo wymuszone na GPU — piksel w środku węzła ma kolor węzła, hit-test i eksport PNG działają;
  pamięć analizy — drugie wczytanie bez analizy i bez workerów, zmieniony plik od nowa, graf identyczny.

### Poprawione
- Analiza: ścieżka z `?zapytaniem` albo `#kotwicą` (`<script src="js/a.js?v=…">`, Vite `./a.svg?raw`, `?worker`) nie
  rozwiązywała się do pliku — w samym CodeMap 48 skryptów z `index.html` było fałszywie „osieroconych" (teraz 1: `sw.js`).

### Zmienione
- Kamera: `toScreen` bez sklejania klucza z liczb i bez `DOMPoint` (`cam.xf()` = współczynniki jako liczby),
  etykiety odrzucają za małe węzły przed liczeniem pozycji — klatka canvas 2D przy 20 tys. węzłów 74 → 32 ms.
- RAG: plik wymieniony w pytaniu z nazwy (`co robi agent.js…`), którego wyszukiwanie nie zwróciło, dostaje dwa
  najlepsze fragmenty na początku kontekstu (`CM.RAG.mentionedFiles`).

## [1.2.0] — 2026-09-27

Rozszerzenie VS Code (domknięcie fazy 4), przegląd zmian w PR (faza 5), folder na żywo (faza 6), README po angielsku
i jakość własnego kodu (faza 8) — [docs/ROADMAP.md](docs/ROADMAP.md).

### Dodane — Faza 4 (rozszerzenie VS Code)
- **Rozszerzenie VS Code** (`integrations/vscode/`, v0.1.0, VS Code ≥ 1.90): analiza workspace (kopia CLI w wątku
  roboczym, anulowanie) → diagnostyki w Problems z progiem ważności, kodem reguły i powiązanymi plikami; health
  score w pasku stanu; CodeLens nad hotspotami git; mapa w panelu webview (CSP z nonce, ścieżki zapasowe bez
  Workerów) z nawigacją edytor ↔ mapa; analiza przy zapisie (debounce 1,5 s); 37 testów z atrapą `vscode`
  i smoke webview w headless Chrome. W aplikacji: `js/vscode-bridge.js`, hak `A.ctxExtra` w menu kontekstowym,
  w webview bez service workera i bez `/api`.

### Dodane — Faza 6 (tryb na żywo)
- **Folder na żywo** (`js/live.js`, Wczytaj → „Folder na żywo"): uchwyt katalogu z File System Access, obserwacja
  przez `FileSystemObserver` (wyzwalacz) + skan dat modyfikacji co 2,5–15 s (siatka bezpieczeństwa, tylko przy
  widocznej karcie); zmienione i nowe pliki czytane i analizowane w workerze (wyniki niezmienionych z poprzedniego
  grafu), graf przebudowany z zachowaniem pozycji, zwinięć, zaznaczenia, kamery, nakładki i danych git / testów /
  PR; zmiany świecą na mapie (3 s), znacznik „NA ŻYWO" z pauzą i zatrzymaniem na pasku stanu; nowy commit
  (`.git/HEAD`, `logs/HEAD`) przelicza historię git; ChatBot `liveFolder`, `liveStop`. Test w smoke na OPFS.

### Dodane — Faza 5 (przegląd zmian)
- **Mapa wpływu PR** (`js/pr-core.js`, `js/pr.js`): Projekt → „Przegląd PR…" (numer albo adres PR / MR
  z GitHub, GitLab, Bitbucket; PR z innego repozytorium wczytuje najpierw to repozytorium) i link
  `#repo=…&pr=N`. Zmienione pliki z API hostingu, pliki zależne (odwrotny BFS po importach, do 3 poziomów),
  ryzyko każdej zmiany 0–100 (częstość zmian, złożoność — tylko kod, zależni, testy / pokrycie — tylko kod,
  rozmiar zmiany, znajomość pliku przez autora), sugerowani recenzenci z własności plików; nakładka „Wpływ PR"
  z legendą, znaczniki A/M/D/R na węzłach, karta PR i sekcje plików w panelu, raport Markdown, link do mapy,
  przeliczenie po dołączeniu historii git; dane PR zapisują się w mapie. ChatBot: `prReview {pr}`, `prRisk`.
- **CLI — przegląd zmian**: `--base <ref>` (pliki z `git diff <ref>...HEAD`, ta sama ocena co w aplikacji),
  `--baseline` (health score bazy z tymczasowego `git worktree` + nowe i usunięte znaleziska), `--pr-md`
  (komentarz Markdown), `--max-score-drop N` (próg „nie pogarszaj"), `--pr-number/-title/-author/-link`.
- **GitHub Action — komentarz w PR**: w `pull_request` baza PR automatycznie, jeden komentarz aktualizowany
  przy kolejnych pushach (`pr-comment`), `max-score-drop`, link do mapy wpływu, wyjścia `risk` i `score-delta`.

### Zmienione
- **README po angielsku** jako główne (`README.md`), polskie w `README.pl.md` (przełącznik języka na górze obu).
- Wspólny kod zamiast kopii (Inspect „zduplikowany kod” na samym CodeMap): fizyka układu siłowego w `js/physics.js`
  (okno i `sim-worker.js`), obsługa Chrome przez CDP w `tools/cdp.mjs` (smoke i zrzuty), pigułka postępu / okno
  dialogowe / token / indeks plików w `js/ui-kit.js` (git, PR, linki).

### Bezpieczeństwo
- Treść plików z sekretami (`.env*` poza przykładami, `.npmrc`, `.netrc`, klucze prywatne, `*.pem/.key/.p12/.pfx/.jks`)
  nie jest czytana — plik jest na mapie, ale jego treść nie trafia do podglądu, zapisanej mapy, publicznego
  linku, RAG ani raportów CLI (wcześniej m.in. `server/.env` trafiał do analizy).

## [1.1.0] — 2026-09-27

Fazy 2–4 planu rozwoju — głębsza analiza, inteligencja git, ekosystem ([docs/ROADMAP.md](docs/ROADMAP.md)).

### Dodane — Faza 4 (ekosystem)
- **Tryb headless — CLI** `codemap analyze` (`cli/`, bez zależności, te same `js/*.js` w kontekście `vm`): raporty
  w terminalu, JSON, Markdown, **SARIF 2.1.0** (reguły Inspect, `relatedLocations` dla cykli i duplikatów, stabilne
  odciski, URI względne od korzenia repo), mapa `.codemap.json`, DOT / Mermaid / GraphML; historia git z `.git`
  (także z katalogu nadrzędnego i worktree), testy i pokrycie; progi `--min-score` / `--fail-on` / `--max-findings`
  (kody 0/1/2); API `analyzeProject()`. CodeMap: ~1 s, Odysseus-Lab (1649 plików, 464 tys. linii): ~6 s.
- **GitHub Action** (`action.yml`, kompozytowa): raport w podsumowaniu kroku, SARIF, progi, wyjścia `score` /
  `findings` / `sarif-file`; job `codemap` w CI tego repozytorium; przykład z code scanning w `docs/github-action.md`.
- **Deep-linki**: `#repo=owner/nazwa[@gałąź[/podkatalog]]` (także pełne URL GitHub/GitLab/Bitbucket, `&layout=`),
  `#gist=<id>`, `#share=<id>`; link wklejony do otwartej aplikacji wczytuje mapę (z potwierdzeniem).
- **Publiczne linki do map** (backend): „Udostępnij publiczny link…" z wygasaniem i opcjami prywatności
  (domyślnie bez podglądu treści), lista z unieważnianiem w Ustawienia → Konto; `POST/GET/DELETE /api/shares`,
  publiczny `GET /api/share/:id` (no-store, bez CORS i ciasteczek, ta sama 404 dla nieistniejących/wygasłych);
  treść w magazynie blobów wliczana do quoty; testy backendu (`server/test`, `app.inject`) w CI.
- Eksport do Gista kopiuje link `…/#gist=<id>` otwierający mapę w CodeMap.
- **Pytania o kod — RAG dla modeli lokalnych** (`js/rag.js`, tryb 📚 w ChatBocie): pliki dzielone na fragmenty
  wg granic symboli (scalanie krótkich, okno 60 linii dla długich), wyszukiwanie BM25 zawsze (rozbijanie
  identyfikatorów camelCase/snake_case, polskie pojęcia rozszerzane o angielskie odpowiedniki) + semantyczne
  z embeddingami Ollamy (`/api/embed`, `bge-m3`, `nomic-embed-text` z właściwymi prefiksami), ranking
  hybrydowy, max 2 fragmenty z pliku, odcięcie słabych trafień. Wektory w IndexedDB per projekt i model,
  przeliczane tylko dla zmienionych fragmentów (CodeMap: 596 fragmentów ≈ 46 s pierwszy raz, ≈ 6 s po zmianie
  3 plików). Odpowiedź tekstowa z cytatami `[n]` i listą źródeł — klik otwiera plik przewinięty do linii.
  Tylko WebLLM / Ollama; dla modeli w chmurze tryb 📚 odmawia (treść kodu nie opuszcza komputera).
  Ustawienia → AI: wybór modelu embeddingów, budowanie / usuwanie indeksu; `/codeSearch {query}` bez modelu.

### Dodane — Faza 3 (historia git, testy i pokrycie)
- **Czytnik lokalnego `.git` w przeglądarce** (`js/git-local.js` + `js/git-worker.js`, bez zależności): HEAD i refy
  (luźne, `packed-refs`, tagi adnotowane), obiekty luźne i paczki (`.idx` v1/v2 z offsetami 64-bit, OFS_DELTA,
  REF_DELTA), czytanie wycinkami `Blob.slice` (paczki nie są ładowane w całości), LRU zdekodowanych obiektów,
  historia w kolejności `git log` z diffem drzew i dokładnym wykrywaniem zmian nazw, płytkie klony,
  anulowanie; w Web Workerze z przejściem na wątek główny. Zgodność z `git log` sprawdza `tools/git-probe.mjs`
  (w `npm run verify`); 2000 commitów dużego repozytorium ≈ 1 s.
- **Historia git** (`js/git-core.js`, `js/git-remote.js`, `js/git.js`): folder wczytany razem z katalogiem
  `.git` jest analizowany sam, lokalnie i bez sieci; repozytorium z GitHub / GitLab / Bitbucket — na żądanie
  (Projekt → Historia git) przez API hostingu, z oszczędzaniem limitu zapytań (pliki dla najnowszych commitów,
  pełna historia z tokenem). Zmiany nazw plików są śledzone wstecz, tożsamości autorów scalane (e-maile,
  login z noreply GitHuba, imię), boty nie zostają właścicielami.
- **Własność i bus factor**: właściciel każdego pliku, udziały autorów w panelu szczegółów (plik, folder,
  projekt), bus factor projektu i każdego folderu (zachłannie wg Avelino i in. 2016); awatary (API) albo
  inicjały (lokalnie) właścicieli na węzłach.
- **Hotspoty churn × złożoność** (jak CodeScene): okno „Hotspoty" liczy (zmiany + zmiany z 90 dni) ×
  (1 + złożoność), gdy jest historia; `topFiles {metric:"churn"|"hotspot"}` w ChatBocie.
- **Kolorowanie węzłów wg danych** (`js/overlays.js`, lewy panel „Kolorowanie"): język, złożoność, data
  modyfikacji, a z historią — właściciel, częstość zmian, hotspoty, ostatnia zmiana; legenda z licznikami,
  klik podświetla pliki; akcja ChatBota `colorBy {mode}`.
- **Oś czasu — ewolucja projektu** (Gource-lite): pliki pojawiają się na mapie w kolejności powstania,
  zmienione świecą kolorem autora, nad nimi etykiety autorów z promieniami; odtwarzanie 0,5×–40×, suwak;
  bez historii git — oś czasu z migawek projektu.
- ChatBot: `gitHistory`, `owners {query?}`, `busFactor {query?}`, `churn {n?}`, `timeline {action}`, `colorBy`.
- Inspect: reguły „hotspoty zmian" (zmiany × złożoność, górne 10 %) i „wiedza w jednej głowie" (≥ 90 % zmian
  złożonego, często zmienianego pliku od jednej osoby; projekty z ≥ 2 autorami).
- **Testy ↔ kod i pokrycie** (`js/testmap.js`, `js/tests-ui.js`): mapowanie testów do kodu po nazwie (także
  ścieżki lustrzane `test/` ↔ `src/`, `src/test/java` ↔ `src/main/java`) i po importach, dla kilkunastu języków;
  krawędzie „Testy (test → kod)". Pokrycie z lcov, Istanbul (`coverage-final.json` i `coverage-summary.json`),
  Cobertura, JaCoCo i Clover — automatycznie z `coverage/`, z menu „Projekt → Wczytaj pokrycie testów" albo przez
  upuszczenie raportu na mapę. Nakładki „Testy" i „Pokrycie", sekcja „Testy i pokrycie" w panelu szczegółów,
  niepokryte linie w podglądzie pliku, reguły Inspect „złożone pliki bez testów" i „niskie pokrycie testami",
  akcje ChatBota `tests`, `coverage`, `loadCoverage`; dwa pliki testowe w demo.
- Loader przekazuje „pliki boczne" (uchwyty katalogu `.git` i raportów pokrycia, także z pomijanego
  `coverage/`) bez ich czytania; historia i dane git zapisują się w pliku mapy.

### Dodane — Faza 2
- Eksport widocznego grafu do **DOT** (Graphviz, klastry = foldery, kolory wg języka), **Mermaid**
  (`flowchart LR`, subgraph per folder) i **GraphML** (yEd: atrybuty type/lang/size/lines, grupy) —
  menu Projekt, paleta Ctrl+K, akcja ChatBota `exportGraph {format}` (`js/export.js`).
- Metryki sprzężeń w panelu szczegółów: **Ca / Ce / I** (afferent, efferent, niestabilność Martina)
  dla plików i folderów (agregacja po plikach potomnych, krawędzie wewnętrzne pomijane) (`js/metrics.js`).
- Reguły architektury z pliku **`.codemap.rules.json`** w repozytorium (warstwy = globy `*`/`**`,
  `forbid` między warstwami lub globami, `noCycles`) — reguła Inspect „naruszenia architektury"
  (krytyczne); brak pliku = cisza, niepoprawny plik = informacja (`js/rules.js`). Przykład dla
  samego CodeMap: rdzeń (analysis/graph/layouts) nie importuje UI (chrome/navigation/ui).
- Inspect: reguła **zduplikowany kod** — winnowing (k=5 tokenów, okno 4, ≥ 8 wspólnych odcisków)
  na treści plików ≥ 20 linii, próbka 1500 największych, liczone w chunkach; zastępuje dawną
  regułę porównującą same nazwy plików.
- **Graf symboli i wywołań (tree-sitter)** — przełącznik „Symbole (tree-sitter)" w lewym panelu (opt-in,
  pierwsze włączenie pobiera `web-tree-sitter` 0.22.6 i gramatyki z `tree-sitter-wasms` 0.1.12 z jsdelivr):
  funkcje, metody, klasy, struktury, interfejsy, enumy, traity/impl z 12 języków jako węzły-romby pod plikiem,
  wywołania rozwiązane w tym samym pliku i w plikach importowanych jako przerywane krawędzie `call`
  (przełącznik „Wywołania"). Parsowanie w Web Workerze z postępem; pliki zwinięte (dwuklik rozwija), przy
  zwiniętych wywołania łączą pliki; panel szczegółów: rodzaj, linie, „wywołuje" / „wywoływany przez";
  symbole zapisują się w mapie; akcja ChatBota `symbols {on}`; `tools/symbols-probe.mjs` w `npm run verify`.
- Analiza plików w **Web Workerze** (`js/analysis-worker.js`): metryki, importy, symbole i hash liczone
  poza głównym wątkiem, chunkami, z postępem „Analiza plików N / M" i anulowaniem; główny wątek składa
  z wyników tylko strukturę i krawędzie (bez Workera: te same kroki z oddawaniem wątku). Jeden przebieg
  `stripNonCode` dla importów i symboli (`analyzeFile`).
- Rozwiązywanie zależności: aliasy `tsconfig`/`jsconfig` **per katalog** z `extends` (najbliższy config
  wygrywa, monorepo się nie miesza), **workspaces** (import po nazwie pakietu z `package.json` →
  `exports`/`module`/`main`/folder), dynamiczne odwołania JS (`new Worker`, `new URL(…, import.meta.url)`,
  `importScripts`, `require.resolve`, `import.meta.glob`), SCSS `@use`/`@forward`, C# `using` → pliki
  z `namespace`, Rust `use crate::/self::/super::`, Python: moduł z katalogu importera i nazwy po
  `from X import`; nowe parsery: **Swift, Dart, Elixir, Lua, Zig, Haskell, Shell** (`js/analysis.js`).
- ChatBot: menu narzędzi po wpisaniu **`/`** (54 narzędzia, filtrowanie, `/nazwa argument`), nowe
  narzędzia `stats`, `topFiles`, `findText` (szukanie w treści plików z podświetleniem na mapie),
  `listLang`, `dependsOn`, `dependencies`, `explain`, `exportGraph`, `clearChat`.
- ChatBot: okno rozciągane za 8 uchwytów, lista rozmów o zmiennej szerokości (przeciągnij do 0 = zwiń),
  **elementy mapy jako załączniki** — przeciągnij węzeł do okna czatu (miniaturka z nazwą i krzyżykiem,
  maks. 30), panel myśli w pełni widoczny i zwijany, przycisk **⚡ Szybka odpowiedź** dla modeli myślących.
- Modele lokalne: 18 wyselekcjonowanych modeli WebLLM + pełna lista silnika (135), pobieranie modeli
  do Ollamy z Ustawień (postęp, propozycje); strumień rozumowania Ollamy pokazywany na żywo.

### Zmienione
- `#v=` niesie podkatalog repozytorium oraz źródło gist / publiczny link; podkatalog działa też dla GitLab i Bitbucket.
- Inspect: pozycje znalezisk z własną ważnością i powiązanymi plikami, raport Markdown bez DOM (`toMarkdown`).
- Inspect: reguła duplikatów bez fałszywych alarmów — `k=15`, okno 10, min. 12 wspólnych odcisków, odciski
  obecne w > 8 plikach pomijane (boilerplate), pliki blokad (`package-lock.json`, `yarn.lock`…) wykluczone.
  Na samym CodeMap 2034 → 44 par, health score 6 → 42.

### Naprawione
- Workery (`analysis-worker.js`, `symbols-worker.js`) importują moduły z tym samym stemplem `?v=` co strona —
  bez niego `importScripts` dostawał nieaktualną kopię z cache service workera.
- ChatBot wykonywał auto-akcje z pustymi argumentami (`setLayout` → „Nieznany układ", `setTheme` zawsze
  ciemny) — główna przyczyna, dla której modele lokalne „nie sterowały aplikacją".
- Gramatyka JSON Ollamy tylko dla małych modeli i nigdy z rozumowaniem (z nią ~1 tok/s; duże modele
  trzymają JSON z promptu).
- ChatBot bez błędów przy małych modelach lokalnych (zgłoszenie z Llama 3.2 3B, „wymień wszystkie dostępne
  komędy" → seria czerwonych chipów): akcje modelu walidowane przed wykonaniem (wymagane argumenty, znana
  nazwa, maks. 4 naraz); pytanie bez czasownika-polecenia nie uruchamia żadnych akcji; prośba o listę
  komend/narzędzi (także z literówkami) i komendy `/…` działają **bez modelu i bez klucza**; zamiast pustego
  „✓ wykonano" — odpowiedź tekstowa albo wskazówka; błędy dostawców jako krótki komunikat ze szczegółami;
  uszkodzone rozmowy w `localStorage` są naprawiane przy wczytaniu; brak `Uncaught AbortError` po
  zatrzymaniu strumienia (`reader.cancel()`).
- ChatBot: wyniki narzędzi informacyjnych (`/stats`, `/topFiles`, `/findText`, `/dependsOn`…) są treścią
  odpowiedzi (markdown), a nie ściśniętym chipem; opisy w menu `/` i w pomocy po polsku (model nadal
  dostaje angielski katalog); awatar asystenta przy początku dymka.
- `/stats` liczył węzły symboli tree-sittera jako foldery („foldery: 1281").
- Legenda „Typy plików": `.js` i `.mjs` to dwa wiersze „JavaScript" — przy powtórzonej nazwie pokazuje
  rozszerzenie.
- Testy: `test/export.test.mjs`, `test/metrics.test.mjs`, `test/rules.test.mjs`; smoke sprawdza eksport
  trzech formatów na grafie demo oraz ChatBota bez modelu (pomoc, walidacja akcji, 0 chipów błędu).

### Bezpieczeństwo
- Walidacja źródeł z linków (także ze starego `#v=`, które trafiało do loadera bez kontroli); czyszczenie adresów
  repozytorium i awatarów w mapach wczytywanych z pliku lub linku (`javascript:`, obrazki śledzące).

### Dokumentacja
- Nowe zrzuty w README (mapa repozytorium CodeMap, graf symboli, ChatBot z menu `/`) zamiast
  `docs/screenshot-demo.png`; generuje je `node tools/screenshots.mjs` (headless Chrome, powtarzalnie).

## [1.0.0] — 2026-09-25

Pierwsze publiczne wydanie open source (MIT). Faza 0 planu rozwoju ([docs/ROADMAP.md](docs/ROADMAP.md)).

### Bezpieczeństwo
- Backend dev serwuje wyłącznie pliki frontendu (allowlista, `dotfiles: deny`) i nasłuchuje tylko na
  `127.0.0.1` — wcześniej cały katalog repozytorium (w tym `server/.env`, baza SQLite, logi, Sejf)
  był dostępny przez HTTP na wszystkich interfejsach.
- Atomowa rezerwacja quoty przed zapisem: równoległe uploady nie mogą razem przekroczyć limitu.
- `Cache-Control: no-store` dla `/api/*`; log żądań bez query stringa (tokeny weryfikacji/resetu).
- Zależności backendu: fastify 5.12.5, @fastify/static 10.1.4 (`npm audit`: 0 podatności).
- Caddy: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  CSP w trybie report-only; hardening unitu systemd; backupy z `umask 077` i bezpieczną rotacją.
- ChatBot: allowlista akcji wykonywanych automatycznie (tylko zmiany widoku); wczytywanie, kasowanie,
  zapis, eksport, schowek, MindMap, płatne AI, instalacja wymagają kliknięcia. Nazwy z repozytorium
  w prompcie przycięte i oczyszczone ze znaków sterujących.

### Poprawki
- Mapa wczytana z pliku zachowuje pozycje przy „rozwiń/zwiń wszystko" i „pokaż różnice"
  (relayout przechodził przez układ force i niszczył zapisane położenia).
- Przycisk „Konto" ukryty, gdy nie ma backendu (GitHub Pages, sam `serve.py`).
- `manifest.id` względne — bezkonfliktowa instalacja PWA obok innych aplikacji na tym samym originie.

### Publikacja
- Licencja MIT, README od nowa (zrzut, start w 30 s, sekcja prywatności, mapa modułów), SECURITY.md,
  workflow GitHub Pages, jedno źródło wersji `CM.VERSION`.
- Historia repozytorium przepisana przed upublicznieniem (usunięty dawny log serwera z tokenem).

## Wcześniej (rozwój zamknięty, 2026-06 → 2026-07)

Skrót ważniejszych kamieni milowych sprzed wersjonowania:
- Rdzeń: mapa plików i zależności na canvasie, 13 układów, fizyka w Web Workerze, auto-LOD dla dużych
  repozytoriów, migawki i historia z diffem na mapie, porównywanie schematów, widok wpływu, cykle, hotspoty.
- Wczytywanie: folder/pliki/drop/wklej, ZIP/TAR/GZ, PDF, GitHub/GitLab/Bitbucket z gałęziami i porównaniem.
- Inspect: 15 reguł antywzorców z health score i raportem Markdown.
- AI: Mistral (4 sloty kluczy), WebLLM w Web Workerze (WebGPU), Ollama; ChatBot sterujący aplikacją,
  Runner (sandbox HTML/JS/PHP-wasm), błyskawiczne komendy bez modelu.
- MindMap: 16 szablonów kart, 34 typy diagramów, warstwa rysowania klasy Excalidraw, oś czasu.
- Dysk i Sejf: OPFS z AES-GCM-256 + PBKDF2, galeria, Ulubione; File System Access.
- Backend: Fastify + SQLite, argon2id, weryfikacja e-mail, synchronizacja map/migawek/ustawień,
  Sejf w chmurze jako szyfrogram; pliki wdrożeniowe Hetzner (Caddy, systemd, backup).
- PWA: service worker z precache, dwujęzyczność PL/EN, samouczek, motywy.

[1.0.0]: https://github.com/RaCzKoViC/CodeMap/releases/tag/v1.0.0
