import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE, memStorage } from './harness.mjs';

// Migawki, sesja i pliki map (js/storage.js) bez IndexedDB — ścieżka zapasowa localStorage (jak w przeglądarce
// z zablokowaną bazą), odczyt pliku przez FileReader i nakładanie diffu na graf (węzły-duchy usuniętych plików).
class FakeFileReader {
  readAsText(file) { setTimeout(() => { if (file.fail) this.onerror(); else { this.result = file.text; this.onload(); } }, 0); }
}
function load() {
  const ls = memStorage();
  const CM = loadCM([...CORE, 'storage'], { localStorage: ls, FileReader: FakeFileReader });
  const sync = [];
  CM.Sync = { onSnapshot: (s, json) => sync.push(['snap', s.id, JSON.parse(json).format]), onSnapshotDeleted: (id) => sync.push(['del', id]),
    onSessionSaved: () => sync.push(['sess']) };
  return { CM, S: CM.Storage, ls, sync };
}
const FILES = [
  { path: 'src/a.js', size: 30, content: "import './b.js';\nexport const a = 1;\n" },
  { path: 'src/b.js', size: 20, content: 'export const b = 2;\n' },
];
function graph(CM, name = 'demo', source = 'local: demo') {
  const g = new CM.Graph.Graph(); g.build(FILES, { name, source, kind: 'local' }); return g;
}

describe('migawki (localStorage)', () => {
  test('addSnapshot: id, klucz projektu ze źródła, etykieta domyślna, sygnatura; hook synchronizacji z mapą', async () => {
    const { CM, S, ls, sync } = load();
    const g = graph(CM);
    const s = await S.addSnapshot(g, 'Przed refaktorem');
    assert.match(s.id, /^\d+-\d+$/);
    assert.equal(s.projectKey, 'local: demo'); assert.equal(s.label, 'Przed refaktorem'); assert.equal(s.name, 'demo');
    assert.equal(s.signature.fileCount, 2);
    const stored = JSON.parse(ls.getItem('codemap-snapshots'));
    assert.equal(stored.length, 1); assert.equal(stored[0].id, s.id);
    assert.deepEqual(sync, [['snap', s.id, 'codemap']]);
    const d = await S.addSnapshot(g);
    assert.match(d.label, /^Migawka /);
  });
  test('listSnapshots: filtr po projekcie, najnowsze pierwsze; allSnapshots bez filtra; deleteSnapshot', async () => {
    const { S, sync } = load();
    await S.importSnapshots([
      { id: 'a', projectKey: 'p1', ts: 10 }, { id: 'b', projectKey: 'p2', ts: 30 }, { id: 'c', projectKey: 'p1', ts: 20 }, { projectKey: 'p3', ts: 5 }]);
    assert.deepEqual(host((await S.listSnapshots('p1')).map((s) => s.id)), ['c', 'a']);
    const all = await S.allSnapshots();
    assert.equal(all.length, 4); assert.equal(all[0].id, 'b');
    assert.ok(all.at(-1).id, 'migawka bez id dostaje id przy imporcie');
    assert.equal((await S.listSnapshots()).length, 4);
    await S.deleteSnapshot('c');
    assert.deepEqual(host((await S.listSnapshots('p1')).map((s) => s.id)), ['a']);
    assert.deepEqual(sync.at(-1), ['del', 'c']);
  });
  test('uszkodzony wpis localStorage = pusta lista, bez wyjątku', async () => {
    const { S, ls } = load();
    ls.setItem('codemap-snapshots', '{nie json');
    assert.deepEqual(host(await S.allSnapshots()), []);
  });
});

describe('sesja', () => {
  test('saveSession → loadSession → clearSession; hook sesji wołany', async () => {
    const { S, sync } = load();
    assert.equal(await S.loadSession(), null);
    await S.saveSession({ format: 'codemap', nodes: [{ id: 'x' }] });
    const r = await S.loadSession();
    assert.equal(r.id, 'current'); assert.equal(r.map.nodes[0].id, 'x'); assert.ok(r.ts > 0);
    assert.deepEqual(sync, [['sess']]);
    await S.clearSession();
    assert.equal(await S.loadSession(), null);
  });
});

describe('pliki map', () => {
  test('openMap: poprawny JSON, uszkodzony plik i błąd odczytu → czytelne błędy', async () => {
    const { S } = load();
    assert.deepEqual(host(await S.openMap({ text: '{"format":"codemap","nodes":[]}' })), { format: 'codemap', nodes: [] });
    await assert.rejects(S.openMap({ text: '{zepsuty' }), /Nieprawidłowy plik mapy/);
    await assert.rejects(S.openMap({ fail: true }), /Błąd odczytu pliku/);
  });
  test('saveMap: nazwa pliku z nazwy projektu bez znaków specjalnych, JSON z savedAt', () => {
    const { CM, S } = load();
    let saved = null; CM.util.download = (name, text) => { saved = { name, obj: JSON.parse(text) }; };
    S.saveMap(graph(CM, 'mój projekt/v2 <beta>'));
    assert.equal(saved.name, 'm_j_projekt_v2_beta_.codemap.json');
    assert.equal(saved.obj.format, 'codemap'); assert.ok(saved.obj.savedAt > 0);
  });
});

describe('applyDiffToGraph', () => {
  test('dodane/zmienione oznaczone, usunięte jako węzły-duchy w (nowych) folderach, stare znaczniki czyszczone', () => {
    const { CM, S } = load();
    const g = graph(CM);
    g.nodes.get('src/b.js').diff = 'stale';
    S.applyDiffToGraph(g, {
      added: [{ path: 'src/a.js' }], modified: [{ path: 'nie/ma.js' }],
      removed: [{ path: 'lib/old/gone.py', size: 12, lines: 3 }, { path: 'src/a.js' }],
    });
    assert.equal(g.nodes.get('src/a.js').diff, 'added');
    assert.equal(g.nodes.get('src/b.js').diff, undefined);
    const ghost = g.nodes.get('lib/old/gone.py');
    assert.equal(ghost.ghost, true); assert.equal(ghost.diff, 'removed');
    assert.equal(ghost.lang, 'py'); assert.equal(ghost.metrics.lines, 3);
    assert.equal(ghost.parent, 'lib/old');
    assert.ok(g.nodes.get('lib/old').children.includes('lib/old/gone.py'));
    assert.ok(g.edges.some((e) => e.type === 'contains' && e.target === 'lib/old/gone.py'));
    assert.equal(g.nodes.get('src/a.js').ghost, undefined, 'istniejący plik nie staje się duchem');
  });
});
