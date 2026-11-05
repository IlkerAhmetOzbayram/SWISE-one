// Roller ve yetki matrisi (#/roller)
import { state, $, main, api, toast, esc, opt } from '../core.js';
import { personnelTabs } from './personnel.js';

let selected = null;

export async function pageRoles() {
  let roles;
  let meta;
  try {
    [roles, meta] = await Promise.all([api('GET', '/api/roles'), api('GET', '/api/roles/catalog')]);
  } catch (err) { return toast(err.message, true); }
  if (!roles.some((r) => r.id === selected)) selected = roles.find((r) => !r.locked)?.id ?? roles[0].id;
  const role = roles.find((r) => r.id === selected);
  const actions = Object.keys(meta.action_labels).filter((a) => meta.catalog.some((m) => a in m.actions));

  main.innerHTML = `<h1>Personel</h1>${personnelTabs('roller')}
    <div class="split" style="grid-template-columns: 280px 1fr">
      <section class="card">
        <div class="card-head"><h2>Roller</h2></div>
        <div class="role-list">${roles.map((r) => `<button type="button" class="role-item ${r.id === selected ? 'active' : ''}" data-role="${r.id}">
          <b>${esc(r.name)}</b>${r.locked ? ' 🔒' : ''}<span class="small">${r.user_count} kişi${r.system ? '' : ' · özel'}</span></button>`).join('')}</div>
        <form data-new-role style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
          <label>Yeni rol adı<input name="name" placeholder="Örn. Ekip Lideri" required></label>
          <label>Başlangıç yetkileri<select name="copy_from">${roles.map((r) => opt(r.id, `${r.name} rolünden kopyala`, roles.find((x) => x.name === 'Çalışan')?.id)).join('')}</select></label>
          <button type="submit" class="secondary">+ Rol ekle</button>
        </form>
      </section>
      <section class="card">
        <div class="card-head"><h2>${esc(role.name)}</h2>
          ${!role.system ? `<button type="button" class="link danger" data-delete>Rolü sil</button>` : ''}</div>
        ${role.locked ? '<div class="notice">Yönetici rolü tüm yetkilere sahiptir ve değiştirilemez. Uygulamaya yeni modüller eklendikçe otomatik olarak yetki alır.</div>' : ''}
        <form data-perms>
          ${role.system ? '' : `<label style="margin-bottom:10px">Rol adı<input name="name" value="${esc(role.name)}" required></label>`}
          <label style="margin-bottom:14px">Açıklama<input name="description" value="${esc(role.description)}" ${role.locked ? 'disabled' : ''}></label>
          <div class="table-wrap"><table class="matrix">
            <thead><tr><th>Modül</th>${actions.map((a) => `<th>${meta.action_labels[a]}</th>`).join('')}</tr></thead>
            <tbody>${meta.catalog.map((m) => `<tr><td><b>${esc(m.label)}</b></td>${actions.map((a) => `<td>${cell(m, a, role, meta)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <p class="hint">Kapsam: <b>Kendi</b> = yalnızca kendi kayıtları · <b>Sorumlu olduğu</b> = sorumlusu olduğu müşterilerin kayıtları + kendi kayıtları · <b>Tümü</b> = herkesin kayıtları.
            “Ücret ve tutarlar” kapalı olan kişi günlük ücret ve tutarları hiçbir ekranda görmez.</p>
          ${role.locked ? '' : '<div class="actions" style="margin-top:12px"><button type="submit">Yetkileri kaydet</button></div>'}
        </form>
      </section>
    </div>`;

  main.querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => { selected = Number(b.dataset.role); pageRoles(); }; });

  $('[data-new-role]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const { id } = await api('POST', '/api/roles', { name: f.elements.namedItem('name').value, copy_from: f.elements.namedItem('copy_from').value });
      selected = id;
      toast('Rol eklendi');
      pageRoles();
    } catch (err) { toast(err.message, true); }
  };

  const del = $('[data-delete]');
  if (del) del.onclick = async () => {
    if (!confirm(`"${role.name}" rolü silinsin mi?`)) return;
    try {
      await api('DELETE', `/api/roles/${role.id}`);
      selected = null;
      toast('Rol silindi');
      pageRoles();
    } catch (err) { toast(err.message, true); }
  };

  $('[data-perms]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const permissions = {};
    f.querySelectorAll('[data-perm]').forEach((el) => {
      if (el.type === 'checkbox') { if (el.checked) permissions[el.dataset.perm] = true; }
      else if (el.value) permissions[el.dataset.perm] = el.value;
    });
    try {
      await api('PUT', `/api/roles/${role.id}`, {
        name: f.elements.namedItem('name')?.value ?? role.name, description: f.elements.namedItem('description').value, permissions,
      });
      toast('Yetkiler kaydedildi');
      // Kendi rolü değiştiyse menü ve ekranlar yeni yetkilere göre yenilenir
      if (role.id === state.user.role_id) location.reload();
      else pageRoles();
    } catch (err) { toast(err.message, true); }
  };
}

// Matris hücresi: kapsamlı yetkide seçim kutusu, açık/kapalı yetkide onay kutusu
function cell(m, action, role, meta) {
  const spec = m.actions[action];
  if (!spec) return '<span class="small">—</span>';
  const key = `${m.module}.${action}`;
  const value = role.permissions[key];
  const disabled = role.locked ? 'disabled' : '';
  if (Array.isArray(spec)) {
    return `<select data-perm="${key}" ${disabled}><option value="">Yok</option>${spec.map((s) => opt(s, meta.scope_labels[s], value)).join('')}</select>`;
  }
  return `<input type="checkbox" data-perm="${key}" ${value ? 'checked' : ''} ${disabled} aria-label="${esc(m.label)} – ${esc(meta.action_labels[action])}">`;
}
