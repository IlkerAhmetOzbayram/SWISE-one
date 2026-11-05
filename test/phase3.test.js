// Faz 3: roller ve yetkiler, onay akışları, ay kapanışı, personel ve KVKK
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
let admin;
const ids = {};
const u = {};
const act = (date, company_id, hours = 2) => ({ date, company_id, description: 'İş', hours, billable: true });

async function login(username, password) {
  const c = client(srv.base);
  const r = await c('POST', '/api/login', { username, password });
  assert.equal(r.status, 200, `${username} giriş yapamadı`);
  return c;
}

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin('POST', '/api/setup', { full_name: 'Yönetici', username: 'admin', password: 'secret123' });
  const roles = (await admin('GET', '/api/roles')).data;
  for (const r of roles) ids[r.name] = r.id;

  ids.pmUser = (await admin('POST', '/api/users', { full_name: 'Proje Yöneticisi Pelin', username: 'pelin', password: 'parola123', role_id: ids['Proje Yöneticisi'] })).data.id;
  ids.accUser = (await admin('POST', '/api/users', { full_name: 'Muhasebe Mert', username: 'mert', password: 'parola123', role_id: ids.Muhasebe })).data.id;
  ids.empUser = (await admin('POST', '/api/users', { full_name: 'Çalışan Ece', username: 'ece', password: 'parola123' })).data.id;

  const a = (await admin('POST', '/api/customers', { name: 'Atanmış AŞ', daily_rate: '16000', currency: 'TRY', manager_id: ids.pmUser })).data;
  const b = (await admin('POST', '/api/customers', { name: 'Başka Ltd', daily_rate: '8000', currency: 'TRY' })).data;
  Object.assign(ids, { custA: a.id, coA: a.company_id, custB: b.id, coB: b.company_id });

  u.pm = await login('pelin', 'parola123');
  u.acc = await login('mert', 'parola123');
  u.emp = await login('ece', 'parola123');

  await u.emp('POST', '/api/activities', act('2026-11-02', ids.coA, 4));
  await u.emp('POST', '/api/activities', act('2026-11-03', ids.coB, 3));
});

after(() => srv.close());

test('4 hazır rol oluşur; yeni personel varsayılan olarak Çalışan rolündedir', async () => {
  assert.deepEqual(Object.keys(ids).filter((k) => ['Yönetici', 'Muhasebe', 'Proje Yöneticisi', 'Çalışan'].includes(k)).length, 4);
  const ece = (await admin('GET', `/api/personnel/${ids.empUser}`)).data;
  assert.equal(ece.role_name, 'Çalışan');
  const me = (await u.emp('GET', '/api/me')).data;
  assert.deepEqual(me.perms, { 'activities.view': 'own', 'activities.edit': 'own', 'expenses.view': 'own', 'expenses.edit': 'own' });
});

test('proje yöneticisi yalnızca sorumlu olduğu müşterinin eforunu ve raporunu görür, ücret görmez', async () => {
  const acts = (await u.pm('GET', '/api/activities')).data;
  assert.deepEqual(acts.map((x) => x.customer_name), ['Atanmış AŞ']);
  assert.equal('daily_rate' in acts[0], false);
  assert.equal((await u.pm('GET', `/api/effort-report?customer_id=${ids.custA}`)).status, 200);
  assert.equal((await u.pm('GET', `/api/effort-report?customer_id=${ids.custB}`)).status, 403);
  assert.equal((await u.pm('GET', '/api/report')).status, 403);
  const customers = (await u.pm('GET', '/api/customers')).data;
  assert.equal('daily_rate' in customers[0], false);
  assert.equal((await u.pm('POST', '/api/customers', { name: 'X', daily_rate: 1, currency: 'TRY' })).status, 403);
});

