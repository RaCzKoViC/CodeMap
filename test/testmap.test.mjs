import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';

const CM = loadCM([...CORE, 'testmap']);
const { Graph } = CM.Graph;
const TM = CM.TestMap;
const F = (path, content = '// kod\n') => ({ path, size: content.length, content, mtime: 0 });
const build = (files) => new Graph().build(files, { name: 'proj' });
const node = (g, id) => g.nodes.get(id);
const testEdges = (g) => g.edges.filter((e) => e.type === 'test').map((e) => `${e.source} -> ${e.target} (${e.via})`).sort();

describe('konwencje nazw testów', () => {
  const TESTS = [
    'src/utils/format.test.js', 'src/a.spec.ts', 'web/Button.test.tsx', 'e2e/login.cy.js', 'src/__tests__/Button.js',
    'test/graph.test.mjs', 'test/graph.js', 'tests/test_parser.py', 'pkg/parser_test.py', 'pkg/tests.py',
    'server/handler_test.go', 'src/test/java/a/FooTest.java', 'src/main/java/a/FooTests.java', 'app/src/test/kotlin/BarTest.kt',
    'it/FooIT.java', 'core/TestLegacy.java', 'core/BookSpec.scala', 'MyApp.Tests/Services/UserServiceTests.cs', 'lib/UserTest.cs',
    'spec/models/user_spec.rb', 'test/models/user_test.rb', 'tests/Unit/UserTest.php', 'tests/integration.rs',
    'test/widget_test.dart', 'MyAppTests/LoginTests.swift', 'test/app_test.exs', 'tests/test_list.c', 'src/list_test.cpp', 'base/list_unittest.cc',
  ];
  const HELPERS = [
    'tests/conftest.py', 'conftest.py', 'spec/spec_helper.rb', 'src/setupTests.ts', 'jest.config.js', 'vitest.setup.ts',
    'test/harness.mjs', 'test/fixtures/sample-project.mjs', 'tests/fixtures/data.json', 'src/__mocks__/axios.js', 'src/__snapshots__/a.test.js.snap',
    'tests/__init__.py', 'tests/common/mod.rs', 'test/helpers.js', 'src/test/resources/app.yml', 'go/pkg/testdata/in.txt', 'src/test-utils.tsx',
  ];
  const NOT = [
    'src/app.js', 'src/latest.js', 'src/Latest.java', 'src/Contest.cs', 'setup.py', 'src/testing.go', 'src/contest.py', 'docs/test-plan.md',
    'tests/README.md', 'src/main/java/a/Foo.java', 'Test.java', 'src/manifest.php', 'lib/TypeSpec.kt', 'src/attestation.ts',
  ];
  test('pliki testowe w wielu językach', () => {
    for (const p of TESTS) assert.equal(TM.testRole(p), 'test', p);
  });
  test('pliki pomocnicze: testowe, ale bez podmiotu', () => {
    for (const p of HELPERS) { assert.equal(TM.testRole(p), 'helper', p); assert.ok(TM.isTestFile(p) && TM.isTestHelper(p), p); }
  });
  test('zwykły kod i dokumentacja nie są testami', () => {
    for (const p of NOT) assert.equal(TM.testRole(p), null, p);
    assert.ok(!TM.isTestFile('src/app.js'));
  });
  test('rdzeń nazwy testu', () => {
    const cases = { 'src/format.test.js': 'format', 'a/b.spec.ts': 'b', 'tests/test_parser.py': 'parser', 'x_test.go': 'x',
      'FooTest.java': 'Foo', 'FooTests.cs': 'Foo', 'FooIT.java': 'Foo', 'TestFoo.java': 'Foo', 'FooTestCase.php': 'Foo', 'BookSpec.scala': 'Book',
      'user_spec.rb': 'user', 'list_unittest.cc': 'list', 'tests/integration.rs': 'integration', 'tests.py': '', 'my-parser.test.ts': 'my-parser' };
    for (const [p, s] of Object.entries(cases)) assert.equal(TM.testStem(p), s, p);
  });
  test('isCodeFile pomija deklaracje typów, konfigurację i __init__.py', () => {
    assert.ok(TM.isCodeFile('src/a.ts') && TM.isCodeFile('lib/x.h') && TM.isCodeFile('a/B.java'));
    for (const p of ['src/types.d.ts', 'vite.config.ts', 'pkg/__init__.py', 'vendor/jq.min.js', 'README.md', 'a.json', '.eslintrc.js']) assert.ok(!TM.isCodeFile(p), p);
  });
});

