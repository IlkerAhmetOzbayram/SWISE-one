// Aktivite Listesi ekranı: günlük liste, haftalık çizelge (hücreden giriş) ve aylık takvim.
// Rota: #/efor/gun | #/efor/hafta | #/efor/ay
import { state, isAdmin, $, main, api, toast, esc, hrs, today, fmtDate, addDays, weekStart, dayShort, dayName, isWeekend,
  monthLabel, addMonths, monthEnd, opt, clientProjectCell, companyLabel, yesNo, HOURS_PER_DAY } from '../core.js';
import { openEntryDialog } from '../components/entry-dialog.js';

const VIEWS = { gun: 'Günlük', hafta: 'Haftalık', ay: 'Aylık' };
const view = { date: today(), userId: null };

const rangeOf = (v, d) => {
  if (v === 'gun') return [d, d];
  if (v === 'hafta') { const s = weekStart(d); return [s, addDays(s, 6)]; }
  return [`${d.slice(0, 7)}-01`, monthEnd(d.slice(0, 7))];
};
const step = (v, d, n) => (v === 'gun' ? addDays(d, n) : v === 'hafta' ? addDays(d, 7 * n) : `${addMonths(d.slice(0, 7), n)}-01`);
const label = (v, [from, to]) => (v === 'gun' ? `${fmtDate(from)} · ${dayName(from)}` : v === 'hafta' ? `${fmtDate(from)} – ${fmtDate(to)}` : monthLabel(from.slice(0, 7)));
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const sumHours = (rows) => rows.reduce((a, r) => a + r.hours, 0);
const targetKey = (r) => `${r.company_id}|${r.project_id ?? ''}`;

export function pageEffort(param) {
  const v = VIEWS[param] ? param : 'hafta';
  if (view.userId === null) view.userId = String(state.user.id);
  const teamMode = isAdmin() && view.userId === '';
  const range = rangeOf(v, view.date);

  main.innerHTML = `<h1>Aktivite Listesi</h1>
    <section class="card">
      <div class="toolbar">
        <div class="tabs">${Object.entries(VIEWS).map(([k, t]) => `<a href="#/efor/${k}" class="${k === v ? 'active' : ''}">${t}</a>`).join('')}</div>
        <div class="nav-date">
          <button type="button" class="secondary" data-prev aria-label="Önceki">‹</button>
          <button type="button" class="secondary" data-today>Bugün</button>
          <button type="button" class="secondary" data-next aria-label="Sonraki">›</button>
          <b data-label>${label(v, range)}</b>
        </div>
        ${isAdmin() ? `<label class="inline">Kişi <select data-user><option value="">Tüm ekip</option>${state.users.filter((u) => u.active).map((u) => opt(u.id, u.full_name, view.userId)).join('')}</select></label>` : ''}
      </div>
      ${teamMode && v !== 'ay' ? '<p class="hint">Tüm ekip görünümünde yalnızca okunur; giriş için bir kişi seçin.</p>' : ''}
      <div data-body><div class="empty">Yükleniyor…</div></div>
    </section>`;

  $('[data-prev]').onclick = () => { view.date = step(v, view.date, -1); pageEffort(v); };
  $('[data-next]').onclick = () => { view.date = step(v, view.date, 1); pageEffort(v); };
  $('[data-today]').onclick = () => { view.date = today(); pageEffort(v); };
  const userSel = $('[data-user]');
  if (userSel) userSel.onchange = () => { view.userId = userSel.value; pageEffort(v); };

  load(v, range, teamMode);
}

