import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findGitDir, findRepoRoot, readGitFiles } from '../cli/gitdir.mjs';

// Katalog .git z dysku (cli/gitdir.mjs) na sztucznych repozytoriach: zwykłe .git, worktree (plik „gitdir:" +
// commondir), pliki pomijane (logs, hooks, worktrees…), leniwe Bloby, szukanie korzenia repozytorium w górę drzewa.
let root;
const put = (rel, data) => { const p = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-gitdir-'));
  put('main/.git/HEAD', 'ref: refs/heads/main\n');
  put('main/.git/config', '[core]\n');
  put('main/.git/refs/heads/main', 'a'.repeat(40) + '\n');
  put('main/.git/objects/ab/cdef', 'blob');
  put('main/.git/logs/HEAD', 'log');
  put('main/.git/hooks/pre-commit', '#!/bin/sh');
  put('main/.git/worktrees/wt/HEAD', 'ref: refs/heads/feature\n');
  put('main/.git/worktrees/wt/commondir', '../..\n');
  put('main/src/deep/x.js', 'x');
  put('wt/.git', 'gitdir: ' + path.join(root, 'main', '.git', 'worktrees', 'wt') + '\n');
  put('rel/.git', 'gitdir: ../main/.git\n');
  put('broken/.git', 'to nie jest wskazanie');
});
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('findGitDir / findRepoRoot', () => {
  test('zwykły katalog .git; plik gitdir (ścieżka bezwzględna i względna) z commondir; brak lub zły plik → null', () => {
    const m = findGitDir(path.join(root, 'main'));
    assert.deepEqual(m, { gitDir: path.join(root, 'main', '.git'), commonDir: path.join(root, 'main', '.git') });
    const w = findGitDir(path.join(root, 'wt'));
    assert.equal(w.gitDir, path.join(root, 'main', '.git', 'worktrees', 'wt'));
    assert.equal(w.commonDir, path.join(root, 'main', '.git'));
    const r = findGitDir(path.join(root, 'rel'));
    assert.equal(r.gitDir, path.join(root, 'main', '.git')); assert.equal(r.commonDir, r.gitDir, 'bez commondir = ten sam katalog');
    assert.equal(findGitDir(path.join(root, 'broken')), null);
    assert.equal(findGitDir(path.join(root, 'main', 'src')), null);
  });
  test('findRepoRoot: najbliższy przodek z .git; katalog bez .git w sobie nie jest korzeniem', () => {
    assert.equal(findRepoRoot(path.join(root, 'main', 'src', 'deep')), path.join(root, 'main'));
    assert.equal(findRepoRoot(path.join(root, 'wt')), path.join(root, 'wt'), 'plik .git też wyznacza korzeń');
    const outside = findRepoRoot(root);
    assert.ok(outside === null || (outside !== root && root.startsWith(outside)));
  });
});

describe('readGitFiles', () => {
  test('pliki .git jako [{path, file}] ze ścieżkami z „/"; logs, hooks i worktrees pominięte; treść czytelna', async () => {
    const files = await readGitFiles(path.join(root, 'main'));
    assert.deepEqual(files.map((f) => f.path).sort(), ['HEAD', 'config', 'objects/ab/cdef', 'refs/heads/main']);
    const head = files.find((f) => f.path === 'HEAD');
    assert.equal(await head.file.text(), 'ref: refs/heads/main\n');
    assert.equal(head.file.size, 21);
  });
  test('worktree: własny HEAD, reszta ze wspólnego katalogu; tryb leniwy (openAsBlob); spoza repo → null', async () => {
    const files = await readGitFiles(path.join(root, 'wt'), { lazy: true });
    assert.deepEqual(files.map((f) => f.path).sort(), ['HEAD', 'config', 'objects/ab/cdef', 'refs/heads/main']);
    assert.equal(await files.find((f) => f.path === 'HEAD').file.text(), 'ref: refs/heads/feature\n');
    assert.equal(await readGitFiles(path.join(root, 'broken')), null);
  });
});
