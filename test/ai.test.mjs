import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, memStorage } from './harness.mjs';

// Dostawcy AI z kluczem (js/ai.js) na podstawionym fetch: rozpoznawanie klucza, magazyn i migracja, test klucza
// (lista modeli), czat w 3 stylach API (OpenAI / Anthropic / Gemini) z SSE, rotacja kluczy i komunikaty błędów.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const sse = (chunks) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const x of chunks) c.enqueue(e.encode(x)); c.close(); } }), { status: 200 });
function load(route = () => json({}, 404), ls = memStorage()) {
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return route(url, init); };
  const CM = loadCM(['util', 'i18n', 'ai'], { fetch, localStorage: ls, Response });
  return { AI: CM.AI, calls, ls };
}
const KEYS = { anthropic: 'sk-ant-api03-abcdef', openrouter: 'sk-or-v1-abc', gemini: 'AIza' + 'B'.repeat(35), groq: 'gsk_abc', xai: 'xai-abc',
  openai: 'sk-proj-' + 'a'.repeat(24), mistral: 'A'.repeat(32), together: 'f'.repeat(64) };

describe('rozpoznawanie klucza i maskowanie', () => {
  test('format klucza → dostawca; klucz sk- z 32 hex pasuje do DeepSeek i OpenAI (rozstrzyga test)', () => {
    const { AI } = load();
    for (const [p, k] of Object.entries(KEYS)) assert.equal(AI.detect(k)[0], p, p);
    assert.deepEqual(host(AI.detect('sk-' + 'ab12'.repeat(8))), ['deepseek', 'openai']);
    assert.deepEqual(host(AI.detect('  zupełnie nieznany  ')), []);
    assert.equal(AI.providerName('gemini'), 'Google Gemini'); assert.equal(AI.providerName('x'), 'x');
  });
  test('mask: krótkie klucze w całości kropkami, dłuższe — 4 znaki z każdej strony', () => {
    const { AI } = load();
    assert.equal(AI.mask('abc'), '•••');
    assert.equal(AI.mask('sk-ant-1234567890'), 'sk-a…7890');
  });
});

describe('magazyn kluczy', () => {
  test('migracja 4 slotów Mistrala + pojedynczego klucza (bez duplikatów), z dotychczasowym modelem', () => {
    const ls = memStorage();
    ls.setItem('codemap_mistral_keys', JSON.stringify(['k1', '', 'k2', 'k1']));
    ls.setItem('codemap_mistral_key', 'k2'); ls.setItem('codemap_mistral_model', 'mistral-large-latest');
    const { AI } = load(undefined, ls);
    assert.deepEqual(host(AI.keys().map((k) => [k.key, k.provider, k.model])), [['k1', 'mistral', 'mistral-large-latest'], ['k2', 'mistral', 'mistral-large-latest']]);
    assert.equal(JSON.parse(ls.getItem('codemap_ai_keys')).length, 2);
  });
  test('add / update / remove + lustro dawnych slotów Mistrala; onChange i odpięcie słuchacza', () => {
    const { AI, ls } = load();
    let n = 0; const off = AI.onChange(() => n++);
    const a = AI.add('  ' + KEYS.mistral + '  '), b = AI.add(KEYS.groq);
    assert.equal(a.key, KEYS.mistral); assert.equal(a.provider, 'mistral'); assert.equal(b.provider, 'groq');
    assert.deepEqual(JSON.parse(ls.getItem('codemap_mistral_keys')), [KEYS.mistral, '', '', '']);
    assert.equal(ls.getItem('codemap_mistral_key'), KEYS.mistral);
    AI.update(a.id, { model: 'x' });
    assert.equal(AI.keys().find((k) => k.id === a.id).model, 'x');
    off(); AI.remove(a.id);
    assert.equal(n, 3);
    assert.deepEqual(host(AI.keys().map((k) => k.provider)), ['groq']);
    assert.deepEqual(JSON.parse(ls.getItem('codemap_mistral_keys')), ['', '', '', '']);
  });
  test('usable / primary / hasKey: bez dostawcy i z nieudanym testem odpadają; primary woli przetestowany', () => {
    const ls = memStorage();
    ls.setItem('codemap_ai_keys', JSON.stringify([
      { id: 'u', key: 'zzz', provider: 'nie-ma' }, { id: 'bad', key: 'k', provider: 'groq', status: { ok: false } },
      { id: 'new', key: 'k2', provider: 'openai' }, { id: 'ok', key: 'k3', provider: 'mistral', status: { ok: true } }, 'śmieci']));
    const { AI } = load(undefined, ls);
    assert.deepEqual(host(AI.usable().map((k) => k.id)), ['new', 'ok']);
    assert.equal(AI.primary().id, 'ok'); assert.equal(AI.hasKey(), true);
    assert.equal(AI.modelFor(AI.usable()[0]), 'gpt-4o-mini');
  });
});

