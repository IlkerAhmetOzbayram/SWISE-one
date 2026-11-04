// Giriş ve ilk kurulum ekranları
import { $, main, api, formToObj, LOGO_HTML } from '../core.js';

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
  form.elements[0].focus();
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
    <label>Parola<input type="password" name="password" autocomplete="new-password" minlength="6" required></label>
    <label>Parola (tekrar)<input type="password" name="password2" autocomplete="new-password" required></label>`,
  'Kurulumu tamamla', (d) => {
    if (d.password !== d.password2) throw new Error('Parolalar eşleşmiyor');
    return api('POST', '/api/setup', d);
  }, onDone);
}
