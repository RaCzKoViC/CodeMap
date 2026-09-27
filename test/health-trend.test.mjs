// CM.HealthTrend na atrapie repozytorium (commit / snapshot / blob): próbkowanie łańcucha pierwszego rodzica,
// reguły wczytywania, punkty z wynikiem i regułami, tick między punktami, anulowanie, zmiany reguł.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { CLI_MODULES } from '../cli/runtime.mjs';

const CM = loadCM(CLI_MODULES);
const HT = CM.HealthTrend;
const enc = new TextEncoder();

// historia: c0 (a.js) → c1 (+ b.js z pustym catch) → c2 (+ node_modules) → c3 (bez pustego catch); merge c3 ma 2 rodziców
function fakeRepo() {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  const put = (text) => { const sha = 'b' + blobs.size; blobs.set(sha, enc.encode(text)); return sha; };
  const A = put('export const a = 1;\n'), B1 = put("import { a } from './a.js';\ntry { a(); } catch (e) {}\nexport const b = a;\n"), B2 = put("import { a } from './a.js';\nexport const b = a;\n"), NM = put('module.exports = 1;\n');
  trees.set('c0', [{ path: 'src/a.js', sha: A }]);
  trees.set('c1', [{ path: 'src/a.js', sha: A }, { path: 'src/b.js', sha: B1 }]);
  trees.set('c2', [{ path: 'src/a.js', sha: A }, { path: 'src/b.js', sha: B1 }, { path: 'node_modules/x/index.js', sha: NM }]);
  trees.set('c3', [{ path: 'src/a.js', sha: A }, { path: 'src/b.js', sha: B2 }, { path: 'node_modules/x/index.js', sha: NM }]);
  const T0 = Date.UTC(2026, 0, 1);
  ['c0', 'c1', 'c2', 'c3'].forEach((s, i) => commits.set(s, { sha: s, tree: s, parents: i ? ['c' + (i - 1)].concat(i === 3 ? ['side'] : []) : [], author: { time: T0 + i * 864e5 }, committer: { time: T0 + i * 864e5 }, message: 'commit ' + i + '\nbody' }));
  commits.set('side', { sha: 'side', tree: 'c0', parents: [], author: { time: T0 }, committer: { time: T0 }, message: 'side' });
  return {
    commit: async (ref) => commits.get(ref === 'HEAD' ? 'c3' : ref) || null,
    snapshot: async (sha) => ({ commit: commits.get(sha), files: trees.get(sha).map((f) => ({ ...f })) }),
    blob: async (sha) => blobs.get(sha) || null,
  };
}

describe('HealthTrend', () => {
  test('łańcuch pierwszego rodzica (bez gałęzi bocznej), node_modules pominięte, puste catch w c1–c2', async () => {
    let ticks = 0; const seen = [];
    const h = host(await HT.compute(fakeRepo(), { n: 10, tick: async () => { ticks++; }, onPoint: (p, i, n) => seen.push(i + '/' + n) }));
    assert.equal(h.chain, 4);
    assert.deepEqual(h.points.map((p) => [p.sha, p.files, p.rules.emptycatch || 0, p.message]), [['c0', 1, 0, 'commit 0'], ['c1', 2, 1, 'commit 1'], ['c2', 2, 1, 'commit 2'], ['c3', 2, 0, 'commit 3']]);
    assert.equal(h.points[0].date, '2026-01-01');
    assert.deepEqual(seen, ['1/4', '2/4', '3/4', '4/4']); assert.equal(ticks, 4);
    assert.deepEqual(host(HT.ruleDeltas(h.points)), []);   // pierwszy i ostatni bez znalezisk tej reguły
  });
  test('2 punkty = pierwszy i HEAD; wykluczenie globem; anulowanie przerywa', async () => {
    const h = host(await HT.compute(fakeRepo(), { n: 2, exclude: ['src/b.js'] }));
    assert.deepEqual(h.points.map((p) => [p.sha, p.files]), [['c0', 1], ['c3', 1]]);
    const ctrl = new AbortController(); ctrl.abort();
    await assert.rejects(HT.compute(fakeRepo(), { n: 3, signal: ctrl.signal }), (e) => e.name === 'AbortError');
  });
  test('ruleDeltas: zmiany między pierwszym a ostatnim, malejąco po wartości bezwzględnej', () => {
    const pts = [{ rules: { a: 1, b: 5 } }, { rules: { a: 4, c: 2 } }];
    assert.deepEqual(host(HT.ruleDeltas(pts)), [['b', -5], ['a', 3], ['c', 2]]);
  });
});
