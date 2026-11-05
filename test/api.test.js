const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
let admin;
let ayse;
const ids = {};
const projectCompany = {};
const activity = (project_id, hours, extra = {}) => ({ date: '2026-11-02', company_id: projectCompany[project_id], project_id, description: 'İş', hours, billable: true, ...extra });
const project = async (company_id, name, extra = {}) => {
  const id = (await admin('POST', '/api/projects', { company_id, name, ...extra })).data.id;
  projectCompany[id] = company_id;
  return id;
};

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  ayse = client(srv.base);

  assert.equal((await admin('POST', '/api/setup', { company_name: 'Test AŞ', full_name: 'Yönetici', username: 'admin', password: 'secret123' })).status, 200);

  // Acme Holding: günlük 16.000 TL; ilk şirket otomatik (stopajlı), ikinci şirket kendi ücretiyle (24.000)
  const acme = (await admin('POST', '/api/customers', {
    name: 'Acme Holding', daily_rate: '16000', currency: 'TRY', payment_days: '45',
    company_name: 'Acme Enerji A.Ş.', tax_no: '1234567890', withholding: true,
  })).data;
  ids.acme = acme.id;
  ids.enerji = acme.company_id;
  ids.lojistik = (await admin('POST', '/api/companies', { customer_id: ids.acme, name: 'Acme Lojistik Ltd.', daily_rate: '24000' })).data.id;

  // Global GmbH: EUR, KDV uygulanmaz
  const global = (await admin('POST', '/api/customers', { name: 'Global GmbH', daily_rate: '800', currency: 'EUR', vat_exempt: true })).data;
  ids.global = global.id;
  ids.globalCo = global.company_id;

  ids.web = await project(ids.enerji, 'Web Sitesi');
  ids.ozel = await project(ids.enerji, 'Özel Proje', { daily_rate: '20000' });
  ids.depo = await project(ids.lojistik, 'Depo Sistemi');
  ids.eu = await project(ids.globalCo, 'EU Rollout');
  ids.ayse = (await admin('POST', '/api/users', { full_name: 'Ayşe Çalışan', username: 'ayse', password: 'secret234', role: 'user' })).data.id;

  ids.act1 = (await admin('POST', '/api/activities', activity(ids.web, 4))).data.id;           // 4/8 × 16000 = 8000 TRY
  await admin('POST', '/api/activities', activity(ids.ozel, 2));                                // 2/8 × 20000 = 5000 TRY
  await admin('POST', '/api/activities', activity(ids.web, 1, { billable: false }));            // faturasız
  await admin('POST', '/api/activities', activity(ids.eu, 8));                                  // 8/8 × 800 = 800 EUR
  await admin('POST', '/api/expenses', { date: '2026-11-02', company_id: ids.enerji, project_id: ids.web, category: 'Ulaşım', amount: '500', currency: 'TRY', vat_rate: '20', billable: true });
  await admin('POST', '/api/expenses', { date: '2026-11-02', company_id: ids.globalCo, project_id: ids.eu, category: 'Konaklama', amount: '100', currency: 'EUR', vat_rate: '0', billable: true });

  assert.equal((await ayse('POST', '/api/login', { username: 'ayse', password: 'secret234' })).status, 200);
  ids.ayseAct = (await ayse('POST', '/api/activities', activity(ids.depo, 8))).data.id;     // 8/8 × 24000 = 24000 TRY
});

after(() => srv.close());

test('kurulum yalnızca bir kez yapılabilir', async () => {
  const r = await admin('POST', '/api/setup', { full_name: 'X', username: 'x', password: 'secret999' });
  assert.equal(r.status, 400);
});

test('yeni müşteri ilk şirketiyle oluşur; şirket ücret, para birimi ve vadeyi müşteriden devralır', async () => {
  const { data } = await admin('GET', '/api/companies');
  const enerji = data.find((c) => c.id === ids.enerji);
  assert.equal(enerji.customer_name, 'Acme Holding');
  assert.equal(enerji.tax_no, '1234567890');
  assert.equal(enerji.daily_rate, null);
  assert.equal(enerji.effective_daily_rate, 16000);
  assert.equal(enerji.effective_currency, 'TRY');
  assert.equal(enerji.effective_payment_days, 45);
  const lojistik = data.find((c) => c.id === ids.lojistik);
  assert.equal(lojistik.effective_daily_rate, 24000);
});

