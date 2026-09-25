# Historia zmian

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie [SemVer](https://semver.org/lang/pl/).
Numer wersji aplikacji: `CM.VERSION` w `js/util.js` (Ustawienia → O aplikacji).

## [Unreleased]

Faza 2 planu rozwoju — głębsza analiza ([docs/ROADMAP.md](docs/ROADMAP.md)).

### Dodane
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

### Naprawione
- ChatBot wykonywał auto-akcje z pustymi argumentami (`setLayout` → „Nieznany układ", `setTheme` zawsze
  ciemny) — główna przyczyna, dla której modele lokalne „nie sterowały aplikacją".
- Gramatyka JSON Ollamy tylko dla małych modeli i nigdy z rozumowaniem (z nią ~1 tok/s; duże modele
  trzymają JSON z promptu).
- Testy: `test/export.test.mjs`, `test/metrics.test.mjs`, `test/rules.test.mjs`; smoke sprawdza eksport
  trzech formatów na grafie demo.

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
