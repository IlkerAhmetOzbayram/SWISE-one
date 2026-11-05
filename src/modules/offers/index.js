// Teklifler: hazırlama, iç onay, PDF dondurma, imzalı dosya, gönderim, kabul/red ve revizyon.
// Durumlar: draft → pending_approval → approved (PDF donduruldu) → signed → sent → accepted / rejected
// Revizyon: approved/signed/sent/rejected → draft (revision + 1); önceki sürüm arşivde kalır.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { one, all, run, tx } = require('../../db');
const { HttpError, bad, asyncHandler } = require('../../lib/http');
const { str, num, int, date, currency, r2 } = require('../../lib/validate');
const { auth, can, requirePerm } = require('../../lib/auth');
const { today, isoDay } = require('../../lib/workdays');
const { getSettings } = require('../settings');
const { buildOfferPdf } = require('./pdf');
const audit = require('../../lib/audit');

const router = express.Router();
const KINDS = ['service', 'fixed', 'license'];
const SIGNED_EXT = ['pdf', 'p7s', 'p7m', 'imz', 'asice'];
const now = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

const BASE = `SELECT o.*, cu.name customer_name, cu.manager_id, co.name company_name, u.full_name created_by_name, ap.full_name approved_by_name
  FROM offers o JOIN customers cu ON cu.id = o.customer_id JOIN companies co ON co.id = o.company_id
  JOIN users u ON u.id = o.created_by LEFT JOIN users ap ON ap.id = o.approved_by`;

// Görme kapsamı: kendi hazırladıkları / sorumlu olduğu müşteriler + kendi / tümü
function scopeWhere(req) {
  const scope = can(req, 'offers.view');
  if (!scope) throw new HttpError(403, 'Teklifleri görme yetkiniz yok');
  if (scope === 'own') return { sql: 'o.created_by = ?', params: [req.user.id] };
  if (scope === 'assigned') return { sql: '(cu.manager_id = ? OR o.created_by = ?)', params: [req.user.id, req.user.id] };
  return { sql: '1 = 1', params: [] };
}

function validUntil(o) {
  const d = new Date(`${o.offer_date}T00:00:00`);
  d.setDate(d.getDate() + o.valid_days);
  return isoDay(d);
}
// Gönderilmiş ve geçerlilik süresi geçmiş teklif "süresi doldu" sayılır
const withExpiry = (o) => ({ ...o, valid_until: validUntil(o), expired: o.status === 'sent' && validUntil(o) < today() });

function computeTotals(o, items, payments, vatExempt) {
  const lines = items.map((it) => ({ ...it, line_total: r2(it.quantity * it.unit_price * (1 - it.discount_pct / 100)) }));
  const subtotal = r2(lines.reduce((a, l) => a + l.line_total, 0));
  const vat = r2(subtotal * o.vat_rate / 100);
  const total = r2(subtotal + vat);
  const paymentsTotal = r2(payments.reduce((a, p) => a + p.amount, 0));
  return {
    lines,
    totals: { subtotal, vat, total, vat_exempt: !!vatExempt, payments_total: paymentsTotal,
      payment_mismatch: payments.length > 0 && Math.abs(paymentsTotal - total) > 0.01 },
  };
}

function findOffer(req, id) {
  const w = scopeWhere(req);
  const o = one(`${BASE} WHERE o.id = ? AND ${w.sql}`, id, ...w.params);
  if (!o) throw new HttpError(404, 'Teklif bulunamadı');
  return o;
}

function detail(o) {
  const items = all('SELECT * FROM offer_items WHERE offer_id = ? ORDER BY position', o.id);
  const payments = all('SELECT * FROM offer_payments WHERE offer_id = ? ORDER BY position', o.id);
  const company = one('SELECT name, tax_no, tax_office, address, email, phone, vat_exempt FROM companies WHERE id = ?', o.company_id);
  const contact = o.contact_id ? one('SELECT id, full_name, title, email FROM contacts WHERE id = ?', o.contact_id) : null;
  const { lines, totals } = computeTotals(o, items, payments, company.vat_exempt);
  const versions = all(`SELECT v.id, v.revision, v.pdf_sha256, v.created_at, v.signed_name, v.signed_sha256, v.signed_at,
      ua.full_name approved_by_name, us.full_name signed_by_name
    FROM offer_versions v LEFT JOIN users ua ON ua.id = v.approved_by LEFT JOIN users us ON us.id = v.signed_by
    WHERE v.offer_id = ? ORDER BY v.revision DESC`, o.id);
  return { ...withExpiry(o), company, contact, items: lines, payments, totals, versions };
}

