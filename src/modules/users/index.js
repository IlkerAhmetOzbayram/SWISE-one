// Personel: genel bilgiler, hesap ve rol, hassas bilgiler (IBAN, acil durum kişisi), maaş geçmişi.
// Hassas bilgilerin görüntülenmesi de işlem kaydına yazılır (KVKK).
const crypto = require('crypto');
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str, num, date, flag, currency, email } = require('../../lib/validate');
const { auth, can, requirePerm, hashPassword } = require('../../lib/auth');
const { checkPassword } = require('../auth');
const { getSettings } = require('../settings');
const { createPasswordLink } = require('../../lib/password-links');
const audit = require('../../lib/audit');

const router = express.Router();
const EMPLOYMENT = ['full_time', 'part_time', 'freelance', 'intern'];

const GENERAL = `u.id, u.username, u.full_name, u.title, u.department, u.email, u.phone, u.start_date, u.end_date,
  u.employment_type, u.active, u.role_id, r.name role_name`;

// Herkes seçim listeleri için ad listesini görür; ayrıntılar "personeli görme" yetkisiyle
router.get('/api/users', auth, (req, res) => {
  const cols = can(req, 'personnel.view') ? GENERAL : 'u.id, u.full_name, u.active';
  res.json(all(`SELECT ${cols} FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`));
});

const self = (req, id) => req.user.id === id;
function findUser(id) {
  const u = one(`SELECT ${GENERAL} FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, id);
  if (!u) throw new HttpError(404, 'Personel bulunamadı');
  return u;
}

// Kişi kendi kartını her zaman görür
router.get('/api/personnel/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!self(req, id) && !can(req, 'personnel.view')) throw new HttpError(403, 'Bu işlem için yetkiniz yok');
  res.json(findUser(id));
});

function generalFields(b) {
  const type = EMPLOYMENT.includes(b.employment_type) ? b.employment_type : 'full_time';
  const start = b.start_date ? date(b.start_date, 'İşe giriş tarihi') : null;
  const end = b.end_date ? date(b.end_date, 'Çıkış tarihi') : null;
  if (start && end && end < start) bad('Çıkış tarihi işe giriş tarihinden önce olamaz');
  return [str(b.username, 'Kullanıcı adı').toLowerCase(), str(b.full_name, 'Ad soyad'), str(b.title, '', false),
    str(b.department, '', false), email(b.email), str(b.phone, '', false), start, end, type];
}

// Rol yalnızca "roller" yetkisiyle atanır; yoksa yeni personel Çalışan olur
function roleFor(req, b, current) {
  if (!can(req, 'roles.edit') || !b.role_id) return current ?? one("SELECT id FROM roles WHERE name = 'Çalışan'")?.id ?? null;
  const role = one('SELECT id FROM roles WHERE id = ?', Number(b.role_id));
  if (!role) bad('Rol bulunamadı');
  return role.id;
}

// En az bir aktif Yönetici kalmalı
function keepOneAdmin(excludeId) {
  const n = one(`SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.locked = 1 AND u.active = 1 AND u.id != ?`, excludeId).n;
  if (n === 0) bad('En az bir aktif Yönetici kalmalı');
}

// Yönetici hesabının parolasına yalnızca bir Yönetici dokunabilir
const isLockedRole = (roleId) => !!one('SELECT locked FROM roles WHERE id = ?', roleId)?.locked;
function guardAdminCredentials(req, roleId) {
  if (isLockedRole(roleId) && !isLockedRole(req.user.role_id)) throw new HttpError(403, 'Yönetici hesabının parolasını yalnızca bir Yönetici değiştirebilir');
}

// Parola girilmezse kişi davet bağlantısıyla kendi parolasını belirler
router.post('/api/users', auth, requirePerm('personnel.edit'), (req, res) => {
  const pw = req.body.password ? checkPassword(String(req.body.password)) : null;
  const fields = generalFields(req.body);
  const roleId = roleFor(req, req.body);
  const result = tx(() => {
    const { lastInsertRowid } = run(`INSERT INTO users (username, full_name, title, department, email, phone, start_date, end_date,
      employment_type, role_id, password_hash, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...fields, roleId, hashPassword(pw ?? crypto.randomBytes(24).toString('hex')), req.body.active === undefined ? 1 : flag(req.body.active));
    const id = Number(lastInsertRowid);
    audit.logCreate(req, 'users', id);
    if (pw) return { id };
    audit.record(req, 'invite', 'users', id);
    return { id, link: createPasswordLink(id, 'invite', req.user.id, req) };
  });
  res.json(result);
});

