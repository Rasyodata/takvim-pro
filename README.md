# Takvim Pro — Ekip Takvimi & İş Akışı

> 🌐 **Canlı:** https://takvim-pro.onrender.com — Render'da (Docker) yayında.

Çok kullanıcılı takvim + Kanban görev yönetimi uygulaması.
**Node.js (LTS) + Express 5** arka uç, **SQLite** (better-sqlite3, tek dosya, kurulum gerektirmez) ve
taşınabilir SQL şeması; ön yüz bağımlılıksız (vanilla JS), Türkçe arayüz, PWA olarak kurulabilir.

## Hızlı başlangıç

Gereksinim: **Node.js 20+** (LTS önerilir).

```bash
npm install        # bağımlılıklar
npm run seed       # (isteğe bağlı) örnek kullanıcılar, projeler, görevler, etkinlikler
npm start          # http://localhost:3000
```

Veritabanı ilk çalıştırmada `data/takvim.db` olarak otomatik oluşturulur ve göçler (migration) uygulanır.
Geliştirme sırasında otomatik yeniden başlatma için: `npm run dev`. Göçleri elle çalıştırmak için: `npm run migrate`.

### Örnek hesaplar (`npm run seed`)

| Rol | E-posta | Şifre |
|---|---|---|
| Yönetici | `admin@ornek.com` | `Admin123!` |
| Kullanıcı | `ayse@ornek.com` | `Ayse1234!` |
| Kullanıcı | `mehmet@ornek.com` | `Mehmet123!` |

> ⚠️ Bunlar **yalnızca deneme** içindir; şifreleri herkes bilir. Gerçek kullanımda **Yönetim → Örnek verileri sil**
> ile silin (veya hiç `seed` çalıştırmayın). Örnek kayıtların başlıkları “Örnek:” ile başlar.
> `npm run seed` tekrar çalıştırılırsa yalnızca örnek kayıtları silip yeniden oluşturur; gerçek verilere dokunmaz.

Seed içinde gizlilik kurallarını göstermek için: “Örnek: Mobil Uygulama” projesinde yönetici **üye değildir**,
Ayşe'nin kişisel görevi ve özel randevusunu yalnızca Ayşe görür.

İlk kez kurulumda seed çalıştırmazsanız, **ilk kayıt olan kullanıcı otomatik olarak yönetici** olur.

## Özellikler

- **Kimlik doğrulama:** kayıt / giriş / çıkış, bcrypt ile şifre özeti, `HttpOnly` + `SameSite=Lax` oturum çerezi
  (oturumlar veritabanında SHA-256 özetiyle tutulur), giriş denemesi sınırlaması, CSRF koruması (`X-Requested-With` başlığı).
- **Yetkilendirme:** herkes yalnızca kendi kişisel kayıtlarını ve üyesi olduğu projelerin kayıtlarını görür.
  Başkasının kaydına erişim denemeleri 404 döner (varlığı sızdırılmaz). Etkinliği yalnızca oluşturan düzenler;
  davetliler katılım yanıtı (RSVP) verebilir. Proje ayarlarını ve üyelerini yalnızca proje sahibi yönetir.
- **Yönetici sayfası:** kullanıcı oluşturma, düzenleme, rol değiştirme, devre dışı bırakma, şifre sıfırlama, silme,
  örnek verileri silme. Son etkin yönetici düşürülemez/silinemez.
- **Takvim:** ay / hafta / gün / ajanda görünümleri, gün veya saat dilimine tıklayıp etkinlik oluşturma, tüm gün etkinlikleri,
  kategori/renk, notlar, isteğe bağlı proje, katılımcılar. Teslim tarihli görevler de takvimde görünür.
- **İş akışı (Kanban):** kişisel pano + her proje için ayrı pano; sütun ekleme/yeniden adlandırma/sıralama/silme,
  “tamamlandı” sütunu, sürükle-bırak (fare + dokunmatik uzun basma), klavye ile taşıma (Alt + oklar).
  Kartlar: başlık, açıklama, öncelik (Düşük/Orta/Yüksek/Acil), teslim tarihi, etiketler, proje, **atanan kişi**,
  kontrol listesi ve **yorumlar**.
