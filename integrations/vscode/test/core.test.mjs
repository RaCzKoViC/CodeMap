// Czysta logika rozszerzenia (src/core.js): ważności i progi, ścieżki (Windows i posix), SARIF → diagnostyki,
// pasek stanu, CodeLens, walidacja wiadomości z webview, debounce analizy przy zapisie.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { require } from './helpers.mjs';

const core = require('../src/core.js');

describe('ważności i progi', () => {
  test('ranking i próg minSeverity', () => {
    assert.deepEqual(core.SEVS, ['high', 'med', 'low', 'info']);
    assert.ok(core.passes('high', 'low') && core.passes('low', 'low') && !core.passes('info', 'low'));
    assert.ok(core.passes('info', 'info') && !core.passes('med', 'high') && core.passes('high', 'high'));
    assert.ok(core.passes('low', 'bogus') && !core.passes('info', 'bogus'), 'nieznany próg = domyślny low');
  });
  test('ważność wyniku SARIF: properties.severity, inaczej level', () => {
    assert.equal(core.resultSeverity({ level: 'note', properties: { severity: 'info' } }), 'info');
    assert.equal(core.resultSeverity({ level: 'error' }), 'high');
    assert.equal(core.resultSeverity({ level: 'warning' }), 'med');
    assert.equal(core.resultSeverity({ level: 'note' }), 'low');
    assert.equal(core.resultSeverity({}), 'low');
  });
  test('język: ustawienie albo język VS Code', () => {
    assert.equal(core.resolveLang('auto', 'pl'), 'pl');
    assert.equal(core.resolveLang('auto', 'pl-PL'), 'pl');
    assert.equal(core.resolveLang('auto', 'en-US'), 'en');
    assert.equal(core.resolveLang('auto', 'de'), 'en');
    assert.equal(core.resolveLang('en', 'pl'), 'en');
    assert.equal(core.resolveLang('pl', 'en'), 'pl');
  });
  test('odmiana liczebnika PL / EN', () => {
    const f = ['zmiana', 'zmiany', 'zmian'];
    assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 25, 112].map((n) => core.plural('pl', n, f)),
      ['zmiana', 'zmiany', 'zmiany', 'zmian', 'zmian', 'zmian', 'zmiany', 'zmian', 'zmian']);
    assert.deepEqual([1, 2].map((n) => core.plural('en', n, ['change', 'changes'])), ['change', 'changes']);
  });
});

describe('ścieżki', () => {
  test('URI z SARIF → ścieżka względna (dekodowanie, prefiks podkatalogu)', () => {
    assert.equal(core.sarifUriToRel('src/my%20file.js', ''), 'src/my file.js');
    assert.equal(core.sarifUriToRel('pkg/sub/src/a.js', 'pkg/sub'), 'src/a.js');
    assert.equal(core.sarifUriToRel('other/src/a.js', 'pkg'), null, 'plik spoza podkatalogu');
    assert.equal(core.sarifUriToRel('pkg', 'pkg'), null);
    for (const bad of ['../x.js', 'a/../../x', '', null, 'a//b', 'a/%2e%2e/b', 'a\\b', '%E0%A4%A']) assert.equal(core.sarifUriToRel(bad, ''), null, String(bad));
    assert.equal(core.reportSub({ project: { path: '.' } }), '');
    assert.equal(core.reportSub({ project: { path: 'pkg/x' } }), 'pkg/x');
  });

  test('resolveMapPath — Windows', () => {
    const W = path.win32, root = 'C:\\proj', roots = ['C:\\proj', 'D:\\other'];
    assert.equal(core.resolveMapPath('src/a.js', root, roots, W), 'C:\\proj\\src\\a.js');
    assert.equal(core.resolveMapPath('src\\a.js', root, roots, W), 'C:\\proj\\src\\a.js');
    assert.equal(core.resolveMapPath('./src/./a.js', root, roots, W), 'C:\\proj\\src\\a.js');
    for (const bad of ['../secret.txt', 'src/../../x', 'C:\\Windows\\win.ini', 'C:/Windows/win.ini', 'D:x', '\\\\server\\share\\x',
      '//server/share/x', '/etc/passwd', '\\x', '', 'a\0b', 42, null, undefined, '..', 'src/..\\..\\x']) {
      assert.equal(core.resolveMapPath(bad, root, roots, W), null, JSON.stringify(bad));
    }
    // analizowany folder poza folderami workspace → odrzucone
    assert.equal(core.resolveMapPath('a.js', 'E:\\elsewhere', roots, W), null);
    // wielkość liter bez znaczenia na Windows
    assert.equal(core.resolveMapPath('a.js', 'c:\\PROJ', roots, W), 'c:\\PROJ\\a.js');
  });

  test('resolveMapPath — posix', () => {
    const P = path.posix, root = '/home/u/proj', roots = ['/home/u/proj'];
    assert.equal(core.resolveMapPath('src/a.js', root, roots, P), '/home/u/proj/src/a.js');
    for (const bad of ['../x', '/etc/passwd', 'src/../../x', 'C:\\x', '//x/y']) assert.equal(core.resolveMapPath(bad, root, roots, P), null, bad);
    assert.equal(core.resolveMapPath('a.js', '/home/u/PROJ', roots, P), null, 'posix rozróżnia wielkość liter');
    assert.equal(core.relToRoot('/home/u/proj/src/a.js', root, P), 'src/a.js');
    assert.equal(core.relToRoot('/home/u/proj', root, P), '');
    assert.equal(core.relToRoot('/home/u/other/a.js', root, P), null);
    assert.equal(core.relToRoot('C:\\proj\\src\\a.js', 'c:\\proj', path.win32), 'src/a.js');
  });

  test('linia SARIF → indeks 0…', () => {
    assert.deepEqual([1, 5, 0, -3, 1.5, 'x', undefined].map(core.lineIndex), [0, 4, 0, 0, 0, 0, 0]);
  });
});

