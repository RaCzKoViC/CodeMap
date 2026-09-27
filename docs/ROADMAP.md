# CodeMap — plan rozwoju

Stan na 2026-09-25 (po przejściu na open source, MIT). Plan powstał z trzech równoległych przeglądów:
architektury frontendu, audytu bezpieczeństwa backendu i krypto po stronie klienta oraz porównania
z narzędziami konkurencyjnymi (Sourcegraph, CodeSee, CodeScene, dependency-cruiser, Sourcetrail,
Understand, Madge, Gource). Odwołania `plik:linia` dotyczą stanu z commita `073ef5b`.

## Ocena wyjściowa

Mocne strony: 13 układów, 34 typy diagramów MindMap, 3 dostawców AI (WebLLM, Ollama, Mistral),
15 reguł Inspect, Sejf AES-GCM, backend z argon2id, prepared statements wszędzie, strumieniowe
uploady z twardym limitem, sandbox Runnera bez `allow-same-origin`. Audyt nie znalazł działającego
XSS ani IDOR.

Słabości: zero testów automatycznych, analiza zależności regexami na poziomie plików (bez symboli),
`js/app.js` jako moduł-bóg (~22 odpowiedzialności, 2200 linii), persystencja bez wersjonowania,
README opisujące aplikację sprzed kilkunastu wersji, konfiguracja dev backendu serwująca cały
katalog repozytorium w sieci lokalnej.

## Faza 0 — zanim ktoś to zobaczy (bezpieczna publikacja) — WYKONANA 2026-09-25

Bezpieczeństwo backendu:
- [x] Dev serwuje tylko frontend (nie `server/`, `Sejf/`, `.git`, `.claude`), bind `127.0.0.1` poza produkcją (`server/index.js:41-47`).
- [x] Aktualizacja zależności: `fastify ≥ 5.12.1`, `@fastify/static ≥ 10.1.4` (path traversal), `npm update`.
- [x] `Cache-Control: no-store` dla odpowiedzi `/api/*`.
- [x] Rezerwacja quoty atomowo przed zapisem (`UPDATE … WHERE used_bytes + ? <= quota_bytes`), korekta po zapisie (`server/blobs.js:58`, `sync.js`, `vault.js`).
- [x] Nagłówki w Caddy: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; CSP w trybie report-only jako punkt startowy.
- [x] Logi bez query stringów (serializer `req` bez query) — tokeny weryfikacji nie trafiają do journald.
- [x] Hardening unitu systemd i `backup.sh` (`umask 077`, `-mindepth 1`, `chmod 600 .env`).

Frontend:
- [x] ChatBot: allowlista akcji czysto widokowych wykonywanych automatycznie; reszta przez przycisk „▶" (`js/chatbot.js:184`). Nazwy plików w prompcie przycięte i oczyszczone ze znaków sterujących (`js/app.js` `aiStructureSummary`).
- [x] Błąd układu `saved`: po wczytaniu zapisanej mapy „rozwiń wszystko" / „pokaż różnice" nie może przechodzić przez force i niszczyć pozycji (`js/layouts.js:966`).
- [x] `manifest.webmanifest`: `id: "./"` (dziś `"/"` zderza się z innymi aplikacjami na `raczkovic.github.io`).
- [x] Przycisk „Konto" ukryty, gdy `/api/health` nie odpowiada (GitHub Pages bez backendu).
- [x] Jedno źródło wersji: `CM.VERSION` używane przez „O aplikacji"; usunięcie martwego `preconnect` do Google Fonts.

Publikacja:
- [x] README od nowa: zrzut ekranu, badge, „Start w 30 s", link do demo, lista funkcji zgodna z kodem, mapa modułów, sekcja prywatności (co opuszcza urządzenie).
- [x] GitHub Pages przez workflow (`.github/workflows/deploy-pages.yml`), homepage w repo, topics.
- [x] `CHANGELOG.md`, `SECURITY.md`, tag `v1.0.0` + Release.

