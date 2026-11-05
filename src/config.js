// Ortam değişkenleriyle ayarlanabilen yapılandırma
const path = require('path');

const root = path.join(__dirname, '..');

// Girişsiz geliştirme modu: yalnızca canlı (production) değilken ve açıkça istenirse.
// Bu modda bile yalnızca bu bilgisayardan (localhost) gelen istekler girişsiz kabul edilir.
const noLoginEnabled = (env, argv) =>
  env.NODE_ENV !== 'production' && (env.NO_LOGIN === '1' || argv.includes('--girissiz'));

module.exports = {
  noLoginEnabled,
  noLogin: noLoginEnabled(process.env, process.argv),
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(root, 'data.db'),
  backupDir: process.env.BACKUP_DIR || path.join(root, 'backups'),
  // Teklif PDF'leri ve imzalı dosyalar
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  backupKeep: Number(process.env.BACKUP_KEEP) || 14,
  // Bulutta HTTPS arkasında çalışırken: NODE_ENV=production ve (proxy varsa) TRUST_PROXY=1
  production: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
};
