// Tek kullanımlık parola belirleme bağlantıları (davet ve sıfırlama).
// Anahtar yalnızca bağlantıda bulunur; veritabanında SHA-256 özeti tutulur.
const crypto = require('crypto');
const config = require('../config');
const { one, run } = require('../db');

const VALID_HOURS = { invite: 7 * 24, reset: 24 };

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Dış adres: PUBLIC_URL; yoksa (yalnızca geliştirmede) isteğin geldiği adres
function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  return req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${config.port}`;
}

// Kişinin kullanılmamış eski bağlantıları geçersiz olur; yeni bağlantı döner
function createPasswordLink(userId, purpose, createdBy, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + VALID_HOURS[purpose] * 3600e3;
  run('DELETE FROM password_links WHERE user_id = ? AND used_at IS NULL', userId);
  run('INSERT INTO password_links (token_hash, user_id, purpose, expires_at, created_by) VALUES (?, ?, ?, ?, ?)',
    hashToken(token), userId, purpose, expiresAt, createdBy ?? null);
  return { url: `${baseUrl(req)}/#/parola/${token}`, purpose, expires_at: new Date(expiresAt).toISOString() };
}

// Geçerli (kullanılmamış, süresi dolmamış, kişi aktif) bağlantı kaydı ya da null
function findPasswordLink(token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token || '')) return null;
  return one(`SELECT l.id, l.user_id, l.purpose, u.username, u.full_name FROM password_links l JOIN users u ON u.id = l.user_id
              WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ? AND u.active = 1`, hashToken(token), Date.now()) || null;
}

const markUsed = (id) => run('UPDATE password_links SET used_at = ? WHERE id = ?', Date.now(), id);

module.exports = { createPasswordLink, findPasswordLink, markUsed, VALID_HOURS };