// SARIF w kształcie z cli/sarif.mjs (podkatalog 'pkg' repozytorium)
const loc = (uri, line, text) => ({ ...(text ? { message: { text } } : {}), physicalLocation: { artifactLocation: { uri, uriBaseId: '%SRCROOT%' }, region: { startLine: line } } });
const SARIF = {
  version: '2.1.0',
  runs: [{
    results: [
      { ruleId: 'cycles', level: 'error', message: { text: 'Cykle: a.js → b.js' }, properties: { severity: 'high' },
        locations: [loc('pkg/src/a.js', 1)], relatedLocations: [{ id: 1, ...loc('pkg/src/b.js', 1, 'b.js') }, { id: 2, ...loc('pkg/src/c.js', 1, 'c.js') }] },
      { ruleId: 'dupcode', level: 'warning', message: { text: 'Duplikaty' }, properties: { severity: 'med' },
        locations: [loc('pkg/src/b.js', 1)], relatedLocations: [{ id: 1, ...loc('pkg/lib/x%20y.js', 1, 'x y.js') }] },
      { ruleId: 'orphan', level: 'note', message: { text: 'Sierota' }, properties: { severity: 'low' }, locations: [loc('pkg/src/my%20file.js', 1)] },
      { ruleId: 'todo', level: 'note', message: { text: 'TODO' }, properties: { severity: 'info' }, locations: [loc('pkg/src/a.js', 7)] },
      { ruleId: 'god', level: 'warning', message: { text: 'Spoza podkatalogu' }, properties: { severity: 'med' }, locations: [loc('other/z.js', 1)] },
      { ruleId: 'archviolation', level: 'error', message: { text: 'Naruszenie $& $1' }, properties: { severity: 'high' },
        locations: [loc('pkg/src/c.js', 3)], relatedLocations: [{ id: 1, ...loc('pkg/src/a.js', 1, 'a.js') }] },
    ],
  }],
};

