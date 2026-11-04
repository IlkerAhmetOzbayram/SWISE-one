import { $, main, api, toast, esc, money, hrs, pct, today, fmtDate, qs, clientProjectCell, LOGO_HTML } from '../core.js';
import { filters, filterBar, bindFilterBar } from '../filters.js';

let showDetails = false;

export function pageReport() {
  main.innerHTML = `<h1 class="no-print">Muhasebe Raporu</h1>
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

function renderReport(r) {
  const t = r.totals;
  const period = `${r.period.from ? fmtDate(r.period.from) : 'Başlangıç'} – ${r.period.to ? fmtDate(r.period.to) : 'Bugün'}`;
  const stat = (label, value, hl) => `<div class="stat${hl ? ' hl' : ''}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  const moneyCells = (o) => ['fee', 'expenses', 'vat_base', 'vat', 'withholding_amount', 'invoice_total', 'net']
    .map((k) => `<td class="num">${o[k] === undefined ? '' : money(o[k])}</td>`).join('');

  $('[data-report]').innerHTML = `
    <div class="print-only">
      <div class="print-logo">${LOGO_HTML}</div>
      <h1>${esc(r.company_name)} — Muhasebe Raporu</h1>
      <p>Dönem: ${period} · Hazırlanma: ${fmtDate(today())}</p>
    </div>
    <p class="hint no-print" style="margin:0 0 12px">Dönem: ${period}</p>
    <div class="stats">
      ${stat('Toplam saat', hrs(t.hours))}
      ${stat('Faturalanabilir saat', `${hrs(t.billable_hours)} <span class="small">${t.hours ? pct(t.billable_hours / t.hours) : ''}</span>`)}
      ${stat('Hizmet bedeli', money(t.fee))}
      ${stat('Yansıtılan masraf', money(t.expenses))}
      ${stat(`KDV (%${r.vat_rate})`, money(t.vat))}
      ${stat(`Stopaj (%${r.withholding_rate})`, money(t.withholding_amount))}
      ${stat('Fatura toplamı', money(t.invoice_total), true)}
      ${stat('Net tahsilat', money(t.net), true)}
    </div>

    <section class="card">
      <h2>Müşteri ve proje bazında</h2>
      ${r.clients.length ? `<div class="table-wrap"><table class="report">
        <thead><tr><th>Müşteri / Proje</th><th class="num">Saat</th><th class="num">Fat. saat</th><th class="num">Hizmet bedeli</th>
          <th class="num">Masraf</th><th class="num">KDV matrahı</th><th class="num">KDV</th><th class="num">Stopaj</th>
          <th class="num">Fatura toplamı</th><th class="num">Net tahsilat</th></tr></thead>
        <tbody>${r.clients.map((c) => `
          <tr class="group"><td>${esc(c.name)}${c.tax_no ? ` <span class="small">VKN ${esc(c.tax_no)}</span>` : ''}${c.withholding ? ' <span class="badge">stopajlı</span>' : ''}</td>
            <td class="num">${hrs(c.hours)}</td><td class="num">${hrs(c.billable_hours)}</td>${moneyCells(c)}</tr>
          ${c.projects.map((p) => `<tr class="sub"><td>${esc(p.name)}</td><td class="num">${hrs(p.hours)}</td><td class="num">${hrs(p.billable_hours)}</td>
            ${moneyCells({ fee: p.fee, expenses: p.expenses })}</tr>`).join('')}`).join('')}
        </tbody>
        <tfoot><tr class="total"><td>Toplam</td><td class="num">${hrs(t.hours)}</td><td class="num">${hrs(t.billable_hours)}</td>${moneyCells(t)}</tr></tfoot>
      </table></div>` : '<div class="empty">Bu dönemde kayıt yok.</div>'}
      <p class="hint">KDV matrahı = hizmet bedeli + yansıtılan masraf · Stopaj yalnızca “stopajlı” müşterilerde hizmet bedeli üzerinden · Net tahsilat = fatura toplamı − stopaj</p>
    </section>

    <div class="split">
      <section class="card">
        <h2>Kullanıcı eforu</h2>
        ${r.users.length ? `<table><thead><tr><th>Kullanıcı</th><th class="num">Saat</th><th class="num">Fat. saat</th><th class="num">Oran</th><th class="num">Hizmet bedeli</th></tr></thead>
          <tbody>${r.users.map((u) => `<tr><td>${esc(u.name)}</td><td class="num">${hrs(u.hours)}</td><td class="num">${hrs(u.billable_hours)}</td>
            <td class="num">${u.hours ? pct(u.billable_hours / u.hours) : '—'}</td><td class="num">${money(u.fee)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Kayıt yok.</div>'}
      </section>
      <section class="card">
        <h2>Gider özeti</h2>
        <table><thead><tr><th>Kategori</th><th class="num">Tutar (KDV hariç)</th><th class="num">KDV</th></tr></thead>
          <tbody>${r.expense_summary.categories.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${money(c.amount)}</td><td class="num">${money(c.vat)}</td></tr>`).join('')
            || '<tr><td colspan="3" class="empty">Masraf yok.</td></tr>'}</tbody>
          <tfoot>
            <tr><td>Müşteriye yansıtılan</td><td class="num">${money(r.expense_summary.billable)}</td><td></td></tr>
            <tr><td>Yansıtılmayan (maliyet)</td><td class="num">${money(r.expense_summary.nonbillable)}</td><td></td></tr>
            <tr class="total"><td>İndirilecek KDV</td><td></td><td class="num">${money(r.expense_summary.input_vat)}</td></tr>
          </tfoot></table>
      </section>
    </div>

    ${showDetails ? `
    <section class="card">
      <h2>Aktivite detayı</h2>
      <div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Kullanıcı</th><th>Müşteri / Proje</th><th>Açıklama</th><th class="num">Saat</th><th class="num">Ücret</th><th class="num">Tutar</th></tr></thead>
        <tbody>${r.activities.map((a) => `<tr class="${a.billable ? '' : 'muted'}"><td>${fmtDate(a.date)}</td><td>${esc(a.user_name)}</td><td>${clientProjectCell(a)}</td>
          <td>${esc(a.description)}</td><td class="num">${hrs(a.hours)}</td><td class="num">${money(a.rate)}</td><td class="num">${a.billable ? money(a.hours * a.rate) : 'Faturasız'}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="card">
      <h2>Masraf detayı</h2>
      <div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Kullanıcı</th><th>Müşteri / Proje</th><th>Kategori</th><th>Açıklama</th><th class="num">Tutar</th><th class="num">KDV</th><th>Yansıtılır</th></tr></thead>
        <tbody>${r.expenses.map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.user_name)}</td><td>${clientProjectCell(e)}</td><td>${esc(e.category)}</td>
          <td>${esc(e.description)}</td><td class="num">${money(e.amount)}</td><td class="num">${money(e.amount * e.vat_rate / 100)}</td><td>${e.billable ? 'Evet' : 'Hayır'}</td></tr>`).join('')
          || '<tr><td colspan="8" class="empty">Masraf yok.</td></tr>'}</tbody></table></div>
    </section>` : ''}`;
}
