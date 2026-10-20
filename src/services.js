'use strict';
/* Erişim denetimi ve veri yükleme yardımcıları.
 * Kural: Kullanıcı yalnızca kendi kişisel kayıtlarını ve üyesi olduğu projelerin kayıtlarını görür. */
const { uid, now, notFound, forbidden, bad, trLower } = require('./util');

const MEMBER_PROJECTS = 'SELECT project_id FROM project_members WHERE user_id = ?';
const VIS_TASK = `((t.project_id IS NULL AND t.creator_id = ?) OR t.project_id IN (${MEMBER_PROJECTS}))`;
const VIS_EVENT = `(e.owner_id = ? OR e.project_id IN (${MEMBER_PROJECTS}) OR e.id IN (SELECT event_id FROM event_attendees WHERE user_id = ?))`;
const DEFAULT_COLUMNS = [['Yapılacak', 0], ['Devam Ediyor', 0], ['Bitti', 1]];

// ---------- Kullanıcılar ----------
const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, isActive: !!u.is_active, isSample: !!u.is_sample });

// ---------- Projeler ----------
async function memberRole(db, projectId, userId) {
  const r = await db.get('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  return r ? r.role : null;
}
async function requireMember(db, projectId, userId) {
  const p = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!p) throw notFound('Proje bulunamadı.');
  const role = await memberRole(db, projectId, userId);
  if (!role) throw notFound('Proje bulunamadı.'); // varlığını sızdırmamak için 404
  return { project: p, role };
}
async function requireOwner(db, projectId, userId) {
  const r = await requireMember(db, projectId, userId);
  if (r.project.owner_id !== userId) throw forbidden('Bu işlemi yalnızca proje sahibi yapabilir.');
  return r;
}
async function createDefaultColumns(db, scope) {
  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
    const [name, done] = DEFAULT_COLUMNS[i];
    await db.run('INSERT INTO board_columns (id, project_id, user_id, name, position, is_done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uid(), scope.projectId || null, scope.projectId ? null : scope.userId, name, i, done, now()]);
  }
}
async function ensurePersonalColumns(db, userId) {
  const c = await db.get('SELECT COUNT(*) AS n FROM board_columns WHERE user_id = ?', [userId]);
  if (!Number(c.n)) await createDefaultColumns(db, { userId });
}
async function loadProjects(db, userId) {
  const projects = await db.all(`SELECT p.* FROM projects p WHERE p.id IN (${MEMBER_PROJECTS}) ORDER BY p.created_at`, [userId]);
  const members = await db.all(`SELECT pm.project_id, pm.user_id, pm.role FROM project_members pm WHERE pm.project_id IN (${MEMBER_PROJECTS})`, [userId]);
  return projects.map((p) => ({
    id: p.id, name: p.name, color: p.color, description: p.description, ownerId: p.owner_id, isSample: !!p.is_sample, createdAt: p.created_at,
    members: members.filter((m) => m.project_id === p.id).map((m) => ({ userId: m.user_id, role: m.role })),
  }));
}

// ---------- Sütunlar ----------
const serCol = (c) => ({ id: c.id, projectId: c.project_id, userId: c.user_id, name: c.name, position: c.position, isDone: !!c.is_done });
async function loadColumns(db, userId) {
  return (await db.all(`SELECT * FROM board_columns WHERE user_id = ? OR project_id IN (${MEMBER_PROJECTS}) ORDER BY position, created_at`, [userId, userId])).map(serCol);
}
/** Sütunu getirir ve kullanıcının erişimini doğrular. */
async function getColumnForUser(db, columnId, userId) {
  const c = await db.get('SELECT * FROM board_columns WHERE id = ?', [columnId]);
  if (!c) throw notFound('Sütun bulunamadı.');
  if (c.user_id && c.user_id !== userId) throw notFound('Sütun bulunamadı.');
  if (c.project_id && !(await memberRole(db, c.project_id, userId))) throw notFound('Sütun bulunamadı.');
  return c;
}
const scopeWhere = (c) => (c.project_id ? ['project_id = ?', c.project_id] : ['user_id = ?', c.user_id]);

