// Kasa/banka hareketleri ve bordro.
//   Tahsilat (giden faturaya veya müşteriye), ödeme (gelen faturaya veya tedarikçiye),
//   faturasız gelir/gider (kategoriyle), personel: maaş ödemesi, avans, masraf iadesi; SGK ve vergi ödemesi.
//   Bordro tutarları muhasebeciden gelir; uygulama hesaplamaz.
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str, num, date, r2 } = require('../../lib/validate');
const { auth, can, requirePerm } = require('../../lib/auth');
const audit = require('../../lib/audit');
const { rateFor } = require('./rates');
const { directionOf, invoiceState, PERSONNEL_KINDS, personnelLedger, stateLiabilities } = require('./ledger');

const router = express.Router();
const view = requirePerm('accounting.view');
const edit = requirePerm('accounting.edit');
const KINDS = ['collection', 'payment', 'income', 'expense', 'salary_payment', 'advance', 'expense_refund', 'sgk_payment', 'tax_payment'];

const LIST = `SELECT t.*, a.name account_name, a.currency, i.number invoice_number, i.direction invoice_direction,
    co.name company_name, s.name supplier_name, u.full_name user_name, c.name category_name
  FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN invoices i ON i.id = t.invoice_id
  LEFT JOIN companies co ON co.id = t.company_id LEFT JOIN suppliers s ON s.id = t.supplier_id
  LEFT JOIN users u ON u.id = t.user_id LEFT JOIN categories c ON c.id = t.category_id`;

router.get('/api/transactions', auth, view, (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.account_id) { where.push('t.account_id = ?'); params.push(Number(q.account_id)); }
  if (q.from) { where.push('t.date >= ?'); params.push(date(q.from)); }
  if (q.to) { where.push('t.date <= ?'); params.push(date(q.to)); }
  if (q.kind) { where.push('t.kind = ?'); params.push(String(q.kind)); }
  // Personel hareketleri maaş yetkisi olmayanlardan gizlenir
  if (!can(req, 'salary.view')) where.push(`t.kind NOT IN (${PERSONNEL_KINDS.map((k) => `'${k}'`).join(',')})`);
  res.json(all(`${LIST} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.date DESC, t.id DESC LIMIT 1000`, ...params));
});

function fields(req) {
  const b = req.body;
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) bad('Hareket türü geçersiz');
  if (PERSONNEL_KINDS.includes(kind) && !can(req, 'salary.edit')) throw new HttpError(403, 'Personel ödemeleri için maaş yetkisi gerekir');
  const account = one('SELECT * FROM accounts WHERE id = ? AND active = 1', num(b.account_id, 'Hesap'));
  if (!account) bad('Hesap bulunamadı');
  const d = date(b.date, 'Tarih');
  const amount = num(b.amount, 'Tutar');
  if (!(amount > 0)) bad('Tutar sıfırdan büyük olmalı');
  const direction = directionOf(kind);
  let rate = num(b.rate, 'Kur', { required: false });
  if (!rate) {
    const r = rateFor(account.currency, d, direction === 'in' ? 'buying' : 'selling');
    if (!r) bad(`${d} için ${account.currency} kuru yok; kuru elle girin`);
    rate = r.rate;
  }
  const t = { account_id: account.id, date: d, direction, kind, amount, rate, amount_try: r2(amount * rate),
    invoice_id: null, invoice_amount: null, company_id: null, supplier_id: null, user_id: null, category_id: null,
    description: str(b.description, '', false) };

  if (kind === 'collection' || kind === 'payment') {
    if (b.invoice_id) {
      const inv = one('SELECT * FROM invoices WHERE id = ?', Number(b.invoice_id));
      if (!inv || inv.status !== 'issued') bad('Kesilmiş bir fatura seçilmeli');
      if ((kind === 'collection') !== (inv.direction === 'out')) bad(kind === 'collection' ? 'Tahsilat giden faturaya bağlanır' : 'Ödeme gelen faturaya bağlanır');
      // Fatura ile hesap aynı para birimindeyse tutar aynen düşülür; değilse faturadan düşülecek tutar ayrıca girilir
      const applied = inv.currency === account.currency ? amount : num(b.invoice_amount, `Faturadan düşülecek tutar (${inv.currency})`);
      const { outstanding } = invoiceState(inv);
      if (applied > outstanding + 0.01) bad(`Tutar faturanın kalan bakiyesinden (${outstanding} ${inv.currency}) büyük olamaz`);
      Object.assign(t, { invoice_id: inv.id, invoice_amount: r2(applied), company_id: inv.company_id, supplier_id: inv.supplier_id, category_id: inv.category_id });
    } else if (kind === 'collection') {
      t.company_id = num(b.company_id, 'Müşteri / şirket');
      if (!one('SELECT id FROM companies WHERE id = ?', t.company_id)) bad('Şirket bulunamadı');
    } else {
      t.supplier_id = num(b.supplier_id, 'Tedarikçi');
      if (!one('SELECT id FROM suppliers WHERE id = ?', t.supplier_id)) bad('Tedarikçi bulunamadı');
    }
  }
  if (kind === 'income' || kind === 'expense') {
    const c = one('SELECT id, kind FROM categories WHERE id = ?', num(b.category_id, 'Kategori'));
    if (!c || c.kind !== kind) bad(kind === 'income' ? 'Gelir kategorisi seçilmeli' : 'Gider kategorisi seçilmeli');
    t.category_id = c.id;
  }
  if (PERSONNEL_KINDS.includes(kind)) {
    t.user_id = num(b.user_id, 'Personel');
    if (!one('SELECT id FROM users WHERE id = ?', t.user_id)) bad('Personel bulunamadı');
  }
  if (kind === 'sgk_payment' || kind === 'tax_payment') {
    t.category_id = one('SELECT id FROM categories WHERE name = ?', kind === 'sgk_payment' ? 'Personel (maaş ve SGK)' : 'Vergi ve harçlar')?.id ?? null;
  }
  return t;
}