## Faza 1 — fundamenty (żeby dało się bezpiecznie zmieniać) — WYKONANA 2026-09-25 (zostały: decyzja o 20 układach, `escapeHtml` ×8, migracja `codemap_settings`)

- [x] Harness testowy w Node (`node:test`) dla czystych modułów: `analysis.js` (parsery importów per język, `stripNonCode`, aliasy tsconfig), `graph.js` (Tarjan, impact, `collapseToBudget`, round-trip JSON, `diffSignatures`), `layouts.js` (determinizm, brak NaN), `sim-worker.js`. Moduły to IIFE → ewaluacja przez `vm` w kolejności `util → languages → analysis → graph → layouts`.
- [x] CI: `node --check js/*.js`, testy, smoke (headless Chrome przez CDP zamiast Playwrighta, `tools/smoke.mjs`: demo + 65 akcji `CMApp.exec`) ładujący `#demo` i sprawdzający liczbę węzłów.
- [x] ESLint (flat config, globals `CM`), `.editorconfig`, root `package.json` ze skryptami (`check/test/lint/smoke/bump/verify`).
- [x] Podział `app.js` na 6 modułów (zrealizowany jako pola na `CM.App`, app.js = 19 linii bootstrapu; verify + smoke zielone). Pierwotny opis: `app-core` (state, apply, ingest, select), `chrome` (toolbar, menu, panele, wygląd, filtry, skróty), `repo-hosts` (GitHub/GitLab/Bitbucket, autorzy, gałęzie, gist, `#v=`), `compare` (grupy schematów, cykle, hotspoty, historia), `navigation` (radar, minimapa, WASD, menu kontekstowe, eksport obrazu), `ai-bridge` (Mistral/Local/Ollama, most ChatBota `exec`, paleta). Warunek: jawny kontekst `CM.App.ctx` zamiast domknięć.
- [x] Martwy kod (renderer ~130 linii, 3 checkboxy bez efektu, klucze Mistral ×3 → `U.mistralKeySlots`); POZOSTAŁO: decyzja o 20 układach, `escapeHtml` ×8, hash ×4. Pierwotny opis: 20 z 33 układów nieosiągalnych z UI (decyzja: przywrócić do menu albo usunąć), ~130 linii starego renderera, 3 checkboxy bez efektu (animowane połączenia, cząsteczki, poświata), duplikaty (`escapeHtml` ×8, klucze Mistral ×3, `bhRepulse` ×2, hash ×4).
- [x] Wersjonowanie: skrypt bumpu (`npm run bump [wersja]`) aktualizujący `?v=` w `index.html`, `CACHE` w `sw.js` i `CM.VERSION`.
- [x] Persystencja (kontrola `version` mapy, `SYNC_KEYS` = blob `codemap_settings`); POZOSTAŁO: migracja `codemap_settings` na klucze niezależne od id-ów DOM. Pierwotny opis: sprawdzanie `version` mapy przy wczytaniu, migracje `codemap_settings` (klucze niezależne od id-ów DOM), usunięcie 17 kluczy-widm z `SYNC_KEYS` (`js/sync.js:28`) albo realne zapisywanie wyglądu pod nimi.
- [x] Backend (blokada per konto 30 s → 15 min, 3 maile/h na adres, wysyłka poza ścieżką odpowiedzi, limit współbieżności argon2, GC co godzinę, PBKDF2 600k z polem `kdf`, min. 8 znaków hasła albumu). Pierwotny opis: rate limit per konto (backoff po nieudanych logowaniach), limit maili per adres, sprzątanie wygasłych sesji i tokenów, PBKDF2 ≥ 600k iteracji z polem `kdf` w meta Sejfu, minimum 12 znaków hasła albumu synchronizowanego.
- [x] Autozapis: nie serializować całego grafu po każdym `apply()`; zapis tylko po zmianie struktury lub pozycji.