describe('mapTests — test → podmiot', () => {
  const FILES = [
    F('js/graph.js'), F('tools/graph-tool.js'), F('test/graph.test.mjs', "import './harness.mjs';\n"), F('test/harness.mjs', "import '../js/util.js';\n"),
    F('js/util.js'),
    F('src/utils/format.js'), F('src/utils/format.test.js', "import { format } from './format.js';\nimport { log } from '../log.js';\nimport { h } from '../../test/harness.mjs';\nimport { x } from './other.test.js';\n"),
    F('src/utils/other.test.js'), F('src/log.js'), F('src/types.d.ts'),
    F('src/main/java/a/Foo.java'), F('src/main/java/b/Foo.java'), F('src/test/java/a/FooTest.java'),
    F('pkg/parser.py'), F('other/parser.py'), F('tests/test_parser.py'), F('tests/conftest.py'),
    F('src/components/button/index.js'), F('src/components/button.test.js'),
    F('lib/list.c'), F('lib/list.h'), F('tests/test_list.c'),
    F('scripts/build.py'),
  ];
  const g = build(FILES);
  // Python: import z pakietu rozwiązywany przez analizę — tu dodany ręcznie jak z grafu
  g.edges.push({ id: 'x1', source: 'tests/test_parser.py', target: 'pkg/parser.py', type: 'import' });
  const info = TM.mapTests(g);

  test('lustrzane ścieżki, ten sam katalog, najbliższy przodek i importy', () => {
    assert.deepEqual(host(testEdges(g)), [
      'src/components/button.test.js -> src/components/button/index.js (name)',
      'src/test/java/a/FooTest.java -> src/main/java/a/Foo.java (name)',
      'src/utils/format.test.js -> src/log.js (import)',
      'src/utils/format.test.js -> src/utils/format.js (name)',
      'test/graph.test.mjs -> js/graph.js (name)',
      'tests/test_list.c -> lib/list.c (name)',
      'tests/test_parser.py -> pkg/parser.py (import)',
    ]);
  });
  test('pola na węzłach: isTest, tests, testedBy, testHelper', () => {
    assert.equal(node(g, 'src/utils/format.test.js').isTest, true);
    assert.deepEqual(host(node(g, 'src/utils/format.test.js').tests), ['src/utils/format.js', 'src/log.js']);
    assert.deepEqual(host(node(g, 'src/utils/format.js').testedBy), ['src/utils/format.test.js']);
    assert.deepEqual(host(node(g, 'src/main/java/a/Foo.java').testedBy), ['src/test/java/a/FooTest.java']);
    assert.equal(node(g, 'src/main/java/b/Foo.java').testedBy, undefined);
    assert.equal(node(g, 'test/harness.mjs').testHelper, true);
    assert.deepEqual(host(node(g, 'test/harness.mjs').tests), [], 'plik pomocniczy nie ma podmiotu mimo importu util.js');
    assert.equal(node(g, 'js/util.js').testedBy, undefined, 'import z pliku pomocniczego nie czyni kodu przetestowanym');
    assert.equal(node(g, 'tests/conftest.py').isTest, true);
    assert.equal(node(g, 'scripts/build.py').isTest, undefined);
    assert.equal(node(g, 'src/utils/other.test.js').testedBy, undefined, 'test importowany przez test nie jest podmiotem');
  });
  test('niejednoznaczna nazwa bez importu → brak podmiotu po nazwie', () => {
    // tests/test_parser.py: pkg/parser.py i other/parser.py remisują; rozstrzyga import
    assert.deepEqual(host(node(g, 'tests/test_parser.py').tests), ['pkg/parser.py']);
    assert.equal(node(g, 'other/parser.py').testedBy, undefined);
  });
  test('graph.testInfo', () => {
    assert.equal(info.tests, 7);
    assert.equal(info.helpers, 2);
    assert.equal(info.tested, 7);
    assert.equal(info.byName, 5);
    assert.equal(info.byImport, 2);
    assert.equal(info.edges, 7);
    assert.equal(info.code, 13);
    assert.equal(info.untested, 6);
    assert.equal(info.pct, 54);
  });
  test('idempotencja: drugie wywołanie daje ten sam wynik', () => {
    const before = { edges: testEdges(g), info: host(g.testInfo), f: host(node(g, 'src/utils/format.js').testedBy) };
    TM.mapTests(g); TM.mapTests(g);
    assert.deepEqual(host(testEdges(g)), host(before.edges));
    assert.deepEqual(host(g.testInfo), before.info);
    assert.deepEqual(host(node(g, 'src/utils/format.js').testedBy), before.f);
  });
  test('toJSON/fromJSON: krawędzie test i isTest zapisane, tests/testedBy odtwarzane przez mapTests', () => {
    const obj = JSON.parse(JSON.stringify(g.toJSON()));
    assert.ok(obj.edges.some((e) => e.type === 'test'));
    assert.equal(obj.nodes.find((n) => n.id === 'src/utils/format.test.js').isTest, true);
    const g2 = Graph.fromJSON(obj);
    TM.mapTests(g2);
    assert.deepEqual(host(testEdges(g2)), host(testEdges(g)));
    assert.deepEqual(host(node(g2, 'src/utils/format.js').testedBy), ['src/utils/format.test.js']);
  });
  test('folderStats liczy testy i kod bez testów w poddrzewie', () => {
    const s = TM.folderStats(g, node(g, 'src/utils'));
    assert.deepEqual(host({ ...s, untestedIds: undefined }), { tests: 2, helpers: 0, tested: 1, untested: 0, code: 1, untestedIds: undefined });
    const r = TM.folderStats(g, node(g, '__root__'));
    assert.equal(r.tests, 7); assert.equal(r.code, 13); assert.equal(r.untested, 6);
  });
  test('importy z JS rozwiązywane przez Graph.build trafiają do podmiotów', () => {
    const g3 = build([F('src/a.js'), F('src/b.js'), F('spec/a_spec.js', "import '../src/a.js';\nimport '../src/b.js';\n")]);
    TM.mapTests(g3);
    assert.deepEqual(host(testEdges(g3)), ['spec/a_spec.js -> src/a.js (name)', 'spec/a_spec.js -> src/b.js (import)']);
  });
});

