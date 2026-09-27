// Wspólne dla testów rozszerzenia: paczka (bundle) w katalogu tymczasowym — testy nie zostawiają app/ i cli/
// w repozytorium — oraz mały projekt-fixture na dysku.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bundle, EXT_DIR, REPO } from '../scripts/bundle.mjs';

export const require = createRequire(import.meta.url);
export { EXT_DIR, REPO };

export function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
export function rmDir(dir) { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Windows: blokady plików */ } } }

/** Paczka rozszerzenia (app/, cli/, LICENSE) w nowym katalogu tymczasowym — jako extensionUri w testach. */
export function tmpBundle() {
  const out = tmpDir('cm-vsc-bundle-');
  bundle({ out });
  return out;
}

export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

/** Projekt z cyklem a → b → c → a, sierotą ze spacją w nazwie i naruszeniem .codemap.rules.json (jak test/cli.test.mjs). */
export const FIXTURE = {
  'package.json': '{ "name": "fixture", "version": "0.0.1" }\n',
  'src/a.js': "import { b } from './b.js';\nexport const a = () => b();\n",
  'src/b.js': "// moduł b\nimport { c } from './c.js';\nexport const b = () => c();\n",
  'src/c.js': "// moduł c\n\nimport { a } from './a.js';\nexport const c = () => a;\n",
  'src/my file.js': 'export const spaced = 1;\n',
  'src/index.js': "import { a } from './a.js';\nexport default () => a();\n",
  '.codemap.rules.json': JSON.stringify({
    layers: [{ name: 'core', match: 'src/c.js' }, { name: 'entry', match: 'src/a.js' }],
    forbid: [{ from: 'core', to: 'entry', why: 'rdzeń nie zna wejścia' }],
  }, null, 2) + '\n',
};
export const IMPORT_LINE = { 'src/a.js': 1, 'src/b.js': 2, 'src/c.js': 3 };   // linia importu następnego pliku cyklu
