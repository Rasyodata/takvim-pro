'use strict';
/* Basit göç (migration) çalıştırıcısı:
 *  - db/schema.sql  -> sürüm "0001_schema" (temel şema)
 *  - db/migrations/NNNN_ad.sql -> sırasıyla, yalnızca bir kez uygulanır
 * Uygulanan sürümler schema_migrations tablosunda tutulur. */
const fs = require('fs');
const path = require('path');
const config = require('./config');

function listMigrations() {
  const dir = path.join(config.ROOT, 'db', 'migrations');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort() : [];
  return [{ version: '0001_schema', file: path.join(config.ROOT, 'db', 'schema.sql') }]
    .concat(files.map((f) => ({ version: f.replace(/\.sql$/, ''), file: path.join(dir, f) })));
}

async function migrate(db, { log = false } = {}) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await db.all('SELECT version FROM schema_migrations')).map((r) => r.version));
  const applied = [];
  for (const m of listMigrations()) {
    if (done.has(m.version)) continue;
    const sql = fs.readFileSync(m.file, 'utf8');
    await db.tx(async () => {
      await db.exec(sql);
      await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
    });
    applied.push(m.version);
    if (log) console.log('  ✔ uygulandı:', m.version);
  }
  return applied;
}

module.exports = { migrate, listMigrations };
