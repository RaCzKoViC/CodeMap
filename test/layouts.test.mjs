import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, ALL_FILTERS, host } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM();
const { Graph } = CM.Graph;
const Layouts = CM.Layouts;

// wszystkie nazwy obsługiwane przez Layouts.apply (13 z UI + reszta dostępna programowo)
export const LAYOUT_NAMES = ['tree', 'tree-h', 'radial', 'concentric', 'circle', 'spiral', 'grid', 'cluster', 'layered', 'flow',
  'compact', 'balloon', 'mindmap', 'genealogy', 'pack', 'structtree', 'structradial', 'nebula', 'spiralgalaxy', 'cosmicrings',
  'sunburst', 'treemap', 'icicle', 'solar', 'honeycomb', 'arcdiagram', 'dendrite', 'helix', 'constellation', 'vortex',
  'galaxy', 'modules', 'force'];
const ANIMATED = new Set(['galaxy', 'modules', 'force']);

function fresh() {
  const g = new Graph().build(FILES.map((f) => ({ ...f })), META);
  const vis = g.getVisible(ALL_FILTERS);
  for (const n of vis.nodes) { n.x = 0; n.y = 0; n.vx = 0; n.vy = 0; }
  return { g, vis };
}
const finite = (nodes) => nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
const bbox = (nodes) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
  return { w: x1 - x0, h: y1 - y0 };
};

describe('Layouts.apply', () => {
  for (const name of LAYOUT_NAMES) {
    test(`${name}: każdy węzeł dostaje skończone współrzędne`, () => {
      const { g, vis } = fresh();
      const res = Layouts.apply(name, g, vis, { spacing: 1 });
      assert.equal(!!res.animated, ANIMATED.has(name), 'animated flag');
      if (res.sim) { for (let i = 0; i < 60 && res.sim.running !== false; i++) res.sim.tick(); }
      assert.ok(finite(vis.nodes), 'finite coordinates');
      const b = bbox(vis.nodes);
      assert.ok(b.w > 0 || b.h > 0, 'nodes are spread, not stacked at origin');
    });
  }

  test('układy statyczne są deterministyczne', () => {
    for (const name of LAYOUT_NAMES.filter((n) => !ANIMATED.has(n))) {
      const a = fresh(); Layouts.apply(name, a.g, a.vis, { spacing: 1 });
      const b = fresh(); Layouts.apply(name, b.g, b.vis, { spacing: 1 });
      const pa = host(a.vis.nodes.map((n) => [n.id, +n.x.toFixed(6), +n.y.toFixed(6)]));
      const pb = host(b.vis.nodes.map((n) => [n.id, +n.x.toFixed(6), +n.y.toFixed(6)]));
      assert.deepEqual(pa, pb, `${name} must be deterministic`);
    }
  });

  test('spacing skaluje układ statyczny', () => {
    const a = fresh(); Layouts.apply('pack', a.g, a.vis, { spacing: 1 });
    const b = fresh(); Layouts.apply('pack', b.g, b.vis, { spacing: 2 });
    const ba = bbox(a.vis.nodes), bb = bbox(b.vis.nodes);
    assert.ok(bb.w > ba.w * 1.5 && bb.h > ba.h * 1.5, 'spacing 2 ≈ twice the extent');
  });

  test('pusta lista węzłów nie wywraca się', () => {
    const { g } = fresh();
    assert.deepEqual(host(Layouts.apply('pack', g, { nodes: [], edges: [] }, {})), { animated: false });
    assert.deepEqual(host(Layouts.apply('force', g, { nodes: [], edges: [] }, {})), { animated: false });
  });

  test('nieznana nazwa → układ siłowy (default)', () => {
    const { g, vis } = fresh();
    const res = Layouts.apply('nie-ma-takiego', g, vis, {});
    assert.ok(res.animated && res.sim && typeof res.sim.tick === 'function');
  });

  test('symulacja siłowa osiada: alpha maleje i running przechodzi na false', () => {
    const { g, vis } = fresh();
    const { sim } = Layouts.apply('force', g, vis, { spacing: 1 });
    let ticks = 0; while (sim.running !== false && ticks++ < 5000) sim.tick();
    assert.ok(ticks < 5000, 'settles within bounded ticks');
    assert.ok(finite(vis.nodes));
    // brak nakładania środków: żadne dwa węzły nie dzielą tego samego punktu
    const seen = new Set(); for (const n of vis.nodes) { const k = n.x.toFixed(1) + ',' + n.y.toFixed(1); assert.ok(!seen.has(k), 'overlapping centers'); seen.add(k); }
  });
});
