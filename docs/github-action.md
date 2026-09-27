# CodeMap w CI — GitHub Action, CLI i SARIF

Ta sama analiza co w aplikacji (graf zależności, cykle, god-files, reguły architektury z
`.codemap.rules.json`, duplikaty, hotspoty zmian i „wiedza w jednej głowie" z historii git, pliki bez
testów i niskie pokrycie, health score), uruchamiana z wiersza poleceń albo jako krok GitHub Actions.
CLI ładuje te same moduły `js/*.js` co przeglądarka (w kontekście `vm` Node.js) — wyniki są identyczne
z panelem **Analiza statyczna** w aplikacji. Bez zależności npm, bez sieci; wymaga Node.js ≥ 20.6.

## Akcja — najprostsze użycie

```yaml
# .github/workflows/codemap.yml
name: CodeMap
on: [push, pull_request]
permissions:
  contents: read
jobs:
  codemap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # pełna historia → hotspoty zmian, bus factor
      - uses: RaCzKoViC/CodeMap@main  # w produkcji przypnij tag albo SHA commita
        with:
          min-score: 60             # health score < 60 → krok kończy się porażką
          fail-on: cycles,archviolation
```

Raport Markdown (wynik, języki, znaleziska wg reguł, hotspoty, git, testy i pokrycie, szczegóły reguł)
trafia do **podsumowania kroku** (`$GITHUB_STEP_SUMMARY`), podsumowanie tekstowe — do logu.

## Przegląd PR — komentarz z ryzykiem zmian

W zdarzeniu `pull_request` akcja sama bierze bazę PR (`github.event.pull_request.base.sha`): liczy ryzyko
każdego zmienionego pliku (częstość zmian z historii git, złożoność, pliki zależne, testy / pokrycie, rozmiar
zmiany, znajomość pliku przez autora), health score przed i po zmianach, nowe znaleziska i sugerowanych
recenzentów — i dodaje **jeden** komentarz w PR, aktualizowany przy kolejnych pushach.

```yaml
# .github/workflows/codemap-pr.yml
name: CodeMap PR
on: pull_request
permissions:
  contents: read
  pull-requests: write          # komentarz w PR
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # historia git i baza PR
      - uses: RaCzKoViC/CodeMap@v1.5.1   # komentarz w PR: od wydania v1.2.0
        with:
          pr-comment: true
          max-score-drop: 0     # porażka, gdy PR obniża health score
```

Wejścia przeglądu: `base` (domyślnie baza PR), `baseline` (`true` — health score bazy z tymczasowego
`git worktree`), `max-score-drop`, `pr-comment`, `map-link` (link do mapy wpływu w aplikacji — działa
dla repozytoriów publicznych), `github-token`. Wyjścia: `risk`, `score-delta`. To samo w CLI:
`codemap analyze --base origin/main --baseline --pr-md pr.md [--max-score-drop 0]`.

## Akcja z GitHub code scanning (SARIF)

Znaleziska jako alerty w zakładce **Security → Code scanning** i adnotacje w pull requestach:

```yaml
name: CodeMap
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
  security-events: write          # wymagane przez upload-sarif
jobs:
  codemap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # (opcjonalnie) pokrycie: wygeneruj raport PRZED analizą — np. npm ci && npx vitest run --coverage
      - id: codemap
        uses: RaCzKoViC/CodeMap@main
        with:
          sarif: codemap.sarif
          fail-on: high             # porażka przy znaleziskach krytycznych
          lang: en
      - uses: github/codeql-action/upload-sarif@v3
        if: always()                # wyślij raport także wtedy, gdy próg nie przeszedł
        with:
          sarif_file: ${{ steps.codemap.outputs.sarif-file }}
          category: codemap
      - run: echo "Health score ${{ steps.codemap.outputs.score }}/100"
        if: always()
```

Code scanning jest bezpłatny dla repozytoriów publicznych; w prywatnych wymaga GitHub Advanced Security.
Bez niego zapisz SARIF jako artefakt (`actions/upload-artifact`) i otwórz go w VS Code (SARIF Viewer).

### Wejścia