// Davet (henüz hiç giriş yapmamışsa) ya da parola sıfırlama bağlantısı
router.post('/api/users/:id/password-link', auth, requirePerm('personnel.edit'), (req, res) => {
  const id = Number(req.params.id);
  const u = findUser(id);
  if (!u.active) bad('Pasif personele bağlantı gönderilemez');
  guardAdminCredentials(req, u.role_id);
  const everLoggedIn = one(`SELECT 1 FROM audit_log WHERE entity = 'users' AND entity_id = ?
    AND action IN ('login', 'invite_accepted', 'password_reset', 'setup', 'admin_grant') LIMIT 1`, id);
  const purpose = everLoggedIn ? 'reset' : 'invite';
  const link = tx(() => {
    audit.record(req, purpose === 'invite' ? 'invite' : 'password_link', 'users', id);
    return createPasswordLink(id, purpose, req.user.id, req);
  });
  res.json(link);
});

router.put('/api/users/:id', auth, requirePerm('personnel.edit'), (req, res) => {
  const id = Number(req.params.id);
  const before = audit.snapshot('users', id);
  if (!before) throw new HttpError(404, 'Personel bulunamadı');
  const fields = generalFields(req.body);
  const active = req.body.active === undefined ? before.active : flag(req.body.active);
  const roleId = roleFor(req, req.body, before.role_id);
  const lockedRole = (rid) => !!one('SELECT locked FROM roles WHERE id = ?', rid)?.locked;
  if (self(req, id) && !active) bad('Kendi hesabınızı pasifleştiremezsiniz');
  if (lockedRole(before.role_id) && (!active || !lockedRole(roleId))) keepOneAdmin(id);
  if (self(req, id) && roleId !== before.role_id) bad('Kendi rolünüzü değiştiremezsiniz');
  tx(() => {
    run(`UPDATE users SET username = ?, full_name = ?, title = ?, department = ?, email = ?, phone = ?, start_date = ?, end_date = ?,
         employment_type = ?, role_id = ?, active = ? WHERE id = ?`, ...fields, roleId, active, id);
    audit.logUpdate(req, 'users', before);
    if (req.body.password) {
      guardAdminCredentials(req, before.role_id);
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(checkPassword(String(req.body.password))), id);
      run('DELETE FROM sessions WHERE user_id = ?', id);
      audit.record(req, 'password_reset', 'users', id);
    }
    if (!active) run('DELETE FROM sessions WHERE user_id = ?', id);
  });
  res.json({ ok: true });
});

// Kişinin tüm cihazlardaki oturumlarını kapatır
router.post('/api/users/:id/logout-all', auth, requirePerm('personnel.edit'), (req, res) => {
  const id = Number(req.params.id);
  findUser(id);
  const { changes } = run('DELETE FROM sessions WHERE user_id = ?', id);
  audit.record(req, 'logout_all', 'users', id, { sessions: changes });
  res.json({ closed: changes });
});

// ---------- Hassas bilgiler ve maaş ----------
const sensitiveOf = (id) => one('SELECT * FROM personnel_sensitive WHERE user_id = ?', id)
  || { user_id: id, iban: '', emergency_name: '', emergency_relation: '', emergency_phone: '', anonymized_at: null };
const salariesOf = (id) => all('SELECT * FROM salaries WHERE user_id = ? ORDER BY effective_date DESC, id DESC', id);

// Yetkili veya kişinin kendisi görebilir; kişi kendi maaşını yalnızca ayar açıksa görür.
// Başkasının bilgisine her bakış işlem kaydına yazılır.
router.get('/api/personnel/:id/sensitive', auth, (req, res) => {
  const id = Number(req.params.id);
  const mine = self(req, id);
  if (!mine && !can(req, 'salary.view')) throw new HttpError(403, 'Bu bilgileri görme yetkiniz yok');
  findUser(id);
  const showSalary = can(req, 'salary.view') || getSettings().show_own_salary === '1';
  if (!mine) audit.record(req, 'sensitive_view', 'users', id);
  res.json({ ...sensitiveOf(id), salaries: showSalary ? salariesOf(id) : null });
});

// IBAN: boşluklar atılır, 2 harf + 2 rakam + en fazla 30 harf/rakam; TR IBAN 26 karakter olmalı
function iban(v) {
  const s = str(v, 'IBAN', false).replace(/\s+/g, '').toUpperCase();
  if (!s) return '';
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) bad('IBAN geçersiz');
  if (s.startsWith('TR') && s.length !== 26) bad('TR IBAN 26 karakter olmalı');
  return s;
}

