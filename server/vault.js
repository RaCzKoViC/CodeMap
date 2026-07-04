/* Sejf/Ulubione w chmurze: serwer przechowuje wyłącznie szyfrogram (enc:true wymuszone). */
import { db, now } from './db.js';
import { handleUpload, deleteBlob, sendBlob, bumpUsage } from './blobs.js';
import { sha256hex } from './util.js';

const ALBUMS = new Set(['vault', 'fav']);

const q = {
  getMeta: db.prepare('SELECT meta_json, updated_at FROM vault_meta WHERE user_id = ? AND album = ?'),
  putMeta: db.prepare(`INSERT INTO vault_meta (user_id, album, meta_json, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id, album) DO UPDATE SET meta_json = excluded.meta_json, updated_at = excluded.updated_at`),
  listFiles: db.prepare('SELECT name, size_bytes, mtime FROM vault_files WHERE user_id = ? AND album = ? ORDER BY name'),
  getFile: db.prepare('SELECT * FROM vault_files WHERE user_id = ? AND album = ? AND name = ?'),
  putFile: db.prepare(`INSERT INTO vault_files (user_id, album, name, size_bytes, mtime, blob_path) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id, album, name) DO UPDATE SET size_bytes = excluded.size_bytes, mtime = excluded.mtime`),
  delFile: db.prepare('DELETE FROM vault_files WHERE user_id = ? AND album = ? AND name = ?'),
};

function albumOf(req, reply) {
  const a = req.params.album;
  if (!ALBUMS.has(a)) { reply.code(400).send({ error: 'album' }); return null; }
  return a;
}

function fileName(req, reply) {
  const n = String(req.params.name || '');
  if (!n || n.length > 255 || n.includes('/') || n.includes('\\')) { reply.code(400).send({ error: 'name' }); return null; }
  return n;
}

export async function registerVault(app) {
  const auth = { preHandler: app.requireAuth };

  app.get('/api/vault/:album', auth, async (req, reply) => {
    const album = albumOf(req, reply); if (!album) return;
    const meta = q.getMeta.get(req.user.id, album);
    return {
      meta: meta ? { json: meta.meta_json, updatedAt: meta.updated_at } : null,
      files: q.listFiles.all(req.user.id, album).map(f => ({ name: f.name, size: f.size_bytes, mtime: f.mtime })),
    };
  });

  app.put('/api/vault/:album/meta', auth, async (req, reply) => {
    const album = albumOf(req, reply); if (!album) return;
    const { json, updatedAt } = req.body || {};
    let parsed = null;
    try { parsed = JSON.parse(json); } catch (e) {}
    // Chmura przyjmuje wyłącznie albumy zaszyfrowane — serwer nigdy nie widzi treści plików.
    if (!parsed || parsed.enc !== true) return reply.code(400).send({ error: 'plain' });
    q.putMeta.run(req.user.id, album, String(json).slice(0, 8192), Number(updatedAt) || now());
    return { ok: true };
  });

  app.put('/api/vault/:album/files/:name', auth, async (req, reply) => {
    const album = albumOf(req, reply); if (!album) return;
    const name = fileName(req, reply); if (!name) return;
    const meta = q.getMeta.get(req.user.id, album);
    let enc = false;
    try { enc = JSON.parse(meta?.meta_json || '{}').enc === true; } catch (e) {}
    if (!enc) return reply.code(400).send({ error: 'plain' });
    const cur = q.getFile.get(req.user.id, album, name);
    const rel = `${req.user.id}/${album}/${sha256hex(name)}.bin`;
    const size = await handleUpload(req, reply, rel, cur?.size_bytes || 0);
    if (size === null) return;
    q.putFile.run(req.user.id, album, name, size, Number(req.query?.mtime) || now(), rel);
    bumpUsage(req.user.id, size - (cur?.size_bytes || 0));
    return { ok: true, size };
  });

  app.get('/api/vault/:album/files/:name', auth, async (req, reply) => {
    const album = albumOf(req, reply); if (!album) return;
    const name = fileName(req, reply); if (!name) return;
    const row = q.getFile.get(req.user.id, album, name);
    if (!row) return reply.code(404).send({ error: 'notfound' });
    return sendBlob(reply, row.blob_path, { 'x-cm-mtime': row.mtime });
  });

  app.delete('/api/vault/:album/files/:name', auth, async (req, reply) => {
    const album = albumOf(req, reply); if (!album) return;
    const name = fileName(req, reply); if (!name) return;
    const row = q.getFile.get(req.user.id, album, name);
    if (!row) return reply.code(404).send({ error: 'notfound' });
    q.delFile.run(req.user.id, album, name);
    bumpUsage(req.user.id, -row.size_bytes);
    await deleteBlob(row.blob_path);
    return { ok: true };
  });
}