// Kişi bu teklifi düzenleyebilir mi (yetki + kapsam)
function checkEdit(req, o) {
  const scope = can(req, 'offers.edit');
  if (!scope) throw new HttpError(403, 'Teklif düzenleme yetkiniz yok');
  if (scope === 'own' && o.created_by !== req.user.id) throw new HttpError(403, 'Bu teklifi yalnızca hazırlayan düzenleyebilir');
}
const expectStatus = (o, ...statuses) => {
  if (!statuses.includes(o.status)) throw new HttpError(409, 'Teklifin durumu bu işleme uygun değil');
};

// ---------- Doğrulama ----------
function headerFields(req, b) {
  const companyId = num(b.company_id, 'Müşteri / şirket');
  const co = one(`SELECT co.id, co.customer_id, co.vat_exempt, COALESCE(co.currency, cu.currency) currency,
                  COALESCE(co.payment_days, cu.payment_days) payment_days, cu.manager_id
                  FROM companies co JOIN customers cu ON cu.id = co.customer_id WHERE co.id = ?`, companyId);
  if (!co) bad('Şirket bulunamadı');
  if (can(req, 'offers.view') === 'assigned' && co.manager_id !== req.user.id) {
    throw new HttpError(403, 'Bu müşteriye teklif hazırlama yetkiniz yok (sorumlusu değilsiniz)');
  }
  let contactId = null;
  if (b.contact_id) {
    contactId = Number(b.contact_id);
    if (!one('SELECT id FROM contacts WHERE id = ? AND customer_id = ?', contactId, co.customer_id)) bad('İlgili kişi bu müşteriye ait değil');
  }
  const validDays = int(b.valid_days, 'Geçerlilik süresi', { required: false }) ?? 30;
  if (validDays < 1) bad('Geçerlilik süresi en az 1 gün olmalı');
  return {
    customer_id: co.customer_id, company_id: companyId, contact_id: contactId,
    language: b.language === 'en' ? 'en' : 'tr',
    title: str(b.title, 'Konu'),
    offer_date: b.offer_date ? date(b.offer_date, 'Teklif tarihi') : today(),
    valid_days: validDays,
    currency: currency(b.currency || co.currency),
    payment_days: int(b.payment_days, 'Ödeme vadesi', { required: false }) ?? co.payment_days,
    vat_rate: co.vat_exempt ? 0 : Number(getSettings().vat_rate),
    intro: str(b.intro, '', false), scope: str(b.scope, '', false), assumptions: str(b.assumptions, '', false),
    terms: str(b.terms, '', false), internal_notes: str(b.internal_notes, '', false),
  };
}

function itemFields(list) {
  if (!Array.isArray(list) || !list.length) bad('En az bir kalem girilmeli');
  return list.map((it, i) => {
    const discount = num(it.discount_pct, 'İskonto', { required: false }) ?? 0;
    if (discount > 100) bad('İskonto %100\'den büyük olamaz');
    return {
      position: i + 1, kind: KINDS.includes(it.kind) ? it.kind : 'service',
      description: str(it.description, `${i + 1}. kalem açıklaması`), quantity: num(it.quantity, `${i + 1}. kalem miktarı`),
      unit: str(it.unit, '', false), unit_price: num(it.unit_price, `${i + 1}. kalem birim fiyatı`), discount_pct: discount,
    };
  });
}

function paymentFields(list = []) {
  if (!Array.isArray(list)) bad('Ödeme planı geçersiz');
  return list.filter((p) => p && (p.description || p.amount)).map((p, i) => ({
    position: i + 1, description: str(p.description, `${i + 1}. ödeme açıklaması`),
    amount: num(p.amount, `${i + 1}. ödeme tutarı`), due: str(p.due, '', false),
  }));
}

const HEADER_COLS = ['customer_id', 'company_id', 'contact_id', 'language', 'title', 'offer_date', 'valid_days', 'currency',
  'payment_days', 'vat_rate', 'intro', 'scope', 'assumptions', 'terms', 'internal_notes'];

