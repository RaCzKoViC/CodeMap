// Konta (server/auth.js) przez app.inject na tymczasowej bazie: rejestracja (odporna na enumerację), weryfikacja
// e-mail, logowanie z blokadą po porażkach, sesje w ciasteczku, reset i zmiana hasła, wylogowanie, usunięcie konta, GC.
// Każde żądanie z innego adresu (X-Forwarded-For, trustProxy) — limity tras per IP nie mieszają się między testami.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'codemap-auth-'));
Object.assign(process.env, { DATA_DIR: DIR, NODE_ENV: 'test', EMAIL_MODE: 'console', APP_ORIGIN: 'http://localhost:8787' });
const mails = [];
const log = console.log;
console.log = (s, ...rest) => { if (String(s).startsWith('[MAIL]')) mails.push(String(s)); else log(s, ...rest); };
const { buildApp } = await import('../app.js');
const { db, BLOB_DIR } = await import('../db.js');
const { gcAuth } = await import('../auth.js');

const app = await buildApp({ logger: false, serveStatic: false });
after(async () => { console.log = log; await app.close(); db.close(); rmSync(DIR, { recursive: true, force: true }); });

let ip = 0;
const req = (method, url, payload, cookie, headers = {}) => app.inject({ method, url, payload,
  headers: { 'x-forwarded-for': '10.0.' + Math.floor(++ip / 250) + '.' + (ip % 250 + 1), ...(cookie ? { cookie } : {}), ...headers } });
const cookieOf = (r) => { const c = r.cookies.find((x) => x.name === 'cm_sess'); return c ? `cm_sess=${c.value}` : null; };
const tokenOf = (link) => new URL(link).searchParams.get('token') || new URL(link).searchParams.get('reset');
const userRow = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
const PASS = 'dobre-haslo-123';
const flushMail = () => new Promise((r) => setImmediate(() => setImmediate(r)));

async function registered(email, verify = true) {
  const r = await req('POST', '/api/auth/register', { email, password: PASS, lang: 'en' });
  assert.equal(r.statusCode, 200, r.body);
  if (verify) assert.equal((await req('GET', '/api/auth/verify?token=' + tokenOf(r.json().devVerifyLink))).headers.location, '/?verified=1');
  return r.json();
}
async function login(email, password = PASS) {
  const r = await req('POST', '/api/auth/login', { email, password });
  assert.equal(r.statusCode, 200, r.body);
  return cookieOf(r);
}

test('rejestracja: walidacja e-maila i hasła; sukces → link weryfikacyjny w trybie dev i mail w języku użytkownika', async () => {
  assert.equal((await req('POST', '/api/auth/register', { email: 'zly', password: PASS })).json().error, 'email');
  assert.equal((await req('POST', '/api/auth/register', { email: 'a@b.pl', password: 'krotkie' })).json().error, 'password');
  assert.equal((await req('POST', '/api/auth/register', { email: 'a@b.pl', password: 'x'.repeat(201) })).json().error, 'password');
  const r = await registered('ala@example.com', false);
  assert.match(r.devVerifyLink, /^http:\/\/localhost:8787\/api\/auth\/verify\?token=[\w-]{43}$/);
  const u = userRow('ala@example.com');
  assert.equal(u.verified_at, null); assert.equal(u.lang, 'en'); assert.ok(u.pass_hash.startsWith('$argon2id$'));
  await flushMail();
  assert.ok(mails.some((m) => m.includes('to=ala@example.com') && m.includes('Confirm your CodeMap account')));
});

