// Onaylar: haftalık efor onayı, masraf onayı ve ay kapanışı (#/onaylar/hafta | masraf | ay)
import { can, $, main, api, toast, esc, money, hrs, fmtDate, fmtDateTime, addDays, today, monthLabel, addMonths, clientProjectCell, HOURS_PER_DAY } from '../core.js';
import { showWeek } from './effort.js';

const TABS = [
  { id: 'hafta', title: 'Haftalık efor', allowed: () => can('activities.approve'), render: weeksTab },
  { id: 'masraf', title: 'Masraflar', allowed: () => can('expenses.approve'), render: expensesTab },
  { id: 'ay', title: 'Ay kapanışı', allowed: () => can('period.close') || can('period.reopen'), render: periodTab },
];

export function pageApprovals(param) {
  const tabs = TABS.filter((t) => t.allowed());
  const tab = tabs.find((t) => t.id === param) || tabs[0];
  main.innerHTML = `<h1>Onaylar</h1>
    <div class="tabs" style="margin-bottom:16px">${tabs.map((t) => `<a href="#/onaylar/${t.id}" class="${t === tab ? 'active' : ''}">${t.title}</a>`).join('')}</div>
    <section class="card" data-tab><div class="empty">Yükleniyor…</div></section>`;
  tab.render($('[data-tab]'));
}

const askNote = (title) => {
  const note = prompt(title);
  return note && note.trim() ? note.trim() : null;
};

async function weeksTab(box) {
  let rows;
  try { rows = await api('GET', '/api/timesheets/pending'); } catch (err) { return toast(err.message, true); }
  box.innerHTML = `<h2>Onay bekleyen haftalar</h2>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Kişi</th><th>Hafta</th><th class="num">Saat</th><th class="num">Fat. saat</th><th class="num">Adam-gün</th><th>Gönderildi</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><b>${esc(r.user_name)}</b></td>
        <td>${fmtDate(r.week_start)} – ${fmtDate(addDays(r.week_start, 6))}</td>
        <td class="num">${hrs(r.hours)}</td><td class="num">${hrs(r.billable)}</td><td class="num">${hrs(r.billable / HOURS_PER_DAY)}</td>
        <td>${fmtDateTime(r.submitted_at)}</td>
        <td class="num"><button class="link" data-view="${r.id}">Görüntüle</button>
          <button class="link" data-ok="${r.id}">Onayla</button><button class="link danger" data-no="${r.id}">Geri gönder</button></td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty">Onay bekleyen hafta yok. 👍</div>'}
    <p class="hint">Onaylanan hafta kilitlenir; değişiklik gerekirse Aktivite Listesi'nden “Yeniden aç” ile açılabilir.</p>`;
  box.onclick = async (e) => {
    const find = (attr) => rows.find((r) => r.id === Number(e.target.closest(`[${attr}]`)?.getAttribute(attr)));
    const view = find('data-view');
    const ok = find('data-ok');
    const no = find('data-no');
    try {
      if (view) return showWeek(view.user_id, view.week_start);
      if (ok) await api('POST', `/api/timesheets/${ok.id}/review`, { decision: 'approved' });
      else if (no) {
        const note = askNote(`${no.user_name} – geri gönderme gerekçesi:`);
        if (!note) return;
        await api('POST', `/api/timesheets/${no.id}/review`, { decision: 'rejected', note });
      } else return;
      toast('Güncellendi');
      weeksTab(box);
    } catch (err) { toast(err.message, true); }
  };
}

async function expensesTab(box) {
  let rows;
  try { rows = await api('GET', '/api/expenses?status=pending'); } catch (err) { return toast(err.message, true); }
  box.innerHTML = `<h2>Onay bekleyen masraflar</h2>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Tarih</th><th>Kişi</th><th>Müşteri / Proje</th><th>Kategori</th><th>Açıklama</th><th class="num">Tutar</th><th>Yansıtılır</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.user_name)}</td><td>${clientProjectCell(r)}</td>
        <td>${esc(r.category)}</td><td>${esc(r.description)}</td>
        <td class="num">${money(r.amount, r.currency)}<div class="small">KDV %${r.vat_rate}</div></td>
        <td>${r.billable ? 'Evet' : 'Hayır'}</td>
        <td class="num"><button class="link" data-ok="${r.id}">Onayla</button><button class="link danger" data-no="${r.id}">Reddet</button></td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty">Onay bekleyen masraf yok. 👍</div>'}
    <p class="hint">Onaylanmamış masraflar muhasebe raporunda müşteriye yansıtılmaz, ayrıca “onay bekliyor” olarak gösterilir.</p>`;
  box.onclick = async (e) => {
    const okId = e.target.closest('[data-ok]')?.dataset.ok;
    const noId = e.target.closest('[data-no]')?.dataset.no;
    try {
      if (okId) await api('POST', `/api/expenses/${okId}/review`, { decision: 'approved' });
      else if (noId) {
        const note = askNote('Reddetme gerekçesi:');
        if (!note) return;
        await api('POST', `/api/expenses/${noId}/review`, { decision: 'rejected', note });
      } else return;
      toast('Güncellendi');
      expensesTab(box);
    } catch (err) { toast(err.message, true); }
  };
}

