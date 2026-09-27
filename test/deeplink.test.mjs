// Deep-linki i mapy z linków (js/deeplink.js) oraz podkatalog repozytorium w loaderach (js/loaders.js, opts.sub).
// Bez sieci: fetch jest podstawiany, odpowiedzi to prawdziwe obiekty Response (strumień + nagłówki).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';

const CM = loadCM(['util', 'i18n', 'deeplink']);
const DL = CM.DeepLink;
const GID = '0123456789abcdef0123456789abcdef';
const SID = 'AbCdEfGhIjKlMnOpQrStUv_-';   // 24 znaki base64url

const MAP = { format: 'codemap', version: 2, meta: { name: 'demo' }, nodes: [{ id: '__root__', type: 'folder' }, { id: 'a.js', type: 'file', parent: '__root__', preview: 'const a=1;' }], edges: [] };
const json = (o) => JSON.stringify(o);
function resp(body, { status = 200, headers = {} } = {}) {
  return new Response(typeof body === 'string' ? body : json(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
/** fetch z tabelą odpowiedzi po URL; zapisuje wywołania (url + init) */
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const r = routes[String(url)];
    if (r === undefined) return resp({ message: 'Not Found' }, { status: 404 });
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r() : r;
  };
  f.calls = calls;
  return f;
}
const rejectsWith = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code); return true; });

describe('parseRepoSpec — dozwolone źródła', () => {
  const cases = [
    ['owner/name', { host: 'github', repo: 'owner/name', branch: '', sub: '', url: 'https://github.com/owner/name' }],
    ['owner/name@dev', { host: 'github', repo: 'owner/name', branch: 'dev', sub: '' }],
    ['owner/name@main/src/lib', { host: 'github', repo: 'owner/name', branch: 'main', sub: 'src/lib' }],
    ['owner/name.git@v1.2.0', { host: 'github', repo: 'owner/name', branch: 'v1.2.0' }],
    ['octo-org/.github', { host: 'github', repo: 'octo-org/.github' }],
    ['https://github.com/o/r', { host: 'github', repo: 'o/r', url: 'https://github.com/o/r' }],
    ['https://github.com/o/r/', { host: 'github', repo: 'o/r' }],
    ['https://github.com/o/r.git', { host: 'github', repo: 'o/r' }],
    ['github.com/o/r', { host: 'github', repo: 'o/r' }],
    ['HTTPS://WWW.GitHub.com/o/r?tab=readme#top', { host: 'github', repo: 'o/r' }],
    ['https://github.com/o/r/tree/main/src/app', { host: 'github', repo: 'o/r', branch: 'main', sub: 'src/app' }],
    ['https://gitlab.com/grp/sub/proj', { host: 'gitlab', repo: 'grp/sub/proj', owner: 'grp', name: 'proj', url: 'https://gitlab.com/grp/sub/proj' }],
    ['https://gitlab.com/grp/proj/-/tree/dev/lib/core?ref_type=heads', { host: 'gitlab', repo: 'grp/proj', branch: 'dev', sub: 'lib/core' }],
    ['gitlab.com/grp/proj.git', { host: 'gitlab', repo: 'grp/proj' }],
    ['https://bitbucket.org/ws/repo', { host: 'bitbucket', repo: 'ws/repo', url: 'https://bitbucket.org/ws/repo' }],
    ['https://bitbucket.org/ws/repo/src/main/pkg', { host: 'bitbucket', repo: 'ws/repo', branch: 'main', sub: 'pkg' }],
  ];
  for (const [input, want] of cases) {
    test(input, () => {
      const got = host(DL.parseRepoSpec(input));
      assert.ok(got, 'powinno zostać przyjęte');
      for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, k);
    });
  }
});