describe('SARIF → opisy diagnostyk', () => {
  const root = path.resolve('/work/repo/pkg');
  const J = (...s) => path.join(root, ...s);
  test('próg low: pliki, linie, ważności, powiązane pliki, pominięte info i ścieżki spoza podkatalogu', () => {
    const r = core.sarifToSpecs(SARIF, { root, sub: 'pkg', minSeverity: 'low', lang: 'pl' });
    assert.equal(r.total, 6);
    assert.equal(r.shown, 4);
    assert.equal(r.hidden, 2);
    assert.deepEqual([...r.files.keys()].sort(), [J('src', 'a.js'), J('src', 'b.js'), J('src', 'c.js'), J('src', 'my file.js')].sort());
    const [cyc] = r.files.get(J('src', 'a.js'));
    assert.equal(cyc.rule, 'cycles');
    assert.equal(cyc.sev, 'high');
    assert.equal(cyc.line, 0);
    assert.deepEqual(cyc.related.map((x) => [x.file, x.line, x.message]), [[J('src', 'b.js'), 0, 'cykl: b.js'], [J('src', 'c.js'), 0, 'cykl: c.js']]);
    const [dup] = r.files.get(J('src', 'b.js'));
    assert.deepEqual(dup.related.map((x) => [x.file, x.message]), [[J('lib', 'x y.js'), 'duplikat: x y.js']]);
    const [arch] = r.files.get(J('src', 'c.js'));
    assert.equal(arch.line, 2);
    assert.equal(arch.message, 'Naruszenie $& $1');
    assert.equal(arch.related[0].message, 'cel importu: a.js');
  });
  test('progi info / high i język EN', () => {
    const all = core.sarifToSpecs(SARIF, { root, sub: 'pkg', minSeverity: 'info', lang: 'en' });
    assert.equal(all.shown, 5);
    assert.equal(all.files.get(J('src', 'a.js')).length, 2);
    assert.equal(all.files.get(J('src', 'a.js'))[1].line, 6);
    assert.equal(all.files.get(J('src', 'a.js'))[0].related[0].message, 'cycle: b.js');
    const high = core.sarifToSpecs(SARIF, { root, sub: 'pkg', minSeverity: 'high', lang: 'en' });
    assert.deepEqual([...high.files.values()].flat().map((s) => s.rule).sort(), ['archviolation', 'cycles']);
  });
  test('pusty / uszkodzony SARIF', () => {
    assert.equal(core.sarifToSpecs(null, { root }).shown, 0);
    assert.equal(core.sarifToSpecs({ runs: [{ results: [{ ruleId: 'x' }] }] }, { root }).shown, 0);
  });
});

const REPORT = {
  project: { name: 'demo', path: '.' }, score: 42,
  totals: { findings: 20, high: 3, med: 10, low: 5, info: 2 },
  git: { busFactor: { value: 1, authors: ['Jan *Kowalski*'] } },
  hotspots: [{ path: 'src/app_main.js', changes: 16, recent: 16, complexity: 669, score: 1 }, { path: 'src/b.js', changes: 3, complexity: 12, score: 1 }],
  findings: [{ rule: 'silo', items: [{ path: 'src/c.js', kind: 'file' }, { path: 'src', kind: 'folder' }] }],
};

describe('pasek stanu', () => {
  test('tekst, tooltip (ważności, bus factor, hotspoty), ostrzeżenie < 50', () => {
    const s = core.statusSpec(REPORT, 'pl', 'demo');
    assert.equal(s.text, '$(pulse) CodeMap 42');
    assert.equal(s.warn, true);
    assert.match(s.tooltip, /health score \*\*42\/100\*\*/);
    assert.match(s.tooltip, /wysokie 3 · średnie 10 · niskie 5 · info 2/);
    assert.match(s.tooltip, /Bus factor: \*\*1\*\* \(Jan \\\*Kowalski\\\*\)/, 'nazwiska escapowane w Markdown');
    assert.match(s.tooltip, /src\/app\\_main\\\.js — 16 × 669/);
    const en = core.statusSpec({ ...REPORT, score: 90, git: null, hotspots: [] }, 'en', 'demo');
    assert.equal(en.warn, false);
    assert.match(en.tooltip, /high 3 · medium 10 · low 5 · info 2/);
    assert.match(en.tooltip, /no git history/);
    assert.equal(core.statusSpec(null, 'en').text, '$(pulse) CodeMap');
  });
});

describe('CodeLens', () => {
  const result = {
    report: REPORT,
    graph: {
      gitInfo: { authors: [{ name: 'Anna' }, { name: 'Jan' }] },
      nodes: [
        { id: 'src/app_main.js', path: 'src/app_main.js', type: 'file', metrics: { complexity: 669 }, git: { c: 16, own: 1, share: 0.82 } },
        { id: 'src/c.js', path: 'src/c.js', type: 'file', metrics: { complexity: 4 }, git: { c: 1, own: 0, share: 1 } },
        { id: 'src/quiet.js', path: 'src/quiet.js', type: 'file', metrics: { complexity: 9 }, git: { c: 2, own: 0, share: 1 } },
        { id: 'src', path: 'src', type: 'folder' },
      ],
    },
  };
  test('tytuły dla hotspotów i plików z ryzykiem git, nic dla pozostałych', () => {
    const idx = core.lensIndex(result);
    assert.equal(core.lensTitle(idx, 'src/app_main.js', 'pl'), 'CodeMap: 16 zmian × złożoność 669 · właściciel Jan (82 %) · hotspot #1');
    assert.equal(core.lensTitle(idx, 'src/app_main.js', 'en'), 'CodeMap: 16 changes × complexity 669 · owner Jan (82%) · hotspot #1');
    assert.equal(core.lensTitle(idx, 'src/c.js', 'pl'), 'CodeMap: 1 zmiana × złożoność 4 · właściciel Anna (100 %)');
    assert.equal(core.lensTitle(idx, 'src/quiet.js', 'pl'), null);
    assert.equal(core.lensTitle(idx, 'src/b.js', 'pl'), null, 'hotspot bez danych git w grafie');
    assert.equal(core.lensTitle(idx, 'nope.js', 'pl'), null);
  });
  test('bez historii git — brak CodeLens', () => {
    const idx = core.lensIndex({ ...result, report: { ...REPORT, git: null } });
    assert.equal(core.lensTitle(idx, 'src/app_main.js', 'pl'), null);
  });
});

