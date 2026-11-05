// Muhasebe raporları (TL karşılıklarıyla):
//   Özet, yaşlandırma (cari), nakit akışı, aylık gelir–gider (tahakkuk esaslı), kategori bütçesi, aylık Excel.
// Gelir–gider tahakkuk esaslıdır:
//   Gelir = kesilmiş giden faturaların ara toplamı (hizmet kalemleri faturanın kategorisine, masraf kalemleri
//           "Yansıtılan masraf"a) + faturasız gelir hareketleri
//   Gider = kesilmiş gelen faturaların ara toplamı (kategorisine) + faturasız gider hareketleri
//           + bordro maliyeti (brüt + işveren SGK) "Personel (maaş ve SGK)"
const express = require('express');
const ExcelJS = require('exceljs');
const { one, all, run, tx } = require('../../db');
const { bad, asyncHandler } = require('../../lib/http');
const { str, num, date, r2 } = require('../../lib/validate');
const { auth, can, requirePerm } = require('../../lib/auth');
const { today, monthRange, isoDay } = require('../../lib/workdays');
const audit = require('../../lib/audit');
const { invoiceState, accountBalance, toTry, personnelLedger, stateLiabilities, PERSONNEL_KINDS } = require('./ledger');
const { buildBudget } = require('../budget/service');

const router = express.Router();
const view = requirePerm('accounting.view');
const edit = requirePerm('accounting.edit');

const month = (v) => {
  const s = str(v, 'Ay');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) bad('Ay geçersiz');
  return s;
};
const categoryId = (name) => one('SELECT id FROM categories WHERE name = ?', name)?.id;

const issuedInvoices = (direction) => all(`SELECT i.*, co.name company_name, s.name supplier_name FROM invoices i
  LEFT JOIN companies co ON co.id = i.company_id LEFT JOIN suppliers s ON s.id = i.supplier_id
  WHERE i.direction = ? AND i.status = 'issued'`, direction).map((i) => ({ ...i, ...invoiceState(i) }));

// ---------- Özet ----------
router.get('/api/accounting/summary', auth, view, (req, res) => {
  const t = today();
  const accounts = all('SELECT * FROM accounts WHERE active = 1 ORDER BY type, name').map((a) => {
    const balance = accountBalance(a);
    return { id: a.id, name: a.name, type: a.type, currency: a.currency, balance, balance_try: toTry(balance, a.currency, t) };
  });
  const sumOpen = (rows, overdue) => r2(rows.filter((r) => !overdue || r.overdue_days > 0).reduce((a, r) => a + r.outstanding_try, 0));
  const out = issuedInvoices('out');
  const inn = issuedInvoices('in');
  const [from, to] = monthRange(t.slice(0, 7));
  const pnl = profitAndLoss(from, to);
  const result = {
    accounts,
    cash_try: r2(accounts.reduce((a, x) => a + (x.balance_try || 0), 0)),
    receivables_try: sumOpen(out), receivables_overdue_try: sumOpen(out, true),
    payables_try: sumOpen(inn), payables_overdue_try: sumOpen(inn, true),
    month: { income: pnl.income_total, expense: pnl.expense_total, net: r2(pnl.income_total - pnl.expense_total) },
    unbilled_activities: one(`SELECT COUNT(*) n FROM activities WHERE billable = 1 AND invoice_id IS NULL`).n,
  };
  if (can(req, 'salary.view')) {
    result.personnel_balance_try = r2(personnelLedger().reduce((a, p) => a + p.balance, 0));
    result.state = stateLiabilities();
  }
  res.json(result);
});

// ---------- Yaşlandırma ----------
const BUCKETS = [['current', 'Vadesi gelmemiş', -Infinity, 0], ['d30', '1–30 gün', 1, 30], ['d60', '31–60 gün', 31, 60],
  ['d90', '61–90 gün', 61, 90], ['d90p', '90+ gün', 91, Infinity]];

