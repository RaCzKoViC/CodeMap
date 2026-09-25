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

/* Atomowa rezerwacja miejsca PRZED zapisem: jeden UPDATE z warunkiem, więc N równoległych PUT-ów
   nie może razem przekroczyć quoty (wcześniej każdy liczył wolne miejsce z req.user odczytanego
   na początku żądania — klasyczne TOCTOU, którym jedno konto zapełniało dysk).
   replacedBytes = rozmiar nadpisywanego bloba — zwalnia się dopiero po udanym zapisie. */
const reserve = db.prepare('UPDATE users SET used_bytes = used_bytes + ? WHERE id = ? AND used_bytes + ? <= quota_bytes + ?');

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

/* Wspólna obsługa PUT-a strumieniowego: precheck Content-Length, rezerwacja quoty, zapis,
   rozliczenie końcowe (rezerwacja → realny rozmiar, stary blob zwolniony). Wywołujący NIE robi
   już własnego bumpUsage po zapisie — cała księgowość uploadu jest tutaj. */
export async function handleUpload(req, reply, relPath, replacedBytes = 0) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > CFG.maxUpload) { reply.code(413).send({ error: 'toobig' }); return null; }
  // Bez Content-Length (chunked) rezerwujemy maksymalny upload i korygujemy po zapisie.
  const hold = declared || CFG.maxUpload;
  const r = reserve.run(hold, req.user.id, hold, replacedBytes);
  if (r.changes !== 1) { reply.code(507).send({ error: 'quota' }); return null; }
  let size;
  try {
    size = await writeBlobStream(req.body, relPath, { room: hold });
  } catch (e) {
    bumpUsage(req.user.id, -hold);   // zwolnij rezerwację
    if (e instanceof LimitError) {
      reply.code(e.code === 'quota' ? 507 : 413).send({ error: e.code });
      return null;
    }
    throw e;
  }
  bumpUsage(req.user.id, size - hold - replacedBytes);
  return size;
}
