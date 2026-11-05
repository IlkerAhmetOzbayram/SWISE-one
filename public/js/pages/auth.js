// Giriş ve ilk kurulum ekranları
import { $, main, api, esc, formToObj, LOGO_HTML } from '../core.js';

function authPage(title, intro, fields, button, onSubmit, onDone) {
  $('#topbar').hidden = true;
  main.innerHTML = `<div class="auth card"><div class="auth-logo">${LOGO_HTML}</div>
    <h2>${title}</h2><p class="hint">${intro}</p>
    <form>${fields}<div class="error"></div><button type="submit">${button}</button></form></div>`;
  const form = $('form', main);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await onSubmit(formToObj(form)); onDone(); }
    catch (err) { $('.error', form).textContent = err.message; }
  };
  form.querySelector('input:not([hidden])').focus();
}

export function showLogin(onDone) {
  authPage('SWISE One', 'Hesabınızla giriş yapın.', `
    <label>Kullanıcı adı<input name="username" autocomplete="username" required></label>
    <label>Parola<input type="password" name="password" autocomplete="current-password" required></label>`,
  'Giriş yap', (d) => api('POST', '/api/login', d), onDone);
}

export function showSetup(onDone) {
  authPage('İlk kurulum', 'Şirket bilgilerini girin ve yönetici hesabını oluşturun.', `
    <label>Şirket adı<input name="company_name" value="SWISE Teknoloji ve Danışmanlık" required></label>
    <label>Ad soyad<input name="full_name" required></label>
    <label>Kullanıcı adı<input name="username" autocomplete="username" required></label>
    <label>Parola<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
    <label>Parola (tekrar)<input type="password" name="password2" autocomplete="new-password" required></label>`,
  'Kurulumu tamamla', (d) => {
    if (d.password !== d.password2) throw new Error('Parolalar eşleşmiyor');
    return api('POST', '/api/setup', d);
  }, onDone);
}

// Canlıda ilk yönetici web'den değil, sunucudaki komutla oluşturulur
export function showSetupCommand() {
  $('#topbar').hidden = true;
  main.innerHTML = `<div class="auth card"><div class="auth-logo">${LOGO_HTML}</div>
    <h2>Kurulum bekleniyor</h2>
    <p class="hint">Henüz yönetici hesabı yok. Güvenlik için ilk yönetici web'den oluşturulamaz;
      sunucuda şu komutu çalıştırın, ardından bu sayfayı yenileyin:</p>
    <pre class="cmd">sudo swise-one yonetici-olustur kullaniciadi "Ad Soyad"</pre>
    <p class="hint">Bulut dışında, proje klasöründe: <code>npm run yonetici-olustur -- kullaniciadi "Ad Soyad"</code></p></div>`;
}

// Davet / parola sıfırlama bağlantısı (#/parola/<anahtar>)
export async function showPasswordLink(token, onDone) {
  const leave = () => { history.replaceState(null, '', location.pathname); onDone(); };
  let info;
  try { info = await api('GET', `/api/password-link/${encodeURIComponent(token)}`); } catch (err) {
    $('#topbar').hidden = true;
    main.innerHTML = `<div class="auth card"><div class="auth-logo">${LOGO_HTML}</div>
      <h2>Bağlantı geçersiz</h2><p class="hint">${esc(err.message)}</p>
      <button type="button" data-go>Giriş sayfasına git</button></div>`;
    $('[data-go]', main).onclick = leave;
    return;
  }
  const invite = info.purpose === 'invite';
  authPage(invite ? 'SWISE One’a hoş geldiniz' : 'Yeni parola',
    `${esc(info.full_name)} · kullanıcı adınız <b>${esc(info.username)}</b>. ${invite ? 'Giriş için parolanızı belirleyin.' : 'Yeni parolanızı belirleyin.'}`, `
    <input name="username" value="${esc(info.username)}" autocomplete="username" hidden>
    <label>Parola<input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="En az 8 karakter" required></label>
    <label>Parola (tekrar)<input type="password" name="password2" autocomplete="new-password" required></label>`,
  invite ? 'Parolamı belirle ve giriş yap' : 'Parolayı değiştir ve giriş yap', (d) => {
    if (d.password !== d.password2) throw new Error('Parolalar eşleşmiyor');
    return api('POST', `/api/password-link/${encodeURIComponent(token)}`, { password: d.password });
  }, leave);
}
