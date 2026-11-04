// Kullanıcı parolasını sıfırlar (sunucuya erişimi olan yönetici için).
// Kullanım: npm run parola-sifirla -- <kullanıcı adı>
// Yeni parola terminalde gizli olarak sorulur; kullanıcının tüm oturumları kapatılır.
const readline = require('readline');

// Soruları sırayla sorar; yazılanlar ekranda görünmez
function askPasswords(prompts) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl._writeToOutput = () => {};
    const answers = [];
    process.stdout.write(prompts[0]);
    rl.on('line', (line) => {
      answers.push(line);
      process.stdout.write('\n');
      if (answers.length === prompts.length) rl.close();
      else process.stdout.write(prompts[answers.length]);
    });
    rl.on('close', () => resolve(answers));
  });
}

async function main() {
  const username = (process.argv[2] || '').toLowerCase();
  if (!username) {
    console.error('Kullanım: npm run parola-sifirla -- <kullanıcı adı>');
    process.exit(1);
  }
  const { one, run, tx } = require('../src/db');
  const { hashPassword } = require('../src/lib/auth');
  const audit = require('../src/lib/audit');

  const user = one('SELECT id, full_name FROM users WHERE username = ?', username);
  if (!user) {
    console.error(`"${username}" adlı kullanıcı bulunamadı.`);
    process.exit(1);
  }
  const [pw = '', pw2 = ''] = await askPasswords([`${user.full_name} için yeni parola: `, 'Yeni parola (tekrar): ']);
  if (pw.length < 6) { console.error('Parola en az 6 karakter olmalı.'); process.exit(1); }
  if (pw !== pw2) { console.error('Parolalar eşleşmiyor.'); process.exit(1); }

  tx(() => {
    run('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', hashPassword(pw), user.id);
    run('DELETE FROM sessions WHERE user_id = ?', user.id);
    audit.record({ ip: 'komut satırı' }, 'password_reset', 'users', user.id, { kaynak: 'parola-sifirla komutu' }, null);
  });
  console.log('Parola güncellendi. Artık yeni parolanızla giriş yapabilirsiniz.');
}

main();
