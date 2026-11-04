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

function auth(req, res, next) {
  const token = getToken(req);
  const user = token && one(
    `SELECT u.id, u.username, u.full_name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`, token, Date.now());
  if (!user) return res.status(401).json({ error: 'Lütfen giriş yapın' });
  req.user = user;
  next();
}

const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });

const isAdmin = (req) => req.user.role === 'admin';

module.exports = { hashPassword, verifyPassword, startSession, clearSessionCookie, getToken, auth, admin, isAdmin };
