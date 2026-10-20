'use strict';
/*
 * DENEYSEL PostgreSQL bağdaştırıcısı (bu depoda test edilmedi).
 * Kullanım: npm install pg  &&  DB_CLIENT=postgres DATABASE_URL=postgres://... npm start
 * Aynı arayüzü (all/get/run/exec/tx) sağlar; "?" yer tutucularını $n'e çevirir.
 * İşlemler AsyncLocalStorage ile isteğe özel bir istemci üzerinde yürütülür.
 */
const { AsyncLocalStorage } = require('async_hooks');

function convert(sql) {
  let i = 0; let out = ''; let q = false;
  for (const ch of sql) {
    if (ch === "'") q = !q;
    out += !q && ch === '?' ? '$' + (++i) : ch;
  }
  return out;
}

async function open(url) {
  if (!url) throw new Error('DATABASE_URL tanımlı değil');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url });
  const als = new AsyncLocalStorage();
  const q = (sql, p) => (als.getStore() || pool).query(convert(sql), (p || []).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)));
  return {
    client: 'postgres',
    all: async (sql, p) => (await q(sql, p)).rows,
    get: async (sql, p) => (await q(sql, p)).rows[0],
    run: async (sql, p) => ({ changes: (await q(sql, p)).rowCount }),
    exec: async (sql) => { await (als.getStore() || pool).query(sql); },
    async tx(fn) {
      if (als.getStore()) return fn();
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await als.run(c, fn);
        await c.query('COMMIT');
        return r;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
    close: () => pool.end(),
  };
}

module.exports = { open, convert };
