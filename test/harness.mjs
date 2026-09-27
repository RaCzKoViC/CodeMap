// Harness testowy: moduły CodeMap to klasyczne skrypty (IIFE → globalne CM.*), nie moduły ES.
// Ładujemy je do izolowanego kontekstu `vm` z minimalnymi stubami przeglądarki, w tej samej
// kolejności co index.html. Testy dostają obiekt CM z czystymi modułami (bez DOM, bez sieci).
// Kontekst i loader są wspólne z CLI (cli/runtime.mjs) — testy i `codemap analyze` widzą to samo środowisko.
import vm from 'node:vm';
import { ROOT, memStorage, docStub, createContext, runFile, loadCM as loadModules } from '../cli/runtime.mjs';

export { ROOT, memStorage, docStub, createContext, runFile };
/** Wartości zwracane z kontekstu vm mają prototypy obcego realmu (Array/Object), więc
 *  assert.deepStrictEqual je odrzuca — host() klonuje dane do realmu testu. */
export const host = (v) => structuredClone(v);
// kolejność = zależności przy ładowaniu (util → i18n → languages → analysis → graph → layouts)
export const CORE = ['util', 'i18n', 'languages', 'analysis', 'graph', 'physics', 'layouts'];

/** Ładuje moduły js/<name>.js w podanej kolejności i zwraca CM. */
export function loadCM(files = CORE, extra = {}) {
  return loadModules(files, extra);
}

/** Domyślne filtry widoczności (jak w app.js, ale z zależnościami zewnętrznymi i referencjami). */
export const ALL_FILTERS = { folders: true, files: true, externals: true, contains: true, import: true, reference: true, langsOff: new Set(), metric: 'lines', minMetric: 0 };

/** Worker fizyki: `setTimeout` zamieniony na kolejkę, którą test opróżnia synchronicznie. */
export function loadWorker() {
  const queue = [];
  const posted = [];
  const g = {
    console, performance, Float32Array, Math,
    postMessage: (msg) => posted.push(msg),
    importScripts: (...urls) => { for (const u of urls) runFile(ctx, 'js/' + String(u).split('?')[0]); },
    setTimeout: (fn) => { queue.push(fn); return queue.length; },
    clearTimeout: () => { queue.length = 0; },
  };
  g.self = g;
  let ctx = null;
  ctx = vm.createContext(g);
  runFile(ctx, 'js/sim-worker.js');
  const send = (data) => ctx.onmessage({ data });
  const drain = (max = 10000) => { let n = 0; while (queue.length && n++ < max) { const fn = queue.shift(); fn(); } return n; };
  return { ctx, posted, send, drain };
}
