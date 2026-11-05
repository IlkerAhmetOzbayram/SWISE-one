// Faturalar: liste, aktivitelerden taslak, elle fatura (giden/gelen), ayrıntı (kes, iptal, ek, tahsilat/ödeme)
import { state, can, $, api, toast, esc, money, fmtDate, opt, today, addMonths, monthEnd, companyLabel, CURRENCY_LABELS } from '../core.js';
import { tl, parseNum } from './accounting.js';
import { openTransactionDialog } from './accounting-ledger.js';

const STATUS = {
  draft: ['Taslak', 'off'], cancelled: ['İptal', 'off'], open: ['Açık', 'warn'], partial: ['Kısmi ödendi', 'warn'], paid: ['Ödendi', 'ok'],
};
export const invoiceBadge = (i) => {
  if (i.overdue_days > 0) return `<span class="badge danger">${i.overdue_days} gün gecikmiş</span>`;
  const [label, cls] = STATUS[i.payment_status] || [i.payment_status, ''];
  return `<span class="badge ${cls}">${label}</span>`;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
let dir = 'out';
let statusFilter = '';

export function pageInvoices(box, sub) {
  if (sub === 'yeni-aktivite') return fromActivities(box);
  if (sub === 'yeni-giden') return editor(box, { direction: 'out' });
  if (sub === 'yeni-gelen') return editor(box, { direction: 'in' });
  if (sub) return detail(box, Number(sub));
  return list(box);
}

async function list(box) {
  let rows;
  try { rows = await api('GET', `/api/invoices?direction=${dir}${statusFilter ? `&payment_status=${statusFilter}` : ''}`); } catch (err) { return toast(err.message, true); }
  const ed = can('accounting.edit');
  box.innerHTML = `<section class="card">
    <div class="card-head"><div class="tabs"><a href="#" data-dir="out" class="${dir === 'out' ? 'active' : ''}">Giden faturalar</a>
        <a href="#" data-dir="in" class="${dir === 'in' ? 'active' : ''}">Gelen faturalar</a></div>
      ${ed ? `<div class="actions">${dir === 'out' ? '<a href="#/muhasebe/faturalar/yeni-aktivite"><button type="button">+ Aktivitelerden fatura</button></a><a href="#/muhasebe/faturalar/yeni-giden"><button type="button" class="secondary">+ Elle fatura</button></a>'
        : '<a href="#/muhasebe/faturalar/yeni-gelen"><button type="button">+ Gelen fatura</button></a>'}</div>` : ''}</div>
    <div class="filters"><label>Durum<select data-status><option value="">Tümü</option>${opt('open', 'Açık', statusFilter)}${opt('partial', 'Kısmi ödendi', statusFilter)}
      ${opt('overdue', 'Gecikmiş', statusFilter)}${opt('paid', 'Ödendi', statusFilter)}${opt('draft', 'Taslak', statusFilter)}${opt('cancelled', 'İptal', statusFilter)}</select></label></div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Tarih</th><th>Fatura no</th><th>${dir === 'out' ? 'Müşteri' : 'Tedarikçi'}</th><th>Açıklama</th><th class="num">Net</th>
        <th class="num">Kalan</th><th>Vade</th><th>Durum</th></tr></thead>
      <tbody>${rows.map((i) => `<tr class="${i.status === 'cancelled' ? 'muted' : ''}">
        <td>${fmtDate(i.issue_date)}</td><td><a href="#/muhasebe/faturalar/${i.id}"><b>${esc(i.number || 'Taslak')}</b></a></td>
        <td>${esc(dir === 'out' ? companyLabel(i.customer_name, i.company_name) : i.supplier_name)}</td>
        <td class="small">${esc(i.description)}</td><td class="num">${money(i.net, i.currency)}</td>
        <td class="num">${i.status === 'issued' ? money(i.outstanding, i.currency) : '—'}</td><td>${fmtDate(i.due_date)}</td><td>${invoiceBadge(i)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty">Fatura yok.</div>'}
    <p class="hint">Uygulama resmi e-fatura kesmez; e-fatura/e-arşiv numarasını faturayı keserken girersiniz.</p></section>`;
  box.querySelectorAll('[data-dir]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); dir = a.dataset.dir; list(box); }; });
  $('[data-status]', box).onchange = (e) => { statusFilter = e.target.value; list(box); };
}

const companyOptions = (selected) => state.companies.filter((c) => c.usable || String(c.id) === String(selected))
  .map((c) => opt(c.id, companyLabel(c.customer_name, c.name), selected)).join('');

async function fromActivities(box) {
  const lastMonth = addMonths(today().slice(0, 7), -1);
  box.innerHTML = `<a class="back" href="#/muhasebe/faturalar">← Faturalar</a>
    <section class="card"><h2>Aktivitelerden giden fatura</h2>
      <p class="hint" style="margin:-6px 0 14px">Seçilen dönemdeki <b>faturalanmamış</b> faturalanabilir aktiviteler (proje ve günlük ücrete göre gruplanır) ve
        müşteriye yansıtılacak <b>onaylı</b> masraflar taslak faturaya eklenir. Faturaya giren kayıtlar işaretlenir; tekrar faturalanmaz.</p>
      <form class="grid" data-form>
        <label class="wide">Müşteri / şirket<select name="company_id" required><option value="">Seçin…</option>${companyOptions()}</select></label>
        <label>Dönem başı<input type="date" name="from" value="${lastMonth}-01" required></label>
        <label>Dönem sonu<input type="date" name="to" value="${monthEnd(lastMonth)}" required></label>
        <label>Fatura tarihi<input type="date" name="issue_date" value="${today()}" required></label>
        <label class="check"><input type="checkbox" name="include_expenses" checked> Onaylı masrafları ekle</label>
        <div class="actions"><button type="submit">Taslak fatura oluştur</button></div>
      </form></section>`;
  $('[data-form]', box).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      const r = await api('POST', '/api/invoices/from-activities', { company_id: f.company_id.value, from: f.from.value, to: f.to.value,
        issue_date: f.issue_date.value, include_expenses: f.include_expenses.checked });
      toast(`Taslak oluşturuldu (${r.lines} kalem)${r.skipped_other_currency ? ` · farklı para birimindeki ${r.skipped_other_currency} grup dahil edilmedi` : ''}`);
      location.hash = `#/muhasebe/faturalar/${r.id}`;
    } catch (err) { toast(err.message, true); }
  };
}

