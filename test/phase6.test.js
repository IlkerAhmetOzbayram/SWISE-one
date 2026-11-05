// Faz 6.1: davet / parola sıfırlama bağlantıları, canlı ortam kuralları, yönetici oluşturma komutu
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { startServer, client } = require('./helpers');
const config = require('../src/config');

let srv;
let admin;
const ids = {};
const tokenOf = (url) => url.split('#/parola/')[1];

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin('POST', '/api/setup', { full_name: 'Yönetici', username: 'admin', password: 'secret123' });
  const roles = (await admin('GET', '/api/roles')).data;
  ids.adminRole = roles.find((r) => r.locked).id;
  // İK: personel düzenleyebilir ama Yönetici değil
  ids.ik = (await admin('POST', '/api/roles', { name: 'İK', copy_from: roles.find((r) => r.name === 'Çalışan').id })).data.id;
  const ik = (await admin('GET', '/api/roles')).data.find((r) => r.id === ids.ik);
  await admin('PUT', `/api/roles/${ids.ik}`, { name: 'İK', permissions: { ...ik.permissions, 'personnel.view': true, 'personnel.edit': true } });
  ids.admin = (await admin('GET', '/api/me')).data.id;
});

after(() => srv.close());

test('parolasız oluşturulan personel davet bağlantısıyla kendi parolasını belirler ve giriş yapar', async () => {
  const r = await admin('POST', '/api/users', { full_name: 'Can Yeni', username: 'can', email: 'can@swise.com.tr' });
  assert.equal(r.status, 200);
  ids.can = r.data.id;
  assert.equal(r.data.link.purpose, 'invite');
  assert.match(r.data.link.url, /^http:\/\/127\.0\.0\.1:\d+\/#\/parola\/[A-Za-z0-9_-]{43}$/);
  const days = (new Date(r.data.link.expires_at) - Date.now()) / 864e5;
  assert.ok(days > 6.9 && days <= 7);

  // Bağlantı oluşmadan parola bilinmez: giriş yapılamaz
  const can = client(srv.base);
  assert.equal((await can('POST', '/api/login', { username: 'can', password: 'herhangi1' })).status, 401);

  const token = tokenOf(r.data.link.url);
  const info = await can('GET', `/api/password-link/${token}`);
  assert.deepEqual(info.data, { purpose: 'invite', username: 'can', full_name: 'Can Yeni' });
  assert.equal((await can('POST', `/api/password-link/${token}`, { password: 'kisa' })).status, 400);
  assert.equal((await can('POST', `/api/password-link/${token}`, { password: 'canparola1' })).status, 200);
  assert.equal((await can('GET', '/api/me')).data.username, 'can');

  // Tek kullanımlık
  assert.equal((await client(srv.base)('GET', `/api/password-link/${token}`)).status, 404);
  assert.equal((await client(srv.base)('POST', `/api/password-link/${token}`, { password: 'baskaparola' })).status, 404);
  assert.equal((await client(srv.base)('POST', '/api/login', { username: 'can', password: 'canparola1' })).status, 200);

  // Anahtar veritabanında açık tutulmaz; işlem kaydında davet ve kabul görünür
  const { one } = require('../src/db');
  assert.equal(one('SELECT COUNT(*) n FROM password_links WHERE token_hash = ?', token).n, 0);
  const actions = (await admin('GET', `/api/audit?entity=users`)).data;
  const list = (actions.rows || actions).map((a) => a.action);
  assert.ok(list.includes('invite') && list.includes('invite_accepted'));
});

test('giriş yapmış kişiye sıfırlama bağlantısı (24 saat); yenisi eskisini geçersiz kılar, oturumlar kapanır', async () => {
  const can = client(srv.base);
  await can('POST', '/api/login', { username: 'can', password: 'canparola1' });
  const first = (await admin('POST', `/api/users/${ids.can}/password-link`, {})).data;
  assert.equal(first.purpose, 'reset');
  const hours = (new Date(first.expires_at) - Date.now()) / 3600e3;
  assert.ok(hours > 23.9 && hours <= 24);
  const second = (await admin('POST', `/api/users/${ids.can}/password-link`, {})).data;
  assert.equal((await client(srv.base)('GET', `/api/password-link/${tokenOf(first.url)}`)).status, 404);

  const anon = client(srv.base);
  assert.equal((await anon('POST', `/api/password-link/${tokenOf(second.url)}`, { password: 'yeniparola9' })).status, 200);
  assert.equal((await can('GET', '/api/me')).status, 401);
  assert.equal((await client(srv.base)('POST', '/api/login', { username: 'can', password: 'yeniparola9' })).status, 200);
});

test('pasif personelin bağlantısı çalışmaz; geçersiz biçimli anahtar reddedilir', async () => {
  const r = await admin('POST', '/api/users', { full_name: 'Pasif Kişi', username: 'pasif' });
  const token = tokenOf(r.data.link.url);
  const p = (await admin('GET', `/api/personnel/${r.data.id}`)).data;
  await admin('PUT', `/api/users/${r.data.id}`, { ...p, active: false });
  assert.equal((await client(srv.base)('GET', `/api/password-link/${token}`)).status, 404);
  assert.equal((await admin('POST', `/api/users/${r.data.id}/password-link`, {})).status, 400);
  assert.equal((await client(srv.base)('GET', '/api/password-link/abc')).status, 404);
});

test('Yönetici olmayan personel yetkilisi yöneticinin parolasına dokunamaz', async () => {
  await admin('POST', '/api/users', { full_name: 'İK Uzmanı', username: 'ik', password: 'ikparola12', role_id: ids.ik });
  const ik = client(srv.base);
  await ik('POST', '/api/login', { username: 'ik', password: 'ikparola12' });
  assert.equal((await ik('POST', `/api/users/${ids.admin}/password-link`, {})).status, 403);
  const me = (await admin('GET', `/api/personnel/${ids.admin}`)).data;
  assert.equal((await ik('PUT', `/api/users/${ids.admin}`, { ...me, password: 'ele-gecir-1' })).status, 403);
  // Çalışana bağlantı oluşturabilir
  assert.equal((await ik('POST', `/api/users/${ids.can}/password-link`, {})).status, 200);
});

test('sağlık kontrolü giriş gerektirmez', async () => {
  const r = await client(srv.base)('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
});

test('canlıda ilk yönetici web’den oluşturulamaz; bağlantılar PUBLIC_URL ile üretilir', async () => {
  const saved = { production: config.production, publicUrl: config.publicUrl };
  try {
    config.production = true;
    config.publicUrl = 'https://one.swise.com.tr';
    const s = await client(srv.base)('GET', '/api/setup');
    assert.equal(s.data.webSetup, false);
    assert.equal((await client(srv.base)('POST', '/api/setup', { full_name: 'X', username: 'x', password: 'secret999' })).status, 403);
    const link = (await admin('POST', `/api/users/${ids.can}/password-link`, {}, { host: 'kotu-site.example' })).data;
    assert.match(link.url, /^https:\/\/one\.swise\.com\.tr\/#\/parola\//);
  } finally {
    Object.assign(config, saved);
  }
});

test('yonetici-olustur: "Yerel Yönetici" hesabını kayıtlarıyla devralır; parola-sifirla çalışır', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swise-yonetici-'));
  const env = { ...process.env, DB_PATH: path.join(dir, 'test.db') };
  const root = path.join(__dirname, '..');
  const node = (args, input) => execFileSync(process.execPath, ['--no-warnings', ...args], { cwd: root, env, input, encoding: 'utf8' });
  try {
    // Geliştirmede oluşan yerel hesap ve ona ait bir aktivite
    node(['-e', `const { run, one } = require('./src/db');
      run("INSERT INTO users (username, full_name, password_hash, role, role_id) VALUES ('yerel', 'Yerel Yönetici', 'x:y', 'admin', (SELECT id FROM roles WHERE locked = 1))");
      run("INSERT INTO customers (name, daily_rate) VALUES ('C', 8000)");
      run("INSERT INTO companies (customer_id, name) VALUES (1, 'C')");
      run("INSERT INTO activities (user_id, company_id, date, description, hours, daily_rate, currency) VALUES (1, 1, '2026-11-01', 'x', 2, 8000, 'TRY')");`]);
    const out = node(['scripts/yonetici-olustur.js', 'ilker', 'İlker Özbayram'], 'E\nguclu-parola-1\nguclu-parola-1\n');
    assert.match(out, /"ilker" artık Yönetici/);
    const check = (code) => JSON.parse(node(['-e', `const { one } = require('./src/db'); const { verifyPassword } = require('./src/lib/auth'); ${code}`]));
    const u = check(`const u = one("SELECT u.*, r.locked FROM users u JOIN roles r ON r.id = u.role_id WHERE username = 'ilker'");
      console.log(JSON.stringify({ id: u.id, full_name: u.full_name, locked: u.locked, ok: verifyPassword('guclu-parola-1', u.password_hash),
        yerel: one("SELECT COUNT(*) n FROM users WHERE username = 'yerel'").n, act: one('SELECT user_id FROM activities').user_id }))`);
    assert.deepEqual(u, { id: 1, full_name: 'İlker Özbayram', locked: 1, ok: true, yerel: 0, act: 1 });

    // Kısa parola reddedilir
    assert.throws(() => node(['scripts/parola-sifirla.js', 'ilker'], 'kisa\nkisa\n'));
    node(['scripts/parola-sifirla.js', 'ilker'], 'yeni-parola-22\nyeni-parola-22\n');
    assert.equal(check(`console.log(JSON.stringify(verifyPassword('yeni-parola-22', one("SELECT password_hash FROM users WHERE username = 'ilker'").password_hash)))`), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
