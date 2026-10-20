'use strict';
const config = require('./src/config');
const { open } = require('./src/db');
const { createApp } = require('./src/app');

(async () => {
  const db = await open();
  const app = createApp(db);
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`Takvim Pro çalışıyor: http://localhost:${config.PORT}  (veritabanı: ${db.client === 'sqlite' ? config.DB_PATH : 'PostgreSQL'}, saat dilimi: ${config.APP_TZ})`);
  });
  const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((e) => { console.error('Başlatma hatası:', e); process.exit(1); });