test('muhasebe raporu ve maaşı görür; roller ve ay yeniden açma yetkisi yoktur', async () => {
  assert.equal((await u.acc('GET', '/api/report')).status, 200);
  assert.equal((await u.acc('GET', `/api/personnel/${ids.empUser}/sensitive`)).status, 200);
  assert.equal((await u.acc('PUT', `/api/roles/${ids['Çalışan']}`, { permissions: {} })).status, 403);
  assert.equal((await u.acc('POST', '/api/periods/reopen', { month: '2026-01' })).status, 403);
  assert.equal((await u.acc('POST', '/api/users', { full_name: 'X', username: 'x', password: 'parola123' })).status, 403);
});

test('özel rol: kopyalanarak oluşturulur, yetkisi hemen geçerli olur; kilitli rol ve kullanılan rol korunur', async () => {
  const r = await admin('POST', '/api/roles', { name: 'Raporcu', copy_from: ids['Çalışan'] });
  assert.equal(r.status, 200);
  const roles = (await admin('GET', '/api/roles')).data;
  const raporcu = roles.find((x) => x.id === r.data.id);
  assert.equal(raporcu.permissions['activities.view'], 'own');
  await admin('PUT', `/api/roles/${r.data.id}`, { name: 'Raporcu', permissions: { ...raporcu.permissions, 'reports.view': true, 'bilinmeyen.yetki': true } });
  const after = (await admin('GET', '/api/roles')).data.find((x) => x.id === r.data.id);
  assert.equal(after.permissions['reports.view'], true);
  assert.equal('bilinmeyen.yetki' in after.permissions, false);

  const id = (await admin('POST', '/api/users', { full_name: 'Rapor Rana', username: 'rana', password: 'parola123', role_id: r.data.id })).data.id;
  const rana = await login('rana', 'parola123');
  assert.equal((await rana('GET', '/api/report')).status, 200);
  assert.equal((await admin('DELETE', `/api/roles/${r.data.id}`)).status, 400); // kullanılıyor
  await admin('PUT', `/api/users/${id}`, { full_name: 'Rapor Rana', username: 'rana', role_id: ids['Çalışan'], active: true });
  assert.equal((await rana('GET', '/api/report')).status, 403);
  assert.equal((await admin('DELETE', `/api/roles/${r.data.id}`)).status, 200);

  assert.equal((await admin('PUT', `/api/roles/${ids['Yönetici']}`, { permissions: {} })).status, 400);
  assert.equal((await admin('DELETE', `/api/roles/${ids['Çalışan']}`)).status, 400);
});

test('masraf onayı: çalışanın masrafı onay bekler, raporda ayrı görünür; onaylanınca kilitlenir; ret gerekçe ister', async () => {
  const e = (await u.emp('POST', '/api/expenses', { date: '2026-11-04', company_id: ids.coA, category: 'Ulaşım', amount: '300', vat_rate: '20', billable: true })).data;
  assert.equal(e.status, 'pending');
  let rep = (await admin('GET', '/api/report?from=2026-11-01&to=2026-11-30')).data;
  assert.equal(rep.expense_summary.totals[0].billable, 0);
  assert.equal(rep.expense_summary.totals[0].pending, 300);

  assert.equal((await u.acc('POST', `/api/expenses/${e.id}/review`, { decision: 'rejected' })).status, 400);  // gerekçe yok
  assert.equal((await u.emp('POST', `/api/expenses/${e.id}/review`, { decision: 'approved' })).status, 403);
  assert.equal((await u.acc('POST', `/api/expenses/${e.id}/review`, { decision: 'approved' })).status, 200);
  rep = (await admin('GET', '/api/report?from=2026-11-01&to=2026-11-30')).data;
  assert.equal(rep.expense_summary.totals[0].billable, 300);

  const edit = await u.emp('PUT', `/api/expenses/${e.id}`, { date: '2026-11-04', company_id: ids.coA, category: 'Ulaşım', amount: '999', billable: true });
  assert.equal(edit.status, 423);

  const e2 = (await u.emp('POST', '/api/expenses', { date: '2026-11-05', company_id: ids.coA, category: 'Yemek', amount: '50', billable: true })).data;
  await u.acc('POST', `/api/expenses/${e2.id}/review`, { decision: 'rejected', note: 'Fiş eksik' });
  const mine = (await u.emp('GET', '/api/expenses')).data.find((x) => x.id === e2.id);
  assert.equal(mine.status, 'rejected');
  assert.equal(mine.review_note, 'Fiş eksik');
  // Düzeltip tekrar kaydedince yeniden onaya düşer
  const re = await u.emp('PUT', `/api/expenses/${e2.id}`, { date: '2026-11-05', company_id: ids.coA, category: 'Yemek', amount: '50', billable: true });
  assert.equal(re.data.status, 'pending');
});