describe('parseRepoSpec — odrzucane (inne hosty, schematy, ścieżki z .., znaki specjalne)', () => {
  const bad = [
    'https://evil.com/o/r', 'http://github.com/o/r', 'ftp://github.com/o/r', 'javascript:alert(1)', 'data:text/html,<b>x</b>',
    'https://github.com.evil.com/o/r', 'github.com.evil.com/o/r', 'https://github.com@evil.com/o/r', 'https://user:pw@github.com/o/r',
    'https://github.com:8443/o/r', 'github.com:22/o/r', '//github.com/o/r', 'https://raw.githubusercontent.com/o/r/main/x',
    'o/r@main/../../other/repo', 'o/r@main/src/..', '../o/r', 'o/..', 'o/.', 'o/r@..', 'o/r@main/./x', 'github.com/o/r/tree/../../x',
    'o/r@main/%2e%2e/x', 'https://github.com/o/r/tree/ma%2F../x', 'o/r@ma in', 'o/r@main\\x', 'o/r@main?x=1', 'o/r@main#f',
    'o/r@-rf', 'o/r@x.lock', 'o/r@', '-o/r', 'o', 'o/r/x', 'https://github.com/o', 'https://github.com/o/r/blob/main/x.js',
    'https://github.com/o/r/issues', 'https://gitlab.com/g', 'https://gitlab.com/g/p/-/blob/main/x', 'https://bitbucket.org/ws/repo/commits',
    'o/r@main/src\u0000', 'o/r@ma\nin', 'o\t/r', 'x'.repeat(600) + '/r', '', '   ', 'o/r@main/<script>',
  ];
  for (const s of bad) test(JSON.stringify(s).slice(0, 70), () => assert.equal(DL.parseRepoSpec(s), null));
  test('nie-string', () => { assert.equal(DL.parseRepoSpec(null), null); assert.equal(DL.parseRepoSpec({}), null); });
});

