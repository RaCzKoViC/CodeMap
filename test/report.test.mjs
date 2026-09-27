import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeMap } from '../cli/runtime.mjs';
import { buildReport, toMarkdown, toSummary, SEVS, SEV_RANK } from '../cli/report.mjs';

// Raport CLI (cli/report.mjs) na prawdziwym grafie z syntetycznym wynikiem Inspect, historią git i testami:
// sumy ważności (także ponad limit listy), języki, autorzy bez botów, hotspoty tylko kodu, Markdown i terminal.
function setup(lang = 'pl') {
  const CM = loadCodeMap({ lang });
  const files = [
    { path: 'src/a.js', size: 100, content: 'export function a(x){ if (x) { return 1; } return 2; }\n'.repeat(3) },
    { path: 'src/b.js', size: 50, content: "import { a } from './a.js';\nexport const b = a;\n" },
    { path: 'src/we|ird.js', size: 10, content: 'export const w = 1;\n' },
    { path: 'lib/c.py', size: 30, content: 'import os\n' },
    { path: 'README.md', size: 5, content: '# x\n' },
  ];
  const graph = new CM.Graph.Graph(); graph.build(files, { name: 'demo' });
  const set = (id, git) => { graph.nodes.get(id).git = git; };
  set('src/a.js', { c: 9, recent: 2 }); set('src/b.js', { c: 1 }); set('src/we|ird.js', { c: 4 }); set('README.md', { c: 50 });
  graph.gitInfo = { commits: 22, merges: 3, tracked: 5, untracked: 0, truncated: true, head: { ref: 'main', sha: 'abc' },
    range: { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 8, 1) },
    authors: [{ name: 'Ala', commits: 10, files: 3, owned: 2 }, { name: 'dependabot[bot]', commits: 40, bot: true }, { name: 'Bob', commits: 12, files: 1, owned: 1 }],
    busFactor: { value: 1, authors: [2] } };
  graph.testInfo = { tests: 3, helpers: 1, code: 4, tested: 2, untested: 2, pct: 50, byName: 2, byImport: 1,
    coverage: { files: 2, pct: 61.25, lh: 49, lf: 80, bh: 1, bf: 2, fh: 3, ff: 4, matched: 2, total: 3, source: 'coverage/lcov.info', format: 'lcov' } };
  const rep = { score: 64, files: 5, findings: [
    { rule: 'cycles', sev: 'high', count: 3, items: [{ id: 'src/a.js', path: 'src/a.js', name: 'a.js', related: ['src/b.js'], detail: 'x' }, { id: 'src/b.js', path: 'src/b.js', name: 'b.js', sev: 'med' }] },
    { rule: 'deep', sev: 'low', count: 1, items: [{ id: 'lib', path: 'lib', name: 'lib' }] },
  ] };
  const loaded = { stats: { content: 5, maxContent: 4000, capped: 2, excluded: 1 } };
  const timing = { readMs: 12, buildMs: 1500, gitMs: 0, inspectMs: 3, totalMs: 1515 };
  const report = buildReport({ CM, graph, rep, loaded, timing, lang, name: 'demo', sub: 'packages/app', warnings: ['uwaga'] });
  return { CM, graph, rep, report };
}