async function load(v, [from, to], teamMode) {
  const params = new URLSearchParams({ from, to });
  if (isAdmin() && view.userId) params.set('user_id', view.userId);
  let rows;
  let holidays;
  try {
    [rows, { holidays }] = await Promise.all([api('GET', `/api/activities?${params}`), api('GET', `/api/workdays?from=${from}&to=${to}`)]);
  } catch (err) { return toast(err.message, true); }
  const hol = new Map(holidays.map((h) => [h.date, h]));
  const refresh = () => pageEffort(v);
  const open = (date, target) => !teamMode && openEntryDialog({ date, target, userId: Number(view.userId || state.user.id), onChange: refresh });
  const body = $('[data-body]');
  if (v === 'gun') renderDay(body, rows, from, hol, open, teamMode);
  else if (v === 'hafta') renderWeek(body, rows, days(from, to), hol, open, teamMode);
  else renderMonth(body, rows, from, to, hol);
}

function renderDay(body, rows, date, hol, open, teamMode) {
  const total = sumHours(rows);
  const h = hol.get(date);
  body.innerHTML = `
    ${h ? `<p class="holiday-note">🎌 ${esc(h.name)}</p>` : ''}
    <div class="card-head"><div class="small">${hrs(total)} saat · ${hrs(total / HOURS_PER_DAY)} adam-gün</div>
      <button type="button" data-add>+ Efor ekle</button></div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr>${isAdmin() ? '<th>Kişi</th>' : ''}<th>Müşteri / Proje</th><th>Açıklama</th><th class="num">Saat</th><th>Fatura</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>${isAdmin() ? `<td>${esc(r.user_name)}</td>` : ''}<td>${clientProjectCell(r)}</td><td>${esc(r.description)}</td>
        <td class="num">${hrs(r.hours)}</td><td>${yesNo(r.billable)}</td><td class="num"><button class="link" data-open="${r.id}">Aç</button></td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty">Bu gün için kayıt yok.</div>'}`;
  const add = body.querySelector('[data-add]');
  add.hidden = teamMode;
  add.onclick = () => open(date);
  body.onclick = (e) => {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    const r = rows.find((x) => x.id === Number(b.dataset.open));
    open(date, { customer_id: r.customer_id, company_id: r.company_id, project_id: r.project_id });
  };
}

function renderWeek(body, rows, week, hol, open, teamMode) {
  // Satırlar: müşteri › şirket / proje; hücreler: günlük saat toplamı
  const lines = new Map();
  for (const r of rows) {
    const k = targetKey(r);
    if (!lines.has(k)) lines.set(k, { target: { customer_id: r.customer_id, company_id: r.company_id, project_id: r.project_id }, row: r, byDay: {} });
    const l = lines.get(k);
    l.byDay[r.date] = (l.byDay[r.date] || 0) + r.hours;
  }
  const sorted = [...lines.values()].sort((a, b) => companyLabel(a.row.customer_name, a.row.company_name).localeCompare(companyLabel(b.row.customer_name, b.row.company_name), 'tr'));
  const dayTotal = (d) => rows.filter((r) => r.date === d).reduce((a, r) => a + r.hours, 0);
  const total = sumHours(rows);
  const cls = (d) => [isWeekend(d) && 'weekend', hol.has(d) && 'holiday', d === today() && 'today'].filter(Boolean).join(' ');
  const cell = (v) => (v ? hrs(v) : '');

  body.innerHTML = `<div class="table-wrap"><table class="week ${teamMode ? '' : 'editable'}">
    <thead><tr><th>Müşteri / Proje</th>${week.map((d) => `<th class="num ${cls(d)}" data-day="${d}" title="${esc(hol.get(d)?.name || '')}">${dayShort(d)}<div class="small">${fmtDate(d).slice(0, 5)}</div></th>`).join('')}<th class="num">Toplam</th></tr></thead>
    <tbody>${sorted.map((l, i) => `<tr><td>${clientProjectCell(l.row)}</td>
      ${week.map((d) => `<td class="num cell ${cls(d)}" data-line="${i}" data-date="${d}">${cell(l.byDay[d])}</td>`).join('')}
      <td class="num"><b>${hrs(Object.values(l.byDay).reduce((a, b) => a + b, 0))}</b></td></tr>`).join('')
      || `<tr><td colspan="${week.length + 2}" class="empty">Bu hafta kayıt yok.</td></tr>`}</tbody>
    <tfoot><tr class="total"><td>Toplam</td>${week.map((d) => `<td class="num ${cls(d)}">${cell(dayTotal(d))}</td>`).join('')}<td class="num">${hrs(total)}</td></tr>
      <tr><td class="small">Adam-gün</td>${week.map((d) => `<td class="num small">${dayTotal(d) ? hrs(dayTotal(d) / HOURS_PER_DAY) : ''}</td>`).join('')}<td class="num small">${hrs(total / HOURS_PER_DAY)}</td></tr></tfoot>
  </table></div>
  ${teamMode ? '' : `<div class="actions" style="margin-top:12px"><button type="button" class="secondary" data-new-line>+ Yeni satır (başka müşteri)</button>
    <span class="hint">Hücreye veya gün başlığına tıklayarak efor girin.</span></div>`}`;

  if (teamMode) return;
  body.onclick = (e) => {
    const c = e.target.closest('td[data-line]');
    const h = e.target.closest('th[data-day]');
    if (c) open(c.dataset.date, sorted[Number(c.dataset.line)].target);
    else if (h) open(h.dataset.day);
    else if (e.target.closest('[data-new-line]')) open(week.includes(today()) ? today() : week[0]);
  };
}

