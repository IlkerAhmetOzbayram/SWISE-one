// Şirket ve vergi ayarları
const express = require('express');
const { all, run, tx } = require('../../db');
const { str, num, flag } = require('../../lib/validate');
const { bad } = require('../../lib/http');
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

// Teklif şablonu: numara öneki, imza yetkilisi, TR/EN varsayılan metinler
const TEMPLATE_KEYS = ['offer_signatory_name', 'offer_signatory_title', 'offer_signatory_title_en',
  'offer_intro_tr', 'offer_intro_en', 'offer_assumptions_tr', 'offer_assumptions_en', 'offer_terms_tr', 'offer_terms_en'];

router.put('/api/settings/offer-template', auth, requirePerm('settings.edit'), (req, res) => {
  const b = req.body;
  const prefix = str(b.offer_number_prefix, 'Numara öneki').toUpperCase();
  if (!/^[A-Z0-9-]{1,12}$/.test(prefix)) bad('Numara öneki yalnızca harf, rakam ve tire içerebilir (en fazla 12)');
  const values = { offer_number_prefix: prefix, ...Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, str(b[k], '', false)])) };
  tx(() => {
    const before = getSettings();
    for (const [k, v] of Object.entries(values)) {
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
    }
    const changed = Object.keys(values).filter((k) => before[k] !== values[k]);
    if (changed.length) audit.record(req, 'update', 'settings', null, { changed_fields: changed });
  });
  res.json(getSettings());
});

module.exports = { router, getSettings };
