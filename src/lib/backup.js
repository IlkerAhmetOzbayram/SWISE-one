// Veritabanı yedekleri: her gün bir kopya (swise-YYYY-MM-DD.db), son N gün saklanır.
// VACUUM INTO, uygulama çalışırken tutarlı bir anlık kopya üretir.
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = /^swise-\d{4}-\d{2}-\d{2}\.db$/;
const sqlString = (s) => `'${s.replace(/'/g, "''")}'`;
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const snapshotTo = (db, file) => db.exec(`VACUUM INTO ${sqlString(file)}`);

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse().map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, size: st.size, created_at: st.mtime.toISOString() };
  });
}

function prune(dir, keep) {
  for (const b of listBackups(dir).slice(keep)) fs.unlinkSync(path.join(dir, b.name));
}

function dailyBackup(db, dir, keep, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `swise-${localDay(now)}.db`);
  const created = !fs.existsSync(file);
  if (created) snapshotTo(db, file);
  prune(dir, keep);
  return { file, created };
}

// Yüklenen dosyalar (teklif PDF'leri, imzalı dosyalar) değişmez; yedekte olmayanlar kopyalanır
function syncUploads(src, dest) {
  if (!src || !fs.existsSync(src)) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copied += syncUploads(from, to);
    else if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) {
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    }
  }
  return copied;
}

// Açılışta ve saatte bir kontrol eder; o günün yedeği yoksa alır, yeni yüklenen dosyaları kopyalar
function scheduleDailyBackup(db, { backupDir, backupKeep, uploadDir }) {
  const tick = () => {
    try {
      const r = dailyBackup(db, backupDir, backupKeep);
      if (r.created) console.log(`Yedek alındı: ${r.file}`);
      const n = syncUploads(uploadDir, path.join(backupDir, 'uploads'));
      if (n) console.log(`Yedeğe ${n} dosya kopyalandı`);
    } catch (err) {
      console.error('Yedek alınamadı:', err.message);
    }
  };
  tick();
  const timer = setInterval(tick, 3600e3);
  timer.unref();
  return timer;
}

// İndirme için geçici kopya; gönderildikten sonra silinmeli
function tempSnapshot(db) {
  const file = path.join(os.tmpdir(), `swise-indir-${Date.now()}.db`);
  snapshotTo(db, file);
  return file;
}

module.exports = { dailyBackup, listBackups, scheduleDailyBackup, tempSnapshot, syncUploads };
