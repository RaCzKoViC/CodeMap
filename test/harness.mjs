// Harness testowy: moduły CodeMap to klasyczne skrypty (IIFE → globalne CM.*), nie moduły ES.
// Ładujemy je do izolowanego kontekstu `vm` z minimalnymi stubami przeglądarki, w tej samej
// kolejności co index.html. Testy dostają obiekt CM z czystymi modułami (bez DOM, bez sieci).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Wartości zwracane z kontekstu vm mają prototypy obcego realmu (Array/Object), więc
 *  assert.deepStrictEqual je odrzuca — host() klonuje dane do realmu testu. */
export const host = (v) => structuredClone(v);
// kolejność = zależności przy ładowaniu (util → i18n → languages → analysis → graph → layouts)
export const CORE = ['util', 'i18n', 'languages', 'analysis', 'graph', 'layouts'];

export function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

function elementStub() {
  const el = {
    style: {}, dataset: {}, children: [], childNodes: [], attributes: {},
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    setAttribute(k, v) { el.attributes[k] = v; }, getAttribute(k) { return el.attributes[k] ?? null; },
    appendChild(c) { el.children.push(c); return c; }, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    textContent: '', innerHTML: '', innerText: '', value: '', hidden: false,
  };
  return el;
}

export function docStub() {
  const body = elementStub(), head = elementStub(), html = elementStub();
  return {
    body, head, documentElement: html, title: '', readyState: 'complete', hidden: false,
    querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
    createElement() { return elementStub(); }, createElementNS() { return elementStub(); },
    createTextNode(t) { return { textContent: t }; }, createDocumentFragment() { return elementStub(); },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  };
}

export function createContext(extra = {}) {
  const g = {};
  g.window = g; g.self = g; g.globalThis = g;
  Object.assign(g, {
    console, performance, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    structuredClone, TextEncoder, TextDecoder, URL, URLSearchParams, Blob,
    crypto: globalThis.crypto,
    localStorage: memStorage(), sessionStorage: memStorage(),
    navigator: { language: 'pl', languages: ['pl'], onLine: true, userAgent: 'node-test', storage: { persist: async () => false } },
    location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', hash: '', search: '', protocol: 'http:' },
    document: docStub(),
    fetch: () => Promise.reject(new Error('no network in tests')),
    requestAnimationFrame: (f) => setTimeout(() => f(performance.now()), 0),
    cancelAnimationFrame: (h) => clearTimeout(h),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    addEventListener() {}, removeEventListener() {},
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800,
  }, extra);
  return vm.createContext(g);
}

export function runFile(ctx, rel) {
  const file = path.join(ROOT, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
  return ctx;
}

/** Ładuje moduły js/<name>.js w podanej kolejności i zwraca CM. */
export function loadCM(files = CORE, extra = {}) {
  const ctx = createContext(extra);
  for (const f of files) runFile(ctx, `js/${f}.js`);
  return ctx.CM;
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
    setTimeout: (fn) => { queue.push(fn); return queue.length; },
    clearTimeout: () => { queue.length = 0; },
  };
  g.self = g;
  const ctx = vm.createContext(g);
  runFile(ctx, 'js/sim-worker.js');
  const send = (data) => ctx.onmessage({ data });
  const drain = (max = 10000) => { let n = 0; while (queue.length && n++ < max) { const fn = queue.shift(); fn(); } return n; };
  return { ctx, posted, send, drain };
}
