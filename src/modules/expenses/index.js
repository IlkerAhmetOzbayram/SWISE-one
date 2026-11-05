// Masraf girişi ve onayı. Kayıt şirkete bağlıdır, proje isteğe bağlıdır.
// Onay yetkisi olmayanın girdiği masraf "onay bekliyor" (pending) başlar; onaylanmış masrafı
// yalnızca onay yetkilisi değiştirebilir. Kapalı aydaki masraflar kilitlidir.
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str, num, date, flag, currency } = require('../../lib/validate');
const { auth, can, requirePerm } = require('../../lib/auth');
const { buildFilter, JOINS, NAMES, ownRecord, resolveTarget, targetUserId } = require('../../lib/records');
const { checkMonth } = require('../../lib/locks');
const audit = require('../../lib/audit');

const router = express.Router();
const STATUSES = ['pending', 'approved', 'rejected'];

function listExpenses(req) {
  const f = buildFilter(req, 'e', 'expenses');
  const extra = STATUSES.includes(req.query.status) ? `${f.sql ? ' AND' : 'WHERE'} e.status = ?` : '';
  const params = extra ? [...f.params, req.query.status] : f.params;
  return all(`SELECT e.*, ${NAMES}, rv.full_name reviewer_name FROM expenses e ${JOINS('e')}
              LEFT JOIN users rv ON rv.id = e.reviewed_by ${f.sql}${extra} ORDER BY e.date DESC, e.id DESC`, ...params);
}

router.get('/api/expenses', auth, (req, res) => res.json(listExpenses(req)));

const approver = (req) => !!can(req, 'expenses.approve');

function expenseFields(req, existing) {
  const b = req.body;
  const { companyId, projectId } = resolveTarget(req, existing, 'expenses');
  const day = date(b.date);
  checkMonth(day);
  return [companyId, projectId, day, str(b.category, 'Kategori'), str(b.description, '', false),
    num(b.amount, 'Tutar'), currency(b.currency || 'TRY'), num(b.vat_rate, 'KDV oranı', { required: false }) ?? 0,
    flag(b.billable), targetUserId(req, existing, 'expenses')];
}

// Onaylanmış masraf yalnızca onay yetkilisi tarafından değiştirilebilir
function checkEditable(req, row) {
  checkMonth(row.date);
  if (row.status === 'approved' && !approver(req)) throw new HttpError(423, 'Onaylanmış masraf değiştirilemez');
}

router.post('/api/expenses', auth, requirePerm('expenses.edit'), (req, res) => {
  const values = expenseFields(req);
  const status = approver(req) ? 'approved' : 'pending';
  const id = tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO expenses (company_id, project_id, date, category, description, amount, currency, vat_rate, billable, user_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values, status);
    audit.logCreate(req, 'expenses', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id, status });
});

router.put('/api/expenses/:id', auth, (req, res) => {
  const before = ownRecord(req, 'expenses', Number(req.params.id), 'expenses');
  checkEditable(req, before);
  const values = expenseFields(req, before);
  // Onay yetkisi olmayan düzenlerse masraf yeniden onaya düşer
  const status = approver(req) ? before.status : 'pending';
  tx(() => {
    run(`UPDATE expenses SET company_id = ?, project_id = ?, date = ?, category = ?, description = ?, amount = ?,
         currency = ?, vat_rate = ?, billable = ?, user_id = ?, status = ? WHERE id = ?`, ...values, status, before.id);
    audit.logUpdate(req, 'expenses', before);
  });
  res.json({ ok: true, status });
});

router.delete('/api/expenses/:id', auth, (req, res) => {
  const before = ownRecord(req, 'expenses', Number(req.params.id), 'expenses');
  checkEditable(req, before);
  tx(() => {
    run('DELETE FROM expenses WHERE id = ?', before.id);
    audit.logDelete(req, 'expenses', before);
  });
  res.json({ ok: true });
});

// Onay / ret. Onaylayan, masrafı görme kapsamında olmalı (sorumlu olduğu müşteri veya tümü).
router.post('/api/expenses/:id/review', auth, requirePerm('expenses.approve'), (req, res) => {
  const decision = req.body.decision;
  if (!['approved', 'rejected'].includes(decision)) bad('Karar geçersiz');
  const note = str(req.body.note, 'Gerekçe', decision === 'rejected');
  const before = one(`SELECT e.*, cu.manager_id FROM expenses e JOIN companies co ON co.id = e.company_id
                      JOIN customers cu ON cu.id = co.customer_id WHERE e.id = ?`, Number(req.params.id));
  if (!before) throw new HttpError(404, 'Kayıt bulunamadı');
  const scope = can(req, 'expenses.view');
  const visible = scope === 'all' || before.user_id === req.user.id || (scope === 'assigned' && before.manager_id === req.user.id);
  if (!visible) throw new HttpError(403, 'Bu masrafı onaylama yetkiniz yok');
  checkMonth(before.date);
  tx(() => {
    run(`UPDATE expenses SET status = ?, reviewed_by = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), review_note = ? WHERE id = ?`,
      decision, req.user.id, note, before.id);
    audit.record(req, decision === 'approved' ? 'approve' : 'reject', 'expenses', before.id, note ? { note } : {});
  });
  res.json({ ok: true });
});

module.exports = { router, listExpenses };
