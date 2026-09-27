import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { countOf, strings, CliError } from '../cli/strings.mjs';

// Teksty CLI (cli/strings.mjs): odmiana przez liczbę (PL: 1 / 2–4 poza 12–14 / reszta), podstawienia, rezerwa PL.

describe('countOf — odmiana', () => {
  test('polski: 1 commit, 2–4 commity, 5+ i 12–14 commitów, 22 commity, 112 commitów', () => {
    const c = (n) => countOf('pl', n, 'commits');
    assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 104, 112, 1000].map(c),
      ['1 commit', '2 commity', '4 commity', '5 commitów', '11 commitów', '12 commitów', '14 commitów', '21 commitów', '22 commity',
        '25 commitów', '104 commity', '112 commitów', '1000 commitów']);
    assert.equal(countOf('pl', 0, 'tests'), '0 plików testowych');
    assert.equal(countOf('pl', 3, 'findings'), '3 znaleziska');
    assert.equal(countOf('pl', 2, 'authors'), '2 autorów');
  });
  test('angielski: 1 / reszta; sformatowana liczba jako tekst; nieznany klucz → sama liczba; nieznany język → PL', () => {
    assert.equal(countOf('en', 1, 'authors'), '1 author');
    assert.equal(countOf('en', 0, 'findings'), '0 findings');
    assert.equal(countOf('en', 1234, 'commits', '1,234'), '1,234 commits');
    assert.equal(countOf('pl', 5, 'nie-ma', '5'), '5');
    assert.equal(countOf('de', 3, 'commits'), '3 commity');
  });
});

describe('strings — tłumacz', () => {
  test('podstawienia (także powtórzone), rezerwa PL, nieznany klucz → sam klucz', () => {
    const pl = strings('pl'), en = strings('en');
    assert.equal(pl('failSev', { n: 3, sev: 'high' }), '3 o ważności ≥ high (--fail-on high)');
    assert.equal(en('eDir', { p: '/x' }), 'directory does not exist: /x');
    assert.equal(strings('xx')('none'), 'brak');
    assert.equal(en('nie.ma'), 'nie.ma');
    assert.equal(pl('title', { v: '1.4.0', name: '$&' }), 'CodeMap 1.4.0 — analiza: $&', 'wartość nie jest wzorcem zamiany');
  });
  test('komunikaty z podstawieniami: EN istnieje i ma te same zmienne {…} co PL', () => {
    const src = { pl: {}, en: {} };
    for (const k of ['help', 'filesVal', 'capNote', 'gitVal', 'gitTrunc', 'testsVal', 'covVal', 'timeVal', 'failScore', 'failSev', 'failRule',
      'failMax', 'failDrop', 'prVal', 'blVal', 'eCmd', 'eOpt', 'eVal', 'eNum', 'eLang', 'eFmt', 'eFail', 'eArgs', 'eDir', 'eCovFile', 'wCovBad', 'wCovNone', 'wGit', 'wSymlinks', 'folderNote']) {
      src.pl[k] = [...strings('pl')(k).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      src.en[k] = [...strings('en')(k).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.notEqual(strings('en')(k), k, 'brak EN: ' + k);
    }
    assert.deepEqual(src.en, src.pl);
  });
  test('CliError: nazwa i komunikat (kod wyjścia 2 w codemap.mjs)', () => {
    const e = new CliError('zła opcja');
    assert.ok(e instanceof Error); assert.equal(e.name, 'CliError'); assert.equal(e.message, 'zła opcja');
  });
});
