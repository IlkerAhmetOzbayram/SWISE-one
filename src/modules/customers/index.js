// Müşteriler (grup), şirketler (fatura birimi), iletişim kişileri ve projeler.
// Ücret önceliği: proje → şirket → müşteri. Para birimi: şirket → müşteri.
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { bad, HttpError } = require('../../lib/http');
const { str, num, int, flag, currency, email } = require('../../lib/validate');
const { auth, can, requirePerm } = require('../../lib/auth');
const audit = require('../../lib/audit');

const router = express.Router();

const existing = (table, id) => {
  const row = audit.snapshot(table, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı');
  return row;
};
const activeFlag = (b) => (b.active === undefined ? 1 : flag(b.active));
const edit = requirePerm('customers.edit');

// Ücret alanları yalnızca "ücretleri görme" yetkisiyle döner
const RATE_KEYS = ['daily_rate', 'effective_daily_rate'];
const withoutRates = (req, rows) => (can(req, 'rates.view') ? rows : rows.map((r) => {
  const o = { ...r };
  for (const k of RATE_KEYS) delete o[k];
  return o;
}));

// ---------- Müşteriler ----------
// Kayıt girişi için herkes müşteri adlarını görür; ayrıntılar "müşterileri görme" yetkisiyle
router.get('/api/customers', auth, (req, res) => {
  const cols = can(req, 'customers.view')
    ? `cu.*, m.full_name manager_name, (SELECT COUNT(*) FROM companies co WHERE co.customer_id = cu.id) company_count`
    : 'cu.id, cu.name, cu.active, cu.manager_id';
  res.json(withoutRates(req, all(`SELECT ${cols} FROM customers cu LEFT JOIN users m ON m.id = cu.manager_id ORDER BY cu.name`)));
});

// Sorumlu proje yöneticisi (isteğe bağlı) aktif bir kullanıcı olmalı
function managerOf(b) {
  if (!b.manager_id) return null;
  const id = Number(b.manager_id);
  if (!one('SELECT id FROM users WHERE id = ? AND active = 1', id)) bad('Sorumlu kişi bulunamadı');
  return id;
}

const customerFields = (b) => [
  str(b.name, 'Müşteri adı'), num(b.daily_rate, 'Günlük ücret'), currency(b.currency),
  int(b.payment_days, 'Ödeme vadesi', { required: false }) ?? 30, str(b.notes, '', false), activeFlag(b), managerOf(b),
];

// VKN (10 hane) / TCKN (11 hane); yurt dışı vergi numaraları harf içerebilir. En fazla 11 karakter.
function taxNo(v) {
  const s = str(v, 'VKN / TCKN', false).replace(/\s+/g, '');
  if (s.length > 11) bad('VKN / TCKN en fazla 11 karakter olabilir');
  if (s && !/^[0-9A-Za-z]+$/.test(s)) bad('VKN / TCKN yalnızca rakam ve harf içerebilir');
  return s;
}

function companyFields(b, customerId, { inherit = true } = {}) {
  return [
    customerId, str(b.company_name ?? b.name, 'Şirket unvanı'), taxNo(b.tax_no), str(b.tax_office, '', false),
    str(b.address, '', false), email(b.email), str(b.phone, '', false),
    inherit ? num(b.daily_rate, 'Günlük ücret', { required: false }) : null,
    inherit ? currency(b.currency, 'Para birimi', false) : null,
    inherit ? int(b.payment_days, 'Ödeme vadesi', { required: false }) : null,
    flag(b.withholding), flag(b.vat_exempt), activeFlag(b),
  ];
}

const INSERT_COMPANY = `INSERT INTO companies (customer_id, name, tax_no, tax_office, address, email, phone,
  daily_rate, currency, payment_days, withholding, vat_exempt, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// Yeni müşteri, ilk şirketiyle (fatura bilgileri) birlikte oluşturulur
router.post('/api/customers', auth, edit, (req, res) => {
  const b = req.body;
  const result = tx(() => {
    const { lastInsertRowid } = run(
      'INSERT INTO customers (name, daily_rate, currency, payment_days, notes, active, manager_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ...customerFields(b));
    const id = Number(lastInsertRowid);
    audit.logCreate(req, 'customers', id);
    let companyId = null;
    if (b.create_company !== false) {
      // Şirket ücret/para birimi/vadeyi müşteriden devralır
      companyId = Number(run(INSERT_COMPANY, ...companyFields({ ...b, company_name: b.company_name || b.name }, id, { inherit: false })).lastInsertRowid);
      audit.logCreate(req, 'companies', companyId);
    }
    return { id, company_id: companyId };
  });
  res.json(result);
});

router.put('/api/customers/:id', auth, edit, (req, res) => {
  const before = existing('customers', Number(req.params.id));
  tx(() => {
    run('UPDATE customers SET name = ?, daily_rate = ?, currency = ?, payment_days = ?, notes = ?, active = ?, manager_id = ? WHERE id = ?',
      ...customerFields(req.body), before.id);
    audit.logUpdate(req, 'customers', before);
  });
  res.json({ ok: true });
});

// ---------- Şirketler ----------
router.get('/api/companies', auth, (req, res) => {
  const cols = can(req, 'customers.view')
    ? `co.*, COALESCE(co.daily_rate, cu.daily_rate) effective_daily_rate,
       COALESCE(co.currency, cu.currency) effective_currency,
       COALESCE(co.payment_days, cu.payment_days) effective_payment_days`
    : 'co.id, co.customer_id, co.name, co.active, COALESCE(co.currency, cu.currency) effective_currency';
  // "usable": şirket ve müşterisi aktifse yeni kayıt girilebilir
  res.json(withoutRates(req, all(`SELECT ${cols}, cu.name customer_name, (co.active AND cu.active) usable
                FROM companies co JOIN customers cu ON cu.id = co.customer_id ORDER BY cu.name, co.name`)));
});

function customerOf(b) {
  const id = num(b.customer_id, 'Müşteri');
  if (!one('SELECT id FROM customers WHERE id = ?', id)) bad('Müşteri bulunamadı');
  return id;
}

router.post('/api/companies', auth, edit, (req, res) => {
  const id = tx(() => {
    const { lastInsertRowid } = run(INSERT_COMPANY, ...companyFields(req.body, customerOf(req.body)));
    audit.logCreate(req, 'companies', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/companies/:id', auth, edit, (req, res) => {
  const before = existing('companies', Number(req.params.id));
  tx(() => {
    run(`UPDATE companies SET customer_id = ?, name = ?, tax_no = ?, tax_office = ?, address = ?, email = ?, phone = ?,
         daily_rate = ?, currency = ?, payment_days = ?, withholding = ?, vat_exempt = ?, active = ? WHERE id = ?`,
      ...companyFields(req.body, customerOf(req.body)), before.id);
    audit.logUpdate(req, 'companies', before);
  });
  res.json({ ok: true });
});

// ---------- İletişim kişileri ----------
router.get('/api/contacts', auth, requirePerm('customers.view'), (req, res) => {
  const where = req.query.customer_id ? 'WHERE ct.customer_id = ?' : '';
  const params = req.query.customer_id ? [Number(req.query.customer_id)] : [];
  res.json(all(`SELECT ct.*, co.name company_name FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
                ${where} ORDER BY ct.full_name`, ...params));
});

function contactFields(b) {
  const customerId = customerOf(b);
  let companyId = null;
  if (b.company_id) {
    companyId = Number(b.company_id);
    if (!one('SELECT id FROM companies WHERE id = ? AND customer_id = ?', companyId, customerId)) bad('Şirket bu müşteriye ait değil');
  }
  return [customerId, companyId, str(b.full_name, 'Ad soyad'), str(b.title, '', false), email(b.email),
    str(b.phone, '', false), flag(b.receives_offers), flag(b.receives_invoices), str(b.notes, '', false), activeFlag(b)];
}

router.post('/api/contacts', auth, edit, (req, res) => {
  const id = tx(() => {
    const { lastInsertRowid } = run(`INSERT INTO contacts (customer_id, company_id, full_name, title, email, phone,
      receives_offers, receives_invoices, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...contactFields(req.body));
    audit.logCreate(req, 'contacts', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/contacts/:id', auth, edit, (req, res) => {
  const before = existing('contacts', Number(req.params.id));
  tx(() => {
    run(`UPDATE contacts SET customer_id = ?, company_id = ?, full_name = ?, title = ?, email = ?, phone = ?,
         receives_offers = ?, receives_invoices = ?, notes = ?, active = ? WHERE id = ?`, ...contactFields(req.body), before.id);
    audit.logUpdate(req, 'contacts', before);
  });
  res.json({ ok: true });
});

