// Serwer MCP (cli/mcp.mjs): JSON-RPC (initialize z negocjacją wersji, tools/list, tools/call, błędy), narzędzia na
// tymczasowym projekcie z cyklem i testem, oraz prawdziwa sesja stdio `codemap mcp` (stdout = tylko protokół).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, TOOLS } from '../cli/mcp.mjs';
import { vulnSummary } from '../cli/report.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'codemap.mjs');
let dir, srv;
const write = (rel, text) => { const p = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const call = async (name, args = {}) => { const r = await srv.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }); return r.result; };
const text = async (name, args) => (await call(name, args)).content[0].text;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-mcp-'));
  write('package.json', '{ "name": "demo", "scripts": { "test": "node --test" } }');
  write('src/a.js', "import { b } from './b.js';\nexport function a(x) { if (x > 1) { return b(x); } return 0; }\n");
  write('src/b.js', "import { a } from './a.js';\nexport function b(x) { return a(x - 1); }\n");
  write('src/util.js', "import { a } from './a.js';\nexport const u = () => a(2);\n");
  write('test/util.test.js', "import { u } from '../src/util.js';\n");
  srv = createServer({ dir, git: false, lang: 'en', log: () => {} });
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('MCP: protokół', () => {
  test('initialize: wersja klienta albo najnowsza; capabilities.tools; powiadomienie → brak odpowiedzi; ping', async () => {
    const r = await srv.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    assert.equal(r.result.protocolVersion, '2025-03-26');
    assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
    assert.equal((await srv.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result.protocolVersion, '2025-06-18');
    assert.equal(await srv.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    assert.deepEqual((await srv.handle({ jsonrpc: '2.0', id: 3, method: 'ping' })).result, {});
  });
  test('tools/list: narzędzia ze schematami wejścia; bez --osv bez vulnerable_dependencies', async () => {
    const r = await srv.handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    assert.deepEqual(r.result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
    assert.ok(r.result.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object' && t.description));
  });
  test('nieznane narzędzie → isError z opisem; nieznana metoda → -32601', async () => {
    const r = await call('rm_rf', {});
    assert.equal(r.isError, true); assert.match(r.content[0].text, /unknown tool: rm_rf/);
    assert.equal((await srv.handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).error.code, -32601);
  });
});

describe('MCP: narzędzia', () => {
  test('project_overview, find_files, dependents, file_info', async () => {
    assert.match(await text('project_overview'), /files, \d+ lines · health score \d+\/100/);
    assert.equal(await text('find_files', { query: 'util' }), 'src/util.js\ntest/util.test.js');
    assert.match(await text('dependents', { path: 'src/a.js' }), /^src\/a\.js is imported by: src\/b\.js, src\/util\.js/);
    assert.match(await text('file_info', { path: 'a.js' }), /^src\/a\.js: \d+ lines, complexity \d+/);
    const miss = await call('file_info', { path: 'nope.js' }); assert.equal(miss.isError, true);
  });
  test('cycles, findings (filtr reguły), change_impact, tests, ask_map, test_skeleton, code_search', async () => {
    assert.match(await text('cycles'), /1 import cycle\(s\):\n- src\/(a|b)\.js → src\/(a|b)\.js \(2 files\)/);
    assert.match(await text('findings', { rule: 'cycles' }), /^\[med\] cycles · src\//);
    assert.match(await text('change_impact', { paths: ['src/a.js'] }), /^risk \w+ \(\d+\/100\) · 1 changed files on the map · \d+ impacted dependents/);
    assert.match(await text('tests', { path: 'src/util.js' }), /is tested by: test\/util\.test\.js/);
    assert.match(await text('ask_map', { question: 'files in cycles' }), /^Files: 2 — /);
    assert.match(await text('test_skeleton', { path: 'src/b.js' }), /^proposed file: test\/b\.test\.js \(node\)\n```\n/);
    // BM25: słowa kluczowe i jednoliterowe tokeny odpadają z zapytania, więc szukamy po nazwie
    assert.match(await text('code_search', { query: 'util' }), /\[1\] (src\/util\.js|test\/util\.test\.js):1-/);
  });
});

describe('MCP: sesja stdio', () => {
  test('codemap mcp: każda linia stdout to JSON-RPC; initialize + tools/call', async () => {
    const child = spawn(process.execPath, [CLI, 'mcp', dir, '--no-git'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'find_files', arguments: { query: 'b.js' } } }) + '\n');
    child.stdin.end();
    await new Promise((res) => child.on('close', res));
    const msgs = out.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(msgs.map((m) => m.id).sort(), [1, 2]);
    assert.equal(msgs.find((m) => m.id === 2).result.content[0].text, 'src/b.js');
    assert.equal(msgs.find((m) => m.id === 1).result.serverInfo.name, 'codemap');
  });
});

describe('vulnerable_dependencies — tekst (vulnSummary)', () => {
  test('brak sprawdzenia, brak podatności, lista z przechodnią zależnością i poprawką', () => {
    assert.match(vulnSummary(null), /did not run/);
    assert.equal(vulnSummary({ checked: 4, items: [] }), 'none of 4 packages has known vulnerabilities');
    const t = vulnSummary({ checked: 9, items: [{ name: 'lodash', version: '4.17.20', ecosystem: 'npm', direct: false, level: 'HIGH', fixed: '4.17.21',
      vulns: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id })) }] });
    assert.equal(t, '1 of 9 packages vulnerable:\n- lodash 4.17.20 (npm, transitive): HIGH — A, B, C, D · fixed in 4.17.21');
  });
});
