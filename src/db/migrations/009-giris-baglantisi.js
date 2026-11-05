// Tek kullanımlık giriş bağlantıları: yeni personel daveti ve parola sıfırlama.
// Bağlantıdaki anahtarın kendisi değil, SHA-256 özeti saklanır.

module.exports = {
  id: 9,
  name: 'giris-baglantisi',
  up(db) {
    db.exec(`
      CREATE TABLE password_links (
        id INTEGER PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('invite','reset')),
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE INDEX password_links_user ON password_links (user_id);
    `);
  },
};
