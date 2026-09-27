import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, memStorage } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Hosting repozytoriów (js/repo-hosts.js) na zaślepce CM.App: adresy plików na GitHub / GitLab / Bitbucket,
// udostępnialny widok #v= (serializacja i walidacja przy odtwarzaniu), ostatnie repozytoria, karta autora (XSS), Gist.
const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

function load({ meta = {}, nodes = [], fetch, extra = {} } = {}) {
  const doc = miniDocument(), log = [], toasts = [];
  const main = doc.createElement('div'); main.id = 'main'; doc.body.appendChild(main);
  const cam = { x: 12.34, y: -5.678, zoom: 1.234567, rot: 0.5, tilt: 0.1234 };
  const A = {
    state: { groups: [], counts: { nodes: nodes.length }, layout: 'force', vis: { nodes: [] } }, filters: {}, handlers: {},
    graph: { meta, nodes: new Map(nodes.map((n) => [n.id, n])) },
    renderer: { cam, selected: null, w: 800, h: 600, setSelected: (n) => log.push(['sel', n.id]), onChange() {}, kick() {} },
    revealNode: (id) => log.push(['reveal', id]), applyImpact() {},
    openGist: (id, o) => { log.push(['gist', id, typeof o.onLoaded]); return 'gist-ok'; },
    openShare: (id) => { log.push(['share', id]); return 'share-ok'; },
    ingest: async (factory, status) => { log.push(['ingest', status, A._restoring]); log.push(['factory', await factory(() => {}, () => {})]); return true; },
  };
  const ls = memStorage();
  // moduły, które repo-hosts.js czyta przy ładowaniu (const Loaders=CM.Loaders…) — zaślepki przed załadowaniem
  const Loaders = { fromRepoURL: async (url, opts) => ({ url, opts: JSON.parse(JSON.stringify(opts)) }),
    createGist: async () => ({ id: 'ABCDEF0123456789ABCD', url: 'https://gist.github.com/x/abcdef0123456789abcd' }) };
  const CM = loadCM(['util', 'icons', 'i18n', 'languages', 'analysis', 'graph', 'deeplink', 'repo-hosts'], {
    document: doc, localStorage: ls, setTimeout: setTimeoutUnref, CM: { App: A, Loaders, UI: { renderDetails() {} }, Storage: {} }, fetch: fetch || (async () => json({}, 404)),
    location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', hash: '', search: '', protocol: 'http:' }, ...extra });
  CM.util.toast = (m, k) => toasts.push([String(m), typeof k === 'object' ? k.kind : k]);
  return { A, CM, doc, log, toasts, ls, cam };
}
const GH = { host: 'github', kind: 'github', html: 'https://github.com/o/r', branch: 'feature/x', name: 'r' };

describe('nodeRepoUrl / repoHostName', () => {
  test('GitHub: blob dla pliku, tree dla folderu, gałąź i segmenty ścieżki kodowane, podkatalog projektu jako prefiks', () => {
    const { A } = load({ meta: { ...GH, sub: 'pkg/' } });
    assert.equal(A.nodeRepoUrl({ type: 'file', path: 'src/my file#1.js' }), 'https://github.com/o/r/blob/feature%2Fx/pkg/src/my%20file%231.js');
    assert.equal(A.nodeRepoUrl({ type: 'folder', path: 'src' }), 'https://github.com/o/r/tree/feature%2Fx/pkg/src');
    assert.equal(A.repoHostName(), 'GitHub');
  });
  test('GitLab (/-/blob|tree), Bitbucket (/src), korzeń → strona repozytorium, domyślna gałąź z repoInfo', () => {
    const gl = load({ meta: { host: 'gitlab', html: 'https://gitlab.com/g/p', branch: 'main' } });
    assert.equal(gl.A.nodeRepoUrl({ type: 'file', path: 'a/b.py' }), 'https://gitlab.com/g/p/-/blob/main/a/b.py');
    assert.equal(gl.A.nodeRepoUrl({ type: 'folder', path: 'a' }), 'https://gitlab.com/g/p/-/tree/main/a');
    const bb = load({ meta: { host: 'bitbucket', html: 'https://bitbucket.org/w/r', repoInfo: { defaultBranch: 'develop' } } });
    assert.equal(bb.A.nodeRepoUrl({ type: 'file', path: 'x.js' }), 'https://bitbucket.org/w/r/src/develop/x.js');
    assert.equal(bb.A.nodeRepoUrl({ type: 'folder', path: '' }), 'https://bitbucket.org/w/r');
    assert.equal(bb.A.repoHostName(), 'Bitbucket');
  });
  test('brak adresu: zależność zewnętrzna, schemat porównawczy, projekt lokalny, brak węzła', () => {
    const { A } = load({ meta: GH });
    assert.equal(A.nodeRepoUrl({ type: 'external', path: 'react' }), null);
    assert.equal(A.nodeRepoUrl({ type: 'file', path: 'a.js', gid: 'g1' }), null);
    assert.equal(A.nodeRepoUrl(null), null);
    const local = load({ meta: { name: 'x', kind: 'local' } });
    assert.equal(local.A.nodeRepoUrl({ type: 'file', path: 'a.js' }), null);
    assert.equal(local.A.repoHostName(), '');
  });
});

describe('widok #v=', () => {
  const decode = (h) => JSON.parse(decodeURIComponent(h.slice(3)));
  test('serializeView: źródło repo z gałęzią i podkatalogiem, kamera zaokrąglona, zaznaczenie; pusta mapa / odtwarzanie → ""', () => {
    const { A } = load({ meta: { ...GH, sub: 'lib' }, nodes: [{ id: 'a.js' }] });
    A.renderer.selected = { id: 'a.js' };
    assert.deepEqual(decode(A.serializeView()), { v: 1, ly: 'force', cam: [12.3, -5.7, 1.2346, 0.5, 0.123], src: 'https://github.com/o/r', b: 'feature/x', sub: 'lib', sel: 'a.js' });
    A._restoring = true; assert.equal(A.serializeView(), '');
    const empty = load({ meta: GH });
    assert.equal(empty.A.serializeView(), '');
  });
  test('mapa z Gista / publicznego linku: link niesie ich id zamiast repozytorium; mapa lokalna — bez źródła', () => {
    const { A } = load({ meta: GH, nodes: [{ id: 'x' }] });
    A.state.linkSrc = { type: 'gist', id: 'abc' };
    const o = decode(A.serializeView());
    assert.equal(o.gist, 'abc'); assert.equal(o.src, undefined);
    const local = load({ meta: { kind: 'local', html: 'https://github.com/o/r' }, nodes: [{ id: 'x' }] });
    assert.equal(decode(local.A.serializeView()).src, undefined);
  });
  test('restoreView: nie #v=, zły JSON, zła wersja → false; #v= z gistem / share → otwarcie z kamerą po wczytaniu', async () => {
    const h = (o) => '#v=' + encodeURIComponent(JSON.stringify(o));
    for (const hash of ['', '#repo=o/r', '#v=%7Bzly', h({ v: 2 })]) {
      const { A } = load({ extra: { location: { hash, origin: 'http://localhost', pathname: '/' } } });
      assert.equal(await A.restoreView(), false, hash);
    }
    const g = load({ extra: { location: { hash: h({ v: 1, gist: 'abc', cam: [1, 2, 3, 0, 0] }), origin: 'x', pathname: '/' } } });
    assert.equal(await g.A.restoreView(), 'gist-ok');
    assert.deepEqual(g.log, [['gist', 'abc', 'function']]);
    const s = load({ extra: { location: { hash: h({ v: 1, share: 'S' }), origin: 'x', pathname: '/' } } });
    assert.equal(await s.A.restoreView(), 'share-ok');
  });
  test('restoreView: źródło walidowane jak #repo= — obcy host albo zła gałąź → komunikat, bez wczytywania', async () => {
    const h = (o) => '#v=' + encodeURIComponent(JSON.stringify(o));
    for (const o of [{ v: 1, src: 'https://evil.example/o/r' }, { v: 1, src: 'https://github.com/o/r', b: '../../x' }, { v: 1, src: 'https://github.com/o/r', sub: 'a/../b' }]) {
      const { A, log, toasts } = load({ extra: { location: { hash: h(o), origin: 'x', pathname: '/' } } });
      assert.equal(await A.restoreView(), false, JSON.stringify(o));
      assert.equal(log.length, 0); assert.equal(toasts[0][1], 'error');
    }
  });
  test('restoreView: poprawne źródło → układ ustawiony przed wczytaniem, ingest z gałęzią i podkatalogiem, kamera po ułożeniu', async () => {
    const hash = '#v=' + encodeURIComponent(JSON.stringify({ v: 1, ly: 'treemap', src: 'https://gitlab.com/g/p', b: 'dev', sub: 'lib', cam: [1, 2, 3, 0.1, 0.2] }));
    const { A, doc, log } = load({ extra: { location: { hash, origin: 'x', pathname: '/' } } });
    const sel = doc.createElement('select'); sel.id = 'sel-layout'; doc.body.appendChild(sel);
    for (const v of ['force', 'treemap']) { const o = doc.createElement('option'); o.value = v; o.textContent = 'U-' + v; sel.appendChild(o); }
    assert.equal(await A.restoreView(), true);
    assert.equal(sel.value, 'treemap');
    assert.deepEqual(log[0].slice(2), [true], 'ingest w trybie _restoring');
    assert.deepEqual(log[1][1], { url: 'https://gitlab.com/g/p', opts: { branch: 'dev', sub: 'lib', fetchContent: true } });
    assert.equal(A._restoring, false);
    A.state._pendingViewRestore();
    assert.deepEqual([A.renderer.cam.x, A.renderer.cam.y, A.renderer.cam.zoom, A.renderer.cam.rot, A.renderer.cam.tilt], [1, 2, 3, 0.1, 0.2]);
  });
  test('setLayoutSelect: tylko istniejąca opcja (bez składania selektorów z danych linku), etykieta menu', () => {
    const { A, doc } = load();
    assert.equal(A.setLayoutSelect('force'), false, 'bez <select>');
    const sel = doc.createElement('select'); sel.id = 'sel-layout'; doc.body.appendChild(sel);
    const lbl = doc.createElement('span'); lbl.id = 'layout-menu-label'; doc.body.appendChild(lbl);
    const o = doc.createElement('option'); o.value = 'pack'; o.textContent = 'Upakowane'; sel.appendChild(o);
    assert.equal(A.setLayoutSelect('"] , script'), false);
    assert.equal(A.setLayoutSelect('pack'), true);
    assert.equal(sel.value, 'pack'); assert.equal(lbl.textContent, 'Upakowane');
  });
});

describe('ostatnie repozytoria', () => {
  test('najnowsze pierwsze, bez duplikatów (po adresie), najwyżej 6; uszkodzony zapis → pusta lista', () => {
    const { A, ls } = load();
    for (let i = 0; i < 8; i++) A.pushRecentRepo({ html: 'https://github.com/o/r' + i, repo: 'o/r' + i, kind: 'github' });
    A.pushRecentRepo({ html: 'https://github.com/o/r3', name: 'r3', host: 'github' });
    A.pushRecentRepo(null); A.pushRecentRepo({ name: 'bez adresu' });
    const list = host(A.recentRepos());
    assert.equal(list.length, 6);
    assert.deepEqual(list.slice(0, 3).map((r) => r.name), ['r3', 'o/r7', 'o/r6']);
    assert.equal(list.filter((r) => r.url.endsWith('/r3')).length, 1);
    ls.setItem('codemap_recent_repos', '{zle');
    assert.deepEqual(host(A.recentRepos()), []);
  });
});

describe('karta autora', () => {
  const card = () => { const c = { innerHTML: '', querySelector: () => ({}) }; return c; };
  test('renderAuthorCard: tekst z API escapowany, adresy tylko http(s) (javascript: → awatar zastępczy)', () => {
    const { A } = load();
    const c = card();
    A.renderAuthorCard(c, { name: '<img src=x onerror=alert(1)>', bio: '"><script>', avatar_url: 'javascript:alert(1)', blog: 'example.com/"x', twitter_username: 'a"b', public_repos: 3 }, 'ala', 'javascript:void(0)', 'GitHub');
    const h = c.innerHTML;
    assert.ok(!h.includes('<img src=x') && !h.includes('<script>'));
    assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(h, /src="https:\/\/github\.com\/ala\.png\?size=200"/);
    assert.match(h, /href="https:\/\/github\.com\/ala"/);
    assert.match(h, /href="https:\/\/example\.com\/&quot;x"/);
    assert.match(h, /href="https:\/\/twitter\.com\/a&quot;b"/);
    assert.ok(!/href="javascript:/i.test(h));
    assert.equal(A.safeUrl(' http://a.b '), 'http://a.b'); assert.equal(A.safeUrl('data:x'), ''); assert.equal(A.safeUrl(null), '');
  });
  test('openAuthorCard: profil z GitHub API raz (pamięć podręczna); 403 → komunikat o limicie; GitLab bez zapytań', async () => {
    const calls = [];
    let status = 200;
    const { A, doc } = load({ fetch: async (u, o) => { calls.push([u, o.headers]); return status === 200 ? json({ name: 'Ala', login: 'ala' }) : json({}, status); } });
    const c = doc.createElement('div'); c.id = 'author-card'; c.querySelector = () => ({}); doc.getElementById('main').appendChild(c);
    const tok = doc.createElement('input'); tok.id = 'gh-token'; tok.value = ' T '; doc.body.appendChild(tok);
    await A.openAuthorCard({ login: 'ala', avatar: 'https://avatars.githubusercontent.com/u/1' });
    assert.deepEqual(host(calls), [['https://api.github.com/users/ala', { Authorization: 'token T' }]]);
    assert.match(c.innerHTML, /class="ac-name">Ala</);
    await A.openAuthorCard({ login: 'ala' });
    assert.equal(calls.length, 1);
    status = 403;
    await A.openAuthorCard({ login: 'bob' });
    assert.match(c.innerHTML, /class="ac-err">Limit zapytań GitHub API/);
    await A.openAuthorCard({ login: 'gl', host: 'gitlab', url: 'https://gitlab.com/gl' });
    assert.equal(calls.length, 2);
    assert.match(c.innerHTML, /na GitLab/);
  });
});

describe('eksport do Gista', () => {
  test('brak mapy → komunikat; token z pola; poprawny id → link #gist= w schowku (małe litery)', async () => {
    const copied = [];
    const empty = load();
    await empty.A.exportGist();
    assert.equal(empty.toasts[0][0], 'Brak mapy do eksportu.');
    const { A, doc, toasts } = load({ meta: { name: 'demo' }, nodes: [{ id: 'a' }], extra: { navigator: { clipboard: { writeText: async (s) => copied.push(s) } } } });
    A.graph.toJSON = () => ({ format: 'codemap' });
    const tok = doc.createElement('input'); tok.id = 'gh-token'; tok.value = 'ghp_x'; doc.body.appendChild(tok);
    await A.exportGist();
    assert.equal(A.state._ghToken, 'ghp_x');
    assert.deepEqual(copied, ['http://localhost/#gist=abcdef0123456789abcd']);
    assert.equal(toasts.at(-1)[1], 'success');
    assert.match(toasts.at(-1)[0], /href="http:\/\/localhost\/#gist=abcdef0123456789abcd"/);
  });
  test('bez tokenu: pytanie o token; anulowanie → nic nie wysyłane', async () => {
    let sent = 0;
    const { A, CM } = load({ meta: { name: 'demo' }, nodes: [{ id: 'a' }], extra: { prompt: () => null } });
    CM.Loaders.createGist = async () => { sent++; return {}; };
    await A.exportGist();
    assert.equal(sent, 0);
  });
});