describe('test klucza (lista modeli)', () => {
  test('pierwszy kandydat odrzuca (401) → następny przyjmuje; zapis dostawcy, modeli i preferowanego modelu', async () => {
    const { AI, calls } = load((url) => url.startsWith('https://api.deepseek.com') ? json({ error: { message: 'nope' } }, 401)
      : json({ data: [{ id: 'o1' }, { id: 'gpt-4o-mini-2024' }, { id: 'gpt-4o' }] }));
    const e = AI.add('sk-' + 'ab12'.repeat(8));
    const r = await AI.test(e.id);
    assert.equal(r.ok, true); assert.equal(r.provider, 'openai'); assert.equal(r.model, 'gpt-4o-mini-2024');
    assert.deepEqual(host(calls.map((c) => c.url)), ['https://api.deepseek.com/v1/models', 'https://api.openai.com/v1/models']);
    assert.equal(calls[1].init.headers.Authorization, 'Bearer sk-' + 'ab12'.repeat(8));
    const saved = AI.keys()[0];
    assert.equal(saved.provider, 'openai'); assert.equal(saved.status.ok, true); assert.equal(saved.status.count, 3);
  });
  test('Gemini: klucz w adresie, tylko modele z generateContent, bez prefiksu models/', async () => {
    const { AI, calls } = load(() => json({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] }));
    assert.deepEqual(host(await AI.listModels('gemini', 'AIza key')), ['gemini-2.5-flash']);
    assert.match(calls[0].url, /\/models\?pageSize=200&key=AIza%20key$/);
    await assert.rejects(AI.listModels('nie-ma', 'k'), /provider/);
  });
  test('nieznany format → sprawdzani wszyscy dostawcy; błąd sieci → komunikat sieciowy; zapisany status ok:false', async () => {
    const { AI, calls } = load(() => json({ error: { message: 'bad' } }, 401));
    const e = AI.add('???');
    const r = await AI.test(e.id);
    assert.equal(r.ok, false); assert.match(r.error, /^nie rozpoznano dostawcy/);
    assert.equal(calls.length, Object.keys(AI.PROVIDERS).length);
    assert.equal(AI.keys()[0].status.ok, false);
    const net = load(() => { throw new TypeError('Failed to fetch'); });
    const k = net.AI.add(KEYS.groq);
    const r2 = await net.AI.test(k.id);
    assert.equal(r2.error, 'Groq: brak połączenia z API (sieć lub CORS)');
  });
});

