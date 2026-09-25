import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker } from './harness.mjs';

function ring(n) {
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; nodes.push({ x: Math.cos(a) * 50, y: Math.sin(a) * 50, r: 6 }); }
  for (let i = 0; i < n; i++) edges.push({ s: i, t: (i + 1) % n, c: i % 3 === 0, w: 1 });
  return { nodes, edges };
}

describe('sim-worker', () => {
  test('init → strumień pozycji → settled; wszystkie liczby skończone', () => {
    const w = loadWorker();
    const { nodes, edges } = ring(30);
    w.send({ type: 'init', nodes, edges, spacing: 1 });
    const iters = w.drain(5000);
    assert.ok(iters > 0 && iters < 5000, 'loop scheduled and terminated');
    assert.ok(w.posted.length >= 2);
    const last = w.posted[w.posted.length - 1];
    assert.equal(last.type, 'settled');
    assert.ok(last.pos instanceof Float32Array);
    assert.equal(last.pos.length, nodes.length * 2);
    for (const v of last.pos) assert.ok(Number.isFinite(v));
    assert.ok(w.posted.slice(0, -1).every((m) => m.type === 'pos'));
    // bufory są przekazywane (transfer) — każdy komunikat ma własną tablicę
    assert.notEqual(w.posted[0].pos, last.pos);
  });

  test('węzły fixed nie ruszają się; pozostałe się rozchodzą', () => {
    const w = loadWorker();
    const { nodes, edges } = ring(20);
    nodes[0].fixed = true; nodes[0].x = 123; nodes[0].y = -45;
    w.send({ type: 'init', nodes, edges, spacing: 1 });
    w.drain(5000);
    const last = w.posted[w.posted.length - 1].pos;
    assert.equal(last[0], 123); assert.equal(last[1], -45);
    let minD = Infinity;
    for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) minD = Math.min(minD, Math.hypot(last[i * 2] - last[j * 2], last[i * 2 + 1] - last[j * 2 + 1]));
    assert.ok(minD > 1, 'no two nodes collapse onto the same point');
  });

  test('stop przerywa pętlę, reheat ją wznawia', () => {
    const w = loadWorker();
    const { nodes, edges } = ring(12);
    w.send({ type: 'init', nodes, edges, spacing: 1 });
    w.send({ type: 'stop' });
    const before = w.posted.length;
    assert.equal(w.drain(100), 0, 'nothing left in the queue after stop');
    assert.equal(w.posted.length, before);
    w.send({ type: 'reheat', alpha: 0.6 });
    w.drain(5000);
    assert.equal(w.posted[w.posted.length - 1].type, 'settled');
  });

  test('pusta lista węzłów nie wywraca workera', () => {
    const w = loadWorker();
    w.send({ type: 'init', nodes: [], edges: [], spacing: 1 });
    w.drain(5000);
    assert.equal(w.posted[w.posted.length - 1].type, 'settled');
  });
});
