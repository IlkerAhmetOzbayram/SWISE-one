// Ortak durum ve yardımcılar

export const state = { user: null, settings: {}, clients: [], projects: [], users: [] };
export const isAdmin = () => state.user?.role === 'admin';
export const $ = (sel, root = document) => root.querySelector(sel);
export const main = $('#main');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moneyFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
export const money = (n) => moneyFmt.format(n || 0);
export const hrs = (n) => (n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
export const pct = (n) => (n || 0).toLocaleString('tr-TR', { style: 'percent', maximumFractionDigits: 0 });
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
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
  [state.settings, state.clients, state.projects, state.users] = await Promise.all([
    api('GET', '/api/settings'), api('GET', '/api/clients'), api('GET', '/api/projects'), api('GET', '/api/users'),
  ]);
}

export const LOGO_HTML = `<img src="swise-mark.png" alt="">
  <span class="wordmark"><b>SWISE</b><small>Teknoloji ve Danışmanlık</small></span>`;

// Proje seçimi: müşteriye göre gruplu, yalnızca aktifler (+ düzenlenen kaydın projesi)
export function projectOptions(selected, { all = false } = {}) {
  const groups = new Map();
  for (const p of state.projects) {
    if (!all && !p.active && String(p.id) !== String(selected)) continue;
    if (!groups.has(p.client_name)) groups.set(p.client_name, []);
    groups.get(p.client_name).push(p);
  }
  return [...groups].map(([client, ps]) =>
    `<optgroup label="${esc(client)}">${ps.map((p) => opt(p.id, p.name + (p.active ? '' : ' (pasif)'), selected)).join('')}</optgroup>`).join('');
}

export const userOptions = (selected) => state.users.filter((u) => u.active !== 0).map((u) => opt(u.id, u.full_name, selected)).join('');

export const clientProjectCell = (r) => `${esc(r.client_name)}<div class="small">${esc(r.project_name)}</div>`;
export const yesNo = (v, yes = 'Evet', no = 'Hayır') => `<span class="badge${v ? '' : ' off'}">${v ? yes : no}</span>`;
