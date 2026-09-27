import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { FILES, META } from './fixtures/sample-project.mjs';

// Trasy po kodzie bez DOM: trasa automatyczna ze struktury, walidacja, prompt (tylko struktura), parser, CodeTour, link.
const CM = loadCM([...CORE, 'testmap', 'tour'], { Response, Blob, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, btoa, atob });
const T = CM.Tour;
const F = (path, content) => ({ path, content, size: content.length, mtime: 1 });
const build = (extra = []) => { const g = new CM.Graph.Graph().build(FILES.map((f) => ({ ...f })).concat(extra), META); CM.TestMap.mapTests(g); return g; };
const TEST = F('src/lib/util.test.js', "import { u } from './util.js';\ntest('u', () => u());\n");

describe('trasa automatyczna', () => {
  test('opis → punkty wejścia → rdzeń (najwięcej zależnych) → hotspot → testy rdzenia; bez powtórzeń', () => {
    const t = T.auto(build([TEST]), { lang: 'pl' });
    const kinds = host(t.steps.map((s) => s.kind));
    assert.equal(kinds[0], 'readme');
    assert.ok(kinds.includes('entry') && kinds.includes('core'));
    assert.equal(new Set(t.steps.map((s) => s.path)).size, t.steps.length);
    assert.ok(t.steps.length <= 8);
    const core = t.steps.find((s) => s.kind === 'core');
    assert.match(core.note, /^Rdzeń — zależne pliki: \d+; wiersze: \d+, złożoność: \d+/);
    assert.match(t.title, /^Trasa po projekcie — sample/);
  });
  test('bez importów: po jednym pliku z największych folderów; angielskie notatki', () => {
    const g = new CM.Graph.Graph().build([F('a/x.js', 'function a(){ if(1) return 1; }'), F('a/y.js', 'var b=1'), F('b/z.js', 'function z(){ for(;;){} }')], META);
    const t = T.auto(g, { lang: 'en' });
    assert.deepEqual(host(t.steps.filter((s) => s.kind === 'module').map((s) => s.path)), ['a/x.js', 'b/z.js']);
    assert.match(t.steps[0].note, /^Module "a" \(files: 2\)/);
  });
});

describe('walidacja i model', () => {
  test('nieznane ścieżki odrzucone, sufiks ścieżki rozwiązany, duplikaty i limit linii', () => {
    const g = build();
    const v = T.validate(g, { title: 'X', steps: [{ path: 'nie/ma.js', note: 'a' }, { path: 'app.js', note: 'b', line: 99999 }, { path: 'src/app.js', note: 'dup' }, { file: 'src/lib/util.js', description: 'c' }] });
    assert.deepEqual(host(v.steps.map((s) => [s.path, s.note])), [['src/app.js', 'b'], ['src/lib/util.js', 'c']]);
    assert.equal(v.dropped, 2);
    assert.ok(v.steps[0].line >= 1 && v.steps[0].line <= g.nodes.get('src/app.js').metrics.lines);
    assert.equal(T.validate(g, { steps: [{ path: 'x' }] }), null);
  });
  test('prompt zawiera tylko strukturę (bez treści plików); parser odpowiedzi z ```json``` i <think>', () => {
    const g = build(); const msgs = T.prompt(g, 'pl');
    assert.match(msgs[0].content, /never source code/);
    assert.match(msgs[0].content, /Title and notes in Polish/);
    assert.ok(!msgs[1].content.includes('export default'), 'bez treści kodu');
    assert.match(msgs[1].content, /"path":"src\/app\.js"/);
    const j = T.parse('<think>hmm</think>Oto trasa:\n```json\n{"title":"T","steps":[{"path":"src/app.js","note":"start"}]}\n```');
    assert.equal(j.steps[0].path, 'src/app.js');
    assert.equal(T.parse('brak json'), null);
  });
});

describe('CodeTour i link', () => {
  test('CodeTour w obie strony', () => {
    const t = { title: 'T', steps: [{ path: 'src/app.js', line: 3, note: 'n' }] };
    const ct = host(T.toCodeTour(t));
    assert.deepEqual(ct.steps, [{ file: 'src/app.js', line: 3, description: 'n' }]);
    assert.deepEqual(host(T.fromCodeTour(ct).steps), [{ path: 'src/app.js', line: 3, note: 'n' }]);
  });
  test('#tour=: kodowanie i dekodowanie (deflate + base64url), polskie znaki, śmieci → null', async () => {
    const t = { title: 'Trasa ąę', steps: [{ path: 'src/app.js', line: 1, note: 'Zacznij tutaj — źródło' }, { path: 'src/lib/util.js', line: 7, note: 'x' }] };
    const s = await T.encode(t);
    assert.match(s, /^[zj][A-Za-z0-9_-]+$/);
    const d = await T.decode(s);
    assert.equal(d.title, 'Trasa ąę');
    assert.deepEqual(host(d.steps.map((x) => [x.path, x.note, x.line])), [['src/app.js', 'Zacznij tutaj — źródło', 1], ['src/lib/util.js', 'x', 7]]);
    assert.equal(await T.decode('zzzz'), null);
    assert.equal(await T.decode('q123'), null);
  });
});
