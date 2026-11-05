// SWISE One sunucusu
const config = require('./src/config');
const { createApp } = require('./src/app');
const { db } = require('./src/db');
const { scheduleDailyBackup } = require('./src/lib/backup');
const { scheduleRates } = require('./src/modules/accounting/rates');

createApp().listen(config.port, () => {
  console.log(`SWISE One çalışıyor: http://localhost:${config.port}`);
  if (config.noLogin) {
    console.log('UYARI: Girişsiz geliştirme modu açık. Bu bilgisayardan gelen istekler giriş istemeden yönetici olarak kabul edilir.');
  }
});

scheduleDailyBackup(db, config);
scheduleRates();
