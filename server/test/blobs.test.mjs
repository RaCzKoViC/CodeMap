// Magazyn blobów (server/blobs.js) bez HTTP: zapis strumienia przez plik .part z limitami (toobig / quota),
// atomowa rezerwacja quoty przed zapisem, rozliczenie po zapisie (także bez Content-Length), bufor o znanym rozmiarze.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';

const DIR = mkdtempSync(join(tmpdir(), 'codemap-blobs-'));
Object.assign(process.env, { DATA_DIR: DIR, NODE_ENV: 'test', MAX_UPLOAD_BYTES: '1000' });
const { db, BLOB_DIR } = await import('../db.js');
const B = await import('../blobs.js');
after(() => { db.close(); rmSync(DIR, { recursive: true, force: true }); });

const mkUser = (quota) => db.prepare('INSERT INTO users (email, pass_hash, quota_bytes, created_at) VALUES (?,?,?,?)').run(`u${Math.random()}@x.pl`, 'h', quota, Date.now()).lastInsertRowid;
const used = (id) => db.prepare('SELECT used_bytes FROM users WHERE id = ?').get(id).used_bytes;
const setUsed = (id, v) => db.prepare('UPDATE users SET used_bytes = ? WHERE id = ?').run(v, id);
const chunks = (...sizes) => Readable.from(sizes.map((n) => Buffer.alloc(n, 0x61)));
const leftovers = (rel) => { const d = dirname(B.blobAbs(rel)); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.part')) : []; };
function fakeReq(userId, body, contentLength) { return { user: { id: userId }, body, headers: contentLength == null ? {} : { 'content-length': String(contentLength) } }; }
function fakeReply() { const r = { status: 200, sent: null, headers: {}, code(c) { r.status = c; return r; }, send(x) { r.sent = x; return r; }, header(k, v) { r.headers[k] = v; return r; } }; return r; }

test('writeBlobStream: zapis w kawałkach przez .part → plik docelowy; limity toobig i quota bez śmieci na dysku', async () => {
  assert.equal(await B.writeBlobStream(chunks(300, 200), '1/a/x.bin', { room: 1000 }), 500);
  assert.equal(readFileSync(B.blobAbs('1/a/x.bin')).length, 500);
  assert.deepEqual(leftovers('1/a/x.bin'), []);
  await assert.rejects(B.writeBlobStream(chunks(600, 600), '1/a/big.bin', { room: 5000 }), (e) => e instanceof B.LimitError && e.code === 'toobig');
  await assert.rejects(B.writeBlobStream(chunks(100, 100), '1/a/q.bin', { room: 150 }), (e) => e.code === 'quota');
  assert.equal(existsSync(B.blobAbs('1/a/big.bin')), false); assert.equal(existsSync(B.blobAbs('1/a/q.bin')), false);
  assert.deepEqual(leftovers('1/a/x.bin'), []);
  assert.equal(B.blobAbs('7/s.bin'), join(BLOB_DIR, '7/s.bin'));
});

test('bumpUsage nigdy poniżej zera; zero to brak zmiany; deleteBlob nieistniejącego pliku bez błędu', async () => {
  const id = mkUser(1000);
  B.bumpUsage(id, 30); assert.equal(used(id), 30);
  B.bumpUsage(id, -100); assert.equal(used(id), 0);
  B.bumpUsage(id, 0); assert.equal(used(id), 0);
  await B.deleteBlob('nie/ma/takiego.bin');
});

test('storeBuffer: atomowa rezerwacja — ponad quotę false i nic nie zapisane; w limicie zapis i zużycie', async () => {
  const id = mkUser(100);
  assert.equal(await B.storeBuffer(id, `${id}/s/a.json`, Buffer.alloc(101)), false);
  assert.equal(used(id), 0); assert.equal(existsSync(B.blobAbs(`${id}/s/a.json`)), false);
  assert.equal(await B.storeBuffer(id, `${id}/s/a.json`, Buffer.from('x'.repeat(60))), true);
  assert.equal(used(id), 60);
  assert.equal(await B.storeBuffer(id, `${id}/s/b.json`, Buffer.alloc(41)), false, 'suma ponad quotę');
  assert.equal(await B.storeBuffer(id, `${id}/s/b.json`, Buffer.alloc(40)), true);
  assert.equal(used(id), 100);
});

test('handleUpload: deklaracja ponad limit → 413; brak miejsca → 507; sukces rozlicza rozmiar i zwalnia nadpisany blob', async () => {
  const id = mkUser(1000);
  let rep = fakeReply();
  assert.equal(await B.handleUpload(fakeReq(id, chunks(10), 5000), rep, `${id}/m.bin`), null);
  assert.deepEqual([rep.status, rep.sent], [413, { error: 'toobig' }]);
  setUsed(id, 950); rep = fakeReply();
  assert.equal(await B.handleUpload(fakeReq(id, chunks(100), 100), rep, `${id}/m.bin`), null);
  assert.deepEqual([rep.status, rep.sent], [507, { error: 'quota' }]);
  assert.equal(used(id), 950, 'nieudana rezerwacja bez śladu');
  rep = fakeReply();
  assert.equal(await B.handleUpload(fakeReq(id, chunks(100), 100), rep, `${id}/m.bin`, 80), 100, 'nadpisanie 80 B zwalnia miejsce na 100 B');
  assert.equal(used(id), 970);
});

test('handleUpload: strumień dłuższy niż deklaracja → 507 i zwolniona rezerwacja; bez Content-Length rezerwacja maksymalna i korekta', async () => {
  const id = mkUser(5000);
  let rep = fakeReply();
  assert.equal(await B.handleUpload(fakeReq(id, chunks(50, 50), 60), rep, `${id}/n.bin`), null);
  assert.deepEqual([rep.status, rep.sent], [507, { error: 'quota' }]);
  assert.equal(used(id), 0);
  rep = fakeReply();
  assert.equal(await B.handleUpload(fakeReq(id, chunks(300, 20)), rep, `${id}/n.bin`), 320);
  assert.equal(used(id), 320, 'rezerwacja 1000 B skorygowana do rzeczywistych 320 B');
  rep = fakeReply();
  assert.equal(await B.handleUpload(fakeReq(id, chunks(700, 700)), rep, `${id}/o.bin`), null);
  assert.deepEqual([rep.status, rep.sent], [413, { error: 'toobig' }]);
  assert.equal(used(id), 320);
  const full = mkUser(500); rep = fakeReply();
  assert.equal(await B.handleUpload(fakeReq(full, chunks(10)), rep, `${full}/c.bin`), null, 'bez deklaracji potrzeba miejsca na maksymalny upload');
  assert.equal(rep.status, 507);
});

test('sendBlob: typ octet-stream, dodatkowe nagłówki, strumień pliku', async () => {
  await B.writeBlobStream(chunks(5), '9/f.bin', { room: 100 });
  const rep = fakeReply();
  B.sendBlob(rep, '9/f.bin', { 'x-cm-ts': 42 });
  assert.equal(rep.headers['content-type'], 'application/octet-stream'); assert.equal(rep.headers['x-cm-ts'], 42);
  const got = []; for await (const c of rep.sent) got.push(c);
  assert.equal(Buffer.concat(got).toString(), 'aaaaa');
});
