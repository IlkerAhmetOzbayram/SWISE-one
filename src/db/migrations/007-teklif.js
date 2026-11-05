// Teklifler: başlık, kalemler, ödeme planı, dondurulmuş sürümler (PDF + imzalı dosya) ve şablon ayarları.
// Hazır rollere teklif yetkileri eklenir (Yönetici kilitli olduğu için otomatik alır).

const TEMPLATE = {
  offer_number_prefix: 'SWISE',
  offer_signatory_name: '',
  offer_signatory_title: 'Genel Müdür',
  offer_signatory_title_en: 'General Manager',
  offer_intro_tr: 'Değerli iş ortağımız,\n\nTalebiniz doğrultusunda hazırladığımız teklifimizi bilgilerinize sunarız.',
  offer_intro_en: 'Dear partner,\n\nPlease find below our proposal prepared in line with your request.',
  offer_assumptions_tr: '• Çalışmalar mesai saatleri içinde ve uzaktan yürütülecektir.\n• Gerekli erişim ve bilgiler müşteri tarafından zamanında sağlanacaktır.',
  offer_assumptions_en: '• Work will be carried out remotely during business hours.\n• Required access and information will be provided by the client in a timely manner.',
  offer_terms_tr: '• Teklif, belirtilen geçerlilik süresince geçerlidir.\n• Fiyatlara aksi belirtilmedikçe KDV dahil değildir.\n• Seyahat ve konaklama giderleri ayrıca faturalandırılır.',
  offer_terms_en: '• This proposal is valid for the stated validity period.\n• Prices exclude VAT unless stated otherwise.\n• Travel and accommodation expenses are invoiced separately.',
};

module.exports = {
  id: 7,
  name: 'teklifler',
  up(db) {
    db.exec(`
      CREATE TABLE offers (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        year INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        company_id INTEGER NOT NULL REFERENCES companies(id),
        contact_id INTEGER REFERENCES contacts(id),
        language TEXT NOT NULL DEFAULT 'tr' CHECK (language IN ('tr','en')),
        title TEXT NOT NULL,
        offer_date TEXT NOT NULL,
        valid_days INTEGER NOT NULL DEFAULT 30 CHECK (valid_days > 0),
        currency TEXT NOT NULL DEFAULT 'TRY' CHECK (currency IN ('TRY','EUR','USD')),
        payment_days INTEGER NOT NULL DEFAULT 30,
        vat_rate REAL NOT NULL DEFAULT 20,
        intro TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT '',
        assumptions TEXT NOT NULL DEFAULT '',
        terms TEXT NOT NULL DEFAULT '',
        internal_notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft','pending_approval','approved','signed','sent','accepted','rejected')),
        review_note TEXT NOT NULL DEFAULT '',
        decision_note TEXT NOT NULL DEFAULT '',
        created_by INTEGER NOT NULL REFERENCES users(id),
        submitted_at TEXT,
        approved_by INTEGER REFERENCES users(id),
        approved_at TEXT,
        sent_at TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (year, seq)
      );
      CREATE INDEX idx_offers_customer ON offers(customer_id);

      CREATE TABLE offer_items (
        id INTEGER PRIMARY KEY,
        offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service','fixed','license')),
        description TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity >= 0),
        unit TEXT NOT NULL DEFAULT '',
        unit_price REAL NOT NULL CHECK (unit_price >= 0),
        discount_pct REAL NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100)
      );

      CREATE TABLE offer_payments (
        id INTEGER PRIMARY KEY,
        offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount >= 0),
        due TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE offer_versions (
        id INTEGER PRIMARY KEY,
        offer_id INTEGER NOT NULL REFERENCES offers(id),
        revision INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        pdf_path TEXT NOT NULL,
        pdf_sha256 TEXT NOT NULL,
        approved_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        signed_path TEXT,
        signed_name TEXT,
        signed_sha256 TEXT,
        signed_by INTEGER REFERENCES users(id),
        signed_at TEXT,
        UNIQUE (offer_id, revision)
      );
    `);

    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(TEMPLATE)) insert.run(k, v);

    // Hazır rollere varsayılan teklif yetkileri
    const add = {
      Muhasebe: { 'offers.view': 'all' },
      'Proje Yöneticisi': { 'offers.view': 'assigned', 'offers.edit': 'own' },
    };
    for (const [name, perms] of Object.entries(add)) {
      const r = db.prepare('SELECT id, permissions FROM roles WHERE name = ? AND system = 1').get(name);
      if (r) db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(r.permissions), ...perms }), r.id);
    }
  },
};
