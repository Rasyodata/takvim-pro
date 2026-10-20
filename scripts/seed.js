'use strict';
/* Örnek veri yükleyici: npm run seed
 * Önce mevcut tüm örnek (is_sample = 1) kayıtları siler, ardından yeniden oluşturur.
 * Örnek kullanıcıların şifreleri src/sample.js içindedir — üretimde kullanmayın! */
const { open } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { uid, now, todayStr, addDays, weekStart } = require('../src/util');
const S = require('../src/services');
const sample = require('../src/sample');

(async () => {
  const db = await open();
  const t0 = now();
  const today = todayStr();
  const d = (n) => addDays(today, n);
  const hashes = {};
  for (const u of sample.USERS) hashes[u.key] = await hashPassword(u.password);

  await db.tx(async () => {
    await db.run('DELETE FROM events WHERE is_sample = 1', []);
    await db.run('DELETE FROM tasks WHERE is_sample = 1', []);
    await db.run('DELETE FROM projects WHERE is_sample = 1', []);
    await db.run('DELETE FROM users WHERE is_sample = 1', []);
    await db.run('DELETE FROM activity_log WHERE user_id IS NULL AND project_id IS NULL', []);

    const U = {};
    for (const u of sample.USERS) {
      const existing = await db.get('SELECT id FROM users WHERE email = ?', [u.email]);
      if (existing) { console.warn(`! ${u.email} örnek olmayan bir hesap olarak zaten var, atlandı.`); U[u.key] = existing.id; continue; }
      U[u.key] = uid();
      await db.run('INSERT INTO users (id, name, email, password_hash, role, is_active, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)',
        [U[u.key], u.name, u.email, hashes[u.key], u.role, t0, t0]);
      await S.ensurePersonalColumns(db, U[u.key]);
    }

    async function project(name, color, owner, members, description) {
      const id = uid();
      await db.run('INSERT INTO projects (id, owner_id, name, color, description, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', [id, owner, name, color, description, t0, t0]);
      await db.run("INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)", [id, owner, t0]);
      for (const m of members) await db.run("INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'member', ?)", [id, m, t0]);
      await S.createDefaultColumns(db, { projectId: id });
      await S.logActivity(db, { userId: owner, projectId: id, entityType: 'project', entityId: id, action: 'created', details: { name } });
      return id;
    }
    const colsOf = async (w, v) => Object.fromEntries((await db.all(`SELECT * FROM board_columns WHERE ${w} = ? ORDER BY position`, [v])).map((c, i) => [['todo', 'doing', 'done'][i] || c.id, c]));

    const P1 = await project('Örnek: Web Sitesi Yenileme', '#6366f1', U.admin, [U.ayse, U.mehmet], 'Kurumsal web sitesinin yeni tasarımla yayına alınması.');
    const P2 = await project('Örnek: Mobil Uygulama', '#10b981', U.ayse, [U.mehmet], 'iOS/Android uygulamasının ilk sürümü (yönetici bu projenin üyesi değildir).');
    const C1 = await colsOf('project_id', P1), C2 = await colsOf('project_id', P2);
    const PC = { admin: await colsOf('user_id', U.admin), ayse: await colsOf('user_id', U.ayse), mehmet: await colsOf('user_id', U.mehmet) };

    const pos = {};
    async function task(cols, col, title, o = {}) {
      const id = uid(); const c = cols[col];
      pos[c.id] = (pos[c.id] || 0);
      await db.run(`INSERT INTO tasks (id, title, description, priority, column_id, project_id, assignee_id, creator_id, due_date, completed_at, position, is_sample, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, title, o.desc || '', o.priority || 'medium', c.id, c.project_id, o.assignee || null, o.creator, o.due || null, c.is_done ? (o.completedAt || t0) : null, pos[c.id]++, t0, t0]);
      if (o.tags) await S.setTags(db, id, o.tags);
      if (o.checklist) await S.replaceChecklist(db, id, o.checklist.map(([text, isDone]) => ({ text, isDone })));
      await S.logActivity(db, { userId: o.creator, projectId: c.project_id, entityType: 'task', entityId: id, action: 'created', details: { title } });
      return id;
    }
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    // Proje 1 (yönetici + Ayşe + Mehmet)
    const tHero = await task(C1, 'todo', 'Örnek: Ana sayfa metinlerini yaz', { creator: U.admin, assignee: U.ayse, priority: 'high', due: d(2), tags: ['içerik'], desc: 'Hero, özellikler ve SSS bölümleri için metin taslakları.', checklist: [['Hero başlığı', true], ['Özellikler listesi'], ['SSS']] });
    await task(C1, 'todo', 'Örnek: Logo dosyalarını topla', { creator: U.admin, assignee: U.mehmet, priority: 'low', due: d(6), tags: ['tasarım'] });
    await task(C1, 'todo', 'Örnek: Alan adı yenilemesi', { creator: U.admin, assignee: U.admin, priority: 'urgent', due: today, tags: ['altyapı'], desc: 'Alan adının süresi bugün doluyor.' });
    await task(C1, 'doing', 'Örnek: Rapor taslağını gönder', { creator: U.admin, assignee: U.admin, priority: 'high', due: d(-1), tags: ['rapor'], desc: 'Geciken örnek görev.', checklist: [['Verileri derle', true], ['Grafikler', true], ['Özet yaz']] });
    await task(C1, 'doing', 'Örnek: Renk paleti seçimi', { creator: U.ayse, assignee: U.ayse, priority: 'medium', due: d(3), tags: ['tasarım'], checklist: [['3 alternatif hazırla', true], ['Geri bildirim al']] });
    await task(C1, 'done', 'Örnek: Toplantı notlarını paylaş', { creator: U.mehmet, assignee: U.mehmet, priority: 'medium', due: today, tags: ['iletişim'], completedAt: yesterday });
    // Proje 2 (Ayşe + Mehmet; yönetici göremez)
    await task(C2, 'todo', 'Örnek: Giriş ekranı tasarımı', { creator: U.ayse, assignee: U.mehmet, priority: 'high', due: d(4), tags: ['tasarım', 'mobil'] });
    await task(C2, 'doing', 'Örnek: Bildirim altyapısı', { creator: U.ayse, assignee: U.ayse, priority: 'medium', due: d(8), tags: ['mobil'] });
    await task(C2, 'done', 'Örnek: Proje kurulumu', { creator: U.mehmet, assignee: U.mehmet, priority: 'low', due: d(-3), tags: ['mobil'] });
    // Kişisel görevler (yalnızca sahibi görür)
    await task(PC.admin, 'todo', 'Örnek: Fatura ödemesi', { creator: U.admin, assignee: U.admin, priority: 'urgent', due: today, tags: ['finans'], desc: 'Elektrik ve internet faturaları.' });
    await task(PC.admin, 'done', 'Örnek: Market alışverişi', { creator: U.admin, assignee: U.admin, priority: 'low', due: d(-1), tags: ['ev'], checklist: [['Süt', true], ['Ekmek', true]] });
    await task(PC.ayse, 'todo', 'Örnek: Ayşe\'nin özel görevi', { creator: U.ayse, assignee: U.ayse, priority: 'medium', due: d(1), tags: ['özel'], desc: 'Bu görevi yalnızca Ayşe görebilir.' });
    await task(PC.mehmet, 'todo', 'Örnek: Mehmet\'in kişisel listesi', { creator: U.mehmet, assignee: U.mehmet, priority: 'low', due: d(2) });

    await db.run('INSERT INTO comments (id, task_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [uid(), tHero, U.ayse, 'Örnek yorum: Hero başlığını bitirdim, diğer bölümlere yarın bakacağım.', t0, t0]);
    await db.run('INSERT INTO comments (id, task_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [uid(), tHero, U.admin, 'Örnek yorum: Teşekkürler! SSS için müşteri sorularını paylaştım.', t0, t0]);

    async function event(owner, date, start, end, title, category, o = {}) {
      const id = uid();
      const colors = { work: '#3b82f6', meeting: '#8b5cf6', personal: '#10b981', health: '#ef4444', education: '#f59e0b', social: '#ec4899', other: '#64748b' };
      await db.run(`INSERT INTO events (id, title, start_at, end_at, all_day, category, color, notes, owner_id, project_id, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, title, `${date}T${start}`, `${date}T${end}`, o.allDay ? 1 : 0, category, colors[category], o.notes || '', owner, o.project || null, t0, t0]);
      for (const [a, st] of o.attendees || []) await db.run('INSERT INTO event_attendees (event_id, user_id, status, added_at) VALUES (?, ?, ?, ?)', [id, a, st, t0]);
      return id;
    }
    await event(U.admin, today, '09:30', '10:00', 'Örnek: Günlük ekip toplantısı', 'meeting', { project: P1, attendees: [[U.ayse, 'accepted'], [U.mehmet, 'invited']], notes: 'Kısa durum değerlendirmesi.' });
    await event(U.admin, today, '13:00', '14:00', 'Örnek: Müşteri ile öğle yemeği', 'social', { notes: 'Kadıköy' });
    await event(U.admin, today, '16:00', '17:30', 'Örnek: Tasarım incelemesi', 'work', { project: P1, attendees: [[U.ayse, 'accepted']] });
    await event(U.admin, d(1), '08:30', '09:15', 'Örnek: Spor salonu', 'health');
    await event(U.admin, d(2), '11:00', '12:30', 'Örnek: Sprint planlama', 'meeting', { project: P1, attendees: [[U.ayse, 'invited'], [U.mehmet, 'invited']] });
    await event(U.admin, d(4), '19:00', '21:00', 'Örnek: Arkadaşlarla akşam yemeği', 'social');
    await event(U.admin, addDays(weekStart(today), 8), '10:00', '12:00', 'Örnek: Online eğitim — JavaScript', 'education');
    await event(U.admin, d(-2), '15:00', '16:00', 'Örnek: Diş hekimi randevusu', 'health');
    await event(U.ayse, d(1), '14:00', '15:00', 'Örnek: Ayşe — özel doktor randevusu', 'health', { notes: 'Yalnızca Ayşe görür.' });
    await event(U.ayse, d(3), '10:00', '11:00', 'Örnek: Mobil uygulama demo', 'meeting', { project: P2, attendees: [[U.mehmet, 'accepted']] });
    await event(U.mehmet, today, '00:00', '23:59', 'Örnek: Mehmet izinli', 'personal', { allDay: true });
  });

  console.log('✔ Örnek veriler yüklendi. Giriş bilgileri:');
  for (const u of sample.USERS) console.log(`   ${u.role === 'admin' ? 'Yönetici ' : 'Kullanıcı'}  ${u.email.padEnd(18)} / ${u.password}`);
  await db.close();
})().catch((e) => { console.error('Seed hatası:', e); process.exit(1); });
