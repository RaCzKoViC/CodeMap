import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM([...CORE, 'git-core', 'pr-core']);
const P = CM.PRCore, G = CM.GitCore;
const build = () => new CM.Graph.Graph().build(FILES.map((f) => ({ ...f })), META);
const D = 864e5, T0 = Date.UTC(2026, 0, 1);
const ala = { name: 'Ala Kowalska', email: 'ala@x.pl', login: 'ala' }, bob = { name: 'Bob Nowak', email: 'bob@x.pl', login: 'bob' };
function withGit(g) {
  const cs = [];
  const add = (who, day, files) => cs.push({ sha: 's' + cs.length, parents: [], merge: false, author: who, authorTime: T0 + day * D, time: T0 + day * D, message: 'x', files });
  add(ala, 0, [{ path: 'src/lib/util.js', status: 'A' }, { path: 'src/store/reducer.js', status: 'A' }, { path: 'src/app.js', status: 'A' }]);
  for (let i = 1; i <= 8; i++) add(ala, i, [{ path: 'src/lib/util.js', status: 'M' }]);
  add(bob, 20, [{ path: 'src/store/reducer.js', status: 'M' }]);
  cs.reverse();
  const paths = [...g.nodes.values()].filter((n) => n.type === 'file').map((n) => n.path);
  G.applyToGraph(g, G.analyze(cs, paths), { source: 'test' });
  return g;
}

describe('zależne (odwrotny BFS)', () => {
  test('util.js: bezpośrednio app.js i index.js, odległości zapisane, sam plik wykluczony', () => {
    const g = build();
    const d = host([...P.dependents(g, ['src/lib/util.js']).entries()]).sort();
    assert.ok(d.some(([id, k]) => id === 'src/app.js' && k === 1));
    assert.ok(d.some(([id, k]) => id === 'src/index.js' && k === 1));
    assert.ok(!d.some(([id]) => id === 'src/lib/util.js'));
  });
});

describe('analiza PR', () => {
  test('ryzyko: częściej zmieniany, bardziej używany plik wyżej; pliki spoza mapy osobno; poziom i sumy', () => {
    const g = withGit(build());
    const res = P.analyze(g, [
      { path: 'src/lib/util.js', status: 'M', add: 40, del: 12 },
      { path: 'src/lazy.js', status: 'M', add: 1, del: 1 },
      { path: 'src/new/feature.js', status: 'A', add: 80, del: 0 },
    ], { author: { login: 'bob' } });
    assert.deepEqual(host(res.changed.map((c) => c.path)), ['src/lib/util.js', 'src/lazy.js']);
    assert.ok(res.changed[0].risk > res.changed[1].risk);
    assert.deepEqual(host(res.outside.map((o) => o.path)), ['src/new/feature.js']);
    assert.equal(res.add, 121); assert.equal(res.del, 13);
    assert.equal(res.changed[0].parts.familiarity, 1);         // bob nie zmieniał util.js
    assert.ok(res.impacted.has('src/app.js'));
    assert.ok(['low', 'med', 'high'].includes(res.level));
  });
  test('recenzenci: właściciele zmienianych plików bez autora PR', () => {
    const g = withGit(build());
    const res = P.analyze(g, [{ path: 'src/lib/util.js', status: 'M' }, { path: 'src/store/reducer.js', status: 'M' }], { author: { login: 'bob' } });
    assert.deepEqual(host(res.reviewers.map((r) => r.login)), ['ala']);
    const res2 = P.analyze(g, [{ path: 'src/store/reducer.js', status: 'M' }], { author: { login: 'carol' } });
    assert.deepEqual(host(res2.reviewers.map((r) => r.login)).sort(), ['ala', 'bob']);
  });
  test('bez historii git i testów: działa na samej strukturze (złożoność, zależni, rozmiar)', () => {
    const g = build();
    const res = P.analyze(g, [{ path: 'src/app.js', status: 'M', add: 5, del: 2 }]);
    assert.equal(res.changed.length, 1);
    assert.deepEqual(host(Object.keys(res.changed[0].parts)).sort(), ['complexity', 'dependents', 'size']);
    assert.equal(res.reviewers.length, 0);
  });
  test('zmiana nazwy: plik znaleziony po starej ścieżce (mapa to gałąź bazowa)', () => {
    const g = build();
    const res = P.analyze(g, [{ path: 'src/utils/helpers.js', from: 'src/lib/util.js', status: 'R', add: 0, del: 0 }]);
    assert.equal(res.changed.length, 1); assert.equal(res.changed[0].id, 'src/lib/util.js');
  });
});

describe('pomocnicze', () => {
  test('parsePR: adresy GitHub / GitLab / Bitbucket i sam numer', () => {
    assert.deepEqual(host(P.parsePR('https://github.com/o/r/pull/42')), { host: 'github', repo: 'o/r', number: 42 });
    assert.deepEqual(host(P.parsePR('https://gitlab.com/g/sub/p/-/merge_requests/7')), { host: 'gitlab', repo: 'g/sub/p', number: 7 });
    assert.deepEqual(host(P.parsePR('https://bitbucket.org/ws/r/pull-requests/3')), { host: 'bitbucket', repo: 'ws/r', number: 3 });
    assert.deepEqual(host(P.parsePR('#12')), { number: 12 });
    assert.equal(P.parsePR('javascript:alert(1)'), null);
  });
  test('summaryMarkdown: tabela plików, recenzenci, link', () => {
    const g = withGit(build());
    const res = P.analyze(g, [{ path: 'src/lib/util.js', status: 'M', add: 3, del: 1 }], { author: { login: 'bob' } });
    const md = P.summaryMarkdown(res, { number: 5, title: 'Fix' }, { link: 'https://x/#repo=o/r&pr=5' });
    assert.match(md, /### CodeMap — wpływ PR #5: Fix/);
    assert.match(md, /\| `src\/lib\/util\.js` \| M \+3\/−1 \|/);
    assert.match(md, /@ala/);
    assert.match(md, /\(https:\/\/x\/#repo=o\/r&pr=5\)/);
  });
});
