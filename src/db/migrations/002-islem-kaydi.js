// İşlem kaydı (audit log): kim, ne zaman, hangi kaydı nasıl değiştirdi
module.exports = {
  id: 2,
  name: 'işlem kaydı',
  up(db) {
    db.exec(`
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER,
        details TEXT NOT NULL DEFAULT '{}',
        ip TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_audit_at ON audit_log(at);
      CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
    `);
  },
};