describe('czat: 3 style API', () => {
  const entry = (provider, key = 'KEY') => ({ id: 'e', key, provider, model: null });
  test('OpenAI-zgodny bez strumienia: body, format JSON tylko gdy dostawca go wspiera, nagłówki OpenRouter', async () => {
    const { AI, calls } = load(() => json({ choices: [{ message: { content: 'odp' } }] }));
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }];
    assert.equal(await AI.chat(msgs, { entry: entry('groq'), json: true, maxTokens: 50 }), 'odp');
    assert.deepEqual(host(calls[0].body), { model: 'llama-3.3-70b-versatile', messages: msgs, temperature: 0.4, stream: false, max_tokens: 50, response_format: { type: 'json_object' } });
    await AI.chat(msgs, { entry: entry('xai'), json: true });
    assert.equal(calls[1].body.response_format, undefined, 'xAI bez trybu JSON');
    await AI.chat(msgs, { entry: entry('openrouter') });
    assert.equal(calls[2].init.headers['HTTP-Referer'], 'http://localhost'); assert.equal(calls[2].init.headers['X-Title'], 'CodeMap');
  });
  test('OpenAI-zgodny strumień SSE: dane pocięte między paczkami, [DONE] kończy, śmieci pomijane', async () => {
    const { AI } = load(() => sse(['data: {"choices":[{"delta":{"content":"Ala "}}]}\n\nda', 'ta: nie-json\n', 'data: {"choices":[{"delta":{"content":"ma kota"}}]}\n', 'data: [DONE]\n', 'data: {"choices":[{"delta":{"content":"PO"}}]}\n']));
    const toks = [];
    const full = await AI.chat([{ role: 'user', content: 'x' }], { entry: entry('mistral'), onToken: (d, f) => toks.push([d, f]) });
    assert.equal(full, 'Ala ma kota');
    assert.deepEqual(toks, [['Ala ', 'Ala '], ['ma kota', 'Ala ma kota']]);
  });
  test('Anthropic: system osobno, rozmowa zaczyna się od użytkownika, nagłówki; strumień i zdarzenie błędu', async () => {
    let mode = 'json';
    const { AI, calls } = load(() => mode === 'json' ? json({ content: [{ type: 'text', text: 'A' }, { type: 'tool_use' }, { type: 'text', text: 'B' }] })
      : mode === 'sse' ? sse(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\n', 'data: {"type":"message_stop"}\n'])
        : sse(['data: {"type":"error","error":{"message":"overloaded"}}\n']));
    const msgs = [{ role: 'system', content: 'S1' }, { role: 'assistant', content: 'wcześniej' }, { role: 'system', content: 'S2' }, { role: 'user', content: 'Q' }];
    assert.equal(await AI.chat(msgs, { entry: entry('anthropic') }), 'AB');
    const b = calls[0].body;
    assert.equal(b.system, 'S1\n\nS2'); assert.equal(b.max_tokens, 1024); assert.equal(b.model, 'claude-sonnet-4-5');
    assert.deepEqual(host(b.messages.map((m) => m.role)), ['user', 'assistant', 'user']);
    assert.equal(b.messages[0].content, '(start)');
    assert.equal(calls[0].init.headers['x-api-key'], 'KEY'); assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
    mode = 'sse';
    assert.equal(await AI.chat(msgs, { entry: entry('anthropic'), onToken() {} }), 'x');
    mode = 'err';
    await assert.rejects(AI.chat(msgs, { entry: entry('anthropic'), onToken() {} }), /Anthropic \(Claude\): overloaded/);
  });
  test('Gemini: klucz w URL, role user/model, systemInstruction, JSON jako responseMimeType; strumień alt=sse', async () => {
    const { AI, calls } = load((url) => url.includes(':streamGenerateContent') ? sse(['data: {"candidates":[{"content":{"parts":[{"text":"a"},{"text":"b"}]}}]}\n'])
      : json({ candidates: [{ content: { parts: [{ text: 'odp' }] } }] }));
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }];
    assert.equal(await AI.chat(msgs, { entry: entry('gemini', 'K&1'), json: true, maxTokens: 9 }), 'odp');
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=K%261');
    const b = calls[0].body;
    assert.deepEqual(host(b.contents.map((c) => c.role)), ['user', 'model']);
    assert.deepEqual(host(b.systemInstruction), { parts: [{ text: 'S' }] });
    assert.deepEqual(host(b.generationConfig), { temperature: 0.4, maxOutputTokens: 9, responseMimeType: 'application/json' });
    assert.equal(await AI.chat(msgs, { entry: entry('gemini'), onToken() {} }), 'ab');
    assert.match(calls[1].url, /:streamGenerateContent\?alt=sse&key=KEY$/);
  });
  test('błędy: brak klucza, nieznany dostawca, 401 z opisem, 429, inne HTTP z treścią', async () => {
    let status = 401;
    const { AI } = load(() => status === 500 ? new Response('wewnętrzny błąd', { status }) : json({ error: { message: 'Incorrect API key' } }, status));
    await assert.rejects(AI.chat([]), /Brak działającego klucza API/);
    await assert.rejects(AI.chat([], { entry: { key: 'k', provider: 'nie-ma' } }), /nie rozpoznano dostawcy/);
    await assert.rejects(AI.chat([], { entry: entry('openai') }), (e) => e.status === 401 && e.message === 'Nieprawidłowy lub nieaktywny klucz (OpenAI): Incorrect API key');
    status = 429; await assert.rejects(AI.chat([], { entry: entry('openai') }), /OpenAI: przekroczono limit zapytań/);
    status = 500; await assert.rejects(AI.chat([], { entry: entry('openai') }), /OpenAI: HTTP 500 — wewnętrzny błąd/);
  });
});

describe('chatAny: rotacja i przełączanie kluczy', () => {
  test('429 na pierwszym kluczu → następny; kolejne wywołanie zaczyna od następnego w kolejce', async () => {
    const ls = memStorage();
    ls.setItem('codemap_ai_keys', JSON.stringify([{ id: 'a', key: 'KA', provider: 'groq' }, { id: 'b', key: 'KB', provider: 'mistral' }]));
    const { AI, calls } = load((url, init) => init.headers.Authorization === 'Bearer KA' ? json({}, 429) : json({ choices: [{ message: { content: 'z B' } }] }), ls);
    assert.equal(await AI.chatAny([{ role: 'user', content: 'x' }]), 'z B');
    assert.deepEqual(host(calls.map((c) => c.init.headers.Authorization)), ['Bearer KA', 'Bearer KB']);
    await AI.chatAny([{ role: 'user', content: 'y' }]);
    assert.equal(calls[2].init.headers.Authorization, 'Bearer KA', 'po sukcesie B rotacja wraca do A');
  });
  test('błąd nie do obejścia (400) przerywa od razu; brak kluczy → komunikat', async () => {
    const ls = memStorage();
    ls.setItem('codemap_ai_keys', JSON.stringify([{ id: 'a', key: 'KA', provider: 'groq' }, { id: 'b', key: 'KB', provider: 'groq' }]));
    const { AI, calls } = load(() => json({ error: 'bad request' }, 400), ls);
    await assert.rejects(AI.chatAny([]), /Groq: HTTP 400 — bad request/);
    assert.equal(calls.length, 1);
    await assert.rejects(load().AI.chatAny([]), /Brak działającego klucza/);
  });
});