describe('buildReport', () => {
  const { report, CM } = setup();
  test('sumy: pozycje wg własnej ważności, nadwyżka ponad listę wg ważności reguły', () => {
    assert.deepEqual(report.totals, { findings: 4, high: 2, med: 1, low: 1, info: 0 });
    const f = report.findings[0];
    assert.equal(f.title, CM.Inspect.text('r.cycles')); assert.equal(f.items[0].kind, 'file');
    assert.deepEqual(f.items[0].related, ['src/b.js']);
    assert.equal(report.findings[1].items[0].kind, 'folder');
  });
  test('statystyki: pliki, foldery (bez korzenia), bajty, języki wg liczby plików; projekt z podkatalogiem', () => {
    assert.equal(report.stats.files, 5); assert.equal(report.stats.folders, 2); assert.equal(report.stats.bytes, 195);
    assert.deepEqual([report.stats.contentCap, report.stats.withoutContent, report.stats.excluded], [4000, 2, 1]);
    assert.deepEqual(report.stats.languages.map((l) => [l.key, l.files]), [['js', 3], ['md', 1], ['py', 1]]);
    assert.equal(report.project.path, 'packages/app');
    assert.equal(report.tool.version, CM.VERSION);
    assert.deepEqual(report.warnings, ['uwaga']);
  });
  test('git: autorzy bez botów, bus factor z nazwiskami, zakres ISO; hotspoty tylko plików kodu wg wyniku', () => {
    const g = report.git;
    assert.deepEqual([g.commits, g.merges, g.authors, g.bots], [22, 3, 2, 1]);
    assert.deepEqual(g.topAuthors.map((a) => a.name), ['Bob', 'Ala']);
    assert.deepEqual(g.busFactor, { value: 1, authors: ['Bob'] });
    assert.deepEqual(g.range, { from: '2026-01-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' });
    assert.equal(g.truncated, true);
    assert.deepEqual(report.hotspots.map((h) => h.path), ['src/a.js', 'src/we|ird.js', 'src/b.js'], 'README ma zmiany, ale nie jest kodem');
    assert.ok(report.hotspots[0].score > report.hotspots[1].score);
  });
  test('testy i pokrycie; bez testów i pokrycia → null; bez historii git → git null i brak hotspotów', () => {
    assert.equal(report.tests.coverage.pct, 61.25); assert.equal(report.tests.tests, 3);
    const { CM, graph, rep } = setup();
    graph.testInfo = { tests: 0, helpers: 0, coverage: { files: 0 } }; graph.gitInfo = null;
    const r = buildReport({ CM, graph, rep, loaded: { stats: {} }, timing: {}, lang: 'pl', name: 'x', sub: '', warnings: [] });
    assert.equal(r.tests, null); assert.equal(r.git, null); assert.deepEqual(r.hotspots, []);
    assert.equal(r.project.path, '.');
  });
  test('stałe ważności: kolejność i ranga', () => {
    assert.deepEqual(SEVS, ['high', 'med', 'low', 'info']);
    assert.ok(SEV_RANK.high > SEV_RANK.med && SEV_RANK.med > SEV_RANK.low && SEV_RANK.low > SEV_RANK.info);
  });
});

describe('toMarkdown / toSummary', () => {
  test('Markdown: nagłówek z Inspect, podsumowanie CLI (przecinek dziesiętny w PL), tabela reguł i hotspotów z escapowaniem |', () => {
    const { CM, rep, report } = setup();
    const md = toMarkdown(CM, rep, report);
    assert.match(md, /^# CodeMap — .*: demo\n/);
    assert.match(md, /- \*\*Pliki:\*\* 5 \(z treścią: 5; limit treści 4.?000 — 2 bez treści\)/);
    assert.match(md, /- \*\*Historia git:\*\* 22 commity · 2 autorów · bus factor 1 \(Bob\) · ucięta do 25 najnowszych/);
    assert.match(md, /- \*\*Pokrycie:\*\* 61,3 % linii \(49\/80\)/);
    assert.match(md, /- \*\*Czas:\*\* 1,5 s \(pliki 12 ms, graf 1,5 s, git 0 ms, analiza 3 ms\)/);
    assert.match(md, /\| `src\/we\\\|ird\.js` \| 4 \|/);
    assert.ok(md.includes('(`cycles`) | ' + CM.Inspect.text('sev.high') + ' | 3 |'));
    assert.match(md, /- …i 1 więcej\n/, 'pozycje ponad listę');
    assert.ok(md.endsWith('\n'));
  });
  test('terminal: bez kolorów czysty tekst, z kolorami kody ANSI; tytuł z podkatalogiem; wersja angielska', () => {
    const { CM, report } = setup();
    const plain = toSummary(CM, report);
    assert.ok(!plain.includes('\x1b['));
    assert.match(plain.split('\n')[0], /^CodeMap .* — analiza: demo \(packages\/app\)$/);
    assert.match(plain, /✖ .*cycles\)\s+3$/m);
    assert.match(plain, /src\/a\.js\s+9 × CC \d+/);
    const col = toSummary(CM, report, { color: true });
    assert.match(col, /\x1b\[33m\x1b\[1m64\/100\x1b\[0m\x1b\[0m/, 'wynik 55–79 na żółto');
    const en = setup('en');
    const s = toSummary(en.CM, en.report);
    assert.match(s, /Git history\s+22 commits · 2 authors · bus factor 1 \(Bob\) · truncated to the 25 newest/);
    assert.match(s, /Coverage\s+61\.3 % of lines/);
  });
});
