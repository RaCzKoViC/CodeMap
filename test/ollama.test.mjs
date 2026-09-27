import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, memStorage } from './harness.mjs';

// Lokalna Ollama (js/ollama.js) na podstawionym fetch: lista modeli (bez embeddingów, naprawa wyboru), czat
// NDJSON z rozumowaniem jako <think>, narzędzia agenta, embeddingi z przejściem na stare API, pobieranie modelu.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const ndjson = (chunks) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const x of chunks) c.enqueue(e.encode(x)); c.close(); } }), { status: 200 });
function load(route, ls = memStorage()) {
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, body: init.body ? JSON.parse(init.body) : null }); return route(url, init); };
  const CM = loadCM(['util', 'i18n', 'ollama'], { fetch, localStorage: ls, AbortSignal });
  return { O: CM.Ollama, calls, ls };
}
const TAGS = { models: [
  { name: 'qwen2.5:7b', size: 4.7 * 1073741824, details: { family: 'qwen2' } }, { name: 'bge-m3', size: 1.2e9, details: { family: 'bert' } },
  { name: 'nomic-embed-text', details: { family: 'nomic-bert' } }, { name: 'llama3.2:3b', size: 2 * 1073741824 }, { name: 'mxbai-embed-large' }] };

describe('adres i model', () => {
  test('domyślny adres, własny bez ukośników na końcu, pusty → domyślny', () => {
    const { O } = load(() => json({}));
    assert.equal(O.base(), 'http://localhost:11434');
    O.setBase('  http://gpu-box:11434///  ');
    assert.equal(O.base(), 'http://gpu-box:11434');
    O.setBase('');
    assert.equal(O.base(), O.DEF_BASE);
  });
});

describe('models / embeddingModels', () => {
  test('lista czatu bez modeli embeddingów, alfabetycznie, rozmiar w GB; zapamiętany usunięty model → pierwszy z listy', async () => {
    const ls = memStorage(); ls.setItem('codemap_ollama_model', 'usuniety:1b');
    const { O, calls } = load(() => json(TAGS), ls);
    const m = host(await O.models());
    assert.deepEqual(m, [{ name: 'llama3.2:3b', sizeGB: '2.0' }, { name: 'qwen2.5:7b', sizeGB: '4.7' }]);
    assert.equal(O.model(), 'llama3.2:3b');
    await O.models();
    assert.equal(calls.length, 1, 'lista z pamięci podręcznej');
    assert.equal(O.modelSizeGB('qwen2.5:7b'), 4.7); assert.equal(O.modelSizeGB('nie-ma'), null);
    assert.deepEqual(host((await O.embeddingModels()).map((x) => x.name)), ['bge-m3', 'mxbai-embed-large', 'nomic-embed-text']);
  });
  test('serwer wyłączony → czytelny komunikat z adresem; online() = false; HTTP 500 → błąd', async () => {
    const { O } = load(() => { throw new TypeError('fetch failed'); });
    await assert.rejects(O.models(true), /Ollama nie odpowiada pod http:\/\/localhost:11434/);
    assert.equal(await O.online(), false);
    const bad = load(() => json({}, 500));
    await assert.rejects(bad.O.models(true), /Ollama: HTTP 500/);
  });
});

