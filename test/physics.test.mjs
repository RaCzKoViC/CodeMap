import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM } from './harness.mjs';

// Fizyka układu siłowego (js/physics.js): grawitacja, sprężyny, odpychanie Barnes-Hut, tłumienie i chłodzenie.
const P = loadCM(['physics']).Physics;
const nd = (x, y, o = {}) => ({ x, y, vx: 0, vy: 0, r: 6, ...o });
const st = (o = {}) => ({ alpha: 1, alphaMin: 0.001, alphaDecay: 0.05, velDecay: 0.6, spacing: 1, ...o });
const finite = (ns) => ns.every((n) => [n.x, n.y, n.vx, n.vy].every(Number.isFinite));

describe('bhRepulse', () => {
  test('dwa węzły odpychają się symetrycznie wzdłuż osi łączącej', () => {
    const a = nd(-10, 0), b = nd(10, 0);
    P.bhRepulse([a, b], 100, 0.9);
    assert.ok(a.vx < 0 && b.vx > 0, 'rozjazd na boki');
    assert.ok(Math.abs(a.vx + b.vx) < 1e-9, 'siły przeciwne');
    assert.equal(a.vy, 0); assert.equal(b.vy, 0);
  });
  test('węzły w dokładnie tym samym punkcie dostają przeciwne siły i rozsuwają się w symulacji (regresja)', () => {
    const a = nd(5, 5), b = nd(5, 5);
    P.bhRepulse([a, b], 100, 0.9);
    assert.ok(Math.hypot(a.vx, a.vy) > 0, 'jest siła');
    assert.ok(Math.abs(a.vx + b.vx) < 1e-9 && Math.abs(a.vy + b.vy) < 1e-9, 'przeciwne kierunki');
    const trio = [nd(0, 0), nd(0, 0), nd(0, 0)], s = st();
    for (let i = 0; i < 60 && P.step(trio, [], s); i++);
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    assert.ok(d(trio[0], trio[1]) > 10 && d(trio[0], trio[2]) > 10 && d(trio[1], trio[2]) > 10, JSON.stringify(trio.map((n) => [n.x, n.y])));
    assert.ok(finite(trio));
  });
  test('nakładające się figury odpychają się mocniej (×3,2) niż odległe', () => {
    const near = [nd(0, 0), nd(10, 0)], far = [nd(0, 0), nd(100, 0)];
    P.bhRepulse(near, 100, 0.9); P.bhRepulse(far, 100, 0.9);
    const fNear = near[1].vx * 10 * 10, fFar = far[1].vx * 100 * 100;   // znormalizowane przez 1/d²
    assert.ok(Math.abs(fNear / fFar - 3.2) < 1e-9);
  });
  test('węzły w jednym punkcie (i ponad 48 poziomów drzewa) nie dają NaN; przypięty węzeł nie dostaje siły', () => {
    const same = Array.from({ length: 60 }, () => nd(5, 5));
    same[0].fixed = true;
    P.bhRepulse(same, 50, 0.9);
    assert.ok(finite(same));
    assert.equal(same[0].vx, 0); assert.equal(same[0].vy, 0);
  });
  test('prawie w jednym punkcie (d² < 0,01): zastępczy kierunek zamiast dzielenia przez zero', () => {
    const a = nd(0, 0), b = nd(0.01, 0.02);
    P.bhRepulse([a, b], 100, 0.9);
    assert.ok(finite([a, b]));
    assert.ok(a.vx !== 0 || a.vy !== 0);
  });
  test('mniej niż 2 węzły albo współrzędne nieskończone → bez zmian', () => {
    const one = [nd(1, 1)]; P.bhRepulse(one, 100, 0.9); assert.equal(one[0].vx, 0);
    const inf = [nd(Infinity, 0), nd(-Infinity, 0)]; P.bhRepulse(inf, 100, 0.9);
    assert.equal(inf[0].vx, 0);
  });
  test('duży zbiór: aproksymacja Barnes-Hut daje wynik bliski sumie dokładnej (θ=0)', () => {
    const mk = () => Array.from({ length: 200 }, (_, i) => nd(Math.cos(i * 1.7) * (50 + i * 3), Math.sin(i * 2.3) * (40 + i * 2)));
    const exact = mk(), approx = mk();
    P.bhRepulse(exact, 1000, 0);
    P.bhRepulse(approx, 1000, 0.9);
    let err = 0, mag = 0;
    for (let i = 0; i < exact.length; i++) { err += Math.hypot(exact[i].vx - approx[i].vx, exact[i].vy - approx[i].vy); mag += Math.hypot(exact[i].vx, exact[i].vy); }
    assert.ok(err / mag < 0.15, 'błąd względny ' + (err / mag).toFixed(3));
  });
});

describe('step', () => {
  test('alpha maleje wg alphaDecay; false, gdy spadnie poniżej alphaMin', () => {
    const s = st({ alpha: 0.02, alphaDecay: 0.5, alphaMin: 0.015 });
    assert.equal(P.step([nd(0, 0), nd(50, 0)], [], s), false);
    assert.equal(s.alpha, 0.01);
    const s2 = st();
    assert.equal(P.step([nd(0, 0)], [], s2), true);
    assert.ok(Math.abs(s2.alpha - 0.95) < 1e-12);
  });
  test('grawitacja ciągnie samotny węzeł do środka; przypięty stoi i ma zerową prędkość', () => {
    const a = nd(200, -100), f = nd(300, 300, { fixed: true, vx: 5, vy: 5 });
    P.step([a, f], [], st());
    assert.ok(a.x < 200 && a.y > -100);
    assert.deepEqual([f.x, f.y, f.vx, f.vy], [300, 300, 0, 0]);
  });
  test('sprężyna „contains" ściąga daleki węzeł ku rodzicowi; import trzyma większy dystans', () => {
    const run = (c) => {
      const s = nd(0, 0, { fixed: true }), t = nd(600, 0), e = { s, t, c, w: 1 };
      for (let i = 0; i < 300; i++) P.step([s, t], [e], st({ alpha: 0.3, alphaDecay: 0 }));
      return t.x;
    };
    const dContains = run(true), dImport = run(false);
    assert.ok(dContains < 600 && dImport < 600);
    assert.ok(dContains < dImport, `contains ${dContains.toFixed(1)} < import ${dImport.toFixed(1)}`);
  });
  test('prędkość ograniczona do 28 na krok', () => {
    const a = nd(0, 0, { vx: 1e6, vy: 0 });
    P.step([a], [], st({ velDecay: 1 }));
    assert.ok(Math.abs(Math.hypot(a.vx, a.vy) - 28) < 1e-9);
  });
  test('pełna symulacja 40 węzłów zbiega (alpha → alphaMin) bez NaN', () => {
    const ns = Array.from({ length: 40 }, (_, i) => nd((i % 7) * 30, Math.floor(i / 7) * 30));
    const springs = ns.slice(1).map((t, i) => ({ s: ns[i], t, c: i % 3 === 0, w: 1 }));
    const s = st({ alphaDecay: 0.03 });
    let steps = 0; while (P.step(ns, springs, s) && steps < 1000) steps++;
    assert.ok(steps < 1000 && s.alpha < s.alphaMin);
    assert.ok(finite(ns));
  });
});
