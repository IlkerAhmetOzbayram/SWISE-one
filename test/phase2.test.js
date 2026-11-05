// Faz 2: iş günleri, tatiller, aylık plan, bütçe tahmini, müşteri efor raporu, ana sayfa
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');
const { businessDays, monthRange } = require('../src/lib/workdays');

let srv;
let admin;
let ayse;
const ids = {};
const act = (date, company_id, hours, extra = {}) => ({ date, company_id, description: 'İş', hours, billable: true, ...extra });

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  ayse = client(srv.base);
  await admin('POST', '/api/setup', { full_name: 'Yönetici', username: 'admin', password: 'secret123' });
  const abc = (await admin('POST', '/api/customers', { name: 'ABC Holding', daily_rate: '16000', currency: 'TRY', company_name: 'ABC Enerji' })).data;
  ids.abc = abc.id;
  ids.enerji = abc.company_id;
  ids.lojistik = (await admin('POST', '/api/companies', { customer_id: ids.abc, name: 'ABC Lojistik', daily_rate: '24000' })).data.id;
  ids.depo = (await admin('POST', '/api/projects', { company_id: ids.lojistik, name: 'Depo' })).data.id;
  const eu = (await admin('POST', '/api/customers', { name: 'Global GmbH', daily_rate: '800', currency: 'EUR' })).data;
  ids.eu = eu.id;
  ids.euCo = eu.company_id;
  ids.ayse = (await admin('POST', '/api/users', { full_name: 'Ayşe', username: 'ayse', password: 'secret234' })).data.id;
  await ayse('POST', '/api/login', { username: 'ayse', password: 'secret234' });

  // Kasım 2026: ilk hafta
  await admin('POST', '/api/activities', act('2026-11-02', ids.enerji, 8));                                 // 1 gün × 16000
  await admin('POST', '/api/activities', act('2026-11-03', ids.lojistik, 4, { project_id: ids.depo }));     // 0,5 gün × 24000
  await admin('POST', '/api/activities', act('2026-11-03', ids.enerji, 2, { billable: false }));
  await admin('POST', '/api/activities', act('2026-11-04', ids.euCo, 8));                                   // 1 gün × 800 EUR
  await ayse('POST', '/api/activities', act('2026-11-02', ids.enerji, 8));                                  // 1 gün × 16000
});

after(() => srv.close());

test('iş günü: hafta sonu ve resmi tatiller düşülür, yarım gün tatil 0,5 sayılır', () => {
  assert.equal(businessDays(...monthRange('2026-11')), 21);
  assert.equal(businessDays(...monthRange('2026-05')), 15.5);  // 1 ve 19 Mayıs, arife yarım gün, 3 bayram günü
  assert.equal(businessDays(...monthRange('2026-10')), 20.5);  // 28 Ekim yarım gün, 29 Ekim
  assert.equal(businessDays('2026-11-07', '2026-11-08'), 0);   // hafta sonu
});

test('tatil eklenince iş günü sayısı düşer; aynı güne ikinci tatil reddedilir; yalnızca yönetici değiştirir', async () => {
  const before = (await admin('GET', '/api/workdays?from=2026-11-01&to=2026-11-30')).data.business_days;
  const r = await admin('POST', '/api/holidays', { date: '2026-11-27', name: 'Şirket izni', kind: 'full' });
  assert.equal(r.status, 200);
  assert.equal((await admin('GET', '/api/workdays?from=2026-11-01&to=2026-11-30')).data.business_days, before - 1);
  assert.equal((await admin('POST', '/api/holidays', { date: '2026-11-27', name: 'Tekrar' })).status, 400);
  assert.equal((await ayse('POST', '/api/holidays', { date: '2026-11-26', name: 'X' })).status, 403);
  assert.equal((await ayse('GET', '/api/holidays?year=2026')).status, 200);
  await admin('DELETE', `/api/holidays/${r.data.id}`);
  assert.equal((await admin('GET', '/api/workdays?from=2026-11-01&to=2026-11-30')).data.business_days, before);
});

test('plan: müşteri zorunlu, şirket/proje uyumlu olmalı, aynı hedefe ikinci plan reddedilir', async () => {
  const ok = await admin('POST', '/api/plans', { month: '2026-11', customer_id: ids.abc, planned_days: '10' });
  assert.equal(ok.status, 200);
  ids.plan = ok.data.id;
  assert.equal((await admin('POST', '/api/plans', { month: '2026-11', customer_id: ids.abc, planned_days: '5' })).status, 400);
  assert.equal((await admin('POST', '/api/plans', { month: '2026-11', customer_id: ids.abc, company_id: ids.euCo, planned_days: '1' })).status, 400);
  assert.equal((await admin('POST', '/api/plans', { month: '2026-11', customer_id: ids.abc, project_id: ids.depo, planned_days: '1' })).status, 400);
  assert.equal((await admin('POST', '/api/plans', { month: '2026-13', customer_id: ids.abc, planned_days: '1' })).status, 400);
  // Şirket bazında ayrı plan aynı müşteride olabilir
  const lojistik = await admin('POST', '/api/plans', { month: '2026-11', customer_id: ids.abc, company_id: ids.lojistik, planned_days: '2' });
  assert.equal(lojistik.status, 200);
  await admin('POST', '/api/plans', { month: '2026-11', customer_id: ids.eu, planned_days: '5' });
  assert.equal((await ayse('GET', '/api/plans?month=2026-11')).status, 403);
});

