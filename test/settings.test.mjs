import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, docStub } from './harness.mjs';

// Okno Ustawień bez przeglądarki: rejestr zakładek (kolejność niezależna od kolejności ładowania modułów),
// słowniki PL/EN, wbudowana dokumentacja i render każdej zakładki na stubach DOM z cli/runtime.mjs.
const MODS = ['util', 'icons', 'i18n', 'settings-strings', 'settings', 'settings-ai', 'settings-docs'];
const KEYS = ['lang', 'account', 'appearance', 'ai', 'install', 'shortcuts', 'tutorial', 'spec', 'manual', 'about'];

/** Stub dokumentu, w którym innerHTML = '' czyści dzieci (jak w przeglądarce) — wtedy zawartość
 *  po open(klucz) to dokładnie ta jedna zakładka. */
function dom() {
  const doc = docStub(), make = doc.createElement;
  doc.createElement = (tag) => {
    const e = make(tag); e.tagName = String(tag).toUpperCase();
    let html = '';
    Object.defineProperty(e, 'innerHTML', { get: () => html, set: (v) => { html = v; e.children.length = 0; } });
    return e;
  };
  return doc;
}
function load(mods = MODS) {
  const doc = dom();
  return { CM: loadCM(mods, { document: doc }), doc };
}
const byTag = (c, tag) => c.children.filter((e) => e.tagName === tag);

describe('rejestr zakładek', () => {
  test('wszystkie klucze w stałej kolejności; publiczne API zgodne', () => {
    const { CM } = load();
    assert.deepEqual(host(CM.Settings.tabs()), KEYS);
    for (const f of ['open', 'close', 'wire', 'startTutorial', 'isTourActive', 'addTab']) assert.equal(typeof CM.Settings[f], 'function', f);
    assert.equal(CM.Settings.isTourActive(), false);
  });
  test('kolejność nie zależy od kolejności ładowania modułów; nieznana zakładka trafia na koniec', () => {
    const { CM } = load(['util', 'icons', 'i18n', 'settings-strings', 'settings', 'settings-docs', 'settings-ai']);
    assert.deepEqual(host(CM.Settings.tabs()), KEYS);
    CM.Settings.addTab('extra', 'info', () => {});
    assert.deepEqual(host(CM.Settings.tabs()), [...KEYS, 'extra']);
  });
  test('bez modułów zakładek rdzeń pokazuje tylko własne zakładki', () => {
    const { CM } = load(['util', 'icons', 'i18n', 'settings-strings', 'settings']);
    assert.deepEqual(host(CM.Settings.tabs()), KEYS.filter((k) => !['ai', 'spec', 'manual'].includes(k)));
  });
});

describe('teksty PL / EN', () => {
  test('oba słowniki mają ten sam zestaw kluczy; każda zakładka ma tytuł', () => {
    const { CM } = load();
    const S = CM.SettingsStrings, pl = Object.keys(S.pl), en = Object.keys(S.en);
    assert.deepEqual(en.filter((k) => !(k in S.pl)), []);
    assert.deepEqual(pl.filter((k) => !(k in S.en)), []);
    for (const k of KEYS) assert.ok(S.pl['tab.' + k] && S.en['tab.' + k], k);
  });
  test('kit.t: bieżący język, brak klucza → sam klucz', () => {
    const { CM } = load();
    const t = CM.Settings.kit.t;
    assert.equal(t('title'), 'Ustawienia');
    CM.i18n.setLang('en');
    assert.equal(t('title'), 'Settings');
    assert.equal(t('nie.ma.takiego'), 'nie.ma.takiego');
  });
});

describe('dokumentacja wbudowana', () => {
  test('PL i EN mają tyle samo rozdziałów; renderDoc: nagłówek jako tekst, treść jako HTML', () => {
    const { CM, doc } = load();
    const D = CM.SettingsDocs.DOCS;
    for (const kind of ['spec', 'manual']) {
      assert.equal(D.pl[kind].length, D.en[kind].length, kind);
      for (const lang of ['pl', 'en']) for (const [h, body] of D[lang][kind]) assert.ok(typeof h === 'string' && h && typeof body === 'string' && body, lang + ' ' + kind);
    }
    const c = doc.createElement('div');
    CM.SettingsDocs.renderDoc(c, D.pl.manual);
    assert.equal(c.children.length, D.pl.manual.length * 2);
    assert.equal(c.children[0].tagName, 'H4');
    assert.equal(c.children[0].className, 'set-doc-h');
    assert.equal(c.children[0].textContent, D.pl.manual[0][0]);
    assert.equal(c.children[1].className, 'set-doc-p');
    assert.equal(c.children[1].innerHTML, D.pl.manual[0][1]);
  });
});

describe('render zakładek (stub DOM)', () => {
  for (const lang of ['pl', 'en']) {
    test(`każda zakładka renderuje treść bez wyjątku — ${lang}`, () => {
      const { CM, doc } = load();
      CM.i18n.setLang(lang);
      const t = CM.Settings.kit.t;
      for (const key of KEYS) {
        CM.Settings.open(key);
        const overlay = doc.body.children[0];
        const nav = overlay.children[0].children[1].children[0];
        assert.deepEqual(nav.children.map((b) => b.getAttribute('data-tab')), KEYS);
        const c = overlay._content;
        assert.ok(c.children.length > 1, key + ': pusta zakładka');
        const heads = byTag(c, 'H3').map((h) => h.textContent).filter(Boolean);
        assert.ok(heads.length >= 1, key + ': brak nagłówka');
        if (key === 'spec' || key === 'manual') {
          assert.equal(heads[0], t('tab.' + key));
          assert.equal(byTag(c, 'H4').length, CM.SettingsDocs.DOCS[lang][key].length);
        }
      }
      assert.equal(byTag(overlay_(doc)._content, 'H3')[0].textContent, t('about.head'));
      CM.Settings.close();
    });
  }
  test('nieznany klucz → zakładka „Język” (jak dotąd)', () => {
    const { CM, doc } = load();
    CM.Settings.open('nie-ma');
    assert.equal(byTag(overlay_(doc)._content, 'H3')[0].textContent, CM.Settings.kit.t('lang.head'));
  });
  test('wire(): moduł AI czyta aktualne handlery (analiza bez projektu)', async () => {
    const { CM, doc } = load();
    let asked = 0;
    CM.Settings.wire({ aiHasProject: () => { asked++; return false; } });
    CM.Settings.open('ai');
    const c = overlay_(doc)._content;
    const btn = c.children.find((e) => e.tagName === 'BUTTON' && /set-mt/.test(e.className));
    const out = c.children[c.children.indexOf(btn) + 1];
    assert.ok(btn && out, 'przycisk analizy');
    await btn.onclick();   // handler przypisany jako właściwość onclick (nie przez el())
    assert.equal(asked, 1);
    assert.equal(out.textContent, CM.Settings.kit.t('ai.noProject'));
  });
});

function overlay_(doc) { return doc.body.children[0]; }
