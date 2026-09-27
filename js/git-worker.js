/* ===================== git-worker.js — historia git poza głównym wątkiem =====================
   Czyta katalog .git przez CM.GitLocal (js/git-local.js) i odsyła listę commitów z plikami.
   Wejście:  {type:'log', id, files:[{path, file}], opts:{max, ref}}  (File/Blob bez kopiowania treści)
             {type:'cancel', id}
   Wyjście:  {type:'progress', id, done, total} · {type:'done', id, head, commits, stats} · {type:'error', id, code, message} */
// UWAGA: nie ustawiać self.window — git-local.js dopisuje się do self.CM i nie potrzebuje okna.
const V = (self.location.search.match(/[?&]v=([\w.-]+)/) || [])[1] || '';
importScripts('git-local.js' + (V ? '?v=' + V : ''));      // wersja z URL-a workera — bez nieaktualnej kopii z cache SW
const Git = self.CM.GitLocal;
const jobs = new Map();                                     // id → AbortController

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === 'cancel') { const c = jobs.get(d.id); if (c) c.abort(); return; }
  if (d.type !== 'log') return;
  const id = d.id, ctrl = new AbortController();
  jobs.set(id, ctrl);
  try {
    const opts = Object.assign({}, d.opts, {
      signal: ctrl.signal,
      onProgress: (p) => self.postMessage({ type: 'progress', id, done: p.done, total: p.total }),
    });
    const res = await Git.runInThread(d.files || [], opts);
    self.postMessage({ type: 'done', id, head: res.head, commits: res.commits, stats: res.stats });
  } catch (err) {
    self.postMessage({ type: 'error', id, code: (err && err.code) || 'error', message: String((err && err.message) || err) });
  } finally {
    jobs.delete(id);
  }
};