test('ponowna rejestracja istniejącego adresu: ta sama odpowiedź (bez linku), właściciel dostaje powiadomienie; limit 3 maile/h na adres', async () => {
  await registered('bob@example.com');
  for (let i = 0; i < 4; i++) {
    const r = await req('POST', '/api/auth/register', { email: 'bob@example.com', password: 'inne-haslo-123' });
    assert.deepEqual(r.json(), { ok: true });
  }
  await flushMail();
  const toBob = mails.filter((m) => m.includes('to=bob@example.com'));
  assert.equal(toBob.length, 3, '1 weryfikacyjny + 2 powiadomienia = limit 3 na godzinę');
  assert.equal(toBob.filter((m) => m.includes('CodeMap sign-up attempt')).length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE email = ?").get('bob@example.com').n, 3);
  await login('bob@example.com');   // hasło nie zmienione przez próbę rejestracji
});

test('weryfikacja: zły / zużyty token → verified=0; logowanie przed weryfikacją → 403', async () => {
  const r = await registered('cyd@example.com', false);
  assert.equal((await req('POST', '/api/auth/login', { email: 'cyd@example.com', password: PASS })).json().error, 'unverified');
  assert.equal((await req('GET', '/api/auth/verify?token=zly')).headers.location, '/?verified=0');
  assert.equal((await req('GET', '/api/auth/verify')).headers.location, '/?verified=0');
  const t = tokenOf(r.devVerifyLink);
  assert.equal((await req('GET', '/api/auth/verify?token=' + t)).headers.location, '/?verified=1');
  assert.equal((await req('GET', '/api/auth/verify?token=' + t)).headers.location, '/?verified=0', 'token jednorazowy');
  assert.ok(userRow('cyd@example.com').verified_at > 0);
  const again = await req('POST', '/api/auth/resend-verification', { email: 'cyd@example.com' });
  assert.deepEqual(again.json(), { ok: true }, 'zweryfikowane konto nie dostaje nowego linku');
});

test('logowanie: ciasteczko httpOnly/SameSite=Lax (bez Secure na localhost), /me z danymi konta; bez sesji 401', async () => {
  await registered('dan@example.com');
  const r = await req('POST', '/api/auth/login', { email: 'dan@example.com', password: PASS });
  const c = r.cookies.find((x) => x.name === 'cm_sess');
  assert.equal(c.httpOnly, true); assert.equal(c.sameSite, 'Lax'); assert.ok(!c.secure); assert.equal(c.path, '/');
  assert.deepEqual(Object.keys(r.json()).sort(), ['createdAt', 'email', 'quotaBytes', 'usedBytes']);
  const me = await req('GET', '/api/auth/me', null, cookieOf(r));
  assert.equal(me.json().email, 'dan@example.com');
  assert.equal((await req('GET', '/api/auth/me')).statusCode, 401);
  assert.equal((await req('GET', '/api/auth/me', null, 'cm_sess=podrobione')).statusCode, 401);
  const row = db.prepare('SELECT * FROM sessions WHERE user_id = ?').get(userRow('dan@example.com').id);
  assert.notEqual(row.id, c.value, 'w bazie tylko skrót tokenu sesji');
});

test('blokada po 5 nieudanych logowaniach (także nieistniejącego konta — bez wyroczni), potem 429 z Retry-After', async () => {
  await registered('eve@example.com');
  for (let i = 0; i < 5; i++) assert.equal((await req('POST', '/api/auth/login', { email: 'eve@example.com', password: 'zle-haslo-xx' })).statusCode, 401);
  const locked = await req('POST', '/api/auth/login', { email: 'EVE@example.com', password: PASS });
  assert.equal(locked.statusCode, 429); assert.equal(locked.json().error, 'rate');
  assert.ok(+locked.headers['retry-after'] >= 29 && +locked.headers['retry-after'] <= 30);
  for (let i = 0; i < 5; i++) await req('POST', '/api/auth/login', { email: 'ghost@example.com', password: 'cokolwiek-123' });
  assert.equal((await req('POST', '/api/auth/login', { email: 'ghost@example.com', password: 'x' })).statusCode, 429);
  db.prepare('UPDATE login_attempts SET locked_until = 0 WHERE email = ?').run('eve@example.com');
  await login('eve@example.com');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?').get('eve@example.com').n, 0, 'sukces czyści licznik');
});

test('reset hasła: link dev, walidacja, zużycie tokenu, wylogowanie wszystkich sesji, logowanie nowym hasłem', async () => {
  await registered('fay@example.com');
  const old = await login('fay@example.com');
  const r = await req('POST', '/api/auth/request-reset', { email: 'fay@example.com' });
  const token = tokenOf(r.json().devResetLink);
  assert.deepEqual((await req('POST', '/api/auth/request-reset', { email: 'nikt@example.com' })).json(), { ok: true });
  assert.equal((await req('POST', '/api/auth/reset', { token, password: 'krotkie' })).json().error, 'password');
  assert.equal((await req('POST', '/api/auth/reset', { token: 'zly', password: 'nowe-haslo-456' })).json().error, 'token');
  assert.equal((await req('POST', '/api/auth/reset', { token, password: 'nowe-haslo-456' })).statusCode, 200);
  assert.equal((await req('POST', '/api/auth/reset', { token, password: 'inne-haslo-789' })).json().error, 'token', 'jednorazowy');
  assert.equal((await req('GET', '/api/auth/me', null, old)).statusCode, 401, 'stare sesje wylogowane');
  assert.equal((await req('POST', '/api/auth/login', { email: 'fay@example.com', password: PASS })).statusCode, 401);
  await login('fay@example.com', 'nowe-haslo-456');
});

test('zmiana hasła: złe obecne → 401; sukces wylogowuje inne sesje, bieżąca zostaje', async () => {
  await registered('gus@example.com');
  const a = await login('gus@example.com'), b = await login('gus@example.com');
  assert.equal((await req('POST', '/api/auth/change-password', { current: 'zle-haslo-xx', next: 'nowe-haslo-456' }, a)).statusCode, 401);
  assert.equal((await req('POST', '/api/auth/change-password', { current: PASS, next: 'x' }, a)).json().error, 'password');
  assert.equal((await req('POST', '/api/auth/change-password', { current: PASS, next: 'nowe-haslo-456' }, a)).statusCode, 200);
  assert.equal((await req('GET', '/api/auth/me', null, a)).statusCode, 200);
  assert.equal((await req('GET', '/api/auth/me', null, b)).statusCode, 401);
});

test('wylogowanie kasuje sesję; usunięcie konta wymaga hasła i kasuje dane oraz katalog blobów', async () => {
  await registered('hal@example.com');
  const s = await login('hal@example.com');
  const out = await req('POST', '/api/auth/logout', {}, s);
  assert.equal(out.statusCode, 200);
  assert.equal(out.cookies.find((x) => x.name === 'cm_sess').value, '');
  assert.equal((await req('GET', '/api/auth/me', null, s)).statusCode, 401);
  const s2 = await login('hal@example.com');
  const uid = userRow('hal@example.com').id;
  mkdirSync(join(BLOB_DIR, String(uid)), { recursive: true }); writeFileSync(join(BLOB_DIR, String(uid), 'x.bin'), 'x');
  assert.equal((await req('DELETE', '/api/auth/account', { password: 'zle-haslo-xx' }, s2)).statusCode, 401);
  assert.equal((await req('DELETE', '/api/auth/account', { password: PASS }, s2)).statusCode, 200);
  assert.equal(userRow('hal@example.com'), undefined);
  assert.equal(existsSync(join(BLOB_DIR, String(uid))), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(uid).n, 0);
});

test('CSRF: obcy Origin → 403, lokalny origin deweloperski dozwolony', async () => {
  assert.equal((await req('POST', '/api/auth/logout', {}, null, { origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await req('POST', '/api/auth/logout', {}, null, { origin: 'http://127.0.0.1:5500' })).statusCode, 200);
  assert.equal((await req('GET', '/api/health', null, null, { origin: 'https://evil.example' })).statusCode, 200, 'GET bez sprawdzania');
});

test('gcAuth: wygasłe sesje i tokeny, stare wpisy blokad i dziennika maili usunięte', async () => {
  await registered('ivy@example.com');
  const s = await login('ivy@example.com');
  const uid = userRow('ivy@example.com').id;
  db.prepare('UPDATE sessions SET expires_at = 1 WHERE user_id = ?').run(uid);
  db.prepare("INSERT INTO login_attempts (email, fails, locked_until, updated_at) VALUES ('old@x.pl', 9, 0, 1)").run();
  db.prepare("INSERT INTO mail_log (email, kind, sent_at) VALUES ('old@x.pl', 'verify', 1)").run();
  gcAuth();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(uid).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_tokens WHERE used_at IS NOT NULL').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = 'old@x.pl'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE email = 'old@x.pl'").get().n, 0);
  assert.equal((await req('GET', '/api/auth/me', null, s)).statusCode, 401);
});
