// Fixture wielojęzyczna dla Fazy 2 (rozwiązywanie zależności + nowe parsery). Każda sekcja to
// osobny „mini-projekt" w swoim katalogu; oczekiwane cele krawędzi są w test/graph.test.mjs.
const F = (path, content) => ({ path, content, size: content.length, mtime: 1700000000000 });
const BIN = (path, size) => ({ path, content: null, size, mtime: 1700000000000 });

export const FILES = [
  // ---- JS: odwołania dynamiczne (worker, URL, importScripts, require.resolve, import.meta.glob) ----
  F('web/main.js', [
    "const w = new Worker('./workers/heavy.js', { type: 'module' });",
    "const sw = new SharedWorker(new URL('./workers/shared.js', import.meta.url));",
    "const wasm = new URL('./assets/mod.wasm', import.meta.url);",
    "const cfg = require.resolve('./config');",
    "const plugins = import.meta.glob('./plugins/*.js');",
    "const views = import.meta.glob(['./views/**/*.vue', '!./views/**/skip.vue']);",
    "const remote = new URL('https://example.com/x.js');",
    "const api = new URL('/api/x', location.href);",
    "fetch('./data.json');",
    "",
  ].join('\n')),
  F('web/workers/heavy.js', "importScripts('lib/a.js', './b.js');\nself.onmessage = () => {};\n"),
  F('web/workers/lib/a.js', 'self.A = 1;\n'),
  F('web/workers/b.js', 'self.B = 1;\n'),
  F('web/workers/shared.js', 'self.S = 1;\n'),
  BIN('web/assets/mod.wasm', 100),
  F('web/config.js', 'module.exports = {};\n'),
  F('web/data.json', '{}\n'),
  F('web/plugins/p1.js', 'export default 1;\n'),
  F('web/plugins/p2.js', 'export default 2;\n'),
  F('web/plugins/nested/p3.js', 'export default 3;\n'),
  F('web/views/Home.vue', '<template><div/></template>\n'),
  F('web/views/admin/Users.vue', '<template><div/></template>\n'),
  F('web/views/admin/skip.vue', '<template><div/></template>\n'),

  // ---- SCSS: @use / @forward → partiale `_x.scss`, `index.scss` / `_index.scss` w katalogu ----
  F('sass/main.scss', "@use 'sass:math';\n@use 'partial' as p;\n@use 'lib';\n@forward 'theme' with ($c: red);\n@import 'legacy';\n"),
  F('sass/_partial.scss', '$p: 1;\n'),
  F('sass/lib/_index.scss', "@forward 'mixins';\n"),
  F('sass/lib/_mixins.scss', '@mixin m {}\n'),
  F('sass/theme.scss', '$c: blue;\n'),
  F('sass/legacy/index.scss', '.l {}\n'),
];

export const META = { name: 'polyglot', source: 'test' };
