# CodeMap — Kartografia Kodu 🗺️

[English](README.md) · **Polski**

[![Licencja MIT](https://img.shields.io/badge/licencja-MIT-22d3ee.svg)](LICENSE)
[![Wydanie](https://img.shields.io/github/v/release/RaCzKoViC/CodeMap?label=wydanie&color=22d3ee)](https://github.com/RaCzKoViC/CodeMap/releases)
[![GitHub Pages](https://github.com/RaCzKoViC/CodeMap/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/RaCzKoViC/CodeMap/actions/workflows/deploy-pages.yml)
[![Bez build-stepu](https://img.shields.io/badge/build--step-brak-8b5cf6.svg)](#-architektura)

> **English summary.** CodeMap is a local-first, Maltego-style code cartography tool: load a folder,
> an archive or a GitHub/GitLab/Bitbucket repository and get an interactive map of files, dependencies
> and metrics — with 13 layouts, static analysis (15 anti-pattern rules), snapshots and diffs, a MindMap
> mode with a drawing layer, and optional AI assistants that can run **entirely in your browser**
> (WebLLM) or on your machine (Ollama). Pure JavaScript, no build step, PWA, MIT. UI in Polish and English.

**Demo online:** https://raczkovic.github.io/CodeMap/#demo

![CodeMap — mapa repozytorium CodeMap w układzie siłowym: pliki, foldery i importy](docs/screenshot-map.png)

| Graf symboli i wywołań (tree-sitter) | ChatBot sterujący mapą, menu narzędzi `/` |
|:---:|:---:|
| [![Graf symboli: funkcje pliku symbols-core.js i ich wywołania, panel szczegółów symbolu](docs/screenshot-symbols.png)](docs/screenshot-symbols.png) | [![ChatBot: wyniki /stats i /topFiles oraz lista narzędzi po wpisaniu /](docs/screenshot-chatbot.png)](docs/screenshot-chatbot.png) |

| Historia git z lokalnego `.git`: częstość zmian, oś czasu, autorzy, testy ↔ kod |
|:---:|
| [![Oś czasu historii git: pliki zmienione w ostatnich commitach świecą, etykieta autora z promieniami do plików, kolorowanie wg częstości zmian, zielone krawędzie test → kod](docs/screenshot-git.png)](docs/screenshot-git.png) |

<sub>Zrzuty przedstawiają samo repozytorium CodeMap wczytane jako projekt; odtwarza je `node tools/screenshots.mjs`.</sub>

---

## 🚀 Start w 30 sekund

```bash
git clone https://github.com/RaCzKoViC/CodeMap.git
cd CodeMap
python serve.py            # → http://localhost:8777
```

Bez Pythona wystarczy dowolny serwer statyczny (`npx serve .`) albo dwuklik na `index.html`
(tryb `file://` ma ograniczenia: brak service workera i migawek w IndexedDB).
Kliknij **„✨ Zobacz demo"** lub otwórz `index.html#demo`.

---

## ✨ Co potrafi

### Wczytywanie (150+ formatów)
- **Folder / pliki / przeciągnij-upuść / wklej** (`Ctrl+V`) — pełna struktura katalogów.
- **Folder na żywo** (Wczytaj → Folder na żywo, Chrome / Edge): mapa nadąża za edycją — zmienione pliki są
  czytane i analizowane w Web Workerze, pozycje, zaznaczenie, kamera i kolorowanie zostają, zmiany świecą na
  mapie, nowy commit odświeża historię git. Pliki z sekretami (`.env`, klucze prywatne) są na mapie, ale bez treści.
  Po przeładowaniu strony pasek stanu proponuje **↻ Wznów na żywo: <folder>** — jedno kliknięcie (przeglądarka ponownie
  pyta o zgodę na odczyt) i folder jest wczytany i znów obserwowany, niezmienione pliki prosto z pamięci analizy.
- **Przykładowe repozytoria** (Przykłady na ekranie startowym, Wczytaj → *Przykładowe repozytoria…*): dziewięć małych,
  prawdziwych projektów w siedmiu językach (Express, Preact, ky, petite-vue, Flask, Gin, serde json, Gson, Rake),
  otwieranych jednym kliknięciem — także od razu z trasą po kodzie.
- **Archiwa** ZIP, TAR, TGZ, GZ — rozpakowywane w przeglądarce (`DecompressionStream`).
- **PDF** — mapa z zakładek i stron.
- **Repozytoria** GitHub, GitLab, Bitbucket po adresie URL (publiczne lub z tokenem), wybór gałęzi/tagu,
  podkatalogu, **porównanie dwóch gałęzi** po sygnaturze drzewa, eksport mapy do Gist.
- **Linki**: `#repo=owner/nazwa[@gałąź[/podkatalog]]` (także pełny URL GitHub/GitLab/Bitbucket, `&layout=`),
  `#gist=<id>` (mapa wyeksportowana do Gista), `#share=<id>` (publiczny link z backendu), `#v=` (bieżący widok).
  Przykład: [`#repo=RaCzKoViC/CodeMap@main/server&layout=treemap`](https://raczkovic.github.io/CodeMap/#repo=RaCzKoViC/CodeMap@main/server&layout=treemap).

### Analiza
- Metryki per plik: linie, kod, komentarze, złożoność, funkcje, TODO/FIXME, rozmiar, data.
- Parsowanie importów dla 19 rodzin języków (JS/TS, Python, C/C++, Go, Java, C#, PHP, Ruby, Rust, Swift, Dart, Elixir, Lua, Zig, Haskell, Shell, CSS/SCSS,
  HTML, Markdown), aliasy `tsconfig`/`jsconfig` per katalog z `extends`, workspaces monorepo, dynamiczne
  odwołania (`new Worker`, `import.meta.glob`…), zależności zewnętrzne jako osobne węzły.
- Symbole (funkcje, klasy, typy) z własną złożonością w panelu szczegółów.
- **Graf symboli i wywołań (tree-sitter)** — opcjonalny: funkcje, metody, klasy, struktury, interfejsy,
  enumy i traity jako węzły drugiego poziomu pod plikiem, a wywołania rozwiązane w pliku i przez importy
  jako krawędzie. 12 gramatyk (JS/JSX, TS/TSX, Python, Go, Java, Rust, C, C++, C#, PHP, Ruby), parsowanie
  w Web Workerze; dwuklik na pliku rozwija jego symbole, przy zwiniętych plikach wywołania łączą pliki.
- Graf: sąsiedzi, **wpływ zależności** w górę i w dół, **cykle** (Tarjan SCC), sygnatury do porównań.
- **Macierz zależności (DSM)** — Projekt → Macierz zależności: pakiety monorepo (package.json, Cargo.toml, go.mod, pubspec,
  pyproject) albo foldery (poziom 1/2) w kolejności dostawcy → konsumenci, więc zdrowe zależności leżą pod przekątną,
  a czerwone komórki nad nią to cykle; klik pokazuje pary importów i podświetla pliki. Reguła Inspect **cykle między pakietami**.
- **Sprawdzane narzędziami samych ekosystemów**: `npm run corpus` porównuje krawędzie importów CodeMap na przypiętych
  wydaniach Express, Preact, ky, petite-vue, Flask i Gin z esbuildem (JS/TS), grimp (Python) i `go list` (Go) — precyzja
  i kompletność per repozytorium, zadanie CI pada poniżej 97 %. Dziś: 100 % / 100 %. Krawędzie z `import type` (TS) mają flagę `typeOnly`.

### Mapa
- **13 układów**: upakowane koła, drzewo strukturalne, radialny, treemap, icicle, sunburst, siła (force),
  warstwowy, moduły, diagram łukowy, galaktyka, mgławica, pierścienie.
- Fizyka układów siłowych w **Web Workerze** — UI nie zamiera na dużych repozytoriach (auto-LOD, budżet węzłów).
- **Rysowanie na GPU (WebGL2)** dla dużych map: od 3000 widocznych węzłów + krawędzi tło, siatkę, wszystkie krawędzie
  (łuki, linie przerywane, nakładki wpływu i cykli) i figury rysuje karta graficzna, a etykiety i zaznaczenia warstwa 2D
  nad nią. 20 000 plików i 60 000 krawędzi: ~1–2 ms na klatkę zamiast 30–150 ms w canvas 2D; gęste krawędzie są
  wygaszane według gęstości na ekranie zamiast pomijane. Lewy panel → Mapa → *Rysowanie mapy* (automatycznie / Canvas 2D /
  WebGL); bez WebGL2 zostaje canvas. `npm run bench` mierzy oba na syntetycznych projektach (także w CI).
- **Szybkie ponowne wczytanie:** pliki są analizowane równolegle w maks. 4 Web Workerach, a wyniki zapamiętane
  w przeglądarce (OPFS, gzip, per projekt). Ponowne wczytanie tego samego folderu albo repozytorium pomija niezmienione
  pliki — ten sam rozmiar i data modyfikacji (albo sha bloba git), w razie wątpliwości decyduje skrót treści: 2800 plików
  w ~0,2 s zamiast ~2,6 s. Zapisywane są tylko metryki, importy i nazwy symboli; Ustawienia → Instalacja →
  *Wyczyść pamięć analizy*.
- Pan, zoom do kursora, **obrót**, pseudo-3D, minimapa, radar okolicy, tryb lotu `WASD`, widok wpływu,
  podgląd kodu po najechaniu, menu kontekstowe, paleta poleceń `Ctrl+K`, wyszukiwarka `/`.
- Eksport **PNG** (2×/4×) i **SVG**, link do bieżącego widoku (`#v=`).

### Śledzenie rozwoju
- **Migawki** (IndexedDB) i **historia**: raport dodane / zmienione / usunięte, Δ linii i rozmiaru,
  różnice naniesione na mapę (zielony / żółty / czerwony).
- **Zapis / odczyt** całej mapy z pozycjami (`.codemap.json`), porównywanie kilku schematów obok siebie,
  hotspoty (rozmiar × zależności × złożoność).

### Historia git
- Folder wczytany **razem z katalogiem `.git`** jest analizowany od razu — w przeglądarce, w Web Workerze,
  bez sieci (czytnik obiektów, paczek i delt gita napisany od zera). Repozytorium z GitHub / GitLab /
  Bitbucket: Projekt → **Historia git** (API hostingu; bez tokenu pliki dla ~50 najnowszych commitów).
- **Właściciel** każdego pliku i udziały autorów, **bus factor** projektu i każdego folderu, zmiany nazw
  śledzone wstecz, boty pomijane przy własności; awatary właścicieli na węzłach.
- **Hotspoty churn × złożoność** — pliki często zmieniane i jednocześnie złożone (jak w CodeScene).
- **Kolorowanie** węzłów (lewy panel): właściciel, częstość zmian, hotspoty, ostatnia zmiana — obok
  języka, złożoności i daty modyfikacji; legenda z licznikami, klik podświetla pliki.
- **Oś czasu** — animowana ewolucja projektu (Gource-lite): pliki pojawiają się w kolejności powstania,
  zmiany świecą kolorem autora; bez historii git — oś czasu z migawek.
- **Sprzężenie zmian** (jak code-maat / CodeScene): pliki zmieniane w tych samych commitach — stopień = wspólne commity /
  średnia zmian obu, bez masowych commitów (> 30 plików). Panel szczegółów pokazuje, z czym plik zmienia się razem, i oznacza
  pary **bez importu** między nimi (ukryta zależność: globalne nazwy, konfiguracja, klucze tekstów); akcja ChatBota `changeCoupling`.
- Inspect: reguły **hotspoty zmian**, **wiedza w jednej głowie** (≥ 90 % zmian złożonego pliku od jednej osoby) i **ukryte
  sprzężenie zmian** (pliki kodu zmieniane razem w ≥ 50 % swoich commitów bez importu w żadną stronę).
- **CODEOWNERS a git**: wzorce jak na GitHubie (ostatnie dopasowanie wygrywa, `docs/*` tylko bezpośrednie pliki, `apps/`
  na dowolnej głębokości), właściciele `@login` / e-mail rozwiązywani na autorów historii; reguły Inspect **kod bez
  właściciela** (jedna pozycja na folder) i **rozjazd CODEOWNERS** (deklarowany właściciel ma < 10 % zmian pliku, ktoś
  inny ≥ 50 %); sekcja w panelu, kolorowanie **Właściciel (CODEOWNERS)** i akcja ChatBota `codeOwners`.
- **Podatne zależności (OSV.dev)** — Projekt → Podatne zależności: dokładne wersje z plików blokad (package-lock, yarn.lock,
  Cargo.lock, poetry.lock, Pipfile.lock, go.sum — także przechodnie) albo z manifestów; okno najpierw pokazuje, co wyjdzie
  (tylko nazwy i wersje), dopiero potem wysyła; wynik z ważnością (GHSA / CVSS 3), wersją z poprawką, linkami do osv.dev,
  kolorowaniem **Podatności** i regułą Inspect **podatne zależności** (CLI: `--osv`).

### Testy i pokrycie
- CodeMap sam wiąże **testy z testowanym kodem** — po nazwie (także ścieżki lustrzane `test/` ↔ `src/`,
  `src/test/java` ↔ `src/main/java`) i po importach, dla kilkunastu języków; krawędzie „Testy (test → kod)".
- **Pokrycie** z lcov, Istanbul (`coverage-final.json`, `coverage-summary.json`), Cobertura, JaCoCo i Clover —
  wczytywane samo z `coverage/` wczytanego folderu, z menu Projekt → „Wczytaj pokrycie testów" albo przez
  przeciągnięcie raportu na mapę. Kolorowanie „Pokrycie testami" i „Testy", sekcja „Testy i pokrycie"
  w panelu, niepokryte linie w podglądzie pliku, reguły Inspect „złożone pliki bez testów" i „niskie pokrycie".

### Inspect — analiza statyczna
16 reguł antywzorców (cykle, god-file, huby, sieroty, złożoność, ryzykowne API, puste `catch`, kod debug,
głębokie zagnieżdżenie, minifikaty, **zduplikowany kod** — winnowing na treści plików…) z progami
statystycznymi, **health score** i raportem Markdown. Opcjonalny plik **`.codemap.rules.json`** w repozytorium
(warstwy = globy ścieżek, `forbid` między warstwami, `noCycles`) jest egzekwowany jako reguła
„naruszenia architektury". W panelu szczegółów każdy plik i folder ma **sprzężenia** Ca / Ce / I
(afferent, efferent, niestabilność wg Martina). Widoczny graf da się **wyeksportować** do DOT (Graphviz),
Mermaid i GraphML (yEd) — menu Projekt albo akcja ChatBota `exportGraph`.

### AI — opcjonalnie, z zachowaniem prywatności
- **Pytania o mapę bez żadnego modelu** — ChatBot odpowiada na pytania typu „pliki bez testów o złożoności powyżej 50
  w src”, „top 5 najczęściej zmienianych plików”, „pliki autora Ala zmienione w ostatnim miesiącu” czy „pliki w cyklach”
  wprost z grafu (metryki, git, testy, CODEOWNERS, OSV; po polsku i angielsku) i podświetla wynik; akcja `mapQuery`.
- **Szkielety testów** (Doktor hotspotów, bez modelu): „🧪 Szkielet testów” w panelu pliku z kodem albo akcja `testSkeleton`
  — plik testów wg konwencji samego projektu (framework z package.json / istniejących testów: vitest, jest, mocha,
  node:test; pytest / unittest; Go testing; Rust; JUnit 5), położenie i przyrostek wybrane głosowaniem z istniejących par
  test ↔ kod, import eksportowanych symboli, przypadki od najbardziej złożonych funkcji; kopiowanie albo pobranie pliku.
- **WebLLM** — modele uruchamiane w przeglądarce (WebGPU), wagi w cache, bez wysyłania czegokolwiek.
- **Ollama** — lokalny serwer modeli na Twoim komputerze.
- **Klucze API (chmura)** — dowolna liczba kluczy: Mistral, OpenAI, Anthropic (Claude), Google Gemini, Groq,
  OpenRouter, DeepSeek, xAI, Together. Dostawca jest **wykrywany po formacie klucza** i potwierdzany
  przyciskiem „Testuj" (lista modeli), model wybierany per klucz; działające klucze używane rotacyjnie.
- **ChatBot** steruje aplikacją (ok. 50 akcji: układ, filtry, motyw, wyszukiwanie, migawki…). Akcje spoza
  zbioru „tylko widok" wymagają kliknięcia — model nie może sam wczytać, skasować ani wyeksportować.
- W polu czatu wpisz **`/`**, aby zobaczyć wszystkie narzędzia (statystyki, top plików, szukanie w treści,
  zależności, eksport…); przeciągnij element z mapy do okna czatu, aby dołączyć go do pytania (do 30).
  Okno czatu można przesuwać i rozciągać, a lista rozmów ma regulowaną szerokość.
- Modele myślące (DeepSeek R1, Qwen 3) pokazują tok rozumowania w zwijanym panelu; przycisk ⚡ daje
  szybką odpowiedź bez rozumowania.
  Modele lokalne (WebLLM, Ollama) odpowiadają w **trybie strukturalnym**: JSON `{reply, actions}` wymuszony
  schematem, więc nawet małe modele niezawodnie wykonują polecenia.
- **Pytania o kod (RAG, tryb 📚)** — przełącznik w nagłówku czatu: ChatBot odpowiada na podstawie
  fragmentów kodu wczytanego projektu i cytuje je jako `[1]`, `[2]` (klik = plik otwarty na tych liniach).
  Wyszukiwanie słów działa od razu (identyfikatory rozbijane, pytania po polsku rozszerzane o angielskie
  pojęcia); model embeddingów w Ollamie (`bge-m3`, `nomic-embed-text`) albo 🌐 **w przeglądarce** (WebLLM
  `snowflake-arctic-embed`, WebGPU, bez Ollamy) dodaje wyszukiwanie semantyczne —
  indeks budowany w Ustawieniach → AI, wektory zapisane w przeglądarce i przeliczane tylko dla zmienionych
  fragmentów. Narzędzie `/codeSearch` pokazuje trafienia bez modelu.
- **Agent z narzędziami (Ollama i WebLLM, tryb 📚)** — gdy fragmenty nie wystarczą, model sam sprawdza kod przed
  odpowiedzią: `codeSearch`, `readFile`, `findFiles`, `dependencies`, `dependents`, `fileInfo`, `hotspots`, `owners` (git), `tests` oraz
  widokowe `showOnMap` (podświetla pliki, o których jest odpowiedź, i ustawia na nich kamerę) —
  wyłącznie odczyt, w przeglądarce, na wczytanym projekcie. Działa z natywnymi wywołaniami narzędzi
  (Llama 3.x, Qwen 3), z modelami, które zapisują wywołanie jako JSON w treści (Qwen 2.5 Coder), a w przeglądarce
  (WebLLM) — z każdym krokiem wymuszonym gramatyką jako JSON (nazwy narzędzi z enum); wyniki
  narzędzi są cytowane jako `[n]` jak fragmenty, a kroki widać w zwijanej liście „Kroki agenta". Najwyżej
  5 kroków, potem model musi odpowiedzieć. Plik wymieniony w pytaniu (`agent.js`) zawsze trafia do kontekstu.
  Wyłączany w Ustawieniach → AI → Ollama.
- **🩺 Doktor hotspotów** — plan refaktoryzacji jednego ryzykownego pliku: panel pliku pokazuje jego miejsce w rankingu
  ryzyka i przycisk *Plan refaktoryzacji* (albo `/hotspotDoctor`, domyślnie plik z czoła hotspotów). Model dostaje
  kartotekę pliku — rozmiar, złożoność, zmiany i autorów z git, testy i pokrycie, zależne pliki — i ponumerowane
  fragmenty najdłuższych funkcji, a odpowiada w czterech stałych sekcjach: diagnoza, 3–5 małych kroków z cytatami
  kodu `[n]`, testy do dopisania przed zmianą, ryzyko. Tylko modele lokalne (kod nie wychodzi z komputera).
- **🧭 Trasy po kodzie** (Projekt → *Trasa po kodzie…*) — uporządkowana ścieżka po plikach z notatką przy każdym
  kroku, dla nowej osoby w projekcie: tworzona automatycznie z mapy (opis → punkty wejścia → rdzeń, od którego zależy
  najwięcej plików → hotspot → testy) albo układana przez model **tylko ze struktury** (ścieżki, metryki, zależności,
  nazwy symboli — więc działa też z modelem w chmurze). Odtwarzana na mapie: karta kroku, ponumerowane kroki ze
  strzałkami, ← / → / Esc; notatki można edytować, trasa zapisuje się w mapie, idzie linkiem (`#tour=…`, sama albo
  z `#repo=`) i do / z **VS Code CodeTour** (`.tour`).
- **Runner** — sandbox do uruchamiania wygenerowanego HTML/SVG/CSS/JS/PHP: `runner.html` trzyma kod w zagnieżdżonym
  `iframe sandbox` bez `allow-same-origin`, więc nie ma on dostępu do aplikacji, choć aplikacja ma ścisłe CSP.
- Do modeli w chmurze trafia wyłącznie **struktura** projektu (nazwy, liczby), nigdy treść plików; fragmenty
  kodu (tryb 📚, podgląd załączników) dostają tylko modele **lokalne** — WebLLM i Ollama.

### MindMap
Drugi tryb pracy: 16 szablonów kart, **34 typy diagramów**, warstwa rysowania z 9 narzędziami
(styl odręczny), undo/redo, import/eksport Markdown, oś czasu migawek.

### Dysk i Sejf
- **Sejf** — magazyn w OPFS szyfrowany hasłem (AES-GCM-256, PBKDF2), galeria zdjęć, album „Ulubione".
- **Dysk** — prawdziwy folder na komputerze przez File System Access API (uchwyt trwały).

### Interfejs
Polski i angielski, motyw ciemny/jasny, 8 presetów kolorystycznych, suwaki wyglądu „liquid glass",
interaktywny samouczek (CodeMap i MindMap), wbudowana instrukcja, PWA do zainstalowania.

### Przegląd PR — mapa wpływu
- **Asystent przeglądu PR** (model lokalny — diff to kod): „🔍 Asystent przeglądu” w karcie PR albo akcja `prAssist` —
  mapa wpływu (ryzyko pliku i jego powody, zależne, brakujące testy, recenzenci) oraz ponumerowane fragmenty diffu [n]
  z łatek hostingu, od najbardziej ryzykownych plików, w budżecie modelu; odpowiedź w czterech sekcjach: podsumowanie,
  ryzyka z cytatami [n], brakujące testy, pytania do autora. **Przed / po**: widok zmienionego pliku obok siebie z łatki.
  Łatki są tylko w pamięci — nigdy w zapisanej mapie ani w linku udostępniania.
- Projekt → **Przegląd PR** (numer albo adres PR / MR z GitHub, GitLab, Bitbucket) albo link
  `#repo=owner/nazwa&pr=N`: zmienione pliki (znaczniki A/M/D/R na węzłach), pliki od nich zależne i **ryzyko
  każdej zmiany** (0–100) z częstości zmian, złożoności, liczby zależnych, testów / pokrycia, rozmiaru zmiany
  i tego, czy autor zna plik; sugerowani recenzenci z historii git; kolorowanie „Wpływ PR"; raport Markdown.
- To samo w CI: CLI `--base` / `--baseline` / `--pr-md` i komentarz w PR z GitHub Action
  (health score przed i po, nowe znaleziska, próg `max-score-drop`) — [docs/github-action.md](docs/github-action.md).

### CLI i CI
- `node cli/codemap.mjs analyze [ścieżka]` (albo `npm link` → `codemap`) — ta sama analiza co panel „Analiza
  statyczna", bez przeglądarki i bez zależności npm: historia git z `.git`, testy i pokrycie, reguły architektury.
- Raporty: terminal, `--json`, `--md`, `--sarif` (GitHub code scanning), `--map` (mapa do otwarcia w aplikacji),
  `--export dot|mermaid|graphml`. Progi dla CI: `--min-score`, `--fail-on cycles,archviolation|high`,
  `--max-findings` (kody wyjścia 0 / 1 / 2); przegląd zmian: `--base <ref>`, `--baseline`, `--pr-md`,
  `--max-score-drop`.
- `--osv` — podatne zależności z api.osv.dev (tylko nazwy i wersje pakietów) jako znaleziska w każdym raporcie.
- **Trend zdrowia**: `--history N` — N commitów rozłożonych równo na historii (pierwszy rodzic HEAD), każde drzewo
  czytane wprost z `.git` (bez checkoutu i binarki git) i analizowane jak folder, bez reguł historii git i pokrycia,
  żeby punkty były porównywalne; tabela w podsumowaniu, `history` w `--json`, sekcja ze zmianami reguł w `--md`.
  W aplikacji: Projekt → **Trend zdrowia** dla folderu wczytanego razem z `.git` — to samo liczenie w przeglądarce
  z paskiem postępu i anulowaniem, wykres wyniku w czasie, tabela punktów i największe zmiany reguł.
- Paczka npm (jeszcze nieopublikowana — nazwa `codemap` jest zajęta, więc idzie pod zakresem): `npm run npm-pack -- --name @zakres/codemap`
  buduje paczkę 170 KB (CLI + 17 modułów analizy), instaluje ją w katalogu tymczasowym i uruchamia zainstalowane
  `codemap analyze`; potem `npm publish dist/npm/<plik>.tgz --access public` i `npx @zakres/codemap analyze .`.
- **GitHub Action**: `uses: RaCzKoViC/CodeMap@v1.5.1` — raport w podsumowaniu kroku, SARIF, progi; przykład
  z code scanning w [docs/github-action.md](docs/github-action.md). Ten sam krok działa w CI tego repozytorium.

### Rozszerzenie VS Code
`integrations/vscode/` — ta sama analiza w edytorze: znaleziska Inspect w **Problems** (linia, reguła, powiązane
pliki), health score w pasku stanu, CodeLens nad hotspotami git, mapa CodeMap w panelu i nawigacja w obie strony
(plik ↔ węzeł), analiza przy zapisie. Lokalnie, w wątku roboczym, bez sieci. Instalacja:
`cd integrations/vscode && npm run package` → `code --install-extension codemap-0.1.0.vsix` (VS Code ≥ 1.90).

---

## ⌨️ Skróty klawiszowe

| Klawisz | Działanie | | Klawisz | Działanie |
|---|---|---|---|---|
| `F` | dopasuj widok | | `Q` / `E` | obróć w lewo / prawo |
| `+` / `-` | przybliż / oddal | | `R` | wyzeruj obrót |
| `/` | wyszukiwanie | | `T` | perspektywa (pseudo-3D) |
| `Ctrl+K` | paleta poleceń | | `Alt+S` | ściągawka skrótów |
| `Esc` | odznacz / zamknij | | `WASD` + `Spacja` | tryb lotu |

Mysz: przeciąganie tła = przesuwanie • kółko = zoom • `Shift`+przeciąganie lub PPM = obrót •
dwuklik na folderze = zwiń/rozwiń • PPM = menu kontekstowe.

---

## 🔒 Prywatność — co opuszcza Twoje urządzenie

Domyślnie **nic**. Analiza, mapa, migawki, Sejf i historia żyją w przeglądarce. Sieć jest używana tylko
na Twoje wyraźne żądanie:

| Kiedy | Dokąd | Co |
|---|---|---|
| wczytanie repozytorium | api.github.com / gitlab.com / api.bitbucket.org | adres repo, opcjonalny token (tylko w pamięci karty) |
| Historia git repozytorium z URL — na żądanie | te same API + avatars.githubusercontent.com | zapytania o listę commitów i zmienione pliki; awatary autorów. Lokalny `.git` jest czytany wyłącznie w przeglądarce |
| klucz API (chmura) | API wybranego dostawcy (api.mistral.ai, api.openai.com, api.anthropic.com, …) | Twój klucz i struktura projektu (nazwy, liczby) |
| WebLLM | esm.run, huggingface.co | pobranie biblioteki i wag modelu; inferencja lokalnie |
| Runner PHP | cdn.jsdelivr.net | pobranie interpretera php-wasm |
| Symbole (tree-sitter) — po włączeniu | cdn.jsdelivr.net | pobranie parsera web-tree-sitter i gramatyk WASM; parsowanie lokalnie w Web Workerze |
| Podatne zależności — na żądanie, po podglądzie tego, co wyjdzie | api.osv.dev | tylko nazwy pakietów, ekosystemy i wersje (z plików blokad / manifestów) — bez kodu, ścieżek i nazwy projektu |
| Ollama | 127.0.0.1:11434 | lokalnie — także fragmenty kodu w trybie 📚 i ich embeddingi (RAG) |
| konto (opcjonalne) | Twój własny serwer | mapy, migawki, ustawienia; Sejf **tylko jako szyfrogram** |
| otwarcie linku `#repo=` / `#gist=` | te same API co wczytanie repozytorium; api.github.com i gist.githubusercontent.com | adres repozytorium / id gista, **bez tokenu** |
| publiczny link do mapy — po zalogowaniu, na żądanie | Twój serwer, potem **każdy, kto ma link** | kopia mapy: nazwy i ścieżki plików, metryki, zależności; podgląd treści i e-maile autorów tylko po odznaczeniu opcji; do wygaśnięcia lub unieważnienia |

Klucze API są przechowywane w `localStorage` przeglądarki i nigdy nie są synchronizowane z serwerem.
Szczegóły i sposób zgłaszania podatności: [SECURITY.md](SECURITY.md).

---

## 🧱 Architektura

Czysty JavaScript, bez zależności i bez kroku budowania. Moduły to globalne obiekty `CM.*`
ładowane w kolejności z `index.html`.

```
index.html                 # struktura UI
css/styles.css             # motyw „cyber-cartography" (ciemny / jasny)
js/util.js                 # kamera (pan/zoom/obrót/tilt), narzędzia, CM.VERSION
js/icons.js  js/i18n.js    # ikony SVG, tłumaczenia PL/EN
js/languages.js            # rejestr 150+ formatów
js/analysis.js             # metryki, parsowanie importów, rozwiązywanie zależności
js/analysis-worker.js      # analiza plików (metryki, importy, symbole) w maks. 4 Web Workerach
js/analysis-cache.js       # pamięć analizy w OPFS: niezmienione pliki (rozmiar + data / sha bloba, inaczej skrót treści) bez ponownej analizy
js/symbols-core.js  js/symbols.js  js/symbols-worker.js   # graf symboli: tree-sitter w workerze
js/graph.js                # model: hierarchia, agregaty, zwijanie, cykle, wpływ, (de)serializacja, diff
js/layouts.js              # 13 układów (+ fizyka), js/sim-worker.js — Web Worker
js/export.js               # eksport widocznego grafu: DOT (Graphviz), Mermaid, GraphML (yEd)
js/metrics.js              # sprzężenia Ca/Ce/I per plik i folder, duplikaty kodu (winnowing)
js/rules.js                # reguły architektury z .codemap.rules.json (warstwy, forbid, noCycles)
js/git-core.js             # historia git bez DOM: autorzy, własność, bus factor, hotspoty, oś czasu
js/git-local.js  js/git-worker.js   # czytnik lokalnego .git (obiekty, paczki, delty, packed-refs) w Web Workerze
js/rag.js                  # RAG: fragmenty kodu wg symboli, BM25 + embeddingi Ollamy (IndexedDB), kontekst z cytatami
js/agent.js                # pętla agenta: narzędzia tylko do odczytu (codeSearch, readFile, dependents…), tool_calls albo JSON w treści
js/doctor.js  js/doctor-ui.js   # Doktor hotspotów: kartoteka pliku + prompt (czyste), sekcja w panelu pliku i akcja hotspotDoctor
js/cochange.js                  # sprzężenie zmian (GitCore.coupling): sekcja „Zmieniany razem z" w panelu, akcja changeCoupling
js/dsm.js  js/dsm-ui.js         # pakiety i macierz zależności: jednostki, kolejność dostawcy → konsumenci, cykle (czyste) + okno DSM
js/codeowners.js  js/codeowners-ui.js  # CODEOWNERS: wzorce, właściciele → autorzy git, bez właściciela / rozjazd (czyste) + panel, kolorowanie, akcja
js/vulns.js  js/vulns-ui.js     # podatne zależności: wersje z blokad/manifestów, querybatch OSV.dev, CVSS 3 (czyste) + okno, kolorowanie
js/mapquery.js                  # pytania o mapę językiem naturalnym (PL/EN) → spec → pliki, bez modelu; akcja mapQuery
js/testgen.js                   # szkielety testów: framework i położenie wg konwencji projektu, przypadki wg złożoności (czyste)
js/pr-review.js                 # asystent przeglądu PR: łatka → hunki → wiersze przed/po, prompt z fragmentami [n] (czyste)
js/health-trend.js  js/health-trend-ui.js  # trend zdrowia w historii git (wspólny dla CLI i aplikacji) + okno z wykresem
js/tour.js  js/tour-ui.js       # trasy po kodzie: automatyczne / z modelu ze struktury, CodeTour, linki #tour=; odtwarzacz na mapie
js/testmap.js              # testy ↔ kod, parsery pokrycia (lcov / Istanbul / Cobertura / JaCoCo / Clover)
js/renderer.js             # canvas: rysowanie, hit-test, interakcje, minimapa, dekoratory modułów
js/gl-layer.js             # warstwa WebGL2 pod mapą: krawędzie i figury na GPU (instancje, kamera jako uniform)
js/overlays.js             # kolorowanie węzłów wg danych (język, złożoność, git, pokrycie) + legenda
js/loaders.js              # folder / pliki / archiwa / PDF / GitHub / GitLab / Bitbucket / Mistral; pliki boczne (.git, lcov)
js/git-remote.js           # historia commitów z API GitHub / GitLab / Bitbucket
js/storage.js              # migawki i sesja (IndexedDB)
js/ui.js                   # panele szczegółów, filtry, historia, diff
js/settings.js             # okno ustawień: rejestr zakładek, zakładki ogólne, interaktywny samouczek
js/settings-strings.js     # teksty ustawień i samouczka (PL / EN)
js/settings-ai.js          # zakładka AI: dostawcy, klucze API, WebLLM, Ollama, indeks kodu (RAG)
js/settings-docs.js        # wbudowana specyfikacja i instrukcja obsługi
js/inspect.js              # analiza statyczna (16 reguł + reguły architektury, health score)
js/localai.js  js/ollama.js  js/chatbot.js  js/runner.js   # AI: WebLLM, Ollama, ChatBot, sandbox
js/chatbot-strings.js  js/chatbot-core.js  js/chatbot-render.js   # ChatBot: teksty PL/EN, czysta logika (narzędzia, prompty, walidacja akcji), renderowanie
js/mindmap.js  js/mmdraw.js  # tryb MindMap: edytor, renderowanie, interakcja + warstwa rysowania
js/mindmap-strings.js      # MindMap: słowniki tekstów (klucze i18n + polskie teksty zapasowe)
js/mindmap-templates.js    # MindMap: 16 ramek kart, 34 typy diagramów, miniatury, karta kodu
js/mindmap-layout.js       # MindMap: algorytmy układu + okno „Schemat układu”
js/mindmap-io.js           # MindMap: import/eksport Markdown, .mindmap.json, SVG/PNG, zapis lokalny, migawki
js/mindmap-ui.js           # MindMap: widżety (okno tekstu, popover, menu, przyciski pierścienia)
js/drive.js                # Dysk (File System Access) i Sejf (OPFS + AES-GCM)
js/auth.js  js/sync.js     # konto i synchronizacja (tylko z backendem)
js/app-core.js             # CM.App — wspólny kontekst (graph, renderer, state, filters, handlers) + rdzeń:
                           #   init/boot, apply, ingest, loadFromJSON, clearAll, zaznaczenie, sesja, tryby, worker
js/chrome.js               # okablowanie DOM: toolbar, menu, panele, wygląd/ustawienia, filtry, szukaj, DnD, klawiatura, PWA
js/repo-hosts.js           # GitHub/GitLab/Bitbucket: autorzy, deep-linki, gałęzie, gist, udostępnialny widok (#v=)
js/compare.js              # porównywanie schematów, cykle, historia migawek i diff, hotspoty/Inspect
js/navigation.js           # radar okolicy, minimapa, tarcza obrotu, nawigacja WASD, menu kontekstowe, eksport obrazu
js/ai-bridge.js            # AI (Mistral/lokalne), most ChatBota (appState/exec, registerAction), paleta Ctrl+K, dane demo
js/git.js                  # historia git na mapie: uruchamianie, nakładki, panel, awatary, oś czasu, akcje ChatBota
js/pr-core.js  js/pr.js    # mapa wpływu PR: ryzyko zmian, zależne, recenzenci (bez DOM) + okno, nakładka, panel
js/tests-ui.js             # testy i pokrycie w aplikacji: nakładki, panel, Inspect, ChatBot, wczytywanie raportów
js/deeplink.js  js/links.js  # linki #repo= / #gist= / #share= (walidacja, wczytanie), okno publicznych linków
js/app.js                  # bootstrap: CM.App.boot() + window.CMApp (API dla chatbot/drive/inspect/smoke)
js/vscode-bridge.js        # most do rozszerzenia VS Code (poza jego webview nic nie robi)
integrations/vscode/       # rozszerzenie VS Code: diagnostyki, pasek stanu, CodeLens, panel z mapą
cli/                       # CLI headless (runtime vm z tymi samymi js/*.js, analiza, SARIF, raporty); action.yml — GitHub Action
sw.js  manifest.webmanifest  serve.py                       # PWA i lokalny serwer
```

Moduły `app-core` → `ai-bridge` dzielą jeden kontekst `CM.App` (`A`): każdy dopisuje swoje funkcje przez
`Object.assign(A, …)` i woła pozostałe wyłącznie w czasie działania przez `A.nazwa(…)`, więc poza tym, że
`app-core.js` ładuje się pierwszy (tworzy `CM.App`), a `app.js` ostatni, ich kolejność nie ma znaczenia.
`A.graph` jest podmieniany przy każdym wczytaniu — moduły czytają go w momencie wywołania, nie kopiują.

Plan rozwoju i znane długi techniczne: [docs/ROADMAP.md](docs/ROADMAP.md).

---

## ☁️ Konto i synchronizacja (opcjonalny backend)

Katalog `server/` zawiera mały serwer (Node.js ≥ 20.6, Fastify, SQLite) dodający konta z weryfikacją
e-mail i synchronizację map, migawek, ustawień oraz Sejfu — ten ostatni **wyłącznie jako szyfrogram**
(AES-GCM po stronie klienta; serwer nigdy nie widzi haseł ani treści). Bez logowania aplikacja działa
w 100 % lokalnie. Bez backendu przycisk „Konto" jest ukryty. Zalogowany użytkownik może utworzyć **publiczny
link do mapy** (Projekt → „Udostępnij publiczny link…", `#share=<id>`) z czasem wygaśnięcia i unieważnianiem
w Ustawienia → Konto; domyślnie bez podglądu treści plików. Testy backendu: `cd server; npm test`.

```powershell
cd server; copy .env.example .env; npm install; npm start   # → http://localhost:8787 (frontend + API)
```

Maile w trybie dev drukują się w konsoli (`EMAIL_MODE=console`). Serwer dev nasłuchuje tylko na
`127.0.0.1` i serwuje wyłącznie pliki frontendu. Produkcja (Caddy + systemd + backup):
[`deploy/setup-vps.md`](deploy/setup-vps.md), wgrywanie `.\tools\deploy.ps1 -Server deploy@twoja-domena`.

---

## 🤝 Współpraca

Zgłoszenia błędów i pomysły: [Issues](https://github.com/RaCzKoViC/CodeMap/issues).
Zasady, które utrzymują projekt prostym:

- brak kroku budowania i zależności npm po stronie frontendu — nowe biblioteki tylko ładowane na żądanie;
- każdy tekst w UI przez `CM.i18n.t()` z tłumaczeniem PL **i** EN;
- zmiana plików `js/` lub `css/` = bump `?v=` w `index.html` i `CACHE` w `sw.js`;
- `index.html` edytuj narzędziem zachowującym UTF-8;
- przed commitem `npm run verify` (testy, lint, sonda gramatyk, sonda `.git` zgodna z `git log`) i `node tools/smoke.mjs` (headless Chrome);
  po zmianach w rozwiązywaniu importów `npm run corpus` (wymaga gita; Python i Go dla wyroczni Flask i Gin);
  po zmianach w wyglądzie `node tools/screenshots.mjs` odświeża zrzuty w `docs/`.

Historia zmian: [CHANGELOG.md](CHANGELOG.md).

---

## 📜 Licencja

CodeMap jest **open source** na licencji [MIT](LICENSE) — możesz go używać, kopiować, modyfikować
i rozpowszechniać (także komercyjnie), pod warunkiem zachowania informacji o prawach autorskich.

Biblioteki ładowane na żądanie: [WebLLM](https://github.com/mlc-ai/web-llm) (Apache-2.0),
[rough.js](https://github.com/rough-stuff/rough) (MIT), [php-wasm](https://github.com/seanmorris/php-wasm) (Apache-2.0).
Backend: Fastify, better-sqlite3, argon2 (MIT).
