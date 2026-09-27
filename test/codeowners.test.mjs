// CM.CodeOwners — wzorce jak w dokumentacji GitHuba, ostatnia reguła wygrywa, rozwiązywanie właścicieli na autorów
// historii, pliki kodu bez właściciela i rozjazd CODEOWNERS z git; reguły Inspect „unowned" i „ownerdrift".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { CLI_MODULES } from '../cli/runtime.mjs';

const CM = loadCM(CLI_MODULES);
const CO = CM.CodeOwners;
const { Graph } = CM.Graph;
const F = (path, content) => ({ path, content, size: content.length, mtime: 1 });

describe('CODEOWNERS: wzorce (przykłady z dokumentacji GitHuba)', () => {
  const m = (pat, path) => CO.compile(pat).test(path);
  test('* i *.js — wszędzie; /build/logs/ — katalog od korzenia z zawartością', () => {
    assert.ok(m('*', 'a/b/c.txt'));
    assert.ok(m('*.js', 'src/deep/x.js') && !m('*.js', 'src/x.jsx'));
    assert.ok(m('/build/logs/', 'build/logs/a/b.log') && !m('/build/logs/', 'x/build/logs/a.log'));
  });
  test('docs/* — tylko pliki bezpośrednio w docs; apps/ — każdy katalog apps; /docs/ — tylko w korzeniu; **/logs', () => {
    assert.ok(m('docs/*', 'docs/getting-started.md') && !m('docs/*', 'docs/build-app/troubleshooting.md'));
    assert.ok(m('apps/', 'apps/a.js') && m('apps/', 'x/apps/y/z.js') && !m('apps/', 'apps.js'));
    assert.ok(m('/docs/', 'docs/a.md') && !m('/docs/', 'x/docs/a.md'));
    assert.ok(m('**/logs', 'logs/a.log') && m('**/logs', 'deploy/logs/x/y.log') && !m('**/logs', 'logs.txt'));
    assert.ok(m('src/**/test.js', 'src/test.js') && m('src/**/test.js', 'src/a/b/test.js'));
  });
  test('parse: komentarze, \\#, sekcje GitLaba, reguła bez właścicieli; ostatnia pasująca wygrywa', () => {
    const rules = CO.parse('# komentarz\n*       @global\n[Docs] @docs-team\n/src/ @ala @org/core  # uwaga\n/src/gen/\n\\#tmp @x\n');
    assert.deepEqual(host(rules.map((r) => [r.pattern, r.owners, r.line])),
      [['*', ['@global'], 2], ['/src/', ['@ala', '@org/core'], 4], ['/src/gen/', [], 5], ['\\#tmp', ['@x'], 6]]);
    assert.deepEqual(host(CO.ownersOf(rules, 'src/a.js')), { owners: ['@ala', '@org/core'], line: 4, pattern: '/src/' });
    assert.deepEqual(host(CO.ownersOf(rules, 'src/gen/x.js').owners), []);
    assert.deepEqual(host(CO.ownersOf(rules, 'README.md').owners), ['@global']);
    assert.deepEqual(host(CO.ownersOf(rules, '#tmp').owners), ['@x']);
  });
  test('resolve: @login po loginie, części lokalnej e-maila (noreply) i nazwisku; e-mail; zespół → null', () => {
    const au = [{ name: 'Ala Kowalska', email: 'ala@firma.pl' }, { name: 'Bob', email: '123+bobdev@users.noreply.github.com' },
      { name: 'Celina', email: 'c@x.io', login: 'celka' }, { name: 'dependabot[bot]', email: 'd@x', bot: true }];
    assert.equal(CO.resolve('@ala', au), 0);
    assert.equal(CO.resolve('@AlaKowalska', au), 0);
    assert.equal(CO.resolve('@bobdev', au), 1);
    assert.equal(CO.resolve('@celka', au), 2);
    assert.equal(CO.resolve('c@x.io', au), 2);
    assert.equal(CO.resolve('@org/core', au), null);
    assert.equal(CO.resolve('@nikt', au), null);
  });
});

describe('CODEOWNERS a historia git (analyze + reguły Inspect)', () => {
  const T0 = Date.UTC(2026, 0, 1);
  const files = [
    F('.github/CODEOWNERS', '*.md @docs\n/src/core/ @ala\n/src/ui/ @org/frontend\n'),
    F('src/core/engine.js', 'export const e = 1;\n'), F('src/core/model.js', 'export const m = 1;\n'),
    F('src/ui/view.js', 'export const v = 1;\n'),
    F('lib/a.js', 'export const a = 1;\n'), F('lib/b.js', 'export const b = 1;\n'), F('tools/x.py', 'X = 1\n'),
    F('README.md', '# x\n'),
  ];
  const build = () => {
    const g = new Graph().build(files, { name: 't', source: 'test' });
    const cs = []; const c = (who, email, paths, i) => cs.push({ sha: 'c' + cs.length, parents: [], merge: false, author: { name: who, email },
      authorTime: T0 + i * 864e5, time: T0 + i * 864e5, message: 'm', files: paths.map((p) => ({ path: p, status: 'M' })) });
    for (let i = 0; i < 6; i++) c('Bob Nowak', 'bob@firma.pl', ['src/core/engine.js'], i);        // engine.js: sam Bob — rozjazd
    for (let i = 0; i < 6; i++) c('Ala Kowalska', 'ala@firma.pl', ['src/core/model.js'], 10 + i);  // model.js: Ala — zgodnie
    c('Ala Kowalska', 'ala@firma.pl', ['src/ui/view.js'], 20);
    CM.GitCore.applyToGraph(g, CM.GitCore.analyze(cs.reverse(), files.map((f) => f.path)), { source: 'test' });
    return g;
  };
  test('analyze: pliki kodu bez właściciela (lib/*, tools/x.py) i rozjazd tylko dla engine.js (zespół nie oceniany)', () => {
    const co = host(CO.analyze(build()));
    assert.equal(co.file, '.github/CODEOWNERS');
    assert.deepEqual(co.unowned.sort(), ['lib/a.js', 'lib/b.js', 'tools/x.py']);
    assert.deepEqual(co.drift.map((d) => [d.id, d.owners, d.c]), [['src/core/engine.js', ['@ala'], 6]]);
  });
  test('reguły Inspect: unowned po folderach, ownerdrift z autorem i udziałem; bez CODEOWNERS — nic', async () => {
    const res = host(await CM.Inspect.run(build()));
    const un = res.findings.find((f) => f.rule === 'unowned'), dr = res.findings.find((f) => f.rule === 'ownerdrift');
    assert.deepEqual(un.items.map((i) => [i.path, i.detail]).sort(), [['lib', 'plików bez właściciela: 2'], ['tools', 'plików bez właściciela: 1']]);
    assert.equal(dr.count, 1);
    assert.equal(dr.items[0].detail, 'CODEOWNERS: @ala · git: Bob Nowak 100 % z 6 zmian');
    const plain = host(await CM.Inspect.run(new Graph().build(files.slice(1), { name: 't' })));
    assert.ok(!plain.findings.some((f) => f.rule === 'unowned' || f.rule === 'ownerdrift'));
  });
});
