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

  // ---- C#: using X.Y → pliki deklarujące `namespace X.Y` (file-scoped i blokowe); static/alias → namespace typu ----
  F('cs/App/Program.cs', 'using System;\nusing MyApp.Services;\nusing static MyApp.Util.Helpers;\nusing Log = MyApp.Logging.Logger;\nnamespace MyApp;\nclass Program { static void Main() {} }\n'),
  F('cs/Services/UserService.cs', 'namespace MyApp.Services;\npublic class UserService {}\n'),
  F('cs/Services/OrderService.cs', 'namespace MyApp.Services\n{\n    public class OrderService {}\n}\n'),
  F('cs/Util/Helpers.cs', 'namespace MyApp.Util;\npublic static class Helpers {}\n'),
  F('cs/Logging/Logger.cs', 'namespace MyApp.Logging { public class Logger {} }\n'),
  F('cs/Services/Unrelated.cs', 'using MyApp.Services;\nnamespace MyApp.Other;\npublic class U {}\n'),   // using własnego ns z innego pliku

  // ---- Rust: use crate::a::b::c → src/a/b/c.rs | c/mod.rs | a/b.rs (od najdłuższej); super/self względem modułu ----
  F('rs/Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n'),
  F('rs/src/main.rs', 'mod a;\nmod util;\nuse crate::a::b::c::run;\nuse crate::util;\nuse std::collections::HashMap;\nuse serde::Serialize;\nuse demo::a::b;\nfn main() { run(); }\n'),
  F('rs/src/a/mod.rs', 'pub mod b;\nuse super::util::helper;\nuse self::b::c;\n'),
  F('rs/src/a/b.rs', 'pub mod c;\nuse super::super::util;\nuse super::*;\n'),
  F('rs/src/a/b/c.rs', 'use crate::util::helper;\npub fn run() { helper(); }\n'),
  F('rs/src/util.rs', 'pub fn helper() {}\n'),
];

export const META = { name: 'polyglot', source: 'test' };
