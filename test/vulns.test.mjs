// CM.Vulns — podatne zależności (OSV.dev) bez sieci: pliki blokad → graph.lockDeps, źródła wersji (blokada / manifest),
// normalizacja, CVSS 3, zapytania na podstawionym fetch (querybatch + szczegóły), wersja z poprawką, reguła Inspect
// „vulndep" i zapis mapy.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { CLI_MODULES } from '../cli/runtime.mjs';

const CM = loadCM(CLI_MODULES);
const V = CM.Vulns;
const { Graph } = CM.Graph;
const F = (path, content) => ({ path, content, size: content.length, mtime: 1 });
const build = (files) => new Graph().build(files, { name: 't', source: 'test' });
const locks = (g) => host([...g.lockDeps.values()].map((d) => d.eco + ':' + d.name + '@' + d.version + ' ' + d.file).sort());

describe('pliki blokad → graph.lockDeps', () => {
  test('package-lock v3 (zagnieżdżone, bez linków), v1, yarn.lock v1 i berry', () => {
    const g = build([
      F('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'app' }, 'node_modules/lodash': { version: '4.17.15' },
        'node_modules/a/node_modules/@scope/b': { version: '1.0.0' }, 'node_modules/local': { version: '0.0.1', link: true } } })),
      F('old/package-lock.json', JSON.stringify({ lockfileVersion: 1, dependencies: { minimist: { version: '1.2.0', dependencies: { deep: { version: '2.0.0' } } } } })),
      F('y1/yarn.lock', '# yarn lockfile v1\n\n"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.2.0"\n  resolved "x"\n\nleft-pad@^1.3.0:\n  version "1.3.0"\n'),
      F('y2/yarn.lock', '__metadata:\n  version: 6\n\n"react@npm:^18.0.0":\n  version: 18.2.0\n'),
    ]);
    assert.deepEqual(locks(g), [
      'npm:@babel/core@7.2.0 y1/yarn.lock', 'npm:@scope/b@1.0.0 package-lock.json', 'npm:deep@2.0.0 old/package-lock.json',
      'npm:left-pad@1.3.0 y1/yarn.lock', 'npm:lodash@4.17.15 package-lock.json', 'npm:minimist@1.2.0 old/package-lock.json', 'npm:react@18.2.0 y2/yarn.lock']);
  });
  test('Cargo.lock, poetry.lock, Pipfile.lock, go.sum', () => {
    const g = build([
      F('Cargo.lock', '[[package]]\nname = "serde"\nversion = "1.0.100"\n\n[[package]]\nname = "time"\nversion = "0.1.43"\n'),
      F('poetry.lock', '[[package]]\nname = "Jinja2"\nversion = "2.10"\n'),
      F('Pipfile.lock', JSON.stringify({ default: { requests: { version: '==2.19.0' } }, develop: {} })),
      F('go.sum', 'github.com/gin-gonic/gin v1.9.0 h1:abc=\ngithub.com/gin-gonic/gin v1.9.0/go.mod h1:def=\n'),
    ]);
    assert.deepEqual(locks(g), ['cargo:serde@1.0.100 Cargo.lock', 'cargo:time@0.1.43 Cargo.lock', 'go:github.com/gin-gonic/gin@v1.9.0 go.sum',
      'pip:jinja2@2.10 poetry.lock', 'pip:requests@2.19.0 Pipfile.lock']);
  });
});