// ---------- parsery pokrycia ----------
const LCOV = `TN:
SF:/home/ci/proj/src/a.js
FN:1,alpha
FN:5,10,beta
FNDA:3,alpha
FNDA:0,beta
FNF:2
FNH:1
DA:1,3
DA:2,3
DA:5,0
DA:6,0
DA:8,0
DA:9,1
DA:12,0
LF:7
LH:3
BRDA:2,0,0,3
BRDA:2,0,1,-
BRDA:9,1,0,1
BRDA:9,1,1,0
BRF:4
BRH:2
end_of_record
TN:
SF:/home/ci/proj/src/a.js
DA:12,1
end_of_record
SF:src\\b.js
LF:10
LH:4
BRF:0
BRH:0
end_of_record
`;

describe('parseLcov', () => {
  const m = TM.parseLcov(LCOV);
  test('rekordy, gałęzie z „-", funkcje i scalanie powtórzonego SF', () => {
    assert.equal(m.size, 2);
    const a = host(m.get('/home/ci/proj/src/a.js'));
    assert.deepEqual({ lf: a.lf, lh: a.lh, bf: a.bf, bh: a.bh, ff: a.ff, fh: a.fh }, { lf: 7, lh: 4, bf: 4, bh: 2, ff: 2, fh: 1 });
    assert.equal(a.lines.get(12), 1, 'drugi rekord tego samego pliku sumuje trafienia');
    assert.equal(a.lines.get(5), 0);
  });
  test('rekord tylko z podsumowaniem (LF/LH bez DA)', () => {
    const b = host(m.get('src\\b.js'));
    assert.deepEqual({ lf: b.lf, lh: b.lh, bf: b.bf, lines: b.lines.size }, { lf: 10, lh: 4, bf: 0, lines: 0 });
  });
  test('uncoveredRanges scala niepokryte linie przez linie bez instrukcji', () => {
    const a = m.get('/home/ci/proj/src/a.js');
    assert.deepEqual(host(TM.uncoveredRanges(a.lines)), [[5, 8]]);
    assert.equal(TM.fmtRanges([[5, 8], [12, 12], [20, 30]]), '5–8, 12, 20–30');
    assert.equal(TM.fmtRanges([[1, 1], [3, 3], [5, 5]], 2), '1, 3, …');
  });
});

