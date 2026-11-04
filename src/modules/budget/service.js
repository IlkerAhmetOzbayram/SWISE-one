// Aylık bütçe: plan, gerçekleşen ve tempo tahmini (müşteri + para birimi bazında)
//   Plan tutarı      = planlanan adam-gün × geçerli günlük ücret (proje → şirket → müşteri)
//   Gerçekleşen      = ay içindeki faturalanabilir aktiviteler (saat / 8 = adam-gün)
//   Tahmin           = gerçekleşen / geçen iş günü × ayın toplam iş günü
//                      (ay bitmişse gerçekleşen; ay başlamamışsa tahmin yok)
const { all } = require('../../db');
const { r2, CURRENCIES } = require('../../lib/validate');
const { monthRange, holidayMap, businessDays, today: todayStr } = require('../../lib/workdays');
const { HOURS_PER_DAY } = require('../activities');

const PLAN_SQL = `SELECT bp.*, cu.name customer_name, co.name company_name, p.name project_name,
    CASE WHEN bp.project_id IS NOT NULL THEN COALESCE(p.daily_rate, co.daily_rate, cu.daily_rate)
         WHEN bp.company_id IS NOT NULL THEN COALESCE(co.daily_rate, cu.daily_rate)
         ELSE cu.daily_rate END daily_rate,
    COALESCE(co.currency, cu.currency) currency
  FROM budget_plans bp JOIN customers cu ON cu.id = bp.customer_id
  LEFT JOIN companies co ON co.id = bp.company_id LEFT JOIN projects p ON p.id = bp.project_id`;

const listPlans = (month) => all(`${PLAN_SQL} WHERE bp.month = ? ORDER BY cu.name, co.name, p.name`, month)
  .map((r) => ({ ...r, planned_amount: r2(r.planned_days * r.daily_rate) }));

function monthProgress(month, today) {
  const [from, to] = monthRange(month);
  const holidays = holidayMap(from, to);
  const total = businessDays(from, to, holidays);
  let elapsed;
  if (today > to) elapsed = total;
  else if (today < from) elapsed = 0;
  else elapsed = businessDays(from, today, holidays);
  return { from, to, total, elapsed, remaining: r2(total - elapsed), holidays: [...holidays.values()] };
}

function buildBudget(month, today = todayStr()) {
  const progress = monthProgress(month, today);
  const rows = new Map();
  const row = (customerId, customerName, currency) => {
    const key = `${customerId}|${currency}`;
    if (!rows.has(key)) {
      rows.set(key, { customer_id: customerId, customer_name: customerName, currency,
        planned_days: 0, planned_amount: 0, actual_hours: 0, actual_days: 0, actual_amount: 0 });
    }
    return rows.get(key);
  };

  const plans = listPlans(month);
  for (const p of plans) {
    const r = row(p.customer_id, p.customer_name, p.currency);
    r.planned_days += p.planned_days;
    r.planned_amount += p.planned_amount;
  }

  const acts = all(`SELECT a.hours, a.daily_rate, a.currency, co.customer_id, cu.name customer_name
                    FROM activities a JOIN companies co ON co.id = a.company_id JOIN customers cu ON cu.id = co.customer_id
                    WHERE a.billable = 1 AND a.date BETWEEN ? AND ?`, progress.from, progress.to);
  for (const a of acts) {
    const r = row(a.customer_id, a.customer_name, a.currency);
    r.actual_hours += a.hours;
    r.actual_amount += a.hours * a.daily_rate / HOURS_PER_DAY;
  }

  // Tempo katsayısı: geçen iş gününe göre ay sonuna ölçekleme
  const factor = progress.elapsed > 0 ? progress.total / progress.elapsed : null;
  const finish = (r) => {
    r.actual_days = r.actual_hours / HOURS_PER_DAY;
    const out = {
      ...r,
      planned_days: r2(r.planned_days), planned_amount: r2(r.planned_amount),
      actual_hours: r2(r.actual_hours), actual_days: r2(r.actual_days), actual_amount: r2(r.actual_amount),
      forecast_days: factor === null ? null : r2(r.actual_days * factor),
      forecast_amount: factor === null ? null : r2(r.actual_amount * factor),
    };
    out.actual_pct = out.planned_amount ? r2(out.actual_amount / out.planned_amount) : null;
    out.forecast_pct = out.planned_amount && out.forecast_amount !== null ? r2(out.forecast_amount / out.planned_amount) : null;
    out.forecast_variance = out.planned_amount && out.forecast_amount !== null ? r2(out.forecast_amount - out.planned_amount) : null;
    return out;
  };

  const list = [...rows.values()].map(finish)
    .sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'tr') || CURRENCIES.indexOf(a.currency) - CURRENCIES.indexOf(b.currency));

  const totals = new Map();
  for (const r of rows.values()) {
    if (!totals.has(r.currency)) totals.set(r.currency, { customer_id: null, customer_name: 'Toplam', currency: r.currency, planned_days: 0, planned_amount: 0, actual_hours: 0, actual_days: 0, actual_amount: 0 });
    const t = totals.get(r.currency);
    for (const k of ['planned_days', 'planned_amount', 'actual_hours', 'actual_amount']) t[k] += r[k];
  }

  return {
    month,
    today,
    business_days: { total: progress.total, elapsed: progress.elapsed, remaining: progress.remaining },
    holidays: progress.holidays,
    rows: list,
    totals: [...totals.values()].map(finish).sort((a, b) => CURRENCIES.indexOf(a.currency) - CURRENCIES.indexOf(b.currency)),
    plans,
  };
}

module.exports = { buildBudget, listPlans, monthProgress };
