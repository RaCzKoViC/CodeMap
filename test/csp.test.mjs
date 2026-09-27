// CSP: <meta> w index.html (GitHub Pages) i nagłówek w deploy/Caddyfile (VPS) muszą być IDENTYCZNE — pod Caddy
// obowiązują obie i przecinają się, więc różnica (np. blob: tylko w nagłówku) działa dopiero w produkcji. Nagłówek dodaje
// jedynie frame-ancestors (meta go nie obsługuje). Do tego zasady: bez inline i 'unsafe-eval' w skryptach, WebAssembly
// dozwolone, Report-Only z tymi samymi skryptami.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';

const parse = (p) => {
  const m = new Map();
  for (const part of p.split(';').map((s) => s.trim()).filter(Boolean)) { const [k, ...v] = part.split(/\s+/); m.set(k, v.sort()); }
  return m;
};
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const caddy = fs.readFileSync(path.join(ROOT, 'deploy', 'Caddyfile'), 'utf8');
const meta = parse(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1]);
const header = parse(/^\s*Content-Security-Policy "([^"]+)"/m.exec(caddy)[1]);
const report = parse(/Content-Security-Policy-Report-Only "([^"]+)"/.exec(caddy)[1]);

describe('CSP: index.html = Caddyfile', () => {
  test('te same dyrektywy i źródła; nagłówek dodaje tylko frame-ancestors', () => {
    const h = new Map(header); assert.deepEqual(h.get('frame-ancestors'), ["'self'"]); h.delete('frame-ancestors');
    assert.deepEqual(Object.fromEntries(meta), Object.fromEntries(h));
  });
  test('skrypty: bez inline i unsafe-eval, z wasm-unsafe-eval i blob: (workery); Report-Only z tymi samymi skryptami', () => {
    const s = meta.get('script-src');
    assert.ok(!s.includes("'unsafe-inline'") && !s.includes("'unsafe-eval'"), s.join(' '));
    assert.ok(s.includes("'wasm-unsafe-eval'") && s.includes('blob:') && s.includes("'self'"));
    assert.deepEqual(report.get('script-src'), s);
    assert.deepEqual(meta.get('object-src'), ["'none'"]);
  });
  test('Ollama osiągalna (connect-src http: — lokalny serwer na dowolnym porcie / hoście), także w Report-Only', () => {
    assert.ok(meta.get('connect-src').includes('http:'));
    assert.ok(report.get('connect-src').includes('http://localhost:11434') && report.get('connect-src').includes('http://127.0.0.1:11434'));
  });
});
