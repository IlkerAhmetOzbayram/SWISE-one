import { state, isAdmin, esc, money, hrs, today, fmtDate, sum, parseHours, projectOptions, userOptions, clientProjectCell, yesNo } from '../core.js';
import { entryPage, footerCells } from '../components/entry-page.js';

export function pageActivities() {
  entryPage({
    title: 'Aktiviteler',
    newTitle: 'Yeni aktivite',
    editTitle: 'Aktiviteyi düzenle',
    endpoint: '/api/activities',
    fields: () => `
      <label>Tarih<input type="date" name="date" required></label>
      <label class="wide">Müşteri / Proje<select name="project_id" required>${projectOptions()}</select></label>
      <label>Süre (saat)<input name="hours" placeholder="1,5 veya 1:30" inputmode="decimal" required></label>
      <label class="full">Açıklama<input name="description" placeholder="Ne üzerinde çalışıldı?" required></label>
      ${isAdmin() ? `<label>Kullanıcı<select name="user_id">${userOptions()}</select></label>
      <label>Saatlik ücret (₺)<input name="rate" inputmode="decimal" placeholder="Otomatik"></label>` : ''}
      <label class="check"><input type="checkbox" name="billable"> Faturalanabilir</label>`,
    defaults: (f) => {
      f.elements.namedItem('date').value = today();
      f.elements.namedItem('billable').checked = true;
      if (isAdmin()) f.elements.namedItem('user_id').value = state.user.id;
    },
    toPayload: (d) => {
      const hours = parseHours(d.hours);
      if (!(hours > 0)) throw new Error('Süre geçersiz');
      return { ...d, hours };
    },
    toForm: (r) => ({ ...r, hours: hrs(r.hours), rate: r.rate ?? '' }),
    columns: [
      { h: 'Tarih', v: (r) => fmtDate(r.date) },
      { h: 'Kullanıcı', admin: true, v: (r) => esc(r.user_name) },
      { h: 'Müşteri / Proje', v: clientProjectCell },
      { h: 'Açıklama', v: (r) => esc(r.description) },
      { h: 'Saat', key: 'hours', cls: 'num', v: (r) => hrs(r.hours) },
      { h: 'Fatura', key: 'billable', v: (r) => yesNo(r.billable) },
      { h: 'Ücret', admin: true, cls: 'num', v: (r) => money(r.rate) },
      { h: 'Tutar', key: 'amount', admin: true, cls: 'num', v: (r) => (r.billable ? money(r.hours * r.rate) : '—') },
    ],
    footer: (rows, cols) => footerCells(cols, {
      hours: hrs(sum(rows, (r) => r.hours)),
      billable: `<span class="small">${hrs(sum(rows, (r) => (r.billable ? r.hours : 0)))} sa</span>`,
      amount: money(sum(rows, (r) => (r.billable ? r.hours * r.rate : 0))),
    }),
  });
}
