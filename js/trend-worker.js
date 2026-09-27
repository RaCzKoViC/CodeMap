/* ===================== trend-worker.js — trend zdrowia poza głównym wątkiem (faza 13) =====================
   Dostaje pliki katalogu .git ([{path, file}], jak git-worker.js) i liczy CM.HealthTrend.compute: dla każdego punktu
   drzewo z .git, graf i analiza statyczna — to, co w wątku strony blokowało interfejs na sekundy przy dużych
   repozytoriach. Te same moduły co CLI; przeglądarkowe API, których dotykają przy ładowaniu, zastępują atrapy (jak
   cli/runtime.mjs). Punkty z pamięci strony (`known`: sha → punkt) nie są liczone od nowa. Anulowanie = terminate(). */
self.window = self;
const V = (self.location && self.location.search.match(/[?&]v=([\w.-]+)/) || [])[1] || '';
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
  removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length(){ return m.size; } }; };
const el = () => { const e = { style: {}, dataset: {}, children: [], attributes: {}, classList: { add(){}, remove(){}, toggle(){ return false; }, contains(){ return false; } },
  setAttribute(k, v){ e.attributes[k] = v; }, getAttribute(k){ return e.attributes[k] ?? null; }, appendChild(c){ return c; }, removeChild(){}, remove(){},
  addEventListener(){}, removeEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }, textContent: '', innerHTML: '' }; return e; };
self.localStorage = memStorage(); self.sessionStorage = memStorage();
self.document = { body: el(), head: el(), documentElement: el(), readyState: 'complete', hidden: true, title: '',
  querySelector(){ return null; }, querySelectorAll(){ return []; }, getElementById(){ return null; },
  createElement: el, createElementNS: el, createTextNode: (t) => ({ textContent: t }), createDocumentFragment: el,
  addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; } };
self.Worker = undefined;                              // bez zagnieżdżonych workerów: duplikaty liczone tutaj
importScripts(...['util', 'i18n', 'languages', 'analysis', 'graph', 'metrics', 'git-core', 'rules', 'testmap', 'git-local',
  'loaders', 'dsm', 'codeowners', 'vulns', 'deadcode', 'inspect', 'health-trend'].map((f) => f + '.js' + (V ? '?v=' + V : '')));

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type !== 'trend') return;
  const known = d.known || {};
  try {
    const repo = await self.CM.GitLocal.open(d.files);
    const h = await self.CM.HealthTrend.compute(repo, { n: d.n, sub: d.sub || '', exclude: d.exclude || [],
      cache: { get: (sha) => known[sha] || null, set: () => {} },
      onPoint: (p, i, total) => self.postMessage({ type: 'progress', id: d.id, p, i, total }) });
    self.postMessage({ type: 'done', id: d.id, h });
  } catch (err) {
    self.postMessage({ type: 'error', id: d.id, message: (err && err.message) || String(err), code: err && err.code });
  }
};
