'use strict';
const A = require('../auth');
const { V, ApiError, uid, now, notFound, bad } = require('../util');
const { publicUser, ensurePersonalColumns, logActivity } = require('../services');

module.exports = (r, db) => {
  r.use('/admin', A.requireAdmin);

  const listUsers = async () => (await db.all(`
    SELECT u.*,
      (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id) AS owned_projects,
      (SELECT COUNT(*) FROM project_members pm WHERE pm.user_id = u.id) AS memberships,
      (SELECT COUNT(*) FROM tasks t JOIN board_columns c ON c.id = t.column_id WHERE t.assignee_id = u.id AND c.is_done = 0) AS open_assigned
    FROM users u ORDER BY u.created_at`, [])).map((u) => Object.assign(publicUser(u), {
    createdAt: u.created_at, lastLoginAt: u.last_login_at, ownedProjects: Number(u.owned_projects), memberships: Number(u.memberships), openAssigned: Number(u.open_assigned),
  }));
  const activeAdmins = async (exceptId) => Number((await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?", [exceptId || ''])).n);

  r.get('/admin/users', async (_req, res) => res.json({ users: await listUsers() }));

  r.post('/admin/users', async (req, res) => {
    const b = V.object(req.body);
    const name = V.str(b.name, 'Ad soyad', { required: true, min: 2, max: 80, field: 'name' });
    const email = V.email(b.email);
    const password = V.password(b.password);
    const role = V.oneOf(b.role || 'user', 'Rol', ['admin', 'user'], { field: 'role' });
    if (await db.get('SELECT id FROM users WHERE email = ?', [email])) throw new ApiError(409, 'Bu e-posta adresi zaten kullanılıyor.', 'email');
    const hash = await A.hashPassword(password);
    const id = uid(); const t = now();
    await db.tx(async () => {
      await db.run('INSERT INTO users (id, name, email, password_hash, role, is_active, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [id, name, email, hash, role, t, t]);
      await ensurePersonalColumns(db, id);
      await logActivity(db, { userId: req.user.id, entityType: 'user', entityId: id, action: 'created', details: { name, email } });
    });
    res.status(201).json({ user: (await listUsers()).find((u) => u.id === id) });
  });

  r.patch('/admin/users/:id', async (req, res) => {
    const b = V.object(req.body);
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) throw notFound('Kullanıcı bulunamadı.');
    const name = V.str(b.name, 'Ad soyad', { min: 2, max: 80, field: 'name' });
    const email = b.email != null ? V.email(b.email) : null;
    const role = V.oneOf(b.role, 'Rol', ['admin', 'user'], { field: 'role' });
    const isActive = V.bool(b.isActive, 'Etkin');
    const hash = b.password ? await A.hashPassword(V.password(b.password)) : null;
    if (email && email !== u.email && await db.get('SELECT id FROM users WHERE email = ?', [email])) throw new ApiError(409, 'Bu e-posta adresi zaten kullanılıyor.', 'email');
    const losesAdmin = u.role === 'admin' && u.is_active && ((role && role !== 'admin') || isActive === false);
    if (losesAdmin && (await activeAdmins(u.id)) === 0) throw bad('Sistemde en az bir etkin yönetici kalmalı.');
    if (u.id === req.user.id && isActive === false) throw bad('Kendi hesabınızı devre dışı bırakamazsınız.');
    await db.tx(async () => {
      await db.run(`UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), role = COALESCE(?, role),
        is_active = COALESCE(?, is_active), password_hash = COALESCE(?, password_hash), updated_at = ? WHERE id = ?`,
      [name || null, email, role || null, isActive == null ? null : (isActive ? 1 : 0), hash, now(), u.id]);
      if (isActive === false || hash) await db.run('DELETE FROM sessions WHERE user_id = ? AND user_id <> ?', [u.id, req.user.id]);
      await logActivity(db, { userId: req.user.id, entityType: 'user', entityId: u.id, action: 'updated', details: { name: name || u.name } });
    });
    res.json({ user: (await listUsers()).find((x) => x.id === u.id) });
  });

  r.delete('/admin/users/:id', async (req, res) => {
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) throw notFound('Kullanıcı bulunamadı.');
    if (u.id === req.user.id) throw bad('Kendi hesabınızı silemezsiniz.');
    if (u.role === 'admin' && (await activeAdmins(u.id)) === 0) throw bad('Son yönetici silinemez.');
    await db.tx(async () => {
      await db.run('DELETE FROM users WHERE id = ?', [u.id]);
      await logActivity(db, { userId: req.user.id, entityType: 'user', entityId: u.id, action: 'deleted', details: { name: u.name, email: u.email } });
    });
    res.json({ ok: true });
  });

  // Tüm örnek verileri (örnek kullanıcılar dahil, oturum açmış yönetici hariç) siler
  r.delete('/admin/sample-data', async (req, res) => {
    const counts = {};
    await db.tx(async () => {
      counts.events = (await db.run('DELETE FROM events WHERE is_sample = 1', [])).changes;
      counts.tasks = (await db.run('DELETE FROM tasks WHERE is_sample = 1', [])).changes;
      counts.projects = (await db.run('DELETE FROM projects WHERE is_sample = 1', [])).changes;
      counts.users = (await db.run('DELETE FROM users WHERE is_sample = 1 AND id <> ?', [req.user.id])).changes;
      await db.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM task_tags)', []);
    });
    res.json({ ok: true, deleted: counts });
  });
};
