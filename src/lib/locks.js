// Kayıt kilitleri: kapatılmış ay ve onaya gönderilmiş/onaylanmış hafta
const { one } = require('../db');
const { HttpError } = require('./http');
const { isoDay } = require('./workdays');
const { can } = require('./auth');

// Tarihin haftasının Pazartesi'si
function weekStartOf(date) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
}

const isMonthClosed = (date) => !!one('SELECT 1 FROM period_closures WHERE month = ?', date.slice(0, 7));

function checkMonth(date) {
  if (isMonthClosed(date)) throw new HttpError(423, `${date.slice(0, 7)} ayı kapatıldı; kayıt eklenemez veya değiştirilemez`);
}

// Aktivite: kapalı ay herkese kilitli. Onaylanmış hafta herkese kilitli (önce yeniden açılmalı);
// onaya gönderilmiş hafta, onay yetkisi olmayanlara kilitli.
function checkActivity(req, userId, date) {
  checkMonth(date);
  const ts = one('SELECT status FROM timesheets WHERE user_id = ? AND week_start = ?', userId, weekStartOf(date));
  if (ts?.status === 'approved') throw new HttpError(423, 'Bu hafta onaylandı; değişiklik için önce yeniden açılmalı');
  if (ts?.status === 'submitted' && !can(req, 'activities.approve')) throw new HttpError(423, 'Bu hafta onaya gönderildi; değiştirilemez');
}

module.exports = { weekStartOf, isMonthClosed, checkMonth, checkActivity };
