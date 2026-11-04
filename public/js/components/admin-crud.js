// Yönetim ekranları için ortak form + liste.
// compact: liste önde, form yalnızca "ekle/düzenle" ile açılır. deletable: satırlarda "Sil".
import { $, api, toast, formToObj, fillForm, loadRefs } from '../core.js';

export function adminCrud(root, cfg) {
  const formCard = `<section class="card" data-form-card ${cfg.compact ? 'hidden' : ''}>
      <h2 data-title>${cfg.newTitle}</h2>
      <form class="grid"><input type="hidden" name="_id">${cfg.fields()}
        <div class="actions"><button type="submit">Kaydet</button><button type="button" class="secondary" data-cancel ${cfg.compact ? '' : 'hidden'}>Vazgeç</button></div>
      </form>
    </section>`;
  const listCard = `<section class="card"><div class="card-head"><h2>${cfg.listTitle}</h2>
      ${cfg.compact ? `<button type="button" class="secondary" data-add>+ ${cfg.addLabel || cfg.newTitle}</button>` : ''}</div>
      ${cfg.intro ? `<p class="hint" style="margin:-6px 0 12px">${cfg.intro}</p>` : ''}
      <div class="table-wrap" data-list></div></section>`;
  root.innerHTML = cfg.compact ? listCard + formCard : formCard + listCard;

  const form = $('form', root);
  const card = $('[data-form-card]', root);
  const title = $('[data-title]', root);
  const cancel = $('[data-cancel]', root);

  const reset = () => {
    form.reset();
    form.elements.namedItem('_id').value = '';
    cfg.defaults?.(form);
    title.textContent = cfg.newTitle;
    if (cfg.compact) card.hidden = true;
    else cancel.hidden = true;
  };
  const open = () => {
    card.hidden = false;
    if (!cfg.compact) cancel.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const list = () => {
    const rows = cfg.rows();
    $('[data-list]', root).innerHTML = rows.length ? `<table>
      <thead><tr>${cfg.columns.map((c) => `<th class="${c.cls || ''}">${c.h}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.active === 0 ? 'muted' : ''}">${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.v(r)}</td>`).join('')}
        <td class="num"><button class="link" data-edit="${r.id}">Düzenle</button>${cfg.deletable ? `<button class="link danger" data-del="${r.id}">Sil</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${cfg.emptyText}</div>`;
  };

  const saved = async () => {
    await loadRefs();
    if (cfg.onSaved) await cfg.onSaved();
    else { reset(); list(); }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formToObj(form);
    const id = d._id;
    delete d._id;
    try {
      await api(id ? 'PUT' : 'POST', id ? `${cfg.endpoint}/${id}` : cfg.endpoint, cfg.toPayload ? cfg.toPayload(d) : d);
      toast('Kaydedildi');
      await saved();
    } catch (err) { toast(err.message, true); }
  };
  cancel.onclick = reset;
  const add = $('[data-add]', root);
  if (add) add.onclick = () => { reset(); open(); };

  $('[data-list]', root).onclick = async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
      const row = cfg.rows().find((r) => r.id === Number(edit.dataset.edit));
      reset();
      fillForm(form, { ...(cfg.toForm ? cfg.toForm(row) : row), _id: row.id });
      cfg.onEdit?.(form, row);
      title.textContent = cfg.editTitle;
      open();
    } else if (del && confirm('Bu kayıt silinsin mi?')) {
      try {
        await api('DELETE', `${cfg.endpoint}/${del.dataset.del}`);
        toast('Kayıt silindi');
        await saved();
      } catch (err) { toast(err.message, true); }
    }
  };
  cfg.bind?.(form);
  reset();
  list();
}
