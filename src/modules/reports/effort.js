// Müşteri efor raporu: hangi gün, kim, hangi şirket/projede ne kadar çalıştı.
// Müşteriye gönderilmek üzere hazırlanır; ücret ve tutar içermez.
const ExcelJS = require('exceljs');
const { one, all } = require('../../db');
const { bad, HttpError } = require('../../lib/http');
const { can } = require('../../lib/auth');
const { num, date, r2 } = require('../../lib/validate');
const { HOURS_PER_DAY } = require('../activities');

function buildEffortReport(req) {
  const q = req.query;
  const customerId = num(q.customer_id, 'Müşteri');
  const customer = one('SELECT id, name, manager_id FROM customers WHERE id = ?', customerId);
  if (!customer) bad('Müşteri bulunamadı');
  // Proje yöneticisi yalnızca sorumlu olduğu müşterinin raporunu alabilir
  if (can(req, 'effort_report.view') !== 'all' && customer.manager_id !== req.user.id) throw new HttpError(403, 'Bu müşterinin raporunu görme yetkiniz yok');
  delete customer.manager_id;
  const where = ['co.customer_id = ?'];
  const params = [customerId];
  if (q.from) { where.push('a.date >= ?'); params.push(date(q.from, 'Başlangıç')); }
  if (q.to) { where.push('a.date <= ?'); params.push(date(q.to, 'Bitiş')); }
  if (q.company_id) { where.push('a.company_id = ?'); params.push(Number(q.company_id)); }
  if (q.billable_only !== '0') where.push('a.billable = 1');

  const rows = all(`SELECT a.id, a.date, a.hours, a.billable, a.description, co.name company_name, p.name project_name, u.full_name user_name
                    FROM activities a JOIN companies co ON co.id = a.company_id LEFT JOIN projects p ON p.id = a.project_id
                    JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')}
                    ORDER BY a.date, co.name, p.name, u.full_name`, ...params)
    .map((r) => ({ ...r, days: r2(r.hours / HOURS_PER_DAY) }));

  const group = (keyFn, labelFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, { ...labelFn(r), hours: 0 });
      m.get(k).hours += r.hours;
    }
    return [...m.values()].map((g) => ({ ...g, hours: r2(g.hours), days: r2(g.hours / HOURS_PER_DAY) }));
  };

  const hours = r2(rows.reduce((a, r) => a + r.hours, 0));
  return {
    customer,
    period: { from: q.from || null, to: q.to || null },
    billable_only: q.billable_only !== '0',
    total: { hours, days: r2(hours / HOURS_PER_DAY) },
    by_target: group((r) => `${r.company_name}|${r.project_name ?? ''}`, (r) => ({ company_name: r.company_name, project_name: r.project_name })),
    by_user: group((r) => r.user_name, (r) => ({ user_name: r.user_name })).sort((a, b) => b.hours - a.hours),
    rows,
  };
}

async function writeEffortXlsx(rep, companyName, res) {
  const wb = new ExcelJS.Workbook();
  wb.creator = companyName;
  const period = `${rep.period.from || 'Başlangıç'} – ${rep.period.to || 'Bugün'}`;
  const sheet = (name, columns) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([`${rep.customer.name} — Efor Raporu`]).font = { bold: true, size: 14 };
    ws.addRow([`Dönem: ${period}`]);
    ws.addRow([`Hazırlayan: ${companyName}`]);
    ws.addRow([]);
    const header = ws.addRow(columns.map((c) => c.header));
    header.font = { bold: true };
    header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EBF3' } }; });
    columns.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.width || 14; if (c.fmt) col.numFmt = c.fmt; });
    ws.views = [{ state: 'frozen', ySplit: 5 }];
    return ws;
  };
  const HOURS = '#,##0.00';

  const summary = sheet('Özet', [{ header: 'Şirket', width: 32 }, { header: 'Proje', width: 28 }, { header: 'Saat', fmt: HOURS }, { header: 'Adam-Gün', fmt: HOURS }]);
  for (const t of rep.by_target) summary.addRow([t.company_name, t.project_name ?? '—', t.hours, t.days]);
  const tr = summary.addRow(['TOPLAM', '', rep.total.hours, rep.total.days]);
  tr.font = { bold: true };
  tr.border = { top: { style: 'thin' } };
  summary.addRow([]);
  summary.addRow(['Kişi', '', 'Saat', 'Adam-Gün']).font = { bold: true };
  for (const u of rep.by_user) summary.addRow([u.user_name, '', u.hours, u.days]);

  const detail = sheet('Detay', [
    { header: 'Tarih', width: 12 }, { header: 'Şirket', width: 28 }, { header: 'Proje', width: 24 }, { header: 'Kişi', width: 22 },
    { header: 'Açıklama', width: 50 }, { header: 'Saat', fmt: HOURS }, { header: 'Adam-Gün', fmt: HOURS },
  ]);
  for (const r of rep.rows) detail.addRow([r.date, r.company_name, r.project_name ?? '', r.user_name, r.description, r.hours, r.days]);

  const safe = rep.customer.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
  const fname = `efor-raporu-${safe}-${rep.period.from || 'tum'}_${rep.period.to || 'bugun'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { buildEffortReport, writeEffortXlsx };
