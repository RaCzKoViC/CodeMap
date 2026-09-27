import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM([...CORE, 'git-core']);
const G = CM.GitCore;
const D = 864e5, T0 = Date.UTC(2026, 0, 1);

// historia budowana od najstarszego, zwracana jak z git-local (najnowsze pierwsze)
function history(steps) {
  return steps.map((s, i) => ({
    sha: 'c' + i, parents: i ? ['c' + (i - 1)] : [], merge: !!s.merge, boundary: !!s.boundary,
    author: s.author, authorTime: T0 + (s.day ?? i) * D, time: T0 + (s.day ?? i) * D,
    message: s.msg || ('commit ' + i), files: s.files || [],
  })).reverse();
}
const ala = { name: 'Ala Kowalska', email: 'ala@firma.pl' };
const alaHome = { name: 'Ala Kowalska', email: 'ala@dom.pl' };
const bob = { name: 'Bob', email: '1234+bobdev@users.noreply.github.com' };
const bobLogin = { name: 'bobdev', email: 'bob@work.io', login: 'bobdev' };
const bot = { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' };

describe('tożsamości autorów', () => {
  test('ten sam człowiek pod dwoma e-mailami i przez login z noreply GitHuba → jeden autor', () => {
    const cs = history([
      { author: ala, files: [{ path: 'a.js', status: 'A' }] },
      { author: alaHome, files: [{ path: 'a.js', status: 'M' }] },
      { author: bob, files: [{ path: 'b.js', status: 'A' }] },
      { author: bobLogin, files: [{ path: 'b.js', status: 'M' }] },
    ]);
    const r = G.analyze(cs, ['a.js', 'b.js']);
    assert.equal(r.authors.length, 2);
    const names = host(r.authors.map((a) => [a.name, a.commits, a.login])).sort();
    assert.deepEqual(names, [['Ala Kowalska', 2, null], ['Bob', 2, 'bobdev']].sort());
  });
  test('krótkie / ogólne imiona nie sklejają różnych osób', () => {
    const cs = history([
      { author: { name: 'root', email: 'x@a' }, files: [{ path: 'a.js', status: 'A' }] },
      { author: { name: 'root', email: 'y@b' }, files: [{ path: 'a.js', status: 'M' }] },
    ]);
    assert.equal(G.analyze(cs, ['a.js']).authors.length, 2);
  });
});

describe('analyze — statystyki plików', () => {
  test('zmiana nazwy: historia starej ścieżki trafia do bieżącego pliku, narodziny = pierwsze dodanie', () => {
    const cs = history([
      { author: ala, files: [{ path: 'old/util.js', status: 'A' }] },
      { author: bob, files: [{ path: 'old/util.js', status: 'M' }] },
      { author: ala, files: [{ path: 'lib/util.js', status: 'R', from: 'old/util.js' }] },
      { author: ala, files: [{ path: 'lib/util.js', status: 'M' }, { path: 'gone.js', status: 'A' }] },
      { author: bob, files: [{ path: 'gone.js', status: 'D' }] },
    ]);
    const r = G.analyze(cs, ['lib/util.js']);
    const g = host(r.files.get('lib/util.js'));
    assert.equal(g.c, 4);
    assert.equal(g.born, T0);
    assert.equal(g.first, T0); assert.equal(g.last, T0 + 3 * D);
    assert.equal(g.n, 2);
    assert.equal(r.authors[g.own].name, 'Ala Kowalska');
    assert.equal(g.share, 0.75);
    assert.equal(r.untracked, 2);          // gone.js: A + D — pliku nie ma na mapie
    assert.equal(r.commits, 5);
  });
  test('merge pomijany, boundary (płytki klon) to nie narodziny, linie z API sumowane', () => {
    const cs = history([
      { author: ala, boundary: true, files: [{ path: 'a.js', status: 'A', add: 10, del: 0 }] },
      { author: bob, files: [{ path: 'a.js', status: 'M', add: 3, del: 1 }] },
      { author: bob, merge: true, files: [] },
    ]);
    const r = G.analyze(cs, ['a.js']);
    const g = host(r.files.get('a.js'));
    assert.equal(g.c, 2); assert.equal(g.born, null);
    assert.equal(g.add, 13); assert.equal(g.del, 1);
    assert.equal(r.merges, 1); assert.equal(r.commits, 2);
  });
  test('recent = zmiany z ostatnich 90 dni licząc od najnowszego commita', () => {
    const cs = history([
      { author: ala, day: 0, files: [{ path: 'a.js', status: 'A' }] },
      { author: ala, day: 200, files: [{ path: 'a.js', status: 'M' }] },
      { author: ala, day: 250, files: [{ path: 'a.js', status: 'M' }] },
    ]);
    assert.equal(G.analyze(cs, ['a.js']).files.get('a.js').recent, 2);
  });
  test('bot nie zostaje właścicielem pliku, choć ma najwięcej zmian', () => {
    const cs = history([
      { author: ala, files: [{ path: 'package.json', status: 'A' }] },
      { author: bot, files: [{ path: 'package.json', status: 'M' }] },
      { author: bot, files: [{ path: 'package.json', status: 'M' }] },
    ]);
    const r = G.analyze(cs, ['package.json']);
    assert.equal(r.authors[r.files.get('package.json').own].name, 'Ala Kowalska');
    assert.ok(r.authors.find((a) => a.bot));
  });
  test('rebase: repo wczytane od podkatalogu — ścieżki względem mapy, pliki spoza pominięte', () => {
    const cs = history([{ author: ala, files: [{ path: 'app/src/x.js', status: 'A' }, { path: 'README.md', status: 'A' }] },
      { author: ala, files: [{ path: 'app/src/y.js', status: 'R', from: 'tools/y.js' }] }]);
    const rb = G.rebase(cs, 'app/');
    assert.deepEqual(host(rb.map((c) => c.files.map((f) => f.status + ':' + f.path))), [['A:src/y.js'], ['A:src/x.js']]);
  });
});

describe('bus factor', () => {
  const two = (split) => history(split.map(([p, who]) => ({ author: who, files: [{ path: p, status: 'A' }] })));
  test('jeden autor → 1', () => {
    const r = G.analyze(two([['a', ala], ['b', ala], ['c', ala]]), ['a', 'b', 'c']);
    assert.deepEqual(host({ v: r.busFactor.value, n: r.busFactor.files }), { v: 1, n: 3 });
  });
  test('dwóch autorów po połowie plików → 2 (po zdjęciu jednego osierocona jest dokładnie połowa)', () => {
    const r = G.analyze(two([['a', ala], ['b', ala], ['c', bob], ['d', bob]]), ['a', 'b', 'c', 'd']);
    assert.equal(r.busFactor.value, 2);
  });
  test('jeden dominujący autor → 1, mimo innych drobnych autorów', () => {
    const r = G.analyze(two([['a', ala], ['b', ala], ['c', ala], ['d', bob]]), ['a', 'b', 'c', 'd']);
    assert.equal(r.busFactor.value, 1);
    assert.equal(r.authors[r.busFactor.authors[0]].name, 'Ala Kowalska');
  });
});

describe('oś czasu i hotspoty', () => {
  test('zdarzenia chronologicznie, narodziny tylko dla plików dodanych w oknie', () => {
    const cs = history([
      { author: ala, files: [{ path: 'a.js', status: 'M' }] },               // a.js istniał przed oknem
      { author: bob, files: [{ path: 'b.js', status: 'A' }] },
      { author: ala, files: [{ path: 'b.js', status: 'M' }, { path: 'a.js', status: 'M' }] },
    ]);
    const r = G.analyze(cs, ['a.js', 'b.js', 'c.js']);
    const tl = r.timeline;
    assert.equal(tl.commits.length, 3);
    assert.equal(tl.commits[0][0], T0);
    const b = host([...G.births(tl)]);
    assert.equal(b[tl.files.indexOf('a.js')], -1);
    assert.equal(b[tl.files.indexOf('b.js')], 1);
    assert.equal(tl.files.indexOf('c.js'), -1);   // bez historii w oknie — brak zdarzeń
  });
  test('hotspotScore: częściej zmieniany i bardziej złożony plik wyżej', () => {
    const hot = { git: { c: 20, recent: 5 }, metrics: { complexity: 30, lines: 400 } };
    const busyEasy = { git: { c: 30, recent: 0 }, metrics: { complexity: 1, lines: 50 } };
    const hardQuiet = { git: { c: 1, recent: 0 }, metrics: { complexity: 60, lines: 900 } };
    assert.ok(G.hotspotScore(hot) > G.hotspotScore(busyEasy));
    assert.ok(G.hotspotScore(hot) > G.hotspotScore(hardQuiet));
    assert.equal(G.hotspotScore({ metrics: { complexity: 9 } }), 0);
  });
});

describe('zapis do grafu', () => {
  test('applyToGraph ustawia node.git po ścieżce, folderStats agreguje, JSON przenosi dane', () => {
    const g = new CM.Graph.Graph().build(FILES.map((f) => ({ ...f })), META);
    const cs = history([
      { author: ala, files: [{ path: 'src/lib/util.js', status: 'A' }, { path: 'src/index.js', status: 'A' }] },
      { author: bob, files: [{ path: 'src/lib/util.js', status: 'M' }] },
    ]);
    const r = G.analyze(cs, [...g.nodes.values()].filter((n) => n.type === 'file').map((n) => n.path));
    const hit = G.applyToGraph(g, r, { source: 'local' });
    assert.equal(hit, 2);
    assert.equal(g.nodes.get('src/lib/util.js').git.c, 2);
    const fs = G.folderStats(g, g.nodes.get('src'));
    assert.equal(fs.files, 2); assert.equal(fs.c, 3);
    const g2 = CM.Graph.Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    assert.equal(g2.nodes.get('src/lib/util.js').git.c, 2);
    assert.equal(g2.gitInfo.source, 'local');
    assert.equal(g2.gitInfo.authors.length, 2);
  });
});
