// Muhasebe tanımları: kasa/banka hesapları, tedarikçiler, gelir/gider kategorileri, döviz kurları
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { HttpError, bad, asyncHandler } = require('../../lib/http');
const { str, num, int, date, flag, currency, email } = require('../../lib/validate');
const { auth, requirePerm } = require('../../lib/auth');
const { today } = require('../../lib/workdays');
const audit = require('../../lib/audit');
const { fetchTcmb, rateFor, listRates, saveRates } = require('./rates');
const { accountBalance, toTry } = require('./ledger');

const router = express.Router();
const view = requirePerm('accounting.view');
const edit = requirePerm('accounting.edit');
const activeOf = (b) => (b.active === undefined ? 1 : flag(b.active));
const existing = (table, id) => {
  const row = audit.snapshot(table, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı');
  return row;
};

// Basit ekle/güncelle uç noktaları (işlem kaydıyla)
function crud(path, table, cols, fields) {
  router.post(path, auth, edit, (req, res) => {
    const values = fields(req.body);
    const id = tx(() => {
      const { lastInsertRowid } = run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...values);
      audit.logCreate(req, table, Number(lastInsertRowid));
      return Number(lastInsertRowid);
    });
    res.json({ id });
  });
  router.put(`${path}/:id`, auth, edit, (req, res) => {
    const before = existing(table, Number(req.params.id));
    const values = fields(req.body);
    tx(() => {
      run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...values, before.id);
      audit.logUpdate(req, table, before);
    });
    res.json({ ok: true });
  });
}

// ---------- Kasa / banka hesapları ----------
router.get('/api/accounts', auth, view, (req, res) => {
  res.json(all('SELECT * FROM accounts ORDER BY active DESC, type, name').map((a) => {
    const balance = accountBalance(a);
    return { ...a, balance, balance_try: toTry(balance, a.currency, today()) };
  }));
});
crud('/api/accounts', 'accounts', ['name', 'type', 'currency', 'iban', 'opening_balance', 'opening_date', 'active'], (b) => [
  str(b.name, 'Hesap adı'), b.type === 'cash' ? 'cash' : 'bank', currency(b.currency || 'TRY'),
  str(b.iban, '', false).replace(/\s+/g, '').toUpperCase(), num(b.opening_balance, 'Açılış bakiyesi', { required: false, min: -1e12 }) ?? 0,
  b.opening_date ? date(b.opening_date, 'Açılış tarihi') : today(), activeOf(b),
]);

// ---------- Tedarikçiler ----------
router.get('/api/suppliers', auth, view, (req, res) => res.json(all('SELECT * FROM suppliers ORDER BY active DESC, name')));
crud('/api/suppliers', 'suppliers', ['name', 'tax_no', 'tax_office', 'address', 'email', 'phone', 'payment_days', 'notes', 'active'], (b) => {
  const taxNo = str(b.tax_no, '', false).replace(/\s+/g, '');
  if (taxNo.length > 11) bad('VKN / TCKN en fazla 11 karakter olabilir');
  return [str(b.name, 'Tedarikçi unvanı'), taxNo, str(b.tax_office, '', false), str(b.address, '', false), email(b.email),
    str(b.phone, '', false), int(b.payment_days, 'Vade', { required: false }) ?? 30, str(b.notes, '', false), activeOf(b)];
});

// ---------- Kategoriler ----------
router.get('/api/categories', auth, view, (req, res) => res.json(all('SELECT * FROM categories ORDER BY kind, name')));
crud('/api/categories', 'categories', ['kind', 'name', 'active'], (b) => [b.kind === 'income' ? 'income' : 'expense', str(b.name, 'Kategori adı'), activeOf(b)]);

// ---------- Döviz kurları ----------
router.get('/api/rates', auth, view, (req, res) => res.json(listRates(Number(req.query.limit) || 60)));

// İşlem formları için önerilen kur (tarihte veya öncesindeki en yakın)
router.get('/api/rates/for', auth, view, (req, res) => {
  const cur = currency(req.query.currency);
  const r = rateFor(cur, date(req.query.date || today()), req.query.side === 'selling' ? 'selling' : 'buying');
  res.json(r || { rate: null });
});

router.post('/api/rates/refresh', auth, edit, asyncHandler(async (req, res) => {
  try {
    const r = await fetchTcmb(req.body.date ? date(req.body.date) : null);
    audit.record(req, 'update', 'exchange_rates', null, { tarih: r.date, kaynak: 'TCMB' });
    res.json(r);
  } catch (err) {
    throw new HttpError(502, `TCMB'den kur alınamadı: ${err.message}. Kuru elle girebilirsiniz.`);
  }
}));

router.post('/api/rates', auth, edit, (req, res) => {
  const b = req.body;
  const cur = currency(b.currency);
  if (cur === 'TRY') bad('TL için kur girilmez');
  const rate = { currency: cur, buying: num(b.buying, 'Alış kuru'), selling: num(b.selling ?? b.buying, 'Satış kuru') };
  if (!(rate.buying > 0) || !(rate.selling > 0)) bad('Kur sıfırdan büyük olmalı');
  const d = date(b.date);
  saveRates({ date: d, rates: [rate] }, 'manual');
  audit.record(req, 'update', 'exchange_rates', null, { tarih: d, ...rate, kaynak: 'elle' });
  res.json({ ok: true });
});

module.exports = { router, existing };
