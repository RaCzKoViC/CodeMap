// Fixture monorepo: dwa pakiety z RÓŻNYMI aliasami `@/*`, wspólna baza `tsconfig.base.json` przez
// `extends` (raz z rozszerzeniem, raz bez), root `tsconfig.json` z własnym aliasem, który NIE może
// przeciekać do pakietów. Używane przez test/graph.test.mjs (aliasy per katalog, workspaces).
const F = (path, content) => ({ path, content, size: content.length, mtime: 1700000000000 });

export const FILES = [
  F('tsconfig.base.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@shared/*": ["packages/shared/src/*"] } } }\n'),
  F('tsconfig.json', '{ "extends": "./tsconfig.base.json", "compilerOptions": { "paths": { "@root/*": ["tools/*"] } } }\n'),
  F('packages/a/tsconfig.json', '{ "extends": "../../tsconfig.base", "compilerOptions": { "paths": { "@/*": ["src/*"] } } }\n'),
  F('packages/b/tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["lib/*"] } } }\n'),
  F('packages/a/src/x.ts', 'export const x = 1;\n'),
  F('packages/a/src/main.ts', "import { x } from '@/x';\nimport s from '@shared/util';\nimport r from '@root/gen';\n"),
  F('packages/b/lib/x.ts', 'export const x = 2;\n'),
  F('packages/b/src/main.ts', "import { x } from '@/x';\nimport s from '@shared/util';\n"),
  F('packages/shared/src/util.ts', 'export default 1;\n'),
  F('tools/gen.ts', 'export default 1;\n'),
  F('scripts/build.ts', "import g from '@root/gen';\nimport s from '@shared/util';\nimport x from '@/x';\n"),
  // ---- workspaces: import po nazwie pakietu z package.json (main / module / exports / index / folder) ----
  F('package.json', '{ "name": "mono", "private": true, "workspaces": ["packages/*"] }\n'),
  F('packages/shared/package.json', '{ "name": "@mono/shared", "main": "src/index.ts" }\n'),
  F('packages/shared/src/index.ts', "export * from './util';\n"),
  F('packages/b/package.json', '{ "name": "@mono/b", "exports": { ".": { "import": "./lib/index.mjs", "require": "./lib/index.cjs" }, "./x": "./lib/x.ts", "./feat/*": "./lib/feat/*.ts" } }\n'),
  F('packages/b/lib/index.mjs', 'export const b = 1;\n'),
  F('packages/b/lib/feat/one.ts', 'export const one = 1;\n'),
  F('packages/c/package.json', '{ "name": "@mono/c", "exports": "./c.ts" }\n'),
  F('packages/c/c.ts', 'export const c = 1;\n'),
  F('packages/util/package.json', '{ "name": "util-pkg" }\n'),
  F('packages/util/helper.ts', 'export const h = 1;\n'),
  F('packages/a/src/uses.ts', [
    "import s from '@mono/shared';",
    "import b from '@mono/b';",
    "import bx from '@mono/b/x';",
    "import one from '@mono/b/feat/one';",
    "import c from '@mono/c';",
    "import u from 'util-pkg';",
    "import h from 'util-pkg/helper';",
    "import lp from 'left-pad';",
    "",
  ].join('\n')),
];

export const META = { name: 'mono', source: 'test' };
