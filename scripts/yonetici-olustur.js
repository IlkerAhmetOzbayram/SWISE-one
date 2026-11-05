// Yönetici hesabı oluşturur ya da var olan bir kullanıcıyı Yönetici yapar (sunucuya erişimi olan kişi için).
// Kullanım: npm run yonetici-olustur -- <kullanıcı adı> ["Ad Soyad"]
// Parola terminalde gizli olarak sorulur. Canlıda ilk yönetici yalnızca bu komutla oluşturulur.
//
// Geliştirme sırasında oluşan "Yerel Yönetici" (yerel) hesabı varsa, girilen kayıtlar kaybolmasın diye
// bu hesabın yeni yöneticiye dönüştürülmesi önerilir.
const { ask, askNewPassword, fail, done } = require('./sor');

async function main() {
  const username = (process.argv[2] || '').toLowerCase();
  let fullName = (process.argv[3] || '').trim();
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) fail('Kullanım: npm run yonetici-olustur -- <kullanıcı adı> ["Ad Soyad"]\nKullanıcı adı küçük harf, rakam, nokta, tire içerebilir.');

  const { one, run, tx } = require('../src/db');
  const { hashPassword } = require('../src/lib/auth');
  const audit = require('../src/lib/audit');
  const cli = { ip: 'komut satırı' };

  const adminRole = one('SELECT id FROM roles WHERE locked = 1 ORDER BY id LIMIT 1');
  const existing = one('SELECT id, full_name FROM users WHERE username = ?', username);
  const local = !existing && username !== 'yerel' && one("SELECT id FROM users WHERE username = 'yerel'");

  let takeOver = false;
  if (local) {
    const n = one('SELECT (SELECT COUNT(*) FROM activities WHERE user_id = ?) + (SELECT COUNT(*) FROM expenses WHERE user_id = ?) n', local.id, local.id).n;
    const [answer = ''] = await ask([`Geliştirme sırasında oluşan "Yerel Yönetici" hesabı var (${n} aktivite/masraf kaydı).\n`
      + `Bu hesap "${username}" hesabına dönüştürülsün mü? Kayıtlar size geçer. [E/h] `]);
    takeOver = !/^h/i.test(answer);
  }
  if (!existing && !fullName) [fullName = ''] = await ask(['Ad soyad: ']);
  if (!existing && !fullName) fail('Ad soyad gerekli.');

  const pw = await askNewPassword(existing?.full_name || fullName);
  const hash = hashPassword(pw);

  tx(() => {
    if (existing) {
      run('UPDATE users SET password_hash = ?, role_id = ?, active = 1 WHERE id = ?', hash, adminRole.id, existing.id);
      run('DELETE FROM sessions WHERE user_id = ?', existing.id);
      audit.record(cli, 'admin_grant', 'users', existing.id, { kaynak: 'yonetici-olustur komutu' }, null);
    } else if (takeOver) {
      run('UPDATE users SET username = ?, full_name = ?, password_hash = ?, role_id = ?, active = 1 WHERE id = ?',
        username, fullName, hash, adminRole.id, local.id);
      run('DELETE FROM sessions WHERE user_id = ?', local.id);
      audit.record(cli, 'admin_grant', 'users', local.id, { kaynak: 'yonetici-olustur komutu', onceki: 'yerel' }, null);
    } else {
      const { lastInsertRowid } = run(`INSERT INTO users (username, full_name, password_hash, role, role_id) VALUES (?, ?, ?, 'admin', ?)`,
        username, fullName, hash, adminRole.id);
      audit.record(cli, 'admin_grant', 'users', Number(lastInsertRowid), { kaynak: 'yonetici-olustur komutu' }, null);
    }
  });
  console.log(`"${username}" artık Yönetici. Bu kullanıcı adı ve parolayla giriş yapabilirsiniz.`);
  done();
}

main();
