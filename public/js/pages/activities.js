import { seeOthers, editOthers, seeRates, esc, money, moneyByCurrency, hrs, today, fmtDate, parseHours, clientProjectCell, yesNo, HOURS_PER_DAY } from '../core.js';
import { entryPage, footerCells } from '../components/entry-page.js';
import { effectiveRate } from '../components/target-select.js';

const amount = (r) => r.hours * r.daily_rate / HOURS_PER_DAY;

// Para birimi başına toplam
function totalsByCurrency(rows) {
  const t = {};
  for (const r of rows) if (r.billable) t[r.currency] = (t[r.currency] || 0) + amount(r);
  return t;
}

// Yönetici: seçilen müşteri/şirket/projenin geçerli ücretini göster
function showRate(f) {
  const hint = f.querySelector('[data-rate-hint]');
  if (!hint) return;
  const r = effectiveRate(f);
  hint.textContent = r ? `Geçerli günlük ücret: ${money(r.daily_rate, r.currency)} (saatlik ${money(r.daily_rate / HOURS_PER_DAY, r.currency)}). Farklı bir ücret için “Günlük ücret” alanına yazın.` : '';
}

export function pageActivities() {
  entryPage({
    title: 'Aktivite Giriş',
    newTitle: 'Yeni aktivite',
    editTitle: 'Aktiviteyi düzenle',
    module: 'activities',
    endpoint: '/api/activities',
    fields: ({ target, user }) => `
      <label>Tarih<input type="date" name="date" required></label>
      ${target}
      <label>Süre (saat)<input name="hours" placeholder="1,5 veya 1:30" inputmode="decimal" required></label>
      <label class="full">Açıklama<input name="description" placeholder="Ne üzerinde çalışıldı?" required></label>
      ${user}
      ${seeRates() && editOthers('activities') ? '<label>Günlük ücret<input name="daily_rate" inputmode="decimal" placeholder="Otomatik"></label>' : ''}
      <label class="check"><input type="checkbox" name="billable"> Faturalanabilir</label>
      ${seeRates() ? '<p class="hint full" data-rate-hint></p>' : ''}`,
    defaults: (f) => {
      f.elements.namedItem('date').value = today();
      f.elements.namedItem('billable').checked = true;
    },
    onTargetChange: showRate,
    toPayload: (d) => {
      const hours = parseHours(d.hours);
      if (!(hours > 0)) throw new Error('Süre geçersiz');
      return { ...d, hours };
    },
    toForm: (r) => ({ ...r, hours: hrs(r.hours), daily_rate: r.daily_rate ?? '' }),
    columns: [
      { h: 'Tarih', v: (r) => fmtDate(r.date) },
      { h: 'Kullanıcı', show: () => seeOthers('activities'), v: (r) => esc(r.user_name) },
      { h: 'Müşteri / Proje', v: clientProjectCell },
      { h: 'Açıklama', v: (r) => esc(r.description) },
      { h: 'Saat', key: 'hours', cls: 'num', v: (r) => hrs(r.hours) },
      { h: 'Fatura', key: 'billable', v: (r) => yesNo(r.billable) },
      { h: 'Günlük ücret', show: seeRates, cls: 'num', v: (r) => money(r.daily_rate, r.currency) },
      { h: 'Tutar', key: 'amount', show: seeRates, cls: 'num', v: (r) => (r.billable ? money(amount(r), r.currency) : '—') },
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