// Elle fatura / taslak düzenleme
async function editor(box, inv) {
  let suppliers = [];
  let categories = [];
  try { [suppliers, categories] = await Promise.all([api('GET', '/api/suppliers'), api('GET', '/api/categories')]); } catch (err) { return toast(err.message, true); }
  const out = inv.direction === 'out';
  const isNew = !inv.id;
  const lines = (inv.lines || [{ description: '', quantity: 1, unit: out ? 'gün' : 'adet', unit_price: '', is_service: 1 }]).map((l) => ({ ...l }));
  const kind = out ? 'income' : 'expense';
  box.innerHTML = `<a class="back" href="#/muhasebe/faturalar${inv.id ? `/${inv.id}` : ''}">← ${inv.id ? 'Fatura' : 'Faturalar'}</a>
    <section class="card"><h2>${isNew ? (out ? 'Yeni giden fatura' : 'Yeni gelen fatura') : 'Taslak faturayı düzenle'}</h2>
      <form class="grid form-like" data-form>
        ${out ? `<label class="wide">Müşteri / şirket<select name="company_id" required><option value="">Seçin…</option>${companyOptions(inv.company_id)}</select></label>`
          : `<label class="wide">Tedarikçi<select name="supplier_id" required><option value="">Seçin…</option>${suppliers.filter((s) => s.active || s.id === inv.supplier_id).map((s) => opt(s.id, s.name, inv.supplier_id)).join('')}</select></label>`}
        <label class="wide">Kategori<select name="category_id"><option value="">Varsayılan</option>${categories.filter((c) => c.kind === kind && c.active).map((c) => opt(c.id, c.name, inv.category_id)).join('')}</select></label>
        <label>${out ? 'Fatura no (sonra da girilebilir)' : 'Belge no'}<input name="number"></label>
        <label>Fatura tarihi<input type="date" name="issue_date" required></label>
        <label>Vade tarihi<input type="date" name="due_date" placeholder="Cari vadesinden"></label>
        <label>Para birimi<select name="currency">${Object.entries(CURRENCY_LABELS).map(([k, v]) => opt(k, v, inv.currency || (out ? '' : 'TRY'))).join('')}</select></label>
        <label>Kur (TL)<input name="rate" inputmode="decimal" placeholder="Boş: TCMB kuru"></label>
        <label>KDV %<input name="vat_rate" inputmode="decimal" placeholder="Cariden"></label>
        <label>Stopaj %<input name="withholding_rate" inputmode="decimal" placeholder="Cariden"></label>
        <label class="full">Açıklama<input name="description"></label>
      </form>
      <h2 style="margin-top:18px">Kalemler</h2>
      <div class="table-wrap"><table class="items-table"><thead><tr><th>Açıklama</th><th class="num">Miktar</th><th>Birim</th><th class="num">Birim fiyat</th>
        <th>Hizmet</th><th class="num">Tutar</th><th></th></tr></thead><tbody data-lines></tbody></table></div>
      <div class="actions" style="margin-top:8px"><button type="button" class="secondary" data-add>+ Kalem ekle</button></div>
      <div class="totals" data-totals></div>
      <p class="hint">Stopaj yalnızca "hizmet" işaretli kalemlere uygulanır. KDV ve stopaj oranı boş bırakılırsa cariden (şirket/tedarikçi) gelir.</p>
      <div class="actions" style="margin-top:14px"><button type="button" data-save>${isNew ? 'Taslağı kaydet' : 'Kaydet'}</button></div>
    </section>
    ${out ? '' : '<p class="hint">Gelen faturanın PDF/XML ekini kaydettikten sonra fatura sayfasından yükleyebilirsiniz.</p>'}`;
  const form = $('[data-form]', box);
  const f = (n) => form.elements.namedItem(n);
  for (const k of ['number', 'issue_date', 'due_date', 'rate', 'vat_rate', 'withholding_rate', 'description']) f(k).value = inv[k] ?? '';
  if (!inv.issue_date) f('issue_date').value = today();
  if (isNew) { f('rate').value = ''; f('vat_rate').value = ''; f('withholding_rate').value = ''; }
  if (out && isNew) f('currency').value = 'TRY';

  const render = () => {
    $('[data-lines]', box).innerHTML = lines.map((l, i) => `<tr data-i="${i}">
      <td style="min-width:240px"><input data-k="description" value="${esc(l.description)}" placeholder="Açıklama"></td>
      <td><input data-k="quantity" class="num-in" value="${esc(l.quantity)}" inputmode="decimal"></td>
      <td><input data-k="unit" class="unit-in" value="${esc(l.unit)}"></td>
      <td><input data-k="unit_price" class="num-in" value="${esc(l.unit_price)}" inputmode="decimal"></td>
      <td style="text-align:center"><input type="checkbox" data-k="is_service" ${l.is_service ? 'checked' : ''}></td>
      <td class="num" data-total>${money(r2(parseNum(l.quantity) * parseNum(l.unit_price)), f('currency').value)}</td>
      <td><button type="button" class="link danger" data-del="${i}" aria-label="Kalemi sil">✕</button></td></tr>`).join('');
    totals();
  };
  const totals = () => {
    const sub = r2(lines.reduce((a, l) => a + parseNum(l.quantity) * parseNum(l.unit_price), 0));
    const vr = f('vat_rate').value === '' ? null : parseNum(f('vat_rate').value);
    $('[data-totals]', box).innerHTML = `<div class="tot-row"><span>Ara toplam</span><b>${money(sub, f('currency').value)}</b></div>
      ${vr === null ? '<div class="tot-row"><span>KDV / stopaj</span><b class="small">cari ayarına göre hesaplanacak</b></div>'
        : `<div class="tot-row grand"><span>KDV dahil</span><b>${money(r2(sub * (1 + vr / 100)), f('currency').value)}</b></div>`}`;
  };
  $('[data-lines]', box).addEventListener('input', (e) => {
    const tr = e.target.closest('[data-i]');
    if (!tr) return;
    const l = lines[Number(tr.dataset.i)];
    l[e.target.dataset.k] = e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value;
    tr.querySelector('[data-total]').textContent = money(r2(parseNum(l.quantity) * parseNum(l.unit_price)), f('currency').value);
    totals();
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) { lines.push({ description: '', quantity: 1, unit: 'adet', unit_price: '', is_service: out ? 1 : 0 }); render(); }
    const del = e.target.closest('[data-del]');
    if (del) { lines.splice(Number(del.dataset.del), 1); render(); }
  });
  form.addEventListener('change', totals);
  render();

  $('[data-save]', box).onclick = async () => {
    if (!form.reportValidity()) return;
    const d = Object.fromEntries([...form.elements].filter((el) => el.name).map((el) => [el.name, el.value]));
    for (const k of ['rate', 'vat_rate', 'withholding_rate']) d[k] = d[k] === '' ? undefined : parseNum(d[k]);
    if (!d.due_date) delete d.due_date;
    const payload = { ...d, direction: inv.direction, lines: lines.map((l) => ({ ...l, quantity: parseNum(l.quantity), unit_price: parseNum(l.unit_price) })) };
    try {
      if (isNew) {
        const r = await api('POST', '/api/invoices', payload);
        toast('Taslak kaydedildi');
        location.hash = `#/muhasebe/faturalar/${r.id}`;
      } else {
        await api('PUT', `/api/invoices/${inv.id}`, payload);
        toast('Kaydedildi');
        location.hash = `#/muhasebe/faturalar/${inv.id}`;
      }
    } catch (err) { toast(err.message, true); }
  };
}

