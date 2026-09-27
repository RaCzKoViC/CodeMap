# CodeMap for VS Code

**PL** · Kartografia kodu w edytorze: [CodeMap](https://github.com/RaCzKoViC/CodeMap) analizuje folder
workspace tą samą logiką co aplikacja w przeglądarce i CLI — lokalnie, bez sieci i bez wysyłania kodu.

**EN** · Code cartography in the editor: [CodeMap](https://github.com/RaCzKoViC/CodeMap) analyzes the
workspace folder with the same logic as the browser app and the CLI — locally, offline, no code leaves your machine.

## Funkcje / Features

| | PL | EN |
|---|---|---|
| **Problems** | `CodeMap: Analizuj workspace` — znaleziska Inspect (cykle, god-files, huby, duplikaty, reguły architektury z `.codemap.rules.json`, pliki bez testów, hotspoty zmian, wiedza w jednej głowie…) jako diagnostyki z linią, kodem reguły i powiązanymi plikami. | `CodeMap: Analyze workspace` — Inspect findings (cycles, god files, hubs, duplicates, `.codemap.rules.json` architecture rules, untested files, change hotspots, knowledge silos…) as diagnostics with line, rule code and related files. |
| **Pasek stanu / Status bar** | Health score; tooltip: znaleziska wg ważności, bus factor, hotspoty. Klik otwiera mapę. | Health score; tooltip: findings by severity, bus factor, hotspots. Click opens the map. |
| **Mapa / Map** | `CodeMap: Otwórz mapę` — interaktywna mapa CodeMap w panelu (13 układów, filtry, kolorowanie wg git i pokrycia). | `CodeMap: Open map` — the interactive CodeMap map in a panel (13 layouts, filters, git and coverage overlays). |
| **Nawigacja / Navigation** | `CodeMap: Pokaż plik na mapie` (menu edytora i eksploratora); dwuklik pliku na mapie albo „Otwórz w edytorze" w menu kontekstowym. | `CodeMap: Show file on map` (editor and explorer menus); double-click a file on the map or "Open in editor" in its context menu. |
| **CodeLens** | Nad hotspotami: „16 zmian × złożoność 669 · właściciel …". | Above hotspots: "16 changes × complexity 669 · owner …". |

## Ustawienia / Settings

| | Domyślnie / Default | |
|---|---|---|
| `codemap.analyzeOnSave` | `false` | PL: analiza po zapisie (1,5 s, nowszy przebieg anuluje poprzedni) · EN: analyze on save (1.5 s debounce) |
| `codemap.minSeverity` | `low` | `info` \| `low` \| `med` \| `high` — próg Problems / Problems threshold |
| `codemap.git` | `true` | historia `.git` / `.git` history |
| `codemap.exclude` | `[]` | globy pomijane / globs to skip |
| `codemap.lang` | `auto` | `auto` \| `pl` \| `en` |
| `codemap.codeLens` | `true` | CodeLens nad hotspotami / above hotspots |

## Ograniczenia w panelu / Limitations in the panel

PL: panel ma restrykcyjną CSP — nie działają funkcje ładujące biblioteki z sieci (graf symboli tree-sitter,
WebLLM, Ollama i klucze API w ChatBocie, Runner PHP, styl odręczny MindMap), a Web Workery zastępują
ścieżki na wątku głównym. Pełna aplikacja: https://raczkovic.github.io/CodeMap/.

EN: the panel runs under a strict CSP — features that load libraries from the network (tree-sitter symbol
graph, WebLLM, Ollama and API keys in the ChatBot, PHP Runner, hand-drawn MindMap style) are unavailable,
and Web Workers fall back to the main thread. Full app: https://raczkovic.github.io/CodeMap/.

## Instalacja lokalna / Local install

Wymaga / requires VS Code ≥ 1.90 (Node.js 20 w hoście rozszerzeń / in the extension host).

```bash
cd integrations/vscode
npm run package                                   # → codemap-0.1.0.vsix (bundle + npx @vscode/vsce)
code --install-extension codemap-0.1.0.vsix
```

PL: bez `vsce` — `npm run bundle`, a potem skopiuj katalog `integrations/vscode` do
`~/.vscode/extensions/raczkovic.codemap-0.1.0` i uruchom VS Code ponownie.
EN: without `vsce` — run `npm run bundle`, copy `integrations/vscode` to
`~/.vscode/extensions/raczkovic.codemap-0.1.0` and restart VS Code.

## Rozwój / Development

```bash
npm run bundle     # kopiuje app/ i cli/ z korzenia repozytorium / copies app/ and cli/ from the repo root
npm test           # testy jednostkowe i integracyjne (node:test, atrapa modułu vscode)
npm run smoke      # panel mapy w headless Chrome / the map panel in headless Chrome
npm run package    # .vsix (npx @vscode/vsce)
```

Analiza działa w wątku roboczym (`worker_threads`) z kopią CLI (`analyzeProject`), więc nie blokuje hosta
rozszerzeń; anulowanie kończy wątek. / The analysis runs in a worker thread with the bundled CLI, so it never
blocks the extension host; cancelling terminates the thread.

Licencja / License: MIT.
