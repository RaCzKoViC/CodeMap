// Mały, wielojęzyczny projekt-fixture: ćwiczy rozwiązywanie importów względnych, index.js,
// aliasów tsconfig (JSONC), pakietów zewnętrznych, cyklu, importów Pythona, CSS, HTML, Markdown,
// C, Go (folder pakietu) i Javy. Ścieżki i oczekiwane krawędzie są używane w kilku plikach testów.
const F = (path, content) => ({ path, content, size: content.length, mtime: 1700000000000 });

export const FILES = [
  F('package.json', '{\n  "name": "sample",\n  "dependencies": { "react": "^18.2.0", "lodash": "4.17.21" }\n}\n'),
  F('tsconfig.json', '{\n  // JSONC: komentarz i przecinek na końcu\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@/*": ["src/*"], },\n  },\n}\n'),
  F('src/index.js', [
    "import { App } from './app';",
    "import util from './lib/util.js';",
    "import cfg from '@/config';",
    "import React from 'react';",
    "// import ghost from './ghost'; — w komentarzu, nie może dać krawędzi",
    "const lazy = () => import('./lazy.js');",
    "const cjs = require('./cjs');",
    "export function main(){ if(cfg && util){ return new App(); } }",
    "",
  ].join('\n')),
  F('src/app.js', "import { helper } from './lib/util';\nimport { store } from './store';\nexport class App { run(){ return helper(store); } }\n"),
  F('src/lib/util.js', "import { App } from '../app';   // cykl app ↔ lib/util\nexport function helper(s){ return s && App; }\nexport default helper;\n"),
  F('src/store/index.js', "import { reducer } from './reducer';\nexport const store = { state: reducer({}, {}) };\n"),
  F('src/store/reducer.js', "export function reducer(s, a){ switch(a.type){ case 'x': return s; default: return s; } }\n"),
  F('src/config.js', "export default { debug: false };\n"),
  F('src/lazy.js', "export const lazy = true;\n"),
  F('src/cjs.js', "module.exports = { cjs: true };\n"),
  F('py/pkg/__init__.py', "from . import helpers\n"),
  F('py/pkg/mod.py', "import os, sys\nfrom .helpers import x\nfrom . import helpers\n\ndef run():\n    \"\"\"import fake  # docstring, nie import\"\"\"\n    return x()\n"),
  F('py/pkg/helpers.py', "def x():\n    return 1\n"),
  F('styles/main.css', "@import './theme.css';\n@import url(\"vars.css\");\n.a{color:red}\n"),
  F('styles/theme.css', ".t{color:blue}\n"),
  F('styles/vars.css', ":root{--x:1}\n"),
  F('index.html', '<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"></head><body><script src="src/index.js"></script></body></html>\n'),
  F('docs/README.md', "# Docs\n\nSee [architecture](./arch.md) and [site](https://example.com).\n"),
  F('docs/arch.md', "# Arch\n"),
  F('c/main.c', '#include "util.h"\n#include <stdio.h>\nint main(void){ if(1){ return util(); } }\n'),
  F('c/util.h', 'int util(void);\n'),
  F('go/cmd/main.go', 'package main\n\nimport (\n\t"fmt"\n\t"example.com/proj/go/pkg/util"\n)\n\nfunc main(){ fmt.Println(util.X) }\n'),
  F('go/pkg/util/util.go', 'package util\n\nconst X = 1\n'),
  F('java/com/x/App.java', 'package com.x;\nimport com.x.util.Helper;\nimport java.util.List;\npublic class App { public static void main(String[] a){ Helper.h(); } }\n'),
  F('java/com/x/util/Helper.java', 'package com.x.util;\npublic class Helper { public static void h(){} }\n'),
  // plik binarny: content null, rozmiar jawny
  { path: 'assets/logo.png', content: null, size: 1234, mtime: 1700000000000 },
];

export const META = { name: 'sample', source: 'test' };

/** Krawędzie import/reference, które MUSZĄ powstać (źródło → cel). */
export const EXPECTED_EDGES = [
  ['src/index.js', 'src/app.js', 'import'],
  ['src/index.js', 'src/lib/util.js', 'import'],
  ['src/index.js', 'src/config.js', 'import'],      // alias @/config z tsconfig
  ['src/index.js', 'src/lazy.js', 'import'],        // import()
  ['src/index.js', 'src/cjs.js', 'import'],         // require()
  ['src/app.js', 'src/lib/util.js', 'import'],
  ['src/app.js', 'src/store/index.js', 'import'],   // ./store → store/index.js
  ['src/lib/util.js', 'src/app.js', 'import'],      // cykl
  ['src/store/index.js', 'src/store/reducer.js', 'import'],
  ['py/pkg/mod.py', 'py/pkg/helpers.py', 'import'],
  ['py/pkg/mod.py', 'py/pkg/__init__.py', 'import'],
  ['py/pkg/__init__.py', 'py/pkg/helpers.py', 'import'],   // `from . import helpers` — nazwy po `import` to podmoduły (Faza 2)
  ['styles/main.css', 'styles/theme.css', 'import'],
  ['styles/main.css', 'styles/vars.css', 'import'],
  ['index.html', 'src/index.js', 'reference'],
  ['index.html', 'styles/main.css', 'reference'],
  ['docs/README.md', 'docs/arch.md', 'reference'],
  ['c/main.c', 'c/util.h', 'import'],
  ['go/cmd/main.go', 'go/pkg/util', 'import'],      // pakiet Go = folder
  ['java/com/x/App.java', 'java/com/x/util/Helper.java', 'import'],
];

/** Pakiety zewnętrzne, które muszą zostać rozpoznane, z importerem. */
export const EXPECTED_EXTERNALS = [
  ['react', 'src/index.js'],
  ['os', 'py/pkg/mod.py'],
  ['sys', 'py/pkg/mod.py'],
  ['fmt', 'go/cmd/main.go'],
  ['java', 'java/com/x/App.java'],                  // java.util.List → "java"
];
