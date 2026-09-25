/* Bootstrap API CodeMap: Fastify + cookie + rate-limit (+ static w dev). */
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './config.js';
import { registerAuth, gcAuth } from './auth.js';
import { registerSync } from './sync.js';
import { registerVault } from './vault.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// Serializer żądania BEZ query stringa: domyślny log Fastify zapisuje pełny req.url, czyli tokeny
// weryfikacji/resetu (?token=…) i nazwy map/migawek trafiałyby do journald. Logi błędów zostają.
const app = Fastify({
  logger: { serializers: { req: (req) => ({ method: req.method, path: req.url.split('?')[0], ip: req.ip }) } },
  trustProxy: true,
  bodyLimit: 4 * 1024 * 1024,
});

// Odpowiedzi API (mapy, szyfrogramy Sejfu, dane konta) nigdy nie lądują w cache HTTP przeglądarki.
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
    if (origin && origin !== CFG.appOrigin) return reply.code(403).send({ error: 'origin' });
  }
  done();
});

app.get('/api/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

await registerAuth(app);
gcAuth();
setInterval(gcAuth, 3600 * 1000).unref();   // wygasłe sesje, tokeny, blokady logowania, dziennik maili
await registerSync(app);
await registerVault(app);

if (!CFG.prod) {
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

// Prod: tylko loopback (Caddy proxuje). Dev: też loopback, chyba że HOST=0.0.0.0 w .env (świadome
// wystawienie w LAN — pamiętaj, że rate-limit per IP jest wtedy podatny na spoofing X-Forwarded-For).
app.listen({ port: CFG.port, host: CFG.prod ? '127.0.0.1' : CFG.host })
  .then(() => console.log(`CodeMap API: ${CFG.appOrigin} (port ${CFG.port}, mail: ${CFG.emailMode})`))
  .catch((err) => { app.log.error(err); process.exit(1); });
