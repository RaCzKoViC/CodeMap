# Historia zmian

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie [SemVer](https://semver.org/lang/pl/).
Numer wersji aplikacji: `CM.VERSION` w `js/util.js` (Ustawienia → O aplikacji).

## [Unreleased]

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
