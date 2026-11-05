// Teklifler: liste (#/teklifler), yeni (#/teklifler/yeni), ayrıntı/düzenleme (#/teklifler/:id)
import { state, can, $, main, api, toast, esc, money, fmtDate, fmtDateTime, opt, today, companyLabel, currencyOptions, CURRENCY_LABELS } from '../core.js';

export const OFFER_STATUS = {
  draft: ['Taslak', 'off'],
  pending_approval: ['Onay bekliyor', 'warn'],
  approved: ['Onaylandı', ''],
  signed: ['İmzalandı', ''],
  sent: ['Gönderildi', 'cur'],
  accepted: ['Kabul edildi', 'ok'],
  rejected: ['Reddedildi', 'danger'],
};
export const offerBadge = (o) => {
  if (o.expired) return '<span class="badge danger">Süresi doldu</span>';
  const [label, cls] = OFFER_STATUS[o.status] || [o.status, ''];
  return `<span class="badge ${cls}">${label}</span>`;
};
const STEPS = ['draft', 'pending_approval', 'approved', 'signed', 'sent', 'accepted'];
const KINDS = { service: 'Danışmanlık', fixed: 'Sabit ücret', license: 'Lisans / masraf' };
const DEFAULT_UNIT = { tr: { service: 'gün', fixed: 'adet', license: 'adet' }, en: { service: 'day', fixed: 'item', license: 'item' } };

// "1.234,56" → 1234.56 ; "12.5" → 12.5
const parseNum = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

let listFilter = { status: '', customer_id: '' };

export function pageOffers(param) {
  if (param === 'yeni') return pageOffer(null);
  if (param) return pageOffer(Number(param));
  return pageOfferList();
}

async function pageOfferList() {
  main.innerHTML = `<div class="card-head"><h1 style="margin:0">Teklifler</h1>
      ${can('offers.edit') ? '<a href="#/teklifler/yeni"><button type="button">+ Yeni teklif</button></a>' : ''}</div>
    <section class="card">
      <div class="filters">
        <label>Durum<select data-f="status"><option value="">Tümü</option>${Object.entries(OFFER_STATUS).map(([k, [l]]) => opt(k, l, listFilter.status)).join('')}</select></label>
        <label>Müşteri<select data-f="customer_id"><option value="">Tümü</option>${state.customers.map((c) => opt(c.id, c.name, listFilter.customer_id)).join('')}</select></label>
      </div>
      <div class="table-wrap" data-list><div class="empty">Yükleniyor…</div></div>
    </section>`;
  main.querySelectorAll('[data-f]').forEach((el) => { el.onchange = () => { listFilter[el.dataset.f] = el.value; load(); }; });
  async function load() {
    let rows;
    try { rows = await api('GET', `/api/offers?${new URLSearchParams(Object.entries(listFilter).filter(([, v]) => v))}`); } catch (err) { return toast(err.message, true); }
    $('[data-list]').innerHTML = rows.length ? `<table>
      <thead><tr><th>Teklif no</th><th>Konu</th><th>Müşteri</th><th>Tarih</th><th>Geçerlilik</th><th class="num">Tutar (KDV dahil)</th><th>Durum</th></tr></thead>
      <tbody>${rows.map((o) => `<tr>
        <td><a href="#/teklifler/${o.id}"><b>${esc(o.number)}</b></a><div class="small">Rev.${o.revision} · ${o.language.toUpperCase()}</div></td>
        <td>${esc(o.title)}<div class="small">${esc(o.created_by_name)}</div></td>
        <td>${esc(companyLabel(o.customer_name, o.company_name))}</td>
        <td>${fmtDate(o.offer_date)}</td><td>${fmtDate(o.valid_until)}</td>
        <td class="num">${money(o.total, o.currency)}</td><td>${offerBadge(o)}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">Teklif yok.${can('offers.edit') ? ' “+ Yeni teklif” ile başlayın.' : ''}</div>`;
  }
  load();
}

