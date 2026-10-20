'use strict';
const crypto = require('crypto');
const config = require('./config');

class ApiError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const bad = (msg, field) => new ApiError(400, msg, field);
const notFound = (msg = 'Kayıt bulunamadı.') => new ApiError(404, msg);
const forbidden = (msg = 'Bu işlem için yetkiniz yok.') => new ApiError(403, msg);

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---- Zaman (APP_TZ) ----
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: config.APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const todayStr = () => ymd.format(new Date());
const localDate = (iso) => ymd.format(new Date(iso));
function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekStart(s) { const d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); }

// ---- Doğrulama ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validDate(s) { if (!DATE_RE.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s; }
function validDateTime(s) { if (!DT_RE.test(s)) return false; const [h, m] = s.slice(11).split(':').map(Number); return validDate(s.slice(0, 10)) && h < 24 && m < 60; }

const V = {
  str(v, label, { min = 0, max = 500, required = false, field } = {}) {
    if (v == null) { if (required) throw bad(`${label} gerekli.`, field); return v; }
    if (typeof v !== 'string') throw bad(`${label} metin olmalı.`, field);
    const s = v.trim();
    if (required && !s) throw bad(`${label} gerekli.`, field);
    if (s.length < min) throw bad(`${label} en az ${min} karakter olmalı.`, field);
    if (s.length > max) throw bad(`${label} en fazla ${max} karakter olabilir.`, field);
    return s;
  },
  oneOf(v, label, list, { required = false, field } = {}) {
    if (v == null) { if (required) throw bad(`${label} gerekli.`, field); return v; }
    if (!list.includes(v)) throw bad(`${label} geçersiz.`, field);
    return v;
  },
  date(v, label, { field } = {}) {
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || !validDate(v)) throw bad(`${label} YYYY-AA-GG biçiminde olmalı.`, field);
    return v;
  },
  dateTime(v, label, { required = false, field } = {}) {
    if (v == null) { if (required) throw bad(`${label} gerekli.`, field); return v; }
    if (typeof v !== 'string' || !validDateTime(v)) throw bad(`${label} YYYY-AA-GGTSS:DD biçiminde olmalı.`, field);
    return v;
  },
  color(v, label = 'Renk', { field } = {}) {
    if (v == null) return v;
    if (typeof v !== 'string' || !COLOR_RE.test(v)) throw bad(`${label} #RRGGBB biçiminde olmalı.`, field);
    return v.toLowerCase();
  },
  email(v, { required = true, field = 'email' } = {}) {
    if (v == null && !required) return v;
    const s = V.str(v, 'E-posta', { required, max: 254, field });
    if (!EMAIL_RE.test(s)) throw bad('Geçerli bir e-posta adresi girin.', field);
    return s.toLowerCase();
  },
  password(v, { field = 'password' } = {}) {
    if (typeof v !== 'string' || v.length < 8) throw bad('Şifre en az 8 karakter olmalı.', field);
    if (v.length > 128) throw bad('Şifre en fazla 128 karakter olabilir.', field);
    if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) || !/\d/.test(v)) throw bad('Şifre en az bir harf ve bir rakam içermeli.', field);
    return v;
  },
  bool(v, label) { if (v == null) return v; if (typeof v !== 'boolean') throw bad(`${label} true/false olmalı.`); return v; },
  id(v, label, { required = false, field } = {}) {
    if (v == null || v === '') { if (required) throw bad(`${label} gerekli.`, field); return null; }
    if (typeof v !== 'string' || v.length > 64) throw bad(`${label} geçersiz.`, field);
    return v;
  },
  int(v, label, { min = -1e9, max = 1e9 } = {}) {
    if (v == null) return v;
    if (!Number.isInteger(v) || v < min || v > max) throw bad(`${label} geçersiz.`);
    return v;
  },
  object(v) { if (v == null || typeof v !== 'object' || Array.isArray(v)) throw bad('Geçersiz istek gövdesi.'); return v; },
};

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const CATEGORIES = ['work', 'meeting', 'personal', 'health', 'education', 'social', 'other'];
const trLower = (s) => String(s || '').toLocaleLowerCase('tr-TR');

module.exports = { validDate, ApiError, bad, notFound, forbidden, uid, now, todayStr, localDate, addDays, weekStart, V, PRIORITIES, CATEGORIES, trLower };
