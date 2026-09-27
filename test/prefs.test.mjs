import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

// Wersjonowanie bloba ustawień `codemap_settings` (js/prefs.js).
const CM = loadCM(['util', 'prefs']);
const P = CM.Prefs;
const O = { ids: ['rng-trans', 'sel-layout', 'opt-grid'], layouts: ['pack', 'treemap', 'force'], defaultLayout: 'pack' };

describe('migracja ustawień', () => {
  test('v1 (bez numeru): _menuTint → _menuRgb, usunięty układ → pack, pola po usuniętych kontrolkach wypadają', () => {
    const m = host(P.migrate({ _menuTint: '14,19,28', 'sel-layout': 'honeycomb', 'rng-trans': '40', 'opt-glow': true, _theme: 'dark' }, O));
    assert.deepEqual(m, { _menuRgb: '14,19,28', 'sel-layout': 'pack', 'rng-trans': '40', _theme: 'dark', _v: P.VERSION });
  });
  test('bieżąca wersja bez zmian (idempotentne); zły motyw usunięty; nie-obiekt → null', () => {
    const cur = { 'sel-layout': 'treemap', 'opt-grid': false, _menuRgb: '1,2,3', _v: P.VERSION };
    assert.ok(P.same(host(P.migrate(cur, O)), cur));
    assert.ok(P.same(host(P.migrate(P.migrate(cur, O), O)), cur));
    assert.equal(P.migrate({ _theme: 'neon' }, O)._theme, undefined);
    assert.equal(P.migrate(null, O), null); assert.equal(P.migrate([1], O), null); assert.equal(P.migrate('x', O), null);
  });
  test('istniejące _menuRgb nie jest nadpisywane starym _menuTint', () => {
    assert.equal(P.migrate({ _menuTint: '0,0,0', _menuRgb: '9,9,9' }, O)._menuRgb, '9,9,9');
  });
});