// ---------- Ayrıntı / düzenleyici ----------
async function pageOffer(id) {
  let o = null;
  try {
    if (id) o = await api('GET', `/api/offers/${id}`);
  } catch (err) { return toast(err.message, true); }
  const isNew = !o;
  const editable = isNew || (o.status === 'draft' && can('offers.edit'));
  const items = o ? o.items.map((i) => ({ ...i })) : [];
  const payments = o ? o.payments.map((p) => ({ ...p })) : [];
  let defaults = {};
  // Müşteri seçimi: kullanılabilir şirketi olan müşteriler (+ teklifin müşterisi)
  const customerIds = new Set(state.companies.filter((c) => c.usable).map((c) => c.customer_id));
  if (o) customerIds.add(o.customer_id);

  main.innerHTML = `<a class="back" href="#/teklifler">← Teklifler</a>
    <div class="card-head" style="align-items:flex-start">
      <div><h1 style="margin:0 0 4px">${o ? `${esc(o.number)} <span class="small">Rev.${o.revision}</span>` : 'Yeni teklif'}</h1>
        ${o ? `<div>${offerBadge(o)} <span class="small">Hazırlayan: ${esc(o.created_by_name)}${o.approved_by_name ? ` · Onaylayan: ${esc(o.approved_by_name)}` : ''}</span></div>` : ''}</div>
      <div class="actions" data-actions></div>
    </div>
    ${o ? stepper(o) : ''}
    ${o?.status === 'draft' && o.review_note ? `<div class="notice danger">Onaydan geri gönderildi: “${esc(o.review_note)}”</div>` : ''}
    ${o?.decision_note ? `<div class="notice">Müşteri kararı notu: ${esc(o.decision_note)}</div>` : ''}
    <form data-offer>
      <section class="card"><h2>Teklif bilgileri</h2>
        <div class="grid form-like">
          <label class="wide">Müşteri<select name="_customer" required><option value="">Seçin…</option>${state.customers.filter((c) => customerIds.has(c.id)).map((c) => opt(c.id, c.name, o?.customer_id)).join('')}</select></label>
          <label class="wide" data-company-wrap>Şirket<select name="company_id" required></select></label>
          <label class="wide">İlgili kişi<select name="contact_id"><option value="">—</option></select></label>
          <label>Dil<select name="language">${opt('tr', 'Türkçe', o?.language || 'tr')}${opt('en', 'English', o?.language)}</select></label>
          <label>Para birimi<select name="currency">${currencyOptions(o?.currency || 'TRY')}</select></label>
          <label class="full">Konu<input name="title" required placeholder="Örn. Enerji izleme platformu danışmanlığı"></label>
          <label>Teklif tarihi<input type="date" name="offer_date"></label>
          <label>Geçerlilik (gün)<input name="valid_days" inputmode="numeric"></label>
          <label>Ödeme vadesi (gün)<input name="payment_days" inputmode="numeric"></label>
          <span></span>
          <label class="full">Giriş metni<textarea name="intro" rows="3"></textarea></label>
          <label class="full">Kapsam ve iş tanımı<textarea name="scope" rows="5" placeholder="Yapılacak işlerin açıklaması"></textarea></label>
        </div>
      </section>
      <section class="card"><div class="card-head"><h2>Kalemler</h2>
          ${editable ? `<div class="actions">${Object.entries(KINDS).map(([k, l]) => `<button type="button" class="secondary" data-add-item="${k}">+ ${l}</button>`).join('')}</div>` : ''}</div>
        <div class="table-wrap"><table class="items-table"><thead><tr><th>Tür</th><th>Açıklama</th><th class="num">Miktar</th><th>Birim</th>
          <th class="num">Birim fiyat</th><th class="num">İskonto %</th><th class="num">Tutar</th><th></th></tr></thead><tbody data-items></tbody></table></div>
        <div class="totals" data-totals></div>
      </section>
      <section class="card"><div class="card-head"><h2>Ödeme planı</h2>
          ${editable ? `<div class="actions"><button type="button" class="secondary" data-pay="single">Tek ödeme</button>
            <button type="button" class="secondary" data-pay="half">%50 / %50</button><button type="button" class="secondary" data-pay="add">+ Ödeme ekle</button></div>` : ''}</div>
        <div class="table-wrap"><table><thead><tr><th>Açıklama</th><th>Vade</th><th class="num">Tutar</th><th></th></tr></thead><tbody data-payments></tbody></table></div>
        <div data-pay-check></div>
      </section>
      <section class="card"><h2>Varsayımlar, şartlar ve notlar</h2>
        <div class="grid form-like">
          <label class="full">Varsayımlar ve hariç tutulanlar<textarea name="assumptions" rows="4"></textarea></label>
          <label class="full">Şartlar<textarea name="terms" rows="4"></textarea></label>
          <label class="full">İç notlar <span class="small">(PDF'e girmez)</span><textarea name="internal_notes" rows="2"></textarea></label>
        </div>
      </section>
    </form>
    ${o ? `<section class="card"><h2>Sürümler ve dosyalar</h2><div data-versions></div></section>` : ''}`;

  const form = $('[data-offer]');
  const f = (n) => form.elements.namedItem(n);
  const lang = () => f('language').value;

  // ---- müşteri / şirket / kişi seçimleri ----
  const fillCompanies = (selected) => {
    const cid = Number(f('_customer').value);
    const list = state.companies.filter((c) => c.customer_id === cid && (c.usable || c.id === o?.company_id));
    f('company_id').innerHTML = list.map((c) => opt(c.id, c.name, selected ?? list[0]?.id)).join('');
    form.querySelector('[data-company-wrap]').hidden = list.length <= 1;
  };
  const loadDefaults = async (applyCompanyDefaults) => {
    if (!f('company_id').value || !can('offers.edit')) return;
    try {
      defaults = await api('GET', `/api/offers/defaults?company_id=${f('company_id').value}&language=${lang()}`);
    } catch (err) { return toast(err.message, true); }
    f('contact_id').innerHTML = `<option value="">—</option>${(defaults.contacts || []).map((c) => opt(c.id, `${c.full_name}${c.title ? ` – ${c.title}` : ''}${c.receives_offers ? ' ★' : ''}`, o?.contact_id ?? (defaults.contacts.find((x) => x.receives_offers)?.id))).join('')}`;
    if (applyCompanyDefaults) {
      f('currency').value = defaults.currency;
      f('payment_days').value = defaults.payment_days;
    }
    renderItems();
  };

  if (o) {
    fillCompanies(o.company_id);
    for (const k of ['title', 'offer_date', 'valid_days', 'payment_days', 'intro', 'scope', 'assumptions', 'terms', 'internal_notes']) f(k).value = o[k] ?? '';
    if (o.contact) f('contact_id').innerHTML = `<option value="${o.contact.id}">${esc(o.contact.full_name)}</option>`;
    if (editable) loadDefaults(false);
  } else {
    f('offer_date').value = today();
    f('valid_days').value = 30;
    try {
      const t = (await api('GET', '/api/offers/defaults?language=tr')).templates;
      f('intro').value = t.intro || '';
      f('assumptions').value = t.assumptions || '';
      f('terms').value = t.terms || '';
    } catch { /* şablon yoksa boş başlar */ }
  }
  f('_customer').onchange = () => { fillCompanies(); loadDefaults(true); };
  f('company_id').onchange = () => loadDefaults(true);
  // Dil değişince (yeni teklifte) şablon metinleri o dilde yeniden doldurulur
  f('language').onchange = async () => {
    if (!isNew) return renderItems();
    const t = (await api('GET', `/api/offers/defaults?language=${lang()}`)).templates;
    if (confirm('Giriş, varsayımlar ve şartlar metinleri seçilen dilin şablonuyla değiştirilsin mi?')) {
      f('intro').value = t.intro || '';
      f('assumptions').value = t.assumptions || '';
      f('terms').value = t.terms || '';
    }
    for (const it of items) if (Object.values(DEFAULT_UNIT.tr).includes(it.unit) || Object.values(DEFAULT_UNIT.en).includes(it.unit)) it.unit = DEFAULT_UNIT[lang()][it.kind];
    renderItems();
  };

  // ---- kalemler ----
  const cur = () => f('currency').value;
  const lineTotal = (it) => r2(parseNum(it.quantity) * parseNum(it.unit_price) * (1 - parseNum(it.discount_pct) / 100));
  const totals = () => {
    const subtotal = r2(items.reduce((a, it) => a + lineTotal(it), 0));
    const vatRate = o && !editable ? o.vat_rate : (defaults.vat_rate ?? o?.vat_rate ?? Number(state.settings.vat_rate));
    const vat = r2(subtotal * vatRate / 100);
    return { subtotal, vat, total: r2(subtotal + vat), vatRate, exempt: defaults.vat_exempt ?? o?.totals.vat_exempt };
  };
  const dis = editable ? '' : 'disabled';
  function renderItems() {
    $('[data-items]').innerHTML = items.length ? items.map((it, i) => `<tr data-i="${i}">
      <td><select data-k="kind" ${dis}>${Object.entries(KINDS).map(([k, l]) => opt(k, l, it.kind)).join('')}</select></td>
      <td style="min-width:220px"><input data-k="description" value="${esc(it.description)}" ${dis} placeholder="Açıklama"></td>
      <td><input data-k="quantity" class="num-in" value="${esc(it.quantity)}" inputmode="decimal" ${dis}></td>
      <td><input data-k="unit" class="unit-in" value="${esc(it.unit)}" ${dis}></td>
      <td><input data-k="unit_price" class="num-in" value="${esc(it.unit_price)}" inputmode="decimal" ${dis}></td>
      <td><input data-k="discount_pct" class="pct-in" value="${esc(it.discount_pct || '')}" inputmode="decimal" ${dis}></td>
      <td class="num" data-line>${money(lineTotal(it), cur())}</td>
      <td>${editable ? `<button type="button" class="link danger" data-del-item="${i}" aria-label="Kalemi sil">✕</button>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="8" class="empty">Henüz kalem yok.${editable ? ' Yukarıdan ekleyin.' : ''}</td></tr>`;
    renderTotals();
  }
  function renderTotals() {
    const t = totals();
    $('[data-totals]').innerHTML = `<div class="tot-row"><span>Ara toplam</span><b>${money(t.subtotal, cur())}</b></div>
      <div class="tot-row"><span>${t.exempt ? 'KDV (istisna)' : `KDV (%${t.vatRate})`}</span><b>${money(t.vat, cur())}</b></div>
      <div class="tot-row grand"><span>Genel toplam</span><b>${money(t.total, cur())}</b></div>`;
    renderPayCheck();
  }
  $('[data-items]').addEventListener('input', (e) => {
    const tr = e.target.closest('[data-i]');
    if (!tr || !e.target.dataset.k) return;
    const it = items[Number(tr.dataset.i)];
    it[e.target.dataset.k] = e.target.value;
    if (e.target.dataset.k === 'kind') it.unit = DEFAULT_UNIT[lang()][it.kind];
    tr.querySelector('[data-line]').textContent = money(lineTotal(it), cur());
    if (e.target.dataset.k === 'kind') renderItems(); else renderTotals();
  });
  form.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-item]');
    const del = e.target.closest('[data-del-item]');
    if (add) {
      const kind = add.dataset.addItem;
      items.push({ kind, description: '', quantity: kind === 'service' ? 1 : 1, unit: DEFAULT_UNIT[lang()][kind],
        unit_price: kind === 'service' && defaults.daily_rate ? defaults.daily_rate : '', discount_pct: '' });
      renderItems();
      $('[data-items] tr:last-child [data-k="description"]')?.focus();
    } else if (del) { items.splice(Number(del.dataset.delItem), 1); renderItems(); }
  });
  f('currency').addEventListener('change', renderItems);

  // ---- ödeme planı ----
  function renderPayments() {
    $('[data-payments]').innerHTML = payments.length ? payments.map((p, i) => `<tr data-p="${i}">
      <td><input data-k="description" value="${esc(p.description)}" ${dis} placeholder="Örn. Sipariş onayında"></td>
      <td><input data-k="due" value="${esc(p.due)}" ${dis} placeholder="Örn. Teslimde / 31.12.2026"></td>
      <td><input data-k="amount" class="num-in" value="${esc(p.amount)}" inputmode="decimal" ${dis}></td>
      <td>${editable ? `<button type="button" class="link danger" data-del-pay="${i}" aria-label="Ödemeyi sil">✕</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">Ödeme planı yok (isteğe bağlı).</td></tr>';
    renderPayCheck();
  }
  function renderPayCheck() {
    const box = $('[data-pay-check]');
    if (!box) return;
    const sum = r2(payments.reduce((a, p) => a + parseNum(p.amount), 0));
    const t = totals();
    box.innerHTML = payments.length ? `<p class="hint ${Math.abs(sum - t.total) > 0.01 ? 'neg' : ''}">Ödeme planı toplamı: ${money(sum, cur())}
      ${Math.abs(sum - t.total) > 0.01 ? ` — genel toplamla (${money(t.total, cur())}) eşleşmiyor` : ' ✓ genel toplamla eşleşiyor'}</p>` : '';
  }
  $('[data-payments]').addEventListener('input', (e) => {
    const tr = e.target.closest('[data-p]');
    if (!tr || !e.target.dataset.k) return;
    payments[Number(tr.dataset.p)][e.target.dataset.k] = e.target.value;
    renderPayCheck();
  });
  form.addEventListener('click', (e) => {
    const pay = e.target.closest('[data-pay]');
    const del = e.target.closest('[data-del-pay]');
    const en = lang() === 'en';
    const t = totals();
    if (pay?.dataset.pay === 'single') payments.splice(0, payments.length, { description: en ? 'Full payment' : 'Tamamı', due: en ? 'On invoice' : 'Faturada', amount: t.total });
    else if (pay?.dataset.pay === 'half') {
      const h = r2(t.total / 2);
      payments.splice(0, payments.length,
        { description: en ? '50% on order' : 'Sipariş onayında %50', due: en ? 'On order' : 'Sipariş', amount: h },
        { description: en ? '50% on delivery' : 'Teslimde %50', due: en ? 'On delivery' : 'Teslim', amount: r2(t.total - h) });
    } else if (pay?.dataset.pay === 'add') payments.push({ description: '', due: '', amount: '' });
    else if (del) payments.splice(Number(del.dataset.delPay), 1);
    else return;
    renderPayments();
  });

  renderItems();
  renderPayments();
  if (!editable) [...form.elements].forEach((el) => { el.disabled = true; });

  // ---- kaydetme ve durum işlemleri ----
  const payload = () => {
    const d = Object.fromEntries(['company_id', 'contact_id', 'language', 'currency', 'title', 'offer_date', 'valid_days', 'payment_days',
      'intro', 'scope', 'assumptions', 'terms', 'internal_notes'].map((k) => [k, f(k).value]));
    d.items = items.map((it) => ({ ...it, quantity: parseNum(it.quantity), unit_price: parseNum(it.unit_price), discount_pct: parseNum(it.discount_pct) }));
    d.payments = payments.map((p) => ({ ...p, amount: parseNum(p.amount) }));
    return d;
  };
  const save = async () => {
    if (!form.reportValidity()) return null;
    if (isNew) {
      const r = await api('POST', '/api/offers', payload());
      toast(`${r.number} oluşturuldu`);
      location.hash = `#/teklifler/${r.id}`;
      return r.id;
    }
    await api('PUT', `/api/offers/${o.id}`, payload());
    return o.id;
  };

  const actions = $('[data-actions]');
  actions.innerHTML = actionButtons(o, editable, isNew);
  actions.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'save') { await save(); if (!isNew) { toast('Kaydedildi'); pageOffer(o.id); } return; }
      if (act === 'preview') { if (editable && !isNew) await save(); return window.open(`/api/offers/${o.id}/pdf`, '_blank'); }
      if (act === 'submit') { await save(); await api('POST', `/api/offers/${o.id}/submit`); toast('Onaya gönderildi'); }
      if (act === 'approve') { await api('POST', `/api/offers/${o.id}/review`, { decision: 'approved' }); toast('Onaylandı; PDF donduruldu'); }
      if (act === 'reject') {
        const note = prompt('Geri gönderme gerekçesi:');
        if (!note) return;
        await api('POST', `/api/offers/${o.id}/review`, { decision: 'rejected', note });
        toast('Hazırlayana geri gönderildi');
      }
      if (act === 'upload') return $('[data-file]').click();
      if (act === 'mail') return mailDraft(o);
      if (act === 'send') { if (!confirm('Teklif müşteriye gönderildi olarak işaretlensin mi?')) return; await api('POST', `/api/offers/${o.id}/send`); toast('Gönderildi olarak işaretlendi'); }
      if (act === 'accept' || act === 'decline') {
        const note = prompt(act === 'accept' ? 'Kabul notu (isteğe bağlı):' : 'Ret gerekçesi (isteğe bağlı):') ?? null;
        if (note === null) return;
        await api('POST', `/api/offers/${o.id}/decision`, { decision: act === 'accept' ? 'accepted' : 'rejected', note });
        toast(act === 'accept' ? 'Kabul edildi' : 'Reddedildi olarak işaretlendi');
      }
      if (act === 'revise') { if (!confirm('Yeni revizyon açılsın mı? Mevcut sürüm arşivde değişmeden kalır.')) return; await api('POST', `/api/offers/${o.id}/revise`); toast('Yeni revizyon açıldı'); }
      if (act === 'delete') { if (!confirm('Taslak teklif silinsin mi?')) return; await api('DELETE', `/api/offers/${o.id}`); toast('Silindi'); location.hash = '#/teklifler'; return; }
      pageOffer(o.id);
    } catch (err) { toast(err.message, true); }
  };

  if (o) {
    renderVersions(o);
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.pdf,.p7s,.p7m,.imz,.asice';
    file.hidden = true;
    file.dataset.file = '';
    main.append(file);
    file.onchange = async () => {
      const fl = file.files[0];
      if (!fl) return;
      try {
        const res = await fetch(`/api/offers/${o.id}/signed`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(fl.name) }, body: fl,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Yükleme başarısız');
        toast('İmzalı dosya yüklendi');
        pageOffer(o.id);
      } catch (err) { toast(err.message, true); }
    };
  }
}

