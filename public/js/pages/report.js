import { $, main, api, toast, esc, money, moneyByCurrency, hrs, pct, today, fmtDate, qs, clientProjectCell, LOGO_HTML, HOURS_PER_DAY, CURRENCY_LABELS } from '../core.js';
import { filters, filterBar, bindFilterBar } from '../filters.js';
import { pageEffortReport, reportTabs } from './effort-report.js';

let showDetails = false;

export function pageReport(param) {
  if (param === 'efor') return pageEffortReport();
  main.innerHTML = `<h1 class="no-print">Raporlar</h1>${reportTabs('muhasebe')}
    <section class="card no-print">
      ${filterBar({
        user: true,
        extra: `<label class="check"><input type="checkbox" data-details ${showDetails ? 'checked' : ''}> Detayları göster</label>
          <div class="actions"><button type="button" class="secondary" data-xlsx>Excel indir</button>
          <button type="button" data-print>Yazdır / PDF</button></div>`,
      })}
    </section>
    <div data-report></div>`;

  const load = async () => {
    try {
      renderReport(await api('GET', `/api/report?${qs(filters)}`));
    } catch (err) { toast(err.message, true); }
  };
  $('[data-details]').onchange = (e) => { showDetails = e.target.checked; load(); };
  $('[data-print]').onclick = () => window.print();
  $('[data-xlsx]').onclick = () => { location.href = `/api/report.xlsx?${qs(filters)}`; };
  bindFilterBar(main, load);
  load();
}

const MONEY_COLS = ['fee', 'expenses', 'vat', 'withholding_amount', 'invoice_total', 'net'];
const moneyCells = (t) => MONEY_COLS.map((k) => `<td class="num">${t[k] === undefined ? '' : money(t[k], t.currency)}</td>`).join('');
const effortCells = (t) => `<td class="num">${hrs(t.hours)}</td><td class="num">${hrs(t.billable_hours)}</td><td class="num">${hrs(t.days)}</td>`;
const currencyBadge = (c) => `<span class="badge cur">${c}</span>`;

