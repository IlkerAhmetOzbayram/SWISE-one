// İlk kurulum, giriş/çıkış ve kullanıcının kendi parolası
const express = require('express');
const { one, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str } = require('../../lib/validate');
const { hashPassword, verifyPassword, startSession, clearSessionCookie, getToken, auth } = require('../../lib/auth');
const { createLoginLimiter } = require('../../lib/security');
const { findPasswordLink, markUsed } = require('../../lib/password-links');
const config = require('../../config');
const audit = require('../../lib/audit');

const router = express.Router();
const limiter = createLoginLimiter();

const MIN_PASSWORD = 8;
const checkPassword = (pw) => { if (pw.length < MIN_PASSWORD) bad(`Parola en az ${MIN_PASSWORD} karakter olmalı`); return pw; };

// Canlıda ilk yönetici web'den oluşturulamaz (adrese ilk ulaşan kişi yönetici olmasın);
// sunucuda "sudo swise-one yonetici-olustur" (geliştirmede "npm run yonetici-olustur") kullanılır.
router.get('/api/setup', (req, res) => {
  res.json({ needsSetup: one('SELECT COUNT(*) n FROM users').n === 0, webSetup: !config.production });
});

router.post('/api/setup', (req, res) => {
  if (config.production) throw new HttpError(403, 'İlk yönetici sunucuda "sudo swise-one yonetici-olustur" komutuyla oluşturulur');
  const b = req.body;
  const userId = tx(() => {
    if (one('SELECT COUNT(*) n FROM users').n > 0) bad('Kurulum zaten tamamlanmış');
    const { lastInsertRowid } = run(
      `INSERT INTO users (username, full_name, password_hash, role, role_id)
       VALUES (?, ?, ?, 'admin', (SELECT id FROM roles WHERE locked = 1 ORDER BY id LIMIT 1))`,
      str(b.username, 'Kullanıcı adı').toLowerCase(), str(b.full_name, 'Ad soyad'),
      hashPassword(checkPassword(str(b.password, 'Parola'))));
    const id = Number(lastInsertRowid);
    if (b.company_name) run(`UPDATE settings SET value = ? WHERE key = 'company_name'`, str(b.company_name, 'Şirket adı'));
    audit.record(req, 'setup', 'users', id, { username: b.username }, id);
    return id;
  });
  startSession(res, userId);
  res.json({ ok: true });
});

router.post('/api/login', (req, res) => {
  const username = str(req.body.username, 'Kullanıcı adı').toLowerCase();
  const password = str(req.body.password, 'Parola');
  limiter.check(req, username);
  const u = one('SELECT * FROM users WHERE username = ? AND active = 1', username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    limiter.fail(req, username);
    audit.record(req, 'login_failed', 'users', u?.id ?? null, { username }, null);
    throw new HttpError(401, 'Kullanıcı adı veya parola hatalı');
  }
  limiter.success(req, username);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  startSession(res, u.id);
  audit.record(req, 'login', 'users', u.id, {}, u.id);
  res.json({ ok: true });
});

// Davet / parola sıfırlama bağlantısı: kişi kendi parolasını belirler ve giriş yapar
router.get('/api/password-link/:token', (req, res) => {
  const link = findPasswordLink(req.params.token);
  if (!link) throw new HttpError(404, 'Bağlantı geçersiz veya süresi dolmuş. Yöneticinizden yeni bağlantı isteyin.');
  res.json({ purpose: link.purpose, username: link.username, full_name: link.full_name });
});

router.post('/api/password-link/:token', (req, res) => {
  limiter.check(req, 'parola-baglantisi');
  const link = findPasswordLink(req.params.token);
  if (!link) {
    limiter.fail(req, 'parola-baglantisi');
    throw new HttpError(404, 'Bağlantı geçersiz veya süresi dolmuş. Yöneticinizden yeni bağlantı isteyin.');
  }
  const hash = hashPassword(checkPassword(str(req.body.password, 'Parola')));
  tx(() => {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hash, link.user_id);
    run('DELETE FROM sessions WHERE user_id = ?', link.user_id);
    markUsed(link.id);
    audit.record(req, link.purpose === 'invite' ? 'invite_accepted' : 'password_reset', 'users', link.user_id, { kaynak: 'bağlantı' }, link.user_id);
  });
  startSession(res, link.user_id);
  res.json({ ok: true });
});

router.post('/api/logout', (req, res) => {
  const token = getToken(req);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/api/me', auth, (req, res) => res.json(req.user));

router.put('/api/me/password', auth, (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(str(req.body.current, 'Mevcut parola'), u.password_hash)) bad('Mevcut parola hatalı');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(checkPassword(str(req.body.password, 'Yeni parola'))), u.id);
  // Diğer cihazlardaki oturumlar kapatılır
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', u.id, getToken(req));
  audit.record(req, 'password_change', 'users', u.id);
  res.json({ ok: true });
});

module.exports = { router, checkPassword };
