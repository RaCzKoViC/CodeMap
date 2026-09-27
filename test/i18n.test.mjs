import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, memStorage, docStub } from './harness.mjs';

// Słowniki interfejsu PL / EN (js/i18n.js): tłumaczenie z rezerwą, zmiana języka, słowniki modułów, apply() na DOM.
const load = (extra) => loadCM(['util', 'i18n'], extra).i18n;

// element z atrybutami data-i18n*; childNodes: tekst (3) i elementy (1) — jak ikona wstrzyknięta przed etykietą
function node(attrs, kids = []) {
  const e = { attrs, childNodes: kids, textContent: '', innerHTML: '', title: '', placeholder: '',
    getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; },
    appendChild: (c) => { e.childNodes.push(c); return c; } };
  return e;
}
const textNode = (t) => { const n = { nodeType: 3, nodeValue: t, remove: () => { n.removed = true; } }; return n; };
function root(els) {
  const sel = { '[data-i18n]': 'data-i18n', '[data-i18n-html]': 'data-i18n-html', '[data-i18n-title]': 'data-i18n-title',
    '[data-i18n-aria]': 'data-i18n-aria', '[data-i18n-ph]': 'data-i18n-ph' };
  return { querySelectorAll: (s) => els.filter((e) => sel[s] in e.attrs) };
}

describe('t(): klucz → tekst', () => {
  test('bieżący język, rezerwa PL dla braków w EN, potem fallback, na końcu sam klucz', () => {
    const I = load();
    assert.equal(I.getLang(), 'pl');
    assert.equal(I.t('load.btn'), 'Wczytaj');
    I.extend('pl', { 'tylko.pl': 'Tylko po polsku' });
    I.setLang('en');
    assert.equal(I.t('load.btn'), 'Load');
    assert.equal(I.t('tylko.pl'), 'Tylko po polsku');
    assert.equal(I.t('nie.ma', 'domyślny'), 'domyślny');
    assert.equal(I.t('nie.ma'), 'nie.ma');
    assert.equal(I.t('nie.ma', ''), '', 'pusty fallback to też fallback (nie klucz)');
  });
  test('extend dopisuje do istniejącego słownika; nieznany język i brak obiektu są ignorowane', () => {
    const I = load();
    I.extend('en', { 'x.key': 'X' }); I.extend('de', { 'x.key': 'Y' }); I.extend('pl', null);
    I.setLang('en');
    assert.equal(I.t('x.key'), 'X');
    assert.deepEqual([...I.langs], ['pl', 'en']);
  });
});

describe('setLang / getLang / onChange', () => {
  test('tylko pl|en; zapis w localStorage; słuchacze wołani z językiem, wyjątek jednego nie psuje reszty', () => {
    const ls = memStorage();
    const I = load({ localStorage: ls });
    const seen = [];
    I.onChange(() => { throw new Error('zły słuchacz'); });
    I.onChange((l) => seen.push(l));
    I.setLang('de');
    assert.equal(I.getLang(), 'pl'); assert.deepEqual(seen, []);
    assert.equal(ls.getItem('codemap_lang'), null);
    I.setLang('en');
    assert.equal(I.getLang(), 'en'); assert.deepEqual(seen, ['en']);
    assert.equal(ls.getItem('codemap_lang'), 'en');
  });
  test('język przywracany przy ładowaniu z localStorage; śmieci ignorowane', () => {
    const ls = memStorage(); ls.setItem('codemap_lang', 'en');
    assert.equal(load({ localStorage: ls }).getLang(), 'en');
    const bad = memStorage(); bad.setItem('codemap_lang', 'fr');
    assert.equal(load({ localStorage: bad }).getLang(), 'pl');
  });
  test('setLang ustawia <html lang> i tytuł dokumentu', () => {
    const doc = docStub();
    const I = load({ document: doc });
    I.setLang('en');
    assert.equal(doc.documentElement.lang, 'en');
    assert.equal(doc.title, I.t('app.title'));
    I.setLang('pl');
    assert.equal(doc.title, 'CodeMap — Kartografia Kodu');
  });
});

describe('apply(root): atrybuty data-i18n*', () => {
  test('tekst, HTML, title, aria-label, placeholder', () => {
    const I = load();
    const a = node({ 'data-i18n': 'load.btn' });
    const h = node({ 'data-i18n-html': 'load.btn' });
    const ti = node({ 'data-i18n-title': 'load.btn' });
    const ar = node({ 'data-i18n-aria': 'load.btn' });
    const ph = node({ 'data-i18n-ph': 'nie.ma.klucza' });
    I.apply(root([a, h, ti, ar, ph]));
    assert.equal(a.textContent, 'Wczytaj');
    assert.equal(h.innerHTML, 'Wczytaj');
    assert.equal(ti.title, 'Wczytaj');
    assert.equal(ar.attrs['aria-label'], 'Wczytaj');
    assert.equal(ph.placeholder, 'nie.ma.klucza');
  });
  test('element z ikoną: ikona zostaje, stary tekst usunięty, nowy dopisany po spacji', () => {
    const I = load();
    const icon = { nodeType: 1 }, old = textNode('Stary');
    const e = node({ 'data-i18n': 'load.btn' }, [icon, old]);
    I.setLang('en');
    I.apply(root([e]));
    assert.equal(old.removed, true);
    assert.equal(e.childNodes[0], icon);
    assert.equal(e.childNodes.at(-1).textContent, ' Load');
    assert.equal(e.textContent, '', 'textContent nietknięty (ikona by zniknęła)');
  });
});
