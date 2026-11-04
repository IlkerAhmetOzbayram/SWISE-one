// Muhasebe raporunun Excel çıktısı (para birimi sütunlu)
const ExcelJS = require('exceljs');
const { r2 } = require('../../lib/validate');
const { HOURS_PER_DAY } = require('../activities');

const MONEY = '#,##0.00';
const HOURS = '#,##0.00';
const MONEY_KEYS = ['fee', 'expenses', 'vat_base', 'vat', 'withholding_amount', 'invoice_total', 'net'];

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

  // Özet: müşteri → şirket (para birimi başına satır) → proje
  const summary = addSheet('Muhasebe Özeti', [
    { header: 'Müşteri / Şirket / Proje', width: 38 }, { header: 'VKN', width: 14 }, { header: 'Para Birimi', width: 11 },
    { header: 'Saat', fmt: HOURS }, { header: 'Fat. Saat', fmt: HOURS }, { header: 'Adam-Gün', fmt: HOURS },
    { header: 'Hizmet Bedeli', fmt: MONEY, width: 16 }, { header: 'Yansıtılan Masraf', fmt: MONEY, width: 16 },
    { header: 'KDV Matrahı', fmt: MONEY, width: 16 }, { header: `KDV (%${rep.vat_rate})`, fmt: MONEY, width: 14 },
    { header: `Stopaj (%${rep.withholding_rate})`, fmt: MONEY, width: 14 }, { header: 'Fatura Toplamı', fmt: MONEY, width: 16 },
    { header: 'Net Tahsilat', fmt: MONEY, width: 16 },
  ]);
  const line = (label, taxNo, t) => [label, taxNo, t.currency, t.hours, t.billable_hours, t.days, ...MONEY_KEYS.map((k) => t[k])];
  for (const cu of rep.customers) {
    summary.addRow([cu.name]).font = { bold: true, size: 12 };
    for (const co of cu.companies) {
      for (const t of co.totals) {
        const note = [co.withholding && 'stopajlı', co.vat_exempt && 'KDV yok'].filter(Boolean).join(', ');
        summary.addRow(line(`   ${co.name}${note ? ` (${note})` : ''}`, co.tax_no, t)).font = { bold: true };
      }
      for (const p of co.projects) {
        summary.addRow([`      ${p.name}`, '', p.currency, p.hours, p.billable_hours, p.days, p.fee, p.expenses]);
      }
    }
    for (const t of cu.totals) summary.addRow(line(`   ${cu.name} toplamı`, '', t)).font = { italic: true };
    summary.addRow([]);
  }
  for (const t of rep.totals) {
    const row = summary.addRow(line('GENEL TOPLAM', '', t));
    row.font = { bold: true };
    row.border = { top: { style: 'thin' } };
  }
  summary.addRow([]);
  summary.addRow(['Gider özeti']).font = { bold: true };
  for (const e of rep.expense_summary.totals) {
    summary.addRow([`Yansıtılan masraflar`, '', e.currency, '', '', '', e.billable]);
    summary.addRow([`Yansıtılmayan masraflar (maliyet)`, '', e.currency, '', '', '', e.nonbillable]);
    summary.addRow([`İndirilecek KDV (masraflar)`, '', e.currency, '', '', '', e.input_vat]);
  }

  // Efor
  const currencies = [...new Set(rep.users.flatMap((u) => Object.keys(u.fees)))];
  const effort = addSheet('Kullanıcı Eforu', [
    { header: 'Kullanıcı', width: 28 }, { header: 'Toplam Saat', fmt: HOURS }, { header: 'Fat. Saat', fmt: HOURS },
    { header: 'Adam-Gün', fmt: HOURS }, { header: 'Faturalanabilir Oran', fmt: '0%', width: 18 },
    ...currencies.map((c) => ({ header: `Hizmet Bedeli (${c})`, fmt: MONEY, width: 18 })),
  ]);
  for (const u of rep.users) {
    effort.addRow([u.name, u.hours, u.billable_hours, u.days, u.hours ? u.billable_hours / u.hours : 0, ...currencies.map((c) => u.fees[c] || 0)]);
  }

  // Detaylar
  const acts = addSheet('Aktiviteler', [
    { header: 'Tarih', width: 12 }, { header: 'Kullanıcı', width: 22 }, { header: 'Müşteri', width: 22 },
    { header: 'Şirket', width: 24 }, { header: 'Proje', width: 22 }, { header: 'Açıklama', width: 40 },
    { header: 'Saat', fmt: HOURS }, { header: 'Faturalanabilir', width: 14 }, { header: 'Günlük Ücret', fmt: MONEY },
    { header: 'Para Birimi', width: 11 }, { header: 'Tutar', fmt: MONEY, width: 16 },
  ]);
  for (const a of rep.activities) {
    acts.addRow([a.date, a.user_name, a.customer_name, a.company_name, a.project_name ?? '', a.description, a.hours,
      a.billable ? 'Evet' : 'Hayır', a.daily_rate, a.currency, a.billable ? r2(a.hours * a.daily_rate / HOURS_PER_DAY) : 0]);
  }

  const exps = addSheet('Masraflar', [
    { header: 'Tarih', width: 12 }, { header: 'Kullanıcı', width: 22 }, { header: 'Müşteri', width: 22 },
    { header: 'Şirket', width: 24 }, { header: 'Proje', width: 22 }, { header: 'Kategori', width: 16 },
    { header: 'Açıklama', width: 32 }, { header: 'Tutar (KDV hariç)', fmt: MONEY, width: 18 },
    { header: 'Para Birimi', width: 11 }, { header: 'KDV %', width: 8 }, { header: 'KDV', fmt: MONEY }, { header: 'Yansıtılır', width: 10 },
  ]);
  for (const e of rep.expenses) {
    exps.addRow([e.date, e.user_name, e.customer_name, e.company_name, e.project_name ?? '', e.category, e.description,
      e.amount, e.currency, e.vat_rate, r2(e.amount * e.vat_rate / 100), e.billable ? 'Evet' : 'Hayır']);
  }

  const fname = `muhasebe-raporu-${rep.period.from || 'tum'}_${rep.period.to || 'bugun'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { writeReportXlsx };
