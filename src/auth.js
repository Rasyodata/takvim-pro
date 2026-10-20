'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { ApiError, now } = require('./util');

const hashPassword = (pw) => bcrypt.hash(pw, config.BCRYPT_ROUNDS);
const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { const k = p.slice(0, i).trim(); try { out[k] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) { /* yoksay */ } }
  });
  return out;
}

function cookieOpts(maxAgeSec) {
  return [`Path=/`, 'HttpOnly', 'SameSite=Lax', config.COOKIE_SECURE ? 'Secure' : '', maxAgeSec != null ? `Max-Age=${maxAgeSec}` : ''].filter(Boolean).join('; ');
}

async function createSession(db, res, userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const created = now();
  const expires = new Date(Date.now() + config.SESSION_DAYS * 86400000).toISOString();
  await db.run('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)', [sha(token), userId, created, expires, String(userAgent || '').slice(0, 300)]);
  res.setHeader('Set-Cookie', `${config.COOKIE_NAME}=${token}; ${cookieOpts(config.SESSION_DAYS * 86400)}`);
}

async function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[config.COOKIE_NAME];
  if (token) await db.run('DELETE FROM sessions WHERE id = ?', [sha(token)]);
  res.setHeader('Set-Cookie', `${config.COOKIE_NAME}=; ${cookieOpts(0)}`);
}

/** Her istekte oturumu çözer: req.user ayarlanır (yoksa null). */
function sessionMiddleware(db) {
  let lastCleanup = 0;
  return async (req, res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[config.COOKIE_NAME];
    if (token) {
      const row = await db.get(
        `SELECT u.id, u.name, u.email, u.role, u.is_active, u.is_sample, s.expires_at
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [sha(token)]);
      if (row && row.expires_at > now() && row.is_active) req.user = row;
      else if (row) await db.run('DELETE FROM sessions WHERE id = ?', [sha(token)]);
    }
    if (Date.now() - lastCleanup > 3600000) { lastCleanup = Date.now(); await db.run('DELETE FROM sessions WHERE expires_at < ?', [now()]); }
    next();
  };
}

const requireAuth = (req, _res, next) => { if (!req.user) return next(new ApiError(401, 'Oturum açmanız gerekiyor.')); next(); };
const requireAdmin = (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'Oturum açmanız gerekiyor.'));
  if (req.user.role !== 'admin') return next(new ApiError(403, 'Bu sayfa yalnızca yöneticiler içindir.'));
  next();
};

/** Basit bellek içi kaba kuvvet koruması: 15 dakikada en fazla 10 başarısız deneme (IP+e-posta). */
const attempts = new Map();
const LIMIT = 10, WINDOW = 15 * 60 * 1000;
function loginGuard(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= LIMIT) throw new ApiError(429, 'Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin.');
}
function loginFailed(key) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + WINDOW });
  else a.count++;
  if (attempts.size > 10000) attempts.clear();
}
const loginOk = (key) => attempts.delete(key);

module.exports = { hashPassword, verifyPassword, createSession, destroySession, sessionMiddleware, requireAuth, requireAdmin, loginGuard, loginFailed, loginOk, parseCookies };
