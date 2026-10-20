"""Uçtan uca tarayıcı testi (Playwright + Chromium).
Çalıştırma: sunucu http://localhost:3000 adresinde açıkken  `python3 tests/e2e_browser.py`
Not: Önce `npm run seed` ile örnek veriler yüklenmiş olmalıdır."""
import os, re, sys, json
from playwright.sync_api import sync_playwright

URL = os.environ.get('BASE_URL', 'http://localhost:3000')
SS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'screenshots') + '/'
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
errors, results = [], []

def ok(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)

def watch(pg, label):
    pg.on('console', lambda m: errors.append(f'[{label}] console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errors.append(f'[{label}] pageerror: {e}'))
    pg.on('requestfailed', lambda r: errors.append(f'[{label}] requestfailed: {r.url} {r.failure}') if '/api/export' not in r.url else None)

def shot(pg, name):
    pg.evaluate("document.querySelectorAll('.toast').forEach(t=>t.remove())"); pg.wait_for_timeout(150); pg.screenshot(path=SS + name)

def state(pg): return pg.evaluate('JSON.parse(JSON.stringify(TakvimPro.state))')

def login(pg, email, password):
    pg.goto(URL); pg.wait_for_selector('#auth-form')
    pg.fill('#au-email', email); pg.fill('#au-pass', password); pg.click('#auth-form [type=submit]')
    pg.wait_for_selector('#app:not([hidden])'); pg.wait_for_function('window.TakvimPro && TakvimPro.state')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    mk = lambda: b.new_context(viewport={'width': 1280, 'height': 800}, timezone_id='Europe/Istanbul', locale='tr-TR', color_scheme='light', accept_downloads=True)
    ctxA = mk(); A = ctxA.new_page(); watch(A, 'admin')

    # ---------- Giriş ----------
    A.goto(URL); A.wait_for_selector('#auth-form'); A.wait_for_timeout(200)
    ok('login screen shown', A.is_visible('#auth-form') and A.locator('.demo-box button').count() == 3)
    shot(A, 'login.png')
    A.fill('#au-email', 'admin@ornek.com'); A.fill('#au-pass', 'yanlis-sifre1'); A.click('#auth-form [type=submit]')
    A.wait_for_selector('#auth-err:not([hidden])')
    ok('wrong password rejected', 'hatalı' in A.text_content('#auth-err'))
    errors[:] = [e for e in errors if '401' not in e]  # beklenen 401 kaynak hatası
    A.click('.demo-box button[data-demo="admin@ornek.com"]'); A.click('#auth-form [type=submit]')
    A.wait_for_selector('#app:not([hidden])'); A.wait_for_function('window.TakvimPro && TakvimPro.state')
    s = state(A); ok('admin logged in', s['me']['email'] == 'admin@ornek.com' and s['me']['role'] == 'admin')
    A.click('.nav-item[data-view=today]')
    A.wait_for_function("[...document.querySelectorAll('.stat .value')].every(v=>!v.textContent.includes('…'))")
    ok('dashboard stats loaded', A.locator('.stat').count() == 5 and A.locator('.activity .a-row').count() > 0)
    ok('overdue highlighted', A.locator('.row-item.overdue').count() >= 1)
    shot(A, 'dashboard.png')

    # ---------- Takvim + etkinlik oluşturma ----------
    A.click('.nav-item[data-view=calendar]'); A.click('[data-action=cal-mode][data-mode=month]'); A.wait_for_timeout(200)
    shot(A, 'calendar-month.png')
    cell = A.locator('.mcell:not(.other)').nth(24); date = cell.get_attribute('data-date')
    bb = cell.bounding_box(); A.mouse.click(bb['x'] + bb['width'] - 8, bb['y'] + bb['height'] - 8)
    A.wait_for_selector('#ev-title'); A.fill('#ev-title', 'E2E ekip toplantısı'); A.fill('#ev-start', '14:00'); A.fill('#ev-end', '15:00')
    web = [x for x in s['projects'] if 'Web' in x['name']][0]
    ayse = [u for u in s['users'] if u['email'] == 'ayse@ornek.com'][0]
    A.select_option('#ev-proj', web['id'])
    A.check(f'input[name=attendee][value="{ayse["id"]}"]')
    A.click('.modal [type=submit]'); A.wait_for_selector('.modal', state='detached')
    ev = [e for e in state(A)['events'] if e['title'] == 'E2E ekip toplantısı']
    ok('create event (month cell) persisted', ev and ev[0]['date'] == date and ev[0]['start'] == '14:00' and ev[0]['attendees'][0]['userId'] == ayse['id'])
    A.click('[data-action=cal-mode][data-mode=week]'); A.wait_for_timeout(150); ok('week view', A.locator('.day-col').count() == 7)
    A.click('[data-action=cal-mode][data-mode=day]'); A.wait_for_timeout(150); ok('day view', A.locator('.day-col').count() == 1)
    A.click('[data-action=cal-mode][data-mode=agenda]'); A.wait_for_timeout(150); ok('agenda view', A.locator('.agenda-day').count() > 0)
    A.click('[data-action=cal-mode][data-mode=month]')

    # ---------- Görev oluştur + ata ----------
    A.click('.nav-item[data-view=board]'); A.select_option('#board-select', web['id']); A.wait_for_timeout(200)
    ok('project board shows 3 columns', A.locator('.column').count() == 3)
    shot(A, 'kanban.png')
    A.keyboard.press('g'); A.wait_for_selector('#tk-title')
    A.fill('#tk-title', 'E2E: Ayşe için görev'); A.select_option('#tk-proj', web['id'])
    A.select_option('#tk-asg', ayse['id']); A.click('[data-prio=high]'); A.fill('#tk-tags', 'e2e, test')
    A.fill('#cl-new', 'Alt görev 1'); A.keyboard.press('Enter')
    A.click('.modal [type=submit]'); A.wait_for_selector('.modal', state='detached')
    t = [x for x in state(A)['tasks'] if x['title'] == 'E2E: Ayşe için görev']
    ok('create + assign task', t and t[0]['assignee'] == ayse['id'] and t[0]['project'] == web['id'] and t[0]['priority'] == 'high' and len(t[0]['checklist']) == 1 and sorted(t[0]['tags']) == ['e2e', 'test'])
    tid = t[0]['id']
    ok('card shows assignee avatar', A.locator(f'.card[data-id="{tid}"] .avatar').count() == 1)

    # ---------- Kartı sürükle ----------
    cols = sorted([c for c in state(A)['columns'] if c['projectId'] == web['id']], key=lambda c: c['position'])
    src = A.locator(f'.card[data-id="{tid}"]'); tgt = A.locator(f'.col-cards[data-col="{cols[1]["id"]}"]')
    sb = src.bounding_box(); tb = tgt.bounding_box()
    A.mouse.move(sb['x'] + 30, sb['y'] + 15); A.mouse.down(); A.mouse.move(sb['x'] + 60, sb['y'] + 30, steps=5)
    A.mouse.move(tb['x'] + tb['width'] / 2, tb['y'] + 5, steps=15)
    ok('placeholder during drag', A.locator(f'.col-cards[data-col="{cols[1]["id"]}"] .card-placeholder').count() == 1)
    A.mouse.up(); A.wait_for_timeout(600)
    r = A.request.get(f'{URL}/api/tasks/{tid}').json()['task']
    ok('drag card todo->doing persisted on server', r['columnId'] == cols[1]['id'], r['columnId'])
    ok('no modal after drag', A.locator('.modal').count() == 0)
    src = A.locator(f'.card[data-id="{tid}"]'); tgt = A.locator(f'.col-cards[data-col="{cols[2]["id"]}"]')
    sb = src.bounding_box(); tb = tgt.bounding_box()
    A.mouse.move(sb['x'] + 30, sb['y'] + 15); A.mouse.down(); A.mouse.move(tb['x'] + 40, tb['y'] + tb['height'] - 10, steps=15); A.mouse.up(); A.wait_for_timeout(600)
    r = A.request.get(f'{URL}/api/tasks/{tid}').json()['task']
    ok('drag to done sets completedAt', r['columnId'] == cols[2]['id'] and r['completedAt'])
    A.locator(f'.card[data-id="{tid}"]').focus(); A.keyboard.press('Alt+ArrowLeft'); A.wait_for_timeout(500)
    r = A.request.get(f'{URL}/api/tasks/{tid}').json()['task']
    ok('keyboard Alt+Left moves back, clears completedAt', r['columnId'] == cols[1]['id'] and not r['completedAt'])
    # yorum ekle
    A.locator(f'.card[data-id="{tid}"]').click(); A.wait_for_selector('#cm-new')
    A.fill('#cm-new', 'E2E yorumu'); A.click('#cm-send'); A.wait_for_selector('.comment .txt')
    ok('comment added', A.locator('.comment .txt', has_text='E2E yorumu').count() == 1)
    A.keyboard.press('Escape')
    # quick add + Bana atananlar
    A.click(f'[data-action=quick-add][data-col="{cols[0]["id"]}"]'); A.keyboard.type('E2E hızlı kart'); A.keyboard.press('Enter'); A.wait_for_timeout(500); A.keyboard.press('Escape')
    ok('quick add card', any(x['title'] == 'E2E hızlı kart' for x in state(A)['tasks']))
    A.click('#mine-btn'); A.wait_for_timeout(200)
    me_id = state(A)['me']['id']
    mine_expected = len([x for x in state(A)['tasks'] if x['assignee'] == me_id and x['project'] == web['id']])
    ok('Bana atananlar filter', A.locator('.card').count() == mine_expected and A.locator('#active-filters .chip').count() == 1, f'{mine_expected}')
    A.click('#mine-btn')
    A.fill('#search', 'Logo'); A.wait_for_timeout(400); ok('search filters board', A.locator('.card').count() == 1); A.fill('#search', ''); A.wait_for_timeout(300)

    # ---------- Yönetim: kullanıcı oluştur ----------
    A.click('.nav-item[data-view=admin]'); A.wait_for_selector('table.data tbody tr')
    A.click('[data-action=admin-new-user]'); A.wait_for_selector('#au-n')
    A.fill('#au-n', 'Zeynep Kaya'); A.fill('#au-e', 'zeynep@test.com'); A.fill('#au-p', 'Zeynep2026')
    A.click('.modal [type=submit]'); A.wait_for_selector('.modal', state='detached'); A.wait_for_selector('table.data td >> text=zeynep@test.com')
    ok('admin created user', A.locator('table.data tbody tr').count() == 4)
    shot(A, 'admin-users.png')

    # ---------- İkinci kullanıcı (Ayşe) ----------
    ctxB = mk(); B = ctxB.new_page(); watch(B, 'ayse')
    login(B, 'ayse@ornek.com', 'Ayse1234!')
    sb_ = state(B)
    ok('Ayşe sees task assigned by admin', any(x['id'] == tid and x['assignee'] == sb_['me']['id'] for x in sb_['tasks']))
    ok('Ayşe sees event invite', any(e['title'] == 'E2E ekip toplantısı' for e in sb_['events']))
    ok('Ayşe cannot see admin personal task', not any('Fatura' in x['title'] for x in sb_['tasks']))
    ok('Ayşe cannot see admin personal event', not any('Müşteri ile öğle' in e['title'] for e in sb_['events']))
    ok('Ayşe has no admin nav', B.locator('.nav-item[data-view=admin]').is_hidden())
    B.click('#mine-btn'); B.click('.nav-item[data-view=today]'); B.wait_for_timeout(300)
    ok('Ayşe dashboard: Bana atananlar shows task', B.locator('.row-item', has_text='E2E: Ayşe için görev').count() >= 1)
    B.click('#mine-btn')
    priv_task = [x for x in sb_['tasks'] if 'özel görevi' in x['title']][0]
    priv_event = [e for e in sb_['events'] if 'özel doktor' in e['title']][0]
    mobil = [x for x in sb_['projects'] if 'Mobil' in x['name']][0]
    sa = state(A)
    ok('admin state lacks Ayşe private items', not any(x['id'] == priv_task['id'] for x in sa['tasks']) and not any(e['id'] == priv_event['id'] for e in sa['events']) and not any(x['id'] == mobil['id'] for x in sa['projects']))
    st = [A.request.get(f'{URL}/api/tasks/{priv_task["id"]}').status, A.request.get(f'{URL}/api/events/{priv_event["id"]}').status, A.request.get(f'{URL}/api/projects/{mobil["id"]}').status,
          A.request.patch(f'{URL}/api/tasks/{priv_task["id"]}', data=json.dumps({'title': 'x'}), headers={'content-type': 'application/json', 'x-requested-with': 'fetch'}).status]
    ok('admin gets 404 for Ayşe private task/event/project via API', st == [404, 404, 404, 404], str(st))
    ok('non-admin blocked from admin API', B.request.get(f'{URL}/api/admin/users').status == 403)
    # Ayşe toplantıyı düzenleyemez ama yanıt verebilir
    eid = [e for e in sb_['events'] if e['title'] == 'E2E ekip toplantısı'][0]['id']
    B.click('.nav-item[data-view=calendar]'); B.evaluate(f"TakvimPro.ui.cursor='{date}'"); B.click('[data-action=cal-mode][data-mode=agenda]'); B.wait_for_timeout(200)
    B.locator('.row-item', has_text='E2E ekip toplantısı').first.click(); B.wait_for_selector('[data-rsvp=accepted]')
    ok('invitee sees read-only event', B.locator('#ev-title').is_disabled())
    B.click('[data-rsvp=accepted]'); B.wait_for_timeout(500)
    ok('RSVP saved', any(a['status'] == 'accepted' for a in A.request.get(f'{URL}/api/events/{eid}').json()['event']['attendees']))

    # ---------- Yeni kullanıcı (Zeynep) ----------
    ctxC = mk(); C = ctxC.new_page(); watch(C, 'zeynep')
    login(C, 'zeynep@test.com', 'Zeynep2026')
    sc = state(C)
    ok('new user sees nothing private', len(sc['projects']) == 0 and len(sc['tasks']) == 0 and len(sc['events']) == 0 and len(sc['columns']) == 3)
    C.click('#user-btn'); C.click('[data-action=logout]'); C.wait_for_selector('#auth-form')
    ok('logout returns to login', C.is_visible('#auth-form'))

    # ---------- Tema + mobil ----------
    A.click('.nav-item[data-view=today]'); A.click('#theme-btn'); A.wait_for_timeout(300)
    ok('dark theme', A.evaluate('document.documentElement.dataset.theme') == 'dark'); shot(A, 'dashboard-dark.png'); A.click('#theme-btn')
    m = b.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Europe/Istanbul', locale='tr-TR', has_touch=True, is_mobile=True)
    M = m.new_page(); watch(M, 'mobile'); login(M, 'ayse@ornek.com', 'Ayse1234!'); M.wait_for_timeout(400)
    ok('mobile: no horizontal overflow', M.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
    shot(M, 'mobile-dashboard.png')
    M.click('[data-action=open-sidebar]'); M.wait_for_timeout(300); M.click('.nav-item[data-view=board]'); M.wait_for_timeout(300); shot(M, 'mobile-kanban.png')
    ok('service worker registered', A.evaluate('navigator.serviceWorker.getRegistrations().then(r=>r.length)') >= 1)

    # ---------- Temizlik: test kullanıcısını sil ----------
    zid = [u for u in A.request.get(f'{URL}/api/admin/users').json()['users'] if u['email'] == 'zeynep@test.com'][0]['id']
    ok('admin deletes user', A.request.delete(f'{URL}/api/admin/users/{zid}', headers={'x-requested-with': 'fetch'}).status == 200)
    b.close()

print('\nCONSOLE/PAGE ERRORS:', errors if errors else 'none')
failed = [r[0] for r in results if not r[1]]
print(f'RESULT: {len(results) - len(failed)}/{len(results)} passed', 'FAILED: ' + str(failed) if failed else '')
sys.exit(1 if failed or errors else 0)
