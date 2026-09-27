// Sejf / Ulubione w chmurze (server/vault.js) przez app.inject: tylko albumy zaszyfrowane (enc:true), walidacja
// albumu i nazwy pliku, szyfrogramy jako strumień z quotą, nadpisanie i usunięcie, manifest synchronizacji, izolacja kont.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { testApp } from './helpers.mjs';

const { BLOB_DIR, call, bin: put, user, used } = await testApp('vault', {}, { subnet: 2 });
const ala = await user('ala@example.com'), bob = await user('bob@example.com');
const META = JSON.stringify({ enc: true, salt: 'c29s', verifier: 'dmVy', kdf: { name: 'pbkdf2', iter: 600000 } });

test('nieznany album → 400; pusty album → brak meta i plików; bez sesji → 401', async () => {
  assert.equal((await call(ala, 'GET', '/api/vault/tajne')).json().error, 'album');
  assert.deepEqual((await call(ala, 'GET', '/api/vault/vault')).json(), { meta: null, files: [] });
  assert.equal((await call(null, 'GET', '/api/vault/fav')).statusCode, 401);
});

test('meta: tylko album zaszyfrowany (enc:true), zły JSON / jawny album → 400 „plain"', async () => {
  for (const json of ['{"enc":false}', 'nie json', '{"enc":"true"}', undefined])
    assert.equal((await call(ala, 'PUT', '/api/vault/vault/meta', { json, updatedAt: 1 })).json().error, 'plain', String(json));
  assert.equal((await call(ala, 'PUT', '/api/vault/vault/meta', { json: META, updatedAt: 1234 })).statusCode, 200);
  assert.deepEqual((await call(ala, 'GET', '/api/vault/vault')).json().meta, { json: META, updatedAt: 1234 });
});

test('plik przed zaszyfrowaniem albumu → 400; zła nazwa → 400; zapis szyfrogramu, lista, odczyt z x-cm-mtime', async () => {
  assert.equal((await put(ala, '/api/vault/fav/files/a.bin', [1, 2, 3])).json().error, 'plain', 'Ulubione bez meta');
  assert.equal((await put(ala, '/api/vault/vault/files/a%5Cb.bin', [1])).json().error, 'name');
  assert.equal((await put(ala, '/api/vault/vault/files/' + 'x'.repeat(256), [1])).json().error, 'name');
  assert.equal((await put(ala, '/api/vault/vault/files/' + encodeURIComponent('ż'.repeat(256)), [1])).json().error, 'name', 'limit liczony po zdekodowaniu');
  const u0 = used(ala);
  const w = await put(ala, '/api/vault/vault/files/zdjęcie 1.jpg.enc?mtime=555', [9, 8, 7, 6]);
  assert.deepEqual(w.json(), { ok: true, size: 4 });
  assert.equal(used(ala), u0 + 4);
  assert.deepEqual((await call(ala, 'GET', '/api/vault/vault')).json().files, [{ name: 'zdjęcie 1.jpg.enc', size: 4, mtime: 555 }]);
  const r = await call(ala, 'GET', '/api/vault/vault/files/' + encodeURIComponent('zdjęcie 1.jpg.enc'));
  assert.deepEqual([...r.rawPayload], [9, 8, 7, 6]);
  assert.equal(r.headers['x-cm-mtime'], '555');
  const files = readdirSync(join(BLOB_DIR, String(ala.id), 'vault'));
  assert.ok(files.every((f) => /^[0-9a-f]{64}\.bin$/.test(f)), 'nazwa pliku na dysku = skrót nazwy (bez nazwy użytkownika)');
});