function renderMonth(body, rows, from, to, hol) {
  const byDay = {};
  for (const r of rows) byDay[r.date] = (byDay[r.date] || 0) + r.hours;
  const level = (h) => (!h ? 0 : h < 4 ? 1 : h < 8 ? 2 : 3);
  const lead = (new Date(`${from}T00:00:00`).getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...days(from, to)];
  const billable = rows.reduce((a, r) => a + (r.billable ? r.hours : 0), 0);

  // Müşteri › şirket bazında ay özeti
  const byTarget = new Map();
  for (const r of rows) {
    const k = r.company_id;
    if (!byTarget.has(k)) byTarget.set(k, { name: companyLabel(r.customer_name, r.company_name), hours: 0, billable: 0 });
    const t = byTarget.get(k);
    t.hours += r.hours;
    if (r.billable) t.billable += r.hours;
  }

  body.innerHTML = `
    <div class="small" style="margin-bottom:10px">${hrs(sumHours(rows))} saat · faturalanabilir ${hrs(billable)} saat (${hrs(billable / HOURS_PER_DAY)} adam-gün)</div>
    <div class="calendar">
      ${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => `<div class="cal-head">${d}</div>`).join('')}
      ${cells.map((d) => (d ? `<button type="button" class="cal-day lvl${level(byDay[d])} ${isWeekend(d) ? 'weekend' : ''} ${hol.has(d) ? 'holiday' : ''} ${d === today() ? 'today' : ''}"
          data-day="${d}" title="${esc(hol.get(d)?.name || '')}">
          <span class="num-day">${Number(d.slice(8))}</span>
          <span class="cal-hours">${byDay[d] ? `${hrs(byDay[d])} sa` : ''}</span>
          ${hol.has(d) ? `<span class="cal-hol">${esc(hol.get(d).kind === 'half' ? 'Yarım gün' : 'Tatil')}</span>` : ''}
        </button>` : '<div></div>')).join('')}
    </div>
    <p class="hint">Bir güne tıklayınca o günün ayrıntısı açılır.</p>
    ${byTarget.size ? `<h2 style="margin-top:18px">Müşteri bazında</h2><table>
      <thead><tr><th>Müşteri / Şirket</th><th class="num">Saat</th><th class="num">Fat. saat</th><th class="num">Adam-gün</th></tr></thead>
      <tbody>${[...byTarget.values()].sort((a, b) => b.hours - a.hours).map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${hrs(t.hours)}</td>
        <td class="num">${hrs(t.billable)}</td><td class="num">${hrs(t.billable / HOURS_PER_DAY)}</td></tr>`).join('')}</tbody></table>` : ''}`;

  body.onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    view.date = b.dataset.day;
    location.hash = '#/efor/gun';
  };
}
