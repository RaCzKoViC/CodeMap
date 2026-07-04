/* Konta: rejestracja, weryfikacja e-mail, sesje (ciasteczko httpOnly), reset hasła. */
import argon2 from 'argon2';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { db, BLOB_DIR, now } from './db.js';
import { randomToken, sha256hex, validEmail, validPassword, normLang } from './util.js';
import { sendVerifyMail, sendResetMail, sendExistsMail } from './mailer.js';
import { CFG } from './config.js';

const ARGON = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
const SESSION_MS = 30 * 24 * 3600 * 1000;
const VERIFY_TTL = 24 * 3600 * 1000;
const RESET_TTL = 30 * 60 * 1000;

const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (email, pass_hash, lang, quota_bytes, created_at) VALUES (?,?,?,?,?)'),
  setVerified: db.prepare('UPDATE users SET verified_at = ? WHERE id = ?'),
  setPass: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  insertToken: db.prepare('INSERT INTO email_tokens (user_id, kind, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)'),
  tokenByHash: db.prepare('SELECT * FROM email_tokens WHERE token_hash = ?'),
  useToken: db.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?'),
  dropTokens: db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL'),

  insertSess: db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?,?,?,?,?,?,?)'),
  sessById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  touchSess: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?'),
  deleteSess: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteUserSess: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  deleteOtherSess: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?'),
};

// Wyrównanie czasu odpowiedzi logowania, gdy konto nie istnieje.
const DUMMY_HASH = await argon2.hash('dummy-password-for-timing', ARGON);

const secureCookie = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(CFG.appOrigin);
const cookieOpts = { httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/', maxAge: SESSION_MS / 1000 };

function createSession(reply, user, req) {
  const token = randomToken();
  q.insertSess.run(sha256hex(token), user.id, now(), now(), now() + SESSION_MS,
    String(req.headers['user-agent'] || '').slice(0, 200), req.ip);
  reply.setCookie('cm_sess', token, cookieOpts);
}

function issueEmailToken(userId, kind, ttl) {
  q.dropTokens.run(userId, kind);
  const token = randomToken();
  q.insertToken.run(userId, kind, sha256hex(token), now() + ttl, now());
  return token;
}

function userInfo(u) {
  return { email: u.email, quotaBytes: u.quota_bytes, usedBytes: u.used_bytes, createdAt: u.created_at };
}

async function mailSafe(p, log) {
  try { await p; } catch (e) { log.error({ err: e }, 'mail delivery failed'); }
}

export async function registerAuth(app) {
  app.decorate('requireAuth', async (req, reply) => {
    const raw = req.cookies?.cm_sess;
    const sess = raw ? q.sessById.get(sha256hex(raw)) : null;
    if (!sess || sess.expires_at < now()) return reply.code(401).send({ error: 'auth' });
    const user = q.userById.get(sess.user_id);
    if (!user || user.disabled) return reply.code(401).send({ error: 'auth' });
    if (now() - sess.last_seen_at > 3600 * 1000) q.touchSess.run(now(), now() + SESSION_MS, sess.id);
    req.user = user;
    req.sessId = sess.id;
  });

  app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { email, password, lang } = req.body || {};
    if (!validEmail(email)) return reply.code(400).send({ error: 'email' });
    if (!validPassword(password)) return reply.code(400).send({ error: 'password' });
    const existing = q.userByEmail.get(email);
    if (existing) {
      // Odporność na enumerację: ta sama odpowiedź, a właściciel konta dostaje powiadomienie.
      await mailSafe(sendExistsMail(existing.email, existing.lang), req.log);
      return { ok: true };
    }
    const hash = await argon2.hash(password, ARGON);
    const { lastInsertRowid: id } = q.insertUser.run(email, hash, normLang(lang), CFG.defaultQuota, now());
    const token = issueEmailToken(id, 'verify', VERIFY_TTL);
    await mailSafe(sendVerifyMail(email, normLang(lang), token), req.log);
    return { ok: true };
  });

  app.get('/api/auth/verify', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const t = req.query?.token ? q.tokenByHash.get(sha256hex(String(req.query.token))) : null;
    const ok = t && t.kind === 'verify' && !t.used_at && t.expires_at >= now();
    if (ok) {
      q.useToken.run(now(), t.id);
      q.setVerified.run(now(), t.user_id);
    }
    return reply.redirect(`/?verified=${ok ? 1 : 0}`);
  });

  app.post('/api/auth/resend-verification', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req) => {
    const { email } = req.body || {};
    const user = validEmail(email) ? q.userByEmail.get(email) : null;
    if (user && !user.verified_at) {
      const token = issueEmailToken(user.id, 'verify', VERIFY_TTL);
      await mailSafe(sendVerifyMail(user.email, user.lang, token), req.log);
    }
    return { ok: true };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { email, password } = req.body || {};
    const user = validEmail(email) ? q.userByEmail.get(email) : null;
    const ok = await argon2.verify(user ? user.pass_hash : DUMMY_HASH, String(password || ''));
    if (!user || !ok || user.disabled) return reply.code(401).send({ error: 'credentials' });
    if (!user.verified_at) return reply.code(403).send({ error: 'unverified' });
    createSession(reply, user, req);
    return userInfo(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies?.cm_sess;
    if (raw) q.deleteSess.run(sha256hex(raw));
    reply.clearCookie('cm_sess', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: app.requireAuth }, async (req) => userInfo(req.user));

  app.post('/api/auth/request-reset', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const { email } = req.body || {};
    const user = validEmail(email) ? q.userByEmail.get(email) : null;
    if (user) {
      const token = issueEmailToken(user.id, 'reset', RESET_TTL);
      await mailSafe(sendResetMail(user.email, user.lang, token), req.log);
    }
    return { ok: true };
  });

  app.post('/api/auth/reset', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { token, password } = req.body || {};
    if (!validPassword(password)) return reply.code(400).send({ error: 'password' });
    const t = token ? q.tokenByHash.get(sha256hex(String(token))) : null;
    if (!t || t.kind !== 'reset' || t.used_at || t.expires_at < now()) return reply.code(400).send({ error: 'token' });
    q.useToken.run(now(), t.id);
    q.setPass.run(await argon2.hash(password, ARGON), t.user_id);
    q.deleteUserSess.run(t.user_id);
    return { ok: true };
  });

  app.post('/api/auth/change-password', { preHandler: app.requireAuth }, async (req, reply) => {
    const { current, next } = req.body || {};
    if (!validPassword(next)) return reply.code(400).send({ error: 'password' });
    if (!await argon2.verify(req.user.pass_hash, String(current || ''))) return reply.code(401).send({ error: 'credentials' });
    q.setPass.run(await argon2.hash(next, ARGON), req.user.id);
    q.deleteOtherSess.run(req.user.id, req.sessId);
    return { ok: true };
  });

  app.delete('/api/auth/account', { preHandler: app.requireAuth }, async (req, reply) => {
    const { password } = req.body || {};
    if (!await argon2.verify(req.user.pass_hash, String(password || ''))) return reply.code(401).send({ error: 'credentials' });
    q.deleteUser.run(req.user.id);
    reply.clearCookie('cm_sess', { path: '/' });
    await rm(join(BLOB_DIR, String(req.user.id)), { recursive: true, force: true });
    return { ok: true };
  });
}
