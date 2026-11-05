// Roller ve yetki matrisi. Yönetici rolü kilitlidir (tüm yetkiler, değiştirilemez).
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str } = require('../../lib/validate');
const { auth, can, requirePerm } = require('../../lib/auth');
const { CATALOG, ACTION_LABELS, SCOPE_LABELS, fullPermissions, normalize } = require('../../lib/permissions');
const audit = require('../../lib/audit');

const router = express.Router();

const list = () => all(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.active = 1) user_count
                        FROM roles r ORDER BY r.system DESC, r.id`)
  .map((r) => ({ ...r, permissions: r.locked ? fullPermissions() : JSON.parse(r.permissions) }));

router.get('/api/roles', auth, (req, res) => {
  if (!can(req, 'roles.edit') && !can(req, 'personnel.view')) throw new HttpError(403, 'Bu işlem için yetkiniz yok');
  res.json(list());
});

router.get('/api/roles/catalog', auth, (req, res) => res.json({ catalog: CATALOG, action_labels: ACTION_LABELS, scope_labels: SCOPE_LABELS }));

const findRole = (id) => {
  const r = one('SELECT * FROM roles WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Rol bulunamadı');
  return r;
};

router.post('/api/roles', auth, requirePerm('roles.edit'), (req, res) => {
  const b = req.body;
  // Mevcut bir rolden kopyalanabilir
  const base = b.copy_from ? list().find((r) => r.id === Number(b.copy_from))?.permissions : b.permissions;
  try {
    const id = tx(() => {
      const { lastInsertRowid } = run('INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)',
        str(b.name, 'Rol adı'), str(b.description, '', false), JSON.stringify(normalize(base || {})));
      audit.logCreate(req, 'roles', Number(lastInsertRowid));
      return Number(lastInsertRowid);
    });
    res.json({ id });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) bad('Bu adda bir rol zaten var');
    throw err;
  }
});

router.put('/api/roles/:id', auth, requirePerm('roles.edit'), (req, res) => {
  const before = findRole(Number(req.params.id));
  if (before.locked) bad('Yönetici rolü değiştirilemez');
  const perms = normalize(req.body.permissions);
  // Kişi kendi rolünden roller yetkisini kaldıramaz (kendini kilitlememesi için)
  if (req.user.role_id === before.id && !perms['roles.edit']) bad('Kendi rolünüzden "Roller ve yetkiler" yetkisini kaldıramazsınız');
  try {
    tx(() => {
      run('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?',
        before.system ? before.name : str(req.body.name, 'Rol adı'), str(req.body.description, '', false), JSON.stringify(perms), before.id);
      audit.logUpdate(req, 'roles', before);
    });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) bad('Bu adda bir rol zaten var');
    throw err;
  }
  res.json({ ok: true });
});

router.delete('/api/roles/:id', auth, requirePerm('roles.edit'), (req, res) => {
  const before = findRole(Number(req.params.id));
  if (before.system) bad('Hazır roller silinemez');
  if (one('SELECT COUNT(*) n FROM users WHERE role_id = ?', before.id).n) bad('Bu role atanmış personel var; önce başka role taşıyın');
  tx(() => {
    run('DELETE FROM roles WHERE id = ?', before.id);
    audit.logDelete(req, 'roles', before);
  });
  res.json({ ok: true });
});

module.exports = { router };
