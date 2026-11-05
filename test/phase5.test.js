// Faz 5: muhasebe — kurlar, faturalar, tahsilat/ödeme, yaşlandırma, nakit akışı, bordro ve personel carisi,
// gelir–gider, kategori bütçesi, Excel ve yetkiler
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swise-muhasebe-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');
const { parseTcmbXml, rateFor } = require('../src/modules/accounting/rates');

let srv;
let admin;
let emp;
const ids = {};
const act = (date, company_id, hours) => ({ date, company_id, description: 'İş', hours, billable: true });

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?><Tarih_Date Tarih="03.11.2026" Date="11/03/2026" Bulten_No="2026/209">
<Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit><ForexBuying>41.1234</ForexBuying><ForexSelling>41.2000</ForexSelling></Currency>
<Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><ForexBuying>50.5000</ForexBuying><ForexSelling>50.6000</ForexSelling></Currency>
</Tarih_Date>`;

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin('POST', '/api/setup', { full_name: 'Yönetici', username: 'admin', password: 'secret123' });
  const abc = (await admin('POST', '/api/customers', { name: 'ABC Holding', daily_rate: '16000', currency: 'TRY', withholding: true })).data;
  const gl = (await admin('POST', '/api/customers', { name: 'Global GmbH', daily_rate: '800', currency: 'EUR', vat_exempt: true, payment_days: '15' })).data;
  Object.assign(ids, { abcCo: abc.company_id, glCo: gl.company_id });
  ids.emp = (await admin('POST', '/api/users', { full_name: 'Ece Demir', username: 'ece', password: 'parola123' })).data.id;
  emp = client(srv.base);
  await emp('POST', '/api/login', { username: 'ece', password: 'parola123' });

  await admin('POST', '/api/rates', { date: '2026-10-30', currency: 'EUR', buying: '50', selling: '51' });
  await admin('POST', '/api/rates', { date: '2026-10-30', currency: 'USD', buying: '40', selling: '41' });
  ids.tl = (await admin('POST', '/api/accounts', { name: 'İş Bankası TL', type: 'bank', currency: 'TRY', opening_balance: '100000', opening_date: '2026-10-01' })).data.id;
  ids.eur = (await admin('POST', '/api/accounts', { name: 'İş Bankası EUR', type: 'bank', currency: 'EUR', opening_balance: '0', opening_date: '2026-10-01' })).data.id;
  ids.sup = (await admin('POST', '/api/suppliers', { name: 'Ofis Kira AŞ', tax_no: '9876543210', payment_days: '10' })).data.id;

  await admin('POST', '/api/activities', act('2026-10-05', ids.abcCo, 16));     // 2 gün × 16000 = 32000
  await admin('POST', '/api/activities', act('2026-10-06', ids.glCo, 8));      // 1 gün × 800 EUR
  await admin('POST', '/api/expenses', { date: '2026-10-07', company_id: ids.abcCo, category: 'Ulaşım', amount: '500', vat_rate: '20', billable: true });
});

after(async () => {
  await srv.close();
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

test('TCMB XML ayrıştırılır; bir tarihin kuru o gün veya önceki en yakın kurdur', () => {
  const p = parseTcmbXml(SAMPLE_XML);
  assert.equal(p.date, '2026-11-03');
  assert.deepEqual(p.rates, [{ currency: 'EUR', buying: 50.5, selling: 50.6 }, { currency: 'USD', buying: 41.1234, selling: 41.2 }]);
  assert.equal(rateFor('EUR', '2026-11-02').rate, 50);           // hafta sonu: 30 Ekim kuru
  assert.equal(rateFor('EUR', '2026-11-02', 'selling').rate, 51);
  assert.equal(rateFor('TRY', '2026-11-02').rate, 1);
  assert.equal(rateFor('EUR', '2026-01-01'), null);
});

test('aktivitelerden fatura: hizmet + yansıtılan masraf, KDV, hizmete stopaj; tekrar faturalanamaz', async () => {
  const r = await admin('POST', '/api/invoices/from-activities', { company_id: ids.abcCo, from: '2026-10-01', to: '2026-10-31', issue_date: '2026-11-02' });
  assert.equal(r.status, 200);
  ids.inv1 = r.data.id;
  const d = (await admin('GET', `/api/invoices/${ids.inv1}`)).data;
  assert.deepEqual([d.subtotal, d.vat, d.withholding, d.total, d.net], [32500, 6500, 6400, 39000, 32600]);
  assert.equal(d.due_date, '2026-12-02');      // şirket vadesi 30 gün
  assert.equal(d.lines.length, 2);
  assert.equal(d.linked_activities, 1);
  assert.equal(d.linked_expenses, 1);
  assert.equal((await admin('POST', '/api/invoices/from-activities', { company_id: ids.abcCo, from: '2026-10-01', to: '2026-10-31' })).status, 400);
});

test('dövizli fatura TCMB kuruyla; KDV muaf şirkette KDV yok', async () => {
  const r = await admin('POST', '/api/invoices/from-activities', { company_id: ids.glCo, from: '2026-10-01', to: '2026-10-31', issue_date: '2026-11-01' });
  ids.inv2 = r.data.id;
  const d = (await admin('GET', `/api/invoices/${ids.inv2}`)).data;
  assert.equal(d.currency, 'EUR');
  assert.equal(d.rate, 50);
  assert.deepEqual([d.subtotal, d.vat, d.net], [800, 0, 800]);
});

test('fatura kesme numara ister; kısmi ve tam tahsilat ödeme durumunu günceller; fazla tahsilat reddedilir', async () => {
  assert.equal((await admin('POST', `/api/invoices/${ids.inv1}/issue`, {})).status, 400);
  assert.equal((await admin('POST', `/api/invoices/${ids.inv1}/issue`, { number: 'SWE2026000000001' })).status, 200);
  await admin('POST', '/api/transactions', { kind: 'collection', account_id: ids.tl, date: '2026-11-10', amount: '20000', invoice_id: ids.inv1 });
  let d = (await admin('GET', `/api/invoices/${ids.inv1}`)).data;
  assert.equal(d.payment_status, 'partial');
  assert.equal(d.outstanding, 12600);
  assert.equal((await admin('POST', '/api/transactions', { kind: 'collection', account_id: ids.tl, date: '2026-11-11', amount: '20000', invoice_id: ids.inv1 })).status, 400);
  await admin('POST', '/api/transactions', { kind: 'collection', account_id: ids.tl, date: '2026-11-11', amount: '12600', invoice_id: ids.inv1 });
  d = (await admin('GET', `/api/invoices/${ids.inv1}`)).data;
  assert.equal(d.payment_status, 'paid');
  assert.equal(d.payments.length, 2);
  assert.equal((await admin('POST', `/api/invoices/${ids.inv1}/cancel`, {})).status, 400);   // tahsilatı olan iptal edilemez
});

test('döviz hesabına tahsilat; farklı para birimli hesaptan tahsilatta faturadan düşülecek tutar istenir', async () => {
  await admin('POST', `/api/invoices/${ids.inv2}/issue`, { number: 'SWE2026000000002' });
  assert.equal((await admin('POST', '/api/transactions', { kind: 'collection', account_id: ids.tl, date: '2026-11-12', amount: '20000', invoice_id: ids.inv2 })).status, 400);
  const tlCol = await admin('POST', '/api/transactions', { kind: 'collection', account_id: ids.tl, date: '2026-11-12', amount: '20000', invoice_id: ids.inv2, invoice_amount: '400' });
  assert.equal(tlCol.status, 200);
  const eurCol = await admin('POST', '/api/transactions', { kind: 'collection', account_id: ids.eur, date: '2026-11-12', amount: '400', invoice_id: ids.inv2 });
  assert.equal(eurCol.data.amount_try, 20000);   // 400 × 50
  const d = (await admin('GET', `/api/invoices/${ids.inv2}`)).data;
  assert.equal(d.payment_status, 'paid');
  const accounts = (await admin('GET', '/api/accounts')).data;
  assert.equal(accounts.find((a) => a.id === ids.eur).balance, 400);
  assert.equal(accounts.find((a) => a.id === ids.tl).balance, 100000 + 32600 + 20000);
});

test('taslak silinince aktiviteler yeniden faturalanabilir olur', async () => {
  await admin('POST', '/api/activities', act('2026-11-03', ids.abcCo, 8));
  const r = (await admin('POST', '/api/invoices/from-activities', { company_id: ids.abcCo, from: '2026-11-01', to: '2026-11-30' })).data;
  assert.equal((await admin('DELETE', `/api/invoices/${r.id}`)).status, 200);
  assert.equal((await admin('POST', '/api/invoices/from-activities', { company_id: ids.abcCo, from: '2026-11-01', to: '2026-11-30' })).status, 200);
});

test('gelen fatura: tedarikçi, gider kategorisi, ek dosya; ödeme ve yaşlandırma', async () => {
  const cats = (await admin('GET', '/api/categories')).data;
  const rent = cats.find((c) => c.name === 'Kira');
  assert.equal((await admin('POST', '/api/invoices', { direction: 'in', supplier_id: ids.sup, category_id: cats.find((c) => c.name === 'Hizmet geliri').id,
    issue_date: '2026-09-01', lines: [{ description: 'x', unit_price: 1 }] })).status, 400);   // gelir kategorisi seçilemez
  const r = await admin('POST', '/api/invoices', { direction: 'in', supplier_id: ids.sup, category_id: rent.id, issue_date: '2026-09-01',
    lines: [{ description: 'Eylül kirası', quantity: 1, unit_price: 25000, is_service: 0 }] });
  ids.rent = r.data.id;
  await admin('POST', `/api/invoices/${ids.rent}/issue`, { number: 'KRA-0901' });

  const file = Buffer.from('%PDF-1.4 kira faturası');
  const up = await fetch(`${srv.base}/api/invoices/${ids.rent}/attachment`, { method: 'POST', body: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('kira-eylül.pdf'), cookie: admin.cookie } });
  assert.equal(up.status, 200);
  const back = (await admin('GET', `/api/invoices/${ids.rent}/attachment`)).data;
  assert.equal(back.toString(), file.toString());

  const aging = (await admin('GET', '/api/accounting/aging?direction=in')).data;
  const row = aging.rows.find((x) => x.party === 'Ofis Kira AŞ');
  assert.equal(row.total_try, 30000);   // 25000 + %20 KDV, vade 11.09 → 30+ gün gecikmiş
  assert.ok(row.d60 + row.d90 + row.d90p === 30000);
  await admin('POST', '/api/transactions', { kind: 'payment', account_id: ids.tl, date: '2026-11-15', amount: '30000', invoice_id: ids.rent });
  assert.equal((await admin('GET', `/api/invoices/${ids.rent}`)).data.payment_status, 'paid');
});

test('bordro ve personel carisi: net tahakkuk, avans, maaş ödemesi, masraf iadesi; devlete SGK/vergi borcu', async () => {
  await admin('PUT', '/api/payroll', { user_id: ids.emp, period: '2026-10', gross: '60000', net: '45000', employee_sgk: '8400', employer_sgk: '9300', income_tax: '6000', stamp_tax: '455' });
  await emp('POST', '/api/expenses', { date: '2026-10-20', company_id: ids.abcCo, category: 'Yemek', amount: '100', vat_rate: '20', billable: false });
  const exp = (await admin('GET', '/api/expenses?status=pending')).data[0];
  await admin('POST', `/api/expenses/${exp.id}/review`, { decision: 'approved' });
  await admin('POST', '/api/transactions', { kind: 'advance', account_id: ids.tl, date: '2026-10-15', amount: '5000', user_id: ids.emp });
  await admin('POST', '/api/transactions', { kind: 'salary_payment', account_id: ids.tl, date: '2026-11-01', amount: '40000', user_id: ids.emp });
  await admin('POST', '/api/transactions', { kind: 'sgk_payment', account_id: ids.tl, date: '2026-11-20', amount: '17700' });

  const led = (await admin('GET', '/api/personnel-ledger')).data;
  const ece = led.personnel.find((p) => p.user_id === ids.emp);
  assert.deepEqual([ece.salary_accrued, ece.refunds_owed, ece.advances, ece.salary_paid, ece.balance], [45000, 120, 5000, 40000, 120]);
  assert.deepEqual(led.state, { sgk: 0, tax: 6455 });
  const detail = (await admin('GET', `/api/personnel-ledger/${ids.emp}`)).data;
  assert.equal(detail.rows.at(-1).balance, 120);
  assert.equal((await admin('PUT', '/api/payroll', { user_id: ids.emp, period: '2026-10', gross: '1000', net: '2000' })).status, 400);
});

test('gelir–gider (tahakkuk): hizmet ve yansıtılan masraf ayrı; bordro maliyeti gider; bütçe plan–gerçekleşen', async () => {
  const pnl = (await admin('GET', '/api/accounting/pnl?year=2026')).data;
  const cat = (name) => pnl.categories.find((c) => c.name === name).id;
  const nov = pnl.months.find((m) => m.month === '2026-11');
  assert.equal(nov.categories[cat('Hizmet geliri')], 32000 + 40000);   // ABC 32000 + Global 800 EUR × 50
  assert.equal(nov.categories[cat('Yansıtılan masraf')], 500);
  const oct = pnl.months.find((m) => m.month === '2026-10');
  assert.equal(oct.categories[cat('Personel (maaş ve SGK)')], 69300);   // brüt + işveren SGK
  const sep = pnl.months.find((m) => m.month === '2026-09');
  assert.equal(sep.categories[cat('Kira')], 25000);

  await admin('PUT', '/api/accounting/budget', { month: '2026-11', category_id: cat('Hizmet geliri'), amount: '100000' });
  const b = (await admin('GET', '/api/accounting/budget?month=2026-11')).data;
  const svc = b.rows.find((r) => r.name === 'Hizmet geliri');
  assert.deepEqual([svc.plan, svc.actual, svc.diff, svc.pct], [100000, 72000, -28000, 0.72]);
  assert.equal((await admin('POST', '/api/accounting/budget/copy', { from_month: '2026-11', to_month: '2026-12' })).data.copied, 1);
});

test('özet, nakit akışı ve aylık Excel', async () => {
  const s = (await admin('GET', '/api/accounting/summary')).data;
  assert.equal(s.receivables_try, 0);
  assert.ok(s.state);
  const cf = (await admin('GET', '/api/accounting/cashflow?days=28')).data;
  assert.equal(cf.weeks.length, 4);
  const x = await admin('GET', '/api/accounting/export.xlsx?month=2026-11');
  assert.equal(x.status, 200);
  assert.equal(x.data.subarray(0, 2).toString(), 'PK');
});

test('yetkiler: çalışan muhasebeye erişemez; maaş yetkisi olmayan muhasebeci personel hareketlerini görmez', async () => {
  assert.equal((await emp('GET', '/api/invoices')).status, 403);
  assert.equal((await emp('GET', '/api/accounting/summary')).status, 403);
  const role = (await admin('POST', '/api/roles', { name: 'Ön Muhasebe', permissions: { 'accounting.view': true, 'accounting.edit': true } })).data.id;
  await admin('POST', '/api/users', { full_name: 'Ön Muhasebe', username: 'onmuh', password: 'parola123', role_id: role });
  const om = client(srv.base);
  await om('POST', '/api/login', { username: 'onmuh', password: 'parola123' });
  const txs = (await om('GET', '/api/transactions')).data;
  assert.ok(txs.length > 0);
  assert.ok(txs.every((t) => !['advance', 'salary_payment', 'expense_refund'].includes(t.kind)));
  assert.equal((await om('GET', '/api/payroll?period=2026-10')).status, 403);
  assert.equal((await om('POST', '/api/transactions', { kind: 'advance', account_id: ids.tl, date: '2026-11-01', amount: '1', user_id: ids.emp })).status, 403);
  assert.equal((await om('GET', '/api/accounting/summary')).data.state, undefined);
});
