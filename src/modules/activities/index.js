// Aktivite (efor) girişi. Kayıt şirkete bağlıdır, proje isteğe bağlıdır. Tutar = saat × günlük ücret / 8
const express = require('express');
const { all, run, tx } = require('../../db');
const { bad } = require('../../lib/http');
const { str, num, date, flag } = require('../../lib/validate');
const { auth, can, requirePerm } = require('../../lib/auth');
const { buildFilter, JOINS, NAMES, ownRecord, resolveTarget, targetUserId, editAll } = require('../../lib/records');
const { checkActivity } = require('../../lib/locks');
const { resolveRate } = require('../customers');
const audit = require('../../lib/audit');

const router = express.Router();

const HOURS_PER_DAY = 8;

function listActivities(req) {
  const f = buildFilter(req, 'a', 'activities');
  return all(`SELECT a.*, ${NAMES}, co.withholding, co.vat_exempt
              FROM activities a ${JOINS('a')} ${f.sql} ORDER BY a.date DESC, a.id DESC`, ...f.params);
}

router.get('/api/activities', auth, (req, res) => {
  const rows = listActivities(req);
  if (!can(req, 'rates.view')) rows.forEach((r) => delete r.daily_rate);
  res.json(rows);
});

function activityFields(req, existing) {
  const b = req.body;
  const { companyId, projectId } = resolveTarget(req, existing);
  const hours = num(b.hours, 'Süre');
  if (hours <= 0 || hours > 24) bad('Süre 0 ile 24 saat arasında olmalı');
  // Ücret ve para birimi kayda sabitlenir; şirket/proje değişirse yeniden belirlenir
  const same = existing && existing.company_id === companyId && existing.project_id === projectId;
  let { daily_rate: dailyRate, currency } = same ? existing : resolveRate(companyId, projectId);
  // Ücreti elle değiştirmek: ücretleri görme + tüm kayıtları düzenleme yetkisi
  if (can(req, 'rates.view') && editAll(req, 'activities') && b.daily_rate !== undefined && b.daily_rate !== '' && b.daily_rate !== null) dailyRate = num(b.daily_rate, 'Günlük ücret');
  const day = date(b.date);
  const userId = targetUserId(req, existing);
  checkActivity(req, userId, day);
  return [companyId, projectId, day, str(b.description, 'Açıklama'), hours, flag(b.billable), dailyRate, currency, userId];
}

router.post('/api/activities', auth, requirePerm('activities.edit'), (req, res) => {
  const values = activityFields(req);
  const id = tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO activities (company_id, project_id, date, description, hours, billable, daily_rate, currency, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values);
    audit.logCreate(req, 'activities', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/activities/:id', auth, (req, res) => {
  const before = ownRecord(req, 'activities', Number(req.params.id));
  checkActivity(req, before.user_id, before.date);
  const values = activityFields(req, before);
  tx(() => {
    run(`UPDATE activities SET company_id = ?, project_id = ?, date = ?, description = ?, hours = ?, billable = ?,
         daily_rate = ?, currency = ?, user_id = ? WHERE id = ?`, ...values, before.id);
    audit.logUpdate(req, 'activities', before);
  });
  res.json({ ok: true });
});

router.delete('/api/activities/:id', auth, (req, res) => {
  const before = ownRecord(req, 'activities', Number(req.params.id));
  checkActivity(req, before.user_id, before.date);
  tx(() => {
    run('DELETE FROM activities WHERE id = ?', before.id);
    audit.logDelete(req, 'activities', before);
  });
  res.json({ ok: true });
});

module.exports = { router, listActivities, HOURS_PER_DAY };
