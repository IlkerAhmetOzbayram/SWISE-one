// Muhasebe (#/muhasebe/<sekme>[/<id>]): özet, faturalar, hareketler, cariler, personel, gelir–gider, tanımlar
import { can, $, main, api, toast, esc, money, fmtDate, opt, today, addMonths, monthLabel, CURRENCY_LABELS } from '../core.js';
import { adminCrud } from '../components/admin-crud.js';
import { pageInvoices } from './accounting-invoices.js';
import { tabTransactions, tabPersonnel, tabPnl } from './accounting-ledger.js';

export const tl = (n) => money(n, 'TRY');
export const parseNum = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
};

const TABS = [
  { id: 'ozet', title: 'Özet', allowed: () => can('accounting.view'), render: tabSummary },
  { id: 'faturalar', title: 'Faturalar', allowed: () => can('accounting.view'), render: pageInvoices },
  { id: 'hareketler', title: 'Kasa / banka', allowed: () => can('accounting.view'), render: tabTransactions },
  { id: 'cariler', title: 'Cariler ve nakit akışı', allowed: () => can('accounting.view'), render: tabAging },
  { id: 'personel', title: 'Personel ve bordro', allowed: () => can('salary.view'), render: tabPersonnel },
  { id: 'gelir-gider', title: 'Gelir–gider ve bütçe', allowed: () => can('accounting.view'), render: tabPnl },
  { id: 'tanimlar', title: 'Tanımlar ve kurlar', allowed: () => can('accounting.view'), render: tabSetup },
];

export function pageAccounting(param, sub) {
  const tabs = TABS.filter((t) => t.allowed());
  const tab = tabs.find((t) => t.id === param) || tabs[0];
  main.innerHTML = `<h1>Muhasebe</h1>
    <div class="tabs tabs-wrap" style="margin-bottom:18px">${tabs.map((t) => `<a href="#/muhasebe/${t.id}" class="${t === tab ? 'active' : ''}">${t.title}</a>`).join('')}</div>
    <div data-acc><div class="empty">Yükleniyor…</div></div>`;
  tab.render($('[data-acc]'), sub);
}

