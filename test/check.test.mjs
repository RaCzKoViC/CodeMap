// `codemap check` (cli/check.mjs) na tymczasowym repozytorium git: stan „po" = indeks (nie katalog roboczy), stan
// „przed" = HEAD, nowe znaleziska reguł architektury = kod 1; podkatalog, repozytorium bez commitów, hook pre-commit
// przy prawdziwym `git commit` (także `commit -a`), cudzy hook nietknięty, JSON z CLI.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, gitAvailable } from '../tools/git-probe.mjs';
import { runCheck, checkFailures, formatCheck, installHook, uninstallHook, DEFAULT_FAIL } from '../cli/check.mjs';
import { createServer } from '../cli/mcp.mjs';
import { ROOT, writeTree, LAYER_RULES } from './harness.mjs';

const CLI = path.join(ROOT, 'cli', 'codemap.mjs');
const skip = !gitAvailable() && 'brak polecenia git';
let DIR;
const write = (rel, text) => writeTree(DIR, rel, text);
const g = (...args) => String(git(DIR, args));
const commit = (msg, ...extra) => spawnSync('git', ['commit', '-q', '-m', msg, ...extra], { cwd: DIR, encoding: 'utf8',
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } });
const CLEAN = 'export const hook = () => 1;\n';
const UPSTREAM = "import { View } from '../app/view.js';\nexport const hook = () => new View();\n";   // lib → app: zakazane

before(() => {
  if (skip) return;
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-check-'));
  g('init', '-q');
  for (const [k, v] of [['core.autocrlf', 'false'], ['commit.gpgsign', 'false'], ['user.name', 'Anna Nowak'], ['user.email', 'anna@example.com']]) g('config', k, v);
  write('lib/core.js', 'export const total = (xs) => xs.length;\n');
  write('app/view.js', "import { total } from '../lib/core.js';\nexport class View { constructor() { this.t = total([1]); } }\n");
  write('.codemap.rules.json', LAYER_RULES);
  g('add', '-A'); assert.equal(commit('base').status, 0);
});
after(() => { if (DIR) fs.rmSync(DIR, { recursive: true, force: true }); });