const ISTANBUL = {
  '/repo/src/a.js': {
    path: '/repo/src/a.js',
    statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } }, 1: { start: { line: 2, column: 2 }, end: { line: 2, column: 9 } },
      2: { start: { line: 2, column: 10 }, end: { line: 2, column: 30 } }, 3: { start: { line: 4, column: 2 }, end: { line: 4, column: 10 } } },
    s: { 0: 1, 1: 0, 2: 5, 3: 0 },
    fnMap: { 0: { name: 'f', decl: { start: { line: 1 } }, loc: { start: { line: 1 } } }, 1: { name: '(anonymous_1)', decl: {}, loc: {} } },
    f: { 0: 1, 1: 0 },
    branchMap: { 0: { type: 'if', locations: [{}, {}] }, 1: { type: 'cond-expr', locations: [{}, {}, {}] } },
    b: { 0: [1, 0], 1: [0, 0, 2] },
  },
};
const SUMMARY = {
  total: { lines: { total: 30, covered: 20, pct: 66.67 }, branches: { total: 4, covered: 1 }, functions: { total: 3, covered: 3 } },
  '/repo/src/a.js': { lines: { total: 10, covered: 8, skipped: 0, pct: 80 }, statements: { total: 12, covered: 9 }, functions: { total: 2, covered: 1 }, branches: { total: 4, covered: 1 } },
  '/repo/src/b.js': { lines: { total: 20, covered: 12, pct: 60 }, functions: { total: 1, covered: 1 }, branches: { total: 0, covered: 0 } },
};

describe('parseIstanbul', () => {
  test('coverage-final.json: linia = max z instrukcji, funkcje i gałęzie', () => {
    const e = host(TM.parseIstanbul(JSON.stringify(ISTANBUL)).get('/repo/src/a.js'));
    assert.deepEqual([...e.lines.entries()], [[1, 1], [2, 5], [4, 0]]);
    assert.deepEqual({ lf: e.lf, lh: e.lh, ff: e.ff, fh: e.fh, bf: e.bf, bh: e.bh }, { lf: 3, lh: 2, ff: 2, fh: 1, bf: 5, bh: 2 });
  });
  test('coverage-summary.json: tylko liczniki, bez „total"', () => {
    const m = TM.parseIstanbul(SUMMARY);
    assert.deepEqual(host([...m.keys()]), ['/repo/src/a.js', '/repo/src/b.js']);
    const a = host(m.get('/repo/src/a.js'));
    assert.deepEqual({ lf: a.lf, lh: a.lh, ff: a.ff, fh: a.fh, bf: a.bf, bh: a.bh, n: a.lines.size }, { lf: 10, lh: 8, ff: 2, fh: 1, bf: 4, bh: 1, n: 0 });
  });
  test('zły JSON → wyjątek', () => {
    assert.throws(() => TM.parseIstanbul('[1,2]'), /object/);
    assert.throws(() => TM.parseIstanbul('{ nope'));
  });
});

