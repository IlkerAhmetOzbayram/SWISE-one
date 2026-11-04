// Bir günün eforunu görme/ekleme/düzenleme penceresi (Efor ekranı ve ana sayfa kullanır)
import { state, isAdmin, api, toast, esc, hrs, fmtDate, dayName, formToObj, parseHours, userOptions, clientProjectCell, yesNo } from '../core.js';
import { targetFields, setTarget, bindTarget } from './target-select.js';

const sameTarget = (r, t) => String(r.company_id) === String(t.company_id) && String(r.project_id ?? '') === String(t.project_id ?? '');

// target verilirse liste o müşteri/şirket/projeyle sınırlanır ve form o hedefle açılır
export function openEntryDialog({ date, target = null, userId = state.user.id, onChange = () => {} }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <div class="modal-head"><h2>${fmtDate(date)} · ${dayName(date)}</h2><button type="button" class="link" data-close aria-label="Kapat">✕</button></div>
    <div data-entries></div>
    <form class="grid" data-form>
      <input type="hidden" name="_id">
      ${targetFields()}
      <label>Süre (saat)<input name="hours" placeholder="1,5 veya 1:30" inputmode="decimal" required></label>
      <label class="full">Açıklama<input name="description" placeholder="Ne üzerinde çalışıldı?" required></label>
      ${isAdmin() ? `<label>Kullanıcı<select name="user_id">${userOptions(userId)}</select></label>` : ''}
      <label class="check"><input type="checkbox" name="billable" checked> Faturalanabilir</label>
      <div class="actions"><button type="submit" data-submit>Ekle</button><button type="button" class="secondary" data-reset hidden>Vazgeç</button></div>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('[data-form]');
  const submit = dlg.querySelector('[data-submit]');
  const resetBtn = dlg.querySelector('[data-reset]');
  let rows = [];

  const resetForm = () => {
    form.reset();
    form.elements.namedItem('_id').value = '';
    form.elements.namedItem('billable').checked = true;
    if (isAdmin()) form.elements.namedItem('user_id').value = userId;
    setTarget(form, target || {});
    submit.textContent = 'Ekle';
    resetBtn.hidden = true;
  };

  async function load() {
    const params = new URLSearchParams({ from: date, to: date });
    if (isAdmin()) params.set('user_id', userId);
    try {
      rows = (await api('GET', `/api/activities?${params}`)).filter((r) => !target || sameTarget(r, target));
    } catch (err) { return toast(err.message, true); }
    const total = rows.reduce((a, r) => a + r.hours, 0);
    dlg.querySelector('[data-entries]').innerHTML = rows.length ? `<table>
      <thead><tr><th>Müşteri / Proje</th><th>Açıklama</th><th class="num">Saat</th><th>Fatura</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${clientProjectCell(r)}</td><td>${esc(r.description)}</td><td class="num">${hrs(r.hours)}</td>
        <td>${yesNo(r.billable)}</td><td class="num"><button class="link" data-edit="${r.id}">Düzenle</button><button class="link danger" data-del="${r.id}">Sil</button></td></tr>`).join('')}</tbody>
      <tfoot><tr class="total"><td colspan="2">Toplam</td><td class="num">${hrs(total)}</td><td colspan="2"></td></tr></tfoot></table>`
      : '<p class="hint" style="margin:0 0 12px">Bu gün için kayıt yok.</p>';
  }

  dlg.querySelector('[data-entries]').onclick = async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
      const r = rows.find((x) => x.id === Number(edit.dataset.edit));
      setTarget(form, r);
      form.elements.namedItem('_id').value = r.id;
      form.elements.namedItem('hours').value = hrs(r.hours);
      form.elements.namedItem('description').value = r.description;
      form.elements.namedItem('billable').checked = !!r.billable;
      if (isAdmin()) form.elements.namedItem('user_id').value = r.user_id;
      submit.textContent = 'Güncelle';
      resetBtn.hidden = false;
    } else if (del && confirm('Bu kayıt silinsin mi?')) {
      try {
        await api('DELETE', `/api/activities/${del.dataset.del}`);
        toast('Kayıt silindi');
        await load();
        onChange();
      } catch (err) { toast(err.message, true); }
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formToObj(form);
    const id = d._id;
    delete d._id;
    delete d._customer;
    const hours = parseHours(d.hours);
    if (!(hours > 0)) return toast('Süre geçersiz', true);
    try {
      await api(id ? 'PUT' : 'POST', id ? `/api/activities/${id}` : '/api/activities', { ...d, hours, date });
      toast(id ? 'Kayıt güncellendi' : 'Kayıt eklendi');
      resetForm();
      await load();
      onChange();
    } catch (err) { toast(err.message, true); }
  };

  resetBtn.onclick = resetForm;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  bindTarget(form);
  resetForm();
  load();
  dlg.showModal();
}
