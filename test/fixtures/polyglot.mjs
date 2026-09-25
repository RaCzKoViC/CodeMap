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

  // ---- Swift: import Module → folder Sources/<Module> (SwiftPM) albo folder najwyższego poziomu; inaczej zewnętrzny ----
  F('swift/Sources/App/main.swift', 'import Foundation\nimport Core\n@testable import Helpers\n'),
  F('swift/Sources/Core/Core.swift', 'public struct Core {}\n'),
  F('swift/Tests/CoreTests/CoreTests.swift', '@testable import Core\nimport XCTest\n'),

  // ---- Dart: package:<name>/x.dart → lib/x.dart pakietu z pubspec.yaml; względne; part; export ----
  F('dart/pubspec.yaml', 'name: myapp\ndescription: x\n'),
  F('dart/lib/main.dart', "import 'dart:io';\nimport 'package:myapp/src/util.dart';\nimport 'package:flutter/material.dart';\nimport 'widgets/home.dart';\nexport 'src/api.dart';\npart 'main.g.dart';\n"),
  F('dart/lib/src/util.dart', 'int u() => 1;\n'),
  F('dart/lib/src/api.dart', 'int api() => 1;\n'),
  F('dart/lib/widgets/home.dart', 'class Home {}\n'),
  F('dart/lib/main.g.dart', "part of 'main.dart';\n"),

  // ---- Elixir: alias/import/use → defmodule w projekcie (indeks) albo lib/a/b/c.ex po snake_case ----
  F('ex/lib/my_app_web.ex', 'defmodule MyAppWeb do\nend\n'),
  F('ex/lib/my_app/repo.ex', 'defmodule MyApp.Repo do\n  use Ecto.Repo, otp_app: :my_app\nend\n'),
  F('ex/lib/my_app/accounts/user.ex', 'defmodule MyApp.Accounts.User do\nend\n'),
  F('ex/lib/legacy.ex', 'defmodule Legacy.Thing do\nend\n'),
  F('ex/lib/my_app_web/controllers/user_controller.ex', 'defmodule MyAppWeb.UserController do\n  use MyAppWeb, :controller\n  alias MyApp.{Repo, Accounts.User}\n  alias Legacy.Thing\n  import Ecto.Query\n  require Logger\nend\n'),

  // ---- Lua: require('a.b') → a/b.lua | a/b/init.lua ----
  F('lua/main.lua', "local a = require('lib.a')\nlocal b = require \"lib.b\"\nlocal s = require('socket')\n"),
  F('lua/lib/a.lua', 'return {}\n'),
  F('lua/lib/b/init.lua', 'return {}\n'),

  // ---- Zig: @import("x.zig") względne; std systemowe; pakiet zewnętrzny ----
  F('zig/src/main.zig', 'const std = @import("std");\nconst util = @import("util.zig");\nconst thing = @import("sub/thing.zig");\nconst zap = @import("zap");\n'),
  F('zig/src/util.zig', 'pub const x = 1;\n'),
  F('zig/src/sub/thing.zig', 'pub const y = 1;\n'),

  // ---- Haskell: import Data.Map → src/Data/Map.hs | Data/Map.hs ----
  F('hs/src/Main.hs', "{-# LANGUAGE OverloadedStrings #-}\nmodule Main where\nimport qualified Data.Map as M\nimport Lib.Util\nimport {-# SOURCE #-} Lib.Core (core)\n"),
  F('hs/src/Lib/Util.hs', 'module Lib.Util where\n'),
  F('hs/src/Lib/Core.hs', 'module Lib.Core where\n'),

  // ---- Shell: source ./x.sh | . x.sh — względem skryptu, awaryjnie od korzenia projektu ----
  F('sh/run.sh', '#!/bin/bash\nsource ./lib/common.sh\n. "$HOME/.profile"\n. lib/colors.sh\nsource scripts/env.sh\n'),
  F('sh/lib/common.sh', 'common() { :; }\n'),
  F('sh/lib/colors.sh', 'RED=1\n'),
  F('scripts/env.sh', 'export X=1\n'),

  // ---- Python: dwa utils.py w różnych pakietach — `import utils` z katalogu pliku, potem bliższy pakiet, potem najkrótsza ścieżka ----
  F('py2/pkg_a/__init__.py', ''),
  F('py2/pkg_a/utils.py', 'A = 1\n'),
  F('py2/pkg_a/core.py', 'import utils\nfrom pkg_b.sub import utils as u2\n'),
  F('py2/pkg_b/__init__.py', ''),
  F('py2/pkg_b/shared.py', 'S = 1\n'),
  F('py2/pkg_b/sub/__init__.py', ''),
  F('py2/pkg_b/sub/utils.py', 'B = 1\n'),
  F('py2/pkg_b/sub/mod.py', 'import utils\nfrom . import utils as u\nfrom .. import shared, missing\n'),
  F('py2/pkg_b/tools/run.py', 'import utils\n'),
  F('py2/other/deep/x/mod2.py', 'import utils\n'),
];

export const META = { name: 'polyglot', source: 'test' };