function stepper(o) {
  const idx = STEPS.indexOf(o.status === 'rejected' ? 'accepted' : o.status);
  const labels = { draft: 'Taslak', pending_approval: 'İç onay', approved: 'Onaylandı', signed: 'İmzalandı', sent: 'Gönderildi', accepted: o.status === 'rejected' ? 'Reddedildi' : 'Kabul' };
  return `<div class="stepper">${STEPS.map((s, i) => `<div class="step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''} ${s === 'accepted' && o.status === 'rejected' ? 'fail' : ''}">
    <span class="dot">${i < idx ? '✓' : i + 1}</span><span>${labels[s]}</span></div>`).join('<div class="bar"></div>')}</div>`;
}

function actionButtons(o, editable, isNew) {
  if (isNew) return '<button type="button" data-act="save">Taslağı oluştur</button>';
  const b = (act, label, secondary) => `<button type="button" ${secondary ? 'class="secondary"' : ''} data-act="${act}">${label}</button>`;
  const handle = can('offers.edit') || can('offers.approve');
  const out = [];
  if (o.status === 'draft' && editable) out.push(b('save', 'Kaydet', true), b('preview', 'PDF önizle', true), b('submit', 'Onaya gönder'));
  if (o.status === 'draft' && editable && o.revision === 1 && !o.versions.length) out.unshift(`<button type="button" class="link danger" data-act="delete">Sil</button>`);
  if (o.status === 'pending_approval') {
    out.push(b('preview', 'PDF önizle', true));
    if (can('offers.approve')) out.push(b('reject', 'Geri gönder', true), b('approve', 'Onayla ve PDF\'i dondur'));
  }
  if (['approved', 'signed'].includes(o.status) && handle) {
    out.push(b('preview', 'PDF indir', true), b('upload', o.status === 'signed' ? 'İmzalı dosyayı değiştir' : 'İmzalı dosya yükle', true), b('mail', 'Mail taslağı', true), b('send', 'Gönderildi'));
  }
  if (o.status === 'sent' && handle) out.push(b('mail', 'Mail taslağı', true), b('decline', 'Reddedildi', true), b('accept', 'Kabul edildi'));
  if (['approved', 'signed', 'sent', 'rejected'].includes(o.status) && can('offers.edit')) out.push(b('revise', 'Revizyon aç', true));
  return out.join('');
}

