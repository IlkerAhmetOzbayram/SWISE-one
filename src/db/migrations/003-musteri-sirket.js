// Müşteri (grup) → Şirket (fatura birimi) → Proje yapısı, günlük ücret ve para birimi.
// Eski "clients" tablosu fatura bilgilerini taşıdığı için "companies" olur;
// her eski müşteri, tek şirketli yeni bir müşteriye dönüşür. Saatlik ücretler × 8 = günlük ücret.
module.exports = {
  id: 3,
  name: 'müşteri-şirket yapısı',
  up(db) {
    db.exec(`
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        daily_rate REAL NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
        currency TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','EUR','USD')),
        payment_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_days >= 0),
        notes TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1
      );

      ALTER TABLE clients RENAME TO companies;
      ALTER TABLE companies ADD COLUMN customer_id INTEGER REFERENCES customers(id);
      ALTER TABLE companies ADD COLUMN email TEXT NOT NULL DEFAULT '';
      ALTER TABLE companies ADD COLUMN phone TEXT NOT NULL DEFAULT '';
      ALTER TABLE companies ADD COLUMN daily_rate REAL CHECK (daily_rate >= 0);
      ALTER TABLE companies ADD COLUMN currency TEXT CHECK (currency IN ('TRY','EUR','USD'));
      ALTER TABLE companies ADD COLUMN payment_days INTEGER CHECK (payment_days >= 0);
      ALTER TABLE companies ADD COLUMN vat_exempt INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_companies_customer ON companies(customer_id);

      ALTER TABLE projects RENAME COLUMN client_id TO company_id;
      ALTER TABLE projects ADD COLUMN daily_rate REAL CHECK (daily_rate >= 0);
      UPDATE projects SET daily_rate = hourly_rate * 8 WHERE hourly_rate IS NOT NULL;
      ALTER TABLE projects DROP COLUMN hourly_rate;
      CREATE INDEX idx_projects_company ON projects(company_id);

      ALTER TABLE activities ADD COLUMN daily_rate REAL NOT NULL DEFAULT 0;
      ALTER TABLE activities ADD COLUMN currency TEXT NOT NULL DEFAULT 'TRY';
      UPDATE activities SET daily_rate = rate * 8;
      ALTER TABLE activities DROP COLUMN rate;

      ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'TRY';

      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        company_id INTEGER REFERENCES companies(id),
        full_name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        receives_offers INTEGER NOT NULL DEFAULT 0,
        receives_invoices INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_contacts_customer ON contacts(customer_id);
    `);

    const companies = db.prepare('SELECT id, name, default_rate, active FROM companies').all();
    const insertCustomer = db.prepare('INSERT INTO customers (name, daily_rate, active) VALUES (?, ?, ?)');
    const link = db.prepare('UPDATE companies SET customer_id = ? WHERE id = ?');
    for (const c of companies) {
      const { lastInsertRowid } = insertCustomer.run(c.name, (c.default_rate ?? 0) * 8, c.active);
      link.run(lastInsertRowid, c.id);
    }
    db.exec('ALTER TABLE companies DROP COLUMN default_rate');
  },
};
