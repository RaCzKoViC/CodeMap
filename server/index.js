/* Start serwera API CodeMap: fabryka z app.js + sprzątanie co godzinę + listen. */
import { CFG } from './config.js';
import { buildApp } from './app.js';
import { gcAuth } from './auth.js';
import { gcShares } from './shares.js';

const app = await buildApp();

// wygasłe sesje, tokeny, blokady logowania, dziennik maili oraz wygasłe publiczne linki (z blobami i quotą)
const gc = () => { gcAuth(); gcShares().catch((err) => app.log.error({ err }, 'gcShares failed')); };
gc();
setInterval(gc, 3600 * 1000).unref();

// Prod: tylko loopback (Caddy proxuje). Dev: też loopback, chyba że HOST=0.0.0.0 w .env (świadome
// wystawienie w LAN — pamiętaj, że rate-limit per IP jest wtedy podatny na spoofing X-Forwarded-For).
app.listen({ port: CFG.port, host: CFG.prod ? '127.0.0.1' : CFG.host })
  .then(() => console.log(`CodeMap API: ${CFG.appOrigin} (port ${CFG.port}, mail: ${CFG.emailMode})`))
  .catch((err) => { app.log.error(err); process.exit(1); });
