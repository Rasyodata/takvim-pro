'use strict';
const { open } = require('../src/db');
(async () => {
  const db = await open({ migrate: false });
  const applied = await require('../src/migrate').migrate(db, { log: true });
  console.log(applied.length ? `${applied.length} göç uygulandı.` : 'Veritabanı güncel.');
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