describe('parseHash', () => {
  test('#demo, #v= i obce hashe bez zmian', () => {
    assert.equal(DL.parseHash('#demo').kind, 'demo');
    assert.equal(DL.parseHash('#v=%7B%22v%22%3A1%7D').kind, 'view');
    for (const h of ['', '#', '#foo', '#repository=o/r', '#gists=abc', '#reset=1']) assert.equal(DL.parseHash(h), null, h);
  });
  test('#repo= ze skrótem, kodowaniem %, układem, gałęzią i ścieżką z parametrów', () => {
    const a = host(DL.parseHash('#repo=o%2Fr%40main%2Fsrc&layout=treemap'));
    assert.equal(a.kind, 'repo'); assert.equal(a.spec.repo, 'o/r'); assert.equal(a.spec.branch, 'main'); assert.equal(a.spec.sub, 'src'); assert.equal(a.layout, 'treemap');
    const b = host(DL.parseHash('#repo=o/r&branch=feature/x&path=/src/lib/'));
    assert.equal(b.spec.branch, 'feature/x'); assert.equal(b.spec.sub, 'src/lib'); assert.equal(b.layout, '');
    const c = host(DL.parseHash('#repo=https://gitlab.com/g/p/-/tree/dev/lib'));
    assert.equal(c.spec.host, 'gitlab'); assert.equal(c.spec.url, 'https://gitlab.com/g/p');
  });
  test('nieprawidłowy układ jest ignorowany, nie psuje linku', () => {
    for (const ly of ['%3Cscript%3E', 'Force', '1abc', 'x'.repeat(40)]) {
      const r = host(DL.parseHash('#repo=o/r&layout=' + ly));
      assert.equal(r.kind, 'repo'); assert.equal(r.layout, '');
    }
  });
  test('#repo= — błędy z typem i powodem', () => {
    const e = (h) => host(DL.parseHash(h));
    assert.deepEqual(e('#repo=https://evil.com/o/r'), { kind: 'error', type: 'repo', reason: 'source' });
    assert.deepEqual(e('#repo=javascript:alert(1)'), { kind: 'error', type: 'repo', reason: 'source' });
    assert.deepEqual(e('#repo='), { kind: 'error', type: 'repo', reason: 'source' });
    assert.deepEqual(e('#repo=o/r&branch=..'), { kind: 'error', type: 'repo', reason: 'branch' });
    assert.deepEqual(e('#repo=o/r&path=../etc'), { kind: 'error', type: 'repo', reason: 'path' });
    assert.deepEqual(e('#repo=o/r&path=a%2F..%2F..'), { kind: 'error', type: 'repo', reason: 'path' });
    assert.deepEqual(e('#repo=%E0%A4%A'), { kind: 'error', type: 'repo', reason: 'encoding' });
    assert.deepEqual(e('#repo=o/r&x=' + 'a'.repeat(9000)), { kind: 'error', type: 'repo', reason: 'toolong' });
  });
  test('#gist= — tylko [0-9a-f]{20,40}, wielkie litery normalizowane', () => {
    assert.deepEqual(host(DL.parseHash('#gist=' + GID)), { kind: 'gist', id: GID });
    assert.deepEqual(host(DL.parseHash('#gist=' + GID + '&tour=zAbC_-12')), { kind: 'gist', id: GID, tour: 'zAbC_-12' });
    assert.deepEqual(host(DL.parseHash('#gist=' + GID.toUpperCase())), { kind: 'gist', id: GID });
    assert.deepEqual(host(DL.parseHash('#gist=0123456789abcdef0123')), { kind: 'gist', id: '0123456789abcdef0123' });
    for (const v of ['abc', 'a'.repeat(41), '0123456789abcdefghij', 'javascript:alert(1)', '../../x', GID + '/x', GID + '%00', ''])
      assert.equal(DL.parseHash('#gist=' + v).kind, 'error', v);
  });
  test('#share= — base64url 22–64 znaki', () => {
    assert.deepEqual(host(DL.parseHash('#share=' + SID)), { kind: 'share', id: SID });
    for (const v of ['abc', 'A'.repeat(21), 'A'.repeat(65), 'AAAAAAAAAAAAAAAAAAAAAA/../x', '<script>alert(1)</script>AAAAAAAAAA', 'A'.repeat(22) + '='])
      assert.equal(DL.parseHash('#share=' + v).kind, 'error', v);
  });
  test('isDeepLink / label', () => {
    assert.equal(DL.isDeepLink('#repo=o/r'), true); assert.equal(DL.isDeepLink('#v=x'), false); assert.equal(DL.isDeepLink(''), false);
    assert.equal(DL.label(DL.parseRepoSpec('o/r@main/src')), 'github.com/o/r@main / src');
  });
});

