/* Fabryka aplikacji: Fastify + cookie + rate-limit + trasy (+ static w dev), BEZ listen i timerów.
   index.js = serwer (npm start), server/test/*.test.mjs = app.inject na tymczasowej bazie (DATA_DIR). */
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
import { registerShares } from './shares.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// Ścieżka do logów: bez query stringa (tokeny weryfikacji/resetu ?token=…, nazwy map i migawek) i z zamaskowanym
// id publicznego linku — id JEST kluczem dostępu, więc nie może leżeć w journald.
export function logPath(url) {
  return String(url || '').split('?')[0].replace(/^(\/api\/shares?\/)[^/]+/, '$1:id');
}
export const LOGGER = { serializers: { req: (req) => ({ method: req.method, path: logPath(req.url), ip: req.ip }) } };

export async function buildApp({ logger = LOGGER, serveStatic = !CFG.prod } = {}) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 4 * 1024 * 1024 });

  // Odpowiedzi API (mapy, szyfrogramy Sejfu, dane konta, publiczne linki) nigdy nie lądują w cache HTTP.
  app.addHook('onSend', (req, reply, payload, done) => {
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    done(null, payload);
  });

  // Duże treści (mapy, bloby Sejfu) płyną strumieniem — nigdy nie buforujemy ich w RAM.
  app.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload));

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  // CSRF: przy żądaniach zmieniających stan nagłówek Origin (jeśli obecny) musi być nasz.
  app.addHook('onRequest', (req, reply, done) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.url.startsWith('/api/')) {
      const origin = req.headers.origin;
      // dev: aplikacja bywa otwierana jako localhost, 127.0.0.1 albo z innego portu (serve.py + API) —
      // każdy lokalny origin jest nasz. Prod: wyłącznie APP_ORIGIN.
      const localDev = !CFG.prod && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin || '');
      if (origin && origin !== CFG.appOrigin && !localDev) return reply.code(403).send({ error: 'origin' });
    }
    done();
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

  await registerAuth(app);
  await registerSync(app);
  await registerVault(app);
  await registerShares(app);

  if (serveStatic) {
    // Dev: Node serwuje też frontend, żeby aplikacja i API były same-origin (prod robi to Caddy).
    // Root to katalog repozytorium, więc serwujemy WYŁĄCZNIE pliki frontendu z allowlisty —
    // nigdy server/ (.env, SQLite, logi), Sejf/, .git, .claude, docs ani plików z kropką.
    // no-store: edytowane pliki mają być widoczne od razu, bez walki z cache przeglądarki.
    const FRONT_RE = /^\/(index\.html|manifest\.webmanifest|sw\.js|icon-[\w-]+\.png|js\/[\w.-]+\.js|css\/[\w.-]+\.css)?$/;
    await app.register(fastifyStatic, {
      root: join(HERE, '..'),
      dotfiles: 'deny',
      allowedPath: (pathName) => FRONT_RE.test(pathName),
      setHeaders: (reply) => reply.header('Cache-Control', 'no-store'),   // @fastify/static ≥10: fn(reply, path, stat)
    });
  }
  return app;
}
