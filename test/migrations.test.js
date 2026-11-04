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
  assert.equal(db.prepare('SELECT name FROM customers').get().name, 'Eski Müşteri');
  assert.equal(db.prepare('SELECT name FROM companies').get().name, 'Eski Müşteri');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'audit_log'").get());
});

test('geçiş 3: eski müşteriler tek şirketli müşteriye dönüşür, saatlik ücretler günlüğe çevrilir', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, migrations.slice(0, 2));
  db.exec(`
    INSERT INTO users (username, full_name, password_hash) VALUES ('a', 'A', 'x');
    INSERT INTO clients (name, tax_no, default_rate, withholding, active) VALUES ('Eski AŞ', '111', 2000, 1, 1), ('Pasif Ltd', '', NULL, 0, 0);
    INSERT INTO projects (client_id, name, hourly_rate) VALUES (1, 'Ücretli', 2500), (1, 'Ücretsiz', NULL), (2, 'Diğer', NULL);
    INSERT INTO activities (user_id, project_id, date, description, hours, rate) VALUES (1, 1, '2026-11-01', 'x', 2, 2500);
    INSERT INTO expenses (user_id, project_id, date, category, amount) VALUES (1, 2, '2026-11-01', 'Ulaşım', 100);
  `);

  migrate(db);

  assert.deepEqual(db.prepare('SELECT name, daily_rate, currency, active FROM customers ORDER BY id').all().map((r) => ({ ...r })), [
    { name: 'Eski AŞ', daily_rate: 16000, currency: 'TRY', active: 1 },
    { name: 'Pasif Ltd', daily_rate: 0, currency: 'TRY', active: 0 },
  ]);
  const co = db.prepare('SELECT customer_id, name, tax_no, withholding, daily_rate FROM companies WHERE id = 1').get();
  assert.deepEqual({ ...co }, { customer_id: 1, name: 'Eski AŞ', tax_no: '111', withholding: 1, daily_rate: null });
  assert.deepEqual(db.prepare('SELECT company_id, daily_rate FROM projects ORDER BY id').all().map((r) => ({ ...r })), [
    { company_id: 1, daily_rate: 20000 }, { company_id: 1, daily_rate: null }, { company_id: 2, daily_rate: null },
  ]);
  const act = db.prepare('SELECT daily_rate, currency FROM activities').get();
  assert.deepEqual({ ...act }, { daily_rate: 20000, currency: 'TRY' });
  assert.equal(db.prepare('SELECT currency FROM expenses').get().currency, 'TRY');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
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

test('geçiş 4: aktivite ve masraflar şirkete bağlanır, proje isteğe bağlı olur', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, migrations.slice(0, 3));
  db.exec(`
    INSERT INTO users (username, full_name, password_hash) VALUES ('a', 'A', 'x');
    INSERT INTO customers (name, daily_rate) VALUES ('C', 8000);
    INSERT INTO companies (customer_id, name) VALUES (1, 'Ş1'), (1, 'Ş2');
    INSERT INTO projects (company_id, name) VALUES (2, 'P');
    INSERT INTO activities (user_id, project_id, date, description, hours, daily_rate, currency) VALUES (1, 1, '2026-11-01', 'x', 2, 8000, 'EUR');
    INSERT INTO expenses (user_id, project_id, date, category, amount, currency) VALUES (1, 1, '2026-11-01', 'Ulaşım', 50, 'EUR');
  `);
  migrate(db);
  assert.deepEqual({ ...db.prepare('SELECT company_id, project_id, daily_rate, currency FROM activities').get() },
    { company_id: 2, project_id: 1, daily_rate: 8000, currency: 'EUR' });
  assert.deepEqual({ ...db.prepare('SELECT company_id, project_id, amount, currency FROM expenses').get() },
    { company_id: 2, project_id: 1, amount: 50, currency: 'EUR' });
  db.prepare("INSERT INTO activities (user_id, company_id, date, description, hours) VALUES (1, 1, '2026-11-02', 'projesiz', 1)").run();
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
