const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
let admin;
let ayse;
const ids = {};

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  ayse = client(srv.base);

  assert.equal((await admin('POST', '/api/setup', { company_name: 'Test AŞ', full_name: 'Yönetici', username: 'admin', password: 'secret1' })).status, 200);
  ids.acme = (await admin('POST', '/api/clients', { name: 'Acme Ltd', tax_no: '1234567890', default_rate: '2000', withholding: true })).data.id;
  ids.bireysel = (await admin('POST', '/api/clients', { name: 'Bireysel Müşteri' })).data.id;
  ids.web = (await admin('POST', '/api/projects', { client_id: ids.acme, name: 'Web Sitesi', hourly_rate: '' })).data.id;
  ids.danis = (await admin('POST', '/api/projects', { client_id: ids.bireysel, name: 'Danışmanlık', hourly_rate: '1500' })).data.id;
  ids.ayse = (await admin('POST', '/api/users', { full_name: 'Ayşe Çalışan', username: 'ayse', password: 'secret2', role: 'user', hourly_rate: '1000' })).data.id;

  ids.act1 = (await admin('POST', '/api/activities', { date: '2026-11-01', project_id: ids.web, description: 'Tasarım', hours: 2.5, billable: true })).data.id;
  await admin('POST', '/api/activities', { date: '2026-11-02', project_id: ids.danis, description: 'Toplantı', hours: 1, billable: true });
  await admin('POST', '/api/activities', { date: '2026-11-02', project_id: ids.web, description: 'İç iş', hours: 1, billable: false });
  await admin('POST', '/api/expenses', { date: '2026-11-02', project_id: ids.web, category: 'Ulaşım', amount: '500', vat_rate: '20', billable: true });
  await admin('POST', '/api/expenses', { date: '2026-11-02', project_id: ids.danis, category: 'Yazılım/Lisans', amount: '100', vat_rate: '20', billable: false });

  assert.equal((await ayse('POST', '/api/login', { username: 'ayse', password: 'secret2' })).status, 200);
  ids.ayseAct = (await ayse('POST', '/api/activities', { date: '2026-11-02', project_id: ids.web, description: 'Kodlama', hours: 3, billable: true })).data.id;
});

after(() => srv.close());

test('kurulum yalnızca bir kez yapılabilir', async () => {
  const r = await admin('POST', '/api/setup', { full_name: 'X', username: 'x', password: 'secret9' });
  assert.equal(r.status, 400);
});

test('muhasebe raporu KDV, stopaj ve net tahsilatı doğru hesaplar', async () => {
  const { data } = await admin('GET', '/api/report?from=2026-11-01&to=2026-11-30');
  assert.deepEqual(data.totals, {
    hours: 7.5, billable_hours: 6.5, fee: 12500, expenses: 500, vat_base: 13000,
    vat: 2600, withholding_amount: 2200, invoice_total: 15600, net: 13400,
  });
  const acme = data.clients.find((c) => c.name === 'Acme Ltd');
  // Ayşe'nin ücreti 1000 ama müşteri varsayılanı (2000) önceliklidir: 5,5 sa × 2000
  assert.equal(acme.fee, 11000);
  assert.equal(acme.withholding_amount, 2200);
  assert.equal(acme.net, 11600);
  const bireysel = data.clients.find((c) => c.name === 'Bireysel Müşteri');
  assert.equal(bireysel.withholding_amount, 0);
  assert.equal(data.expense_summary.input_vat, 120);
});

test('çalışan yalnızca kendi kayıtlarını görür ve ücretleri göremez', async () => {
  const { data } = await ayse('GET', '/api/activities');
  assert.equal(data.length, 1);
  assert.equal('rate' in data[0], false);
  assert.equal((await ayse('GET', '/api/report')).status, 403);
  assert.equal((await ayse('GET', '/api/audit')).status, 403);
  assert.equal((await ayse('GET', '/api/admin/backup.db')).status, 403);
});

