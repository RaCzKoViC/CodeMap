import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { loadCM, host, CORE } from './harness.mjs';

// Wczytywanie projektów (js/loaders.js): archiwa ZIP / TAR / TAR.GZ / GZ budowane w teście, struktura PDF (zakładki,
// strony), folder z <input> i z upuszczenia (pliki boczne .git i pokrycia), filtry, adresy repozytoriów oraz API
// GitHub / GitLab / Bitbucket / Gist / Mistral na podstawionym fetch.
class FakeFileReader { readAsText(f) { setTimeout(() => { this.result = f.text; this.onload(); }, 0); } }
function load(fetch) {
  const calls = [];
  const f = fetch ? async (url, init = {}) => { calls.push({ url, init }); return fetch(url, init); } : undefined;
  const CM = loadCM([...CORE, 'loaders'], { FileReader: FakeFileReader, atob, Response, ...(f ? { fetch: f } : {}) });
  return { L: CM.Loaders, calls };
}
const { L } = load();
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
// plik jak z <input type=file>: tekst (FileReader) albo bajty (arrayBuffer)
const tf = (rel, text) => ({ name: rel.split('/').pop(), webkitRelativePath: rel.includes('/') ? rel : '', size: text.length, lastModified: 7, text });
const bf = (name, buf) => ({ name, webkitRelativePath: '', size: buf.length, lastModified: 7, arrayBuffer: async () => ab(buf) });