const COBERTURA = `<?xml version="1.0" ?>
<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">
<coverage version="7.4.0" timestamp="1700000000" lines-valid="9" lines-covered="6" line-rate="0.6667" branches-covered="1" branches-valid="2" branch-rate="0.5" complexity="0">
  <sources><source>/home/ci/proj</source></sources>
  <packages>
    <package name="pkg" line-rate="0.6667" branch-rate="0.5" complexity="0">
      <classes>
        <class name="parser.py" filename="pkg/parser.py" complexity="0" line-rate="0.6" branch-rate="0.5">
          <methods>
            <method name="parse" signature="(s)" line-rate="1"><lines><line number="3" hits="4"/></lines></method>
            <method name="unused" signature="()" line-rate="0"><lines><line number="8" hits="0"/></lines></method>
          </methods>
          <lines>
            <line number="1" hits="1"/>
            <line number="3" hits="4" branch="true" condition-coverage="50% (1/2)" missing-branches="5"/>
            <line number="4" hits="1"/>
            <line number="8" hits="0"/>
            <line number="9" hits="0"/>
          </lines>
        </class>
        <class name="util.py" filename="pkg/util.py" line-rate="1"><methods/><lines><line number="1" hits="2"/></lines></class>
        <class name="Inner" filename="pkg/util.py" line-rate="1"><lines><line number="5" hits="1"/></lines></class>
      </classes>
    </package>
  </packages>
</coverage>`;

describe('parseCobertura', () => {
  const m = TM.parseCobertura(COBERTURA);
  test('linie klasy (bez dublowania z <methods>), gałęzie z condition-coverage, metody', () => {
    const p = host(m.get('pkg/parser.py'));
    assert.deepEqual([...p.lines.entries()], [[1, 1], [3, 4], [4, 1], [8, 0], [9, 0]]);
    assert.deepEqual({ lf: p.lf, lh: p.lh, bf: p.bf, bh: p.bh, ff: p.ff, fh: p.fh }, { lf: 5, lh: 3, bf: 2, bh: 1, ff: 2, fh: 1 });
  });
  test('kilka klas w jednym pliku scalone', () => {
    const u = host(m.get('pkg/util.py'));
    assert.deepEqual({ lf: u.lf, lh: u.lh }, { lf: 2, lh: 2 });
  });
});

const JACOCO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd"><report name="app">
<sessioninfo id="x" start="1" dump="2"/>
<package name="com/example">
 <class name="com/example/Foo" sourcefilename="Foo.java"><method name="bar" desc="()V" line="3"><counter type="METHOD" missed="0" covered="1"/></method><counter type="METHOD" missed="1" covered="1"/></class>
 <sourcefile name="Foo.java">
  <line nr="3" mi="0" ci="4" mb="0" cb="0"/>
  <line nr="4" mi="2" ci="0" mb="1" cb="1"/>
  <line nr="7" mi="3" ci="0" mb="0" cb="0"/>
  <counter type="INSTRUCTION" missed="5" covered="4"/><counter type="BRANCH" missed="1" covered="1"/><counter type="LINE" missed="2" covered="1"/><counter type="METHOD" missed="1" covered="1"/>
 </sourcefile>
 <counter type="LINE" missed="99" covered="0"/>
</package>
<counter type="LINE" missed="99" covered="0"/>
</report>`;

const CLOVER = `<?xml version="1.0" encoding="UTF-8"?>
<coverage generated="1700000000" clover="3.2.0">
  <project timestamp="1700000000" name="All files">
    <metrics statements="5" coveredstatements="3" conditionals="2" coveredconditionals="1" methods="2" coveredmethods="1" elements="9" coveredelements="5" complexity="0" loc="5" ncloc="5" packages="1" files="1" classes="1"/>
    <file name="Foo.php" path="C:\\work\\app\\src\\Foo.php">
      <class name="Foo" namespace="global"><metrics complexity="3" methods="99" coveredmethods="0" statements="99" coveredstatements="0" elements="9" coveredelements="5"/></class>
      <line num="3" type="method" name="bar" visibility="public" complexity="1" crap="1" count="2"/>
      <line num="4" type="stmt" count="2"/>
      <line num="5" type="cond" count="1" truecount="1" falsecount="0"/>
      <line num="9" type="method" name="baz" count="0"/>
      <line num="10" type="stmt" count="0"/>
      <metrics loc="12" ncloc="10" classes="1" methods="2" coveredmethods="1" conditionals="2" coveredconditionals="1" statements="3" coveredstatements="2" elements="5" coveredelements="3"/>
    </file>
  </project>