function writeLines(offerId, items, payments) {
  run('DELETE FROM offer_items WHERE offer_id = ?', offerId);
  run('DELETE FROM offer_payments WHERE offer_id = ?', offerId);
  for (const it of items) {
    run(`INSERT INTO offer_items (offer_id, position, kind, description, quantity, unit, unit_price, discount_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, offerId, it.position, it.kind, it.description, it.quantity, it.unit, it.unit_price, it.discount_pct);
  }
  for (const p of payments) {
    run('INSERT INTO offer_payments (offer_id, position, description, amount, due) VALUES (?, ?, ?, ?, ?)',
      offerId, p.position, p.description, p.amount, p.due);
  }
}

// ---------- Liste, varsayılanlar, ayrıntı ----------
router.get('/api/offers', auth, (req, res) => {
  const w = scopeWhere(req);
  const where = [w.sql];
  const params = [...w.params];
  if (req.query.status) { where.push('o.status = ?'); params.push(String(req.query.status)); }
  if (req.query.customer_id) { where.push('o.customer_id = ?'); params.push(Number(req.query.customer_id)); }
  const rows = all(`SELECT o.id, o.number, o.revision, o.title, o.status, o.offer_date, o.valid_days, o.currency, o.language,
      o.vat_rate, o.customer_id, cu.name customer_name, co.name company_name, u.full_name created_by_name,
      COALESCE((SELECT SUM(quantity * unit_price * (1 - discount_pct / 100.0)) FROM offer_items WHERE offer_id = o.id), 0) subtotal
    FROM offers o JOIN customers cu ON cu.id = o.customer_id JOIN companies co ON co.id = o.company_id JOIN users u ON u.id = o.created_by
    WHERE ${where.join(' AND ')} ORDER BY o.year DESC, o.seq DESC`, ...params);
  res.json(rows.map((o) => ({ ...withExpiry(o), subtotal: r2(o.subtotal), total: r2(o.subtotal * (1 + o.vat_rate / 100)) })));
});

// Yeni teklif formu için: şirketin para birimi/vadesi, ilgili kişiler, şablon metinleri, (yetki varsa) günlük ücret
router.get('/api/offers/defaults', auth, requirePerm('offers.edit'), (req, res) => {
  const s = getSettings();
  const lang = req.query.language === 'en' ? 'en' : 'tr';
  const out = { templates: { intro: s[`offer_intro_${lang}`], assumptions: s[`offer_assumptions_${lang}`], terms: s[`offer_terms_${lang}`] } };
  if (req.query.company_id) {
    const co = one(`SELECT co.customer_id, co.vat_exempt, COALESCE(co.currency, cu.currency) currency,
                    COALESCE(co.payment_days, cu.payment_days) payment_days, COALESCE(co.daily_rate, cu.daily_rate) daily_rate
                    FROM companies co JOIN customers cu ON cu.id = co.customer_id WHERE co.id = ?`, Number(req.query.company_id));
    if (co) {
      Object.assign(out, { currency: co.currency, payment_days: co.payment_days, vat_exempt: !!co.vat_exempt,
        vat_rate: co.vat_exempt ? 0 : Number(s.vat_rate) });
      if (can(req, 'rates.view')) out.daily_rate = co.daily_rate;
      out.contacts = all(`SELECT id, full_name, title, email, company_id, receives_offers FROM contacts
                          WHERE customer_id = ? AND active = 1 ORDER BY receives_offers DESC, full_name`, co.customer_id);
    }
  }
  res.json(out);
});

router.get('/api/offers/:id', auth, (req, res) => res.json(detail(findOffer(req, Number(req.params.id)))));

// ---------- Oluşturma, düzenleme, silme (yalnızca taslak) ----------
router.post('/api/offers', auth, requirePerm('offers.edit'), (req, res) => {
  const b = req.body;
  const h = headerFields(req, b);
  const items = itemFields(b.items);
  const payments = paymentFields(b.payments);
  // Şablon metinleri boş gönderilmediyse dilin varsayılanı kullanılır
  const s = getSettings();
  for (const k of ['intro', 'assumptions', 'terms']) if (b[k] === undefined) h[k] = s[`offer_${k}_${h.language}`] || '';
  const year = Number(h.offer_date.slice(0, 4));
  const result = tx(() => {
    const seq = one('SELECT COALESCE(MAX(seq), 0) + 1 n FROM offers WHERE year = ?', year).n;
    const number = `${s.offer_number_prefix || 'SWISE'}-${year}-${String(seq).padStart(4, '0')}`;
    const { lastInsertRowid } = run(`INSERT INTO offers (number, year, seq, created_by, ${HEADER_COLS.join(', ')})
      VALUES (?, ?, ?, ?, ${HEADER_COLS.map(() => '?').join(', ')})`, number, year, seq, req.user.id, ...HEADER_COLS.map((k) => h[k]));
    const id = Number(lastInsertRowid);
    writeLines(id, items, payments);
    audit.record(req, 'create', 'offers', id, { number, title: h.title });
    return { id, number };
  });
  res.json(result);
});

router.put('/api/offers/:id', auth, (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  checkEdit(req, o);
  expectStatus(o, 'draft');
  const h = headerFields(req, req.body);
  const items = itemFields(req.body.items);
  const payments = paymentFields(req.body.payments);
  tx(() => {
    run(`UPDATE offers SET ${HEADER_COLS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...HEADER_COLS.map((k) => h[k]), o.id);
    writeLines(o.id, items, payments);
    const diff = Object.fromEntries(HEADER_COLS.filter((k) => o[k] !== h[k] && !['intro', 'scope', 'assumptions', 'terms', 'internal_notes'].includes(k)).map((k) => [k, [o[k], h[k]]]));
    audit.record(req, 'update', 'offers', o.id, { number: o.number, ...diff });
  });
  res.json({ ok: true });
});