// ---- ZIP: nagłówki lokalne + katalog centralny + EOCD (metoda 0 = stored, 8 = deflate) ----
function zip(entries) {
  const parts = [], central = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, e.utf8 === false ? 'latin1' : 'utf8'), raw = Buffer.from(e.data ?? '');
    const comp = e.method === 8 ? zlib.deflateRawSync(raw) : raw, flags = e.utf8 === false ? 0 : 0x800;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(e.method || 0, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(e.method || 0, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, comp); central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
// ---- TAR (ustar): nagłówek 512 B, rozmiar ósemkowo, prefiks ścieżki, dane dopełnione do 512 B ----
function tar(entries) {
  const blocks = [];
  for (const e of entries) {
    const h = Buffer.alloc(512), data = Buffer.from(e.data ?? '');
    h.write(e.name, 0, 100, 'utf8');
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    h.write(e.type ?? '0', 156, 'ascii');
    h.write('ustar\0', 257, 'ascii');
    if (e.prefix) h.write(e.prefix, 345, 155, 'utf8');
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
const paths = (r) => host(r.files.map((f) => f.path)).sort();
const content = (r, p) => r.files.find((f) => f.path === p).content;

describe('filtry i adresy', () => {
  test('shouldSkip: katalogi narzędzi i śmieci systemowe, ale nie podobne nazwy', () => {
    for (const p of ['node_modules/x.js', 'a/node_modules/b/c.js', 'dist/app.js', '.git/HEAD', 'src/__pycache__/m.pyc', '.DS_Store', 'x/Thumbs.db', 'coverage/lcov.info'])
      assert.equal(L.shouldSkip(p), true, p);
    for (const p of ['src/distance.js', 'build.gradle', 'lib/binary.js', 'targets/a.py', 'docs/.github/x.md'])
      assert.equal(L.shouldSkip(p), false, p);
  });
  test('isTextFile: tekst do limitu rozmiaru, binaria i sekrety bez treści', () => {
    assert.equal(L.isTextFile('a.js', 100), true);
    assert.equal(L.isTextFile('a.js', L.TEXT_SIZE_LIMIT + 1), false);
    assert.equal(L.isTextFile('img.png', 10), false);
    assert.equal(L.isTextFile('.env.local', 10), false);
  });
  test('parseSource / repoHost: pełne adresy, SSH, /tree/gałąź/podkatalog, skrót owner/repo; śmieci → null', () => {
    assert.deepEqual(host(L.parseSource(' https://github.com/o/r.git ')), { owner: 'o', repo: 'r', branch: '', sub: '' });
    assert.deepEqual(host(L.parseSource('git@github.com:o/r.git')), { owner: 'o', repo: 'r', branch: '', sub: '' });
    assert.deepEqual(host(L.parseSource('https://github.com/o/r/tree/dev/src/lib?tab=1')), { owner: 'o', repo: 'r', branch: 'dev', sub: 'src/lib' });
    assert.deepEqual(host(L.parseSource('o/r.git')), { owner: 'o', repo: 'r', branch: '', sub: '' });
    assert.equal(L.parseSource('to nie adres'), null);
    assert.deepEqual([L.repoHost('https://gitlab.com/g/p'), L.repoHost('bitbucket.org/w/r'), L.repoHost('o/r')], ['gitlab', 'bitbucket', 'github']);
  });
});

describe('archiwa', () => {
  test('ZIP: stored i deflate, nazwy UTF-8 i CP1252, katalogi i node_modules pominięte, katalog nazwany po archiwum', async () => {
    const z = zip([
      { name: 'src/', data: '' }, { name: 'src/a.js', data: "import './b.js';", method: 8 }, { name: 'src/b.js', data: 'export default 1;' },
      { name: 'dokumentacja/żółw.md', data: '# Żółw', method: 8 }, { name: 'caf\xe9.txt', data: 'x', utf8: false },
      { name: 'node_modules/x/index.js', data: 'x' }]);
    const r = await L.fromFileList([bf('projekt.zip', z)]);
    assert.equal(r.meta.name, 'projekt');
    assert.deepEqual(paths(r), ['projekt/café.txt', 'projekt/dokumentacja/żółw.md', 'projekt/src/a.js', 'projekt/src/b.js']);
    assert.equal(content(r, 'projekt/src/a.js'), "import './b.js';");
    assert.equal(content(r, 'projekt/dokumentacja/żółw.md'), '# Żółw');
    assert.deepEqual(host(r.meta.warnings), []);
  });
  test('TAR z prefiksem ustar i wpisem katalogu; TAR.GZ (gzip); pojedynczy .gz → plik bez katalogu', async () => {
    const t = tar([{ name: 'dir/', type: '5' }, { name: 'main.go', prefix: 'cmd/app', data: 'package main\n' }, { name: 'dane.json', data: '{"a":1}' }]);
    const r1 = await L.fromFileList([bf('src.tar', t)]);
    assert.deepEqual(paths(r1), ['src/cmd/app/main.go', 'src/dane.json']);
    assert.equal(content(r1, 'src/cmd/app/main.go'), 'package main\n');
    const r2 = await L.fromFileList([bf('rel-1.0.tgz', zlib.gzipSync(t))]);
    assert.deepEqual(paths(r2), ['rel-1.0/cmd/app/main.go', 'rel-1.0/dane.json']);
    const r3 = await L.fromFileList([bf('notatki.md.gz', zlib.gzipSync('# Notatki'))]);
    assert.deepEqual(host(r3.files.map((f) => [f.path, f.content])), [['notatki.md', '# Notatki']]);
  });
  test('tylko nieobsługiwane archiwum → czytelny błąd; obok zwykłych plików → ostrzeżenie; uszkodzony ZIP → ostrzeżenie', async () => {
    await assert.rejects(L.fromFileList([bf('dane.rar', Buffer.from('Rar!'))]), /Format RAR nie jest obsługiwany/);
    const warn = console.warn; console.warn = () => {};
    try {
      const r = await L.fromFileList([tf('a.js', 'x'), bf('b.7z', Buffer.from('7z')), bf('zly.zip', Buffer.from('to nie zip'))]);
      assert.deepEqual(paths(r), ['a.js']);
      assert.deepEqual(host(r.meta.warnings), ['b.7z', 'zly.zip (błąd odczytu)']);
    } finally { console.warn = warn; }
  });
});

describe('PDF', () => {
  const pdf = (body) => Buffer.from('%PDF-1.4\n' + body + '\n%%EOF', 'latin1');
  test('zakładki (outline) jako drzewo: napisy ósemkowe i UTF-16, ukośniki w tytułach zamienione', async () => {
    const r = await L.fromFileList([bf('raport.pdf', pdf([
      '1 0 obj << /Type /Catalog /Outlines 2 0 R /Pages 3 0 R >> endobj',
      '2 0 obj << /Type /Outlines /First 4 0 R >> endobj',
      '3 0 obj << /Type /Pages /Count 7 >> endobj',
      '4 0 obj << /Title (Caf\\351 \\(1\\)) /First 6 0 R /Next 5 0 R >> endobj',
      '5 0 obj << /Title <FEFF0052006F007A> >> endobj',
      '6 0 obj << /Title (Cel/zakres) >> endobj'].join('\n')))]);
    assert.equal(r.meta.kind, 'pdf'); assert.equal(r.meta.pages, 7); assert.equal(r.meta.name, 'raport');
    assert.deepEqual(paths(r), ['Café (1)/Cel∕zakres', 'Roz']);
  });
  test('bez zakładek → lista stron; bez struktury → jeden węzeł z opisem; PDF obok innych plików → podkatalog', async () => {
    const pages = await L.fromFileList([bf('a.pdf', pdf('1 0 obj << /Type /Pages /Count 3 >> endobj'))]);
    assert.deepEqual(paths(pages), ['Strony/Strona 1', 'Strony/Strona 2', 'Strony/Strona 3']);
    const none = await L.fromFileList([bf('b.pdf', pdf('nic'))]);
    assert.deepEqual(paths(none), ['(nie udało się odczytać struktury PDF)']);
    const mixed = await L.fromFileList([tf('x.md', '# x'), bf('c.pdf', pdf('1 0 obj << /Type /Pages /Count 1 >> endobj'))]);
    assert.deepEqual(paths(mixed), ['c/Strony/Strona 1', 'x.md']);
  });
});

describe('folder: <input> i upuszczenie', () => {
  test('fromFileList: nazwa projektu z katalogu, ścieżki bez niego, sekrety i binaria bez treści, pliki boczne .git i pokrycia', async () => {
    const prog = [];
    const r = await L.fromFileList([tf('proj/src/a.js', 'export {}'), tf('proj/.env', 'SECRET=1'), tf('proj/logo.png', 'PNG'),
      tf('proj/node_modules/x/i.js', 'x'), tf('proj/.git/HEAD', 'ref: refs/heads/main'), tf('proj/coverage/lcov.info', 'SF:a'),
      tf('proj/deep/a/b/c/d/lcov.info', 'SF:b')], (d, t) => prog.push([d, t]));
    assert.equal(r.meta.name, 'proj'); assert.equal(r.meta.source, 'local: proj');
    assert.deepEqual(paths(r), ['.env', 'deep/a/b/c/d/lcov.info', 'logo.png', 'src/a.js']);
    assert.equal(content(r, 'src/a.js'), 'export {}');
    assert.equal(content(r, '.env'), null); assert.equal(content(r, 'logo.png'), null);
    assert.deepEqual(host(r.side.git.map((g) => g.path)), ['HEAD']);
    assert.deepEqual(host(r.side.coverage.map((c) => c.path)), ['coverage/lcov.info'], 'raport zbyt głęboko pominięty');
    assert.deepEqual(prog.at(-1), [4, 4]);
  });
  test('fromDrop: katalog z wpisów (.git i coverage/ zapamiętane leniwie, node_modules pominięty), resolveSide czyta je później', async () => {
    const fileE = (name, text) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(tf(name, text)) });
    const dirE = (name, kids) => ({ isFile: false, isDirectory: true, name, createReader() { let done = false; return { readEntries(ok) { const b = done ? [] : kids; done = true; ok(b); } }; } });
    const root = dirE('proj', [
      dirE('src', [fileE('a.js', "import './b.js'"), fileE('b.js', 'export {}')]),
      dirE('.git', [fileE('HEAD', 'ref'), dirE('refs', [dirE('heads', [fileE('main', 'abc')])])]),
      dirE('coverage', [fileE('lcov.info', 'SF:src/a.js'), fileE('index.html', '<html>')]),
      dirE('node_modules', [fileE('x.js', 'x')])]);
    const r = await L.fromDrop([root], []);
    assert.equal(r.meta.name, 'proj');
    assert.deepEqual(paths(r), ['proj/src/a.js', 'proj/src/b.js']);
    assert.ok(r.side.gitEntry && r.side.git === null, '.git czytany dopiero na żądanie');
    const side = await L.resolveSide(r.side);
    assert.deepEqual(host(side.git.map((g) => g.path)).sort(), ['HEAD', 'refs/heads/main']);
    assert.deepEqual(host(side.coverage.map((c) => c.path)), ['coverage/lcov.info']);
    assert.equal(side.gitEntry, null);
    const empty = await L.resolveSide(null);
    assert.deepEqual(host(empty), { git: null, gitFile: null, coverage: [], gitEntry: null, coverageEntries: [] });
  });
  test('fromDrop bez wpisów katalogów → jak zwykłe pliki', async () => {
    const r = await L.fromDrop([], [tf('solo.py', 'print(1)')]);
    assert.equal(r.meta.name, 'solo.py'); assert.deepEqual(paths(r), ['solo.py']);
  });
});

describe('GitHub / GitLab / Bitbucket (API)', () => {
  const tree = { tree: [{ type: 'blob', path: 'src/a.js', sha: 's1', size: 10 }, { type: 'blob', path: 'dist/x.js', sha: 's2' }, { type: 'tree', path: 'src' }] };
  test('GitHub z tokenem: nagłówek Bearer, treść z blobów base64 (UTF-8), meta repozytorium i właściciela', async () => {
    const { L: G, calls } = load((url) => url.endsWith('/repos/o/r') ? json({ default_branch: 'trunk', html_url: 'https://github.com/o/r', stargazers_count: 5,
      owner: { login: 'o', avatar_url: 'https://avatars.githubusercontent.com/u/1', html_url: 'https://github.com/o' }, license: { spdx_id: 'MIT' }, topics: ['x'] })
      : url.includes('/git/trees/') ? json({ ...tree, truncated: true }) : json({ encoding: 'base64', content: Buffer.from('const ż = 1;').toString('base64').replace(/(.{8})/g, '$1\n') }));
    const status = [];
    const { files, meta } = await G.fromGitHub('https://github.com/o/r', { token: 'T', fetchContent: true }, null, (s) => status.push(s));
    assert.deepEqual(host(files.map((f) => [f.path, f.content])), [['src/a.js', 'const ż = 1;']]);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer T');
    assert.ok(calls.some((c) => c.url === 'https://api.github.com/repos/o/r/git/trees/trunk?recursive=1'));
    assert.ok(calls.some((c) => c.url === 'https://api.github.com/repos/o/r/git/blobs/s1'));
    assert.equal(meta.branch, 'trunk'); assert.equal(meta.repoInfo.license, 'MIT'); assert.equal(meta.owner.login, 'o');
    assert.equal(meta.source, 'github: o/r@trunk');
    assert.ok(status.some((s) => /drzewo bardzo duże/.test(s)));
  });
  test('GitHub: brak informacji o repo → gałąź main; 403 limit wyczerpany / brak dostępu; 404 z podpowiedzią o tokenie; zły adres', async () => {
    let mode = 'ok';
    const { L: G } = load((url) => {
      if (url.endsWith('/repos/o/r')) return json({}, 500);
      if (mode === '403-rate') return json({}, 403, { 'x-ratelimit-remaining': '0' });
      if (mode === '403') return json({}, 403, { 'x-ratelimit-remaining': '10' });
      if (mode === '404') return json({}, 404);
      assert.ok(url.includes('/git/trees/main'), url); return json(tree);
    });
    assert.equal((await G.fromGitHub('o/r')).meta.branch, 'main');
    mode = '403-rate'; await assert.rejects(G.fromGitHub('o/r'), /limit zapytań wyczerpany/);
    mode = '403'; await assert.rejects(G.fromGitHub('o/r'), /brak dostępu \(403\)/);
    mode = '404'; await assert.rejects(G.fromGitHub('o/r'), /\(404\)[^]*token dla repo prywatnego/);
    await assert.rejects(G.fromGitHub('https://example.com/x'), /Nie rozpoznano adresu/);
    const net = load(() => { throw new TypeError('Failed to fetch'); });
    await assert.rejects(net.L.fromGitHub('o/r'), /Brak połączenia/);
  });
  test('fetchRefs: gałęzie i tagi z trzech hostingów; błąd → pusta lista z opisem', async () => {
    const { L: G } = load((url) => {
      if (url.includes('api.github.com') && url.includes('/branches')) return json([{ name: 'main' }, { name: 'dev' }]);
      if (url.includes('api.github.com') && url.includes('/tags')) return json([{ name: 'v1' }]);
      if (url === 'https://gitlab.com/api/v4/projects/g%2Fp') return json({ id: 9, default_branch: 'master' });
      if (url.includes('/projects/9/repository/branches')) return json([{ name: 'master' }]);
      if (url.includes('/projects/9/repository/tags')) return json([], 500);
      if (url.includes('bitbucket') && url.includes('/refs/branches')) return json({ values: [{ name: 'main' }] });
      if (url.includes('bitbucket') && url.includes('/refs/tags')) return json({ values: [{ name: 't1' }] });
      throw new Error('nieznany ' + url);
    });
    assert.deepEqual(host(await G.fetchRefs('https://github.com/o/r')), { branches: ['main', 'dev'], tags: ['v1'], host: 'github' });
    assert.deepEqual(host(await G.fetchRefs('https://gitlab.com/g/p/-/tree/x')), { branches: ['master'], tags: [], default: 'master', host: 'gitlab' });
    assert.deepEqual(host(await G.fetchRefs('https://bitbucket.org/w/r.git')), { branches: ['main'], tags: ['t1'], host: 'bitbucket' });
    const bad = host(await G.fetchRefs('https://gitlab.com/inny/projekt'));
    assert.deepEqual([bad.branches, bad.tags, bad.host], [[], [], 'gitlab']);
    assert.match(bad.error, /nieznany/);
  });
  test('fetchTreeSig: sygnatura (ścieżka + sha) z domyślnej gałęzi i podkatalogu; GitLab stronicowany; Bitbucket nieobsługiwany', async () => {
    const { L: G } = load((url) => {
      if (url === 'https://api.github.com/repos/o/r') return json({ default_branch: 'main' });
      if (url.includes('api.github.com')) return json({ tree: [{ type: 'blob', path: 'src/b.js', sha: 'h2', size: 3 }, { type: 'blob', path: 'src/a.js', sha: 'h1', size: 5 }, { type: 'blob', path: 'README.md', sha: 'h3' }] });
      if (url.endsWith('/projects/g%2Fp')) return json({ id: 3, default_branch: 'dev' });
      const page = +new URL(url).searchParams.get('page');
      return json(page === 1 ? Array.from({ length: 100 }, (_, i) => ({ type: 'blob', path: `f${i}.js`, id: 'x' + i })) : [{ type: 'blob', path: 'z.js', id: 'z' }]);
    });
    const s = host(await G.fetchTreeSig('https://github.com/o/r/tree/main/src'));
    assert.deepEqual([s.name, s.fileCount, s.totalSize], ['main', 2, 8]);
    assert.deepEqual(s.files.map((f) => [f.path, f.hash]), [['a.js', 'h1'], ['b.js', 'h2']]);
    const gl = await G.fetchTreeSig('https://gitlab.com/g/p');
    assert.equal(gl.name, 'dev'); assert.equal(gl.fileCount, 101);
    await assert.rejects(G.fetchTreeSig('https://bitbucket.org/w/r', 'main'), /obsługuje obecnie GitHub i GitLab/);
  });
});

describe('Gist, limit API, Mistral', () => {
  test('ghRateLimit: rate albo resources.core; błąd → null', async () => {
    assert.deepEqual(host(await load(() => json({ rate: { limit: 60, remaining: 5 } })).L.ghRateLimit()), { limit: 60, remaining: 5 });
    assert.deepEqual(host(await load(() => json({ resources: { core: { limit: 5000 } } })).L.ghRateLimit('t')), { limit: 5000 });
    assert.equal(await load(() => json({}, 401)).L.ghRateLimit(), null);
    assert.equal(await load(() => { throw new Error('x'); }).L.ghRateLimit(), null);
  });
  test('createGist: prywatny gist z plikiem codemap.json; 401/403 → komunikat o uprawnieniu „gist"', async () => {
    const { L: G, calls } = load(() => json({ html_url: 'https://gist.github.com/u/abc', id: 'abc' }));
    assert.deepEqual(host(await G.createGist('{"a":1}', 'Opis', 'T')), { url: 'https://gist.github.com/u/abc', id: 'abc' });
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, { description: 'Opis', public: false, files: { 'codemap.json': { content: '{"a":1}' } } });
    assert.equal(calls[0].init.headers.Authorization, 'Bearer T');
    await assert.rejects(load(() => json({}, 403)).L.createGist('x', '', 'T'), /uprawnieniem „gist"/);
    await assert.rejects(load(() => json({}, 500)).L.createGist('x', '', 'T'), /Gist: HTTP 500/);
  });
  test('mistralChat: brak klucza, 401 / 429 ze statusem, format JSON na żądanie', async () => {
    const { L: M, calls } = load(() => json({ choices: [{ message: { content: 'ok' } }] }));
    await assert.rejects(M.mistralChat([], {}), /Brak klucza Mistral/);
    assert.equal(await M.mistralChat([{ role: 'user', content: 'q' }], { key: 'K', json: true }), 'ok');
    const b = JSON.parse(calls[0].init.body);
    assert.deepEqual([b.model, b.temperature, b.response_format.type], ['mistral-small-latest', 0.3, 'json_object']);
    await assert.rejects(load(() => json({}, 401)).L.mistralChat([], { key: 'K' }), (e) => e.status === 401 && /Nieprawidłowy klucz/.test(e.message));
    await assert.rejects(load(() => json({}, 429)).L.mistralChat([], { key: 'K' }), (e) => e.status === 429);
  });
  test('mistralStream: SSE z danymi pociętymi między paczkami, [DONE] kończy strumień', async () => {
    const sse = (chunks) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const x of chunks) c.enqueue(e.encode(x)); c.close(); } }));
    const { L: M } = load(() => sse(['data: {"choices":[{"delta":{"content":"Ala"}}]}\ndata: {"choi', 'ces":[{"delta":{"content":" ma"}}]}\n: komentarz\n', 'data: [DONE]\ndata: {"choices":[{"delta":{"content":"X"}}]}\n']));
    const toks = [];
    assert.equal(await M.mistralStream([], { key: 'K', onToken: (d) => toks.push(d) }), 'Ala ma');
    assert.deepEqual(toks, ['Ala', ' ma']);
    await assert.rejects(M.mistralStream([], {}), (e) => e.status === 0);
  });
});
