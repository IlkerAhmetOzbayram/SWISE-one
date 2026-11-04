const express = require('express');
const crypto = require('crypto');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

// ---------- Doğrulama yardımcıları ----------
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

// ---------- Parola ve oturum ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}
const SESSION_DAYS = 30;
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    token, userId, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}
const getToken = (req) => (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/)?.[1];

function auth(req, res, next) {
  const token = getToken(req);
  const user = token && one(
    `SELECT u.id, u.username, u.full_name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`, token, Date.now());
  if (!user) return res.status(401).json({ error: 'Lütfen giriş yapın' });
  req.user = user;
  next();
}
const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
const isAdmin = (req) => req.user.role === 'admin';

// ---------- Kurulum ve giriş ----------
app.get('/api/setup', (req, res) => {
  res.json({ needsSetup: one('SELECT COUNT(*) n FROM users').n === 0 });
});

app.post('/api/setup', (req, res) => {
  if (one('SELECT COUNT(*) n FROM users').n > 0) bad('Kurulum zaten tamamlanmış');
  const b = req.body;
  const password = str(b.password, 'Parola');
  if (password.length < 6) bad('Parola en az 6 karakter olmalı');
  const { lastInsertRowid } = run(
    `INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, 'admin')`,
    str(b.username, 'Kullanıcı adı').toLowerCase(), str(b.full_name, 'Ad soyad'), hashPassword(password));
  if (b.company_name) run(`UPDATE settings SET value = ? WHERE key = 'company_name'`, str(b.company_name, 'Şirket adı'));
  startSession(res, Number(lastInsertRowid));
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const u = one('SELECT * FROM users WHERE username = ? AND active = 1',
    str(req.body.username, 'Kullanıcı adı').toLowerCase());
  if (!u || !verifyPassword(str(req.body.password, 'Parola'), u.password_hash)) {
    throw new HttpError(401, 'Kullanıcı adı veya parola hatalı');
  }
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  startSession(res, u.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = getToken(req);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.put('/api/me/password', auth, (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(str(req.body.current, 'Mevcut parola'), u.password_hash)) bad('Mevcut parola hatalı');
  const pw = str(req.body.password, 'Yeni parola');
  if (pw.length < 6) bad('Parola en az 6 karakter olmalı');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), u.id);
  res.json({ ok: true });
});

// ---------- Ayarlar ----------
const getSettings = () => Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));

app.get('/api/settings', auth, (req, res) => res.json(getSettings()));

app.put('/api/settings', auth, admin, (req, res) => {
  const b = req.body;
  const values = {
    company_name: str(b.company_name, 'Şirket adı'),
    vat_rate: String(num(b.vat_rate, 'KDV oranı')),
    withholding_rate: String(num(b.withholding_rate, 'Stopaj oranı')),
    expense_categories: str(b.expense_categories, 'Masraf kategorileri'),
  };
  for (const [k, v] of Object.entries(values)) {
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
  }
  res.json(getSettings());
});

// ---------- Kullanıcılar ----------
app.get('/api/users', auth, (req, res) => {
  const cols = isAdmin(req) ? 'id, username, full_name, role, hourly_rate, active' : 'id, full_name';
  res.json(all(`SELECT ${cols} FROM users ORDER BY full_name`));
});

function userFields(b) {
  const role = b.role === 'admin' ? 'admin' : 'user';
  return [str(b.username, 'Kullanıcı adı').toLowerCase(), str(b.full_name, 'Ad soyad'), role,
    num(b.hourly_rate, 'Saatlik ücret', { required: false }) ?? 0];
}

app.post('/api/users', auth, admin, (req, res) => {
  const pw = str(req.body.password, 'Parola');
  if (pw.length < 6) bad('Parola en az 6 karakter olmalı');
  const { lastInsertRowid } = run(
    'INSERT INTO users (username, full_name, role, hourly_rate, password_hash) VALUES (?, ?, ?, ?, ?)',
    ...userFields(req.body), hashPassword(pw));
  res.json({ id: Number(lastInsertRowid) });
});

