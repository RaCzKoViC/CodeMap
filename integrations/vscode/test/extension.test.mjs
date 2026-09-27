// Rozszerzenie z atrapą `vscode` i podstawioną analizą (bez wątku roboczego): aktywacja i zgodność z
// package.json, Problems (ważności, próg, kody, relatedInformation), pasek stanu, mapa i nawigacja w obie
// strony (codemap:open spoza workspace odrzucone), analiza przy zapisie z debounce, CodeLens, czyszczenie.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { require, EXT_DIR, tmpBundle, tmpDir, rmDir, writeFiles } from './helpers.mjs';

const { createExtension, COMMANDS } = require('../src/extension.js');
const core = require('../src/core.js');
const { createVscodeMock, createContext } = require('./vscode-mock.cjs');
const PKG = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'));

let EXT = null, WS = null, OTHER = null;
before(() => {
  EXT = tmpBundle();
  WS = tmpDir('cm-vsc-ws-');
  OTHER = tmpDir('cm-vsc-other-');
  writeFiles(WS, { 'src/a.js': 'a\n'.repeat(20), 'src/b.js': 'b\n', 'src/c.js': 'c\n', 'img/logo.png': 'PNG' });
  writeFiles(OTHER, { 'secret.txt': 'x' });
});
after(() => { rmDir(EXT); rmDir(WS); rmDir(OTHER); });

const loc = (uri, line, text) => ({ ...(text ? { message: { text } } : {}), physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } });
function fakeResult(score = 42) {
  return {
    graph: { format: 'codemap', version: 2, meta: { name: 'ws' }, gitInfo: { authors: [{ name: 'Jan' }] },
      nodes: [{ id: 'src/a.js', path: 'src/a.js', type: 'file', metrics: { complexity: 30 }, git: { c: 5, own: 0, share: 1 } }], edges: [] },
    report: { project: { name: 'ws', path: '.' }, score, files: 3, totals: { findings: 3, high: 1, med: 1, low: 0, info: 1 },
      git: { busFactor: { value: 1, authors: ['Jan'] } }, hotspots: [{ path: 'src/a.js', changes: 5, complexity: 30, score: 1 }], findings: [], warnings: ['uwaga testowa'], timing: { totalMs: 5 } },
    sarif: { version: '2.1.0', runs: [{ results: [
      { ruleId: 'cycles', level: 'error', message: { text: 'Cykl' }, properties: { severity: 'high' }, locations: [loc('src/a.js', 3)],
        relatedLocations: [{ id: 1, ...loc('src/b.js', 2, 'b.js') }] },
      { ruleId: 'god', level: 'warning', message: { text: 'God' }, properties: { severity: 'med' }, locations: [loc('src/b.js', 1)] },
      { ruleId: 'todo', level: 'note', message: { text: 'TODO' }, properties: { severity: 'info' }, locations: [loc('src/c.js', 1)] },
    ] }] },
    markdown: '# x',
  };
}

function setup({ settings = {}, language = 'pl', analyze, responses } = {}) {
  const m = createVscodeMock({ folders: [WS, OTHER], settings, language, responses });
  const calls = [];
  const timers = { q: [], setTimeout(fn, ms) { const t = { fn, ms }; this.q.push(t); return t; }, clearTimeout(t) { this.q = this.q.filter((x) => x !== t); },
    flush() { const q = this.q; this.q = []; for (const t of q) t.fn(); } };
  const ext = createExtension(m.vscode, {
    timers,
    analyze: analyze || ((root, opts, o) => { calls.push({ root, opts, signal: o.signal }); return Promise.resolve(fakeResult()); }),
  });
  const ctx = createContext(EXT);
  const api = ext.activate(ctx);
  return { ...m, ext, api, ctx, calls, timers };
}
const tick = () => new Promise((r) => setImmediate(r));
const collection = (S) => S.collections[0];

