import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

const CM = loadCM([...CORE, 'rag', 'git-core', 'testmap', 'agent']);
const AG = CM.Agent;
const build = () => new CM.Graph.Graph().build(FILES.map((f) => ({ ...f })), META);
// RAG bez przeglądarki: search na indeksie leksykalnym z grafu
function fakeRag(g) {
  const chunks = []; for (const n of g.nodes.values()) for (const c of CM.RAG.chunkFile(n)) chunks.push(c);
  const lex = CM.RAG.buildLexical(chunks);
  return { search: async (q, o) => ({ hits: CM.RAG.rank(CM.RAG.bm25(lex, CM.RAG.queryTokens(q)), null, (o && o.k) || 4).filter((h) => h.score > 0), s: { chunks } }) };
}
// udawany model: kolejne odpowiedzi ze skryptu, zapis wiadomości, które dostał
function scripted(replies) { const seen = []; let i = 0; return { seen, chat: async (msgs, tools) => { seen.push({ msgs: msgs.slice(), tools: !!tools }); return replies[Math.min(i++, replies.length - 1)]; } }; }

describe('wywołania narzędzi z odpowiedzi modelu', () => {
  test('natywne tool_calls (llama3.x / qwen3) — argumenty jako obiekt albo tekst JSON', () => {
    const r = AG.toolCalls({ content: '', tool_calls: [{ function: { name: 'dependents', arguments: { path: 'util.js' } } }, { function: { name: 'readFile', arguments: '{"path":"a.js","start":3}' } }] });
    assert.equal(r.native, true);
    assert.deepEqual(host(r.calls), [{ name: 'dependents', args: { path: 'util.js' } }, { name: 'readFile', args: { path: 'a.js', start: 3 } }]);
  });
  test('JSON w treści (qwen2.5-coder), także w ```json``` i z opisem zamiast nazwy; zwykły tekst → brak wywołań', () => {
    assert.deepEqual(host(AG.toolCalls({ content: '{"name": "codeSearch", "arguments": {"query": "bus factor"}}' }).calls), [{ name: 'codeSearch', args: { query: 'bus factor' } }]);
    assert.deepEqual(host(AG.toolCalls({ content: 'Sprawdzę:\n```json\n{"name":"Files that import the given file","arguments":{"path":"x.js"}}\n```' }).calls), [{ name: 'dependents', args: { path: 'x.js' } }]);
    assert.equal(AG.toolCalls({ content: 'Bus factor to liczba osób…' }).calls.length, 0);
    assert.equal(AG.toolCalls({ content: '{"name":"rm -rf","arguments":{}}' }).calls.length, 0, 'nieznane narzędzie odrzucone');
  });
});

describe('narzędzia na grafie projektu (tylko odczyt)', () => {
  const g = build(), ctx = { graph: g, rag: fakeRag(g), sources: [] };
  test('dependents / dependencies / fileInfo / findFiles', async () => {
    assert.match(await AG.exec('dependents', { path: 'src/lib/util.js' }, ctx), /src\/app\.js/);
    assert.match(await AG.exec('dependencies', { path: 'app.js' }, ctx), /src\/lib\/util\.js/);
    assert.match(await AG.exec('fileInfo', { path: 'src/store/reducer.js' }, ctx), /lines, complexity \d+/);
    assert.match(await AG.exec('findFiles', { query: 'store' }, ctx), /src\/store\/index\.js/);
    await assert.rejects(AG.exec('readFile', { path: 'nie/ma.js' }, ctx), /file not found/);
  });
  test('codeSearch i readFile dopisują źródła ze wspólną numeracją [n]', async () => {
    const out = await AG.exec('codeSearch', { query: 'reducer state', k: 2 }, ctx);
    assert.match(out, /^\[1\] /);
    const n0 = ctx.sources.length;
    const rf = await AG.exec('readFile', { path: 'src/app.js', start: 1, end: 2 }, ctx);
    assert.ok(rf.startsWith('[' + (n0 + 1) + '] src/app.js:1-2'));
    assert.equal(ctx.sources[ctx.sources.length - 1].path, 'src/app.js');
  });
});