test('çalışan başkasının kaydını değiştiremez veya silemez', async () => {
  const body = { date: '2026-11-01', project_id: ids.web, description: 'x', hours: 1, billable: true };
  assert.equal((await ayse('PUT', `/api/activities/${ids.act1}`, body)).status, 403);
  assert.equal((await ayse('DELETE', `/api/activities/${ids.act1}`)).status, 403);
});

test('geçersiz süre reddedilir', async () => {
  const r = await ayse('POST', '/api/activities', { date: '2026-11-02', project_id: ids.web, description: 'x', hours: 30, billable: true });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /0 ile 24/);
});

test('işlem kaydı ekleme, güncelleme ve silmeyi eski/yeni değerlerle tutar', async () => {
  await ayse('PUT', `/api/activities/${ids.ayseAct}`, { date: '2026-11-02', project_id: ids.web, description: 'Kodlama', hours: 4, billable: true });
  await ayse('DELETE', `/api/activities/${ids.ayseAct}`);

  const { data } = await admin('GET', `/api/audit?entity=activities&user_id=${ids.ayse}`);
  const forRecord = data.filter((r) => r.entity_id === ids.ayseAct).map((r) => r.action);
  assert.deepEqual(forRecord, ['delete', 'update', 'create']);
  const update = data.find((r) => r.action === 'update' && r.entity_id === ids.ayseAct);
  assert.deepEqual(update.details, { hours: [3, 4] });
  assert.equal(update.user_name, 'Ayşe Çalışan');
});

test('işlem kaydında parola özeti yer almaz', async () => {
  await admin('PUT', `/api/users/${ids.ayse}`, { full_name: 'Ayşe Çalışan', username: 'ayse', role: 'user', hourly_rate: '1100', active: true, password: 'yeniparola' });
  const { data } = await admin('GET', '/api/audit?entity=users&limit=500');
  assert.ok(data.some((r) => r.action === 'password_reset'));
  assert.ok(!JSON.stringify(data).includes('password_hash'));
  const update = data.find((r) => r.action === 'update' && r.entity_id === ids.ayse);
  assert.deepEqual(update.details, { hourly_rate: [1000, 1100] });
});

test('parola sıfırlanınca kullanıcının oturumları kapanır', async () => {
  assert.equal((await ayse('GET', '/api/me')).status, 401);
});

test('art arda hatalı girişte hesap geçici olarak kilitlenir', async () => {
  await admin('POST', '/api/users', { full_name: 'Deneme', username: 'deneme', password: 'dogruparola' });
  const guest = client(srv.base);
  for (let i = 0; i < 5; i++) {
    assert.equal((await guest('POST', '/api/login', { username: 'deneme', password: 'yanlis' })).status, 401);
  }
  const locked = await guest('POST', '/api/login', { username: 'deneme', password: 'dogruparola' });
  assert.equal(locked.status, 429);
  const { data } = await admin('GET', '/api/audit?entity=users&limit=500');
  assert.ok(data.filter((r) => r.action === 'login_failed').length >= 5);
});

test('başka siteden gelen değişiklik istekleri reddedilir', async () => {
  const r = await admin('POST', '/api/clients', { name: 'Kötü' }, { Origin: 'https://kotu-site.example' });
  assert.equal(r.status, 403);
});

test('güvenlik başlıkları gönderilir', async () => {
  const r = await admin('GET', '/api/me');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('Excel raporu üretilir', async () => {
  const r = await admin('GET', '/api/report.xlsx?from=2026-11-01&to=2026-11-30');
  assert.equal(r.status, 200);
  assert.equal(r.data.subarray(0, 2).toString(), 'PK');
});

test('yönetici veritabanı yedeğini indirebilir', async () => {
  const r = await admin('GET', '/api/admin/backup.db');
  assert.equal(r.status, 200);
  assert.equal(r.data.subarray(0, 15).toString(), 'SQLite format 3');
});
