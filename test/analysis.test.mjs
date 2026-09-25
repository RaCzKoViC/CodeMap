import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

const CM = loadCM();
const A = CM.Analysis;

describe('ścieżki', () => {
  test('normPath usuwa ./ i ../ oraz backslashe', () => {
    assert.equal(A.normPath('a//b/../c/./d.js'), 'a/c/d.js');
    assert.equal(A.normPath('.\\src\\x.js'), 'src/x.js');
    assert.equal(A.normPath('/leading/slash'), 'leading/slash');
    assert.equal(A.normPath(''), '');
  });
  test('dirname / basename / joinPath', () => {
    assert.equal(A.dirname('src/lib/util.js'), 'src/lib');
    assert.equal(A.dirname('index.js'), '');
    assert.equal(A.basename('src/lib/util.js'), 'util.js');
    assert.equal(A.joinPath('src/lib', '../app'), 'src/app');
    assert.equal(A.joinPath('', 'x.js'), 'x.js');
  });
});

describe('stripNonCode', () => {
  test('usuwa komentarze JS, zostawia stringi, zachowuje liczbę linii', () => {
    const src = "import a from './a'; // import b from './b'\n/* import c from './c' */\nconst s = \"import d from './d'\";\n";
    const out = A.stripNonCode(src, 'js');
    assert.equal(out.split('\n').length, src.split('\n').length);
    assert.ok(out.includes("import a from './a'"));
    assert.ok(!out.includes("'./b'"));
    assert.ok(!out.includes("'./c'"));
    assert.ok(out.includes("'./d'"), 'string literal must survive');
  });
  test('# jest komentarzem w Pythonie, ale nie w C', () => {
    assert.ok(!A.stripNonCode('# import os\nimport sys\n', 'py').includes('import os'));
    assert.ok(A.stripNonCode('#include "x.h"\n', 'c').includes('#include "x.h"'));
  });
  test('docstring potrójnie cytowany jest wygaszany', () => {
    const out = A.stripNonCode('def f():\n    """import fake"""\n    return 1\n', 'py');
    assert.ok(!out.includes('import fake'));
  });
});

describe('looseJSON', () => {
  test('parsuje JSONC: komentarze i przecinki końcowe', () => {
    const j = A.looseJSON('{\n // c\n "a": [1, 2,], /* x */ "b": {"c": "http://x",},\n}');
    assert.deepEqual(host(j), { a: [1, 2], b: { c: 'http://x' } });
  });
});