// ---------- Görevler ----------
function serTask(t, tags, checklist, comments) {
  return {
    id: t.id, title: t.title, description: t.description, priority: t.priority, columnId: t.column_id, projectId: t.project_id,
    assigneeId: t.assignee_id, creatorId: t.creator_id, dueDate: t.due_date, completedAt: t.completed_at, position: t.position,
    isSample: !!t.is_sample, createdAt: t.created_at, updatedAt: t.updated_at,
    tags: tags || [], checklist: checklist || [], commentCount: comments || 0,
  };
}
async function loadTasks(db, userId, { taskId } = {}) {
  const extra = taskId ? ' AND t.id = ?' : '';
  const p = taskId ? [userId, userId, taskId] : [userId, userId];
  const tasks = await db.all(`SELECT t.* FROM tasks t WHERE ${VIS_TASK}${extra} ORDER BY t.position, t.created_at`, p);
  if (!tasks.length) return [];
  const tags = await db.all(`SELECT tt.task_id, g.name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id JOIN tasks t ON t.id = tt.task_id WHERE ${VIS_TASK}${extra} ORDER BY g.name`, p);
  const items = await db.all(`SELECT c.* FROM checklist_items c JOIN tasks t ON t.id = c.task_id WHERE ${VIS_TASK}${extra} ORDER BY c.position, c.created_at`, p);
  const counts = await db.all(`SELECT c.task_id, COUNT(*) AS n FROM comments c JOIN tasks t ON t.id = c.task_id WHERE ${VIS_TASK}${extra} GROUP BY c.task_id`, p);
  const by = (rows, key) => rows.reduce((m, r) => { (m[r[key]] = m[r[key]] || []).push(r); return m; }, {});
  const tg = by(tags, 'task_id'), it = by(items, 'task_id');
  const cc = Object.fromEntries(counts.map((r) => [r.task_id, Number(r.n)]));
  return tasks.map((t) => serTask(t, (tg[t.id] || []).map((r) => r.name), (it[t.id] || []).map((c) => ({ id: c.id, text: c.text, isDone: !!c.is_done, position: c.position })), cc[t.id]));
}
async function getTaskRow(db, taskId, userId) {
  const t = await db.get(`SELECT t.* FROM tasks t WHERE t.id = ? AND ${VIS_TASK}`, [taskId, userId, userId]);
  if (!t) throw notFound('Görev bulunamadı.');
  return t;
}
async function getTask(db, taskId, userId) { const [t] = await loadTasks(db, userId, { taskId }); if (!t) throw notFound('Görev bulunamadı.'); return t; }

