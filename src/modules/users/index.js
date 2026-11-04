// Kullanıcı (ekip) yönetimi
const express = require('express');
const { all, run, tx } = require('../../db');
const { bad } = require('../../lib/http');
const { str, flag } = require('../../lib/validate');
const { auth, admin, isAdmin, hashPassword } = require('../../lib/auth');
const { checkPassword } = require('../auth');
const audit = require('../../lib/audit');

const router = express.Router();

router.get('/api/users', auth, (req, res) => {
  const cols = isAdmin(req) ? 'id, username, full_name, role, active' : 'id, full_name';
  res.json(all(`SELECT ${cols} FROM users ORDER BY full_name`));
});

// Not: users.hourly_rate artık müşteri ücretinde kullanılmıyor; Faz 3'te personel maliyetine dönüşecek
function userFields(b) {
  const role = b.role === 'admin' ? 'admin' : 'user';
  return [str(b.username, 'Kullanıcı adı').toLowerCase(), str(b.full_name, 'Ad soyad'), role];
}

router.post('/api/users', auth, admin, (req, res) => {
  const pw = checkPassword(str(req.body.password, 'Parola'));
  const id = tx(() => {
    const { lastInsertRowid } = run(
      'INSERT INTO users (username, full_name, role, password_hash) VALUES (?, ?, ?, ?)',
      ...userFields(req.body), hashPassword(pw));
    audit.logCreate(req, 'users', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/users/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  const before = audit.snapshot('users', id);
  if (!before) bad('Kullanıcı bulunamadı');
  const active = req.body.active === undefined ? 1 : flag(req.body.active);
  if (id === req.user.id && (!active || req.body.role !== 'admin')) bad('Kendi yönetici hesabınızı pasifleştiremez veya yetkisini düşüremezsiniz');
  tx(() => {
    run('UPDATE users SET username = ?, full_name = ?, role = ?, active = ? WHERE id = ?',
      ...userFields(req.body), active, id);
    audit.logUpdate(req, 'users', before);
    if (req.body.password) {
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(checkPassword(String(req.body.password))), id);
      run('DELETE FROM sessions WHERE user_id = ?', id);
      audit.record(req, 'password_reset', 'users', id);
    }
    if (!active) run('DELETE FROM sessions WHERE user_id = ?', id);
  });
  res.json({ ok: true });
});

module.exports = { router };
