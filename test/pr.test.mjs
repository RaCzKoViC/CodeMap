import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCodeMap } from '../cli/runtime.mjs';
import { findingKeys, diffFindings, assertRef, changedFiles, prReport, prMarkdown, baseline } from '../cli/pr.mjs';
import { CliError } from '../cli/strings.mjs';
import { git, gitAvailable } from '../tools/git-probe.mjs';

// Przegląd zmian w CLI (cli/pr.mjs): klucze i różnica znalezisk, walidacja refa, komentarz Markdown ze stanem
// zdrowia, raport PR na grafie oraz — z poleceniem git — zmienione pliki (M/A/D/R, podkatalog) i wynik bazowy z worktree.
const HAS_GIT = gitAvailable();
const report = (items) => ({ findings: items.map(([rule, sev, p, related, detail]) => ({ rule, title: 'T:' + rule, items: [{ path: p, sev, related, detail }] })) });

describe('klucze i różnica znalezisk', () => {
  test('klucz = reguła + ścieżka + posortowane powiązane; szczegół (liczby) nie wpływa na klucz', () => {
    const k = findingKeys(report([['cycles', 'high', 'a.js', ['c.js', 'b.js'], '3 pliki'], ['god', 'med', 'x.js', undefined, 'fan-in 40']]));
    assert.deepEqual([...k.keys()], ['cycles|a.js|b.js,c.js', 'god|x.js']);
    assert.equal(k.get('god|x.js').detail, 'fan-in 40');
    assert.deepEqual([...findingKeys(report([['cycles', 'high', 'a.js', ['b.js', 'c.js'], '9 plików']])).keys()], ['cycles|a.js|b.js,c.js']);
  });
  test('diffFindings: nowe posortowane wg ważności (potem reguły), usunięte osobno', () => {
    const base = findingKeys(report([['god', 'med', 'x.js'], ['todo', 'info', 'y.js']]));
    const d = diffFindings(base, report([['god', 'med', 'x.js'], ['orphan', 'low', 'z.js'], ['cycles', 'high', 'a.js', ['b.js']], ['archviolation', 'high', 'q.js']]));
    assert.deepEqual(d.added.map((x) => x.rule), ['archviolation', 'cycles', 'orphan']);
    assert.deepEqual(d.removed.map((x) => x.path), ['y.js']);
  });
});

describe('assertRef', () => {
  test('ref z niedozwolonymi znakami albo zaczynający się od „-" → czytelny błąd bez uruchamiania gita', () => {
    for (const ref of ['-x', '--output=/tmp/x', 'a b', '$(rm -rf)', 'x;y', 'a'.repeat(201), '']) {
      assert.throws(() => assertRef(os.tmpdir(), ref, 'pl'), (e) => e instanceof CliError && e.message.includes('nie znaleziono refa bazowego'), JSON.stringify(ref));
    }
    assert.throws(() => assertRef(os.tmpdir(), '-x', 'en'), /base ref "-x" not found/);
  });
});