let periodMonth = addMonths(today().slice(0, 7), -1);
const STATUS = { draft: 'Gönderilmedi', submitted: 'Onay bekliyor', rejected: 'Geri gönderildi' };

async function periodTab(box) {
  let closed;
  let check = null;
  try {
    closed = await api('GET', '/api/periods');
    if (can('period.close')) check = await api('GET', `/api/periods/check?month=${periodMonth}`);
  } catch (err) { return toast(err.message, true); }
  const isClosed = closed.some((p) => p.month === periodMonth);
  box.innerHTML = `<h2>Ay kapanışı</h2>
    <p class="hint" style="margin:-6px 0 14px">Kapatılan ayın aktivite ve masrafları hiç kimse tarafından değiştirilemez; fatura ve muhasebe için sabitlenir.</p>
    <div class="nav-date" style="margin-bottom:14px">
      <button type="button" class="secondary" data-prev>‹</button><button type="button" class="secondary" data-next>›</button>
      <b>${monthLabel(periodMonth)}</b> ${isClosed ? '<span class="badge">Kapalı</span>' : '<span class="badge off">Açık</span>'}
    </div>
    ${check && !isClosed ? `
      ${check.unapproved.length ? `<div class="notice danger">Bu ayda onaylanmamış ${check.unapproved.length} hafta var.</div>
        <div class="table-wrap"><table><thead><tr><th>Kişi</th><th>Hafta</th><th class="num">Saat (bu ay)</th><th>Durum</th></tr></thead>
        <tbody>${check.unapproved.map((w) => `<tr><td>${esc(w.user_name)}</td><td>${fmtDate(w.week_start)}</td><td class="num">${hrs(w.hours)}</td>
          <td><span class="badge ${w.status === 'rejected' ? 'danger' : 'warn'}">${STATUS[w.status]}</span></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="notice">Bu aydaki tüm haftalar onaylandı. ✓</div>'}
      ${check.pending_expenses ? `<div class="notice danger">${check.pending_expenses} masraf onay bekliyor.</div>` : ''}
      <div class="actions" style="margin-top:14px"><button type="button" data-close>Ayı kapat</button></div>` : ''}
    ${isClosed && can('period.reopen') ? '<div class="actions"><button type="button" class="secondary" data-reopen>Ayı yeniden aç</button></div>' : ''}
    <h2 style="margin-top:22px">Kapatılmış aylar</h2>
    ${closed.length ? `<table><thead><tr><th>Ay</th><th>Kapatan</th><th>Zaman</th></tr></thead>
      <tbody>${closed.map((p) => `<tr><td>${monthLabel(p.month)}</td><td>${esc(p.closed_by_name || '—')}</td><td>${fmtDateTime(p.closed_at)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Henüz kapatılmış ay yok.</div>'}`;

  $('[data-prev]', box).onclick = () => { periodMonth = addMonths(periodMonth, -1); periodTab(box); };
  $('[data-next]', box).onclick = () => { periodMonth = addMonths(periodMonth, 1); periodTab(box); };
  const close = $('[data-close]', box);
  if (close) close.onclick = async () => {
    const warn = check.unapproved.length || check.pending_expenses;
    if (!confirm(warn ? `${monthLabel(periodMonth)} ayında eksik onaylar var. Yine de kapatılsın mı?` : `${monthLabel(periodMonth)} ayı kapatılsın mı?`)) return;
    try {
      await api('POST', '/api/periods/close', { month: periodMonth, force: true });
      toast('Ay kapatıldı');
      periodTab(box);
    } catch (err) { toast(err.message, true); }
  };
  const reopen = $('[data-reopen]', box);
  if (reopen) reopen.onclick = async () => {
    if (!confirm(`${monthLabel(periodMonth)} ayı yeniden açılsın mı? Bu işlem kayda geçer.`)) return;
    try {
      await api('POST', '/api/periods/reopen', { month: periodMonth });
      toast('Ay yeniden açıldı');
      periodTab(box);
    } catch (err) { toast(err.message, true); }
  };
}
