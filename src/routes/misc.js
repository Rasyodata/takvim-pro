'use strict';
const A = require('../auth');
const { todayStr, weekStart, addDays, localDate, trLower } = require('../util');
const S = require('../services');

module.exports = (r, db) => {
  r.use(['/users', '/tags', '/dashboard', '/activity', '/bootstrap', '/export'], A.requireAuth);

  // Kişi rehberi: atama, proje üyeliği ve katılımcı seçimi için etkin kullanıcılar
  r.get('/users', async (_req, res) => {
    const rows = await db.all('SELECT id, name, email, role, is_active, is_sample FROM users WHERE is_active = 1 ORDER BY name', []);
    res.json({ users: rows.map((u) => ({ id: u.id, name: u.name, email: u.email })) });
  });

  r.get('/tags', async (req, res) => {
    const rows = await db.all(`SELECT g.name, COUNT(*) AS n FROM task_tags tt JOIN tags g ON g.id = tt.tag_id JOIN tasks t ON t.id = tt.task_id WHERE ${S.VIS_TASK} GROUP BY g.name ORDER BY g.name`, [req.user.id, req.user.id]);
    res.json({ tags: rows.map((x) => ({ name: x.name, count: Number(x.n) })) });
  });

  r.get('/activity', async (req, res) => res.json({ activity: await S.loadActivity(db, req.user.id, { projectId: req.query.projectId, limit: req.query.limit }) }));

  /** Bugün panosu istatistikleri. İsteğe bağlı filtreler: projectId (veya "personal"), tag, q, mine=1 */
  r.get('/dashboard', async (req, res) => {
    const me = req.user.id; const q = req.query;
    const today = todayStr(); const ws = weekStart(today);
    const cols = new Map((await S.loadColumns(db, me)).map((c) => [c.id, c]));
    const isDone = (t) => !!(cols.get(t.columnId) || {}).isDone;
    let tasks = await S.loadTasks(db, me);
    let events = await S.loadEvents(db, me, { from: today + 'T00:00', to: today + 'T23:59' });
    const s = q.q ? trLower(q.q) : '';
    if (q.projectId) { const f = (x) => (q.projectId === 'personal' ? !x.projectId : x.projectId === q.projectId); tasks = tasks.filter(f); events = events.filter(f); }
    if (q.mine === '1') { tasks = tasks.filter((t) => t.assigneeId === me); events = events.filter((e) => e.ownerId === me || e.attendees.some((a) => a.userId === me)); }
    if (q.tag) { tasks = tasks.filter((t) => t.tags.includes(trLower(q.tag))); events = []; }
    if (s) {
      tasks = tasks.filter((t) => trLower([t.title, t.description, t.tags.join(' '), t.checklist.map((c) => c.text).join(' ')].join(' ')).includes(s));
      events = events.filter((e) => trLower([e.title, e.notes].join(' ')).includes(s));
    }
    const done = tasks.filter(isDone);
    const completedWeek = done.filter((t) => t.completedAt && localDate(t.completedAt) >= ws);
    const perDay = Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, i); return { date: d, count: completedWeek.filter((t) => localDate(t.completedAt) === d).length }; });
    const open = tasks.filter((t) => !isDone(t));
    res.json({
      today, weekStart: ws,
      eventsToday: events.filter((e) => e.startAt.slice(0, 10) <= today).length,
      dueToday: tasks.filter((t) => t.dueDate === today).length,
      dueTodayDone: tasks.filter((t) => t.dueDate === today && isDone(t)).length,
      overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
      upcoming7: open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= addDays(today, 7)).length,
      completedThisWeek: completedWeek.length,
      completedPerDay: perDay,
      total: tasks.length, done: done.length, open: open.length,
      progress: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
      assignedToMeOpen: open.filter((t) => t.assigneeId === me).length,
    });
  });

  async function everything(user) {
    const me = user.id;
    const [projects, columns, tasks, events, activity, users] = [
      await S.loadProjects(db, me), await S.loadColumns(db, me), await S.loadTasks(db, me), await S.loadEvents(db, me),
      await S.loadActivity(db, me, { limit: 25 }), (await db.all('SELECT id, name, email FROM users WHERE is_active = 1 ORDER BY name', [])),
    ];
    return { me: S.publicUser(user), users, projects, columns, tasks, events, activity, serverTime: new Date().toISOString(), today: todayStr() };
  }
  r.get('/bootstrap', async (req, res) => res.json(await everything(req.user)));

  r.get('/export', async (req, res) => {
    const data = await everything(req.user);
    res.setHeader('Content-Disposition', `attachment; filename="takvim-yedek-${todayStr()}.json"`);
    res.json(Object.assign({ app: 'takvim-pro', exportedAt: new Date().toISOString() }, data));
  });
};