function renderVersions(o) {
  $('[data-versions]').innerHTML = o.versions.length ? `<table>
    <thead><tr><th>Sürüm</th><th>Onay</th><th>PDF</th><th>Parmak izi (SHA-256)</th><th>İmzalı dosya</th></tr></thead>
    <tbody>${o.versions.map((v) => `<tr><td><b>Rev.${v.revision}</b>${v.revision === o.revision ? ' <span class="badge">güncel</span>' : ''}</td>
      <td>${fmtDateTime(v.created_at)}<div class="small">${esc(v.approved_by_name || '')}</div></td>
      <td><a href="/api/offer-versions/${v.id}/pdf">PDF indir</a></td>
      <td class="masked small" title="${v.pdf_sha256}">${v.pdf_sha256.slice(0, 16)}…</td>
      <td>${v.signed_name ? `<a href="/api/offer-versions/${v.id}/signed">${esc(v.signed_name)}</a><div class="small">${fmtDateTime(v.signed_at)} · ${esc(v.signed_by_name || '')}</div>` : '<span class="small">—</span>'}</td></tr>`).join('')}</tbody></table>
    <p class="hint">Onaylanan her sürümün PDF'i değiştirilemez şekilde saklanır; parmak izi imzalanan dosyanın hangi sürüm olduğunu doğrulamak için kullanılır.</p>`
    : '<div class="empty">Henüz onaylanmış sürüm yok. Teklif onaylanınca PDF burada saklanır.</div>';
}

