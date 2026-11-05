// Muhasebe hesap kuralları (tek yerde):
//   Fatura:   ara toplam = Σ kalem; KDV = ara toplam × KDV%; stopaj = hizmet kalemleri × stopaj%;
//             toplam = ara toplam + KDV; net (tahsil/ödenecek) = toplam − stopaj
//   Ödeme durumu: kesilmiş faturada kalan = net − Σ bağlı tahsilat/ödeme (fatura para biriminde)
//   Hesap bakiyesi: açılış + Σ giriş − Σ çıkış (hesabın para biriminde)
//   Personel bakiyesi (şirketin personele borcu): Σ net maaş tahakkuku + Σ onaylı masraf (KDV dahil, TL)
//                                                 − Σ maaş ödemesi − Σ avans − Σ masraf iadesi
const { one, all } = require('../../db');
const { r2 } = require('../../lib/validate');
const { today } = require('../../lib/workdays');
const { rateFor } = require('./rates');

const INCOMING = ['collection', 'income'];
const PERSONNEL_KINDS = ['salary_payment', 'advance', 'expense_refund'];
const directionOf = (kind) => (INCOMING.includes(kind) ? 'in' : 'out');

function computeInvoice(lines, vatRate, withholdingRate) {
  const ls = lines.map((l) => ({ ...l, line_total: r2(l.line_total ?? l.quantity * l.unit_price) }));
  const subtotal = r2(ls.reduce((a, l) => a + l.line_total, 0));
  const service = r2(ls.filter((l) => l.is_service).reduce((a, l) => a + l.line_total, 0));
  const vat = r2(subtotal * vatRate / 100);
  const withholding = r2(service * withholdingRate / 100);
  const total = r2(subtotal + vat);
  return { lines: ls, subtotal, vat, withholding, total, net: r2(total - withholding) };
}

const paidOf = (invoiceId) => r2(one('SELECT COALESCE(SUM(invoice_amount), 0) s FROM transactions WHERE invoice_id = ?', invoiceId).s);

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 864e5);
}

function invoiceState(inv, asOf = today()) {
  const paid = paidOf(inv.id);
  const outstanding = inv.status === 'issued' ? r2(inv.net - paid) : 0;
  let payment = inv.status;
  if (inv.status === 'issued') payment = outstanding <= 0.005 ? 'paid' : paid > 0 ? 'partial' : 'open';
  const overdueDays = outstanding > 0.005 && inv.due_date < asOf ? daysBetween(inv.due_date, asOf) : 0;
  return { paid, outstanding, outstanding_try: r2(outstanding * inv.rate), payment_status: payment, overdue_days: overdueDays };
}

function accountBalance(acc) {
  const s = one(`SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) s FROM transactions WHERE account_id = ?`, acc.id).s;
  return r2(acc.opening_balance + s);
}

// Bir tutarın TL karşılığı (kur bulunamazsa null)
function toTry(amount, currency, date, side = 'buying') {
  const r = rateFor(currency, date, side);
  return r ? r2(amount * r.rate) : null;
}

// Personel carisi: her kişi için tahakkuk, ödeme ve bakiye (TL)
function personnelLedger(userId = null) {
  const users = all(`SELECT id, full_name, active FROM users WHERE username != 'yerel' ${userId ? 'AND id = ?' : ''} ORDER BY full_name`,
    ...(userId ? [userId] : []));
  return users.map((u) => {
    const salary = one('SELECT COALESCE(SUM(net), 0) s FROM payroll WHERE user_id = ?', u.id).s;
    let refundsOwed = 0;
    let missingRate = 0;
    for (const e of all("SELECT amount, vat_rate, currency, date FROM expenses WHERE user_id = ? AND status = 'approved'", u.id)) {
      const v = toTry(e.amount * (1 + e.vat_rate / 100), e.currency, e.date, 'selling');
      if (v === null) missingRate += 1; else refundsOwed += v;
    }
    const paid = (kind) => one('SELECT COALESCE(SUM(amount_try), 0) s FROM transactions WHERE user_id = ? AND kind = ?', u.id, kind).s;
    const out = {
      user_id: u.id, full_name: u.full_name, active: u.active,
      salary_accrued: r2(salary), refunds_owed: r2(refundsOwed),
      salary_paid: r2(paid('salary_payment')), advances: r2(paid('advance')), refunds_paid: r2(paid('expense_refund')),
      missing_rate: missingRate,
    };
    out.balance = r2(out.salary_accrued + out.refunds_owed - out.salary_paid - out.advances - out.refunds_paid);
    return out;
  });
}

// Devlete borç: SGK (işçi + işveren) ve vergi (gelir + damga) tahakkuku − ödemeleri
function stateLiabilities() {
  const p = one(`SELECT COALESCE(SUM(employee_sgk + employer_sgk), 0) sgk, COALESCE(SUM(income_tax + stamp_tax), 0) tax FROM payroll`);
  const paid = (kind) => one('SELECT COALESCE(SUM(amount_try), 0) s FROM transactions WHERE kind = ?', kind).s;
  return { sgk: r2(p.sgk - paid('sgk_payment')), tax: r2(p.tax - paid('tax_payment')) };
}

module.exports = {
  INCOMING, PERSONNEL_KINDS, directionOf, computeInvoice, paidOf, invoiceState, accountBalance, toTry,
  personnelLedger, stateLiabilities, daysBetween,
};
