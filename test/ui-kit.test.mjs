import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Wspólne klocki UI (js/ui-kit.js): pigułka postępu z anulowaniem, okno dialogowe, token hostingu, indeks plików.
function load(extra = {}) {
  const doc = miniDocument();
  const CM = loadCM(['util', 'ui-kit'], { document: doc, ...extra });
  return { K: CM.UIKit, doc, CM };
}

describe('pill: pigułka postępu', () => {
  test('show tworzy jedną pigułkę w #toast-wrap i podmienia tekst; × woła anulowanie; hide usuwa', async () => {
    const { K, doc } = load();
    let cancelled = 0;
    const p = K.pill('Anuluj analizę', () => cancelled++);
    assert.equal(p.visible, false);
    p.show('Krok 1'); p.show('Krok 2');
    const wrap = doc.getElementById('toast-wrap');
    assert.equal(wrap.children.length, 1);
    assert.equal(wrap.querySelector('.gp-t').textContent, 'Krok 2');
    const x = wrap.querySelector('.gp-x');
    assert.equal(x.getAttribute('aria-label'), 'Anuluj analizę');
    x.click();
    assert.equal(cancelled, 1);
    p.hide();
    assert.equal(p.visible, false);
    await new Promise((r) => setTimeout(r, 320));
    assert.equal(wrap.children.length, 0, 'usunięta po animacji');
  });
  test('bez funkcji anulowania — bez przycisku ×; istniejący #toast-wrap jest używany', () => {
    const { K, doc } = load();
    const wrap = doc.createElement('div'); wrap.id = 'toast-wrap'; doc.body.appendChild(wrap);
    const p = K.pill(); p.show('x');
    assert.equal(doc.querySelectorAll('#toast-wrap').length, 1);
    assert.equal(wrap.querySelector('.gp-x'), null);
  });
});

describe('modal: okno dialogowe', () => {
  test('tworzy raz (id części z prefiksu), title / clear / open / close; Esc i klik w tło zamykają', () => {
    const { K, doc } = load();
    const m = K.modal('modal-x', 'my-modal', 'mx');
    assert.equal(m.el.getAttribute('aria-labelledby'), 'mx-title');
    assert.ok(m.el.querySelector('.my-modal'));
    assert.equal(m.body.id, 'mx-body'); assert.equal(m.foot.id, 'mx-foot');
    m.title('Tytuł').open();
    assert.equal(doc.getElementById('mx-title').textContent, 'Tytuł');
    assert.equal(m.el.classList.contains('hidden'), false);
    m.body.appendChild(doc.createElement('p')); m.foot.innerHTML = '<b>x</b>';
    m.clear();
    assert.equal(m.body.children.length, 0); assert.equal(m.foot.innerHTML, '');
    m.el.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(m.el.classList.contains('hidden'), true);
    m.open(); m.el.dispatchEvent({ type: 'mousedown', target: m.el });
    assert.equal(m.el.classList.contains('hidden'), true);
    m.open(); m.el.dispatchEvent({ type: 'mousedown', target: m.body });
    assert.equal(m.el.classList.contains('hidden'), false, 'klik w treść nie zamyka');
    const again = K.modal('modal-x', 'my-modal', 'mx');
    assert.equal(again.el, m.el);
    assert.equal(doc.querySelectorAll('#modal-x').length, 1);
  });
  test('przycisk ✕ zamyka; domyślny prefiks = id okna, domyślna klasa share-modal', () => {
    const { K } = load();
    const m = K.modal('modal-y').open();
    assert.equal(m.body.id, 'modal-y-body');
    assert.ok(m.el.querySelector('.share-modal'));
    m.el.querySelector('.modal-x').click();
    assert.equal(m.el.classList.contains('hidden'), true);
  });
});

describe('repoToken i fileIndex', () => {
  test('token z pola #gh-token (przycięty), potem z pamięci karty, inaczej undefined', () => {
    const { K, doc, CM } = load();
    assert.equal(K.repoToken(), undefined);
    CM.App = { state: { _ghToken: 'zapamietany' } };
    assert.equal(K.repoToken(), 'zapamietany');
    const inp = doc.createElement('input'); inp.id = 'gh-token'; inp.value = '  ghp_abc  '; doc.body.appendChild(inp);
    assert.equal(K.repoToken(), 'ghp_abc');
    inp.value = '   ';
    assert.equal(K.repoToken(), 'zapamietany');
  });
  test('fileIndex: tylko pliki z ścieżką z projektu bazowego; brak grafu → pusta mapa', () => {
    const { K } = load();
    const nodes = [
      { id: 'a', type: 'file', path: 'src/a.js' }, { id: 'b', type: 'file', path: 'src/b.js', gid: 'base' },
      { id: 'g1:a', type: 'file', path: 'src/a.js', gid: 'g1' }, { id: 'src', type: 'folder', path: 'src' }, { id: 'x', type: 'file' }];
    const m = K.fileIndex({ nodes: new Map(nodes.map((n) => [n.id, n])) });
    assert.deepEqual(host([...m.keys()]), ['src/a.js', 'src/b.js']);
    assert.equal(m.get('src/a.js').id, 'a');
    assert.equal(K.fileIndex(null).size, 0);
  });
});