</coverage>`;

describe('JaCoCo i Clover', () => {
  test('JaCoCo: ścieżka pakiet/plik, linie z ci, gałęzie mb/cb, metody z licznika pliku (nie klasy)', () => {
    const m = TM.parseJacoco(JACOCO);
    assert.deepEqual(host([...m.keys()]), ['com/example/Foo.java']);
    const e = host(m.get('com/example/Foo.java'));
    assert.deepEqual([...e.lines.entries()], [[3, 4], [4, 0], [7, 0]]);
    assert.deepEqual({ lf: e.lf, lh: e.lh, bf: e.bf, bh: e.bh, ff: e.ff, fh: e.fh }, { lf: 3, lh: 1, bf: 2, bh: 1, ff: 2, fh: 1 });
  });
  test('Clover: path, stmt/cond jako linie, method jako funkcje, metryki klasy pominięte', () => {
    const m = TM.parseClover(CLOVER);
    const e = host(m.get('C:\\work\\app\\src\\Foo.php'));
    assert.deepEqual([...e.lines.entries()], [[4, 2], [5, 1], [10, 0]]);
    assert.deepEqual({ lf: e.lf, lh: e.lh, bf: e.bf, bh: e.bh, ff: e.ff, fh: e.fh }, { lf: 3, lh: 2, bf: 2, bh: 1, ff: 2, fh: 1 });
  });
  test('detectFormat / parseCoverage po nazwie i treści', () => {
    assert.equal(TM.detectFormat(LCOV, 'lcov.info'), 'lcov');
    assert.equal(TM.detectFormat(LCOV, 'report.txt'), 'lcov');
    assert.equal(TM.detectFormat(JSON.stringify(ISTANBUL), 'coverage-final.json'), 'istanbul');
    assert.equal(TM.detectFormat(JSON.stringify(SUMMARY), 'x.json'), 'istanbul-summary');
    assert.equal(TM.detectFormat(COBERTURA, 'coverage.xml'), 'cobertura');
    assert.equal(TM.detectFormat(JACOCO, 'jacoco.xml'), 'jacoco');
    assert.equal(TM.detectFormat(CLOVER, 'clover.xml'), 'clover');
    assert.equal(TM.detectFormat('hello', 'notes.txt'), null);
    assert.equal(TM.parseCoverage('hello', 'x'), null);
    const r = TM.parseCoverage(COBERTURA, 'coverage.xml');
    assert.equal(r.format, 'cobertura'); assert.equal(r.files.size, 2);
  });
});

describe('applyCoverage — dopasowanie ścieżek i agregacja folderów', () => {
  const files = [F('src/a.js'), F('src/b.js'), F('src/c.js'), F('src/deep/index.js'), F('lib/index.js'), F('pkg/parser.py'), F('pkg/util.py'),
    F('src/main/java/com/example/Foo.java'), F('README.md', '# x\n')];
  test('absolutne Windows/Linux, ./, prefiks katalogu projektu; niejednoznaczne i obce pominięte', () => {
    const g = build(files);
    const lcov = [
      'SF:/home/ci/work/proj/src/a.js', 'DA:1,1', 'DA:2,0', 'end_of_record',
      'SF:C:\\Users\\dev\\proj\\src\\b.js', 'DA:1,1', 'DA:2,1', 'DA:3,1', 'DA:4,0', 'end_of_record',
      'SF:./src/c.js', 'DA:1,0', 'end_of_record',
      'SF:index.js', 'DA:1,1', 'end_of_record',                       // dwa index.js w grafie → niejednoznaczne
      'SF:/elsewhere/other/x/util.js', 'DA:1,1', 'end_of_record',     // brak takiego pliku
      'SF:/abs/other/zzz/a.js', 'DA:1,1', 'end_of_record',            // ten sam basename, inny katalog, sufiks 1 → odrzucony
    ].join('\n');
    const info = TM.applyCoverage(g, TM.parseCoverage(lcov, 'lcov.info'), { source: 'lcov.info', at: 1 });
    assert.deepEqual(host(node(g, 'src/a.js').coverage), { pct: 50, lh: 1, lf: 2, bh: 0, bf: 0, fh: 0, ff: 0, uncovered: [[2, 2]] });
    assert.equal(node(g, 'src/b.js').coverage.pct, 75);
    assert.equal(node(g, 'src/c.js').coverage.pct, 0);
    assert.equal(node(g, 'src/deep/index.js').coverage, undefined);
    assert.equal(node(g, 'README.md').coverage, undefined);
    assert.deepEqual(host({ ...info, unmatchedSample: undefined }), { files: 3, matched: 3, unmatched: 3, total: 6, pct: 57.1, lh: 4, lf: 7, bh: 0, bf: 0, fh: 0, ff: 0,
      source: 'lcov.info', format: 'lcov', at: 1, unmatchedSample: undefined });
    assert.equal(info.unmatchedSample.length, 3);
    // foldery = suma dzieci
    assert.deepEqual(host(node(g, 'src').coverage), { pct: 57.1, lh: 4, lf: 7, bh: 0, bf: 0, fh: 0, ff: 0, files: 3 });
    assert.equal(node(g, '__root__').coverage.files, 3);
    assert.equal(node(g, 'lib').coverage, undefined);
    assert.equal(g.testInfo.coverage.pct, 57.1);
  });
  test('Cobertura względem <source> (tylko nazwa pakietu) i JaCoCo pakiet/plik', () => {
    const g = build(files);
    const info = TM.applyCoverage(g, [TM.parseCoverage(COBERTURA, 'coverage.xml'), TM.parseCoverage(JACOCO, 'jacoco.xml')]);
    assert.equal(info.files, 3);
    assert.equal(node(g, 'pkg/parser.py').coverage.pct, 60);
    assert.deepEqual(host(node(g, 'pkg/parser.py').coverage.uncovered), [[8, 9]]);
    assert.equal(node(g, 'src/main/java/com/example/Foo.java').coverage.lh, 1);
    assert.equal(node(g, 'pkg').coverage.lf, 7);
    assert.equal(info.format, 'cobertura+jacoco');
  });
  test('kilka raportów tego samego pliku: lcov wygrywa z Istanbul, ponowne nałożenie zastępuje stare', () => {
    const g = build(files);
    const lc = TM.parseCoverage('SF:/repo/src/a.js\nDA:1,1\nDA:2,1\nend_of_record\n', 'lcov.info');
    const ist = TM.parseCoverage(JSON.stringify(ISTANBUL), 'coverage-final.json');
    TM.applyCoverage(g, [ist, lc]);
    assert.equal(node(g, 'src/a.js').coverage.pct, 100);
    TM.applyCoverage(g, ist);
    assert.equal(node(g, 'src/a.js').coverage.pct, 66.7);
    TM.applyCoverage(g, TM.parseCoverage('SF:/repo/src/b.js\nDA:1,0\nend_of_record\n', 'lcov.info'));
    assert.equal(node(g, 'src/a.js').coverage, undefined, 'stare pokrycie usunięte');
    assert.equal(node(g, 'src/b.js').coverage.pct, 0);
  });
  test('mapTests zachowuje pokrycie; clearCoverage czyści', () => {
    const g = build([...files, F('src/a.test.js')]);
    TM.applyCoverage(g, TM.parseCoverage('SF:src/a.js\nDA:1,1\nend_of_record\n', 'lcov.info'));
    TM.mapTests(g);
    assert.equal(g.testInfo.coverage.files, 1);
    assert.equal(g.testInfo.tests, 1);
    const g2 = Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    TM.mapTests(g2);
    assert.equal(g2.testInfo.coverage.files, 1, 'testInfo.coverage przetrwało zapis mapy');
    assert.equal(node(g2, 'src/a.js').coverage.pct, 100);
    TM.clearCoverage(g2);
    assert.equal(node(g2, 'src/a.js').coverage, undefined);
    assert.equal(g2.testInfo.coverage, null);
  });
  test('reportSegs: file://, backslashe, litera dysku, ./ i ..', () => {
    assert.deepEqual(host(TM.reportSegs('file:///C:/a/b.js')), ['a', 'b.js']);
    assert.deepEqual(host(TM.reportSegs('C:\\x\\y\\z.ts')), ['x', 'y', 'z.ts']);
    assert.deepEqual(host(TM.reportSegs('./src/../src/a.js')), ['src', 'src', 'a.js']);
  });
});
