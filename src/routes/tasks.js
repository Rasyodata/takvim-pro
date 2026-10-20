'use strict';
const A = require('../auth');
const { V, uid, now, bad, notFound, forbidden, PRIORITIES, trLower } = require('../util');
const S = require('../services');

module.exports = (r, db) => {
  r.use(['/tasks', '/checklist', '/comments'], A.requireAuth);

  /** Proje/sütun/atanan kişiyi doğrular ve hedef kapsamı döndürür. */
  async function resolve(user, { projectId, columnId, assigneeId }, current) {
    const pid = projectId === undefined ? (current ? current.project_id : null) : V.id(projectId, 'Proje', { field: 'projectId' });
    if (pid) await S.requireMember(db, pid, user.id);
    if (current && current.project_id && !pid && current.creator_id !== user.id) throw forbidden('Başkasının oluşturduğu proje görevini kişisel panonuza taşıyamazsınız.');
    let column;
    const cid = columnId === undefined || columnId === null || columnId === '' ? null : V.id(columnId, 'Sütun', { field: 'columnId' });
    if (cid) {
      column = await S.getColumnForUser(db, cid, user.id);
      const ok = pid ? column.project_id === pid : column.user_id === user.id;
      if (!ok) throw bad('Seçilen sütun bu görevin panosuna ait değil.', 'columnId');
    } else if (current && (current.project_id || null) === (pid || null)) {
      column = await db.get('SELECT * FROM board_columns WHERE id = ?', [current.column_id]);
    } else {
      const w = pid ? ['project_id = ?', pid] : ['user_id = ?', user.id];
      column = await db.get(`SELECT * FROM board_columns WHERE ${w[0]} ORDER BY is_done, position LIMIT 1`, [w[1]]);
      if (!column) { await S.ensurePersonalColumns(db, user.id); column = await db.get(`SELECT * FROM board_columns WHERE ${w[0]} ORDER BY is_done, position LIMIT 1`, [w[1]]); }
    }
    let aid = assigneeId === undefined ? (current ? current.assignee_id : null) : V.id(assigneeId, 'Atanan kişi', { field: 'assigneeId' });
    if (aid) {
      if (pid) { if (!(await S.memberRole(db, pid, aid))) { if (assigneeId === undefined) aid = null; else throw bad('Görev yalnızca proje üyelerine atanabilir.', 'assigneeId'); } }
      else if (aid !== user.id) { if (assigneeId === undefined) aid = null; else throw bad('Kişisel görevler yalnızca size atanabilir.', 'assigneeId'); }
    }
    return { pid, column, aid };
  }
  function fields(b, partial) {
    const out = {};
    const title = V.str(b.title, 'Başlık', { required: !partial, max: 200, field: 'title' });
    if (partial && title === '') throw bad('Başlık gerekli.', 'title');
    if (title != null) out.title = title;
    if (b.description != null) out.description = V.str(b.description, 'Açıklama', { max: 10000, field: 'description' });
    if (b.priority != null) out.priority = V.oneOf(b.priority, 'Öncelik', PRIORITIES, { field: 'priority' });
    if (b.dueDate !== undefined) out.due_date = V.date(b.dueDate, 'Teslim tarihi', { field: 'dueDate' });
    return out;
  }

  r.get('/tasks', async (req, res) => {
    let tasks = await S.loadTasks(db, req.user.id);
    const q = req.query;
    if (q.projectId) tasks = tasks.filter((t) => (q.projectId === 'personal' ? !t.projectId : t.projectId === q.projectId));
    if (q.assignee) tasks = tasks.filter((t) => t.assigneeId === (q.assignee === 'me' ? req.user.id : q.assignee));
    if (q.tag) tasks = tasks.filter((t) => t.tags.includes(trLower(q.tag)));
    if (q.dueFrom) tasks = tasks.filter((t) => t.dueDate && t.dueDate >= q.dueFrom);
    if (q.dueTo) tasks = tasks.filter((t) => t.dueDate && t.dueDate <= q.dueTo);
    if (q.status) tasks = tasks.filter((t) => (q.status === 'done' ? !!t.completedAt : !t.completedAt));
    if (q.q) { const s = trLower(q.q); tasks = tasks.filter((t) => trLower([t.title, t.description, t.tags.join(' ')].join(' ')).includes(s)); }
    res.json({ tasks });
  });

  r.post('/tasks', async (req, res) => {
    const b = V.object(req.body);
    const f = fields(b, false);
    const tags = S.normTags(b.tags) || [];
    const { pid, column, aid } = await resolve(req.user, b, null);
    const id = uid(); const t = now();
    await db.tx(async () => {
      const pos = await db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE column_id = ?', [column.id]);
      await db.run(`INSERT INTO tasks (id, title, description, priority, column_id, project_id, assignee_id, creator_id, due_date, completed_at, position, is_sample, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, f.title, f.description || '', f.priority || 'medium', column.id, pid, aid, req.user.id, f.due_date || null, column.is_done ? t : null, Number(pos.p), t, t]);
      await S.setTags(db, id, tags);
      if (b.checklist) await S.replaceChecklist(db, id, b.checklist);
      await S.logActivity(db, { userId: req.user.id, projectId: pid, entityType: 'task', entityId: id, action: 'created', details: { title: f.title } });
      if (aid && aid !== req.user.id) await S.logActivity(db, { userId: req.user.id, projectId: pid, entityType: 'task', entityId: id, action: 'assigned', details: { title: f.title, assigneeId: aid } });
    });
    res.status(201).json({ task: await S.getTask(db, id, req.user.id) });
  });

  r.get('/tasks/:id', async (req, res) => res.json({ task: await S.getTask(db, req.params.id, req.user.id) }));

  r.patch('/tasks/:id', async (req, res) => {
    const b = V.object(req.body);
    const cur = await S.getTaskRow(db, req.params.id, req.user.id);
    const f = fields(b, true);
    const tags = S.normTags(b.tags);
    const { pid, column, aid } = await resolve(req.user, b, cur);
    await db.tx(async () => {
      const sets = Object.keys(f).map((k) => `${k} = ?`);
      await db.run(`UPDATE tasks SET ${sets.concat(['project_id = ?', 'assignee_id = ?', 'updated_at = ?']).join(', ')} WHERE id = ?`, [...Object.values(f), pid, aid, now(), cur.id]);
      if (column.id !== cur.column_id) await S.placeTask(db, Object.assign({}, cur, { project_id: pid }), column, null);
      if (tags) await S.setTags(db, cur.id, tags);
      if (b.checklist) await S.replaceChecklist(db, cur.id, b.checklist);
      const title = f.title || cur.title;
      await S.logActivity(db, { userId: req.user.id, projectId: pid, entityType: 'task', entityId: cur.id, action: 'updated', details: { title } });
      if (aid && aid !== cur.assignee_id) await S.logActivity(db, { userId: req.user.id, projectId: pid, entityType: 'task', entityId: cur.id, action: 'assigned', details: { title, assigneeId: aid } });
    });
    res.json({ task: await S.getTask(db, cur.id, req.user.id) });
  });

  r.delete('/tasks/:id', async (req, res) => {
    const cur = await S.getTaskRow(db, req.params.id, req.user.id);
    await db.tx(async () => {
      await db.run('DELETE FROM tasks WHERE id = ?', [cur.id]);
      await db.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM task_tags)', []);
      await S.logActivity(db, { userId: req.user.id, projectId: cur.project_id, entityType: 'task', entityId: cur.id, action: 'deleted', details: { title: cur.title } });
    });
    res.json({ ok: true });
  });

  r.post('/tasks/:id/move', async (req, res) => {
    const b = V.object(req.body);
    const cur = await S.getTaskRow(db, req.params.id, req.user.id);
    const column = await S.getColumnForUser(db, V.id(b.columnId, 'Sütun', { required: true }), req.user.id);
    const sameScope = cur.project_id ? column.project_id === cur.project_id : column.user_id === cur.creator_id;
    if (!sameScope) throw bad('Görev yalnızca kendi panosundaki sütunlara taşınabilir.', 'columnId');
    const beforeId = V.id(b.beforeId, 'Önceki kart');
    const from = await db.get('SELECT name FROM board_columns WHERE id = ?', [cur.column_id]);
    await db.tx(async () => {
      await S.placeTask(db, cur, column, beforeId);
      if (column.id !== cur.column_id) await S.logActivity(db, { userId: req.user.id, projectId: cur.project_id, entityType: 'task', entityId: cur.id, action: 'moved', details: { title: cur.title, from: from && from.name, to: column.name } });
    });
    res.json({ task: await S.getTask(db, cur.id, req.user.id) });
  });

  r.post('/tasks/:id/assign', async (req, res) => {
    const b = V.object(req.body);
    const cur = await S.getTaskRow(db, req.params.id, req.user.id);
    const { aid } = await resolve(req.user, { assigneeId: b.assigneeId === undefined ? null : b.assigneeId }, cur);
    await db.run('UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE id = ?', [aid, now(), cur.id]);
    await S.logActivity(db, { userId: req.user.id, projectId: cur.project_id, entityType: 'task', entityId: cur.id, action: aid ? 'assigned' : 'unassigned', details: { title: cur.title, assigneeId: aid } });
    res.json({ task: await S.getTask(db, cur.id, req.user.id) });
  });

  // ---------------- Kontrol listesi ----------------
  r.put('/tasks/:id/checklist', async (req, res) => {
    const b = V.object(req.body);
    const cur = await S.getTaskRow(db, req.params.id, req.user.id);
    await db.tx(() => S.replaceChecklist(db, cur.id, b.items));
    res.json({ task: await S.getTask(db, cur.id, req.user.id) });
  });
  r.post('/tasks/:id/checklist', async (req, res) => {
    const b = V.object(req.body);
    const cur = await S.getTaskRow(db, req.params.id, req.user.id);
    const text = V.str(b.text, 'Alt görev', { required: true, max: 300, field: 'text' });
    const pos = await db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM checklist_items WHERE task_id = ?', [cur.id]);
    const id = uid();
    await db.run('INSERT INTO checklist_items (id, task_id, text, is_done, position, created_at) VALUES (?, ?, ?, 0, ?, ?)', [id, cur.id, text, Number(pos.p), now()]);
    res.status(201).json({ item: { id, text, isDone: false, position: Number(pos.p) } });
  });
  async function itemForUser(id, userId) {
    const it = await db.get('SELECT * FROM checklist_items WHERE id = ?', [id]);
    if (!it) throw notFound('Alt görev bulunamadı.');
    await S.getTaskRow(db, it.task_id, userId);
    return it;
  }
  r.patch('/checklist/:id', async (req, res) => {
    const b = V.object(req.body);
    const it = await itemForUser(req.params.id, req.user.id);
    const text = V.str(b.text, 'Alt görev', { max: 300 });
    if (text === '') throw bad('Alt görev boş olamaz.');
    const isDone = V.bool(b.isDone, 'Tamamlandı');
    await db.run('UPDATE checklist_items SET text = COALESCE(?, text), is_done = COALESCE(?, is_done) WHERE id = ?', [text || null, isDone == null ? null : (isDone ? 1 : 0), it.id]);
    const n = await db.get('SELECT * FROM checklist_items WHERE id = ?', [it.id]);
    res.json({ item: { id: n.id, text: n.text, isDone: !!n.is_done, position: n.position } });
  });
  r.delete('/checklist/:id', async (req, res) => {
    const it = await itemForUser(req.params.id, req.user.id);
    await db.run('DELETE FROM checklist_items WHERE id = ?', [it.id]);
    res.json({ ok: true });
  });

  // ---------------- Yorumlar ----------------
  const serComment = (c) => ({ id: c.id, taskId: c.task_id, userId: c.user_id, userName: c.user_name, body: c.body, createdAt: c.created_at, updatedAt: c.updated_at });
  r.get('/tasks/:id/comments', async (req, res) => {
    const cur = await S.getTaskRow(db, req.params.id, req.user.id);
    const rows = await db.all('SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at', [cur.id]);
    res.json({ comments: rows.map(serComment) });
  });
  r.post('/tasks/:id/comments', async (req, res) => {
    const b = V.object(req.body);
    const cur = await S.getTaskRow(db, req.params.id, req.user.id);
    const body = V.str(b.body, 'Yorum', { required: true, max: 5000, field: 'body' });
    const id = uid(); const t = now();
    await db.run('INSERT INTO comments (id, task_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, cur.id, req.user.id, body, t, t]);
    await S.logActivity(db, { userId: req.user.id, projectId: cur.project_id, entityType: 'comment', entityId: cur.id, action: 'commented', details: { title: cur.title } });
    res.status(201).json({ comment: serComment(Object.assign(await db.get('SELECT * FROM comments WHERE id = ?', [id]), { user_name: req.user.name })) });
  });
  async function commentForUser(id, user) {
    const c = await db.get('SELECT * FROM comments WHERE id = ?', [id]);
    if (!c) throw notFound('Yorum bulunamadı.');
    const task = await S.getTaskRow(db, c.task_id, user.id);
    return { c, task };
  }
  r.patch('/comments/:id', async (req, res) => {
    const b = V.object(req.body);
    const { c } = await commentForUser(req.params.id, req.user);
    if (c.user_id !== req.user.id) throw forbidden('Yalnızca kendi yorumunuzu düzenleyebilirsiniz.');
    const body = V.str(b.body, 'Yorum', { required: true, max: 5000, field: 'body' });
    await db.run('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?', [body, now(), c.id]);
    res.json({ comment: serComment(Object.assign(await db.get('SELECT * FROM comments WHERE id = ?', [c.id]), { user_name: req.user.name })) });
  });
  r.delete('/comments/:id', async (req, res) => {
    const { c, task } = await commentForUser(req.params.id, req.user);
    let allowed = c.user_id === req.user.id;
    if (!allowed && task.project_id) { const p = await db.get('SELECT owner_id FROM projects WHERE id = ?', [task.project_id]); allowed = p && p.owner_id === req.user.id; }
    if (!allowed) throw forbidden('Bu yorumu silemezsiniz.');
    await db.run('DELETE FROM comments WHERE id = ?', [c.id]);
    res.json({ ok: true });
  });
};
