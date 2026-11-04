// Aylık bütçe: müşteri planı (adam-gün), gerçekleşen ve tempo tahmini
import { state, $, main, api, toast, esc, money, hrs, pct, today, fmtDate, monthLabel, addMonths, opt, CURRENCY_LABELS } from '../core.js';
import { adminCrud } from '../components/admin-crud.js';

let month = today().slice(0, 7);

// Plan formu: müşteri zorunlu, şirket ve proje isteğe bağlı (seçime göre daralır)
function syncSelects(form, sel = {}) {
  const cust = form.elements.namedItem('customer_id');
  const comp = form.elements.namedItem('company_id');
  const proj = form.elements.namedItem('project_id');
  const companyId = sel.company_id ?? comp.value;
  const companies = state.companies.filter((c) => String(c.customer_id) === cust.value);
  comp.innerHTML = `<option value="">— Tüm şirketler —</option>${companies.map((c) => opt(c.id, c.name, companyId)).join('')}`;
  const projects = state.projects.filter((p) => String(p.company_id) === comp.value);
  proj.innerHTML = `<option value="">— Tüm projeler —</option>${projects.map((p) => opt(p.id, p.name, sel.project_id ?? proj.value)).join('')}`;
  proj.disabled = !comp.value;
}

const bar = (ratio) => (ratio == null ? '' : `<div class="progress"><span style="width:${Math.min(100, Math.round(ratio * 100))}%" class="${ratio >= 1 ? 'over' : ''}"></span></div>`);

