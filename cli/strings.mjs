// Teksty CLI (PL domyślnie, EN przez --lang en). Nazwy i opisy reguł pochodzą z js/inspect.js
// (CM.Inspect.text) — tu tylko to, czego nie ma w aplikacji: pomoc, podsumowanie, progi, błędy.
const STR = {
  pl: {
    help: `CodeMap {v} — analiza struktury kodu z wiersza poleceń (ta sama analiza co w aplikacji)

Użycie:
  codemap analyze [ścieżka=.] [opcje]
  codemap check [ścieżka=.] [--fail-on <lista>|none] [--json <plik>] [--no-git] [--exclude glob]…
                         zmiany w indeksie (git add) vs HEAD przed commitem: ryzyko, zasięg, nowe znaleziska;
                         kod 1 przy nowych znaleziskach z --fail-on (domyślnie archviolation,cycles,pkgcycle)
  codemap check --install-hook | --uninstall-hook
                         hook pre-commit wołający codemap check (cudzego hooka nie nadpisuje)
  codemap rules [ścieżka=.] [--packages | --folders --depth N] [--out .codemap.rules.json]
                         propozycja reguł architektury z warstw macierzy zależności (dziś przechodzą,
                         blokują nowe zależności pod prąd; istniejące — lista wyjątków na stderr)
  codemap mcp [ścieżka=.] [--osv] [--no-git] [--exclude glob]… [--lang pl|en]
                         serwer MCP (stdio) dla agentów AI: te same analizy jako narzędzia tylko do odczytu
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
  --no-gitignore         analizuj też pliki ignorowane przez .gitignore (domyślnie pomijane)
  --max-content <N>      limit plików z czytaną treścią (domyślnie {max}, jak w przeglądarce)
  --osv                  podatne zależności z api.osv.dev (wysyłane są tylko nazwy i wersje pakietów)
  --architecture <plik>  ARCHITECTURE.md z mapy: warstwy, pakiety, punkty wejścia, rdzeń, hotspoty, własność, testy, cykle
  --history <N>          trend zdrowia: N commitów rozłożonych równo na historii (pierwszy rodzic HEAD),
                         drzewa czytane wprost z .git; tabela w podsumowaniu, pole „history" w --json, sekcja w --md

Progi (kod wyjścia 1, gdy niespełnione):
  --min-score <N>        health score poniżej N
  --fail-on <lista>      po przecinku: poziom ważności (high | med | low | info — ten lub wyższy)
                         albo identyfikatory reguł (np. cycles,archviolation)
  --max-findings <N>     więcej niż N znalezisk łącznie
  --max-score-drop <N>   (z --baseline) health score spadł o więcej niż N względem --base

Przegląd zmian (PR):
  --base <ref>           zmienione pliki z „git diff <ref>...HEAD": ryzyko każdej zmiany, pliki zależne,
                         sugerowani recenzenci (w raporcie JSON: „pr")
  --baseline             policz też health score dla <ref> (tymczasowy git worktree) i nowe znaleziska
  --pr-md <plik>         komentarz Markdown do PR (ryzyko, pliki, zdrowie przed/po, nowe znaleziska)
  --pr-number <N>, --pr-title <tekst>, --pr-author <login>, --pr-link <url>   dane PR do komentarza

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
    failDrop: 'health score spadł o {d} (z {b} do {s}) > --max-score-drop {max}', eBaselineNoBase: '--baseline i --pr-md wymagają --base <ref>',
    rulesSum: 'Propozycja reguł ({m}): warstwy {l}, zakazy {f}, wyjątki do naprawy (zależności pod prąd) {e}',
    prLine: 'Zmiany vs {base}', prVal: 'ryzyko {risk}/100 ({lvl}) · plików {n} (+{a} / −{d}) · zależnych {dep}',
    blLine: 'Zdrowie vs {base}', blVal: '{b} → {s} ({sign}{d}) · nowe znaleziska: {nf}, usunięte: {rf}',
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
  codemap check [path=.] [--fail-on <list>|none] [--json <file>] [--no-git] [--exclude glob]…
                         staged changes (git add) vs HEAD before a commit: risk, reach, new findings;
                         exit 1 on new findings from --fail-on (default archviolation,cycles,pkgcycle)
  codemap check --install-hook | --uninstall-hook
                         a pre-commit hook running codemap check (an existing foreign hook is left alone)
  codemap rules [path=.] [--packages | --folders --depth N] [--out .codemap.rules.json]
                         architecture rules proposed from the dependency-matrix layers (pass today,
                         block new upstream dependencies; existing ones listed as exceptions on stderr)
  codemap mcp [path=.] [--osv] [--no-git] [--exclude glob]… [--lang pl|en]
                         MCP server (stdio) for AI agents: the same analysis as read-only tools
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
  --no-gitignore         also analyze files ignored by .gitignore (skipped by default)
  --max-content <N>      cap on files whose content is read (default {max}, as in the browser)
  --osv                  vulnerable dependencies from api.osv.dev (only package names and versions are sent)
  --architecture <file>  ARCHITECTURE.md from the map: layers, packages, entry points, core, hotspots, ownership, tests, cycles
  --history <N>          health trend: N commits spread evenly over history (HEAD first parent), trees read
                         straight from .git; table in the summary, "history" field in --json, section in --md

Thresholds (exit code 1 when not met):
  --min-score <N>        health score below N
  --fail-on <list>       comma-separated: severity (high | med | low | info — that or higher)
                         or rule ids (e.g. cycles,archviolation)
  --max-findings <N>     more than N findings in total
  --max-score-drop <N>   (with --baseline) health score dropped by more than N vs --base

Change review (PR):
  --base <ref>           changed files from "git diff <ref>...HEAD": risk of each change, dependent files,
                         suggested reviewers (JSON report: "pr")
  --baseline             also compute the health score of <ref> (temporary git worktree) and new findings
  --pr-md <file>         Markdown PR comment (risk, files, health before/after, new findings)
  --pr-number <N>, --pr-title <text>, --pr-author <login>, --pr-link <url>   PR data for the comment

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
    failDrop: 'health score dropped by {d} (from {b} to {s}) > --max-score-drop {max}', eBaselineNoBase: '--baseline and --pr-md need --base <ref>',
    rulesSum: 'Proposed rules ({m}): layers {l}, forbidden {f}, exceptions to fix (upstream dependencies) {e}',
    prLine: 'Changes vs {base}', prVal: 'risk {risk}/100 ({lvl}) · {n} files (+{a} / −{d}) · {dep} dependents',
    blLine: 'Health vs {base}', blVal: '{b} → {s} ({sign}{d}) · new findings: {nf}, resolved: {rf}',
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

/** Ryzyko zmian jednym wierszem (analyze --base, check): „ryzyko 48/100 (średnie) · plików 1 (+3 / −0) · zależnych 0". */
export function riskLine(lang, p) {
  const en = lang === 'en', lvl = { high: en ? 'high' : 'wysokie', med: en ? 'medium' : 'średnie', low: en ? 'low' : 'niskie' }[p.level] || p.level;
  return strings(lang)('prVal', { risk: p.risk, lvl, n: p.changed.length + p.outside.length, a: p.add, d: p.del, dep: p.impacted });
}

/** Błąd użycia / wykonania → kod wyjścia 2 (komunikat już przetłumaczony). */
export class CliError extends Error {
  constructor(message) { super(message); this.name = 'CliError'; }
}