function renderReport(r) {
  const e = r.effort;
  const period = `${r.period.from ? fmtDate(r.period.from) : 'Başlangıç'} – ${r.period.to ? fmtDate(r.period.to) : 'Bugün'}`;
  const stat = (label, value) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  const multi = r.totals.length > 1;

  const customerRows = (cu) => `
    <tr class="customer"><td colspan="10">${esc(cu.name)}</td></tr>
    ${cu.companies.map((co) => `
      ${co.totals.map((t) => `<tr class="group"><td class="indent1">${esc(co.name)}
          ${co.tax_no ? `<span class="small">VKN ${esc(co.tax_no)}</span>` : ''}
          ${co.withholding ? '<span class="badge">stopajlı</span>' : ''}${co.vat_exempt ? '<span class="badge">KDV yok</span>' : ''}
          ${multi ? currencyBadge(t.currency) : ''}</td>
        ${effortCells(t)}${moneyCells(t)}</tr>`).join('')}
      ${co.projects.map((p) => `<tr class="sub"><td class="indent2">${esc(p.name)}${multi ? ` ${currencyBadge(p.currency)}` : ''}</td>
        ${effortCells(p)}${moneyCells({ currency: p.currency, fee: p.fee, expenses: p.expenses })}</tr>`).join('')}`).join('')}
    ${cu.companies.length > 1 || cu.totals.length > 1 ? cu.totals.map((t) => `<tr class="subtotal"><td class="indent1">${esc(cu.name)} toplamı ${multi ? currencyBadge(t.currency) : ''}</td>
      ${effortCells(t)}${moneyCells(t)}</tr>`).join('') : ''}`;

  $('[data-report]').innerHTML = `
    <div class="print-only">
      <div class="print-logo">${LOGO_HTML}</div>
      <h1>${esc(r.company_name)} — Muhasebe Raporu</h1>
      <p>Dönem: ${period} · Hazırlanma: ${fmtDate(today())}</p>
    </div>
    <p class="hint no-print" style="margin:0 0 12px">Dönem: ${period}</p>
    <div class="stats">
      ${stat('Toplam saat', hrs(e.hours))}
      ${stat('Faturalanabilir saat', `${hrs(e.billable_hours)} <span class="small">${e.hours ? pct(e.billable_hours / e.hours) : ''}</span>`)}
      ${stat('Faturalanabilir adam-gün', `${hrs(e.days)} <span class="small">${HOURS_PER_DAY} saat = 1 gün</span>`)}
      ${stat('Müşteri sayısı', r.customers.length)}
    </div>

    <section class="card">
      <h2>Para birimine göre özet</h2>
      ${r.totals.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Para birimi</th><th class="num">Hizmet bedeli</th><th class="num">Yansıtılan masraf</th><th class="num">KDV matrahı</th>
          <th class="num">KDV (%${r.vat_rate})</th><th class="num">Stopaj (%${r.withholding_rate})</th><th class="num">Fatura toplamı</th><th class="num">Net tahsilat</th></tr></thead>
        <tbody>${r.totals.map((t) => `<tr><td><b>${CURRENCY_LABELS[t.currency] || t.currency}</b></td>
          ${['fee', 'expenses', 'vat_base', 'vat', 'withholding_amount'].map((k) => `<td class="num">${money(t[k], t.currency)}</td>`).join('')}
          <td class="num"><b>${money(t.invoice_total, t.currency)}</b></td><td class="num"><b>${money(t.net, t.currency)}</b></td></tr>`).join('')}</tbody>
      </table></div>
      ${multi ? '<p class="hint">Farklı para birimleri birbirine eklenmez. Kur çevirisi muhasebe modülünde yapılacak.</p>' : ''}`
      : '<div class="empty">Bu dönemde kayıt yok.</div>'}
    </section>

    ${r.customers.length ? `<section class="card">
      <h2>Müşteri → Şirket → Proje</h2>
      <div class="table-wrap"><table class="report">
        <thead><tr><th>Müşteri / Şirket / Proje</th><th class="num">Saat</th><th class="num">Fat. saat</th><th class="num">Adam-gün</th>
          <th class="num">Hizmet bedeli</th><th class="num">Masraf</th><th class="num">KDV</th><th class="num">Stopaj</th>
          <th class="num">Fatura toplamı</th><th class="num">Net tahsilat</th></tr></thead>
        <tbody>${r.customers.map(customerRows).join('')}</tbody>
      </table></div>
      <p class="hint">KDV matrahı = hizmet bedeli + yansıtılan masraf · Stopaj yalnızca “stopajlı” şirketlerde hizmet bedeli üzerinden · “KDV yok” şirketlerde KDV uygulanmaz · Net tahsilat = fatura toplamı − stopaj</p>
    </section>` : ''}

    <div class="split">
      <section class="card">
        <h2>Kullanıcı eforu</h2>
        ${r.users.length ? `<table><thead><tr><th>Kullanıcı</th><th class="num">Saat</th><th class="num">Fat. saat</th><th class="num">Adam-gün</th><th class="num">Oran</th><th class="num">Hizmet bedeli</th></tr></thead>
          <tbody>${r.users.map((u) => `<tr><td>${esc(u.name)}</td><td class="num">${hrs(u.hours)}</td><td class="num">${hrs(u.billable_hours)}</td>
            <td class="num">${hrs(u.days)}</td><td class="num">${u.hours ? pct(u.billable_hours / u.hours) : '—'}</td>
            <td class="num">${moneyByCurrency(u.fees)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Kayıt yok.</div>'}
      </section>
      <section class="card">
        <h2>Gider özeti</h2>
        <table><thead><tr><th>Kategori</th><th class="num">Tutar (KDV hariç)</th><th class="num">KDV</th></tr></thead>
          <tbody>${r.expense_summary.categories.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${money(c.amount, c.currency)}</td><td class="num">${money(c.vat, c.currency)}</td></tr>`).join('')
            || '<tr><td colspan="3" class="empty">Masraf yok.</td></tr>'}</tbody>
          <tfoot>${r.expense_summary.totals.map((t) => `
            <tr><td>Müşteriye yansıtılan${multi ? ` ${currencyBadge(t.currency)}` : ''}</td><td class="num">${money(t.billable, t.currency)}</td><td></td></tr>
            <tr><td>Yansıtılmayan (maliyet)${multi ? ` ${currencyBadge(t.currency)}` : ''}</td><td class="num">${money(t.nonbillable, t.currency)}</td><td></td></tr>
            <tr class="total"><td>İndirilecek KDV${multi ? ` ${currencyBadge(t.currency)}` : ''}</td><td></td><td class="num">${money(t.input_vat, t.currency)}</td></tr>`).join('')}
          </tfoot></table>
      </section>
    </div>

    ${showDetails ? `
    <section class="card">
      <h2>Aktivite detayı</h2>
      <div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Kullanıcı</th><th>Müşteri › Şirket / Proje</th><th>Açıklama</th><th class="num">Saat</th><th class="num">Günlük ücret</th><th class="num">Tutar</th></tr></thead>
        <tbody>${r.activities.map((a) => `<tr class="${a.billable ? '' : 'muted'}"><td>${fmtDate(a.date)}</td><td>${esc(a.user_name)}</td><td>${clientProjectCell(a)}</td>
          <td>${esc(a.description)}</td><td class="num">${hrs(a.hours)}</td><td class="num">${money(a.daily_rate, a.currency)}</td>
          <td class="num">${a.billable ? money(a.hours * a.daily_rate / HOURS_PER_DAY, a.currency) : 'Faturasız'}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="card">
      <h2>Masraf detayı</h2>
      <div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Kullanıcı</th><th>Müşteri › Şirket / Proje</th><th>Kategori</th><th>Açıklama</th><th class="num">Tutar</th><th class="num">KDV</th><th>Yansıtılır</th></tr></thead>
        <tbody>${r.expenses.map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.user_name)}</td><td>${clientProjectCell(x)}</td><td>${esc(x.category)}</td>
          <td>${esc(x.description)}</td><td class="num">${money(x.amount, x.currency)}</td><td class="num">${money(x.amount * x.vat_rate / 100, x.currency)}</td><td>${x.billable ? 'Evet' : 'Hayır'}</td></tr>`).join('')
          || '<tr><td colspan="8" class="empty">Masraf yok.</td></tr>'}</tbody></table></div>
    </section>` : ''}`;
}
