import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

// Galeria przykładowych repozytoriów: dane i link #repo= (okno tylko w przeglądarce — tu nie jest budowane).
const CM = loadCM(['util', 'deeplink', 'gallery']);
const G = CM.Gallery, DL = CM.DeepLink;

describe('galeria przykładów', () => {
  test('każdy przykład daje poprawny deep-link #repo= (z podkatalogiem, gdy jest), unikalne repozytoria, 7 języków', () => {
    assert.ok(G.ITEMS.length >= 8);
    assert.equal(new Set(G.ITEMS.map((i) => i.repo)).size, G.ITEMS.length);
    assert.ok(new Set(G.ITEMS.map((i) => i.lang)).size >= 7);
    for (const it of G.ITEMS) {
      const r = host(DL.parseHash(G.hashFor(it)));
      assert.equal(r.kind, 'repo', it.repo);
      assert.equal(r.spec.repo, it.repo); assert.equal(r.spec.host, 'github');
      assert.equal(r.spec.sub || '', it.path || '');
      assert.ok(it.pl && it.en && it.files > 0);
    }
  });
  test('wyszukiwanie po pełnej nazwie, samej nazwie repozytorium albo fragmencie; brak → null', () => {
    assert.equal(G.find('pallets/flask').repo, 'pallets/flask');
    assert.equal(G.find('gin').repo, 'gin-gonic/gin');
    assert.equal(G.find('PETITE').repo, 'vuejs/petite-vue');
    assert.equal(G.find('nie-ma-takiego'), null);
    assert.equal(G.find(''), null);
  });
  test('bez DOM i aplikacji moduł nie buduje okna (tylko dane)', () => {
    assert.equal(typeof G.open, 'undefined');
  });
});