// Yalnızca hiç onaylanmamış ilk taslak silinebilir; diğerleri arşivde kalır
router.delete('/api/offers/:id', auth, (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  checkEdit(req, o);
  if (o.status !== 'draft' || o.revision !== 1 || one('SELECT 1 FROM offer_versions WHERE offer_id = ?', o.id)) {
    bad('Yalnızca hiç onaylanmamış taslak teklif silinebilir');
  }
  tx(() => {
    run('DELETE FROM offers WHERE id = ?', o.id);
    audit.record(req, 'delete', 'offers', o.id, { number: o.number, title: o.title });
  });
  res.json({ ok: true });
});

// ---------- İç onay ----------
router.post('/api/offers/:id/submit', auth, (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  checkEdit(req, o);
  expectStatus(o, 'draft');
  tx(() => {
    run(`UPDATE offers SET status = 'pending_approval', submitted_at = ${now}, review_note = '' WHERE id = ?`, o.id);
    audit.record(req, 'submit', 'offers', o.id, { number: o.number, revision: o.revision });
  });
  res.json({ ok: true });
});

// PDF'in dondurulacağı görüntü: teklif + şirketin kendi adı + imza yetkilisi
function snapshotOf(o) {
  const s = getSettings();
  const title = o.language === 'en' ? (s.offer_signatory_title_en || s.offer_signatory_title) : s.offer_signatory_title;
  return { ...detail(o), company_name_self: s.company_name, signatory: { name: s.offer_signatory_name, title } };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const ensureDir = () => fs.mkdirSync(path.join(config.uploadDir, 'offers'), { recursive: true });

router.post('/api/offers/:id/review', auth, requirePerm('offers.approve'), asyncHandler(async (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  expectStatus(o, 'pending_approval');
  const decision = req.body.decision;
  if (!['approved', 'rejected'].includes(decision)) bad('Karar geçersiz');
  if (decision === 'rejected') {
    const note = str(req.body.note, 'Gerekçe');
    tx(() => {
      run("UPDATE offers SET status = 'draft', review_note = ? WHERE id = ?", note, o.id);
      audit.record(req, 'reject', 'offers', o.id, { number: o.number, note });
    });
    return res.json({ ok: true });
  }
  // Onay: PDF üretilir, dosyaya yazılır ve parmak iziyle birlikte sürüm olarak saklanır
  const snap = snapshotOf(o);
  const pdf = await buildOfferPdf(snap);
  const rel = path.join('offers', `${o.number}-rev${o.revision}.pdf`);
  ensureDir();
  fs.writeFileSync(path.join(config.uploadDir, rel), pdf);
  tx(() => {
    run(`INSERT INTO offer_versions (offer_id, revision, snapshot, pdf_path, pdf_sha256, approved_by) VALUES (?, ?, ?, ?, ?, ?)`,
      o.id, o.revision, JSON.stringify(snap), rel, sha256(pdf), req.user.id);
    run(`UPDATE offers SET status = 'approved', approved_by = ?, approved_at = ${now}, review_note = '' WHERE id = ?`, req.user.id, o.id);
    audit.record(req, 'approve', 'offers', o.id, { number: o.number, revision: o.revision, pdf_sha256: sha256(pdf) });
  });
  res.json({ ok: true });
}));

// ---------- İmzalı dosya, gönderim, karar, revizyon ----------
const currentVersion = (o) => one('SELECT * FROM offer_versions WHERE offer_id = ? AND revision = ?', o.id, o.revision);
const canHandle = (req, o) => {
  if (can(req, 'offers.approve')) return;
  checkEdit(req, o);
};

// Gövde ham dosyadır; dosya adı X-File-Name başlığında (URL kodlu) gelir
router.post('/api/offers/:id/signed', auth, express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  canHandle(req, o);
  expectStatus(o, 'approved', 'signed');
  const name = decodeURIComponent(String(req.headers['x-file-name'] || '')).replace(/[\\/]/g, '_');
  const ext = name.split('.').pop().toLowerCase();
  if (!SIGNED_EXT.includes(ext)) bad(`İmzalı dosya şu biçimlerden biri olmalı: ${SIGNED_EXT.join(', ')}`);
  if (!Buffer.isBuffer(req.body) || !req.body.length) bad('Dosya boş');
  const v = currentVersion(o);
  const rel = path.join('offers', `${o.number}-rev${o.revision}-imzali.${ext}`);
  ensureDir();
  fs.writeFileSync(path.join(config.uploadDir, rel), req.body);
  tx(() => {
    run(`UPDATE offer_versions SET signed_path = ?, signed_name = ?, signed_sha256 = ?, signed_by = ?, signed_at = ${now} WHERE id = ?`,
      rel, name, sha256(req.body), req.user.id, v.id);
    run("UPDATE offers SET status = 'signed' WHERE id = ?", o.id);
    audit.record(req, 'sign', 'offers', o.id, { number: o.number, revision: o.revision, file: name });
  });
  res.json({ ok: true });
});

