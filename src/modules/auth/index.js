// İlk kurulum, giriş/çıkış ve kullanıcının kendi parolası
const express = require('express');
const { one, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str } = require('../../lib/validate');
const { hashPassword, verifyPassword, startSession, clearSessionCookie, getToken, auth } = require('../../lib/auth');
const { createLoginLimiter } = require('../../lib/security');
const audit = require('../../lib/audit');

const router = express.Router();
const limiter = createLoginLimiter();

const checkPassword = (pw) => { if (pw.length < 6) bad('Parola en az 6 karakter olmalı'); return pw; };

router.get('/api/setup', (req, res) => {
  res.json({ needsSetup: one('SELECT COUNT(*) n FROM users').n === 0 });
});

router.post('/api/setup', (req, res) => {
  const b = req.body;
  const userId = tx(() => {
    if (one('SELECT COUNT(*) n FROM users').n > 0) bad('Kurulum zaten tamamlanmış');
    const { lastInsertRowid } = run(
      `INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, 'admin')`,
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
