// Sonda czytnika historii git (js/git-local.js) na PRAWDZIWYM repozytorium: czyta katalog .git tak jak
// przeglądarka (lista [{path, file}] ze ścieżkami względem .git, pliki jako Blob), drukuje liczbę commitów,
// czas i 10 najczęściej zmienianych plików, a potem PORÓWNUJE wynik z wyrocznią `git log`
// (kolejność, czasy, autorzy, pliki i bloby per commit). Repozytorium jest tylko czytane.
//   node tools/git-probe.mjs [ścieżka-repo] [max] [ref]  (domyślnie: repozytorium CodeMap, 2000, HEAD)
// Eksportuje też pomocników dla test/git-local.test.mjs.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { findGitDir, readGitFiles } from '../cli/gitdir.mjs';

// odczyt katalogu .git z dysku jest wspólny z CLI (cli/gitdir.mjs); tu tylko re-eksport dla testów
export { findGitDir, readGitFiles };

export const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

/** git z izolowaną konfiguracją (bez ~/.gitconfig i systemowej), stdout jako Buffer. */
export function git(cwd, args, { env = {}, input } = {}) {
  const r = spawnSync('git', args, {
    cwd, input, maxBuffer: 1 << 30,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull(), GIT_TERMINAL_PROMPT: '0', ...env },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(r.stderr).trim()}`);
  return r.stdout;
}
const devNull = () => (process.platform === 'win32' ? 'NUL' : '/dev/null');
export function gitAvailable() {
  try { return spawnSync('git', ['--version']).status === 0; } catch { return false; }
}

/** js/git-local.js w świeżym kontekście vm (jak w workerze: self.CM, bez DOM). */
export function loadGitLocal() {
  const g = {
    console, performance, setTimeout, clearTimeout, TextDecoder, TextEncoder, Blob, DecompressionStream, AbortController,
  };
  g.self = g;
  const ctx = vm.createContext(g);
  vm.runInContext(readFileSync(join(ROOT, 'js', 'git-local.js'), 'utf8'), ctx, { filename: 'js/git-local.js' });
  return ctx.CM.GitLocal;
}

/** R → D (stara ścieżka) + A (nowa), żeby porównać z `git log --no-renames`. */
export function splitRenames(files) {
  const out = [];
  for (const f of files) {
    if (f.status === 'R') { out.push({ path: f.from, status: 'D', oldSha: f.oldSha }, { path: f.path, status: 'A', sha: f.sha }); }
    else out.push(f);
  }
  return out;
}

const ZERO = '0'.repeat(40);
/** Wyrocznia: kolejność + metadane (`git log`) i pliki z blobami (`git log --no-merges --no-renames --raw`). */
export function oracle(repo, max = 2000, ref = 'HEAD') {
  const fmt = ['%H', '%ct', '%at', '%an', '%ae', '%cn', '%ce', '%P'].join('%x1f');
  const order = String(git(repo, ['-c', 'core.quotepath=false', 'log', '-z', `--format=${fmt}`, '-n', String(max), ref]))
    .split('\0').filter(Boolean).map((l) => {
      const [sha, ct, at, an, ae, cn, ce, p] = l.replace(/^\n/, '').split('\x1f');
      return { sha, ct: +ct, at: +at, an, ae, cn, ce, parents: p ? p.split(' ') : [] };
    });
  const raw = String(git(repo, ['-c', 'core.quotepath=false', 'log', '--no-merges', '--no-renames', '--raw', '--no-abbrev', '-z',
    '--format=%x01%H', '-n', String(max), ref]));
  const files = new Map();
  for (const chunk of raw.split('\x01')) {
    if (!chunk) continue;
    const sha = chunk.slice(0, 40), list = [];
    const tok = chunk.slice(40).split('\0').map((t) => t.replace(/^\n/, ''));
    for (let i = 0; i < tok.length; i++) {
      if (!tok[i].startsWith(':')) continue;
      const [om, nm, os, ns, st] = tok[i].slice(1).split(' ');
      const path = tok[++i];
      const oldG = om === '160000', newG = nm === '160000';
      if (oldG && newG) continue;                                             // submoduły pomijamy
      if (st[0] === 'T' && (oldG || newG)) {                                  // plik ↔ submoduł
        if (!oldG) list.push({ path, status: 'D', oldSha: os });
        if (!newG) list.push({ path, status: 'A', sha: ns });
        continue;
      }
      if ((st[0] === 'A' && newG) || (st[0] === 'D' && oldG)) continue;
      const status = st[0] === 'T' ? 'M' : st[0];                             // zmiana typu (plik ↔ symlink) = M
      const e = { path, status };
      if (ns !== ZERO) e.sha = ns;
      if (os !== ZERO) e.oldSha = os;
      list.push(e);
    }
    files.set(sha, list);
  }
  return { order, files };
}

const key = (f) => `${f.status}\t${f.path}\t${f.sha || ''}\t${f.oldSha || ''}`;
/** Różnice między wynikiem czytnika a wyrocznią (lista komunikatów; pusta = zgodne). */
export function compareWithOracle(commits, orc, { limit = 20 } = {}) {
  const problems = [];
  const push = (m) => { if (problems.length < limit) problems.push(m); };
  const n = Math.min(commits.length, orc.order.length);
  if (commits.length !== orc.order.length) push(`liczba commitów: ${commits.length} ≠ git log ${orc.order.length}`);
  for (let i = 0; i < n; i++) {
    const c = commits[i], o = orc.order[i];
    if (c.sha !== o.sha) { push(`#${i}: kolejność ${c.sha.slice(0, 10)} ≠ git log ${o.sha.slice(0, 10)}`); continue; }
    if (c.time !== o.ct * 1000 || c.authorTime !== o.at * 1000) push(`${c.sha.slice(0, 10)}: czas ${c.time}/${c.authorTime} ≠ ${o.ct}/${o.at}`);
    if (c.author.name !== o.an || c.author.email !== o.ae || c.committer.name !== o.cn || c.committer.email !== o.ce)
      push(`${c.sha.slice(0, 10)}: autor „${c.author.name} <${c.author.email}>” ≠ „${o.an} <${o.ae}>”`);
    if (!c.boundary && c.parents.join(' ') !== o.parents.join(' ')) push(`${c.sha.slice(0, 10)}: rodzice ${c.parents} ≠ ${o.parents}`);
    if (c.merge !== (o.parents.length > 1)) push(`${c.sha.slice(0, 10)}: merge=${c.merge}`);
    if (c.merge) { if (c.files.length) push(`${c.sha.slice(0, 10)}: merge z plikami`); continue; }
    const want = orc.files.get(c.sha);
    if (!want) { push(`${c.sha.slice(0, 10)}: brak w git log --no-merges`); continue; }
    const a = splitRenames(c.files).map(key).sort(), b = want.map(key).sort();
    if (a.join('\n') !== b.join('\n')) {
      const sa = new Set(a), sb = new Set(b);
      push(`${c.sha.slice(0, 10)}: pliki różne — nadmiar: [${a.filter((x) => !sb.has(x)).join(' | ')}] brak: [${b.filter((x) => !sa.has(x)).join(' | ')}]`);
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repo = resolve(process.argv[2] || ROOT);
  const max = Number(process.argv[3]) || 2000;
  const ref = process.argv[4] || null;
  const files = await readGitFiles(repo, { lazy: true });
  if (!files) {
    console.log(`– git-probe: ${repo} nie jest repozytorium git — pominięto`);
  } else {
    const G = loadGitLocal();
    const t0 = performance.now();
    let res = null;
    try {
      res = await G.runInThread(files, { max, ref });
    } catch (e) {
      console.log(`✖ git-probe: ${e.code || ''} ${e.message}`);
      process.exitCode = 1;
    }
    if (res) {
      const ms = performance.now() - t0;
      const files1 = res.commits.reduce((a, c) => a + c.files.length, 0);
      const merges = res.commits.filter((c) => c.merge).length;
      console.log(`git-probe: ${repo}`);
      console.log(`  HEAD ${res.head.ref || '(odłączony)'} @ ${res.head.sha.slice(0, 12)}${ref ? ', historia od ' + ref : ''}`);
      console.log(`  ${res.commits.length} commitów (${merges} scalających${res.stats.truncated ? ', ucięte do max=' + max : ''}), ${files1} zmian plików, ${res.stats.objects} obiektów, ${ms.toFixed(0)} ms`);
      const count = new Map();
      for (const c of res.commits) for (const f of c.files) count.set(f.path, (count.get(f.path) || 0) + 1);
      const top = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10);
      console.log('  najczęściej zmieniane:');
      for (const [p, n] of top) console.log(`    ${String(n).padStart(5)}  ${p}`);
      if (!gitAvailable()) {
        console.log('– brak polecenia git — pominięto porównanie z wyrocznią');
      } else {
        const t1 = performance.now();
        const problems = compareWithOracle(res.commits, oracle(repo, max, ref || res.head.sha));
        const tail = `(git log: ${(performance.now() - t1).toFixed(0)} ms)`;
        if (problems.length) { console.log(`✖ różnice z git log ${tail}:\n   ` + problems.join('\n   ')); process.exitCode = 1; }
        else console.log(`✔ zgodne z git log --no-merges --no-renames --raw ${tail}`);
      }
    }
  }
  // exitCode zamiast process.exit(): na Node 26 twarde exit() po strumieniach potrafi skończyć się asercją libuv
}
