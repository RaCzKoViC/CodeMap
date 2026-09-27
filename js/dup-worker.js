/* ===================== dup-worker.js — duplikaty kodu poza głównym wątkiem (faza 13) =====================
   Odciski winnowing (CM.Metrics.fingerprints) i parowanie w ciągłe bloki (pairDuplicates) dla kandydatów przysłanych
   przez CM.Metrics.findDuplicatesAsync. Odciski zapamiętane po skrócie treści pliku (hash + długość podglądu), więc
   ponowna analiza (tryb na żywo, drugi Inspect) liczy od nowa tylko zmienione pliki. Te same moduły co strona. */
self.window = self;                                   // util.js: window.CM = window.CM || {}
const V = (self.location && self.location.search.match(/[?&]v=([\w.-]+)/) || [])[1] || '';
importScripts(...['util.js', 'metrics.js'].map((f) => f + (V ? '?v=' + V : '')));
const M = self.CM.Metrics;
const cache = new Map(), MAX_CACHE = 20000;           // klucz → odciski (z pozycjami)

self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type !== 'dups') return;
  const cand = [], fps = []; let hits = 0;
  for (const it of d.items || []) {
    const key = it.hash ? it.hash + ':' + it.len : null;
    let fp = key ? cache.get(key) : null;
    if (fp) hits++;
    else {
      fp = M.fingerprints(it.text || '', d.opts || undefined);
      if (key) { cache.set(key, fp); if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); }
    }
    cand.push({ id: it.id }); fps.push(fp);
  }
  const pairs = M.pairDuplicates(cand, fps, d.opts || undefined);
  self.postMessage({ type: 'dups', id: d.id, pairs, hits, total: cand.length });
};
