// Synchronizacja (server/sync.js) przez app.inject: manifest, ustawienia (LWW, 409 dla starszych), bieżąca sesja,
// zapisane mapy i migawki (strumień octet-stream, quota, idempotentny PUT migawki, sygnatura), izolacja kont.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'codemap-sync-'));
Object.assign(process.env, { DATA_DIR: DIR, NODE_ENV: 'test', EMAIL_MODE: 'console', APP_ORIGIN: 'http://localhost:8787', MAX_UPLOAD_BYTES: String(64 * 1024) });
const { buildApp } = await import('../app.js');
const { db, BLOB_DIR } = await import('../db.js');
const argon2 = (await import('argon2')).default;

const app = await buildApp({ logger: false, serveStatic: false });
after(async () => { await app.close(); db.close(); rmSync(DIR, { recursive: true, force: true }); });

const PASS = 'test-password-123';
let ip = 0;
const call = (u, method, url, payload, headers = {}) => app.inject({ method, url, payload,
  headers: { 'x-forwarded-for': '10.1.0.' + (++ip % 250 + 1), ...(u ? { cookie: u.cookie } : {}), ...headers } });
const bin = (u, url, data, method = 'PUT') => call(u, method, url, Buffer.from(data), { 'content-type': 'application/octet-stream' });
async function user(email, quota = 10 * 1024 * 1024) {
  const hash = await argon2.hash(PASS, { type: argon2.argon2id, memoryCost: 4096, timeCost: 1, parallelism: 1 });
  db.prepare('INSERT INTO users (email, pass_hash, lang, verified_at, quota_bytes, created_at) VALUES (?,?,?,?,?,?)').run(email, hash, 'pl', Date.now(), quota, Date.now());
  const r = await call(null, 'POST', '/api/auth/login', { email, password: PASS });
  assert.equal(r.statusCode, 200, r.body);
  return { cookie: 'cm_sess=' + r.cookies.find((x) => x.name === 'cm_sess').value, id: db.prepare('SELECT id FROM users WHERE email = ?').get(email).id };
}
const used = (u) => db.prepare('SELECT used_bytes FROM users WHERE id = ?').get(u.id).used_bytes;
const ala = await user('ala@example.com'), bob = await user('bob@example.com');

test('wszystko wymaga sesji (401)', async () => {
  for (const [m, url] of [['GET', '/api/sync/manifest'], ['GET', '/api/settings'], ['PUT', '/api/session'], ['GET', '/api/maps'], ['DELETE', '/api/snapshots/x']])
    assert.equal((await call(null, m, url)).statusCode, 401, m + ' ' + url);
});

test('manifest pustego konta: bez ustawień i sesji, puste listy, albumy Sejfu i Ulubionych, zużycie', async () => {
  const m = (await call(bob, 'GET', '/api/sync/manifest')).json();
  assert.deepEqual(m, { settings: null, session: null, maps: [], snapshots: [],
    vault: { vault: { metaUpdatedAt: null, files: [] }, fav: { metaUpdatedAt: null, files: [] } }, usage: { usedBytes: 0, quotaBytes: 10 * 1024 * 1024 } });
});

test('ustawienia: last-write-wins — starszy zapis → 409 z aktualną wersją; zły JSON → 400', async () => {
  assert.deepEqual((await call(ala, 'GET', '/api/settings')).json(), { json: null, updatedAt: 0 });
  assert.equal((await call(ala, 'PUT', '/api/settings', { json: '{"codemap_lang":"en"}', updatedAt: 200 })).statusCode, 200);
  const old = await call(ala, 'PUT', '/api/settings', { json: '{"codemap_lang":"pl"}', updatedAt: 100 });
  assert.equal(old.statusCode, 409); assert.deepEqual(old.json(), { json: '{"codemap_lang":"en"}', updatedAt: 200 });
  assert.equal((await call(ala, 'PUT', '/api/settings', { json: 123 })).json().error, 'json');
  assert.equal((await call(ala, 'PUT', '/api/settings', { json: 'x'.repeat(256 * 1024 + 1) })).statusCode, 400);
  assert.deepEqual((await call(ala, 'GET', '/api/settings')).json(), { json: '{"codemap_lang":"en"}', updatedAt: 200 });
  assert.deepEqual((await call(ala, 'GET', '/api/sync/manifest')).json().settings, { updatedAt: 200 });
});

test('sesja: zapis strumienia, odczyt z nagłówkiem x-cm-ts, starsza wersja → 409, nadpisanie rozlicza quotę', async () => {
  assert.equal((await call(ala, 'GET', '/api/session')).statusCode, 404);
  const u0 = used(ala);
  const w = await bin(ala, '/api/session?ts=500', '{"format":"codemap","v":1}');
  assert.equal(w.statusCode, 200); assert.equal(w.json().size, 26);
  assert.equal(used(ala), u0 + 26);
  const r = await call(ala, 'GET', '/api/session');
  assert.equal(r.body, '{"format":"codemap","v":1}'); assert.equal(r.headers['x-cm-ts'], '500');
  assert.equal(r.headers['content-type'], 'application/octet-stream'); assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal((await bin(ala, '/api/session?ts=400', 'stare')).statusCode, 409);
  assert.equal((await bin(ala, '/api/session?ts=600', 'krótsze')).statusCode, 200);
  assert.equal(used(ala), u0 + Buffer.byteLength('krótsze'), 'stary blob zwolniony');
  assert.deepEqual((await call(ala, 'GET', '/api/sync/manifest')).json().session, { ts: 600, size: Buffer.byteLength('krótsze') });
  assert.equal((await call(bob, 'GET', '/api/session')).statusCode, 404, 'sesje kont rozdzielone');
});

