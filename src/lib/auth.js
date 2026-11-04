// Parola, oturum ve yetki kontrolü
const crypto = require('crypto');
const config = require('../config');
const { one, run } = require('../db');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}

const SESSION_DAYS = 30;

// Canlıda (HTTPS) çerez yalnızca şifreli bağlantıda gönderilir
const cookie = (value, maxAge) =>
  `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${config.production ? '; Secure' : ''}`;

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    token, userId, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', cookie(token, SESSION_DAYS * 86400));
}

const clearSessionCookie = (res) => res.setHeader('Set-Cookie', cookie('', 0));

const getToken = (req) => (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/)?.[1];

// İstek bu bilgisayardan mı? (Vekil başlıklarına değil, gerçek bağlantı adresine bakılır)
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLocalRequest = (req) => LOCAL.has(req.socket.remoteAddress);

// Girişsiz modda kayıtlar ilk aktif yöneticinin adına girilir; yönetici yoksa "Yerel Yönetici" oluşturulur
function devUser() {
  const sql = `SELECT id, username, full_name, role FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1`;
  let user = one(sql);
  if (!user) {
    run(`INSERT INTO users (username, full_name, password_hash, role) VALUES ('yerel', 'Yerel Yönetici', ?, 'admin')`,
      hashPassword(crypto.randomBytes(24).toString('hex')));
    user = one(sql);
  }
  return { ...user, no_login: true };
}

function auth(req, res, next) {
  const token = getToken(req);
  let user = token && one(
    `SELECT u.id, u.username, u.full_name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`, token, Date.now());
  if (!user && config.noLogin && isLocalRequest(req)) user = devUser();
  if (!user) return res.status(401).json({ error: 'Lütfen giriş yapın' });
  req.user = user;
  next();
}

const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });

const isAdmin = (req) => req.user.role === 'admin';

module.exports = { hashPassword, verifyPassword, startSession, clearSessionCookie, getToken, auth, admin, isAdmin, isLocalRequest };