| Wejście | Domyślnie | Opis |
|---|---|---|
| `path` | `.` | Katalog do analizy. W monorepo np. `packages/app` — ścieżki w SARIF i tak są względem korzenia repozytorium. |
| `min-score` | — | Minimalny health score (0–100). |
| `fail-on` | — | Po przecinku: poziom ważności `high` \| `med` \| `low` \| `info` (ten **lub wyższy**) albo identyfikatory reguł (`cycles,archviolation`). |
| `max-findings` | — | Porażka, gdy znalezisk łącznie jest więcej niż N. |
| `sarif` | `codemap.sarif` | Plik SARIF 2.1.0; puste = bez SARIF. |
| `markdown` | — | Plik z raportem Markdown (raport i tak trafia do podsumowania kroku). |
| `architecture` | — | Plik `ARCHITECTURE.md` wygenerowany z mapy (warstwy, pakiety, punkty wejścia, rdzeń, hotspoty, własność, testy, reguły, cykle) — np. jako artefakt albo do commita przez osobny krok. |
| `lang` | `pl` | Język raportów: `pl` \| `en`. |
| `git` | `true` | Historia git z `.git` (hotspoty zmian, wiedza w jednej głowie, bus factor). |
| `args` | — | Dodatkowe argumenty CLI rozdzielone spacjami (bez cudzysłowów), np. `--coverage coverage/lcov.info --exclude docs/**`. |
| `node-version` | `22` | Wersja Node.js (≥ 20.6). |

### Wyjścia

| Wyjście | Opis |
|---|---|
| `score` | Health score (0–100). |
| `findings` | Łączna liczba znalezisk. |
| `sarif-file` | Ścieżka zapisanego pliku SARIF (pusta, gdy wyłączony). |

Krok kończy się kodem wyjścia CLI: **0** — OK, **1** — próg niespełniony (powody w logu), **2** — błąd
użycia lub wykonania. Wyjścia i podsumowanie kroku są zapisywane także przy porażce progu.

## CLI

```bash
node cli/codemap.mjs analyze [ścieżka=.] [opcje]     # z klonu repozytorium CodeMap
npm run cli -- analyze ../moj-projekt --md raport.md  # to samo przez npm
npm link && codemap analyze .                         # polecenie `codemap` w PATH (package.json → bin)
```

