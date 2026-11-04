// Ortam değişkenleriyle ayarlanabilen yapılandırma
const path = require('path');

const root = path.join(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(root, 'data.db'),
  backupDir: process.env.BACKUP_DIR || path.join(root, 'backups'),
  backupKeep: Number(process.env.BACKUP_KEEP) || 14,
  // Bulutta HTTPS arkasında çalışırken: NODE_ENV=production ve (proxy varsa) TRUST_PROXY=1
  production: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
};
