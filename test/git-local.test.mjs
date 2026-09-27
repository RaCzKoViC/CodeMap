import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { loadCM, runFile, docStub, host } from './harness.mjs';
import { git, gitAvailable, readGitFiles, oracle, compareWithOracle } from '../tools/git-probe.mjs';

const G = loadCM(['git-local']).GitLocal;
const HAS_GIT = gitAvailable();
const SKIP = HAS_GIT ? false : 'brak polecenia git';
const code = (c) => (e) => { assert.equal(e.code, c, e.message); return true; };

// ---- czyste funkcje (bez gita) ----
describe('GitLocal: delta, komunikaty, błędy open()', () => {
  const { applyDelta } = G._internals;
  const u8 = (a) => Uint8Array.from(a);
  test('applyDelta: kopiowanie (offset/rozmiar w bitach, rozmiar 0 = 0x10000) i wstawianie', () => {
    const base = new Uint8Array(0x10000 + 300);
    for (let i = 0; i < base.length; i++) base[i] = (i * 7) & 0xff;
    // varinty: baza 65836 (0xAC 0x82 0x04), wynik 0x10000 + 3 + 10 = 65549 (0x8D 0x80 0x04)
    const delta = u8([0xac, 0x82, 0x04, 0x8d, 0x80, 0x04,
      0x80,                         // kopiuj: offset 0, rozmiar 0 → 0x10000
      0x03, 1, 2, 3,                // wstaw 3 bajty
      0x91, 0x2c, 0x0a,             // kopiuj: offset 0x2c (bit 0), rozmiar 10 (bit 4)
    ]);
    const out = applyDelta(base, delta);
    assert.equal(out.length, 0x10000 + 13);
    assert.deepEqual([...out.subarray(0, 0x10000)], [...base.subarray(0, 0x10000)]);
    assert.deepEqual([...out.subarray(0x10000, 0x10003)], [1, 2, 3]);
    assert.deepEqual([...out.subarray(0x10003)], [...base.subarray(0x2c, 0x36)]);
  });
  test('applyDelta: zły rozmiar bazy / instrukcja 0 / kopiowanie poza bazę → bad-pack', () => {
    const base = u8([1, 2, 3, 4]);
    assert.throws(() => applyDelta(base, u8([5, 1, 0x01, 9])), code('bad-pack'));
    assert.throws(() => applyDelta(base, u8([4, 1, 0x00])), code('bad-pack'));
    assert.throws(() => applyDelta(base, u8([4, 8, 0x90, 8])), code('bad-pack'));
  });
  test('inflate: śmieci po strumieniu / brak sumy adler32 → poprawne dane zostają (broken ustawione)', async () => {
    const src = Buffer.from('treść obiektu '.repeat(400));
    const z = zlib.deflateSync(src);
    for (const [name, buf, broken] of [['czysty', z, false], ['śmieci', Buffer.concat([z, Buffer.from('JUNK')]), true], ['bez adler32', z.subarray(0, z.length - 4), true]]) {
      const r = await G._internals.inflate(buf);
      assert.ok(Buffer.from(r.data).equals(src), name);
      assert.equal(!!r.broken, broken, name);
    }
    const cut = await G._internals.inflate(z.subarray(0, z.length >> 1));
    assert.ok(cut.data.length < src.length, 'ucięty strumień nie udaje pełnych danych');
  });
  test('explainGitdirFile: worktree, submoduł, inne', () => {
    assert.match(G.explainGitdirFile('gitdir: D:/r/.git/worktrees/feat\n'), /worktree/);
    assert.match(G.explainGitdirFile('gitdir: ../.git/modules/lib\n'), /submoduł/);
    assert.match(G.explainGitdirFile('gitdir: /elsewhere/repo.git'), /elsewhere/);
    assert.match(G.explainGitdirFile('coś innego'), /gitdir/);
  });
  const blob = (s) => new Blob([s]);
  test('open(): brak HEAD → no-head; plik .git z gitdir → gitdir-file; SHA-256 → sha256', async () => {
    await assert.rejects(G.open([]), code('no-head'));
    await assert.rejects(G.open([{ path: 'config', file: blob('[core]\n') }]), code('no-head'));
    await assert.rejects(G.open([{ path: '.git', file: blob('gitdir: ../.git/worktrees/x\n') }]), code('gitdir-file'));
    await assert.rejects(G.open([{ path: 'HEAD', file: blob('ref: refs/heads/main\n') },
      { path: 'config', file: blob('[extensions]\n\tobjectformat = sha256\n') }]), code('sha256'));
    await assert.rejects(G.open([{ path: 'HEAD', file: blob('a'.repeat(64) + '\n') }]), code('sha256'));
    await assert.rejects(G.open([{ path: 'HEAD', file: blob('ref: refs/heads/main\n') }]), (e) => e.code === 'no-head' && /main/.test(e.message));
    const Old = loadCM(['git-local'], { DecompressionStream: undefined }).GitLocal;
    await assert.rejects(Old.open([{ path: 'HEAD', file: blob('a'.repeat(40)) }]), code('unsupported'));
  });
  test('run() bez Workera: te same błędy, anulowanie przed startem → cancelled', async () => {
    await assert.rejects(G.run([]), code('no-head'));
    const ac = new AbortController(); ac.abort();
    await assert.rejects(G.run([], { signal: ac.signal }), code('cancelled'));
  });
});

