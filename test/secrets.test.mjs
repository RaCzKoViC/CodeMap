import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, CORE } from './harness.mjs';

const L = loadCM([...CORE, 'loaders']).Loaders;

test('pliki z sekretami: węzeł tak, treść nie (podgląd, mapa, publiczny link, RAG, CLI)', () => {
  for (const f of ['.env', 'server/.env', '.env.local', '.env.production', 'id_rsa', 'deploy/id_ed25519', 'cert.pem', 'tls.key', 'app.p12', '.npmrc', '.netrc'])
    assert.equal(L.isTextFile(f, 100), false, f);
  for (const f of ['.env.example', 'server/.env.sample', '.env.template', 'src/key.js', 'keys.json', 'README.md', 'pem-utils.ts'])
    assert.equal(L.isSecretFile(f), false, f);
  assert.equal(L.isTextFile('server/.env.example', 100), true);
});