router.post('/api/offers/:id/send', auth, (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  canHandle(req, o);
  expectStatus(o, 'approved', 'signed');
  tx(() => {
    run(`UPDATE offers SET status = 'sent', sent_at = ${now} WHERE id = ?`, o.id);
    audit.record(req, 'send', 'offers', o.id, { number: o.number, revision: o.revision, signed: o.status === 'signed' });
  });
  res.json({ ok: true });
});

router.post('/api/offers/:id/decision', auth, (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  canHandle(req, o);
  expectStatus(o, 'sent');
  const decision = req.body.decision;
  if (!['accepted', 'rejected'].includes(decision)) bad('Karar geçersiz');
  const note = str(req.body.note, 'Not', false);
  tx(() => {
    run(`UPDATE offers SET status = ?, decided_at = ${now}, decision_note = ? WHERE id = ?`, decision, note, o.id);
    audit.record(req, decision === 'accepted' ? 'accept' : 'decline', 'offers', o.id, { number: o.number, revision: o.revision, ...(note ? { note } : {}) });
  });
  res.json({ ok: true });
});

router.post('/api/offers/:id/revise', auth, (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  checkEdit(req, o);
  expectStatus(o, 'approved', 'signed', 'sent', 'rejected');
  tx(() => {
    run(`UPDATE offers SET status = 'draft', revision = revision + 1, approved_by = NULL, approved_at = NULL, submitted_at = NULL,
         sent_at = NULL, decided_at = NULL, decision_note = '', review_note = '' WHERE id = ?`, o.id);
    audit.record(req, 'revise', 'offers', o.id, { number: o.number, from_revision: o.revision, to_revision: o.revision + 1 });
  });
  res.json({ ok: true, revision: o.revision + 1 });
});

// ---------- PDF ve dosyalar ----------
// Taslak/onay bekleyen: anlık "TASLAK" filigranlı önizleme; sonrası: dondurulmuş PDF
router.get('/api/offers/:id/pdf', auth, asyncHandler(async (req, res) => {
  const o = findOffer(req, Number(req.params.id));
  const v = currentVersion(o);
  const name = `${o.number}-Rev${o.revision}.pdf`;
  if (v && !['draft', 'pending_approval'].includes(o.status)) return res.download(path.join(config.uploadDir, v.pdf_path), name);
  const pdf = await buildOfferPdf(snapshotOf(o), { draft: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${o.number}-Rev${o.revision}-TASLAK.pdf"`);
  res.end(pdf);
}));

function findVersion(req) {
  const v = one('SELECT * FROM offer_versions WHERE id = ?', Number(req.params.vid));
  if (!v) throw new HttpError(404, 'Sürüm bulunamadı');
  return { v, o: findOffer(req, v.offer_id) };   // görme yetkisi teklif üzerinden kontrol edilir
}

router.get('/api/offer-versions/:vid/pdf', auth, (req, res) => {
  const { v, o } = findVersion(req);
  res.download(path.join(config.uploadDir, v.pdf_path), `${o.number}-Rev${v.revision}.pdf`);
});

router.get('/api/offer-versions/:vid/signed', auth, (req, res) => {
  const { v } = findVersion(req);
  if (!v.signed_path) throw new HttpError(404, 'İmzalı dosya yok');
  res.download(path.join(config.uploadDir, v.signed_path), v.signed_name);
});

module.exports = { router };