describe('prReport / prMarkdown', () => {
  const CM = loadCodeMap({ lang: 'pl' });
  const g = new CM.Graph.Graph();
  g.build([{ path: 'src/a.js', size: 40, content: "import './b.js';\nexport const a = 1;\n" }, { path: 'src/b.js', size: 20, content: 'export const b = 1;\n' }], { name: 'demo' });
  const files = [{ path: 'src/b.js', status: 'M', add: 5, del: 1 }, { path: 'docs/new.md', status: 'A', add: 3, del: 0 }];
  test('raport PR: zwykły obiekt (bez Map), zależne, pliki spoza mapy', () => {
    const r = prReport(CM, g, files, {});
    assert.equal(r.impacted, 1, 'a.js importuje zmieniony b.js');
    assert.equal(r.direct, 1);
    assert.deepEqual(r.changed.map((c) => [c.path, c.status, c.add, c.del]), [['src/b.js', 'M', 5, 1]]);
    assert.deepEqual(r.outside.map((c) => c.path), ['docs/new.md']);
    assert.deepEqual([r.add, r.del], [8, 1]);
    assert.ok(['low', 'med', 'high'].includes(r.level));
  });
  test('komentarz: stan zdrowia względem bazy ze znakiem, nowe znaleziska (do 10 + „…i N więcej"), usunięte', () => {
    const added = Array.from({ length: 12 }, (_, i) => ({ rule: 'r' + i, title: 'Tytuł ' + i, sev: i ? 'low' : 'high', path: 'f' + i + '.js', detail: i === 0 ? '3 pliki' : '' }));
    const md = prMarkdown(CM, g, files, { number: 7, title: 'Zmiana' }, { lang: 'pl', link: 'https://x/#repo=o/r&pr=7', score: 60, baseline: { ref: 'origin/main', score: 65 }, diff: { added, removed: [{}, {}] } });
    assert.match(md, /^### CodeMap — wpływ PR #7: Zmiana/);
    assert.match(md, /\*\*Stan zdrowia:\*\* 60\/100 \(−5 względem `origin\/main`: 65\)/);
    assert.match(md, /\*\*Nowe znaleziska \(12\):\*\* \n- 🔴 Tytuł 0 — `f0\.js` \(3 pliki\)\n- 🟡 Tytuł 1 — `f1\.js`\n/);
    assert.match(md, /…i 2 więcej/);
    assert.match(md, /\*\*Usunięte znaleziska:\*\* 2/);
    assert.match(md, /\[🗺️ Otwórz mapę wpływu\]\(https:\/\/x\/#repo=o\/r&pr=7\)/);
    assert.ok(md.endsWith('\n'));
    const en = prMarkdown(CM, g, files, {}, { lang: 'en', score: 70, baseline: { ref: 'main', score: 70 }, diff: { added: [], removed: [] } });
    assert.match(en, /\*\*Health:\*\* 70\/100 \(±0 vs `main`: 70\)/);
    assert.match(en, /\*\*New findings \(0\):\*\* none/);
    assert.ok(!/Resolved/.test(en));
    const noBase = prMarkdown(CM, g, files);
    assert.ok(!/Stan zdrowia/.test(noBase));
  });
});

describe('z repozytorium git', { skip: HAS_GIT ? false : 'brak polecenia git' }, () => {
  let repo;
  const put = (rel, text) => { const p = path.join(repo, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const commit = (msg) => { git(repo, ['add', '-A']); git(repo, ['-c', 'user.name=T', '-c', 'user.email=t@e.pl', 'commit', '-q', '-m', msg]); };
  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-pr-'));
    git(repo, ['init', '-q', '-b', 'main']);
    for (const [k, v] of [['core.autocrlf', 'false'], ['commit.gpgsign', 'false'], ['gc.auto', '0']]) git(repo, ['config', k, v]);
    put('src/a.js', 'a1\na2\na3\n'); put('src/b.js', 'b\n'); put('lib/moved.js', 'export const m = 1;\n'.repeat(5)); put('docs/x.md', '# x\n');
    commit('baza');
    git(repo, ['checkout', '-q', '-b', 'feature']);
    put('src/a.js', 'a1\nzmiana\na3\nnowa\n'); fs.rmSync(path.join(repo, 'src', 'b.js'));
    put('src/zażółć.js', 'x\n'); fs.renameSync(path.join(repo, 'lib', 'moved.js'), path.join(repo, 'src', 'moved.js'));
    put('docs/x.md', '# y\n');
    commit('feature');
  });
  after(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  test('changedFiles: M / A / D / R z liczbą linii, nazwy UTF-8 bez cytowania', () => {
    const f = changedFiles(repo, 'main', '', 'pl').sort((a, b) => (a.path < b.path ? -1 : 1));
    assert.deepEqual(f.map((x) => [x.path, x.status, x.from, x.add, x.del]), [
      ['docs/x.md', 'M', undefined, 1, 1], ['src/a.js', 'M', undefined, 2, 1], ['src/b.js', 'D', undefined, 0, 1],
      ['src/moved.js', 'R', 'lib/moved.js', 0, 0], ['src/zażółć.js', 'A', undefined, 1, 0]]);
  });
  test('changedFiles z podkatalogiem: ścieżki względne, pliki spoza pominięte, przeniesienie spoza = dodanie', () => {
    const f = changedFiles(repo, 'main', 'src/', 'pl').sort((a, b) => (a.path < b.path ? -1 : 1));
    assert.deepEqual(f.map((x) => [x.path, x.status, x.from]), [['a.js', 'M', undefined], ['b.js', 'D', undefined], ['moved.js', 'A', undefined], ['zażółć.js', 'A', undefined]]);
    assert.throws(() => changedFiles(repo, 'nie-ma-takiej', '', 'pl'), /nie znaleziono refa bazowego „nie-ma-takiej"/);
  });
  test('baseline: analiza w tymczasowym worktree gałęzi bazowej (z podkatalogiem), sprzątanie po sobie', async () => {
    let seen = null;
    const r = await baseline(repo, 'main', 'src', async (dir, opts) => {
      seen = dir; assert.ok(fs.existsSync(path.join(dir, 'b.js')), 'stan gałęzi main'); assert.deepEqual(opts, { lang: 'pl' });
      return { report: { score: 81, totals: { findings: 1 }, findings: [{ rule: 'orphan', title: 'x', items: [{ path: 'b.js', sev: 'low' }] }] } };
    }, { lang: 'pl' }, 'pl');
    assert.deepEqual([r.ref, r.score, [...r.keys.keys()]], ['main', 81, ['orphan|b.js']]);
    assert.ok(!fs.existsSync(seen), 'worktree usunięty');
    assert.ok(!String(git(repo, ['worktree', 'list'])).includes('codemap-base-'));
  });
});