describe('validateMap / sanitizeMap / prepareShare', () => {
  test('validateMap', () => {
    assert.equal(DL.validateMap(structuredClone(MAP)), '');
    assert.equal(DL.validateMap(null), 'notmap');
    assert.equal(DL.validateMap([]), 'notmap');
    assert.equal(DL.validateMap({ format: 'other', nodes: [{ id: 'a' }] }), 'notmap');
    assert.equal(DL.validateMap({ format: 'codemap', nodes: [] }), 'badmap');
    assert.equal(DL.validateMap({ format: 'codemap', nodes: [1] }), 'badmap');
    assert.equal(DL.validateMap({ format: 'codemap', nodes: [{ id: 5 }] }), 'badmap');
    assert.equal(DL.validateMap({ format: 'codemap', nodes: [{ id: 'a' }], edges: {} }), 'badmap');
    assert.equal(DL.validateMap({ format: 'codemap', nodes: [{ id: 'a' }], meta: [] }), 'badmap');
  });
  test('sanitizeMap: adresy tylko https ze znanych hostów', () => {
    const m = {
      format: 'codemap', nodes: [{ id: 'a' }],
      meta: { html: 'javascript:alert(1)', repoInfo: { url: 'https://github.com/o/r' },
        owner: { login: 'o', url: 'https://evil.example/x', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' } },
      gitInfo: { authors: [{ name: 'a', avatar: 'http://tracker.example/p.png' }, { name: 'b', avatar: 'https://secure.gravatar.com/avatar/x' }, { name: 'c', avatar: 'data:image/png;base64,xx' }] },
    };
    const dropped = DL.sanitizeMap(m);
    assert.equal(dropped, 4);
    assert.equal(m.meta.html, undefined); assert.equal(m.meta.owner.url, undefined);
    assert.equal(m.meta.repoInfo.url, 'https://github.com/o/r');
    assert.equal(m.meta.owner.avatar, 'https://avatars.githubusercontent.com/u/1?v=4');
    assert.deepEqual(m.gitInfo.authors.map((a) => a.avatar), [undefined, 'https://secure.gravatar.com/avatar/x', undefined]);
    for (const u of ['https://user@github.com/o/r', 'https://github.com:444/o/r', 'https://github.com.evil.com/o', 'vbscript:x', ' javascript:alert(1)']) {
      const x = { meta: { html: u } }; DL.sanitizeMap(x); assert.equal(x.meta.html, undefined, u);
    }
    const ok = { meta: { html: 'https://gitlab.com/g/p' } }; assert.equal(DL.sanitizeMap(ok), 0); assert.equal(ok.meta.html, 'https://gitlab.com/g/p');
  });
  test('prepareShare: bez podglądu i e-maili, graf nietknięty', () => {
    const gitInfo = { authors: [{ name: 'Ala', email: 'ala@x.pl', commits: 3 }], timeline: { who: [{ email: 'b@x.pl', n: 1 }] } };
    const obj = { format: 'codemap', nodes: [{ id: 'a', preview: 'tajne' }, { id: 'b', preview: null }], gitInfo };
    DL.prepareShare(obj);
    assert.deepEqual(obj.nodes.map((n) => n.preview), [null, null]);
    assert.equal(JSON.stringify(obj.gitInfo).includes('@x.pl'), false);
    assert.equal(obj.gitInfo.authors[0].name, 'Ala');
    assert.equal(gitInfo.authors[0].email, 'ala@x.pl', 'oryginalne gitInfo nie może się zmienić');
    const keep = { format: 'codemap', nodes: [{ id: 'a', preview: 'jawne' }], gitInfo: { authors: [{ email: 'e@x.pl' }] } };
    DL.prepareShare(keep, { noPreview: false, noEmails: false });
    assert.equal(keep.nodes[0].preview, 'jawne'); assert.equal(keep.gitInfo.authors[0].email, 'e@x.pl');
  });
});

describe('fetchGistMap (podstawiony fetch)', () => {
  const API = 'https://api.github.com/gists/' + GID;
  const gist = (files, extra = {}) => resp({ id: GID, owner: { login: 'ala' }, description: 'CodeMap — demo', html_url: 'https://gist.github.com/ala/' + GID, files, ...extra });
  test('codemap.json z treścią → mapa, bez tokenu i ciasteczek', async () => {
    const f = fakeFetch({ [API]: gist({ 'notes.json': { size: 9, content: '{"a":1}' }, 'codemap.json': { size: 100, truncated: false, content: json(MAP) } }) });
    const r = await DL.fetchGistMap(GID, { fetch: f });
    assert.equal(r.file, 'codemap.json'); assert.equal(r.owner, 'ala'); assert.equal(r.map.meta.name, 'demo');
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, API);
    assert.equal(f.calls[0].init.credentials, 'omit');
    assert.equal(JSON.stringify(f.calls[0].init.headers || {}).toLowerCase().includes('authorization'), false);
  });
  test('inny plik .json z format:"codemap"', async () => {
    const f = fakeFetch({ [API]: gist({ 'README.md': { content: '# x' }, 'moja-mapa.json': { content: json(MAP) } }) });
    assert.equal((await DL.fetchGistMap(GID, { fetch: f })).file, 'moja-mapa.json');
  });
  test('truncated → raw_url tylko z gist.githubusercontent.com', async () => {
    const RAW = 'https://gist.githubusercontent.com/ala/' + GID + '/raw/abc/codemap.json';
    const f = fakeFetch({ [API]: gist({ 'codemap.json': { size: 2000, truncated: true, content: '{"form', raw_url: RAW } }), [RAW]: resp(json(MAP)) });
    const r = await DL.fetchGistMap(GID, { fetch: f });
    assert.equal(r.map.format, 'codemap'); assert.deepEqual(f.calls.map((c) => c.url), [API, RAW]);
    for (const evil of ['https://evil.example/x.json', 'http://gist.githubusercontent.com/x.json', 'https://gist.githubusercontent.com.evil.com/x.json', 'javascript:alert(1)']) {
      const g = fakeFetch({ [API]: gist({ 'codemap.json': { size: 10, truncated: true, content: '', raw_url: evil } }) });
      await rejectsWith(DL.fetchGistMap(GID, { fetch: g }), 'raw-host');
      assert.deepEqual(g.calls.map((c) => c.url), [API], 'obcy adres nie może zostać pobrany: ' + evil);
    }
  });
  test('błędy HTTP: 404, limit API, 403, 5xx, sieć', async () => {
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({}) }), 'gist-notfound');
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: resp({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) }) }), 'gist-rate');
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: resp({}, { status: 429 }) }) }), 'gist-rate');
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: resp({}, { status: 403 }) }) }), 'gist-forbidden');
    await assert.rejects(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: resp({}, { status: 502 }) }) }), (e) => e.code === 'gist-http' && e.status === 502);
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: new TypeError('Failed to fetch') }) }), 'net');
  });
  test('nie-mapa, uszkodzona mapa, zły identyfikator', async () => {
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: gist({ 'a.md': { content: 'x' }, 'b.json': { content: '{"a":1}' }, 'c.json': { content: 'nie json' } }) }) }), 'gist-notmap');
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: resp('<html>') }) }), 'gist-notmap');
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: gist({ 'codemap.json': { content: json({ format: 'codemap', nodes: 'x' }) } }) }) }), 'badmap');
    const f = fakeFetch({});
    await rejectsWith(DL.fetchGistMap('../../users/x', { fetch: f }), 'gist-id');
    assert.equal(f.calls.length, 0);
  });
  test('limit rozmiaru: pole size, Content-Length i liczony strumień', async () => {
    const big = json({ ...MAP, pad: 'x'.repeat(5000) });
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: gist({ 'codemap.json': { size: 999999, content: big } }) }), maxBytes: 1000 }), 'too-big');
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: resp(big, { headers: { 'content-length': String(big.length) } }) }), maxBytes: 1000 }), 'too-big');
    await rejectsWith(DL.fetchGistMap(GID, { fetch: fakeFetch({ [API]: () => resp(big) }), maxBytes: 1000 }), 'too-big');
  });
});