// ---- prawdziwe repozytoria ----
let BASE = null;
const tmp = (name) => { if (!BASE) BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-git-')); const d = path.join(BASE, name); fs.mkdirSync(d, { recursive: true }); return d; };
let clock = 1700000000;
function initRepo(dir) {
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'gc.auto', '0']);
  return dir;
}
function put(dir, rel, content) { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
function commit(dir, msg, { name = 'Jan Kowalski', email = 'jan@example.com', time } = {}) {
  const t = time ?? (clock += 3600);
  git(dir, ['add', '-A']);
  git(dir, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', msg],
    { env: { GIT_AUTHOR_DATE: `${t} +0200`, GIT_COMMITTER_DATE: `${t} +0200` } });
  return String(git(dir, ['rev-parse', 'HEAD'])).trim();
}
const copyRepo = (src, name) => { const d = tmp(name); fs.cpSync(src, d, { recursive: true }); return d; };
after(() => { if (BASE) { try { fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Windows: pliki paczek bywają zablokowane */ } } });
// duży plik tekstowy (> 64 KB), wersje różnią się kilkoma liniami → delty z długim kopiowaniem
function bigText(v) {
  const lines = [];
  for (let i = 0; i < 4000; i++) lines.push(`linia ${i} ${((i * 2654435761) >>> 0).toString(36)} ${i % 97 === v ? 'ZMIANA-' + v : 'stała treść'}`);
  if (v) lines.splice(1000 * v, 0, `wstawka w wersji ${v}`);
  return lines.join('\n') + '\n';
}

async function readRepo(dir, opts = {}) {
  const repo = await G.open(await readGitFiles(dir));
  const res = await repo.walk({ max: 10000, ...opts });
  return { repo, head: host(repo.head), commits: host(res.commits), truncated: res.truncated };
}
function assertOracle(dir, commits, ref = 'HEAD') {
  assert.deepEqual(compareWithOracle(commits, oracle(dir, 10000, ref)), []);
}
/** Liczniki typów obiektów w paczkach (1–4 pełne, 6 OFS_DELTA, 7 REF_DELTA) — niezależnie od modułu. */
function packTypes(dir) {
  const pdir = path.join(dir, '.git', 'objects', 'pack'), counts = {}, bySha = {};
  if (!fs.existsSync(pdir)) return { counts, bySha };
  for (const f of fs.readdirSync(pdir).filter((x) => x.endsWith('.idx'))) {
    const idx = fs.readFileSync(path.join(pdir, f)), pack = fs.readFileSync(path.join(pdir, f.replace(/\.idx$/, '.pack')));
    const v2 = idx.readUInt32BE(0) === 0xff744f63, fan = v2 ? 8 : 0, n = idx.readUInt32BE(fan + 255 * 4);
    for (let i = 0; i < n; i++) {
      let off, sha;
      if (v2) {
        sha = idx.subarray(fan + 1024 + 20 * i, fan + 1024 + 20 * i + 20).toString('hex');
        const offAt = fan + 1024 + n * 24, v = idx.readUInt32BE(offAt + 4 * i);
        off = v & 0x80000000 ? Number(idx.readBigUInt64BE(offAt + n * 4 + 8 * (v & 0x7fffffff))) : v;
      } else { off = idx.readUInt32BE(1024 + 24 * i); sha = idx.subarray(1028 + 24 * i, 1048 + 24 * i).toString('hex'); }
      const t = (pack[off] >> 4) & 7;
      counts[t] = (counts[t] || 0) + 1; bySha[sha] = t;
    }
  }
  return { counts, bySha };
}
// dokładne zmiany nazw według gita (-M100%): zbiór „stara → nowa” per commit
function gitExactRenames(dir) {
  const out = String(git(dir, ['-c', 'core.quotepath=false', 'log', '--no-merges', '-M100%', '--name-status', '-z', '--format=%x01%H']));
  const res = new Map();
  for (const chunk of out.split('\x01').filter(Boolean)) {
    const tok = chunk.slice(40).split('\0').map((t) => t.replace(/^\n/, '')), list = [];
    for (let i = 0; i < tok.length; i++) {
      if (/^R100$/.test(tok[i])) { list.push(tok[i + 1] + ' → ' + tok[i + 2]); i += 2; }
    }
    res.set(chunk.slice(0, 40), list.sort());
  }
  return res;
}

// zmiany nazw według `git log -M` (domyślny próg 50 %): sha → ['stara → nowa']
function gitRenamesM(dir) {
  const out = String(git(dir, ['log', '-M', '--no-merges', '--name-status', '-z', '--format=%x01%H']));
  const res = new Map();
  for (const chunk of out.split('\x01').filter(Boolean)) {
    const tok = chunk.slice(40).split('\0').map((t) => t.replace(/^\n/, '')), list = [];
    for (let i = 0; i < tok.length; i++) if (/^R\d{3}$/.test(tok[i])) { list.push(tok[i + 1] + ' → ' + tok[i + 2]); i += 2; }
    res.set(chunk.slice(0, 40), list.sort());
  }
  return res;
}

describe('GitLocal na prawdziwych repozytoriach', { skip: SKIP }, () => {
  let MAIN, info = {}, loose;
  before(async () => {
    MAIN = initRepo(tmp('main'));
    // 1. dodania, zagnieżdżone katalogi, polskie znaki w autorze i nazwie pliku, plik binarny, pusty plik
    put(MAIN, 'README.md', '# Projekt\n');
    put(MAIN, 'src/app.js', 'console.log(1);\n');
    put(MAIN, 'src/lib/util.js', 'export const u = 1;\n');
    put(MAIN, 'docs/zażółć gęślą.md', 'jaźń\n');
    put(MAIN, 'bin/logo.bin', Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 31) & 0xff)));
    put(MAIN, 'empty.txt', '');
    put(MAIN, 'thing', 'plik, który stanie się katalogiem\n');
    info.c1 = commit(MAIN, 'Pierwszy commit — zażółć', { name: 'Łukasz Żółć', email: 'lukasz@example.pl' });
    // modyfikacja, usunięcie, głęboko zagnieżdżony plik
    put(MAIN, 'src/app.js', 'console.log(2);\n');
    fs.rmSync(path.join(MAIN, 'docs', 'zażółć gęślą.md'));
    put(MAIN, 'src/lib/deep/nested/x.txt', 'x\n');
    info.c2 = commit(MAIN, 'Zmiany i usunięcie');
    // 5. git mv bez zmiany treści → R; pusty plik też
    git(MAIN, ['mv', 'src/lib/util.js', 'src/lib/helpers.js']);
    git(MAIN, ['mv', 'empty.txt', 'docs/empty-moved.txt']);
    info.c3 = commit(MAIN, 'Zmiana nazwy');
    // zmiana nazwy + edycja → D + A; plik → katalog o tej samej nazwie
    git(MAIN, ['mv', 'README.md', 'README.txt']);
    put(MAIN, 'README.txt', '# Projekt\nwięcej\n');
    fs.rmSync(path.join(MAIN, 'thing'));
    put(MAIN, 'thing/inner.txt', 'teraz katalog\n');
    info.c4 = commit(MAIN, 'Nazwa i treść');
    // 4. duży plik w kilku wersjach
    for (let v = 0; v < 4; v++) { put(MAIN, 'data/big.txt', bigText(v)); info['big' + v] = commit(MAIN, 'Duży plik v' + v); }
    // 6. gałąź + commit scalający
    git(MAIN, ['checkout', '-q', '-b', 'feature']);
    put(MAIN, 'feature.txt', 'f\n');
    info.f1 = commit(MAIN, 'Funkcja na gałęzi');
    git(MAIN, ['checkout', '-q', 'main']);
    put(MAIN, 'src/app.js', 'console.log(3);\n');
    info.m1 = commit(MAIN, 'Równolegle na main');
    clock += 3600;
    git(MAIN, ['-c', 'user.name=Jan Kowalski', '-c', 'user.email=jan@example.com', 'merge', '-q', '--no-ff', '-m', 'Scalenie feature', 'feature'],
      { env: { GIT_AUTHOR_DATE: `${clock} +0200`, GIT_COMMITTER_DATE: `${clock} +0200` } });
    info.merge = String(git(MAIN, ['rev-parse', 'HEAD'])).trim();
    fs.rmSync(path.join(MAIN, 'src', 'lib', 'deep'), { recursive: true });
    info.last = commit(MAIN, 'Usunięcie całego katalogu');
    loose = await readRepo(MAIN);
  });

  test('1. obiekty luźne: zgodność z git log, polskie znaki, pliki binarne, katalogi', () => {
    assert.deepEqual(packTypes(MAIN).counts, {}, 'repozytorium testowe ma tylko obiekty luźne');
    const { commits, head } = loose;
    assert.deepEqual(head, { ref: 'refs/heads/main', sha: info.last });
    assertOracle(MAIN, commits);
    const first = commits.at(-1);
    assert.equal(first.sha, info.c1);
    assert.equal(first.boundary, false);
    assert.deepEqual(first.parents, []);
    assert.deepEqual(first.author, { name: 'Łukasz Żółć', email: 'lukasz@example.pl' });
    assert.equal(first.message, 'Pierwszy commit — zażółć');
    assert.equal(first.authorTime, first.time);
    assert.deepEqual(first.files.map((f) => f.path + ':' + f.status),
      ['README.md:A', 'bin/logo.bin:A', 'docs/zażółć gęślą.md:A', 'empty.txt:A', 'src/app.js:A', 'src/lib/util.js:A', 'thing:A']);
    const c2 = commits.find((c) => c.sha === info.c2);
    assert.deepEqual(c2.files.map((f) => f.path + ':' + f.status), ['docs/zażółć gęślą.md:D', 'src/app.js:M', 'src/lib/deep/nested/x.txt:A']);
    const m = c2.files.find((f) => f.status === 'M');
    assert.ok(/^[0-9a-f]{40}$/.test(m.sha) && /^[0-9a-f]{40}$/.test(m.oldSha) && m.sha !== m.oldSha);
    const last = commits[0];
    assert.deepEqual(last.files.map((f) => f.path + ':' + f.status), ['src/lib/deep/nested/x.txt:D']);
  });

  test('5. git mv bez zmian → R (także pusty plik); zmiana nazwy z edycją → R z podobieństwem; plik → katalog', () => {
    const c3 = loose.commits.find((c) => c.sha === info.c3);
    assert.deepEqual(c3.files.map(({ path, status, from }) => ({ path, status, from })), [
      { path: 'docs/empty-moved.txt', status: 'R', from: 'empty.txt' },
      { path: 'src/lib/helpers.js', status: 'R', from: 'src/lib/util.js' },
    ]);
    for (const f of c3.files) assert.equal(f.sha, f.oldSha);
    const c4 = loose.commits.find((c) => c.sha === info.c4);
    // zmiana nazwy z edycją (jak git -M50%): README.md → README.txt (wspólna 1 z 3 linii → 67 %); plik → katalog
    // o niepodobnej treści zostaje jako D + A
    assert.deepEqual(c4.files.map((f) => f.path + ':' + f.status + (f.from ? '<' + f.from : '')), ['README.txt:R<README.md', 'thing:D', 'thing/inner.txt:A']);
    assert.equal(c4.files[0].similarity, 67);
    // nasze R ze 100 % podobieństwa (albo bez pola — dokładne, po sha) = dokładne zmiany nazw gita (-M100%)
    const exact = gitExactRenames(MAIN);
    for (const c of loose.commits.filter((x) => !x.merge)) {
      assert.deepEqual(c.files.filter((f) => f.status === 'R' && (f.similarity == null || f.similarity === 100)).map((f) => f.from + ' → ' + f.path).sort(), exact.get(c.sha) || [], c.message);
    }
    // zbiór zmian nazw zgodny z domyślnym `git log -M` (50 %)
    const gm = gitRenamesM(MAIN);
    for (const c of loose.commits.filter((x) => !x.merge)) {
      assert.deepEqual(c.files.filter((f) => f.status === 'R').map((f) => f.from + ' → ' + f.path).sort(), gm.get(c.sha) || [], 'git -M: ' + c.message);
    }
  });

  test('6. commit scalający: merge:true, files:[], dwaj rodzice; kolejność jak git log', () => {
    const idx = loose.commits.findIndex((c) => c.sha === info.merge);
    const mc = loose.commits[idx];
    assert.equal(mc.merge, true);
    assert.deepEqual(mc.files, []);
    assert.deepEqual(mc.parents, [info.m1, info.f1]);
    const order = String(git(MAIN, ['log', '--format=%H'])).trim().split('\n');
    assert.deepEqual(loose.commits.map((c) => c.sha), order);
    for (let i = 1; i < loose.commits.length; i++) assert.ok(loose.commits[i - 1].time >= loose.commits[i].time, 'czas malejąco');
  });

  test('2. po git gc --aggressive (OFS_DELTA) wynik identyczny jak z obiektów luźnych; paczka + nowe obiekty luźne', async () => {
    const dir = copyRepo(MAIN, 'gc');
    git(dir, ['gc', '--aggressive', '--prune=now', '-q']);
    const t = packTypes(dir).counts;
    assert.ok(t[6] > 0, 'paczka ma delty OFS: ' + JSON.stringify(t));
    assert.ok(!t[7], 'bez REF_DELTA');
    const r = await readRepo(dir);
    assert.deepEqual(r.commits, loose.commits);
    // nowy commit na paczce: mieszanka obiektów luźnych i spakowanych
    put(dir, 'src/app.js', 'console.log(4);\n');
    commit(dir, 'Po gc');
    const r2 = await readRepo(dir);
    assertOracle(dir, r2.commits);
    assert.deepEqual(r2.commits.slice(1), loose.commits);
  });

  test('3. REF_DELTA (repack.useDeltaBaseOffset=false); indeks v1 i 64-bitowe offsety', async () => {
    const dir = copyRepo(MAIN, 'ref');
    git(dir, ['-c', 'repack.useDeltaBaseOffset=false', 'repack', '-a', '-d', '-f', '-q']);
    git(dir, ['prune']);
    const t = packTypes(dir).counts;
    assert.ok(t[7] > 0, 'paczka ma delty REF: ' + JSON.stringify(t));
    assert.ok(!t[6], 'bez OFS_DELTA');
    assert.deepEqual((await readRepo(dir)).commits, loose.commits);
    // ten sam .pack z indeksem v1 (bez magii), potem v2 z wymuszoną tablicą offsetów 64-bit
    const pdir = path.join(dir, '.git', 'objects', 'pack');
    const packFile = fs.readdirSync(pdir).find((f) => f.endsWith('.pack'));
    const idxFile = path.join(pdir, packFile.replace(/\.pack$/, '.idx'));
    for (const ver of ['1', '2,0x20']) {
      const tmpIdx = path.join(BASE, 'tmp-' + ver.replace(/\W/g, '') + '.idx');
      git(dir, ['index-pack', '--index-version=' + ver, '-o', tmpIdx, path.join(pdir, packFile)]);
      fs.chmodSync(idxFile, 0o644);
      fs.copyFileSync(tmpIdx, idxFile);
      const magic = fs.readFileSync(idxFile).readUInt32BE(0) === 0xff744f63;
      assert.equal(magic, ver !== '1', 'indeks w wersji ' + ver);
      assert.deepEqual((await readRepo(dir)).commits, loose.commits, 'indeks ' + ver);
    }
  });

  test('4. duży plik (> 64 KB) w paczce jako delta: readObject = git cat-file', async () => {
    const dir = copyRepo(MAIN, 'big');
    git(dir, ['gc', '--aggressive', '--prune=now', '-q']);
    const { bySha } = packTypes(dir);
    const repo = await G.open(await readGitFiles(dir));
    let deltas = 0;
    for (let v = 0; v < 4; v++) {
      const sha = String(git(dir, ['rev-parse', `${info['big' + v]}:data/big.txt`])).trim();
      if (bySha[sha] === 6) deltas++;
      const o = await repo.readObject(sha);
      assert.equal(o.type, 'blob');
      assert.ok(o.data.length > 65536);
      assert.ok(Buffer.from(o.data).equals(git(dir, ['cat-file', 'blob', sha])), 'wersja ' + v);
      assert.equal(Buffer.from(o.data).toString('utf8'), bigText(v));
    }
    assert.ok(deltas >= 2, 'wersje dużego pliku zapisane jako delty: ' + deltas);
    const bin = await repo.readObject(String(git(dir, ['rev-parse', `${info.c1}:bin/logo.bin`])).trim());
    assert.ok(Buffer.from(bin.data).equals(fs.readFileSync(path.join(MAIN, 'bin', 'logo.bin'))));
    const c = await repo.readObject(info.c1);
    assert.equal(c.type, 'commit');
    await assert.rejects(repo.readObject('0'.repeat(40)), code('missing-object'));
  });

  test('7. pack-refs (ref tylko w packed-refs, tag adnotowany z ^), odłączony HEAD, refs()', async () => {
    const dir = copyRepo(MAIN, 'refs');
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'tag', '-a', 'v1', '-m', 'wersja 1', info.c4]);
    git(dir, ['pack-refs', '--all']);
    assert.ok(!fs.existsSync(path.join(dir, '.git', 'refs', 'heads', 'main')), 'main tylko w packed-refs');
    assert.match(fs.readFileSync(path.join(dir, '.git', 'packed-refs'), 'utf8'), /^\^[0-9a-f]{40}$/m);
    const r = await readRepo(dir);
    assert.deepEqual(r.head, { ref: 'refs/heads/main', sha: info.last });
    assert.deepEqual(r.commits, loose.commits);
    const refs = host(await r.repo.refs());
    assert.deepEqual(refs.map((x) => x.name), ['refs/heads/feature', 'refs/heads/main', 'refs/tags/v1']);
    // log od taga adnotowanego → odwinięty commit
    const fromTag = await readRepo(dir, { ref: 'v1' });
    assert.equal(fromTag.commits[0].sha, info.c4);
    assertOracle(dir, fromTag.commits, 'v1');
    // odłączony HEAD
    git(dir, ['checkout', '-q', '--detach', info.big1]);
    const d = await readRepo(dir);
    assert.deepEqual(d.head, { ref: null, sha: info.big1 });
    assertOracle(dir, d.commits);
    assert.deepEqual(d.commits, loose.commits.slice(loose.commits.findIndex((c) => c.sha === info.big1)));
  });

  test('8. płytki klon (--depth 3): ostatni commit boundary:true, pliki względem pustego drzewa', async () => {
    const dir = tmp('shallow');
    git(BASE, ['clone', '-q', '--depth', '3', pathToFileURL(MAIN).href, dir]);
    assert.ok(fs.existsSync(path.join(dir, '.git', 'shallow')));
    const r = await readRepo(dir);
    assertOracle(dir, r.commits);
    const b = r.commits.filter((c) => c.boundary);
    assert.ok(b.length >= 1);
    assert.equal(r.commits.at(-1).boundary, true);
    for (const c of b) {
      assert.ok(c.parents.length >= 1, 'boundary ma rodziców, których brak w obiektach');
      assert.ok(c.files.length > 0 && c.files.every((f) => f.status === 'A'), 'pliki względem pustego drzewa');
    }
  });

  test('brak obiektu drzewa → missing-object; uszkodzona paczka → bad-pack', async () => {
    const dir = copyRepo(MAIN, 'broken');
    const tree = String(git(dir, ['rev-parse', `${info.c2}^{tree}`])).trim();
    fs.rmSync(path.join(dir, '.git', 'objects', tree.slice(0, 2), tree.slice(2)));
    await assert.rejects(readRepo(dir), code('missing-object'));
    const dir2 = copyRepo(MAIN, 'badpack');
    git(dir2, ['gc', '-q', '--prune=now']);
    const pdir = path.join(dir2, '.git', 'objects', 'pack');
    const pf = path.join(pdir, fs.readdirSync(pdir).find((f) => f.endsWith('.pack')));
    fs.chmodSync(pf, 0o644);
    const buf = fs.readFileSync(pf); buf.write('JUNK', 0); fs.writeFileSync(pf, buf);
    await assert.rejects(readRepo(dir2), code('bad-pack'));
  });
});

