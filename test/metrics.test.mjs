import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM([...CORE, 'metrics']);
const { Graph } = CM.Graph;
const M = CM.Metrics;
const build = () => new Graph().build(FILES.map((f) => ({ ...f })), META);

describe('computeCoupling', () => {
  test('plik: Ca/Ce/I — src/lib/util.js ma Ca=2 (index, app), Ce=1 (app) → I=0.33', () => {
    const c = M.computeCoupling(build());
    assert.deepEqual(host(c.get('src/lib/util.js')), { ca: 2, ce: 1, instability: 0.33 });
    // index.js: Ce = app, lib/util, config, lazy, cjs (react = zewnętrzny, pomijany); Ca = index.html (reference)
    assert.deepEqual(host(c.get('src/index.js')), { ca: 1, ce: 5, instability: 0.83 });
    // liść bez klientów i bez zależności → brak sprzężeń → I=null
    assert.deepEqual(host(c.get('docs/arch.md')), { ca: 1, ce: 0, instability: 0 });
    assert.deepEqual(host(c.get('assets/logo.png')), { ca: 0, ce: 0, instability: null });
  });
  test('folder: agregacja po plikach potomnych, krawędzie wewnętrzne nie liczą się', () => {
    const c = M.computeCoupling(build());
    assert.deepEqual(host(c.get('src/lib')), { ca: 2, ce: 1, instability: 0.33 });
    // src: jedyne sprzężenie z zewnątrz to index.html → src/index.js (react pominięty)
    assert.deepEqual(host(c.get('src')), { ca: 1, ce: 0, instability: 0 });
    assert.deepEqual(host(c.get('src/store')), { ca: 1, ce: 0, instability: 0 });
    // pakiet Go = folder jako cel krawędzi: go/cmd zależy od go/pkg/util, folder go jest samowystarczalny
    assert.deepEqual(host(c.get('go/cmd')), { ca: 0, ce: 1, instability: 1 });
    assert.deepEqual(host(c.get('go/pkg/util')), { ca: 1, ce: 0, instability: 0 });
    assert.deepEqual(host(c.get('go/pkg')), { ca: 1, ce: 0, instability: 0 });
    assert.deepEqual(host(c.get('go')), { ca: 0, ce: 0, instability: null });
    // py/pkg: wszystkie importy wewnątrz pakietu
    assert.deepEqual(host(c.get('py/pkg')), { ca: 0, ce: 0, instability: null });
  });
  test('węzły syntetyczne i zewnętrzne pominięte; opts.externals dolicza pakiety do Ce', () => {
    const g = build();
    const c = M.computeCoupling(g);
    assert.ok(!c.has('__root__') && !c.has('__ext__') && !c.has('ext:react'));
    for (const n of g.nodes.values()) if (n.type === 'file' || (n.type === 'folder' && !n.external && n.id !== '__root__')) assert.ok(c.has(n.id), n.id);
    const cx = M.computeCoupling(g, { externals: true });
    assert.deepEqual(host(cx.get('src/index.js')), { ca: 1, ce: 6, instability: 0.86 });
    assert.deepEqual(host(cx.get('src')), { ca: 1, ce: 1, instability: 0.5 });
    assert.deepEqual(host(cx.get('src/lib/util.js')), host(c.get('src/lib/util.js')), 'files without external imports unchanged');
  });
  test('zduplikowane krawędzie liczone raz; couplingFor cache per graf', () => {
    const g = build();
    g.edges.push({ id: 'dupe', source: 'src/index.js', target: 'src/app.js', type: 'import' });
    assert.equal(M.computeCoupling(g).get('src/app.js').ca, 2);
    const a = M.couplingFor(g), b = M.couplingFor(g);
    assert.equal(a, b, 'same Map instance for the same graph object');
    assert.notEqual(M.couplingFor(build()), a);
    assert.equal(M.couplingFor(null).size, 0);
  });
});
