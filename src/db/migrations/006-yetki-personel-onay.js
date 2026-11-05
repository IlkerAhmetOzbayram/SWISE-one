// Roller ve yetkiler, personel kartı, maaş geçmişi, hassas bilgiler,
// müşteri sorumlusu (proje yöneticisi), masraf onayı, haftalık efor onayı ve ay kapanışı.
// Varsayılan rol yetkileri bu dosyada sabittir (geçişler sonradan değişmez).

const DEFAULT_ROLES = [
  {
    name: 'Yönetici', description: 'Tüm yetkiler. Değiştirilemez.', locked: 1, permissions: {},
  },
  {
    name: 'Muhasebe', description: 'Muhasebe, maaş, onaylar ve ay kapanışı.', locked: 0,
    permissions: {
      'activities.view': 'all', 'activities.edit': 'own', 'expenses.view': 'all', 'expenses.edit': 'own', 'expenses.approve': true,
      'customers.view': true, 'customers.edit': true, 'rates.view': true, 'reports.view': true, 'effort_report.view': 'all',
      'budget.view': true, 'budget.edit': true, 'personnel.view': true, 'salary.view': true, 'salary.edit': true,
      'period.close': true, 'audit.view': true,
    },
  },
  {
    name: 'Proje Yöneticisi', description: 'Sorumlu olduğu müşterilerin eforunu ve raporlarını görür; ücret görmez.', locked: 0,
    permissions: {
      'activities.view': 'assigned', 'activities.edit': 'own', 'expenses.view': 'assigned', 'expenses.edit': 'own',
      'customers.view': true, 'effort_report.view': 'assigned',
    },
  },
  {
    name: 'Çalışan', description: 'Kendi aktivite ve masraflarını girer.', locked: 0,
    permissions: { 'activities.view': 'own', 'activities.edit': 'own', 'expenses.view': 'own', 'expenses.edit': 'own' },
  },
];

module.exports = {
  id: 6,
  name: 'roller, personel, onaylar',
  up(db) {
    db.exec(`
      CREATE TABLE roles (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        system INTEGER NOT NULL DEFAULT 0,
        locked INTEGER NOT NULL DEFAULT 0,
        permissions TEXT NOT NULL DEFAULT '{}'
      );

      ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id);
      ALTER TABLE users ADD COLUMN title TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN start_date TEXT;
      ALTER TABLE users ADD COLUMN end_date TEXT;
      ALTER TABLE users ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'full_time';

      ALTER TABLE customers ADD COLUMN manager_id INTEGER REFERENCES users(id);

      CREATE TABLE personnel_sensitive (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        iban TEXT NOT NULL DEFAULT '',
        emergency_name TEXT NOT NULL DEFAULT '',
        emergency_relation TEXT NOT NULL DEFAULT '',
        emergency_phone TEXT NOT NULL DEFAULT '',
        anonymized_at TEXT
      );

      CREATE TABLE salaries (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        effective_date TEXT NOT NULL,
        gross REAL CHECK (gross >= 0),
        net REAL CHECK (net >= 0),
        currency TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','EUR','USD')),
        notes TEXT NOT NULL DEFAULT '',
        CHECK (gross IS NOT NULL OR net IS NOT NULL)
      );
      CREATE INDEX idx_salaries_user ON salaries(user_id, effective_date);

      ALTER TABLE expenses ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected'));
      ALTER TABLE expenses ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
      ALTER TABLE expenses ADD COLUMN reviewed_at TEXT;
      ALTER TABLE expenses ADD COLUMN review_note TEXT NOT NULL DEFAULT '';

      CREATE TABLE timesheets (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        week_start TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('submitted','approved','rejected')),
        submitted_at TEXT,
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TEXT,
        note TEXT NOT NULL DEFAULT '',
        UNIQUE (user_id, week_start)
      );

      CREATE TABLE period_closures (
        month TEXT PRIMARY KEY,
        closed_by INTEGER REFERENCES users(id),
        closed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );

      INSERT OR IGNORE INTO settings (key, value) VALUES ('show_own_salary', '0');
    `);

    const insert = db.prepare('INSERT INTO roles (name, description, system, locked, permissions) VALUES (?, ?, 1, ?, ?)');
    const ids = {};
    for (const r of DEFAULT_ROLES) ids[r.name] = Number(insert.run(r.name, r.description, r.locked, JSON.stringify(r.permissions)).lastInsertRowid);
    // Eski "admin" kullanıcılar Yönetici, diğerleri Çalışan olur
    db.prepare("UPDATE users SET role_id = ? WHERE role = 'admin'").run(ids['Yönetici']);
    db.prepare("UPDATE users SET role_id = ? WHERE role_id IS NULL").run(ids['Çalışan']);
  },
};
