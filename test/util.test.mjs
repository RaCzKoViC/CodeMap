import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

const CM = loadCM(['util']);
const U = CM.util;

describe('util', () => {
  test('CM.VERSION jest semver i zgadza się z package.json', async () => {
    const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
    assert.match(CM.VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(CM.VERSION, pkg.version);
  });
  test('hashString: deterministyczny, różny dla różnych treści, hex', () => {
    assert.equal(U.hashString('abc'), U.hashString('abc'));
    assert.notEqual(U.hashString('abc'), U.hashString('abd'));
    assert.match(U.hashString(''), /^[0-9a-f]+$/);
  });
  test('clamp / lerp / dist2', () => {
    assert.equal(U.clamp(5, 0, 3), 3);
    assert.equal(U.clamp(-1, 0, 3), 0);
    assert.equal(U.lerp(0, 10, 0.25), 2.5);
    assert.equal(U.dist2(0, 0, 3, 4), 25);
  });
  test('fmtBytes / fmtNum zwracają czytelne stringi', () => {
    assert.equal(typeof U.fmtBytes(0), 'string');
    assert.ok(/KB|kB|KiB/i.test(U.fmtBytes(2048)));
    assert.ok(/MB|MiB/i.test(U.fmtBytes(5 * 1024 * 1024)));
    assert.equal(typeof U.fmtNum(1234567), 'string');
  });
  test('hexToRgb parsuje #rrggbb, colorFromString jest stabilne', () => {
    assert.deepEqual(host(U.hexToRgb('#ff8000')), [255, 128, 0]);
    assert.deepEqual(host(U.hexToRgb('#f80')), [255, 136, 0]);
    assert.equal(U.colorFromString('src/x.js'), U.colorFromString('src/x.js'));
    assert.equal(typeof U.colorFromString('a'), 'string');
  });
  test('debounce i throttle zwracają funkcje', () => {
    assert.equal(typeof U.debounce(() => {}, 10), 'function');
    assert.equal(typeof U.throttle(() => {}, 10), 'function');
  });
  test('matchPath: pełna ścieżka > końcówka > nazwa > fragment; ./ i \\ normalizowane; pusto → null', () => {
    const nodes = [{ path: 'lib/util.js', name: 'util.js' }, { path: 'src/util.js', name: 'util.js' }, { path: 'src/app.js', name: 'app.js' }];
    assert.equal(U.matchPath(nodes, 'src/util.js').path, 'src/util.js');
    assert.equal(U.matchPath(nodes, '.\\src\\util.js').path, 'src/util.js');
    assert.equal(U.matchPath(nodes, 'util.js').path, 'lib/util.js', 'remis → pierwszy w kolejności');
    assert.equal(U.matchPath(nodes, 'APP').path, 'src/app.js');
    assert.equal(U.matchPath(nodes, 'brak'), null);
    assert.equal(U.matchPath(nodes, '  '), null);
  });
  test('matchNode: nazwa > początek > fragment > ścieżka; bez __root__/__ext__; only, exactPath, preferFile', () => {
    const nodes = [{ id: '__root__', name: 'app', type: 'folder' }, { id: 'd', name: 'app', type: 'folder', path: 'app' },
      { id: 'f', name: 'app', type: 'file', path: 'src/app' }, { id: 's', name: 'apply', type: 'symbol', path: 'src/x.js' },
      { id: 'u', name: 'myapp.js', type: 'file', path: 'lib/myapp.js' }];
    assert.equal(U.matchNode(nodes, 'APP ').id, 'd', 'remis → pierwszy (bez __root__)');
    assert.equal(U.matchNode(nodes, 'app', { preferFile: true }).id, 'f', 'remis → plik');
    assert.equal(U.matchNode(nodes, 'src/app', { exactPath: 110 }).id, 'f');
    assert.equal(U.matchNode(nodes, 'appl').id, 's');
    assert.equal(U.matchNode(nodes, 'appl', { only: (n) => n.type !== 'symbol' }), null);
    assert.equal(U.matchNode(nodes, 'myapp').id, 'u');
    assert.equal(U.matchNode(nodes, 'lib/').id, 'u', 'fragment ścieżki');
    assert.equal(U.matchNode(nodes, ''), null);
  });
  test('lsSet / lsDel / lsJSON: zapis, domyślna wartość przy braku klucza i złym JSON, brak wyjątku bez dostępu', () => {
    assert.equal(U.lsSet('t_ls', JSON.stringify({ a: 1 })), true);
    assert.deepEqual(host(U.lsJSON('t_ls', null)), { a: 1 });
    assert.deepEqual(host(U.lsJSON('t_brak', [])), []);
    U.lsSet('t_zly', '{nie json');
    assert.equal(U.lsJSON('t_zly', 7), 7);
    U.lsSet('t_pusty', '');
    assert.deepEqual(host(U.lsJSON('t_pusty', {})), {});
    assert.equal(U.lsDel('t_ls'), true);
    assert.equal(U.lsJSON('t_ls', 'def'), 'def');
    // tryb prywatny / zablokowane dane witryny: każde wywołanie localStorage rzuca
    const boom = () => { throw new Error('SecurityError'); };
    const Ux = loadCM(['util'], { localStorage: { getItem: boom, setItem: boom, removeItem: boom } }).util;
    assert.equal(Ux.lsSet('k', 'v'), false);
    assert.equal(Ux.lsDel('k'), false);
    assert.equal(Ux.lsJSON('k', 3), 3);
  });
});

describe('escapowanie HTML (jedno źródło)', () => {
  test('escapeHtml: & < > " \' — bezpieczne w tekście i atrybutach; null → pusty napis', () => {
    assert.equal(CM.util.escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(CM.util.escapeHtml(null), '');
    assert.equal(CM.util.escapeHtml(42), '42');
  });
  test('escapeText: tylko & < > (cudzysłowy zostają dla kolorowania składni)', () => {
    assert.equal(CM.util.escapeText('if (a < b && s === "x") {}'), 'if (a &lt; b &amp;&amp; s === "x") {}');
  });
});
