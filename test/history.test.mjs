// Trend zdrowia (`codemap analyze --history N`, cli/history.mjs): próbkowanie commitów, reguły wczytywania na
// ścieżkach z drzewa commita i pełny przebieg na prawdziwym, tymczasowym repozytorium (bez checkoutu).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sampleIndexes, healthHistory, historyMarkdown, historyTable } from '../cli/history.mjs';
import { acceptPath } from '../cli/fsload.mjs';
import { parseArgs } from '../cli/codemap.mjs';
import { loadCodeMap } from '../cli/runtime.mjs';
import { git, gitAvailable } from '../tools/git-probe.mjs';

describe('trend zdrowia: czyste funkcje', () => {
  test('sampleIndexes: równo z pierwszym i ostatnim, bez powtórzeń; n ≥ len → wszystkie; n = 1 → HEAD', () => {
    assert.deepEqual(sampleIndexes(10, 4), [0, 3, 6, 9]);
    assert.deepEqual(sampleIndexes(3, 10), [0, 1, 2]);
    assert.deepEqual(sampleIndexes(5, 1), [4]);
    assert.deepEqual(sampleIndexes(0, 3), []);
    assert.equal(new Set(sampleIndexes(7, 6)).size, 6);
  });
  test('acceptPath: katalogi pomijane (node_modules, dist) i globy --exclude także dla przodków', () => {
    const CM = loadCodeMap({ lang: 'pl' });
    assert.equal(acceptPath(CM, 'src/a.js', []), true);
    assert.equal(acceptPath(CM, 'node_modules/x/index.js', []), false);
    assert.equal(acceptPath(CM, 'pkg/dist/bundle.js', []), false);
    assert.equal(acceptPath(CM, 'vendor/lib/a.js', ['vendor']), false);
    assert.equal(acceptPath(CM, 'vendor/lib/a.js', ['vendor/**']), false);
    assert.equal(acceptPath(CM, 'src/vendor.js', ['vendor']), true);
  });
  test('--history N w parseArgs (1…200)', () => {
    const RULES = ['cycles'];
    assert.equal(parseArgs(['analyze', '--history', '12'], RULES).history, 12);
    assert.equal(parseArgs(['analyze', '--history=999'], RULES).history, 200);
    assert.equal(parseArgs(['analyze'], RULES).history, null);
    assert.throws(() => parseArgs(['analyze', '--history', 'x'], RULES));
  });
});

describe('trend zdrowia na prawdziwym repozytorium', { skip: gitAvailable() ? false : 'brak polecenia git' }, () => {
  let dir;
  const write = (rel, text) => { const p = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const commit = (msg, day) => { git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', msg], { env: { GIT_AUTHOR_DATE: `2026-01-0${day}T12:00:00Z`, GIT_COMMITTER_DATE: `2026-01-0${day}T12:00:00Z` } }); };
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-hist-'));
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.name', 'Ala Kowalska']); git(dir, ['config', 'user.email', 'ala@example.com']);
    write('src/a.js', 'export const a = 1;\n'); commit('pierwszy', 1);
    write('src/b.js', "import { a } from './a.js';\ntry { a(); } catch (e) {}\nexport const b = a;\n"); commit('drugi: pusty catch', 2);
    write('node_modules/x/index.js', 'module.exports = 1;\n'); write('gen/big.js', 'export const g = 1;\n'); commit('trzeci: zależności i generowane', 3);
    write('src/b.js', "import { a } from './a.js';\nexport const b = a;\n"); commit('czwarty: bez pustego catch', 4);
  });
  after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  test('4 punkty od najstarszego: pliki bez node_modules i --exclude, reguły per commit, wynik wraca po poprawce', async () => {
    const h = await healthHistory(dir, '', 10, { exclude: ['gen/**'] });
    assert.equal(h.chain, 4);
    assert.deepEqual(h.points.map((p) => p.message), ['pierwszy', 'drugi: pusty catch', 'trzeci: zależności i generowane', 'czwarty: bez pustego catch']);
    assert.deepEqual(h.points.map((p) => p.files), [1, 2, 2, 2]);
    assert.deepEqual(h.points.map((p) => p.rules.emptycatch || 0), [0, 1, 1, 0]);
    assert.equal(h.points[0].date, '2026-01-01');
    assert.ok(h.points[1].score < h.points[0].score && h.points[3].score > h.points[1].score);
    const md = historyMarkdown(h, 'pl');
    assert.match(md, /## Trend zdrowia/);
    assert.match(md, /\| 2026-01-02 \| `[0-9a-f]{7}` \|/);
    assert.match(historyTable(h, 'en'), /Health trend — 4 of 4 commits/);
  });
  test('podkatalog: ścieżki względem niego; 2 punkty = pierwszy i HEAD', async () => {
    const h = await healthHistory(dir, 'src', 2);
    assert.deepEqual(h.points.map((p) => p.message), ['pierwszy', 'czwarty: bez pustego catch']);
    assert.deepEqual(h.points.map((p) => p.files), [1, 2]);
  });
});
