// Środowisko uruchomieniowe modułów CodeMap poza przeglądarką (CLI i testy): moduły to klasyczne
// skrypty (IIFE → globalne CM.*), nie moduły ES. Ładujemy je do izolowanego kontekstu `vm`
// z minimalnymi stubami przeglądarki, w tej samej kolejności co index.html — ta sama logika
// analizy co w aplikacji, bez kopiowania kodu. Bez DOM, bez sieci, bez Workerów.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Moduły potrzebne analizie headless (kolejność = zależności przy ładowaniu, jak w index.html). */
export const CLI_MODULES = ['util', 'icons', 'i18n', 'languages', 'analysis', 'graph', 'physics', 'layouts', 'export', 'metrics',
  'git-core', 'rules', 'testmap', 'pr-core', 'git-local', 'loaders', 'dsm', 'codeowners', 'vulns', 'inspect', 'health-trend'];

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

// Celowo BEZ MessageChannel i Worker: moduły wtedy oddają sterowanie przez setTimeout i liczą w bieżącym
// wątku (w Node port MessageChannel z onmessage trzymałby proces przy życiu).
export function createContext(extra = {}) {
  const g = {};
  g.window = g; g.self = g; g.globalThis = g;
  Object.assign(g, {
    console, performance, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    structuredClone, TextEncoder, TextDecoder, URL, URLSearchParams, Blob,
    DecompressionStream, CompressionStream, AbortController,   // js/git-local.js (zlib, anulowanie)
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
export function loadCM(files, extra = {}) {
  const ctx = createContext(extra);
  for (const f of files) runFile(ctx, `js/${f}.js`);
  return ctx.CM;
}

/** CM z modułami analizy headless; lang = 'pl' | 'en' (teksty reguł Inspect, szczegóły znalezisk). */
export function loadCodeMap({ lang = 'pl' } = {}) {
  const ctx = createContext({
    navigator: { language: lang, languages: [lang], onLine: false, userAgent: 'codemap-cli', storage: { persist: async () => false } },
    fetch: () => Promise.reject(new Error('CodeMap CLI: brak sieci')),
  });
  for (const f of CLI_MODULES) runFile(ctx, `js/${f}.js`);
  const CM = ctx.CM;
  CM.i18n.setLang(lang);
  return CM;
}