test('haftalık onay: gönderilen hafta çalışana kilitlenir; geri gönderilince açılır; onaylanınca herkese kilitlenir', async () => {
  const week = '2026-11-09';
  const id = (await u.emp('POST', '/api/activities', act('2026-11-10', ids.coA, 5))).data.id;
  assert.equal((await u.emp('POST', '/api/timesheets/submit', { week_start: '2026-11-10' })).status, 400); // Pazartesi değil
  assert.equal((await u.emp('POST', '/api/timesheets/submit', { week_start: week })).status, 200);
  assert.equal((await u.emp('PUT', `/api/activities/${id}`, act('2026-11-10', ids.coA, 6))).status, 423);
  assert.equal((await u.emp('POST', '/api/activities', act('2026-11-11', ids.coA, 1))).status, 423);

  const pending = (await admin('GET', '/api/timesheets/pending')).data;
  const ts = pending.find((p) => p.user_id === ids.empUser && p.week_start === week);
  assert.equal(ts.hours, 5);
  assert.equal((await u.pm('GET', '/api/timesheets/pending')).status, 403);

  assert.equal((await admin('POST', `/api/timesheets/${ts.id}/review`, { decision: 'rejected' })).status, 400);
  await admin('POST', `/api/timesheets/${ts.id}/review`, { decision: 'rejected', note: 'Açıklamalar eksik' });
  const st = (await u.emp('GET', `/api/timesheets/week?week_start=${week}`)).data;
  assert.equal(st.status, 'rejected');
  assert.equal(st.timesheet.note, 'Açıklamalar eksik');
  assert.equal((await u.emp('PUT', `/api/activities/${id}`, act('2026-11-10', ids.coA, 6))).status, 200);

  await u.emp('POST', '/api/timesheets/submit', { week_start: week });
  const ts2 = (await admin('GET', '/api/timesheets/pending')).data.find((p) => p.user_id === ids.empUser);
  await admin('POST', `/api/timesheets/${ts2.id}/review`, { decision: 'approved' });
  assert.equal((await u.emp('DELETE', `/api/activities/${id}`)).status, 423);
  assert.equal((await admin('PUT', `/api/activities/${id}`, act('2026-11-10', ids.coA, 7))).status, 423);
  await admin('POST', `/api/timesheets/${ts2.id}/reopen`);
  assert.equal((await u.emp('PUT', `/api/activities/${id}`, act('2026-11-10', ids.coA, 7))).status, 200);
});

test('ay kapanışı: eksik onay uyarısı verir; kapalı ay herkese kilitlidir; yalnızca Yönetici yeniden açar', async () => {
  const check = await u.acc('POST', '/api/periods/close', { month: '2026-11' });
  assert.equal(check.status, 409);
  assert.ok(check.data.unapproved.length > 0);
  assert.equal((await u.acc('POST', '/api/periods/close', { month: '2026-11', force: true })).status, 200);
  assert.equal((await admin('POST', '/api/activities', act('2026-11-20', ids.coA))).status, 423);
  assert.equal((await u.emp('POST', '/api/expenses', { date: '2026-11-20', company_id: ids.coA, category: 'Ulaşım', amount: '1' })).status, 423);
  assert.equal((await u.emp('POST', '/api/activities', act('2026-12-01', ids.coA))).status, 200);   // sonraki ay açık
  assert.deepEqual((await u.emp('GET', '/api/periods')).data.map((p) => p.month), ['2026-11']);
  assert.equal((await admin('POST', '/api/periods/reopen', { month: '2026-11' })).status, 200);
  assert.equal((await admin('POST', '/api/activities', act('2026-11-20', ids.coA))).status, 200);
});

