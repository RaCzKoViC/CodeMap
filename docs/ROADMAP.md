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

## Faza 2 — wyróżnik: głębsza analiza — W TOKU (stan 2026-09-26)

- [ ] Graf symboli i call graph przez `web-tree-sitter` (WASM ładowany na żądanie, jak WebLLM); symbole jako węzły drugiego poziomu, serializowane w mapie.
- [ ] Analiza w Web Workerze i w chunkach (`graph.build` dziś blokuje UI); jeden przebieg `stripNonCode` zamiast dwóch.
- [x] Rozwiązywanie zależności (bez `package.json#imports` i `extends` na pakiet npm): aliasy tsconfig per katalog + `extends`, `package.json#imports/exports`, workspaces monorepo (`@scope/pkg` → `packages/pkg`), dynamiczne importy z literałów, `new Worker()`/`new URL()`, SCSS `@use/@forward`, C# `using` i Rust `use crate::` łączone z plikami.
- [x] Plik reguł architektury (`.codemap.rules.json`: warstwy, zakazane importy, `noCycles`) egzekwowany przez silnik Inspect (`js/rules.js`, reguła `archviolation`; przykład dla samego CodeMap w korzeniu repo).
- [x] Metryki sprzężeń Ca / Ce / niestabilność per plik i folder (`js/metrics.js`, panel szczegółów); POZOSTAŁO: abstractness (wymaga symboli z tree-sittera).
- [x] Wykrywanie duplikatów kodu — winnowing na treści (`CM.Metrics.findDuplicates`, reguła `dupcode` zamiast porównania nazw plików; ≥ 20 linii, próbka 1500 największych, chunkowane).
- [x] Wyszukiwanie w treści plików z wynikami na mapie (narzędzie ChatBota `/findText`; POZOSTAŁO: pole w UI i regex); parsery Swift/Dart/Elixir/Lua/Zig/Haskell/Shell (Kotlin/Scala już w rodzinie Java).
- [x] Eksport DOT / GraphML / Mermaid (`js/export.js`, menu Projekt, paleta Ctrl+K, akcja ChatBota `exportGraph`).

## Faza 3 — inteligencja git

- Hotspoty churn × złożoność z API GitHub/GitLab (`commits?path=`), wpięte w `hotspotScore`.
- Ownership per plik i bus factor; awatary autorów na węzłach.
- Suwak czasu: animowana ewolucja na bazie migawek i porównania gałęzi (Gource-lite).
- Mapowanie testów do kodu (`*.test`/`*.spec` → podmiot) i nakładka pokrycia z lcov.

## Faza 4 — ekosystem

- Tryb headless/CLI + GitHub Action (fail na cyklach lub progu health score, raport SARIF).
- RAG po grafie dla lokalnych modeli (Ollama `/api/embeddings`): odpowiedzi ugruntowane w kodzie, polityka „tylko lokalny dostawca" już istnieje.
- Deep-linki `#repo=owner/name`, `#gist=id`; publiczne linki do map przez backend.
- Rozszerzenie VS Code / integracja z LSP jako opcja.

## Kolejność

Faza 0 w całości, potem harness testowy z fazy 1 (bez niego przebudowa `app.js` i parserów jest ryzykowna).
Największą wartość ma połączenie faz 2 i 3: graf na poziomie funkcji plus hotspoty z historii git,
analizowane lokalnie i objaśniane lokalnym modelem — żadne z porównywanych narzędzi nie daje tego
bez serwera i bez wysyłania kodu na zewnątrz.
