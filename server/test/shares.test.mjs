// Publiczne linki do map: tworzenie, publiczny odczyt, wygaśnięcie, unieważnienie, własność, quota, nagłówki.
// app.inject (bez portu) na tymczasowej bazie SQLite — DATA_DIR ustawiony PRZED importem modułów serwera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { testApp, PASS } from './helpers.mjs';

const { app, appMod: { logPath }, db, BLOB_DIR, user } = await testApp('shares',
  { MAX_SHARE_BYTES: String(64 * 1024), MAX_SHARES_PER_USER: '6', DEFAULT_QUOTA_BYTES: String(10 * 1024 * 1024) }, { subnet: 3 });
const { gcShares, SHARE_ID_RE } = await import('../shares.js');
const MAP = { format: 'codemap', version: 2, meta: { name: 'demo-app', html: 'https://github.com/o/r' },
  nodes: [{ id: '__root__', type: 'folder', name: 'demo-app' }, { id: 'src/a.js', type: 'file', parent: '__root__', name: 'a.js', preview: null }],
  edges: [{ source: 'src/a.js', target: 'src/b.js', type: 'import' }] };

const used = (uid) => db.prepare('SELECT used_bytes FROM users WHERE id = ?').get(uid).used_bytes;
const create = (u, body = MAP, qs = '', headers = {}) => app.inject({
  method: 'POST', url: '/api/shares' + qs,
  headers: { 'content-type': 'application/json', ...(u ? { cookie: u.cookie } : {}), ...headers },
  payload: typeof body === 'string' ? body : JSON.stringify(body),
});
const read = (id, headers = {}) => app.inject({ method: 'GET', url: '/api/share/' + id, headers });
const list = (u) => app.inject({ method: 'GET', url: '/api/shares', headers: { cookie: u.cookie } });
const del = (u, id) => app.inject({ method: 'DELETE', url: '/api/shares/' + id, headers: u ? { cookie: u.cookie } : {} });

const ala = await user('ala@example.com');
const bob = await user('bob@example.com');

test('tworzenie wymaga sesji (401) — także z poprawnym ciałem', async () => {
  const r = await create(null);
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().error, 'auth');
});

test('CSRF: obcy Origin → 403', async () => {
  const r = await create(ala, MAP, '', { origin: 'https://evil.example' });
  assert.equal(r.statusCode, 403);
});

test('złe dane: 415 bez JSON, 400 nie-JSON / nie-mapa / pusta mapa / __proto__, 400 zły czas wygaśnięcia', async () => {
  assert.equal((await create(ala, 'x', '', { 'content-type': 'text/plain' })).statusCode, 415);
  assert.equal((await create(ala, 'x', '', { 'content-type': 'application/octet-stream' })).statusCode, 415);
  const bad = await create(ala, '{"format":"codemap",');
  assert.equal(bad.statusCode, 400); assert.equal(bad.json().error, 'json');
  assert.equal(bad.body.includes('codemap'), false, 'odpowiedź nie powtarza fragmentu treści');
  assert.equal((await create(ala, { format: 'other', nodes: [{ id: 'a' }] })).json().error, 'format');
  assert.equal((await create(ala, { format: 'codemap', nodes: [] })).json().error, 'map');
  assert.equal((await create(ala, [1, 2])).json().error, 'map');
  assert.equal((await create(ala, '{"format":"codemap","nodes":[{"id":"a"}],"__proto__":{"x":1}}')).statusCode, 400);
  // (liczba POST-ów w całym pliku < 30 — limit trasy na godzinę per IP)
  for (const d of ['0', '366', '1.5']) {
    const r = await create(ala, MAP, '?expiresInDays=' + d);
    assert.equal(r.statusCode, 400, d); assert.equal(r.json().error, 'expires');
  }
  assert.equal(used(ala.id), 0, 'odrzucone żądania nie zużywają quoty');
});

test('413: ciało ponad MAX_SHARE_BYTES — z Content-Length (precheck) i strumieniem bez niego (limit parsera)', async () => {
  const big = { ...MAP, pad: 'x'.repeat(70 * 1024) };
  const r = await create(ala, big);
  assert.equal(r.statusCode, 413); assert.equal(r.json().error, 'toobig');
  const chunked = await app.inject({ method: 'POST', url: '/api/shares',
    headers: { 'content-type': 'application/json', cookie: ala.cookie },
    payload: Readable.from([JSON.stringify(big)]) });
  assert.equal(chunked.statusCode, 413); assert.equal(chunked.json().error, 'toobig');
  assert.equal(used(ala.id), 0);
});