describe('chat', () => {
  test('bez strumienia: body z opcjami (temperatura, num_predict, format, repeat_penalty, think:false); rozumowanie w <think>', async () => {
    const { O, calls } = load(() => json({ message: { content: 'Wynik', thinking: 'myślę' } }));
    O.setModel('qwen3:8b');
    const r = await O.chat([{ role: 'user', content: 7 }], { maxTokens: 64, format: 'json', repeatPenalty: 1.1, think: false, temperature: 0 });
    assert.equal(r, '<think>myślę</think>Wynik');
    assert.deepEqual(host(calls[0].body), { model: 'qwen3:8b', messages: [{ role: 'user', content: '7' }], stream: false,
      options: { temperature: 0, num_predict: 64, repeat_penalty: 1.1 }, format: 'json', think: false });
  });
  test('strumień NDJSON: myśli → <think>…</think>, linie pocięte między paczkami, ostatnia linia bez \\n też liczona', async () => {
    const { O } = load(() => ndjson(['{"message":{"thinking":"a"}}\n{"message":{"thin', 'king":"b"}}\n{"message":{"content":"X"}}\n', 'śmieci\n', '{"message":{"content":"Y"},"done":false}']));
    O.setModel('m');
    const toks = [];
    const full = await O.chat([{ role: 'user', content: 'q' }], { onToken: (d) => toks.push(d) });
    assert.equal(full, '<think>ab</think>XY');
    assert.deepEqual(toks, ['<think>a', 'b', '</think>X', 'Y']);
  });
  test('done przy otwartym <think> domyka znacznik; błąd w strumieniu → wyjątek; brak modelu → komunikat', async () => {
    const { O } = load(() => ndjson(['{"message":{"thinking":"t"}}\n{"done":true}\n{"message":{"content":"po końcu"}}\n']));
    O.setModel('m');
    assert.equal(await O.chat([], { onToken() {} }), '<think>t</think>');
    const err = load(() => ndjson(['{"error":"model not found"}\n']));
    err.O.setModel('m');
    await assert.rejects(err.O.chat([], { onToken() {} }), /Ollama: model not found/);
    await assert.rejects(load(() => json({})).O.chat([]), /Nie wybrano modelu Ollamy/);
    const http = load(() => json({ error: 'out of memory' }, 500)); http.O.setModel('m');
    await assert.rejects(http.O.chat([]), /Ollama: out of memory/);
  });
  test('AbortError przechodzi bez zamiany na „serwer wyłączony"', async () => {
    const { O } = load(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    O.setModel('m');
    await assert.rejects(O.chat([]), (e) => e.name === 'AbortError');
  });
});

describe('chatTools (agent)', () => {
  test('wiadomości narzędzi zachowują tool_calls / tool_name; odpowiedź z wywołaniami narzędzi', async () => {
    const { O, calls } = load(() => json({ message: { content: '', tool_calls: [{ function: { name: 'stats', arguments: {} } }], thinking: 'hm' } }));
    O.setModel('llama3.1:8b');
    const msgs = [{ role: 'user', content: 'ile plików?' }, { role: 'assistant', content: '', tool_calls: [{ id: 1 }] }, { role: 'tool', content: '42', tool_name: 'stats' }];
    const r = host(await O.chatTools(msgs, [{ type: 'function' }], { think: false }));
    assert.deepEqual(r, { content: '', tool_calls: [{ function: { name: 'stats', arguments: {} } }], thinking: 'hm' });
    const b = calls[0].body;
    assert.equal(b.stream, false); assert.equal(b.think, false); assert.equal(b.options.temperature, 0.2);
    assert.deepEqual(host(b.messages[1].tool_calls), [{ id: 1 }]); assert.equal(b.messages[2].tool_name, 'stats');
    assert.equal(b.tools.length, 1);
  });
  test('model bez narzędzi → błąd z code „notools"', async () => {
    const { O } = load(() => new Response('registry.ollama.ai/library/gemma2 does not support tools', { status: 400 }));
    O.setModel('gemma2');
    await assert.rejects(O.chatTools([], []), (e) => e.code === 'notools' && /HTTP 400/.test(e.message));
  });
});

describe('embed i pull', () => {
  test('/api/embed wsadowo; 404 → przejście na /api/embeddings (zapamiętane); inny błąd HTTP → wyjątek', async () => {
    const { O, calls } = load((url, init) => {
      if (url.endsWith('/api/embed')) return json({}, 404);
      return json({ embedding: [JSON.parse(init.body).prompt.length] });
    });
    assert.deepEqual(host(await O.embed(['a', 'bbb'], { model: 'bge-m3' })), [[1], [3]]);
    await O.embed(['cc'], { model: 'bge-m3' });
    assert.deepEqual(host(calls.map((c) => c.url.replace('http://localhost:11434', ''))), ['/api/embed', '/api/embeddings', '/api/embeddings', '/api/embeddings']);
    const ok = load(() => json({ embeddings: [[1, 2], [3, 4]] }));
    assert.deepEqual(host(await ok.O.embed(['x', 'y'], { model: 'm' })), [[1, 2], [3, 4]]);
    assert.equal(ok.calls[0].body.truncate, true);
    await assert.rejects(ok.O.embed(['x'], {}), /embed: model/);
    const bad = load(() => new Response('boom', { status: 500 }));
    await assert.rejects(bad.O.embed(['x'], { model: 'm' }), /Ollama embed: HTTP 500 boom/);
  });
  test('pull: postęp w % z NDJSON, po sukcesie lista modeli odświeżona; błąd w strumieniu → wyjątek', async () => {
    const { O, calls } = load((url) => url.endsWith('/api/tags') ? json(TAGS)
      : ndjson(['{"status":"pulling","total":200,"completed":50}\n', '{"status":"pulling","total":200,"completed":200}\n{"status":"success"}\n']));
    const prog = [];
    const last = host(await O.pull(' qwen2.5:3b ', (p) => prog.push([p.status, p.pct])));
    assert.deepEqual(last, { status: 'success' });
    assert.deepEqual(prog, [['pulling', 25], ['pulling', 100], ['success', null]]);
    assert.deepEqual(host(calls[0].body), { model: 'qwen2.5:3b', stream: true });
    assert.ok(calls.at(-1).url.endsWith('/api/tags'));
    await assert.rejects(O.pull('  '), /model/);
    const bad = load(() => ndjson(['{"error":"pull model manifest: file does not exist"}\n']));
    await assert.rejects(bad.O.pull('x'), /file does not exist/);
  });
  test('SUGGESTED: unikalne nazwy z rozmiarem', () => {
    const { O } = load(() => json({}));
    assert.equal(new Set(O.SUGGESTED.map((s) => s.name)).size, O.SUGGESTED.length);
    for (const s of O.SUGGESTED) assert.match(s.size, /^\d+(\.\d)? GB$/);
  });
});

describe('niedostępna Ollama: blokada CORS a wyłączony serwer', () => {
  const loadAt = (route, origin) => {
    const fetch = async (url, init = {}) => route(url, init);
    const CM = loadCM(['util', 'i18n', 'ollama'], { fetch, localStorage: memStorage(), AbortSignal, location: { origin } });
    return CM.Ollama;
  };
  test('fetch pada, a zapytanie no-cors przechodzi → CORS z poleceniami OLLAMA_ORIGINS dla originu strony', async () => {
    const modes = [];
    const O = loadAt((url, init) => { modes.push(init.mode || 'cors'); if (init.mode === 'no-cors') return new Response(null, { status: 200 }); throw new TypeError('Failed to fetch'); }, 'https://raczkovic.github.io');
    const e = await O.models(true).then(() => null, (x) => x);
    assert.equal(e.code, 'cors');
    assert.match(e.message, /CORS/);
    assert.match(e.hint, /setx OLLAMA_ORIGINS "https:\/\/raczkovic\.github\.io"/);
    assert.match(e.hint, /launchctl setenv OLLAMA_ORIGINS/);
    assert.match(e.hint, /Environment="OLLAMA_ORIGINS=https:\/\/raczkovic\.github\.io"/);
    assert.deepEqual(modes, ['cors', 'no-cors']);
    const st = await O.check();
    assert.equal(st.ok, false); assert.equal(st.code, 'cors'); assert.ok(st.hint);
  });
  test('oba zapytania padają → serwer wyłączony (bez instrukcji CORS); przekroczony czas → wyłączony bez sondy', async () => {
    const O = loadAt(() => { throw new TypeError('Failed to fetch'); }, 'http://localhost:8787');
    const e = await O.models(true).then(() => null, (x) => x);
    assert.equal(e.code, 'offline'); assert.match(e.message, /ollama serve/); assert.doesNotMatch(e.message, /OLLAMA_ORIGINS/);
    let probes = 0;
    const T = loadAt((url, init) => { if (init.mode === 'no-cors') { probes++; return new Response(null); } throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, 'http://localhost:8787');
    assert.equal((await T.models(true).then(() => null, (x) => x)).code, 'offline');
    assert.equal(probes, 0);
  });
  test('strona z internetu, przeglądarka odmówiła dostępu do sieci lokalnej → „blocked" (bez sondy); strona lokalna — bez pytania', async () => {
    const at = (origin, states, baseUrl) => {
      const asked = []; let probes = 0;
      const fetch = async (url, init = {}) => { if (init.mode === 'no-cors') { probes++; throw new TypeError('Failed to fetch'); } throw new TypeError('Failed to fetch'); };
      const permissions = { query: async ({ name }) => { asked.push(name); if (!(name in states)) throw new TypeError('bad name'); return { state: states[name] }; } };
      const CM = loadCM(['util', 'i18n', 'ollama'], { fetch, localStorage: memStorage(), AbortSignal, location: { origin }, navigator: { permissions } });
      if (baseUrl) CM.Ollama.setBase(baseUrl);
      return { O: CM.Ollama, asked, probes: () => probes };
    };
    const a = at('https://raczkovic.github.io', { 'loopback-network': 'denied' });
    const e = await a.O.models(true).then(() => null, (x) => x);
    assert.equal(e.code, 'blocked'); assert.match(e.message, /sieci lokalnej/); assert.doesNotMatch(e.message, /OLLAMA_ORIGINS/);
    assert.deepEqual(a.asked, ['loopback-network']); assert.equal(a.probes(), 0);
    const old = at('https://raczkovic.github.io', { 'local-network-access': 'denied' });   // starszy Chrome: tylko ogólna nazwa
    assert.equal((await old.O.check()).code, 'blocked'); assert.deepEqual(old.asked, ['loopback-network', 'local-network-access']);
    const lan = at('https://raczkovic.github.io', { 'local-network': 'denied' }, 'http://192.168.1.20:11434');
    assert.equal((await lan.O.check()).code, 'blocked'); assert.deepEqual(lan.asked, ['local-network']);
    const granted = at('https://raczkovic.github.io', { 'loopback-network': 'granted' });
    assert.equal((await granted.O.check()).code, 'offline'); assert.equal(granted.probes(), 1);
    const local = at('http://localhost:8787', { 'loopback-network': 'denied' });   // strona z localhost → Ollama bez zgody
    assert.equal((await local.O.check()).code, 'offline'); assert.deepEqual(local.asked, []);
    const lanPage = at('http://192.168.1.5:8080', { 'local-network': 'denied' }, 'http://192.168.1.20:11434');
    assert.equal((await lanPage.O.check()).code, 'offline'); assert.deepEqual(lanPage.asked, []);
  });
  test('czat i pobieranie modelu też rozróżniają CORS; przerwanie (AbortError) przechodzi bez zmian', async () => {
    const O = loadAt((url, init) => { if (init.mode === 'no-cors') return new Response(null); if (init.signal && init.signal.aborted) throw Object.assign(new Error('a'), { name: 'AbortError' }); throw new TypeError('Failed to fetch'); }, 'null');   // strona otwarta z dysku ma origin "null"
    O.setModel('x');
    const e = await O.chat([{ role: 'user', content: 'hi' }], {}).then(() => null, (x) => x);
    assert.equal(e.code, 'cors'); assert.match(e.hint, /OLLAMA_ORIGINS "\*"/);   // strona z dysku → dowolny origin
    assert.equal((await O.pull('m', () => {}).then(() => null, (x) => x)).code, 'cors');
    const ac = new AbortController(); ac.abort();
    assert.equal((await O.chat([{ role: 'user', content: 'hi' }], { signal: ac.signal }).then(() => null, (x) => x)).name, 'AbortError');
  });
});
