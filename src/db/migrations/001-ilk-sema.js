// İlk sürümün şeması. IF NOT EXISTS sayesinde geçiş sisteminden önce
// oluşturulmuş veritabanlarında da güvenle çalışır.
module.exports = {
  id: 1,
  name: 'ilk şema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
        hourly_rate REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        tax_no TEXT NOT NULL DEFAULT '',
        tax_office TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        default_rate REAL,
        withholding INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id),
        name TEXT NOT NULL,
        hourly_rate REAL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        project_id INTEGER NOT NULL REFERENCES projects(id),
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        hours REAL NOT NULL CHECK (hours > 0),
        billable INTEGER NOT NULL DEFAULT 1,
        rate REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        project_id INTEGER NOT NULL REFERENCES projects(id),
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL CHECK (amount >= 0),
        vat_rate REAL NOT NULL DEFAULT 20,
        billable INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const defaults = {
      company_name: 'SWISE Teknoloji ve Danışmanlık',
      vat_rate: '20',
      withholding_rate: '20',
      expense_categories: 'Ulaşım,Konaklama,Yemek,Malzeme,Yazılım/Lisans,Diğer',
    };
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) insert.run(k, v);
  },
};
