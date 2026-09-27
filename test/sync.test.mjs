import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createContext, runFile, host, memStorage } from './harness.mjs';

// Synchronizacja z chmurą po stronie klienta (js/sync.js): kolejka operacji w IndexedDB (tu minimalna atrapa),
// wysyłka (push) z obsługą 409 / 507 / błędów sieci, pobieranie (pull, LWW ustawień), Sejf/Ulubione (szyfrogram).

// moduł ładowany jawnie po adresie: sync.js jest też w server/ — sama nazwa pliku testu nie wskazuje podmiotu jednoznacznie
const SUBJECT = new URL('../js/sync.js', import.meta.url);
function loadCM(mods, extra) {
  const ctx = createContext(extra);
  for (const m of mods) runFile(ctx, `js/${m}.js`);
  vm.runInContext(readFileSync(SUBJECT, 'utf8'), ctx, { filename: 'js/sync.js' });
  return ctx.CM;
}

// atrapa IndexedDB: jedna baza, magazyny z autoIncrement, add / delete / openCursor, zdarzenia asynchroniczne
function fakeIDB() {
  const stores = new Map(); let seq = 0;
  const later = (fn) => queueMicrotask(fn);   // zdarzenia po bieżącym kodzie (uchwyty onsuccess przypisane synchronicznie)
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore: (n) => { stores.set(n, new Map()); },
    transaction: (n) => {
      const tx = {}; const st = stores.get(n);
      tx.objectStore = () => ({
        add: (v) => { const k = ++seq; st.set(k, { ...v, qid: k }); later(() => tx.oncomplete && tx.oncomplete()); },
        delete: (k) => { st.delete(k); later(() => tx.oncomplete && tx.oncomplete()); },
        openCursor: () => { const req = {}; const vals = [...st.values()]; let i = 0;
          const step = () => later(() => { req.result = i < vals.length ? { value: vals[i++], continue: step } : null; req.onsuccess(); });
          step(); return req; },
      });
      return tx;
    },
  };
  return { open: () => { const req = { result: db }; later(() => { if (!stores.size) req.onupgradeneeded(); req.onsuccess(); }); return req; }, stores };
}
// zegar testu: automatyczny push (debounce 800 ms) wyłączony — test woła push() sam; debounce hooków ustawień
// (5 s) i sesji (15 s) skrócony do zera; pozostałe timery bez podtrzymywania procesu
const timer = (fn, ms) => { if (ms === 800) return 0; const t = setTimeout(fn, ms >= 5000 ? 0 : ms); t.unref(); return t; };

function load({ api = async () => ({}), loggedIn = true, local = {} } = {}) {
  const ls = memStorage(), idb = fakeIDB(), calls = [], toasts = [];
  const CM = loadCM(['util', 'i18n'], { localStorage: ls, indexedDB: idb, setTimeout: timer });
  CM.util.toast = (m, k) => toasts.push([m, k || '']);
  let refreshed = 0;
  CM.Auth = { isLoggedIn: () => loggedIn, refresh: () => { refreshed++; },
    api: async (path, opt = {}) => { calls.push([opt.method || 'GET', path, opt.json !== undefined ? opt.json : opt.body]); return api(path, opt); } };
  const snaps = [...(local.snapshots || [])];
  let session = local.session || null;
  CM.Storage = { loadSession: async () => session, saveSession: async (m) => { session = { map: m }; }, allSnapshots: async () => snaps,
    importSnapshots: async (arr) => { snaps.push(...arr); } };
  return { S: CM.Sync, CM, ls, idb, calls, toasts, snaps, getSession: () => session, refreshed: () => refreshed };
}
const err = (status) => Object.assign(new Error('http' + status), { status });
const queue = (idb) => [...(idb.stores.get('queue') || new Map()).values()].map((o) => o.kind + (o.id ? ':' + o.id : ''));
const flush = () => new Promise((r) => setTimeout(r, 20));   // skrócone debounce (0 ms) + mikrozadania atrapy IndexedDB

