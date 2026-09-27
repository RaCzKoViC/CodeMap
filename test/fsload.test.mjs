import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCodeMap } from '../cli/runtime.mjs';
import { loadProjectFiles } from '../cli/fsload.mjs';

// Wczytanie projektu z dysku w CLI (cli/fsload.mjs) na katalogu tymczasowym: te same reguły co przeglądarka
// (pomijane katalogi, treść tylko tekstu, sekrety bez treści), raporty pokrycia także z katalogów pomijanych,
// limit treści, --exclude, kolejność alfabetyczna, dekodowanie UTF-8 jak FileReader, dowiązania pominięte.
const CM = loadCodeMap();
let dir;
const put = (rel, data) => { const p = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-fsload-'));
  put('src/b.js', 'export const b = 1;\n');
  put('src/a.js', "import './b.js';\n");
  put('src/bom.ts', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('const x = 1;')]));
  put('src/bad.txt', Buffer.from([0x61, 0xff, 0x62]));
  put('img/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  put('.env', 'SECRET=1');
  put('.DS_Store', 'x');
  put('node_modules/pkg/index.js', 'x');
  put('node_modules/pkg/coverage/lcov.info', 'SF:x');
  put('coverage/lcov.info', 'SF:src/a.js\nend_of_record\n');
  put('build/reports/cobertura.xml', '<coverage/>');
  put('deep/a/b/c/coverage-final.json', '{}');
  put('docs/guide.md', '# x');
  put('docs/api/ref.md', '# y');
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('loadProjectFiles', () => {
  test('pliki projektu alfabetycznie; pomijane katalogi i śmieci; binaria i sekrety bez treści', () => {
    const r = loadProjectFiles(dir, CM);
    assert.deepEqual(r.files.map((f) => f.path), ['.env', 'deep/a/b/c/coverage-final.json', 'docs/api/ref.md', 'docs/guide.md', 'img/logo.png',
      'src/a.js', 'src/b.js', 'src/bad.txt', 'src/bom.ts']);
    const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
    assert.equal(by['src/a.js'].content, "import './b.js';\n");
    assert.equal(by['img/logo.png'].content, null); assert.equal(by['.env'].content, null);
    assert.equal(by['img/logo.png'].size, 4);
    assert.ok(by['src/a.js'].mtime > 0);
    assert.equal(r.stats.files, 9);
  });
  test('dekodowanie jak FileReader: BOM zdjęty, złe bajty → U+FFFD', () => {
    const r = loadProjectFiles(dir, CM);
    const by = Object.fromEntries(r.files.map((f) => [f.path, f.content]));
    assert.equal(by['src/bom.ts'], 'const x = 1;');
    assert.equal(by['src/bad.txt'], 'a�b');
  });
  test('raporty pokrycia: z katalogów pomijanych (coverage/, build/) i z drzewa, ale nie z node_modules ani zbyt głęboko', () => {
    const r = loadProjectFiles(dir, CM);
    assert.deepEqual(r.coverage.sort(), ['build/reports/cobertura.xml', 'coverage/lcov.info', 'deep/a/b/c/coverage-final.json']);
    put('x/y/z/w/v/lcov.info', 'SF:a');
    const r2 = loadProjectFiles(dir, CM);
    assert.ok(!r2.coverage.includes('x/y/z/w/v/lcov.info'), 'ponad 5 segmentów ścieżki');
    fs.rmSync(path.join(dir, 'x'), { recursive: true });
  });
  test('limit plików z treścią: nadwyżka policzona jako capped; exclude (glob) pomija pliki i katalogi', () => {
    const r = loadProjectFiles(dir, CM, { maxContent: 2 });
    assert.equal(r.stats.content, 2); assert.equal(r.stats.maxContent, 2);
    assert.equal(r.files.filter((f) => f.content != null).length, 2);
    assert.equal(r.stats.capped, 5);
    const e = loadProjectFiles(dir, CM, { exclude: ['docs/**', '**/*.png', ''] });
    assert.ok(!e.files.some((f) => f.path.startsWith('docs/') || f.path.endsWith('.png')));
    assert.ok(e.stats.excluded >= 2);
  });
  test('dowiązania symboliczne pominięte i policzone (gdy system pozwala je utworzyć); brak katalogu → pusto', (t) => {
    let linked = true;
    try { fs.symlinkSync(path.join(dir, 'src'), path.join(dir, 'loop'), 'junction'); } catch { linked = false; }
    if (!linked) { t.skip('brak uprawnień do dowiązań'); return; }
    try {
      const r = loadProjectFiles(dir, CM);
      assert.ok(r.stats.symlinks >= 1);
      assert.ok(!r.files.some((f) => f.path.startsWith('loop/')));
    } finally { fs.rmSync(path.join(dir, 'loop'), { recursive: true, force: true }); }
    const none = loadProjectFiles(path.join(dir, 'nie-ma'), CM);
    assert.deepEqual([none.files, none.coverage], [[], []]);
  });
});
