import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadCM } from './harness.mjs';

// SRI (js/sri.js, generowany przez tools/sri.mjs): bajty z CDN przechodzą tylko ze zgodnym SHA-384.
let body = 'console.log(1)';
const CM = loadCM(['util', 'sri'], { fetch: async () => new Response(body), Response, crypto: globalThis.crypto, btoa });
const S = CM.SRI;
const LIB = 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.22.6/tree-sitter.js';

describe('SRI dla plików z CDN', () => {
  test('manifest: tree-sitter.js + tree-sitter.wasm + gramatyki, same sha384', () => {
    const urls = Object.keys(S.HASHES);
    assert.ok(urls.includes(LIB) && urls.some((u) => u.endsWith('/tree-sitter.wasm')));
    assert.ok(urls.filter((u) => /tree-sitter-\w+\.wasm$/.test(u)).length >= 12);
    assert.ok(Object.values(S.HASHES).every((h) => /^sha384-[A-Za-z0-9+/]{64}$/.test(h)));
    assert.equal(S.integrity(LIB), S.HASHES[LIB]);
    assert.equal(S.integrity('https://evil.example/x.js'), '');
  });
  test('zgodne bajty przechodzą; podmieniony plik i adres spoza listy — wyjątek', async () => {
    const url = 'https://cdn.example/lib.js';
    S.HASHES[url] = 'sha384-' + createHash('sha384').update(body).digest('base64');
    assert.equal(Buffer.from(await S.fetchVerified(url)).toString(), body);
    body = 'console.log(1) /* podmiana */';
    await assert.rejects(S.fetchVerified(url), /nie zgadza się z przypiętym skrótem/);
    await assert.rejects(S.fetchVerified(LIB), /nie zgadza się/);
    await assert.rejects(S.fetchVerified('https://cdn.example/other.js'), /brak przypiętego skrótu/);
  });
});