export async function pageBudget() {
  let data;
  try {
    data = await api('GET', `/api/budget?month=${month}`);
  } catch (err) { return toast(err.message, true); }
  const bd = data.business_days;
  const isCurrent = month === today().slice(0, 7);

  main.innerHTML = `<h1>Bütçe</h1>
    <section class="card">
      <div class="toolbar">
        <div class="nav-date">
          <button type="button" class="secondary" data-prev aria-label="Önceki ay">‹</button>
          <button type="button" class="secondary" data-now>Bu ay</button>
          <button type="button" class="secondary" data-next aria-label="Sonraki ay">›</button>
          <b>${monthLabel(month)}</b>
        </div>
        <div class="small">${bd.total} iş günü · ${isCurrent ? `${bd.elapsed} geçti, ${bd.remaining} kaldı` : bd.elapsed ? 'tamamlandı' : 'başlamadı'}
          ${data.holidays.length ? ` · Tatiller: ${data.holidays.map((h) => `${fmtDate(h.date).slice(0, 5)} ${esc(h.name)}`).join(', ')}` : ''}</div>
      </div>
      ${data.rows.length ? `<div class="table-wrap"><table class="budget">
        <thead>
          <tr><th rowspan="2">Müşteri</th><th colspan="2" class="center">Plan</th><th colspan="3" class="center">Gerçekleşen</th><th colspan="3" class="center">Tahmin (ay sonu)</th></tr>
          <tr><th class="num">Adam-gün</th><th class="num">Tutar</th><th class="num">Adam-gün</th><th class="num">Tutar</th><th>Plana göre</th>
            <th class="num">Adam-gün</th><th class="num">Tutar</th><th>Plana göre</th></tr>
        </thead>
        <tbody>${data.rows.map((r) => row(r)).join('')}</tbody>
        <tfoot>${data.totals.map((r) => row(r, true)).join('')}</tfoot>
      </table></div>
      <p class="hint">Tahmin = gerçekleşen ÷ geçen iş günü × ayın iş günü (yalnızca faturalanabilir efor). Plan tutarı, planlanan adam-gün × geçerli günlük ücret.</p>`
      : '<div class="empty">Bu ay için plan veya faturalanabilir efor yok.</div>'}
    </section>
    <div data-plans></div>`;

  $('[data-prev]').onclick = () => { month = addMonths(month, -1); pageBudget(); };
  $('[data-next]').onclick = () => { month = addMonths(month, 1); pageBudget(); };
  $('[data-now]').onclick = () => { month = today().slice(0, 7); pageBudget(); };

  adminCrud($('[data-plans]'), {
    compact: true, deletable: true,
    listTitle: `${monthLabel(month)} planı`, newTitle: 'Yeni plan', editTitle: 'Planı düzenle', addLabel: 'Plan ekle',
    intro: 'Her müşteri için bu ay planlanan adam-gün. İsterseniz şirket veya proje bazında ayrı satır girebilirsiniz.',
    emptyText: `Bu ay için plan yok. <button type="button" class="link" data-copy>${monthLabel(addMonths(month, -1))} planını kopyala</button>`,
    endpoint: '/api/plans', rows: () => data.plans, onSaved: pageBudget,
    fields: () => `
      <label class="wide">Müşteri<select name="customer_id" required><option value="">Seçin…</option>${state.customers.filter((c) => c.active).map((c) => opt(c.id, c.name)).join('')}</select></label>
      <label>Şirket<select name="company_id"></select></label>
      <label>Proje<select name="project_id"></select></label>
      <label>Planlanan adam-gün<input name="planned_days" inputmode="decimal" required></label>
      <label class="wide">Not<input name="notes"></label>`,
    bind: (f) => {
      f.elements.namedItem('customer_id').addEventListener('change', () => syncSelects(f, { company_id: '', project_id: '' }));
      f.elements.namedItem('company_id').addEventListener('change', () => syncSelects(f, { project_id: '' }));
    },
    defaults: (f) => syncSelects(f, { company_id: '', project_id: '' }),
    onEdit: (f, r) => syncSelects(f, { company_id: r.company_id ?? '', project_id: r.project_id ?? '' }),
    toForm: (r) => ({ ...r, company_id: r.company_id ?? '', project_id: r.project_id ?? '', planned_days: String(r.planned_days).replace('.', ',') }),
    toPayload: (d) => ({ ...d, month, planned_days: String(d.planned_days).replace(',', '.') }),
    columns: [
      { h: 'Müşteri / Şirket / Proje', v: (r) => `<b>${esc(r.customer_name)}</b>${r.company_name ? `<div class="small">${esc(r.company_name)}${r.project_name ? ` › ${esc(r.project_name)}` : ''}</div>` : ''}` },
      { h: 'Adam-gün', cls: 'num', v: (r) => hrs(r.planned_days) },
      { h: 'Günlük ücret', cls: 'num', v: (r) => money(r.daily_rate, r.currency) },
      { h: 'Plan tutarı', cls: 'num', v: (r) => money(r.planned_amount, r.currency) },
      { h: 'Not', v: (r) => esc(r.notes) },
    ],
  });

  const copy = $('[data-copy]');
  if (copy) copy.onclick = async () => {
    try {
      const { copied } = await api('POST', '/api/plans/copy', { from_month: addMonths(month, -1), to_month: month });
      toast(copied ? `${copied} plan kopyalandı` : 'Önceki ayda plan yok');
      pageBudget();
    } catch (err) { toast(err.message, true); }
  };
}

function row(r, total = false) {
  const m = (v) => (v == null ? '—' : money(v, r.currency));
  const name = total ? `Toplam <span class="badge cur">${r.currency}</span>` : `${esc(r.customer_name)}${state.customers.length && r.currency !== 'TRY' ? ` <span class="badge cur">${r.currency}</span>` : ''}`;
  return `<tr class="${total ? 'total' : ''}"><td title="${CURRENCY_LABELS[r.currency]}">${name}</td>
    <td class="num">${r.planned_days ? hrs(r.planned_days) : '—'}</td><td class="num">${r.planned_amount ? m(r.planned_amount) : '—'}</td>
    <td class="num">${hrs(r.actual_days)}</td><td class="num">${m(r.actual_amount)}</td>
    <td>${r.actual_pct == null ? '' : `${pct(r.actual_pct)}${bar(r.actual_pct)}`}</td>
    <td class="num">${r.forecast_days == null ? '—' : hrs(r.forecast_days)}</td><td class="num">${m(r.forecast_amount)}</td>
    <td>${r.forecast_pct == null ? '' : `<span class="${r.forecast_pct < 0.9 ? 'neg' : r.forecast_pct > 1.1 ? 'pos' : ''}">${pct(r.forecast_pct)}</span>${bar(r.forecast_pct)}`}</td></tr>`;
}
