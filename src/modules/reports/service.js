// Muhasebe raporu: Müşteri → Şirket → Proje dökümü, her para birimi ayrı toplanır.
//   Hizmet bedeli      = Σ faturalanabilir saat × günlük ücret / 8
//   KDV matrahı        = hizmet bedeli + müşteriye yansıtılan masraflar
//   KDV                = matrah × KDV oranı (şirket "KDV uygulanmaz" ise 0)
//   Stopaj             = hizmet bedeli × stopaj oranı (yalnızca stopaj kesen şirketlerde)
//   Fatura toplamı     = matrah + KDV
//   Net tahsilat       = fatura toplamı − stopaj
// Farklı para birimleri birbirine eklenmez; kur çevirisi muhasebe modülünde (Faz 5) yapılacak.
const { one } = require('../../db');
const { r2, CURRENCIES } = require('../../lib/validate');
const { getSettings } = require('../settings');
const { listActivities, HOURS_PER_DAY } = require('../activities');
const { listExpenses } = require('../expenses');

const KEYS = ['hours', 'billable_hours', 'days', 'fee', 'expenses', 'vat_base', 'vat', 'withholding_amount', 'invoice_total', 'net'];
const byCurrency = (a, b) => CURRENCIES.indexOf(a.currency) - CURRENCIES.indexOf(b.currency);
const zero = (currency) => ({ currency, ...Object.fromEntries(KEYS.map((k) => [k, 0])) });

// Para birimi → toplam satırı eşlemesi
function totalsMap() {
  const m = new Map();
  return {
    add(row) {
      if (!m.has(row.currency)) m.set(row.currency, zero(row.currency));
      const t = m.get(row.currency);
      for (const k of KEYS) t[k] = r2(t[k] + row[k]);
    },
    list: () => [...m.values()].sort(byCurrency),
  };
}

