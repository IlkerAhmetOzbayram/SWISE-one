// Kullanıcı parolasını sıfırlar (sunucuya erişimi olan yönetici için).
// Kullanım: npm run parola-sifirla -- <kullanıcı adı>
// Yeni parola terminalde gizli olarak sorulur; kullanıcının tüm oturumları kapatılır.
const { askNewPassword, fail, done } = require('./sor');

async function main() {
  const username = (process.argv[2] || '').toLowerCase();
  if (!username) fail('Kullanım: npm run parola-sifirla -- <kullanıcı adı>');
  const { one, run, tx } = require('../src/db');
  const { hashPassword } = require('../src/lib/auth');
  const audit = require('../src/lib/audit');

  const user = one('SELECT id, full_name FROM users WHERE username = ?', username);
  if (!user) fail(`"${username}" adlı kullanıcı bulunamadı.`);
  const pw = await askNewPassword(user.full_name);

  tx(() => {
    run('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', hashPassword(pw), user.id);
    run('DELETE FROM sessions WHERE user_id = ?', user.id);
    audit.record({ ip: 'komut satırı' }, 'password_reset', 'users', user.id, { kaynak: 'parola-sifirla komutu' }, null);
  });
  console.log('Parola güncellendi. Artık yeni parolanızla giriş yapabilirsiniz.');
  done();
}

main();
