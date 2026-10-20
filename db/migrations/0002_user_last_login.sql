-- Kullanıcının son giriş zamanı (yönetici sayfasında gösterilir)
ALTER TABLE users ADD COLUMN last_login_at TEXT;