test('pełny cykl: tworzenie → lista → publiczny odczyt z licznikiem → unieważnienie → 404', async () => {
  const before = used(ala.id);
  const r = await create(ala, MAP, '?name=' + encodeURIComponent('Moja\u0007 mapa') + '&expiresInDays=30');
  assert.equal(r.statusCode, 201, r.body);
  const s = r.json();
  assert.match(s.id, SHARE_ID_RE); assert.equal(s.id.length, 24);
  assert.equal(s.url, 'http://localhost:8787/#share=' + s.id);
  assert.equal(s.name, 'Moja  mapa');
  assert.ok(s.expiresAt > Date.now() + 29 * 864e5 && s.expiresAt <= Date.now() + 30 * 864e5);
  assert.equal(used(ala.id), before + s.size, 'rozmiar liczy się do quoty');
  assert.ok(existsSync(join(BLOB_DIR, String(ala.id), 'shares', s.id + '.json')));

  const l = (await list(ala)).json();
  assert.equal(l.length, 1); assert.equal(l[0].id, s.id); assert.equal(l[0].views, 0); assert.equal(l[0].size, s.size);
  assert.equal((await list(bob)).json().length, 0, 'lista pokazuje tylko własne linki');

  // publiczny odczyt: bez ciasteczka i z ciasteczkiem — nigdy Set-Cookie, zawsze JSON + nosniff, bez CORS
  for (const headers of [{}, { cookie: bob.cookie, origin: 'https://evil.example' }]) {
    const g = await read(s.id, headers);
    assert.equal(g.statusCode, 200);
    assert.deepEqual(g.json(), MAP);
    assert.match(g.headers['content-type'], /^application\/json/);
    assert.equal(g.headers['x-content-type-options'], 'nosniff');
    assert.equal(g.headers['cache-control'], 'no-store');
    assert.equal(g.headers['cross-origin-resource-policy'], 'same-origin');
    assert.match(g.headers['x-robots-tag'], /noindex/);
    assert.equal(g.headers['set-cookie'], undefined);
    assert.equal(g.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await app.inject({ method: 'HEAD', url: '/api/share/' + s.id })).statusCode, 200);
  assert.equal((await list(ala)).json()[0].views, 2, 'licznik wyświetleń (HEAD się nie liczy)');

  // cudzy link: 404 jak nieistniejący, link dalej działa
  const other = await del(bob, s.id);
  assert.equal(other.statusCode, 404); assert.equal(other.json().error, 'notfound');
  assert.equal((await read(s.id)).statusCode, 200);
  assert.equal((await del(null, s.id)).statusCode, 401);

  const d = await del(ala, s.id);
  assert.equal(d.statusCode, 200);
  assert.equal(used(ala.id), before, 'quota zwolniona');
  assert.equal(existsSync(join(BLOB_DIR, String(ala.id), 'shares', s.id + '.json')), false);
  const gone = await read(s.id);
  assert.equal(gone.statusCode, 404); assert.deepEqual(gone.json(), { error: 'notfound' });
  assert.equal((await del(ala, s.id)).statusCode, 404);
});

test('404 identyczne dla nieistniejącego, źle zbudowanego i wygasłego linku; GC zwalnia quotę', async () => {
  const nx = await read('A'.repeat(24));
  const bad = await read('..%2F..%2Fauth%2Fme');
  const short = await read('abc');
  const r = await create(bob, MAP, '?expiresInDays=1');
  const s = r.json();
  assert.equal((await read(s.id)).statusCode, 200);
  db.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, s.id);
  const exp = await read(s.id);
  for (const x of [nx, bad, short, exp]) { assert.equal(x.statusCode, 404); assert.equal(x.body, nx.body); }
  assert.equal((await list(bob)).json().some((x) => x.id === s.id), false, 'wygasły znika z listy od razu');
  const usedBefore = used(bob.id);
  assert.equal(await gcShares(), 1);
  assert.equal(used(bob.id), usedBefore - s.size);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shares WHERE id = ?').get(s.id).n, 0);
});

test('bez wygasania (expires_at NULL) i nazwa domyślna z mapy', async () => {
  const r = await create(bob, MAP);
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().expiresAt, null); assert.equal(r.json().name, 'demo-app');
  assert.equal(await gcShares(), 0);
  assert.equal((await read(r.json().id)).statusCode, 200);
});

test('quota (507) i limit aktywnych linków (409)', async () => {
  const tiny = await user('tiny@example.com', 100);
  const q = await create(tiny, MAP);
  assert.equal(q.statusCode, 507); assert.equal(q.json().error, 'quota');
  assert.equal(used(tiny.id), 0, 'nieudana rezerwacja nie zostawia śladu');
  const carl = await user('carl@example.com');
  for (let i = 0; i < 6; i++) assert.equal((await create(carl, MAP)).statusCode, 201);
  const lim = await create(carl, MAP);
  assert.equal(lim.statusCode, 409); assert.equal(lim.json().error, 'limit');
});

test('usunięcie konta kasuje linki (kaskada + katalog blobów)', async () => {
  const dave = await user('dave@example.com');
  const s = (await create(dave, MAP)).json();
  const r = await app.inject({ method: 'DELETE', url: '/api/auth/account', headers: { cookie: dave.cookie, 'content-type': 'application/json' }, payload: { password: PASS } });
  assert.equal(r.statusCode, 200);
  assert.equal((await read(s.id)).statusCode, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?').get(dave.id).n, 0);
});

test('logi: bez query stringa i bez id publicznego linku', () => {
  assert.equal(logPath('/api/share/AbCdEfGhIjKlMnOpQrStUvWx'), '/api/share/:id');
  assert.equal(logPath('/api/shares/AbCdEfGhIjKlMnOpQrStUvWx'), '/api/shares/:id');
  assert.equal(logPath('/api/shares?name=tajne&expiresInDays=7'), '/api/shares');
  assert.equal(logPath('/api/auth/verify?token=abc'), '/api/auth/verify');
  assert.equal(logPath('/api/maps/x'), '/api/maps/x');
});