app.put('/api/users/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  const active = req.body.active === undefined ? 1 : flag(req.body.active);
  if (id === req.user.id && (!active || req.body.role !== 'admin')) bad('Kendi yönetici hesabınızı pasifleştiremez veya yetkisini düşüremezsiniz');
  run('UPDATE users SET username = ?, full_name = ?, role = ?, hourly_rate = ?, active = ? WHERE id = ?',
    ...userFields(req.body), active, id);
  if (req.body.password) {
    if (String(req.body.password).length < 6) bad('Parola en az 6 karakter olmalı');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(req.body.password)), id);
  }
  if (!active) run('DELETE FROM sessions WHERE user_id = ?', id);
  res.json({ ok: true });
});

// ---------- Müşteriler ve projeler ----------
app.get('/api/clients', auth, (req, res) => {
  const cols = isAdmin(req) ? '*' : 'id, name, active';
  res.json(all(`SELECT ${cols} FROM clients ORDER BY name`));
});

const clientFields = (b) => [str(b.name, 'Müşteri adı'), str(b.tax_no, '', false), str(b.tax_office, '', false),
  str(b.address, '', false), num(b.default_rate, 'Varsayılan ücret', { required: false }), flag(b.withholding),
  b.active === undefined ? 1 : flag(b.active)];