test('ücret önceliği proje → şirket → müşteri; aktivitede günlük ücret ve para birimi sabitlenir', async () => {
  const { data } = await admin('GET', '/api/activities');
  const rate = (pid) => data.find((a) => a.project_id === pid);
  assert.equal(rate(ids.web).daily_rate, 16000);     // müşteriden
  assert.equal(rate(ids.ozel).daily_rate, 20000);    // projeden
  assert.equal(rate(ids.depo).daily_rate, 24000);    // şirketten
  assert.equal(rate(ids.eu).currency, 'EUR');
  assert.equal(rate(ids.eu).customer_name, 'Global GmbH');
  assert.equal(rate(ids.eu).company_name, 'Global GmbH');
});

test('müşteri ücreti sonradan değişince eski aktiviteler etkilenmez, yenileri yeni ücretle girilir', async () => {
  await admin('PUT', `/api/customers/${ids.acme}`, { name: 'Acme Holding', daily_rate: '18000', currency: 'TRY', payment_days: '45' });
  const id = (await admin('POST', '/api/activities', activity(ids.web, 1, { date: '2026-12-01' }))).data.id;
  const { data } = await admin('GET', '/api/activities');
  assert.equal(data.find((a) => a.id === ids.act1).daily_rate, 16000);
  assert.equal(data.find((a) => a.id === id).daily_rate, 18000);
  await admin('DELETE', `/api/activities/${id}`);
  await admin('PUT', `/api/customers/${ids.acme}`, { name: 'Acme Holding', daily_rate: '16000', currency: 'TRY', payment_days: '45' });
});

test('şirkete farklı para birimi verilirse projeleri o para birimiyle çalışır', async () => {
  const co = (await admin('POST', '/api/companies', { customer_id: ids.acme, name: 'Acme USA Inc.', currency: 'USD', daily_rate: '1000' })).data.id;
  const p = await project(co, 'US');
  const { data } = await admin('GET', '/api/projects');
  assert.equal(data.find((x) => x.id === p).currency, 'USD');
  assert.equal(data.find((x) => x.id === ids.web).currency, 'TRY');
});

test('muhasebe raporu para birimlerini ayrı toplar; KDV muafiyeti ve stopaj şirket bazında uygulanır', async () => {
  const { data } = await admin('GET', '/api/report?from=2026-11-01&to=2026-11-30');
  assert.deepEqual(data.effort, { hours: 23, billable_hours: 22, days: 2.75 });

  const [tryTotal, eurTotal] = data.totals;
  assert.deepEqual(tryTotal, {
    currency: 'TRY', hours: 15, billable_hours: 14, days: 1.75, fee: 37000, expenses: 500, vat_base: 37500,
    vat: 7500, withholding_amount: 2600, invoice_total: 45000, net: 42400,
  });
  assert.deepEqual(eurTotal, {
    currency: 'EUR', hours: 8, billable_hours: 8, days: 1, fee: 800, expenses: 100, vat_base: 900,
    vat: 0, withholding_amount: 0, invoice_total: 900, net: 900,
  });

  const acme = data.customers.find((c) => c.name === 'Acme Holding');
  assert.deepEqual(acme.companies.map((c) => c.name), ['Acme Enerji A.Ş.', 'Acme Lojistik Ltd.']);
  const enerji = acme.companies[0];
  assert.equal(enerji.totals[0].fee, 13000);                 // 8000 + 5000
  assert.equal(enerji.totals[0].withholding_amount, 2600);   // stopajlı
  assert.equal(acme.companies[1].totals[0].withholding_amount, 0);
  assert.equal(acme.totals[0].fee, 37000);
  assert.deepEqual(data.users.find((u) => u.name === 'Ayşe Çalışan').fees, { TRY: 24000 });
});

test('müşteri ve şirket filtresi çalışır', async () => {
  const byCustomer = (await admin('GET', `/api/activities?customer_id=${ids.global}`)).data;
  assert.deepEqual([...new Set(byCustomer.map((a) => a.customer_name))], ['Global GmbH']);
  const byCompany = (await admin('GET', `/api/activities?company_id=${ids.lojistik}`)).data;
  assert.equal(byCompany.length, 1);
  assert.equal(byCompany[0].company_name, 'Acme Lojistik Ltd.');
});

