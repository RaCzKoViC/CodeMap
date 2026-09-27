// .gitignore w CLI (cli/gitignore.mjs + cli/fsload.mjs): składnia wzorców jak w gicie, pliki zagnieżdżone,
// .git/info/exclude, analiza podkatalogu dziedziczy wzorce przodków, raporty pokrycia z ignorowanego coverage/,
// --no-gitignore wyłącza. Wyrocznia dla wzorców: `git check-ignore` (gdy jest polecenie git).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseGitignore, createIgnore } from '../cli/gitignore.mjs';
import { runAnalysis } from '../cli/analyze.mjs';
import { git, gitAvailable } from '../tools/git-probe.mjs';
import { writeTree } from './harness.mjs';

const IGNORE = [
  '# komentarz', '', 'build/', '*.log', '!keep.log', '/root-only.txt', 'docs/**/draft.md', 'tmp/**', '**/cache', 'a?c.txt',
  'x[0-9].js', '\\#hash.txt', 'trailing.txt   ', 'deep/nested/file.js',
].join('\n');
const CASES = [   // [ścieżka, katalog?, ignorowana?]
  ['build', true, true], ['src/build', true, true], ['build', false, false],                 // `build/` — tylko katalogi, na każdym poziomie
  ['app.log', false, true], ['src/deep/app.log', false, true], ['keep.log', false, false],   // negacja
  ['root-only.txt', false, true], ['src/root-only.txt', false, false],                       // zakotwiczone `/`
  ['docs/draft.md', false, true], ['docs/a/b/draft.md', false, true], ['src/docs/draft.md', false, false],
  ['tmp/x/y.js', false, true], ['tmp', true, false, 'dir/**'],                              // `tmp/**` — zawartość, nie sam katalog
  ['cache', true, true], ['src/lib/cache', true, true],
  ['abc.txt', false, true], ['abbc.txt', false, false], ['x7.js', false, true], ['xa.js', false, false],
  ['#hash.txt', false, true], ['trailing.txt', false, true], ['deep/nested/file.js', false, true], ['nested/file.js', false, false],
];

describe('wzorce .gitignore', () => {
  test('komentarze i puste linie pominięte; negacja, katalogi, zakotwiczenie', () => {
    const r = parseGitignore(IGNORE);
    assert.equal(r.length, 12);
    assert.deepEqual(r.filter((x) => x.neg).length, 1);
    assert.deepEqual(r.filter((x) => x.dir).length, 1);
  });
  test('dopasowania jak w gicie (tabela przypadków)', () => {
    const ig = createIgnore(); ig.add('', IGNORE);
    for (const [p, dir, want] of CASES) assert.equal(ig.ignored(p, dir), want, p + (dir ? '/' : ''));
  });
  test('zgodność z `git check-ignore` na tych samych ścieżkach', { skip: !gitAvailable() && 'brak polecenia git' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-gi-'));
    try {
      git(dir, ['init', '-q']); fs.writeFileSync(path.join(dir, '.gitignore'), IGNORE);
      const ig = createIgnore(); ig.add('', IGNORE);
      // ścieżki nie muszą istnieć — katalog sygnalizuje końcowy `/`
      const paths = CASES.map(([p, isDir]) => p + (isDir ? '/' : ''));
      let out = '';
      try { out = String(git(dir, ['check-ignore', '--no-index', ...paths])); } catch (e) { out = String((e && e.message) || ''); }
      const gitSet = new Set(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));   // ścieżki jak podane (z `/`)
      // `tmp/` przy `tmp/**`: check-ignore dopasowuje pusty `**`, ale git wchodzi do katalogu (działa `!tmp/keep`) — jak my
      for (const [p, isDir, , skip] of CASES) if (!skip) assert.equal(ig.ignored(p, isDir), gitSet.has(p + (isDir ? '/' : '')), 'vs git: ' + p + (isDir ? '/' : ''));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test('zagnieżdżony .gitignore: wzorce względem swojego katalogu, głębszy wygrywa', () => {
    const ig = createIgnore(); ig.add('', '*.gen.js\n'); ig.add('pkg', '!keep.gen.js\n/local.txt\n');
    assert.equal(ig.ignored('pkg/a.gen.js', false), true);
    assert.equal(ig.ignored('pkg/keep.gen.js', false), false);
    assert.equal(ig.ignored('pkg/local.txt', false), true);
    assert.equal(ig.ignored('pkg/sub/local.txt', false), false);
    assert.equal(ig.ignored('local.txt', false), false);
  });
});

describe('wczytywanie projektu z .gitignore', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-gi-proj-'));
    fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'info', 'exclude'), 'notes.md\n');
    writeTree(dir, '.gitignore', 'private/\nreports/\n*.secret.js\n');
    writeTree(dir, 'src/a.js', "import { b } from './b.js';\nexport const a = b;\n");
    writeTree(dir, 'src/b.js', 'export const b = 1;\n');
    writeTree(dir, 'src/x.secret.js', 'export const s = 1;\n');
    writeTree(dir, 'private/p.js', 'export const p = 1;\n');
    writeTree(dir, 'reports/coverage/lcov.info', 'SF:src/a.js\nDA:1,1\nend_of_record\n');   // raport pokrycia w ignorowanym katalogu
    writeTree(dir, 'notes.md', '# n\n');
    writeTree(dir, 'pkg/.gitignore', 'gen/\n');
    writeTree(dir, 'pkg/gen/g.js', 'export const g = 1;\n');
    writeTree(dir, 'pkg/main.js', 'export const m = 1;\n');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const paths = (r) => [...r.graph.nodes.values()].filter((n) => n.type === 'file').map((n) => n.path).sort();
  test('ignorowane pominięte (także .git/info/exclude i zagnieżdżony), pokrycie z ignorowanego reports/ zostaje; --no-gitignore wszystko', async () => {
    const r = await runAnalysis(dir, { git: false, lang: 'en' });
    assert.deepEqual(paths(r), ['.gitignore', 'pkg/.gitignore', 'pkg/main.js', 'src/a.js', 'src/b.js']);
    assert.equal(r.report.stats.gitignored, 5);
    assert.ok(r.report.tests && r.report.tests.coverage, 'raport pokrycia z reports/coverage wczytany');
    const all = await runAnalysis(dir, { git: false, coverage: false, lang: 'en', gitignore: false });
    assert.ok(paths(all).includes('private/p.js') && paths(all).includes('src/x.secret.js') && paths(all).includes('notes.md'));
  });
  test('analiza podkatalogu dziedziczy wzorce z .gitignore przodków', async () => {
    writeTree(dir, 'src/private/deep.js', 'export const d = 1;\n');
    try {
      const r = await runAnalysis(path.join(dir, 'src'), { git: false, coverage: false, lang: 'en' });
      assert.deepEqual(paths(r), ['a.js', 'b.js']);   // private/ (wzorzec z korzenia) i *.secret.js
    } finally { fs.rmSync(path.join(dir, 'src', 'private'), { recursive: true, force: true }); }
  });
});
