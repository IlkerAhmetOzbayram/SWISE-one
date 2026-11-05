// Şirket ve vergi ayarları
const express = require('express');
const { all, run, tx } = require('../../db');
const { str, num, flag } = require('../../lib/validate');
const { auth, requirePerm } = require('../../lib/auth');
const audit = require('../../lib/audit');

const router = express.Router();

const getSettings = () => Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));

router.get('/api/settings', auth, (req, res) => res.json(getSettings()));

router.put('/api/settings', auth, requirePerm('settings.edit'), (req, res) => {
  const b = req.body;
  const values = {
    company_name: str(b.company_name, 'Şirket adı'),
    vat_rate: String(num(b.vat_rate, 'KDV oranı')),
    withholding_rate: String(num(b.withholding_rate, 'Stopaj oranı')),
    expense_categories: str(b.expense_categories, 'Masraf kategorileri'),
    // Personel kendi maaş geçmişini görebilir mi
    show_own_salary: flag(b.show_own_salary) ? '1' : '0',
  };
  tx(() => {
    const before = getSettings();
    for (const [k, v] of Object.entries(values)) {
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
    }
    const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => before[k] !== v).map(([k, v]) => [k, [before[k] ?? null, v]]));
    if (Object.keys(diff).length) audit.record(req, 'update', 'settings', null, diff);
  });
  res.json(getSettings());
});

module.exports = { router, getSettings };
