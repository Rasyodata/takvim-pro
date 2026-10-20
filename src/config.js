'use strict';
const path = require('path');

const bool = (v, def) => (v == null || v === '' ? def : /^(1|true|yes|evet|on)$/i.test(String(v)));
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  ROOT,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  DB_CLIENT: (process.env.DB_CLIENT || 'sqlite').toLowerCase(), // sqlite | postgres
  DB_PATH: path.resolve(ROOT, process.env.DB_PATH || 'data/takvim.db'),
  DATABASE_URL: process.env.DATABASE_URL || '',
  APP_TZ: process.env.APP_TZ || 'Europe/Istanbul',
  SESSION_DAYS: Number(process.env.SESSION_DAYS) || 30,
  COOKIE_NAME: process.env.COOKIE_NAME || 'takvim_sid',
  COOKIE_SECURE: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  TRUST_PROXY: bool(process.env.TRUST_PROXY, false),
  ALLOW_REGISTRATION: bool(process.env.ALLOW_REGISTRATION, true),
  BCRYPT_ROUNDS: Number(process.env.BCRYPT_ROUNDS) || 11,
  SHOW_DEMO_HINT: bool(process.env.SHOW_DEMO_HINT, true),
};
