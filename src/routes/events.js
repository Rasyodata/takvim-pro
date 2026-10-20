'use strict';
const A = require('../auth');
const { V, uid, now, bad, forbidden, CATEGORIES, validDate } = require('../util');
const S = require('../services');

const CAT_COLORS = { work: '#3b82f6', meeting: '#8b5cf6', personal: '#10b981', health: '#ef4444', education: '#f59e0b', social: '#ec4899', other: '#64748b' };

module.exports = (r, db) => {
  r.use('/events', A.requireAuth);

  async function parse(b, cur, user) {
    const out = {};
    const title = V.str(b.title, 'Başlık', { required: !cur, max: 200, field: 'title' });
    if (cur && title === '') throw bad('Başlık gerekli.', 'title');
    if (title != null) out.title = title;
    const allDay = b.allDay == null ? (cur ? !!cur.all_day : false) : V.bool(b.allDay, 'Tüm gün');
    let start = V.dateTime(b.startAt, 'Başlangıç', { required: !cur, field: 'startAt' }) || (cur && cur.start_at);
    let end = V.dateTime(b.endAt, 'Bitiş', { required: !cur && !allDay, field: 'endAt' }) || (cur && cur.end_at) || start;
    if (allDay) { start = start.slice(0, 10) + 'T00:00'; end = (end && end >= start ? end : start).slice(0, 10) + 'T23:59'; }
    if (end <= start && !allDay) throw bad('Bitiş zamanı başlangıçtan sonra olmalı.', 'endAt');
    Object.assign(out, { start_at: start, end_at: end, all_day: allDay ? 1 : 0 });
    if (b.category != null) out.category = V.oneOf(b.category, 'Kategori', CATEGORIES, { field: 'category' });
    if (b.color != null) out.color = V.color(b.color);
    if (b.notes != null) out.notes = V.str(b.notes, 'Notlar', { max: 5000, field: 'notes' });
    if (b.projectId !== undefined) {
      out.project_id = V.id(b.projectId, 'Proje', { field: 'projectId' });
      if (out.project_id) await S.requireMember(db, out.project_id, user.id);
    }
    let attendees = null;
    if (b.attendeeIds != null) {
      if (!Array.isArray(b.attendeeIds) || b.attendeeIds.length > 100) throw bad('Katılımcı listesi geçersiz.', 'attendeeIds');
      attendees = [...new Set(b.attendeeIds)].filter((x) => x !== user.id);
      for (const a of attendees) if (!(await db.get('SELECT id FROM users WHERE id = ? AND is_active = 1', [V.id(a, 'Katılımcı')]))) throw bad('Katılımcı bulunamadı.', 'attendeeIds');
    }
    return { f: out, attendees };
  }
  async function setAttendees(eventId, ids) {
    const existing = await db.all('SELECT user_id, status FROM event_attendees WHERE event_id = ?', [eventId]);
    const keep = new Map(existing.map((x) => [x.user_id, x.status]));
    await db.run('DELETE FROM event_attendees WHERE event_id = ?', [eventId]);
    for (const id of ids) await db.run('INSERT INTO event_attendees (event_id, user_id, status, added_at) VALUES (?, ?, ?, ?)', [eventId, id, keep.get(id) || 'invited', now()]);
  }
  async function ownEvent(id, user) {
    const e = await S.getEvent(db, id, user.id); // görünürlük
    if (e.ownerId !== user.id) throw forbidden('Etkinliği yalnızca oluşturan kişi değiştirebilir.');
    return db.get('SELECT * FROM events WHERE id = ?', [id]);
  }

  r.get('/events', async (req, res) => {
    const from = req.query.from && validDate(req.query.from) ? req.query.from + 'T00:00' : null;
    const to = req.query.to && validDate(req.query.to) ? req.query.to + 'T23:59' : null;
    res.json({ events: await S.loadEvents(db, req.user.id, { from, to }) });
  });

  r.post('/events', async (req, res) => {
    const b = V.object(req.body);
    const { f, attendees } = await parse(b, null, req.user);
    const id = uid(); const t = now();
    const category = f.category || 'other';
    await db.tx(async () => {
      await db.run(`INSERT INTO events (id, title, start_at, end_at, all_day, category, color, notes, owner_id, project_id, is_sample, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, f.title, f.start_at, f.end_at, f.all_day, category, f.color || CAT_COLORS[category], f.notes || '', req.user.id, f.project_id || null, t, t]);
      if (attendees) await setAttendees(id, attendees);
      await S.logActivity(db, { userId: req.user.id, projectId: f.project_id, entityType: 'event', entityId: id, action: 'created', details: { title: f.title, startAt: f.start_at } });
    });
    res.status(201).json({ event: await S.getEvent(db, id, req.user.id) });
  });

  r.get('/events/:id', async (req, res) => res.json({ event: await S.getEvent(db, req.params.id, req.user.id) }));

  r.patch('/events/:id', async (req, res) => {
    const b = V.object(req.body);
    const cur = await ownEvent(req.params.id, req.user);
    const { f, attendees } = await parse(b, cur, req.user);
    await db.tx(async () => {
      const keys = Object.keys(f);
      await db.run(`UPDATE events SET ${keys.map((k) => `${k} = ?`).concat('updated_at = ?').join(', ')} WHERE id = ?`, [...keys.map((k) => f[k]), now(), cur.id]);
      if (attendees) await setAttendees(cur.id, attendees);
      await S.logActivity(db, { userId: req.user.id, projectId: f.project_id === undefined ? cur.project_id : f.project_id, entityType: 'event', entityId: cur.id, action: 'updated', details: { title: f.title || cur.title } });
    });
    res.json({ event: await S.getEvent(db, cur.id, req.user.id) });
  });

  r.delete('/events/:id', async (req, res) => {
    const cur = await ownEvent(req.params.id, req.user);
    await db.tx(async () => {
      await db.run('DELETE FROM events WHERE id = ?', [cur.id]);
      await S.logActivity(db, { userId: req.user.id, projectId: cur.project_id, entityType: 'event', entityId: cur.id, action: 'deleted', details: { title: cur.title } });
    });
    res.json({ ok: true });
  });

  r.post('/events/:id/rsvp', async (req, res) => {
    const b = V.object(req.body);
    const status = V.oneOf(b.status, 'Yanıt', ['accepted', 'declined', 'invited'], { required: true, field: 'status' });
    const e = await S.getEvent(db, req.params.id, req.user.id);
    const r1 = await db.run('UPDATE event_attendees SET status = ? WHERE event_id = ? AND user_id = ?', [status, e.id, req.user.id]);
    if (!r1.changes) throw bad('Bu etkinliğe davetli değilsiniz.');
    res.json({ event: await S.getEvent(db, e.id, req.user.id) });
  });
};
