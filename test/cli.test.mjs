// CLI (cli/codemap.mjs) na małym projekcie-fixture w katalogu tymczasowym: cykl importów a → b → c → a,
// naruszenie .codemap.rules.json, plik testowy, raport lcov w coverage/, katalogi pomijane (node_modules,
// dist) i — gdy jest polecenie git — kilka commitów dwóch autorów. Sprawdza podsumowanie, --json, --sarif
// (struktura SARIF 2.1.0, URI względne, relatedLocations cyklu), --map (Graph.fromJSON), --export, kody wyjścia.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCM, CORE, ROOT } from './harness.mjs';
import { git, gitAvailable } from '../tools/git-probe.mjs';
import { analyzeProject } from '../cli/analyze.mjs';

const CLI = path.join(ROOT, 'cli', 'codemap.mjs');
const HAS_GIT = gitAvailable();
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const FILES = {
  'package.json': '{ "name": "fixture", "version": "0.0.1" }\n',
  'src/a.js': "import { b } from './b.js';\nexport const a = () => b();\n",
  'src/b.js': "// moduł b\nimport { c } from './c.js';\nexport const b = () => c();\n",
  'src/c.js': "// moduł c\n\nimport { a } from './a.js';\nexport const c = () => a;\n",
  'src/my file.js': 'export const spaced = 1;\n',   // nikt go nie importuje → orphan (spacja w URI SARIF)
  'src/index.js': "import { a } from './a.js';\nexport default () => a();\n",
  // złożony (CC ≥ 15), bez testu, pokrycie 10 % → reguły untested i lowcov (dane z testów i lcov działają w CLI)
  'src/logic.js': 'export function pick(x) {\n' + Array.from({ length: 16 }, (_, i) => `  if (x === ${i}) return ${i * 2};\n`).join('') + '  return -1;\n}\n',
  'test/b.test.js': "import { b } from '../src/b.js';\nimport assert from 'node:assert';\nassert.ok(b);\n",
  'coverage/lcov.info': 'TN:\nSF:src/a.js\nDA:1,1\nDA:2,0\nLF:2\nLH:1\nend_of_record\nSF:src/b.js\nDA:1,1\nDA:2,1\nDA:3,1\nLF:3\nLH:3\nend_of_record\n'
    + 'SF:src/logic.js\n' + Array.from({ length: 10 }, (_, i) => `DA:${i + 2},${i ? 0 : 1}\n`).join('') + 'LF:10\nLH:1\nend_of_record\n',
  'node_modules/dep/index.js': 'module.exports = 1;\n',
  'dist/bundle.js': 'console.log(1);\n',
  '.codemap.rules.json': JSON.stringify({
    layers: [{ name: 'core', match: 'src/c.js' }, { name: 'entry', match: 'src/a.js' }],
    forbid: [{ from: 'core', to: 'entry', why: 'rdzeń nie zna wejścia' }],
  }, null, 2) + '\n',
};
const IMPORT_LINE = { 'src/a.js': 1, 'src/b.js': 2, 'src/c.js': 3 };   // linia importu następnego pliku cyklu