test('iletişim kişileri müşteriye veya o müşterinin şirketine bağlanır', async () => {
  const groupContact = await admin('POST', '/api/contacts', { customer_id: ids.acme, full_name: 'Ali Satın', title: 'Satın Alma', email: 'ali@acme.com', receives_offers: true });
  assert.equal(groupContact.status, 200);
  const coContact = await admin('POST', '/api/contacts', { customer_id: ids.acme, company_id: ids.lojistik, full_name: 'Veli Muhasebe', receives_invoices: true });
  assert.equal(coContact.status, 200);
  const wrong = await admin('POST', '/api/contacts', { customer_id: ids.acme, company_id: ids.globalCo, full_name: 'Yanlış' });
  assert.equal(wrong.status, 400);
  const badMail = await admin('POST', '/api/contacts', { customer_id: ids.acme, full_name: 'X', email: 'gecersiz' });
  assert.equal(badMail.status, 400);

  const { data } = await admin('GET', `/api/contacts?customer_id=${ids.acme}`);
  assert.deepEqual(data.map((c) => [c.full_name, c.company_name]), [['Ali Satın', null], ['Veli Muhasebe', 'Acme Lojistik Ltd.']]);

  assert.equal((await admin('DELETE', `/api/contacts/${groupContact.data.id}`)).status, 200);
  const log = (await admin('GET', '/api/audit?entity=contacts')).data;
  assert.deepEqual(log.map((r) => r.action), ['delete', 'create', 'create']);
});

test('çalışan yalnızca kendi kayıtlarını görür; ücret, kişi ve rapora erişemez', async () => {
  const { data } = await ayse('GET', '/api/activities');
  assert.equal(data.length, 1);
  assert.equal('daily_rate' in data[0], false);
  assert.equal((await ayse('GET', '/api/report')).status, 403);
  assert.equal((await ayse('GET', '/api/contacts')).status, 403);
  assert.equal((await ayse('POST', '/api/customers', { name: 'X', daily_rate: 1, currency: 'TRY' })).status, 403);
  const companies = (await ayse('GET', '/api/companies')).data;
  assert.equal('effective_daily_rate' in companies[0], false);
  assert.equal((await ayse('GET', '/api/audit')).status, 403);
  assert.equal((await ayse('GET', '/api/admin/backup.db')).status, 403);
});

test('pasif şirketin projesine çalışan kayıt giremez', async () => {
  const co = (await admin('POST', '/api/companies', { customer_id: ids.acme, name: 'Kapanan Şirket' })).data.id;
  const p = await project(co, 'Eski');
  await admin('PUT', `/api/companies/${co}`, { customer_id: ids.acme, name: 'Kapanan Şirket', active: false });
  const r = await ayse('POST', '/api/activities', activity(p, 1));
  assert.equal(r.status, 400);
  assert.match(r.data.error, /pasif/);
});

test('geçersiz para birimi ve süre reddedilir', async () => {
  assert.equal((await admin('POST', '/api/customers', { name: 'X', daily_rate: '1', currency: 'GBP' })).status, 400);
  assert.equal((await admin('POST', '/api/customers', { name: 'X', currency: 'TRY' })).status, 400); // ücret zorunlu
  const r = await ayse('POST', '/api/activities', activity(ids.web, 30));
  assert.equal(r.status, 400);
  assert.match(r.data.error, /0 ile 24/);
});

test('çalışan başkasının kaydını değiştiremez veya silemez', async () => {
  assert.equal((await ayse('PUT', `/api/activities/${ids.act1}`, activity(ids.web, 1))).status, 403);
  assert.equal((await ayse('DELETE', `/api/activities/${ids.act1}`)).status, 403);
});

test('işlem kaydı ekleme, güncelleme ve silmeyi eski/yeni değerlerle tutar', async () => {
  await ayse('PUT', `/api/activities/${ids.ayseAct}`, activity(ids.depo, 6));
  await ayse('DELETE', `/api/activities/${ids.ayseAct}`);
  const { data } = await admin('GET', `/api/audit?entity=activities&user_id=${ids.ayse}`);
  assert.deepEqual(data.filter((r) => r.entity_id === ids.ayseAct).map((r) => r.action), ['delete', 'update', 'create']);
  const update = data.find((r) => r.action === 'update' && r.entity_id === ids.ayseAct);
  assert.deepEqual(update.details, { hours: [8, 6] });
});

