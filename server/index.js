/* Bootstrap API CodeMap: Fastify + cookie + rate-limit (+ static w dev). */
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './config.js';
import { registerAuth } from './auth.js';
import { registerSync } from './sync.js';
import { registerVault } from './vault.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 4 * 1024 * 1024 });

// Duże treści (mapy, bloby Sejfu) płyną strumieniem — nigdy nie buforujemy ich w RAM.
app.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload));

await app.register(fastifyCookie);
await app.register(fastifyRateLimit, { global: true, max: 300, timeWindow: '1 minute' });

// CSRF: przy żądaniach zmieniających stan nagłówek Origin (jeśli obecny) musi być nasz.
app.addHook('onRequest', (req, reply, done) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.url.startsWith('/api/')) {
    const origin = req.headers.origin;
    if (origin && origin !== CFG.appOrigin) return reply.code(403).send({ error: 'origin' });
  }
  done();
});

app.get('/api/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

await registerAuth(app);
await registerSync(app);
await registerVault(app);

if (!CFG.prod) {
  // Dev: Node serwuje też frontend, żeby aplikacja i API były same-origin (prod robi to Caddy).
  await app.register(fastifyStatic, { root: join(HERE, '..') });
}

app.listen({ port: CFG.port, host: CFG.prod ? '127.0.0.1' : '0.0.0.0' })
  .then(() => console.log(`CodeMap API: ${CFG.appOrigin} (port ${CFG.port}, mail: ${CFG.emailMode})`))
  .catch((err) => { app.log.error(err); process.exit(1); });