let BASE = null, DIR = null, OUT = null;
const put = (rel, content) => { const p = path.join(DIR, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
function cli(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: opts.cwd || DIR, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const out = (name) => path.join(OUT, name);
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

before(() => {
  BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cli-'));
  DIR = path.join(BASE, 'fixture');
  OUT = path.join(BASE, 'out');
  fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  for (const [rel, content] of Object.entries(FILES)) put(rel, content);
  if (HAS_GIT) {
    git(DIR, ['init', '-q', '-b', 'main']);
    for (const [k, v] of [['core.autocrlf', 'false'], ['commit.gpgsign', 'false'], ['gc.auto', '0']]) git(DIR, ['config', k, v]);
    let clock = 1700000000;
    const commit = (msg, name, email) => {
      const t = (clock += 3600);
      git(DIR, ['add', '-A']);
      git(DIR, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg],
        { env: { GIT_AUTHOR_DATE: `${t} +0200`, GIT_COMMITTER_DATE: `${t} +0200` } });
    };
    commit('start', 'Jan Kowalski', 'jan@example.com');
    put('src/a.js', FILES['src/a.js'] + '// zmiana 1\n'); commit('a: zmiana', 'Anna Nowak', 'anna@example.com');
    put('src/b.js', FILES['src/b.js'] + '// zmiana 2\n'); commit('b: zmiana', 'Jan Kowalski', 'jan@example.com');
  }
});
after(() => { if (BASE) { try { fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Windows: pliki paczek bywają zablokowane */ } } });

describe('CLI: codemap --version / --help / błędy użycia', () => {
  test('--version = CM.VERSION = package.json', () => {
    const r = cli(['--version']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim(), PKG.version);
  });
  test('--help (PL domyślnie, EN przez --lang en) → kod 0', () => {
    const pl = cli(['--help']);
    assert.equal(pl.code, 0);
    assert.match(pl.out, /codemap analyze/);
    assert.match(pl.out, /--fail-on/);
    assert.match(pl.out, /Kody wyjścia/);
    const en = cli(['--help', '--lang', 'en']);
    assert.match(en.out, /Exit codes/);
  });
  test('zła flaga, zła wartość --fail-on, brak katalogu, brak polecenia → kod 2', () => {
    for (const args of [['analyze', '--bogus'], ['analyze', '--fail-on', 'nope'], ['analyze', path.join(BASE, 'nie-ma')],
      ['analyze', '--min-score'], ['analyze', '--lang', 'de'], ['analyze', '--export', 'svg'], ['frobnicate'], []]) {
      const r = cli(args);
      assert.equal(r.code, 2, args.join(' ') + '\n' + r.err);
      assert.match(r.err, /codemap: błąd|codemap: error|Użycie/, args.join(' '));
    }
  });
});

describe('CLI: analyze na fixture', () => {
  let res = null;
  before(() => {
    res = cli(['analyze', '.', '--json', out('r.json'), '--sarif', out('r.sarif'), '--md', out('r.md'),
      '--map', out('r.codemap.json'), '--export', 'dot', '--out', out('r.dot')]);
  });

  test('kod 0, podsumowanie w terminalu i zapisane pliki', () => {
    assert.equal(res.code, 0, res.err);
    assert.match(res.out, /Zdrowie projektu\s+\d+\/100/);
    assert.match(res.out, /Cykle zależności \(cycles\)/);
    assert.match(res.out, /Naruszenia reguł architektury \(archviolation\)/);
    if (HAS_GIT) assert.match(res.out, /Historia git\s+3 commity · 2 autorów · bus factor 1/);
    assert.match(res.out, /Testy\s+1 plik testowy/);
    assert.match(res.out, /Pokrycie\s+33,3 % linii \(5\/15\)/);
    for (const f of ['r.json', 'r.sarif', 'r.md', 'r.codemap.json', 'r.dot']) assert.ok(fs.existsSync(out(f)), f);
  });

  test('--json: wynik, znaleziska, pliki (bez node_modules/dist), testy, pokrycie, git', () => {
    const r = readJSON(out('r.json'));
    assert.equal(r.tool.name, 'CodeMap');
    assert.equal(r.tool.version, PKG.version);
    assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
    assert.equal(r.files, 9);
    assert.equal(r.stats.files, 9);
    const cyc = r.findings.find((f) => f.rule === 'cycles');
    assert.ok(cyc, 'cykl wykryty');
    assert.equal(cyc.count, 1);
    assert.equal(cyc.items[0].related.length, 2);
    assert.deepEqual([cyc.items[0].path, ...cyc.items[0].related].sort(), ['src/a.js', 'src/b.js', 'src/c.js']);
    const arch = r.findings.find((f) => f.rule === 'archviolation');
    assert.equal(arch.count, 1);
    assert.equal(arch.items[0].path, 'src/c.js');
    assert.equal(arch.sev, 'high');
    assert.equal(r.totals.findings, r.findings.reduce((a, f) => a + f.count, 0));
    assert.equal(r.tests.tests, 1);
    assert.ok(r.tests.tested >= 1);
    assert.equal(r.tests.coverage.pct, 33.3);        // 5 z 15 linii (a.js 1/2, b.js 3/3, logic.js 1/10)
    assert.equal(r.tests.coverage.files, 3);
    for (const rule of ['untested', 'lowcov']) {
      const f = r.findings.find((x) => x.rule === rule);
      assert.ok(f && f.items.some((it) => it.path === 'src/logic.js'), rule + ' dla src/logic.js');
    }
    if (HAS_GIT) {
      assert.equal(r.git.commits, 3);
      assert.equal(r.git.authors, 2);
      assert.equal(r.git.head.ref, 'refs/heads/main');
      assert.ok(r.hotspots.length === 0 || r.hotspots[0].changes >= 1);
    } else assert.equal(r.git, null);
    assert.ok(!JSON.stringify(r).includes(path.basename(BASE)), 'bez ścieżek absolutnych katalogu tymczasowego');
  });

  test('--sarif: struktura 2.1.0, reguły, poziomy, URI względne, relatedLocations cyklu', () => {
    const text = fs.readFileSync(out('r.sarif'), 'utf8');
    const s = JSON.parse(text);
    assert.equal(s.version, '2.1.0');
    assert.match(s.$schema, /sarif-2\.1\.0/);
    assert.equal(s.runs.length, 1);
    const run = s.runs[0], drv = run.tool.driver;
    assert.equal(drv.name, 'CodeMap');
    assert.equal(drv.version, PKG.version);
    assert.equal(drv.informationUri, 'https://github.com/RaCzKoViC/CodeMap');
    assert.ok(drv.rules.length > 0);
    const ids = drv.rules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'reguły bez duplikatów');
    for (const rd of drv.rules) {
      assert.ok(rd.id && rd.shortDescription.text && rd.fullDescription.text && rd.help.text, rd.id);
      assert.ok(['error', 'warning', 'note'].includes(rd.defaultConfiguration.level), rd.id);
    }
    assert.ok(run.results.length > 0);
    for (const r of run.results) {
      assert.ok(ids.includes(r.ruleId), r.ruleId);
      assert.equal(drv.rules[r.ruleIndex].id, r.ruleId);
      assert.ok(['error', 'warning', 'note'].includes(r.level));
      assert.ok(r.message.text.length > 0);
      assert.ok(r.partialFingerprints['codemap/v1']);
      for (const l of [...r.locations, ...(r.relatedLocations || [])]) {
        const al = l.physicalLocation.artifactLocation;
        assert.equal(al.uriBaseId, '%SRCROOT%');
        assert.ok(!/^[a-z][a-z0-9+.-]*:|^\/|\\|(^|\/)\.\.(\/|$)/i.test(al.uri), 'URI względne: ' + al.uri);
        assert.ok(l.physicalLocation.region.startLine >= 1);
      }
    }
    assert.ok(!text.includes(path.basename(BASE)), 'bez ścieżek absolutnych');
    const cyc = run.results.find((r) => r.ruleId === 'cycles');
    const primary = decodeURIComponent(cyc.locations[0].physicalLocation.artifactLocation.uri);
    const rel = cyc.relatedLocations.map((l) => decodeURIComponent(l.physicalLocation.artifactLocation.uri));
    assert.deepEqual([primary, ...rel].sort(), ['src/a.js', 'src/b.js', 'src/c.js']);
    assert.equal(cyc.locations[0].physicalLocation.region.startLine, IMPORT_LINE[primary], 'linia importu w ' + primary);
    assert.equal(cyc.level, 'warning');   // cykl 3 plików = med
    const arch = run.results.find((r) => r.ruleId === 'archviolation');
    assert.equal(arch.level, 'error');
    assert.equal(arch.locations[0].physicalLocation.region.startLine, 3);
    assert.equal(arch.relatedLocations[0].physicalLocation.artifactLocation.uri, 'src/a.js');
    const uris = run.results.map((r) => r.locations[0].physicalLocation.artifactLocation.uri);
    assert.ok(uris.includes('src/my%20file.js'), 'spacja zakodowana w URI: ' + uris.join(', '));
  });

  test('--map: mapa .codemap.json wczytuje się przez CM.Graph.Graph.fromJSON', () => {
    const obj = readJSON(out('r.codemap.json'));
    assert.equal(obj.format, 'codemap');
    const CM = loadCM(CORE);
    const g = CM.Graph.Graph.fromJSON(obj);
    assert.ok(g.nodes.has('src/a.js'));
    assert.ok(!g.nodes.has('node_modules/dep/index.js'));
    assert.equal(g.importCycles().components.length, 1);
    assert.ok(g.nodes.get('src/a.js').coverage, 'pokrycie zapisane w mapie');
    const pos = new Set([...g.nodes.values()].filter((n) => n.type === 'file').map((n) => n.x + ',' + n.y));
    assert.ok(pos.size > 1, 'pozycje z układu (aplikacja otwiera mapę z zapisanymi x/y)');
    if (HAS_GIT) assert.equal(g.gitInfo.commits, 3);
  });

  test('--md i --export dot', () => {
    const md = fs.readFileSync(out('r.md'), 'utf8');
    assert.match(md, /^# CodeMap — Analiza statyczna: fixture/);
    assert.match(md, /\| Cykle zależności \(`cycles`\) \|/);
    assert.match(md, /## Naruszenia reguł architektury \(1\)/);
    const dot = fs.readFileSync(out('r.dot'), 'utf8');
    assert.match(dot, /^digraph/m);
    assert.match(dot, /src\/a\.js|a\.js/);
  });
});

describe('CLI: progi i kody wyjścia', () => {
  test('--min-score 101 → 1 (z powodem na stderr); --min-score 0 → 0', () => {
    const r = cli(['analyze', '--no-git', '--quiet', '--min-score', '101']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Próg niespełniony[\s\S]*health score \d+ < --min-score 101/);
    assert.equal(r.out, '', '--quiet: nic na stdout');
    assert.equal(cli(['analyze', '--no-git', '--quiet', '--min-score', '0']).code, 0);
  });
  test('--fail-on cycles → 1; --fail-on high → 1 (archviolation); --fail-on god,orphan… bez znalezisk → 0', () => {
    const c = cli(['analyze', '--no-git', '-q', '--fail-on', 'cycles']);
    assert.equal(c.code, 1);
    assert.match(c.err, /cycles/);
    assert.equal(cli(['analyze', '--no-git', '-q', '--fail-on=high']).code, 1);
    assert.equal(cli(['analyze', '--no-git', '-q', '--fail-on', 'god,fanout,huge']).code, 0);
  });
  test('--max-findings 0 → 1; duża wartość → 0; --lang en w komunikacie progu', () => {
    const r = cli(['analyze', '--no-git', '-q', '--max-findings', '0', '--lang', 'en']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Threshold not met[\s\S]*> --max-findings 0/);
    assert.equal(cli(['analyze', '--no-git', '-q', '--max-findings', '100000']).code, 0);
  });
  test('--no-coverage, --exclude i wyjście na stdout (--json -)', () => {
    const r = cli(['analyze', '--no-git', '--no-coverage', '--exclude', 'test/**', '--json', '-']);
    assert.equal(r.code, 0, r.err);
    const j = JSON.parse(r.out);
    assert.equal(j.tests, null, 'bez testów i pokrycia');
    assert.equal(j.stats.excluded, 1);
    assert.equal(j.git, null);
    assert.match(r.err, /Zdrowie projektu/, 'podsumowanie przeniesione na stderr, gdy stdout zajęty');
  });
});

describe('CLI: podkatalog repozytorium i API analyzeProject', () => {
  test('analyze src/ w repozytorium: URI SARIF z prefiksem podkatalogu, historia git przepisana', { skip: HAS_GIT ? false : 'brak polecenia git' }, () => {
    const r = cli(['analyze', 'src', '--sarif', out('sub.sarif'), '--json', out('sub.json'), '-q']);
    assert.equal(r.code, 0, r.err);
    const s = readJSON(out('sub.sarif'));
    const uris = s.runs[0].results.map((x) => x.locations[0].physicalLocation.artifactLocation.uri);
    assert.ok(uris.length && uris.every((u) => u.startsWith('src/')), uris.join(', '));
    const j = readJSON(out('sub.json'));
    assert.equal(j.project.path, 'src');
    assert.equal(j.git.tracked, 6);   // sześć plików src/ z historią (ścieżki względem src/)
  });
  test('analyzeProject(dir) → {graph, report, sarif, markdown} w zwykłych obiektach', async () => {
    const r = await analyzeProject(DIR, { lang: 'en', git: false });
    assert.deepEqual(Object.keys(r).sort(), ['graph', 'markdown', 'report', 'sarif']);
    assert.ok(Array.isArray(r.report.findings));
    assert.equal(Object.getPrototypeOf(r.report), Object.prototype, 'obiekt bieżącego realmu');
    assert.equal(r.report.lang, 'en');
    assert.ok(r.report.findings.some((f) => f.rule === 'cycles' && f.title === 'Dependency cycles'));
    assert.equal(r.graph.format, 'codemap');
    assert.equal(r.sarif.version, '2.1.0');
    assert.match(r.markdown, /^# CodeMap — Static analysis: fixture/);
  });
});