- **Bugün paneli:** sunucu tarafında hesaplanan istatistikler (`/api/dashboard`), bugünün programı, bugün teslim edilecekler,
  gecikmiş görevler, bana atanan açık görevler, haftalık tamamlanan grafiği, ekip etkinlik akışı.
- **Filtreler:** proje / kişisel, etiket, **Bana atananlar**, arama.
- Açık/koyu tema, mobil uyumlu, klavye kısayolları (`?`), JSON dışa aktarma, PWA (kurulabilir, uygulama kabuğu çevrimdışı açılır).
- Çok kullanıcılı canlılık: veriler 30 saniyede bir ve sekmeye dönüldüğünde yenilenir.

## Ortam değişkenleri

`.env.example` dosyasına bakın (uygulama `.env` dosyasını kendisi okumaz; değişkenleri kabuktan, Docker'dan veya
süreç yöneticinizden verin, örn. `PORT=8080 npm start`).

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | HTTP portu |
| `HOST` | `0.0.0.0` | Dinlenecek adres |
| `NODE_ENV` | `development` | `production` iken `COOKIE_SECURE` varsayılan olarak açılır |
| `DB_CLIENT` | `sqlite` | `sqlite` veya `postgres` (deneysel) |
| `DB_PATH` | `data/takvim.db` | SQLite dosya yolu |
| `DATABASE_URL` | — | PostgreSQL bağlantı adresi |
| `APP_TZ` | `Europe/Istanbul` | “Bugün”, gecikme ve haftalık istatistik hesapları için saat dilimi |
| `SESSION_DAYS` | `30` | Oturum süresi (gün) |
| `COOKIE_SECURE` | üretimde `true` | Çerez yalnızca HTTPS üzerinden gönderilsin mi |
| `TRUST_PROXY` | `false` | Ters vekil arkasında doğru istemci IP'si için |
| `ALLOW_REGISTRATION` | `true` | `false` ise yalnızca yönetici kullanıcı oluşturur |
| `BCRYPT_ROUNDS` | `11` | bcrypt maliyet faktörü |
| `SHOW_DEMO_HINT` | `true` | Örnek hesaplar varken giriş ekranında bilgilerini göster |

## Docker

```bash
docker compose up -d --build
docker compose exec app npm run seed   # isteğe bağlı örnek veriler
```

Veritabanı `takvim-data` biriminde (`/data/takvim.db`) kalıcıdır. HTTPS sağlayan bir ters vekil (nginx, Caddy, Traefik)
arkasında `COOKIE_SECURE=true` ve `TRUST_PROXY=true` yapın.

## Veritabanı

- Şema: [`db/schema.sql`](db/schema.sql) (temel sürüm `0001_schema`)
- Göçler: `db/migrations/NNNN_ad.sql` — sırasıyla, bir kez uygulanır; uygulananlar `schema_migrations` tablosunda tutulur.
  Yeni değişiklik için yeni bir dosya ekleyin (ör. `0003_yeni_alan.sql`), `schema.sql`'i değiştirmeyin.
- Tablolar: `users`, `sessions`, `projects`, `project_members`, `board_columns`, `tasks`, `tags`, `task_tags`,
  `checklist_items`, `events`, `event_attendees`, `comments`, `activity_log` (+ `schema_migrations`).
- Taşınabilirlik kuralları: kimlikler uygulamada üretilen UUID (`TEXT`), zaman damgaları UTC ISO-8601 metin,
  takvim saatleri `APP_TZ` duvar saati (`YYYY-MM-DDTHH:MM`), mantıksal alanlar `0/1` + `CHECK`, SQLite'a özgü
  sözdizimi yok (`AUTOINCREMENT`, `datetime('now')`, `INSERT OR IGNORE` kullanılmaz; `ON CONFLICT DO NOTHING` kullanılır).
- Yedekleme (SQLite): uygulama çalışırken `sqlite3 data/takvim.db ".backup yedek.db"` veya durdurup dosyayı kopyalayın.

### PostgreSQL'e geçiş (deneysel)

