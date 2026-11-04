const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/db/migrate');
const migrations = require('../src/db/migrations');

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('boş veritabanına tüm geçişler uygulanır, ikinci çalıştırmada hiçbir şey yapılmaz', () => {
  const db = new DatabaseSync(':memory:');
  assert.deepEqual(migrate(db), migrations.map((m) => m.id));
  assert.equal(version(db), migrations.at(-1).id);
  assert.deepEqual(migrate(db), []);
});

test('geçiş sisteminden önce oluşturulmuş veritabanı verisi korunarak güncellenir', () => {
  const db = new DatabaseSync(':memory:');
  migrations[0].up(db); // eski sürümdeki gibi tablolar var, user_version = 0
  db.prepare("INSERT INTO clients (name) VALUES ('Eski Müşteri')").run();
  assert.equal(version(db), 0);

  migrate(db);
  assert.equal(version(db), migrations.at(-1).id);
  assert.equal(db.prepare('SELECT name FROM clients').get().name, 'Eski Müşteri');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'audit_log'").get());
});

test('hatalı geçiş geri alınır ve sürüm ilerlemez', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const before = version(db);
  const broken = { id: before + 1, name: 'bozuk', up(d) { d.exec('CREATE TABLE yarim (id INTEGER)'); d.exec('BU GEÇERSİZ SQL'); } };
  assert.throws(() => migrate(db, [...migrations, broken]), /bozuk/);
  assert.equal(version(db), before);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'yarim'").get(), undefined);
});