describe('pętla agenta', () => {
  test('natywnie: narzędzie → wynik jako rola tool → odpowiedź; kroki i źródła', async () => {
    const g = build(); const m = scripted([
      { content: '', tool_calls: [{ function: { name: 'codeSearch', arguments: { query: 'reducer' } } }] },
      { content: 'Reducer jest w `src/store/reducer.js` [1].' },
    ]);
    const r = await AG.run({ chat: m.chat, messages: [{ role: 'user', content: 'gdzie jest reducer?' }], ctx: { graph: g, rag: fakeRag(g) } });
    assert.equal(r.answer, 'Reducer jest w `src/store/reducer.js` [1].');
    assert.equal(r.native, true);
    assert.deepEqual(host(r.steps.map((s) => [s.name, s.ok])), [['codeSearch', true]]);
    assert.ok(r.sources.length >= 1);
    const second = m.seen[1].msgs; assert.equal(second[second.length - 1].role, 'tool');
    assert.equal(second[second.length - 1].tool_name, 'codeSearch');
  });
  test('JSON w treści: wynik wraca jako wiadomość user; powtórzone wywołanie nie jest wykonywane drugi raz', async () => {
    const g = build(); const call = { content: '{"name":"dependents","arguments":{"path":"src/lib/util.js"}}' };
    const m = scripted([call, call, { content: 'Importują go app.js i index.js.' }]);
    const r = await AG.run({ chat: m.chat, messages: [{ role: 'user', content: 'kto importuje util?' }], ctx: { graph: g } });
    assert.equal(r.native, false);
    assert.equal(r.steps.length, 1, 'duplikat pominięty');
    assert.match(m.seen[1].msgs[m.seen[1].msgs.length - 1].content, /^Tool result \(dependents\):/);
    assert.equal(r.answer, 'Importują go app.js i index.js.');
  });
  test('model bez narzędzi odpowiada od razu; limit kroków wymusza odpowiedź bez narzędzi', async () => {
    const g = build();
    const direct = await AG.run({ chat: scripted([{ content: 'Od razu.' }]).chat, messages: [{ role: 'user', content: 'x' }], ctx: { graph: g } });
    assert.deepEqual(host([direct.answer, direct.steps.length]), ['Od razu.', 0]);
    let n = 0; const loop = scripted([]);
    const chat = async (msgs, tools) => { loop.seen.push(!!tools); n++; return tools ? { content: '', tool_calls: [{ function: { name: 'findFiles', arguments: { query: 'q' + n } } }] } : { content: 'Koniec.' }; };
    const r = await AG.run({ chat, messages: [{ role: 'user', content: 'x' }], ctx: { graph: g }, maxSteps: 3 });
    assert.equal(r.answer, 'Koniec.'); assert.equal(r.steps.length, 3);
    assert.deepEqual(host(loop.seen), [true, true, true, false]);
  });
  test('błąd narzędzia nie przerywa pętli — model dostaje „error: …"', async () => {
    const g = build(); const m = scripted([{ content: '', tool_calls: [{ function: { name: 'readFile', arguments: { path: 'brak.js' } } }] }, { content: 'Nie ma takiego pliku.' }]);
    const r = await AG.run({ chat: m.chat, messages: [{ role: 'user', content: 'x' }], ctx: { graph: g } });
    assert.equal(r.steps[0].ok, false);
    assert.match(m.seen[1].msgs[m.seen[1].msgs.length - 1].content, /^error: file not found/);
    assert.equal(r.answer, 'Nie ma takiego pliku.');
  });
});

describe('pętla agenta — wymyślone narzędzie', () => {
  test('JSON wywołania nieznanego narzędzia nie jest odpowiedzią: model dostaje listę narzędzi i odpowiada tekstem', async () => {
    const g = build(); const m = scripted([{ content: '{"name": "ensure", "parameters": {"graph": "x"}}' }, { content: 'ensure() buduje indeks fragmentów [1].' }]);
    const r = await AG.run({ chat: m.chat, messages: [{ role: 'user', content: 'co robi ensure?' }], ctx: { graph: g } });
    assert.equal(r.answer, 'ensure() buduje indeks fragmentów [1].');
    assert.equal(r.steps[0].ok, false);
    assert.match(m.seen[1].msgs[m.seen[1].msgs.length - 1].content, /There is no tool named "ensure"/);
  });
});

