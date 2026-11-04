import { state, isAdmin, esc, money, moneyByCurrency, today, fmtDate, opt, projectOptions, projectById, userOptions, clientProjectCell, yesNo, currencyOptions } from '../core.js';
import { entryPage, footerCells } from '../components/entry-page.js';

const sumBy = (rows, fn) => {
  const t = {};
  for (const r of rows) t[r.currency] = (t[r.currency] || 0) + fn(r);
  return t;
};

export function pageExpenses() {
  const cats = (state.settings.expense_categories || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Proje seçilince para birimi o projenin para birimine ayarlanır (değiştirilebilir)
  const syncCurrency = (f) => {
    const p = projectById(f.elements.namedItem('project_id').value);
    if (p) f.elements.namedItem('currency').value = p.currency;
  };
  entryPage({
    title: 'Masraflar',
    newTitle: 'Yeni masraf',
    editTitle: 'Masrafı düzenle',
    endpoint: '/api/expenses',
    fields: () => `
      <label>Tarih<input type="date" name="date" required></label>
      <label class="wide">Müşteri › Şirket / Proje<select name="project_id" required>${projectOptions()}</select></label>
      <label>Kategori<select name="category" required>${cats.map((c) => opt(c, c)).join('')}</select></label>
      <label class="wide">Açıklama<input name="description" placeholder="Örn. İstanbul–Ankara uçak bileti"></label>
      <label>Tutar, KDV hariç<input name="amount" inputmode="decimal" required></label>
      <label>Para birimi<select name="currency">${currencyOptions('TRY')}</select></label>
      <label>KDV oranı<select name="vat_rate">${[0, 1, 10, 20].map((v) => opt(v, `%${v}`, 20)).join('')}</select></label>
      ${isAdmin() ? `<label>Kullanıcı<select name="user_id">${userOptions()}</select></label>` : ''}
      <label class="check"><input type="checkbox" name="billable"> Müşteriye yansıtılır</label>`,
    defaults: (f) => {
      f.elements.namedItem('date').value = today();
      f.elements.namedItem('billable').checked = true;
      f.elements.namedItem('vat_rate').value = '20';
      if (isAdmin()) f.elements.namedItem('user_id').value = state.user.id;
    },
    bind: (f) => f.elements.namedItem('project_id').addEventListener('change', () => syncCurrency(f)),
    afterReset: syncCurrency,
    // "1.234,56" → 1234.56; "12.5" olduğu gibi kalır
    toPayload: (d) => ({ ...d, amount: d.amount.includes(',') ? d.amount.replace(/\./g, '').replace(',', '.') : d.amount }),
    toForm: (r) => ({ ...r, amount: String(r.amount).replace('.', ',') }),
    columns: [
      { h: 'Tarih', v: (r) => fmtDate(r.date) },
      { h: 'Kullanıcı', admin: true, v: (r) => esc(r.user_name) },
      { h: 'Müşteri › Şirket / Proje', v: clientProjectCell },
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