test('personel hassas bilgileri: yetkisiz göremez, başkasına bakış kaydedilir, IBAN işlem kaydına yazılmaz', async () => {
  assert.equal((await u.emp('GET', `/api/personnel/${ids.pmUser}/sensitive`)).status, 403);
  assert.equal((await admin('PUT', `/api/personnel/${ids.empUser}/sensitive`, { iban: 'TR12 3456' })).status, 400);
  const ibanValue = 'TR330006100519786457841326';
  assert.equal((await admin('PUT', `/api/personnel/${ids.empUser}/sensitive`, { iban: 'TR33 0006 1005 1978 6457 8413 26', emergency_name: 'Ali', emergency_phone: '555' })).status, 200);
  await admin('POST', `/api/personnel/${ids.empUser}/salaries`, { effective_date: '2026-01-01', gross: '60000', net: '45000' });

  const s = (await u.acc('GET', `/api/personnel/${ids.empUser}/sensitive`)).data;
  assert.equal(s.iban, ibanValue);
  assert.equal(s.salaries[0].gross, 60000);

  const log = JSON.stringify((await admin('GET', '/api/audit?limit=500')).data);
  assert.ok(!log.includes(ibanValue));
  assert.ok(!log.includes('60000'));
  const views = (await admin('GET', '/api/audit?entity=users&limit=500')).data.filter((r) => r.action === 'sensitive_view');
  assert.ok(views.some((r) => r.user_name === 'Muhasebe Mert' && r.entity_id === ids.empUser));
});

test('personel kendi maaşını yalnızca ayar açıksa görür', async () => {
  let own = (await u.emp('GET', `/api/personnel/${ids.empUser}/sensitive`)).data;
  assert.equal(own.salaries, null);
  assert.equal(own.iban, 'TR330006100519786457841326');
  const s = (await admin('GET', '/api/settings')).data;
  await admin('PUT', '/api/settings', { ...s, show_own_salary: true });
  own = (await u.emp('GET', `/api/personnel/${ids.empUser}/sensitive`)).data;
  assert.equal(own.salaries.length, 1);
});

test('anonimleştirme yalnızca ayrılmış ve pasif personelde; maaş geçmişi korunur', async () => {
  assert.equal((await admin('POST', `/api/personnel/${ids.empUser}/anonymize`)).status, 400);
  await admin('PUT', `/api/users/${ids.empUser}`, { full_name: 'Çalışan Ece', username: 'ece', end_date: '2026-12-31', active: false, email: 'ece@x.com' });
  assert.equal((await u.emp('GET', '/api/me')).status, 401);   // pasif olunca oturum kapanır
  assert.equal((await admin('POST', `/api/personnel/${ids.empUser}/anonymize`)).status, 200);
  const s = (await admin('GET', `/api/personnel/${ids.empUser}/sensitive`)).data;
  assert.equal(s.iban, '');
  assert.equal(s.emergency_name, '');
  assert.ok(s.anonymized_at);
  assert.equal(s.salaries.length, 1);
  assert.equal((await admin('GET', `/api/personnel/${ids.empUser}`)).data.email, '');
});

test('hesap güvenliği: parola en az 8 karakter; son Yönetici pasifleştirilemez; oturumlar topluca kapatılabilir', async () => {
  assert.equal((await admin('POST', '/api/users', { full_name: 'K', username: 'kisa', password: 'abc1234' })).status, 400);
  const me = (await admin('GET', '/api/me')).data;
  assert.equal((await admin('PUT', `/api/users/${me.id}`, { full_name: 'Yönetici', username: 'admin', active: false })).status, 400);
  assert.equal((await admin('PUT', `/api/users/${me.id}`, { full_name: 'Yönetici', username: 'admin', role_id: ids['Çalışan'], active: true })).status, 400);
  const r = await admin('POST', `/api/users/${ids.pmUser}/logout-all`);
  assert.equal(r.data.closed, 1);
  assert.equal((await u.pm('GET', '/api/me')).status, 401);
});