describe('fetchShareMap (podstawiony fetch)', () => {
  const URL_ = '/api/share/' + SID;
  test('mapa z tego samego originu, bez ciasteczek', async () => {
    const f = fakeFetch({ [URL_]: resp(json(MAP)) });
    const r = await DL.fetchShareMap(SID, { fetch: f });
    assert.equal(r.map.meta.name, 'demo'); assert.equal(f.calls[0].url, URL_); assert.equal(f.calls[0].init.credentials, 'omit');
    const g = fakeFetch({ ['https://app.example' + URL_]: resp(json(MAP)) });
    assert.equal((await DL.fetchShareMap(SID, { fetch: g, base: 'https://app.example' })).map.format, 'codemap');
  });
  test('404 / 429 / 5xx / HTML zamiast JSON / nie-mapa / za duża / zły id', async () => {
    await rejectsWith(DL.fetchShareMap(SID, { fetch: fakeFetch({}) }), 'share-notfound');
    await rejectsWith(DL.fetchShareMap(SID, { fetch: fakeFetch({ [URL_]: resp({}, { status: 429 }) }) }), 'share-rate');
    await rejectsWith(DL.fetchShareMap(SID, { fetch: fakeFetch({ [URL_]: resp({}, { status: 500 }) }) }), 'share-http');
    await rejectsWith(DL.fetchShareMap(SID, { fetch: fakeFetch({ [URL_]: resp('<!doctype html>', { headers: { 'content-type': 'text/html' } }) }) }), 'share-notfound');
    await rejectsWith(DL.fetchShareMap(SID, { fetch: fakeFetch({ [URL_]: resp('{"format":"other","nodes":[]}') }) }), 'notmap');
    await rejectsWith(DL.fetchShareMap(SID, { fetch: fakeFetch({ [URL_]: resp('nie json') }) }), 'notmap');
    await rejectsWith(DL.fetchShareMap(SID, { fetch: fakeFetch({ [URL_]: () => resp(json({ ...MAP, pad: 'x'.repeat(3000) })) }), maxBytes: 500 }), 'too-big');
    const f = fakeFetch({});
    await rejectsWith(DL.fetchShareMap('../auth/me', { fetch: f }), 'share-id');
    assert.equal(f.calls.length, 0);
  });
});

