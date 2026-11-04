'use strict';

// ---------- Durum ve yardımcılar ----------
const state = { user: null, settings: {}, clients: [], projects: [], users: [] };
const isAdmin = () => state.user?.role === 'admin';
const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moneyFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
const money = (n) => moneyFmt.format(n || 0);
const hrs = (n) => (n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const pct = (n) => (n || 0).toLocaleString('tr-TR', { style: 'percent', maximumFractionDigits: 0 });
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const fmtDate = (s) => (s ? s.split('-').reverse().join('.') : '');
const opt = (value, label, selected) =>
  `<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

// "1,5" → 1.5, "1:30" → 1.5
function parseHours(s) {
  s = String(s).trim();
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    return Number(h || 0) + Number(m || 0) / 60;
  }
  return Number(s.replace(',', '.'));
}

async function api(method, url, body) {
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
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${isErr ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 2600);
}

function formToObj(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}
function fillForm(form, data) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in data)) continue;
    if (el.type === 'checkbox') el.checked = !!data[el.name];
    else el.value = data[el.name] ?? '';
  }
}

async function loadRefs() {
  [state.settings, state.clients, state.projects, state.users] = await Promise.all([
    api('GET', '/api/settings'), api('GET', '/api/clients'), api('GET', '/api/projects'), api('GET', '/api/users'),
  ]);
}

const LOGO_HTML = `<img src="swise-mark.png" alt="">
  <span class="wordmark"><b>SWISE</b><small>Teknoloji ve Danışmanlık</small></span>`;

// Proje seçimi: müşteriye göre gruplu, yalnızca aktifler (+ düzenlenen kaydın projesi)
function projectOptions(selected, { all = false } = {}) {
  const groups = new Map();
  for (const p of state.projects) {
    if (!all && !p.active && String(p.id) !== String(selected)) continue;
    if (!groups.has(p.client_name)) groups.set(p.client_name, []);
    groups.get(p.client_name).push(p);
  }
  return [...groups].map(([client, ps]) =>
    `<optgroup label="${esc(client)}">${ps.map((p) => opt(p.id, p.name + (p.active ? '' : ' (pasif)'), selected)).join('')}</optgroup>`).join('');
}
const userOptions = (selected) => state.users.filter((u) => u.active !== 0).map((u) => opt(u.id, u.full_name, selected)).join('');

// ---------- Dönem filtresi (sayfalar arasında ortak) ----------
const filters = { from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: today(), user_id: '', client_id: '', project_id: '' };

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

function filterBar({ user = false, extra = '' } = {}) {
  return `<div class="filters no-print">
    <label>Başlangıç<input type="date" data-f="from" value="${filters.from}"></label>
    <label>Bitiş<input type="date" data-f="to" value="${filters.to}"></label>
    <label>Hızlı seçim<select data-preset>
      <option value="">—</option><option value="thisMonth">Bu ay</option><option value="lastMonth">Geçen ay</option>
      <option value="thisQuarter">Bu çeyrek</option><option value="thisYear">Bu yıl</option><option value="all">Tümü</option>
    </select></label>
    ${user ? `<label>Kullanıcı<select data-f="user_id"><option value="">Tümü</option>${state.users.map((u) => opt(u.id, u.full_name, filters.user_id)).join('')}</select></label>` : ''}
    <label>Müşteri<select data-f="client_id"><option value="">Tümü</option>${state.clients.map((c) => opt(c.id, c.name, filters.client_id)).join('')}</select></label>
    <label>Proje<select data-f="project_id"><option value="">Tümü</option>${projectOptions(filters.project_id, { all: true })}</select></label>
    <div class="spacer"></div>${extra}
  </div>`;
}
function bindFilterBar(root, onChange) {
  root.querySelectorAll('[data-f]').forEach((el) => {
    el.onchange = () => { filters[el.dataset.f] = el.value; onChange(); };
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

// ---------- Aktivite / masraf giriş sayfası (ortak iskelet) ----------
function entryPage(cfg) {
  const noProjects = !state.projects.some((p) => p.active);
  main.innerHTML = `<h1>${cfg.title}</h1>
    <section class="card">
      <h2 data-title>${cfg.newTitle}</h2>
      ${noProjects ? `<p class="hint">Henüz aktif proje yok. ${isAdmin() ? '<a href="#/musteriler">Müşteri ve proje ekleyin</a>.' : 'Yöneticinizden proje tanımlamasını isteyin.'}</p>` : ''}
      <form class="grid" id="entryForm" ${noProjects ? 'hidden' : ''}>
        <input type="hidden" name="_id">
        ${cfg.fields()}
        <div class="actions"><button type="submit">Kaydet</button><button type="button" class="secondary" data-cancel hidden>Vazgeç</button></div>
      </form>
    </section>
    <section class="card">
      ${filterBar({ user: isAdmin() })}
      <div class="table-wrap" data-list></div>
    </section>`;

  const form = $('#entryForm');
  const field = (n) => form.elements.namedItem(n);
  const title = $('[data-title]');
  const cancel = $('[data-cancel]');
  let rows = [];

  function reset(keepContext) {
    const keep = { date: field('date').value, project_id: field('project_id').value };
    form.reset();
    field('_id').value = '';
    cfg.defaults(form);
    if (keepContext && keep.date) { field('date').value = keep.date; field('project_id').value = keep.project_id; }
    title.textContent = cfg.newTitle;
    cancel.hidden = true;
  }

  async function load() {
    try {
      rows = await api('GET', `${cfg.endpoint}?${qs(filters)}`);
    } catch (err) { return toast(err.message, true); }
    const cols = cfg.columns.filter((c) => !c.admin || isAdmin());
    $('[data-list]').innerHTML = rows.length ? `<table>
      <thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${c.h}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.v(r)}</td>`).join('')}
        <td class="num"><button class="link" data-edit="${r.id}">Düzenle</button><button class="link danger" data-del="${r.id}">Sil</button></td></tr>`).join('')}</tbody>
      <tfoot><tr class="total">${cfg.footer(rows, cols)}<td></td></tr></tfoot>
    </table>` : '<div class="empty">Bu dönemde kayıt yok.</div>';
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formToObj(form);
    const id = d._id;
    delete d._id;
    try {
      await api(id ? 'PUT' : 'POST', id ? `${cfg.endpoint}/${id}` : cfg.endpoint, cfg.toPayload(d));
      toast(id ? 'Kayıt güncellendi' : 'Kayıt eklendi');
      reset(!id);
      load();
    } catch (err) { toast(err.message, true); }
  };
  cancel.onclick = () => reset(false);

  $('[data-list]').onclick = async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
      const row = rows.find((r) => r.id === Number(edit.dataset.edit));
      // Pasif projeli kayıt için seçeneklerin yeniden üretilmesi
      field('project_id').innerHTML = projectOptions(row.project_id);
      fillForm(form, { ...cfg.toForm(row), _id: row.id });
      title.textContent = cfg.editTitle;
      cancel.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (del && confirm('Bu kayıt silinsin mi?')) {
      try {
        await api('DELETE', `${cfg.endpoint}/${del.dataset.del}`);
        toast('Kayıt silindi');
        load();
      } catch (err) { toast(err.message, true); }
    }
  };

  bindFilterBar(main, load);
  reset(false);
  load();
}

const clientProjectCell = (r) => `${esc(r.client_name)}<div class="small">${esc(r.project_name)}</div>`;
const yesNo = (v, yes = 'Evet', no = 'Hayır') => `<span class="badge${v ? '' : ' off'}">${v ? yes : no}</span>`;
const sum = (rows, fn) => rows.reduce((a, r) => a + fn(r), 0);
// Alt toplam satırı: ilk sütunlar boş, belirtilen sütunlara değer yazılır
function footerCells(cols, values) {
  return cols.map((c, i) => (i === 0 ? '<td>Toplam</td>' : `<td class="${c.cls || ''}">${values[c.key] ?? ''}</td>`)).join('');
}

function pageActivities() {
  entryPage({
    title: 'Aktiviteler',
    newTitle: 'Yeni aktivite',
    editTitle: 'Aktiviteyi düzenle',
    endpoint: '/api/activities',
    fields: () => `
      <label>Tarih<input type="date" name="date" required></label>
      <label class="wide">Müşteri / Proje<select name="project_id" required>${projectOptions()}</select></label>
      <label>Süre (saat)<input name="hours" placeholder="1,5 veya 1:30" inputmode="decimal" required></label>
      <label class="full">Açıklama<input name="description" placeholder="Ne üzerinde çalışıldı?" required></label>
      ${isAdmin() ? `<label>Kullanıcı<select name="user_id">${userOptions()}</select></label>
      <label>Saatlik ücret (₺)<input name="rate" inputmode="decimal" placeholder="Otomatik"></label>` : ''}
      <label class="check"><input type="checkbox" name="billable"> Faturalanabilir</label>`,
    defaults: (f) => {
      f.elements.namedItem('date').value = today();
      f.elements.namedItem('billable').checked = true;
      if (isAdmin()) f.elements.namedItem('user_id').value = state.user.id;
    },
    toPayload: (d) => {
      const hours = parseHours(d.hours);
      if (!(hours > 0)) throw new Error('Süre geçersiz');
      return { ...d, hours };
    },
    toForm: (r) => ({ ...r, hours: hrs(r.hours), rate: r.rate ?? '' }),
    columns: [
      { h: 'Tarih', v: (r) => fmtDate(r.date) },
      { h: 'Kullanıcı', admin: true, v: (r) => esc(r.user_name) },
      { h: 'Müşteri / Proje', v: clientProjectCell },
      { h: 'Açıklama', v: (r) => esc(r.description) },
      { h: 'Saat', key: 'hours', cls: 'num', v: (r) => hrs(r.hours) },
      { h: 'Fatura', key: 'billable', v: (r) => yesNo(r.billable) },
      { h: 'Ücret', admin: true, cls: 'num', v: (r) => money(r.rate) },
      { h: 'Tutar', key: 'amount', admin: true, cls: 'num', v: (r) => (r.billable ? money(r.hours * r.rate) : '—') },
    ],
    footer: (rows, cols) => footerCells(cols, {
      hours: hrs(sum(rows, (r) => r.hours)),
      billable: `<span class="small">${hrs(sum(rows, (r) => (r.billable ? r.hours : 0)))} sa</span>`,
      amount: money(sum(rows, (r) => (r.billable ? r.hours * r.rate : 0))),
    }),
  });
}

function pageExpenses() {
  const cats = (state.settings.expense_categories || '').split(',').map((s) => s.trim()).filter(Boolean);
  entryPage({
    title: 'Masraflar',
    newTitle: 'Yeni masraf',
    editTitle: 'Masrafı düzenle',
    endpoint: '/api/expenses',
    fields: () => `
      <label>Tarih<input type="date" name="date" required></label>
      <label class="wide">Müşteri / Proje<select name="project_id" required>${projectOptions()}</select></label>
      <label>Kategori<select name="category" required>${cats.map((c) => opt(c, c)).join('')}</select></label>
      <label class="wide">Açıklama<input name="description" placeholder="Örn. İstanbul–Ankara uçak bileti"></label>
      <label>Tutar, KDV hariç (₺)<input name="amount" inputmode="decimal" required></label>
      <label>KDV oranı<select name="vat_rate">${[0, 1, 10, 20].map((v) => opt(v, `%${v}`, 20)).join('')}</select></label>
      ${isAdmin() ? `<label>Kullanıcı<select name="user_id">${userOptions()}</select></label>` : ''}
      <label class="check"><input type="checkbox" name="billable"> Müşteriye yansıtılır</label>`,
    defaults: (f) => {
      f.elements.namedItem('date').value = today();
      f.elements.namedItem('billable').checked = true;
      f.elements.namedItem('vat_rate').value = '20';
      if (isAdmin()) f.elements.namedItem('user_id').value = state.user.id;
    },
    // "1.234,56" → 1234.56; "12.5" olduğu gibi kalır
    toPayload: (d) => ({ ...d, amount: d.amount.includes(',') ? d.amount.replace(/\./g, '').replace(',', '.') : d.amount }),
    toForm: (r) => ({ ...r, amount: String(r.amount).replace('.', ',') }),
    columns: [
      { h: 'Tarih', v: (r) => fmtDate(r.date) },
      { h: 'Kullanıcı', admin: true, v: (r) => esc(r.user_name) },
      { h: 'Müşteri / Proje', v: clientProjectCell },
      { h: 'Kategori', v: (r) => esc(r.category) },
      { h: 'Açıklama', v: (r) => esc(r.description) },
      { h: 'Tutar', key: 'amount', cls: 'num', v: (r) => money(r.amount) },
      { h: 'KDV', key: 'vat', cls: 'num', v: (r) => `${money(r.amount * r.vat_rate / 100)} <span class="small">%${r.vat_rate}</span>` },
      { h: 'Yansıtılır', v: (r) => yesNo(r.billable) },
    ],
    footer: (rows, cols) => footerCells(cols, {
      amount: money(sum(rows, (r) => r.amount)),
      vat: money(sum(rows, (r) => r.amount * r.vat_rate / 100)),
    }),
  });
}

// ---------- Muhasebe raporu ----------
let showDetails = false;

function pageReport() {
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

// ---------- Yönetim ekranları (ortak form + liste) ----------
function adminCrud(root, cfg) {
  root.innerHTML = `<section class="card">
      <h2 data-title>${cfg.newTitle}</h2>
      <form class="grid"><input type="hidden" name="_id">${cfg.fields()}
        <div class="actions"><button type="submit">Kaydet</button><button type="button" class="secondary" data-cancel hidden>Vazgeç</button></div>
      </form>
    </section>
    <section class="card"><h2>${cfg.listTitle}</h2><div class="table-wrap" data-list></div></section>`;
  const form = $('form', root);
  const title = $('[data-title]', root);
  const cancel = $('[data-cancel]', root);

  const reset = () => {
    form.reset();
    form.elements.namedItem('_id').value = '';
    cfg.defaults?.(form);
    title.textContent = cfg.newTitle;
    cancel.hidden = true;
  };
  const list = () => {
    const rows = cfg.rows();
    $('[data-list]', root).innerHTML = rows.length ? `<table>
      <thead><tr>${cfg.columns.map((c) => `<th class="${c.cls || ''}">${c.h}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.active === 0 ? 'muted' : ''}">${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.v(r)}</td>`).join('')}
        <td class="num"><button class="link" data-edit="${r.id}">Düzenle</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${cfg.emptyText}</div>`;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formToObj(form);
    const id = d._id;
    delete d._id;
    try {
      await api(id ? 'PUT' : 'POST', id ? `${cfg.endpoint}/${id}` : cfg.endpoint, d);
      toast('Kaydedildi');
      await loadRefs();
      cfg.onSaved ? cfg.onSaved() : (reset(), list());
    } catch (err) { toast(err.message, true); }
  };
  cancel.onclick = reset;
  $('[data-list]', root).onclick = (e) => {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    const row = cfg.rows().find((r) => r.id === Number(b.dataset.edit));
    fillForm(form, { ...row, _id: row.id });
    cfg.onEdit?.(form, row);
    title.textContent = cfg.editTitle;
    cancel.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  reset();
  list();
}

const rateText = (v) => (v == null ? '<span class="small">—</span>' : money(v));

function pageClients() {
  main.innerHTML = `<h1>Müşteriler & Projeler</h1>
    <p class="hint" style="margin:-8px 0 16px">Saatlik ücret önceliği: proje ücreti → müşteri varsayılan ücreti → kullanıcı ücreti. Ücret, aktivite girildiği anda kayda sabitlenir.</p>
    <div class="split"><div data-clients></div><div data-projects></div></div>`;
  const rerender = () => pageClients();

  adminCrud($('[data-clients]'), {
    newTitle: 'Yeni müşteri', editTitle: 'Müşteriyi düzenle', listTitle: 'Müşteriler', emptyText: 'Henüz müşteri yok.',
    endpoint: '/api/clients', rows: () => state.clients, onSaved: rerender,
    fields: () => `
      <label class="full">Müşteri / firma adı<input name="name" required></label>
      <label class="wide">VKN / TCKN<input name="tax_no"></label>
      <label class="wide">Vergi dairesi<input name="tax_office"></label>
      <label class="full">Adres<input name="address"></label>
      <label class="wide">Varsayılan saatlik ücret (₺)<input name="default_rate" inputmode="decimal" placeholder="Boş bırakılabilir"></label>
      <label class="check"><input type="checkbox" name="withholding"> Stopaj keser</label>
      <label class="check"><input type="checkbox" name="active"> Aktif</label>`,
    defaults: (f) => { f.elements.namedItem('active').checked = true; },
    columns: [
      { h: 'Müşteri', v: (r) => `${esc(r.name)}${r.tax_no ? `<div class="small">VKN ${esc(r.tax_no)}</div>` : ''}` },
      { h: 'Ücret', cls: 'num', v: (r) => rateText(r.default_rate) },
      { h: 'Stopaj', v: (r) => yesNo(r.withholding, 'Var', 'Yok') },
      { h: 'Durum', v: (r) => yesNo(r.active, 'Aktif', 'Pasif') },
    ],
  });

  adminCrud($('[data-projects]'), {
    newTitle: 'Yeni proje', editTitle: 'Projeyi düzenle', listTitle: 'Projeler', emptyText: 'Henüz proje yok.',
    endpoint: '/api/projects', rows: () => state.projects, onSaved: rerender,
    fields: () => state.clients.length ? `
      <label class="full">Müşteri<select name="client_id" required>${state.clients.map((c) => opt(c.id, c.name)).join('')}</select></label>
      <label class="full">Proje adı<input name="name" required></label>
      <label class="wide">Saatlik ücret (₺)<input name="hourly_rate" inputmode="decimal" placeholder="Boş: müşteri/kullanıcı ücreti"></label>
      <label class="check"><input type="checkbox" name="active"> Aktif</label>`
      : '<p class="hint full">Proje eklemek için önce bir müşteri oluşturun.</p>',
    defaults: (f) => { const a = f.elements.namedItem('active'); if (a) a.checked = true; },
    columns: [
      { h: 'Proje', v: (r) => `${esc(r.name)}<div class="small">${esc(r.client_name)}</div>` },
      { h: 'Ücret', cls: 'num', v: (r) => rateText(r.hourly_rate) },
      { h: 'Durum', v: (r) => yesNo(r.active, 'Aktif', 'Pasif') },
    ],
  });
}

function pageUsers() {
  main.innerHTML = '<h1>Kullanıcılar</h1><div data-users></div>';
  adminCrud($('[data-users]'), {
    newTitle: 'Yeni kullanıcı', editTitle: 'Kullanıcıyı düzenle', listTitle: 'Ekip', emptyText: 'Kullanıcı yok.',
    endpoint: '/api/users', rows: () => state.users, onSaved: pageUsers,
    fields: () => `
      <label class="wide">Ad soyad<input name="full_name" required></label>
      <label>Kullanıcı adı<input name="username" autocomplete="off" required></label>
      <label>Parola<input type="password" name="password" autocomplete="new-password" minlength="6"></label>
      <label>Rol<select name="role"><option value="user">Çalışan</option><option value="admin">Yönetici</option></select></label>
      <label>Saatlik ücret (₺)<input name="hourly_rate" inputmode="decimal"></label>
      <label class="check"><input type="checkbox" name="active"> Aktif</label>`,
    defaults: (f) => {
      f.elements.namedItem('active').checked = true;
      const pw = f.elements.namedItem('password');
      pw.required = true;
      pw.placeholder = 'En az 6 karakter';
    },
    onEdit: (f) => {
      const pw = f.elements.namedItem('password');
      pw.value = '';
      pw.required = false;
      pw.placeholder = 'Değiştirmek için doldurun';
    },
    columns: [
      { h: 'Ad soyad', v: (r) => `${esc(r.full_name)}<div class="small">${esc(r.username)}</div>` },
      { h: 'Rol', v: (r) => (r.role === 'admin' ? 'Yönetici' : 'Çalışan') },
      { h: 'Ücret', cls: 'num', v: (r) => money(r.hourly_rate) },
      { h: 'Durum', v: (r) => yesNo(r.active, 'Aktif', 'Pasif') },
    ],
  });
}

function pageSettings() {
  const s = state.settings;
  main.innerHTML = `<h1>Ayarlar</h1>
    ${isAdmin() ? `<section class="card"><h2>Şirket ve vergi ayarları</h2>
      <form class="grid" data-settings>
        <label class="wide">Şirket adı<input name="company_name" value="${esc(s.company_name)}" required></label>
        <label>KDV oranı (%)<input name="vat_rate" inputmode="decimal" value="${esc(s.vat_rate)}" required></label>
        <label>Stopaj oranı (%)<input name="withholding_rate" inputmode="decimal" value="${esc(s.withholding_rate)}" required></label>
        <label class="full">Masraf kategorileri (virgülle ayırın)<input name="expense_categories" value="${esc(s.expense_categories)}" required></label>
        <div class="actions"><button type="submit">Kaydet</button></div>
      </form></section>` : ''}
    <section class="card"><h2>Parola değiştir</h2>
      <form class="grid" data-password>
        <label>Mevcut parola<input type="password" name="current" autocomplete="current-password" required></label>
        <label>Yeni parola<input type="password" name="password" autocomplete="new-password" minlength="6" required></label>
        <div class="actions"><button type="submit">Parolayı güncelle</button></div>
      </form></section>`;

  const settingsForm = $('[data-settings]');
  if (settingsForm) settingsForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/settings', formToObj(settingsForm));
      await loadRefs();
      toast('Ayarlar kaydedildi');
    } catch (err) { toast(err.message, true); }
  };
  const pwForm = $('[data-password]');
  pwForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/me/password', formToObj(pwForm));
      pwForm.reset();
      toast('Parola güncellendi');
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- Giriş ve kurulum ----------
function authPage(title, intro, fields, button, onSubmit) {
  $('#topbar').hidden = true;
  main.innerHTML = `<div class="auth card"><div class="auth-logo">${LOGO_HTML}</div>
    <h2>${title}</h2><p class="hint">${intro}</p>
    <form>${fields}<div class="error"></div><button type="submit">${button}</button></form></div>`;
  const form = $('form', main);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await onSubmit(formToObj(form)); boot(); }
    catch (err) { $('.error', form).textContent = err.message; }
  };
  form.elements[0].focus();
}

function showLogin() {
  authPage('SWISE One', 'Hesabınızla giriş yapın.', `
    <label>Kullanıcı adı<input name="username" autocomplete="username" required></label>
    <label>Parola<input type="password" name="password" autocomplete="current-password" required></label>`,
  'Giriş yap', (d) => api('POST', '/api/login', d));
}

function showSetup() {
  authPage('İlk kurulum', 'Şirket bilgilerini girin ve yönetici hesabını oluşturun.', `
    <label>Şirket adı<input name="company_name" value="SWISE Teknoloji ve Danışmanlık" required></label>
    <label>Ad soyad<input name="full_name" required></label>
    <label>Kullanıcı adı<input name="username" autocomplete="username" required></label>
    <label>Parola<input type="password" name="password" autocomplete="new-password" minlength="6" required></label>
    <label>Parola (tekrar)<input type="password" name="password2" autocomplete="new-password" required></label>`,
  'Kurulumu tamamla', (d) => {
    if (d.password !== d.password2) throw new Error('Parolalar eşleşmiyor');
    return api('POST', '/api/setup', d);
  });
}

// ---------- Yönlendirme ----------
const ROUTES = [
  { id: 'aktiviteler', title: 'Aktiviteler', render: pageActivities },
  { id: 'masraflar', title: 'Masraflar', render: pageExpenses },
  { id: 'rapor', title: 'Muhasebe Raporu', admin: true, render: pageReport },
  { id: 'musteriler', title: 'Müşteriler & Projeler', admin: true, render: pageClients },
  { id: 'kullanicilar', title: 'Kullanıcılar', admin: true, render: pageUsers },
  { id: 'ayarlar', title: 'Ayarlar', render: pageSettings },
];

function route() {
  if (!state.user) return;
  const visible = ROUTES.filter((r) => !r.admin || isAdmin());
  const id = location.hash.replace(/^#\/?/, '');
  const current = visible.find((r) => r.id === id) || visible[0];
  $('#nav').innerHTML = visible.map((r) => `<a href="#/${r.id}" class="${r === current ? 'active' : ''}">${r.title}</a>`).join('');
  document.title = `${current.title} · SWISE One`;
  current.render();
}

async function boot() {
  try {
    state.user = await api('GET', '/api/me');
  } catch {
    state.user = null;
    const { needsSetup } = await api('GET', '/api/setup');
    return needsSetup ? showSetup() : showLogin();
  }
  await loadRefs();
  $('#topbar').hidden = false;
  $('#meName').textContent = `${state.user.full_name}${isAdmin() ? ' · Yönetici' : ''}`;
  route();
}

window.addEventListener('hashchange', route);
$('#logoutBtn').onclick = async () => {
  await api('POST', '/api/logout');
  state.user = null;
  location.hash = '';
  boot();
};
boot();