Veri erişimi tek bir arayüzden geçer (`src/db.js`: `all/get/run/exec/tx`, `?` yer tutucuları). PostgreSQL
bağdaştırıcısı `src/adapters/postgres.js` içindedir ve `?` → `$1, $2…` dönüşümünü yapar.
**Not: Bu bağdaştırıcı bu depoda gerçek bir PostgreSQL sunucusuna karşı test edilmemiştir.**

1. `npm install pg`
2. Boş bir veritabanı oluşturun: `createdb takvim`
3. `DB_CLIENT=postgres DATABASE_URL=postgres://kullanici:sifre@localhost:5432/takvim npm run migrate`
   (aynı `db/schema.sql` ve göç dosyaları PostgreSQL'de çalışacak şekilde yazılmıştır)
4. `DB_CLIENT=postgres DATABASE_URL=... npm start` (isteğe bağlı: `npm run seed`)
5. Mevcut SQLite verisini taşımak için tabloları sırayla (users → projects → project_members → board_columns → tasks →
   tags → task_tags → checklist_items → events → event_attendees → comments → activity_log) dışa/içe aktarın;
   ör. `sqlite3 -csv data/takvim.db "SELECT * FROM users" > users.csv` ve `\copy users FROM 'users.csv' CSV`.
   İsterseniz `pgloader` aracı da SQLite → PostgreSQL taşımasını otomatik yapar.

## REST API özeti

Tüm uç noktalar `/api` altındadır, JSON alır/verir. Durum değiştiren isteklerde `X-Requested-With: fetch` başlığı zorunludur.
Hatalar `{ "error": "Türkçe mesaj", "field": "alan" }` biçimindedir.

| Alan | Uç noktalar |
|---|---|
| Kimlik | `GET /config`, `GET /auth/session`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET/PATCH /auth/me` |
| Yönetim | `GET/POST /admin/users`, `PATCH/DELETE /admin/users/:id`, `DELETE /admin/sample-data` |
| Kullanıcılar | `GET /users` (rehber) |
| Projeler | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `GET/POST /projects/:id/members`, `DELETE /projects/:id/members/:userId` |
| Sütunlar | `GET /columns?projectId=…|personal`, `POST /columns`, `PATCH/DELETE /columns/:id`, `PUT /columns/order` |
| Görevler | `GET /tasks?projectId&assignee=me&tag&q&status&dueFrom&dueTo`, `POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/move`, `POST /tasks/:id/assign` |
| Kontrol listesi | `PUT/POST /tasks/:id/checklist`, `PATCH/DELETE /checklist/:id` |
| Yorumlar | `GET/POST /tasks/:id/comments`, `PATCH/DELETE /comments/:id` |
| Etiketler | `GET /tags` |
| Etkinlikler | `GET /events?from&to`, `POST /events`, `GET/PATCH/DELETE /events/:id`, `POST /events/:id/rsvp` |
| Diğer | `GET /dashboard`, `GET /activity`, `GET /bootstrap`, `GET /export`, `GET /health` |

## Testler

```bash
npm test                          # API entegrasyon testleri (geçici veritabanı ile)
npm run seed && npm start &       # tarayıcı testi için sunucu
pip install playwright && python3 tests/e2e_browser.py   # uçtan uca tarayıcı testleri + ekran görüntüleri
```

## Bilinen sınırlamalar

- Tekrarlayan etkinlikler, hatırlatma/bildirim ve e-posta gönderimi yok; birden çok güne yayılan etkinlikler
  takvimde yalnızca başlangıç gününde gösterilir.
- Gerçek zamanlı (WebSocket) güncelleme yok; veriler 30 sn'de bir yenilenir. Aynı kaydı aynı anda düzenleyen iki kişiden
  son kaydeden kazanır.
- Ön yüz tüm görünür verileri tek seferde (`/api/bootstrap`) yükler; küçük/orta ekipler için tasarlanmıştır.
- Kullanıcı rehberi (`/api/users`) giriş yapmış herkesin tüm etkin kullanıcıların ad ve e-postasını görmesine izin verir
  (atama/davet için). Proje içi rol yalnızca “sahip” ve “üye”dir.
- Giriş denemesi sınırlaması bellek içidir (tek süreç). Şifre sıfırlama e-postası yoktur; yönetici şifre atayabilir.
- PostgreSQL bağdaştırıcısı deneyseldir ve test edilmemiştir.
