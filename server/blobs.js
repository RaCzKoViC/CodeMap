/* Strumieniowy zapis blobów na dysk (.part → rename) i rozliczanie quoty. */
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { db, BLOB_DIR } from './db.js';
import { CFG } from './config.js';

export class LimitError extends Error {
  constructor(code) { super(code); this.code = code; } // 'toobig' | 'quota'
}

export const blobAbs = (rel) => join(BLOB_DIR, rel);

const bump = db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes + ?) WHERE id = ?');
export const bumpUsage = (userId, delta) => { if (delta) bump.run(delta, userId); };

/* Ile bajtów może jeszcze przyjąć ten zapis (podmiana bloba zwalnia jego starą objętość). */
export function quotaRoom(user, replacedBytes = 0) {
  return Math.max(0, user.quota_bytes - user.used_bytes + replacedBytes);
}

export async function writeBlobStream(stream, relPath, { room }) {
  const abs = blobAbs(relPath);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = abs + '.part';
  let size = 0;
  const guard = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > CFG.maxUpload) return cb(new LimitError('toobig'));
      if (size > room) return cb(new LimitError('quota'));
      cb(null, chunk);
    },
  });
  try {
    await pipeline(stream, guard, createWriteStream(tmp));
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  await rename(tmp, abs);
  return size;
}

export async function deleteBlob(relPath) {
  await rm(blobAbs(relPath), { force: true });
}

export function sendBlob(reply, relPath, headers = {}) {
  reply.header('content-type', 'application/octet-stream');
  for (const [k, v] of Object.entries(headers)) reply.header(k, v);
  return reply.send(createReadStream(blobAbs(relPath)));
}

/* Wspólna obsługa PUT-a strumieniowego: precheck Content-Length + mapowanie błędów. */
export async function handleUpload(req, reply, relPath, replacedBytes) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > CFG.maxUpload) { reply.code(413).send({ error: 'toobig' }); return null; }
  const room = quotaRoom(req.user, replacedBytes);
  if (declared > room) { reply.code(507).send({ error: 'quota' }); return null; }
  try {
    return await writeBlobStream(req.body, relPath, { room });
  } catch (e) {
    if (e instanceof LimitError) {
      reply.code(e.code === 'quota' ? 507 : 413).send({ error: e.code });
      return null;
    }
    throw e;
  }
}