// Outlook/varsayılan mail uygulamasında alıcıları ve metni doldurulmuş taslak açar; dosya elle eklenir
async function mailDraft(o) {
  let contacts = [];
  try { contacts = (await api('GET', `/api/offers/defaults?company_id=${o.company_id}&language=${o.language}`)).contacts || []; } catch { /* kişi listesi alınamazsa boş */ }
  const to = [...new Set([o.contact?.email, ...contacts.filter((c) => c.receives_offers).map((c) => c.email)].filter(Boolean))];
  const en = o.language === 'en';
  const subject = en ? `Proposal ${o.number} Rev.${o.revision} – ${o.title}` : `Teklif ${o.number} Rev.${o.revision} – ${o.title}`;
  const name = o.contact?.full_name ? (en ? `Dear ${o.contact.full_name},` : `Sayın ${o.contact.full_name},`) : (en ? 'Dear Sir/Madam,' : 'Sayın ilgili,');
  const body = en
    ? `${name}\n\nPlease find attached our proposal ${o.number} (Rev.${o.revision}) regarding "${o.title}".\nThe proposal is valid until ${fmtDate(o.valid_until)}.\n\nKind regards,\n${state.user.full_name}\n${state.settings.company_name}`
    : `${name}\n\n"${o.title}" konulu ${o.number} (Rev.${o.revision}) numaralı teklifimizi ekte bilgilerinize sunarız.\nTeklif ${fmtDate(o.valid_until)} tarihine kadar geçerlidir.\n\nSaygılarımızla,\n${state.user.full_name}\n${state.settings.company_name}`;
  if (!to.length) toast('Bu müşteride "teklif alır" işaretli ve e-postası olan kişi yok; alıcıyı elle ekleyin', true);
  location.href = `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  setTimeout(() => toast('Mail taslağı açıldı. İmzalı dosyayı eke eklemeyi unutmayın.'), 300);
}

export const offerCurrencyLabel = (c) => CURRENCY_LABELS[c] || c;
