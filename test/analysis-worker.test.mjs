import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadCM, runFile, host } from './harness.mjs';
import { FILES } from './fixtures/sample-project.mjs';

/** Worker analizy w kontekście vm: importScripts = uruchomienie plików z js/, setTimeout = kolejka. */
function loadAnalysisWorker() {
  const queue = []; const posted = [];
  const g = {
    console, performance, Math, JSON,
    postMessage: (m) => posted.push(m),
    setTimeout: (fn) => { queue.push(fn); return queue.length; },
    clearTimeout: () => {},
    importScripts: (...names) => { for (const n of names) runFile(ctx, 'js/' + n); },
  };
  g.self = g;
  const ctx = vm.createContext(g);
  runFile(ctx, 'js/analysis-worker.js');
  const send = (data) => ctx.onmessage({ data });
  const drain = (max = 10000) => { let n = 0; while (queue.length && n++ < max) queue.shift()(); return n; };
  return { ctx, posted, send, drain };
}

describe('analyzeFile (jeden przebieg stripNonCode)', () => {
  const A = loadCM().Analysis;
  test('daje te same metryki, importy i symbole co osobne wywołania', () => {
    for (const f of FILES) {
      if (f.content == null) continue;
      const key = f.path.split('.').pop();
      const r = A.analyzeFile(f.content, key);
      assert.deepEqual(host(r.metrics), host(A.analyzeContent(f.content, key)), f.path + ' metrics');
      assert.deepEqual(host(r.deps), host(A.extractDeps(f.content, key)), f.path + ' deps');
      assert.deepEqual(host(r.symbols), host(A.extractSymbols(f.content, key)), f.path + ' symbols');
    }
  });
  test('null → puste wyniki', () => {
    assert.deepEqual(host(A.analyzeFile(null, 'js')), { metrics: null, deps: [], symbols: [] });
  });
});

describe('analysis-worker', () => {
  test('analizuje pliki chunkami, raportuje postęp i zwraca wyniki per plik', () => {
    const w = loadAnalysisWorker();
    w.send({ type: 'analyze', gen: 7, files: FILES.map((f) => ({ path: f.path, content: f.content })) });
    w.drain();
    const progress = w.posted.filter((m) => m.type === 'progress');
    const done = w.posted.find((m) => m.type === 'done');
    assert.ok(progress.length >= 1 && progress.every((m) => m.gen === 7));
    assert.equal(progress[progress.length - 1].done, FILES.length);
    assert.ok(done && done.gen === 7);
    const textFiles = FILES.filter((f) => f.content != null).length;
    assert.equal(done.results.length, textFiles, 'one result per text file; binaries skipped');
    const idx = done.results.find((r) => r.path === 'src/index.js');
    assert.ok(idx && !idx.error);
    assert.equal(idx.metrics.lines, 9);
    assert.ok(idx.deps.some((d) => d.spec === './app'));
    assert.ok(idx.symbols.some((s) => s.name === 'main'));
    assert.match(idx.hash, /^[0-9a-f]+$/);
    assert.ok(!('content' in idx), 'results never echo file content back');
  });
  test('wyniki workera są identyczne z analizą na głównym wątku', () => {
    const A = loadCM().Analysis;
    const w = loadAnalysisWorker();
    w.send({ type: 'analyze', gen: 1, files: FILES.map((f) => ({ path: f.path, content: f.content })) });
    w.drain();
    const done = w.posted.find((m) => m.type === 'done');
    for (const r of done.results) {
      const f = FILES.find((x) => x.path === r.path);
      const key = r.path.split('.').pop();
      const m = A.analyzeFile(f.content, key);
      assert.deepEqual(host(r.deps), host(m.deps), r.path);
      assert.deepEqual(host(r.symbols), host(m.symbols), r.path);
    }
  });
  test('nowa generacja porzuca poprzednie zadanie bez komunikatu done', () => {
    const w = loadAnalysisWorker();
    const many = []; for (let i = 0; i < 60; i++) many.push({ path: `f${i}.js`, content: 'export const a' + i + ' = 1;\n' });
    w.send({ type: 'analyze', gen: 1, files: many });
    w.drain(1);                     // tylko pierwszy chunk
    w.send({ type: 'cancel', gen: 2 });
    w.drain();
    assert.ok(!w.posted.some((m) => m.type === 'done' && m.gen === 1), 'cancelled job never completes');
    w.send({ type: 'analyze', gen: 3, files: many.slice(0, 5) });
    w.drain();
    assert.ok(w.posted.some((m) => m.type === 'done' && m.gen === 3 && m.results.length === 5));
  });
});
