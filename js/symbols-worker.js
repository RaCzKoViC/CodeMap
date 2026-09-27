/* ===================== symbols-worker.js — tree-sitter poza głównym wątkiem =====================
   Ładuje web-tree-sitter (tree-sitter.js + tree-sitter.wasm) i gramatyki WASM z CDN dopiero przy
   pierwszym zadaniu, parsuje pliki przez CM.SymbolsCore.analyzeBatch i odsyła [{path, symbols}].
   Postęp co 20 plików, anulowanie przez nową generację (komunikat 'cancel'). Gramatyki są
   cache'owane w workerze; pliki WASM trafiają do cache HTTP przeglądarki. */
// UWAGA: NIE ustawiać self.window — emscripten w tree-sitter.js uznałby worker za okno przeglądarki,
// sięgnąłby po window.document i importScripts zgłasza wtedy mylące „failed to load". symbols-core.js
// dopisuje się do self.CM bez window.
const V = (self.location.search.match(/[?&]v=([\w.-]+)/) || [])[1] || '';
importScripts('symbols-core.js' + (V ? '?v=' + V : ''));   // wersja z URL-a workera — bez nieaktualnej kopii z cache SW
const Core = self.CM.SymbolsCore;
let TS = null, curGen = 0;
const langs = new Map();

async function ensureTS(lib) {
  if (TS) return TS;
  importScripts(lib + 'tree-sitter.js');                    // klasyczny skrypt: globalny TreeSitter
  await self.TreeSitter.init({ locateFile: (f) => lib + f });
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
      if (!langs.has(g)) langs.set(g, T.Language.load(d.urls.grammars + 'tree-sitter-' + g + '.wasm').catch((err) => { langs.delete(g); throw err; }));
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