router.post('/api/transactions', auth, edit, (req, res) => {
  const t = fields(req);
  const cols = Object.keys(t);
  const id = tx(() => {
    const { lastInsertRowid } = run(`INSERT INTO transactions (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
      ...cols.map((c) => t[c]), req.user.id);
    audit.record(req, 'create', 'transactions', Number(lastInsertRowid), { kind: t.kind, amount: t.amount, rate: t.rate, invoice_id: t.invoice_id });
    return Number(lastInsertRowid);
  });
  res.json({ id, amount_try: t.amount_try });
});

router.delete('/api/transactions/:id', auth, edit, (req, res) => {
  const t = one('SELECT * FROM transactions WHERE id = ?', Number(req.params.id));
  if (!t) throw new HttpError(404, 'Kayıt bulunamadı');
  if (PERSONNEL_KINDS.includes(t.kind) && !can(req, 'salary.edit')) throw new HttpError(403, 'Personel ödemeleri için maaş yetkisi gerekir');
  tx(() => {
    run('DELETE FROM transactions WHERE id = ?', t.id);
    audit.record(req, 'delete', 'transactions', t.id, { kind: t.kind, amount: t.amount, date: t.date });
  });
  res.json({ ok: true });
});

// ---------- Bordro (muhasebeciden gelen tutarlar) ----------
const period = (v) => {
  const s = str(v, 'Dönem');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) bad('Dönem geçersiz');
  return s;
};

router.get('/api/payroll', auth, requirePerm('salary.view'), (req, res) => {
  const p = period(req.query.period);
  res.json(all(`SELECT u.id user_id, u.full_name, u.title, pr.* , u.id user_id FROM users u
    LEFT JOIN payroll pr ON pr.user_id = u.id AND pr.period = ?
    WHERE u.username != 'yerel' AND (u.active = 1 OR pr.id IS NOT NULL) ORDER BY u.full_name`, p));
});

const PAY_COLS = ['gross', 'net', 'employee_sgk', 'employer_sgk', 'income_tax', 'stamp_tax'];

router.put('/api/payroll', auth, requirePerm('salary.edit'), (req, res) => {
  const b = req.body;
  const p = period(b.period);
  const userId = num(b.user_id, 'Personel');
  if (!one('SELECT id FROM users WHERE id = ?', userId)) bad('Personel bulunamadı');
  const v = Object.fromEntries(PAY_COLS.map((k) => [k, num(b[k], k, { required: false }) ?? 0]));
  if (v.net > v.gross && v.gross > 0) bad('Net maaş brütten büyük olamaz');
  tx(() => {
    run(`INSERT INTO payroll (user_id, period, ${PAY_COLS.join(', ')}, notes) VALUES (?, ?, ${PAY_COLS.map(() => '?').join(', ')}, ?)
         ON CONFLICT(user_id, period) DO UPDATE SET ${PAY_COLS.map((c) => `${c} = excluded.${c}`).join(', ')}, notes = excluded.notes`,
    userId, p, ...PAY_COLS.map((c) => v[c]), str(b.notes, '', false));
    // Tutarlar hassastır; işlem kaydına yalnızca dönem ve kişi yazılır
    audit.record(req, 'update', 'payroll', null, { user_id: userId, period: p, tutar: 'gizli' });
  });
  res.json({ ok: true });
});

router.delete('/api/payroll/:id', auth, requirePerm('salary.edit'), (req, res) => {
  const row = one('SELECT * FROM payroll WHERE id = ?', Number(req.params.id));
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı');
  tx(() => {
    run('DELETE FROM payroll WHERE id = ?', row.id);
    audit.record(req, 'delete', 'payroll', row.id, { user_id: row.user_id, period: row.period });
  });
  res.json({ ok: true });
});

// ---------- Personel carisi ----------
router.get('/api/personnel-ledger', auth, requirePerm('salary.view'), (req, res) => {
  res.json({ personnel: personnelLedger(), state: stateLiabilities() });
});

// Kişinin hareket dökümü (tahakkuk + ödemeler, yürüyen bakiye)
router.get('/api/personnel-ledger/:userId', auth, requirePerm('salary.view'), (req, res) => {
  const userId = Number(req.params.userId);
  const [summary] = personnelLedger(userId);
  if (!summary) throw new HttpError(404, 'Personel bulunamadı');
  const rows = [
    ...all('SELECT period, net FROM payroll WHERE user_id = ?', userId)
      .map((p) => ({ date: `${p.period}-28`, type: 'Maaş tahakkuku', detail: p.period, amount: p.net })),
    ...all(`SELECT date, kind, amount_try, description FROM transactions WHERE user_id = ?`, userId)
      .map((t) => ({ date: t.date, type: { salary_payment: 'Maaş ödemesi', advance: 'Avans', expense_refund: 'Masraf iadesi' }[t.kind],
        detail: t.description, amount: -t.amount_try })),
    ...all("SELECT date, category, amount, vat_rate, currency, description FROM expenses WHERE user_id = ? AND status = 'approved'", userId)
      .map((e) => {
        const r = rateFor(e.currency, e.date, 'selling');
        return { date: e.date, type: 'Masraf (iade edilecek)', detail: `${e.category}${e.description ? ` – ${e.description}` : ''}`,
          amount: r ? r2(e.amount * (1 + e.vat_rate / 100) * r.rate) : 0, missing_rate: !r };
      }),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let balance = 0;
  for (const r of rows) { balance = r2(balance + r.amount); r.balance = balance; }
  res.json({ summary, rows });
});

module.exports = { router };
