import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, memStorage } from './harness.mjs';

// Lokalne modele WebLLM (js/localai.js) bez WebGPU i bez silnika: wybór dostawcy i modelu (z naprawą starych id),
// czytelne nazwy, budżet promptu (_clampMsgs), zachowanie bez GPU oraz sprzątanie pobranych wag (Cache Storage).
function load(extra = {}) {
  const ls = extra.localStorage || memStorage();
  const CM = loadCM(['util', 'i18n', 'localai'], { localStorage: ls, ...extra });
  return { LA: CM.LocalAI, ls };
}

describe('dostawca i model', () => {
  test('provider: mistral domyślnie, local / ollama rozpoznane, śmieci → mistral', () => {
    const { LA, ls } = load();
    assert.equal(LA.provider(), 'mistral');
    LA.setProvider('local'); assert.equal(LA.provider(), 'local');
    LA.setProvider('ollama'); assert.equal(LA.provider(), 'ollama');
    LA.setProvider('openai'); assert.equal(ls.getItem('codemap_ai_provider'), 'mistral');
  });
  test('modelId: nieznany zapisany id (usunięty z listy) → domyślny i zapis naprawy; wybór spoza listy zapamiętany jako dodatkowy', () => {
    const ls = memStorage(); ls.setItem('codemap_local_model', 'DeepSeek-R1-Distill-Qwen-1.5B-q4f16_1-MLC');
    const { LA } = load({ localStorage: ls });
    assert.equal(LA.modelId(), 'Llama-3.2-1B-Instruct-q4f16_1-MLC');
    assert.equal(ls.getItem('codemap_local_model'), 'Llama-3.2-1B-Instruct-q4f16_1-MLC');
    LA.setModel('Phi-4-mini-instruct-q4f16_1-MLC');
    assert.equal(LA.modelId(), 'Phi-4-mini-instruct-q4f16_1-MLC', 'id z pełnej listy silnika jest znany');
    assert.deepEqual(JSON.parse(ls.getItem('codemap_local_models_extra')), ['Phi-4-mini-instruct-q4f16_1-MLC']);
    LA.setModel(LA.MODELS[0].id);
    assert.equal(JSON.parse(ls.getItem('codemap_local_models_extra')).length, 1, 'model z listy nie trafia do dodatkowych');
  });
  test('lista dodatkowych modeli ograniczona do 20 ostatnich', () => {
    const { LA, ls } = load();
    for (let i = 0; i < 25; i++) LA.setModel('Extra-' + i + '-q4f16_1-MLC');
    const extra = JSON.parse(ls.getItem('codemap_local_models_extra'));
    assert.equal(extra.length, 20); assert.equal(extra[0], 'Extra-5-q4f16_1-MLC');
  });
  test('etykiety: z listy, czytelne z id silnika, krótkie; modele myślące po liście albo po nazwie', () => {
    const { LA } = load();
    assert.equal(LA.label('Llama-3.2-1B-Instruct-q4f16_1-MLC'), 'Llama 3.2 · 1B  (~880 MB — polecany na start)');
    assert.equal(LA.label('Qwen2.5-3B-Instruct-q4f32_1-MLC-1k'), 'Qwen2.5 3B Instruct (q4f32) [1k ctx]');
    assert.equal(LA.label('Qwen3-4B-q4f16_1-MLC'), 'Qwen3 4B (q4f16)');
    assert.equal(LA.shortLabel('Llama-3.2-1B-Instruct-q4f16_1-MLC'), 'Llama 3.2 1B');
    assert.equal(LA.isThinking('DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC'), true);
    assert.equal(LA.isThinking('Qwen2.5-7B-Instruct-q4f16_1-MLC'), false);
    assert.equal(LA.isThinking('Some-Reasoning-8B-MLC'), true);
    assert.equal(new Set(LA.MODELS.map((m) => m.id)).size, LA.MODELS.length);
  });
});

describe('_clampMsgs: budżet znaków promptu', () => {
  const { LA } = load();
  const msg = (role, n, ch = 'x') => ({ role, content: ch.repeat(n) });
  test('mieści się → bez zmian (kopie, content jako tekst)', () => {
    const out = host(LA._clampMsgs([{ role: 'user', content: 5 }], 100));
    assert.deepEqual(out, [{ role: 'user', content: '5' }]);
  });
  test('wycina najstarsze środkowe wiadomości, zachowuje system i ostatnią', () => {
    const out = host(LA._clampMsgs([msg('system', 100, 's'), msg('user', 400, 'a'), msg('assistant', 400, 'b'), msg('user', 100, 'q')], 700));
    assert.deepEqual(out.map((m) => [m.role, m.content[0], m.content.length]), [['system', 's', 100], ['assistant', 'b', 400], ['user', 'q', 100]]);
  });
  test('nadal za dużo → przycięta największa wiadomość z „…"; łączna długość w budżecie', () => {
    const out = host(LA._clampMsgs([msg('system', 100), msg('user', 5000)], 1000));
    assert.equal(out[1].content.length, 899 + 1);
    assert.ok(out[1].content.endsWith('…'));
    assert.ok(out.reduce((s, m) => s + m.content.length, 0) <= 1000);
    const tiny = host(LA._clampMsgs([msg('user', 5000), msg('user', 5000)], 100));
    assert.ok(tiny.some((m) => m.content.length === 37 && m.content.endsWith('…')), 'ujemne cięcie → budżet − 64');
  });
});

describe('bez WebGPU / silnika', () => {
  test('hasWebGPU false, status unloaded, busy false; chat i embed → komunikat o WebGPU; embeddingModels → []', async () => {
    const { LA } = load();
    assert.equal(LA.hasWebGPU(), false); assert.equal(LA.status(), 'unloaded'); assert.equal(LA.busy(), false);
    await assert.rejects(LA.chat([{ role: 'user', content: 'x' }]), /nie obsługuje WebGPU/);
    await assert.rejects(LA.embed(['a'], { model: 'webllm:x' }), /nie obsługuje WebGPU/);
    assert.deepEqual(host(await LA.embeddingModels()), []);
    assert.equal(LA.loadedId(), null);
    assert.equal(LA.busy(), false, 'po nieudanym czacie kolejka wolna');
  });
  test('przerwany sygnał przed startem → AbortError od razu (bez dotykania silnika)', async () => {
    const { LA } = load({ navigator: { gpu: {}, language: 'pl' } });
    const ac = new AbortController(); ac.abort();
    await assert.rejects(LA.chat([], { signal: ac.signal }), (e) => e.name === 'AbortError');
  });
  test('onProgress: odpięcie słuchacza; progress() startowo pusty', () => {
    const { LA } = load();
    const off = LA.onProgress(() => {});
    assert.equal(typeof off, 'function'); off();
    assert.deepEqual(host(LA.progress()), { text: '', pct: 0 });
  });
  test('deleteDownloads / downloadedInfo: tylko cache webllm/mlc', async () => {
    const store = new Map([['webllm/model', ['a', 'b']], ['webllm/wasm', ['c']], ['mlc-cache', []], ['app-shell', ['x']]]);
    const caches = { keys: async () => [...store.keys()], open: async (k) => ({ keys: async () => store.get(k) }), delete: async (k) => store.delete(k) };
    const { LA } = load({ caches });
    assert.deepEqual(host(await LA.downloadedInfo()), { caches: 3, entries: 3 });
    assert.equal(await LA.deleteDownloads(), 3);
    assert.deepEqual([...store.keys()], ['app-shell']);
    assert.equal(await LA.deleteModel(''), false);
  });
});
