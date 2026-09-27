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
