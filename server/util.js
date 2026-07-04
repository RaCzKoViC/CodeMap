import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export function validEmail(e) {
  return typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);
}

export function validPassword(p) {
  return typeof p === 'string' && p.length >= 10 && p.length <= 200;
}

export function normLang(l) {
  return l === 'en' ? 'en' : 'pl';
}