async function setTags(db, taskId, names) {
  await db.run('DELETE FROM task_tags WHERE task_id = ?', [taskId]);
  for (const name of names) {
    let tag = await db.get('SELECT id FROM tags WHERE name = ?', [name]);
    if (!tag) { tag = { id: uid() }; await db.run('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING', [tag.id, name, now()]); tag = await db.get('SELECT id FROM tags WHERE name = ?', [name]); }
    await db.run('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [taskId, tag.id]);
  }
  await db.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM task_tags)', []);
}
function normTags(v) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length > 20) throw bad('Etiketler en fazla 20 öğelik bir liste olmalı.', 'tags');
  const out = [...new Set(v.map((s) => {
    if (typeof s !== 'string') throw bad('Etiket metin olmalı.', 'tags');
    const t = trLower(s.trim().replace(/^#/, ''));
    if (t.length > 40) throw bad('Etiket en fazla 40 karakter olabilir.', 'tags');
    return t;
  }).filter(Boolean))];
  return out;
}
async function replaceChecklist(db, taskId, items) {
  if (!Array.isArray(items) || items.length > 100) throw bad('Kontrol listesi en fazla 100 öğe içerebilir.', 'checklist');
  await db.run('DELETE FROM checklist_items WHERE task_id = ?', [taskId]);
  let i = 0;
  for (const it of items) {
    if (!it || typeof it.text !== 'string' || !it.text.trim()) continue;
    if (it.text.length > 300) throw bad('Alt görev en fazla 300 karakter olabilir.', 'checklist');
    await db.run('INSERT INTO checklist_items (id, task_id, text, is_done, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', [uid(), taskId, it.text.trim(), it.isDone ? 1 : 0, i++, now()]);
  }
}
/** Görevi bir sütuna taşır (beforeId'den önce ya da sona) ve completed_at alanını günceller. */
async function placeTask(db, task, column, beforeId) {
  const prev = await db.get('SELECT is_done FROM board_columns WHERE id = ?', [task.column_id]);
  const ids = (await db.all('SELECT id FROM tasks WHERE column_id = ? AND id <> ? ORDER BY position, created_at', [column.id, task.id])).map((r) => r.id);
  let idx = beforeId ? ids.indexOf(beforeId) : -1;
  if (idx < 0) idx = ids.length;
  ids.splice(idx, 0, task.id);
  const wasDone = !!(prev && prev.is_done);
  const completed = column.is_done ? (wasDone && task.completed_at ? task.completed_at : now()) : null;
  await db.run('UPDATE tasks SET column_id = ?, completed_at = ?, updated_at = ? WHERE id = ?', [column.id, completed, now(), task.id]);
  for (let i = 0; i < ids.length; i++) await db.run('UPDATE tasks SET position = ? WHERE id = ?', [i, ids[i]]);
}

// ---------- Etkinlikler ----------
async function loadEvents(db, userId, { from, to, eventId } = {}) {
  const where = [VIS_EVENT]; const p = [userId, userId, userId];
  if (from) { where.push('e.end_at >= ?'); p.push(from); }
  if (to) { where.push('e.start_at <= ?'); p.push(to); }
  if (eventId) { where.push('e.id = ?'); p.push(eventId); }
  const events = await db.all(`SELECT e.* FROM events e WHERE ${where.join(' AND ')} ORDER BY e.start_at`, p);
  if (!events.length) return [];
  const att = await db.all(`SELECT a.event_id, a.user_id, a.status FROM event_attendees a JOIN events e ON e.id = a.event_id WHERE ${where.join(' AND ')}`, p);
  return events.map((e) => ({
    id: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at, allDay: !!e.all_day, category: e.category, color: e.color, notes: e.notes,
    ownerId: e.owner_id, projectId: e.project_id, isSample: !!e.is_sample, createdAt: e.created_at, updatedAt: e.updated_at,
    attendees: att.filter((a) => a.event_id === e.id).map((a) => ({ userId: a.user_id, status: a.status })),
  }));
}
async function getEvent(db, eventId, userId) { const [e] = await loadEvents(db, userId, { eventId }); if (!e) throw notFound('Etkinlik bulunamadı.'); return e; }

// ---------- Etkinlik günlüğü ----------
async function logActivity(db, { userId, projectId, entityType, entityId, action, details }) {
  await db.run('INSERT INTO activity_log (id, user_id, project_id, entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [uid(), userId || null, projectId || null, entityType, entityId || null, action, JSON.stringify(details || {}), now()]);
}
async function loadActivity(db, userId, { projectId, limit = 30 } = {}) {
  const where = [`(a.project_id IN (${MEMBER_PROJECTS}) OR (a.project_id IS NULL AND a.user_id = ?))`]; const p = [userId, userId];
  if (projectId) { where.push('a.project_id = ?'); p.push(projectId); }
  p.push(Math.min(Math.max(Number(limit) || 30, 1), 200));
  const rows = await db.all(`SELECT a.* FROM activity_log a WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT ?`, p);
  return rows.map((a) => ({ id: a.id, userId: a.user_id, projectId: a.project_id, entityType: a.entity_type, entityId: a.entity_id, action: a.action, details: safeJson(a.details), createdAt: a.created_at }));
}
const safeJson = (s) => { try { return JSON.parse(s); } catch (_) { return {}; } };

module.exports = {
  MEMBER_PROJECTS, VIS_TASK, VIS_EVENT, publicUser, memberRole, requireMember, requireOwner, createDefaultColumns, ensurePersonalColumns,
  loadProjects, serCol, loadColumns, getColumnForUser, scopeWhere, loadTasks, getTaskRow, getTask, setTags, normTags, replaceChecklist, placeTask,
  loadEvents, getEvent, logActivity, loadActivity,
};
