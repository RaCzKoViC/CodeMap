import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createContext, runFile, host, memStorage } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Konto użytkownika po stronie klienta (js/auth.js) na minimalnym DOM i podstawionym fetch: warstwa api(),
// wykrywanie backendu, formularze logowania / rejestracji / resetu, linki z e-maili i zakładka „Konto".

// moduł ładowany jawnie po adresie: auth.js jest też w server/ — sama nazwa pliku testu nie wskazuje podmiotu jednoznacznie
const SUBJECT = new URL('../js/auth.js', import.meta.url);
function loadCM(mods, extra) {
  const ctx = createContext(extra);
  for (const m of mods) runFile(ctx, `js/${m}.js`);
  vm.runInContext(readFileSync(SUBJECT, 'utf8'), ctx, { filename: 'js/auth.js' });
  return ctx.CM;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };

function load({ me = () => json({ error: 'auth' }, 401), route = () => json({}, 404), search = '', extra = {} } = {}) {
  const doc = miniDocument(), calls = [], history = [], events = [];
  for (const [tag, id] of [['button', 'btn-account'], ['div', 'modal-auth'], ['h3', 'auth-title'], ['div', 'auth-body']]) {
    const e = doc.createElement(tag); e.id = id; (id === 'auth-title' || id === 'auth-body' ? doc.getElementById('modal-auth') : doc.body).appendChild(e);
  }
  doc.getElementById('modal-auth').classList.add('hidden');
  doc.addEventListener('cm-auth-change', (e) => events.push(e.detail.user && e.detail.user.email));
  const parse = (b) => { try { return JSON.parse(b); } catch { return b; } };
  const fetch = async (url, init = {}) => { calls.push({ url, init, body: typeof init.body === 'string' ? parse(init.body) : init.body });
    return url === '/api/auth/me' ? me() : route(url, init); };
  const CM = loadCM(['util', 'i18n'], { document: doc, fetch, CustomEvent, localStorage: memStorage(), setTimeout: setTimeoutUnref,
    location: { href: 'http://localhost/' + search, origin: 'http://localhost', pathname: '/', hash: '#v=1', search, protocol: 'http:' },
    history: { replaceState: (...a) => history.push(a) }, ...extra });
  return { A: CM.Auth, CM, doc, calls, history, events };
}
const val = (doc, id, v) => { doc.getElementById(id).value = v; };
const errText = (doc) => doc.querySelector('.auth-err').textContent;
const toasts = (doc) => (doc.getElementById('toast-wrap') || { children: [] }).children.map((t) => t.innerHTML);

describe('api()', () => {
  test('JSON: nagłówek i ciało, ciasteczka same-origin; odpowiedź nie-JSON zwracana jako Response', async () => {
    const { A, calls } = load({ route: (url) => url === '/api/raw' ? new Response('bin', { headers: { 'content-type': 'application/octet-stream' } }) : json({ ok: 1 }) });
    await tick();
    assert.deepEqual(host(await A.api('/api/x', { method: 'PUT', json: { a: 1 }, headers: { 'X-T': '1' } })), { ok: 1 });
    const c = calls.at(-1);
    assert.equal(c.init.method, 'PUT'); assert.equal(c.init.credentials, 'same-origin');
    assert.deepEqual(host(c.init.headers), { 'X-T': '1', 'Content-Type': 'application/json' });
    assert.deepEqual(c.body, { a: 1 });
    const r = await A.api('/api/raw');
    assert.equal(await r.text(), 'bin');
    await A.api('/api/b', { method: 'POST', body: 'surowe' });
    assert.equal(calls.at(-1).init.body, 'surowe');
  });
  test('błędy: kod z JSON serwera, status i dane; bez JSON → „httpNNN"; brak sieci → code net', async () => {
    let mode = 'json';
    const { A } = load({ route: () => { if (mode === 'net') throw new TypeError('Failed to fetch'); return mode === 'json' ? json({ error: 'quota', left: 0 }, 507) : new Response('<html>', { status: 502 }); } });
    await tick();
    await assert.rejects(A.api('/api/x'), (e) => e.code === 'quota' && e.status === 507 && e.data.left === 0 && e.message === 'quota');
    mode = 'html'; await assert.rejects(A.api('/api/x'), (e) => e.message === 'http502' && e.code === '' && e.status === 502);
    mode = 'net'; await assert.rejects(A.api('/api/x'), (e) => e.code === 'net');
  });
});