describe('kolejka i push', () => {
  test('migawka: treść jako octet-stream z metadanymi w query, potem sygnatura; usunięcie migawki (404 = już nie ma)', async () => {
    const { S, idb, calls } = load({ api: async (p, o) => { if (o.method === 'DELETE') throw err(404); return {}; } });
    S.onSnapshot({ id: 's 1', projectKey: 'local: demo', ts: 5, label: 'L', name: 'demo', source: 'src', signature: { fileCount: 2 } }, '{"format":"codemap"}');
    S.onSnapshotDeleted('old');
    await flush();
    assert.deepEqual(queue(idb), ['snapshot:s 1', 'snapdel:old']);
    await S.push();
    assert.deepEqual(host(calls), [
      ['PUT', '/api/snapshots/s%201?projectKey=local%3A+demo&ts=5&label=L&name=demo&source=src', '{"format":"codemap"}'],
      ['PUT', '/api/snapshots/s%201/meta', { signature: '{"fileCount":2}' }],
      ['DELETE', '/api/snapshots/old', undefined]]);
    await flush();
    assert.deepEqual(queue(idb), []);
  });
  test('409 i 507 zdejmują operację z kolejki (507 z komunikatem); błąd sieci przerywa i zostawia resztę', async () => {
    const fail = { a: 409, b: 507, c: 500 };
    const { S, idb, toasts } = load({ api: async (p) => { const id = p.split('/')[3].split('?')[0]; if (fail[id]) throw err(fail[id]); return {}; } });
    for (const id of ['a', 'b', 'c', 'd']) S.onSnapshot({ id, signature: null }, '{}');
    await flush();
    await assert.rejects(S.push(), /http500/);
    await flush();
    assert.deepEqual(queue(idb), ['snapshot:c', 'snapshot:d']);
    assert.deepEqual(toasts, [['Brak miejsca w chmurze — usuń stare dane lub zmniejsz projekt.', 'error']]);
  });
  test('ustawienia (tylko klucze synchronizowane, bez kluczy API) i sesja: jedna operacja każdego rodzaju w kolejce', async () => {
    const { S, ls, idb, calls } = load({ local: { session: { ts: 77, map: { format: 'codemap' } } } });
    ls.setItem('codemap_lang', 'en'); ls.setItem('codemap_settings', '{"a":1}'); ls.setItem('codemap_mistral_keys', '["tajny"]');
    S.onSettingsChanged(); await flush();
    S.onSettingsChanged(); S.onSessionSaved(); await flush(); S.onSessionSaved(); await flush();
    assert.deepEqual(queue(idb), ['settings', 'session']);
    const t0 = Date.now();
    await S.push();
    const [m1, p1, b1] = calls[0];
    assert.deepEqual([m1, p1], ['PUT', '/api/settings']);
    assert.deepEqual(JSON.parse(b1.json), { codemap_lang: 'en', codemap_settings: '{"a":1}' });
    assert.ok(b1.updatedAt >= t0);
    assert.equal(ls.getItem('codemap_sync_settings_ts'), String(b1.updatedAt));
    assert.deepEqual(host(calls[1]), ['PUT', '/api/session?ts=77', '{"format":"codemap"}']);
  });
  test('sesja bez lokalnego zapisu — operacja zdjęta bez zapytania', async () => {
    const { S, idb, calls } = load();
    S.onSessionSaved(); await flush();
    await S.push(); await flush();
    assert.equal(calls.length, 0); assert.deepEqual(queue(idb), []);
  });
  test('bez logowania albo offline — push nic nie robi', async () => {
    const { S, idb, calls } = load({ loggedIn: false });
    S.onSnapshot({ id: 'x' }, '{}');
    await flush();
    assert.deepEqual(queue(idb), [], 'hook nie kolejkuje bez logowania');
    await S.push();
    assert.equal(calls.length, 0);
  });
  test('automatyczna synchronizacja: domyślnie włączona, wyłączona blokuje kolejkowanie', async () => {
    const { S, idb } = load();
    assert.equal(S.isAuto(), true);
    S.setAuto(false);
    assert.equal(S.isAuto(), false);
    S.onSnapshot({ id: 'x' }, '{}');
    await flush();
    assert.deepEqual(queue(idb), []);
  });
});

describe('pull', () => {
  test('ustawienia nowsze na serwerze (LWW): tylko znane klucze, znacznik czasu; starsze — tylko znacznik', async () => {
    const man = { settings: { updatedAt: 500 }, snapshots: [], session: null };
    const { S, ls, toasts, calls, refreshed } = load({ api: async (p) => p === '/api/sync/manifest' ? man
      : { json: JSON.stringify({ codemap_lang: 'en', codemap_mistral_keys: '["wstrzyknięty"]', obce: 'x' }), updatedAt: 500 } });
    await S.pull();
    assert.equal(ls.getItem('codemap_lang'), 'en');
    assert.equal(ls.getItem('codemap_mistral_keys'), null, 'klucze API nigdy z serwera');
    assert.equal(ls.getItem('obce'), null);
    assert.equal(ls.getItem('codemap_sync_settings_ts'), '500');
    assert.equal(toasts.length, 1); assert.equal(refreshed(), 1);
    man.settings.updatedAt = 400;
    await S.pull();
    assert.equal(calls.filter((c) => c[1] === '/api/settings').length, 1, 'starsze ustawienia nie są pobierane');
    assert.equal(ls.getItem('codemap_sync_settings_ts'), '400');
  });
  test('migawki: brakujące lokalnie dopisane z sygnaturą (tekst → obiekt, uszkodzona → null); istniejące pominięte', async () => {
    const man = { snapshots: [{ id: 'a', projectKey: 'p', ts: 1, signature: '{"fileCount":3}' }, { id: 'b', signature: '{zła' }, { id: 'local', signature: null }] };
    const { S, snaps } = load({ api: async () => man, local: { snapshots: [{ id: 'local' }] } });
    await S.pull();
    assert.deepEqual(host(snaps.map((s) => [s.id, s.signature])), [['local', undefined], ['a', { fileCount: 3 }], ['b', null]]);
  });
  test('sesja z chmury tylko na „świeżym" urządzeniu; trwająca praca nie jest nadpisywana', async () => {
    const api = async (p) => p === '/api/sync/manifest' ? { session: { ts: 9 } } : new Response('{"format":"codemap","nodes":[]}');
    const fresh = load({ api });
    await fresh.S.pull();
    assert.deepEqual(host(fresh.getSession().map), { format: 'codemap', nodes: [] });
    assert.equal(fresh.toasts[0][1], 'success');
    const busy = load({ api, local: { session: { map: { mine: true } } } });
    await busy.S.pull();
    assert.deepEqual(host(busy.getSession().map), { mine: true });
  });
  test('syncNow: push + pull → komunikat sukcesu; błąd → komunikat o ponowieniu; bez logowania nic', async () => {
    const ok = load({ api: async () => ({}) });
    await ok.S.syncNow();
    assert.deepEqual(ok.toasts.at(-1), ['Zsynchronizowano z chmurą.', 'success']);
    const bad = load({ api: async () => { throw err(500); } });
    await bad.S.syncNow();
    assert.deepEqual(bad.toasts.at(-1), ['Synchronizacja nieudana — spróbuję później.', 'error']);
    const off = load({ loggedIn: false });
    await off.S.pull();
    assert.equal(off.calls.length, 0);
  });
});

