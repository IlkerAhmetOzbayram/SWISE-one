// Teklif PDF'i (A4, Türkçe/İngilizce). Girdi: dondurulmuş teklif görüntüsü (snapshot).
const path = require('path');
const PDFDocument = require('pdfkit');

const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
const LOGO = path.join(__dirname, '..', '..', '..', 'public', 'swise-mark.png');

const NAVY = '#062149';
const BLUE = '#17448f';
const TINT = '#e3ebf8';
const MUTED = '#65718b';
const LINE = '#d5ddeb';

const LABELS = {
  tr: {
    doc: 'TEKLİF', number: 'Teklif No', revision: 'Revizyon', date: 'Tarih', valid: 'Geçerlilik', to: 'Sayın', attention: 'İlgili', subject: 'Konu',
    scope: 'Kapsam ve İş Tanımı', pricing: 'Fiyatlandırma', no: '#', desc: 'Açıklama', qty: 'Miktar', unit: 'Birim',
    price: 'Birim Fiyat', disc: 'İskonto', amount: 'Tutar', subtotal: 'Ara Toplam', vat: 'KDV', vatExempt: 'KDV (istisna)',
    total: 'Genel Toplam', payments: 'Ödeme Planı', due: 'Vade', payTerms: (n) => `Ödeme vadesi: fatura tarihinden itibaren ${n} gün.`,
    assumptions: 'Varsayımlar ve Hariç Tutulanlar', terms: 'Şartlar', onBehalf: 'adına', signature: 'İmza',
    accepted: 'Kabul Eden', acceptLine: 'Ad Soyad / İmza / Kaşe', acceptDate: 'Tarih', page: 'Sayfa', draft: 'TASLAK',
    taxNo: 'VKN/TCKN', taxOffice: 'V.D.', rev: 'Rev.', paymentMismatch: 'Not: Ödeme planı toplamı genel toplamla eşleşmiyor.',
  },
  en: {
    doc: 'PROPOSAL', number: 'Proposal No', revision: 'Revision', date: 'Date', valid: 'Valid until', to: 'To', attention: 'Attn.', subject: 'Subject',
    scope: 'Scope of Work', pricing: 'Pricing', no: '#', desc: 'Description', qty: 'Qty', unit: 'Unit',
    price: 'Unit Price', disc: 'Disc.', amount: 'Amount', subtotal: 'Subtotal', vat: 'VAT', vatExempt: 'VAT (exempt)',
    total: 'Total', payments: 'Payment Schedule', due: 'Due', payTerms: (n) => `Payment terms: ${n} days from invoice date.`,
    assumptions: 'Assumptions and Exclusions', terms: 'Terms and Conditions', onBehalf: 'on behalf of', signature: 'Signature',
    accepted: 'Accepted by', acceptLine: 'Name / Signature / Stamp', acceptDate: 'Date', page: 'Page', draft: 'DRAFT',
    taxNo: 'Tax No', taxOffice: 'Tax Office', rev: 'Rev.', paymentMismatch: 'Note: Payment schedule total does not match the proposal total.',
  },
};

const fmtMoney = (lang, currency) => {
  const f = new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { style: 'currency', currency });
  return (n) => f.format(n || 0);
};
const upper = (lang, s) => s.toLocaleUpperCase(lang === 'tr' ? 'tr-TR' : 'en-GB');
const fmtNum = (lang) => (n) => (n || 0).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB', { maximumFractionDigits: 2 });
const fmtDate = (lang, s) => new Date(`${s}T00:00:00`).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB',
  lang === 'tr' ? { day: '2-digit', month: '2-digit', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });

