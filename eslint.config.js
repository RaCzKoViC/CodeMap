// ESLint flat config. Frontend to klasyczne skrypty z globalnym CM/CMApp; backend to ESM na Node;
// testy i narzędzia to ESM. Zestaw reguł celowo mały: łapiemy realne błędy (niezdefiniowane nazwy,
// nieosiągalny kod, duplikaty kluczy), nie styl.
const globals = require('globals');

const BROWSER_GLOBALS = {
  ...globals.browser,
  ...globals.worker,
  CM: 'writable', CMApp: 'writable',
  // biblioteki ładowane na żądanie z CDN (rough.js, php-wasm, WebLLM) i API przeglądarki spoza listy globals
  rough: 'readonly', PhpWeb: 'readonly', webllm: 'readonly',
  showDirectoryPicker: 'readonly', showOpenFilePicker: 'readonly', showSaveFilePicker: 'readonly',
  DecompressionStream: 'readonly', CompressionStream: 'readonly', OffscreenCanvas: 'readonly',
};

const CORE_RULES = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-prototype-builtins': 'off',
  'no-cond-assign': 'off',
  'no-useless-escape': 'off',
  'no-control-regex': 'off',
  'no-inner-declarations': 'off',
  'no-fallthrough': 'off',
};

module.exports = [
  { ignores: ['node_modules/**', 'server/node_modules/**', 'server/data/**', 'Sejf/**', 'docs/**', '_site/**'] },
  {
    files: ['js/**/*.js', 'sw.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: BROWSER_GLOBALS },
    rules: CORE_RULES,
  },
  {
    files: ['server/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
    rules: CORE_RULES,
  },
  {
    files: ['test/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: CORE_RULES,
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: globals.node },
  },
];
