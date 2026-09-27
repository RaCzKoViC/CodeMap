// Dostępność mapy (js/a11y.js): opis węzła i podsumowanie mapy dla czytnika ekranu, wybór najbliższego węzła
// w kierunku strzałki (stożek ±63°, odchylenie w bok liczone podwójnie).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM([...CORE, 'testmap', 'a11y']);
const X = CM.A11y;
const g = new CM.Graph.Graph().build(FILES.map((f) => ({ ...f })), META);
CM.TestMap.mapTests(g);

describe('opisy dla czytnika ekranu', () => {
  test('plik: ścieżka, język, linie, importy w obie strony; folder: pliki i stan; zależność zewnętrzna', () => {
    const f = g.nodes.get('src/app.js');
    assert.match(X.describe(f, g, 'en'), /^File src\/app\.js · JavaScript · 4 lines · imports 2 · imported by \d+/);
    assert.match(X.describe(f, g, 'pl'), /^Plik src\/app\.js · JavaScript · 4 linie · importuje 2 · importowany przez \d+/);   // odmiana
    const dir = g.nodes.get('src');
    assert.match(X.describe(dir, g, 'en'), /^Folder src · \d+ files? · .*(expanded|collapsed)$/);
    const ext = [...g.nodes.values()].find((n) => n.type !== 'file' && n.type !== 'folder');
    if (ext) assert.match(X.describe(ext, g, 'en'), /^External dependency /);
    assert.equal(X.describe(null, g, 'en'), '');
  });
  test('podsumowanie mapy: nazwa, pliki, foldery, zależności, najczęstsze języki', () => {
    const s = X.summary(g, 'en');
    assert.match(s, /^Map „[^"]*": \d+ files, \d+ folders, \d+ dependencies; languages: JavaScript \d+/);
    assert.match(X.summary(g, 'pl'), /plików, \d+ folderów, \d+ zależności; języki:/);
  });
});

describe('nawigacja strzałkami', () => {
  const N = (id, x, y) => ({ id, x, y });
  const nodes = [N('c', 0, 0), N('r', 100, 5), N('far', 300, 0), N('diag', 60, 90), N('u', 0, -80), N('l', -50, 0)];
  const from = { x: 0, y: 0 }, c = nodes[0];
  test('najbliższy w stożku kierunku; odchylenie w bok karane; poza stożkiem pominięty; brak → null', () => {
    assert.equal(X.nextInDirection(nodes, from, 'right', null, c).id, 'r');
    assert.equal(X.nextInDirection(nodes, from, 'up', null, c).id, 'u');       // ekran: y rośnie w dół
    assert.equal(X.nextInDirection(nodes, from, 'left', null, c).id, 'l');
    assert.equal(X.nextInDirection(nodes, from, 'down', null, c).id, 'diag');   // 60 w bok przy 90 w dół mieści się w stożku
    assert.equal(X.nextInDirection([c, N('side', 10, 100)], from, 'right', null, c), null);
    assert.equal(X.nextInDirection(nodes, from, 'nowhere', null, c), null);
  });
  test('rzutowanie na ekran (obrót kamery): kierunek liczony po projekcji', () => {
    const rot = (n) => ({ x: -n.y, y: n.x });   // obrót o 90°
    assert.equal(X.nextInDirection(nodes, rot(c), 'down', rot, c).id, 'r');
  });
});