describe('aktywacja i manifest', () => {
  test('polecenia z package.json zarejestrowane, klucze nls w obu językach, domyślne ustawienia zgodne z core', () => {
    const s = setup();
    const declared = PKG.contributes.commands.map((c) => c.command).sort();
    assert.deepEqual(declared, [...COMMANDS].sort());
    assert.deepEqual([...s.state.commands.keys()].sort(), declared);
    const menus = Object.values(PKG.contributes.menus).flat().map((x) => x.command);
    for (const c of menus) assert.ok(declared.includes(c), c);
    const en = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.nls.json'), 'utf8'));
    const pl = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.nls.pl.json'), 'utf8'));
    const keys = [...JSON.stringify(PKG).matchAll(/"%([\w.]+)%"/g)].map((x) => x[1]);
    for (const k of keys) { assert.ok(en[k], 'en: ' + k); assert.ok(pl[k], 'pl: ' + k); }
    assert.deepEqual(Object.keys(en).sort(), Object.keys(pl).sort());
    const props = PKG.contributes.configuration.properties;
    for (const [k, v] of Object.entries(core.DEFAULTS)) assert.deepEqual(props['codemap.' + k].default, v, k);
    assert.deepEqual(props['codemap.minSeverity'].enum, ['info', 'low', 'med', 'high']);
    assert.equal(PKG.publisher, 'raczkovic');
    // kopia CLI wymaga Node ≥ 20.6 (import { openAsBlob } from 'node:fs'); VS Code 1.90 = pierwszy z Node 20
    assert.equal(PKG.engines.vscode, '^1.90.0');
    assert.equal(PKG.main, './src/extension.js');
    assert.ok(fs.existsSync(path.join(EXT_DIR, PKG.main)));
    for (const k of ['bundle', 'test', 'package']) assert.ok(PKG.scripts[k], k);
    assert.equal(s.state.collections[0].name, 'codemap');
    assert.equal(s.state.statusItems[0].text, '$(pulse) CodeMap');
    assert.equal(s.state.statusItems[0].command, 'codemap.openMap');
    assert.equal(s.state.statusItems[0].visible, true);
    assert.equal(s.state.lensProviders.length, 1);
    assert.ok(s.ctx.subscriptions.length >= 10);
  });
});

