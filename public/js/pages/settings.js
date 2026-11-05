import { state, can, $, main, api, toast, esc, formToObj, loadRefs, fmtDate, fmtDateTime, fmtBytes, dayName } from '../core.js';
import { adminCrud } from '../components/admin-crud.js';

export function pageSettings() {
  const s = state.settings;
  main.innerHTML = `<h1>Ayarlar</h1>
    <section class="card"><div class="card-head"><h2>Profilim</h2><a href="#/personel/${state.user.id}">Personel kartım →</a></div>
      <p class="hint" style="margin:0">${esc(state.user.full_name)} · Rol: <b>${esc(state.user.role_name || '—')}</b></p></section>
    ${can('settings.edit') ? `<section class="card"><h2>Şirket ve vergi ayarları</h2>
      <form class="grid" data-settings>
        <label class="wide">Şirket adı<input name="company_name" value="${esc(s.company_name)}" required></label>
        <label>KDV oranı (%)<input name="vat_rate" inputmode="decimal" value="${esc(s.vat_rate)}" required></label>
        <label>Stopaj oranı (%)<input name="withholding_rate" inputmode="decimal" value="${esc(s.withholding_rate)}" required></label>
        <label class="full">Masraf kategorileri (virgülle ayırın)<input name="expense_categories" value="${esc(s.expense_categories)}" required></label>
        <label class="check full"><input type="checkbox" name="show_own_salary" ${s.show_own_salary === '1' ? 'checked' : ''}> Personel kendi maaş geçmişini personel kartında görebilsin</label>
        <div class="actions"><button type="submit">Kaydet</button></div>
      </form></section>
    <div data-holidays></div>
    <section class="card"><h2>Yedekler</h2>
      <p class="hint" style="margin:0 0 12px">Veritabanının yedeği her gün otomatik alınır. Anlık bir kopyayı bilgisayarınıza da indirebilirsiniz.</p>
      <div data-backups></div>
      <div class="actions" style="margin-top:12px"><button type="button" class="secondary" data-backup-download>Şimdi yedek indir</button></div>
    </section>` : ''}
    <section class="card"><h2>Parola değiştir</h2>
      <form class="grid" data-password>
        <label>Mevcut parola<input type="password" name="current" autocomplete="current-password" required></label>
        <label>Yeni parola<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
        <div class="actions"><button type="submit">Parolayı güncelle</button></div>
      </form>
      <p class="hint">Parola değişince diğer cihazlardaki oturumlarınız kapatılır.</p>
    </section>`;

  const settingsForm = $('[data-settings]');
  if (settingsForm) {
    settingsForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/settings', formToObj(settingsForm));
        await loadRefs();
        toast('Ayarlar kaydedildi');
      } catch (err) { toast(err.message, true); }
    };
    $('[data-backup-download]').onclick = () => { location.href = '/api/admin/backup.db'; };
    loadBackups();
    loadHolidays();
  }

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

// Resmi tatiller ve şirket izinleri (iş günü ve bütçe tahmini hesabında düşülür)
let holidayYear = new Date().getFullYear();

async function loadHolidays() {
  let rows;
  try {
    rows = await api('GET', `/api/holidays?year=${holidayYear}`);
  } catch (err) { return toast(err.message, true); }
  const root = $('[data-holidays]');
  adminCrud(root, {
    compact: true, deletable: true,
    listTitle: `Tatiller ve izin günleri · ${holidayYear}`, newTitle: 'Yeni tatil', editTitle: 'Tatili düzenle', addLabel: 'Tatil ekle',
    intro: `İş günü hesabında düşülür. Dini bayram tarihlerini Diyanet takvimiyle kontrol edin.
      <button type="button" class="link" data-year="-1">← ${holidayYear - 1}</button> <button type="button" class="link" data-year="1">${holidayYear + 1} →</button>`,
    emptyText: 'Bu yıl için kayıt yok.', endpoint: '/api/holidays', rows: () => rows, onSaved: loadHolidays,
    fields: () => `
      <label>Tarih<input type="date" name="date" required></label>
      <label class="wide">Açıklama<input name="name" placeholder="Örn. Şirket izni" required></label>
      <label>Tür<select name="kind"><option value="full">Tam gün</option><option value="half">Yarım gün</option></select></label>`,
    columns: [
      { h: 'Tarih', v: (r) => `${fmtDate(r.date)} <span class="small">${dayName(r.date)}</span>` },
      { h: 'Açıklama', v: (r) => esc(r.name) },
      { h: 'Tür', v: (r) => (r.kind === 'half' ? '<span class="badge">Yarım gün</span>' : 'Tam gün') },
    ],
  });
  root.querySelectorAll('[data-year]').forEach((b) => {
    b.onclick = () => { holidayYear += Number(b.dataset.year); loadHolidays(); };
  });
}

async function loadBackups() {
  try {
    const { keep, backups } = await api('GET', '/api/admin/backups');
    $('[data-backups]').innerHTML = backups.length ? `<table>
      <thead><tr><th>Yedek</th><th>Alınma zamanı</th><th class="num">Boyut</th></tr></thead>
      <tbody>${backups.map((b) => `<tr><td>${esc(b.name)}</td><td>${fmtDateTime(b.created_at)}</td><td class="num">${fmtBytes(b.size)}</td></tr>`).join('')}</tbody>
    </table><p class="hint">Son ${keep} günün yedeği sunucuda saklanır.</p>`
      : '<div class="empty">Henüz otomatik yedek alınmadı.</div>';
  } catch (err) { toast(err.message, true); }
}
