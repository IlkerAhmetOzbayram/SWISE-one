// Girişsiz geliştirme modu
process.env.NO_LOGIN = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');
const { noLoginEnabled } = require('../src/config');
const { isLocalRequest } = require('../src/lib/auth');

let srv;
let call;

before(async () => {
  srv = await startServer();
  call = client(srv.base);
});

after(() => srv.close());

test('girişsiz mod canlıda (production) hiçbir koşulda açılmaz', () => {
  assert.equal(noLoginEnabled({ NO_LOGIN: '1' }, []), true);
  assert.equal(noLoginEnabled({}, ['node', 'server.js', '--girissiz']), true);
  assert.equal(noLoginEnabled({}, []), false);
  assert.equal(noLoginEnabled({ NODE_ENV: 'production', NO_LOGIN: '1' }, ['--girissiz']), false);
});

test('yalnızca bu bilgisayardan gelen istekler yerel sayılır', () => {
  const req = (remoteAddress) => ({ socket: { remoteAddress } });
  assert.equal(isLocalRequest(req('127.0.0.1')), true);
  assert.equal(isLocalRequest(req('::1')), true);
  assert.equal(isLocalRequest(req('::ffff:127.0.0.1')), true);
  assert.equal(isLocalRequest(req('192.168.1.20')), false);
  assert.equal(isLocalRequest(req('85.105.10.1')), false);
});

test('kullanıcı yokken giriş istenmeden "Yerel Yönetici" olarak çalışılır', async () => {
  const me = await call('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.full_name, 'Yerel Yönetici');
  assert.equal(me.data.role_name, 'Yönetici');
  assert.equal(me.data.perms['roles.edit'], true);
  assert.equal(me.data.no_login, true);
});

test('işlemler yerel yönetici adına kaydedilir ve tek kullanıcı oluşur', async () => {
  const r = await call('POST', '/api/customers', { name: 'Deneme Müşteri', daily_rate: '10000', currency: 'TRY' });
  assert.equal(r.status, 200);
  await call('GET', '/api/me');
  const users = (await call('GET', '/api/users')).data;
  assert.equal(users.length, 1);
  const log = (await call('GET', '/api/audit?entity=customers')).data;
  assert.equal(log[0].user_name, 'Yerel Yönetici');
});
