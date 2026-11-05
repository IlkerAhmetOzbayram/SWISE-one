// Döviz kurları: TCMB günlük kurları (today.xml / arşiv) ve elle giriş.
// Hafta sonu ve tatillerde TCMB yayın yapmaz; bir tarihin kuru, o tarihte veya öncesindeki en yakın kurdur.
const { one, all, run } = require('../../db');

const CURRENCIES = ['EUR', 'USD'];

// TCMB XML'inden tarih ve EUR/USD döviz alış-satış kurlarını çıkarır
function parseTcmbXml(xml) {
  const d = xml.match(/Tarih="(\d{2})\.(\d{2})\.(\d{4})"/);
  if (!d) throw new Error('TCMB yanıtında tarih bulunamadı');
  const date = `${d[3]}-${d[2]}-${d[1]}`;
  const rates = [];
  for (const cur of CURRENCIES) {
    const block = xml.match(new RegExp(`<Currency[^>]*CurrencyCode="${cur}"[^>]*>([\\s\\S]*?)</Currency>`));
    if (!block) continue;
    const pick = (tag) => Number(block[1].match(new RegExp(`<${tag}>([\\d.]+)</${tag}>`))?.[1]);
    const buying = pick('ForexBuying');
    const selling = pick('ForexSelling');
    if (buying > 0 && selling > 0) rates.push({ currency: cur, buying, selling });
  }
  if (!rates.length) throw new Error('TCMB yanıtında kur bulunamadı');
  return { date, rates };
}

function saveRates({ date, rates }, source = 'TCMB') {
  for (const r of rates) {
    run(`INSERT INTO exchange_rates (date, currency, buying, selling, source) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date, currency) DO UPDATE SET buying = excluded.buying, selling = excluded.selling, source = excluded.source`,
    date, r.currency, r.buying, r.selling, source);
  }
}

// Belirli günün kurunu (yoksa önceki 7 güne kadar) TCMB'den çeker. fetchImpl testler için değiştirilebilir.
async function fetchTcmb(date = null, fetchImpl = fetch) {
  const urls = [];
  if (!date) urls.push('https://www.tcmb.gov.tr/kurlar/today.xml');
  else {
    const d = new Date(`${date}T00:00:00`);
    for (let i = 0; i < 7; i += 1) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      urls.push(`https://www.tcmb.gov.tr/kurlar/${y}${m}/${day}${m}${y}.xml`);
      d.setDate(d.getDate() - 1);
    }
  }
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) { lastError = new Error(`TCMB ${res.status}`); continue; }
      const parsed = parseTcmbXml(await res.text());
      saveRates(parsed);
      return parsed;
    } catch (err) { lastError = err; }
  }
  throw lastError || new Error('TCMB kuru alınamadı');
}

// Tarihteki (veya öncesindeki en yakın) kur; TRY için 1. side: 'buying' | 'selling'
function rateFor(currency, date, side = 'buying') {
  if (currency === 'TRY') return { rate: 1, date, source: 'TRY' };
  const r = one(`SELECT date, ${side === 'selling' ? 'selling' : 'buying'} rate, source FROM exchange_rates
                 WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1`, currency, date);
  return r ? { ...r } : null;
}

const listRates = (limit = 60) => all('SELECT * FROM exchange_rates ORDER BY date DESC, currency LIMIT ?', limit);

// Sunucu açılışında ve 6 saatte bir bugünün kurunu çekmeyi dener (RATES_AUTO=0 ile kapatılır)
function scheduleRates() {
  if (process.env.RATES_AUTO === '0') return null;
  const tick = () => fetchTcmb().then((r) => console.log(`TCMB kurları alındı: ${r.date}`))
    .catch((err) => console.error('TCMB kurları alınamadı:', err.message));
  tick();
  const timer = setInterval(tick, 6 * 3600e3);
  timer.unref();
  return timer;
}

module.exports = { parseTcmbXml, saveRates, fetchTcmb, rateFor, listRates, scheduleRates, CURRENCIES };
