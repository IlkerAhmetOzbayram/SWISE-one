// Faturalar (kayıt amaçlı; resmi e-fatura kesilmez).
//   Giden: müşteri şirketi; elle veya dönemin faturalanmamış aktivite/masraflarından taslak.
//          Faturaya giren aktivite ve masraflar işaretlenir (çift faturalama önlenir).
//   Gelen: tedarikçi; belge eki (PDF/XML) yüklenebilir.
//   Durum: taslak → kesildi (numara girilir) → iptal. Ödeme durumu tahsilat/ödemelerden hesaplanır.
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { one, all, run, tx } = require('../../db');
const { HttpError, bad } = require('../../lib/http');
const { str, num, date, currency, r2 } = require('../../lib/validate');
const { auth, requirePerm } = require('../../lib/auth');
const { today, isoDay } = require('../../lib/workdays');
const { getSettings } = require('../settings');
const { HOURS_PER_DAY } = require('../activities');
const audit = require('../../lib/audit');
const { rateFor } = require('./rates');
const { computeInvoice, invoiceState } = require('./ledger');

const router = express.Router();
const view = requirePerm('accounting.view');
const edit = requirePerm('accounting.edit');

// Yerel tarihle gün ekler (toISOString UTC'ye çevirdiği için Türkiye saatinde bir gün kayardı)
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return isoDay(x); };
const fmt = (d) => d.split('-').reverse().join('.');

const LIST = `SELECT i.*, co.name company_name, cu.name customer_name, s.name supplier_name, c.name category_name
  FROM invoices i LEFT JOIN companies co ON co.id = i.company_id LEFT JOIN customers cu ON cu.id = co.customer_id
  LEFT JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN categories c ON c.id = i.category_id`;

const withState = (inv) => ({ ...inv, party_name: inv.direction === 'out' ? inv.company_name : inv.supplier_name, ...invoiceState(inv) });

function findInvoice(id) {
  const inv = one(`${LIST} WHERE i.id = ?`, id);
  if (!inv) throw new HttpError(404, 'Fatura bulunamadı');
  return inv;
}

router.get('/api/invoices', auth, view, (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.direction) { where.push('i.direction = ?'); params.push(q.direction === 'in' ? 'in' : 'out'); }
  if (q.from) { where.push('i.issue_date >= ?'); params.push(date(q.from)); }
  if (q.to) { where.push('i.issue_date <= ?'); params.push(date(q.to)); }
  if (q.company_id) { where.push('i.company_id = ?'); params.push(Number(q.company_id)); }
  if (q.supplier_id) { where.push('i.supplier_id = ?'); params.push(Number(q.supplier_id)); }
  let rows = all(`${LIST} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.issue_date DESC, i.id DESC`, ...params).map(withState);
  if (q.payment_status) rows = rows.filter((r) => r.payment_status === q.payment_status || (q.payment_status === 'overdue' && r.overdue_days > 0));
  res.json(rows);
});

router.get('/api/invoices/:id', auth, view, (req, res) => {
  const inv = findInvoice(Number(req.params.id));
  res.json({
    ...withState(inv),
    lines: all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position', inv.id),
    payments: all(`SELECT t.*, a.name account_name, a.currency account_currency FROM transactions t JOIN accounts a ON a.id = t.account_id
                   WHERE t.invoice_id = ? ORDER BY t.date`, inv.id),
    linked_activities: one('SELECT COUNT(*) n FROM activities WHERE invoice_id = ?', inv.id).n,
    linked_expenses: one('SELECT COUNT(*) n FROM expenses WHERE invoice_id = ?', inv.id).n,
  });
});

// ---------- Başlık ve kalem doğrulama ----------
function partyDefaults(direction, b) {
  const s = getSettings();
  if (direction === 'out') {
    const co = one(`SELECT co.id, co.vat_exempt, co.withholding, COALESCE(co.currency, cu.currency) currency,
                    COALESCE(co.payment_days, cu.payment_days) payment_days FROM companies co JOIN customers cu ON cu.id = co.customer_id
                    WHERE co.id = ?`, num(b.company_id, 'Müşteri / şirket'));
    if (!co) bad('Şirket bulunamadı');
    return { company_id: co.id, supplier_id: null, currency: co.currency, payment_days: co.payment_days,
      vat_rate: co.vat_exempt ? 0 : Number(s.vat_rate), withholding_rate: co.withholding ? Number(s.withholding_rate) : 0,
      category: 'Hizmet geliri', kind: 'income' };
  }
  const sup = one('SELECT id, payment_days FROM suppliers WHERE id = ?', num(b.supplier_id, 'Tedarikçi'));
  if (!sup) bad('Tedarikçi bulunamadı');
  return { company_id: null, supplier_id: sup.id, currency: 'TRY', payment_days: sup.payment_days,
    vat_rate: Number(s.vat_rate), withholding_rate: 0, category: 'Diğer gider', kind: 'expense' };
}

