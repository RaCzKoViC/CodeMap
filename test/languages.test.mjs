import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

// Rejestr typów plików (js/languages.js): rozszerzenia, nazwy specjalne, pliki z kropką, zgadywanie kategorii.
const CM = loadCM(['util', 'i18n', 'languages']);
const L = CM.languages;
const pick = (name) => { const i = L.lookup(name); return [i.key, i.cat, i.text]; };

describe('lookup: rozszerzenia i nazwy specjalne', () => {
  test('znane rozszerzenia (także wielkie litery i ścieżka) → klucz, kategoria, tekst', () => {
    assert.deepEqual(pick('src/App.JSX'), ['jsx', 'code', true]);
    assert.deepEqual(pick('a/b/c.test.ts'), ['ts', 'code', true]);
    assert.deepEqual(pick('logo.png'), ['png', 'image', false]);
    assert.deepEqual(pick('archive.tar.gz'), ['gz', 'archive', false]);   // ostatnie rozszerzenie
    const js = L.lookup('x.js');
    assert.equal(js.name, 'JavaScript'); assert.match(js.color, /^#[0-9a-f]{6}$/i);
  });
  test('nazwy całe: Dockerfile, Makefile, package.json, Gemfile — także w podkatalogu', () => {
    assert.deepEqual(pick('Dockerfile'), ['dockerfile', 'config', true]);
    assert.deepEqual(pick('deploy/Dockerfile'), ['dockerfile', 'config', true]);
    assert.deepEqual(pick('GNUmakefile'), ['makefile', 'config', true]);
    assert.equal(L.lookup('package-lock.json').key, 'json');
    assert.equal(L.lookup('Gemfile').name, 'Ruby');
  });
  test('regresja: LICENSE / README / CHANGELOG bez rozszerzenia to tekst, nie dokument Worda', () => {
    for (const n of ['LICENSE', 'README', 'CHANGELOG', 'docs/AUTHORS', 'NOTICE', 'COPYING', 'CONTRIBUTING', 'CODE_OF_CONDUCT']) {
      const i = L.lookup(n);
      assert.equal(i.text, true, n + ': treść ma być czytana');
      assert.notEqual(i.name, 'Word', n);
      assert.equal(i.cat, 'doc', n);
    }
    assert.equal(L.lookup('raport.doc').name, 'Word');   // prawdziwy .doc bez zmian (binarny)
    assert.equal(L.lookup('raport.doc').text, false);
  });
  test('regresja: go.mod / go.sum to konfiguracja, nie kod w języku Modula', () => {
    assert.deepEqual(host(pick('go.mod')), ['ini', 'config', true]);
    assert.deepEqual(host(pick('service/go.sum')), ['lock', 'config', true]);
    assert.equal(L.lookup('lib.mod').name, 'Modula');   // samo rozszerzenie .mod nadal Modula
  });
});

describe('lookup: pliki z kropką, bez rozszerzenia i nieznane', () => {
  test('dotfile bez rozszerzenia → konfiguracja z nazwą pliku jako kluczem; zwykły plik bez rozszerzenia → „other"', () => {
    const i = L.lookup('.gitignore');
    assert.deepEqual([i.key, i.name, i.cat, i.text], ['.gitignore', '.gitignore', 'config', true]);
    assert.equal(L.lookup('.weirdrc').cat, 'config');
    const o = L.lookup('bin/run');
    assert.deepEqual([o.key, o.cat, o.text], ['other', 'other', true]);
    assert.equal(o.color, L.CAT.other);
  });
  test('nieznane rozszerzenie: kategoria zgadywana, kolor deterministyczny, binaria bez treści', () => {
    const a = L.lookup('x.zzq'), b = L.lookup('y.ZZQ');
    assert.equal(a.key, 'zzq'); assert.equal(a.name, 'ZZQ'); assert.equal(a.color, b.color);
    assert.match(a.color, /^hsl\(\d+,58%,58%\)$/);
    assert.deepEqual(pick('shot.heicx'), ['heicx', 'image', false]);
    assert.deepEqual(pick('pkg.debx'), ['debx', 'archive', false]);
    assert.deepEqual(pick('view.tmplx'), ['tmplx', 'web', true]);
    assert.deepEqual(pick('weird.qqv'), ['qqv', 'other', true]);
    assert.equal(L.lookup('conf.myconfig').cat, 'config');
  });
});

describe('kolory kategorii i glify', () => {
  test('catColor: znana kategoria i domyślna dla nieznanej', () => {
    assert.equal(L.catColor('code'), L.CAT.code);
    assert.equal(L.catColor('nie-ma'), L.CAT.other);
  });
  test('glyph: symbole dla obrazów / mediów / archiwów / binariów, inaczej pierwsza litera nazwy', () => {
    assert.equal(L.glyph({ cat: 'image' }), '🖼');
    assert.equal(L.glyph({ cat: 'media' }), '♪');
    assert.equal(L.glyph({ cat: 'archive' }), '🗜');
    assert.equal(L.glyph({ cat: 'binary' }), '⬡');
    assert.equal(L.glyph({ cat: 'code', name: 'python' }), 'P');
    assert.equal(L.glyph({ cat: 'code' }), '?');
  });
});
