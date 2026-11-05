// Komut satırı betikleri için soru-cevap yardımcıları.
// Tek bir okuyucu kullanılır; girdi borudan gelse de (testler, otomasyon) satırlar kaybolmaz.
const readline = require('readline');

let rl = null;
let hidden = false;
const lines = [];
const waiting = [];

function reader() {
  if (rl) return rl;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => { if (!hidden) write(s); };
  rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
  rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
  return rl;
}

const nextLine = () => new Promise((resolve) => (lines.length ? resolve(lines.shift()) : waiting.push(resolve)));

// Soruları sırayla sorar; hidden ise yazılanlar ekranda görünmez (parola)
async function ask(prompts, opts = {}) {
  reader();
  const answers = [];
  for (const prompt of prompts) {
    process.stdout.write(prompt);
    hidden = Boolean(opts.hidden);
    const line = await nextLine();
    answers.push(hidden ? line : line.trim());
    if (hidden) process.stdout.write('\n');
    hidden = false;
  }
  return answers;
}

const MIN_PASSWORD = 8;

// İki kez sorulan yeni parola; geçersizse hata mesajıyla çıkar
async function askNewPassword(label) {
  const [pw = '', pw2 = ''] = await ask([`${label} için parola: `, 'Parola (tekrar): '], { hidden: true });
  if (pw.length < MIN_PASSWORD) fail(`Parola en az ${MIN_PASSWORD} karakter olmalı.`);
  if (pw !== pw2) fail('Parolalar eşleşmiyor.');
  return pw;
}

const done = () => rl?.close();

function fail(message) {
  console.error(message);
  process.exit(1);
}

module.exports = { ask, askNewPassword, fail, done };