describe('refresh(): wykrywanie backendu i sesji', () => {
  test('zalogowany: użytkownik, przycisk konta widoczny z klasą logged-in, zdarzenie cm-auth-change', async () => {
    const { A, doc, events } = load({ me: () => json({ email: 'ala@example.com', usedBytes: 0, quotaBytes: 100 }) });
    await tick();
    assert.equal(A.isLoggedIn(), true); assert.equal(A.user.email, 'ala@example.com');
    const b = doc.getElementById('btn-account');
    assert.ok(b.classList.contains('logged-in')); assert.ok(!b.classList.contains('hidden'));
    assert.deepEqual(events, ['ala@example.com']);
    await A.refresh();
    assert.deepEqual(events, ['ala@example.com'], 'odświeżenie quoty to nie zmiana stanu');
  });
  test('401 = serwer jest, brak sesji; 404 / brak sieci = brak backendu (konto ukryte); webview VS Code bez zapytań', async () => {
    const a = load(); await tick();
    assert.equal(a.A.isLoggedIn(), false);
    assert.ok(!a.doc.getElementById('btn-account').classList.contains('hidden'));
    assert.ok(!a.doc.body.classList.contains('no-backend'));
    const b = load({ me: () => json({}, 404) }); await tick();
    assert.ok(b.doc.getElementById('btn-account').classList.contains('hidden'));
    assert.ok(b.doc.body.classList.contains('no-backend'));
    const v = load({ extra: { acquireVsCodeApi: () => ({}) } }); await tick();
    assert.equal(v.calls.length, 0); assert.ok(v.doc.body.classList.contains('no-backend'));
  });
  test('401 z dowolnego API przy aktywnej sesji wylogowuje (zdarzenie z user=null)', async () => {
    const { A, events } = load({ me: () => json({ email: 'a@b.pl' }), route: () => json({ error: 'auth' }, 401) });
    await tick();
    await assert.rejects(A.api('/api/sync/manifest'), (e) => e.status === 401);
    assert.equal(A.isLoggedIn(), false);
    assert.deepEqual(events, ['a@b.pl', null]);
  });
});