async function detail(box, id) {
  let inv;
  try { inv = await api('GET', `/api/invoices/${id}`); } catch (err) { return toast(err.message, true); }
  const ed = can('accounting.edit');
  const out = inv.direction === 'out';
  const cur = inv.currency;
  box.innerHTML = `<a class="back" href="#/muhasebe/faturalar">← Faturalar</a>
    <div class="card-head" style="align-items:flex-start">
      <div><h2 style="font-size:22px;margin:0 0 4px">${out ? 'Giden' : 'Gelen'} fatura ${esc(inv.number || '(taslak)')}</h2>
        <div>${invoiceBadge(inv)} <span class="small">${esc(inv.party_name)}${inv.category_name ? ` · ${esc(inv.category_name)}` : ''}</span></div></div>
      <div class="actions">${ed ? [
        inv.status === 'draft' ? '<button type="button" class="secondary" data-act="edit">Düzenle</button><button type="button" class="link danger" data-act="delete">Sil</button><button type="button" data-act="issue">Faturayı kes</button>' : '',
        inv.status === 'issued' && inv.outstanding > 0 ? `<button type="button" data-act="pay">${out ? '+ Tahsilat' : '+ Ödeme'}</button>` : '',
        inv.status === 'issued' && !inv.payments.length ? '<button type="button" class="link danger" data-act="cancel">İptal et</button>' : '',
        '<button type="button" class="secondary" data-act="attach">Ek yükle</button>',
      ].join('') : ''}</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Net (${out ? 'tahsil edilecek' : 'ödenecek'})</div><div class="value">${money(inv.net, cur)}</div>
        ${cur !== 'TRY' ? `<div class="small">kur ${inv.rate} · ${tl(inv.net * inv.rate)}</div>` : ''}</div>
      <div class="stat"><div class="label">${out ? 'Tahsil edilen' : 'Ödenen'}</div><div class="value">${money(inv.paid, cur)}</div></div>
      <div class="stat"><div class="label">Kalan</div><div class="value ${inv.outstanding > 0 ? '' : ''}">${money(inv.outstanding, cur)}</div></div>
      <div class="stat"><div class="label">Tarih / vade</div><div class="value" style="font-size:16px">${fmtDate(inv.issue_date)} → ${fmtDate(inv.due_date)}</div></div>
    </div>
    <section class="card"><h2>Kalemler</h2>
      <div class="table-wrap"><table><thead><tr><th>Açıklama</th><th class="num">Miktar</th><th>Birim</th><th class="num">Birim fiyat</th><th class="num">Tutar</th></tr></thead>
        <tbody>${inv.lines.map((l) => `<tr><td>${esc(l.description)}${l.is_service ? '' : ' <span class="badge off">masraf</span>'}</td><td class="num">${l.quantity}</td>
          <td>${esc(l.unit)}</td><td class="num">${money(l.unit_price, cur)}</td><td class="num">${money(l.line_total, cur)}</td></tr>`).join('')}</tbody></table></div>
      <div class="totals">
        <div class="tot-row"><span>Ara toplam</span><b>${money(inv.subtotal, cur)}</b></div>
        <div class="tot-row"><span>KDV (%${inv.vat_rate})</span><b>${money(inv.vat, cur)}</b></div>
        <div class="tot-row"><span>Toplam</span><b>${money(inv.total, cur)}</b></div>
        ${inv.withholding ? `<div class="tot-row"><span>Stopaj (%${inv.withholding_rate})</span><b>−${money(inv.withholding, cur)}</b></div>` : ''}
        <div class="tot-row grand"><span>Net</span><b>${money(inv.net, cur)}</b></div>
      </div>
      ${inv.linked_activities || inv.linked_expenses ? `<p class="hint">Bu faturaya ${inv.linked_activities} aktivite ve ${inv.linked_expenses} masraf bağlı; silinir veya iptal edilirse kayıtlar yeniden faturalanabilir olur.</p>` : ''}
      ${inv.attachment_name ? `<p class="hint">Ek: <a href="/api/invoices/${inv.id}/attachment">${esc(inv.attachment_name)}</a></p>` : ''}
    </section>
    <section class="card"><h2>${out ? 'Tahsilatlar' : 'Ödemeler'}</h2>
      ${inv.payments.length ? `<table><thead><tr><th>Tarih</th><th>Hesap</th><th class="num">Tutar</th><th class="num">Faturadan düşülen</th><th>Açıklama</th></tr></thead>
        <tbody>${inv.payments.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.account_name)}</td><td class="num">${money(p.amount, p.account_currency)}</td>
          <td class="num">${money(p.invoice_amount, cur)}</td><td>${esc(p.description)}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">Henüz ${out ? 'tahsilat' : 'ödeme'} yok.</div>`}
    </section>`;

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.pdf,.xml,.jpg,.jpeg,.png,.zip';
  file.hidden = true;
  box.append(file);
  file.onchange = async () => {
    const fl = file.files[0];
    if (!fl) return;
    try {
      const res = await fetch(`/api/invoices/${inv.id}/attachment`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(fl.name) }, body: fl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Yükleme başarısız');
      toast('Ek yüklendi');
      detail(box, inv.id);
    } catch (err) { toast(err.message, true); }
  };

  box.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    try {
      if (act === 'edit') return editor(box, inv);
      if (act === 'attach') return file.click();
      if (act === 'pay') return openTransactionDialog({ kind: out ? 'collection' : 'payment', invoice: inv, onSaved: () => detail(box, inv.id) });
      if (act === 'issue') {
        const number = prompt(out ? 'E-fatura / e-arşiv numarası:' : 'Tedarikçinin fatura (belge) numarası:', inv.number || '');
        if (!number) return;
        await api('POST', `/api/invoices/${inv.id}/issue`, { number });
        toast('Fatura kesildi');
      }
      if (act === 'cancel') {
        if (!confirm('Fatura iptal edilsin mi? Bağlı aktivite ve masraflar yeniden faturalanabilir olur.')) return;
        await api('POST', `/api/invoices/${inv.id}/cancel`, {});
        toast('Fatura iptal edildi');
      }
      if (act === 'delete') {
        if (!confirm('Taslak fatura silinsin mi?')) return;
        await api('DELETE', `/api/invoices/${inv.id}`);
        toast('Silindi');
        location.hash = '#/muhasebe/faturalar';
        return;
      }
      detail(box, inv.id);
    } catch (err) { toast(err.message, true); }
  };
}