// Historia z `git fast-import`: 140 commitów, gałąź z tymi samymi czasami co main (remisy w kolejce) i scalenie
function buildMany(dir) {
  initRepo(dir);
  const T0 = 1710000000;
  let s = '', mark = 1;
  const data = (txt) => `data ${Buffer.byteLength(txt)}\n${txt}\n`;
  const blob = (txt) => { const m = mark++; s += `blob\nmark :${m}\n${data(txt)}`; return m; };
  const commit = (ref, time, msg, from, merge, changes) => {
    const m = mark++;
    s += `commit ${ref}\nmark :${m}\nauthor Anna Nowak <anna@example.com> ${time} +0100\ncommitter Anna Nowak <anna@example.com> ${time} +0100\n${data(msg)}`;
    if (from) s += `from :${from}\n`;
    if (merge) s += `merge :${merge}\n`;
    s += changes.join('\n') + (changes.length ? '\n' : '') + '\n';
    return m;
  };
  const time = (i) => T0 + Math.floor(i / 2) * 60;
  const main = [];
  let side = null;
  for (let i = 0; i < 120; i++) {
    if (i === 60) { main.push(commit('refs/heads/main', time(i), 'scalenie side', main[59], side, [])); continue; }
    const ch = [`M 100644 :${blob('wersja ' + i + '\n')} f${i % 7}.txt`, `M 100644 :${blob('nowy ' + i + '\n')} d${i % 5}/n${i}.txt`];
    if (i >= 10 && i % 3 === 0 && i - 10 !== 60) ch.push(`D d${(i - 10) % 5}/n${i - 10}.txt`);
    // symlink (120000) to zwykły plik historii; submoduł (gitlink 160000) pomijamy jak w porównaniu z git log
    if (i === 5) ch.push('M 120000 inline link\ndata 6\nf0.txt');
    if (i === 13) ch.push('M 120000 inline link\ndata 6\nf1.txt');
    if (i === 15) ch.push(`M 100644 :${blob('już nie link\n')} link`);
    if (i === 7) ch.push('M 160000 ' + 'a'.repeat(40) + ' vendor/sub');
    if (i === 9) ch.push('M 160000 ' + 'b'.repeat(40) + ' vendor/sub');
    if (i === 11) ch.push('D vendor/sub');
    if (i === 12) ch.push('M 160000 ' + 'c'.repeat(40) + ' d0');   // katalog d0 → submoduł o tej samej nazwie
    main.push(commit('refs/heads/main', time(i), 'commit ' + i, main[i - 1], null, ch));
    if (i === 20) {                                         // gałąź side od commita 20, czasy równe commitom main 21..40
      for (let k = 0; k < 20; k++) side = commit('refs/heads/side', time(21 + k), 'side ' + k, side || main[20], null, [`M 100644 :${blob('s' + k + '\n')} side/s${k % 4}.txt`]);
    }
  }
  git(dir, ['fast-import', '--quiet'], { input: s });
  return dir;
}

