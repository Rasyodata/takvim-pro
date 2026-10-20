/* Takvim Pro — ön yüz (bağımlılıksız). Veriler REST API üzerinden sunucudaki SQL veritabanında tutulur. */
(function () {
  'use strict';

  // ================== Sabitler ==================
  let TZ = 'Europe/Istanbul';
  const LOCALE = 'tr-TR';
  const UI_KEY = 'takvim.pro.ui.v1';
  const THEME_KEY = 'takvim.theme';
  const HOUR_H = 48;
  const POLL_MS = 30000;

  const PRIORITIES = {
    low: { label: 'Düşük', color: '#22c55e', rank: 1 },
    medium: { label: 'Orta', color: '#3b82f6', rank: 2 },
    high: { label: 'Yüksek', color: '#f97316', rank: 3 },
    urgent: { label: 'Acil', color: '#ef4444', rank: 4 },
  };
  const CATEGORIES = {
    work: { label: 'İş', color: '#3b82f6' },
    meeting: { label: 'Toplantı', color: '#8b5cf6' },
    personal: { label: 'Kişisel', color: '#10b981' },
    health: { label: 'Sağlık', color: '#ef4444' },
    education: { label: 'Eğitim', color: '#f59e0b' },
    social: { label: 'Sosyal', color: '#ec4899' },
    other: { label: 'Diğer', color: '#64748b' },
  };
  const SWATCHES = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#06b6d4', '#64748b'];
  const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f97316', '#10b981', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#f59e0b', '#64748b'];

  // ================== Yardımcılar ==================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const trLower = (s) => String(s || '').toLocaleLowerCase(LOCALE);

  // --- Tarih yardımcıları ('YYYY-MM-DD' metinleri, hesaplar UTC üzerinde) ---
  let ymdFmt, hmFmt;
  function setTZ(tz) {
    TZ = tz || TZ;
    ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  }
  setTZ(TZ);
  function todayStr() { return ymdFmt.format(new Date()); }
  function nowMinutes() { const [h, m] = hmFmt.format(new Date()).split(':').map(Number); return (h % 24) * 60 + m; }
  function parseD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  function fmtD(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(s, n) { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d); }
  function addMonths(s, n) { const d = parseD(s); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return fmtD(d); }
  function weekday(s) { return (parseD(s).getUTCDay() + 6) % 7; }
  function weekStart(s) { return addDays(s, -weekday(s)); }
  function monthStart(s) { return s.slice(0, 8) + '01'; }
  function diffDays(a, b) { return Math.round((parseD(b) - parseD(a)) / 86400000); }
  const fmtCache = {};
  function fmt(s, opts) { const k = JSON.stringify(opts); const f = fmtCache[k] || (fmtCache[k] = new Intl.DateTimeFormat(LOCALE, Object.assign({ timeZone: 'UTC' }, opts))); return f.format(parseD(s)); }
  function fmtStamp(iso) { return new Date(iso).toLocaleString(LOCALE, { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }); }
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'az önce';
    if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
    if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün önce`;
    return fmtStamp(iso);
  }
  function toMin(t) { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); }
  function fromMin(m) { m = Math.max(0, Math.min(24 * 60 - 1, m)); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function relDay(s) {
    const d = diffDays(todayStr(), s);
    if (d === 0) return 'Bugün';
    if (d === 1) return 'Yarın';
    if (d === -1) return 'Dün';
    if (d < 0) return `${-d} gün gecikti`;
    if (d < 7) return fmt(s, { weekday: 'long' });
    return fmt(s, { day: 'numeric', month: 'short' });
  }
  const WEEKDAYS_SHORT = Array.from({ length: 7 }, (_, i) => fmt(addDays('2024-01-01', i), { weekday: 'short' }));

  // ================== API ==================
  class ApiErr extends Error { constructor(status, msg, field) { super(msg); this.status = status; this.field = field; } }
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin',
        headers: Object.assign({ 'X-Requested-With': 'fetch' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      setOffline(true);
      throw new ApiErr(0, 'Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.');
    }
    setOffline(false);
    let data = null;
    try { data = await res.json(); } catch (_) { /* boş gövde */ }
    if (!res.ok) {
      const msg = (data && data.error) || `İstek başarısız (${res.status}).`;
      if (res.status === 401 && !url.startsWith('/api/auth/')) { S = null; showAuth('login', 'Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.'); }
      throw new ApiErr(res.status, msg, data && data.field);
    }
    return data;
  }
  function setOffline(off) {
    let bar = $('#offline-bar');
    if (off && !bar) { bar = document.createElement('div'); bar.id = 'offline-bar'; bar.className = 'offline-bar'; bar.textContent = 'Çevrimdışı — sunucuya ulaşılamıyor'; document.body.appendChild(bar); }
    if (!off && bar) bar.remove();
  }
  /** API hatasını kullanıcıya gösterir. Form alanı belirtilmişse onu işaretler. */
  function showErr(e, form) {
    if (form && e.field) {
      const map = { dueDate: 'due', startAt: 'start', endAt: 'end', columnId: 'column', projectId: 'project', assigneeId: 'assignee' };
      const el = form.elements[map[e.field] || e.field];
      if (el && el.classList) { el.classList.add('invalid'); el.focus(); }
    }
    toast(e.message || 'Bir hata oluştu.', null, 'err');
  }

  // ================== Durum ==================
  let S = null;    // sunucudan gelen görünür veriler
  let CONFIG = { demoAccounts: null, allowRegistration: true };
  const ui = Object.assign({ view: 'today', calMode: 'month', project: '', tag: '', mine: false, board: 'personal' }, loadJSON(UI_KEY) || {});
  ui.q = ''; ui.cursor = todayStr(); ui.dash = null;
  function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, calMode: ui.calMode, project: ui.project, tag: ui.tag, mine: ui.mine, board: ui.board })); } catch (e) { /* yoksay */ } }

  /** API verisini ön yüzün kullandığı biçime dönüştürür. */
  function transform(d) {
    return {
      me: d.me,
      users: d.users,
      projects: d.projects.map((p) => ({ id: p.id, name: p.name, color: p.color, description: p.description, ownerId: p.ownerId, members: p.members, sample: p.isSample })),
      columns: d.columns.map((c) => ({ id: c.id, name: c.name, done: c.isDone, projectId: c.projectId, userId: c.userId, position: c.position })).sort((a, b) => a.position - b.position),
      tasks: d.tasks.map((t) => ({
        id: t.id, title: t.title, desc: t.description, priority: t.priority, column: t.columnId, project: t.projectId || '', due: t.dueDate || '',
        tags: t.tags, checklist: t.checklist.map((c) => ({ id: c.id, text: c.text, done: c.isDone })), completedAt: t.completedAt, order: t.position,
        assignee: t.assigneeId || '', creator: t.creatorId, commentCount: t.commentCount, sample: t.isSample, created: t.createdAt, updated: t.updatedAt,
      })),
      events: d.events.map((e) => ({
        id: e.id, title: e.title, date: e.startAt.slice(0, 10), start: e.startAt.slice(11, 16), end: e.endAt.slice(0, 10) === e.startAt.slice(0, 10) ? e.endAt.slice(11, 16) : '23:59',
        allDay: e.allDay, category: e.category, color: e.color, notes: e.notes, owner: e.ownerId, project: e.projectId || '', attendees: e.attendees, sample: e.isSample,
      })),
      activity: d.activity,
    };
  }
  let lastSig = '';
  async function reload() {
    const d = await api('GET', '/api/bootstrap');
    const sig = JSON.stringify([d.projects, d.columns, d.tasks, d.events, d.activity.slice(0, 3), d.users]);
    const changed = sig !== lastSig; lastSig = sig;
    S = transform(d);
    if (changed) ui.dash = null;
    if (ui.board !== 'personal' && !projById(ui.board)) ui.board = 'personal';
    if (ui.project && ui.project !== 'personal' && !projById(ui.project)) ui.project = '';
    return changed;
  }
  /** İşlem → yeniden yükle → çiz. Hata olursa bildirir ve false döner. */
  async function act(fn, okMsg) {
    try { const r = await fn(); await reload(); render(); if (okMsg) toast(okMsg); return r === undefined ? true : r; }
    catch (e) { if (e.status !== 401) { showErr(e); try { await reload(); render(); } catch (_) { /* yoksay */ } } return false; }
  }

  // ================== Seçiciler ==================
  const me = () => S.me;
  const colById = (id) => S.columns.find((c) => c.id === id);
  const projById = (id) => S && S.projects.find((p) => p.id === id);
  const userById = (id) => S.users.find((u) => u.id === id);
  const userName = (id) => { if (!id) return 'Silinmiş kullanıcı'; if (S && id === S.me.id) return 'Siz'; const u = userById(id); return u ? u.name : 'Eski üye'; };
  const isDone = (t) => { const c = colById(t.column); return !!(c && c.done); };
  const isOwner = (p) => p && p.ownerId === S.me.id;
  const taskColor = (t) => (projById(t.project) || {}).color || PRIORITIES[t.priority].color;
  const boardColumns = (board) => S.columns.filter((c) => (board === 'personal' ? c.userId === S.me.id : c.projectId === board)).sort((a, b) => a.position - b.position);
  const taskBoard = (t) => t.project || 'personal';
  function membersOf(projectId) {
    if (!projectId) return [S.me];
    const p = projById(projectId); if (!p) return [];
    return p.members.map((m) => userById(m.userId) || { id: m.userId, name: 'Eski üye', email: '' });
  }
  function matchQ(text) { if (!ui.q) return true; return trLower(text).includes(trLower(ui.q)); }
  function taskVisible(t) {
    if (ui.project === 'personal' ? !!t.project : ui.project && t.project !== ui.project) return false;
    if (ui.tag && !t.tags.includes(ui.tag)) return false;
    if (ui.mine && t.assignee !== S.me.id) return false;
    return matchQ([t.title, t.desc, t.tags.join(' '), (projById(t.project) || {}).name, t.checklist.map((c) => c.text).join(' ')].join(' '));
  }
  function eventVisible(e) {
    if (ui.tag) return false; // etiket filtresi yalnızca görevler içindir
    if (ui.project === 'personal' ? !!e.project : ui.project && e.project !== ui.project) return false;
    if (ui.mine && !(e.owner === S.me.id || e.attendees.some((a) => a.userId === S.me.id))) return false;
    return matchQ([e.title, e.notes, CATEGORIES[e.category].label].join(' '));
  }
  const visibleEvents = () => S.events.filter(eventVisible);
  const visibleTasks = () => S.tasks.filter(taskVisible);
  function eventsOn(date, list) { return (list || visibleEvents()).filter((e) => e.date === date).sort((a, b) => (b.allDay - a.allDay) || toMin(a.start) - toMin(b.start)); }
  function tasksDueOn(date, list) { return (list || visibleTasks()).filter((t) => t.due === date).sort((a, b) => isDone(a) - isDone(b) || PRIORITIES[b.priority].rank - PRIORITIES[a.priority].rank); }
  function allTags() { const m = new Map(); S.tasks.forEach((t) => t.tags.forEach((g) => m.set(g, (m.get(g) || 0) + 1))); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], LOCALE)); }

  // ---------- Avatar ----------
  function initials(name) { const p = String(name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toLocaleUpperCase(LOCALE); }
  function avatarColor(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }
  function avatar(id, size) {
    if (!id) return `<span class="avatar empty ${size || ''}" title="Atanmamış">?</span>`;
    const u = id === S.me.id ? S.me : userById(id); const name = u ? u.name : 'Eski üye';
    return `<span class="avatar ${size || ''}" style="--ac:${avatarColor(id)}" title="${esc(name)}">${esc(initials(name))}</span>`;
  }

  // ================== Giriş / kayıt ekranı ==================
  function showAuth(mode, notice) {
    document.body.classList.remove('booting');
    $('#app').hidden = true;
    closeAllModals();
    const root = $('#auth-root');
    const reg = mode === 'register';
    const demo = CONFIG.demoAccounts;
    root.innerHTML = `<div class="auth">
      <section class="auth-hero">
        <div class="brand"><img src="/icons/icon.svg" alt="" width="40" height="40"><div><div class="brand-name">Takvim Pro</div><div class="brand-sub">Ekip takvimi & iş akışı</div></div></div>
        <div><h1>Ekibinizin takvimi ve işleri tek bir yerde.</h1>
          <p>Toplantıları planlayın, görevleri atayın, Kanban panosunda ilerlemeyi takip edin.</p>
          <ul><li>📅 Ay, hafta, gün ve ajanda görünümleri</li><li>🧩 Projeler, ekip üyeleri ve görev atama</li><li>✅ Sürükle-bırak Kanban, kontrol listeleri ve yorumlar</li><li>🔒 Herkes yalnızca kendi ve ekibinin verilerini görür</li></ul></div>
        <small style="opacity:.75">Saat dilimi: ${esc(TZ)}</small>
      </section>
      <section class="auth-panel"><div class="auth-card">
        ${CONFIG.allowRegistration ? `<div class="segmented auth-tabs" role="tablist"><button role="tab" class="${reg ? '' : 'active'}" data-auth="login" aria-selected="${!reg}">Giriş yap</button><button role="tab" class="${reg ? 'active' : ''}" data-auth="register" aria-selected="${reg}">Kayıt ol</button></div>` : ''}
        <h2>${reg ? 'Hesap oluşturun' : 'Tekrar hoş geldiniz 👋'}</h2>
        <p class="sub">${reg ? 'Birkaç saniyede ücretsiz hesabınızı oluşturun.' : 'Devam etmek için hesabınıza giriş yapın.'}</p>
        ${notice ? `<div class="auth-err" style="background:var(--warning-soft);color:var(--text);margin-bottom:14px">${esc(notice)}</div>` : ''}
        <form id="auth-form" novalidate>
          ${reg ? '<div class="field"><label for="au-name">Ad soyad</label><input id="au-name" class="input" name="name" autocomplete="name" required maxlength="80"></div>' : ''}
          <div class="field"><label for="au-email">E-posta</label><input id="au-email" class="input" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="ornek@sirket.com"></div>
          <div class="field"><label for="au-pass">Şifre</label><div class="pw-wrap"><input id="au-pass" class="input" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required maxlength="128"><button type="button" data-pw>Göster</button></div>
            ${reg ? '<small class="muted">En az 8 karakter; en az bir harf ve bir rakam.</small>' : ''}</div>
          <div class="auth-err" id="auth-err" hidden></div>
          <button type="submit" class="btn btn-primary" style="padding:11px">${reg ? 'Kayıt ol' : 'Giriş yap'}</button>
        </form>
        ${!reg && demo ? `<div class="demo-box"><b>🧪 Örnek hesaplar (yalnızca deneme içindir)</b>${demo.map((d) => `<button type="button" data-demo="${esc(d.email)}" data-pw="${esc(d.password)}" title="Bilgileri forma doldur"><span>${esc(d.email)}</span><span>${esc(d.password)}</span></button>`).join('')}</div>` : ''}
      </div></section></div>`;
    root.hidden = false;
    const form = $('#auth-form', root);
    setTimeout(() => (form.elements.name || form.elements.email).focus(), 30);
    root.onclick = (e) => {
      const t = e.target.closest('[data-auth]'); if (t) { showAuth(t.dataset.auth); return; }
      const d = e.target.closest('[data-demo]'); if (d) { form.elements.email.value = d.dataset.demo; form.elements.password.value = d.dataset.pw; form.querySelector('[type=submit]').focus(); return; }
      const pw = e.target.closest('button[data-pw]'); if (pw && !pw.dataset.demo) { const i = form.elements.password; i.type = i.type === 'password' ? 'text' : 'password'; pw.textContent = i.type === 'password' ? 'Göster' : 'Gizle'; }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#auth-err', root); err.hidden = true;
      $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));
      const body = { email: form.elements.email.value.trim(), password: form.elements.password.value };
      if (reg) body.name = form.elements.name.value.trim();
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await api('POST', reg ? '/api/auth/register' : '/api/auth/login', body);
        root.hidden = true; root.innerHTML = '';
        await startApp();
        toast(reg ? 'Hesabınız oluşturuldu. Hoş geldiniz!' : `Hoş geldiniz, ${S.me.name}!`);
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        const el = ex.field && form.elements[ex.field]; if (el) { el.classList.add('invalid'); el.focus(); }
      } finally { btn.disabled = false; }
    };
  }
  async function logout() {
    try { await api('POST', '/api/auth/logout'); } catch (_) { /* yoksay */ }
    S = null; lastSig = '';
    try { CONFIG = await api('GET', '/api/config'); } catch (_) { /* yoksay */ }
    showAuth('login');
  }

  // ================== Çizim ==================
  function render() {
    if (!S) return;
    renderSidebar();
    renderFilters();
    renderUserMenu();
    if (ui.view === 'admin' && S.me.role !== 'admin') ui.view = 'today';
    const titles = { today: 'Bugün', calendar: 'Takvim', board: 'İş Akışı', admin: 'Kullanıcı Yönetimi' };
    $('#page-title').textContent = titles[ui.view];
    document.title = titles[ui.view] + ' · Takvim Pro';
    $$('.nav-item[data-view]').forEach((b) => { const on = b.dataset.view === ui.view; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    const v = $('#view');
    const scroll = $('.week-body-wrap', v); const prevScroll = scroll ? scroll.scrollTop : null;
    const board = $('.board', v); const prevBoardScroll = board ? board.scrollLeft : null;
    if (ui.view === 'today') v.innerHTML = renderToday();
    else if (ui.view === 'calendar') v.innerHTML = renderCalendar();
    else if (ui.view === 'board') v.innerHTML = renderBoard();
    else v.innerHTML = renderAdmin();
    const ns = $('.week-body-wrap', v);
    if (ns) ns.scrollTop = prevScroll != null && ui._keepScroll ? prevScroll : Math.max(0, (Math.min(nowMinutes() / 60, 17) - 1.5) * HOUR_H);
    const nb = $('.board', v); if (nb && prevBoardScroll != null) nb.scrollLeft = prevBoardScroll;
    ui._keepScroll = true;
    if (ui.view === 'admin') loadAdminUsers();
    if (ui.view === 'today') ensureDash();
  }

  function renderSidebar() {
    const counts = {};
    S.tasks.forEach((t) => { if (!isDone(t)) counts[t.project || 'personal'] = (counts[t.project || 'personal'] || 0) + 1; });
    const item = (id, name, color, extra) => `<li class="${ui.project === id ? 'active' : ''}">
        <button class="proj-btn" data-action="filter-project" data-id="${id}" title="Bu kapsama göre filtrele">
          <span class="dot" style="background:${esc(color)}"></span><span class="name">${esc(name)}</span><span class="count">${counts[id] || ''}</span>
        </button>${extra || ''}</li>`;
    $('#project-list').innerHTML = item('personal', 'Kişisel', '#94a3b8') + S.projects.map((p) => item(p.id, p.name, p.color,
      `<button class="edit" data-action="edit-project" data-id="${p.id}" aria-label="${esc(p.name)} projesi: ayrıntılar ve üyeler" title="Ayrıntılar ve üyeler">⋯</button>`)).join('');
    const tags = allTags();
    $('#tag-list').innerHTML = tags.length ? tags.map(([g, n]) => `<button class="chip ${ui.tag === g ? 'active' : ''}" data-action="filter-tag" data-tag="${esc(g)}">#${esc(g)} <span class="muted">${n}</span></button>`).join('') : '<span class="empty">Görevlere etiket ekleyin</span>';
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#theme-btn').textContent = dark ? '☀️ Açık tema' : '🌙 Koyu tema';
    const mine = S.tasks.filter((t) => t.assignee === S.me.id && !isDone(t)).length;
    $('#mine-count').textContent = mine || '';
    $('#mine-btn').setAttribute('aria-pressed', String(!!ui.mine));
    $$('.admin-only').forEach((x) => { x.hidden = S.me.role !== 'admin'; });
    const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = dark ? '#171b2d' : '#6366f1';
  }
  function renderFilters() {
    const parts = [];
    if (ui.mine) parts.push(`<span class="chip filter">👤 Bana atananlar<button class="x" data-action="clear-filter" data-k="mine" aria-label="Filtreyi kaldır">×</button></span>`);
    if (ui.project) {
      const p = ui.project === 'personal' ? { name: 'Kişisel', color: '#94a3b8' } : projById(ui.project);
      if (p) parts.push(`<span class="chip filter"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}<button class="x" data-action="clear-filter" data-k="project" aria-label="Proje filtresini kaldır">×</button></span>`);
    }
    if (ui.tag) parts.push(`<span class="chip filter">#${esc(ui.tag)}<button class="x" data-action="clear-filter" data-k="tag" aria-label="Etiket filtresini kaldır">×</button></span>`);
    $('#active-filters').innerHTML = parts.join('');
  }
  function renderUserMenu() {
    $('#user-btn').innerHTML = `${avatar(S.me.id)}<span class="nm">${esc(S.me.name)}</span>`;
    $('#user-btn').setAttribute('aria-label', `Kullanıcı menüsü: ${S.me.name}`);
    const dd = $('#user-dropdown');
    dd.innerHTML = `<div class="who">${avatar(S.me.id, 'lg')}<div style="min-width:0"><div style="font-weight:700">${esc(S.me.name)}</div><div class="em">${esc(S.me.email)}</div>
      <span class="role-badge ${S.me.role}">${S.me.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</span></div></div>
      <button role="menuitem" data-action="profile">👤 Profil ve şifre</button>
      ${S.me.role === 'admin' ? '<button role="menuitem" data-action="view" data-view="admin">🛡️ Kullanıcı yönetimi</button>' : ''}
      <button role="menuitem" data-action="toggle-theme">${document.documentElement.dataset.theme === 'dark' ? '☀️ Açık tema' : '🌙 Koyu tema'}</button>
      <button role="menuitem" data-action="export">⬇️ Verilerimi dışa aktar</button>
      <button role="menuitem" class="danger" data-action="logout">↪ Çıkış yap</button>`;
  }
  function toggleUserMenu(force) {
    const dd = $('#user-dropdown'); const open = force != null ? force : dd.hidden;
    dd.hidden = !open; $('#user-btn').setAttribute('aria-expanded', String(open));
    if (open) { const f = $('button', dd); if (f) f.focus(); }
  }

  // ---------- Ortak parçalar ----------
  const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
  function prioBadge(p) { return `<span class="prio prio-${p}">${PRIORITIES[p].label}</span>`; }
  function chipTitle(t) { const m = /^(Örnek: )(.*)$/.exec(t); return m ? `<span class="sp">${m[1]}</span>${esc(m[2])}` : esc(t); }
  function timeRange(e) { return e.allDay ? 'Tüm gün' : `${e.start}–${e.end}`; }
  function eventChip(e) {
    return `<button class="ev-chip" style="--c:${esc(e.color)}" data-action="edit-event" data-id="${e.id}" title="${esc(e.title)} · ${timeRange(e)}">
      <span class="dot"></span>${e.allDay ? '' : `<span class="tm">${e.start}</span>`}<span class="tt">${chipTitle(e.title)}</span></button>`;
  }
  function taskChip(t) {
    const done = isDone(t); const od = !done && t.due < todayStr();
    return `<button class="ev-chip task ${done ? 'done' : ''} ${od ? 'overdue' : ''}" style="--c:${esc(taskColor(t))}" data-action="edit-task" data-id="${t.id}" title="Görev: ${esc(t.title)} (${PRIORITIES[t.priority].label})">
      <span class="tk"></span><span class="tt">${chipTitle(t.title)}</span></button>`;
  }
  function projLabel(id) { const p = projById(id); return p ? `<span><span class="dot" style="background:${esc(p.color)};width:7px;height:7px"></span> ${esc(p.name)}</span>` : '<span>Kişisel</span>'; }

  // ================== Bugün ==================
  function dashKey() { return JSON.stringify([ui.project, ui.tag, ui.q, ui.mine]); }
  async function ensureDash() {
    const key = dashKey();
    if ((ui.dash && ui.dash.key === key) || ui.dashLoading === key) return;
    ui.dashLoading = key;
    const p = new URLSearchParams();
    if (ui.project) p.set('projectId', ui.project); if (ui.tag) p.set('tag', ui.tag); if (ui.q) p.set('q', ui.q); if (ui.mine) p.set('mine', '1');
    try {
      const data = await api('GET', '/api/dashboard?' + p.toString());
      ui.dash = { key, data };
      if (ui.view === 'today' && dashKey() === key && !modalStack.length) { const v = $('#view'); const y = window.scrollY; v.innerHTML = renderToday(); window.scrollTo(0, y); }
    } catch (_) { /* yoksay */ } finally { ui.dashLoading = null; }
  }
  const ACT_TEXT = {
    'task:created': 'görev oluşturdu', 'task:updated': 'görevi güncelledi', 'task:deleted': 'görevi sildi', 'task:moved': 'görevi taşıdı', 'task:assigned': 'görev atadı', 'task:unassigned': 'görev atamasını kaldırdı',
    'comment:commented': 'yorum yaptı', 'event:created': 'etkinlik oluşturdu', 'event:updated': 'etkinliği güncelledi', 'event:deleted': 'etkinliği sildi',
    'project:created': 'projeyi oluşturdu', 'project:updated': 'projeyi güncelledi', 'project:member_added': 'projeye üye ekledi', 'project:member_removed': 'projeden üye çıkardı', 'project:member_left': 'projeden ayrıldı',
    'column:created': 'sütun ekledi', 'column:deleted': 'sütun sildi', 'user:registered': 'kaydoldu', 'user:created': 'kullanıcı oluşturdu', 'user:updated': 'kullanıcıyı güncelledi', 'user:deleted': 'kullanıcıyı sildi',
  };
  function activityRow(a) {
    const d = a.details || {};
    const verb = ACT_TEXT[a.entityType + ':' + a.action] || a.action;
    let obj = d.title || d.name || d.member || '';
    let extra = '';
    if (a.action === 'moved' && d.to) extra = ` → <b>${esc(d.to)}</b>`;
    if (a.action === 'assigned' && d.assigneeId) extra = ` → <b>${esc(userName(d.assigneeId))}</b>`;
    if (d.member) obj = d.member;
    const p = projById(a.projectId);
    return `<div class="a-row">${avatar(a.userId, 'sm')}<div class="tx"><b>${esc(userName(a.userId))}</b> ${verb}${obj ? `: “${esc(obj)}”` : ''}${extra}
      <span class="when">${ago(a.createdAt)}${p ? ' · ' + esc(p.name) : ''}</span></div></div>`;
  }
  function renderToday() {
    const t = todayStr(); const ws = weekStart(t);
    const events = eventsOn(t);
    const tasks = visibleTasks();
    const dueToday = tasks.filter((x) => x.due === t);
    const overdue = tasks.filter((x) => x.due && x.due < t && !isDone(x)).sort((a, b) => a.due.localeCompare(b.due));
    const upcoming = tasks.filter((x) => x.due && x.due > t && x.due <= addDays(t, 7) && !isDone(x)).sort((a, b) => a.due.localeCompare(b.due) || PRIORITIES[b.priority].rank - PRIORITIES[a.priority].rank);
    const assigned = tasks.filter((x) => x.assignee === S.me.id && !isDone(x)).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || PRIORITIES[b.priority].rank - PRIORITIES[a.priority].rank);
    const D = ui.dash && ui.dash.key === dashKey() ? ui.dash.data : null;
    const val = (k) => (D ? D[k] : '…');
    const nowM = nowMinutes(); const hour = Math.floor(nowM / 60);
    const greet = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
    const perDay = D ? D.completedPerDay.map((x) => x.count) : Array(7).fill(0);
    const max = Math.max(1, ...perDay);
    const hasSample = S.tasks.some((x) => x.sample) || S.events.some((x) => x.sample);

    const evRows = events.length ? events.map((e) => {
      const isNow = !e.allDay && toMin(e.start) <= nowM && nowM < toMin(e.end);
      const past = !e.allDay && toMin(e.end) <= nowM;
      const att = e.attendees.length ? ` · <span class="avatar-stack">${[e.owner].concat(e.attendees.map((a) => a.userId)).slice(0, 4).map((id) => avatar(id, 'sm')).join('')}</span>` : '';
      return `<button class="row-item ${isNow ? 'is-now' : ''}" data-action="edit-event" data-id="${e.id}" style="${past ? 'opacity:.6' : ''}">
        <span class="bar" style="background:${esc(e.color)}"></span><span class="time">${timeRange(e)}</span>
        <span class="main-txt"><div class="t">${esc(e.title)}</div>
        <div class="meta">${CATEGORIES[e.category].label}${e.project ? ' · ' + projLabel(e.project) : ''}${isNow ? ' · <b style="color:var(--primary)">Şu an</b>' : ''}${e.notes ? ' · ' + esc(e.notes.slice(0, 50)) : ''}${att}</div></span></button>`;
    }).join('') : `<div class="empty-state">Bugün için etkinlik yok.<br><button class="btn btn-sm btn-soft" style="margin-top:8px" data-action="new-event" data-date="${t}">+ Etkinlik ekle</button></div>`;

    const taskRow = (x, od) => {
      const done = isDone(x);
      const cl = x.checklist.length ? ` · ☑ ${x.checklist.filter((c) => c.done).length}/${x.checklist.length}` : '';
      return `<div class="row-item ${od ? 'overdue' : ''}" data-action="edit-task" data-id="${x.id}" role="button" tabindex="0">
        <button class="check ${done ? 'done' : ''}" data-action="toggle-done" data-id="${x.id}" aria-label="${done ? 'Tamamlanmadı olarak işaretle' : 'Tamamlandı olarak işaretle'}" title="${done ? 'Geri al' : 'Tamamla'}">${done ? ICON_CHECK : ''}</button>
        <span class="main-txt"><div class="t ${done ? 'done-txt' : ''}">${esc(x.title)}</div>
        <div class="meta">${prioBadge(x.priority)}${projLabel(x.project)}${x.due ? `<span class="due">${od ? '⚠ ' : ''}${relDay(x.due)}</span>` : ''}<span>${esc((colById(x.column) || {}).name || '')}${cl}</span></div></span>
        ${avatar(x.assignee, 'sm')}</div>`;
    };
    return `
      <div class="hero">
        <div><h2>${greet}, ${esc(S.me.name.split(' ')[0])}! 👋</h2><p>${fmt(t, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${hmFmt.format(new Date())} (İstanbul)</p></div>
        <div style="display:flex;gap:8px"><button class="btn" data-action="new-task" data-due="${t}">+ Bugüne görev</button><button class="btn btn-primary" data-action="new-event" data-date="${t}">+ Etkinlik</button></div>
      </div>
      ${hasSample ? `<div class="sample-banner"><span>📌 <b>Örnek</b> veriler gösteriliyor (başlıkları “Örnek:” ile başlar).${S.me.role === 'admin' ? ' Yönetim sayfasından tek tıkla silebilirsiniz.' : ''}</span>${S.me.role === 'admin' ? '<button class="btn btn-sm" data-action="view" data-view="admin">Yönetim</button>' : ''}</div>` : ''}
      <div class="stats">
        <div class="panel stat"><span class="ico" style="background:var(--primary-soft)">📅</span><span class="label">Bugünkü etkinlikler</span><span class="value">${val('eventsToday')}</span><span class="sub">${events.filter((e) => !e.allDay && toMin(e.start) > nowM).length} tanesi henüz başlamadı</span></div>
        <div class="panel stat"><span class="ico" style="background:var(--warning-soft)">🎯</span><span class="label">Bugün teslim</span><span class="value">${val('dueToday')}</span><span class="sub">${val('dueTodayDone')} tamamlandı</span></div>
        <div class="panel stat ${D && D.overdue ? 'danger' : ''}"><span class="ico" style="background:var(--danger-soft)">⏰</span><span class="label">Gecikmiş görevler</span><span class="value">${val('overdue')}</span><span class="sub">${D && D.overdue ? 'Öncelik verin' : 'Gecikme yok'}</span></div>
        <div class="panel stat"><span class="ico" style="background:var(--success-soft)">✅</span><span class="label">Bu hafta tamamlanan</span><span class="value">${val('completedThisWeek')}</span><span class="sub">${val('assignedToMeOpen')} açık görev size atanmış</span></div>
        <div class="panel stat"><span class="ico" style="background:var(--surface-2)">📈</span><span class="label">Genel ilerleme</span><span class="value">%${val('progress')}</span><div class="progress" aria-label="İlerleme"><i style="width:${D ? D.progress : 0}%"></i></div><span class="sub">${val('done')}/${val('total')} görev bitti</span></div>
      </div>
      <div class="dash-grid">
        <div class="dash-col">
          <section class="panel"><div class="panel-head"><h2>📅 Bugünün programı</h2><span class="muted">${fmt(t, { day: 'numeric', month: 'long' })}</span></div><div class="panel-body">${evRows}</div></section>
          <section class="panel"><div class="panel-head"><h2>🗓 Önümüzdeki 7 gün</h2><span class="muted">${upcoming.length} görev</span></div><div class="panel-body">${upcoming.length ? upcoming.map((x) => taskRow(x, false)).join('') : '<div class="empty-state">Yaklaşan görev yok.</div>'}</div></section>
          <section class="panel"><div class="panel-head"><h2>🕘 Son hareketler</h2><span class="muted">ekip etkinliği</span></div><div class="panel-body activity">${S.activity.length ? S.activity.slice(0, 8).map(activityRow).join('') : '<div class="empty-state">Henüz hareket yok.</div>'}</div></section>
        </div>
        <div class="dash-col">
          ${overdue.length ? `<section class="panel" style="border-color:color-mix(in srgb,var(--danger) 40%,var(--border))"><div class="panel-head"><h2 style="color:var(--danger)">⚠ Gecikmiş</h2><span class="muted">${overdue.length} görev</span></div><div class="panel-body">${overdue.map((x) => taskRow(x, true)).join('')}</div></section>` : ''}
          <section class="panel"><div class="panel-head"><h2>👤 Bana atanan açık görevler</h2><span class="muted">${assigned.length} görev</span></div><div class="panel-body">${assigned.length ? assigned.slice(0, 8).map((x) => taskRow(x, x.due && x.due < t)).join('') + (assigned.length > 8 ? `<div class="muted" style="padding:6px 8px;font-size:12.5px">+${assigned.length - 8} görev daha</div>` : '') : '<div class="empty-state">Size atanmış açık görev yok. 🎉</div>'}</div></section>
          <section class="panel"><div class="panel-head"><h2>🎯 Bugün teslim edilecekler</h2><span class="muted">${dueToday.length} görev</span></div><div class="panel-body">${dueToday.length ? dueToday.map((x) => taskRow(x, false)).join('') : '<div class="empty-state">Bugün teslim edilecek görev yok.</div>'}</div></section>
          <section class="panel"><div class="panel-head"><h2>📊 Bu hafta tamamlananlar</h2><span class="muted">${fmt(ws, { day: 'numeric', month: 'short' })} – ${fmt(addDays(ws, 6), { day: 'numeric', month: 'short' })}</span></div>
            <div class="week-bars">${perDay.map((n, i) => { const d = addDays(ws, i); return `<div class="b ${d === t ? 'today' : ''}" title="${fmt(d, { weekday: 'long' })}: ${n} görev"><span class="n">${n || ''}</span><i style="height:${(n / max) * 80}%"></i><span class="d">${WEEKDAYS_SHORT[i]}</span></div>`; }).join('')}</div>
            <div class="panel-body"></div></section>
        </div>
      </div>`;
  }

  // ================== Takvim ==================
  function calTitle() {
    const c = ui.cursor;
    if (ui.calMode === 'month') return fmt(c, { month: 'long', year: 'numeric' });
    if (ui.calMode === 'week') {
      const a = weekStart(c), b = addDays(a, 6);
      return a.slice(0, 7) === b.slice(0, 7) ? `${fmt(a, { day: 'numeric' })} – ${fmt(b, { day: 'numeric', month: 'long', year: 'numeric' })}` : `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    if (ui.calMode === 'day') return fmt(c, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `${fmt(c, { day: 'numeric', month: 'long' })} – ${fmt(addDays(c, 29), { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  function renderCalendar() {
    const modes = [['month', 'Ay'], ['week', 'Hafta'], ['day', 'Gün'], ['agenda', 'Ajanda']];
    let body;
    if (ui.calMode === 'month') body = renderMonth();
    else if (ui.calMode === 'week') body = renderTimeGrid(weekStart(ui.cursor), 7);
    else if (ui.calMode === 'day') body = renderTimeGrid(ui.cursor, 1);
    else body = renderAgenda();
    return `
      <div class="cal-toolbar">
        <button class="btn" data-action="cal-today" title="Bugüne git (T)">Bugün</button>
        <button class="icon-btn" data-action="cal-prev" aria-label="Önceki" title="Önceki (←)"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <button class="icon-btn" data-action="cal-next" aria-label="Sonraki" title="Sonraki (→)"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
        <h2 aria-live="polite">${calTitle()}</h2>
        <span class="grow"></span>
        <div class="segmented" role="tablist" aria-label="Takvim görünümü">${modes.map(([k, l]) => `<button role="tab" aria-selected="${ui.calMode === k}" class="${ui.calMode === k ? 'active' : ''}" data-action="cal-mode" data-mode="${k}">${l}</button>`).join('')}</div>
        <button class="btn btn-primary" data-action="new-event" data-date="${ui.cursor}">+ Etkinlik</button>
      </div>
      ${ui.tag ? '<p class="muted" style="margin:-6px 0 12px;font-size:12.5px">Etiket filtresi etkin: yalnızca eşleşen görevler gösteriliyor.</p>' : ''}
      ${body}`;
  }
  function renderMonth() {
    const t = todayStr(); const ms = monthStart(ui.cursor); const start = weekStart(ms);
    const evs = visibleEvents(), tks = visibleTasks().filter((x) => x.due);
    const weeks = diffDays(start, addDays(monthStart(addMonths(ms, 1)), -1)) >= 35 ? 6 : 5;
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i);
      const items = [...eventsOn(d, evs).map(eventChip), ...tasksDueOn(d, tks).map(taskChip)];
      const more = items.length > 3 ? `<button class="more" data-action="goto-day" data-date="${d}">+${items.length - 3} daha</button>` : '';
      const cls = [d.slice(0, 7) !== ms.slice(0, 7) ? 'other' : '', d === t ? 'today' : '', weekday(d) >= 5 ? 'weekend' : ''].join(' ');
      cells.push(`<div class="mcell ${cls}" data-action="new-event-day" data-date="${d}" aria-label="${fmt(d, { day: 'numeric', month: 'long', weekday: 'long' })}">
        <button class="dnum" data-action="goto-day" data-date="${d}" title="Gün görünümüne geç">${parseD(d).getUTCDate()}</button>${items.slice(0, 3).join('')}${more}</div>`);
    }
    return `<div class="panel month"><div class="month-head">${WEEKDAYS_SHORT.map((w) => `<div>${w}</div>`).join('')}</div><div class="month-grid">${cells.join('')}</div></div>
      <p class="muted" style="font-size:12.5px;margin-top:10px">İpucu: Yeni etkinlik için bir güne tıklayın. Kesik çizgili öğeler teslim tarihli görevlerdir.</p>`;
  }
  function layoutDay(events) {
    const evs = events.filter((e) => !e.allDay).map((e) => ({ e, s: toMin(e.start), en: Math.max(toMin(e.end), toMin(e.start) + 20) })).sort((a, b) => a.s - b.s || b.en - a.en);
    const out = []; let cluster = [], clusterEnd = -1;
    const flush = () => {
      const cols = [];
      cluster.forEach((it) => { let c = cols.findIndex((end) => end <= it.s); if (c === -1) { c = cols.length; cols.push(0); } cols[c] = it.en; it.col = c; });
      cluster.forEach((it) => { it.cols = cols.length; out.push(it); });
      cluster = []; clusterEnd = -1;
    };
    evs.forEach((it) => { if (cluster.length && it.s >= clusterEnd) flush(); cluster.push(it); clusterEnd = Math.max(clusterEnd, it.en); });
    if (cluster.length) flush();
    return out;
  }
  function renderTimeGrid(start, days) {
    const t = todayStr(); const evs = visibleEvents(), tks = visibleTasks().filter((x) => x.due);
    const dates = Array.from({ length: days }, (_, i) => addDays(start, i)); const nowM = nowMinutes();
    const head = dates.map((d) => `<div class="wh ${d === t ? 'today' : ''}" data-action="goto-day" data-date="${d}" title="Gün görünümü"><div class="wd">${fmt(d, { weekday: days === 1 ? 'long' : 'short' })}</div><div class="wn">${parseD(d).getUTCDate()}</div></div>`).join('');
    const allday = dates.map((d) => `<div class="ad">${[...eventsOn(d, evs).filter((e) => e.allDay).map(eventChip), ...tasksDueOn(d, tks).map(taskChip)].join('')}</div>`).join('');
    const hours = Array.from({ length: 24 }, (_, h) => `<div class="hl">${String(h).padStart(2, '0')}:00</div>`).join('');
    const cols = dates.map((d) => {
      const blocks = layoutDay(eventsOn(d, evs)).map((it) => {
        const top = (it.s / 60) * HOUR_H, h = Math.max(((it.en - it.s) / 60) * HOUR_H - 2, 18); const w = 100 / it.cols;
        return `<button class="tevent" style="--c:${esc(it.e.color)};top:${top}px;height:${h}px;left:calc(${it.col * w}% + 2px);width:calc(${w}% - 4px)" data-action="edit-event" data-id="${it.e.id}" title="${esc(it.e.title)} · ${timeRange(it.e)}">
          <span class="tt">${chipTitle(it.e.title)}</span>${h > 30 ? `<span class="tm">${it.e.start}–${it.e.end}</span>` : ''}</button>`;
      }).join('');
      const now = d === t ? `<div class="now-line" style="top:${(nowM / 60) * HOUR_H}px"></div>` : '';
      return `<div class="day-col ${d === t ? 'today' : weekday(d) >= 5 ? 'weekend' : ''}" data-action="slot" data-date="${d}">${Array.from({ length: 24 }, (_, h) => `<div class="slot" data-hour="${h}"></div>`).join('')}${blocks}${now}</div>`;
    }).join('');
    return `<div class="panel week" style="--days:${days}"><div class="week-scroll-x"><div class="week-inner">
      <div class="week-head"><div></div>${head}</div>
      <div class="week-allday"><div class="gut">Tüm gün<br>/ görev</div>${allday}</div>
      <div class="week-body-wrap"><div class="week-body"><div class="time-col">${hours}</div>${cols}</div></div>
      </div></div></div>
      <p class="muted" style="font-size:12.5px;margin-top:10px">İpucu: Boş bir saat dilimine tıklayarak o saatte etkinlik oluşturun.</p>`;
  }
  function renderAgenda() {
    const t = todayStr(); const evs = visibleEvents(), tks = visibleTasks().filter((x) => x.due); const rows = [];
    for (let i = 0; i < 30; i++) {
      const d = addDays(ui.cursor, i); const es = eventsOn(d, evs), ts = tasksDueOn(d, tks);
      if (!es.length && !ts.length) continue;
      const items = es.map((e) => `<button class="row-item" data-action="edit-event" data-id="${e.id}"><span class="bar" style="background:${esc(e.color)}"></span><span class="time">${timeRange(e)}</span><span class="main-txt"><div class="t">${esc(e.title)}</div><div class="meta">${CATEGORIES[e.category].label}${e.project ? ' · ' + projLabel(e.project) : ''}${e.notes ? ' · ' + esc(e.notes.slice(0, 80)) : ''}</div></span>${avatar(e.owner, 'sm')}</button>`)
        .concat(ts.map((x) => { const done = isDone(x); const od = !done && x.due < t; return `<button class="row-item ${od ? 'overdue' : ''}" data-action="edit-task" data-id="${x.id}"><span class="bar" style="background:${esc(taskColor(x))}"></span><span class="time">Görev</span><span class="main-txt"><div class="t ${done ? 'done-txt' : ''}">${esc(x.title)}</div><div class="meta">${prioBadge(x.priority)} ${projLabel(x.project)} ${esc((colById(x.column) || {}).name || '')}${od ? ' · <span class="due">Gecikti</span>' : ''}</div></span>${avatar(x.assignee, 'sm')}</button>`; }));
      rows.push(`<div class="agenda-day ${d === t ? 'today' : ''}"><div class="ad-date"><div class="num">${parseD(d).getUTCDate()}</div><div class="wd">${fmt(d, { month: 'short', weekday: 'long' })}</div>${d === t ? '<div class="wd" style="color:var(--primary)">Bugün</div>' : ''}</div><div class="items">${items.join('')}</div></div>`);
    }
    return `<div class="panel">${rows.length ? rows.join('') : '<div class="empty-state" style="padding:40px">Önümüzdeki 30 günde kayıt yok.</div>'}</div>`;
  }

  // ================== Kanban ==================
  function renderBoard() {
    if (ui.project && ui.project !== ui.board) ui.board = ui.project;
    const board = ui.board;
    const cols = boardColumns(board);
    const tasks = visibleTasks().filter((x) => taskBoard(x) === board);
    const t = todayStr();
    const p = projById(board);
    const colHtml = cols.map((c) => {
      const list = tasks.filter((x) => x.column === c.id).sort((a, b) => a.order - b.order);
      const cards = list.map((x) => {
        const done = c.done; const od = !done && x.due && x.due < t; const td = !done && x.due === t;
        const cl = x.checklist.length; const cld = x.checklist.filter((i) => i.done).length;
        const dueTxt = x.due ? (relDay(x.due) === fmt(x.due, { day: 'numeric', month: 'short' }) ? relDay(x.due) : relDay(x.due) + ' · ' + fmt(x.due, { day: 'numeric', month: 'short' })) : '';
        return `<article class="card ${done ? 'is-done' : ''}" style="--pc:${PRIORITIES[x.priority].color}" data-id="${x.id}" tabindex="0" role="button" aria-label="${esc(x.title)}, öncelik ${PRIORITIES[x.priority].label}${x.assignee ? ', atanan ' + esc(userName(x.assignee)) : ''}. Düzenlemek için Enter, taşımak için Alt + ok tuşları.">
          <div class="c-title">${esc(x.title)}</div>
          ${x.desc ? `<div class="c-desc">${esc(x.desc)}</div>` : ''}
          <div class="c-meta">${prioBadge(x.priority)}${x.tags.map((g) => `<span class="chip">#${esc(g)}</span>`).join('')}</div>
          <div class="c-foot">${x.due ? `<span class="due ${od ? 'overdue' : td ? 'today' : ''}">📅 ${od ? 'Gecikti · ' : ''}${dueTxt}</span>` : ''}<span class="sp"></span>
            ${cl ? `<span class="mini-progress" title="Alt görevler">☑ ${cld}/${cl}<span class="progress"><i style="width:${(cld / cl) * 100}%"></i></span></span>` : ''}
            ${x.commentCount ? `<span class="ic" title="${x.commentCount} yorum">💬 ${x.commentCount}</span>` : ''}${avatar(x.assignee, 'sm')}</div>
        </article>`;
      }).join('');
      return `<section class="column" data-col="${c.id}" aria-label="${esc(c.name)} sütunu">
        <div class="col-head">
          <button class="col-title" data-action="rename-col" data-id="${c.id}" title="Yeniden adlandırmak için tıklayın">${esc(c.name)}</button>
          ${c.done ? '<span class="col-done-flag" title="Bu sütundaki görevler tamamlanmış sayılır">✓</span>' : ''}
          <span class="cnt">${list.length}</span>
          <button class="icon-btn sm ghost" data-action="col-menu" data-id="${c.id}" aria-label="Sütun seçenekleri" title="Sütun seçenekleri">⋯</button>
        </div>
        <div class="col-cards" data-col="${c.id}">${cards}</div>
        <div class="col-foot"><button class="add-card-btn" data-action="quick-add" data-col="${c.id}">+ Kart ekle</button></div>
      </section>`;
    }).join('');
    const members = p ? `<span class="avatar-stack" title="Proje üyeleri">${p.members.slice(0, 6).map((m) => avatar(m.userId)).join('')}</span><button class="btn btn-sm btn-ghost" data-action="edit-project" data-id="${p.id}">👥 Üyeler (${p.members.length})</button>` : '<span class="muted" style="font-size:12.5px">🔒 Kişisel pano yalnızca size görünür</span>';
    return `
      <div class="board-toolbar">
        <select class="input board-select" id="board-select" aria-label="Pano seçin">
          <option value="personal" ${board === 'personal' ? 'selected' : ''}>🔒 Kişisel pano</option>
          ${S.projects.map((x) => `<option value="${x.id}" ${board === x.id ? 'selected' : ''}>📁 ${esc(x.name)}</option>`).join('')}
        </select>
        ${members}
        <span class="grow"></span>
        <span class="muted" style="font-size:12.5px">${tasks.length} görev${(ui.tag || ui.q || ui.mine) ? ' (filtrelenmiş)' : ''} · sürükle-bırak · Alt + ←/→</span>
        <button class="btn" data-action="add-column">+ Sütun</button>
        <button class="btn btn-primary" data-action="new-task" data-board="${board}">+ Görev</button>
      </div>
      <div class="board">${colHtml}<button class="add-column" data-action="add-column">+ Yeni sütun ekle</button></div>`;
  }

  // ================== Yönetim (admin) ==================
  let adminUsers = null; let adminLoading = false;
  async function loadAdminUsers(force) {
    if (adminLoading || (adminUsers && !force)) return;
    adminLoading = true;
    try { adminUsers = (await api('GET', '/api/admin/users')).users; if (ui.view === 'admin' && !modalStack.length) $('#view').innerHTML = renderAdmin(); }
    catch (e) { if (e.status !== 401) showErr(e); }
    finally { adminLoading = false; }
  }
  function renderAdmin() {
    if (!adminUsers) return '<div class="empty-state" style="padding:60px">Kullanıcılar yükleniyor…</div>';
    const q = trLower(ui.q);
    const list = adminUsers.filter((u) => !q || trLower(u.name + ' ' + u.email).includes(q));
    const samples = adminUsers.filter((u) => u.isSample).length;
    return `
      <div class="admin-toolbar">
        <div><h2 style="margin:0;font-size:20px;letter-spacing:-.02em">Kullanıcılar</h2><span class="muted">${adminUsers.length} kullanıcı · ${adminUsers.filter((u) => u.role === 'admin').length} yönetici · ${adminUsers.filter((u) => !u.isActive).length} devre dışı</span></div>
        <span class="grow"></span>
        <button class="btn btn-primary" data-action="admin-new-user">+ Yeni kullanıcı</button>
      </div>
      ${samples || S.tasks.some((t) => t.sample) ? `<div class="sample-banner"><span>⚠️ Sistemde bilinen şifrelere sahip <b>örnek</b> hesaplar ve örnek veriler var. Gerçek kullanıma geçmeden önce silin.</span><button class="btn btn-sm" data-action="admin-clear-samples">Örnek verileri sil</button></div>` : ''}
      <div class="panel table-wrap"><table class="data">
        <thead><tr><th>Kullanıcı</th><th>Rol</th><th>Durum</th><th class="num">Proje</th><th class="num">Açık görev</th><th>Son giriş</th><th>Kayıt</th><th></th></tr></thead>
        <tbody>${list.map((u) => `<tr>
          <td><div class="who">${avatar(u.id)}<div><b>${esc(u.name)}</b>${u.id === S.me.id ? ' <span class="muted">(siz)</span>' : ''}<small>${esc(u.email)}</small></div></div></td>
          <td><span class="role-badge ${u.role}">${u.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}</span></td>
          <td><span class="status-dot ${u.isActive ? '' : 'off'}">${u.isActive ? 'Etkin' : 'Devre dışı'}</span></td>
          <td class="num">${u.memberships}</td><td class="num">${u.openAssigned}</td>
          <td class="muted">${u.lastLoginAt ? ago(u.lastLoginAt) : '—'}</td><td class="muted">${fmtStamp(u.createdAt)}</td>
          <td><div class="row-actions"><button class="btn btn-sm btn-ghost" data-action="admin-edit-user" data-id="${u.id}">Düzenle</button>${u.id !== S.me.id ? `<button class="btn btn-sm btn-ghost danger" data-action="admin-delete-user" data-id="${u.id}">Sil</button>` : ''}</div></td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty-state">Eşleşen kullanıcı yok.</td></tr>'}</tbody></table></div>`;
  }

  // ================== Modal altyapısı ==================
  let modalStack = [];
  function openModal({ title, body, footer, size, onMount, onSubmit }) {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    const id = 'm' + Math.random().toString(36).slice(2);
    wrap.innerHTML = `<div class="modal ${size || ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
      <div class="modal-head"><h3 id="${id}">${title}</h3><button type="button" class="icon-btn ghost" data-close aria-label="Kapat" title="Kapat (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <form class="modal-form" novalidate><div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</form></div>`;
    $('#modal-root').appendChild(wrap);
    const m = { el: wrap, prevFocus, close: () => closeModal(m), onSubmit, busy: false };
    modalStack.push(m);
    wrap.addEventListener('mousedown', (e) => { m._down = e.target === wrap; });
    wrap.addEventListener('click', (e) => { if ((e.target === wrap && m._down) || e.target.closest('[data-close]')) { e.preventDefault(); m.close(); } });
    const form = $('form', wrap);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit || m.busy) return;
      m.busy = true; const btn = $('[type=submit]', wrap); if (btn) btn.disabled = true;
      $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));
      try { await onSubmit(m, form); } finally { m.busy = false; if (btn) btn.disabled = false; }
    });
    if (onMount) onMount(wrap, m, form);
    setTimeout(() => { if (wrap.contains(document.activeElement)) return; const f = $('[data-autofocus]', wrap) || $('input:not([disabled]),select:not([disabled]),textarea:not([disabled])', $('.modal-body', wrap)) || $('button', wrap); if (f) f.focus(); }, 20);
    return m;
  }
  function closeModal(m) {
    m = m || modalStack[modalStack.length - 1]; if (!m) return;
    modalStack = modalStack.filter((x) => x !== m); m.el.remove();
    if (m.onClose) m.onClose();
    if (m.prevFocus && document.contains(m.prevFocus)) m.prevFocus.focus();
  }
  function closeAllModals() { while (modalStack.length) closeModal(); }
  function confirmDialog(title, message, okLabel, danger) {
    return new Promise((resolve) => {
      let done = false;
      const m = openModal({
        title: esc(title), size: 'sm', body: `<p style="margin:4px 0 6px;color:var(--text-2)">${esc(message)}</p>`,
        footer: `<span class="grow"></span><button type="button" class="btn btn-ghost" data-close>Vazgeç</button><button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-autofocus>${esc(okLabel || 'Tamam')}</button>`,
        onSubmit: (mm) => { done = true; resolve(true); closeModal(mm); },
      });
      m.onClose = () => { if (!done) resolve(false); };
    });
  }
  function toast(msg, action, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    if (kind === 'err') el.style.background = 'var(--danger)';
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    $('#toasts').appendChild(el);
    const kill = () => el.remove();
    if (action) $('button', el).addEventListener('click', () => { action.fn(); kill(); });
    setTimeout(kill, kind === 'err' ? 5000 : 3000);
  }
  const fieldErr = (form, name, msg) => { const el = form.elements[name]; if (el) { el.classList.add('invalid'); el.focus(); } toast(msg, null, 'err'); };
  function peoplePicker(users, selected, name, opts = {}) {
    if (!users.length) return '<div class="muted" style="padding:8px">Seçilebilecek kişi yok.</div>';
    return users.map((u) => `<label><input type="checkbox" name="${name}" value="${u.id}" ${selected.includes(u.id) ? 'checked' : ''} ${opts.disabled ? 'disabled' : ''}>${avatar(u.id, 'sm')}<span class="nm">${esc(u.name)}<small>${esc(u.email)}</small></span>${opts.status ? opts.status(u.id) : ''}</label>`).join('');
  }
  const RSVP = { invited: 'Davetli', accepted: 'Katılıyor', declined: 'Katılmıyor' };

  // ================== Etkinlik formu ==================
  function openEvent(id, preset) {
    const ex = id ? S.events.find((e) => e.id === id) : null;
    if (id && !ex) { toast('Etkinlik bulunamadı.', null, 'err'); return; }
    const canEdit = !ex || ex.owner === S.me.id;
    const d = ex ? JSON.parse(JSON.stringify(ex)) : Object.assign({ title: '', date: ui.cursor || todayStr(), start: '09:00', end: '10:00', allDay: false, category: 'work', color: CATEGORIES.work.color, notes: '', project: ui.project && ui.project !== 'personal' ? ui.project : '', attendees: [], owner: S.me.id }, preset || {});
    if (!ex && preset && preset.start && !preset.end) d.end = fromMin(Math.min(toMin(preset.start) + 60, 23 * 60 + 59));
    const myAtt = ex && ex.attendees.find((a) => a.userId === S.me.id);
    const dis = canEdit ? '' : 'disabled';
    const others = S.users.filter((u) => u.id !== d.owner);
    const swatches = () => SWATCHES.map((c) => `<button type="button" class="swatch ${d.color === c ? 'active' : ''}" style="--c:${c}" data-color="${c}" aria-label="Renk ${c}" aria-pressed="${d.color === c}" ${dis}></button>`).join('');
    openModal({
      title: ex ? (canEdit ? 'Etkinliği düzenle' : 'Etkinlik ayrıntıları') : 'Yeni etkinlik',
      body: `${!canEdit ? `<div class="readonly-note">${avatar(ex.owner, 'sm')} Bu etkinliği <b>${esc(userName(ex.owner))}</b> oluşturdu; yalnızca o düzenleyebilir.
          ${myAtt ? `<span style="margin-left:auto;display:flex;gap:6px"><button type="button" class="btn btn-sm ${myAtt.status === 'accepted' ? 'btn-primary' : ''}" data-rsvp="accepted">✓ Katılıyorum</button><button type="button" class="btn btn-sm ${myAtt.status === 'declined' ? 'btn-danger' : ''}" data-rsvp="declined">✕ Katılmıyorum</button></span>` : ''}</div>` : ''}
        <div class="form-grid">
        <div class="field full"><label for="ev-title">Başlık</label><input id="ev-title" class="input title-input" name="title" value="${esc(d.title)}" placeholder="Örn. Proje toplantısı" data-autofocus maxlength="200" ${dis}></div>
        <div class="field"><label for="ev-date">Tarih</label><input id="ev-date" type="date" class="input" name="date" value="${d.date}" required ${dis}></div>
        <div class="field"><label for="ev-cat">Kategori</label><select id="ev-cat" class="input" name="category" ${dis}>${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${d.category === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div>
        <div class="field full"><label class="inline-check"><input type="checkbox" name="allDay" ${d.allDay ? 'checked' : ''} ${dis}> Tüm gün</label></div>
        <div class="field time-f"><label for="ev-start">Başlangıç</label><input id="ev-start" type="time" class="input" name="start" value="${d.start}" step="300" ${dis}></div>
        <div class="field time-f"><label for="ev-end">Bitiş</label><input id="ev-end" type="time" class="input" name="end" value="${d.end}" step="300" ${dis}></div>
        <div class="field full"><label for="ev-proj">Proje (isteğe bağlı)</label><select id="ev-proj" class="input" name="project" ${dis}><option value="">— Kişisel etkinlik —</option>${S.projects.map((p) => `<option value="${p.id}" ${d.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <small class="muted">Projeye bağlı etkinlikler tüm proje üyelerinin takviminde görünür.</small></div>
        <div class="field full"><span class="lbl">Renk</span><div class="swatches" id="ev-swatches">${swatches()}</div></div>
        <div class="field full"><span class="lbl">Katılımcılar ${canEdit ? '<button type="button" class="btn btn-sm btn-ghost" id="ev-add-members" style="margin-left:6px">+ Proje üyelerini ekle</button>' : ''}</span>
          <div class="people" id="ev-people">${peoplePicker(others, d.attendees.map((a) => a.userId), 'attendee', { disabled: !canEdit, status: (uid) => { const a = d.attendees.find((x) => x.userId === uid); return a ? `<span class="rsvp ${a.status}">${RSVP[a.status]}</span>` : ''; } })}</div></div>
        <div class="field full"><label for="ev-notes">Notlar</label><textarea id="ev-notes" class="input" name="notes" rows="3" placeholder="Konum, bağlantı, açıklama…" ${dis}>${esc(d.notes)}</textarea></div>
      </div>`,
      footer: canEdit ? `${ex ? '<button type="button" class="btn btn-ghost danger" data-del>Sil</button>' : ''}<span class="grow"></span><span class="muted" style="font-size:12px">Ctrl+Enter</span><button type="button" class="btn btn-ghost" data-close>Vazgeç</button><button type="submit" class="btn btn-primary">${ex ? 'Kaydet' : 'Oluştur'}</button>`
        : '<span class="grow"></span><button type="button" class="btn btn-primary" data-close>Kapat</button>',
      onMount: (w, m, f) => {
        const syncAllDay = () => $$('.time-f', w).forEach((x) => { x.style.display = f.allDay.checked ? 'none' : ''; });
        syncAllDay(); f.allDay.addEventListener('change', syncAllDay);
        let colorTouched = !!ex && ex.color !== CATEGORIES[ex.category].color;
        f.category.addEventListener('change', () => { if (!colorTouched) { d.color = CATEGORIES[f.category.value].color; $('#ev-swatches', w).innerHTML = swatches(); } });
        $('#ev-swatches', w).addEventListener('click', (e) => { const b = e.target.closest('.swatch'); if (!b || !canEdit) return; d.color = b.dataset.color; colorTouched = true; $('#ev-swatches', w).innerHTML = swatches(); });
        f.start.addEventListener('change', () => { if (toMin(f.end.value) <= toMin(f.start.value)) f.end.value = fromMin(Math.min(toMin(f.start.value) + 60, 23 * 60 + 59)); });
        const addM = $('#ev-add-members', w);
        if (addM) addM.addEventListener('click', () => {
          const pid = f.project.value; if (!pid) { toast('Önce bir proje seçin.'); return; }
          const ids = membersOf(pid).map((u) => u.id);
          $$('input[name=attendee]', w).forEach((cb) => { if (ids.includes(cb.value)) cb.checked = true; });
        });
        $$('[data-rsvp]', w).forEach((b) => b.addEventListener('click', async () => {
          const ok = await act(() => api('POST', `/api/events/${ex.id}/rsvp`, { status: b.dataset.rsvp }), b.dataset.rsvp === 'accepted' ? 'Katılımınız kaydedildi.' : 'Katılmayacağınız bildirildi.');
          if (ok) m.close();
        }));
        const del = $('[data-del]', w);
        if (del) del.addEventListener('click', async () => {
          if (!(await confirmDialog('Etkinliği sil', `“${ex.title}” kalıcı olarak silinecek.`, 'Sil', true))) return;
          m.close(); await act(() => api('DELETE', '/api/events/' + ex.id), 'Etkinlik silindi.');
        });
      },
      onSubmit: async (m, f) => {
        if (!canEdit) return m.close();
        const title = f.title.value.trim();
        if (!title) return fieldErr(f, 'title', 'Başlık gerekli.');
        if (!f.date.value) return fieldErr(f, 'date', 'Tarih gerekli.');
        const allDay = f.allDay.checked;
        if (!allDay && (!f.start.value || !f.end.value || toMin(f.end.value) <= toMin(f.start.value))) return fieldErr(f, 'end', 'Bitiş, başlangıçtan sonra olmalı.');
        const body = {
          title, allDay, category: f.category.value, color: d.color, notes: f.notes.value.trim(), projectId: f.project.value || null,
          startAt: `${f.date.value}T${allDay ? '00:00' : f.start.value}`, endAt: `${f.date.value}T${allDay ? '23:59' : f.end.value}`,
          attendeeIds: $$('input[name=attendee]:checked', m.el).map((x) => x.value),
        };
        try {
          await api(ex ? 'PATCH' : 'POST', ex ? '/api/events/' + ex.id : '/api/events', body);
          ui.cursor = f.date.value;
          await reload(); m.close(); render(); toast(ex ? 'Etkinlik güncellendi.' : 'Etkinlik oluşturuldu.');
        } catch (e) { showErr(e, f); }
      },
    });
  }

  // ================== Görev formu ==================
  function openTask(id, preset) {
    const ex = id ? S.tasks.find((t) => t.id === id) : null;
    if (id && !ex) { toast('Görev bulunamadı.', null, 'err'); return; }
    preset = preset || {};
    const defBoard = preset.board || (ui.view === 'board' ? ui.board : (ui.project || 'personal'));
    const d = ex ? JSON.parse(JSON.stringify(ex)) : {
      title: '', desc: '', priority: 'medium', due: preset.due || '', project: defBoard === 'personal' ? '' : defBoard,
      column: preset.column || '', assignee: preset.assignee || (ui.mine ? S.me.id : ''), tags: ui.tag ? [ui.tag] : [], checklist: [],
    };
    const renderChecklist = () => d.checklist.map((c, i) => `<div class="ci ${c.done ? 'done' : ''}" data-i="${i}"><input type="checkbox" ${c.done ? 'checked' : ''} aria-label="Tamamlandı"><input type="text" value="${esc(c.text)}" aria-label="Alt görev"><button type="button" class="rm" aria-label="Alt görevi sil" title="Sil">×</button></div>`).join('');
    const prioPick = () => Object.entries(PRIORITIES).map(([k, p]) => `<button type="button" role="radio" aria-checked="${d.priority === k}" class="${d.priority === k ? 'active' : ''}" style="--pc:${p.color}" data-prio="${k}"><span class="dot" style="background:${p.color};width:8px;height:8px"></span>${p.label}</button>`).join('');
    const colOpts = (board, sel) => { const cs = boardColumns(board); const s = sel && cs.some((c) => c.id === sel) ? sel : (cs.find((c) => !c.done) || cs[0] || {}).id; return cs.map((c) => `<option value="${c.id}" ${c.id === s ? 'selected' : ''}>${esc(c.name)}</option>`).join(''); };
    const asgOpts = (pid, sel) => { const ms = membersOf(pid); return `<option value="">— Atanmamış —</option>` + ms.map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.id === S.me.id ? u.name + ' (siz)' : u.name)}</option>`).join(''); };
    const commentHtml = (list) => list.length ? list.map((c) => `<div class="comment">${avatar(c.userId, 'sm')}<div class="bubble"><div class="meta"><b>${esc(c.userId === S.me.id ? 'Siz' : (c.userName || 'Silinmiş kullanıcı'))}</b>${ago(c.createdAt)}
        ${c.userId === S.me.id || isOwner(projById(d.project)) ? `<button type="button" data-del-comment="${c.id}" title="Yorumu sil" aria-label="Yorumu sil">Sil</button>` : ''}</div><div class="txt">${esc(c.body)}</div></div></div>`).join('') : '<div class="muted" style="font-size:12.5px">Henüz yorum yok.</div>';
    openModal({
      title: ex ? 'Görevi düzenle' : 'Yeni görev',
      body: `<div class="form-grid">
        <div class="field full"><label for="tk-title">Başlık</label><input id="tk-title" class="input title-input" name="title" value="${esc(d.title)}" placeholder="Ne yapılması gerekiyor?" data-autofocus maxlength="200"></div>
        <div class="field full"><label for="tk-desc">Açıklama</label><textarea id="tk-desc" class="input" name="description" rows="3" placeholder="Ayrıntılar…">${esc(d.desc)}</textarea></div>
        <div class="field full"><span class="lbl" id="prio-lbl">Öncelik</span><div class="prio-pick" role="radiogroup" aria-labelledby="prio-lbl" id="tk-prio">${prioPick()}</div></div>
        <div class="field"><label for="tk-proj">Proje / pano</label><select id="tk-proj" class="input" name="project"><option value="">🔒 Kişisel</option>${S.projects.map((p) => `<option value="${p.id}" ${d.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="tk-col">Durum (sütun)</label><select id="tk-col" class="input" name="column">${colOpts(d.project || 'personal', d.column)}</select></div>
        <div class="field"><label for="tk-asg">Atanan kişi</label><select id="tk-asg" class="input" name="assignee">${asgOpts(d.project, d.assignee)}</select></div>
        <div class="field"><label for="tk-due">Teslim tarihi</label><input id="tk-due" type="date" class="input" name="due" value="${d.due || ''}"></div>
        <div class="field full"><label for="tk-tags">Etiketler</label><input id="tk-tags" class="input" name="tags" value="${esc(d.tags.join(', '))}" placeholder="virgülle ayırın" list="tag-dl"><datalist id="tag-dl">${allTags().map(([g]) => `<option value="${esc(g)}">`).join('')}</datalist></div>
        <div class="field full"><span class="lbl">Kontrol listesi (alt görevler) <span class="muted" id="cl-count"></span></span>
          <div class="checklist" id="tk-cl">${renderChecklist()}</div>
          <div class="checklist-add"><input class="input" id="cl-new" placeholder="Alt görev ekle ve Enter'a basın" maxlength="300"><button type="button" class="btn" id="cl-add">Ekle</button></div></div>
        ${ex ? `<div class="field full"><div class="section-title">💬 Yorumlar</div><div class="comments" id="tk-comments"><div class="muted" style="font-size:12.5px">Yükleniyor…</div></div>
          <div class="comment-add">${avatar(S.me.id, 'sm')}<textarea class="input" id="cm-new" rows="2" placeholder="Yorum yazın…" maxlength="5000"></textarea><button type="button" class="btn" id="cm-send">Gönder</button></div></div>
          <div class="field full muted" style="font-size:12px">Oluşturan: ${esc(userName(ex.creator))} · ${fmtStamp(ex.created)}${ex.completedAt ? ' · Tamamlanma: ' + fmtStamp(ex.completedAt) : ''}</div>` : ''}
      </div>`,
      footer: `${ex ? '<button type="button" class="btn btn-ghost danger" data-del>Sil</button>' : ''}<span class="grow"></span><span class="muted" style="font-size:12px">Ctrl+Enter</span><button type="button" class="btn btn-ghost" data-close>Vazgeç</button><button type="submit" class="btn btn-primary">${ex ? 'Kaydet' : 'Oluştur'}</button>`,
      onMount: (w, m, f) => {
        const cl = $('#tk-cl', w);
        const updCount = () => { $('#cl-count', w).textContent = d.checklist.length ? `(${d.checklist.filter((c) => c.done).length}/${d.checklist.length})` : ''; };
        updCount();
        const setPrio = (k) => { d.priority = k; $('#tk-prio', w).innerHTML = prioPick(); $(`[data-prio="${k}"]`, w).focus(); };
        $('#tk-prio', w).addEventListener('click', (e) => { const b = e.target.closest('[data-prio]'); if (b) setPrio(b.dataset.prio); });
        $('#tk-prio', w).addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); const ks = Object.keys(PRIORITIES); setPrio(ks[(ks.indexOf(d.priority) + (e.key === 'ArrowRight' ? 1 : -1) + ks.length) % ks.length]); });
        f.project.addEventListener('change', () => {
          const pid = f.project.value;
          f.column.innerHTML = colOpts(pid || 'personal', null);
          const cur = f.assignee.value; f.assignee.innerHTML = asgOpts(pid, cur);
          if (cur && f.assignee.value !== cur) toast('Seçili kişi bu projenin üyesi değil; atama kaldırıldı.');
        });
        const addItem = () => { const inp = $('#cl-new', w); const v = inp.value.trim(); if (!v) return; d.checklist.push({ text: v, done: false }); inp.value = ''; cl.innerHTML = renderChecklist(); updCount(); inp.focus(); };
        $('#cl-add', w).addEventListener('click', addItem);
        $('#cl-new', w).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addItem(); } });
        cl.addEventListener('change', (e) => { const row = e.target.closest('.ci'); const it = d.checklist[row.dataset.i]; if (e.target.type === 'checkbox') { it.done = e.target.checked; row.classList.toggle('done', it.done); updCount(); } });
        cl.addEventListener('input', (e) => { if (e.target.type === 'text') d.checklist[e.target.closest('.ci').dataset.i].text = e.target.value; });
        cl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.type === 'text' && !e.ctrlKey) { e.preventDefault(); $('#cl-new', w).focus(); } });
        cl.addEventListener('click', (e) => { const b = e.target.closest('.rm'); if (!b) return; d.checklist.splice(Number(b.closest('.ci').dataset.i), 1); cl.innerHTML = renderChecklist(); updCount(); $('#cl-new', w).focus(); });
        if (ex) {
          const box = $('#tk-comments', w);
          const loadComments = async () => { try { const r = await api('GET', `/api/tasks/${ex.id}/comments`); if (box.isConnected) box.innerHTML = commentHtml(r.comments); } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
          loadComments();
          $('#cm-send', w).addEventListener('click', async () => {
            const ta = $('#cm-new', w); const body = ta.value.trim(); if (!body) { ta.focus(); return; }
            try { await api('POST', `/api/tasks/${ex.id}/comments`, { body }); ta.value = ''; await loadComments(); reload().then(() => { if (!modalStack.length) render(); }); }
            catch (e) { showErr(e); }
          });
          box.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-del-comment]'); if (!b) return;
            try { await api('DELETE', '/api/comments/' + b.dataset.delComment); await loadComments(); } catch (er) { showErr(er); }
          });
          $('[data-del]', w).addEventListener('click', async () => {
            if (!(await confirmDialog('Görevi sil', `“${ex.title}” ve tüm alt görevleri ile yorumları kalıcı olarak silinecek.`, 'Sil', true))) return;
            m.close(); await act(() => api('DELETE', '/api/tasks/' + ex.id), 'Görev silindi.');
          });
        }
      },
      onSubmit: async (m, f) => {
        const title = f.title.value.trim();
        if (!title) return fieldErr(f, 'title', 'Başlık gerekli.');
        const pending = $('#cl-new', m.el).value.trim(); if (pending) d.checklist.push({ text: pending, done: false });
        const body = {
          title, description: f.description.value.trim(), priority: d.priority, projectId: f.project.value || null, columnId: f.column.value || null,
          assigneeId: f.assignee.value || null, dueDate: f.due.value || null,
          tags: [...new Set(f.tags.value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean))],
          checklist: d.checklist.filter((c) => c.text.trim()).map((c) => ({ text: c.text.trim(), isDone: !!c.done })),
        };
        try {
          await api(ex ? 'PATCH' : 'POST', ex ? '/api/tasks/' + ex.id : '/api/tasks', body);
          await reload(); m.close(); render(); toast(ex ? 'Görev güncellendi.' : 'Görev oluşturuldu.');
        } catch (e) { showErr(e, f); }
      },
    });
  }

  // ================== Projeler ve üyeler ==================
  function openProject(id) {
    const p = id ? projById(id) : null;
    const owner = !p || isOwner(p);
    const dis = owner ? '' : 'disabled';
    let color = p ? p.color : SWATCHES[(S.projects.length * 3) % SWATCHES.length];
    const sw = () => SWATCHES.map((c) => `<button type="button" class="swatch ${color === c ? 'active' : ''}" style="--c:${c}" data-color="${c}" aria-label="Renk ${c}" ${dis}></button>`).join('');
    const membersHtml = () => {
      const cur = projById(id); if (!cur) return '';
      const rows = cur.members.map((mm) => `<div class="row">${avatar(mm.userId, 'sm')}<span class="nm">${esc(userName(mm.userId))}<small>${esc((userById(mm.userId) || {}).email || '')}</small></span>
          <span class="role-badge ${mm.role === 'owner' ? '' : 'user'}">${mm.role === 'owner' ? 'Sahip' : 'Üye'}</span>
          ${owner && mm.role !== 'owner' ? `<button type="button" class="btn btn-sm btn-ghost danger" data-remove="${mm.userId}" aria-label="${esc(userName(mm.userId))} üyeliğini kaldır">Çıkar</button>` : ''}</div>`).join('');
      const candidates = S.users.filter((u) => !cur.members.some((mm) => mm.userId === u.id));
      return `<div class="people">${rows}</div>${owner ? `<div class="checklist-add" style="margin-top:8px"><select class="input" id="pj-add-user" aria-label="Eklenecek kişi"><option value="">Ekip üyesi seçin…</option>${candidates.map((u) => `<option value="${u.id}">${esc(u.name)} — ${esc(u.email)}</option>`).join('')}</select><button type="button" class="btn" id="pj-add-btn">Ekle</button></div>` : ''}`;
    };
    openModal({
      title: p ? (owner ? 'Projeyi düzenle' : 'Proje ayrıntıları') : 'Yeni proje',
      body: `${p && !owner ? `<div class="readonly-note">${avatar(p.ownerId, 'sm')} Proje sahibi: <b>${esc(userName(p.ownerId))}</b>. Ayarları ve üyeleri yalnızca sahip değiştirebilir.</div>` : ''}
        <div class="form-grid">
        <div class="field full"><label for="pj-name">Proje adı</label><input id="pj-name" class="input" name="name" value="${esc(p ? p.name : '')}" data-autofocus maxlength="80" placeholder="Örn. Pazarlama" ${dis}></div>
        <div class="field full"><label for="pj-desc">Açıklama</label><textarea id="pj-desc" class="input" name="description" rows="2" maxlength="2000" ${dis}>${esc(p ? p.description : '')}</textarea></div>
        <div class="field full"><span class="lbl">Renk</span><div class="swatches" id="pj-sw">${sw()}</div></div>
        <div class="field full"><span class="lbl">👥 Ekip üyeleri</span>
          ${p ? `<div id="pj-members">${membersHtml()}</div>` : `<div class="people">${peoplePicker(S.users.filter((u) => u.id !== S.me.id), [], 'member')}</div><small class="muted">Siz proje sahibi olarak otomatik eklenirsiniz.</small>`}</div>
      </div>`,
      footer: `${p && owner ? '<button type="button" class="btn btn-ghost danger" data-del>Projeyi sil</button>' : ''}${p && !owner ? '<button type="button" class="btn btn-ghost danger" data-leave>Projeden ayrıl</button>' : ''}
        <span class="grow"></span><button type="button" class="btn btn-ghost" data-close>${owner ? 'Vazgeç' : 'Kapat'}</button>${owner ? `<button type="submit" class="btn btn-primary">${p ? 'Kaydet' : 'Oluştur'}</button>` : ''}`,
      onMount: (w, m) => {
        $('#pj-sw', w).addEventListener('click', (e) => { const b = e.target.closest('.swatch'); if (!b || !owner) return; color = b.dataset.color; $('#pj-sw', w).innerHTML = sw(); });
        const box = $('#pj-members', w);
        if (box) box.addEventListener('click', async (e) => {
          const rm = e.target.closest('[data-remove]');
          if (rm) {
            if (!(await confirmDialog('Üyeyi çıkar', `${userName(rm.dataset.remove)} projeden çıkarılacak; ona atanmış görevlerin ataması kaldırılır.`, 'Çıkar', true))) return;
            if (await act(() => api('DELETE', `/api/projects/${id}/members/${rm.dataset.remove}`), 'Üye çıkarıldı.')) box.innerHTML = membersHtml();
          }
          if (e.target.id === 'pj-add-btn') {
            const sel = $('#pj-add-user', w); if (!sel.value) { sel.focus(); return; }
            if (await act(() => api('POST', `/api/projects/${id}/members`, { userId: sel.value }), 'Üye eklendi.')) box.innerHTML = membersHtml();
          }
        });
        const del = $('[data-del]', w);
        if (del) del.addEventListener('click', async () => {
          const n = S.tasks.filter((t) => t.project === id).length;
          if (!(await confirmDialog('Projeyi sil', `“${p.name}” projesi, ${n} görevi ve sütunlarıyla birlikte tüm üyeler için kalıcı olarak silinecek.`, 'Kalıcı olarak sil', true))) return;
          m.close(); if (ui.project === id) ui.project = ''; if (ui.board === id) ui.board = 'personal';
          await act(() => api('DELETE', '/api/projects/' + id), 'Proje silindi.');
        });
        const leave = $('[data-leave]', w);
        if (leave) leave.addEventListener('click', async () => {
          if (!(await confirmDialog('Projeden ayrıl', `“${p.name}” projesinden ayrılacaksınız; projenin görevlerini artık göremeyeceksiniz.`, 'Ayrıl', true))) return;
          m.close(); if (ui.project === id) ui.project = ''; if (ui.board === id) ui.board = 'personal';
          await act(() => api('DELETE', `/api/projects/${id}/members/${S.me.id}`), 'Projeden ayrıldınız.');
        });
      },
      onSubmit: async (m, f) => {
        if (!owner) return m.close();
        const name = f.name.value.trim(); if (!name) return fieldErr(f, 'name', 'Proje adı gerekli.');
        const body = { name, color, description: f.description.value.trim() };
        try {
          if (p) await api('PATCH', '/api/projects/' + id, body);
          else { body.memberIds = $$('input[name=member]:checked', m.el).map((x) => x.value); const r = await api('POST', '/api/projects', body); ui.board = r.project.id; }
          await reload(); m.close(); render(); toast(p ? 'Proje güncellendi.' : 'Proje oluşturuldu.');
        } catch (e) { showErr(e, f); }
      },
    });
  }

  // ================== Yönetim: kullanıcı formu ==================
  function openAdminUser(id) {
    const u = id ? adminUsers.find((x) => x.id === id) : null;
    const self = u && u.id === S.me.id;
    openModal({
      title: u ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı', size: 'sm',
      body: `<div class="form-grid">
        <div class="field full"><label for="au-n">Ad soyad</label><input id="au-n" class="input" name="name" value="${esc(u ? u.name : '')}" data-autofocus maxlength="80" autocomplete="off"></div>
        <div class="field full"><label for="au-e">E-posta</label><input id="au-e" class="input" type="email" name="email" value="${esc(u ? u.email : '')}" maxlength="254" autocomplete="off"></div>
        <div class="field"><label for="au-r">Rol</label><select id="au-r" class="input" name="role"><option value="user" ${u && u.role === 'user' ? 'selected' : ''}>Kullanıcı</option><option value="admin" ${u && u.role === 'admin' ? 'selected' : ''}>Yönetici</option></select></div>
        ${u ? `<div class="field"><span class="lbl">Durum</span><label class="inline-check" style="padding-top:8px"><input type="checkbox" name="isActive" ${u.isActive ? 'checked' : ''} ${self ? 'disabled' : ''}> Hesap etkin</label></div>` : '<div></div>'}
        <div class="field full"><label for="au-p">${u ? 'Yeni şifre (değiştirmek istemiyorsanız boş bırakın)' : 'Geçici şifre'}</label><input id="au-p" class="input" type="text" name="password" autocomplete="new-password" maxlength="128" placeholder="En az 8 karakter, harf + rakam"></div>
      </div>`,
      footer: `<span class="grow"></span><button type="button" class="btn btn-ghost" data-close>Vazgeç</button><button type="submit" class="btn btn-primary">${u ? 'Kaydet' : 'Oluştur'}</button>`,
      onSubmit: async (m, f) => {
        const body = { name: f.name.value.trim(), email: f.email.value.trim(), role: f.role.value };
        if (f.password.value) body.password = f.password.value;
        if (u && f.isActive && !self) body.isActive = f.isActive.checked;
        if (!body.name) return fieldErr(f, 'name', 'Ad soyad gerekli.');
        if (!u && !body.password) return fieldErr(f, 'password', 'Geçici şifre gerekli.');
        try {
          await api(u ? 'PATCH' : 'POST', u ? '/api/admin/users/' + u.id : '/api/admin/users', body);
          await loadAdminUsers(true); await reload(); m.close(); render(); toast(u ? 'Kullanıcı güncellendi.' : `${body.name} oluşturuldu.`);
        } catch (e) { showErr(e, f); }
      },
    });
  }
  async function adminDeleteUser(id) {
    const u = adminUsers.find((x) => x.id === id); if (!u) return;
    if (!(await confirmDialog('Kullanıcıyı sil', `${u.name} (${u.email}) kalıcı olarak silinecek. Sahibi olduğu projeler (${u.ownedProjects}), kişisel görevleri ve etkinlikleri de silinir. Bunun yerine hesabı devre dışı bırakmayı düşünün.`, 'Kalıcı olarak sil', true))) return;
    try { await api('DELETE', '/api/admin/users/' + id); await loadAdminUsers(true); await reload(); render(); toast('Kullanıcı silindi.'); } catch (e) { showErr(e); }
  }
  async function adminClearSamples() {
    if (!(await confirmDialog('Örnek verileri sil', 'Tüm örnek kullanıcılar (şu an oturum açmış olan siz hariç), örnek projeler, görevler ve etkinlikler kalıcı olarak silinecek.', 'Sil', true))) return;
    try { const r = await api('DELETE', '/api/admin/sample-data'); await loadAdminUsers(true); await reload(); render(); toast(`Silindi: ${r.deleted.users} kullanıcı, ${r.deleted.projects} proje, ${r.deleted.tasks} görev, ${r.deleted.events} etkinlik.`); }
    catch (e) { showErr(e); }
  }

  // ================== Profil ==================
  function openProfile() {
    openModal({
      title: 'Profil ve şifre', size: 'sm',
      body: `<div class="form-grid">
        <div class="field full"><label for="pf-n">Ad soyad</label><input id="pf-n" class="input" name="name" value="${esc(S.me.name)}" maxlength="80" data-autofocus></div>
        <div class="field full"><span class="lbl">E-posta</span><div class="muted">${esc(S.me.email)} <small>(yalnızca yönetici değiştirebilir)</small></div></div>
        <div class="field full"><div class="section-title" style="margin-top:4px">🔑 Şifre değiştir (isteğe bağlı)</div></div>
        <div class="field full"><label for="pf-c">Mevcut şifre</label><input id="pf-c" class="input" type="password" name="currentPassword" autocomplete="current-password"></div>
        <div class="field full"><label for="pf-p">Yeni şifre</label><input id="pf-p" class="input" type="password" name="newPassword" autocomplete="new-password" placeholder="En az 8 karakter, harf + rakam"></div>
      </div>`,
      footer: '<span class="grow"></span><button type="button" class="btn btn-ghost" data-close>Vazgeç</button><button type="submit" class="btn btn-primary">Kaydet</button>',
      onSubmit: async (m, f) => {
        const body = { name: f.name.value.trim() };
        if (f.newPassword.value) { body.newPassword = f.newPassword.value; body.currentPassword = f.currentPassword.value; }
        try { await api('PATCH', '/api/auth/me', body); m.close(); await reload(); render(); toast(body.newPassword ? 'Şifreniz değiştirildi. Diğer oturumlarınız kapatıldı.' : 'Profil güncellendi.'); }
        catch (e) { showErr(e, f); }
      },
    });
  }

  // ================== Görev işlemleri ==================
  /** Yerelde (iyimser) taşıma: sunucu yanıtı gelene kadar arayüz hemen güncellenir. */
  function localMove(task, colId, beforeId) {
    task.column = colId;
    const list = S.tasks.filter((x) => x.column === colId && x !== task).sort((a, b) => a.order - b.order);
    let idx = beforeId ? list.findIndex((x) => x.id === beforeId) : -1; if (idx < 0) idx = list.length;
    list.splice(idx, 0, task); list.forEach((x, i) => { x.order = i; });
  }
  async function moveTask(task, colId, beforeId, msg) {
    localMove(task, colId, beforeId); render();
    const c = $(`.card[data-id="${task.id}"]`); if (c) c.focus({ preventScroll: true });
    const ok = await act(() => api('POST', `/api/tasks/${task.id}/move`, { columnId: colId, beforeId: beforeId || null }), msg);
    const c2 = $(`.card[data-id="${task.id}"]`); if (c2 && ok) c2.focus({ preventScroll: true });
  }
  function toggleDone(id) {
    const t = S.tasks.find((x) => x.id === id); if (!t) return;
    const cols = boardColumns(taskBoard(t));
    if (isDone(t)) { const c = cols.find((x) => !x.done) || cols[0]; moveTask(t, c.id, null, `“${t.title}” yeniden açıldı.`); }
    else { const c = cols.find((x) => x.done) || cols[cols.length - 1]; moveTask(t, c.id, null, `“${t.title}” tamamlandı. 🎉`); }
  }

  // ================== Sütunlar ==================
  const boardProjectId = () => (ui.board === 'personal' ? null : ui.board);
  async function addColumn() {
    const r = await act(() => api('POST', '/api/columns', { name: 'Yeni sütun', projectId: boardProjectId() }));
    if (r && r.column) startRename(r.column.id);
  }
  function startRename(id) {
    const c = colById(id); const btn = $(`.col-title[data-id="${id}"]`); if (!c || !btn) return;
    const inp = document.createElement('input');
    inp.className = 'col-title-input'; inp.value = c.name; inp.setAttribute('aria-label', 'Sütun adı'); inp.maxLength = 60;
    btn.replaceWith(inp); inp.focus(); inp.select();
    let finished = false;
    const finish = async (ok) => {
      if (finished) return; finished = true;
      const v = inp.value.trim();
      if (ok && v && v !== c.name) await act(() => api('PATCH', '/api/columns/' + id, { name: v }));
      else render();
      const nb = $(`.col-title[data-id="${id}"]`); if (nb) nb.focus();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
    inp.addEventListener('blur', () => finish(true));
  }
  function columnMenu(id) {
    const c = colById(id); const cols = boardColumns(ui.board); const idx = cols.findIndex((x) => x.id === id);
    const n = S.tasks.filter((t) => t.column === id).length;
    openModal({
      title: `“${esc(c.name)}” sütunu`, size: 'sm',
      body: `<div style="display:flex;flex-direction:column;gap:6px">
        <button type="button" class="btn" data-a="rename">✏️ Yeniden adlandır</button>
        <label class="inline-check" style="padding:8px 4px"><input type="checkbox" data-a="done" ${c.done ? 'checked' : ''}> Bu sütundaki görevler “tamamlandı” sayılsın</label>
        <div style="display:flex;gap:6px"><button type="button" class="btn" style="flex:1" data-a="left" ${idx === 0 ? 'disabled' : ''}>← Sola taşı</button><button type="button" class="btn" style="flex:1" data-a="right" ${idx === cols.length - 1 ? 'disabled' : ''}>Sağa taşı →</button></div>
        <button type="button" class="btn btn-ghost danger" data-a="delete" ${cols.length <= 1 ? 'disabled' : ''}>🗑 Sütunu sil${n ? ` (${n} görev başka sütuna taşınır)` : ''}</button></div>`,
      onMount: (w, m) => {
        w.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-a]'); if (!b || b.type === 'checkbox') return;
          const a = b.dataset.a;
          if (a === 'rename') { m.close(); startRename(id); }
          if (a === 'left' || a === 'right') {
            const ids = cols.map((x) => x.id); const j = idx + (a === 'left' ? -1 : 1);
            [ids[idx], ids[j]] = [ids[j], ids[idx]]; m.close();
            await act(() => api('PUT', '/api/columns/order', { projectId: boardProjectId(), ids }));
          }
          if (a === 'delete') {
            if (!(await confirmDialog('Sütunu sil', `“${c.name}” sütunu silinecek.${n ? ` İçindeki ${n} görev başka bir sütuna taşınacak.` : ''}`, 'Sil', true))) return;
            m.close(); await act(() => api('DELETE', '/api/columns/' + id), 'Sütun silindi.');
          }
        });
        $('[data-a="done"]', w).addEventListener('change', (e) => act(() => api('PATCH', '/api/columns/' + id, { isDone: e.target.checked })));
      },
    });
  }
  function startQuickAdd(colId) {
    const foot = $(`.column[data-col="${colId}"] .col-foot`); if (!foot) return;
    foot.innerHTML = '<input placeholder="Kart başlığı, Enter ile ekle" aria-label="Yeni kart başlığı" maxlength="200">';
    const inp = $('input', foot); inp.focus();
    let busy = false;
    inp.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); const v = inp.value.trim(); if (!v || busy) return;
        busy = true;
        const ok = await act(() => api('POST', '/api/tasks', { title: v, projectId: boardProjectId(), columnId: colId, assigneeId: ui.mine ? S.me.id : null, tags: ui.tag ? [ui.tag] : [] }));
        busy = false;
        if (ok) startQuickAdd(colId);
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); render(); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (!busy && document.activeElement !== inp && foot.isConnected && $('input', foot)) render(); }, 150));
  }

  // ================== Sürükle-bırak (fare + dokunmatik) ==================
  const drag = { pending: null, active: false, suppressClick: false };
  function onPointerDown(e) {
    const card = e.target.closest('.board .card');
    if (!card || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.pending = { card, id: card.dataset.id, x: e.clientX, y: e.clientY, type: e.pointerType };
    if (e.pointerType !== 'mouse') drag.pending.timer = setTimeout(() => { if (drag.pending) startDrag(drag.pending.x, drag.pending.y); }, 320);
  }
  function startDrag(x, y) {
    const p = drag.pending; if (!p) return;
    clearTimeout(p.timer);
    const r = p.card.getBoundingClientRect();
    const ghost = p.card.cloneNode(true);
    ghost.classList.add('drag-ghost'); ghost.style.width = r.width + 'px'; ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
    document.body.appendChild(ghost);
    const ph = document.createElement('div'); ph.className = 'card-placeholder'; ph.style.height = r.height + 'px';
    p.card.after(ph); p.card.style.display = 'none';
    Object.assign(drag, { active: true, ghost, ph, offX: x - r.left, offY: y - r.top, card: p.card, id: p.id });
    document.body.classList.add('dragging');
    if (navigator.vibrate && p.type !== 'mouse') try { navigator.vibrate(15); } catch (er) { /* yoksay */ }
  }
  function onPointerMove(e) {
    const p = drag.pending;
    if (p && !drag.active) {
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.type === 'mouse') { if (dist > 5) startDrag(e.clientX, e.clientY); }
      else if (dist > 10) { clearTimeout(p.timer); drag.pending = null; }
      else { p.x = e.clientX; p.y = e.clientY; }
    }
    if (!drag.active) return;
    e.preventDefault();
    drag.ghost.style.left = (e.clientX - drag.offX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.offY) + 'px';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const col = el && el.closest('.column');
    if (col) {
      const list = $('.col-cards', col);
      const cards = $$('.card', list).filter((c) => c !== drag.card);
      const before = cards.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (before) { if (drag.ph.nextSibling !== before) list.insertBefore(drag.ph, before); }
      else if (list.lastElementChild !== drag.ph) list.appendChild(drag.ph);
      const lr = list.getBoundingClientRect();
      if (e.clientY < lr.top + 30) list.scrollTop -= 10; else if (e.clientY > lr.bottom - 30) list.scrollTop += 10;
    }
    const board = $('.board');
    if (board) { const br = board.getBoundingClientRect(); if (e.clientX < br.left + 40) board.scrollLeft -= 14; else if (e.clientX > br.right - 40) board.scrollLeft += 14; }
  }
  function onPointerUp() {
    const p = drag.pending; if (p) clearTimeout(p.timer);
    drag.pending = null;
    if (!drag.active) return;
    const list = drag.ph.parentElement; const colId = list && list.dataset.col;
    let next = drag.ph.nextElementSibling; while (next && !next.classList.contains('card')) next = next.nextElementSibling;
    const beforeId = next ? next.dataset.id : null;
    drag.ghost.remove(); drag.ph.remove(); drag.card.style.display = '';
    document.body.classList.remove('dragging');
    drag.active = false; drag.suppressClick = true; setTimeout(() => { drag.suppressClick = false; }, 50);
    const t = S.tasks.find((x) => x.id === drag.id);
    if (t && colId) {
      const changed = t.column !== colId;
      moveTask(t, colId, beforeId, changed ? `“${t.title}” → ${colById(colId).name}` : null);
    }
  }
  function cancelDrag() {
    if (drag.pending) clearTimeout(drag.pending.timer);
    drag.pending = null;
    if (!drag.active) return;
    drag.ghost.remove(); drag.ph.remove(); drag.card.style.display = '';
    document.body.classList.remove('dragging'); drag.active = false;
  }
  function keyboardMove(card, key) {
    const t = S.tasks.find((x) => x.id === card.dataset.id); if (!t) return;
    const cols = boardColumns(taskBoard(t)); const ci = cols.findIndex((c) => c.id === t.column);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const j = ci + (key === 'ArrowLeft' ? -1 : 1); if (j < 0 || j >= cols.length) return;
      moveTask(t, cols[j].id, null, `“${t.title}” → ${cols[j].name}`);
    } else {
      const list = S.tasks.filter((x) => x.column === t.column).sort((a, b) => a.order - b.order);
      const i = list.indexOf(t);
      if (key === 'ArrowUp' && i > 0) moveTask(t, t.column, list[i - 1].id);
      if (key === 'ArrowDown' && i < list.length - 1) moveTask(t, t.column, list[i + 2] ? list[i + 2].id : null);
    }
  }

  // ================== Diğer ==================
  function showShortcuts() {
    const rows = [['Yeni etkinlik', 'N'], ['Yeni görev', 'G'], ['Ara', '/'], ['Bugün / Takvim / İş Akışı / Yönetim', '1 · 2 · 3 · 4'], ['Bana atananlar filtresi', 'B'], ['Takvim: Ay / Hafta / Gün / Ajanda', 'A · H · D · L'], ['Takvim: önceki / sonraki', '← · →'], ['Takvim: bugüne git', 'T'], ['Kartı sütunlar arasında taşı', 'Alt + ← / →'], ['Kartı sütun içinde sırala', 'Alt + ↑ / ↓'], ['Kartı aç', 'Enter'], ['Formu kaydet', 'Ctrl + Enter'], ['Pencereyi kapat', 'Esc'], ['Tema değiştir', 'Shift + D']];
    openModal({ title: 'Klavye kısayolları', size: 'sm', body: `<table class="kbd-table">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b.split(' · ').map((k) => `<kbd>${k}</kbd>`).join(' ')}</td></tr>`).join('')}</table>`, footer: '<span class="grow"></span><button type="button" class="btn btn-primary" data-close>Tamam</button>' });
  }
  function toggleTheme() {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* yoksay */ }
    renderSidebar(); renderUserMenu();
  }
  function setView(v) { if (v === 'admin' && S.me.role !== 'admin') return; ui.view = v; ui._keepScroll = false; saveUI(); document.body.classList.remove('sidebar-open'); toggleUserMenu(false); if (v === 'admin') adminUsers = null; render(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); }
  function calStep(dir) {
    const m = ui.calMode;
    ui.cursor = m === 'month' ? addMonths(ui.cursor, dir) : m === 'week' ? addDays(ui.cursor, 7 * dir) : m === 'day' ? addDays(ui.cursor, dir) : addDays(ui.cursor, 30 * dir);
    render();
  }

  // ================== Olaylar ==================
  function onClick(e) {
    if (!S) return;
    if (drag.suppressClick) { e.preventDefault(); return; }
    if (!e.target.closest('#user-menu')) toggleUserMenu(false);
    const card = e.target.closest('.board .card');
    if (card && !e.target.closest('[data-action]')) { openTask(card.dataset.id); return; }
    const el = e.target.closest('[data-action]');
    if (!el || el.closest('.modal-backdrop')) return;
    const a = el.dataset.action, id = el.dataset.id;
    switch (a) {
      case 'view': setView(el.dataset.view); break;
      case 'new-event': openEvent(null, { date: el.dataset.date || (ui.view === 'calendar' ? ui.cursor : todayStr()) }); break;
      case 'new-task': openTask(null, { due: el.dataset.due, board: el.dataset.board }); break;
      case 'edit-event': e.stopPropagation(); openEvent(id); break;
      case 'edit-task': if (e.target.closest('[data-action="toggle-done"]')) return; openTask(id); break;
      case 'toggle-done': e.stopPropagation(); toggleDone(id); break;
      case 'new-event-day': openEvent(null, { date: el.dataset.date }); break;
      case 'goto-day': ui.cursor = el.dataset.date; ui.calMode = 'day'; ui._keepScroll = false; saveUI(); render(); break;
      case 'slot': {
        const r = el.getBoundingClientRect();
        const mins = Math.floor(((e.clientY - r.top) / HOUR_H) * 2) * 30;
        openEvent(null, { date: el.dataset.date, start: fromMin(Math.max(0, Math.min(mins, 23 * 60))) });
        break;
      }
      case 'cal-prev': calStep(-1); break;
      case 'cal-next': calStep(1); break;
      case 'cal-today': ui.cursor = todayStr(); ui._keepScroll = false; render(); break;
      case 'cal-mode': ui.calMode = el.dataset.mode; ui._keepScroll = false; saveUI(); render(); break;
      case 'filter-project': ui.project = ui.project === id ? '' : id; if (ui.project) ui.board = ui.project; saveUI(); render(); document.body.classList.remove('sidebar-open'); break;
      case 'filter-tag': ui.tag = ui.tag === el.dataset.tag ? '' : el.dataset.tag; saveUI(); render(); document.body.classList.remove('sidebar-open'); break;
      case 'toggle-mine': ui.mine = !ui.mine; saveUI(); render(); document.body.classList.remove('sidebar-open'); break;
      case 'clear-filter': ui[el.dataset.k] = el.dataset.k === 'mine' ? false : ''; saveUI(); render(); break;
      case 'new-project': openProject(null); break;
      case 'edit-project': openProject(id); break;
      case 'rename-col': startRename(id); break;
      case 'col-menu': columnMenu(id); break;
      case 'add-column': addColumn(); break;
      case 'quick-add': startQuickAdd(el.dataset.col); break;
      case 'toggle-theme': toggleTheme(); break;
      case 'export': window.location.href = '/api/export'; toast('Yedek indiriliyor…'); break;
      case 'shortcuts': showShortcuts(); break;
      case 'open-sidebar': document.body.classList.add('sidebar-open'); break;
      case 'close-sidebar': document.body.classList.remove('sidebar-open'); break;
      case 'user-menu': toggleUserMenu(); break;
      case 'profile': toggleUserMenu(false); openProfile(); break;
      case 'logout': toggleUserMenu(false); logout(); break;
      case 'admin-new-user': openAdminUser(null); break;
      case 'admin-edit-user': openAdminUser(id); break;
      case 'admin-delete-user': adminDeleteUser(id); break;
      case 'admin-clear-samples': adminClearSamples(); break;
    }
  }
  function onChange(e) {
    if (e.target.id === 'board-select') {
      ui.board = e.target.value;
      if (ui.project && ui.project !== ui.board) ui.project = '';
      saveUI(); render();
    }
  }
  function onKeyDown(e) {
    if (!S) return;
    const top = modalStack[modalStack.length - 1];
    if (top) {
      if (e.key === 'Escape') { e.preventDefault(); top.close(); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const f = $('form', top.el); if (f) f.requestSubmit(); return; }
      if (e.key === 'Tab') {
        const fs = $$('button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', top.el).filter((x) => x.offsetParent !== null);
        if (!fs.length) return;
        const first = fs[0], last = fs[fs.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (e.key === 'Escape' && !$('#user-dropdown').hidden) { toggleUserMenu(false); $('#user-btn').focus(); return; }
    if (drag.active && e.key === 'Escape') { cancelDrag(); return; }
    const tg = e.target;
    const typing = tg.matches && tg.matches('input, textarea, select, [contenteditable="true"]');
    if (typing) { if (e.key === 'Escape' && tg.id === 'search') { tg.value = ''; ui.q = ''; render(); tg.blur(); } return; }
    if (tg.classList && tg.classList.contains('card') && tg.closest('.board')) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(tg.dataset.id); return; }
      if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); keyboardMove(tg, e.key); return; }
    }
    if ((e.key === 'Enter' || e.key === ' ') && tg.matches && tg.matches('[role="button"][data-action]')) { e.preventDefault(); tg.click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'D' && e.shiftKey) { toggleTheme(); return; }
    const kl = k.toLocaleLowerCase(LOCALE);
    if (k === '/') { e.preventDefault(); $('#search').focus(); }
    else if (kl === 'n') { e.preventDefault(); openEvent(null, { date: ui.view === 'calendar' ? ui.cursor : todayStr() }); }
    else if (kl === 'g') { e.preventDefault(); openTask(null); }
    else if (kl === 'b') { ui.mine = !ui.mine; saveUI(); render(); }
    else if (k === '1') setView('today');
    else if (k === '2') setView('calendar');
    else if (k === '3') setView('board');
    else if (k === '4') setView('admin');
    else if (k === '?') showShortcuts();
    else if (ui.view === 'calendar') {
      const modes = { a: 'month', h: 'week', d: 'day', l: 'agenda' };
      if (k === 'ArrowLeft') calStep(-1);
      else if (k === 'ArrowRight') calStep(1);
      else if (kl === 't') { ui.cursor = todayStr(); ui._keepScroll = false; render(); }
      else if (modes[kl]) { ui.calMode = modes[kl]; ui._keepScroll = false; saveUI(); render(); }
    }
  }

  // ================== Başlat ==================
  async function startApp() {
    await reload();
    $('#auth-root').hidden = true;
    $('#app').hidden = false;
    document.body.classList.remove('booting');
    render();
  }
  async function poll() {
    if (!S || document.visibilityState !== 'visible' || modalStack.length || drag.active || drag.pending) return;
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches('input:not(#search),textarea,select')) return;
    try {
      const changed = await reload();
      if (changed || ui.view === 'today' || ui.view === 'calendar') { if (!modalStack.length && !drag.active) { const y = window.scrollY; render(); window.scrollTo(0, y); } }
    } catch (_) { /* çevrimdışı olabilir */ }
  }
  async function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', cancelDrag);
    document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
    document.addEventListener('contextmenu', (e) => { if (drag.active || (drag.pending && e.target.closest('.card'))) e.preventDefault(); });
    let st;
    $('#search').addEventListener('input', (e) => { clearTimeout(st); st = setTimeout(() => { ui.q = e.target.value.trim(); render(); }, 150); });
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
    window.addEventListener('online', poll);

    try { CONFIG = await api('GET', '/api/config'); setTZ(CONFIG.tz); ui.cursor = todayStr(); } catch (e) { /* çevrimdışı */ }
    try { const s = await api('GET', '/api/auth/session'); if (s.user) await startApp(); else showAuth('login'); }
    catch (e) { showAuth('login', e.message); }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('/sw.js').catch(() => { /* yoksay */ });
  }
  window.TakvimPro = { get state() { return S; }, ui, todayStr, reload };
  init();
})();
