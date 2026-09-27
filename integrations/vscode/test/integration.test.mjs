// Integracja: paczka (scripts/bundle.mjs) → analyzeProject z KOPII CLI w wątku roboczym (src/analyzer.js)
// na małym projekcie → diagnostyki VS Code (atrapa). Cykl a → b → c → a z liniami importów i powiązanymi
// plikami, sierota ze spacją w nazwie, naruszenie architektury, podkatalog repozytorium (prefiks URI w SARIF),
// anulowanie (terminate wątku) i kontrola samej paczki.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { require, tmpBundle, tmpDir, rmDir, writeFiles, FIXTURE, IMPORT_LINE, REPO } from './helpers.mjs';
import { bundle, localRefs } from '../scripts/bundle.mjs';

const { analyze, AbortError } = require('../src/analyzer.js');
const { buildDiagnostics } = require('../src/extension.js');
const { createVscodeMock } = require('./vscode-mock.cjs');

let EXT = null, BASE = null, DIR = null, REPO_DIR = null, SUB = null;
before(() => {
  EXT = tmpBundle();
  BASE = tmpDir('cm-vsc-fx-');
  DIR = path.join(BASE, 'fixture');
  writeFiles(DIR, FIXTURE);
  // repozytorium z analizowanym podkatalogiem pkg/ (sam katalog .git wystarcza do wykrycia korzenia; git:false)
  REPO_DIR = path.join(BASE, 'repo');
  SUB = path.join(REPO_DIR, 'pkg');
  fs.mkdirSync(path.join(REPO_DIR, '.git'), { recursive: true });
  writeFiles(SUB, FIXTURE);
});
after(() => { rmDir(EXT); rmDir(BASE); });

const cliDir = () => path.join(EXT, 'cli');

describe('paczka rozszerzenia', () => {
  test('app/ i cli/ skopiowane, ROOT w kopii runtime.mjs wskazuje app/, oryginał nietknięty', () => {
    for (const p of ['app/index.html', 'app/css/styles.css', 'app/js/app.js', 'app/js/vscode-bridge.js', 'app/icon-192.png',
      'cli/analyze.mjs', 'cli/runtime.mjs', 'LICENSE']) assert.ok(fs.existsSync(path.join(EXT, ...p.split('/'))), p);
    assert.match(fs.readFileSync(path.join(EXT, 'cli', 'runtime.mjs'), 'utf8'), /import\.meta\.url\)\), '\.\.', 'app'\)/);
    assert.match(fs.readFileSync(path.join(REPO, 'cli', 'runtime.mjs'), 'utf8'), /import\.meta\.url\)\), '\.\.'\);/);
    const html = fs.readFileSync(path.join(EXT, 'app', 'index.html'), 'utf8');
    for (const r of localRefs(html)) assert.ok(fs.existsSync(path.join(EXT, 'app', ...r.split('/'))), r);
  });
  test('brak pliku z index.html albo zmieniona definicja ROOT → błąd bundle', () => {
    const fake = tmpDir('cm-vsc-repo-');
    try {
      for (const d of ['css', 'js', 'cli']) fs.cpSync(path.join(REPO, d), path.join(fake, d), { recursive: true });
      for (const f of ['index.html', 'icon-192.png', 'LICENSE']) fs.copyFileSync(path.join(REPO, f), path.join(fake, f));
      const out = tmpDir('cm-vsc-out-');
      try {
        fs.rmSync(path.join(fake, 'js', 'vscode-bridge.js'));
        assert.throws(() => bundle({ out, repo: fake }), /brak plików z index\.html.*vscode-bridge\.js/);
        fs.copyFileSync(path.join(REPO, 'js', 'vscode-bridge.js'), path.join(fake, 'js', 'vscode-bridge.js'));
        const rt = path.join(fake, 'cli', 'runtime.mjs');
        fs.writeFileSync(rt, fs.readFileSync(rt, 'utf8').replace("'..');", "'..', 'x');"));
        assert.throws(() => bundle({ out, repo: fake }), /definicji ROOT/);
      } finally { rmDir(out); }
    } finally { rmDir(fake); }
  });
});

