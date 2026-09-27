/* Publiczne linki do map (Faza 4): zalogowany użytkownik publikuje KOPIĘ mapy pod losowym, nieprzewidywalnym id;
   każdy, kto zna link, pobiera ją bez logowania (GET /api/share/:id).
   Bezpieczeństwo:
   • id = 18 bajtów z crypto.randomBytes (144 bity, base64url) — nie do zgadnięcia; odpowiedź 404 jest IDENTYCZNA
     dla nieistniejącego, wygasłego, unieważnionego i źle zbudowanego id (brak wyroczni istnienia);
   • publiczna odpowiedź: application/json + nosniff (przeglądarka nie zinterpretuje treści jako HTML/skryptu),
     Cross-Origin-Resource-Policy: same-origin, brak nagłówków CORS (czytać może tylko nasz frontend),
     X-Robots-Tag: noindex, Cache-Control: no-store (hook w app.js) — unieważnienie i wygaśnięcie działają
     natychmiast, nie ma kopii w cache pośredników, licznik wyświetleń jest rzetelny; bez Set-Cookie (trasa nie
     dotyka sesji);
   • tworzenie: sesja sprawdzana w onRequest (zanim serwer przeczyta ciało), tylko application/json, limit
     rozmiaru (MAX_SHARE_BYTES), walidacja format:"codemap", ponowna serializacja (zapisujemy wyłącznie poprawny
     JSON), rezerwacja quoty atomowo, limit liczby aktywnych linków na konto, rate limit;
   • usuwanie: tylko właściciel (cudzy link = 404, jak nieistniejący);
   • logi: bez treści map; id w ścieżce jest maskowane w serializerze żądań (app.js). */
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { db, now } from './db.js';
import { CFG } from './config.js';
import { storeBuffer, deleteBlob, bumpUsage, blobAbs } from './blobs.js';

export const SHARE_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;
const DAY = 24 * 3600 * 1000;
const MAX_NODES = 500000;

const q = {
  insert: db.prepare('INSERT INTO shares (id, user_id, name, size_bytes, blob_path, created_at, expires_at) VALUES (?,?,?,?,?,?,?)'),
  exists: db.prepare('SELECT 1 FROM shares WHERE id = ?'),
  countUser: db.prepare('SELECT COUNT(*) AS n FROM shares WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)'),
  listUser: db.prepare(`SELECT id, name, size_bytes, created_at, expires_at, views FROM shares
    WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC`),
  getOwn: db.prepare('SELECT * FROM shares WHERE id = ? AND user_id = ?'),
  getLive: db.prepare('SELECT blob_path FROM shares WHERE id = ? AND (expires_at IS NULL OR expires_at > ?)'),
  view: db.prepare('UPDATE shares SET views = views + 1 WHERE id = ?'),
  del: db.prepare('DELETE FROM shares WHERE id = ? AND user_id = ?'),
  expired: db.prepare('SELECT id, user_id, size_bytes, blob_path FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ?'),
  delById: db.prepare('DELETE FROM shares WHERE id = ?'),
};

const shareUrl = (id) => `${CFG.appOrigin}/#share=${id}`;
const pub = (r) => ({ id: r.id, name: r.name, size: r.size_bytes, createdAt: r.created_at, expiresAt: r.expires_at, views: r.views, url: shareUrl(r.id) });
// nazwa widoczna tylko dla właściciela (lista) — bez znaków sterujących, max 200 znaków
const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '');

function newId() {
  for (;;) { const id = randomBytes(18).toString('base64url'); if (!q.exists.get(id)) return id; }
}

/* '' = poprawna mapa; inaczej kod błędu dla klienta */
export function validateMap(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.pipe === 'function') return 'map';
  if (m.format !== 'codemap') return 'format';
  if (!Array.isArray(m.nodes) || !m.nodes.length || m.nodes.length > MAX_NODES) return 'map';
  if (m.edges != null && !Array.isArray(m.edges)) return 'map';
  if (m.meta != null && (typeof m.meta !== 'object' || Array.isArray(m.meta))) return 'map';
  for (const n of m.nodes) if (!n || typeof n !== 'object' || typeof n.id !== 'string') return 'map';
  return '';
}

