// CM.PRReview — łatki → hunki → widok przed/po; prompt przeglądu PR z mapą wpływu i fragmentami [n] w budżecie.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';

const CM = loadCM([...CORE, 'testmap', 'git-core', 'pr-core', 'pr-review']);
const R = CM.PRReview;
const F = (path, content) => ({ path, content, size: content.length, mtime: 1 });
const PATCH = '@@ -1,4 +1,5 @@ export function total(items)\n export function total(items) {\n-  let s = 0;\n+  let s = 0, n = 0;\n+  if (!items) return 0;\n   for (const i of items) s += i;\n   return s;\n\\ No newline at end of file\n@@ -20,2 +21,2 @@\n-const OLD = 1;\n+const NEW = 2;\n keep();';

describe('PRReview: łatki', () => {
  test('parsePatch: nagłówki hunków, numery linii przed/po, pomija „\\ No newline"', () => {
    const h = host(R.parsePatch(PATCH));
    assert.equal(h.length, 2);
    assert.deepEqual([h[0].oldStart, h[0].newStart, h[0].header], [1, 1, 'export function total(items)']);
    assert.deepEqual(h[0].lines.map((l) => l.t + (l.o ?? '·') + '/' + (l.n ?? '·')), [' 1/1', '-2/·', '+·/2', '+·/3', ' 3/4', ' 4/5']);
    assert.deepEqual(h[1].lines.map((l) => l.t + (l.o ?? '·') + '/' + (l.n ?? '·')), ['-20/·', '+·/21', ' 21/22']);
  });
  test('sideBySide: kontekst po obu stronach, usunięcie i dodanie sparowane, nadmiar dodań sam po prawej', () => {
    const rows = host(R.sideBySide(R.parsePatch(PATCH)[0]));
    assert.deepEqual(rows.map((r) => r.kind), ['ctx', 'change', 'add', 'ctx', 'ctx']);
    assert.deepEqual([rows[1].left, rows[1].right], [{ n: 2, text: '  let s = 0;' }, { n: 2, text: '  let s = 0, n = 0;' }]);
    assert.equal(rows[2].left, null);
  });
});

describe('PRReview: prompt', () => {
  const g = new CM.Graph.Graph().build([
    F('src/cart.js', 'export function total(items) {\n  let s = 0;\n  for (const i of items) s += i;\n  return s;\n}\n'),
    F('src/app.js', "import { total } from './cart.js';\nexport const t = total([1]);\n"),
    F('test/app.test.js', "import { t } from '../src/app.js';\n"),
  ], { name: 't' });
  CM.TestMap.mapTests(g);
  const res = CM.PRCore.analyze(g, [{ path: 'src/cart.js', status: 'M', add: 3, del: 1 }, { path: 'docs/new.md', status: 'A', add: 10, del: 0 }], { author: { login: 'ala' } });
  const pi = { number: 7, title: 'Suma z pustą listą', author: { login: 'ala' }, base: 'main', head: 'fix', risk: res.risk, level: res.level, changed: res.changed, outside: res.outside,
    impacted: [...res.impacted.entries()], direct: res.direct, reviewers: res.reviewers, add: res.add, del: res.del };
  test('z łatkami: nagłówek z ryzykiem, pliki z powodami, fragmenty [n] jako diff, źródła z liniami po zmianie', () => {
    const p = R.prompt(g, pi, new Map([['src/cart.js', PATCH]]), { lang: 'pl', local: true });
    assert.match(p.user, /^Zrecenzuj ten PR\.\n\nPR #7 „Suma z pustą listą" — autor @ala — main ← fix · ryzyko /);
    assert.match(p.user, /- src\/cart\.js \(M, \+3\/−1, \d+\/100/);
    assert.match(p.user, /zależnych: 1, bez testów\)/);
    assert.match(p.user, /Spoza mapy \(nowe albo pominięte\): docs\/new\.md \(A\)/);
    assert.match(p.user, /\[1\] src\/cart\.js @@ -1 \+1 @@ export function total\(items\)\n```diff\n export function total/);
    assert.deepEqual(host(p.sources), [{ n: 1, id: 'src/cart.js', path: 'src/cart.js', start: 1, end: 5 }, { n: 2, id: 'src/cart.js', path: 'src/cart.js', start: 21, end: 22 }]);
    assert.equal(p.patches, true);
    assert.match(p.sys, /## Ryzyka/);
  });
  test('bez łatek → fragmenty bieżącej treści; budżet ucina; angielski', () => {
    const p = R.prompt(g, pi, null, { lang: 'en', budget: 30 });
    assert.equal(p.patches, false);
    assert.match(p.user, /Excerpts of the changed files \(no diff — patches unavailable\):\n\[1\] src\/cart\.js:1-/);
    assert.equal(p.sources.length, 1);
    assert.ok(p.user.split('```')[1].length <= 32);
    assert.equal(R.prompt(g, null), null);
  });
});
