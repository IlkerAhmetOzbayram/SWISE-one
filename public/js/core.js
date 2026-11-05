// Ortak durum ve yardımcılar

export const state = { user: null, settings: {}, customers: [], companies: [], projects: [], users: [] };
// Yetki yardımcıları (sunucu da aynı kuralları uygular; arayüz yalnızca gösterilecekleri seçer)
export const can = (key) => state.user?.perms?.[key];
export const seeOthers = (module) => !!can(`${module}.view`) && can(`${module}.view`) !== 'own';
export const editOthers = (module) => can(`${module}.edit`) === 'all';
export const seeRates = () => !!can('rates.view');
export const isAdmin = () => !!can('roles.edit');
export const $ = (sel, root = document) => root.querySelector(sel);
export const main = $('#main');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const CURRENCIES = ['TRY', 'EUR', 'USD'];
export const CURRENCY_LABELS = { TRY: 'TL (₺)', EUR: 'Euro (€)', USD: 'Dolar ($)' };
const moneyFmts = {};
export const money = (n, currency = 'TRY') => {
  moneyFmts[currency] ??= new Intl.NumberFormat('tr-TR', { style: 'currency', currency });
  return moneyFmts[currency].format(n || 0);
};
// { TRY: 100, EUR: 5 } → "₺100,00 · €5,00"
export const moneyByCurrency = (map) => {
  const parts = CURRENCIES.filter((c) => map[c]).map((c) => money(map[c], c));
  return parts.length ? parts.join(' · ') : '—';
};
export const HOURS_PER_DAY = 8;
export const hrs = (n) => (n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
export const pct = (n) => (n || 0).toLocaleString('tr-TR', { style: 'percent', maximumFractionDigits: 0 });
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parseDay = (s) => new Date(`${s}T00:00:00`);
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return iso(d); };
export const weekStart = (s) => addDays(s, -((parseDay(s).getDay() + 6) % 7)); // Pazartesi
export const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const dayName = (s) => DAY_NAMES[parseDay(s).getDay()];
export const dayShort = (s) => DAY_SHORT[parseDay(s).getDay()];
export const isWeekend = (s) => [0, 6].includes(parseDay(s).getDay());
export const monthLabel = (m) => parseDay(`${m}-01`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
export const addMonths = (m, n) => { const d = parseDay(`${m}-01`); d.setMonth(d.getMonth() + n); return iso(d).slice(0, 7); };
export const monthEnd = (m) => { const d = parseDay(`${m}-01`); d.setMonth(d.getMonth() + 1, 0); return iso(d); };
export const fmtDate = (s) => (s ? s.split('-').reverse().join('.') : '');
export const fmtDateTime = (s) => (s ? new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB` : `${Math.ceil(n / 1024)} KB`);
export const opt = (value, label, selected) =>
  `<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
export const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
export const sum = (rows, fn) => rows.reduce((a, r) => a + fn(r), 0);

// "1,5" → 1.5, "1:30" → 1.5
export function parseHours(s) {
  s = String(s).trim();
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    return Number(h || 0) + Number(m || 0) / 60;
  }
  return Number(s.replace(',', '.'));
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && state.user) { location.reload(); }
  if (!res.ok) throw new Error(data?.error || 'Beklenmeyen bir hata oluştu');
  return data;
}

let toastTimer;
export function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${isErr ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 2600);
}

export function formToObj(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}

export function fillForm(form, data) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in data)) continue;
    if (el.type === 'checkbox') el.checked = !!data[el.name];
    else el.value = data[el.name] ?? '';
  }
}

export async function loadRefs() {
  [state.settings, state.customers, state.companies, state.projects, state.users] = await Promise.all([
    api('GET', '/api/settings'), api('GET', '/api/customers'), api('GET', '/api/companies'),
    api('GET', '/api/projects'), api('GET', '/api/users'),
  ]);
}

export const currencyOptions = (selected, { inherit } = {}) =>
  (inherit ? opt('', `Müşteriden (${inherit})`, selected ?? '') : '') + CURRENCIES.map((c) => opt(c, CURRENCY_LABELS[c], selected)).join('');

// "Müşteri › Şirket" (tek şirketli müşteride şirket adı aynıysa yalnızca müşteri adı)
export const companyLabel = (customerName, companyName) =>
  (customerName === companyName ? customerName : `${customerName} › ${companyName}`);

export const LOGO_HTML = `<img src="swise-mark.png" alt="">
  <span class="wordmark"><b>SWISE</b><small>Teknoloji ve Danışmanlık</small></span>`;

// Proje seçimi: "Müşteri › Şirket" gruplu, yalnızca kullanılabilirler (+ düzenlenen kaydın projesi)
export function projectOptions(selected, { all = false } = {}) {
  const groups = new Map();
  for (const p of state.projects) {
    if (!all && !p.usable && String(p.id) !== String(selected)) continue;
    const label = companyLabel(p.customer_name, p.company_name);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(p);
  }
  return [...groups].map(([label, ps]) =>
    `<optgroup label="${esc(label)}">${ps.map((p) => opt(p.id, p.name + (p.usable ? '' : ' (pasif)'), selected)).join('')}</optgroup>`).join('');
}

export const projectById = (id) => state.projects.find((p) => String(p.id) === String(id));

export const userOptions = (selected) => state.users.filter((u) => u.active !== 0).map((u) => opt(u.id, u.full_name, selected)).join('');

export const clientProjectCell = (r) =>
  `${esc(companyLabel(r.customer_name, r.company_name))}${r.project_name ? `<div class="small">${esc(r.project_name)}</div>` : ''}`;
export const yesNo = (v, yes = 'Evet', no = 'Hayır') => `<span class="badge${v ? '' : ' off'}">${v ? yes : no}</span>`;