## Faza 2 — wyróżnik: głębsza analiza — WYKONANA 2026-09-27 (zostały drobne: abstractness, pole szukania w treści w UI, `package.json#imports`)

- [x] Graf symboli i call graph przez `web-tree-sitter` (`js/symbols-core.js` + `js/symbols-worker.js` + `js/symbols.js`; web-tree-sitter 0.22.6 + tree-sitter-wasms 0.1.12 z jsdelivr, opt-in przełącznik „Symbole (tree-sitter)", 12 gramatyk, symbole jako węzły pod plikiem, krawędzie `call` rozwiązane w pliku i przez importy, serializowane w mapie).
- [x] Analiza w Web Workerze i w chunkach (`js/analysis-worker.js`: metryki/importy/symbole/hash poza głównym wątkiem, postęp, anulowanie; `graph.build(files, meta, pre)`); jeden przebieg `stripNonCode` (`analyzeFile`).
- [x] Rozwiązywanie zależności (bez `package.json#imports` i `extends` na pakiet npm): aliasy tsconfig per katalog + `extends`, `package.json#imports/exports`, workspaces monorepo (`@scope/pkg` → `packages/pkg`), dynamiczne importy z literałów, `new Worker()`/`new URL()`, SCSS `@use/@forward`, C# `using` i Rust `use crate::` łączone z plikami.
- [x] Plik reguł architektury (`.codemap.rules.json`: warstwy, zakazane importy, `noCycles`) egzekwowany przez silnik Inspect (`js/rules.js`, reguła `archviolation`; przykład dla samego CodeMap w korzeniu repo).
- [x] Metryki sprzężeń Ca / Ce / niestabilność per plik i folder (`js/metrics.js`, panel szczegółów); POZOSTAŁO: abstractness (wymaga symboli z tree-sittera).
- [x] Wykrywanie duplikatów kodu — winnowing na treści (`CM.Metrics.findDuplicates`, reguła `dupcode` zamiast porównania nazw plików; ≥ 20 linii, próbka 1500 największych, chunkowane).
- [x] Wyszukiwanie w treści plików z wynikami na mapie (narzędzie ChatBota `/findText`; POZOSTAŁO: pole w UI i regex); parsery Swift/Dart/Elixir/Lua/Zig/Haskell/Shell (Kotlin/Scala już w rodzinie Java).
- [x] Eksport DOT / GraphML / Mermaid (`js/export.js`, menu Projekt, paleta Ctrl+K, akcja ChatBota `exportGraph`).

## Faza 3 — inteligencja git — WYKONANA 2026-09-27 (zostały drobne: rename z edycją — podobieństwo treści, reftable / SHA-256, Go `coverage.out`)

- [x] Hotspoty churn × złożoność — z lokalnego `.git` (czytnik obiektów i paczek w przeglądarce) albo z API
  GitHub/GitLab/Bitbucket (lista commitów + zmienione pliki per commit w budżecie limitu, zamiast
  `commits?path=` per plik); wpięte w okno „Hotspoty", nakładkę i `topFiles`.
- [x] Ownership per plik i bus factor (projekt i folder); awatary / inicjały właścicieli na węzłach.
- [x] Suwak czasu: animowana ewolucja z historii git albo z migawek (Gource-lite: pojawianie się plików,
  poświata zmian w kolorze autora, etykiety autorów).
- [x] Mapowanie testów do kodu (nazwa, ścieżki lustrzane, importy; kilkanaście języków) i nakładka pokrycia
  z lcov / Istanbul / Cobertura / JaCoCo / Clover (`js/testmap.js`, `js/tests-ui.js`).
- [x] Dodatkowo: czytnik lokalnego `.git` w przeglądarce (`js/git-local.js`, sonda zgodności z `git log`),
  kolorowanie węzłów wg danych (`js/overlays.js`), reguły Inspect „hotspoty zmian" i „wiedza w jednej głowie".

## Faza 4 — ekosystem — WYKONANA 2026-09-27

- [x] Tryb headless/CLI + GitHub Action (`cli/`, `action.yml`): raporty JSON / Markdown / SARIF 2.1.0 / mapa,
  progi `--min-score` / `--fail-on` / `--max-findings`, job `codemap` w naszym CI.
- [x] RAG dla lokalnych modeli (`js/rag.js`): fragmenty wg symboli, BM25 + embeddingi Ollamy (`/api/embed`),
  indeks w IndexedDB z przeliczaniem zmienionych fragmentów, tryb 📚 w ChatBocie z cytatami i źródłami,
  tylko dostawcy lokalni; `/codeSearch`.
- [x] Deep-linki `#repo=`, `#gist=`, `#share=`; publiczne linki do map przez backend (`/api/shares`, testy backendu).
- [x] Rozszerzenie VS Code (`integrations/vscode/`): Problems, pasek stanu, CodeLens, panel z mapą, nawigacja
  w obie strony, analiza przy zapisie. Integracja LSP — nie (niepotrzebna przy diagnostykach z rozszerzenia).
- [x] Wydanie v1.1.0 (2026-09-27); v1.2.0 z rozszerzeniem VS Code, fazą 5 i trybem na żywo.

## Faza 5 — przegląd zmian (PR) — W TOKU 2026-09-27

Największa wartość przy małym koszcie: łączy graf zależności, historię git, testy i pokrycie.
- [x] Mapa wpływu PR (`js/pr-core.js`, `js/pr.js`): zmienione pliki z API GitHub / GitLab / Bitbucket, zależne
  (odwrotny BFS), ryzyko 0–100 z sześciu składników, nakładka, panel, raport, link `#repo=…&pr=N`.
- [x] Komentarz w PR z GitHub Action (`pr-comment`): ryzyko, pliki, zdrowie przed/po, nowe znaleziska, link do mapy.
- [x] Sugerowani recenzenci z własności plików (git).
- [x] CLI `--base` / `--baseline` / `--pr-md` / `--max-score-drop`: health score przed/po, próg „nie pogarszaj".
- [ ] Zostało: wybór PR z listy otwartych PR w oknie, porównanie przed/po także w aplikacji (dziś tylko CLI).

## Faza 6 — tryb na żywo i skala — WYKONANA 2026-09-27 (v1.3.0; zostały drobne: etykiety na GPU, pamięć tree-sittera, próg benchmarku)

- [x] Obserwacja folderu (`js/live.js`): FileSystemObserver + skan dat modyfikacji, analiza tylko zmienionych plików,
  przebudowa z zachowaniem stanu, RAG (wektory po hashu) i historia git (nowy commit) na bieżąco.
  [x] Wznowienie obserwacji po przeładowaniu (uchwyt w IndexedDB, „↻ Wznów na żywo” na pasku stanu, zgoda za kliknięciem).
- [x] Renderer WebGL2 (`js/gl-layer.js`) dla dużych map: krawędzie i figury na GPU, etykiety na canvas 2D,
  wygaszanie gęstych krawędzi zamiast LOD; 20 tys. plików / 60 tys. krawędzi ~1–2 ms na klatkę. Szybsza kamera
  (`cam.xf`) przyspieszyła też canvas 2D ~2×. POZOSTAŁO: etykiety na GPU (atlas glifów) i hit-test z siatką
  przestrzenną dla 100 tys.+ węzłów; łagodniejsze auto-odchudzanie widoku (>1200 węzłów) przy aktywnym GPU.
- [x] Pamięć analizy w OPFS (`js/analysis-cache.js`) + analiza w maks. 4 workerach: ponowne wczytanie 2800 plików
  0,2 s zamiast 2,6 s, pierwsze ~2,3× szybsze. POZOSTAŁO: pamięć także dla wyników tree-sittera (graf symboli).
- [x] Benchmarki w CI (`tools/bench.mjs`: wczytanie + klatka canvas/WebGL na syntetycznych 5k/20k plików, tabela
  w podsumowaniu, JSON jako artefakt). POZOSTAŁO: prawdziwe repozytoria i próg regresji porównywany z bazą.

## Faza 7 — agent kodu (lokalne AI) — WYKONANA 2026-09-27 (v1.3.0; zostało: agent dla WebLLM)

- [x] ChatBot z narzędziami w pętli (`js/agent.js`): model sam woła `codeSearch`, `readFile`, `findFiles`,
  `dependencies`, `dependents`, `fileInfo`, `hotspots`, `owners`, `tests` przed odpowiedzią — natywne wywołania narzędzi Ollamy
  albo JSON w treści; ponaglenie zamiast wymówki. Sprawdzone na llama3.2:3b, qwen3:8b, qwen2.5-coder:7b
  (qwen2.5:7b narzędzia ignoruje → zwykły tryb 📚). Widokowe `showOnMap` (podświetlenie + kamera)
  z pętli agenta. POZOSTAŁO: agent dla WebLLM (tool calling w przeglądarce).
- [x] Embeddingi w przeglądarce (WebLLM `snowflake-arctic-embed`) — semantyczny RAG bez Ollamy; osobny silnik w workerze.
- [x] „Doktor hotspotów" (`js/doctor.js`): plan refaktoryzacji pliku z czołówki hotspotów — kartoteka (metryki, git,
  testy, zależne) + fragmenty najdłuższych funkcji, cztery sekcje z cytatami; przycisk w panelu pliku i `hotspotDoctor`.