router.put('/api/personnel/:id/sensitive', auth, requirePerm('salary.edit'), (req, res) => {
  const id = Number(req.params.id);
  findUser(id);
  const b = req.body;
  const before = sensitiveOf(id);
  const next = { iban: iban(b.iban), emergency_name: str(b.emergency_name, '', false),
    emergency_relation: str(b.emergency_relation, '', false), emergency_phone: str(b.emergency_phone, '', false) };
  tx(() => {
    run(`INSERT INTO personnel_sensitive (user_id, iban, emergency_name, emergency_relation, emergency_phone) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET iban = excluded.iban, emergency_name = excluded.emergency_name,
         emergency_relation = excluded.emergency_relation, emergency_phone = excluded.emergency_phone`,
    id, next.iban, next.emergency_name, next.emergency_relation, next.emergency_phone);
    // İşlem kaydına değerler değil, yalnızca değişen alan adları yazılır
    const changed = Object.keys(next).filter((k) => before[k] !== next[k]);
    if (changed.length) audit.record(req, 'update', 'personnel_sensitive', id, { changed_fields: changed });
  });
  res.json({ ok: true });
});

function salaryFields(b) {
  const gross = num(b.gross, 'Brüt maaş', { required: false });
  const net = num(b.net, 'Net maaş', { required: false });
  if (gross === null && net === null) bad('Brüt veya net maaştan en az biri girilmeli');
  return [date(b.effective_date, 'Geçerlilik tarihi'), gross, net, currency(b.currency || 'TRY'), str(b.notes, '', false)];
}
const salaryAudit = (row) => ({ effective_date: row.effective_date, currency: row.currency, tutar: 'gizli' });

router.post('/api/personnel/:id/salaries', auth, requirePerm('salary.edit'), (req, res) => {
  const userId = Number(req.params.id);
  findUser(userId);
  const values = salaryFields(req.body);
  const id = tx(() => {
    const { lastInsertRowid } = run('INSERT INTO salaries (user_id, effective_date, gross, net, currency, notes) VALUES (?, ?, ?, ?, ?, ?)',
      userId, ...values);
    audit.record(req, 'create', 'salaries', Number(lastInsertRowid), { user_id: userId, ...salaryAudit({ effective_date: values[0], currency: values[3] }) });
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/salaries/:id', auth, requirePerm('salary.edit'), (req, res) => {
  const before = one('SELECT * FROM salaries WHERE id = ?', Number(req.params.id));
  if (!before) throw new HttpError(404, 'Kayıt bulunamadı');
  const values = salaryFields(req.body);
  tx(() => {
    run('UPDATE salaries SET effective_date = ?, gross = ?, net = ?, currency = ?, notes = ? WHERE id = ?', ...values, before.id);
    audit.record(req, 'update', 'salaries', before.id, { user_id: before.user_id, ...salaryAudit(before) });
  });
  res.json({ ok: true });
});

router.delete('/api/salaries/:id', auth, requirePerm('salary.edit'), (req, res) => {
  const before = one('SELECT * FROM salaries WHERE id = ?', Number(req.params.id));
  if (!before) throw new HttpError(404, 'Kayıt bulunamadı');
  tx(() => {
    run('DELETE FROM salaries WHERE id = ?', before.id);
    audit.record(req, 'delete', 'salaries', before.id, { user_id: before.user_id, ...salaryAudit(before) });
  });
  res.json({ ok: true });
});

// KVKK: ayrılmış ve pasif personelin iletişim ve hassas bilgileri silinir.
// Maaş geçmişi yasal saklama süresi nedeniyle korunur.
router.post('/api/personnel/:id/anonymize', auth, requirePerm('salary.edit'), requirePerm('personnel.edit'), (req, res) => {
  const id = Number(req.params.id);
  const u = findUser(id);
  if (u.active || !u.end_date) bad('Yalnızca çıkış tarihi girilmiş ve pasif personel anonimleştirilebilir');
  tx(() => {
    run(`INSERT INTO personnel_sensitive (user_id, anonymized_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
         ON CONFLICT(user_id) DO UPDATE SET iban = '', emergency_name = '', emergency_relation = '', emergency_phone = '',
         anonymized_at = excluded.anonymized_at`, id);
    run("UPDATE users SET email = '', phone = '' WHERE id = ?", id);
    audit.record(req, 'anonymize', 'users', id);
  });
  res.json({ ok: true });
});

module.exports = { router };
