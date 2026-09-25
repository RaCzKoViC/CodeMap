/* ===================== analysis-worker.js — analiza plików poza głównym wątkiem =====================
   Dostaje listę plików z treścią i liczy per plik: metryki (analyzeContent), importy (deps), symbole
   (regex) i hash — czyli wszystko, co dotąd blokowało UI w graph.build (jeden synchroniczny przebieg
   po 4000 plikach). Pracuje chunkami i raportuje postęp; anulowanie = nowa generacja. Główny wątek
   dostaje wyniki i buduje z nich graf (foldery, krawędzie) bez parsowania. Samowystarczalny: importuje
   te same moduły co strona (util → languages → analysis), więc regexy parserów mają jedno źródło. */
self.window = self;                                   // util.js: window.CM = window.CM || {}
importScripts('util.js', 'languages.js', 'analysis.js');
const A = self.CM.Analysis, L = self.CM.languages, U = self.CM.util;
const CHUNK = 24;                                     // plików na jeden krok (między krokami: postęp + kolejka zadań)
let curGen = 0;

self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'cancel') { curGen = d.gen || (curGen + 1); return; }
  if (d.type !== 'analyze') return;
  const gen = d.gen; curGen = gen;
  const files = d.files || []; const total = files.length;
  const results = []; let i = 0;
  const step = () => {
    if (curGen !== gen) return;                       // anulowane / zastąpione — cicho porzuć
    const end = Math.min(i + CHUNK, total);
    for (; i < end; i++) {
      const f = files[i]; const path = A.normPath(f.path);
      if (!path || f.content == null) continue;
      const info = L.lookup(A.basename(path));
      if (!info.text) continue;
      try {
        const r = A.analyzeFile(f.content, info.key);
        results.push({ path, metrics: r.metrics, deps: r.deps, symbols: r.symbols, hash: U.hashString(f.content) });
      } catch (err) { results.push({ path, error: String((err && err.message) || err) }); }
    }
    self.postMessage({ type: 'progress', gen, done: i, total });
    if (i < total) setTimeout(step, 0); else self.postMessage({ type: 'done', gen, results });
  };
  step();
};
