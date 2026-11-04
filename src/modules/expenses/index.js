// Masraf girişi. Kayıt şirkete bağlıdır, proje isteğe bağlıdır.
const express = require('express');
const { all, run, tx } = require('../../db');
const { str, num, date, flag, currency } = require('../../lib/validate');
const { auth } = require('../../lib/auth');
const { buildFilter, JOINS, NAMES, ownRecord, resolveTarget, targetUserId } = require('../../lib/records');
const audit = require('../../lib/audit');

const router = express.Router();

function listExpenses(req) {
  const f = buildFilter(req, 'e');
  return all(`SELECT e.*, ${NAMES} FROM expenses e ${JOINS('e')} ${f.sql} ORDER BY e.date DESC, e.id DESC`, ...f.params);
}

router.get('/api/expenses', auth, (req, res) => res.json(listExpenses(req)));

function expenseFields(req, existing) {
  const b = req.body;
  const { companyId, projectId } = resolveTarget(req, existing);
  return [companyId, projectId, date(b.date), str(b.category, 'Kategori'), str(b.description, '', false),
    num(b.amount, 'Tutar'), currency(b.currency || 'TRY'), num(b.vat_rate, 'KDV oranı', { required: false }) ?? 0,
    flag(b.billable), targetUserId(req, existing)];
}

router.post('/api/expenses', auth, (req, res) => {
  const values = expenseFields(req);
  const id = tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO expenses (company_id, project_id, date, category, description, amount, currency, vat_rate, billable, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values);
    audit.logCreate(req, 'expenses', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/expenses/:id', auth, (req, res) => {
  const before = ownRecord(req, 'expenses', Number(req.params.id));
  const values = expenseFields(req, before);
  tx(() => {
    run(`UPDATE expenses SET company_id = ?, project_id = ?, date = ?, category = ?, description = ?, amount = ?,
         currency = ?, vat_rate = ?, billable = ?, user_id = ? WHERE id = ?`, ...values, before.id);
    audit.logUpdate(req, 'expenses', before);
  });
  res.json({ ok: true });
});

router.delete('/api/expenses/:id', auth, (req, res) => {
  const before = ownRecord(req, 'expenses', Number(req.params.id));
  tx(() => {
    run('DELETE FROM expenses WHERE id = ?', before.id);
    audit.logDelete(req, 'expenses', before);
  });
  res.json({ ok: true });
});

module.exports = { router, listExpenses };