/* Wygasłe linki: rekord, blob i miejsce w quocie (wywoływane co godzinę z index.js) */
export async function gcShares() {
  const rows = q.expired.all(now());
  for (const r of rows) {
    q.delById.run(r.id);
    bumpUsage(r.user_id, -r.size_bytes);
    await deleteBlob(r.blob_path).catch(() => {});
  }
  return rows.length;
}

export async function registerShares(app) {
  const auth = { preHandler: app.requireAuth };

  // przed odczytem ciała: sesja (401), typ treści (415), zadeklarowany rozmiar (413)
  const precheck = async (req, reply) => {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return reply.code(415).send({ error: 'type' });
    if (Number(req.headers['content-length'] || 0) > CFG.maxShare) return reply.code(413).send({ error: 'toobig' });
  };
  // błędy parsera ciała (za duże / nie-JSON / __proto__) → krótkie kody; do logu tylko kod, nigdy fragment treści
  const bodyErrors = (err, req, reply) => {
    const sc = err.statusCode || 500;
    if (sc === 413) return reply.code(413).send({ error: 'toobig' });
    if (sc === 415) return reply.code(415).send({ error: 'type' });
    if (sc >= 400 && sc < 500) return reply.code(400).send({ error: 'json' });
    req.log.error({ code: err.code }, 'share create failed');
    return reply.code(500).send({ error: 'server' });
  };

  app.post('/api/shares', {
    bodyLimit: CFG.maxShare,
    onRequest: [app.requireAuth, precheck],
    errorHandler: bodyErrors,
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const map = req.body;
    const bad = validateMap(map);
    if (bad) return reply.code(400).send({ error: bad });
    let expiresAt = null;
    const exp = req.query?.expiresInDays;
    if (exp != null && exp !== '') {
      const d = Number(exp);
      if (!Number.isInteger(d) || d < 1 || d > 365) return reply.code(400).send({ error: 'expires' });
      expiresAt = now() + d * DAY;
    }
    if (q.countUser.get(req.user.id, now()).n >= CFG.maxSharesPerUser) return reply.code(409).send({ error: 'limit' });
    const buf = Buffer.from(JSON.stringify(map), 'utf8');
    if (buf.length > CFG.maxShare) return reply.code(413).send({ error: 'toobig' });
    const id = newId();
    const rel = `${req.user.id}/shares/${id}.json`;
    if (!await storeBuffer(req.user.id, rel, buf)) return reply.code(507).send({ error: 'quota' });
    const name = cleanName(req.query?.name) || cleanName(map.meta?.name) || 'mapa';
    q.insert.run(id, req.user.id, name, buf.length, rel, now(), expiresAt);
    return reply.code(201).send({ id, url: shareUrl(id), name, size: buf.length, expiresAt });
  });

  app.get('/api/shares', auth, async (req) => q.listUser.all(req.user.id, now()).map(pub));

  app.delete('/api/shares/:id', auth, async (req, reply) => {
    const id = String(req.params.id || '');
    const row = SHARE_ID_RE.test(id) ? q.getOwn.get(id, req.user.id) : null;
    if (!row) return reply.code(404).send({ error: 'notfound' });   // cudzy = nieistniejący
    q.del.run(id, req.user.id);
    bumpUsage(req.user.id, -row.size_bytes);
    await deleteBlob(row.blob_path);
    return { ok: true };
  });

  // PUBLICZNY odczyt — bez sesji, bez ciasteczek, bez CORS
  app.get('/api/share/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff')
      .header('cross-origin-resource-policy', 'same-origin')
      .header('x-robots-tag', 'noindex, nofollow')
      .header('referrer-policy', 'no-referrer');
    const id = String(req.params.id || '');
    const row = SHARE_ID_RE.test(id) ? q.getLive.get(id, now()) : null;
    const abs = row ? blobAbs(row.blob_path) : null;
    if (!abs || !await access(abs).then(() => true, () => false)) return reply.code(404).send({ error: 'notfound' });
    if (req.method === 'GET') q.view.run(id);   // HEAD (automatyczny dla GET) nie liczy się jako wyświetlenie
    reply.header('content-type', 'application/json; charset=utf-8');
    return reply.send(createReadStream(abs));
  });
}
