// Teksty CLI (PL domyślnie, EN przez --lang en). Nazwy i opisy reguł pochodzą z js/inspect.js
// (CM.Inspect.text) — tu tylko to, czego nie ma w aplikacji: pomoc, podsumowanie, progi, błędy.
const STR = {
  pl: {
    help: `CodeMap {v} — analiza struktury kodu z wiersza poleceń (ta sama analiza co w aplikacji)

Użycie:
  codemap analyze [ścieżka=.] [opcje]
  codemap --help | --version

Wyjścia (można kilka naraz; „-" = standardowe wyjście):
  --json <plik>          pełny raport JSON (wynik, znaleziska, git, testy, czasy)
  --md <plik>            raport Markdown (np. do $GITHUB_STEP_SUMMARY)
  --sarif <plik>         SARIF 2.1.0 (GitHub code scanning, edytory)
  --map <plik>           mapa .codemap.json do otwarcia w aplikacji
  --export <format>      graf: dot | mermaid | graphml (z --out <plik>; bez --out → stdout)
  Podsumowanie w terminalu jest zawsze (poza --quiet); gdy stdout zajmuje wyjście „-", idzie na stderr.

Analiza:
  --no-git               bez historii git (domyślnie czytana z .git, gdy istnieje)
  --git-max <N>          najwyżej N commitów historii (domyślnie 3000)
  --coverage <plik>      raport pokrycia (lcov / Istanbul / Cobertura / JaCoCo / Clover; można powtórzyć);
                         domyślnie autodetekcja (coverage/lcov.info, coverage-final.json, cobertura.xml…)
  --no-coverage          bez raportów pokrycia
  --exclude <glob>       pomiń pliki/katalogi pasujące do globu (względem ścieżki; można powtórzyć)
  --max-content <N>      limit plików z czytaną treścią (domyślnie {max}, jak w przeglądarce)

Progi (kod wyjścia 1, gdy niespełnione):
  --min-score <N>        health score poniżej N
  --fail-on <lista>      po przecinku: poziom ważności (high | med | low | info — ten lub wyższy)
                         albo identyfikatory reguł (np. cycles,archviolation)
  --max-findings <N>     więcej niż N znalezisk łącznie

Inne:
  --lang pl|en           język raportów i komunikatów (domyślnie pl)
  --quiet, -q            bez podsumowania w terminalu (błędy i niespełnione progi nadal na stderr)
  --no-color             bez kolorów ANSI

Kody wyjścia: 0 = OK, 1 = próg niespełniony, 2 = błąd użycia lub wykonania.
Reguły: {rules}`,
    title: 'CodeMap {v} — analiza: {name}',
    files: 'Pliki', filesVal: '{n} (z treścią: {c}{cap})', capNote: '; limit treści {max} — {k} bez treści',
    lines: 'Linie', size: 'Rozmiar', langs: 'Języki',
    score: 'Zdrowie projektu', findings: 'Znaleziska', none: 'brak',
    byRule: 'Znaleziska wg reguł', rule: 'Reguła', sev: 'Ważność', count: 'Liczba',
    hotspots: 'Hotspoty zmian (zmiany × złożoność)', file: 'Plik', changes: 'Zmiany', complexity: 'Złożoność',
    git: 'Historia git', gitVal: '{c} · {a} · bus factor {bf}{who}', gitTrunc: ' · ucięta do {n} najnowszych',
    gitNone: 'brak (bez .git albo --no-git)',
    tests: 'Testy', testsVal: '{t} · {tested}/{code} plików kodu z testami ({pct} %)', testsNone: 'brak plików testowych',
    cov: 'Pokrycie', covVal: '{pct} % linii ({lh}/{lf}) · dopasowane pliki: {m}/{n} · {src}',
    time: 'Czas', timeVal: '{total} (pliki {read}, graf {build}, git {git}, analiza {inspect})',
    written: 'zapisano {what}: {file}',
    fail: 'Próg niespełniony', failScore: 'health score {s} < --min-score {min}',
    failSev: '{n} o ważności ≥ {sev} (--fail-on {sev})',
    failRule: 'reguła „{rule}" ({title}): {n} (--fail-on)',
    failMax: '{n} > --max-findings {max}',
    warn: 'uwaga', err: 'błąd',
    eNoCmd: 'brak polecenia — użyj „codemap analyze [ścieżka]" (codemap --help)',
    eCmd: 'nieznane polecenie „{c}" (codemap --help)',
    eOpt: 'nieznana opcja „{o}" (codemap --help)',
    eVal: 'opcja {o} wymaga wartości',
    eNum: 'opcja {o}: oczekiwana liczba, jest „{v}"',
    eLang: 'opcja --lang: pl albo en, jest „{v}"',
    eFmt: 'opcja --export: dot | mermaid | graphml, jest „{v}"',
    eFail: 'opcja --fail-on: nieznana wartość „{v}" (poziomy: high, med, low, info; reguły: {rules})',
    eArgs: 'nadmiarowy argument „{a}"',
    eDir: 'katalog nie istnieje: {p}',
    eOutNoExport: 'opcja --out ma sens tylko z --export',
    eStdout: 'tylko jedno wyjście może iść na standardowe wyjście („-")',
    eCovFile: 'nie znaleziono raportu pokrycia: {p}',
    wCovBad: 'nie rozpoznano raportu pokrycia: {p}',
    wCovNone: 'raport pokrycia nie pasuje do plików projektu ({n} wpisów): {p}',
    wGit: 'historia git niedostępna: {m}',
    wSymlinks: 'pominięto {n} dowiązań symbolicznych',
    folderNote: 'znaleziska dotyczące folderów ({n}) są w JSON/Markdown, nie w SARIF',
  },
  en: {
    help: `CodeMap {v} — code structure analysis from the command line (the same analysis as the app)

Usage:
  codemap analyze [path=.] [options]
  codemap --help | --version

Outputs (several at once; "-" = standard output):
  --json <file>          full JSON report (score, findings, git, tests, timings)
  --md <file>            Markdown report (e.g. for $GITHUB_STEP_SUMMARY)
  --sarif <file>         SARIF 2.1.0 (GitHub code scanning, editors)
  --map <file>           .codemap.json map to open in the app
  --export <format>      graph: dot | mermaid | graphml (with --out <file>; without --out → stdout)
  The terminal summary is always printed (except with --quiet); when an output "-" takes stdout, it goes to stderr.

Analysis:
  --no-git               skip git history (read from .git by default when present)
  --git-max <N>          at most N commits of history (default 3000)
  --coverage <file>      coverage report (lcov / Istanbul / Cobertura / JaCoCo / Clover; repeatable);
                         auto-detected by default (coverage/lcov.info, coverage-final.json, cobertura.xml…)
  --no-coverage          no coverage reports
  --exclude <glob>       skip files/folders matching the glob (relative to the path; repeatable)
  --max-content <N>      cap on files whose content is read (default {max}, as in the browser)

Thresholds (exit code 1 when not met):
  --min-score <N>        health score below N
  --fail-on <list>       comma-separated: severity (high | med | low | info — that or higher)
                         or rule ids (e.g. cycles,archviolation)
  --max-findings <N>     more than N findings in total

Other:
  --lang pl|en           language of reports and messages (default pl)
  --quiet, -q            no terminal summary (errors and failed thresholds still go to stderr)
  --no-color             no ANSI colors

Exit codes: 0 = OK, 1 = threshold not met, 2 = usage or runtime error.
Rules: {rules}`,
    title: 'CodeMap {v} — analysis: {name}',
    files: 'Files', filesVal: '{n} (with content: {c}{cap})', capNote: '; content cap {max} — {k} without content',
    lines: 'Lines', size: 'Size', langs: 'Languages',
    score: 'Project health', findings: 'Findings', none: 'none',
    byRule: 'Findings by rule', rule: 'Rule', sev: 'Severity', count: 'Count',
    hotspots: 'Change hotspots (changes × complexity)', file: 'File', changes: 'Changes', complexity: 'Complexity',
    git: 'Git history', gitVal: '{c} · {a} · bus factor {bf}{who}', gitTrunc: ' · truncated to the {n} newest',
    gitNone: 'none (no .git or --no-git)',
    tests: 'Tests', testsVal: '{t} · {tested}/{code} code files with tests ({pct} %)', testsNone: 'no test files',
    cov: 'Coverage', covVal: '{pct} % of lines ({lh}/{lf}) · matched files: {m}/{n} · {src}',
    time: 'Time', timeVal: '{total} (files {read}, graph {build}, git {git}, analysis {inspect})',
    written: 'wrote {what}: {file}',
    fail: 'Threshold not met', failScore: 'health score {s} < --min-score {min}',
    failSev: '{n} with severity ≥ {sev} (--fail-on {sev})',
    failRule: 'rule "{rule}" ({title}): {n} (--fail-on)',
    failMax: '{n} > --max-findings {max}',
    warn: 'warning', err: 'error',
    eNoCmd: 'no command — use "codemap analyze [path]" (codemap --help)',
    eCmd: 'unknown command "{c}" (codemap --help)',
    eOpt: 'unknown option "{o}" (codemap --help)',
    eVal: 'option {o} requires a value',
    eNum: 'option {o}: expected a number, got "{v}"',
    eLang: 'option --lang: pl or en, got "{v}"',
    eFmt: 'option --export: dot | mermaid | graphml, got "{v}"',
    eFail: 'option --fail-on: unknown value "{v}" (severities: high, med, low, info; rules: {rules})',
    eArgs: 'unexpected argument "{a}"',
    eDir: 'directory does not exist: {p}',
    eOutNoExport: 'option --out only makes sense with --export',
    eStdout: 'only one output can go to standard output ("-")',
    eCovFile: 'coverage report not found: {p}',
    wCovBad: 'coverage report not recognized: {p}',
    wCovNone: 'coverage report does not match the project files ({n} entries): {p}',
    wGit: 'git history unavailable: {m}',
    wSymlinks: 'skipped {n} symbolic links',
    folderNote: 'folder findings ({n}) are in JSON/Markdown, not in SARIF',
  },
};

