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
];

export const META = { name: 'mono', source: 'test' };