test('bütçe: plan tutarı geçerli ücretle, tahmin tempoyla hesaplanır', async () => {
  // 6 Kasım Cuma: 5 iş günü geçti, ayda 21 iş günü var
  const { data } = await admin('GET', '/api/budget?month=2026-11&today=2026-11-06');
  assert.deepEqual(data.business_days, { total: 21, elapsed: 5, remaining: 16 });
  const abc = data.rows.find((r) => r.customer_name === 'ABC Holding');
  // Plan: 10 gün × 16000 + 2 gün × 24000 (Lojistik)
  assert.equal(abc.planned_days, 12);
  assert.equal(abc.planned_amount, 208000);
  // Gerçekleşen (faturalanabilir): 8 sa + 8 sa @16000, 4 sa @24000 → 2,5 gün, 44000
  assert.equal(abc.actual_days, 2.5);
  assert.equal(abc.actual_amount, 44000);
  // Tahmin: × 21/5
  assert.equal(abc.forecast_days, 10.5);
  assert.equal(abc.forecast_amount, 184800);
  assert.equal(abc.forecast_pct, 0.89);
  const eu = data.rows.find((r) => r.currency === 'EUR');
  assert.equal(eu.planned_amount, 4000);
  assert.equal(eu.actual_amount, 800);
  assert.deepEqual(data.totals.map((t) => t.currency), ['TRY', 'EUR']);
});

test('bütçe: biten ayda tahmin = gerçekleşen, başlamamış ayda tahmin yok', async () => {
  const past = (await admin('GET', '/api/budget?month=2026-11&today=2026-12-15')).data;
  const abc = past.rows.find((r) => r.customer_name === 'ABC Holding');
  assert.equal(abc.forecast_amount, abc.actual_amount);
  const future = (await admin('GET', '/api/budget?month=2026-11&today=2026-10-20')).data;
  assert.equal(future.rows.find((r) => r.customer_name === 'ABC Holding').forecast_amount, null);
});

test('plan kopyalama: önceki ayın planları yeni aya aktarılır, var olanlar atlanır', async () => {
  const r = await admin('POST', '/api/plans/copy', { from_month: '2026-11', to_month: '2026-12' });
  assert.equal(r.data.copied, 3);
  const again = await admin('POST', '/api/plans/copy', { from_month: '2026-11', to_month: '2026-12' });
  assert.equal(again.data.copied, 0);
  assert.equal((await admin('GET', '/api/plans?month=2026-12')).data.length, 3);
});

test('müşteri efor raporu: ücret içermez, faturalanabilir/şirket filtresi çalışır', async () => {
  const { data } = await admin('GET', `/api/effort-report?customer_id=${ids.abc}&from=2026-11-01&to=2026-11-30`);
  assert.deepEqual(data.total, { hours: 20, days: 2.5 });
  assert.ok(!JSON.stringify(data).includes('daily_rate'));
  assert.deepEqual(data.by_user.map((u) => [u.user_name, u.hours]), [['Yönetici', 12], ['Ayşe', 8]]);
  const all = (await admin('GET', `/api/effort-report?customer_id=${ids.abc}&from=2026-11-01&to=2026-11-30&billable_only=0`)).data;
  assert.equal(all.total.hours, 22);
  const loj = (await admin('GET', `/api/effort-report?customer_id=${ids.abc}&company_id=${ids.lojistik}`)).data;
  assert.deepEqual(loj.by_target, [{ company_name: 'ABC Lojistik', project_name: 'Depo', hours: 4, days: 0.5 }]);
  const x = await admin('GET', `/api/effort-report.xlsx?customer_id=${ids.abc}`);
  assert.equal(x.status, 200);
  assert.equal(x.data.subarray(0, 2).toString(), 'PK');
  assert.equal((await ayse('GET', `/api/effort-report?customer_id=${ids.abc}`)).status, 403);
});

test('ana sayfa: kişinin haftası ve eksik günleri; yönetici ekip ve bütçe özetini görür', async () => {
  const me = (await ayse('GET', '/api/dashboard?today=2026-11-06')).data;
  assert.equal(me.me.week_hours, 8);
  assert.deepEqual(me.me.missing, ['2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(me.budget, undefined);
  assert.equal(me.team, undefined);

  const ad = (await admin('GET', '/api/dashboard?today=2026-11-06')).data;
  assert.deepEqual(ad.me.missing, ['2026-11-05']);
  assert.deepEqual(ad.team.map((u) => [u.full_name, u.month_hours, u.missing]), [['Ayşe', 8, 3], ['Yönetici', 22, 1]]);
  assert.equal(ad.top_customers[0].name, 'ABC Holding');
  assert.deepEqual(ad.budget.map((b) => b.currency), ['TRY', 'EUR']);
});