describe('analiza → Problems i pasek stanu', () => {
  test('diagnostyki: ważności, zakres z linii, kod z linkiem, relatedInformation, próg low pomija info', async () => {
    const s = setup({ settings: { 'codemap.git': false, 'codemap.exclude': ['gen/**', 7] } });
    s.state.activeEditor = { document: { uri: s.vscode.Uri.file(path.join(WS, 'src', 'a.js')) } };
    await s.state.commands.get('codemap.analyze')();
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].root, WS);
    assert.deepEqual(s.calls[0].opts, { lang: 'pl', git: false, exclude: ['gen/**'] });
    const V = s.vscode, C = collection(s.state);
    const a = C.get(V.Uri.file(path.join(WS, 'src', 'a.js')));
    assert.equal(a.length, 1);
    assert.equal(a[0].severity, V.DiagnosticSeverity.Error);
    assert.equal(a[0].source, 'CodeMap');
    assert.equal(a[0].message, 'Cykl');
    assert.deepEqual([a[0].range.start.line, a[0].range.start.character, a[0].range.end.line], [2, 0, 2]);
    assert.equal(a[0].code.value, 'cycles');
    assert.equal(a[0].code.target.toString(), core.RULE_DOC);
    assert.equal(a[0].relatedInformation.length, 1);
    assert.equal(a[0].relatedInformation[0].location.uri.fsPath, path.join(WS, 'src', 'b.js'));
    assert.equal(a[0].relatedInformation[0].location.range.start.line, 1);
    assert.equal(a[0].relatedInformation[0].message, 'cykl: b.js');
    assert.equal(C.get(V.Uri.file(path.join(WS, 'src', 'b.js')))[0].severity, V.DiagnosticSeverity.Warning);
    assert.equal(C.get(V.Uri.file(path.join(WS, 'src', 'c.js'))), undefined, 'info poniżej progu low');
    // powiadomienie z liczbą znalezisk; progres z anulowaniem
    const info = s.state.messages.find((x) => x.level === 'info');
    assert.match(info.text, /health score 42\/100, znalezisk: 3 \(w Problems: 2\)/);
    assert.deepEqual(info.items, ['Otwórz mapę', 'Pokaż Problems']);
    assert.equal(s.state.progress[0].opts.cancellable, true);
    assert.equal(s.state.progress[0].opts.location, V.ProgressLocation.Notification);
    // pasek stanu
    const st = s.state.statusItems[0];
    assert.equal(st.text, '$(pulse) CodeMap 42');
    assert.match(st.tooltip.value, /wysokie 1 · średnie 1 · info 1/);
    assert.equal(st.tooltip.isTrusted, false);
    assert.equal(st.backgroundColor.id, 'statusBarItem.warningBackground');
    assert.ok(s.state.output.some((l) => /uwaga testowa/.test(l)), 'ostrzeżenia analizy w kanale wyjścia');
    // zmiana progu → ponowna publikacja bez analizy
    s.state.settings['codemap.minSeverity'] = 'info';
    s.fire.config(['codemap.minSeverity']);
    assert.equal(C.get(V.Uri.file(path.join(WS, 'src', 'c.js')))[0].severity, V.DiagnosticSeverity.Hint);
    s.state.settings['codemap.minSeverity'] = 'high';
    s.fire.config(['codemap.minSeverity']);
    assert.equal(C.map.size, 1);
    assert.equal(s.calls.length, 1);
    // czyszczenie
    await s.state.commands.get('codemap.clear')();
    assert.equal(C.map.size, 0);
    assert.equal(st.text, '$(pulse) CodeMap');
  });

  test('ponowna analiza zastępuje diagnostyki; anulowanie z paska postępu; błąd analizy → komunikat', async () => {
    let n = 0;
    const s = setup({ analyze: (root, opts, o) => {
      n++;
      if (n === 2) return new Promise((resolve, reject) => o.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      if (n === 3) return Promise.reject(Object.assign(new Error('Nie ma katalogu'), { cli: true }));
      const r = fakeResult(80); r.sarif.runs[0].results = r.sarif.runs[0].results.slice(1); return Promise.resolve(r);
    } });
    s.state.activeEditor = { document: { uri: s.vscode.Uri.file(path.join(WS, 'src', 'a.js')) } };
    await s.state.commands.get('codemap.analyze')();
    const C = collection(s.state);
    assert.equal(C.map.size, 1, 'tylko b.js (bez cyklu)');
    const p = s.state.commands.get('codemap.analyze')();
    await tick();
    assert.equal(s.state.statusItems[0].text, '$(sync~spin) CodeMap');
    s.state.progress[1].cancel();
    assert.equal(await p, null);
    assert.ok(s.state.messages.some((x) => /anulowana/.test(x.text)));
    assert.equal(C.map.size, 1, 'anulowanie nie kasuje poprzednich wyników');
    await s.state.commands.get('codemap.analyze')();
    assert.ok(s.state.messages.some((x) => x.level === 'error' && /Nie ma katalogu/.test(x.text)));
    assert.equal(s.state.statusItems[0].text, '$(pulse) CodeMap 80');
  });
});