| Opcja | Opis |
|---|---|
| `--json <plik>` | Pełny raport JSON: `score`, `files`, `stats` (pliki, linie, języki), `totals`, `findings` (reguła, ważność, tytuł, opis, liczba, pozycje ze ścieżkami), `hotspots`, `git`, `tests`, `timing`, `warnings`. |
| `--md <plik>` | Raport Markdown (jak eksport „Analiza statyczna" w aplikacji + podsumowanie). |
| `--sarif <plik>` | SARIF 2.1.0. |
| `--architecture <plik>` | `ARCHITECTURE.md` z mapy: foldery w kolejności zależności (⚠ cykl przy zależności pod prąd), pakiety (od 2), punkty wejścia, rdzeń, hotspoty z właścicielami, własność folderów, testy i ich konwencja, reguły architektury, cykle, ukryte sprzężenia. Bez daty — deterministyczny. |
| `--map <plik>` | Mapa `.codemap.json` (z historią git i pokryciem) do otwarcia w aplikacji: Wczytaj → Plik. |
| `--export dot\|mermaid\|graphml` | Graf (Graphviz / Mermaid / yEd); z `--out <plik>`, bez niego na stdout. |
| `--no-git`, `--git-max N` | Bez historii git / najwyżej N commitów (domyślnie 3000, jak w aplikacji). |
| `--coverage <plik>` | Raport pokrycia (lcov, Istanbul, Cobertura, JaCoCo, Clover; można powtórzyć). Domyślnie autodetekcja jak w aplikacji: `lcov.info`, `coverage-final.json`, `coverage-summary.json`, `cobertura.xml`, `jacoco.xml`, `clover.xml` do 5 poziomów głębokości, także w `coverage/`, `build/`, `target/`. |
| `--no-coverage` | Bez raportów pokrycia. |
| `--exclude <glob>` | Pomiń pliki i katalogi (np. `docs/**`, `**/*.min.js`); można powtórzyć. |
| `--max-content N` | Limit plików z czytaną treścią (domyślnie 4000, jak w przeglądarce). |
| `--min-score N`, `--fail-on <lista>`, `--max-findings N` | Progi jak w akcji. |
| `--lang pl\|en`, `--quiet` / `-q`, `--no-color` | Język, bez podsumowania (błędy i niespełnione progi nadal na stderr), bez kolorów. |

`-` jako plik = standardowe wyjście (np. `--json - | jq .score`); podsumowanie idzie wtedy na stderr.
Wczytywanie plików stosuje reguły aplikacji: pomijane `node_modules`, `dist`, `build`, `coverage`, `.git`,
`vendor`, `target`, `.venv`, `__pycache__` itd., treść tylko plików tekstowych do 600 KB. Różnice:
kolejność alfabetyczna (deterministyczna), dowiązania symboliczne pomijane, archiwa i PDF-y nie są
rozpakowywane. Historia git jest czytana z `.git` analizowanego katalogu albo najbliższego katalogu
nadrzędnego (analiza podkatalogu monorepo), także gdy `.git` jest plikiem (`git worktree`, submoduł);
płytki klon (`fetch-depth: 1`) daje historię tylko od granicy klonu.

### Reguły architektury z macierzy zależności: `codemap rules`

```bash
codemap rules --out .codemap.rules.json          # pakiety (monorepo) albo foldery poziomu 1
codemap rules --folders --depth 2 --out .codemap.rules.json
```

Warstwy = jednostki macierzy zależności w kolejności dostawcy → konsumenci; zakazane są zależności dostawcy od
konsumentów, ale tylko tam, gdzie dziś ich nie ma — reguły od razu przechodzą, a akcja z `fail-on: archviolation`
albo `codemap check` zatrzymuje każdą nową zależność „pod prąd". Istniejące (cykle) są wypisane na stderr jako
wyjątki do naprawy. To samo w aplikacji: okno „Macierz zależności" → Zaproponuj reguły → Zatwierdź.

### Przed commitem: `codemap check`

```bash
codemap check                    # zmiany w indeksie (git add) vs HEAD
codemap check --install-hook     # hook pre-commit (.git/hooks albo core.hooksPath); --uninstall-hook usuwa
```

Stan „po" to indeks gita — dokładnie to, co wejdzie do commita (także przy `git add -p` i `git commit -a`);
stan „przed" to HEAD. Oba są czytane poleceniami tylko do odczytu (`ls-files`, `ls-tree`, `cat-file`) — bez
checkoutu i bez zmian w indeksie — i analizowane tak samo (bez historii git i pokrycia, więc porównywalnie).
Wynik: ryzyko i liczba zależnych plików (jak w przeglądzie PR, z historią git), zmiana health score, nowe
znaleziska i osoby znające zmieniany kod. Kod **1**, gdy commit wprowadza nowe znaleziska z `--fail-on` —
domyślnie `archviolation,cycles,pkgcycle` (zakazane zależności warstw z `.codemap.rules.json`, cykle importów
i pakietów); `--fail-on high` = każde nowe znalezisko wysokiej ważności, `--fail-on none` = tylko informacja.
Hook nie nadpisuje cudzego `pre-commit` (podaje linię do dopisania); jednorazowe pominięcie:
`git commit --no-verify`. Opcje `--fail-on`, `--exclude` i `--no-git` podane przy `--install-hook` trafiają
do hooka. `--json <plik>` zapisuje wynik (nowe znaleziska, ryzyko, zmiana wyniku, powody porażki).

API dla innych narzędzi (np. rozszerzenia edytora):

```js
import { analyzeProject } from './cli/analyze.mjs';
const { graph, report, sarif, markdown } = await analyzeProject('.', { lang: 'en', git: true });
// graph = graph.toJSON() (format .codemap.json), report = to samo co --json
```

## Format SARIF — decyzje

- `runs[0].tool.driver`: `name: CodeMap`, `informationUri`, `version` (= `CM.VERSION`), `rules` — tylko
  reguły, które dały wynik, z `shortDescription`, `fullDescription`, `help`, `defaultConfiguration.level`
  i tagami (`architecture`, `maintainability`, `testing`, `git`, `security`…) w języku `--lang`.
- `ruleId` = identyfikator reguły Inspect (`cycles`, `god`, `archviolation`, `gitHotspot`, `untested`,
  `lowcov`, `dupcode`…) — ten sam co w `--fail-on` i w raporcie JSON.
- Jeden wynik na pozycję znaleziska (aplikacja przechowuje do 60 na regułę; nadwyżka jest policzona
  w `run.properties.truncated`). `level` wg ważności pozycji: `high` → `error`, `med` → `warning`,
  `low`/`info` → `note`.
- Lokalizacje: URI względne z `uriBaseId: "%SRCROOT%"` = korzeń repozytorium git (albo analizowany katalog
  poza repozytorium), segmenty kodowane procentowo; nigdy ścieżki absolutne. `region.startLine` zawsze —
  dla cykli i naruszeń architektury to linia importu pliku docelowego (heurystyka na treści), w pozostałych
  regułach 1 (znalezisko dotyczy całego pliku).
- `relatedLocations`: cykle — pozostałe pliki cyklu (do 100); duplikaty — drugi plik pary; naruszenia
  architektury — importowany plik.
- Znaleziska folderów (`deep`, `crowded`) są pomijane — konsumenci SARIF zakotwiczają alerty w plikach;
  zostają w JSON i Markdown, ich liczba jest w `run.properties.folderFindings`.
- `partialFingerprints["codemap/v1"]` — skrót z reguły, ścieżki i posortowanych ścieżek powiązanych
  (dla naruszeń architektury także szczegółu bez cyfr): stabilny między przebiegami, niezależny od języka
  raportu i od zmieniających się liczb (linie, złożoność, liczba zmian).
- `run.properties`: `healthScore`, `files`, `findings`, `folderFindings`, `truncated`.
