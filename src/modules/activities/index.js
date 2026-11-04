// Aktivite (efor) girişi
const express = require('express');
const { all, run, tx } = require('../../db');
const { bad } = require('../../lib/http');
const { str, num, date, flag } = require('../../lib/validate');
const { auth, isAdmin } = require('../../lib/auth');
const { buildFilter, JOINS, ownRecord, checkProject, targetUserId } = require('../../lib/records');
const { resolveRate } = require('../clients');
const audit = require('../../lib/audit');

const router = express.Router();

function listActivities(req) {
  const f = buildFilter(req, 'a');
  return all(`SELECT a.*, p.name project_name, c.id client_id, c.name client_name, c.withholding, u.full_name user_name
              FROM activities a ${JOINS('a')} ${f.sql} ORDER BY a.date DESC, a.id DESC`, ...f.params);
}

router.get('/api/activities', auth, (req, res) => {
  const rows = listActivities(req);
  if (!isAdmin(req)) rows.forEach((r) => delete r.rate);
  res.json(rows);
});

function activityFields(req, existing) {
  const b = req.body;
  const projectId = num(b.project_id, 'Proje');
  checkProject(req, projectId, existing?.project_id);
  const hours = num(b.hours, 'Süre');
  if (hours <= 0 || hours > 24) bad('Süre 0 ile 24 saat arasında olmalı');
  const userId = targetUserId(req, existing);
  // Ücret kayda sabitlenir; yönetici elle değiştirebilir
  let rate;
  if (isAdmin(req) && b.rate !== undefined && b.rate !== '' && b.rate !== null) rate = num(b.rate, 'Ücret');
  else if (existing && existing.project_id === projectId && existing.user_id === userId) rate = existing.rate;
  else rate = resolveRate(projectId, userId);
  return [projectId, date(b.date), str(b.description, 'Açıklama'), hours, flag(b.billable), rate, userId];
}

router.post('/api/activities', auth, (req, res) => {
  const values = activityFields(req);
  const id = tx(() => {
    const { lastInsertRowid } = run(
      'INSERT INTO activities (project_id, date, description, hours, billable, rate, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ...values);
    audit.logCreate(req, 'activities', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/activities/:id', auth, (req, res) => {
  const before = ownRecord(req, 'activities', Number(req.params.id));
  const values = activityFields(req, before);
  tx(() => {
    run('UPDATE activities SET project_id = ?, date = ?, description = ?, hours = ?, billable = ?, rate = ?, user_id = ? WHERE id = ?',
      ...values, before.id);
    audit.logUpdate(req, 'activities', before);
  });
  res.json({ ok: true });
});

router.delete('/api/activities/:id', auth, (req, res) => {
  const before = ownRecord(req, 'activities', Number(req.params.id));
  tx(() => {
    run('DELETE FROM activities WHERE id = ?', before.id);
    audit.logDelete(req, 'activities', before);
  });
  res.json({ ok: true });
});

module.exports = { router, listActivities };
