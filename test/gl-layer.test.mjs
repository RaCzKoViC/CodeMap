import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

// Warstwa WebGL bez GPU: parser kolorów i wygaszanie gęstych krawędzi (czysta arytmetyka na buforze odcinków).
const CM = loadCM(['util', 'gl-layer']);
const GL = CM.GLLayer;
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);

describe('kolory CSS → wektor dla shaderów', () => {
  test('#rgb, #rrggbb, #rrggbbaa', () => {
    assert.ok(near(host(GL.rgba('#fff')), [1, 1, 1, 1]));
    assert.ok(near(host(GL.rgba('#22d3ee')), [0x22 / 255, 0xd3 / 255, 0xee / 255, 1]));
    assert.ok(near(host(GL.rgba('#00000080')), [0, 0, 0, 0x80 / 255]));
  });
  test('ten sam kolor = ten sam obiekt z pamięci podręcznej', () => {
    assert.equal(GL.rgba('#123456'), GL.rgba('#123456'));
  });
});

describe('wygaszanie gęstych zależności', () => {
  // udawany renderer: kamera 1:1 (świat = ekran), okno 100×100
  const R = (zoom = 1) => ({ w: 100, h: 100, cam: { zoom, xf: () => ({ a: zoom, b: 0, c: 0, d: zoom, e: 0, f: 0 }) } });
  const layer = (segs, bounds = [0, 0, 100, 100]) => {
    const a = new Float32Array(segs.flat());
    return { xy: { n: segs.length, a }, bounds, fade: GL.Layer.prototype.fade };
  };
  test('rzadkie krawędzie → pełna alfa; brak krawędzi → 1', () => {
    assert.equal(layer([[0, 10, 100, 10], [0, 50, 100, 50]]).fade(R()), 1);
    assert.equal(layer([]).fade(R()), 1);
  });
  test('gęstość = długość przyciętych do okna / pole mapy w oknie; alfa maleje proporcjonalnie', () => {
    // 100 poziomych odcinków po 100 px w oknie 100×100 → 10 000 px / 10 000 px² = 1 krawędź na piksel → 0,6
    const segs = Array.from({ length: 100 }, (_, i) => [0, i, 100, i]);
    assert.ok(Math.abs(layer(segs).fade(R()) - 0.6) < 1e-6);
    // te same odcinki 3× dłuższe poza oknem — liczy się tylko część w oknie
    const long = Array.from({ length: 100 }, (_, i) => [-100, i, 200, i]);
    assert.ok(Math.abs(layer(long).fade(R()) - 0.6) < 1e-6);
    // odcinki całkiem poza oknem nie zwiększają gęstości
    assert.equal(layer(segs.map(([x0, y, x1]) => [x0 + 500, y, x1 + 500, y])).fade(R()), 1);
  });
  test('mapa zajmuje ćwierć okna → gęstość liczona na jej polu (puste okno nie rozrzedza)', () => {
    const segs = Array.from({ length: 50 }, (_, i) => [0, i, 50, i]);   // 2500 px na polu 50×50
    assert.ok(Math.abs(layer(segs, [0, 0, 50, 50]).fade(R()) - 0.6) < 1e-6);
    assert.equal(layer(segs, [0, 0, 100, 100]).fade(R()), 1);            // ta sama długość na całym oknie = 0,25
  });
  test('dolna granica 0,02', () => {
    const segs = Array.from({ length: 20000 }, (_, i) => [0, i % 100, 100, i % 100]);
    assert.equal(layer(segs).fade(R()), 0.02);
  });
});
