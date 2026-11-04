// Müşteriler ve projeler
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { bad, HttpError } = require('../../lib/http');
const { str, num, flag } = require('../../lib/validate');
const { auth, admin, isAdmin } = require('../../lib/auth');
const audit = require('../../lib/audit');

const router = express.Router();

const existing = (table, id) => {
  const row = audit.snapshot(table, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı');
  return row;
};

// ---------- Müşteriler ----------
router.get('/api/clients', auth, (req, res) => {
  const cols = isAdmin(req) ? '*' : 'id, name, active';
  res.json(all(`SELECT ${cols} FROM clients ORDER BY name`));
});

const clientFields = (b) => [str(b.name, 'Müşteri adı'), str(b.tax_no, '', false), str(b.tax_office, '', false),
  str(b.address, '', false), num(b.default_rate, 'Varsayılan ücret', { required: false }), flag(b.withholding),
  b.active === undefined ? 1 : flag(b.active)];

router.post('/api/clients', auth, admin, (req, res) => {
  const id = tx(() => {
    const { lastInsertRowid } = run(
      'INSERT INTO clients (name, tax_no, tax_office, address, default_rate, withholding, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ...clientFields(req.body));
    audit.logCreate(req, 'clients', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/clients/:id', auth, admin, (req, res) => {
  const before = existing('clients', Number(req.params.id));
  tx(() => {
    run('UPDATE clients SET name = ?, tax_no = ?, tax_office = ?, address = ?, default_rate = ?, withholding = ?, active = ? WHERE id = ?',
      ...clientFields(req.body), before.id);
    audit.logUpdate(req, 'clients', before);
  });
  res.json({ ok: true });
});

// ---------- Projeler ----------
router.get('/api/projects', auth, (req, res) => {
  const cols = isAdmin(req) ? 'p.*' : 'p.id, p.client_id, p.name, p.active';
  res.json(all(`SELECT ${cols}, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY c.name, p.name`));
});

function projectFields(b) {
  const clientId = num(b.client_id, 'Müşteri');
  if (!one('SELECT id FROM clients WHERE id = ?', clientId)) bad('Müşteri bulunamadı');
  return [clientId, str(b.name, 'Proje adı'), num(b.hourly_rate, 'Saatlik ücret', { required: false }),
    b.active === undefined ? 1 : flag(b.active)];
}

router.post('/api/projects', auth, admin, (req, res) => {
  const id = tx(() => {
    const { lastInsertRowid } = run('INSERT INTO projects (client_id, name, hourly_rate, active) VALUES (?, ?, ?, ?)',
      ...projectFields(req.body));
    audit.logCreate(req, 'projects', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/projects/:id', auth, admin, (req, res) => {
  const before = existing('projects', Number(req.params.id));
  tx(() => {
    run('UPDATE projects SET client_id = ?, name = ?, hourly_rate = ?, active = ? WHERE id = ?',
      ...projectFields(req.body), before.id);
    audit.logUpdate(req, 'projects', before);
  });
  res.json({ ok: true });
});

// Ücret önceliği: proje ücreti → müşteri varsayılanı → kullanıcı ücreti
function resolveRate(projectId, userId) {
  const r = one(`SELECT p.hourly_rate pr, c.default_rate cr, (SELECT hourly_rate FROM users WHERE id = ?) ur
                 FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?`, userId, projectId);
  if (!r) bad('Proje bulunamadı');
  return r.pr ?? r.cr ?? r.ur ?? 0;
}

module.exports = { router, resolveRate };