// ---------- Özet ----------
async function tabSummary(box) {
  let s;
  try { s = await api('GET', '/api/accounting/summary'); } catch (err) { return toast(err.message, true); }
  const stat = (label, value, sub, hl) => `<div class="stat${hl ? ' hl' : ''}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="small">${sub}</div>` : ''}</div>`;
  let exportMonth = today().slice(0, 7);
  box.innerHTML = `
    <div class="stats">
      ${stat('Kasa ve banka (TL)', tl(s.cash_try), `${s.accounts.length} hesap`, true)}
      ${stat('Alacaklar', tl(s.receivables_try), s.receivables_overdue_try ? `<span class="neg">vadesi geçen ${tl(s.receivables_overdue_try)}</span>` : 'vadesi geçen yok')}
      ${stat('Borçlar', tl(s.payables_try), s.payables_overdue_try ? `<span class="neg">vadesi geçen ${tl(s.payables_overdue_try)}</span>` : 'vadesi geçen yok')}
      ${stat('Bu ay net', tl(s.month.net), `gelir ${tl(s.month.income)} · gider ${tl(s.month.expense)}`)}
    </div>
    ${s.unbilled_activities ? `<div class="notice">${s.unbilled_activities} faturalanabilir aktivite henüz faturalanmadı. <a href="#/muhasebe/faturalar/yeni-aktivite">Aktivitelerden fatura oluştur →</a></div>` : ''}
    <div class="split">
      <section class="card"><div class="card-head"><h2>Hesaplar</h2><a href="#/muhasebe/tanimlar">Hesap ekle →</a></div>
        ${s.accounts.length ? `<table><thead><tr><th>Hesap</th><th class="num">Bakiye</th><th class="num">TL karşılığı</th></tr></thead>
          <tbody>${s.accounts.map((a) => `<tr><td><b>${esc(a.name)}</b><div class="small">${a.type === 'cash' ? 'Kasa' : 'Banka'} · ${a.currency}</div></td>
            <td class="num">${money(a.balance, a.currency)}</td><td class="num">${a.balance_try == null ? '<span class="small">kur yok</span>' : tl(a.balance_try)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Henüz hesap yok. Önce Tanımlar sekmesinden kasa/banka hesabı ekleyin.</div>'}
      </section>
      <section class="card"><h2>Personel ve devlet</h2>
        ${s.state ? `<table><tbody>
          <tr><td>Personele borç (net maaş + masraf iadesi − ödemeler)</td><td class="num"><b>${tl(s.personnel_balance_try)}</b></td></tr>
          <tr><td>SGK borcu</td><td class="num"><b>${tl(s.state.sgk)}</b></td></tr>
          <tr><td>Vergi borcu (gelir + damga)</td><td class="num"><b>${tl(s.state.tax)}</b></td></tr></tbody></table>
          <p class="hint"><a href="#/muhasebe/personel">Bordro ve personel carisi →</a></p>`
          : '<div class="empty">Bu bilgiler için maaş görme yetkisi gerekir.</div>'}
        <h2 style="margin-top:18px">Muhasebeci için aylık Excel</h2>
        <div class="nav-date"><button type="button" class="secondary" data-ex-prev>‹</button><button type="button" class="secondary" data-ex-next>›</button>
          <b data-ex-label>${monthLabel(exportMonth)}</b><button type="button" data-ex>Excel indir</button></div>
        <p class="hint">Faturalar, kasa/banka hareketleri${s.state ? ' ve bordro' : ''} sayfalarını içerir.</p>
      </section>
    </div>`;
  const label = () => { $('[data-ex-label]', box).textContent = monthLabel(exportMonth); };
  $('[data-ex-prev]', box).onclick = () => { exportMonth = addMonths(exportMonth, -1); label(); };
  $('[data-ex-next]', box).onclick = () => { exportMonth = addMonths(exportMonth, 1); label(); };
  $('[data-ex]', box).onclick = () => { location.href = `/api/accounting/export.xlsx?month=${exportMonth}`; };
}

// ---------- Cariler (yaşlandırma) ve nakit akışı ----------
let agingDir = 'out';
async function tabAging(box) {
  let aging;
  let cash;
  try {
    [aging, cash] = await Promise.all([api('GET', `/api/accounting/aging?direction=${agingDir}`), api('GET', '/api/accounting/cashflow?days=84')]);
  } catch (err) { return toast(err.message, true); }
  box.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>${agingDir === 'out' ? 'Alacaklar (müşteriler)' : 'Borçlar (tedarikçiler)'}</h2>
        <div class="tabs"><a href="#" data-dir="out" class="${agingDir === 'out' ? 'active' : ''}">Alacaklar</a><a href="#" data-dir="in" class="${agingDir === 'in' ? 'active' : ''}">Borçlar</a></div></div>
      ${aging.rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Cari</th><th>Döviz bakiyesi</th>${aging.buckets.map((b) => `<th class="num">${b.label}</th>`).join('')}<th class="num">Toplam (TL)</th></tr></thead>
        <tbody>${aging.rows.map((r) => `<tr><td><b>${esc(r.party)}</b><div class="small">${r.invoices.length} açık fatura</div></td>
          <td class="small">${Object.entries(r.currencies).map(([c, v]) => money(v, c)).join('<br>')}</td>
          ${aging.buckets.map((b) => `<td class="num ${b.key !== 'current' && r[b.key] ? 'neg' : ''}">${r[b.key] ? tl(r[b.key]) : '—'}</td>`).join('')}
          <td class="num"><b>${tl(r.total_try)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr class="total"><td colspan="2">Toplam</td>${aging.buckets.map((b) => `<td class="num">${tl(aging.totals[b.key])}</td>`).join('')}<td class="num">${tl(aging.totals.total_try)}</td></tr></tfoot>
      </table></div>` : `<div class="empty">Açık ${agingDir === 'out' ? 'alacak' : 'borç'} yok.</div>`}
      <p class="hint">Gün grupları vade tarihinden bugüne geçen süreye göredir. Dövizli faturalar fatura kuruyla TL'ye çevrilir.</p>
    </section>
    <section class="card"><h2>Nakit akışı (12 hafta)</h2>
      <p class="hint" style="margin:-6px 0 12px">Bugünkü kasa/banka toplamı ${tl(cash.cash_try)}; açık faturaların vade tarihlerine göre beklenen giriş ve çıkışlar. Vadesi geçmişler ilk haftaya eklenir.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Hafta</th><th class="num">Beklenen tahsilat</th><th class="num">Beklenen ödeme</th><th class="num">Tahmini bakiye</th></tr></thead>
        <tbody>${cash.weeks.map((w) => `<tr><td>${fmtDate(w.week_start)}</td><td class="num">${w.inflow ? tl(w.inflow) : '—'}</td>
          <td class="num">${w.outflow ? tl(w.outflow) : '—'}</td><td class="num ${w.balance < 0 ? 'neg' : ''}"><b>${tl(w.balance)}</b></td></tr>`).join('')}</tbody>
      </table></div>
      ${cash.items.length ? `<h2 style="margin-top:18px">Vadesi gelen / yaklaşan faturalar</h2><div class="table-wrap"><table>
        <thead><tr><th>Vade</th><th>Cari</th><th>Fatura</th><th class="num">Kalan</th><th class="num">TL</th></tr></thead>
        <tbody>${cash.items.map((i) => `<tr class="${i.overdue ? 'warn' : ''}"><td>${fmtDate(i.due_date)}${i.overdue ? ' <span class="badge danger">gecikmiş</span>' : ''}</td>
          <td>${i.direction === 'out' ? '⬇' : '⬆'} ${esc(i.party)}</td><td><a href="#/muhasebe/faturalar/${i.id}">${esc(i.number || 'taslak')}</a></td>
          <td class="num">${money(i.outstanding, i.currency)}</td><td class="num ${i.direction === 'in' ? 'neg' : ''}">${i.direction === 'in' ? '−' : ''}${tl(i.amount_try)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </section>`;
  box.querySelectorAll('[data-dir]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); agingDir = a.dataset.dir; tabAging(box); }; });
}

// ---------- Tanımlar ve kurlar ----------
async function tabSetup(box) {
  let accounts;
  let suppliers;
  let categories;
  let rates;
  try {
    [accounts, suppliers, categories, rates] = await Promise.all(['/api/accounts', '/api/suppliers', '/api/categories', '/api/rates?limit=20'].map((u) => api('GET', u)));
  } catch (err) { return toast(err.message, true); }
  const ro = !can('accounting.edit');
  box.innerHTML = `<section class="card"><div class="card-head"><h2>Döviz kurları (TCMB)</h2>
      ${ro ? '' : '<button type="button" class="secondary" data-refresh>TCMB\'den güncelle</button>'}</div>
      <p class="hint" style="margin:-6px 0 12px">Kurlar sunucu açılışında ve 6 saatte bir TCMB'den otomatik çekilir. Bir tarihin kuru yoksa o tarihten önceki en yakın kur kullanılır.</p>
      <div class="split"><div>${rates.length ? `<table><thead><tr><th>Tarih</th><th>Döviz</th><th class="num">Alış</th><th class="num">Satış</th><th>Kaynak</th></tr></thead>
        <tbody>${rates.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${r.currency}</td><td class="num">${r.buying.toLocaleString('tr-TR', { minimumFractionDigits: 4 })}</td>
          <td class="num">${r.selling.toLocaleString('tr-TR', { minimumFractionDigits: 4 })}</td><td class="small">${r.source === 'manual' ? 'Elle' : 'TCMB'}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Henüz kur yok.</div>'}</div>
      ${ro ? '' : `<form class="grid" data-rate style="align-content:start">
        <h3 class="full form-section" style="border:none;margin:0;padding:0">Elle kur girişi</h3>
        <label>Tarih<input type="date" name="date" value="${today()}" required></label>
        <label>Döviz<select name="currency">${opt('EUR', 'EUR')}${opt('USD', 'USD')}</select></label>
        <label>Alış<input name="buying" inputmode="decimal" required></label><label>Satış<input name="selling" inputmode="decimal"></label>
        <div class="actions"><button type="submit" class="secondary">Kuru kaydet</button></div></form>`}</div>
    </section>
    <div data-accounts></div><div data-suppliers></div><div data-categories></div>`;

  const reload = () => tabSetup(box);
  if (!ro) {
    $('[data-refresh]', box).onclick = async () => {
      try { const r = await api('POST', '/api/rates/refresh', {}); toast(`TCMB kurları alındı (${fmtDate(r.date)})`); reload(); } catch (err) { toast(err.message, true); }
    };
    $('[data-rate]', box).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      try {
        await api('POST', '/api/rates', { date: f.date.value, currency: f.currency.value, buying: parseNum(f.buying.value), selling: parseNum(f.selling.value || f.buying.value) });
        toast('Kur kaydedildi');
        reload();
      } catch (err) { toast(err.message, true); }
    };
  }

  adminCrud($('[data-accounts]', box), {
    compact: true, readOnly: ro, listTitle: 'Kasa ve banka hesapları', newTitle: 'Yeni hesap', editTitle: 'Hesabı düzenle', addLabel: 'Hesap ekle',
    emptyText: 'Hesap yok.', endpoint: '/api/accounts', rows: () => accounts, onSaved: reload,
    fields: () => `<label class="wide">Hesap adı<input name="name" required placeholder="Örn. İş Bankası TL"></label>
      <label>Tür<select name="type"><option value="bank">Banka</option><option value="cash">Kasa</option></select></label>
      <label>Para birimi<select name="currency">${Object.entries(CURRENCY_LABELS).map(([k, v]) => opt(k, v)).join('')}</select></label>
      <label class="wide">IBAN<input name="iban" class="masked"></label>
      <label>Açılış bakiyesi<input name="opening_balance" inputmode="decimal" value="0"></label>
      <label>Açılış tarihi<input type="date" name="opening_date" value="${today()}"></label>
      <label class="check"><input type="checkbox" name="active"> Aktif</label>`,
    defaults: (f) => { f.elements.namedItem('active').checked = true; },
    toPayload: (d) => ({ ...d, opening_balance: parseNum(d.opening_balance) }),
    columns: [
      { h: 'Hesap', v: (r) => `<b>${esc(r.name)}</b><div class="small">${r.type === 'cash' ? 'Kasa' : 'Banka'}${r.iban ? ` · ${esc(r.iban)}` : ''}</div>` },
      { h: 'Para birimi', v: (r) => r.currency },
      { h: 'Bakiye', cls: 'num', v: (r) => money(r.balance, r.currency) },
    ],
  });

  adminCrud($('[data-suppliers]', box), {
    compact: true, readOnly: ro, listTitle: 'Tedarikçiler', newTitle: 'Yeni tedarikçi', editTitle: 'Tedarikçiyi düzenle', addLabel: 'Tedarikçi ekle',
    emptyText: 'Tedarikçi yok.', endpoint: '/api/suppliers', rows: () => suppliers, onSaved: reload,
    fields: () => `<label class="wide">Unvan<input name="name" required></label>
      <label>VKN / TCKN<input name="tax_no" maxlength="11"></label><label>Vergi dairesi<input name="tax_office"></label>
      <label class="full">Adres<input name="address"></label>
      <label class="wide">E-posta<input type="email" name="email"></label><label>Telefon<input name="phone"></label>
      <label>Vade (gün)<input name="payment_days" inputmode="numeric" value="30"></label>
      <label class="wide">Not<input name="notes"></label><label class="check"><input type="checkbox" name="active"> Aktif</label>`,
    defaults: (f) => { f.elements.namedItem('active').checked = true; },
    columns: [
      { h: 'Tedarikçi', v: (r) => `<b>${esc(r.name)}</b>${r.tax_no ? `<div class="small">VKN ${esc(r.tax_no)}</div>` : ''}` },
      { h: 'Vade', cls: 'num', v: (r) => `${r.payment_days} gün` },
      { h: 'İletişim', v: (r) => esc([r.email, r.phone].filter(Boolean).join(' · ') || '—') },
    ],
  });

  adminCrud($('[data-categories]', box), {
    compact: true, readOnly: ro, listTitle: 'Gelir ve gider kategorileri', newTitle: 'Yeni kategori', editTitle: 'Kategoriyi düzenle', addLabel: 'Kategori ekle',
    emptyText: 'Kategori yok.', endpoint: '/api/categories', rows: () => categories, onSaved: reload,
    fields: () => `<label>Tür<select name="kind"><option value="expense">Gider</option><option value="income">Gelir</option></select></label>
      <label class="wide">Ad<input name="name" required></label><label class="check"><input type="checkbox" name="active"> Aktif</label>`,
    defaults: (f) => { f.elements.namedItem('active').checked = true; },
    columns: [{ h: 'Kategori', v: (r) => esc(r.name) }, { h: 'Tür', v: (r) => (r.kind === 'income' ? '<span class="badge ok">Gelir</span>' : '<span class="badge">Gider</span>') }],
  });
}
