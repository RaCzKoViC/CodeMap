# Historia zmian — rozszerzenie VS Code „CodeMap"

## [0.1.0] — 2026-09-27

Pierwsze wydanie / First release.

- **Analiza workspace → Problems** (`CodeMap: Analizuj workspace`): ta sama analiza co aplikacja i CLI
  (graf zależności, reguły Inspect, reguły architektury z `.codemap.rules.json`, duplikaty, pokrycie,
  historia git) w osobnym wątku, z postępem i anulowaniem. Znaleziska plików jako diagnostyki z linią
  z SARIF, kodem reguły (link do opisu) i powiązanymi plikami dla cykli, duplikatów i naruszeń architektury.
- **Pasek stanu**: health score, w tooltipie znaleziska wg ważności, bus factor i hotspoty; klik otwiera mapę.
- **Mapa w panelu webview**: pełna aplikacja CodeMap z mapą wczytaną z analizy; CSP z nonce, zasoby tylko
  z katalogu aplikacji rozszerzenia.
- **Nawigacja w obie strony**: `CodeMap: Pokaż plik na mapie` (paleta, menu edytora i eksploratora, CodeLens)
  oraz dwuklik pliku / symbolu albo „Otwórz w edytorze" w menu kontekstowym mapy.
- **CodeLens** nad hotspotami git (zmiany × złożoność, właściciel).
- Ustawienia: `codemap.analyzeOnSave`, `codemap.minSeverity`, `codemap.git`, `codemap.exclude`, `codemap.lang`,
  `codemap.codeLens`.
