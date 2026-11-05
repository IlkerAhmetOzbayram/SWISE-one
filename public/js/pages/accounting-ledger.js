// Kasa/banka hareketleri, hareket penceresi, personel (bordro + cari), gelir–gider ve kategori bütçesi
import { state, can, $, api, toast, esc, money, fmtDate, opt, today, addMonths, monthLabel, companyLabel } from '../core.js';
import { tl, parseNum } from './accounting.js';

export const KIND_LABELS = {
  collection: 'Tahsilat', payment: 'Ödeme', income: 'Gelir (faturasız)', expense: 'Gider (faturasız)',
  salary_payment: 'Maaş ödemesi', advance: 'Avans', expense_refund: 'Masraf iadesi', sgk_payment: 'SGK ödemesi', tax_payment: 'Vergi ödemesi',
};
const PERSONNEL = ['salary_payment', 'advance', 'expense_refund'];
const IN_KINDS = ['collection', 'income'];

// ---------- Hareket penceresi ----------
export async function openTransactionDialog({ kind = 'collection', invoice = null, userId = null, onSaved = () => {} } = {}) {
  let accounts;
  let categories;
  let openInvoices = [];
  let suppliers = [];
  try {
    [accounts, categories, suppliers] = await Promise.all([api('GET', '/api/accounts'), api('GET', '/api/categories'), api('GET', '/api/suppliers')]);
  } catch (err) { return toast(err.message, true); }
  accounts = accounts.filter((a) => a.active);
  if (!accounts.length) return toast('Önce Tanımlar sekmesinden bir kasa/banka hesabı ekleyin', true);
  const kinds = Object.keys(KIND_LABELS).filter((k) => !PERSONNEL.includes(k) || can('salary.edit'));

  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `<div class="modal-head"><h2>${invoice ? `${invoice.direction === 'out' ? 'Tahsilat' : 'Ödeme'} · ${esc(invoice.number)}` : 'Yeni hareket'}</h2>
      <button type="button" class="link" data-close aria-label="Kapat">✕</button></div>
    <form class="grid" data-form>
      <label class="wide">Tür<select name="kind" ${invoice ? 'disabled' : ''}>${kinds.map((k) => opt(k, KIND_LABELS[k], kind)).join('')}</select></label>
      <label class="wide">Hesap<select name="account_id">${accounts.map((a) => opt(a.id, `${a.name} (${a.currency})`)).join('')}</select></label>
      <label>Tarih<input type="date" name="date" value="${today()}" required></label>
      <label>Tutar<input name="amount" inputmode="decimal" required></label>
      <label>Kur (TL)<input name="rate" inputmode="decimal" placeholder="TL hesap"></label>
      <span class="small" data-rate-hint style="align-self:center"></span>
      <div class="full grid" data-extra style="grid-template-columns:repeat(4,1fr);gap:14px 16px"></div>
      <label class="full">Açıklama<input name="description"></label>
      <div class="actions"><button type="submit">Kaydet</button></div>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const f = (n) => form.elements.namedItem(n);
  const account = () => accounts.find((a) => String(a.id) === f('account_id').value);
  if (invoice) {
    // Faturayla aynı para birimindeki hesap önce seçilir, tutar kalan bakiyeyle dolar
    const same = accounts.find((a) => a.currency === invoice.currency);
    if (same) f('account_id').value = same.id;
    f('amount').value = invoice.outstanding;
  }

  async function suggestRate() {
    const a = account();
    const hint = dlg.querySelector('[data-rate-hint]');
    if (a.currency === 'TRY') { f('rate').value = ''; f('rate').disabled = true; hint.textContent = ''; return; }
    f('rate').disabled = false;
    const side = IN_KINDS.includes(f('kind').value) ? 'buying' : 'selling';
    const r = await api('GET', `/api/rates/for?currency=${a.currency}&date=${f('date').value}&side=${side}`).catch(() => ({}));
    hint.textContent = r.rate ? `TCMB ${side === 'buying' ? 'alış' : 'satış'} ${fmtDate(r.date)}: ${r.rate}` : 'Bu tarih için kur yok; elle girin';
    if (r.rate && !f('rate').dataset.touched) f('rate').value = r.rate;
  }

  async function renderExtra() {
    const k = f('kind').value;
    const box = dlg.querySelector('[data-extra]');
    const inv = invoice;
    let html = '';
    if (k === 'collection' || k === 'payment') {
      if (inv) {
        html = inv.currency !== account().currency
          ? `<label class="wide">Faturadan düşülecek (${inv.currency})<input name="invoice_amount" inputmode="decimal" value="${inv.outstanding}"></label>` : '';
      } else {
        openInvoices = (await api('GET', `/api/invoices?direction=${k === 'collection' ? 'out' : 'in'}`)).filter((i) => i.status === 'issued' && i.outstanding > 0);
        html = `<label class="full">Fatura<select name="invoice_id"><option value="">Faturasız (cariye)</option>${openInvoices.map((i) =>
          opt(i.id, `${i.number} · ${i.party_name} · kalan ${money(i.outstanding, i.currency)}`)).join('')}</select></label>
          <label class="wide" data-party>${k === 'collection' ? `Müşteri / şirket<select name="company_id">${state.companies.map((c) => opt(c.id, companyLabel(c.customer_name, c.name))).join('')}</select>`
            : `Tedarikçi<select name="supplier_id">${suppliers.map((s) => opt(s.id, s.name)).join('')}</select>`}</label>
          <label class="wide" data-inv-amount hidden>Faturadan düşülecek tutar (fatura para birimi)<input name="invoice_amount" inputmode="decimal"></label>`;
      }
    } else if (k === 'income' || k === 'expense') {
      html = `<label class="wide">Kategori<select name="category_id">${categories.filter((c) => c.kind === k && c.active).map((c) => opt(c.id, c.name)).join('')}</select></label>`;
    } else if (PERSONNEL.includes(k)) {
      html = `<label class="wide">Personel<select name="user_id">${state.users.filter((u) => u.active && u.full_name !== 'Yerel Yönetici').map((u) => opt(u.id, u.full_name, userId)).join('')}</select></label>`;
    }
    box.innerHTML = html;
    const invSel = f('invoice_id');
    if (invSel) {
      invSel.onchange = () => {
        const sel = openInvoices.find((i) => String(i.id) === invSel.value);
        box.querySelector('[data-party]').hidden = !!sel;
        box.querySelector('[data-inv-amount]').hidden = !sel || sel.currency === account().currency;
        if (sel && sel.currency === account().currency) f('amount').value = sel.outstanding;
      };
    }
  }

  f('kind').onchange = () => { renderExtra(); suggestRate(); };
  f('account_id').onchange = () => { renderExtra(); suggestRate(); };
  f('date').onchange = suggestRate;
  f('rate').oninput = () => { f('rate').dataset.touched = '1'; };
  await renderExtra();
  await suggestRate();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = { kind: f('kind').value, account_id: f('account_id').value, date: f('date').value, amount: parseNum(f('amount').value),
      rate: f('rate').disabled || !f('rate').value ? undefined : parseNum(f('rate').value), description: f('description').value };
    for (const n of ['invoice_id', 'company_id', 'supplier_id', 'category_id', 'user_id']) if (f(n)?.value && !f(n).closest('[hidden]')) d[n] = f(n).value;
    if (invoice) d.invoice_id = invoice.id;
    if (f('invoice_amount')?.value && !f('invoice_amount').closest('[hidden]')) d.invoice_amount = parseNum(f('invoice_amount').value);
    if (d.invoice_id) { delete d.company_id; delete d.supplier_id; }
    try {
      await api('POST', '/api/transactions', d);
      toast('Hareket kaydedildi');
      dlg.close();
      onSaved();
    } catch (err) { toast(err.message, true); }
  };
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

// ---------- Kasa / banka hareketleri ----------
const txFilter = { account_id: '', kind: '', from: `${today().slice(0, 7)}-01`, to: today() };

export async function tabTransactions(box) {
  let rows;
  let accounts;
  try {
    accounts = await api('GET', '/api/accounts');
    rows = await api('GET', `/api/transactions?${new URLSearchParams(Object.entries(txFilter).filter(([, v]) => v))}`);
  } catch (err) { return toast(err.message, true); }
  const ed = can('accounting.edit');
  box.innerHTML = `<div class="budget-cards" style="margin-bottom:18px">${accounts.filter((a) => a.active).map((a) => `<div class="budget-card">
      <div class="small">${a.type === 'cash' ? 'KASA' : 'BANKA'} · ${a.currency}</div><b>${esc(a.name)}</b>
      <div class="bc-row"><span>Bakiye</span><b>${money(a.balance, a.currency)}</b></div></div>`).join('') || '<div class="empty">Hesap yok.</div>'}</div>
    <section class="card">
      <div class="card-head"><h2>Hareketler</h2>${ed ? '<button type="button" data-new>+ Yeni hareket</button>' : ''}</div>
      <div class="filters">
        <label>Hesap<select data-f="account_id"><option value="">Tümü</option>${accounts.map((a) => opt(a.id, a.name, txFilter.account_id)).join('')}</select></label>
        <label>Tür<select data-f="kind"><option value="">Tümü</option>${Object.entries(KIND_LABELS).filter(([k]) => !PERSONNEL.includes(k) || can('salary.view')).map(([k, v]) => opt(k, v, txFilter.kind)).join('')}</select></label>
        <label>Başlangıç<input type="date" data-f="from" value="${txFilter.from}"></label><label>Bitiş<input type="date" data-f="to" value="${txFilter.to}"></label>
      </div>
      ${rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Tarih</th><th>Hesap</th><th>Tür</th><th>Cari / kişi / kategori</th><th>Açıklama</th><th class="num">Tutar</th><th class="num">TL</th><th></th></tr></thead>
        <tbody>${rows.map((t) => `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.account_name)}</td><td>${KIND_LABELS[t.kind]}</td>
          <td>${esc(t.company_name || t.supplier_name || t.user_name || t.category_name || '—')}${t.invoice_number ? `<div class="small"><a href="#/muhasebe/faturalar/${t.invoice_id}">${esc(t.invoice_number)}</a></div>` : ''}</td>
          <td class="small">${esc(t.description)}</td>
          <td class="num ${t.direction === 'out' ? 'neg' : 'pos'}">${t.direction === 'out' ? '−' : '+'}${money(t.amount, t.currency)}</td>
          <td class="num">${tl(t.amount_try)}</td>
          <td class="num">${ed ? `<button class="link danger" data-del="${t.id}">Sil</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Bu filtrede hareket yok.</div>'}
    </section>`;
  box.querySelectorAll('[data-f]').forEach((el) => { el.onchange = () => { txFilter[el.dataset.f] = el.value; tabTransactions(box); }; });
  const nw = $('[data-new]', box);
  if (nw) nw.onclick = () => openTransactionDialog({ onSaved: () => tabTransactions(box) });
  box.onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del || !confirm('Hareket silinsin mi? Bağlı faturanın bakiyesi yeniden açılır.')) return;
    try { await api('DELETE', `/api/transactions/${del.dataset.del}`); toast('Silindi'); tabTransactions(box); } catch (err) { toast(err.message, true); }
  };
}

// ---------- Personel: bordro ve personel carisi ----------
let payPeriod = addMonths(today().slice(0, 7), -1);
const PAY = [['gross', 'Brüt'], ['net', 'Net'], ['employee_sgk', 'SGK işçi'], ['employer_sgk', 'SGK işveren'], ['income_tax', 'Gelir v.'], ['stamp_tax', 'Damga v.']];

export async function tabPersonnel(box) {
  let payroll;
  let ledger;
  try { [payroll, ledger] = await Promise.all([api('GET', `/api/payroll?period=${payPeriod}`), api('GET', '/api/personnel-ledger')]); } catch (err) { return toast(err.message, true); }
  const ed = can('salary.edit');
  const ro = ed ? '' : 'disabled';
  box.innerHTML = `<section class="card">
      <div class="card-head"><h2>Bordro · ${monthLabel(payPeriod)}</h2>
        <div class="nav-date"><button type="button" class="secondary" data-prev>‹</button><button type="button" class="secondary" data-next>›</button></div></div>
      <p class="hint" style="margin:-6px 0 12px">Tutarlar muhasebecinin bordrosundan girilir; uygulama bordro hesaplamaz. Net maaş personele borç olarak, SGK ve vergiler devlete borç olarak kaydedilir.</p>
      <div class="table-wrap"><table class="items-table"><thead><tr><th>Personel</th>${PAY.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th></th></tr></thead>
        <tbody>${payroll.map((p) => `<tr data-user="${p.user_id}"><td><b>${esc(p.full_name)}</b><div class="small">${esc(p.title || '')}</div></td>
          ${PAY.map(([k]) => `<td><input class="num-in" name="${k}" value="${p[k] ?? ''}" inputmode="decimal" ${ro}></td>`).join('')}
          <td>${ed ? '<button type="button" class="secondary" data-save>Kaydet</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Personel carisi</h2>${can('accounting.edit') && ed ? `<div class="actions">
        <button type="button" class="secondary" data-pay="salary_payment">+ Maaş ödemesi</button><button type="button" class="secondary" data-pay="advance">+ Avans</button>
        <button type="button" class="secondary" data-pay="expense_refund">+ Masraf iadesi</button><button type="button" class="secondary" data-pay="sgk_payment">+ SGK ödemesi</button>
        <button type="button" class="secondary" data-pay="tax_payment">+ Vergi ödemesi</button></div>` : ''}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Personel</th><th class="num">Net maaş tahakkuku</th><th class="num">İade edilecek masraf</th><th class="num">Ödenen maaş</th>
          <th class="num">Avans</th><th class="num">İade edilen</th><th class="num">Bakiye</th></tr></thead>
        <tbody>${ledger.personnel.map((p) => `<tr><td><a href="#" data-person="${p.user_id}"><b>${esc(p.full_name)}</b></a>${p.missing_rate ? ' <span class="badge warn">kur eksik</span>' : ''}</td>
          <td class="num">${tl(p.salary_accrued)}</td><td class="num">${tl(p.refunds_owed)}</td><td class="num">${tl(p.salary_paid)}</td><td class="num">${tl(p.advances)}</td>
          <td class="num">${tl(p.refunds_paid)}</td><td class="num"><b class="${p.balance < 0 ? 'neg' : ''}">${tl(p.balance)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr class="total"><td>Toplam</td><td colspan="5"></td><td class="num">${tl(ledger.personnel.reduce((a, p) => a + p.balance, 0))}</td></tr></tfoot>
      </table></div>
      <p class="hint">Pozitif bakiye şirketin personele borcudur; negatif bakiye personelin şirkete borcudur (örneğin mahsup edilmemiş avans).</p>
      <div class="budget-cards" style="margin-top:12px">
        <div class="budget-card"><div class="small">DEVLETE BORÇ</div><div class="bc-row"><span>SGK (işçi + işveren)</span><b>${tl(ledger.state.sgk)}</b></div>
          <div class="bc-row"><span>Vergi (gelir + damga)</span><b>${tl(ledger.state.tax)}</b></div></div></div>
    </section>`;
  $('[data-prev]', box).onclick = () => { payPeriod = addMonths(payPeriod, -1); tabPersonnel(box); };
  $('[data-next]', box).onclick = () => { payPeriod = addMonths(payPeriod, 1); tabPersonnel(box); };
  box.onclick = async (e) => {
    const save = e.target.closest('[data-save]');
    const pay = e.target.closest('[data-pay]');
    const person = e.target.closest('[data-person]');
    if (save) {
      const tr = save.closest('[data-user]');
      const d = { user_id: tr.dataset.user, period: payPeriod };
      for (const [k] of PAY) d[k] = parseNum(tr.querySelector(`[name="${k}"]`).value);
      try { await api('PUT', '/api/payroll', d); toast('Bordro kaydedildi'); tabPersonnel(box); } catch (err) { toast(err.message, true); }
    } else if (pay) openTransactionDialog({ kind: pay.dataset.pay, onSaved: () => tabPersonnel(box) });
    else if (person) { e.preventDefault(); personLedger(Number(person.dataset.person)); }
  };
}

async function personLedger(userId) {
  let d;
  try { d = await api('GET', `/api/personnel-ledger/${userId}`); } catch (err) { return toast(err.message, true); }
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `<div class="modal-head"><h2>${esc(d.summary.full_name)} · cari</h2><button type="button" class="link" data-close aria-label="Kapat">✕</button></div>
    ${d.rows.length ? `<table><thead><tr><th>Tarih</th><th>İşlem</th><th>Ayrıntı</th><th class="num">Tutar</th><th class="num">Bakiye</th></tr></thead>
      <tbody>${d.rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.type)}${r.missing_rate ? ' <span class="badge warn">kur yok</span>' : ''}</td>
        <td class="small">${esc(r.detail || '')}</td><td class="num ${r.amount < 0 ? 'neg' : ''}">${tl(r.amount)}</td><td class="num"><b>${tl(r.balance)}</b></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Hareket yok.</div>'}`;
  document.body.append(dlg);
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

// ---------- Gelir–gider ve kategori bütçesi ----------
let pnlYear = today().slice(0, 4);
let budgetMonth = today().slice(0, 7);

export async function tabPnl(box) {
  let pnl;
  let budget;
  try { [pnl, budget] = await Promise.all([api('GET', `/api/accounting/pnl?year=${pnlYear}`), api('GET', `/api/accounting/budget?month=${budgetMonth}`)]); } catch (err) { return toast(err.message, true); }
  const ed = can('accounting.edit');
  const short = (m) => monthLabel(m).split(' ')[0].slice(0, 3);
  const used = new Set(pnl.months.flatMap((m) => Object.keys(m.categories).map(Number)));
  const catRows = (kind) => pnl.categories.filter((c) => c.kind === kind && used.has(c.id));
  const row = (c) => `<tr><td>${esc(c.name)}</td>${pnl.months.map((m) => `<td class="num">${m.categories[c.id] ? tl(m.categories[c.id]).replace(',00', '') : ''}</td>`).join('')}
    <td class="num"><b>${tl(pnl.months.reduce((a, m) => a + (m.categories[c.id] || 0), 0)).replace(',00', '')}</b></td></tr>`;
  box.innerHTML = `<section class="card">
      <div class="card-head"><h2>Gelir–gider tablosu · ${pnlYear}</h2>
        <div class="nav-date"><button type="button" class="secondary" data-y="-1">‹</button><button type="button" class="secondary" data-y="1">›</button></div></div>
      <p class="hint" style="margin:-6px 0 12px">Tahakkuk esaslı, TL: kesilen faturalar (fatura kuru), faturasız gelir/gider hareketleri ve bordro maliyeti (brüt + işveren SGK).</p>
      <div class="table-wrap"><table class="pnl"><thead><tr><th>Kategori</th>${pnl.months.map((m) => `<th class="num">${short(m.month)}</th>`).join('')}<th class="num">Yıl</th></tr></thead>
        <tbody>
          <tr class="customer"><td colspan="14">Gelirler</td></tr>${catRows('income').map(row).join('') || '<tr><td colspan="14" class="small">—</td></tr>'}
          <tr class="subtotal"><td>Toplam gelir</td>${pnl.months.map((m) => `<td class="num">${m.income ? tl(m.income).replace(',00', '') : ''}</td>`).join('')}<td class="num">${tl(pnl.totals.income)}</td></tr>
          <tr class="customer"><td colspan="14">Giderler</td></tr>${catRows('expense').map(row).join('') || '<tr><td colspan="14" class="small">—</td></tr>'}
          <tr class="subtotal"><td>Toplam gider</td>${pnl.months.map((m) => `<td class="num">${m.expense ? tl(m.expense).replace(',00', '') : ''}</td>`).join('')}<td class="num">${tl(pnl.totals.expense)}</td></tr>
        </tbody>
        <tfoot><tr class="total"><td>Net</td>${pnl.months.map((m) => `<td class="num ${m.net < 0 ? 'neg' : ''}">${m.net ? tl(m.net).replace(',00', '') : ''}</td>`).join('')}
          <td class="num ${pnl.totals.net < 0 ? 'neg' : ''}">${tl(pnl.totals.net)}</td></tr></tfoot></table></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Bütçe · ${monthLabel(budgetMonth)}</h2>
        <div class="nav-date"><button type="button" class="secondary" data-m="-1">‹</button><button type="button" class="secondary" data-m="1">›</button>
          ${ed ? `<button type="button" class="link" data-copy>${monthLabel(addMonths(budgetMonth, -1))} planını kopyala</button>` : ''}</div></div>
      ${budget.effort_forecast.some((e) => e.forecast) ? `<div class="notice">Efor bütçesine göre bu ayın beklenen hizmet geliri:
        ${budget.effort_forecast.filter((e) => e.forecast).map((e) => `${money(e.forecast, e.currency)}${e.currency !== 'TRY' && e.try ? ` (${tl(e.try)})` : ''}`).join(' · ')}</div>` : ''}
      <div class="table-wrap"><table class="items-table"><thead><tr><th>Kategori</th><th class="num">Plan (TL)</th><th class="num">Gerçekleşen</th><th class="num">Fark</th><th>Plana göre</th></tr></thead>
        <tbody>${['income', 'expense'].map((kind) => `<tr class="customer"><td colspan="5">${kind === 'income' ? 'Gelirler' : 'Giderler'}</td></tr>
          ${budget.rows.filter((r) => r.kind === kind).map((r) => `<tr><td>${esc(r.name)}</td>
            <td><input class="num-in" data-plan="${r.category_id}" value="${r.plan || ''}" inputmode="decimal" ${ed ? '' : 'disabled'}></td>
            <td class="num">${tl(r.actual)}</td><td class="num ${(kind === 'expense' ? r.diff > 0 : r.diff < 0) && r.plan ? 'neg' : ''}">${r.plan ? tl(r.diff) : '—'}</td>
            <td>${r.pct == null ? '' : `${Math.round(r.pct * 100)}%<div class="progress"><span style="width:${Math.min(100, Math.round(r.pct * 100))}%"></span></div>`}</td></tr>`).join('')}`).join('')}</tbody>
        <tfoot><tr class="total"><td>Gelir</td><td class="num">${tl(budget.totals.income_plan)}</td><td class="num">${tl(budget.totals.income_actual)}</td><td colspan="2"></td></tr>
          <tr class="total"><td>Gider</td><td class="num">${tl(budget.totals.expense_plan)}</td><td class="num">${tl(budget.totals.expense_actual)}</td><td colspan="2"></td></tr></tfoot>
      </table></div>
      ${ed ? '<p class="hint">Plan tutarını yazıp kutudan çıkınca kaydedilir.</p>' : ''}
    </section>`;
  box.querySelectorAll('[data-y]').forEach((b) => { b.onclick = () => { pnlYear = String(Number(pnlYear) + Number(b.dataset.y)); tabPnl(box); }; });
  box.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { budgetMonth = addMonths(budgetMonth, Number(b.dataset.m)); tabPnl(box); }; });
  box.querySelectorAll('[data-plan]').forEach((inp) => {
    inp.onchange = async () => {
      try { await api('PUT', '/api/accounting/budget', { month: budgetMonth, category_id: inp.dataset.plan, amount: parseNum(inp.value) }); toast('Plan kaydedildi'); tabPnl(box); } catch (err) { toast(err.message, true); }
    };
  });
  const copy = $('[data-copy]', box);
  if (copy) copy.onclick = async () => {
    try {
      const { copied } = await api('POST', '/api/accounting/budget/copy', { from_month: addMonths(budgetMonth, -1), to_month: budgetMonth });
      toast(copied ? `${copied} kalem kopyalandı` : 'Önceki ayda plan yok'); tabPnl(box);
    } catch (err) { toast(err.message, true); }
  };
}
