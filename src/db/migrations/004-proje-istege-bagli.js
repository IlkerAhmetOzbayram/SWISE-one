// Aktivite ve masraflar doğrudan şirkete bağlanır; proje isteğe bağlı olur.
// project_id'deki NOT NULL kaldırılamadığı için tablolar yeniden kurulur (bu tablolara başka tablo bağlı değil).
module.exports = {
  id: 4,
  name: 'aktivite ve masrafta proje isteğe bağlı',
  up(db) {
    db.exec(`
      CREATE TABLE activities_new (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        company_id INTEGER NOT NULL REFERENCES companies(id),
        project_id INTEGER REFERENCES projects(id),
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        hours REAL NOT NULL CHECK (hours > 0),
        billable INTEGER NOT NULL DEFAULT 1,
        daily_rate REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'TRY',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO activities_new (id, user_id, company_id, project_id, date, description, hours, billable, daily_rate, currency, created_at)
        SELECT a.id, a.user_id, p.company_id, a.project_id, a.date, a.description, a.hours, a.billable, a.daily_rate, a.currency, a.created_at
        FROM activities a JOIN projects p ON p.id = a.project_id;
      DROP TABLE activities;
      ALTER TABLE activities_new RENAME TO activities;
      CREATE INDEX idx_activities_date ON activities(date);
      CREATE INDEX idx_activities_company ON activities(company_id);

      CREATE TABLE expenses_new (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        company_id INTEGER NOT NULL REFERENCES companies(id),
        project_id INTEGER REFERENCES projects(id),
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL CHECK (amount >= 0),
        currency TEXT NOT NULL DEFAULT 'TRY',
        vat_rate REAL NOT NULL DEFAULT 20,
        billable INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO expenses_new (id, user_id, company_id, project_id, date, category, description, amount, currency, vat_rate, billable, created_at)
        SELECT e.id, e.user_id, p.company_id, e.project_id, e.date, e.category, e.description, e.amount, e.currency, e.vat_rate, e.billable, e.created_at
        FROM expenses e JOIN projects p ON p.id = e.project_id;
      DROP TABLE expenses;
      ALTER TABLE expenses_new RENAME TO expenses;
      CREATE INDEX idx_expenses_date ON expenses(date);
      CREATE INDEX idx_expenses_company ON expenses(company_id);
    `);
  },
};
