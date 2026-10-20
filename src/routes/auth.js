'use strict';
const config = require('../config');
const sample = require('../sample');
const A = require('../auth');
const { V, ApiError, uid, now, bad } = require('../util');
const { publicUser, ensurePersonalColumns, logActivity } = require('../services');

// Zamanlama saldırılarına karşı: kullanıcı yoksa da bir karşılaştırma yapılır
let dummyHash = null;
const getDummy = async () => dummyHash || (dummyHash = await A.hashPassword('takvim-dummy-' + Math.random()));

module.exports = (r, db) => {
  r.get('/config', async (_req, res) => {
    let demo = null;
    if (config.SHOW_DEMO_HINT) {
      const rows = await db.all("SELECT email FROM users WHERE is_sample = 1 AND is_active = 1", []);
      const present = new Set(rows.map((x) => x.email));
      demo = sample.USERS.filter((u) => present.has(u.email)).map((u) => ({ email: u.email, password: u.password, role: u.role, name: u.name }));
      if (!demo.length) demo = null;
    }
    const n = await db.get('SELECT COUNT(*) AS n FROM users', []);
    res.json({ tz: config.APP_TZ, allowRegistration: config.ALLOW_REGISTRATION || Number(n.n) === 0, demoAccounts: demo });
  });

  r.post('/auth/register', async (req, res) => {
    const b = V.object(req.body);
    const count = Number((await db.get('SELECT COUNT(*) AS n FROM users', [])).n);
    if (!config.ALLOW_REGISTRATION && count > 0) throw new ApiError(403, 'Kayıt kapalı. Hesap için yöneticinize başvurun.');
    const name = V.str(b.name, 'Ad soyad', { required: true, min: 2, max: 80, field: 'name' });
    const email = V.email(b.email);
    const password = V.password(b.password);
    if (await db.get('SELECT id FROM users WHERE email = ?', [email])) throw new ApiError(409, 'Bu e-posta adresiyle kayıtlı bir hesap zaten var.', 'email');
    const hash = await A.hashPassword(password);
    const id = uid(); const t = now();
    const role = count === 0 ? 'admin' : 'user'; // ilk kullanıcı yönetici olur
    await db.tx(async () => {
      await db.run('INSERT INTO users (id, name, email, password_hash, role, is_active, is_sample, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)', [id, name, email, hash, role, t, t, t]);
      await ensurePersonalColumns(db, id);
      await logActivity(db, { userId: id, entityType: 'user', entityId: id, action: 'registered', details: { name } });
    });
    await A.createSession(db, res, id, req.get('user-agent'));
    res.status(201).json({ user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [id])) });
  });

  r.post('/auth/login', async (req, res) => {
    const b = V.object(req.body);
    const email = V.email(b.email);
    if (typeof b.password !== 'string' || !b.password) throw bad('Şifre gerekli.', 'password');
    const key = (req.ip || '') + '|' + email;
    A.loginGuard(key);
    const u = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    const ok = await A.verifyPassword(b.password, u ? u.password_hash : await getDummy());
    if (!u || !ok) { A.loginFailed(key); throw new ApiError(401, 'E-posta veya şifre hatalı.'); }
    if (!u.is_active) throw new ApiError(403, 'Hesabınız devre dışı bırakılmış. Yöneticinize başvurun.');
    A.loginOk(key);
    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), u.id]);
    await ensurePersonalColumns(db, u.id);
    await A.createSession(db, res, u.id, req.get('user-agent'));
    res.json({ user: publicUser(u) });
  });

  r.post('/auth/logout', async (req, res) => { await A.destroySession(db, req, res); res.json({ ok: true }); });

  // Oturum durumu (giriş yapılmamışsa 401 yerine user: null döner; tarayıcı konsolunu kirletmez)
  r.get('/auth/session', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

  r.get('/auth/me', A.requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

  r.patch('/auth/me', A.requireAuth, async (req, res) => {
    const b = V.object(req.body);
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const name = V.str(b.name, 'Ad soyad', { min: 2, max: 80, field: 'name' });
    let hash = null;
    if (b.newPassword != null) {
      if (typeof b.currentPassword !== 'string' || !(await A.verifyPassword(b.currentPassword, u.password_hash))) throw bad('Mevcut şifre hatalı.', 'currentPassword');
      hash = await A.hashPassword(V.password(b.newPassword, { field: 'newPassword' }));
    }
    await db.run('UPDATE users SET name = COALESCE(?, name), password_hash = COALESCE(?, password_hash), updated_at = ? WHERE id = ?', [name || null, hash, now(), u.id]);
    if (hash) { await db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]); await A.createSession(db, res, u.id, req.get('user-agent')); }
    res.json({ user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [u.id])) });
  });
};
