import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM } from './harness.mjs';

// Pamięć analizy bez OPFS (Node): klucz projektu i ciche wyłączenie; zapis/odczyt sprawdza smoke w przeglądarce.
const CM = loadCM(['util', 'analysis-cache']);
const AC = CM.AnalysisCache;

describe('pamięć analizy — klucz projektu', () => {
  test('ten sam folder / repozytorium = ten sam klucz; inna gałąź, podkatalog albo źródło = inny', () => {
    const gh = { kind: 'github', host: 'github', repo: 'o/r', branch: 'main', name: 'r' };
    assert.equal(AC.projectKey(gh), AC.projectKey({ ...gh }));
    assert.notEqual(AC.projectKey(gh), AC.projectKey({ ...gh, branch: 'dev' }));
    assert.notEqual(AC.projectKey(gh), AC.projectKey({ ...gh, sub: 'src' }));
    assert.notEqual(AC.projectKey({ kind: 'local', name: 'app', source: 'local: app' }), AC.projectKey({ kind: 'local', name: 'app', source: 'upuszczone: app' }));
    assert.match(AC.projectKey(gh), /^p[0-9a-z]+-[0-9a-z]+$/);
    assert.equal(AC.projectKey(null), null);
  });
  test('bez OPFS: load → null, save → false, stats → niedostępna (bez wyjątków)', async () => {
    assert.equal(await AC.load({ kind: 'local', name: 'x' }, 'v1'), null);
    assert.equal(await AC.save({ kind: 'local', name: 'x' }, 'v1', new Map([['a.js', { hash: '1' }]]), new Map([['a.js', 1]])), false);
    assert.deepEqual({ ...(await AC.stats()) }, { available: false, projects: 0, bytes: 0 });
  });
});
