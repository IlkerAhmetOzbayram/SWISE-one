// Express uygulaması: güvenlik katmanları + modüller + hata yönetimi
const express = require('express');
const path = require('path');
const config = require('./config');
const { HttpError } = require('./lib/http');
const { securityHeaders, sameOrigin } = require('./lib/security');

const MODULES = ['auth', 'settings', 'users', 'customers', 'activities', 'expenses', 'reports', 'calendar', 'budget',
  'dashboard', 'audit', 'backup'];

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders(config));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', sameOrigin);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  for (const name of MODULES) app.use(require(`./modules/${name}`).router);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz istek' });
    if (/UNIQUE constraint failed: users.username/.test(err.message)) return res.status(400).json({ error: 'Bu kullanıcı adı zaten var' });
    if (/UNIQUE constraint failed: holidays.date/.test(err.message)) return res.status(400).json({ error: 'Bu tarihte zaten bir tatil kaydı var' });
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  });

  return app;
}

module.exports = { createApp };
