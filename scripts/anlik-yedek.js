// Veritabanının anlık, tutarlı bir kopyasını alır (uygulama çalışırken de güvenlidir).
// Kullanım: node scripts/anlik-yedek.js <hedef dosya>
// Geçişleri çalıştırmaz: güncelleme öncesi yedekte veritabanı olduğu gibi kopyalanır.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');

const target = process.argv[2];
if (!target) {
  console.error('Kullanım: node scripts/anlik-yedek.js <hedef dosya>');
  process.exit(1);
}
if (fs.existsSync(target)) {
  console.error(`Hedef dosya zaten var: ${target}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
const db = new DatabaseSync(config.dbPath, { readOnly: true });
db.exec(`VACUUM INTO '${path.resolve(target).replace(/'/g, "''")}'`);
db.close();
console.log(`Yedek alındı: ${target}`);