router.delete('/api/contacts/:id', auth, edit, (req, res) => {
  const before = existing('contacts', Number(req.params.id));
  tx(() => {
    run('DELETE FROM contacts WHERE id = ?', before.id);
    audit.logDelete(req, 'contacts', before);
  });
  res.json({ ok: true });
});

// ---------- Projeler ----------
// "usable": proje, şirketi ve müşterisi aktifse yeni kayıt girilebilir
router.get('/api/projects', auth, (req, res) => {
  const cols = can(req, 'customers.view')
    ? 'p.*, COALESCE(p.daily_rate, co.daily_rate, cu.daily_rate) effective_daily_rate'
    : 'p.id, p.company_id, p.name, p.active';
  res.json(withoutRates(req, all(`SELECT ${cols}, co.name company_name, co.customer_id, cu.name customer_name,
                COALESCE(co.currency, cu.currency) currency, (p.active AND co.active AND cu.active) usable
                FROM projects p JOIN companies co ON co.id = p.company_id JOIN customers cu ON cu.id = co.customer_id
                ORDER BY cu.name, co.name, p.name`)));
});

function projectFields(b) {
  const companyId = num(b.company_id, 'Şirket');
  if (!one('SELECT id FROM companies WHERE id = ?', companyId)) bad('Şirket bulunamadı');
  return [companyId, str(b.name, 'Proje adı'), num(b.daily_rate, 'Günlük ücret', { required: false }), activeFlag(b)];
}

router.post('/api/projects', auth, edit, (req, res) => {
  const id = tx(() => {
    const { lastInsertRowid } = run('INSERT INTO projects (company_id, name, daily_rate, active) VALUES (?, ?, ?, ?)',
      ...projectFields(req.body));
    audit.logCreate(req, 'projects', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

router.put('/api/projects/:id', auth, edit, (req, res) => {
  const before = existing('projects', Number(req.params.id));
  tx(() => {
    run('UPDATE projects SET company_id = ?, name = ?, daily_rate = ?, active = ? WHERE id = ?',
      ...projectFields(req.body), before.id);
    audit.logUpdate(req, 'projects', before);
  });
  res.json({ ok: true });
});

// Şirketin (ve varsa projenin) geçerli günlük ücreti ve para birimi
function resolveRate(companyId, projectId = null) {
  const r = one(`SELECT COALESCE((SELECT daily_rate FROM projects WHERE id = ?), co.daily_rate, cu.daily_rate) daily_rate,
                 COALESCE(co.currency, cu.currency) currency
                 FROM companies co JOIN customers cu ON cu.id = co.customer_id WHERE co.id = ?`, projectId, companyId);
  if (!r) bad('Şirket bulunamadı');
  return r;
}

module.exports = { router, resolveRate };