// odmiana przez liczbę: pl [1, 2–4 (poza 12–14), reszta], en [1, reszta]
const FORMS = {
  pl: { commits: ['commit', 'commity', 'commitów'], authors: ['autor', 'autorów', 'autorów'], tests: ['plik testowy', 'pliki testowe', 'plików testowych'],
    findings: ['znalezisko', 'znaleziska', 'znalezisk'] },
  en: { commits: ['commit', 'commits'], authors: ['author', 'authors'], tests: ['test file', 'test files'], findings: ['finding', 'findings'] },
};
/** „3 commity", „5 commitów", „1 author" — n już sformatowane przez fmt (text), liczba w n. */
export function countOf(lang, n, key, text = String(n)) {
  const f = (FORMS[lang] || FORMS.pl)[key];
  if (!f) return text;
  let i;
  if (lang === 'en') i = n === 1 ? 0 : 1;
  else i = n === 1 ? 0 : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 1 : 2;
  return text + ' ' + f[i];
}

/** Tłumacz dla języka: tr('klucz', {zmienna: wartość}). */
export function strings(lang) {
  const d = STR[lang] || STR.pl;
  return (k, sub) => {
    let s = k in d ? d[k] : (STR.pl[k] ?? k);
    if (sub) for (const p in sub) s = s.split('{' + p + '}').join(String(sub[p]));
    return s;
  };
}

/** Błąd użycia / wykonania → kod wyjścia 2 (komunikat już przetłumaczony). */
export class CliError extends Error {
  constructor(message) { super(message); this.name = 'CliError'; }
}
