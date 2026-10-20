'use strict';
/* API entegrasyon testleri: node --test tests/  (geçici bir SQLite dosyası kullanır) */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const dbFile = path.join(os.tmpdir(), `takvim-test-${process.pid}.db`);
process.env.DB_PATH = dbFile;
process.env.BCRYPT_ROUNDS = '4';
process.env.ALLOW_REGISTRATION = 'true';
execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'seed.js')], { env: process.env, stdio: 'ignore' });

const { open } = require('../src/db');
const { createApp } = require('../src/app');
let server, base, db;

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return { call, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u), put: (u, b) => call('PUT', u, b) };
}
async function login(email, password) { const c = client(); const r = await c.post('/api/auth/login', { email, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; }

test.before(async () => { db = await open(); server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); db.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true }); });

test('kimlik doğrulama ve CSRF', async () => {
  const c = client();
  assert.equal((await c.get('/api/bootstrap')).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'admin@ornek.com', password: 'yanlis' })).status, 401);
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@ornek.com', password: 'Admin123!' }) });
  assert.equal(r.status, 403, 'X-Requested-With olmadan reddedilmeli');
  const a = await login('admin@ornek.com', 'Admin123!');
  const me = await a.get('/api/auth/me');
  assert.equal(me.data.user.role, 'admin');
  await a.post('/api/auth/logout');
  assert.equal((await a.get('/api/auth/me')).status, 401);
});

test('kayıt ve doğrulama hataları', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/register', { name: 'X', email: 'kotu', password: '1' })).status, 400);
  const r = await c.post('/api/auth/register', { name: 'Yeni Kişi', email: 'Yeni@Test.com', password: 'Sifre1234' });
  assert.equal(r.status, 201); assert.equal(r.data.user.email, 'yeni@test.com'); assert.equal(r.data.user.role, 'user');
  assert.equal((await client().post('/api/auth/register', { name: 'Yeni Kişi', email: 'yeni@test.com', password: 'Sifre1234' })).status, 409);
  const b = await c.get('/api/bootstrap');
  assert.equal(b.data.projects.length, 0); assert.equal(b.data.tasks.length, 0); assert.equal(b.data.events.length, 0);
  assert.equal(b.data.columns.length, 3, 'kişisel pano sütunları oluşturulmalı');
});

test('gizlilik: kullanıcılar yalnızca kendi ve üyesi oldukları verileri görür', async () => {
  const admin = await login('admin@ornek.com', 'Admin123!');
  const ayse = await login('ayse@ornek.com', 'Ayse1234!');
  const A = (await admin.get('/api/bootstrap')).data, B = (await ayse.get('/api/bootstrap')).data;
  assert.ok(!A.projects.some((p) => p.name.includes('Mobil')), 'yönetici Mobil projesini görmemeli');
  assert.ok(!A.tasks.some((t) => t.title.includes('Ayşe\'nin özel')), 'yönetici Ayşe\'nin kişisel görevini görmemeli');
  assert.ok(!A.events.some((e) => e.title.includes('özel doktor')));
  assert.ok(!B.tasks.some((t) => t.title.includes('Fatura')), 'Ayşe yöneticinin kişisel görevini görmemeli');
  assert.ok(B.tasks.some((t) => t.title.includes('Ana sayfa')), 'Ayşe ortak proje görevini görmeli');
  assert.ok(B.events.some((e) => e.title.includes('Günlük ekip')), 'Ayşe davetli olduğu etkinliği görmeli');
  const privateTask = B.tasks.find((t) => t.title.includes('özel görevi'));
  assert.equal((await admin.get('/api/tasks/' + privateTask.id)).status, 404);
  assert.equal((await admin.patch('/api/tasks/' + privateTask.id, { title: 'hack' })).status, 404);
  assert.equal((await admin.del('/api/tasks/' + privateTask.id)).status, 404);
  const mobil = B.projects.find((p) => p.name.includes('Mobil'));
  assert.equal((await admin.get('/api/projects/' + mobil.id)).status, 404);
  assert.equal((await admin.post('/api/tasks', { title: 'x', projectId: mobil.id })).status, 404);
  const privEvent = B.events.find((e) => e.title.includes('özel doktor'));
  assert.equal((await admin.get('/api/events/' + privEvent.id)).status, 404);
  const shared = B.events.find((e) => e.title.includes('Günlük ekip'));
  assert.equal((await ayse.patch('/api/events/' + shared.id, { title: 'x' })).status, 403, 'katılımcı etkinliği düzenleyemez');
  assert.equal((await ayse.post(`/api/events/${shared.id}/rsvp`, { status: 'declined' })).status, 200);
  // Admin olmayan yönetici uç noktalarına erişemez
  assert.equal((await ayse.get('/api/admin/users')).status, 403);
});

