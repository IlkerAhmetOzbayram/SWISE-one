import { state, esc, money, moneyByCurrency, today, fmtDate, opt, clientProjectCell, yesNo, currencyOptions } from '../core.js';
import { entryPage, footerCells } from '../components/entry-page.js';

const sumBy = (rows, fn) => {
  const t = {};
  for (const r of rows) t[r.currency] = (t[r.currency] || 0) + fn(r);
  return t;
};

// Şirket seçilince para birimi o şirketinkine ayarlanır (değiştirilebilir; düzenlemede korunur)
function syncCurrency(f, { keepCurrency } = {}) {
  if (keepCurrency) return;
  const company = state.companies.find((c) => String(c.id) === f.elements.namedItem('company_id').value);
  if (company?.effective_currency) f.elements.namedItem('currency').value = company.effective_currency;
}

export function pageExpenses() {
  const cats = (state.settings.expense_categories || '').split(',').map((s) => s.trim()).filter(Boolean);
  entryPage({
    title: 'Masraflar',
    newTitle: 'Yeni masraf',
    editTitle: 'Masrafı düzenle',
    endpoint: '/api/expenses',
    fields: ({ target, user }) => `
      <label>Tarih<input type="date" name="date" required></label>
      ${target}
      <label>Kategori<select name="category" required>${cats.map((c) => opt(c, c)).join('')}</select></label>
      <label class="wide">Açıklama<input name="description" placeholder="Örn. İstanbul–Ankara uçak bileti"></label>
      <label>Tutar, KDV hariç<input name="amount" inputmode="decimal" required></label>
      <label>Para birimi<select name="currency">${currencyOptions('TRY')}</select></label>
      <label>KDV oranı<select name="vat_rate">${[0, 1, 10, 20].map((v) => opt(v, `%${v}`, 20)).join('')}</select></label>
      ${user}
      <label class="check"><input type="checkbox" name="billable"> Müşteriye yansıtılır</label>`,
    defaults: (f) => {
      f.elements.namedItem('date').value = today();
      f.elements.namedItem('billable').checked = true;
      f.elements.namedItem('vat_rate').value = '20';
    },
    onTargetChange: syncCurrency,
    // "1.234,56" → 1234.56; "12.5" olduğu gibi kalır
    toPayload: (d) => ({ ...d, amount: d.amount.includes(',') ? d.amount.replace(/\./g, '').replace(',', '.') : d.amount }),
    toForm: (r) => ({ ...r, amount: String(r.amount).replace('.', ',') }),
    columns: [
      { h: 'Tarih', v: (r) => fmtDate(r.date) },
      { h: 'Kullanıcı', admin: true, v: (r) => esc(r.user_name) },
      { h: 'Müşteri / Proje', v: clientProjectCell },
      { h: 'Kategori', v: (r) => esc(r.category) },
      { h: 'Açıklama', v: (r) => esc(r.description) },
      { h: 'Tutar', key: 'amount', cls: 'num', v: (r) => money(r.amount, r.currency) },
      { h: 'KDV', key: 'vat', cls: 'num', v: (r) => `${money(r.amount * r.vat_rate / 100, r.currency)} <span class="small">%${r.vat_rate}</span>` },
      { h: 'Yansıtılır', v: (r) => yesNo(r.billable) },
    ],
    footer: (rows, cols) => footerCells(cols, {
      amount: moneyByCurrency(sumBy(rows, (r) => r.amount)),
      vat: moneyByCurrency(sumBy(rows, (r) => r.amount * r.vat_rate / 100)),
    }),
  });
}