describe('analiza w wątku → diagnostyki', () => {
  test('cykl, naruszenie architektury, sierota — pliki, linie, ważności, relatedInformation', async () => {
    const r = await analyze(DIR, { lang: 'en', git: false }, { cliDir: cliDir() });
    assert.ok(r.graph && r.graph.format === 'codemap' && r.graph.nodes.some((n) => n.id === 'src/a.js'));
    assert.equal(r.report.project.path, '.');
    const m = createVscodeMock({ folders: [DIR] });
    const V = m.vscode, S = V.DiagnosticSeverity;
    const d = buildDiagnostics(V, r.sarif, { root: DIR, sub: '', minSeverity: 'info', lang: 'en' });
    const byFile = new Map(d.entries.map(([u, list]) => [path.relative(DIR, u.fsPath).split(path.sep).join('/'), list]));
    // Inspect: jedno znalezisko na cykl, zakotwiczone w jednym z plików; pozostałe jako relatedInformation
    const cycles = [...byFile].flatMap(([rel, list]) => list.filter((x) => x.code.value === 'cycles').map((x) => [rel, x]));
    assert.equal(cycles.length, 1);
    const [primary, cyc] = cycles[0];
    assert.ok(primary in IMPORT_LINE, primary);
    assert.equal(cyc.severity, S.Warning, 'cykl 3 plików = med');
    assert.equal(cyc.source, 'CodeMap');
    assert.equal(cyc.range.start.line, IMPORT_LINE[primary] - 1, 'linia importu następnego pliku cyklu');
    const rels = cyc.relatedInformation.map((x) => path.relative(DIR, x.location.uri.fsPath).split(path.sep).join('/')).sort();
    assert.deepEqual(rels, Object.keys(IMPORT_LINE).filter((x) => x !== primary).sort());
    assert.ok(cyc.relatedInformation.every((x) => /^cycle: [abc]\.js$/.test(x.message)));
    assert.match(cyc.message, /^Dependency cycles/);
    const arch = (byFile.get('src/c.js') || []).find((x) => x.code.value === 'archviolation');
    assert.ok(arch, 'naruszenie architektury');
    assert.equal(arch.severity, S.Error);
    assert.equal(arch.range.start.line, IMPORT_LINE['src/c.js'] - 1);
    assert.deepEqual(arch.relatedInformation.map((x) => path.basename(x.location.uri.fsPath)), ['a.js']);
    const orphan = (byFile.get('src/my file.js') || []).find((x) => x.code.value === 'orphan');
    assert.ok(orphan, 'sierota ze spacją w nazwie (URI zdekodowane)');
    assert.ok(fs.existsSync(path.join(DIR, 'src', 'my file.js')));
    for (const [u] of d.entries) assert.ok(fs.existsSync(u.fsPath), 'diagnostyka na istniejącym pliku: ' + u.fsPath);
    // próg high: tylko Error
    const high = buildDiagnostics(V, r.sarif, { root: DIR, sub: '', minSeverity: 'high', lang: 'en' });
    assert.ok(high.entries.length > 0 && high.entries.every(([, list]) => list.every((x) => x.severity === S.Error)));
    assert.ok(high.shown < d.shown);
  });

  test('podkatalog repozytorium: URI z prefiksem pkg/ → pliki w analizowanym folderze', async () => {
    const r = await analyze(SUB, { lang: 'pl', git: false }, { cliDir: cliDir() });
    assert.equal(r.report.project.path, 'pkg');
    assert.ok(r.sarif.runs[0].results.every((x) => x.locations[0].physicalLocation.artifactLocation.uri.startsWith('pkg/')));
    const V = createVscodeMock({ folders: [SUB] }).vscode;
    const d = buildDiagnostics(V, r.sarif, { root: SUB, sub: r.report.project.path, minSeverity: 'info', lang: 'pl' });
    assert.equal(d.shown, 3);
    assert.deepEqual(d.entries.map(([u]) => path.relative(SUB, u.fsPath).split(path.sep).join('/')).sort(), ['src/c.js', 'src/my file.js']);
    for (const [u, list] of d.entries) {
      assert.ok(fs.existsSync(u.fsPath), u.fsPath);
      for (const x of list) for (const ri of x.relatedInformation || []) assert.ok(fs.existsSync(ri.location.uri.fsPath));
    }
    assert.ok(d.entries.some(([, list]) => list.some((x) => /^cykl: /.test((x.relatedInformation || [{}])[0].message || ''))));
  });

  test('anulowanie: AbortSignal kończy wątek, brak katalogu → błąd z CLI', async () => {
    const ctrl = new AbortController();
    const p = analyze(DIR, { lang: 'en', git: false }, { cliDir: cliDir(), signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(p, (e) => e instanceof AbortError && e.name === 'AbortError');
    await assert.rejects(analyze(DIR, {}, { cliDir: cliDir(), signal: AbortSignal.abort() }), { name: 'AbortError' });
    await assert.rejects(analyze(path.join(BASE, 'nie-ma'), { lang: 'en' }, { cliDir: cliDir() }), (e) => e.cli === true && /nie-ma/.test(e.message));
  });
});
