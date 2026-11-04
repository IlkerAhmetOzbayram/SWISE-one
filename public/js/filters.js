// Dönem filtresi (sayfalar arasında ortak)
import { state, $, iso, today, opt, projectOptions, companyLabel } from './core.js';

export const filters = {
  from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  to: today(),
  user_id: '',
  customer_id: '',
  company_id: '',
  project_id: '',
};

// Seçili müşterinin şirketleri (müşteri seçilmemişse hepsi)
const companyFilterOptions = () => state.companies
  .filter((c) => !filters.customer_id || String(c.customer_id) === String(filters.customer_id))
  .map((c) => opt(c.id, companyLabel(c.customer_name, c.name), filters.company_id)).join('');

function presetRange(key) {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth();
  switch (key) {
    case 'thisMonth': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    case 'lastMonth': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case 'thisQuarter': { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))]; }
    case 'thisYear': return [`${y}-01-01`, `${y}-12-31`];
    case 'all': return ['', ''];
  }
}

export function filterBar({ user = false, clients = true, extra = '' } = {}) {
  return `<div class="filters no-print">
    <label>Başlangıç<input type="date" data-f="from" value="${filters.from}"></label>
    <label>Bitiş<input type="date" data-f="to" value="${filters.to}"></label>
    <label>Hızlı seçim<select data-preset>
      <option value="">—</option><option value="thisMonth">Bu ay</option><option value="lastMonth">Geçen ay</option>
      <option value="thisQuarter">Bu çeyrek</option><option value="thisYear">Bu yıl</option><option value="all">Tümü</option>
    </select></label>
    ${user ? `<label>Kullanıcı<select data-f="user_id"><option value="">Tümü</option>${state.users.map((u) => opt(u.id, u.full_name, filters.user_id)).join('')}</select></label>` : ''}
    ${clients ? `<label>Müşteri<select data-f="customer_id"><option value="">Tümü</option>${state.customers.map((c) => opt(c.id, c.name, filters.customer_id)).join('')}</select></label>
    <label>Şirket<select data-f="company_id"><option value="">Tümü</option>${companyFilterOptions()}</select></label>
    <label>Proje<select data-f="project_id"><option value="">Tümü</option>${projectOptions(filters.project_id, { all: true })}</select></label>` : ''}
    <div class="spacer"></div>${extra}
  </div>`;
}

export function bindFilterBar(root, onChange) {
  root.querySelectorAll('[data-f]').forEach((el) => {
    el.onchange = () => {
      filters[el.dataset.f] = el.value;
      // Müşteri değişince şirket listesi daraltılır, uyumsuz şirket seçimi temizlenir
      if (el.dataset.f === 'customer_id') {
        const company = state.companies.find((c) => String(c.id) === String(filters.company_id));
        if (company && filters.customer_id && String(company.customer_id) !== String(filters.customer_id)) filters.company_id = '';
        const sel = $('[data-f="company_id"]', root);
        if (sel) sel.innerHTML = `<option value="">Tümü</option>${companyFilterOptions()}`;
      }
      onChange();
    };
  });
  const preset = $('[data-preset]', root);
  preset.onchange = () => {
    if (!preset.value) return;
    [filters.from, filters.to] = presetRange(preset.value);
    $('[data-f="from"]', root).value = filters.from;
    $('[data-f="to"]', root).value = filters.to;
    onChange();
  };
}
