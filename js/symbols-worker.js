/* ===================== symbols-worker.js — tree-sitter poza głównym wątkiem =====================
   Ładuje web-tree-sitter (tree-sitter.js + tree-sitter.wasm) i gramatyki WASM z CDN dopiero przy
   pierwszym zadaniu, parsuje pliki przez CM.SymbolsCore.analyzeBatch i odsyła [{path, symbols}].
   Postęp co 20 plików, anulowanie przez nową generację (komunikat 'cancel'). Gramatyki są
   cache'owane w workerze; pliki WASM trafiają do cache HTTP przeglądarki. */
// UWAGA: NIE ustawiać self.window — emscripten w tree-sitter.js uznałby worker za okno przeglądarki,
// sięgnąłby po window.document i importScripts zgłasza wtedy mylące „failed to load". symbols-core.js
// dopisuje się do self.CM bez window.
const V = (self.location.search.match(/[?&]v=([\w.-]+)/) || [])[1] || '';
importScripts(...['symbols-core.js', 'sri.js'].map((f) => f + (V ? '?v=' + V : '')));   // wersja z URL-a workera — bez nieaktualnej kopii z cache SW
const Core = self.CM.SymbolsCore;
let TS = null, curGen = 0;
const langs = new Map();

// SRI (sri.js): kod i WASM z CDN pobierane jako bajty i sprawdzane przypiętym SHA-384 PRZED wykonaniem —
// skrypt z blob: po weryfikacji (importScripts nie ma atrybutu integrity), WASM przez wasmBinary / Language.load(bytes)
const SRI = self.CM.SRI;
async function ensureTS(lib) {
  if (TS) return TS;
  const js = await SRI.fetchVerified(lib + 'tree-sitter.js');
  const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
  try { importScripts(url); } finally { URL.revokeObjectURL(url); }   // klasyczny skrypt: globalny TreeSitter
  const wasm = new Uint8Array(await SRI.fetchVerified(lib + 'tree-sitter.wasm'));
  await self.TreeSitter.init({ locateFile: (f) => lib + f, wasmBinary: wasm });
  TS = self.TreeSitter;
  return TS;
}

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === 'cancel') { curGen = d.gen; return; }
  if (d.type !== 'analyze') return;
  const gen = d.gen; curGen = gen;
  try {
    const T = await ensureTS(d.urls.lib);
    const load = (g) => {
      if (!langs.has(g)) langs.set(g, SRI.fetchVerified(d.urls.grammars + 'tree-sitter-' + g + '.wasm').then((b) => T.Language.load(new Uint8Array(b))).catch((err) => { langs.delete(g); throw err; }));
      return langs.get(g);
    };
    const results = await Core.analyzeBatch(T, d.files || [], load, {
      cancelled: () => curGen !== gen,
      onProgress: (done, total) => { self.postMessage({ type: 'progress', gen, done, total }); return new Promise((r) => setTimeout(r, 0)); },
    });
    if (curGen !== gen) return;
    self.postMessage({ type: 'done', gen, results });
  } catch (err) {
    self.postMessage({ type: 'error', gen, message: String((err && err.message) || err) });
  }
};
