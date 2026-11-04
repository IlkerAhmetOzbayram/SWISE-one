const { bad } = require('./http');

const str = (v, field, required = true) => {
  const s = (v ?? '').toString().trim();
  if (required && !s) bad(`${field} zorunludur`);
  return s;
};

const num = (v, field, { required = true, min = 0 } = {}) => {
  if (v === null || v === undefined || v === '') {
    if (required) bad(`${field} zorunludur`);
    return null;
  }
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min) bad(`${field} geçersiz`);
  return n;
};

const date = (v, field = 'Tarih') => {
  const s = str(v, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) bad(`${field} geçersiz`);
  return s;
};

const flag = (v) => (v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0);

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

module.exports = { str, num, date, flag, r2 };