describe('wiadomości z webview', () => {
  test('codemap:open — walidacja typu, ścieżki i linii', () => {
    assert.deepEqual(core.parseOpenMessage({ type: 'codemap:open', path: 'src/a.js', line: 12 }), { path: 'src/a.js', line: 12 });
    assert.deepEqual(core.parseOpenMessage({ type: 'codemap:open', path: 'src/a.js', line: '3' }), { path: 'src/a.js', line: 3 });
    assert.deepEqual(core.parseOpenMessage({ type: 'codemap:open', path: 'src/a.js', line: -1 }), { path: 'src/a.js' });
    assert.deepEqual(core.parseOpenMessage({ type: 'codemap:open', path: 'src/a.js', line: 1.5 }), { path: 'src/a.js' });
    for (const bad of [null, 'x', { type: 'other', path: 'a' }, { type: 'codemap:open' }, { type: 'codemap:open', path: 7 },
      { type: 'codemap:open', path: '' }, { type: 'codemap:open', path: 'x'.repeat(5000) }]) assert.equal(core.parseOpenMessage(bad), null);
  });
});

describe('analiza przy zapisie: debounce 1,5 s i przerywanie poprzedniego przebiegu', () => {
  function fakeTimers() {
    let now = 0, seq = 0; const q = new Map();
    return {
      setTimeout(fn, ms) { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; },
      clearTimeout(id) { q.delete(id); },
      async tick(ms) {
        now += ms;
        for (const [id, t] of [...q].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { q.delete(id); t.fn(); }
        await new Promise((r) => setImmediate(r));
      },
    };
  }
  test('seria zapisów → jeden przebieg po 1,5 s od ostatniego', async () => {
    const timers = fakeTimers(); const runs = [];
    const s = core.createScheduler((signal) => { runs.push(signal); return new Promise(() => {}); }, { timers });
    s.trigger(); await timers.tick(1000); s.trigger(); await timers.tick(1000); s.trigger();
    assert.equal(runs.length, 0);
    assert.ok(s.pending);
    await timers.tick(1499);
    assert.equal(runs.length, 0);
    await timers.tick(1);
    assert.equal(runs.length, 1);
    assert.ok(s.running && !s.pending);
  });
  test('nowy przebieg przerywa trwający; cancel() przerywa i kasuje termin; dispose() blokuje', async () => {
    const timers = fakeTimers(); const runs = [];
    const s = core.createScheduler((signal) => { runs.push(signal); return new Promise(() => {}); }, { timers, delay: core.SAVE_DELAY });
    s.trigger(); await timers.tick(1500);
    s.trigger();
    assert.equal(runs[0].aborted, false, 'poprzedni trwa do startu następnego');
    await timers.tick(1500);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].aborted, true);
    assert.equal(runs[1].aborted, false);
    s.trigger(); s.cancel();
    assert.equal(runs[1].aborted, true);
    await timers.tick(5000);
    assert.equal(runs.length, 2);
    s.dispose(); s.trigger(); await timers.tick(5000);
    assert.equal(runs.length, 2);
  });
  test('zakończony przebieg zwalnia stan running; błąd przebiegu nie wycieka', async () => {
    const timers = fakeTimers();
    let n = 0;
    const s = core.createScheduler(() => { n++; if (n === 1) throw new Error('boom'); return Promise.resolve(); }, { timers });
    s.trigger(); await timers.tick(1500); await new Promise((r) => setImmediate(r));
    assert.equal(s.running, false);
    s.trigger(); await timers.tick(1500); await new Promise((r) => setImmediate(r));
    assert.equal(n, 2);
    assert.equal(s.running, false);
  });
});
