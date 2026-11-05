// Personel: liste (#/personel) ve personel kartı (#/personel/:id).
// Kart: genel bilgiler, hesap ve rol, hassas bilgiler (IBAN, acil durum kişisi), maaş geçmişi.
import { state, can, $, main, api, toast, esc, money, fmtDate, opt, yesNo, formToObj, fillForm, loadRefs, currencyOptions } from '../core.js';
import { adminCrud } from '../components/admin-crud.js';

const EMPLOYMENT = { full_time: 'Tam zamanlı', part_time: 'Yarı zamanlı', freelance: 'Serbest', intern: 'Stajyer' };
const maskIban = (s) => (s ? `${s.slice(0, 4)} **** **** **** ${s.slice(-4)}` : '—');
const groupIban = (s) => s.replace(/(.{4})/g, '$1 ').trim();

export const personnelTabs = (active) => (can('roles.edit') ? `<div class="tabs" style="margin-bottom:16px">
  <a href="#/personel" class="${active === 'personel' ? 'active' : ''}">Personel</a>
  <a href="#/roller" class="${active === 'roller' ? 'active' : ''}">Roller ve yetkiler</a></div>` : '');

let roles = [];
async function loadRoles() {
  if (can('roles.edit') || can('personnel.view')) roles = await api('GET', '/api/roles');
}

const generalFields = (withAccount) => `
  <label class="wide">Ad soyad<input name="full_name" required></label>
  <label>Kullanıcı adı<input name="username" autocomplete="off" required></label>
  ${withAccount ? '<label>Parola<input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="Boş bırakılırsa davet bağlantısı"></label>' : '<span></span>'}
  <label>Ünvan / pozisyon<input name="title"></label>
  <label>Departman<input name="department"></label>
  <label>E-posta<input type="email" name="email"></label>
  <label>Telefon<input name="phone"></label>
  <label>İşe giriş<input type="date" name="start_date"></label>
  <label>Çalışma tipi<select name="employment_type">${Object.entries(EMPLOYMENT).map(([k, v]) => opt(k, v)).join('')}</select></label>
  ${can('roles.edit') ? `<label>Rol<select name="role_id">${roles.map((r) => opt(r.id, r.name)).join('')}</select></label>` : ''}`;

export async function pagePersonnel(param) {
  try { await loadRoles(); } catch (err) { return toast(err.message, true); }
  if (param) return pagePerson(Number(param));
  const users = await api('GET', '/api/users');

  main.innerHTML = `<div class="card-head"><h1 style="margin:0">Personel</h1>
      ${can('personnel.edit') ? '<button type="button" data-new>+ Yeni personel</button>' : ''}</div>
    ${personnelTabs('personel')}
    <section class="card" data-new-card hidden><h2>Yeni personel</h2>
      <form class="grid" data-new-form>${generalFields(true)}
        <div class="actions full"><button type="submit">Personeli oluştur</button><button type="button" class="secondary" data-cancel>Vazgeç</button></div>
      </form></section>
    <section class="card">
      <div class="filters"><label>Ara<input type="search" data-search placeholder="Ad, ünvan, departman"></label>
        <label class="check"><input type="checkbox" data-inactive> Ayrılanları göster</label></div>
      <div class="table-wrap" data-list></div>
    </section>`;

  const newCard = $('[data-new-card]');
  const newForm = $('[data-new-form]');
  if ($('[data-new]')) $('[data-new]').onclick = () => {
    newCard.hidden = false;
    const role = newForm.elements.namedItem('role_id');
    if (role) role.value = roles.find((r) => r.name === 'Çalışan')?.id ?? '';
  };
  $('[data-cancel]').onclick = () => { newForm.reset(); newCard.hidden = true; };
  newForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { id, link } = await api('POST', '/api/users', formToObj(newForm));
      await loadRefs();
      pendingLink = link ? { id, link } : null;
      toast('Personel oluşturuldu');
      location.hash = `#/personel/${id}`;
    } catch (err) { toast(err.message, true); }
  };

  const render = () => {
    const q = $('[data-search]').value.toLocaleLowerCase('tr');
    const showInactive = $('[data-inactive]').checked;
    const rows = users.filter((u) => (showInactive || u.active) && u.username !== 'yerel'
      && [u.full_name, u.title, u.department].join(' ').toLocaleLowerCase('tr').includes(q));
    $('[data-list]').innerHTML = rows.length ? `<table>
      <thead><tr><th>Ad soyad</th><th>Ünvan / departman</th><th>Rol</th><th>İşe giriş</th><th>Durum</th><th></th></tr></thead>
      <tbody>${rows.map((u) => `<tr class="${u.active ? '' : 'muted'}">
        <td><a href="#/personel/${u.id}"><b>${esc(u.full_name)}</b></a><div class="small">${esc(u.username)}</div></td>
        <td>${esc(u.title || '—')}${u.department ? `<div class="small">${esc(u.department)}</div>` : ''}</td>
        <td><span class="badge">${esc(u.role_name || '—')}</span></td>
        <td>${u.start_date ? fmtDate(u.start_date) : '—'}</td>
        <td>${u.active ? yesNo(1, 'Aktif') : `<span class="badge off">Ayrıldı${u.end_date ? ` · ${fmtDate(u.end_date)}` : ''}</span>`}</td>
        <td class="num"><a href="#/personel/${u.id}">Kartı aç →</a></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Kayıt yok.</div>';
  };
  $('[data-search]').oninput = render;
  $('[data-inactive]').onchange = render;
  render();
}

