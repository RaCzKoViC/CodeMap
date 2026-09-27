// Wspólne dla testów tras (app.inject): tymczasowy katalog danych i zmienne środowiskowe PRZED importem aplikacji
// (config.js czyta je przy imporcie), aplikacja bez listen i sprzątanie po testach, konto z hasłem (argon2 z małym
// kosztem) zalogowane przez /api/auth/login, zapytania z rotacją adresu IP (rate-limit logowania), bajty jako
// application/octet-stream, zużycie quoty konta. Każdy plik testów to osobny proces node:test — osobna baza.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PASS = 'test-password-123';

/**
 * @param {string} name   nazwa katalogu tymczasowego (codemap-<name>-…)
 * @param {object} env    dodatkowe zmienne środowiskowe (limity z config.js)
 * @param {{subnet?:number, onClose?:()=>void}} o  subnet — druga liczba adresu IP (osobna pula dla pliku testów)
 */
export async function testApp(name, env = {}, { subnet = 1, onClose } = {}) {
  const DIR = mkdtempSync(join(tmpdir(), 'codemap-' + name + '-'));
  Object.assign(process.env, { DATA_DIR: DIR, NODE_ENV: 'test', EMAIL_MODE: 'console', APP_ORIGIN: 'http://localhost:8787', ...env });
  const appMod = await import('../app.js');
  const { db, BLOB_DIR } = await import('../db.js');
  const argon2 = (await import('argon2')).default;
  const app = await appMod.buildApp({ logger: false, serveStatic: false });
  after(async () => { if (onClose) onClose(); await app.close(); db.close(); rmSync(DIR, { recursive: true, force: true }); });

  let ip = 0;
  const call = (u, method, url, payload, headers = {}) => app.inject({ method, url, payload,
    headers: { 'x-forwarded-for': '10.' + subnet + '.' + (Math.floor(++ip / 250) % 250) + '.' + (ip % 250 + 1), ...(u ? { cookie: u.cookie } : {}), ...headers } });
  const bin = (u, url, data, method = 'PUT') => call(u, method, url, Buffer.from(data), { 'content-type': 'application/octet-stream' });
  async function user(email, quota = 10 * 1024 * 1024) {
    const hash = await argon2.hash(PASS, { type: argon2.argon2id, memoryCost: 4096, timeCost: 1, parallelism: 1 });
    db.prepare('INSERT INTO users (email, pass_hash, lang, verified_at, quota_bytes, created_at) VALUES (?,?,?,?,?,?)')
      .run(email, hash, 'pl', Date.now(), quota, Date.now());
    const r = await call(null, 'POST', '/api/auth/login', { email, password: PASS });
    assert.equal(r.statusCode, 200, r.body);
    return { cookie: 'cm_sess=' + r.cookies.find((x) => x.name === 'cm_sess').value, id: db.prepare('SELECT id FROM users WHERE email = ?').get(email).id };
  }
  const used = (u) => db.prepare('SELECT used_bytes FROM users WHERE id = ?').get(typeof u === 'object' ? u.id : u).used_bytes;
  return { DIR, app, appMod, db, BLOB_DIR, call, bin, user, used };
}
