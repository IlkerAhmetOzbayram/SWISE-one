// Faz 4: teklifler — numara, toplamlar, yetki, iç onay, PDF dondurma, imzalı dosya, gönderim, karar, revizyon
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swise-teklif-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
let admin;
let pm;
let emp;
const ids = {};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const item = (extra = {}) => ({ kind: 'service', description: 'Danışmanlık', quantity: 10, unit: 'gün', unit_price: 16000, ...extra });

async function login(username) {
  const c = client(srv.base);
  assert.equal((await c('POST', '/api/login', { username, password: 'parola123' })).status, 200);
  return c;
}
async function upload(c, offerId, name, buf) {
  const res = await fetch(`${srv.base}/api/offers/${offerId}/signed`, {
    method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), cookie: c.cookie },
  });
  return { status: res.status, data: await res.json() };
}

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin('POST', '/api/setup', { full_name: 'Yönetici', username: 'admin', password: 'secret123' });
  const roles = Object.fromEntries((await admin('GET', '/api/roles')).data.map((r) => [r.name, r.id]));
  ids.pm = (await admin('POST', '/api/users', { full_name: 'Pelin', username: 'pelin', password: 'parola123', role_id: roles['Proje Yöneticisi'] })).data.id;
  await admin('POST', '/api/users', { full_name: 'Ece', username: 'ece', password: 'parola123' });
  const a = (await admin('POST', '/api/customers', { name: 'ABC Holding', daily_rate: '16000', currency: 'TRY', manager_id: ids.pm, company_name: 'ABC Enerji A.Ş.' })).data;
  const g = (await admin('POST', '/api/customers', { name: 'Global GmbH', daily_rate: '800', currency: 'EUR', vat_exempt: true })).data;
  Object.assign(ids, { abc: a.id, abcCo: a.company_id, gl: g.id, glCo: g.company_id });
  ids.contact = (await admin('POST', '/api/contacts', { customer_id: ids.abc, full_name: 'Ali Satın', email: 'ali@abc.com', receives_offers: true })).data.id;
  pm = await login('pelin');
  emp = await login('ece');
});

