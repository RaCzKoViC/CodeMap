import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Deep-linki i publiczne linki (js/links.js): otwieranie #repo= / #gist= / #share= / #tour= na zaślepce CM.App
// (ingest, loadFromJSON, generacje wczytywania), okno „Udostępnij publiczny link…" i lista linków w „Koncie".
const GIST = 'abcdef0123456789abcd', SHARE = 'AbCdEfGhIjKlMnOpQrStUv';
const MAP = { format: 'codemap', version: 2, meta: { name: 'demo' }, nodes: [{ id: '__root__', type: 'folder' }, { id: 'a.js', type: 'file', preview: 'tajne' }], edges: [] };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };

function load({ route = () => json({}, 404), loaded = true, nodes = 0, confirmAnswer = true, extra = {} } = {}) {
  const doc = miniDocument(), calls = [], log = [], winListeners = {};
  const fetch = async (url, init) => { calls.push({ url, init }); return route(url, init); };
  const A = { state: { counts: { nodes } }, _ingestGen: 0, _restoring: false, graph: { meta: { name: 'demo' } },
    showLoading: (t) => log.push(['loading', t]), hideLoading: () => log.push(['hide']),
    loadFromJSON: (obj, o) => { log.push(['load', obj.meta.name, o.toast, A._restoring]); return loaded; },
    setLayoutSelect: (l) => log.push(['layout', l]),
    ingest: async (factory, status) => { log.push(['ingest', status, A._restoring]); const r = await factory(() => {}, () => {}); log.push(['ingested', r]); return true; } };
  const CM = loadCM(['util', 'i18n', 'deeplink', 'ui-kit', 'links'], {
    document: doc, fetch, confirm: () => confirmAnswer, setTimeout: setTimeoutUnref, addEventListener: (t, fn) => { winListeners[t] = fn; },
    location: { href: 'http://localhost/app/', origin: 'http://localhost', pathname: '/app/', hash: '', search: '', protocol: 'http:' },
    CM: { App: A }, ...extra });
  const toasts = [];
  CM.util.toast = (m, k) => toasts.push([String(m), typeof k === 'object' ? k.kind : k]);
  CM.Loaders = { fromRepoURL: async (url, opts) => ({ url, opts: JSON.parse(JSON.stringify(opts)) }) };
  return { CM, A, L: CM.Links, doc, calls, log, toasts, winListeners };
}

