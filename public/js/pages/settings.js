import { state, isAdmin, $, main, api, toast, esc, formToObj, loadRefs, fmtDateTime, fmtBytes } from '../core.js';

export function pageSettings() {
  const s = state.settings;
  main.innerHTML = `<h1>Ayarlar</h1>
    ${isAdmin() ? `<section class="card"><h2>Şirket ve vergi ayarları</h2>
      <form class="grid" data-settings>
        <label class="wide">Şirket adı<input name="company_name" value="${esc(s.company_name)}" required></label>
        <label>KDV oranı (%)<input name="vat_rate" inputmode="decimal" value="${esc(s.vat_rate)}" required></label>
        <label>Stopaj oranı (%)<input name="withholding_rate" inputmode="decimal" value="${esc(s.withholding_rate)}" required></label>
        <label class="full">Masraf kategorileri (virgülle ayırın)<input name="expense_categories" value="${esc(s.expense_categories)}" required></label>
        <div class="actions"><button type="submit">Kaydet</button></div>
      </form></section>
    <section class="card"><h2>Yedekler</h2>
      <p class="hint" style="margin:0 0 12px">Veritabanının yedeği her gün otomatik alınır. Anlık bir kopyayı bilgisayarınıza da indirebilirsiniz.</p>
      <div data-backups></div>
      <div class="actions" style="margin-top:12px"><button type="button" class="secondary" data-backup-download>Şimdi yedek indir</button></div>
    </section>` : ''}
    <section class="card"><h2>Parola değiştir</h2>
      <form class="grid" data-password>
        <label>Mevcut parola<input type="password" name="current" autocomplete="current-password" required></label>
        <label>Yeni parola<input type="password" name="password" autocomplete="new-password" minlength="6" required></label>
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
