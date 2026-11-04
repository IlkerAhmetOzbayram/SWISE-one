// Muhasebe raporunun Excel çıktısı
const ExcelJS = require('exceljs');
const { r2 } = require('../../lib/validate');

const MONEY = '#,##0.00 "₺"';
const HOURS = '#,##0.00';

async function writeReportXlsx(rep, res) {
  const wb = new ExcelJS.Workbook();
  wb.creator = rep.company_name;
  const period = `${rep.period.from || 'Başlangıç'} – ${rep.period.to || 'Bugün'}`;

  const addSheet = (name, columns) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([`${rep.company_name} — ${name}`]).font = { bold: true, size: 14 };
    ws.addRow([`Dönem: ${period}`]);
    ws.addRow([]);
    const header = ws.addRow(columns.map((c) => c.header));
    header.font = { bold: true };
    header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EBF3' } }; });
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width || 14;
      if (c.fmt) col.numFmt = c.fmt;
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    return ws;
  };

  // Özet
  const summary = addSheet('Muhasebe Özeti', [
    { header: 'Müşteri / Proje', width: 34 }, { header: 'VKN', width: 14 }, { header: 'Saat', fmt: HOURS },
    { header: 'Fat. Saat', fmt: HOURS }, { header: 'Hizmet Bedeli', fmt: MONEY, width: 16 },
    { header: 'Yansıtılan Masraf', fmt: MONEY, width: 16 }, { header: 'KDV Matrahı', fmt: MONEY, width: 16 },
    { header: `KDV (%${rep.vat_rate})`, fmt: MONEY, width: 16 }, { header: `Stopaj (%${rep.withholding_rate})`, fmt: MONEY, width: 16 },
    { header: 'Fatura Toplamı', fmt: MONEY, width: 16 }, { header: 'Net Tahsilat', fmt: MONEY, width: 16 },
  ]);
  for (const c of rep.clients) {
    summary.addRow([c.name, c.tax_no, c.hours, c.billable_hours, c.fee, c.expenses, c.vat_base, c.vat,
      c.withholding_amount, c.invoice_total, c.net]).font = { bold: true };
    for (const p of c.projects) summary.addRow([`   ${p.name}`, '', p.hours, p.billable_hours, p.fee, p.expenses]);
  }
  const t = rep.totals;
  const totalRow = summary.addRow(['TOPLAM', '', t.hours, t.billable_hours, t.fee, t.expenses, t.vat_base, t.vat,
    t.withholding_amount, t.invoice_total, t.net]);
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: 'thin' } };
  summary.addRow([]);
  summary.addRow(['Gider özeti']).font = { bold: true };
  summary.addRow(['Yansıtılan masraflar', '', '', '', rep.expense_summary.billable]);
  summary.addRow(['Yansıtılmayan masraflar (maliyet)', '', '', '', rep.expense_summary.nonbillable]);
  summary.addRow(['İndirilecek KDV (masraflar)', '', '', '', rep.expense_summary.input_vat]);

  // Efor
  const effort = addSheet('Kullanıcı Eforu', [
    { header: 'Kullanıcı', width: 28 }, { header: 'Toplam Saat', fmt: HOURS }, { header: 'Fat. Saat', fmt: HOURS },
    { header: 'Faturalanabilir Oran', fmt: '0%', width: 18 }, { header: 'Hizmet Bedeli', fmt: MONEY, width: 16 },
  ]);
  for (const u of rep.users) effort.addRow([u.name, u.hours, u.billable_hours, u.hours ? u.billable_hours / u.hours : 0, u.fee]);

  // Detaylar
  const acts = addSheet('Aktiviteler', [
    { header: 'Tarih', width: 12 }, { header: 'Kullanıcı', width: 22 }, { header: 'Müşteri', width: 24 },
    { header: 'Proje', width: 24 }, { header: 'Açıklama', width: 44 }, { header: 'Saat', fmt: HOURS },
    { header: 'Faturalanabilir', width: 14 }, { header: 'Ücret', fmt: MONEY }, { header: 'Tutar', fmt: MONEY, width: 16 },
  ]);
  for (const a of rep.activities) {
    acts.addRow([a.date, a.user_name, a.client_name, a.project_name, a.description, a.hours,
      a.billable ? 'Evet' : 'Hayır', a.rate, a.billable ? r2(a.hours * a.rate) : 0]);
  }

  const exps = addSheet('Masraflar', [
    { header: 'Tarih', width: 12 }, { header: 'Kullanıcı', width: 22 }, { header: 'Müşteri', width: 24 },
    { header: 'Proje', width: 24 }, { header: 'Kategori', width: 16 }, { header: 'Açıklama', width: 36 },
    { header: 'Tutar (KDV hariç)', fmt: MONEY, width: 18 }, { header: 'KDV %', width: 8 }, { header: 'KDV', fmt: MONEY },
    { header: 'Yansıtılır', width: 10 },
  ]);
  for (const e of rep.expenses) {
    exps.addRow([e.date, e.user_name, e.client_name, e.project_name, e.category, e.description, e.amount,
      e.vat_rate, r2(e.amount * e.vat_rate / 100), e.billable ? 'Evet' : 'Hayır']);
  }

  const fname = `muhasebe-raporu-${rep.period.from || 'tum'}_${rep.period.to || 'bugun'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { writeReportXlsx };