describe('openDeepLink', () => {
  test('nie nasze hashe (#demo, #v=, puste) → false bez zapytań; zły link → czytelny komunikat', async () => {
    const { A, calls, toasts } = load();
    for (const h of ['#demo', '#v=%7B%7D', '', '#cos']) assert.equal(await A.openDeepLink(h), false, h);
    assert.equal(await A.openDeepLink('#repo=https://evil.example/x/y'), false);
    assert.equal(await A.openDeepLink('#gist=nie-hex'), false);
    assert.equal(calls.length, 0);
    assert.match(toasts[0][0], /^Nieprawidłowy link #repo=/); assert.match(toasts[1][0], /^Nieprawidłowy link #gist=/);
  });
  test('#gist=: mapa z Gista wczytana w trybie _restoring, źródło zapamiętane, toast z właścicielem; bez tokenu', async () => {
    const { A, calls, log, toasts } = load({ route: () => json({ owner: { login: 'ala' }, files: { 'codemap.json': { content: JSON.stringify(MAP) } } }) });
    assert.equal(await A.openDeepLink('#gist=' + GIST.toUpperCase()), true);
    assert.equal(calls[0].url, 'https://api.github.com/gists/' + GIST);
    assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.deepEqual(log.find((l) => l[0] === 'load'), ['load', 'demo', false, true]);
    assert.equal(A._restoring, false);
    assert.deepEqual(host(A.state.linkSrc), { type: 'gist', id: GIST });
    assert.deepEqual(toasts.at(-1), ['Otwarto mapę z Gista: <b>demo</b> (@ala)', 'success']);
  });
  test('#gist= nieistniejący → komunikat z przyczyną (PL), źródło bez zmian; nowsze wczytanie unieważnia pobieranie', async () => {
    const miss = load({ route: () => json({}, 404) });
    assert.equal(await miss.A.openDeepLink('#gist=' + GIST), false);
    assert.equal(miss.toasts.at(-1)[0], 'Nie udało się otworzyć mapy z Gista: gist nie istnieje albo został usunięty (404).');
    assert.equal(miss.A.state.linkSrc, null);
    let A2;
    const stale = load({ route: () => { A2._ingestGen++; return json({ files: { 'codemap.json': { content: JSON.stringify(MAP) } } }); } });
    A2 = stale.A;
    assert.equal(await stale.A.openDeepLink('#gist=' + GIST), false);
    assert.ok(!stale.log.some((l) => l[0] === 'load' || l[0] === 'hide'), 'przestarzały wynik porzucony bez ruszania UI');
  });
  test('#share=: ten sam origin, bez ciasteczek; odrzucona mapa (loadFromJSON=false) → false i brak źródła', async () => {
    const { A, calls } = load({ loaded: false, route: () => json(MAP) });
    assert.equal(await A.openDeepLink('#share=' + SHARE), false);
    assert.equal(calls[0].url, '/api/share/' + SHARE);
    assert.equal(calls[0].init.credentials, 'omit');
    assert.equal(A.state.linkSrc, null);
    const bad = load({ route: () => json({}, 429) });
    await bad.A.openDeepLink('#share=' + SHARE);
    assert.match(bad.toasts.at(-1)[0], /zbyt wiele zapytań/);
  });
  test('#repo= z gałęzią, podkatalogiem, układem i PR: publiczny ingest z treścią, potem mapa wpływu PR', async () => {
    const { A, CM, log, toasts } = load();
    const pr = []; CM.PR = { run: (n) => pr.push(n) };
    assert.equal(await A.openDeepLink('#repo=gitlab.com/g/sub/p&branch=dev&path=lib/&layout=treemap&pr=12'), true);
    assert.deepEqual(log[0], ['layout', 'treemap']);
    assert.equal(log[1][2], true, 'ingest w trybie _restoring');
    assert.deepEqual(log[2][1], { url: 'https://gitlab.com/g/sub/p', opts: { branch: 'dev', sub: 'lib', fetchContent: true } });
    assert.deepEqual(pr, [12]);
    assert.equal(toasts.at(-1)[0], 'Otwarto z linku: <b>gitlab.com/g/sub/p@dev / lib</b>');
  });
  test('#tour= otwiera trasę na bieżącej mapie; potwierdzenie zastąpienia mapy (odmowa → false bez pobierania)', async () => {
    const tours = [];
    const t = load({ extra: {} }); t.CM.TourUI = { openEncoded: (x) => { tours.push(x); return true; } };
    assert.equal(await t.A.openDeepLink('#tour=zAbCdEf'), true);
    assert.deepEqual(tours, ['zAbCdEf']);
    const c = load({ nodes: 5, confirmAnswer: false });
    assert.equal(await c.A.openDeepLink('#gist=' + GIST, { confirmReplace: true }), false);
    assert.equal(c.calls.length, 0);
  });
  test('zmiana hasha w otwartej aplikacji (#gist=) uruchamia otwieranie z pytaniem o zastąpienie', async () => {
    let asked = 0;
    const loc = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', hash: '#v=%7B%7D', search: '', protocol: 'http:' };
    const { winListeners, calls } = load({ nodes: 3, extra: { location: loc, confirm: () => { asked++; return false; } } });
    winListeners.hashchange();
    assert.equal(asked, 0, '#v= to nie deep-link');
    loc.hash = '#gist=' + GIST;
    winListeners.hashchange();
    await tick();
    assert.equal(asked, 1);
    assert.equal(calls.length, 0, 'odmowa = bez pobierania');
  });
});

describe('udostępnianie publicznym linkiem', () => {
  function withMap(opts = {}) {
    const r = load({ nodes: 2, ...opts });
    const gitInfo = { authors: [{ name: 'A', email: 'a@b.pl' }] };
    r.A.graph = { meta: { name: 'Mój projekt' }, gitInfo, toJSON: () => ({ ...JSON.parse(JSON.stringify(MAP)), gitInfo: JSON.parse(JSON.stringify(gitInfo)) }) };
    const api = [];
    r.CM.Auth = { isLoggedIn: () => true, refresh() {}, api: async (path, o) => { api.push([path, o]); if (opts.apiErr) throw opts.apiErr; return path === '/api/shares' ? opts.list || [] : { id: SHARE, expiresAt: null }; } };
    return { ...r, api };
  }
  test('bez logowania albo bez mapy — komunikat zamiast okna', () => {
    const r = load(); r.CM.Auth = { isLoggedIn: () => false };
    r.A.openShareDialog();
    assert.match(r.toasts[0][0], /Zaloguj się/);
    const e = load({ nodes: 0 }); e.CM.Auth = { isLoggedIn: () => true };
    e.A.openShareDialog();
    assert.equal(e.toasts[0][0], 'Brak mapy do eksportu.');
    assert.equal(e.doc.getElementById('modal-share'), null);
  });
  test('utworzenie: nazwa i wygaśnięcie w query, mapa bez podglądów treści i e-maili; wynik z adresem linku', async () => {
    const { A, doc, api, toasts } = withMap();
    A.openShareDialog();
    assert.equal(doc.getElementById('share-name').value, 'Mój projekt');
    assert.equal(doc.getElementById('share-exp').value, '30');
    doc.getElementById('share-name').value = '  Wersja do recenzji ';
    await doc.getElementById('share-go').onclick();
    const [path, o] = api[0];
    assert.equal(path, '/api/shares?name=Wersja+do+recenzji&expiresInDays=30');
    assert.equal(o.method, 'POST'); assert.equal(o.headers['Content-Type'], 'application/json');
    const sent = JSON.parse(o.body);
    assert.equal(sent.nodes[1].preview, null, 'podgląd treści usunięty');
    assert.deepEqual(sent.gitInfo.authors, [{ name: 'A' }], 'e-maile autorów usunięte');
    assert.equal(doc.getElementById('share-url').value, 'http://localhost/app/#share=' + SHARE);
    assert.equal(toasts.at(-1)[1], 'success');
  });
  test('błędy serwera → komunikaty w oknie (413 za duża, 409 limit, sieć)', async () => {
    for (const [e, re] of [[{ status: 413 }, /za duża/], [{ status: 409 }, /limit aktywnych linków/], [{ code: 'net' }, /Brak połączenia z serwerem/], [{ status: 500, message: 'x' }, /Nie udało się utworzyć linku: x/]]) {
      const { A, doc } = withMap({ apiErr: Object.assign(new Error(e.message || 'e'), e) });
      A.openShareDialog();
      await doc.getElementById('share-go').onclick();
      const err = doc.querySelector('.auth-err');
      assert.match(err.textContent, re); assert.ok(!err.classList.contains('hidden'));
      assert.equal(doc.getElementById('share-go').disabled, false);
    }
  });
  test('lista linków w „Koncie": tylko poprawne id, unieważnienie (404 = już nie ma) usuwa wiersz', async () => {
    const list = [{ id: SHARE, name: '<b>mapa</b>', createdAt: 1, expiresAt: null, views: 3, size: 2048 }, { id: '../zly', name: 'x' }];
    const r = withMap({ list });
    const c = r.doc.createElement('div'); r.doc.body.appendChild(c);
    r.L.renderAccountSection(c);
    await tick();
    const rows = c.querySelectorAll('.share-row');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].querySelector('.share-row-name').textContent, '<b>mapa</b>');
    r.CM.Auth.api = async (p, o) => { r.api.push([p, o]); throw Object.assign(new Error('nf'), { status: 404 }); };
    await rows[0].querySelector('.danger').onclick();
    assert.deepEqual(r.api.at(-1)[0], '/api/shares/' + SHARE);
    assert.equal(c.querySelectorAll('.share-row').length, 0);
    assert.ok(c.querySelector('.share-list').textContent.startsWith('Brak aktywnych linków'));
  });
  test('shareUrl: origin + ścieżka aplikacji + #share=', () => {
    const { L } = load();
    assert.equal(L.shareUrl(SHARE), 'http://localhost/app/#share=' + SHARE);
  });
});
