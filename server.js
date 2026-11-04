// SWISE One sunucusu
const config = require('./src/config');
const { createApp } = require('./src/app');
const { db } = require('./src/db');
const { scheduleDailyBackup } = require('./src/lib/backup');

createApp().listen(config.port, () => {
  console.log(`SWISE One çalışıyor: http://localhost:${config.port}`);
});

scheduleDailyBackup(db, config);