describe('collect: skąd wersje', () => {
  test('ekosystem z plikiem blokady → blokada (dokładnie, bezpośrednia/przechodnia); bez → manifest (przypięta albo dolna granica)', () => {
    const g = build([
      F('package.json', '{ "dependencies": { "lodash": "^4.17.15", "tool": "latest" } }'),
      F('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: '4.17.15' }, 'node_modules/minimist': { version: '1.2.0' } } })),
      F('requirements.txt', 'flask==1.0\nrequests>=2.19.0\nanything\n'),
    ]);
    const list = host(V.collect(g)).map((p) => [p.ecosystem, p.name, p.version, p.exact, p.direct, p.file]);
    assert.deepEqual(list, [
      ['npm', 'lodash', '4.17.15', true, true, 'package-lock.json'], ['npm', 'minimist', '1.2.0', true, false, 'package-lock.json'],
      ['PyPI', 'flask', '1.0', true, true, 'requirements.txt'], ['PyPI', 'requests', '2.19.0', false, true, 'requirements.txt']]);
  });
  test('norm: zakresy, tagi, ścieżki → null; v przy npm zdjęte; go wymaga v', () => {
    for (const bad of ['latest', '*', 'workspace:*', 'git+https://x/y.git', 'file:../a', '']) assert.equal(V.norm(bad, 'npm'), null, bad);
    assert.equal(V.norm('v1.2.3', 'npm'), '1.2.3');
    assert.equal(V.norm('1.9.0', 'go'), null);
    assert.equal(V.norm('v0.0.0-20210101-abcdef', 'go'), 'v0.0.0-20210101-abcdef');
  });
  test('CVSS 3.1: 9.8 / 6.1 / 0; ważność z GHSA ma pierwszeństwo', () => {
    assert.equal(V.cvss3('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'), 9.8);
    assert.equal(V.cvss3('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N'), 6.1);
    assert.equal(V.cvss3('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N'), 0);
    assert.deepEqual(host(V.severity({ database_specific: { severity: 'moderate' }, severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })), { level: 'MODERATE', score: null });
    assert.deepEqual(host(V.severity({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })), { level: 'CRITICAL', score: 9.8 });
  });
});

describe('query na podstawionym fetch + reguła Inspect', () => {
  const DB = {
    'GHSA-1': { id: 'GHSA-1', summary: 'Prototype pollution', database_specific: { severity: 'HIGH' },
      affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.19' }] }] }] },
    'GHSA-2': { id: 'GHSA-2', summary: 'ReDoS', database_specific: { severity: 'MODERATE' },
      affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }, { fixed: '3.0.0' }] }] }] },
  };
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, init && init.body ? JSON.parse(init.body) : null]);
    if (url.endsWith('/querybatch')) {
      const q = JSON.parse(init.body).queries;
      return { ok: true, json: async () => ({ results: q.map((x) => (x.package.name === 'lodash' ? { vulns: [{ id: 'GHSA-2' }, { id: 'GHSA-1' }] } : {})) }) };
    }
    const id = decodeURIComponent(url.split('/').pop());
    return DB[id] ? { ok: true, json: async () => DB[id] } : { ok: false, status: 404 };
  };
  const files = [
    F('package.json', '{ "dependencies": { "lodash": "^4.17.15" } }'),
    F('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: '4.17.15' }, 'node_modules/ok': { version: '1.0.0' } } })),
    F('src/a.js', "import _ from 'lodash';\n"),
  ];
  test('wysyłane są tylko nazwa, ekosystem i wersja; wynik z ważnością, poprawką i linkiem; applyToGraph', async () => {
    const g = build(files);
    const r = await V.query(V.collect(g), { fetch });
    assert.deepEqual(host(calls[0][1]), { queries: [{ package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.15' }, { package: { name: 'ok', ecosystem: 'npm' }, version: '1.0.0' }] });
    const it = host(r.vulnerable[0]);
    assert.equal(r.checked, 2); assert.equal(r.vulnerable.length, 1);
    assert.deepEqual([it.name, it.level, it.fixed, it.direct], ['lodash', 'HIGH', '4.17.21', true]);
    assert.deepEqual(it.vulns.map((v) => [v.id, v.level, v.fixed, v.url]), [['GHSA-1', 'HIGH', '4.17.19', 'https://osv.dev/vulnerability/GHSA-1'], ['GHSA-2', 'MODERATE', '4.17.21', 'https://osv.dev/vulnerability/GHSA-2']]);
    assert.equal(V.applyToGraph(g, r), 1);
    assert.equal(g.nodes.get('ext:lodash').vulns, 2);
    const res = host(await CM.Inspect.run(g)), f = res.findings.find((x) => x.rule === 'vulndep');
    assert.equal(f.sev, 'high');
    assert.equal(f.items[0].path, 'package-lock.json');
    assert.equal(f.items[0].detail, 'lodash 4.17.15: podatności 2 — GHSA-1 (HIGH), GHSA-2 (MODERATE) · poprawka: 4.17.21');
    const back = Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    assert.equal(back.lockDeps.size, 2); assert.equal(back.depVersions.get('lodash').file, 'package.json');
    assert.equal(back.vulnInfo.items[0].name, 'lodash');
  });
  test('limit szczegółów → truncated; błąd HTTP querybatch → wyjątek', async () => {
    const r = await V.query([{ name: 'lodash', version: '4.17.15', ecosystem: 'npm' }], { fetch, maxDetails: 1 });
    assert.equal(r.truncated, true); assert.equal(r.details, 1);
    await assert.rejects(V.query([{ name: 'x', version: '1.0.0', ecosystem: 'npm' }], { fetch: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  });
});
