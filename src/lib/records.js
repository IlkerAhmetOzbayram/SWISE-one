// Aktivite, masraf ve rapor modüllerinin ortak sorgu yardımcıları
const { one } = require('../db');
const { HttpError, bad } = require('./http');
const { date } = require('./validate');
const { isAdmin } = require('./auth');

// Tarih/müşteri/şirket/proje/kullanıcı filtresi. Çalışan yalnızca kendi kayıtlarını görür.
function buildFilter(req, alias) {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.from) { where.push(`${alias}.date >= ?`); params.push(date(q.from, 'Başlangıç')); }
  if (q.to) { where.push(`${alias}.date <= ?`); params.push(date(q.to, 'Bitiş')); }
  if (q.project_id) { where.push(`${alias}.project_id = ?`); params.push(Number(q.project_id)); }
  if (q.company_id) { where.push('p.company_id = ?'); params.push(Number(q.company_id)); }
  if (q.customer_id) { where.push('co.customer_id = ?'); params.push(Number(q.customer_id)); }
  if (!isAdmin(req)) { where.push(`${alias}.user_id = ?`); params.push(req.user.id); }
  else if (q.user_id) { where.push(`${alias}.user_id = ?`); params.push(Number(q.user_id)); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const JOINS = (alias) => `JOIN projects p ON p.id = ${alias}.project_id
  JOIN companies co ON co.id = p.company_id JOIN customers cu ON cu.id = co.customer_id
  JOIN users u ON u.id = ${alias}.user_id`;

// Listelerde her kayda eklenen müşteri/şirket/proje adları
const NAMES = `p.name project_name, co.id company_id, co.name company_name, cu.id customer_id, cu.name customer_name,
  u.full_name user_name`;

// Kayıt sahibi veya yönetici değilse erişim yok
function ownRecord(req, table, id) {
  const row = one(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Kayıt bulunamadı');
  if (!isAdmin(req) && row.user_id !== req.user.id) throw new HttpError(403, 'Bu kayıt size ait değil');
  return row;
}

// Pasif proje/şirket/müşteriye yalnızca yönetici veya mevcut kaydın kendisi yazabilir
function checkProject(req, projectId, existingProjectId) {
  const p = one(`SELECT (p.active AND co.active AND cu.active) usable FROM projects p
                 JOIN companies co ON co.id = p.company_id JOIN customers cu ON cu.id = co.customer_id WHERE p.id = ?`, projectId);
  if (!p) bad('Proje bulunamadı');
  if (!p.usable && projectId !== existingProjectId && !isAdmin(req)) bad('Bu proje pasif');
}

// Yönetici başka bir kullanıcı adına kayıt girebilir
const targetUserId = (req, existing) =>
  (isAdmin(req) && req.body.user_id ? Number(req.body.user_id) : (existing?.user_id ?? req.user.id));

module.exports = { buildFilter, JOINS, NAMES, ownRecord, checkProject, targetUserId };