describe('GitLocal: długa historia, limit, anulowanie, worker', { skip: SKIP }, () => {
  let MANY, files, full;
  before(async () => {
    MANY = buildMany(tmp('many'));
    files = await readGitFiles(MANY);
    full = await readRepo(MANY);
  });

  test('9. cała historia zgodna z git log (remisy czasu jak w git log), 140 commitów', () => {
    assert.equal(full.commits.length, 140);
    assert.equal(full.truncated, false);
    assertOracle(MANY, full.commits);
    assert.equal(full.commits.filter((c) => c.merge).length, 1);
    const at = (msg) => full.commits.find((c) => c.message === msg).files.map((f) => f.path + ':' + f.status);
    assert.ok(at('commit 5').includes('link:A'), 'symlink jako plik');
    assert.ok(at('commit 13').includes('link:M') && at('commit 15').includes('link:M'), 'zmiana celu / symlink → plik');
    for (const i of [7, 9, 11]) assert.ok(!at('commit ' + i).some((p) => p.startsWith('vendor/')), 'submoduł pominięty');
    const c12 = at('commit 12');
    assert.ok(c12.includes('d0/n0.txt:D') && !c12.some((p) => p.startsWith('d0:')), 'katalog → submoduł: pliki D, sam gitlink pominięty');
  });

  test('10. max ucina historię i ustawia truncated; postęp co 25 commitów', async () => {
    const progress = [];
    const res = await G.run(files, { max: 60, onProgress: (p) => progress.push(host(p)) });
    assert.equal(res.commits.length, 60);
    assert.equal(res.stats.truncated, true);
    assert.ok(res.stats.objects > 0 && res.stats.ms >= 0);
    assert.deepEqual(host(res.commits), full.commits.slice(0, 60));
    assert.deepEqual(host(res.head), full.head);
    assert.deepEqual(progress, [{ done: 25, total: 60 }, { done: 50, total: 60 }, { done: 60, total: 60 }]);
    const exact = await G.run(files, { max: 140 });
    assert.equal(exact.stats.truncated, false);
    assert.equal((await G.run(files, { max: 139 })).stats.truncated, true);
  });

  test('10. signal przerywa z kodem cancelled', async () => {
    const ac = new AbortController();
    await assert.rejects(G.run(files, { signal: ac.signal, onProgress: (p) => { if (p.done >= 25) ac.abort(); } }), code('cancelled'));
    const repo = await G.open(files);
    const pre = new AbortController(); pre.abort();
    await assert.rejects(repo.log({ signal: pre.signal }), code('cancelled'));
  });

  test('git-worker.js: protokół log/progress/done, cancel → error cancelled', async () => {
    const posted = [];
    let wake = null;
    const g = {
      console, performance, setTimeout, clearTimeout, TextDecoder, TextEncoder, Blob, DecompressionStream, AbortController,
      location: { search: '?v=test1' },
      postMessage: (m) => { posted.push(m); if (wake) wake(); },
    };
    g.self = g;
    const loaded = [];
    g.importScripts = (...names) => { for (const n of names) { loaded.push(n); runFile(ctx, 'js/' + n.replace(/\?.*$/, '')); } };
    const ctx = vm.createContext(g);
    runFile(ctx, 'js/git-worker.js');
    assert.deepEqual(loaded, ['git-local.js?v=test1']);
    const until = (pred) => new Promise((res) => { const check = () => { if (pred()) { wake = null; res(); } }; wake = check; check(); });
    ctx.onmessage({ data: { type: 'log', id: 7, files, opts: { max: 30 } } });
    await until(() => posted.some((m) => m.type === 'done' || m.type === 'error'));
    const done = posted.find((m) => m.type === 'done');
    assert.ok(done, JSON.stringify(posted.find((m) => m.type === 'error')));
    assert.equal(done.id, 7);
    assert.deepEqual(host(done.commits), full.commits.slice(0, 30));
    assert.equal(done.stats.truncated, true);
    assert.ok(posted.some((m) => m.type === 'progress' && m.id === 7 && m.done === 25 && m.total === 30));
    posted.length = 0;
    ctx.onmessage({ data: { type: 'log', id: 8, files, opts: { max: 100 } } });
    ctx.onmessage({ data: { type: 'cancel', id: 8 } });
    await until(() => posted.some((m) => m.type === 'done' || m.type === 'error'));
    assert.deepEqual(host(posted.filter((m) => m.type !== 'progress')).map(({ type, id, code: c }) => ({ type, id, code: c })), [{ type: 'error', id: 8, code: 'cancelled' }]);
  });

  test('run() w oknie: Worker z URL-em ze stemplem ?v=, postęp; bez Workera / błąd startu → ten sam wynik w wątku', async () => {
    const made = [];
    class FakeWorker {
      constructor(url) {
        made.push(url);
        const g = {
          console, performance, setTimeout, clearTimeout, TextDecoder, TextEncoder, Blob, DecompressionStream, AbortController,
          location: { search: url.slice(url.indexOf('?')) },
          postMessage: (m) => setTimeout(() => { if (!this.dead && this.onmessage) this.onmessage({ data: structuredClone(m) }); }, 0),
        };
        g.self = g;
        g.importScripts = (...names) => { for (const n of names) runFile(this.ctx, 'js/' + n.replace(/\?.*$/, '')); };
        this.ctx = vm.createContext(g);
        runFile(this.ctx, 'js/git-worker.js');
      }
      postMessage(m) { setTimeout(() => { if (!this.dead) this.ctx.onmessage({ data: m }); }, 0); }
      terminate() { this.dead = true; }
    }
    const doc = { ...docStub(), currentScript: { src: 'http://localhost/js/git-local.js?v=20260927z' } };
    const W = loadCM(['git-local'], { document: doc, Worker: FakeWorker }).GitLocal;
    assert.equal(W.workerUrl, 'js/git-worker.js?v=20260927z');
    const progress = [];
    const res = await W.run(files, { max: 50, onProgress: (p) => progress.push(host(p)) });
    assert.deepEqual(made, ['js/git-worker.js?v=20260927z']);
    assert.deepEqual(host(res.commits), full.commits.slice(0, 50));
    assert.equal(res.stats.truncated, true);
    assert.deepEqual(progress, [{ done: 25, total: 50 }, { done: 50, total: 50 }]);
    // anulowanie w trakcie: worker zatrzymany, obietnica odrzucona z cancelled
    const ac = new AbortController();
    await assert.rejects(W.run(files, { signal: ac.signal, onProgress: () => ac.abort() }), code('cancelled'));
    // konstruktor Workera rzuca → wątek główny
    const Broken = loadCM(['git-local'], { document: doc, Worker: class { constructor() { throw new Error('CSP'); } } }).GitLocal;
    assert.deepEqual(host((await Broken.run(files, { max: 10 })).commits), full.commits.slice(0, 10));
    // worker pada przy starcie (np. 404 skryptu) → wątek główny
    class Dead { postMessage() { setTimeout(() => this.onerror && this.onerror({ message: 'importScripts failed', preventDefault() {} }), 0); } terminate() {} }
    const Fallback = loadCM(['git-local'], { document: doc, Worker: Dead }).GitLocal;
    assert.deepEqual(host((await Fallback.run(files, { max: 10 })).commits), full.commits.slice(0, 10));
  });
});
