import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Folder na żywo (js/live.js) na atrapie File System Access (uchwyty katalogów i plików w pamięci) i zaślepce
// CM.App: pierwsze wczytanie (pomijane katalogi, pliki .git i raporty pokrycia jako pliki „boczne"), wykrywanie zmian
// (dodane / zmienione / usunięte) z przebudową grafu i zachowaniem pozycji, nowy commit → historia git, stop.
const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };

// drzewo: { nazwa: 'treść' | { podkatalog } }; mtime z licznika (zmiana treści = nowy mtime)
let clock = 1000;
const file = (text) => ({ text, mtime: ++clock });
function fsTree(obj) { const t = {}; for (const [k, v] of Object.entries(obj)) t[k] = typeof v === 'string' ? file(v) : fsTree(v); return t; }
function dirHandle(name, tree) {
  const h = (n, v) => (v && typeof v.text === 'string' ? fileHandle(n, v) : dirHandle(n, v));
  return { kind: 'directory', name,
    async *entries() { for (const [n, v] of Object.entries(tree)) yield [n, h(n, v)]; },
    async getDirectoryHandle(n) { if (!tree[n] || typeof tree[n].text === 'string') throw new Error('NotFound'); return dirHandle(n, tree[n]); },
    async getFileHandle(n) { if (!tree[n] || typeof tree[n].text !== 'string') throw new Error('NotFound'); return fileHandle(n, tree[n]); } };
}
function fileHandle(name, f) {
  return { kind: 'file', name, async getFile() { return { name, size: f.text.length, lastModified: f.mtime, text: async () => f.text }; } };
}

function load() {
  const doc = miniDocument(), log = [], toasts = [], actions = {}, loadedCbs = [];
  const A = { state: { side: null }, filters: {}, _ingestGen: 0,
    renderer: { decorators: [], selected: null, kick() {} },
    ingest: async (factory) => { const r = await factory(() => {}, () => {}); log.push(['ingest', r.meta.name, r.meta.live]); A.lastIngest = r;
      A.graph = new CM.Graph.Graph(); A.graph.build(r.files, r.meta); A.state.side = r.side; return true; },
    analyzeFiles: async (files) => { log.push(['analyze', files.map((f) => f.path).sort()]); return new Map(); },
    countsInit() {}, refreshView: () => log.push(['refresh']), select: (n) => log.push(['select', n && n.id]), ensureSymbols() {},
    onProjectLoaded: (fn) => loadedCbs.push(fn), registerAction: (a) => { actions[a.name] = a; } };
  // animacja „pulsów" zmian kręci się przez requestAnimationFrame, dopóki renderer ich nie zgasi — tu bez podtrzymywania procesu
  const CM = loadCM([...CORE, 'loaders', 'live'], { document: doc, CM: { App: A }, setTimeout: setTimeoutUnref,
    requestAnimationFrame: (f) => setTimeoutUnref(() => f(performance.now()), 16) });
  CM.util.toast = (m, k) => toasts.push([String(m), k || '']);
  return { A, CM, L: CM.Live, doc, log, toasts, actions, loadedCbs };
}
const project = () => fsTree({
  'src': { 'a.js': "import './b.js';\nexport const a = 1;\n", 'b.js': 'export const b = 2;\n' },
  'README.md': '# demo\n', 'node_modules': { 'lib': { 'x.js': 'x' } },
  '.git': { 'HEAD': 'ref: refs/heads/main\n', 'logs': { 'HEAD': 'log1\n' }, 'hooks': { 'pre-commit': 'sh' }, 'index.lock': '', 'objects': { 'ab': { 'cd': 'blob' } } },
  'coverage': { 'lcov.info': 'SF:src/a.js\nend_of_record\n' },
});

describe('start: pierwsze wczytanie folderu', () => {
  test('pliki bez pomijanych katalogów, treść tekstowa, .git (bez hooks i *.lock) i pokrycie jako pliki boczne', async () => {
    const { L, A, log } = load();
    const tree = project();
    assert.equal(await L.start(dirHandle('demo', tree), { interval: 60000 }), true);
    assert.deepEqual(log[0], ['ingest', 'demo', true]);
    const r = A.lastIngest;
    assert.deepEqual(host(r.files.map((f) => f.path)).sort(), ['README.md', 'src/a.js', 'src/b.js']);
    assert.equal(r.files.find((f) => f.path === 'src/b.js').content, 'export const b = 2;\n');
    assert.deepEqual(host(r.side.git.map((g) => g.path)).sort(), ['HEAD', 'logs/HEAD', 'objects/ab/cd']);
    assert.deepEqual(host(r.side.coverage.map((c) => c.path)), ['coverage/lcov.info']);
    assert.equal(r.meta.source, 'live: demo');
    assert.deepEqual(host(L.state()), { on: true, paused: false, name: 'demo', files: 3, observer: false, interval: 60000 });
    L.stop(true);
  });
  test('brak zgody na odczyt → komunikat i false; przeglądarka bez File System Access → komunikat', async () => {
    const { L, toasts, log } = load();
    const dir = { ...dirHandle('x', {}), queryPermission: async () => 'prompt', requestPermission: async () => 'denied' };
    assert.equal(await L.start(dir), false);
    assert.equal(log.length, 0);
    assert.equal(toasts[0][0], 'Brak uprawnień do odczytu folderu.');
    assert.equal(await L.pick(), false);
    assert.match(toasts[1][0], /File System Access/);
  });
});

