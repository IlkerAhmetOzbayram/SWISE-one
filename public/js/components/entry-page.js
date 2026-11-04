// Aktivite / masraf giriş sayfası (ortak iskelet): form + filtreli liste
import { state, isAdmin, $, main, api, toast, formToObj, fillForm, qs, projectOptions } from '../core.js';
import { filters, filterBar, bindFilterBar } from '../filters.js';

// Alt toplam satırı: ilk hücre "Toplam", diğerleri sütun anahtarına göre
export function footerCells(cols, values) {
  return cols.map((c, i) => (i === 0 ? '<td>Toplam</td>' : `<td class="${c.cls || ''}">${values[c.key] ?? ''}</td>`)).join('');
}

export function entryPage(cfg) {
  const noProjects = !state.projects.some((p) => p.active);
  main.innerHTML = `<h1>${cfg.title}</h1>
    <section class="card">
      <h2 data-title>${cfg.newTitle}</h2>
      ${noProjects ? `<p class="hint">Henüz aktif proje yok. ${isAdmin() ? '<a href="#/musteriler">Müşteri ve proje ekleyin</a>.' : 'Yöneticinizden proje tanımlamasını isteyin.'}</p>` : ''}
      <form class="grid" id="entryForm" ${noProjects ? 'hidden' : ''}>
        <input type="hidden" name="_id">
        ${cfg.fields()}
        <div class="actions"><button type="submit">Kaydet</button><button type="button" class="secondary" data-cancel hidden>Vazgeç</button></div>
      </form>
    </section>
    <section class="card">
      ${filterBar({ user: isAdmin() })}
      <div class="table-wrap" data-list></div>
    </section>`;

  const form = $('#entryForm');
  const field = (n) => form.elements.namedItem(n);
  const title = $('[data-title]');
  const cancel = $('[data-cancel]');
  let rows = [];

  function reset(keepContext) {
    const keep = { date: field('date').value, project_id: field('project_id').value };
    form.reset();
    field('_id').value = '';
    cfg.defaults(form);
    if (keepContext && keep.date) { field('date').value = keep.date; field('project_id').value = keep.project_id; }
    title.textContent = cfg.newTitle;
    cancel.hidden = true;
  }

  async function load() {
    try {
      rows = await api('GET', `${cfg.endpoint}?${qs(filters)}`);
    } catch (err) { return toast(err.message, true); }
    const cols = cfg.columns.filter((c) => !c.admin || isAdmin());
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
      // Pasif projeli kayıt için seçeneklerin yeniden üretilmesi
      field('project_id').innerHTML = projectOptions(row.project_id);
      fillForm(form, { ...cfg.toForm(row), _id: row.id });
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

  bindFilterBar(main, load);
  reset(false);
  load();
}