router.get('/api/accounting/aging', auth, view, (req, res) => {
  const direction = req.query.direction === 'in' ? 'in' : 'out';
  const parties = new Map();
  for (const inv of issuedInvoices(direction).filter((i) => i.outstanding > 0.005)) {
    const key = direction === 'out' ? `c${inv.company_id}` : `s${inv.supplier_id}`;
    if (!parties.has(key)) {
      parties.set(key, { party: direction === 'out' ? inv.company_name : inv.supplier_name, total_try: 0, currencies: {},
        ...Object.fromEntries(BUCKETS.map(([k]) => [k, 0])), invoices: [] });
    }
    const p = parties.get(key);
    const bucket = BUCKETS.find(([, , min, max]) => inv.overdue_days >= min && inv.overdue_days <= max)[0];
    p[bucket] = r2(p[bucket] + inv.outstanding_try);
    p.total_try = r2(p.total_try + inv.outstanding_try);
    p.currencies[inv.currency] = r2((p.currencies[inv.currency] || 0) + inv.outstanding);
    p.invoices.push({ id: inv.id, number: inv.number, due_date: inv.due_date, currency: inv.currency, outstanding: inv.outstanding, overdue_days: inv.overdue_days });
  }
  const rows = [...parties.values()].sort((a, b) => b.total_try - a.total_try);
  const totals = Object.fromEntries([...BUCKETS.map(([k]) => k), 'total_try'].map((k) => [k, r2(rows.reduce((a, r) => a + r[k], 0))]));
  res.json({ direction, buckets: BUCKETS.map(([k, label]) => ({ key: k, label })), rows, totals });
});

