'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const { ApiError } = require('./util');
const { sessionMiddleware } = require('./auth');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);

  // Güvenlik başlıkları
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  // CSRF koruması: durum değiştiren isteklerde özel başlık zorunlu (çapraz kaynaktan gönderilemez, SameSite=Lax ile birlikte)
  api.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'fetch') return next(new ApiError(403, 'Geçersiz istek kaynağı.'));
    next();
  });
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(sessionMiddleware(db));
  api.get('/health', async (_req, res) => { await db.get('SELECT 1 AS ok', []); res.json({ ok: true, db: db.client }); });
  for (const m of ['auth', 'admin', 'projects', 'tasks', 'events', 'misc']) require('./routes/' + m)(api, db);
  api.use((_req, _res, next) => next(new ApiError(404, 'API uç noktası bulunamadı.')));
  api.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, field: err.field });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'İstek çok büyük.' });
    if (/UNIQUE|unique/.test(err.message)) return res.status(409).json({ error: 'Bu kayıt zaten var.' });
    if (/FOREIGN KEY|CHECK constraint|violates/.test(err.message)) return res.status(400).json({ error: 'Geçersiz veri.' });
    console.error('[API HATASI]', err);
    res.status(500).json({ error: 'Sunucu hatası. Lütfen tekrar deneyin.' });
  });
  app.use('/api', api);

  // Statik ön yüz
  const pub = path.join(config.ROOT, 'public');
  app.get('/sw.js', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(pub, 'sw.js')); });
  app.use(express.static(pub, { index: 'index.html', maxAge: config.NODE_ENV === 'production' ? '1h' : 0 }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(pub, 'index.html')));
  return app;
}

module.exports = { createApp };