function headerFields(direction, b) {
  const d = partyDefaults(direction, b);
  const issueDate = b.issue_date ? date(b.issue_date, 'Fatura tarihi') : today();
  const cur = currency(b.currency || d.currency);
  // Kur: girilmediyse tarihteki TCMB kuru (giden: alış, gelen: satış)
  let rate = num(b.rate, 'Kur', { required: false });
  if (!rate) {
    const r = rateFor(cur, issueDate, direction === 'out' ? 'buying' : 'selling');
    if (!r) bad(`${issueDate} için ${cur} kuru yok; kuru elle girin veya Kurlar'dan güncelleyin`);
    rate = r.rate;
  }
  let categoryId = b.category_id ? Number(b.category_id) : one('SELECT id FROM categories WHERE kind = ? AND name = ?', d.kind, d.category)?.id;
  if (categoryId) {
    const c = one('SELECT kind FROM categories WHERE id = ?', categoryId);
    if (!c) bad('Kategori bulunamadı');
    if (c.kind !== d.kind) bad(direction === 'out' ? 'Giden faturada gelir kategorisi seçilmeli' : 'Gelen faturada gider kategorisi seçilmeli');
  }
  return {
    company_id: d.company_id, supplier_id: d.supplier_id, number: str(b.number, '', false), issue_date: issueDate,
    due_date: b.due_date ? date(b.due_date, 'Vade tarihi') : addDays(issueDate, d.payment_days), currency: cur, rate,
    category_id: categoryId ?? null, description: str(b.description, '', false),
    vat_rate: num(b.vat_rate, 'KDV oranı', { required: false }) ?? d.vat_rate,
    withholding_rate: num(b.withholding_rate, 'Stopaj oranı', { required: false }) ?? d.withholding_rate,
    notes: str(b.notes, '', false),
  };
}

function lineFields(list) {
  if (!Array.isArray(list) || !list.length) bad('En az bir kalem girilmeli');
  return list.map((l, i) => ({
    position: i + 1, description: str(l.description, `${i + 1}. kalem açıklaması`),
    quantity: num(l.quantity ?? 1, `${i + 1}. kalem miktarı`), unit: str(l.unit, '', false),
    unit_price: num(l.unit_price, `${i + 1}. kalem birim fiyatı`), is_service: l.is_service === false || l.is_service === 0 ? 0 : 1,
  }));
}

const COLS = ['company_id', 'supplier_id', 'number', 'issue_date', 'due_date', 'currency', 'rate', 'category_id', 'description',
  'vat_rate', 'withholding_rate', 'notes'];