describe('poll: zmiany w folderze', () => {
  test('dodany, zmieniony i usunięty plik → przebudowa grafu, analiza tylko zmienionych, pozycje zachowane, komunikat', async () => {
    const { L, A, log, toasts } = load();
    const tree = project();
    await L.start(dirHandle('demo', tree), { interval: 60000 });
    A.graph.nodes.get('src/a.js').x = 123; A.graph.nodes.get('src/a.js').y = -7; A.graph.nodes.get('src').collapsed = true;
    tree.src['b.js'] = file('export const b = 3; // zmiana\n');
    tree.src['c.js'] = file("import './a.js';\n");
    delete tree['README.md'];
    const r = host(await L.poll());
    assert.deepEqual(r, { added: ['src/c.js'], changed: ['src/b.js'], removed: ['README.md'] });
    assert.deepEqual(host(log.find((l) => l[0] === 'analyze')), ['analyze', ['src/b.js', 'src/c.js']]);
    const g = A.graph;
    assert.ok(g.nodes.has('src/c.js') && !g.nodes.has('README.md'));
    assert.deepEqual([g.nodes.get('src/a.js').x, g.nodes.get('src/a.js').y], [123, -7]);
    assert.equal(g.nodes.get('src').collapsed, true);
    assert.equal(g.nodes.get('src/b.js').preview.includes('zmiana'), true);
    assert.equal(toasts.at(-1)[0], 'Na żywo: 1 zmienionych, 1 nowych, 1 usuniętych — b.js, c.js');
    assert.deepEqual(host(await L.poll()), { added: [], changed: [], removed: [] }, 'bez zmian — bez przebudowy');
    L.stop(true);
  });
  test('nowy commit (zmiana .git/logs/HEAD) → świeże pliki .git i przeliczenie historii', async () => {
    const { L, A, CM, toasts } = load();
    const runs = []; CM.Git = { run: (o) => runs.push(o) };
    const tree = project();
    await L.start(dirHandle('demo', tree), { interval: 60000 });
    tree['.git'].logs.HEAD = file('log1\nlog2\n');
    tree['.git'].objects.ef = { gh: file('nowy obiekt') };
    await L.poll();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(host(runs), [{ auto: true }]);
    assert.ok(A.state.side.git.some((f) => f.path === 'objects/ef/gh'));
    assert.match(toasts.at(-1)[0], /Nowy commit/);
    L.stop(true);
  });
  test('stop: koniec obserwacji z komunikatem; poll po stopie nic nie robi; wczytanie innego projektu kończy tryb', async () => {
    const { L, toasts, loadedCbs, actions } = load();
    await L.start(dirHandle('demo', project()), { interval: 60000 });
    assert.equal(await actions.liveStop.run(), 'Zakończono obserwację folderu.');
    assert.equal(toasts.at(-1)[0], 'Zakończono obserwację folderu.');
    assert.equal(await L.poll(), null);
    assert.equal(actions.liveStop.run(), '—');
    await L.start(dirHandle('demo', project()), { interval: 60000 });
    for (const cb of loadedCbs) cb({ reason: 'ingest', meta: { live: true, name: 'demo' } });
    assert.equal(L.state().on, true, 'własne wczytanie tego samego folderu nie przerywa');
    for (const cb of loadedCbs) cb({ reason: 'ingest', meta: { name: 'inny' } });
    assert.equal(L.state().on, false);
  });
});

describe('znacznik na pasku stanu', () => {
  test('„NA ŻYWO" z pauzą i stopem; pauza przełącza kropkę i ikonę; stop usuwa znacznik', async () => {
    const { L, doc } = load();
    const st = doc.createElement('span'); st.id = 'st-project'; doc.body.appendChild(st);
    await L.start(dirHandle('demo', project()), { interval: 60000 });
    const b = doc.getElementById('st-live');
    assert.ok(b); assert.equal(st.nextSibling, b);
    assert.equal(b.querySelectorAll('.st-live-btn')[0].textContent, '❚❚');
    L.pause();
    assert.ok(doc.getElementById('st-live').querySelector('.st-live-dot').classList.contains('paused'));
    assert.equal(L.state().paused, true);
    L.resume();
    assert.equal(L.state().paused, false);
    doc.getElementById('st-live').querySelectorAll('.st-live-btn')[1].click();
    assert.equal(doc.getElementById('st-live'), null);
  });
});
