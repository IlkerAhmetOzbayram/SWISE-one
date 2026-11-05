// Müşteri efor raporu: müşteriye gönderilebilir döküm (ücret/tutar içermez)
import { state, can, $, main, api, toast, esc, hrs, today, fmtDate, dayShort, qs, opt, LOGO_HTML } from '../core.js';
import { filters } from '../filters.js';

const opts = { customer_id: '', company_id: '', billable_only: true };

export const reportTabs = (active) => `<div class="tabs no-print" style="margin-bottom:16px">
  ${can('reports.view') ? `<a href="#/rapor" class="${active === 'muhasebe' ? 'active' : ''}">Muhasebe raporu</a>` : ''}
  ${can('effort_report.view') ? `<a href="#/rapor/efor" class="${active === 'efor' ? 'active' : ''}">Müşteri efor raporu</a>` : ''}</div>`;

// "Sorumlu olduğu" kapsamında yalnızca yöneticisi olunan müşteriler listelenir
const reportCustomers = () => (can('effort_report.view') === 'all' ? state.customers : state.customers.filter((c) => c.manager_id === state.user.id));

export function pageEffortReport() {
  const customers = reportCustomers();
  if (!customers.some((c) => String(c.id) === opts.customer_id)) opts.customer_id = customers.length ? String(customers[0].id) : '';
  const companies = state.companies.filter((c) => String(c.customer_id) === opts.customer_id);

  main.innerHTML = `<h1 class="no-print">Raporlar</h1>${reportTabs('efor')}
    <section class="card no-print">
      <div class="filters">
        <label>Müşteri<select data-o="customer_id">${customers.map((c) => opt(c.id, c.name, opts.customer_id)).join('')}</select></label>
        ${companies.length > 1 ? `<label>Şirket<select data-o="company_id"><option value="">Tümü</option>${companies.map((c) => opt(c.id, c.name, opts.company_id)).join('')}</select></label>` : ''}
        <label>Başlangıç<input type="date" data-f="from" value="${filters.from}"></label>
        <label>Bitiş<input type="date" data-f="to" value="${filters.to}"></label>
        <label class="check"><input type="checkbox" data-billable ${opts.billable_only ? 'checked' : ''}> Yalnızca faturalanabilir</label>
        <div class="spacer"></div>
        <div class="actions"><button type="button" class="secondary" data-xlsx>Excel indir</button><button type="button" data-print>Yazdır / PDF</button></div>
      </div>
      <p class="hint" style="margin:0">Bu rapor müşteriye gönderilmek üzere hazırlanır; ücret ve tutar bilgisi içermez.</p>
    </section>
    <div data-report>${customers.length ? '' : '<div class="empty">Raporunu alabileceğiniz müşteri yok.</div>'}</div>`;

  const params = () => qs({ customer_id: opts.customer_id, company_id: opts.company_id, from: filters.from, to: filters.to, billable_only: opts.billable_only ? '1' : '0' });
  main.querySelectorAll('[data-o]').forEach((el) => {
    el.onchange = () => { opts[el.dataset.o] = el.value; if (el.dataset.o === 'customer_id') opts.company_id = ''; pageEffortReport(); };
  });
  main.querySelectorAll('[data-f]').forEach((el) => { el.onchange = () => { filters[el.dataset.f] = el.value; load(); }; });
  $('[data-billable]').onchange = (e) => { opts.billable_only = e.target.checked; load(); };
  $('[data-xlsx]').onclick = () => { location.href = `/api/effort-report.xlsx?${params()}`; };
  $('[data-print]').onclick = () => window.print();

  async function load() {
    if (!opts.customer_id) return;
    try {
      render(await api('GET', `/api/effort-report?${params()}`));
    } catch (err) { toast(err.message, true); }
  }
  load();
}

function render(r) {
  const period = `${r.period.from ? fmtDate(r.period.from) : 'Başlangıç'} – ${r.period.to ? fmtDate(r.period.to) : 'Bugün'}`;
  $('[data-report]').innerHTML = `
    <section class="card">
      <div class="report-head">
        <div class="print-logo">${LOGO_HTML}</div>
        <div><h1 style="margin:0">${esc(r.customer.name)} — Efor Raporu</h1>
          <div class="small">Dönem: ${period} · Hazırlanma: ${fmtDate(today())}${r.billable_only ? '' : ' · faturalanmayan efor dahil'}</div></div>
      </div>
      <div class="stats" style="margin-top:16px">
        <div class="stat"><div class="label">Toplam saat</div><div class="value">${hrs(r.total.hours)}</div></div>
        <div class="stat"><div class="label">Adam-gün</div><div class="value">${hrs(r.total.days)}</div></div>
        <div class="stat"><div class="label">Kayıt sayısı</div><div class="value">${r.rows.length}</div></div>
        <div class="stat"><div class="label">Çalışan kişi</div><div class="value">${r.by_user.length}</div></div>
      </div>
      ${r.rows.length ? `<div class="split">
        <div><h2>Şirket / proje bazında</h2><table>
          <thead><tr><th>Şirket / Proje</th><th class="num">Saat</th><th class="num">Adam-gün</th></tr></thead>
          <tbody>${r.by_target.map((t) => `<tr><td>${esc(t.company_name)}${t.project_name ? `<div class="small">${esc(t.project_name)}</div>` : ''}</td>
            <td class="num">${hrs(t.hours)}</td><td class="num">${hrs(t.days)}</td></tr>`).join('')}</tbody></table></div>
        <div><h2>Kişi bazında</h2><table>
          <thead><tr><th>Kişi</th><th class="num">Saat</th><th class="num">Adam-gün</th></tr></thead>
          <tbody>${r.by_user.map((u) => `<tr><td>${esc(u.user_name)}</td><td class="num">${hrs(u.hours)}</td><td class="num">${hrs(u.days)}</td></tr>`).join('')}</tbody></table></div>
      </div>
      <h2 style="margin-top:18px">Detay</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Tarih</th><th>Şirket / Proje</th><th>Kişi</th><th>Açıklama</th><th class="num">Saat</th></tr></thead>
        <tbody>${r.rows.map((x) => `<tr><td style="white-space:nowrap">${fmtDate(x.date)} <span class="small">${dayShort(x.date)}</span></td>
          <td>${esc(x.company_name)}${x.project_name ? `<div class="small">${esc(x.project_name)}</div>` : ''}</td>
          <td>${esc(x.user_name)}</td><td>${esc(x.description)}</td><td class="num">${hrs(x.hours)}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="total"><td colspan="4">Toplam</td><td class="num">${hrs(r.total.hours)}</td></tr></tfoot>
      </table></div>` : '<div class="empty">Bu dönemde efor kaydı yok.</div>'}
    </section>`;
}
