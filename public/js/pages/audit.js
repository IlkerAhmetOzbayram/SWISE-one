// İşlem kaydı: kim, ne zaman, neyi değiştirdi
import { $, main, api, toast, esc, qs, opt, fmtDateTime } from '../core.js';
import { filters, filterBar, bindFilterBar } from '../filters.js';

const ACTIONS = {
  create: 'Ekleme', update: 'Güncelleme', delete: 'Silme', setup: 'İlk kurulum',
  login: 'Giriş', login_failed: 'Hatalı giriş', password_change: 'Parola değişikliği',
  password_reset: 'Parola sıfırlama', backup_download: 'Yedek indirme',
};
const ENTITIES = {
  activities: 'Aktivite', expenses: 'Masraf', customers: 'Müşteri', companies: 'Şirket', contacts: 'İletişim kişisi',
  projects: 'Proje', users: 'Kullanıcı', settings: 'Ayarlar', database: 'Veritabanı', clients: 'Müşteri (eski yapı)',
};
const FIELDS = {
  date: 'Tarih', description: 'Açıklama', hours: 'Saat', billable: 'Faturalanabilir', rate: 'Ücret',
  project_id: 'Proje no', user_id: 'Kullanıcı no', client_id: 'Müşteri no', customer_id: 'Müşteri no', company_id: 'Şirket no',
  category: 'Kategori', amount: 'Tutar', vat_rate: 'KDV %', name: 'Ad', tax_no: 'VKN', tax_office: 'Vergi dairesi', address: 'Adres',
  default_rate: 'Varsayılan ücret', hourly_rate: 'Saatlik ücret', daily_rate: 'Günlük ücret', currency: 'Para birimi',
  payment_days: 'Vade (gün)', notes: 'Notlar', email: 'E-posta', phone: 'Telefon', vat_exempt: 'KDV uygulanmaz',
  title: 'Görev', receives_offers: 'Teklif alır', receives_invoices: 'Fatura alır', withholding: 'Stopaj', active: 'Aktif',
  username: 'Kullanıcı adı', full_name: 'Ad soyad', role: 'Rol', company_name: 'Şirket adı',
  withholding_rate: 'Stopaj oranı', expense_categories: 'Masraf kategorileri',
};
const SKIP = new Set(['id', 'created_at']);

const val = (v) => (v === null || v === undefined || v === '' ? '—' : esc(v));
const field = (k) => esc(FIELDS[k] || k);

function detailsHtml(r) {
  const d = r.details || {};
  if (r.action === 'update') {
    return Object.entries(d).map(([k, [a, b]]) => `<div>${field(k)}: <s>${val(a)}</s> → <b>${val(b)}</b></div>`).join('');
  }
  return Object.entries(d).filter(([k]) => !SKIP.has(k)).map(([k, v]) => `<div>${field(k)}: ${val(v)}</div>`).join('');
}

let entity = '';

export function pageAudit() {
  main.innerHTML = `<h1>İşlem Kaydı</h1>
    <p class="hint" style="margin:-8px 0 16px">Uygulamadaki her ekleme, değişiklik, silme ve giriş burada kayıt altındadır. Kayıtlar değiştirilemez.</p>
    <section class="card">
      ${filterBar({
        user: true,
        clients: false,
        extra: `<label>Kayıt türü<select data-entity><option value="">Tümü</option>${Object.entries(ENTITIES).map(([k, v]) => opt(k, v, entity)).join('')}</select></label>`,
      })}
      <div class="table-wrap" data-list></div>
      <div class="actions" style="margin-top:12px"><button type="button" class="secondary" data-more hidden>Daha eski kayıtlar</button></div>
    </section>`;

  let rows = [];
  const PAGE = 100;

  const render = () => {
    $('[data-list]').innerHTML = rows.length ? `<table>
      <thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Kayıt</th><th>Ayrıntı</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.action === 'login_failed' ? 'warn' : ''}">
        <td style="white-space:nowrap">${fmtDateTime(r.at)}</td>
        <td>${esc(r.user_name || '—')}</td>
        <td><span class="badge${r.action === 'delete' || r.action === 'login_failed' ? ' danger' : ''}">${esc(ACTIONS[r.action] || r.action)}</span></td>
        <td>${esc(ENTITIES[r.entity] || r.entity)}${r.entity_id ? ` <span class="small">#${r.entity_id}</span>` : ''}</td>
        <td class="details">${detailsHtml(r)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Bu dönemde işlem yok.</div>';
  };

  const load = async (more = false) => {
    const params = { from: filters.from, to: filters.to, user_id: filters.user_id, entity, limit: PAGE,
      before_id: more ? rows[rows.length - 1]?.id : '' };
    try {
      const page = await api('GET', `/api/audit?${qs(params)}`);
      rows = more ? rows.concat(page) : page;
      $('[data-more]').hidden = page.length < PAGE;
      render();
    } catch (err) { toast(err.message, true); }
  };

  $('[data-entity]').onchange = (e) => { entity = e.target.value; load(); };
  $('[data-more]').onclick = () => load(true);
  bindFilterBar(main, () => load());
  load();
}