app.post('/api/clients', auth, admin, (req, res) => {
  const { lastInsertRowid } = run(
    'INSERT INTO clients (name, tax_no, tax_office, address, default_rate, withholding, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ...clientFields(req.body));
  res.json({ id: Number(lastInsertRowid) });
});

app.put('/api/clients/:id', auth, admin, (req, res) => {
  run('UPDATE clients SET name = ?, tax_no = ?, tax_office = ?, address = ?, default_rate = ?, withholding = ?, active = ? WHERE id = ?',
    ...clientFields(req.body), Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/projects', auth, (req, res) => {
  const cols = isAdmin(req) ? 'p.*' : 'p.id, p.client_id, p.name, p.active';
  res.json(all(`SELECT ${cols}, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY c.name, p.name`));
});

function projectFields(b) {
  const clientId = num(b.client_id, 'Müşteri');
  if (!one('SELECT id FROM clients WHERE id = ?', clientId)) bad('Müşteri bulunamadı');
  return [clientId, str(b.name, 'Proje adı'), num(b.hourly_rate, 'Saatlik ücret', { required: false }),
    b.active === undefined ? 1 : flag(b.active)];
}

app.post('/api/projects', auth, admin, (req, res) => {
  const { lastInsertRowid } = run('INSERT INTO projects (client_id, name, hourly_rate, active) VALUES (?, ?, ?, ?)',
    ...projectFields(req.body));
  res.json({ id: Number(lastInsertRowid) });
});

app.put('/api/projects/:id', auth, admin, (req, res) => {
  run('UPDATE projects SET client_id = ?, name = ?, hourly_rate = ?, active = ? WHERE id = ?',
    ...projectFields(req.body), Number(req.params.id));
  res.json({ ok: true });
});

// Ücret önceliği: proje ücreti → müşteri varsayılanı → kullanıcı ücreti
function resolveRate(projectId, userId) {
  const r = one(`SELECT p.hourly_rate pr, c.default_rate cr, (SELECT hourly_rate FROM users WHERE id = ?) ur
                 FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?`, userId, projectId);
  if (!r) bad('Proje bulunamadı');
  return r.pr ?? r.cr ?? r.ur ?? 0;
}

// ---------- Filtreleme (aktivite, masraf ve rapor ortak) ----------
function buildFilter(req, alias) {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.from) { where.push(`${alias}.date >= ?`); params.push(date(q.from, 'Başlangıç')); }
  if (q.to) { where.push(`${alias}.date <= ?`); params.push(date(q.to, 'Bitiş')); }
  if (q.project_id) { where.push(`${alias}.project_id = ?`); params.push(Number(q.project_id)); }
  if (q.client_id) { where.push('p.client_id = ?'); params.push(Number(q.client_id)); }
  if (!isAdmin(req)) { where.push(`${alias}.user_id = ?`); params.push(req.user.id); }
  else if (q.user_id) { where.push(`${alias}.user_id = ?`); params.push(Number(q.user_id)); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const JOINS = (alias) => `JOIN projects p ON p.id = ${alias}.project_id
  JOIN clients c ON c.id = p.client_id JOIN users u ON u.id = ${alias}.user_id`;

function listActivities(req) {
  const f = buildFilter(req, 'a');
  return all(`SELECT a.*, p.name project_name, c.id client_id, c.name client_name, c.withholding, u.full_name user_name
              FROM activities a ${JOINS('a')} ${f.sql} ORDER BY a.date DESC, a.id DESC`, ...f.params);
}
function listExpenses(req) {
  const f = buildFilter(req, 'e');
  return all(`SELECT e.*, p.name project_name, c.id client_id, c.name client_name, u.full_name user_name
              FROM expenses e ${JOINS('e')} ${f.sql} ORDER BY e.date DESC, e.id DESC`, ...f.params);
}

// Kayıt sahibi veya yönetici değilse erişim yok
function ownRecord(req, table, id) {
  const row = one(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı');
  if (!isAdmin(req) && row.user_id !== req.user.id) throw new HttpError(403, 'Bu kayıt size ait değil');
  return row;
}
function checkProject(req, projectId, existingProjectId) {
  const p = one('SELECT active FROM projects WHERE id = ?', projectId);
  if (!p) bad('Proje bulunamadı');
  if (!p.active && projectId !== existingProjectId && !isAdmin(req)) bad('Bu proje pasif');
}

// ---------- Aktiviteler ----------
app.get('/api/activities', auth, (req, res) => {
  const rows = listActivities(req);
  if (!isAdmin(req)) rows.forEach((r) => delete r.rate);
  res.json(rows);
});

function activityFields(req, existing) {
  const b = req.body;
  const projectId = num(b.project_id, 'Proje');
  checkProject(req, projectId, existing?.project_id);
  const hours = num(b.hours, 'Süre');
  if (hours <= 0 || hours > 24) bad('Süre 0 ile 24 saat arasında olmalı');
  const userId = isAdmin(req) && b.user_id ? Number(b.user_id) : (existing?.user_id ?? req.user.id);
  let rate;
  if (isAdmin(req) && b.rate !== undefined && b.rate !== '' && b.rate !== null) rate = num(b.rate, 'Ücret');
  else if (existing && existing.project_id === projectId && existing.user_id === userId) rate = existing.rate;
  else rate = resolveRate(projectId, userId);
  return { userId, values: [projectId, date(b.date), str(b.description, 'Açıklama'), hours, flag(b.billable), rate] };
}

app.post('/api/activities', auth, (req, res) => {
  const { userId, values } = activityFields(req);
  const { lastInsertRowid } = run(
    'INSERT INTO activities (project_id, date, description, hours, billable, rate, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ...values, userId);
  res.json({ id: Number(lastInsertRowid) });
});

app.put('/api/activities/:id', auth, (req, res) => {
  const existing = ownRecord(req, 'activities', Number(req.params.id));
  const { userId, values } = activityFields(req, existing);
  run('UPDATE activities SET project_id = ?, date = ?, description = ?, hours = ?, billable = ?, rate = ?, user_id = ? WHERE id = ?',
    ...values, userId, existing.id);
  res.json({ ok: true });
});

app.delete('/api/activities/:id', auth, (req, res) => {
  const existing = ownRecord(req, 'activities', Number(req.params.id));
  run('DELETE FROM activities WHERE id = ?', existing.id);
  res.json({ ok: true });
});

// ---------- Masraflar ----------
app.get('/api/expenses', auth, (req, res) => res.json(listExpenses(req)));

function expenseFields(req, existing) {
  const b = req.body;
  const projectId = num(b.project_id, 'Proje');
  checkProject(req, projectId, existing?.project_id);
  const userId = isAdmin(req) && b.user_id ? Number(b.user_id) : (existing?.user_id ?? req.user.id);
  return { userId, values: [projectId, date(b.date), str(b.category, 'Kategori'), str(b.description, '', false),
    num(b.amount, 'Tutar'), num(b.vat_rate, 'KDV oranı', { required: false }) ?? 0, flag(b.billable)] };
}

app.post('/api/expenses', auth, (req, res) => {
  const { userId, values } = expenseFields(req);
  const { lastInsertRowid } = run(
    'INSERT INTO expenses (project_id, date, category, description, amount, vat_rate, billable, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ...values, userId);
  res.json({ id: Number(lastInsertRowid) });
});

app.put('/api/expenses/:id', auth, (req, res) => {
  const existing = ownRecord(req, 'expenses', Number(req.params.id));
  const { userId, values } = expenseFields(req, existing);
  run('UPDATE expenses SET project_id = ?, date = ?, category = ?, description = ?, amount = ?, vat_rate = ?, billable = ?, user_id = ? WHERE id = ?',
    ...values, userId, existing.id);
  res.json({ ok: true });
});

app.delete('/api/expenses/:id', auth, (req, res) => {
  const existing = ownRecord(req, 'expenses', Number(req.params.id));
  run('DELETE FROM expenses WHERE id = ?', existing.id);
  res.json({ ok: true });
});

// ---------- Muhasebe raporu ----------
// Hesap mantığı (serbest meslek / hizmet faturası):
//   Hizmet bedeli      = Σ faturalanabilir saat × ücret
//   KDV matrahı        = hizmet bedeli + müşteriye yansıtılan masraflar
//   KDV                = matrah × KDV oranı
//   Stopaj             = hizmet bedeli × stopaj oranı (yalnızca stopaj kesen müşterilerde)
//   Fatura toplamı     = matrah + KDV
//   Net tahsilat       = fatura toplamı − stopaj
function buildReport(req) {
  const s = getSettings();
  const vatRate = Number(s.vat_rate) / 100;
  const whRate = Number(s.withholding_rate) / 100;
  const activities = listActivities(req).reverse();
  const expenses = listExpenses(req).reverse();

  const clients = new Map();
  const users = new Map();
  const clientOf = (row) => {
    if (!clients.has(row.client_id)) {
      const c = one('SELECT id, name, tax_no, tax_office, withholding FROM clients WHERE id = ?', row.client_id);
      clients.set(row.client_id, { ...c, projects: new Map() });
    }
    const c = clients.get(row.client_id);
    if (!c.projects.has(row.project_id)) {
      c.projects.set(row.project_id, { id: row.project_id, name: row.project_name, hours: 0, billable_hours: 0, fee: 0, expenses: 0 });
    }
    return c.projects.get(row.project_id);
  };

  for (const a of activities) {
    const p = clientOf(a);
    p.hours += a.hours;
    if (!users.has(a.user_id)) users.set(a.user_id, { id: a.user_id, name: a.user_name, hours: 0, billable_hours: 0, fee: 0 });
    const u = users.get(a.user_id);
    u.hours += a.hours;
    if (a.billable) {
      p.billable_hours += a.hours; p.fee += a.hours * a.rate;
      u.billable_hours += a.hours; u.fee += a.hours * a.rate;
    }
  }

  const expenseSummary = { billable: 0, nonbillable: 0, input_vat: 0, categories: new Map() };
  for (const e of expenses) {
    const p = clientOf(e);
    const vat = e.amount * e.vat_rate / 100;
    expenseSummary.input_vat += vat;
    if (e.billable) { p.expenses += e.amount; expenseSummary.billable += e.amount; }
    else expenseSummary.nonbillable += e.amount;
    const cat = expenseSummary.categories.get(e.category) || { category: e.category, amount: 0, vat: 0 };
    cat.amount += e.amount; cat.vat += vat;
    expenseSummary.categories.set(e.category, cat);
  }

  const keys = ['hours', 'billable_hours', 'fee', 'expenses', 'vat_base', 'vat', 'withholding_amount', 'invoice_total', 'net'];
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  const clientList = [...clients.values()].map((c) => {
    const projects = [...c.projects.values()].map((p) => ({
      ...p, hours: r2(p.hours), billable_hours: r2(p.billable_hours), fee: r2(p.fee), expenses: r2(p.expenses),
    }));
    const sum = (k) => r2(projects.reduce((acc, p) => acc + p[k], 0));
    const row = { id: c.id, name: c.name, tax_no: c.tax_no, tax_office: c.tax_office, withholding: !!c.withholding, projects,
      hours: sum('hours'), billable_hours: sum('billable_hours'), fee: sum('fee'), expenses: sum('expenses') };
    row.vat_base = r2(row.fee + row.expenses);
    row.vat = r2(row.vat_base * vatRate);
    row.withholding_amount = c.withholding ? r2(row.fee * whRate) : 0;
    row.invoice_total = r2(row.vat_base + row.vat);
    row.net = r2(row.invoice_total - row.withholding_amount);
    for (const k of keys) totals[k] = r2(totals[k] + row[k]);
    return row;
  }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return {
    company_name: s.company_name,
    vat_rate: Number(s.vat_rate),
    withholding_rate: Number(s.withholding_rate),
    period: { from: req.query.from || null, to: req.query.to || null },
    clients: clientList,
    users: [...users.values()].map((u) => ({ ...u, hours: r2(u.hours), billable_hours: r2(u.billable_hours), fee: r2(u.fee) }))
      .sort((a, b) => b.hours - a.hours),
    expense_summary: {
      billable: r2(expenseSummary.billable), nonbillable: r2(expenseSummary.nonbillable), input_vat: r2(expenseSummary.input_vat),
      categories: [...expenseSummary.categories.values()].map((c) => ({ ...c, amount: r2(c.amount), vat: r2(c.vat) })),
    },
    totals,
    activities,
    expenses,
  };
}

app.get('/api/report', auth, admin, (req, res) => res.json(buildReport(req)));

app.get('/api/report.xlsx', auth, admin, (req, res, next) => {
  writeReportXlsx(req, res).catch(next);
});

async function writeReportXlsx(req, res) {
  const rep = buildReport(req);
  const wb = new ExcelJS.Workbook();
  wb.creator = rep.company_name;
  const MONEY = '#,##0.00 "₺"';
  const HOURS = '#,##0.00';
  const period = `${rep.period.from || 'Başlangıç'} – ${rep.period.to || 'Bugün'}`;

  const addSheet = (name, columns) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([`${rep.company_name} — ${name}`]).font = { bold: true, size: 14 };
    ws.addRow([`Dönem: ${period}`]);
    ws.addRow([]);
    const header = ws.addRow(columns.map((c) => c.header));
    header.font = { bold: true };
    header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } }; });
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width || 14;
      if (c.fmt) col.numFmt = c.fmt;
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    return ws;
  };

  // Özet
  const summary = addSheet('Muhasebe Özeti', [
    { header: 'Müşteri / Proje', width: 34 }, { header: 'VKN', width: 14 }, { header: 'Saat', fmt: HOURS },
    { header: 'Fat. Saat', fmt: HOURS }, { header: 'Hizmet Bedeli', fmt: MONEY, width: 16 },
    { header: 'Yansıtılan Masraf', fmt: MONEY, width: 16 }, { header: 'KDV Matrahı', fmt: MONEY, width: 16 },
    { header: `KDV (%${rep.vat_rate})`, fmt: MONEY, width: 16 }, { header: `Stopaj (%${rep.withholding_rate})`, fmt: MONEY, width: 16 },
    { header: 'Fatura Toplamı', fmt: MONEY, width: 16 }, { header: 'Net Tahsilat', fmt: MONEY, width: 16 },
  ]);
  for (const c of rep.clients) {
    summary.addRow([c.name, c.tax_no, c.hours, c.billable_hours, c.fee, c.expenses, c.vat_base, c.vat,
      c.withholding_amount, c.invoice_total, c.net]).font = { bold: true };
    for (const p of c.projects) summary.addRow([`   ${p.name}`, '', p.hours, p.billable_hours, p.fee, p.expenses]);
  }
  const t = rep.totals;
  const totalRow = summary.addRow(['TOPLAM', '', t.hours, t.billable_hours, t.fee, t.expenses, t.vat_base, t.vat,
    t.withholding_amount, t.invoice_total, t.net]);
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: 'thin' } };
  summary.addRow([]);
  summary.addRow(['Gider özeti']).font = { bold: true };
  summary.addRow(['Yansıtılan masraflar', '', '', '', rep.expense_summary.billable]);
  summary.addRow(['Yansıtılmayan masraflar (maliyet)', '', '', '', rep.expense_summary.nonbillable]);
  summary.addRow(['İndirilecek KDV (masraflar)', '', '', '', rep.expense_summary.input_vat]);

  // Efor
  const effort = addSheet('Kullanıcı Eforu', [
    { header: 'Kullanıcı', width: 28 }, { header: 'Toplam Saat', fmt: HOURS }, { header: 'Fat. Saat', fmt: HOURS },
    { header: 'Faturalanabilir Oran', fmt: '0%', width: 18 }, { header: 'Hizmet Bedeli', fmt: MONEY, width: 16 },
  ]);
  for (const u of rep.users) effort.addRow([u.name, u.hours, u.billable_hours, u.hours ? u.billable_hours / u.hours : 0, u.fee]);

  // Detaylar
  const acts = addSheet('Aktiviteler', [
    { header: 'Tarih', width: 12 }, { header: 'Kullanıcı', width: 22 }, { header: 'Müşteri', width: 24 },
    { header: 'Proje', width: 24 }, { header: 'Açıklama', width: 44 }, { header: 'Saat', fmt: HOURS },
    { header: 'Faturalanabilir', width: 14 }, { header: 'Ücret', fmt: MONEY }, { header: 'Tutar', fmt: MONEY, width: 16 },
  ]);
  for (const a of rep.activities) {
    acts.addRow([a.date, a.user_name, a.client_name, a.project_name, a.description, a.hours,
      a.billable ? 'Evet' : 'Hayır', a.rate, a.billable ? r2(a.hours * a.rate) : 0]);
  }

  const exps = addSheet('Masraflar', [
    { header: 'Tarih', width: 12 }, { header: 'Kullanıcı', width: 22 }, { header: 'Müşteri', width: 24 },
    { header: 'Proje', width: 24 }, { header: 'Kategori', width: 16 }, { header: 'Açıklama', width: 36 },
    { header: 'Tutar (KDV hariç)', fmt: MONEY, width: 18 }, { header: 'KDV %', width: 8 }, { header: 'KDV', fmt: MONEY },
    { header: 'Yansıtılır', width: 10 },
  ]);
  for (const e of rep.expenses) {
    exps.addRow([e.date, e.user_name, e.client_name, e.project_name, e.category, e.description, e.amount,
      e.vat_rate, r2(e.amount * e.vat_rate / 100), e.billable ? 'Evet' : 'Hayır']);
  }

  const fname = `muhasebe-raporu-${rep.period.from || 'tum'}_${rep.period.to || 'bugun'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  await wb.xlsx.write(res);
  res.end();
}

// ---------- Hata yönetimi ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (/UNIQUE constraint failed: users.username/.test(err.message)) return res.status(400).json({ error: 'Bu kullanıcı adı zaten var' });
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`SWISE One çalışıyor: http://localhost:${PORT}`));