describe('mapa i nawigacja', () => {
  test('openMap → panel z mapą; revealInMap → focus; codemap:open: poprawne ścieżki otwarte, spoza workspace odrzucone', async () => {
    const s = setup({ language: 'en' });
    const V = s.vscode;
    s.state.activeEditor = { document: { uri: V.Uri.file(path.join(WS, 'src', 'a.js')) } };
    await s.state.commands.get('codemap.openMap')();
    assert.equal(s.calls.length, 1, 'bez wyniku — analiza przed otwarciem mapy');
    const panel = s.state.panels[0], web = panel.webview;
    assert.equal(panel.title, 'CodeMap — ' + path.basename(WS));
    panel.receive({ type: 'codemap:ready' });
    assert.equal(web.posted[0].type, 'codemap:load');
    assert.equal(web.posted[0].lang, 'en');
    assert.equal(web.posted[0].map.nodes[0].id, 'src/a.js');

    await s.state.commands.get('codemap.revealInMap')(V.Uri.file(path.join(WS, 'src', 'b.js')));
    assert.deepEqual(web.posted[1], { type: 'codemap:focus', path: 'src/b.js' });
    assert.equal(s.calls.length, 1, 'wynik z pamięci');
    await s.state.commands.get('codemap.revealInMap')();   // bez argumentu — aktywny edytor
    assert.deepEqual(web.posted[2], { type: 'codemap:focus', path: 'src/a.js' });
    await s.state.commands.get('codemap.revealInMap')(V.Uri.file(path.join(path.dirname(WS), 'poza', 'x.js')));
    assert.ok(s.state.messages.some((x) => x.level === 'warn' && /outside the workspace/.test(x.text)));

    // z mapy do edytora (z linią)
    assert.equal(await s.api.openFromMap({ type: 'codemap:open', path: 'src/a.js', line: 12 }), true);
    assert.equal(s.state.opened.at(-1).fsPath, path.join(WS, 'src', 'a.js'));
    const ed = s.state.shown.at(-1);
    assert.equal(ed.selection.active.line, 11);
    assert.equal(ed.revealed[0].t, V.TextEditorRevealType.InCenterIfOutsideViewport);
    assert.equal(ed.opts.viewColumn, V.ViewColumn.One, 'panel obok (Beside) → plik w pierwszej kolumnie');
    // odrzucone: wyjście z folderu, ścieżki absolutne, inny folder workspace przez '..', śmieci
    const opened = s.state.opened.length;
    for (const bad of ['../' + path.basename(OTHER) + '/secret.txt', '..\\x', path.join(OTHER, 'secret.txt'), '/etc/passwd', 'C:\\Windows\\win.ini', '', 42]) {
      assert.equal(await s.api.openFromMap({ type: 'codemap:open', path: bad }), false, String(bad));
    }
    assert.equal(s.state.opened.length, opened, 'nic nie otwarto');
    assert.ok(s.state.messages.filter((x) => x.level === 'warn' && /rejected a path/.test(x.text)).length >= 4);
    // nieistniejący plik → ostrzeżenie; plik binarny → vscode.open
    assert.equal(await s.api.openFromMap({ type: 'codemap:open', path: 'src/nope.js' }), false);
    s.state.openFail.add(path.join(WS, 'img', 'logo.png'));
    assert.equal(await s.api.openFromMap({ type: 'codemap:open', path: 'img/logo.png' }), true);
    assert.equal(s.state.executed.at(-1).id, 'vscode.open');
    // wiadomość z webview przechodzi przez panel
    panel.receive({ type: 'codemap:open', path: 'src/b.js' });
    for (let i = 0; i < 100 && !s.state.opened.at(-1).fsPath.endsWith('b.js'); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(s.state.opened.at(-1).fsPath, path.join(WS, 'src', 'b.js'));
  });

  test('ścieżka przez dowiązanie symboliczne wychodzące z workspace → odrzucona (realpath)', async () => {
    const m = createVscodeMock({ folders: [WS] });
    const outside = path.join(path.dirname(WS), 'poza-workspace.txt');
    const realpath = (p) => Promise.resolve(p.endsWith('link.js') ? outside : p);
    const ext = createExtension(m.vscode, { realpath, analyze: () => Promise.resolve(fakeResult()) });
    ext.activate(createContext(EXT));
    await ext.api.openMap(m.vscode.Uri.file(WS));
    assert.equal(await ext.api.openFromMap({ type: 'codemap:open', path: 'src/link.js' }), false);
    assert.equal(m.state.opened.length, 0);
    assert.equal(await ext.api.openFromMap({ type: 'codemap:open', path: 'src/a.js' }), true);
  });
});

describe('analiza przy zapisie i CodeLens', () => {
  test('analyzeOnSave: seria zapisów → jedna analiza (cicha, w pasku okna); wyłączone → brak analizy', async () => {
    const s = setup({ settings: { 'codemap.analyzeOnSave': true } });
    s.fire.save(path.join(WS, 'src', 'a.js'));
    s.fire.save(path.join(WS, 'src', 'b.js'));
    s.fire.save(path.join(WS, 'src', 'a.js'));
    assert.equal(s.timers.q.length, 1, 'jeden oczekujący termin');
    assert.equal(s.timers.q[0].ms, 1500);
    assert.equal(s.calls.length, 0);
    s.timers.flush(); await tick(); await tick();
    assert.equal(s.calls.length, 1);
    assert.equal(s.state.progress[0].opts.location, s.vscode.ProgressLocation.Window);
    assert.ok(!s.state.messages.some((x) => x.level === 'info'), 'bez powiadomienia przy zapisie');
    // plik spoza workspace i nie-plik → ignorowane
    s.fire.save(path.join(path.dirname(WS), 'poza.js'));
    assert.equal(s.timers.q.length, 0);
    // wyłączenie ustawienia
    s.state.settings['codemap.analyzeOnSave'] = false;
    s.fire.config(['codemap.analyzeOnSave']);
    s.fire.save(path.join(WS, 'src', 'a.js'));
    assert.equal(s.timers.q.length, 0);
    assert.equal(s.calls.length, 1);
  });

  test('nowa analiza przerywa trwającą (sygnał przerwania) i tylko najnowszy wynik trafia do Problems', async () => {
    const pending = [];
    const s = setup({ settings: { 'codemap.analyzeOnSave': true }, analyze: (root, opts, o) => new Promise((resolve, reject) => {
      pending.push({ resolve, signal: o.signal });
      o.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) });
    s.fire.save(path.join(WS, 'src', 'a.js')); s.timers.flush(); await tick();
    s.fire.save(path.join(WS, 'src', 'a.js')); s.timers.flush(); await tick();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(pending[1].signal.aborted, false);
    pending[1].resolve(fakeResult(77)); await tick(); await tick();
    assert.equal(s.state.statusItems[0].text, '$(pulse) CodeMap 77');
    // czekający na przerwany przebieg (np. openMap) dostaje wynik nowszego
    const p1 = s.api.analyzeFolder(s.folders[0], { silent: true });
    const p2 = s.api.analyzeFolder(s.folders[0], { silent: true });
    pending[3].resolve(fakeResult(55));
    const [e1, e2] = await Promise.all([p1, p2]);
    assert.equal(pending[2].signal.aborted, true);
    assert.equal(e1, e2);
    assert.equal(e1.result.report.score, 55);
  });

  test('CodeLens nad hotspotem (z danymi git), wyłączany ustawieniem', async () => {
    const s = setup();
    const V = s.vscode;
    const doc = (rel) => ({ uri: V.Uri.file(path.join(WS, ...rel.split('/'))) });
    assert.deepEqual(s.api.provideCodeLenses(doc('src/a.js')), [], 'przed analizą');
    await s.api.analyzeFolder(s.folders[0]);
    const [lens] = s.api.provideCodeLenses(doc('src/a.js'));
    assert.equal(lens.command.title, 'CodeMap: 5 zmian × złożoność 30 · właściciel Jan (100 %) · hotspot #1');
    assert.equal(lens.command.command, 'codemap.revealInMap');
    assert.equal(lens.command.arguments[0].fsPath, path.join(WS, 'src', 'a.js'));
    assert.deepEqual(s.api.provideCodeLenses(doc('src/b.js')), []);
    s.state.settings['codemap.codeLens'] = false;
    assert.deepEqual(s.api.provideCodeLenses(doc('src/a.js')), []);
  });
});