- [x] Trasy po kodzie (`js/tour.js`): automatyczne albo z modelu (tylko struktura), odtwarzacz na mapie, zapis w mapie,
  link `#tour=`, eksport / import VS Code CodeTour.

## Faza 8 — jakość własna i społeczność

- Własny health score CodeMap (29/100 na kopii z GitHuba: duplikaty, złożone pliki bez testów, bardzo długie
  pliki): podział `chatbot.js` / `settings.js` / `mindmap.js`, testy renderera i ChatBota, [x] usunięcie
  duplikatów (`escapeHtml` ×8 → `U.escapeHtml` / `U.escapeText`), [x] próg CLI w naszym CI.
- [x] Bezpieczeństwo: CSP egzekwowane (meta + nagłówek Caddy), Runner przez `runner.html`, SRI dla tree-sitter
  (`tools/sri.mjs`, weryfikacja bajtów przed wykonaniem). WebLLM / rough.js / php-wasm (+esm) — tylko przypięta wersja.
- [x] README po angielsku jako główne (`README.md`), polskie w `README.pl.md`.
- [x] Wspólny kod zamiast kopii wskazanych przez Inspect: `js/physics.js`, `tools/cdp.mjs`, `js/ui-kit.js`.
- Społeczność: galeria przykładowych repozytoriów
  (`#repo=`) w demo, publikacja CLI w npm (`npx codemap analyze`).
- Dług z faz 1–3: 20 nieosiągalnych układów, migracja `codemap_settings`, `package.json#imports`,
  wykrywanie zmiany nazwy z edycją (podobieństwo treści).

## Kolejność

Faza 0 w całości, potem harness testowy z fazy 1 (bez niego przebudowa `app.js` i parserów jest ryzykowna).
Największą wartość ma połączenie faz 2 i 3: graf na poziomie funkcji plus hotspoty z historii git,
analizowane lokalnie i objaśniane lokalnym modelem — żadne z porównywanych narzędzi nie daje tego
bez serwera i bez wysyłania kodu na zewnątrz.

Po fazie 4 (plan z 2026-09-27): domknięcie fazy 4 i v1.1.0 → faza 5 (PR) → z fazy 8 wcześniej jakość
własnego kodu z progiem w CI i angielskie README → tryb na żywo → agent z narzędziami → WebGL.
