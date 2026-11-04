// Geçiş (migration) çalıştırıcı. Uygulanan son geçişin numarası SQLite'ın
// user_version alanında tutulur; her geçiş kendi işlemi (transaction) içinde çalışır.
const migrations = require('./migrations');

function migrate(db, list = migrations) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  const applied = [];
  for (const m of list) {
    if (m.id <= current) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${Number(m.id)}`);
      db.exec('COMMIT');
      applied.push(m.id);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Geçiş ${m.id} (${m.name}) uygulanamadı: ${err.message}`);
    }
  }
  return applied;
}

module.exports = { migrate };
