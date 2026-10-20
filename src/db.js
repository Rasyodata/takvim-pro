'use strict';
/*
 * Veritabanı katmanı. Uygulamanın geri kalanı yalnızca şu arayüzü kullanır:
 *   await db.all(sql, params)  -> satır dizisi
 *   await db.get(sql, params)  -> tek satır | undefined
 *   await db.run(sql, params)  -> { changes }
 *   await db.exec(sql)         -> çoklu ifade (göçler)
 *   await db.tx(async () => { ... }) -> işlem (transaction)
 * SQL'lerde "?" yer tutucusu kullanılır; PostgreSQL bağdaştırıcısı bunları $1, $2... biçimine çevirir.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

function openSqlite(file) {
  const Database = require('better-sqlite3');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  const norm = (p) => (p || []).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
  let depth = 0;
  const db = {
    client: 'sqlite',
    raw,
    all: (sql, p) => stmt(sql).all(norm(p)),
    get: (sql, p) => stmt(sql).get(norm(p)),
    run: (sql, p) => { const r = stmt(sql).run(norm(p)); return { changes: r.changes }; },
    exec: (sql) => { raw.exec(sql); },
    // Not: better-sqlite3 eşzamanlıdır; işlem içindeki tüm db çağrıları anında çözülür, bu nedenle
    // başka bir isteğin araya girmesi mümkün değildir. İşlem içinde gerçek G/Ç (ör. bcrypt) beklemeyin.
    async tx(fn) {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth++;
      try { const r = await fn(); raw.exec('COMMIT'); return r; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch (_) { /* yoksay */ } throw e; }
      finally { depth--; }
    },
    close: () => raw.close(),
  };
  return db;
}

async function open(opts = {}) {
  const client = opts.client || config.DB_CLIENT;
  let db;
  if (client === 'postgres' || client === 'pg') db = await require('./adapters/postgres').open(opts.url || config.DATABASE_URL);
  else db = openSqlite(opts.file || config.DB_PATH);
  if (opts.migrate !== false) await require('./migrate').migrate(db);
  return db;
}

module.exports = { open };
