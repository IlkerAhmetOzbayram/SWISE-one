// Ana sayfa: kişinin bu hafta/bu ay eforu, eksik efor girilen günler; yöneticiye bütçe ve ekip özeti
import { state, isAdmin, main, api, toast, esc, money, hrs, pct, fmtDate, dayShort, dayName, monthLabel, HOURS_PER_DAY } from '../core.js';
import { openEntryDialog } from '../components/entry-dialog.js';

export async function pageHome() {
  let d;
  try {
    d = await api('GET', '/api/dashboard');
  } catch (err) { return toast(err.message, true); }
  const me = d.me;
  const bd = d.business_days;
  const stat = (label, value, sub = '') => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="small">${sub}</div>` : ''}</div>`;
  const maxWeek = Math.max(HOURS_PER_DAY, ...me.week.map((w) => w.hours));

  main.innerHTML = `<h1>Merhaba, ${esc(state.user.full_name.split(' ')[0])}</h1>
    <p class="hint" style="margin:-8px 0 16px">${fmtDate(d.today)} ${dayName(d.today)} · ${monthLabel(d.month)}: ${bd.total} iş günü, ${bd.elapsed} geçti</p>
    <div class="stats">
      ${stat('Bu hafta', `${hrs(me.week_hours)} sa`)}
      ${stat('Bu ay', `${hrs(me.month_hours)} sa`, `faturalanabilir ${hrs(me.month_billable_hours)} sa`)}
      ${stat('Bu ay adam-gün', hrs(me.month_days), 'faturalanabilir')}
      ${stat('Eksik gün', me.missing.length, me.missing.length ? 'efor girilmemiş iş günü' : 'her şey tamam')}
    </div>

    <div class="split">
      <section class="card">
        <div class="card-head"><h2>Bu hafta</h2><a href="#/efor/hafta">Haftalık çizelge →</a></div>
        <div class="week-bars">${me.week.map((w) => `<button type="button" class="wb ${w.workday ? '' : 'off'} ${w.date === d.today ? 'today' : ''}" data-day="${w.date}"
            title="${esc(w.holiday || '')}">
            <span class="wb-val">${w.hours ? hrs(w.hours) : ''}</span>
            <span class="wb-bar" style="--goal:${Math.round((HOURS_PER_DAY / maxWeek) * 100)}%"><span style="height:${Math.round((w.hours / maxWeek) * 100)}%"></span></span>
            <span class="wb-day">${dayShort(w.date)}</span></button>`).join('')}</div>
        <p class="hint">Bir güne tıklayarak efor girebilirsiniz. Gri çizgi = ${HOURS_PER_DAY} saat.</p>
      </section>
      <section class="card">
        <h2>Eksik efor</h2>
        ${me.missing.length ? `<p class="hint" style="margin:-6px 0 10px">Bu ay efor girilmemiş iş günleri:</p>
          <div class="chips">${me.missing.map((m) => `<button type="button" class="chip" data-day="${m}">${fmtDate(m).slice(0, 5)} ${dayShort(m)}</button>`).join('')}</div>`
          : '<div class="empty">Bu ay eksik gününüz yok. 👍</div>'}
      </section>
    </div>

    ${isAdmin() ? `
    <section class="card">
      <div class="card-head"><h2>Bütçe · ${monthLabel(d.month)}</h2><a href="#/butce">Bütçe ekranı →</a></div>
      ${d.budget.length ? `<div class="budget-cards">${d.budget.map((b) => `<div class="budget-card">
        <div class="small">${b.currency}</div>
        <div class="bc-row"><span>Plan</span><b>${b.planned_amount ? money(b.planned_amount, b.currency) : '—'}</b></div>
        <div class="bc-row"><span>Gerçekleşen</span><b>${money(b.actual_amount, b.currency)}</b></div>
        <div class="bc-row"><span>Ay sonu tahmini</span><b>${b.forecast_amount == null ? '—' : money(b.forecast_amount, b.currency)}</b></div>
        ${b.forecast_pct == null ? '' : `<div class="progress"><span style="width:${Math.min(100, Math.round(b.forecast_pct * 100))}%" class="${b.forecast_pct >= 1 ? 'over' : ''}"></span></div>
          <div class="small">Tahmin / plan: ${pct(b.forecast_pct)}</div>`}
      </div>`).join('')}</div>` : '<div class="empty">Bu ay için plan veya faturalanabilir efor yok.</div>'}
    </section>
    <div class="split">
      <section class="card"><h2>En çok çalışılan müşteriler</h2>
        ${d.top_customers.length ? `<table><thead><tr><th>Müşteri</th><th class="num">Saat</th><th class="num">Adam-gün</th></tr></thead>
          <tbody>${d.top_customers.map((c) => `<tr><td><a href="#/musteriler/${c.id}">${esc(c.name)}</a></td><td class="num">${hrs(c.hours)}</td><td class="num">${hrs(c.days)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Bu ay kayıt yok.</div>'}</section>
      <section class="card"><h2>Ekip</h2>
        ${d.team.length ? `<table><thead><tr><th>Kişi</th><th class="num">Bu ay saat</th><th class="num">Eksik gün</th></tr></thead>
          <tbody>${d.team.map((u) => `<tr><td>${esc(u.full_name)}</td><td class="num">${hrs(u.month_hours)}</td>
            <td class="num">${u.missing ? `<span class="neg">${u.missing}</span>` : '0'}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Henüz ekip üyesi eklenmedi.</div>'}</section>
    </div>` : ''}`;

  main.onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (b) openEntryDialog({ date: b.dataset.day, onChange: pageHome });
  };
}
