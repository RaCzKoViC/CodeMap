/* Synchronizacja danych: manifest, ustawienia, bieżąca sesja, mapy, migawki. */
import { db, now } from './db.js';
import { handleUpload, deleteBlob, sendBlob, bumpUsage } from './blobs.js';

const ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const S = (v, max = 300) => String(v ?? '').slice(0, max);

const q = {
  getSettings: db.prepare('SELECT json, updated_at FROM settings WHERE user_id = ?'),
  putSettings: db.prepare(`INSERT INTO settings (user_id, json, updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`),

  getSess: db.prepare('SELECT * FROM session_map WHERE user_id = ?'),
  putSess: db.prepare(`INSERT INTO session_map (user_id, ts, size_bytes, blob_path) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET ts = excluded.ts, size_bytes = excluded.size_bytes`),

  listMaps: db.prepare('SELECT id, kind, name, project_key, updated_at, size_bytes FROM maps WHERE user_id = ? ORDER BY updated_at DESC'),
  getMap: db.prepare('SELECT * FROM maps WHERE user_id = ? AND id = ?'),
  putMap: db.prepare(`INSERT INTO maps (id, user_id, kind, name, project_key, updated_at, size_bytes, blob_path) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
      project_key = excluded.project_key, updated_at = excluded.updated_at, size_bytes = excluded.size_bytes`),
  delMap: db.prepare('DELETE FROM maps WHERE user_id = ? AND id = ?'),

  listSnaps: db.prepare('SELECT id, project_key, ts, label, name, source, signature, size_bytes FROM snapshots WHERE user_id = ? ORDER BY ts DESC'),
  listSnapsProj: db.prepare('SELECT id, project_key, ts, label, name, source, signature, size_bytes FROM snapshots WHERE user_id = ? AND project_key = ? ORDER BY ts DESC'),
  getSnap: db.prepare('SELECT * FROM snapshots WHERE user_id = ? AND id = ?'),
  putSnap: db.prepare(`INSERT INTO snapshots (id, user_id, project_key, ts, label, name, source, signature, size_bytes, blob_path) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, id) DO NOTHING`),
  delSnap: db.prepare('DELETE FROM snapshots WHERE user_id = ? AND id = ?'),
  setSnapSig: db.prepare('UPDATE snapshots SET signature = ? WHERE user_id = ? AND id = ?'),

  vaultMeta: db.prepare('SELECT album, updated_at FROM vault_meta WHERE user_id = ?'),
  vaultFiles: db.prepare('SELECT album, name, size_bytes, mtime FROM vault_files WHERE user_id = ?'),
};

