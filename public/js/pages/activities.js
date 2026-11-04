import { state, isAdmin, esc, money, moneyByCurrency, hrs, today, fmtDate, parseHours, projectOptions, projectById, userOptions, clientProjectCell, yesNo, HOURS_PER_DAY } from '../core.js';
import { entryPage, footerCells } from '../components/entry-page.js';

const amount = (r) => r.hours * r.daily_rate / HOURS_PER_DAY;

// Para birimi başına toplam
function totalsByCurrency(rows) {
  const t = {};
  for (const r of rows) if (r.billable) t[r.currency] = (t[r.currency] || 0) + amount(r);
  return t;
}

export function pageActivities() {
  entryPage({
    title: 'Aktiviteler',
    newTitle: 'Yeni aktivite',
    editTitle: 'Aktiviteyi düzenle',
    endpoint: '/api/activities',
    fields: () => `
      <label>Tarih<input type="date" name="date" required></label>
      <label class="wide">Müşteri › Şirket / Proje<select name="project_id" required>${projectOptions()}</select></label>
      <label>Süre (saat)<input name="hours" placeholder="1,5 veya 1:30" inputmode="decimal" required></label>
      <label class="full">Açıklama<input name="description" placeholder="Ne üzerinde çalışıldı?" required></label>
      ${isAdmin() ? `<label>Kullanıcı<select name="user_id">${userOptions()}</select></label>
      <label>Günlük ücret<input name="daily_rate" inputmode="decimal" placeholder="Otomatik"></label>` : ''}
      <label class="check"><input type="checkbox" name="billable"> Faturalanabilir</label>
      ${isAdmin() ? '<p class="hint full" data-rate-hint></p>' : ''}`,
    defaults: (f) => {
      f.elements.namedItem('date').value = today();
      f.elements.namedItem('billable').checked = true;
      if (isAdmin()) f.elements.namedItem('user_id').value = state.user.id;
    },
    // Yönetici: seçilen projenin geçerli ücretini göster
    bind: (f) => {
      if (!isAdmin()) return;
      const sel = f.elements.namedItem('project_id');
      sel.addEventListener('change', () => showRate(f));
    },
    afterReset: (f) => { if (isAdmin()) showRate(f); },
    toPayload: (d) => {
      const hours = parseHours(d.hours);
      if (!(hours > 0)) throw new Error('Süre geçersiz');
      return { ...d, hours };
    },
    toForm: (r) => ({ ...r, hours: hrs(r.hours), daily_rate: r.daily_rate ?? '' }),
    columns: [
      { h: 'Tarih', v: (r) => fmtDate(r.date) },
      { h: 'Kullanıcı', admin: true, v: (r) => esc(r.user_name) },
      { h: 'Müşteri › Şirket / Proje', v: clientProjectCell },
      { h: 'Açıklama', v: (r) => esc(r.description) },
      { h: 'Saat', key: 'hours', cls: 'num', v: (r) => hrs(r.hours) },
      { h: 'Fatura', key: 'billable', v: (r) => yesNo(r.billable) },
      { h: 'Günlük ücret', admin: true, cls: 'num', v: (r) => money(r.daily_rate, r.currency) },
      { h: 'Tutar', key: 'amount', admin: true, cls: 'num', v: (r) => (r.billable ? money(amount(r), r.currency) : '—') },
    ],
    footer: (rows, cols) => {
      const billable = rows.reduce((a, r) => a + (r.billable ? r.hours : 0), 0);
      return footerCells(cols, {
        hours: hrs(rows.reduce((a, r) => a + r.hours, 0)),
        billable: `<span class="small">${hrs(billable)} sa · ${hrs(billable / HOURS_PER_DAY)} gün</span>`,
        amount: moneyByCurrency(totalsByCurrency(rows)),
      });
    },
  });
}

function showRate(f) {
  const hint = f.parentElement.querySelector('[data-rate-hint]');
  const p = projectById(f.elements.namedItem('project_id').value);
  if (!hint) return;
  hint.textContent = p ? `Bu projenin geçerli günlük ücreti: ${money(p.effective_daily_rate, p.currency)} (saatlik ${money(p.effective_daily_rate / HOURS_PER_DAY, p.currency)}). Farklı bir ücret için yukarıya yazın.` : '';
}