describe('formularze', () => {
  test('logowanie: POST z e-mailem (przyciętym) i hasłem; sukces zamyka okno; zły login → komunikat w formularzu', async () => {
    let ok = false;
    const { A, doc, calls } = load({ route: () => ok ? json({ email: 'ala@example.com' }) : json({ error: 'credentials' }, 401) });
    await tick();
    A.open();
    assert.ok(!doc.getElementById('modal-auth').classList.contains('hidden'));
    assert.equal(doc.getElementById('auth-title').textContent, 'Logowanie');
    val(doc, 'auth-email', '  ala@example.com '); val(doc, 'auth-pass', 'zle-haslo');
    await doc.querySelector('.auth-main').onclick();
    assert.equal(calls.at(-1).url, '/api/auth/login');
    assert.deepEqual(calls.at(-1).body, { email: 'ala@example.com', password: 'zle-haslo' });
    assert.equal(errText(doc), 'Nieprawidłowy e-mail lub hasło.');
    assert.equal(doc.querySelector('.auth-main').disabled, false, 'przycisk odblokowany po błędzie');
    ok = true;
    await doc.querySelector('.auth-main').onclick();
    assert.equal(A.isLoggedIn(), true);
    assert.ok(doc.getElementById('modal-auth').classList.contains('hidden'));
    assert.ok(toasts(doc).some((t) => t.includes('Zalogowano: ala@example.com')));
  });
  test('rejestracja: walidacja długości i zgodności haseł bez zapytań; sukces → widok z linkiem dev', async () => {
    const { A, doc, calls } = load({ route: () => json({ ok: true, devVerifyLink: 'http://localhost/api/auth/verify?token=T' }) });
    await tick();
    A.open('register');
    const n0 = calls.length;
    val(doc, 'auth-email', 'x@y.pl'); val(doc, 'auth-pass', 'krotkie'); val(doc, 'auth-pass2', 'krotkie');
    await doc.querySelector('.auth-main').onclick();
    assert.equal(errText(doc), 'Hasło musi mieć co najmniej 10 znaków.');
    val(doc, 'auth-pass', 'dlugie-haslo-1'); val(doc, 'auth-pass2', 'dlugie-haslo-2');
    await doc.querySelector('.auth-main').onclick();
    assert.equal(errText(doc), 'Hasła nie są takie same.');
    assert.equal(calls.length, n0);
    val(doc, 'auth-pass2', 'dlugie-haslo-1');
    await doc.querySelector('.auth-main').onclick();
    assert.deepEqual(calls.at(-1).body, { email: 'x@y.pl', password: 'dlugie-haslo-1', lang: 'pl' });
    const dev = doc.querySelector('.auth-dev');
    assert.ok(dev && !dev.classList.contains('hidden'));
    assert.ok(doc.querySelector('.auth-info').textContent.startsWith('Konto utworzone.'));
  });
  test('reset: prośba z linkiem dev przechodzi do formularza nowego hasła z tokenem; błąd tokenu po polsku', async () => {
    const { A, doc, calls } = load({ route: (url) => url === '/api/auth/request-reset' ? json({ ok: true, devResetLink: 'http://localhost/?reset=TOK123' }) : json({ error: 'token' }, 400) });
    await tick();
    A.open('reset-request');
    val(doc, 'auth-email', 'a@b.pl');
    await doc.querySelector('.auth-main').onclick();
    assert.equal(doc.getElementById('auth-title').textContent, 'Nowe hasło');
    val(doc, 'auth-pass', 'nowe-haslo-123'); val(doc, 'auth-pass2', 'nowe-haslo-123');
    await doc.querySelector('.auth-main').onclick();
    assert.deepEqual(calls.at(-1).body, { token: 'TOK123', password: 'nowe-haslo-123' });
    assert.equal(errText(doc), 'Link jest nieprawidłowy lub wygasł.');
  });
});

describe('linki z e-maili i zakładka „Konto"', () => {
  test('?verified=1 → komunikat, czyszczenie adresu, po chwili okno logowania; ?reset=… → formularz nowego hasła', async () => {
    const v = load({ search: '?verified=1' });
    assert.ok(toasts(v.doc).some((t) => t.startsWith('E-mail potwierdzony')));
    assert.deepEqual(v.history[0], [null, '', '/#v=1']);
    await tick(450);
    assert.equal(v.doc.getElementById('auth-title').textContent, 'Logowanie');
    const bad = load({ search: '?verified=0' });
    assert.ok(toasts(bad.doc).some((t) => t.startsWith('Link weryfikacyjny jest nieprawidłowy')));
    const r = load({ search: '?reset=abc' });
    await tick(250);
    assert.equal(r.doc.getElementById('auth-title').textContent, 'Nowe hasło');
    assert.ok(!r.doc.getElementById('modal-auth').classList.contains('hidden'));
  });
  test('renderAccount: wylogowany → opis i przyciski; zalogowany → e-mail, pasek quoty w %, zmiana hasła', async () => {
    const out = load(); await tick();
    const c = out.doc.createElement('div');
    out.A.renderAccount(c);
    assert.equal(c.querySelectorAll('button').length, 2);
    const inn = load({ me: () => json({ email: 'ala@example.com', usedBytes: 250, quotaBytes: 1000, createdAt: Date.now() }) }); await tick();
    const d = inn.doc.createElement('div');
    inn.A.renderAccount(d);
    assert.equal(d.querySelector('.set-desc').textContent, 'ala@example.com');
    assert.equal(d.querySelector('.auth-quota-fill').getAttribute('style'), 'width:25%');
    assert.ok(d.querySelector('#acct-cur') && d.querySelector('#acct-new'));
  });
});
