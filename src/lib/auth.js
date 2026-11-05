// Parola, oturum ve yetki kontrolü
const crypto = require('crypto');
const config = require('../config');
const { one, run } = require('../db');
const { fullPermissions } = require('./permissions');

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

const USER_SQL = `SELECT u.id, u.username, u.full_name, u.role_id, r.name role_name, r.locked role_locked, r.permissions
  FROM users u LEFT JOIN roles r ON r.id = u.role_id`;

// Kullanıcı + rol yetkileri. Kilitli rol (Yönetici) katalogdaki tüm yetkileri alır.
function withPermissions(row) {
  if (!row) return null;
  const { permissions, role_locked: locked, ...user } = row;
  return { ...user, perms: locked ? fullPermissions() : JSON.parse(permissions || '{}') };
}

const loadUser = (id) => withPermissions(one(`${USER_SQL} WHERE u.id = ?`, id));

// Girişsiz modda kayıtlar ilk aktif Yönetici adına girilir; yoksa "Yerel Yönetici" oluşturulur
function devUser() {
  const sql = `${USER_SQL} WHERE r.locked = 1 AND u.active = 1 ORDER BY u.id LIMIT 1`;
  let row = one(sql);
  if (!row) {
    const roleId = one('SELECT id FROM roles WHERE locked = 1 ORDER BY id LIMIT 1').id;
    run(`INSERT INTO users (username, full_name, password_hash, role, role_id) VALUES ('yerel', 'Yerel Yönetici', ?, 'admin', ?)`,
      hashPassword(crypto.randomBytes(24).toString('hex')), roleId);
    row = one(sql);
  }
  return { ...withPermissions(row), no_login: true };
}

function auth(req, res, next) {
  const token = getToken(req);
  const session = token && one(`SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id
                                 WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`, token, Date.now());
  let user = session ? loadUser(session.user_id) : null;
  if (!user && config.noLogin && isLocalRequest(req)) user = devUser();
  if (!user) return res.status(401).json({ error: 'Lütfen giriş yapın' });
  req.user = user;
  next();
}

// can(req, 'reports.view') → yetki değeri (true / 'own' / 'assigned' / 'all') ya da undefined
const can = (req, key) => req.user.perms[key];

// Belirtilen yetkilerden en az biri varsa geçer
const requirePerm = (...keys) => (req, res, next) =>
  (keys.some((k) => can(req, k)) ? next() : res.status(403).json({ error: 'Bu işlem için yetkiniz yok' }));

module.exports = {
  hashPassword, verifyPassword, startSession, clearSessionCookie, getToken, auth, can, requirePerm, isLocalRequest, loadUser,
};
