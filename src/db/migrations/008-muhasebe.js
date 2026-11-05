// Muhasebe: kasa/banka hesapları, tedarikçiler, gelir/gider kategorileri, döviz kurları,
// faturalar (giden/gelen) ve kalemleri, hesap hareketleri, bordro, kategori bütçesi.
// Uygulama resmi e-fatura kesmez; faturalar kayıt amaçlıdır.

const CATEGORIES = [
  ['income', 'Hizmet geliri'], ['income', 'Lisans geliri'], ['income', 'Yansıtılan masraf'], ['income', 'Faiz ve kur farkı'], ['income', 'Diğer gelir'],
  ['expense', 'Personel (maaş ve SGK)'], ['expense', 'Kira'], ['expense', 'Ofis giderleri'], ['expense', 'Yazılım ve lisans'],
  ['expense', 'Ulaşım ve konaklama'], ['expense', 'Danışmanlık / hizmet alımı'], ['expense', 'Vergi ve harçlar'],
  ['expense', 'Banka masrafları'], ['expense', 'Diğer gider'],
];

module.exports = {
  id: 8,
  name: 'muhasebe',
  up(db) {
    db.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'bank' CHECK (type IN ('cash','bank')),
        currency TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','EUR','USD')),
        iban TEXT NOT NULL DEFAULT '',
        opening_balance REAL NOT NULL DEFAULT 0,
        opening_date TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE suppliers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        tax_no TEXT NOT NULL DEFAULT '',
        tax_office TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        payment_days INTEGER NOT NULL DEFAULT 30,
        notes TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE categories (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        UNIQUE (kind, name)
      );

      CREATE TABLE exchange_rates (
        date TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (currency IN ('EUR','USD')),
        buying REAL NOT NULL CHECK (buying > 0),
        selling REAL NOT NULL CHECK (selling > 0),
        source TEXT NOT NULL DEFAULT 'TCMB',
        PRIMARY KEY (date, currency)
      );

      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY,
        direction TEXT NOT NULL CHECK (direction IN ('out','in')),
        company_id INTEGER REFERENCES companies(id),
        supplier_id INTEGER REFERENCES suppliers(id),
        number TEXT NOT NULL DEFAULT '',
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','EUR','USD')),
        rate REAL NOT NULL DEFAULT 1 CHECK (rate > 0),
        category_id INTEGER REFERENCES categories(id),
        description TEXT NOT NULL DEFAULT '',
        vat_rate REAL NOT NULL DEFAULT 0,
        withholding_rate REAL NOT NULL DEFAULT 0,
        subtotal REAL NOT NULL DEFAULT 0,
        vat REAL NOT NULL DEFAULT 0,
        withholding REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        net REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
        attachment_path TEXT,
        attachment_name TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        CHECK ((direction = 'out' AND company_id IS NOT NULL) OR (direction = 'in' AND supplier_id IS NOT NULL))
      );
      CREATE INDEX idx_invoices_due ON invoices(direction, due_date);

      CREATE TABLE invoice_lines (
        id INTEGER PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT '',
        unit_price REAL NOT NULL DEFAULT 0,
        line_total REAL NOT NULL DEFAULT 0,
        is_service INTEGER NOT NULL DEFAULT 1
      );

      ALTER TABLE activities ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);
      ALTER TABLE expenses ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);

      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        date TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in','out')),
        kind TEXT NOT NULL CHECK (kind IN ('collection','payment','income','expense','salary_payment','advance',
                                           'expense_refund','sgk_payment','tax_payment')),
        amount REAL NOT NULL CHECK (amount > 0),
        rate REAL NOT NULL DEFAULT 1 CHECK (rate > 0),
        amount_try REAL NOT NULL,
        invoice_id INTEGER REFERENCES invoices(id),
        invoice_amount REAL,
        company_id INTEGER REFERENCES companies(id),
        supplier_id INTEGER REFERENCES suppliers(id),
        user_id INTEGER REFERENCES users(id),
        category_id INTEGER REFERENCES categories(id),
        description TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE INDEX idx_transactions_date ON transactions(date);

      CREATE TABLE payroll (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        period TEXT NOT NULL,
        gross REAL NOT NULL DEFAULT 0,
        net REAL NOT NULL DEFAULT 0,
        employee_sgk REAL NOT NULL DEFAULT 0,
        employer_sgk REAL NOT NULL DEFAULT 0,
        income_tax REAL NOT NULL DEFAULT 0,
        stamp_tax REAL NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        UNIQUE (user_id, period)
      );

      CREATE TABLE category_budgets (
        id INTEGER PRIMARY KEY,
        month TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        amount REAL NOT NULL CHECK (amount >= 0),
        UNIQUE (month, category_id)
      );
    `);
    const insert = db.prepare('INSERT INTO categories (kind, name) VALUES (?, ?)');
    for (const [kind, name] of CATEGORIES) insert.run(kind, name);

    // Muhasebe rolüne muhasebe yetkileri (Yönetici kilitli olduğundan otomatik alır)
    const r = db.prepare("SELECT id, permissions FROM roles WHERE name = 'Muhasebe' AND system = 1").get();
    if (r) {
      db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
        .run(JSON.stringify({ ...JSON.parse(r.permissions), 'accounting.view': true, 'accounting.edit': true }), r.id);
    }
  },
};