test('mapy: zły id → 400, zapis z metadanymi z query, lista, odczyt, starsza wersja → 409, usunięcie zwalnia quotę i plik', async () => {
  assert.equal((await bin(ala, '/api/maps/zły%20id', 'x')).json().error, 'id');
  const u0 = used(ala);
  const w = await bin(ala, '/api/maps/m1?kind=mindmap&name=' + encodeURIComponent('Moja mapa') + '&projectKey=pk&updatedAt=1000', 'MAPA');
  assert.equal(w.statusCode, 200);
  const list = (await call(ala, 'GET', '/api/maps')).json();
  assert.deepEqual(list, [{ id: 'm1', kind: 'mindmap', name: 'Moja mapa', projectKey: 'pk', updatedAt: 1000, size: 4 }]);
  assert.equal((await call(ala, 'GET', '/api/maps/m1')).body, 'MAPA');
  assert.equal((await bin(ala, '/api/maps/m1?updatedAt=999', 'stara')).statusCode, 409);
  assert.equal((await bin(ala, '/api/maps/m2?kind=zly', 'X')).statusCode, 200);
  assert.equal((await call(ala, 'GET', '/api/maps')).json().find((m) => m.id === 'm2').kind, 'codemap');
  assert.equal((await call(bob, 'GET', '/api/maps/m1')).statusCode, 404, 'cudza mapa niewidoczna');
  assert.equal((await call(bob, 'DELETE', '/api/maps/m1')).statusCode, 404);
  assert.equal((await call(ala, 'DELETE', '/api/maps/m1')).statusCode, 200);
  assert.equal(used(ala), u0 + 1);
  assert.equal(existsSync(join(BLOB_DIR, String(ala.id), 'maps', 'm1.bin')), false);
  assert.equal((await call(ala, 'GET', '/api/maps/m1')).statusCode, 404);
});

test('migawki: niemutowalne (ponowny PUT idempotentny, bez podwójnej quoty), sygnatura osobno, filtr projektu, usunięcie', async () => {
  const u0 = used(ala);
  const q = '?projectKey=' + encodeURIComponent('local: demo') + '&ts=77&label=L1&name=demo&source=src';
  assert.equal((await bin(ala, '/api/snapshots/s1' + q, 'SNAP')).json().size, 4);
  const again = await bin(ala, '/api/snapshots/s1' + q, 'INNA TREŚĆ');
  assert.deepEqual(again.json(), { ok: true, size: 4 });
  assert.equal(used(ala), u0 + 4);
  assert.equal((await call(ala, 'GET', '/api/snapshots/s1')).body, 'SNAP');
  assert.equal((await call(ala, 'PUT', '/api/snapshots/s1/meta', { signature: 123 })).json().error, 'signature');
  assert.equal((await call(ala, 'PUT', '/api/snapshots/nie-ma/meta', { signature: '{}' })).statusCode, 404);
  assert.equal((await call(ala, 'PUT', '/api/snapshots/s1/meta', { signature: '{"fileCount":2}' })).statusCode, 200);
  await bin(ala, '/api/snapshots/s2?projectKey=inny&ts=90', 'S2');
  const all = (await call(ala, 'GET', '/api/snapshots')).json();
  assert.deepEqual(all.map((s) => s.id), ['s2', 's1'], 'najnowsze pierwsze');
  const one = (await call(ala, 'GET', '/api/snapshots?projectKey=' + encodeURIComponent('local: demo'))).json();
  assert.deepEqual(one, [{ id: 's1', projectKey: 'local: demo', ts: 77, label: 'L1', name: 'demo', source: 'src', signature: '{"fileCount":2}', size: 4 }]);
  assert.equal((await call(ala, 'DELETE', '/api/snapshots/s1')).statusCode, 200);
  assert.equal((await call(ala, 'DELETE', '/api/snapshots/s1')).statusCode, 404);
  assert.equal(used(ala), u0 + 2);
});

test('limity: ponad MAX_UPLOAD_BYTES → 413, ponad quotę konta → 507, bez śladu w zużyciu i na dysku', async () => {
  const tiny = await user('tiny@example.com', 100);
  const big = await bin(ala, '/api/maps/duza', 'x'.repeat(65 * 1024));
  assert.equal(big.statusCode, 413); assert.equal(big.json().error, 'toobig');
  const q = await bin(tiny, '/api/maps/m', 'x'.repeat(101));
  assert.equal(q.statusCode, 507); assert.equal(q.json().error, 'quota');
  assert.equal(used(tiny), 0);
  assert.equal(existsSync(join(BLOB_DIR, String(tiny.id), 'maps', 'm.bin')), false);
  assert.equal((await bin(tiny, '/api/maps/m', 'x'.repeat(100))).statusCode, 200, 'dokładnie do limitu');
  assert.equal(used(tiny), 100);
});