test('işlem kaydında parola özeti yer almaz; parola sıfırlanınca oturumlar kapanır', async () => {
  await admin('PUT', `/api/users/${ids.ayse}`, { full_name: 'Ayşe Çalışan', username: 'ayse', role: 'user', active: true, password: 'yeniparola' });
  const { data } = await admin('GET', '/api/audit?entity=users&limit=500');
  assert.ok(data.some((r) => r.action === 'password_reset'));
  assert.ok(!JSON.stringify(data).includes('password_hash'));
  assert.equal((await ayse('GET', '/api/me')).status, 401);
});

test('art arda hatalı girişte hesap geçici olarak kilitlenir', async () => {
  await admin('POST', '/api/users', { full_name: 'Deneme', username: 'deneme', password: 'dogruparola' });
  const guest = client(srv.base);
  for (let i = 0; i < 5; i++) {
    assert.equal((await guest('POST', '/api/login', { username: 'deneme', password: 'yanlis' })).status, 401);
  }
  assert.equal((await guest('POST', '/api/login', { username: 'deneme', password: 'dogruparola' })).status, 429);
});

test('başka siteden gelen değişiklik istekleri reddedilir', async () => {
  const r = await admin('POST', '/api/customers', { name: 'Kötü', daily_rate: 1, currency: 'TRY' }, { Origin: 'https://kotu-site.example' });
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

test('aktivite projesiz girilebilir; ücret şirketten/müşteriden gelir', async () => {
  const r = await admin('POST', '/api/activities', { date: '2026-12-02', company_id: ids.lojistik, description: 'Toplantı', hours: 4, billable: true });
  assert.equal(r.status, 200);
  const a = (await admin('GET', '/api/activities?from=2026-12-02&to=2026-12-02')).data[0];
  assert.equal(a.project_id, null);
  assert.equal(a.project_name, null);
  assert.equal(a.company_name, 'Acme Lojistik Ltd.');
  assert.equal(a.daily_rate, 24000);
  const rep = (await admin('GET', '/api/report?from=2026-12-02&to=2026-12-02')).data;
  assert.equal(rep.customers[0].companies[0].projects[0].name, 'Proje dışı');
  assert.equal(rep.totals[0].fee, 12000);
  await admin('DELETE', `/api/activities/${r.data.id}`);
});

test('seçilen proje başka şirkete aitse kayıt reddedilir', async () => {
  const r = await admin('POST', '/api/activities', { date: '2026-12-02', company_id: ids.lojistik, project_id: ids.web, description: 'x', hours: 1 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /şirkete ait değil/);
});

test('çalışan başkası adına kayıt giremez; kaydı giren kullanıcı yazılır', async () => {
  const user = client(srv.base);
  await admin('POST', '/api/users', { full_name: 'Zeynep', username: 'zeynep', password: 'secret345' });
  await user('POST', '/api/login', { username: 'zeynep', password: 'secret345' });
  const me = (await user('GET', '/api/me')).data;
  const id = (await user('POST', '/api/activities', activity(ids.web, 1, { user_id: 1 }))).data.id;
  const a = (await admin('GET', '/api/activities')).data.find((x) => x.id === id);
  assert.equal(a.user_id, me.id);
  assert.equal(a.user_name, 'Zeynep');
  // Yönetici başka kullanıcı adına girebilir
  const id2 = (await admin('POST', '/api/activities', activity(ids.web, 1, { user_id: me.id }))).data.id;
  assert.equal((await admin('GET', '/api/activities')).data.find((x) => x.id === id2).user_id, me.id);
  await admin('DELETE', `/api/activities/${id}`);
  await admin('DELETE', `/api/activities/${id2}`);
});

test('VKN / TCKN en fazla 11 karakter, yalnızca rakam ve harf', async () => {
  const base = { customer_id: ids.acme, name: 'Vergi Testi' };
  assert.equal((await admin('POST', '/api/companies', { ...base, tax_no: '123456789012' })).status, 400);
  assert.equal((await admin('POST', '/api/companies', { ...base, tax_no: '1234-5678' })).status, 400);
  assert.equal((await admin('POST', '/api/customers', { name: 'Y', daily_rate: 1, currency: 'TRY', tax_no: '123456789012' })).status, 400);
  const tckn = await admin('POST', '/api/companies', { ...base, tax_no: '12345678901' });
  assert.equal(tckn.status, 200);
  const foreign = await admin('POST', '/api/companies', { ...base, tax_no: 'DE 123456789' });
  assert.equal(foreign.status, 200);
  const list = (await admin('GET', '/api/companies')).data;
  assert.equal(list.find((c) => c.id === foreign.data.id).tax_no, 'DE123456789');
});
