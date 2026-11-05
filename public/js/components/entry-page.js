// Aktivite / masraf giriş sayfası (ortak iskelet): form + filtreli liste
import { state, can, seeOthers, editOthers, $, main, api, toast, formToObj, fillForm, qs, esc, userOptions } from '../core.js';
import { filters, filterBar, bindFilterBar } from '../filters.js';
import { targetFields, setTarget, getTarget, bindTarget, hasTargets } from './target-select.js';

// Alt toplam satırı: ilk hücre "Toplam", diğerleri sütun anahtarına göre
export function footerCells(cols, values) {
  return cols.map((c, i) => (i === 0 ? '<td>Toplam</td>' : `<td class="${c.cls || ''}">${values[c.key] ?? ''}</td>`)).join('');
}

// Kaydı giren kullanıcı: yalnızca yönetici değiştirebilir, diğerleri kendi adını görür
const userField = (module) => (editOthers(module)
  ? `<label>Kullanıcı<select name="user_id">${userOptions()}</select></label>`
  : `<label>Kullanıcı<input value="${esc(state.user.full_name)}" disabled></label>`);

export function entryPage(cfg) {
  const ready = hasTargets();
  main.innerHTML = `<h1>${cfg.title}</h1>
    <section class="card">
      <h2 data-title>${cfg.newTitle}</h2>
      ${ready ? '' : `<p class="hint">Henüz aktif müşteri yok. ${can('customers.edit') ? '<a href="#/musteriler">Müşteri ekleyin</a>.' : 'Yöneticinizden müşteri tanımlamasını isteyin.'}</p>`}
      <form class="grid" id="entryForm" ${ready ? '' : 'hidden'}>
        <input type="hidden" name="_id">
        ${cfg.fields({ target: targetFields(), user: userField(cfg.module) })}
        <div class="actions"><button type="submit">Kaydet</button><button type="button" class="secondary" data-cancel hidden>Vazgeç</button></div>
      </form>
    </section>
    <section class="card">
      ${filterBar({ user: seeOthers(cfg.module) })}
      <div class="table-wrap" data-list></div>
    </section>`;

  const form = $('#entryForm');
  const field = (n) => form.elements.namedItem(n);
  const title = $('[data-title]');
  const cancel = $('[data-cancel]');
  let rows = [];

  // Yeni kayıttan sonra tarih ve müşteri/şirket/proje seçimi korunur (art arda giriş için)
  function reset(keepContext) {
    const keep = { date: field('date').value, target: getTarget(form) };
    form.reset();
    field('_id').value = '';
    cfg.defaults(form);
    if (editOthers(cfg.module)) field('user_id').value = state.user.id;
    setTarget(form, keepContext ? keep.target : {});
    if (keepContext && keep.date) field('date').value = keep.date;
    cfg.onTargetChange?.(form);
    title.textContent = cfg.newTitle;
    cancel.hidden = true;
  }

  async function load() {
    try {
      rows = await api('GET', `${cfg.endpoint}?${qs(filters)}`);
    } catch (err) { return toast(err.message, true); }
    const cols = cfg.columns.filter((c) => !c.show || c.show());
    $('[data-list]').innerHTML = rows.length ? `<table>
      <thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${c.h}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.v(r)}</td>`).join('')}
        <td class="num"><button class="link" data-edit="${r.id}">Düzenle</button><button class="link danger" data-del="${r.id}">Sil</button></td></tr>`).join('')}</tbody>
      <tfoot><tr class="total">${cfg.footer(rows, cols)}<td></td></tr></tfoot>
    </table>` : '<div class="empty">Bu dönemde kayıt yok.</div>';
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formToObj(form);
    const id = d._id;
    delete d._id;
    delete d._customer;
    try {
      await api(id ? 'PUT' : 'POST', id ? `${cfg.endpoint}/${id}` : cfg.endpoint, cfg.toPayload(d));
      toast(id ? 'Kayıt güncellendi' : 'Kayıt eklendi');
      reset(!id);
      load();
    } catch (err) { toast(err.message, true); }
  };
  cancel.onclick = () => reset(false);

  $('[data-list]').onclick = async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
      const row = rows.find((r) => r.id === Number(edit.dataset.edit));
      setTarget(form, row);
      const { customer_id: _c, company_id: _co, project_id: _p, ...rest } = cfg.toForm(row);
      fillForm(form, { ...rest, _id: row.id });
      cfg.onTargetChange?.(form, { keepCurrency: true });
      title.textContent = cfg.editTitle;
      cancel.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (del && confirm('Bu kayıt silinsin mi?')) {
      try {
        await api('DELETE', `${cfg.endpoint}/${del.dataset.del}`);
        toast('Kayıt silindi');
        load();
      } catch (err) { toast(err.message, true); }
    }
  };

  bindTarget(form, (f) => cfg.onTargetChange?.(f));
  bindFilterBar(main, load);
  reset(false);
  load();
}
