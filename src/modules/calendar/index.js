// Resmi tatiller / şirket izinleri ve iş günü bilgisi
const express = require('express');
const { all, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str, date } = require('../../lib/validate');
const { auth, admin } = require('../../lib/auth');
const { holidayMap, businessDays } = require('../../lib/workdays');
const audit = require('../../lib/audit');

const router = express.Router();

router.get('/api/holidays', auth, (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : String(new Date().getFullYear());
  res.json(all("SELECT * FROM holidays WHERE date LIKE ? || '-%' ORDER BY date", year));
});

// Dönemdeki iş günü sayısı ve tatiller (ekranlar ve tahmin için)
router.get('/api/workdays', auth, (req, res) => {
  const from = date(req.query.from, 'Başlangıç');
  const to = date(req.query.to, 'Bitiş');
  if (from > to) bad('Başlangıç bitişten sonra olamaz');
  const holidays = holidayMap(from, to);
  res.json({ from, to, business_days: businessDays(from, to, holidays), holidays: [...holidays.values()] });
});

const fields = (b) => [date(b.date), str(b.name, 'Açıklama'), b.kind === 'half' ? 'half' : 'full'];

router.post('/api/holidays', auth, admin, (req, res) => {
  const id = tx(() => {
    const { lastInsertRowid } = run('INSERT INTO holidays (date, name, kind) VALUES (?, ?, ?)', ...fields(req.body));
    audit.logCreate(req, 'holidays', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/holidays/:id', auth, admin, (req, res) => {
  const before = audit.snapshot('holidays', Number(req.params.id));
  if (!before) throw new HttpError(404, 'Kayıt bulunamadı');
  tx(() => {
    run('UPDATE holidays SET date = ?, name = ?, kind = ? WHERE id = ?', ...fields(req.body), before.id);
    audit.logUpdate(req, 'holidays', before);
  });
  res.json({ ok: true });
});

router.delete('/api/holidays/:id', auth, admin, (req, res) => {
  const before = audit.snapshot('holidays', Number(req.params.id));
  if (!before) throw new HttpError(404, 'Kayıt bulunamadı');
  tx(() => {
    run('DELETE FROM holidays WHERE id = ?', before.id);
    audit.logDelete(req, 'holidays', before);
  });
  res.json({ ok: true });
});

module.exports = { router };
