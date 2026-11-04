// Aylık müşteri planı (adam-gün) ve bütçe karşılaştırması (yalnızca yönetici)
const express = require('express');
const { one, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str, num, date } = require('../../lib/validate');
const { auth, admin } = require('../../lib/auth');
const audit = require('../../lib/audit');
const { buildBudget, listPlans } = require('./service');

const router = express.Router();

const month = (v, field = 'Ay') => {
  const s = str(v, field);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) bad(`${field} geçersiz`);
  return s;
};

router.get('/api/budget', auth, admin, (req, res) => {
  const today = req.query.today ? date(req.query.today, 'Bugün') : undefined;
  res.json(buildBudget(month(req.query.month), today));
});

router.get('/api/plans', auth, admin, (req, res) => res.json(listPlans(month(req.query.month))));

// Hedef: müşteri zorunlu; şirket ve proje isteğe bağlı ama birbirine ait olmalı
function planFields(b) {
  const customerId = num(b.customer_id, 'Müşteri');
  if (!one('SELECT id FROM customers WHERE id = ?', customerId)) bad('Müşteri bulunamadı');
  const companyId = b.company_id ? Number(b.company_id) : null;
  const projectId = b.project_id ? Number(b.project_id) : null;
  if (companyId && !one('SELECT id FROM companies WHERE id = ? AND customer_id = ?', companyId, customerId)) bad('Şirket bu müşteriye ait değil');
  if (projectId) {
    if (!companyId) bad('Proje için şirket seçilmeli');
    if (!one('SELECT id FROM projects WHERE id = ? AND company_id = ?', projectId, companyId)) bad('Proje bu şirkete ait değil');
  }
  return [month(b.month), customerId, companyId, projectId, num(b.planned_days, 'Planlanan adam-gün'), str(b.notes, '', false)];
}

const duplicate = (err) => {
  if (/UNIQUE constraint failed/.test(err.message)) throw new HttpError(400, 'Bu ay için aynı hedefe ait bir plan zaten var');
  throw err;
};

router.post('/api/plans', auth, admin, (req, res) => {
  const values = planFields(req.body);
  try {
    const id = tx(() => {
      const { lastInsertRowid } = run(
        'INSERT INTO budget_plans (month, customer_id, company_id, project_id, planned_days, notes) VALUES (?, ?, ?, ?, ?, ?)', ...values);
      audit.logCreate(req, 'budget_plans', Number(lastInsertRowid));
      return Number(lastInsertRowid);
    });
    res.json({ id });
  } catch (err) { duplicate(err); }
});

router.put('/api/plans/:id', auth, admin, (req, res) => {
  const before = audit.snapshot('budget_plans', Number(req.params.id));
  if (!before) throw new HttpError(404, 'Kayıt bulunamadı');
  const values = planFields(req.body);
  try {
    tx(() => {
      run('UPDATE budget_plans SET month = ?, customer_id = ?, company_id = ?, project_id = ?, planned_days = ?, notes = ? WHERE id = ?',
        ...values, before.id);
      audit.logUpdate(req, 'budget_plans', before);
    });
    res.json({ ok: true });
  } catch (err) { duplicate(err); }
});

router.delete('/api/plans/:id', auth, admin, (req, res) => {
  const before = audit.snapshot('budget_plans', Number(req.params.id));
  if (!before) throw new HttpError(404, 'Kayıt bulunamadı');
  tx(() => {
    run('DELETE FROM budget_plans WHERE id = ?', before.id);
    audit.logDelete(req, 'budget_plans', before);
  });
  res.json({ ok: true });
});

// Bir ayın planlarını başka aya kopyalar; hedef ayda zaten olanlar atlanır
router.post('/api/plans/copy', auth, admin, (req, res) => {
  const from = month(req.body.from_month, 'Kaynak ay');
  const to = month(req.body.to_month, 'Hedef ay');
  if (from === to) bad('Kaynak ve hedef ay aynı olamaz');
  const copied = tx(() => {
    let n = 0;
    for (const p of listPlans(from)) {
      const { changes, lastInsertRowid } = run(`INSERT OR IGNORE INTO budget_plans (month, customer_id, company_id, project_id, planned_days, notes)
        VALUES (?, ?, ?, ?, ?, ?)`, to, p.customer_id, p.company_id, p.project_id, p.planned_days, p.notes);
      if (changes) { n += 1; audit.logCreate(req, 'budget_plans', Number(lastInsertRowid)); }
    }
    return n;
  });
  res.json({ copied });
});

module.exports = { router };
