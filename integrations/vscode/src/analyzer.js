// Uruchamianie analizy CodeMap w osobnym wątku (src/analyze-worker.mjs) z anulowaniem przez AbortSignal.
'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');

const WORKER = path.join(__dirname, 'analyze-worker.mjs');
const CLI_DIR = path.join(__dirname, '..', 'cli');   // kopia cli/ z korzenia repo (scripts/bundle.mjs)

class AbortError extends Error { constructor() { super('aborted'); this.name = 'AbortError'; } }

/**
 * analyzeProject(root, opts) w wątku roboczym → {graph, report, sarif, markdown}.
 * @param {string} root  katalog projektu (absolutny)
 * @param {{lang?:string, git?:boolean, exclude?:string[]}} opts  opcje analyzeProject
 * @param {{signal?:AbortSignal, cliDir?:string}} [o]
 */
function analyze(root, opts, o = {}) {
  const signal = o.signal;
  if (signal && signal.aborted) return Promise.reject(new AbortError());
  const cli = pathToFileURL(path.join(o.cliDir || CLI_DIR, 'analyze.mjs')).href;
  return new Promise((resolve, reject) => {
    let done = false;
    const w = new Worker(WORKER, { workerData: { cli, root, opts } });
    const finish = (fn, v) => {
      if (done) return; done = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(v);
    };
    const onAbort = () => { finish(reject, new AbortError()); w.terminate().catch(() => {}); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    w.once('message', (m) => {
      if (m && m.ok) finish(resolve, m.result);
      else finish(reject, Object.assign(new Error((m && m.error) || 'CodeMap: analiza nie powiodła się'), { cli: !!(m && m.cli), workerStack: m && m.stack }));
      w.terminate().catch(() => {});
    });
    w.once('error', (e) => finish(reject, e));
    w.once('exit', (code) => finish(reject, new Error('CodeMap: wątek analizy zakończył się (kod ' + code + ')')));
  });
}

module.exports = { analyze, AbortError, CLI_DIR };