describe('pętla agenta — ponaglenie zamiast wymówki', () => {
  test('„would need to inspect agent.js" → jedno ponaglenie, potem narzędzie i właściwa odpowiedź', async () => {
    const g = build(); const m = scripted([
      { content: 'To get a precise answer, we would need to inspect the reducer file.' },
      { content: '', tool_calls: [{ function: { name: 'readFile', arguments: { path: 'src/store/reducer.js' } } }] },
      { content: 'Reducer zwraca stan bez zmian [1].' }]);
    const r = await AG.run({ chat: m.chat, messages: [{ role: 'user', content: 'co robi reducer?' }], ctx: { graph: g } });
    assert.equal(r.answer, 'Reducer zwraca stan bez zmian [1].');
    assert.deepEqual(host(r.steps.map((s) => s.name)), ['readFile']);
    assert.match(m.seen[1].msgs[m.seen[1].msgs.length - 1].content, /Do not guess/);
  });
});

describe('narzędzia owners / tests (bez zmian w widoku)', () => {
  const T0 = Date.UTC(2026, 0, 1), D = 86400000;
  const ala = { name: 'Ala Kowalska', email: 'ala@firma.pl' }, bob = { name: 'Bob', email: 'bob@firma.pl' };
  const commit = (i, author, files) => ({ sha: 'c' + i, parents: i ? ['c' + (i - 1)] : [], author, authorTime: T0 + i * D, time: T0 + i * D, message: 'c' + i, files });
  test('owners: projekt (autorzy, bus factor), plik (udziały), folder; bez historii git → komunikat', async () => {
    const g = build(), ctx = { graph: g, sources: [], gitCore: CM.GitCore };
    assert.match(await AG.exec('owners', {}, ctx), /^no git history/);
    const cs = [commit(0, ala, [{ path: 'src/lib/util.js', status: 'A' }, { path: 'src/index.js', status: 'A' }]),
      commit(1, bob, [{ path: 'src/lib/util.js', status: 'M' }]), commit(2, ala, [{ path: 'src/lib/util.js', status: 'M' }])].reverse();   // analyze: od najnowszego
    CM.GitCore.applyToGraph(g, CM.GitCore.analyze(cs, [...g.nodes.values()].filter((n) => n.type === 'file').map((n) => n.path)), { source: 'local' });
    const all = await AG.exec('owners', {}, ctx);
    assert.match(all, /^authors \(commits · files owned\): Ala Kowalska 2 · \d+, Bob 1/);
    assert.match(all, /\nbus factor: \d/);
    assert.equal(await AG.exec('owners', { path: 'util.js' }, ctx), 'src/lib/util.js — 3 changes: Ala Kowalska 67%, Bob 33%');
    assert.match(await AG.exec('owners', { path: 'src/' }, ctx), /^src\/ — 2 files, 4 changes: Ala Kowalska 75%, Bob 25%/);
    await assert.rejects(AG.exec('owners', { path: 'nie/ma' }, ctx), /not found/);
  });
  test('tests: podsumowanie z najbardziej złożonymi bez testów, plik testowany / nietestowany, plik testu', async () => {
    const extra = [{ path: 'test/reducer.test.js', content: "import reducer from '../src/store/reducer.js';\ntest('x', () => reducer());\n", size: 80, mtime: 1700000000000 }];
    const g = new CM.Graph.Graph().build(FILES.map((f) => ({ ...f })).concat(extra), META), ctx = { graph: g, sources: [], testMap: CM.TestMap };
    const sum = await AG.exec('tests', {}, ctx);
    assert.match(sum, /^1 test files; 1 of \d+ code files have tests/);
    assert.match(sum, /\nmost complex untested: /);
    assert.ok(!/reducer\.js/.test(sum.split('\n')[1]), 'testowany plik nie jest na liście bez testów');
    assert.equal(await AG.exec('tests', { path: 'src/store/reducer.js' }, ctx), 'src/store/reducer.js is tested by: test/reducer.test.js');
    assert.equal(await AG.exec('tests', { path: 'src/app.js' }, ctx), 'src/app.js has no tests');
    assert.equal(await AG.exec('tests', { path: 'reducer.test.js' }, ctx), 'test/reducer.test.js tests: src/store/reducer.js');
    assert.match(await AG.exec('tests', { path: 'src/store' }, ctx), /^src\/store\/: 0 test files, 1 of 2 code files tested\nuntested, most complex first: src\/store\/index\.js \(complexity \d+\)$/);
    assert.equal(await AG.exec('tests', {}, { graph: build(), sources: [], testMap: CM.TestMap }), 'no test files found in the project');
  });
});
