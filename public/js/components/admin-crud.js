// Yönetim ekranları için ortak form + liste
import { $, api, toast, formToObj, fillForm, loadRefs } from '../core.js';

export function adminCrud(root, cfg) {
  root.innerHTML = `<section class="card">
      <h2 data-title>${cfg.newTitle}</h2>
      <form class="grid"><input type="hidden" name="_id">${cfg.fields()}
        <div class="actions"><button type="submit">Kaydet</button><button type="button" class="secondary" data-cancel hidden>Vazgeç</button></div>
      </form>
    </section>
    <section class="card"><h2>${cfg.listTitle}</h2><div class="table-wrap" data-list></div></section>`;
  const form = $('form', root);
  const title = $('[data-title]', root);
  const cancel = $('[data-cancel]', root);

  const reset = () => {
    form.reset();
    form.elements.namedItem('_id').value = '';
    cfg.defaults?.(form);
    title.textContent = cfg.newTitle;
    cancel.hidden = true;
  };
  const list = () => {
    const rows = cfg.rows();
    $('[data-list]', root).innerHTML = rows.length ? `<table>
      <thead><tr>${cfg.columns.map((c) => `<th class="${c.cls || ''}">${c.h}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.active === 0 ? 'muted' : ''}">${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.v(r)}</td>`).join('')}
        <td class="num"><button class="link" data-edit="${r.id}">Düzenle</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${cfg.emptyText}</div>`;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formToObj(form);
    const id = d._id;
    delete d._id;
    try {
      await api(id ? 'PUT' : 'POST', id ? `${cfg.endpoint}/${id}` : cfg.endpoint, d);
      toast('Kaydedildi');
      await loadRefs();
      cfg.onSaved ? cfg.onSaved() : (reset(), list());
    } catch (err) { toast(err.message, true); }
  };
  cancel.onclick = reset;
  $('[data-list]', root).onclick = (e) => {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    const row = cfg.rows().find((r) => r.id === Number(b.dataset.edit));
    fillForm(form, { ...row, _id: row.id });
    cfg.onEdit?.(form, row);
    title.textContent = cfg.editTitle;
    cancel.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  reset();
  list();
}
