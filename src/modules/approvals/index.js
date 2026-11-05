// Haftalık efor onayı ve ay kapanışı.
//   Hafta: taslak (kayıt yok) → onaya gönderildi → onaylandı / geri gönderildi
//   Ay: kapatılınca o ayın aktivite ve masrafları kimse tarafından değiştirilemez
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str, date, r2 } = require('../../lib/validate');
const { auth, can, requirePerm } = require('../../lib/auth');
const { weekStartOf, checkMonth } = require('../../lib/locks');
const { monthRange, isoDay } = require('../../lib/workdays');
const audit = require('../../lib/audit');

const router = express.Router();

const monday = (v) => {
  const d = date(v, 'Hafta');
  if (weekStartOf(d) !== d) bad('Hafta başlangıcı Pazartesi olmalı');
  return d;
};
const weekEnd = (start) => { const d = new Date(`${start}T00:00:00`); d.setDate(d.getDate() + 6); return isoDay(d); };
const weekHours = (userId, start) => one(`SELECT COALESCE(SUM(hours), 0) hours, COALESCE(SUM(CASE WHEN billable = 1 THEN hours END), 0) billable
  FROM activities WHERE user_id = ? AND date BETWEEN ? AND ?`, userId, start, weekEnd(start));

// Başkasının haftasını görmek: onay yetkisi veya tüm aktiviteleri görme yetkisi
function canSeeUser(req, userId) {
  return userId === req.user.id || can(req, 'activities.approve') || can(req, 'activities.view') === 'all';
}

router.get('/api/timesheets/week', auth, (req, res) => {
  const start = monday(req.query.week_start);
  const userId = req.query.user_id ? Number(req.query.user_id) : req.user.id;
  if (!canSeeUser(req, userId)) throw new HttpError(403, 'Bu işlem için yetkiniz yok');
  const ts = one(`SELECT t.*, rv.full_name reviewer_name FROM timesheets t LEFT JOIN users rv ON rv.id = t.reviewed_by
                  WHERE t.user_id = ? AND t.week_start = ?`, userId, start);
  const closed = !!one('SELECT 1 FROM period_closures WHERE month = ? OR month = ?', start.slice(0, 7), weekEnd(start).slice(0, 7));
  res.json({ user_id: userId, week_start: start, status: ts?.status || 'draft', timesheet: ts || null, month_closed: closed, ...weekHours(userId, start) });
});

// Kişi kendi haftasını onaya gönderir (geri gönderilmiş hafta yeniden gönderilebilir)
router.post('/api/timesheets/submit', auth, requirePerm('activities.edit'), (req, res) => {
  const start = monday(req.body.week_start);
  checkMonth(start);
  const ts = one('SELECT * FROM timesheets WHERE user_id = ? AND week_start = ?', req.user.id, start);
  if (ts?.status === 'approved') bad('Bu hafta zaten onaylandı');
  if (ts?.status === 'submitted') bad('Bu hafta zaten onaya gönderildi');
  tx(() => {
    run(`INSERT INTO timesheets (user_id, week_start, status, submitted_at, note) VALUES (?, ?, 'submitted', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), '')
         ON CONFLICT(user_id, week_start) DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at,
         reviewed_by = NULL, reviewed_at = NULL, note = ''`, req.user.id, start);
    audit.record(req, 'submit', 'timesheets', null, { week_start: start });
  });
  res.json({ ok: true });
});

// Gönderilmiş ama henüz onaylanmamış haftayı geri çeker
router.post('/api/timesheets/withdraw', auth, (req, res) => {
  const start = monday(req.body.week_start);
  const ts = one("SELECT * FROM timesheets WHERE user_id = ? AND week_start = ? AND status = 'submitted'", req.user.id, start);
  if (!ts) bad('Geri çekilecek gönderim yok');
  tx(() => {
    run('DELETE FROM timesheets WHERE id = ?', ts.id);
    audit.record(req, 'withdraw', 'timesheets', ts.id, { week_start: start });
  });
  res.json({ ok: true });
});

// Onay bekleyen haftalar. "Sorumlu olduğu" kapsamındaki onaylayan yalnızca kendi müşterilerine efor girilmiş haftaları görür.
router.get('/api/timesheets/pending', auth, requirePerm('activities.approve'), (req, res) => {
  const assigned = can(req, 'activities.view') !== 'all';
  const rows = all(`SELECT t.*, u.full_name user_name FROM timesheets t JOIN users u ON u.id = t.user_id
    WHERE t.status = 'submitted' ${assigned ? `AND EXISTS (SELECT 1 FROM activities a JOIN companies co ON co.id = a.company_id
      JOIN customers cu ON cu.id = co.customer_id WHERE a.user_id = t.user_id AND a.date BETWEEN t.week_start AND date(t.week_start, '+6 day')
      AND cu.manager_id = ?)` : ''} ORDER BY t.week_start, u.full_name`, ...(assigned ? [req.user.id] : []));
  res.json(rows.map((r) => ({ ...r, ...weekHours(r.user_id, r.week_start) })));
});

