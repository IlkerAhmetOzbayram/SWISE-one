import { state, $, main, esc, yesNo } from '../core.js';
import { adminCrud } from '../components/admin-crud.js';

export function pageUsers() {
  main.innerHTML = '<h1>Kullanıcılar</h1><div data-users></div>';
  adminCrud($('[data-users]'), {
    newTitle: 'Yeni kullanıcı', editTitle: 'Kullanıcıyı düzenle', listTitle: 'Ekip', emptyText: 'Kullanıcı yok.',
    endpoint: '/api/users', rows: () => state.users, onSaved: pageUsers,
    fields: () => `
      <label class="wide">Ad soyad<input name="full_name" required></label>
      <label>Kullanıcı adı<input name="username" autocomplete="off" required></label>
      <label>Parola<input type="password" name="password" autocomplete="new-password" minlength="6"></label>
      <label>Rol<select name="role"><option value="user">Çalışan</option><option value="admin">Yönetici</option></select></label>
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
      { h: 'Durum', v: (r) => yesNo(r.active, 'Aktif', 'Pasif') },
    ],
  });
}