describe('extractDeps per język', () => {
  const specs = (content, key) => host(A.extractDeps(content, key).map((d) => d.spec));
  test('JS: import/export from, require, import(), pomija komentarze i URL-e', () => {
    const c = "import a from './a';\nexport * from './b';\nconst r = require('./c');\nconst l = import('./d');\n// import z from './z'\nimport 'https://cdn.example/x.js';\n";
    assert.deepEqual(specs(c, 'js'), ['./a', './b', './c', './d']);
  });
  test('Python: import a, b oraz from .x import', () => {
    const d = A.extractDeps('import os, sys as system\nfrom .helpers import x\nfrom pkg.sub import y\n', 'py');
    assert.deepEqual(host(d.map((x) => [x.spec, x.kind])), [['os', 'module'], ['sys', 'module'], ['.helpers', 'py-rel'], ['pkg.sub', 'module']]);
  });
  test('C: "local.h" jest względne, <system> jest systemowe', () => {
    const d = A.extractDeps('#include "util.h"\n#include <stdio.h>\n', 'c');
    assert.deepEqual(host(d.map((x) => [x.spec, x.kind])), [['util.h', 'rel'], ['stdio.h', 'system']]);
  });
  test('Go: blok import ( )', () => {
    assert.deepEqual(specs('import (\n\t"fmt"\n\t"example.com/p/util"\n)\n', 'go'), ['fmt', 'example.com/p/util']);
  });
  test('Java: import pakietów, bez .*', () => {
    assert.deepEqual(specs('import com.x.util.Helper;\nimport java.util.*;\n', 'java'), ['com.x.util.Helper']);
  });
  test('CSS: @import i url()', () => {
    assert.deepEqual(specs("@import './theme.css';\n@import url(\"vars.css\");\n", 'css'), ['./theme.css', 'vars.css']);
  });
  test('HTML: src/href jako referencje', () => {
    const d = A.extractDeps('<link href="a.css"><script src="b.js"></script><a href="#top">x</a>', 'html');
    assert.deepEqual(host(d.map((x) => [x.spec, x.etype]).sort()), [['a.css', 'reference'], ['b.js', 'reference']]);
  });
  test('Markdown: linki względne i obrazy, bez http (// w URL nie jest komentarzem)', () => {
    assert.deepEqual(specs('[a](./arch.md) [b](https://x.y) ![i](img.png)', 'md'), ['./arch.md', 'img.png']);
  });
  test('brak treści → pusta lista', () => {
    assert.deepEqual(host(A.extractDeps(null, 'js')), []);
  });
  test('JS dynamiczne: Worker, SharedWorker, new URL(…, import.meta.url), importScripts, require.resolve, import.meta.glob (+ negacje); fetch nie', () => {
    const c = [
      "new Worker('./w.js', { type: 'module' });",
      "new SharedWorker(new URL('./s.js', import.meta.url));",
      "const u = new URL('./a.wasm', import.meta.url);",
      "new URL('https://cdn.example/x.js'); new URL('/api', location.href);",
      "importScripts('lib/a.js', \"./b.js\");",
      "require.resolve('./cfg'); require.resolve('pkg');",
      "import.meta.glob('./plugins/*.js'); import.meta.globEager(['./views/**/*.vue', '!./views/skip.vue']);",
      "fetch('./data.json');",
    ].join('\n');
    const d = host(A.extractDeps(c, 'js').map((x) => [x.spec, x.kind]));
    assert.deepEqual(d, [['./w.js', 'rel'], ['./s.js', 'rel'], ['./a.wasm', 'rel'], ['lib/a.js', 'rel'], ['./b.js', 'rel'],
      ['./cfg', 'rel'], ['pkg', 'bare'], ['./plugins/*.js', 'glob'], ['./views/**/*.vue', 'glob']]);
    const glob = A.extractDeps(c, 'js').find((x) => x.spec === './views/**/*.vue');
    assert.deepEqual(host(glob.exclude), ['./views/skip.vue']);
    assert.ok(A.extractDeps(c, 'js').every((x) => x.etype === 'import'));
  });
});

describe('analyzeContent', () => {
  test('liczy linie, puste, komentarze, kod, TODO, złożoność, funkcje', () => {
    const src = ['// header', '', 'function a(x){', '  if(x && y){ return 1; } // TODO fix', '  /* block', '     comment */', '  return 0;', '}', ''].join('\n');
    const m = A.analyzeContent(src, 'js');
    assert.equal(m.lines, 9);
    assert.equal(m.blank, 2);
    assert.equal(m.comment, 3);          // header + 2 linie bloku
    assert.equal(m.code, 4);
    assert.equal(m.todos, 1);
    assert.equal(m.funcs, 1);
    assert.equal(m.complexity, 1 + 1 + 1); // if + &&
    assert.equal(m.chars, src.length);
  });
  test('null → null', () => { assert.equal(A.analyzeContent(null, 'js'), null); });
});

describe('extractSymbols', () => {
  test('JS: funkcje, klasy, strzałki, interfejsy, typy + złożoność', () => {
    const src = "export function a(){ if(x){} }\nclass B {}\nconst c = async (q) => q && 1;\ninterface I {}\ntype T = string;\n";
    const s = A.extractSymbols(src, 'ts');
    assert.deepEqual(host(s.map((x) => [x.name, x.kind, x.line])), [['a', 'function', 1], ['B', 'class', 2], ['c', 'function', 3], ['I', 'interface', 4], ['T', 'type', 5]]);
    assert.equal(s[0].complexity, 2);
    assert.equal(s[2].complexity, 2);
  });
  test('Python i Go', () => {
    assert.deepEqual(host(A.extractSymbols('class K:\n    def m(self):\n        pass\n', 'py').map((x) => x.name)), ['K', 'm']);
    assert.deepEqual(host(A.extractSymbols('type S struct{}\nfunc (s S) M(){}\n', 'go').map((x) => [x.name, x.kind])), [['S', 'type'], ['M', 'function']]);
  });
});

describe('externalName', () => {
  test('pakiety z zakresem i podścieżki', () => {
    assert.equal(A.externalName('@scope/pkg/sub'), '@scope/pkg');
    assert.equal(A.externalName('lodash/fp'), 'lodash');
    assert.equal(A.externalName('java.util.List'), 'java');
  });
});
