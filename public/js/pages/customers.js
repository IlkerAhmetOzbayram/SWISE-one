// Müşteriler: liste (#/musteriler) ve müşteri detayı (#/musteriler/:id)
// Detayda: genel bilgiler, şirketler, iletişim kişileri, projeler
import { state, $, main, api, toast, esc, money, opt, yesNo, formToObj, fillForm, loadRefs, currencyOptions, CURRENCY_LABELS, HOURS_PER_DAY } from '../core.js';
import { adminCrud } from '../components/admin-crud.js';

const dayRate = (v, currency) => `${money(v, currency)} <span class="small">/gün · ${money(v / HOURS_PER_DAY, currency)}/sa</span>`;
// Kendi değeri yoksa devraldığı değer gri ve "nereden" bilgisiyle gösterilir
const inheritedRate = (own, effective, currency, source) =>
  (own != null ? money(own, currency) : `<span class="inherited">${money(effective, currency)} · ${source}</span>`);

export function pageCustomers(param) {
  if (param) return pageCustomer(Number(param));

  main.innerHTML = `<div class="card-head"><h1 style="margin:0">Müşteriler</h1>
      <button type="button" data-new>+ Yeni müşteri</button></div>
    <section class="card" data-new-card hidden>
      <h2>Yeni müşteri</h2>
      <form class="grid" data-new-form>
        <label class="wide">Müşteri adı<input name="name" placeholder="Örn. ABC Holding" required></label>
        <label>Günlük ücret<input name="daily_rate" inputmode="decimal" placeholder="1 gün = ${HOURS_PER_DAY} saat" required></label>
        <label>Para birimi<select name="currency">${currencyOptions('TRY')}</select></label>
        <label>Ödeme vadesi (gün)<input name="payment_days" inputmode="numeric" value="30"></label>
        <label class="full">Notlar<input name="notes"></label>
        <h3 class="full form-section">İlk şirketin fatura bilgileri</h3>
        <p class="hint full" style="margin:-8px 0 0">Müşterinin altında en az bir şirket olur. Başka şirketleri sonradan ekleyebilirsiniz.</p>
        <label class="wide">Şirket unvanı<input name="company_name" placeholder="Boş bırakılırsa müşteri adı kullanılır"></label>
        <label>VKN / TCKN<input name="tax_no" maxlength="11" pattern="[0-9A-Za-z]*" title="En fazla 11 karakter, yalnızca rakam ve harf"></label>
        <label>Vergi dairesi<input name="tax_office"></label>
        <label class="full">Adres<input name="address"></label>
        <label class="wide">E-posta<input type="email" name="email"></label>
        <label>Telefon<input name="phone"></label>
        <span></span>
        <label class="check"><input type="checkbox" name="withholding"> Stopaj keser</label>
        <label class="check"><input type="checkbox" name="vat_exempt"> KDV uygulanmaz</label>
        <div class="actions full"><button type="submit">Müşteriyi oluştur</button><button type="button" class="secondary" data-cancel>Vazgeç</button></div>
      </form>
    </section>
    <section class="card">
      <div class="filters"><label>Ara<input type="search" data-search placeholder="Müşteri adı"></label></div>
      <div class="table-wrap" data-list></div>
    </section>`;

  const newCard = $('[data-new-card]');
  const newForm = $('[data-new-form]');
  $('[data-new]').onclick = () => { newCard.hidden = false; newForm.elements.namedItem('name').focus(); };
  $('[data-cancel]').onclick = () => { newForm.reset(); newCard.hidden = true; };
  newForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { id } = await api('POST', '/api/customers', formToObj(newForm));
      await loadRefs();
      toast('Müşteri oluşturuldu');
      location.hash = `#/musteriler/${id}`;
    } catch (err) { toast(err.message, true); }
  };

  const render = (q = '') => {
    const rows = state.customers.filter((c) => c.name.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')));
    $('[data-list]').innerHTML = rows.length ? `<table>
      <thead><tr><th>Müşteri</th><th class="num">Şirket</th><th class="num">Günlük ücret</th><th>Para birimi</th><th class="num">Vade</th><th>Durum</th><th></th></tr></thead>
      <tbody>${rows.map((c) => `<tr class="${c.active ? '' : 'muted'}">
        <td><a href="#/musteriler/${c.id}"><b>${esc(c.name)}</b></a>${c.notes ? `<div class="small">${esc(c.notes)}</div>` : ''}</td>
        <td class="num">${c.company_count}</td><td class="num">${dayRate(c.daily_rate, c.currency)}</td>
        <td>${CURRENCY_LABELS[c.currency]}</td><td class="num">${c.payment_days} gün</td>
        <td>${yesNo(c.active, 'Aktif', 'Pasif')}</td><td class="num"><a href="#/musteriler/${c.id}">Aç →</a></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${state.customers.length ? 'Aramaya uyan müşteri yok.' : 'Henüz müşteri yok. “+ Yeni müşteri” ile başlayın.'}</div>`;
  };
  $('[data-search]').oninput = (e) => render(e.target.value);
  render();
}

async function pageCustomer(id) {
  const cu = state.customers.find((c) => c.id === id);
  if (!cu) {
    main.innerHTML = '<a class="back" href="#/musteriler">← Müşteriler</a><div class="empty">Müşteri bulunamadı.</div>';
    return;
  }
  let contacts = [];
  try {
    contacts = await api('GET', `/api/contacts?customer_id=${id}`);
  } catch (err) { toast(err.message, true); }
  const companies = () => state.companies.filter((c) => c.customer_id === id);
  const rerender = () => pageCustomer(id);

  main.innerHTML = `<a class="back" href="#/musteriler">← Müşteriler</a>
    <h1>${esc(cu.name)} ${cu.active ? '' : '<span class="badge off">Pasif</span>'}</h1>
    <section class="card">
      <h2>Genel bilgiler</h2>
      <form class="grid" data-customer>
        <label class="wide">Müşteri adı<input name="name" required></label>
        <label>Günlük ücret<input name="daily_rate" inputmode="decimal" required></label>
        <label>Para birimi<select name="currency">${currencyOptions(cu.currency)}</select></label>
        <label>Ödeme vadesi (gün)<input name="payment_days" inputmode="numeric"></label>
        <label class="wide">Notlar<input name="notes"></label>
        <label class="check"><input type="checkbox" name="active"> Aktif</label>
        <div class="actions"><button type="submit">Kaydet</button></div>
      </form>
      <p class="hint">Şirketler ve projeler kendi ücreti/para birimi/vadesi girilmedikçe buradaki değerleri kullanır.
        Ücret, aktivite girildiği anda kayda sabitlenir; buradaki değişiklik eski kayıtları etkilemez.</p>
    </section>
    <div data-companies></div>
    <div data-contacts></div>
    <div data-projects></div>`;

  const cform = $('[data-customer]');
  fillForm(cform, { ...cu, daily_rate: String(cu.daily_rate) });
  cform.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', `/api/customers/${id}`, formToObj(cform));
      await loadRefs();
      toast('Kaydedildi');
      rerender();
    } catch (err) { toast(err.message, true); }
  };

  adminCrud($('[data-companies]'), {
    compact: true, listTitle: 'Şirketler', newTitle: 'Yeni şirket', editTitle: 'Şirketi düzenle', addLabel: 'Şirket ekle',
    intro: 'Fatura bu şirketlere kesilir. Ücret, para birimi ve vade boş bırakılırsa müşteriden alınır.',
    emptyText: 'Şirket yok.', endpoint: '/api/companies', rows: companies, onSaved: rerender,
    fields: () => `
      <label class="wide">Şirket unvanı<input name="name" required></label>
      <label>VKN / TCKN<input name="tax_no" maxlength="11" pattern="[0-9A-Za-z]*" title="En fazla 11 karakter, yalnızca rakam ve harf"></label>
      <label>Vergi dairesi<input name="tax_office"></label>
      <label class="full">Adres<input name="address"></label>
      <label class="wide">E-posta<input type="email" name="email"></label>
      <label class="wide">Telefon<input name="phone"></label>
      <label>Günlük ücret<input name="daily_rate" inputmode="decimal" placeholder="Müşteriden: ${esc(money(cu.daily_rate, cu.currency))}"></label>
      <label>Para birimi<select name="currency">${currencyOptions('', { inherit: cu.currency })}</select></label>
      <label>Ödeme vadesi (gün)<input name="payment_days" inputmode="numeric" placeholder="Müşteriden: ${cu.payment_days}"></label>
      <span></span>
      <label class="check"><input type="checkbox" name="withholding"> Stopaj keser</label>
      <label class="check"><input type="checkbox" name="vat_exempt"> KDV uygulanmaz</label>
      <label class="check"><input type="checkbox" name="active"> Aktif</label>`,
    defaults: (f) => { f.elements.namedItem('active').checked = true; },
    toForm: (r) => ({ ...r, daily_rate: r.daily_rate ?? '', currency: r.currency ?? '', payment_days: r.payment_days ?? '' }),
    toPayload: (d) => ({ ...d, customer_id: id }),
    columns: [
      { h: 'Şirket', v: (r) => `<b>${esc(r.name)}</b>${r.tax_no ? `<div class="small">VKN ${esc(r.tax_no)}${r.tax_office ? ` · ${esc(r.tax_office)}` : ''}</div>` : ''}
        ${r.withholding ? '<span class="badge">stopajlı</span>' : ''}${r.vat_exempt ? '<span class="badge">KDV yok</span>' : ''}` },
      { h: 'Günlük ücret', cls: 'num', v: (r) => inheritedRate(r.daily_rate, r.effective_daily_rate, r.effective_currency, 'müşteriden') },
      { h: 'Para birimi', v: (r) => (r.currency ? r.currency : `<span class="inherited">${r.effective_currency}</span>`) },
      { h: 'Vade', cls: 'num', v: (r) => (r.payment_days != null ? `${r.payment_days} gün` : `<span class="inherited">${r.effective_payment_days} gün</span>`) },
      { h: 'Durum', v: (r) => yesNo(r.active, 'Aktif', 'Pasif') },
    ],
  });

  adminCrud($('[data-contacts]'), {
    compact: true, deletable: true, listTitle: 'İletişim kişileri', newTitle: 'Yeni kişi', editTitle: 'Kişiyi düzenle', addLabel: 'Kişi ekle',
    intro: 'Kişi müşterinin geneline veya belirli bir şirkete bağlanabilir. Teklif ve fatura maillerinde bu işaretler kullanılacak.',
    emptyText: 'Kişi yok.', endpoint: '/api/contacts', rows: () => contacts, onSaved: rerender,
    fields: () => `
      <label class="wide">Ad soyad<input name="full_name" required></label>
      <label class="wide">Görev<input name="title" placeholder="Örn. Satın Alma Müdürü"></label>
      <label class="wide">Bağlı olduğu<select name="company_id"><option value="">Müşteri geneli</option>${companies().map((c) => opt(c.id, c.name)).join('')}</select></label>
      <label>E-posta<input type="email" name="email"></label>
      <label>Telefon<input name="phone"></label>
      <label class="full">Notlar<input name="notes"></label>
      <label class="check"><input type="checkbox" name="receives_offers"> Teklif alır</label>
      <label class="check"><input type="checkbox" name="receives_invoices"> Fatura alır</label>
      <label class="check"><input type="checkbox" name="active"> Aktif</label>`,
    defaults: (f) => { f.elements.namedItem('active').checked = true; },
    toForm: (r) => ({ ...r, company_id: r.company_id ?? '' }),
    toPayload: (d) => ({ ...d, customer_id: id }),
    columns: [
      { h: 'Kişi', v: (r) => `<b>${esc(r.full_name)}</b>${r.title ? `<div class="small">${esc(r.title)}</div>` : ''}` },
      { h: 'Bağlı olduğu', v: (r) => (r.company_name ? esc(r.company_name) : '<span class="inherited">Müşteri geneli</span>') },
      { h: 'İletişim', v: (r) => [r.email && `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`, r.phone && esc(r.phone)].filter(Boolean).join('<br>') || '—' },
      { h: 'Rol', v: (r) => [r.receives_offers && '<span class="badge">Teklif</span>', r.receives_invoices && '<span class="badge">Fatura</span>'].filter(Boolean).join(' ') || '—' },
      { h: 'Durum', v: (r) => yesNo(r.active, 'Aktif', 'Pasif') },
    ],
  });

  adminCrud($('[data-projects]'), {
    compact: true, listTitle: 'Projeler', newTitle: 'Yeni proje', editTitle: 'Projeyi düzenle', addLabel: 'Proje ekle',
    intro: 'Ücret önceliği: proje → şirket → müşteri. Projenin para birimi, bağlı olduğu şirketinkidir.',
    emptyText: 'Proje yok.', endpoint: '/api/projects', onSaved: rerender,
    rows: () => state.projects.filter((p) => p.customer_id === id),
    fields: () => `
      <label class="wide">Şirket<select name="company_id" required>${companies().map((c) => opt(c.id, c.name)).join('')}</select></label>
      <label class="wide">Proje adı<input name="name" required></label>
      <label>Günlük ücret<input name="daily_rate" inputmode="decimal" placeholder="Boş: şirket/müşteri ücreti"></label>
      <label class="check"><input type="checkbox" name="active"> Aktif</label>`,
    defaults: (f) => { f.elements.namedItem('active').checked = true; },
    toForm: (r) => ({ ...r, daily_rate: r.daily_rate ?? '' }),
    columns: [
      { h: 'Proje', v: (r) => `<b>${esc(r.name)}</b>` },
      { h: 'Şirket', v: (r) => esc(r.company_name) },
      { h: 'Günlük ücret', cls: 'num', v: (r) => inheritedRate(r.daily_rate, r.effective_daily_rate, r.currency, 'devralınan') },
      { h: 'Durum', v: (r) => yesNo(r.active, 'Aktif', 'Pasif') },
    ],
  });
}