describe('Sejf / Ulubione', () => {
  function drive(local) {
    const writes = [];
    return { writes, _cloud: {
      state: async () => local.state || 'enc', getMeta: async () => local.meta, writeMeta: async (a, m) => { local.meta = m; writes.push(['meta', m]); },
      listRaw: async () => local.files, readRaw: async (a, n) => new Uint8Array([n.length]), writeRaw: async (a, n, b) => { writes.push([n, b.length]); local.files.push({ name: n, size: b.length }); } },
    refreshAlbum: (a) => writes.push(['refresh', a]) };
  }
  test('pushAlbum: album bez hasła odrzucony; inna sól w chmurze = inne hasło; wysyłane tylko pliki o innym rozmiarze', async () => {
    const plain = load();
    plain.CM.Drive = drive({ state: 'plain', meta: null, files: [] });
    await plain.S.pushAlbum('vault');
    assert.deepEqual(plain.toasts, [['Ustaw hasło albumu, aby synchronizować go z chmurą.', 'error']]);
    const diff = load({ api: async () => ({ meta: { json: '{"enc":true,"salt":"CHMURA"}' }, files: [] }) });
    diff.CM.Drive = drive({ meta: { enc: true, salt: 'LOKALNA' }, files: [] });
    await diff.S.pushAlbum('vault');
    assert.match(diff.toasts[0][0], /inne hasło/);
    const ok = load({ api: async (p) => p === '/api/vault/fav' ? { meta: null, files: [{ name: 'same.bin', size: 10 }, { name: 'old.bin', size: 1 }] } : { ok: true } });
    ok.CM.Drive = drive({ meta: { enc: true, salt: 'S' }, files: [{ name: 'same.bin', size: 10, ts: 1 }, { name: 'old.bin', size: 2, ts: 2 }, { name: 'new file.bin', size: 3, ts: 3 }] });
    await ok.S.pushAlbum('fav');
    assert.deepEqual(host(ok.calls.map((c) => c[0] + ' ' + c[1])), ['GET /api/vault/fav', 'PUT /api/vault/fav/meta',
      'PUT /api/vault/fav/files/old.bin?mtime=2', 'PUT /api/vault/fav/files/new%20file.bin?mtime=3']);
    assert.equal(JSON.parse(ok.calls[1][2].json).salt, 'S');
    assert.deepEqual(ok.toasts.at(-1), ['Wysłano do chmury: 2', 'success']);
  });
  test('pullAlbum: świeże urządzenie przejmuje meta z chmury i pobiera brakujące pliki; niepusty album bez hasła — odmowa', async () => {
    const api = async (p) => p === '/api/vault/vault' ? { meta: { json: '{"enc":true,"salt":"S"}' }, files: [{ name: 'a', size: 3 }, { name: 'b', size: 2 }] }
      : new Response(new Uint8Array(p.endsWith('/a') ? [1, 2, 3] : [9, 9]));
    const fresh = load({ api });
    const d = drive({ meta: null, files: [{ name: 'b', size: 2 }] });
    const empty = drive({ meta: null, files: [] });
    fresh.CM.Drive = empty;
    await fresh.S.pullAlbum('vault');
    assert.deepEqual(host(empty.writes), [['meta', { enc: true, salt: 'S' }], ['a', 3], ['b', 2], ['refresh', 'vault']]);
    assert.deepEqual(fresh.toasts.at(-1), ['Pobrano z chmury: 2', 'success']);
    const refused = load({ api });
    refused.CM.Drive = d;
    await refused.S.pullAlbum('vault');
    assert.match(refused.toasts[0][0], /inne hasło/);
    assert.equal(d.writes.length, 0);
    const nothing = load({ api: async () => ({ meta: null }) });
    nothing.CM.Drive = drive({ meta: null, files: [] });
    await nothing.S.pullAlbum('vault');
    assert.deepEqual(nothing.toasts, [['Wszystko aktualne.', '']]);
  });
});
