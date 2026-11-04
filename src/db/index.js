// Veritabanı: Node 24'ün yerleşik SQLite modülü. Açılışta bekleyen geçişler uygulanır.
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { migrate } = require('./migrate');

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA foreign_keys = ON;');
if (config.dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
migrate(db);

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

// Hata olursa tüm değişiklikler geri alınır
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, one, all, run, tx };