describe('loaders: podkatalog z deep-linku (opts.sub)', () => {
  const text = (s) => new Response(s, { status: 200, headers: { 'content-type': 'text/plain' } });
  const withFetch = (routes) => { const f = fakeFetch(routes); return { f, L: loadCM([...CORE, 'loaders'], { fetch: f }).Loaders }; };

  test('GitHub: opts.sub zawęża drzewo, ścieżki względne, raw z prefiksem', async () => {
    const { f, L } = withFetch({
      'https://api.github.com/repos/o/r': resp({ default_branch: 'main', html_url: 'https://github.com/o/r', owner: { login: 'o' } }),
      'https://api.github.com/repos/o/r/git/trees/dev?recursive=1': resp({ tree: [
        { type: 'blob', path: 'src/a.js', sha: '1', size: 20 }, { type: 'blob', path: 'src/lib/b.js', sha: '2', size: 10 }, { type: 'blob', path: 'README.md', sha: '3', size: 5 }] }),
      'https://raw.githubusercontent.com/o/r/dev/src/a.js': text("import './lib/b.js';"),
      'https://raw.githubusercontent.com/o/r/dev/src/lib/b.js': text('export default 1;'),
    });
    const { files, meta } = await L.fromRepoURL('https://github.com/o/r', { branch: 'dev', sub: 'src', fetchContent: true });
    assert.deepEqual(host(files.map((x) => x.path)).sort(), ['a.js', 'lib/b.js']);
    assert.equal(meta.sub, 'src'); assert.equal(meta.branch, 'dev'); assert.equal(meta.name, 'r/src');
    assert.equal(files.find((x) => x.path === 'a.js').content, "import './lib/b.js';");
    assert.ok(f.calls.every((c) => /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(c.url)));
  });

  test('GitLab: ?path= w drzewie, pliki pobierane pełną ścieżką', async () => {
    const API = 'https://gitlab.com/api/v4';
    const { f, L } = withFetch({
      [API + '/projects/g%2Fp']: resp({ id: 7, default_branch: 'main', web_url: 'https://gitlab.com/g/p', namespace: { path: 'g' } }),
      [API + '/projects/7/repository/tree?recursive=true&ref=dev&path=lib&per_page=100&page=1']: resp([
        { type: 'blob', path: 'lib/a.js' }, { type: 'tree', path: 'lib/x' }, { type: 'blob', path: 'lib/x/b.py' }]),
      [API + '/projects/7/repository/files/lib%2Fa.js/raw?ref=dev']: text('export const a = 1;'),
      [API + '/projects/7/repository/files/lib%2Fx%2Fb.py/raw?ref=dev']: text('import os'),
    });
    const { files, meta } = await L.fromRepoURL('https://gitlab.com/g/p', { branch: 'dev', sub: 'lib', fetchContent: true });
    assert.deepEqual(host(files.map((x) => x.path)).sort(), ['a.js', 'x/b.py']);
    assert.equal(meta.sub, 'lib'); assert.equal(meta.name, 'p/lib'); assert.match(meta.source, /@dev\/lib$/);
    assert.equal(files.find((x) => x.path === 'x/b.py').content, 'import os');
    assert.ok(f.calls.some((c) => c.url.includes('&path=lib&')));
  });

  test('GitLab bez podkatalogu — bez zmian (pełne ścieżki, brak &path=)', async () => {
    const API = 'https://gitlab.com/api/v4';
    const { f, L } = withFetch({
      [API + '/projects/g%2Fp']: resp({ id: 7, default_branch: 'main', web_url: 'https://gitlab.com/g/p', namespace: { path: 'g' } }),
      [API + '/projects/7/repository/tree?recursive=true&ref=main&per_page=100&page=1']: resp([{ type: 'blob', path: 'lib/a.js' }, { type: 'blob', path: 'app.py' }]),
    });
    const { files, meta } = await L.fromRepoURL('https://gitlab.com/g/p', {});
    assert.deepEqual(host(files.map((x) => x.path)).sort(), ['app.py', 'lib/a.js']);
    assert.equal(meta.name, 'p'); assert.equal(meta.sub, '');
    assert.ok(!f.calls.some((c) => c.url.includes('&path=')));
  });

  test('Bitbucket: przegląd od podkatalogu, ścieżki względne', async () => {
    const API = 'https://api.bitbucket.org/2.0/repositories/ws/repo';
    const { L } = withFetch({
      [API]: resp({ mainbranch: { name: 'main' }, links: { html: { href: 'https://bitbucket.org/ws/repo' } } }),
      [API + '/src/main/pkg/?pagelen=100']: resp({ values: [{ type: 'commit_file', path: 'pkg/a.js', size: 5 }, { type: 'commit_directory', path: 'pkg/sub' }] }),
      [API + '/src/main/pkg/sub/?pagelen=100']: resp({ values: [{ type: 'commit_file', path: 'pkg/sub/b.js', size: 3 }] }),
      [API + '/src/main/pkg/a.js']: text('import "./sub/b.js";'),
      [API + '/src/main/pkg/sub/b.js']: text('export {};'),
    });
    const { files, meta } = await L.fromRepoURL('https://bitbucket.org/ws/repo', { sub: 'pkg', fetchContent: true });
    assert.deepEqual(host(files.map((x) => x.path)).sort(), ['a.js', 'sub/b.js']);
    assert.equal(meta.sub, 'pkg'); assert.equal(meta.name, 'repo/pkg');
    assert.equal(files.find((x) => x.path === 'sub/b.js').content, 'export {};');
  });
});

