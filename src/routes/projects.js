'use strict';
const A = require('../auth');
const { V, uid, now, bad, notFound, ApiError } = require('../util');
const S = require('../services');

module.exports = (r, db) => {
  r.use(['/projects', '/columns'], A.requireAuth);

  // ---------------- Projeler ----------------
  r.get('/projects', async (req, res) => res.json({ projects: await S.loadProjects(db, req.user.id) }));

  r.post('/projects', async (req, res) => {
    const b = V.object(req.body);
    const name = V.str(b.name, 'Proje adı', { required: true, max: 80, field: 'name' });
    const color = V.color(b.color) || '#6366f1';
    const description = V.str(b.description, 'Açıklama', { max: 2000 }) || '';
    const memberIds = Array.isArray(b.memberIds) ? b.memberIds.slice(0, 100) : [];
    const id = uid(); const t = now();
    await db.tx(async () => {
      await db.run('INSERT INTO projects (id, owner_id, name, color, description, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)', [id, req.user.id, name, color, description, t, t]);
      await db.run("INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)", [id, req.user.id, t]);
      for (const m of memberIds) {
        if (m === req.user.id) continue;
        const u = await db.get('SELECT id FROM users WHERE id = ? AND is_active = 1', [V.id(m, 'Üye')]);
        if (!u) throw bad('Üye bulunamadı.', 'memberIds');
        await db.run("INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'member', ?) ON CONFLICT DO NOTHING", [id, u.id, t]);
      }
      await S.createDefaultColumns(db, { projectId: id });
      await S.logActivity(db, { userId: req.user.id, projectId: id, entityType: 'project', entityId: id, action: 'created', details: { name } });
    });
    res.status(201).json({ project: (await S.loadProjects(db, req.user.id)).find((p) => p.id === id) });
  });

  r.get('/projects/:id', async (req, res) => {
    await S.requireMember(db, req.params.id, req.user.id);
    res.json({ project: (await S.loadProjects(db, req.user.id)).find((p) => p.id === req.params.id) });
  });

  r.patch('/projects/:id', async (req, res) => {
    const b = V.object(req.body);
    const { project } = await S.requireOwner(db, req.params.id, req.user.id);
    const name = V.str(b.name, 'Proje adı', { max: 80, field: 'name' });
    if (name === '') throw bad('Proje adı gerekli.', 'name');
    const color = V.color(b.color);
    const description = V.str(b.description, 'Açıklama', { max: 2000 });
    await db.run('UPDATE projects SET name = COALESCE(?, name), color = COALESCE(?, color), description = COALESCE(?, description), updated_at = ? WHERE id = ?', [name || null, color || null, description == null ? null : description, now(), project.id]);
    await S.logActivity(db, { userId: req.user.id, projectId: project.id, entityType: 'project', entityId: project.id, action: 'updated', details: { name: name || project.name } });
    res.json({ project: (await S.loadProjects(db, req.user.id)).find((p) => p.id === project.id) });
  });

  r.delete('/projects/:id', async (req, res) => {
    const { project } = await S.requireOwner(db, req.params.id, req.user.id);
    await db.tx(async () => {
      await db.run('DELETE FROM projects WHERE id = ?', [project.id]); // sütunlar, görevler, üyelikler CASCADE ile silinir
      await S.logActivity(db, { userId: req.user.id, entityType: 'project', entityId: project.id, action: 'deleted', details: { name: project.name } });
    });
    res.json({ ok: true });
  });

  // ---------------- Üyeler ----------------
  r.get('/projects/:id/members', async (req, res) => {
    await S.requireMember(db, req.params.id, req.user.id);
    const rows = await db.all('SELECT u.id, u.name, u.email, pm.role, pm.added_at FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY pm.added_at', [req.params.id]);
    res.json({ members: rows.map((m) => ({ userId: m.id, name: m.name, email: m.email, role: m.role, addedAt: m.added_at })) });
  });

  r.post('/projects/:id/members', async (req, res) => {
    const b = V.object(req.body);
    const { project } = await S.requireOwner(db, req.params.id, req.user.id);
    let u;
    if (b.userId) u = await db.get('SELECT id, name FROM users WHERE id = ? AND is_active = 1', [V.id(b.userId, 'Kullanıcı')]);
    else u = await db.get('SELECT id, name FROM users WHERE email = ? AND is_active = 1', [V.email(b.email)]);
    if (!u) throw notFound('Kullanıcı bulunamadı.');
    if (await S.memberRole(db, project.id, u.id)) throw new ApiError(409, 'Bu kullanıcı zaten proje üyesi.');
    await db.run("INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'member', ?)", [project.id, u.id, now()]);
    await S.logActivity(db, { userId: req.user.id, projectId: project.id, entityType: 'project', entityId: project.id, action: 'member_added', details: { member: u.name } });
    res.status(201).json({ project: (await S.loadProjects(db, req.user.id)).find((p) => p.id === project.id) });
  });

  r.delete('/projects/:id/members/:userId', async (req, res) => {
    const { project } = await S.requireMember(db, req.params.id, req.user.id);
    const target = req.params.userId;
    const self = target === req.user.id;
    if (!self && project.owner_id !== req.user.id) throw new ApiError(403, 'Üyeleri yalnızca proje sahibi çıkarabilir.');
    if (target === project.owner_id) throw bad('Proje sahibi projeden ayrılamaz. Projeyi silebilirsiniz.');
    const u = await db.get('SELECT name FROM users WHERE id = ?', [target]);
    await db.tx(async () => {
      const r1 = await db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, target]);
      if (!r1.changes) throw notFound('Üye bulunamadı.');
      await db.run('UPDATE tasks SET assignee_id = NULL, updated_at = ? WHERE project_id = ? AND assignee_id = ?', [now(), project.id, target]);
      await S.logActivity(db, { userId: req.user.id, projectId: project.id, entityType: 'project', entityId: project.id, action: self ? 'member_left' : 'member_removed', details: { member: u && u.name } });
    });
    res.json({ ok: true });
  });

  // ---------------- Sütunlar ----------------
  async function scopeFrom(projectId, userId) {
    if (projectId) { await S.requireMember(db, projectId, userId); return { projectId, where: ['project_id = ?', projectId] }; }
    return { projectId: null, where: ['user_id = ?', userId] };
  }
  const scopeCols = (w) => db.all(`SELECT * FROM board_columns WHERE ${w[0]} ORDER BY position, created_at`, [w[1]]);

  r.get('/columns', async (req, res) => {
    if (req.query.projectId === undefined) return res.json({ columns: await S.loadColumns(db, req.user.id) });
    const sc = await scopeFrom(req.query.projectId === 'personal' ? null : req.query.projectId, req.user.id);
    res.json({ columns: (await scopeCols(sc.where)).map(S.serCol) });
  });

  r.post('/columns', async (req, res) => {
    const b = V.object(req.body);
    const name = V.str(b.name, 'Sütun adı', { required: true, max: 60, field: 'name' });
    const isDone = V.bool(b.isDone, 'Tamamlandı') || false;
    const sc = await scopeFrom(V.id(b.projectId, 'Proje'), req.user.id);
    const id = uid();
    await db.tx(async () => {
      const cols = await scopeCols(sc.where);
      if (cols.length >= 20) throw bad('Bir panoda en fazla 20 sütun olabilir.');
      let idx = Number.isInteger(b.position) ? Math.max(0, Math.min(b.position, cols.length)) : (isDone ? cols.length : cols.findIndex((c) => c.is_done));
      if (idx < 0) idx = cols.length;
      cols.splice(idx, 0, { id });
      await db.run('INSERT INTO board_columns (id, project_id, user_id, name, position, is_done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, sc.projectId, sc.projectId ? null : req.user.id, name, idx, isDone ? 1 : 0, now()]);
      for (let i = 0; i < cols.length; i++) await db.run('UPDATE board_columns SET position = ? WHERE id = ?', [i, cols[i].id]);
      await S.logActivity(db, { userId: req.user.id, projectId: sc.projectId, entityType: 'column', entityId: id, action: 'created', details: { name } });
    });
    res.status(201).json({ column: S.serCol(await db.get('SELECT * FROM board_columns WHERE id = ?', [id])) });
  });

  r.patch('/columns/:id', async (req, res) => {
    const b = V.object(req.body);
    const c = await S.getColumnForUser(db, req.params.id, req.user.id);
    const name = V.str(b.name, 'Sütun adı', { max: 60, field: 'name' });
    if (name === '') throw bad('Sütun adı gerekli.', 'name');
    const isDone = V.bool(b.isDone, 'Tamamlandı');
    await db.tx(async () => {
      await db.run('UPDATE board_columns SET name = COALESCE(?, name), is_done = COALESCE(?, is_done) WHERE id = ?', [name || null, isDone == null ? null : (isDone ? 1 : 0), c.id]);
      if (isDone === true && !c.is_done) await db.run('UPDATE tasks SET completed_at = ?, updated_at = ? WHERE column_id = ? AND completed_at IS NULL', [now(), now(), c.id]);
      if (isDone === false) await db.run('UPDATE tasks SET completed_at = NULL, updated_at = ? WHERE column_id = ?', [now(), c.id]);
    });
    res.json({ column: S.serCol(await db.get('SELECT * FROM board_columns WHERE id = ?', [c.id])) });
  });

  r.put('/columns/order', async (req, res) => {
    const b = V.object(req.body);
    const sc = await scopeFrom(V.id(b.projectId, 'Proje'), req.user.id);
    if (!Array.isArray(b.ids)) throw bad('ids listesi gerekli.');
    const cols = await scopeCols(sc.where);
    const set = new Set(cols.map((c) => c.id));
    if (b.ids.length !== cols.length || !b.ids.every((x) => set.has(x))) throw bad('Sütun listesi panoyla eşleşmiyor.');
    await db.tx(async () => { for (let i = 0; i < b.ids.length; i++) await db.run('UPDATE board_columns SET position = ? WHERE id = ?', [i, b.ids[i]]); });
    res.json({ columns: (await scopeCols(sc.where)).map(S.serCol) });
  });

  r.delete('/columns/:id', async (req, res) => {
    const c = await S.getColumnForUser(db, req.params.id, req.user.id);
    const w = S.scopeWhere(c);
    const others = (await scopeCols(w)).filter((x) => x.id !== c.id);
    if (!others.length) throw bad('Panodaki son sütun silinemez.');
    let target = req.query.moveTo ? others.find((x) => x.id === req.query.moveTo) : (others.find((x) => !x.is_done) || others[0]);
    if (!target) throw bad('Hedef sütun bu panoda değil.');
    await db.tx(async () => {
      const tasks = await db.all('SELECT * FROM tasks WHERE column_id = ? ORDER BY position', [c.id]);
      for (const t of tasks) await S.placeTask(db, t, target, null);
      await db.run('DELETE FROM board_columns WHERE id = ?', [c.id]);
      await S.logActivity(db, { userId: req.user.id, projectId: c.project_id, entityType: 'column', entityId: c.id, action: 'deleted', details: { name: c.name, moved: tasks.length } });
    });
    res.json({ ok: true, movedTo: target.id });
  });
};
