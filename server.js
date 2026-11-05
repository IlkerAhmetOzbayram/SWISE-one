// SWISE One sunucusu
const config = require('./src/config');
const { createApp } = require('./src/app');
const { db } = require('./src/db');
const { scheduleDailyBackup } = require('./src/lib/backup');
const { scheduleRates } = require('./src/modules/accounting/rates');

if (config.production && !config.publicUrl) {
  console.error('HATA: Canlıda PUBLIC_URL tanımlanmalı (örn. https://one.swise.com.tr). Davet bağlantıları bu adresle oluşturulur.');
  process.exit(1);
}

const server = createApp().listen(config.port, config.host, () => {
  console.log(`SWISE One çalışıyor: ${config.publicUrl || `http://localhost:${config.port}`}`);
  if (config.noLogin) {
    console.log('UYARI: Girişsiz geliştirme modu açık. Bu bilgisayardan gelen istekler giriş istemeden yönetici olarak kabul edilir.');
  }
});

scheduleDailyBackup(db, config);
scheduleRates();

// Servis durdurulurken (güncelleme, yeniden başlatma) açık istekler tamamlanır ve veritabanı düzgün kapatılır
function shutdown(signal) {
  console.log(`${signal} alındı, kapatılıyor...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10e3).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
