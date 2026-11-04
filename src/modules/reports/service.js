// Muhasebe raporu hesapları (serbest meslek / hizmet faturası):
//   Hizmet bedeli      = Σ faturalanabilir saat × ücret
//   KDV matrahı        = hizmet bedeli + müşteriye yansıtılan masraflar
//   KDV                = matrah × KDV oranı
//   Stopaj             = hizmet bedeli × stopaj oranı (yalnızca stopaj kesen müşterilerde)
//   Fatura toplamı     = matrah + KDV
//   Net tahsilat       = fatura toplamı − stopaj
const { one } = require('../../db');
const { r2 } = require('../../lib/validate');
const { getSettings } = require('../settings');
const { listActivities } = require('../activities');
const { listExpenses } = require('../expenses');

function buildReport(req) {
  const s = getSettings();
  const vatRate = Number(s.vat_rate) / 100;
  const whRate = Number(s.withholding_rate) / 100;
  const activities = listActivities(req).reverse();
  const expenses = listExpenses(req).reverse();

  const clients = new Map();
  const users = new Map();
  const projectOf = (row) => {
    if (!clients.has(row.client_id)) {
      const c = one('SELECT id, name, tax_no, tax_office, withholding FROM clients WHERE id = ?', row.client_id);
      clients.set(row.client_id, { ...c, projects: new Map() });
    }
    const c = clients.get(row.client_id);
    if (!c.projects.has(row.project_id)) {
      c.projects.set(row.project_id, { id: row.project_id, name: row.project_name, hours: 0, billable_hours: 0, fee: 0, expenses: 0 });
    }
    return c.projects.get(row.project_id);
  };

  for (const a of activities) {
    const p = projectOf(a);
    p.hours += a.hours;
    if (!users.has(a.user_id)) users.set(a.user_id, { id: a.user_id, name: a.user_name, hours: 0, billable_hours: 0, fee: 0 });
    const u = users.get(a.user_id);
    u.hours += a.hours;
    if (a.billable) {
      p.billable_hours += a.hours; p.fee += a.hours * a.rate;
      u.billable_hours += a.hours; u.fee += a.hours * a.rate;
    }
  }

  const expenseSummary = { billable: 0, nonbillable: 0, input_vat: 0, categories: new Map() };
  for (const e of expenses) {
    const p = projectOf(e);
    const vat = e.amount * e.vat_rate / 100;
    expenseSummary.input_vat += vat;
    if (e.billable) { p.expenses += e.amount; expenseSummary.billable += e.amount; }
    else expenseSummary.nonbillable += e.amount;
    const cat = expenseSummary.categories.get(e.category) || { category: e.category, amount: 0, vat: 0 };
    cat.amount += e.amount; cat.vat += vat;
    expenseSummary.categories.set(e.category, cat);
  }

  const keys = ['hours', 'billable_hours', 'fee', 'expenses', 'vat_base', 'vat', 'withholding_amount', 'invoice_total', 'net'];
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  const clientList = [...clients.values()].map((c) => {
    const projects = [...c.projects.values()].map((p) => ({
      ...p, hours: r2(p.hours), billable_hours: r2(p.billable_hours), fee: r2(p.fee), expenses: r2(p.expenses),
    }));
    const sum = (k) => r2(projects.reduce((acc, p) => acc + p[k], 0));
    const row = { id: c.id, name: c.name, tax_no: c.tax_no, tax_office: c.tax_office, withholding: !!c.withholding, projects,
      hours: sum('hours'), billable_hours: sum('billable_hours'), fee: sum('fee'), expenses: sum('expenses') };
    row.vat_base = r2(row.fee + row.expenses);
    row.vat = r2(row.vat_base * vatRate);
    row.withholding_amount = c.withholding ? r2(row.fee * whRate) : 0;
    row.invoice_total = r2(row.vat_base + row.vat);
    row.net = r2(row.invoice_total - row.withholding_amount);
    for (const k of keys) totals[k] = r2(totals[k] + row[k]);
    return row;
  }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return {
    company_name: s.company_name,
    vat_rate: Number(s.vat_rate),
    withholding_rate: Number(s.withholding_rate),
    period: { from: req.query.from || null, to: req.query.to || null },
    clients: clientList,
    users: [...users.values()].map((u) => ({ ...u, hours: r2(u.hours), billable_hours: r2(u.billable_hours), fee: r2(u.fee) }))
      .sort((a, b) => b.hours - a.hours),
    expense_summary: {
      billable: r2(expenseSummary.billable), nonbillable: r2(expenseSummary.nonbillable), input_vat: r2(expenseSummary.input_vat),
      categories: [...expenseSummary.categories.values()].map((c) => ({ ...c, amount: r2(c.amount), vat: r2(c.vat) })),
    },
    totals,
    activities,
    expenses,
  };
}

module.exports = { buildReport };