const findTimesheet = (id) => {
  const ts = one('SELECT * FROM timesheets WHERE id = ?', id);
  if (!ts) throw new HttpError(404, 'Kayıt bulunamadı');
  return ts;
};

router.post('/api/timesheets/:id/review', auth, requirePerm('activities.approve'), (req, res) => {
  const ts = findTimesheet(Number(req.params.id));
  const decision = req.body.decision;
  if (!['approved', 'rejected'].includes(decision)) bad('Karar geçersiz');
  if (ts.status !== 'submitted') bad('Yalnızca onaya gönderilmiş haftalar değerlendirilebilir');
  const note = str(req.body.note, 'Gerekçe', decision === 'rejected');
  checkMonth(ts.week_start);
  tx(() => {
    run(`UPDATE timesheets SET status = ?, reviewed_by = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), note = ? WHERE id = ?`,
      decision, req.user.id, note, ts.id);
    audit.record(req, decision === 'approved' ? 'approve' : 'reject', 'timesheets', ts.id, { week_start: ts.week_start, user_id: ts.user_id, ...(note ? { note } : {}) });
  });
  res.json({ ok: true });
});

// Onaylanmış haftayı yeniden düzenlemeye açar
router.post('/api/timesheets/:id/reopen', auth, requirePerm('activities.approve'), (req, res) => {
  const ts = findTimesheet(Number(req.params.id));
  checkMonth(ts.week_start);
  tx(() => {
    run('DELETE FROM timesheets WHERE id = ?', ts.id);
    audit.record(req, 'reopen', 'timesheets', ts.id, { week_start: ts.week_start, user_id: ts.user_id });
  });
  res.json({ ok: true });
});

// ---------- Ay kapanışı ----------
const month = (v) => {
  const s = str(v, 'Ay');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) bad('Ay geçersiz');
  return s;
};

router.get('/api/periods', auth, (req, res) => {
  res.json(all(`SELECT pc.*, u.full_name closed_by_name FROM period_closures pc LEFT JOIN users u ON u.id = pc.closed_by ORDER BY pc.month DESC`));
});

// Kapanış öncesi kontrol: onaylanmamış haftalar ve onay bekleyen masraflar
function periodCheck(m) {
  const [from, to] = monthRange(m);
  const weeks = new Map();
  for (const a of all(`SELECT a.user_id, u.full_name, a.date, a.hours FROM activities a JOIN users u ON u.id = a.user_id
                        WHERE a.date BETWEEN ? AND ?`, from, to)) {
    const key = `${a.user_id}|${weekStartOf(a.date)}`;
    if (!weeks.has(key)) weeks.set(key, { user_id: a.user_id, user_name: a.full_name, week_start: weekStartOf(a.date), hours: 0 });
    weeks.get(key).hours += a.hours;
  }
  const unapproved = [...weeks.values()].map((w) => ({
    ...w, hours: r2(w.hours),
    status: one('SELECT status FROM timesheets WHERE user_id = ? AND week_start = ?', w.user_id, w.week_start)?.status || 'draft',
  })).filter((w) => w.status !== 'approved').sort((a, b) => a.week_start.localeCompare(b.week_start) || a.user_name.localeCompare(b.user_name, 'tr'));
  const pendingExpenses = one("SELECT COUNT(*) n FROM expenses WHERE status = 'pending' AND date BETWEEN ? AND ?", from, to).n;
  return { month: m, closed: !!one('SELECT 1 FROM period_closures WHERE month = ?', m), unapproved, pending_expenses: pendingExpenses };
}

router.get('/api/periods/check', auth, requirePerm('period.close'), (req, res) => res.json(periodCheck(month(req.query.month))));

router.post('/api/periods/close', auth, requirePerm('period.close'), (req, res) => {
  const m = month(req.body.month);
  const check = periodCheck(m);
  if (check.closed) bad('Bu ay zaten kapatıldı');
  // Eksik onay varsa kapatmak için açık onay (force) gerekir
  if ((check.unapproved.length || check.pending_expenses) && !req.body.force) {
    return res.status(409).json({ error: 'Onaylanmamış hafta veya onay bekleyen masraf var', ...check });
  }
  tx(() => {
    run('INSERT INTO period_closures (month, closed_by) VALUES (?, ?)', m, req.user.id);
    audit.record(req, 'close', 'periods', null, { month: m, unapproved_weeks: check.unapproved.length, pending_expenses: check.pending_expenses });
  });
  res.json({ ok: true });
});

router.post('/api/periods/reopen', auth, requirePerm('period.reopen'), (req, res) => {
  const m = month(req.body.month);
  const { changes } = run('DELETE FROM period_closures WHERE month = ?', m);
  if (!changes) bad('Bu ay kapalı değil');
  audit.record(req, 'reopen', 'periods', null, { month: m });
  res.json({ ok: true });
});

module.exports = { router };
