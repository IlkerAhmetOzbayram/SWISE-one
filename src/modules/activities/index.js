// Aktivite (efor) girişi. Tutar = saat × günlük ücret / 8
const express = require('express');
const { all, run, tx } = require('../../db');
const { bad } = require('../../lib/http');
const { str, num, date, flag } = require('../../lib/validate');
const { auth, isAdmin } = require('../../lib/auth');
const { buildFilter, JOINS, NAMES, ownRecord, checkProject, targetUserId } = require('../../lib/records');
const { resolveRate } = require('../customers');
const audit = require('../../lib/audit');

const router = express.Router();

const HOURS_PER_DAY = 8;

function listActivities(req) {
  const f = buildFilter(req, 'a');
  return all(`SELECT a.*, ${NAMES}, co.withholding, co.vat_exempt
              FROM activities a ${JOINS('a')} ${f.sql} ORDER BY a.date DESC, a.id DESC`, ...f.params);
}

router.get('/api/activities', auth, (req, res) => {
  const rows = listActivities(req);
  if (!isAdmin(req)) rows.forEach((r) => delete r.daily_rate);
  res.json(rows);
});

function activityFields(req, existing) {
  const b = req.body;
  const projectId = num(b.project_id, 'Proje');
  checkProject(req, projectId, existing?.project_id);
  const hours = num(b.hours, 'Süre');
  if (hours <= 0 || hours > 24) bad('Süre 0 ile 24 saat arasında olmalı');
  // Ücret ve para birimi kayda sabitlenir; proje değişirse yeniden belirlenir
  let { daily_rate: dailyRate, currency } = existing && existing.project_id === projectId ? existing : resolveRate(projectId);
  if (isAdmin(req) && b.daily_rate !== undefined && b.daily_rate !== '' && b.daily_rate !== null) dailyRate = num(b.daily_rate, 'Günlük ücret');
  return [projectId, date(b.date), str(b.description, 'Açıklama'), hours, flag(b.billable), dailyRate, currency, targetUserId(req, existing)];
}

router.post('/api/activities', auth, (req, res) => {
  const values = activityFields(req);
  const id = tx(() => {
    const { lastInsertRowid } = run(
      'INSERT INTO activities (project_id, date, description, hours, billable, daily_rate, currency, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
    run('UPDATE activities SET project_id = ?, date = ?, description = ?, hours = ?, billable = ?, daily_rate = ?, currency = ?, user_id = ? WHERE id = ?',
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

module.exports = { router, listActivities, HOURS_PER_DAY };
