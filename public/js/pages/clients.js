import { state, $, main, esc, money, opt, yesNo } from '../core.js';
import { adminCrud } from '../components/admin-crud.js';

const rateText = (v) => (v == null ? '<span class="small">—</span>' : money(v));

export function pageClients() {
  main.innerHTML = `<h1>Müşteriler & Projeler</h1>
    <p class="hint" style="margin:-8px 0 16px">Saatlik ücret önceliği: proje ücreti → müşteri varsayılan ücreti → kullanıcı ücreti. Ücret, aktivite girildiği anda kayda sabitlenir.</p>
    <div class="split"><div data-clients></div><div data-projects></div></div>`;

  adminCrud($('[data-clients]'), {
    newTitle: 'Yeni müşteri', editTitle: 'Müşteriyi düzenle', listTitle: 'Müşteriler', emptyText: 'Henüz müşteri yok.',
    endpoint: '/api/clients', rows: () => state.clients, onSaved: pageClients,
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
    endpoint: '/api/projects', rows: () => state.projects, onSaved: pageClients,
    fields: () => (state.clients.length ? `
      <label class="full">Müşteri<select name="client_id" required>${state.clients.map((c) => opt(c.id, c.name)).join('')}</select></label>
      <label class="full">Proje adı<input name="name" required></label>
      <label class="wide">Saatlik ücret (₺)<input name="hourly_rate" inputmode="decimal" placeholder="Boş: müşteri/kullanıcı ücreti"></label>
      <label class="check"><input type="checkbox" name="active"> Aktif</label>`
      : '<p class="hint full">Proje eklemek için önce bir müşteri oluşturun.</p>'),
    defaults: (f) => { const a = f.elements.namedItem('active'); if (a) a.checked = true; },
    columns: [
      { h: 'Proje', v: (r) => `${esc(r.name)}<div class="small">${esc(r.client_name)}</div>` },
      { h: 'Ücret', cls: 'num', v: (r) => rateText(r.hourly_rate) },
      { h: 'Durum', v: (r) => yesNo(r.active, 'Aktif', 'Pasif') },
    ],
  });
}
