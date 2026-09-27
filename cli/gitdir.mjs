// Katalog .git z dysku jako lista plików w kształcie, jaki dostaje js/git-local.js w przeglądarce
// ([{path (względem .git), file: Blob}]). Wspólne dla CLI (cli/analyze.mjs) i sondy tools/git-probe.mjs.
// W odróżnieniu od przeglądarki rozumie plik `.git` z `gitdir:` (worktree, submoduł) — ścieżkę da się
// tu po prostu otworzyć. Repozytorium jest tylko czytane.
import { existsSync, readFileSync, readdirSync, statSync, openAsBlob } from 'node:fs';
import { join, resolve, isAbsolute, relative, sep, dirname } from 'node:path';

/** Katalog .git repozytorium: zwykły katalog albo plik `gitdir:` (worktree/submoduł) + `commondir`. */
export function findGitDir(repo) {
  const dotgit = join(repo, '.git');
  if (!existsSync(dotgit)) return null;
  if (statSync(dotgit).isDirectory()) return { gitDir: dotgit, commonDir: dotgit };
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'));
  if (!m) return null;
  const gitDir = isAbsolute(m[1]) ? m[1] : resolve(repo, m[1]);
  const cd = join(gitDir, 'commondir');
  const commonDir = existsSync(cd) ? resolve(gitDir, readFileSync(cd, 'utf8').trim()) : gitDir;
  return { gitDir, commonDir };
}

/** Najbliższy katalog (dir albo jego przodek) zawierający `.git`; null poza repozytorium. */
export function findRepoRoot(dir) {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, '.git'))) return cur;
    const up = dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

function* walk(dir, base = dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, base);
    else if (e.isFile()) yield relative(base, p).split(sep).join('/');
  }
}
// katalogi, których czytnik nie potrzebuje (drzewa robocze, submoduły, logi, hooki)
const SKIP_TOP = new Set(['worktrees', 'modules', 'logs', 'hooks', 'lfs']);

/** Pliki katalogu .git jako [{path, file}] — jak loader przeglądarki. lazy: Blob z pliku (fs.openAsBlob). */
export async function readGitFiles(repo, { lazy = false } = {}) {
  const loc = findGitDir(repo);
  if (!loc) return null;
  const blob = async (p) => (lazy ? openAsBlob(p) : new Blob([readFileSync(p)]));
  const out = new Map();
  for (const rel of walk(loc.commonDir)) {
    if (SKIP_TOP.has(rel.split('/')[0])) continue;
    out.set(rel, join(loc.commonDir, rel));
  }
  if (loc.gitDir !== loc.commonDir) out.set('HEAD', join(loc.gitDir, 'HEAD'));   // worktree: własny HEAD, reszta wspólna
  return Promise.all([...out].map(async ([path, p]) => ({ path, file: await blob(p) })));
}
