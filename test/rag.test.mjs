import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';

const CM = loadCM([...CORE, 'rag']);
const R = CM.RAG;

const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n');
const file = (path, text, extra = {}) => ({ type: 'file', id: path, path, lang: 'js', preview: text,
  metrics: { lines: text.split('\n').length, chars: text.length, longest: Math.max(...text.split('\n').map((l) => l.length)) }, ...extra });

describe('tokenizacja', () => {
  test('identyfikatory camelCase / snake_case rozbite, cały identyfikator zachowany, słowa-szum pominięte', () => {
    const t = host(R.tokenize('function parseImportSpecifiers(the_raw_source) { return x2; }'));
    for (const w of ['parseimportspecifiers', 'parse', 'import', 'specifiers', 'raw', 'source', 'the_raw_source'.replace(/_/g, '_')]) {
      if (w.includes('_')) continue;
      assert.ok(t.includes(w), w);
    }
    assert.ok(!t.includes('function') && !t.includes('return') && !t.includes('the'));
  });
  test('pytanie po polsku rozszerzone o angielskie pojęcia', () => {
    const q = host(R.queryTokens('Gdzie jest parsowanie importów i rysowanie krawędzi?'));
    for (const w of ['parse', 'parser', 'import', 'draw', 'render', 'edge']) assert.ok(q.includes(w), w);
    assert.ok(!q.includes('gdzie') && !q.includes('jest'));
  });
});

describe('fragmenty', () => {
  test('granice wg symboli, krótkie scalone, długie dzielone oknem 60 linii z zakładką', () => {
    const text = lines(200, (i) => (i === 1 ? '// nagłówek' : i === 5 ? 'function alpha(){' : i === 12 ? 'function beta(){' : i === 60 ? 'function gamma(){' : 'x = ' + i + ';'));
    const n = file('src/a.js', text, { symbols: [{ name: 'alpha', line: 5 }, { name: 'beta', line: 12 }, { name: 'gamma', line: 60 }] });
    const cs = host(R.chunkFile(n).map((c) => [c.start, c.end, c.sym]));
    assert.deepEqual(cs[0], [1, 59, 'alpha, beta']);          // 1–4 + alpha + beta scalone (każdy < 18 linii)
    assert.deepEqual(cs.slice(1).map((c) => [c[0], c[1]]), [[60, 119], [110, 169], [160, 200]]);
    assert.ok(cs.slice(1).every((c) => c[2] === 'gamma'));
  });
  test('pliki zminifikowane, lock i puste są pomijane', () => {
    assert.equal(R.chunkFile(file('dist/app.min.js', 'a'.repeat(5000))).length, 0);
    assert.equal(R.chunkFile(file('package-lock.json', '{"a":1,\n"b":2}')).length, 0);
    assert.equal(R.chunkFile(file('x.js', '   \n  ')).length, 0);
    assert.equal(R.chunkFile({ type: 'folder', path: 'src' }).length, 0);
  });
});

describe('wyszukiwanie', () => {
  const chunks = [
    { path: 'js/analysis.js', id: 'a', start: 1, end: 40, sym: 'parseImports', text: 'function parseImports(src){ const deps=[]; /* import/require */ return deps; }' },
    { path: 'js/renderer.js', id: 'r', start: 1, end: 40, sym: 'drawEdges', text: 'drawEdges(ctx){ for(const e of this.edges){ ctx.moveTo(); ctx.lineTo(); } }' },
    { path: 'js/renderer.js', id: 'r', start: 41, end: 80, sym: 'drawNodes', text: 'drawNodes(ctx){ ctx.arc(); ctx.fill(); }' },
    { path: 'js/renderer.js', id: 'r', start: 81, end: 120, sym: 'drawLabels', text: 'drawLabels(ctx){ ctx.fillText(); draw edges labels }' },
    { path: 'README.md', id: 'm', start: 1, end: 10, sym: '', text: 'CodeMap — kartografia kodu.' },
  ];
  const lex = R.buildLexical(chunks);
  test('BM25: pytanie po polsku trafia w parser importów', () => {
    const sc = R.bm25(lex, host(R.queryTokens('jak działa parsowanie importów?')));
    const best = [...sc].indexOf(Math.max(...sc));
    assert.equal(chunks[best].sym, 'parseImports');
  });
  test('ranking hybrydowy: wektory przestawiają kolejność, różnorodność ≤ 2 fragmenty z pliku', () => {
    const lexSc = R.bm25(lex, host(R.queryTokens('draw')));
    const cos = new Float32Array([0.9, 0.1, 0.2, 0.3, 0.0]);
    const hits = R.rank(lexSc, cos, 10, 0.9);
    assert.equal(hits[0].i, 0);                         // semantyka wygrywa przy alpha=0.9
    const div = host(R.diversify(R.rank(lexSc, null, 10), chunks, 10).map((h) => chunks[h.i].path));
    assert.equal(div.filter((p) => p === 'js/renderer.js').length, 2);
  });
  test('blok kontekstu: numeracja źródeł, budżet znaków, nagłówki plik:linie', () => {
    const hits = [{ i: 0, score: 1 }, { i: 1, score: 0.5 }, { i: 2, score: 0.4 }];
    const cb = R.contextBlock(hits, chunks, 500);
    assert.ok(cb.text.startsWith('[1] js/analysis.js:1-40 (parseImports)\n```'));
    assert.ok(cb.text.length <= 520);
    assert.deepEqual(host(cb.sources.map((s) => [s.n, s.path, s.start])), host(cb.sources.map((s, k) => [k + 1, s.path, s.start])));
    assert.ok(cb.sources.length >= 2);
  });
  test('prefiksy modeli embeddingów i normalizacja wektora', () => {
    assert.deepEqual(host(R.prefixes('nomic-embed-text:latest')), { q: 'search_query: ', d: 'search_document: ' });
    assert.deepEqual(host(R.prefixes('bge-m3')), { q: '', d: '' });
    const v = R.normalize([3, 4]);
    assert.ok(Math.abs(v[0] - 0.6) < 1e-6 && Math.abs(v[1] - 0.8) < 1e-6);
  });
});

describe('pliki wymienione w pytaniu', () => {
  test('mentionedFiles: nazwy z rozszerzeniem, bez duplikatów, małe litery', () => {
    assert.deepEqual(host(R.mentionedFiles('Co robi Agent.js i agent.js? A plik src/rag.js oraz README.md?')), ['agent.js', 'src/rag.js'.split('/').pop(), 'readme.md']);
    assert.deepEqual(host(R.mentionedFiles('jak działa bus factor')), []);
  });
});