// Promise<Buffer>
function buildOfferPdf(o, { draft = false } = {}) {
  const L = LABELS[o.language] || LABELS.tr;
  const money = fmtMoney(o.language, o.currency);
  const num = fmtNum(o.language);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 60, left: 50, right: 50 }, bufferPages: true,
    info: { Title: `${L.doc} ${o.number} ${L.rev}${o.revision}`, Author: o.company_name_self, Subject: o.title } });
  doc.registerFont('R', FONT);
  doc.registerFont('B', FONT_BOLD);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = 50;
  const width = doc.page.width - 100;
  const bottom = () => doc.page.height - 70;
  const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage(); };

  // ---------- Üst bilgi ----------
  doc.rect(0, 0, doc.page.width, 6).fill(NAVY);
  doc.image(LOGO, left, 34, { width: 24 });
  doc.font('B').fontSize(15).fillColor(NAVY).text('SWISE', left + 34, 36, { characterSpacing: 4.5 });
  doc.font('R').fontSize(6.5).fillColor(MUTED).text('TEKNOLOJİ VE DANIŞMANLIK', left + 34, 55, { characterSpacing: 1.6 });

  doc.font('B').fontSize(20).fillColor(NAVY).text(L.doc, left, 32, { width, align: 'right', characterSpacing: 2 });
  const validUntil = new Date(`${o.offer_date}T00:00:00`);
  validUntil.setDate(validUntil.getDate() + o.valid_days);
  const meta = [
    [L.number, o.number],
    [L.revision, String(o.revision)],
    [L.date, fmtDate(o.language, o.offer_date)],
    [L.valid, fmtDate(o.language, validUntil.toISOString().slice(0, 10))],
  ];
  let my = 56;
  for (const [k, v] of meta) {
    doc.font('R').fontSize(8).fillColor(MUTED).text(k, left + width - 220, my, { width: 100, align: 'right' });
    doc.font('B').fontSize(8.5).fillColor(NAVY).text(v, left + width - 115, my, { width: 115, align: 'right' });
    my += 12;
  }

  // ---------- Alıcı ----------
  let y = 118;
  doc.moveTo(left, y - 8).lineTo(left + width, y - 8).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.font('R').fontSize(8).fillColor(MUTED).text(L.to, left, y);
  doc.font('B').fontSize(11).fillColor('#0f1b33').text(o.company.name, left, y + 11, { width: width * 0.62 });
  const addr = [o.company.address, [o.company.tax_office && `${L.taxOffice} ${o.company.tax_office}`, o.company.tax_no && `${L.taxNo} ${o.company.tax_no}`].filter(Boolean).join(' · ')]
    .filter(Boolean).join('\n');
  if (addr) doc.font('R').fontSize(8.5).fillColor(MUTED).text(addr, { width: width * 0.62 });
  if (o.contact) {
    doc.moveDown(0.3).font('R').fontSize(8.5).fillColor('#0f1b33')
      .text(`${L.attention} ${o.contact.full_name}${o.contact.title ? `, ${o.contact.title}` : ''}`, { width: width * 0.62 });
  }
  doc.moveDown(1.2);
  doc.font('B').fontSize(12).fillColor(NAVY).text(`${L.subject}: ${o.title}`, left, doc.y, { width });
  doc.moveDown(0.6);
  if (o.intro) doc.font('R').fontSize(9.5).fillColor('#0f1b33').text(o.intro, { width, lineGap: 2 });

  const section = (title) => {
    ensure(50);
    doc.moveDown(1);
    const sy = doc.y;
    doc.font('B').fontSize(11.5).fillColor(NAVY).text(title, left, sy);
    doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).lineWidth(1.2).strokeColor(NAVY).stroke();
    doc.moveDown(0.6);
  };
  const paragraph = (text) => doc.font('R').fontSize(9.5).fillColor('#0f1b33').text(text, left, doc.y, { width, lineGap: 2 });

  if (o.scope) { section(L.scope); paragraph(o.scope); }

  // ---------- Fiyatlandırma tablosu ----------
  section(L.pricing);
  const cols = [
    { key: 'no', label: L.no, w: 22, align: 'left' },
    { key: 'desc', label: L.desc, w: 190, align: 'left' },
    { key: 'qty', label: L.qty, w: 48, align: 'right' },
    { key: 'unit', label: L.unit, w: 42, align: 'left' },
    { key: 'price', label: L.price, w: 72, align: 'right' },
    { key: 'disc', label: L.disc, w: 53, align: 'right' },
    { key: 'amount', label: L.amount, w: 68, align: 'right' },
  ];
  const header = () => {
    const hy = doc.y;
    doc.rect(left, hy, width, 18).fill(TINT);
    let x = left;
    for (const c of cols) {
      doc.font('B').fontSize(7.5).fillColor(BLUE).text(upper(o.language, c.label), x + 4, hy + 5.5, { width: c.w - 8, align: c.align });
      x += c.w;
    }
    doc.y = hy + 20;
  };
  header();
  o.items.forEach((it, i) => {
    const cells = {
      no: String(i + 1), desc: it.description, qty: num(it.quantity), unit: it.unit,
      price: money(it.unit_price), disc: it.discount_pct ? `%${num(it.discount_pct)}` : '—', amount: money(it.line_total),
    };
    doc.font('R').fontSize(8.5);
    const h = Math.max(16, doc.heightOfString(cells.desc, { width: cols[1].w - 8 }) + 8);
    if (doc.y + h > bottom()) { doc.addPage(); header(); }
    const ry = doc.y;
    let x = left;
    for (const c of cols) {
      doc.font(c.key === 'amount' ? 'B' : 'R').fontSize(8.5).fillColor('#0f1b33').text(cells[c.key], x + 4, ry + 4, { width: c.w - 8, align: c.align });
      x += c.w;
    }
    doc.moveTo(left, ry + h).lineTo(left + width, ry + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = ry + h + 1;
  });

  // Toplamlar
  ensure(70);
  const tx = left + width - 220;
  const totalRow = (label, value, strong) => {
    const ty = doc.y + 3;
    if (strong) doc.rect(tx, ty - 3, 220, 20).fill(NAVY);
    doc.font(strong ? 'B' : 'R').fontSize(strong ? 10 : 9).fillColor(strong ? '#ffffff' : MUTED).text(label, tx + 8, ty + 1, { width: 110 });
    doc.font('B').fontSize(strong ? 10 : 9).fillColor(strong ? '#ffffff' : '#0f1b33').text(value, tx + 110, ty + 1, { width: 102, align: 'right' });
    doc.y = ty + (strong ? 20 : 15);
  };
  doc.moveDown(0.4);
  totalRow(L.subtotal, money(o.totals.subtotal));
  totalRow(o.totals.vat_exempt ? L.vatExempt : `${L.vat} (%${num(o.vat_rate)})`, money(o.totals.vat));
  totalRow(L.total, money(o.totals.total), true);
  doc.x = left;

  // ---------- Ödeme planı ----------
  if (o.payments.length) {
    section(L.payments);
    const pw = [width - 230, 130, 100];
    const ph = doc.y;
    doc.rect(left, ph, width, 18).fill(TINT);
    [[L.desc, 'left'], [L.due, 'left'], [L.amount, 'right']].reduce((x, [label, align], i) => {
      doc.font('B').fontSize(7.5).fillColor(BLUE).text(upper(o.language, label), x + 4, ph + 5.5, { width: pw[i] - 8, align });
      return x + pw[i];
    }, left);
    doc.y = ph + 20;
    for (const p of o.payments) {
      ensure(18);
      const ry = doc.y;
      doc.font('R').fontSize(8.5).fillColor('#0f1b33').text(p.description, left + 4, ry + 4, { width: pw[0] - 8 });
      const h = Math.max(16, doc.y - ry + 4);
      doc.text(p.due || '—', left + pw[0] + 4, ry + 4, { width: pw[1] - 8 });
      doc.font('B').text(money(p.amount), left + pw[0] + pw[1] + 4, ry + 4, { width: pw[2] - 8, align: 'right' });
      doc.moveTo(left, ry + h).lineTo(left + width, ry + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = ry + h + 1;
    }
    if (o.totals.payment_mismatch) doc.moveDown(0.3).font('R').fontSize(8).fillColor('#c0392b').text(L.paymentMismatch, left, doc.y, { width });
  }
  doc.moveDown(0.6).font('R').fontSize(8.5).fillColor(MUTED).text(L.payTerms(o.payment_days), left, doc.y, { width });

  if (o.assumptions) { section(L.assumptions); paragraph(o.assumptions); }
  if (o.terms) { section(L.terms); paragraph(o.terms); }

  // ---------- İmza ----------
  ensure(100);
  doc.moveDown(1.2);
  const sy = doc.y;
  const half = (width - 30) / 2;
  const signBox = (x, heading, lines) => {
    doc.font('B').fontSize(9).fillColor(NAVY).text(heading, x, sy, { width: half });
    doc.font('R').fontSize(8.5).fillColor('#0f1b33');
    for (const l of lines) if (l) doc.text(l, x, doc.y + 2, { width: half });
    doc.moveTo(x, sy + 62).lineTo(x + half, sy + 62).lineWidth(0.6).strokeColor(MUTED).stroke();
  };
  signBox(left, `${o.company_name_self}`, [o.signatory?.name, o.signatory?.title]);
  doc.font('R').fontSize(7.5).fillColor(MUTED).text(L.signature, left, sy + 66, { width: half });
  signBox(left + half + 30, L.accepted, [o.company.name]);
  doc.font('R').fontSize(7.5).fillColor(MUTED).text(`${L.acceptLine}        ${L.acceptDate}: ____ / ____ / ______`, left + half + 30, sy + 66, { width: half });

  // ---------- Alt bilgi ve taslak filigranı (tüm sayfalar) ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // alt bilgi kenar boşluğuna yazılır; yeni sayfa açılmasın
    if (draft) {
      doc.save().rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .font('B').fontSize(90).fillColor('#062149').fillOpacity(0.06)
        .text(L.draft, 0, doc.page.height / 2 - 50, { width: doc.page.width, align: 'center', lineBreak: false }).restore();
      doc.fillOpacity(1);
    }
    const fy = doc.page.height - 40;
    doc.moveTo(left, fy - 6).lineTo(left + width, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('R').fontSize(7).fillColor(MUTED)
      .text(`${o.company_name_self} · ${o.number} ${L.rev}${o.revision}`, left, fy, { width: width / 2, lineBreak: false })
      .text(`${L.page} ${i + 1} / ${range.count}`, left + width / 2, fy, { width: width / 2, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

module.exports = { buildOfferPdf };