describe('parseHash — &pr= (mapa wpływu PR)', () => {
  test('numer PR przechodzi, zero / tekst / za długi — ignorowane (0)', () => {
    assert.equal(DL.parseHash('#repo=o/r@main&pr=12').pr, 12);
    assert.equal(DL.parseHash('#repo=gitlab.com/g/p&branch=dev&pr=7').pr, 7);
    for (const bad of ['0', 'abc', '12a', '-3', '12345678']) assert.equal(DL.parseHash('#repo=o/r&pr=' + bad).pr, 0, bad);
    assert.equal(DL.parseHash('#repo=o/r').pr, 0);
  });
});

describe('#tour= (trasa po kodzie)', () => {
  test('sama trasa, trasa przy repozytorium, śmieci odrzucone albo zignorowane', () => {
    assert.deepEqual(host(DL.parseHash('#tour=zAbCdEf_-9')), { kind: 'tour', tour: 'zAbCdEf_-9' });
    assert.deepEqual(host(DL.parseHash('#tour=<script>')), { kind: 'error', type: 'tour', reason: 'tour' });
    const r = host(DL.parseHash('#repo=o/r&branch=dev&tour=jeyJ0IjoiVCJ9'));
    assert.equal(r.kind, 'repo'); assert.equal(r.tour, 'jeyJ0IjoiVCJ9'); assert.equal(r.spec.branch, 'dev');
    assert.equal(host(DL.parseHash('#repo=o/r&tour=x!')).tour, undefined);
    assert.ok(DL.isDeepLink('#tour=zabc'));
  });
});
