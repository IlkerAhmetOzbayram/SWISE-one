// Aktivite/masraf formları için Müşteri › Şirket › Proje seçici.
// Şirket kutusu yalnızca müşterinin birden fazla şirketi varsa görünür; proje isteğe bağlıdır.
import { state, opt } from '../core.js';

const usableOr = (row, selected) => row.usable || String(row.id) === String(selected ?? '');

export function targetFields() {
  return `
    <label class="wide">Müşteri<select name="_customer" required></select></label>
    <label class="wide" data-company-wrap>Şirket<select name="company_id" required></select></label>
    <label class="wide">Proje <span class="small">(isteğe bağlı)</span><select name="project_id"></select></label>`;
}

const field = (form, n) => form.elements.namedItem(n);

// Kullanılabilir şirketi olan müşteriler (+ düzenlenen kaydın müşterisi)
export function hasTargets() {
  return state.companies.some((c) => c.usable);
}

function fillCustomers(form, selectedCustomer) {
  const ids = new Set(state.companies.filter((c) => c.usable).map((c) => c.customer_id));
  if (selectedCustomer) ids.add(Number(selectedCustomer));
  const list = state.customers.filter((c) => ids.has(c.id));
  field(form, '_customer').innerHTML = `<option value="">Seçin…</option>${list.map((c) => opt(c.id, c.name + (c.active ? '' : ' (pasif)'), selectedCustomer)).join('')}`;
}

function fillCompanies(form, selectedCompany) {
  const customerId = Number(field(form, '_customer').value);
  const list = state.companies.filter((c) => c.customer_id === customerId && usableOr(c, selectedCompany));
  const sel = field(form, 'company_id');
  sel.innerHTML = list.map((c) => opt(c.id, c.name + (c.usable ? '' : ' (pasif)'), selectedCompany ?? list[0]?.id)).join('');
  // Tek şirketli müşteride şirket = müşteri; kutu gizlenir
  form.querySelector('[data-company-wrap]').hidden = list.length <= 1;
}

function fillProjects(form, selectedProject) {
  const companyId = Number(field(form, 'company_id').value);
  const list = state.projects.filter((p) => p.company_id === companyId && usableOr(p, selectedProject));
  field(form, 'project_id').innerHTML = `<option value="">— Proje yok —</option>${list.map((p) => opt(p.id, p.name + (p.usable ? '' : ' (pasif)'), selectedProject)).join('')}`;
}

// Seçimi ayarlar (yeni kayıtta boş, düzenlemede kaydın değerleri)
export function setTarget(form, { customer_id = '', company_id = '', project_id = '' } = {}) {
  fillCustomers(form, customer_id);
  field(form, '_customer').value = customer_id ?? '';
  fillCompanies(form, company_id || undefined);
  fillProjects(form, project_id);
  field(form, 'project_id').value = project_id ?? '';
}

export const getTarget = (form) => ({
  customer_id: field(form, '_customer').value,
  company_id: field(form, 'company_id').value,
  project_id: field(form, 'project_id').value,
});

export function bindTarget(form, onChange = () => {}) {
  field(form, '_customer').addEventListener('change', () => { fillCompanies(form); fillProjects(form); onChange(form); });
  field(form, 'company_id').addEventListener('change', () => { fillProjects(form); onChange(form); });
  field(form, 'project_id').addEventListener('change', () => onChange(form));
}

// Seçilen şirket/projenin geçerli günlük ücreti ve para birimi (yönetici verisinden)
export function effectiveRate(form) {
  const company = state.companies.find((c) => String(c.id) === field(form, 'company_id').value);
  if (!company) return null;
  const project = state.projects.find((p) => String(p.id) === field(form, 'project_id').value);
  return {
    daily_rate: project?.effective_daily_rate ?? company.effective_daily_rate,
    currency: company.effective_currency,
  };
}