function saveInvoice(id, direction, h, lines, createdBy) {
  const t = computeInvoice(lines, h.vat_rate, h.withholding_rate);
  const amounts = [t.subtotal, t.vat, t.withholding, t.total, t.net];
  if (id) {
    run(`UPDATE invoices SET ${COLS.map((c) => `${c} = ?`).join(', ')}, subtotal = ?, vat = ?, withholding = ?, total = ?, net = ? WHERE id = ?`,
      ...COLS.map((c) => h[c]), ...amounts, id);
  } else {
    id = Number(run(`INSERT INTO invoices (direction, ${COLS.join(', ')}, subtotal, vat, withholding, total, net, created_by)
      VALUES (?, ${COLS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?)`, direction, ...COLS.map((c) => h[c]), ...amounts, createdBy).lastInsertRowid);
  }
  run('DELETE FROM invoice_lines WHERE invoice_id = ?', id);
  for (const l of t.lines) {
    run(`INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit, unit_price, line_total, is_service)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, l.position, l.description, l.quantity, l.unit, l.unit_price, l.line_total, l.is_service);
  }
  return { id, ...t };
}

// ---------- Elle fatura ----------
router.post('/api/invoices', auth, edit, (req, res) => {
  const direction = req.body.direction === 'in' ? 'in' : 'out';
  const h = headerFields(direction, req.body);
  const lines = lineFields(req.body.lines);
  const r = tx(() => {
    const saved = saveInvoice(null, direction, h, lines, req.user.id);
    audit.record(req, 'create', 'invoices', saved.id, { direction, total: saved.total, currency: h.currency });
    return saved;
  });
  res.json({ id: r.id, total: r.total, net: r.net });
});

// ---------- Aktivite ve masraflardan giden fatura taslağı ----------
router.post('/api/invoices/from-activities', auth, edit, (req, res) => {
  const b = req.body;
  const from = date(b.from, 'Başlangıç');
  const to = date(b.to, 'Bitiş');
  const h = headerFields('out', { ...b, issue_date: b.issue_date || today() });
  const acts = all(`SELECT a.project_id, p.name project_name, a.daily_rate, a.currency, SUM(a.hours) hours, MIN(a.date) first, MAX(a.date) last,
                      GROUP_CONCAT(a.id) ids
                    FROM activities a LEFT JOIN projects p ON p.id = a.project_id
                    WHERE a.company_id = ? AND a.billable = 1 AND a.invoice_id IS NULL AND a.date BETWEEN ? AND ?
                    GROUP BY a.project_id, a.daily_rate, a.currency ORDER BY p.name`, h.company_id, from, to);
  const exps = b.include_expenses === false ? [] : all(`SELECT category, currency, SUM(amount) amount, GROUP_CONCAT(id) ids FROM expenses
    WHERE company_id = ? AND billable = 1 AND status = 'approved' AND invoice_id IS NULL AND date BETWEEN ? AND ?
    GROUP BY category, currency ORDER BY category`, h.company_id, from, to);
  // Faturanın para birimindeki kayıtlar alınır; diğerleri ayrı fatura gerektirir
  const skipped = acts.filter((a) => a.currency !== h.currency).length + exps.filter((e) => e.currency !== h.currency).length;
  const useActs = acts.filter((a) => a.currency === h.currency);
  const useExps = exps.filter((e) => e.currency === h.currency);
  if (!useActs.length && !useExps.length) bad('Bu dönemde faturalanmamış faturalanabilir aktivite veya onaylı masraf yok');
  const period = `${fmt(from)}–${fmt(to)}`;
  const lines = [
    ...useActs.map((a) => ({
      description: `${a.project_name ? `${a.project_name} – ` : ''}Danışmanlık hizmeti (${period})`,
      quantity: r2(a.hours / HOURS_PER_DAY), unit: 'gün', unit_price: a.daily_rate,
      line_total: r2(a.hours * a.daily_rate / HOURS_PER_DAY), is_service: 1,
    })),
    ...useExps.map((e) => ({ description: `Yansıtılan masraf – ${e.category} (${period})`, quantity: 1, unit: 'adet',
      unit_price: r2(e.amount), line_total: r2(e.amount), is_service: 0 })),
  ].map((l, i) => ({ ...l, position: i + 1 }));
  if (!h.description) h.description = `${period} dönemi hizmet bedeli`;
  const r = tx(() => {
    const saved = saveInvoice(null, 'out', h, lines, req.user.id);
    for (const a of useActs) run(`UPDATE activities SET invoice_id = ? WHERE id IN (${a.ids.split(',').map(Number).join(',')})`, saved.id);
    for (const e of useExps) run(`UPDATE expenses SET invoice_id = ? WHERE id IN (${e.ids.split(',').map(Number).join(',')})`, saved.id);
    audit.record(req, 'create', 'invoices', saved.id, { direction: 'out', kaynak: 'aktiviteler', donem: period, total: saved.total, currency: h.currency });
    return saved;
  });
  res.json({ id: r.id, total: r.total, net: r.net, lines: r.lines.length, skipped_other_currency: skipped });
});

// ---------- Düzenleme, kesme, iptal, silme ----------
// Taslak tamamen düzenlenir; kesilmiş faturada yalnızca numara, vade ve not değişir
router.put('/api/invoices/:id', auth, edit, (req, res) => {
  const inv = findInvoice(Number(req.params.id));
  if (inv.status === 'cancelled') bad('İptal edilmiş fatura değiştirilemez');
  tx(() => {
    if (inv.status === 'draft') {
      saveInvoice(inv.id, inv.direction, headerFields(inv.direction, { ...inv, ...req.body }), lineFields(req.body.lines));
    } else {
      run('UPDATE invoices SET number = ?, due_date = ?, notes = ? WHERE id = ?', str(req.body.number ?? inv.number, 'Fatura numarası'),
        req.body.due_date ? date(req.body.due_date, 'Vade') : inv.due_date, str(req.body.notes ?? inv.notes, '', false), inv.id);
    }
    audit.record(req, 'update', 'invoices', inv.id, { number: inv.number });
  });
  res.json({ ok: true });
});

router.post('/api/invoices/:id/issue', auth, edit, (req, res) => {
  const inv = findInvoice(Number(req.params.id));
  if (inv.status !== 'draft') bad('Yalnızca taslak fatura kesilebilir');
  const number = str(req.body.number || inv.number, inv.direction === 'out' ? 'E-fatura / fatura numarası' : 'Belge numarası');
  tx(() => {
    run("UPDATE invoices SET status = 'issued', number = ? WHERE id = ?", number, inv.id);
    audit.record(req, 'issue', 'invoices', inv.id, { number, net: inv.net, currency: inv.currency });
  });
  res.json({ ok: true });
});

const unlink = (id) => {
  run('UPDATE activities SET invoice_id = NULL WHERE invoice_id = ?', id);
  run('UPDATE expenses SET invoice_id = NULL WHERE invoice_id = ?', id);
};

router.post('/api/invoices/:id/cancel', auth, edit, (req, res) => {
  const inv = findInvoice(Number(req.params.id));
  if (inv.status !== 'issued') bad('Yalnızca kesilmiş fatura iptal edilebilir');
  if (one('SELECT 1 FROM transactions WHERE invoice_id = ?', inv.id)) bad('Tahsilat/ödeme bağlı fatura iptal edilemez; önce hareketleri silin');
  tx(() => {
    run("UPDATE invoices SET status = 'cancelled' WHERE id = ?", inv.id);
    unlink(inv.id);
    audit.record(req, 'cancel', 'invoices', inv.id, { number: inv.number, note: str(req.body.note, '', false) });
  });
  res.json({ ok: true });
});

router.delete('/api/invoices/:id', auth, edit, (req, res) => {
  const inv = findInvoice(Number(req.params.id));
  if (inv.status !== 'draft') bad('Yalnızca taslak fatura silinebilir');
  tx(() => {
    unlink(inv.id);
    run('DELETE FROM invoices WHERE id = ?', inv.id);
    audit.record(req, 'delete', 'invoices', inv.id, { direction: inv.direction, total: inv.total });
  });
  res.json({ ok: true });
});

// ---------- Ek (gelen fatura PDF/XML vb.) ----------
const ATTACH_EXT = ['pdf', 'xml', 'jpg', 'jpeg', 'png', 'zip'];

router.post('/api/invoices/:id/attachment', auth, edit, express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  const inv = findInvoice(Number(req.params.id));
  const name = decodeURIComponent(String(req.headers['x-file-name'] || '')).replace(/[\\/]/g, '_');
  const ext = name.split('.').pop().toLowerCase();
  if (!ATTACH_EXT.includes(ext)) bad(`Ek şu biçimlerden biri olmalı: ${ATTACH_EXT.join(', ')}`);
  if (!Buffer.isBuffer(req.body) || !req.body.length) bad('Dosya boş');
  const rel = path.join('invoices', `${inv.id}-${Date.now()}.${ext}`);
  fs.mkdirSync(path.join(config.uploadDir, 'invoices'), { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, rel), req.body);
  tx(() => {
    run('UPDATE invoices SET attachment_path = ?, attachment_name = ? WHERE id = ?', rel, name, inv.id);
    audit.record(req, 'attach', 'invoices', inv.id, { file: name });
  });
  res.json({ ok: true });
});

router.get('/api/invoices/:id/attachment', auth, view, (req, res) => {
  const inv = findInvoice(Number(req.params.id));
  if (!inv.attachment_path) throw new HttpError(404, 'Ek yok');
  res.download(path.join(config.uploadDir, inv.attachment_path), inv.attachment_name);
});

module.exports = { router };