test('regresja: nazwy plików dłuższe niż 100 znaków (do limitu 255) przechodzą przez router', async () => {
  // Sejf nazywa pliki jak użytkownik (safeFileName w drive.js, do 120 znaków) — domyślny maxParamLength Fastify
  // (100 znaków) odrzucał dłuższe z 414 jeszcze przed trasą, więc synchronizacja albumu przerywała się na takim pliku
  const names = ['Wakacje nad morzem — zdjęcie grupowe z rodziną i przyjaciółmi, lato 2024, plaża w Dębkach, zachód słońca.jpg', 'ą'.repeat(255)];
  for (const name of names) {
    assert.ok(name.length > 100);
    const w = await put(ala, '/api/vault/vault/files/' + encodeURIComponent(name) + '?mtime=9', [5, 5]);
    assert.equal(w.statusCode, 200, name.slice(0, 20) + ': ' + w.body);
    const r = await call(ala, 'GET', '/api/vault/vault/files/' + encodeURIComponent(name));
    assert.deepEqual([...r.rawPayload], [5, 5]);
    assert.equal((await call(ala, 'DELETE', '/api/vault/vault/files/' + encodeURIComponent(name))).statusCode, 200);
  }
});

test('nadpisanie rozlicza tylko różnicę rozmiaru; usunięcie zwalnia quotę i plik; drugi raz → 404', async () => {
  await put(ala, '/api/vault/vault/files/n.enc?mtime=1', [1, 1, 1]);
  const u0 = used(ala);
  await put(ala, '/api/vault/vault/files/n.enc?mtime=2', [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(used(ala), u0 + 4);
  assert.equal((await call(ala, 'GET', '/api/vault/vault')).json().files.find((f) => f.name === 'n.enc').mtime, 2);
  assert.equal((await call(ala, 'DELETE', '/api/vault/vault/files/n.enc')).statusCode, 200);
  assert.equal(used(ala), u0 - 3);
  assert.equal((await call(ala, 'DELETE', '/api/vault/vault/files/n.enc')).statusCode, 404);
  assert.equal((await call(ala, 'GET', '/api/vault/vault/files/n.enc')).statusCode, 404);
});

test('manifest synchronizacji pokazuje meta i pliki albumów; konta są rozdzielone', async () => {
  const m = (await call(ala, 'GET', '/api/sync/manifest')).json();
  assert.equal(m.vault.vault.metaUpdatedAt, 1234);
  assert.deepEqual(m.vault.vault.files.map((f) => f.name), ['zdjęcie 1.jpg.enc']);
  assert.deepEqual(m.vault.fav, { metaUpdatedAt: null, files: [] });
  assert.deepEqual((await call(bob, 'GET', '/api/vault/vault')).json(), { meta: null, files: [] });
  assert.equal((await call(bob, 'GET', '/api/vault/vault/files/' + encodeURIComponent('zdjęcie 1.jpg.enc'))).statusCode, 404);
  assert.equal((await call(bob, 'DELETE', '/api/vault/vault/files/' + encodeURIComponent('zdjęcie 1.jpg.enc'))).statusCode, 404);
  assert.ok(existsSync(join(BLOB_DIR, String(ala.id), 'vault')));
});

test('meta większe niż 8 KB zapisuje się w całości (regresja: było obcinane), ponad limit → 413 bez zmiany zapisu', async () => {
  const ewa = await user('ewa@example.com');   // osobne konto — stan ala/bob należy do testów wyżej
  const big =JSON.stringify({ enc: true, salt: 's', files: Array.from({ length: 400 }, (_, i) => ({ n: 'plik-' + i + '.jpg.enc', iv: 'x'.repeat(24), s: i * 1000 })) });
  assert.ok(big.length > 20000);
  assert.equal((await call(ewa, 'PUT', '/api/vault/fav/meta', { json: big, updatedAt: 77 })).statusCode, 200);
  const got = (await call(ewa, 'GET', '/api/vault/fav')).json().meta;
  assert.equal(got.json, big, 'całe meta, poprawny JSON');
  assert.equal(JSON.parse(got.json).files.length, 400);
  const huge = JSON.stringify({ enc: true, pad: 'y'.repeat(1024 * 1024 + 10) });
  const r = await call(ewa, 'PUT', '/api/vault/fav/meta', { json: huge, updatedAt: 78 });
  assert.equal(r.statusCode, 413); assert.equal(r.json().error, 'toobig');
  assert.equal((await call(ewa, 'GET', '/api/vault/fav')).json().meta.updatedAt, 77, 'poprzednie meta nietknięte');
  assert.equal((await put(ewa, '/api/vault/fav/files/po-duzym-meta.enc', [1, 2])).statusCode, 200, 'album dalej przyjmuje pliki');
});
