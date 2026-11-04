// Ana sayfa göstergeleri: kişinin bu ay/bu haftaki eforu, eksik efor girilen iş günleri;
// yönetici için ek olarak bütçe özeti, en çok çalışılan müşteriler ve ekibin eksik günleri.
const express = require('express');
const { all } = require('../../db');
const { date, r2 } = require('../../lib/validate');
const { auth, isAdmin } = require('../../lib/auth');
const { monthRange, holidayMap, dayValue, eachDay, isoDay, today: todayStr } = require('../../lib/workdays');
const { buildBudget, monthProgress } = require('../budget/service');
const { HOURS_PER_DAY } = require('../activities');

const router = express.Router();

function weekRange(today) {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Pazartesi
  const from = isoDay(d);
  d.setDate(d.getDate() + 6);
  return [from, isoDay(d)];
}

const hoursByDay = (userId, from, to) => new Map(all(
  `SELECT date, SUM(hours) hours, SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END) billable
   FROM activities WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date`, userId, from, to).map((r) => [r.date, r]));

// Ay başından dünü de kapsayacak şekilde, hiç efor girilmemiş iş günleri
function missingDays(byDay, from, today, holidays) {
  const out = [];
  const yesterday = new Date(`${today}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const until = isoDay(yesterday);
  if (until < from) return out;
  eachDay(from, until, (d) => { if (dayValue(d, holidays) > 0 && !byDay.has(d)) out.push(d); });
  return out;
}

router.get('/api/dashboard', auth, (req, res) => {
  const today = req.query.today ? date(req.query.today, 'Bugün') : todayStr();
  const month = today.slice(0, 7);
  const [from, to] = monthRange(month);
  const [wFrom, wTo] = weekRange(today);
  const holidays = holidayMap(from < wFrom ? from : wFrom, to > wTo ? to : wTo);

  const monthDays = hoursByDay(req.user.id, from, to);
  const weekDays = hoursByDay(req.user.id, wFrom, wTo);
  const sum = (m, k) => r2([...m.values()].reduce((a, r) => a + r[k], 0));
  const week = [];
  eachDay(wFrom, wTo, (d) => week.push({ date: d, hours: r2(weekDays.get(d)?.hours || 0), workday: dayValue(d, holidays), holiday: holidays.get(d)?.name || null }));

  const result = {
    today,
    month,
    business_days: (({ total, elapsed, remaining }) => ({ total, elapsed, remaining }))(monthProgress(month, today)),
    me: {
      month_hours: sum(monthDays, 'hours'),
      month_billable_hours: sum(monthDays, 'billable'),
      month_days: r2(sum(monthDays, 'billable') / HOURS_PER_DAY),
      week_hours: sum(weekDays, 'hours'),
      week,
      missing: missingDays(monthDays, from, today, holidays),
    },
  };

  if (isAdmin(req)) {
    result.budget = buildBudget(month, today).totals;
    result.top_customers = all(`SELECT cu.id, cu.name, SUM(a.hours) hours FROM activities a
      JOIN companies co ON co.id = a.company_id JOIN customers cu ON cu.id = co.customer_id
      WHERE a.date BETWEEN ? AND ? GROUP BY cu.id ORDER BY hours DESC LIMIT 5`, from, to)
      .map((r) => ({ ...r, hours: r2(r.hours), days: r2(r.hours / HOURS_PER_DAY) }));
    result.team = all("SELECT id, full_name FROM users WHERE active = 1 AND username != 'yerel' ORDER BY full_name").map((u) => {
      const byDay = hoursByDay(u.id, from, to);
      return { id: u.id, full_name: u.full_name, month_hours: sum(byDay, 'hours'), missing: missingDays(byDay, from, today, holidays).length };
    });
  }
  res.json(result);
});

module.exports = { router };