function buildReport(req) {
  const s = getSettings();
  const vatRate = Number(s.vat_rate) / 100;
  const whRate = Number(s.withholding_rate) / 100;
  const activities = listActivities(req).reverse();
  const expenses = listExpenses(req).reverse();

  const customers = new Map();
  const users = new Map();

  // Proje + para birimi kovası (müşteri ve şirket gerektiğinde oluşturulur)
  const bucket = (row, currency) => {
    if (!customers.has(row.customer_id)) customers.set(row.customer_id, { id: row.customer_id, name: row.customer_name, companies: new Map() });
    const cu = customers.get(row.customer_id);
    if (!cu.companies.has(row.company_id)) {
      const c = one('SELECT id, name, tax_no, tax_office, withholding, vat_exempt FROM companies WHERE id = ?', row.company_id);
      cu.companies.set(row.company_id, { ...c, withholding: !!c.withholding, vat_exempt: !!c.vat_exempt, projects: new Map() });
    }
    const co = cu.companies.get(row.company_id);
    const key = `${row.project_id}|${currency}`;
    if (!co.projects.has(key)) {
      co.projects.set(key, { id: row.project_id, name: row.project_name ?? 'Proje dışı', currency, hours: 0, billable_hours: 0, fee: 0, expenses: 0 });
    }
    return co.projects.get(key);
  };

  for (const a of activities) {
    const p = bucket(a, a.currency);
    p.hours += a.hours;
    if (!users.has(a.user_id)) users.set(a.user_id, { id: a.user_id, name: a.user_name, hours: 0, billable_hours: 0, fees: {} });
    const u = users.get(a.user_id);
    u.hours += a.hours;
    if (a.billable) {
      const amount = a.hours * a.daily_rate / HOURS_PER_DAY;
      p.billable_hours += a.hours;
      p.fee += amount;
      u.billable_hours += a.hours;
      u.fees[a.currency] = (u.fees[a.currency] || 0) + amount;
    }
  }

  const expenseByCurrency = new Map();
  const categories = new Map();
  // Yalnızca onaylanmış masraflar rapora girer; onay bekleyenler ayrıca gösterilir, reddedilenler hiç girmez
  for (const e of expenses) {
    if (e.status === 'rejected') continue;
    if (!expenseByCurrency.has(e.currency)) expenseByCurrency.set(e.currency, { currency: e.currency, billable: 0, nonbillable: 0, input_vat: 0, pending: 0 });
    const ex = expenseByCurrency.get(e.currency);
    if (e.status === 'pending') { ex.pending += e.amount; continue; }
    const vat = e.amount * e.vat_rate / 100;
    ex.input_vat += vat;
    if (e.billable) { bucket(e, e.currency).expenses += e.amount; ex.billable += e.amount; }
    else ex.nonbillable += e.amount;
    const catKey = `${e.category}|${e.currency}`;
    const cat = categories.get(catKey) || { category: e.category, currency: e.currency, amount: 0, vat: 0 };
    cat.amount += e.amount;
    cat.vat += vat;
    categories.set(catKey, cat);
  }

  const grand = totalsMap();
  const customerList = [...customers.values()].map((cu) => {
    const customerTotals = totalsMap();
    const companies = [...cu.companies.values()].map((co) => {
      const projects = [...co.projects.values()].map((p) => ({
        ...p, hours: r2(p.hours), billable_hours: r2(p.billable_hours), days: r2(p.billable_hours / HOURS_PER_DAY),
        fee: r2(p.fee), expenses: r2(p.expenses),
      })).sort((a, b) => a.name.localeCompare(b.name, 'tr') || byCurrency(a, b));

      // Şirket toplamı her para birimi için ayrı hesaplanır
      const currencies = [...new Set(projects.map((p) => p.currency))];
      const totals = currencies.map((currency) => {
        const ps = projects.filter((p) => p.currency === currency);
        const sum = (k) => r2(ps.reduce((acc, p) => acc + p[k], 0));
        const t = { currency, hours: sum('hours'), billable_hours: sum('billable_hours'), days: sum('days'), fee: sum('fee'), expenses: sum('expenses') };
        t.vat_base = r2(t.fee + t.expenses);
        t.vat = co.vat_exempt ? 0 : r2(t.vat_base * vatRate);
        t.withholding_amount = co.withholding ? r2(t.fee * whRate) : 0;
        t.invoice_total = r2(t.vat_base + t.vat);
        t.net = r2(t.invoice_total - t.withholding_amount);
        customerTotals.add(t);
        grand.add(t);
        return t;
      }).sort(byCurrency);

      const { projects: _, ...info } = co;
      return { ...info, projects, totals };
    }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return { id: cu.id, name: cu.name, companies, totals: customerTotals.list() };
  }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const hours = r2(activities.reduce((a, r) => a + r.hours, 0));
  const billableHours = r2(activities.reduce((a, r) => a + (r.billable ? r.hours : 0), 0));

  return {
    company_name: s.company_name,
    vat_rate: Number(s.vat_rate),
    withholding_rate: Number(s.withholding_rate),
    period: { from: req.query.from || null, to: req.query.to || null },
    effort: { hours, billable_hours: billableHours, days: r2(billableHours / HOURS_PER_DAY) },
    customers: customerList,
    totals: grand.list(),
    users: [...users.values()].map((u) => ({
      ...u, hours: r2(u.hours), billable_hours: r2(u.billable_hours), days: r2(u.billable_hours / HOURS_PER_DAY),
      fees: Object.fromEntries(Object.entries(u.fees).map(([c, v]) => [c, r2(v)])),
    })).sort((a, b) => b.hours - a.hours),
    expense_summary: {
      totals: [...expenseByCurrency.values()].map((e) => ({
        ...e, billable: r2(e.billable), nonbillable: r2(e.nonbillable), input_vat: r2(e.input_vat), pending: r2(e.pending),
      })).sort(byCurrency),
      categories: [...categories.values()].map((c) => ({ ...c, amount: r2(c.amount), vat: r2(c.vat) }))
        .sort((a, b) => a.category.localeCompare(b.category, 'tr') || byCurrency(a, b)),
    },
    activities,
    expenses,
  };
}

module.exports = { buildReport };