test('görev: oluştur, ata, taşı, kontrol listesi, yorum', async () => {
  const admin = await login('admin@ornek.com', 'Admin123!');
  const boot = (await admin.get('/api/bootstrap')).data;
  const web = boot.projects.find((p) => p.name.includes('Web'));
  const cols = boot.columns.filter((c) => c.projectId === web.id).sort((a, b) => a.position - b.position);
  const ayse = boot.users.find((u) => u.email === 'ayse@ornek.com');
  const r = await admin.post('/api/tasks', { title: 'API testi', projectId: web.id, priority: 'urgent', tags: ['#Test', 'test'], dueDate: '2026-12-01', checklist: [{ text: 'bir' }] });
  assert.equal(r.status, 201); const t = r.data.task;
  assert.deepEqual(t.tags, ['test']); assert.equal(t.columnId, cols[0].id); assert.equal(t.checklist.length, 1);
  assert.equal((await admin.post('/api/tasks', { title: 'x', priority: 'kritik' })).status, 400);
  assert.equal((await admin.post('/api/tasks', { title: 'x', dueDate: '2026-02-30' })).status, 400);
  const asg = await admin.post(`/api/tasks/${t.id}/assign`, { assigneeId: ayse.id });
  assert.equal(asg.data.task.assigneeId, ayse.id);
  const ayseC = await login('ayse@ornek.com', 'Ayse1234!');
  assert.ok((await ayseC.get('/api/tasks?assignee=me')).data.tasks.some((x) => x.id === t.id));
  const done = cols.find((c) => c.isDone);
  const mv = await ayseC.post(`/api/tasks/${t.id}/move`, { columnId: done.id });
  assert.equal(mv.status, 200); assert.ok(mv.data.task.completedAt);
  const back = await ayseC.post(`/api/tasks/${t.id}/move`, { columnId: cols[1].id });
  assert.equal(back.data.task.completedAt, null);
  const personalCol = boot.columns.find((c) => c.userId);
  assert.equal((await admin.post(`/api/tasks/${t.id}/move`, { columnId: personalCol.id })).status, 400);
  const outsider = boot.users.find((u) => u.email === 'yeni@test.com');
  if (outsider) assert.equal((await admin.post(`/api/tasks/${t.id}/assign`, { assigneeId: outsider.id })).status, 400);
  const cm = await ayseC.post(`/api/tasks/${t.id}/comments`, { body: 'Merhaba' });
  assert.equal(cm.status, 201);
  assert.equal((await admin.get(`/api/tasks/${t.id}/comments`)).data.comments.length, 1);
  const item = (await admin.post(`/api/tasks/${t.id}/checklist`, { text: 'iki' })).data.item;
  assert.equal((await admin.patch('/api/checklist/' + item.id, { isDone: true })).data.item.isDone, true);
  const dash = (await ayseC.get('/api/dashboard')).data;
  assert.ok(dash.total > 0 && typeof dash.progress === 'number');
  assert.equal((await admin.del('/api/tasks/' + t.id)).status, 200);
});

test('etkinlik doğrulaması', async () => {
  const admin = await login('admin@ornek.com', 'Admin123!');
  assert.equal((await admin.post('/api/events', { title: 'x', startAt: '2026-10-20T10:00', endAt: '2026-10-20T09:00' })).status, 400);
  const r = await admin.post('/api/events', { title: 'Tüm gün', startAt: '2026-10-20T10:00', allDay: true, category: 'work' });
  assert.equal(r.status, 201); assert.equal(r.data.event.endAt, '2026-10-20T23:59'); assert.equal(r.data.event.color, '#3b82f6');
});

test('yönetici: kullanıcı yönetimi', async () => {
  const admin = await login('admin@ornek.com', 'Admin123!');
  const r = await admin.post('/api/admin/users', { name: 'Zeynep Kaya', email: 'zeynep@test.com', password: 'Zeynep123', role: 'user' });
  assert.equal(r.status, 201);
  await login('zeynep@test.com', 'Zeynep123');
  const meId = (await admin.get('/api/auth/me')).data.user.id;
  assert.equal((await admin.patch('/api/admin/users/' + meId, { role: 'user' })).status, 400, 'son yönetici düşürülemez');
  assert.equal((await admin.del('/api/admin/users/' + meId)).status, 400);
  assert.equal((await admin.patch('/api/admin/users/' + r.data.user.id, { isActive: false })).status, 200);
  assert.equal((await client().post('/api/auth/login', { email: 'zeynep@test.com', password: 'Zeynep123' })).status, 403);
  assert.equal((await admin.del('/api/admin/users/' + r.data.user.id)).status, 200);
});

test('proje üyeliği ve sütunlar', async () => {
  const ayse = await login('ayse@ornek.com', 'Ayse1234!');
  const p = (await ayse.post('/api/projects', { name: 'Test projesi', color: '#ff0000' })).data.project;
  const admin = await login('admin@ornek.com', 'Admin123!');
  assert.equal((await admin.get('/api/projects/' + p.id)).status, 404);
  const adminId = (await admin.get('/api/auth/me')).data.user.id;
  assert.equal((await ayse.post(`/api/projects/${p.id}/members`, { email: 'admin@ornek.com' })).status, 201);
  assert.equal((await admin.get('/api/projects/' + p.id)).status, 200);
  assert.equal((await admin.patch('/api/projects/' + p.id, { name: 'x' })).status, 403, 'yalnızca sahip düzenler');
  const col = (await admin.post('/api/columns', { name: 'İncelemede', projectId: p.id })).data.column;
  const cols = (await admin.get('/api/columns?projectId=' + p.id)).data.columns;
  assert.deepEqual(cols.map((c) => c.name), ['Yapılacak', 'Devam Ediyor', 'İncelemede', 'Bitti']);
  const t = (await admin.post('/api/tasks', { title: 'Sütun silme testi', projectId: p.id, columnId: col.id })).data.task;
  assert.equal((await admin.del('/api/columns/' + col.id)).status, 200);
  assert.notEqual((await admin.get('/api/tasks/' + t.id)).data.task.columnId, col.id);
  assert.equal((await admin.del(`/api/projects/${p.id}/members/${adminId}`)).status, 200, 'üye ayrılabilir');
  assert.equal((await admin.get('/api/tasks/' + t.id)).status, 404);
  assert.equal((await ayse.del('/api/projects/' + p.id)).status, 200);
});
