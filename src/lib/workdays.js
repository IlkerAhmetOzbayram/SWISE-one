// İş günü hesabı: Pazartesi–Cuma, resmi tatiller düşülür (yarım gün tatil = 0,5 gün)
const { all } = require('../db');

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => new Date(`${s}T00:00:00`);
const today = () => isoDay(new Date());

// "2026-11" → ["2026-11-01", "2026-11-30"]
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return [`${month}-01`, isoDay(new Date(y, m, 0))];
}

const holidayMap = (from, to) =>
  new Map(all('SELECT date, name, kind FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date', from, to).map((h) => [h.date, { ...h }]));

// Günün iş günü değeri: 1, 0,5 (yarım gün tatil) veya 0
function dayValue(date, holidays) {
  const wd = parse(date).getDay();
  if (wd === 0 || wd === 6) return 0;
  const h = holidays.get(date);
  if (!h) return 1;
  return h.kind === 'half' ? 0.5 : 0;
}

function eachDay(from, to, fn) {
  for (let d = parse(from); isoDay(d) <= to; d.setDate(d.getDate() + 1)) fn(isoDay(d));
}

function businessDays(from, to, holidays = holidayMap(from, to)) {
  let n = 0;
  eachDay(from, to, (d) => { n += dayValue(d, holidays); });
  return n;
}

module.exports = { isoDay, today, monthRange, holidayMap, dayValue, eachDay, businessDays };