// ---------- Nakit akışı ----------
router.get('/api/accounting/cashflow', auth, view, (req, res) => {
  const days = Math.min(Number(req.query.days) || 90, 365);
  const t = today();
  const end = new Date(`${t}T00:00:00`);
  end.setDate(end.getDate() + days);
  const until = isoDay(end);
  const items = [...issuedInvoices('out'), ...issuedInvoices('in')]
    .filter((i) => i.outstanding > 0.005 && i.due_date <= until)
    .map((i) => ({ id: i.id, direction: i.direction, party: i.direction === 'out' ? i.company_name : i.supplier_name, number: i.number,
      due_date: i.due_date, currency: i.currency, outstanding: i.outstanding, amount_try: i.outstanding_try, overdue: i.due_date < t }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const cash = all('SELECT * FROM accounts WHERE active = 1').reduce((a, acc) => a + (toTry(accountBalance(acc), acc.currency, t) || 0), 0);
  // Haftalık kümülatif projeksiyon (vadesi geçmişler ilk haftaya)
  const weeks = [];
  let running = r2(cash);
  for (let w = 0; w * 7 < days; w += 1) {
    const s = new Date(`${t}T00:00:00`); s.setDate(s.getDate() + w * 7);
    const e = new Date(s); e.setDate(e.getDate() + 6);
    const [ws, we] = [isoDay(s), isoDay(e)];
    const inWeek = items.filter((i) => (w === 0 ? i.due_date <= we : i.due_date >= ws && i.due_date <= we));
    const inflow = r2(inWeek.filter((i) => i.direction === 'out').reduce((a, i) => a + i.amount_try, 0));
    const outflow = r2(inWeek.filter((i) => i.direction === 'in').reduce((a, i) => a + i.amount_try, 0));
    running = r2(running + inflow - outflow);
    weeks.push({ week_start: ws, inflow, outflow, balance: running });
  }
  res.json({ cash_try: r2(cash), items, weeks });
});

// ---------- Gelir–gider ----------
function profitAndLoss(from, to) {
  const byCat = new Map();
  const add = (catId, amount) => {
    if (!catId || !amount) return;
    byCat.set(catId, r2((byCat.get(catId) || 0) + amount));
  };
  const reflected = categoryId('Yansıtılan masraf');
  for (const inv of all("SELECT * FROM invoices WHERE status = 'issued' AND issue_date BETWEEN ? AND ?", from, to)) {
    const fallback = categoryId(inv.direction === 'out' ? 'Hizmet geliri' : 'Diğer gider');
    if (inv.direction === 'out') {
      const lines = all('SELECT line_total, is_service FROM invoice_lines WHERE invoice_id = ?', inv.id);
      add(inv.category_id || fallback, lines.filter((l) => l.is_service).reduce((a, l) => a + l.line_total, 0) * inv.rate);
      add(reflected, lines.filter((l) => !l.is_service).reduce((a, l) => a + l.line_total, 0) * inv.rate);
    } else add(inv.category_id || fallback, inv.subtotal * inv.rate);
  }
  for (const t of all("SELECT category_id, amount_try FROM transactions WHERE kind IN ('income','expense') AND date BETWEEN ? AND ?", from, to)) {
    add(t.category_id, t.amount_try);
  }
  const personnel = categoryId('Personel (maaş ve SGK)');
  for (const p of all('SELECT gross, employer_sgk FROM payroll WHERE period BETWEEN ? AND ?', from.slice(0, 7), to.slice(0, 7))) {
    add(personnel, p.gross + p.employer_sgk);
  }
  const cats = all('SELECT id, kind, name FROM categories ORDER BY kind, name');
  const rows = cats.map((c) => ({ ...c, amount: r2(byCat.get(c.id) || 0) }));
  const sum = (kind) => r2(rows.filter((r) => r.kind === kind).reduce((a, r) => a + r.amount, 0));
  return { rows, income_total: sum('income'), expense_total: sum('expense') };
}

router.get('/api/accounting/pnl', auth, view, (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : today().slice(0, 4);
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const [from, to] = monthRange(`${year}-${String(m).padStart(2, '0')}`);
    const p = profitAndLoss(from, to);
    months.push({ month: from.slice(0, 7), income: p.income_total, expense: p.expense_total, net: r2(p.income_total - p.expense_total),
      categories: Object.fromEntries(p.rows.filter((r) => r.amount).map((r) => [r.id, r.amount])) });
  }
  const categories = all('SELECT id, kind, name FROM categories ORDER BY kind, name');
  const total = (k) => r2(months.reduce((a, m) => a + m[k], 0));
  res.json({ year, categories, months, totals: { income: total('income'), expense: total('expense'), net: total('net') } });
});

// ---------- Kategori bütçesi ----------
router.get('/api/accounting/budget', auth, view, (req, res) => {
  const m = month(req.query.month);
  const [from, to] = monthRange(m);
  const actual = profitAndLoss(from, to);
  const plans = new Map(all('SELECT category_id, amount FROM category_budgets WHERE month = ?', m).map((p) => [p.category_id, p.amount]));
  const rows = actual.rows.filter((r) => r.active !== 0).map((r) => {
    const plan = plans.get(r.id) ?? 0;
    return { category_id: r.id, kind: r.kind, name: r.name, plan, actual: r.amount, diff: r2(r.amount - plan), pct: plan ? r2(r.amount / plan) : null };
  });
  // Faz 2 efor bütçesinden beklenen hizmet geliri (ay sonu tahmini, TL'ye çevrilmiş)
  const effort = buildBudget(m).totals.map((t) => ({ currency: t.currency, forecast: t.forecast_amount, try: t.forecast_amount == null ? null : toTry(t.forecast_amount, t.currency, today()) }));
  const sum = (kind, key) => r2(rows.filter((r) => r.kind === kind).reduce((a, r) => a + r[key], 0));
  res.json({ month: m, rows, totals: { income_plan: sum('income', 'plan'), income_actual: sum('income', 'actual'),
    expense_plan: sum('expense', 'plan'), expense_actual: sum('expense', 'actual') }, effort_forecast: effort });
});

router.put('/api/accounting/budget', auth, edit, (req, res) => {
  const m = month(req.body.month);
  const catId = num(req.body.category_id, 'Kategori');
  if (!one('SELECT id FROM categories WHERE id = ?', catId)) bad('Kategori bulunamadı');
  const amount = num(req.body.amount, 'Tutar', { required: false }) ?? 0;
  tx(() => {
    run(`INSERT INTO category_budgets (month, category_id, amount) VALUES (?, ?, ?)
         ON CONFLICT(month, category_id) DO UPDATE SET amount = excluded.amount`, m, catId, amount);
    audit.record(req, 'update', 'category_budgets', null, { month: m, category_id: catId, amount });
  });
  res.json({ ok: true });
});

router.post('/api/accounting/budget/copy', auth, edit, (req, res) => {
  const from = month(req.body.from_month);
  const to = month(req.body.to_month);
  const { changes } = run(`INSERT OR IGNORE INTO category_budgets (month, category_id, amount)
                           SELECT ?, category_id, amount FROM category_budgets WHERE month = ?`, to, from);
  audit.record(req, 'create', 'category_budgets', null, { from_month: from, to_month: to, copied: changes });
  res.json({ copied: changes });
});

// ---------- Muhasebeci için aylık Excel ----------
router.get('/api/accounting/export.xlsx', auth, view, asyncHandler(async (req, res) => {
  const m = month(req.query.month);
  const [from, to] = monthRange(m);
  const wb = new ExcelJS.Workbook();
  const MONEY = '#,##0.00';
  const sheet = (name, cols) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map(([header, key, width, fmt]) => ({ header, key, width: width || 14, style: fmt ? { numFmt: fmt } : {} }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  };
  const inv = sheet('Faturalar', [['Yön', 'dir', 8], ['Tarih', 'issue_date', 12], ['Fatura no', 'number', 18], ['Cari', 'party', 30],
    ['VKN', 'tax_no', 14], ['Kategori', 'category', 22], ['Para birimi', 'currency', 10], ['Kur', 'rate', 10, '0.0000'],
    ['Ara toplam', 'subtotal', 14, MONEY], ['KDV', 'vat', 12, MONEY], ['Stopaj', 'withholding', 12, MONEY], ['Toplam', 'total', 14, MONEY],
    ['Net', 'net', 14, MONEY], ['Net (TL)', 'net_try', 14, MONEY], ['Vade', 'due_date', 12], ['Durum', 'state', 12]]);
  for (const i of all(`SELECT i.*, co.name cname, co.tax_no ctax, s.name sname, s.tax_no stax, c.name category FROM invoices i
                       LEFT JOIN companies co ON co.id = i.company_id LEFT JOIN suppliers s ON s.id = i.supplier_id
                       LEFT JOIN categories c ON c.id = i.category_id WHERE i.status = 'issued' AND i.issue_date BETWEEN ? AND ?
                       ORDER BY i.direction DESC, i.issue_date`, from, to)) {
    const st = invoiceState(i);
    inv.addRow({ dir: i.direction === 'out' ? 'Giden' : 'Gelen', issue_date: i.issue_date, number: i.number, party: i.cname || i.sname,
      tax_no: i.ctax || i.stax, category: i.category, currency: i.currency, rate: i.rate, subtotal: i.subtotal, vat: i.vat,
      withholding: i.withholding, total: i.total, net: i.net, net_try: r2(i.net * i.rate), due_date: i.due_date,
      state: { paid: 'Ödendi', partial: 'Kısmi', open: 'Açık' }[st.payment_status] });
  }
  const tr = sheet('Hareketler', [['Tarih', 'date', 12], ['Hesap', 'account', 22], ['Tür', 'kind', 16], ['Giriş/Çıkış', 'dir', 10],
    ['Tutar', 'amount', 14, MONEY], ['Para birimi', 'currency', 10], ['Kur', 'rate', 10, '0.0000'], ['TL', 'amount_try', 14, MONEY],
    ['Fatura', 'invoice', 16], ['Cari / kişi', 'party', 26], ['Kategori', 'category', 22], ['Açıklama', 'description', 30]]);
  const KIND = { collection: 'Tahsilat', payment: 'Ödeme', income: 'Gelir', expense: 'Gider', salary_payment: 'Maaş ödemesi',
    advance: 'Avans', expense_refund: 'Masraf iadesi', sgk_payment: 'SGK ödemesi', tax_payment: 'Vergi ödemesi' };
  const hidePersonnel = !can(req, 'salary.view');
  for (const t of all(`SELECT t.*, a.name account, a.currency, i.number invoice, co.name cname, s.name sname, u.full_name uname, c.name category
                       FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN invoices i ON i.id = t.invoice_id
                       LEFT JOIN companies co ON co.id = t.company_id LEFT JOIN suppliers s ON s.id = t.supplier_id
                       LEFT JOIN users u ON u.id = t.user_id LEFT JOIN categories c ON c.id = t.category_id
                       WHERE t.date BETWEEN ? AND ? ORDER BY t.date`, from, to)) {
    if (hidePersonnel && PERSONNEL_KINDS.includes(t.kind)) continue;
    tr.addRow({ date: t.date, account: t.account, kind: KIND[t.kind], dir: t.direction === 'in' ? 'Giriş' : 'Çıkış', amount: t.amount,
      currency: t.currency, rate: t.rate, amount_try: t.amount_try, invoice: t.invoice, party: t.cname || t.sname || t.uname,
      category: t.category, description: t.description });
  }
  if (can(req, 'salary.view')) {
    const pr = sheet('Bordro', [['Personel', 'name', 26], ['Dönem', 'period', 10], ['Brüt', 'gross', 14, MONEY], ['Net', 'net', 14, MONEY],
      ['SGK işçi', 'employee_sgk', 12, MONEY], ['SGK işveren', 'employer_sgk', 12, MONEY], ['Gelir vergisi', 'income_tax', 12, MONEY],
      ['Damga vergisi', 'stamp_tax', 12, MONEY]]);
    for (const p of all('SELECT p.*, u.full_name name FROM payroll p JOIN users u ON u.id = p.user_id WHERE p.period = ? ORDER BY u.full_name', m)) pr.addRow(p);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="muhasebe-${m}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = { router, profitAndLoss };
