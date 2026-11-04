// İnternete açık çalışma için güvenlik önlemleri
const { HttpError } = require('./http');

function securityHeaders({ production }) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
      "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

// Başka bir siteden gönderilen değişiklik isteklerini (CSRF) reddeder
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = ''; }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Geçersiz istek kaynağı' });
  }
  next();
}

// Aynı IP + kullanıcı adı için belirli sürede en fazla `max` hatalı giriş
function createLoginLimiter({ max = 5, windowMs = 15 * 60e3 } = {}) {
  const fails = new Map();
  const key = (req, username) => `${req.ip}|${username}`;
  return {
    check(req, username) {
      const e = fails.get(key(req, username));
      if (!e || e.count < max) return;
      const left = windowMs - (Date.now() - e.first);
      if (left <= 0) { fails.delete(key(req, username)); return; }
      throw new HttpError(429, `Çok fazla hatalı deneme. ${Math.ceil(left / 60e3)} dakika sonra tekrar deneyin.`);
    },
    fail(req, username) {
      const k = key(req, username);
      const e = fails.get(k);
      if (!e || Date.now() - e.first >= windowMs) fails.set(k, { count: 1, first: Date.now() });
      else e.count += 1;
    },
    success(req, username) { fails.delete(key(req, username)); },
  };
}

module.exports = { securityHeaders, sameOrigin, createLoginLimiter };
