// Resmi tatiller (iş günü hesabı) ve aylık müşteri planları (bütçe)
// Dini bayram tarihleri Diyanet takvimine göredir; yönetici Ayarlar'dan düzeltebilir.
const range = (from, to, name) => {
  const out = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let i = 1;
  while (d <= end) {
    out.push([`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, `${name} ${i}. gün`, 'full']);
    d.setDate(d.getDate() + 1);
    i += 1;
  }
  return out;
};

const fixed = (y) => [
  [`${y}-01-01`, 'Yılbaşı', 'full'],
  [`${y}-04-23`, 'Ulusal Egemenlik ve Çocuk Bayramı', 'full'],
  [`${y}-05-01`, 'Emek ve Dayanışma Günü', 'full'],
  [`${y}-05-19`, "Atatürk'ü Anma, Gençlik ve Spor Bayramı", 'full'],
  [`${y}-07-15`, 'Demokrasi ve Milli Birlik Günü', 'full'],
  [`${y}-08-30`, 'Zafer Bayramı', 'full'],
  [`${y}-10-28`, 'Cumhuriyet Bayramı Arifesi (yarım gün)', 'half'],
  [`${y}-10-29`, 'Cumhuriyet Bayramı', 'full'],
];

const HOLIDAYS = [
  ...fixed(2026),
  ['2026-03-19', 'Ramazan Bayramı Arifesi (yarım gün)', 'half'],
  ...range('2026-03-20', '2026-03-22', 'Ramazan Bayramı'),
  ['2026-05-26', 'Kurban Bayramı Arifesi (yarım gün)', 'half'],
  ...range('2026-05-27', '2026-05-30', 'Kurban Bayramı'),
  ...fixed(2027),
  ['2027-03-08', 'Ramazan Bayramı Arifesi (yarım gün)', 'half'],
  ...range('2027-03-09', '2027-03-11', 'Ramazan Bayramı'),
  ['2027-05-15', 'Kurban Bayramı Arifesi (yarım gün)', 'half'],
  ...range('2027-05-16', '2027-05-19', 'Kurban Bayramı'),
];

module.exports = {
  id: 5,
  name: 'tatiller ve aylık plan',
  up(db) {
    db.exec(`
      CREATE TABLE holidays (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full','half'))
      );

      CREATE TABLE budget_plans (
        id INTEGER PRIMARY KEY,
        month TEXT NOT NULL,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        company_id INTEGER REFERENCES companies(id),
        project_id INTEGER REFERENCES projects(id),
        planned_days REAL NOT NULL CHECK (planned_days >= 0),
        notes TEXT NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX idx_plans_target ON budget_plans(month, customer_id, IFNULL(company_id, 0), IFNULL(project_id, 0));
    `);
    // Aynı güne denk gelen tatiller tek kayıtta birleştirilir (örn. 19 Mayıs 2027)
    const merged = new Map();
    for (const [date, name, kind] of HOLIDAYS) {
      const prev = merged.get(date);
      merged.set(date, prev ? [`${prev[0]} / ${name}`, prev[1] === 'full' || kind === 'full' ? 'full' : 'half'] : [name, kind]);
    }
    const insert = db.prepare('INSERT INTO holidays (date, name, kind) VALUES (?, ?, ?)');
    for (const [date, [name, kind]] of [...merged].sort()) insert.run(date, name, kind);
  },
};
