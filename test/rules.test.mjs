import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM([...CORE, 'rules']);
const { Graph } = CM.Graph;
const R = CM.Rules;
const build = (extra = []) => new Graph().build([...FILES.map((f) => ({ ...f })), ...extra], META);

describe('globy', () => {
  test('** obejmuje dowolną liczbę segmentów (także zero), * tylko segment, ? jeden znak', () => {
    assert.ok(R.matchGlob('src/ui/**', 'src/ui/a.js'));
    assert.ok(R.matchGlob('src/ui/**', 'src/ui/x/y/z.js'));
    assert.ok(R.matchGlob('src/ui/**', 'src/ui'), 'folder itself (Go package targets)');
    assert.ok(!R.matchGlob('src/ui/**', 'src/uix/a.js'));
    assert.ok(!R.matchGlob('src/ui/**', 'src/core/a.js'));
    assert.ok(R.matchGlob('**/*.test.js', 'a.test.js'));
    assert.ok(R.matchGlob('**/*.test.js', 'x/y/a.test.js'));
    assert.ok(!R.matchGlob('**/*.test.js', 'x/y/a.tests.js'));
    assert.ok(R.matchGlob('src/*.js', 'src/a.js'));
    assert.ok(!R.matchGlob('src/*.js', 'src/x/a.js'));
    assert.ok(R.matchGlob('src/?.js', 'src/a.js') && !R.matchGlob('src/?.js', 'src/ab.js'));
    assert.ok(R.matchGlob('src/**/util.js', 'src/util.js') && R.matchGlob('src/**/util.js', 'src/a/b/util.js'));
  });
  test('znaki specjalne regexa są literałami; tablica globów = alternatywa; ./ i backslashe', () => {
    assert.ok(R.matchGlob('js/graph.js', 'js/graph.js') && !R.matchGlob('js/graph.js', 'js/graphXjs'));
    assert.ok(R.matchGlob('lib/(x)+[y].js', 'lib/(x)+[y].js'));
    assert.ok(R.matchGlob(['a/**', 'b/*.js'], 'b/c.js') && !R.matchGlob(['a/**', 'b/*.js'], 'c/d.js'));
    assert.ok(R.matchGlob('./src/*.js', 'src\\a.js'));
    assert.equal(R.globToRegExp('src/**/*.js').source, '^src\\/(?:.*\\/)?[^/]*\\.js$');
  });
});

describe('parse', () => {
  const SAMPLE = { layers: [{ name: 'ui', match: 'src/ui/**' }, { name: 'core', match: ['src/core/**', 'lib/*.js'] }], forbid: [{ from: 'core', to: 'ui', why: 'rdzeń nie zna UI' }], noCycles: true };
  test('normalizuje obiekt i tekst JSON tak samo', () => {
    const a = R.parse(SAMPLE), b = R.parse(JSON.stringify(SAMPLE));
    assert.deepEqual(host(a), host(b));
    assert.deepEqual(host(a), { layers: [{ name: 'ui', match: ['src/ui/**'] }, { name: 'core', match: ['src/core/**', 'lib/*.js'] }], forbid: [{ from: 'core', to: 'ui', why: 'rdzeń nie zna UI' }], noCycles: true, warnings: [] });
  });
  test('zły JSON / kształt → Error; braki i nieznane warstwy → warnings', () => {
    assert.throws(() => R.parse('{ nope'), /\.codemap\.rules\.json/);
    assert.throws(() => R.parse('[1,2]'), /object/);
    assert.throws(() => R.parse(null), /object/);
    const r = R.parse({ layers: [{ name: 'a' }, { match: 'x/**' }, { name: 'b', match: 'b/**' }, { name: 'b', match: 'c/**' }], forbid: [{ from: 'b' }, { from: 'b', to: 'ghost' }, { from: 'b', to: 'z/**' }] });
    assert.deepEqual(host(r.layers.map((l) => l.name)), ['b', 'b']);
    assert.equal(r.forbid.length, 2);
    assert.ok(r.warnings.some((w) => /missing match/.test(w)) && r.warnings.some((w) => /missing name/.test(w)) && r.warnings.some((w) => /duplicated/.test(w)));
    assert.ok(r.warnings.some((w) => /unknown layer "ghost"/.test(w)));
    assert.ok(!r.warnings.some((w) => /"z\/\*\*"/.test(w)), 'a path glob is not reported as an unknown layer');
    assert.equal(R.parse({}).noCycles, false);
  });
});

describe('evaluate', () => {
  const RULES = R.parse({
    layers: [{ name: 'lib', match: 'src/lib/**' }, { name: 'app', match: 'src/app.js' }, { name: 'store', match: 'src/store/**' }],
    forbid: [{ from: 'lib', to: 'app', why: 'biblioteka nie zna aplikacji' }, { from: 'app', to: 'store' }, { from: 'store', to: 'lib' }],
  });
  test('zakazane importy między warstwami; nienaruszone reguły milczą; wynik posortowany', () => {
    const v = R.evaluate(build(), RULES);
    assert.deepEqual(host(v), [
      { from: 'src/app.js', to: 'src/store/index.js', rule: 'forbid:app→store', why: '' },
      { from: 'src/lib/util.js', to: 'src/app.js', rule: 'forbid:lib→app', why: 'biblioteka nie zna aplikacji' },
    ]);
  });
  test('noCycles: jedno naruszenie na cykl, z łańcuchem w why', () => {
    const v = R.evaluate(build(), R.parse({ noCycles: true }));
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, 'noCycles');
    assert.deepEqual(host([v[0].from, v[0].to].sort()), ['src/app.js', 'src/lib/util.js']);
    assert.match(v[0].why, /util\.js → app\.js → util\.js|app\.js → util\.js → app\.js/);
    assert.equal(R.evaluate(build(), R.parse({ noCycles: false })).length, 0);
  });
  test('from/to jako glob ścieżki, gdy nie ma takiej warstwy; pakiet Go jako folder-cel; zewnętrzne pominięte', () => {
    const v = R.evaluate(build(), R.parse({ forbid: [{ from: 'src/index.js', to: 'src/lib/**' }, { from: 'go/cmd/**', to: 'go/pkg/**', why: 'cmd nie sięga do pkg' }, { from: '**', to: 'react' }] }));
    assert.deepEqual(host(v.map((x) => [x.from, x.to, x.rule])), [
      ['go/cmd/main.go', 'go/pkg/util', 'forbid:go/cmd/**→go/pkg/**'],
      ['src/index.js', 'src/lib/util.js', 'forbid:src/index.js→src/lib/**'],
    ]);
    assert.equal(R.evaluate(build(), R.parse({})).length, 0);
    assert.equal(R.evaluate(null, RULES).length, 0);
  });
  test('findRulesNode: najpłytszy .codemap.rules.json z treścią w preview, inaczej null', () => {
    assert.equal(R.findRulesNode(build()), null);
    const g = build([
      { path: 'sub/.codemap.rules.json', content: '{"noCycles":false}', size: 18, mtime: 1 },
      { path: '.codemap.rules.json', content: JSON.stringify({ layers: [{ name: 'lib', match: 'src/lib/**' }], forbid: [{ from: 'lib', to: 'src/app.js' }] }), size: 80, mtime: 1 },
    ]);
    const n = R.findRulesNode(g);
    assert.equal(n.id, '.codemap.rules.json');
    const v = R.evaluate(g, R.parse(n.preview));
    assert.deepEqual(host(v.map((x) => x.from)), ['src/lib/util.js']);
  });
});
