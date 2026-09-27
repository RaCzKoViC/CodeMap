// Wątek analizy (worker_threads): analyzeProject z kopii CLI w rozszerzeniu (cli/analyze.mjs, bundle.mjs).
// Analiza (odczyt plików, graf, Inspect, historia git) idzie poza wątkiem hosta rozszerzeń — nie blokuje
// innych rozszerzeń, a anulowanie to po prostu worker.terminate().
import { parentPort, workerData } from 'node:worker_threads';

const { cli, root, opts } = workerData;
try {
  const { analyzeProject } = await import(cli);
  const result = await analyzeProject(root, opts);
  parentPort.postMessage({ ok: true, result });
} catch (e) {
  parentPort.postMessage({ ok: false, error: (e && e.message) || String(e), cli: !!(e && e.name === 'CliError'), stack: e && e.stack });
}