describe('codemap check', { skip }, () => {
  test('nic w indeksie → pusto, bez porażki; zmiana tylko w katalogu roboczym się nie liczy', async () => {
    write('lib/hook.js', UPSTREAM);
    const r = await runCheck(DIR, { lang: 'en' });
    assert.equal(r.empty, true);
    assert.deepEqual(checkFailures(r, [], 'en'), []);
    assert.match(formatCheck(r, 'en'), /Nothing staged/);
    fs.rmSync(path.join(DIR, 'lib', 'hook.js'));
  });

  test('zależność pod prąd w indeksie → nowe archviolation, porażka domyślna; --fail-on none/high', async () => {
    write('lib/hook.js', UPSTREAM); g('add', 'lib/hook.js');
    try {
      const r = await runCheck(DIR, { lang: 'en' });
      assert.equal(r.empty, false);
      assert.deepEqual(r.staged.map((f) => [f.path, f.status]), [['lib/hook.js', 'A']]);
      const av = r.added.find((x) => x.rule === 'archviolation');
      assert.ok(av && av.path === 'lib/hook.js', JSON.stringify(r.added));
      assert.ok(r.score.delta < 0 && r.score.after < r.score.before, JSON.stringify(r.score));
      assert.equal(r.pr.changed[0].path, 'lib/hook.js');
      assert.deepEqual(DEFAULT_FAIL, ['archviolation', 'cycles', 'pkgcycle']);
      const why = checkFailures(r, [], 'en');
      assert.equal(why.length, 1); assert.match(why[0], /new archviolation findings .*: 1/);
      assert.equal(checkFailures(r, [{ rule: 'orphan' }], 'en').length, 0);
      assert.equal(checkFailures(r, [{ sev: 'high' }], 'en').length, 1);
      assert.match(formatCheck(r, 'en'), /Health vs HEAD +100 → \d+ \(−\d+\) · new findings: 1/);
    } finally { g('rm', '-q', '--cached', 'lib/hook.js'); fs.rmSync(path.join(DIR, 'lib', 'hook.js')); }
  });

  test('częściowe git add: liczy się treść z indeksu, nie z dysku (w obie strony)', async () => {
    write('lib/hook.js', CLEAN); g('add', 'lib/hook.js'); write('lib/hook.js', UPSTREAM);
    try {
      let r = await runCheck(DIR, { lang: 'en', git: false });
      assert.ok(!r.added.some((x) => x.rule === 'archviolation'), 'zakazany import tylko na dysku');
      g('add', 'lib/hook.js'); write('lib/hook.js', CLEAN);
      r = await runCheck(DIR, { lang: 'en', git: false });
      assert.ok(r.added.some((x) => x.rule === 'archviolation'), 'zakazany import w indeksie');
    } finally { g('rm', '-q', '-f', '--cached', 'lib/hook.js'); fs.rmSync(path.join(DIR, 'lib', 'hook.js')); }
  });

  test('podkatalog: ścieżki względem analizowanego folderu, zmiany spoza niego pominięte', async () => {
    write('lib/extra.js', 'export const x = 1;\n'); g('add', 'lib/extra.js');
    try {
      const r = await runCheck(path.join(DIR, 'lib'), { lang: 'en', git: false });
      assert.equal(r.sub, 'lib');
      assert.deepEqual(r.staged.map((f) => f.path), ['extra.js']);
      const r2 = await runCheck(path.join(DIR, 'app'), { lang: 'en', git: false });
      assert.equal(r2.empty, true);
    } finally { g('rm', '-q', '--cached', 'lib/extra.js'); fs.rmSync(path.join(DIR, 'lib', 'extra.js')); }
  });

  test('hook pre-commit: zatrzymuje commit z naruszeniem (także commit -a), --no-verify przechodzi; cudzy hook nietknięty', () => {
    const cliPath = CLI;
    assert.match(installHook(DIR, { cliPath, lang: 'en' }), /Installed the pre-commit hook/);
    const hook = path.join(DIR, '.git', 'hooks', 'pre-commit');
    assert.match(fs.readFileSync(hook, 'utf8'), /^#!\/bin\/sh\n# codemap-check: .*\nexec node ".*codemap\.mjs" check "\." --lang en\n$/);
    try {
      write('lib/ok.js', CLEAN); g('add', 'lib/ok.js');
      assert.equal(commit('ok').status, 0, 'czysta zmiana przechodzi');
      write('lib/ok.js', UPSTREAM);                               // bez git add — commit -a bierze z GIT_INDEX_FILE
      const bad = commit('bad', '-a');
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /commit (stopped|zatrzymany)/);
      assert.equal(commit('bad', '-a', '--no-verify').status, 0);
    } finally { uninstallHook(DIR, { lang: 'en' }); }
    assert.ok(!fs.existsSync(hook));
    fs.writeFileSync(hook, '#!/bin/sh\necho mine\n');
    try { assert.throws(() => installHook(DIR, { cliPath, lang: 'en' }), /already exists and is not from CodeMap/); }
    finally { assert.match(uninstallHook(DIR, { lang: 'en' }), /No CodeMap pre-commit hook/); assert.ok(fs.existsSync(hook)); fs.rmSync(hook); }
  });

  test('MCP staged_check: BLOCKING przy naruszeniu, bez niego „no blocking problems"', async () => {
    const srv = createServer({ dir: DIR, lang: 'en', git: false, log: () => {} });
    const call = async () => (await srv.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'staged_check', arguments: {} } })).result;
    write('lib/mcp.js', UPSTREAM); g('add', 'lib/mcp.js');
    try {
      const r = await call();
      assert.equal(r.isError, false);
      assert.match(r.content[0].text, /CodeMap check · index vs HEAD[\s\S]*BLOCKING:\n- new archviolation findings/);
      write('lib/mcp.js', CLEAN); g('add', 'lib/mcp.js');
      assert.match((await call()).content[0].text, /no blocking problems$/);
      await srv.ready();
    } finally { g('rm', '-q', '-f', '--cached', 'lib/mcp.js'); fs.rmSync(path.join(DIR, 'lib', 'mcp.js')); }
  });

  test('CLI: kod 1 przy naruszeniu, JSON z nowymi znaleziskami; --fail-on none → 0; poza repozytorium → 2', () => {
    write('app/x.js', "import { hook } from '../lib/ok.js';\nexport const x = hook;\n");
    write('lib/core.js', "import { x } from '../app/x.js';\nexport const total = (xs) => xs.length + (x ? 0 : 1);\n");
    g('add', '-A');
    try {
      const out = path.join(DIR, 'check.json');
      const r = spawnSync(process.execPath, [CLI, 'check', DIR, '--json', out, '--lang', 'en', '--no-git'], { encoding: 'utf8' });
      assert.equal(r.status, 1, r.stderr);
      const j = JSON.parse(fs.readFileSync(out, 'utf8'));
      assert.equal(j.empty, false);
      assert.ok(j.newFindings.some((x) => x.rule === 'archviolation'));
      assert.ok(j.failed.length >= 1);
      assert.equal(spawnSync(process.execPath, [CLI, 'check', DIR, '--fail-on', 'none', '-q', '--no-git'], { encoding: 'utf8' }).status, 0);
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-nogit-'));
      try {
        const e = spawnSync(process.execPath, [CLI, 'check', outside, '--lang', 'en'], { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(outside) } });
        assert.equal(e.status, 2); assert.match(e.stderr, /needs a git repository/);
      } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    } finally { g('reset', '-q'); g('checkout', '-q', '--', 'lib/core.js'); fs.rmSync(path.join(DIR, 'app', 'x.js'), { force: true }); fs.rmSync(path.join(DIR, 'check.json'), { force: true }); }
  });
});
