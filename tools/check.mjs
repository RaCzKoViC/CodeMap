// Sprawdzenie składni wszystkich skryptów (frontend, service worker, backend, testy, narzędzia)
// przez `node --check` — działa tak samo na Windows i w CI (bez globów powłoki).
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['node_modules', '.git', 'Sejf', 'data', '_site']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (['.js', '.mjs'].includes(extname(name))) yield p;
  }
}

let failed = 0, n = 0;
for (const file of walk(ROOT)) {
  n++;
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`✖ ${file}\n${r.stderr}`); }
}
console.log(`${failed ? '✖' : '✔'} składnia: ${n - failed}/${n} plików OK`);
process.exit(failed ? 1 : 0);