after(async () => {
  await srv.close();
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

test('teklif oluşturulur: yıllık sıra numarası, şirketten para birimi ve vade, şablon metinleri', async () => {
  const r = await admin('POST', '/api/offers', { company_id: ids.abcCo, title: 'Platform danışmanlığı', offer_date: '2026-11-05',
    items: [item(), item({ kind: 'license', description: 'Lisans', quantity: 1, unit: 'adet', unit_price: 50000, discount_pct: 10 })],
    payments: [{ description: 'Peşin', amount: 246000 }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.number, 'SWISE-2026-0001');
  ids.o1 = r.data.id;
  const d = (await admin('GET', `/api/offers/${ids.o1}`)).data;
  assert.equal(d.currency, 'TRY');
  assert.equal(d.payment_days, 30);
  assert.match(d.intro, /Talebiniz doğrultusunda/);
  assert.deepEqual(d.totals, { subtotal: 205000, vat: 41000, total: 246000, vat_exempt: false, payments_total: 246000, payment_mismatch: false });

  const en = (await admin('POST', '/api/offers', { company_id: ids.glCo, language: 'en', title: 'EU rollout', offer_date: '2026-11-06', items: [item({ unit: 'day', unit_price: 800 })] })).data;
  assert.equal(en.number, 'SWISE-2026-0002');
  ids.o2 = en.id;
  const de = (await admin('GET', `/api/offers/${en.id}`)).data;
  assert.equal(de.currency, 'EUR');
  assert.equal(de.totals.vat, 0);         // KDV uygulanmaz şirket
  assert.equal(de.totals.vat_exempt, true);
  assert.match(de.intro, /Dear partner/);
});

test('geçersiz kalem, iskonto ve başka müşterinin kişisi reddedilir', async () => {
  const base = { company_id: ids.abcCo, title: 'X' };
  assert.equal((await admin('POST', '/api/offers', { ...base, items: [] })).status, 400);
  assert.equal((await admin('POST', '/api/offers', { ...base, items: [item({ discount_pct: 120 })] })).status, 400);
  assert.equal((await admin('POST', '/api/offers', { company_id: ids.glCo, title: 'X', contact_id: ids.contact, items: [item()] })).status, 400);
});

test('proje yöneticisi yalnızca sorumlu olduğu müşteriye teklif hazırlar ve onu görür; çalışan teklif göremez', async () => {
  const mine = await pm('POST', '/api/offers', { company_id: ids.abcCo, title: 'PM teklifi', items: [item()] });
  assert.equal(mine.status, 200);
  ids.pmOffer = mine.data.id;
  assert.equal((await pm('POST', '/api/offers', { company_id: ids.glCo, title: 'Yetkisiz', items: [item()] })).status, 403);
  const list = (await pm('GET', '/api/offers')).data.map((o) => o.customer_name);
  assert.ok(list.every((n) => n === 'ABC Holding'));
  assert.equal((await pm('GET', `/api/offers/${ids.o2}`)).status, 404);
  assert.equal((await emp('GET', '/api/offers')).status, 403);
  // Proje yöneticisi ücret göremez: varsayılanlarda günlük ücret dönmez
  const def = (await pm('GET', `/api/offers/defaults?company_id=${ids.abcCo}`)).data;
  assert.equal('daily_rate' in def, false);
  assert.equal((await admin('GET', `/api/offers/defaults?company_id=${ids.abcCo}`)).data.daily_rate, 16000);
});

test('iç onay: gönderilen teklif düzenlenemez; geri gönderme gerekçe ister; onayda PDF dondurulur', async () => {
  assert.equal((await pm('POST', `/api/offers/${ids.pmOffer}/submit`)).status, 200);
  assert.equal((await pm('PUT', `/api/offers/${ids.pmOffer}`, { company_id: ids.abcCo, title: 'Değişti', items: [item()] })).status, 409);
  assert.equal((await pm('POST', `/api/offers/${ids.pmOffer}/review`, { decision: 'approved' })).status, 403);
  assert.equal((await admin('POST', `/api/offers/${ids.pmOffer}/review`, { decision: 'rejected' })).status, 400);
  await admin('POST', `/api/offers/${ids.pmOffer}/review`, { decision: 'rejected', note: 'İskonto ekleyin' });
  let d = (await pm('GET', `/api/offers/${ids.pmOffer}`)).data;
  assert.equal(d.status, 'draft');
  assert.equal(d.review_note, 'İskonto ekleyin');
  assert.equal((await pm('PUT', `/api/offers/${ids.pmOffer}`, { company_id: ids.abcCo, title: 'PM teklifi', items: [item({ discount_pct: 5 })] })).status, 200);
  await pm('POST', `/api/offers/${ids.pmOffer}/submit`);
  assert.equal((await admin('POST', `/api/offers/${ids.pmOffer}/review`, { decision: 'approved' })).status, 200);

  d = (await pm('GET', `/api/offers/${ids.pmOffer}`)).data;
  assert.equal(d.status, 'approved');
  assert.equal(d.versions.length, 1);
  const pdf = (await pm('GET', `/api/offer-versions/${d.versions[0].id}/pdf`)).data;
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(sha(pdf), d.versions[0].pdf_sha256);       // indirilen dosya dondurulan sürümle aynı
  const again = (await pm('GET', `/api/offers/${ids.pmOffer}/pdf`)).data;
  assert.equal(sha(again), d.versions[0].pdf_sha256);     // onaydan sonra hep aynı PDF döner
});

test('imzalı dosya: yalnızca izin verilen biçimler; yüklenen dosya aynen geri indirilir', async () => {
  pm.cookie = undefined;
  const pmCookie = await (async () => {
    const res = await fetch(`${srv.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pelin', password: 'parola123' }) });
    return res.headers.get('set-cookie').split(';')[0];
  })();
  const c = { cookie: pmCookie };
  assert.equal((await upload(c, ids.pmOffer, 'imza.exe', Buffer.from('x'))).status, 400);
  const signed = Buffer.from('%PDF-1.7 imzalı içerik örneği');
  const r = await upload(c, ids.pmOffer, 'SWISE-2026-0003-imzali.pdf', signed);
  assert.equal(r.status, 200);
  const d = (await pm('GET', `/api/offers/${ids.pmOffer}`)).data;
  assert.equal(d.status, 'signed');
  assert.equal(d.versions[0].signed_name, 'SWISE-2026-0003-imzali.pdf');
  const back = (await pm('GET', `/api/offer-versions/${d.versions[0].id}/signed`)).data;
  assert.equal(sha(back), sha(signed));
});

test('gönderim ve karar: kabul edilen teklif revize edilemez; gönderilmiş teklif revize edilince eski sürüm korunur', async () => {
  assert.equal((await pm('POST', `/api/offers/${ids.pmOffer}/decision`, { decision: 'accepted' })).status, 409);  // henüz gönderilmedi
  assert.equal((await pm('POST', `/api/offers/${ids.pmOffer}/send`)).status, 200);
  assert.equal((await pm('POST', `/api/offers/${ids.pmOffer}/decision`, { decision: 'accepted', note: 'Sipariş geldi' })).status, 200);
  const acc = (await pm('GET', `/api/offers/${ids.pmOffer}`)).data;
  assert.equal(acc.status, 'accepted');
  assert.equal(acc.decision_note, 'Sipariş geldi');
  assert.equal((await pm('POST', `/api/offers/${ids.pmOffer}/revise`)).status, 409);

  await admin('POST', `/api/offers/${ids.o1}/submit`);
  await admin('POST', `/api/offers/${ids.o1}/review`, { decision: 'approved' });
  await admin('POST', `/api/offers/${ids.o1}/send`);   // imzasız da gönderilebilir
  const rev = await admin('POST', `/api/offers/${ids.o1}/revise`);
  assert.equal(rev.data.revision, 2);
  const d = (await admin('GET', `/api/offers/${ids.o1}`)).data;
  assert.equal(d.status, 'draft');
  assert.equal(d.revision, 2);
  assert.deepEqual(d.versions.map((v) => v.revision), [1]);
  assert.equal((await admin('DELETE', `/api/offers/${ids.o1}`)).status, 400);   // sürümü olan silinmez
  assert.equal((await admin('PUT', `/api/offers/${ids.o1}`, { company_id: ids.abcCo, title: 'Rev 2', items: [item({ quantity: 12 })] })).status, 200);
  await admin('POST', `/api/offers/${ids.o1}/submit`);
  await admin('POST', `/api/offers/${ids.o1}/review`, { decision: 'approved' });
  const d2 = (await admin('GET', `/api/offers/${ids.o1}`)).data;
  assert.deepEqual(d2.versions.map((v) => v.revision), [2, 1]);
  assert.notEqual(d2.versions[0].pdf_sha256, d2.versions[1].pdf_sha256);
});

test('taslak silinebilir; taslak önizlemesi PDF döner; süresi geçmiş gönderilmiş teklif "süresi doldu" görünür', async () => {
  const pv = await admin('GET', `/api/offers/${ids.o2}/pdf`);
  assert.equal(pv.status, 200);
  assert.equal(pv.data.subarray(0, 5).toString(), '%PDF-');
  const old = (await admin('POST', '/api/offers', { company_id: ids.abcCo, title: 'Eski', offer_date: '2026-01-02', valid_days: 10, items: [item()] })).data;
  await admin('POST', `/api/offers/${old.id}/submit`);
  await admin('POST', `/api/offers/${old.id}/review`, { decision: 'approved' });
  await admin('POST', `/api/offers/${old.id}/send`);
  const row = (await admin('GET', '/api/offers')).data.find((o) => o.id === old.id);
  assert.equal(row.expired, true);
  const tmp = (await admin('POST', '/api/offers', { company_id: ids.abcCo, title: 'Silinecek', items: [item()] })).data;
  assert.equal((await admin('DELETE', `/api/offers/${tmp.id}`)).status, 200);
});

test('şablon: numara öneki değişir, geçersiz önek reddedilir; ana sayfada onay bekleyen teklif sayısı', async () => {
  const s = (await admin('GET', '/api/settings')).data;
  assert.equal((await admin('PUT', '/api/settings/offer-template', { ...s, offer_number_prefix: 'sw 1' })).status, 400);
  assert.equal((await admin('PUT', '/api/settings/offer-template', { ...s, offer_number_prefix: 'swt', offer_signatory_name: 'İlker Özbayram' })).status, 200);
  const r = (await admin('POST', '/api/offers', { company_id: ids.abcCo, title: 'Yeni önek', offer_date: '2026-12-01', items: [item()] })).data;
  assert.match(r.number, /^SWT-2026-\d{4}$/);
  await admin('POST', `/api/offers/${r.id}/submit`);
  assert.equal((await admin('GET', '/api/dashboard')).data.pending_offers, 1);
  assert.equal((await pm('GET', '/api/settings')).status, 200);
  assert.equal((await pm('PUT', '/api/settings/offer-template', s)).status, 403);
});