// Yeni personel davetle oluşturulduysa bağlantı kartta gösterilir
let pendingLink = null;

// Tek kullanımlık bağlantı: kopyalama ve mail taslağı (gönderim elle yapılır)
function showLink(box, u, link) {
  const invite = link.purpose === 'invite';
  const until = new Date(link.expires_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  const subject = invite ? 'SWISE One hesabınız' : 'SWISE One parola sıfırlama';
  const body = `Merhaba ${u.full_name},\n\n${invite ? 'SWISE One hesabınız oluşturuldu.' : 'SWISE One parolanızı sıfırlamak için bağlantınız hazır.'}\n`
    + `Kullanıcı adınız: ${u.username}\n\nAşağıdaki bağlantıdan parolanızı belirleyip giriş yapabilirsiniz `
    + `(${until} tarihine kadar geçerli, tek kullanımlık):\n${link.url}\n`;
  box.hidden = false;
  box.innerHTML = `<p class="hint" style="margin:0 0 8px">${invite ? 'Davet' : 'Parola sıfırlama'} bağlantısı · ${until} tarihine kadar geçerli, tek kullanımlık.
      Bağlantı bir daha gösterilmez; yenisi oluşturulursa bu geçersiz olur.</p>
    <div class="link-box"><input readonly value="${esc(link.url)}" data-link-url>
      <button type="button" class="secondary" data-copy>Kopyala</button>
      <button type="button" class="secondary" data-mail>Mail taslağı</button></div>`;
  $('[data-copy]', box).onclick = async () => {
    const input = $('[data-link-url]', box);
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
    toast('Bağlantı kopyalandı');
  };
  $('[data-mail]', box).onclick = () => {
    location.href = `mailto:${encodeURIComponent(u.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
}

async function pagePerson(id) {
  let u;
  try { u = await api('GET', `/api/personnel/${id}`); } catch (err) { return toast(err.message, true); }
  const mine = id === state.user.id;
  const editable = can('personnel.edit');
  const canSensitive = mine || can('salary.view');

  main.innerHTML = `${can('personnel.view') ? '<a class="back" href="#/personel">← Personel</a>' : ''}
    <h1>${esc(u.full_name)} ${u.active ? '' : '<span class="badge off">Ayrıldı</span>'}</h1>
    <section class="card">
      <h2>Genel bilgiler</h2>
      <form class="grid" data-general>${generalFields(false)}
        <label>Çıkış tarihi<input type="date" name="end_date"></label>
        <label class="check"><input type="checkbox" name="active"> Aktif (giriş yapabilir)</label>
        ${editable ? '<div class="actions"><button type="submit">Kaydet</button></div>' : ''}
      </form>
    </section>
    ${editable ? `<section class="card"><h2>Hesap</h2>
      <div class="actions" style="margin-bottom:12px"><button type="button" data-link>Giriş bağlantısı oluştur</button></div>
      <div data-link-box hidden></div>
      <p class="hint" style="margin:12px 0">Kişi bağlantıdan kendi parolasını belirler. İsterseniz parolayı aşağıdan siz de belirleyebilirsiniz.</p>
      <form class="grid" data-password>
        <label class="wide">Yeni parola<input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="En az 8 karakter" required></label>
        <div class="actions"><button type="submit">Parolayı sıfırla</button>
          <button type="button" class="secondary" data-logout-all>Tüm oturumlarını kapat</button></div>
      </form>
      <p class="hint">Parola sıfırlanınca kişinin açık oturumları kapanır.</p></section>` : ''}
    ${canSensitive ? `<section class="card" data-sensitive-card>
      <div class="card-head"><h2>Hassas bilgiler</h2><span class="badge">KVKK</span></div>
      <div data-sensitive>${mine ? '' : `<p class="hint" style="margin:0 0 12px">Bu bilgilerin görüntülenmesi işlem kaydına yazılır.</p>
        <button type="button" class="secondary" data-reveal>Hassas bilgileri göster</button>`}</div>
    </section><div data-salaries></div>` : ''}`;

  const gform = $('[data-general]');
  fillForm(gform, { ...u, start_date: u.start_date ?? '', end_date: u.end_date ?? '' });
  if (!editable) [...gform.elements].forEach((el) => { el.disabled = true; });
  if (gform.elements.namedItem('role_id') && mine) gform.elements.namedItem('role_id').disabled = true;
  gform.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', `/api/users/${id}`, formToObj(gform));
      await loadRefs();
      toast('Kaydedildi');
      pagePerson(id);
    } catch (err) { toast(err.message, true); }
  };

  const pform = $('[data-password]');
  if (pform) {
    const linkBox = $('[data-link-box]');
    if (pendingLink?.id === id) showLink(linkBox, u, pendingLink.link);
    pendingLink = null;
    $('[data-link]').onclick = async () => {
      try { showLink(linkBox, u, await api('POST', `/api/users/${id}/password-link`, {})); } catch (err) { toast(err.message, true); }
    };
    pform.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('PUT', `/api/users/${id}`, { ...formToObj(gform), password: pform.elements.namedItem('password').value });
        pform.reset();
        toast('Parola sıfırlandı');
      } catch (err) { toast(err.message, true); }
    };
    $('[data-logout-all]').onclick = async () => {
      try {
        const { closed } = await api('POST', `/api/users/${id}/logout-all`);
        toast(`${closed} oturum kapatıldı`);
      } catch (err) { toast(err.message, true); }
    };
  }

  if (canSensitive) {
    if (mine) showSensitive(u);
    else $('[data-reveal]').onclick = () => showSensitive(u);
  }
}

async function showSensitive(u) {
  let s;
  try { s = await api('GET', `/api/personnel/${u.id}/sensitive`); } catch (err) { return toast(err.message, true); }
  const editable = can('salary.edit');
  const box = $('[data-sensitive]');
  box.innerHTML = `
    ${s.anonymized_at ? `<div class="notice">Bu personelin hassas bilgileri ${fmtDate(s.anonymized_at.slice(0, 10))} tarihinde anonimleştirildi.</div>` : ''}
    <form class="grid" data-sens-form>
      <label class="wide">IBAN<input name="iban" class="masked" placeholder="TR00 0000 0000 0000 0000 0000 00"></label>
      <span class="small wide" style="align-self:center">${editable ? '' : `Kayıtlı: <span class="masked">${maskIban(s.iban)}</span>`}</span>
      <label class="wide">Acil durum kişisi<input name="emergency_name"></label>
      <label>Yakınlık<input name="emergency_relation" placeholder="Örn. Eşi"></label>
      <label>Telefon<input name="emergency_phone"></label>
      ${editable ? '<div class="actions"><button type="submit">Kaydet</button></div>' : ''}
    </form>
    ${editable && can('personnel.edit') && !u.active && u.end_date && !s.anonymized_at ? `<p class="hint">Personel ayrıldı.
      <button type="button" class="link danger" data-anonymize>Hassas bilgileri anonimleştir (KVKK)</button> — IBAN, acil durum kişisi, e-posta ve telefon silinir; maaş geçmişi yasal saklama için korunur.</p>` : ''}`;
  const form = $('[data-sens-form]');
  fillForm(form, { ...s, iban: s.iban ? groupIban(s.iban) : '' });
  if (!editable) [...form.elements].forEach((el) => { el.disabled = true; });
  if (!editable) form.elements.namedItem('iban').value = maskIban(s.iban);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', `/api/personnel/${u.id}/sensitive`, formToObj(form));
      toast('Kaydedildi');
    } catch (err) { toast(err.message, true); }
  };
  const anon = $('[data-anonymize]');
  if (anon) anon.onclick = async () => {
    if (!confirm(`${u.full_name} için IBAN, acil durum kişisi, e-posta ve telefon kalıcı olarak silinsin mi?`)) return;
    try {
      await api('POST', `/api/personnel/${u.id}/anonymize`);
      toast('Anonimleştirildi');
      pagePerson(u.id);
    } catch (err) { toast(err.message, true); }
  };

  const salBox = $('[data-salaries]');
  if (s.salaries === null) {
    salBox.innerHTML = '';
    return;
  }
  adminCrud(salBox, {
    compact: true, deletable: true, readOnly: !editable,
    listTitle: 'Maaş geçmişi', newTitle: 'Yeni maaş kaydı', editTitle: 'Maaş kaydını düzenle', addLabel: 'Maaş ekle',
    intro: 'Tutarlar muhasebeciden alınan bordroya göre girilir; geçerlilik tarihinden itibaren geçerlidir.',
    emptyText: 'Maaş kaydı yok.', endpoint: '/api/salaries', createEndpoint: `/api/personnel/${u.id}/salaries`,
    rows: () => s.salaries, onSaved: () => showSensitive(u),
    fields: () => `
      <label>Geçerlilik tarihi<input type="date" name="effective_date" required></label>
      <label>Brüt<input name="gross" inputmode="decimal"></label>
      <label>Net<input name="net" inputmode="decimal"></label>
      <label>Para birimi<select name="currency">${currencyOptions('TRY')}</select></label>
      <label class="full">Not<input name="notes"></label>`,
    toForm: (r) => ({ ...r, gross: r.gross ?? '', net: r.net ?? '' }),
    toPayload: (d) => ({ ...d, gross: d.gross.replace(',', '.'), net: d.net.replace(',', '.') }),
    columns: [
      { h: 'Geçerlilik', v: (r) => fmtDate(r.effective_date) },
      { h: 'Brüt', cls: 'num', v: (r) => (r.gross == null ? '—' : money(r.gross, r.currency)) },
      { h: 'Net', cls: 'num', v: (r) => (r.net == null ? '—' : money(r.net, r.currency)) },
      { h: 'Not', v: (r) => esc(r.notes) },
    ],
  });
}