export async function registerSync(app) {
  const auth = { preHandler: app.requireAuth };

  app.get('/api/sync/manifest', auth, async (req) => {
    const u = req.user;
    const settings = q.getSettings.get(u.id);
    const sess = q.getSess.get(u.id);
    const vault = { vault: { metaUpdatedAt: null, files: [] }, fav: { metaUpdatedAt: null, files: [] } };
    for (const m of q.vaultMeta.all(u.id)) vault[m.album].metaUpdatedAt = m.updated_at;
    for (const f of q.vaultFiles.all(u.id)) vault[f.album].files.push({ name: f.name, size: f.size_bytes, mtime: f.mtime });
    return {
      settings: settings ? { updatedAt: settings.updated_at } : null,
      session: sess ? { ts: sess.ts, size: sess.size_bytes } : null,
      maps: q.listMaps.all(u.id).map(m => ({ id: m.id, kind: m.kind, name: m.name, projectKey: m.project_key, updatedAt: m.updated_at, size: m.size_bytes })),
      snapshots: q.listSnaps.all(u.id).map(s => ({ id: s.id, projectKey: s.project_key, ts: s.ts, label: s.label, name: s.name, source: s.source, signature: s.signature, size: s.size_bytes })),
      vault,
      usage: { usedBytes: u.used_bytes, quotaBytes: u.quota_bytes },
    };
  });

  // --- ustawienia (mały JSON, last-write-wins) ---
  app.get('/api/settings', auth, async (req) => {
    const row = q.getSettings.get(req.user.id);
    return row ? { json: row.json, updatedAt: row.updated_at } : { json: null, updatedAt: 0 };
  });

  app.put('/api/settings', auth, async (req, reply) => {
    const { json, updatedAt } = req.body || {};
    if (typeof json !== 'string' || json.length > 256 * 1024) return reply.code(400).send({ error: 'json' });
    const ts = Number(updatedAt) || now();
    const cur = q.getSettings.get(req.user.id);
    if (cur && cur.updated_at > ts) return reply.code(409).send({ json: cur.json, updatedAt: cur.updated_at });
    q.putSettings.run(req.user.id, json, ts);
    return { ok: true };
  });

  // --- bieżąca sesja (jeden slot na użytkownika) ---
  app.get('/api/session', auth, async (req, reply) => {
    const row = q.getSess.get(req.user.id);
    if (!row) return reply.code(404).send({ error: 'empty' });
    return sendBlob(reply, row.blob_path, { 'x-cm-ts': row.ts });
  });

  app.put('/api/session', auth, async (req, reply) => {
    const ts = Number(req.query?.ts) || now();
    const cur = q.getSess.get(req.user.id);
    if (cur && cur.ts > ts) return reply.code(409).send({ error: 'newer', ts: cur.ts });
    const rel = `${req.user.id}/session.bin`;
    const size = await handleUpload(req, reply, rel, cur?.size_bytes || 0);
    if (size === null) return;
    q.putSess.run(req.user.id, ts, size, rel);
    return { ok: true, size };
  });

  // --- zapisane mapy ---
  app.get('/api/maps', auth, async (req) =>
    q.listMaps.all(req.user.id).map(m => ({ id: m.id, kind: m.kind, name: m.name, projectKey: m.project_key, updatedAt: m.updated_at, size: m.size_bytes })));

  app.get('/api/maps/:id', auth, async (req, reply) => {
    const row = ID_RE.test(req.params.id) ? q.getMap.get(req.user.id, req.params.id) : null;
    if (!row) return reply.code(404).send({ error: 'notfound' });
    return sendBlob(reply, row.blob_path, { 'x-cm-ts': row.updated_at });
  });

  app.put('/api/maps/:id', auth, async (req, reply) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return reply.code(400).send({ error: 'id' });
    const kind = req.query?.kind === 'mindmap' ? 'mindmap' : 'codemap';
    const ts = Number(req.query?.updatedAt) || now();
    const cur = q.getMap.get(req.user.id, id);
    if (cur && cur.updated_at > ts) return reply.code(409).send({ error: 'newer', updatedAt: cur.updated_at });
    const rel = `${req.user.id}/maps/${id}.bin`;
    const size = await handleUpload(req, reply, rel, cur?.size_bytes || 0);
    if (size === null) return;
    q.putMap.run(id, req.user.id, kind, S(req.query?.name, 200) || 'mapa', S(req.query?.projectKey) || null, ts, size, rel);
    return { ok: true, size };
  });

  app.delete('/api/maps/:id', auth, async (req, reply) => {
    const row = ID_RE.test(req.params.id) ? q.getMap.get(req.user.id, req.params.id) : null;
    if (!row) return reply.code(404).send({ error: 'notfound' });
    q.delMap.run(req.user.id, row.id);
    bumpUsage(req.user.id, -row.size_bytes);
    await deleteBlob(row.blob_path);
    return { ok: true };
  });

  // --- migawki (niemutowalne: ponowny PUT tego samego id jest idempotentny) ---
  app.get('/api/snapshots', auth, async (req) => {
    const pk = req.query?.projectKey;
    const rows = pk ? q.listSnapsProj.all(req.user.id, S(pk)) : q.listSnaps.all(req.user.id);
    return rows.map(s => ({ id: s.id, projectKey: s.project_key, ts: s.ts, label: s.label, name: s.name, source: s.source, signature: s.signature, size: s.size_bytes }));
  });

  app.get('/api/snapshots/:id', auth, async (req, reply) => {
    const row = ID_RE.test(req.params.id) ? q.getSnap.get(req.user.id, req.params.id) : null;
    if (!row) return reply.code(404).send({ error: 'notfound' });
    return sendBlob(reply, row.blob_path, { 'x-cm-ts': row.ts });
  });

  app.put('/api/snapshots/:id', auth, async (req, reply) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return reply.code(400).send({ error: 'id' });
    const cur = q.getSnap.get(req.user.id, id);
    if (cur) { req.body.resume?.(); return { ok: true, size: cur.size_bytes }; }
    const rel = `${req.user.id}/snapshots/${id}.bin`;
    const size = await handleUpload(req, reply, rel, 0);
    if (size === null) return;
    q.putSnap.run(id, req.user.id, S(req.query?.projectKey) || 'projekt', Number(req.query?.ts) || now(),
      S(req.query?.label, 200) || null, S(req.query?.name, 200) || null, S(req.query?.source) || null, null, size, rel);
    return { ok: true, size };
  });

  // Sygnatura (duży JSON do porównań między migawkami) nie mieści się w nagłówku ani query —
  // dociera osobnym małym PUT-em po wgraniu treści.
  app.put('/api/snapshots/:id/meta', auth, async (req, reply) => {
    const id = req.params.id;
    if (!ID_RE.test(id) || !q.getSnap.get(req.user.id, id)) return reply.code(404).send({ error: 'notfound' });
    const sig = req.body?.signature;
    if (typeof sig !== 'string' || sig.length > 3 * 1024 * 1024) return reply.code(400).send({ error: 'signature' });
    q.setSnapSig.run(sig, req.user.id, id);
    return { ok: true };
  });

  app.delete('/api/snapshots/:id', auth, async (req, reply) => {
    const row = ID_RE.test(req.params.id) ? q.getSnap.get(req.user.id, req.params.id) : null;
    if (!row) return reply.code(404).send({ error: 'notfound' });
    q.delSnap.run(req.user.id, row.id);
    bumpUsage(req.user.id, -row.size_bytes);
    await deleteBlob(row.blob_path);
    return { ok: true };
  });
}
